/**
 * Pulls recent Gmail messages and Calendar events for a connected user, matches the
 * external participants to CRM contacts, and logs them as activities on the best deal.
 */
import { config } from '../config.js'
import { one, query, withTransaction } from '../db.js'
import { audit } from '../audit.js'
import { fetcherFor, loadConnection, type ConnectionRow, type GoogleFetcher, type Params, GoogleApiError } from './client.js'
import { parseCalendarEvent, parseGmailMessage, type CalendarEvent, type GmailMessage, type ParsedEmail, type ParsedEvent } from './parse.js'
import type { EmailParty } from '../../shared/types.js'

export type Trigger = 'manual' | 'scheduled' | 'connect'

interface MatchedContact { id: string; company_id: string | null; email: string }

export interface SyncStats { seen: number; logged: number; updated: number }

// ---------- matching ----------

export async function matchContacts(parties: EmailParty[]): Promise<MatchedContact[]> {
  if (!parties.length) return []
  return query<MatchedContact>(
    `SELECT id, company_id, lower(email) AS email FROM contacts WHERE archived_at IS NULL AND lower(email) = ANY($1::text[])`,
    [parties.map((p) => p.email)],
  )
}

const domainOf = (email: string) => email.split('@')[1] ?? ''

/** Drop addresses whose domain the team has chosen to ignore (vendors, newsletters, system senders). */
export async function dropIgnored(parties: EmailParty[]): Promise<EmailParty[]> {
  if (!parties.length) return []
  const ignored = new Set((await query<{ domain: string }>('SELECT domain FROM sync_ignored_domains WHERE domain = ANY($1::text[])', [[...new Set(parties.map((p) => domainOf(p.email)))]])).map((r) => r.domain))
  return parties.filter((p) => !ignored.has(domainOf(p.email)))
}

/**
 * Senders at a domain that belongs to a known company become contacts automatically
 * (HubSpot-style domain association). Returns the contacts created.
 */
export async function autoCreateByDomain(parties: EmailParty[], userId: string): Promise<MatchedContact[]> {
  if (!parties.length) return []
  const companies = await query<{ id: string; domain: string }>('SELECT id, lower(domain) AS domain FROM companies WHERE archived_at IS NULL AND lower(domain) = ANY($1::text[])', [[...new Set(parties.map((p) => domainOf(p.email)))]])
  if (!companies.length) return []
  const out: MatchedContact[] = []
  for (const p of parties) {
    const company = companies.find((c) => c.domain === domainOf(p.email))
    if (!company) continue
    const [first, ...rest] = (p.name ?? p.email.split('@')[0].replace(/[._-]+/g, ' ')).split(/\s+/)
    const c = await one<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, company_id, owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT DO NOTHING RETURNING id`,
      [first || p.email, rest.join(' '), p.email, company.id, userId],
    )
    if (!c) continue
    await withTransaction((client) => audit(client, { entityType: 'contact', entityId: c.id, action: 'create', actorId: userId, changes: { email: p.email, company_id: company.id, via: 'domain match' }, summary: `Contact created automatically from ${p.email} (company domain match)` }))
    out.push({ id: c.id, company_id: company.id, email: p.email })
  }
  return out
}

/** Best deal for a set of contacts: open deal naming one of them, else an open deal at their company; newest first. */
export async function pickDeal(contacts: MatchedContact[]): Promise<{ id: string; company_id: string | null } | null> {
  if (!contacts.length) return null
  const contactIds = contacts.map((c) => c.id)
  const companyIds = contacts.map((c) => c.company_id).filter((x): x is string => !!x)
  return one<{ id: string; company_id: string | null }>(
    `SELECT d.id, d.company_id FROM deals d JOIN stages s ON s.id = d.stage_id
     WHERE d.archived_at IS NULL AND (d.contact_id = ANY($1::uuid[]) OR d.company_id = ANY($2::uuid[]))
     ORDER BY (s.kind = 'open') DESC, (d.contact_id = ANY($1::uuid[])) DESC, d.updated_at DESC LIMIT 1`,
    [contactIds, companyIds],
  )
}

async function recordUnmatched(userId: string, source: 'gmail' | 'gcal', externalId: string, occurredAt: string, subject: string, addresses: EmailParty[], url: string | null): Promise<void> {
  if (!addresses.length) return
  await query(
    `INSERT INTO sync_unmatched (user_id, source, external_id, occurred_at, subject, addresses, external_url)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT (source, external_id) DO NOTHING`,
    [userId, source, externalId, occurredAt, subject, JSON.stringify(addresses), url],
  )
}

async function touchDeal(dealId: string | null, at: string): Promise<void> {
  if (!dealId) return
  await query('UPDATE deals SET last_activity_at = GREATEST(COALESCE(last_activity_at, $2), $2) WHERE id = $1', [dealId, at])
}

// ---------- re-evaluating earlier unmatched items ----------

interface UnmatchedRow { id: number; source: 'gmail' | 'gcal'; external_id: string; addresses: EmailParty[] }

/**
 * Items we could not match earlier may match now (a contact was created or linked, a company
 * learned its domain). Fetch exactly those items again and log them. Runs at the start of each sync.
 */
export async function reprocessUnmatched(conn: ConnectionRow, api: GoogleFetcher, source: 'gmail' | 'gcal'): Promise<{ logged: number; dismissed: number }> {
  const rows = await query<UnmatchedRow>(`SELECT id, source, external_id, addresses FROM sync_unmatched WHERE user_id = $1 AND source = $2 AND dismissed_at IS NULL ORDER BY occurred_at DESC LIMIT 500`, [conn.user_id, source])
  let logged = 0
  let dismissed = 0
  for (const row of rows) {
    const addresses = await dropIgnored(row.addresses)
    if (!addresses.length) {
      await query('UPDATE sync_unmatched SET dismissed_at = now() WHERE id = $1', [row.id])
      dismissed++
      continue
    }
    let contacts = await matchContacts(addresses)
    if (!contacts.length) contacts = await autoCreateByDomain(addresses, conn.user_id)
    if (!contacts.length) continue
    try {
      if (source === 'gmail') {
        const q = row.external_id.startsWith('gmail:') ? null : `rfc822msgid:${row.external_id}`
        const id = q
          ? (await api.get<{ messages?: Array<{ id: string }> }>(`${GMAIL}/messages`, { q, maxResults: 1 })).messages?.[0]?.id
          : row.external_id.slice('gmail:'.length)
        if (!id) continue
        const m = await api.get<GmailMessage>(`${GMAIL}/messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID'] })
        const parsed = parseGmailMessage(m, conn.google_email, config.allowedDomain)
        const r = await logEmail(conn.user_id, parsed)
        if (r === 'logged') {
          logged++
          await query(`UPDATE activities SET meta = meta || jsonb_build_object('gmail_id', $2::text) WHERE source = 'gmail' AND external_id = $1`, [parsed.message_id, id])
        }
        if (r !== 'unmatched') await query('DELETE FROM sync_unmatched WHERE id = $1', [row.id])
      } else {
        const page = await api.get<{ items?: CalendarEvent[] }>(CAL, { iCalUID: row.external_id, singleEvents: 'true', maxResults: 5 })
        const raw = page.items?.[0]
        if (!raw) {
          await query('DELETE FROM sync_unmatched WHERE id = $1', [row.id])
          continue
        }
        const r = await logEvent(conn.user_id, parseCalendarEvent(raw, config.allowedDomain))
        if (r === 'logged' || r === 'updated') logged++
        if (r !== 'unmatched') await query('DELETE FROM sync_unmatched WHERE id = $1', [row.id])
      }
    } catch (e) {
      console.warn('reprocess failed for', row.source, row.external_id, (e as Error).message)
    }
  }
  return { logged, dismissed }
}

// ---------- runs ----------

async function startRun(userId: string, kind: 'gmail' | 'calendar', trigger: Trigger): Promise<number> {
  const r = (await one<{ id: number }>('INSERT INTO sync_runs (user_id, kind, trigger) VALUES ($1, $2, $3) RETURNING id', [userId, kind, trigger]))!
  return r.id
}

async function finishRun(id: number, stats: SyncStats, error?: string): Promise<void> {
  await query(
    `UPDATE sync_runs SET finished_at = now(), status = $2, items_seen = $3, items_logged = $4, items_updated = $5, error = $6 WHERE id = $1`,
    [id, error ? 'error' : 'ok', stats.seen, stats.logged, stats.updated, error ?? null],
  )
}

// ---------- Gmail ----------

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

export async function logEmail(userId: string, email: ParsedEmail): Promise<'logged' | 'skipped' | 'unmatched'> {
  const external = await dropIgnored(email.external)
  if (!external.length) return 'skipped'
  let contacts = await matchContacts(external)
  if (!contacts.length) contacts = await autoCreateByDomain(external, userId)
  if (!contacts.length) {
    await recordUnmatched(userId, 'gmail', email.message_id, email.date, email.subject, external, `https://mail.google.com/mail/#all/${email.thread_id}`)
    return 'unmatched'
  }
  // Prefer the contact on the From line (for received mail), else the first match.
  const primary = contacts.find((c) => c.email === email.from?.email) ?? contacts[0]
  const deal = await pickDeal(contacts)
  const inserted = await one<{ id: string }>(
    `INSERT INTO activities (type, subject, body, deal_id, contact_id, company_id, owner_id, due_at, completed_at, created_by, created_at, source, external_id, external_url, meta)
     VALUES ('email', $1, $2, $3, $4, $5, $6, NULL, $7, $6, $7, 'gmail', $8, $9, $10::jsonb)
     ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
    [
      email.subject,
      email.snippet || null,
      deal?.id ?? null,
      primary.id,
      deal?.company_id ?? primary.company_id,
      userId,
      email.date,
      email.message_id,
      `https://mail.google.com/mail/#all/${email.thread_id}`,
      JSON.stringify({ direction: email.direction, from: email.from, to: email.to, cc: email.cc, thread_id: email.thread_id, synced_by: userId }),
    ],
  )
  if (!inserted) return 'skipped'
  await touchDeal(deal?.id ?? null, email.date)
  return 'logged'
}

export async function syncGmail(conn: ConnectionRow, api: GoogleFetcher, trigger: Trigger): Promise<SyncStats> {
  const runId = await startRun(conn.user_id, 'gmail', trigger)
  const stats: SyncStats = { seen: 0, logged: 0, updated: 0 }
  try {
    const re = await reprocessUnmatched(conn, api, 'gmail')
    stats.logged += re.logged
    // Overlap the previous watermark by a day: Gmail's `after:` is day-granular and
    // messages can arrive out of order. Dedup makes the overlap harmless.
    const since = conn.gmail_synced_through
      ? new Date(new Date(conn.gmail_synced_through).getTime() - 86400e3)
      : new Date(Date.now() - conn.gmail_sync_window_days * 86400e3)
    const q = `after:${Math.floor(since.getTime() / 1000)} -in:spam -in:trash -in:chats -category:promotions -category:social -category:updates -category:forums`
    const started = new Date()
    let pageToken: string | undefined
    const ids: Array<{ id: string }> = []
    do {
      const page = await api.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(`${GMAIL}/messages`, { q, maxResults: 100, pageToken })
      ids.push(...(page.messages ?? []))
      pageToken = page.nextPageToken
    } while (pageToken && ids.length < 2000)

    // Skip anything already logged or already recorded as unmatched.
    const known = new Set(
      (await query<{ external_id: string }>(
        `SELECT external_id FROM activities WHERE source = 'gmail' AND meta->>'synced_by' = $1::text AND created_at >= $2
         UNION SELECT external_id FROM sync_unmatched WHERE source = 'gmail' AND user_id = $1::uuid AND occurred_at >= $2`,
        [conn.user_id, since.toISOString()],
      )).map((r) => r.external_id),
    )
    // We only know the Message-ID after fetching, so track gmail ids we fetched in this window too.
    const fetchedGmailIds = new Set((await query<{ id: string }>(`SELECT meta->>'gmail_id' AS id FROM activities WHERE source = 'gmail' AND meta->>'synced_by' = $1::text AND created_at >= $2`, [conn.user_id, since.toISOString()])).map((r) => r.id))

    for (const { id } of ids) {
      if (fetchedGmailIds.has(id)) continue
      stats.seen++
      const m = await api.get<GmailMessage>(`${GMAIL}/messages/${id}`, { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date', 'Message-ID'] })
      const parsed = parseGmailMessage(m, conn.google_email, config.allowedDomain)
      if (known.has(parsed.message_id)) continue
      if (!parsed.external.length) continue // purely internal thread
      const r = await logEmail(conn.user_id, { ...parsed })
      if (r === 'logged') {
        stats.logged++
        await query(`UPDATE activities SET meta = meta || jsonb_build_object('gmail_id', $2::text) WHERE source = 'gmail' AND external_id = $1`, [parsed.message_id, id])
      }
    }
    await query('UPDATE google_connections SET gmail_synced_through = $2, gmail_last_synced_at = now(), last_error = NULL WHERE user_id = $1', [conn.user_id, started.toISOString()])
    await finishRun(runId, stats)
  } catch (e) {
    const msg = (e as Error).message
    await query('UPDATE google_connections SET last_error = $2 WHERE user_id = $1', [conn.user_id, msg])
    await finishRun(runId, stats, msg)
    throw e
  }
  return stats
}

// ---------- Calendar ----------

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export async function logEvent(userId: string, ev: ParsedEvent): Promise<'logged' | 'updated' | 'removed' | 'skipped' | 'unmatched'> {
  const existing = await one<{ id: string; deal_id: string | null }>(`SELECT id, deal_id FROM activities WHERE source = 'gcal' AND external_id = $1`, [ev.uid])
  if (ev.cancelled) {
    if (!existing) return 'skipped'
    await withTransaction(async (client) => {
      await query('DELETE FROM activities WHERE id = $1', [existing.id], client)
      await audit(client, { entityType: 'activity', entityId: existing.id, action: 'delete', actorId: null, changes: { subject: ev.subject, reason: 'calendar event cancelled' }, summary: `Calendar event cancelled: ${ev.subject}` })
    })
    return 'removed'
  }
  if (!ev.starts_at) return 'skipped'
  const external = await dropIgnored(ev.external)
  if (!external.length && !existing) return 'skipped'
  let contacts = await matchContacts(external)
  if (!contacts.length && !existing) contacts = await autoCreateByDomain(external, userId)
  if (!contacts.length && !existing) {
    await recordUnmatched(userId, 'gcal', ev.uid, ev.starts_at, ev.subject, external, ev.url)
    return 'unmatched'
  }
  const primary = contacts[0]
  const deal = existing?.deal_id ? { id: existing.deal_id, company_id: null } : await pickDeal(contacts)
  const completedAt = ev.ends_at && new Date(ev.ends_at).getTime() < Date.now() ? ev.ends_at : null
  const meta = JSON.stringify({ attendees: ev.attendees, location: ev.location, conference_url: ev.conference_url, all_day: ev.all_day, synced_by: userId })
  if (existing) {
    await query(
      `UPDATE activities SET subject = $2, body = $3, due_at = $4, ends_at = $5, completed_at = COALESCE(completed_at, $6), external_url = $7, meta = meta || $8::jsonb WHERE id = $1`,
      [existing.id, ev.subject, ev.description, ev.starts_at, ev.ends_at, completedAt, ev.url, meta],
    )
    return 'updated'
  }
  await query(
    `INSERT INTO activities (type, subject, body, deal_id, contact_id, company_id, owner_id, due_at, ends_at, completed_at, created_by, source, external_id, external_url, meta)
     VALUES ('meeting', $1, $2, $3, $4, $5, $6, $7, $8, $9, $6, 'gcal', $10, $11, $12::jsonb)
     ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
    [ev.subject, ev.description, deal?.id ?? null, primary?.id ?? null, deal?.company_id ?? primary?.company_id ?? null, userId, ev.starts_at, ev.ends_at, completedAt, ev.uid, ev.url, meta],
  )
  if (completedAt) await touchDeal(deal?.id ?? null, completedAt)
  return 'logged'
}

export async function syncCalendar(conn: ConnectionRow, api: GoogleFetcher, trigger: Trigger): Promise<SyncStats> {
  const runId = await startRun(conn.user_id, 'calendar', trigger)
  const stats: SyncStats = { seen: 0, logged: 0, updated: 0 }
  const fetchAll = async (syncToken: string | null) => {
    const events: CalendarEvent[] = []
    let pageToken: string | undefined
    let nextSyncToken: string | undefined
    do {
      const params: Params = syncToken
        ? { syncToken, pageToken, maxResults: 250 }
        : { singleEvents: 'true', timeMin: new Date(Date.now() - 30 * 86400e3).toISOString(), timeMax: new Date(Date.now() + 90 * 86400e3).toISOString(), maxResults: 250, pageToken }
      const page = await api.get<{ items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }>(CAL, params)
      events.push(...(page.items ?? []))
      pageToken = page.nextPageToken
      nextSyncToken = page.nextSyncToken ?? nextSyncToken
    } while (pageToken)
    return { events, nextSyncToken }
  }
  try {
    const re = await reprocessUnmatched(conn, api, 'gcal')
    stats.logged += re.logged
    let result
    try {
      result = await fetchAll(conn.calendar_sync_token)
    } catch (e) {
      // 410 Gone: the sync token expired. Start over with a full window.
      if (e instanceof GoogleApiError && e.status === 410 && conn.calendar_sync_token) result = await fetchAll(null)
      else throw e
    }
    for (const raw of result.events) {
      stats.seen++
      const ev = parseCalendarEvent(raw, config.allowedDomain)
      if (!ev.cancelled && !ev.external.length) continue // internal-only meeting
      const r = await logEvent(conn.user_id, ev)
      if (r === 'logged') stats.logged++
      else if (r === 'updated' || r === 'removed') stats.updated++
    }
    // Past meetings that have ended count as happened.
    await query(`UPDATE activities SET completed_at = ends_at WHERE source = 'gcal' AND completed_at IS NULL AND ends_at < now()`)
    await query('UPDATE google_connections SET calendar_sync_token = $2, calendar_last_synced_at = now(), last_error = NULL WHERE user_id = $1', [conn.user_id, result.nextSyncToken ?? conn.calendar_sync_token])
    await finishRun(runId, stats)
  } catch (e) {
    const msg = (e as Error).message
    await query('UPDATE google_connections SET last_error = $2 WHERE user_id = $1', [conn.user_id, msg])
    await finishRun(runId, stats, msg)
    throw e
  }
  return stats
}

// ---------- orchestration ----------

// One sync per user at a time. Entries expire so a frozen instance can never wedge a user forever.
const inFlight = new Map<string, number>()
const IN_FLIGHT_TTL_MS = 15 * 60 * 1000

export async function syncUser(userId: string, trigger: Trigger, apiOverride?: GoogleFetcher): Promise<{ gmail?: SyncStats; calendar?: SyncStats; errors: string[] }> {
  const startedAt = inFlight.get(userId)
  if (startedAt && Date.now() - startedAt < IN_FLIGHT_TTL_MS) return { errors: [`A sync started ${Math.round((Date.now() - startedAt) / 60000)} min ago is still running; try again shortly`] }
  inFlight.set(userId, Date.now())
  try {
    const conn = await loadConnection(userId)
    if (!conn) return { errors: ['Google account is not connected'] }
    const api = apiOverride ?? fetcherFor(conn)
    const out: { gmail?: SyncStats; calendar?: SyncStats; errors: string[] } = { errors: [] }
    if (conn.gmail_sync_enabled) {
      try {
        out.gmail = await syncGmail(conn, api, trigger)
      } catch (e) {
        out.errors.push(`Gmail: ${(e as Error).message}`)
      }
    }
    if (conn.calendar_sync_enabled && config.calendarSyncEnabled) {
      try {
        out.calendar = await syncCalendar(conn, api, trigger)
      } catch (e) {
        out.errors.push(`Calendar: ${(e as Error).message}`)
      }
    }
    return out
  } finally {
    inFlight.delete(userId)
  }
}

export async function syncAll(trigger: Trigger = 'scheduled'): Promise<Array<{ user_id: string; errors: string[] }>> {
  const users = await query<{ user_id: string }>(
    `SELECT c.user_id FROM google_connections c JOIN users u ON u.id = c.user_id WHERE u.is_active ORDER BY COALESCE(c.gmail_last_synced_at, c.calendar_last_synced_at, c.created_at)`,
  )
  const results: Array<{ user_id: string; errors: string[] }> = []
  for (const { user_id } of users) {
    const r = await syncUser(user_id, trigger)
    results.push({ user_id, errors: r.errors })
  }
  return results
}
