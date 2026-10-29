/**
 * End-to-end sync against a real Postgres with a fake Google API.
 * Runs only when DATABASE_URL is set (loaded from .env locally); skipped otherwise.
 */
import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HAS_DB = !!process.env.DATABASE_URL

describe.skipIf(!HAS_DB)('google sync (db)', async () => {
  const { pool, one, query } = await import('../db.js')
  const { runMigrations } = await import('../migrate.js')
  const { syncUser } = await import('./sync.js')
  const { encrypt } = await import('./crypto.js')
  const { config } = await import('../config.js')
  type Fetcher = import('./client.js').GoogleFetcher

  const uniq = Date.now().toString(36)
  let userId = ''
  let contactId = ''
  let dealId = ''
  const calls: string[] = []

  const gmailMsg = (id: string, from: string, to: string, subject: string, msgId: string, ts: number) => ({
    id, threadId: `t-${id}`, labelIds: ['INBOX'], snippet: `snippet ${id}`, internalDate: String(ts),
    payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: `<${msgId}>` }] },
  })
  const now = Date.now()
  const state = {
    messages: [
      gmailMsg('m1', `Ann <ann-${uniq}@customer.test>`, 'rep@ecolens.io', 'Re: Proposal', `m1-${uniq}@x`, now - 3600e3),
      gmailMsg('m2', `stranger-${uniq}@elsewhere.test`, 'rep@ecolens.io', 'Cold inbound', `m2-${uniq}@x`, now - 7200e3),
      gmailMsg('m3', 'colleague@ecolens.io', 'rep@ecolens.io', 'Internal only', `m3-${uniq}@x`, now - 60e3),
      gmailMsg('m4', `New Person <new.person@customer-${uniq}.test>`, 'rep@ecolens.io', 'Domain match', `m4-${uniq}@x`, now - 1800e3),
      gmailMsg('m5', 'promo@linkedin.com', 'rep@ecolens.io', 'Ignored vendor', `m5-${uniq}@x`, now - 900e3),
    ],
    events: [
      { id: 'ev1', iCalUID: `ev1-${uniq}@google.com`, status: 'confirmed', summary: 'Kickoff', start: { dateTime: new Date(now + 86400e3).toISOString() }, end: { dateTime: new Date(now + 90000e3).toISOString() }, attendees: [{ email: 'rep@ecolens.io', self: true }, { email: `ann-${uniq}@customer.test` }], htmlLink: 'https://cal/ev1' },
      { id: 'ev2', iCalUID: `ev2-${uniq}@google.com`, status: 'confirmed', summary: 'Past review', start: { dateTime: new Date(now - 86400e3).toISOString() }, end: { dateTime: new Date(now - 82800e3).toISOString() }, attendees: [{ email: `ann-${uniq}@customer.test` }] },
    ] as Array<Record<string, unknown>>,
    syncToken: 'tok-1',
  }
  const fake: Fetcher = {
    async get<T>(url: string, params: Record<string, unknown> = {}): Promise<T> {
      calls.push(url + (params.syncToken ? ' (incremental)' : ''))
      if (url.endsWith('/users/me/messages')) {
        const q = String(params.q ?? '')
        if (q.startsWith('rfc822msgid:')) {
          const want = q.slice('rfc822msgid:'.length)
          const hit = state.messages.find((m) => m.payload.headers.some((h) => h.name === 'Message-ID' && h.value === `<${want}>`))
          return { messages: hit ? [{ id: hit.id }] : [] } as T
        }
        return { messages: state.messages.map((m) => ({ id: m.id })) } as T
      }
      const m = state.messages.find((x) => url.endsWith(`/messages/${x.id}`))
      if (m) return m as T
      if (url.includes('/calendars/primary/events')) {
        if (params.iCalUID) return { items: state.events.filter((e) => e.iCalUID === params.iCalUID) } as T
        return { items: state.events, nextSyncToken: state.syncToken } as T
      }
      throw new Error(`unexpected url ${url}`)
    },
  }

  beforeAll(async () => {
    await runMigrations()
    config.allowedDomain = 'ecolens.io'
    config.calendarSyncEnabled = true // the calendar paths stay covered even though the default is off
    userId = (await one<{ id: string }>(`INSERT INTO users (email, name) VALUES ($1, 'Rep') RETURNING id`, [`rep-${uniq}@ecolens.io`]))!.id
    const companyId = (await one<{ id: string }>(`INSERT INTO companies (name, domain) VALUES ($1, $2) RETURNING id`, [`Customer ${uniq}`, `customer-${uniq}.test`]))!.id
    contactId = (await one<{ id: string }>(`INSERT INTO contacts (first_name, email, company_id) VALUES ('Ann', $1, $2) RETURNING id`, [`ann-${uniq}@customer.test`, companyId]))!.id
    const stage = (await one<{ id: string; pipeline_id: string }>(`SELECT id, pipeline_id FROM stages WHERE kind = 'open' ORDER BY position LIMIT 1`))!
    dealId = (await one<{ id: string }>(`INSERT INTO deals (title, pipeline_id, stage_id, company_id, contact_id, owner_id, stage_entered_at) VALUES ('Deal', $1, $2, $3, $4, $5, now() - interval '20 days') RETURNING id`, [stage.pipeline_id, stage.id, companyId, contactId, userId]))!.id
    await query(`INSERT INTO google_connections (user_id, google_email, refresh_token_enc, scopes) VALUES ($1, $2, $3, '{}')`, [userId, `rep-${uniq}@ecolens.io`, encrypt('rt', 'k'.repeat(40))])
  })

  afterAll(async () => {
    await query('DELETE FROM deals WHERE id = $1', [dealId]) // cascades its activities and stage history
    await query('DELETE FROM users WHERE id = $1', [userId]) // cascades connection, runs, unmatched
    await query(`DELETE FROM activities WHERE external_id LIKE $1 OR external_id LIKE $2`, [`%${uniq}%`, `%${uniq}%`])
    await query(`DELETE FROM contacts WHERE email LIKE $1`, [`%${uniq}%`])
    await query(`DELETE FROM activities WHERE subject = 'Domain match' AND created_at > now() - interval '10 minutes'`)
    await query(`DELETE FROM companies WHERE name LIKE $1`, [`%${uniq}%`])
    await pool.end()
  })

  it('logs matched emails on the deal, records unmatched senders, skips internal mail', async () => {
    const r = await syncUser(userId, 'manual', fake)
    expect(r.errors).toEqual([])
    expect(r.gmail).toMatchObject({ logged: 2 })
    const act = await one<{ deal_id: string; contact_id: string; completed_at: string | null; meta: { direction: string } }>(`SELECT * FROM activities WHERE source = 'gmail' AND external_id = $1`, [`m1-${uniq}@x`])
    expect(act?.deal_id).toBe(dealId)
    expect(act?.contact_id).toBe(contactId)
    expect(act?.completed_at).not.toBeNull()
    expect(act?.meta.direction).toBe('received')
    const unmatched = await query<{ subject: string }>(`SELECT subject FROM sync_unmatched WHERE user_id = $1`, [userId])
    expect(unmatched.map((u) => u.subject)).toEqual(['Cold inbound'])
    expect(await one(`SELECT 1 FROM activities WHERE external_id = $1`, [`m3-${uniq}@x`])).toBeNull()
    // Domain match: a sender at the company's domain becomes a contact and the email lands on the deal.
    const auto = await one<{ id: string; first_name: string; company_id: string }>(`SELECT id, first_name, company_id FROM contacts WHERE lower(email) = $1`, [`new.person@customer-${uniq}.test`])
    expect(auto?.first_name).toBe('New')
    const m4 = await one<{ deal_id: string; contact_id: string }>(`SELECT deal_id, contact_id FROM activities WHERE external_id = $1`, [`m4-${uniq}@x`])
    expect(m4?.deal_id).toBe(dealId)
    expect(m4?.contact_id).toBe(auto?.id)
    // Ignored vendor domain: neither logged nor listed as unmatched.
    expect(await one(`SELECT 1 FROM activities WHERE external_id = $1`, [`m5-${uniq}@x`])).toBeNull()
    expect(await one(`SELECT 1 FROM sync_unmatched WHERE external_id = $1`, [`m5-${uniq}@x`])).toBeNull()
    // Rotting timer reset by the customer email.
    const deal = await one<{ last_activity_at: string }>('SELECT last_activity_at FROM deals WHERE id = $1', [dealId])
    expect(new Date(deal!.last_activity_at).getTime()).toBeGreaterThan(now - 3700e3)
  })

  it('logs meetings: future = open, past = completed', async () => {
    const future = await one<{ completed_at: string | null; deal_id: string; type: string }>(`SELECT * FROM activities WHERE source = 'gcal' AND external_id = $1`, [`ev1-${uniq}@google.com`])
    expect(future?.type).toBe('meeting')
    expect(future?.completed_at).toBeNull()
    expect(future?.deal_id).toBe(dealId)
    const past = await one<{ completed_at: string | null }>(`SELECT * FROM activities WHERE source = 'gcal' AND external_id = $1`, [`ev2-${uniq}@google.com`])
    expect(past?.completed_at).not.toBeNull()
    const runs = await query<{ kind: string; status: string; items_logged: number }>('SELECT kind, status, items_logged FROM sync_runs WHERE user_id = $1 ORDER BY id', [userId])
    expect(runs).toEqual([{ kind: 'gmail', status: 'ok', items_logged: 2 }, { kind: 'calendar', status: 'ok', items_logged: 2 }])
  })

  it('is idempotent and uses the calendar sync token; cancellations remove the meeting', async () => {
    state.events = [{ id: 'ev1', iCalUID: `ev1-${uniq}@google.com`, status: 'cancelled' }]
    state.syncToken = 'tok-2'
    calls.length = 0
    const r = await syncUser(userId, 'scheduled', fake)
    expect(r.errors).toEqual([])
    expect(r.gmail?.logged).toBe(0)
    expect(calls.some((c) => c.includes('(incremental)'))).toBe(true)
    expect(await one(`SELECT 1 FROM activities WHERE external_id = $1`, [`ev1-${uniq}@google.com`])).toBeNull()
    expect((await query(`SELECT 1 FROM activities WHERE source = 'gmail' AND external_id = $1`, [`m1-${uniq}@x`])).length).toBe(1)
    const conn = await one<{ calendar_sync_token: string }>('SELECT calendar_sync_token FROM google_connections WHERE user_id = $1', [userId])
    expect(conn?.calendar_sync_token).toBe('tok-2')
  })

  it('re-evaluates earlier unmatched items once a contact exists, and linking a company carries them onto its deal', async () => {
    const { propagateLink } = await import('../routes/linker.js')
    // The cold inbound sender becomes a contact (no company yet).
    const stranger = (await one<{ id: string }>(`INSERT INTO contacts (first_name, email) VALUES ('Stranger', $1) RETURNING id`, [`stranger-${uniq}@elsewhere.test`]))!
    const r = await syncUser(userId, 'manual', fake)
    expect(r.errors).toEqual([])
    const act = await one<{ id: string; contact_id: string; deal_id: string | null; company_id: string | null }>(`SELECT id, contact_id, deal_id, company_id FROM activities WHERE source = 'gmail' AND external_id = $1`, [`m2-${uniq}@x`])
    expect(act?.contact_id).toBe(stranger.id)
    expect(act?.deal_id).toBeNull()
    expect(await one(`SELECT 1 FROM sync_unmatched WHERE external_id = $1 AND dismissed_at IS NULL`, [`m2-${uniq}@x`])).toBeNull()
    // Now link the contact to the company: the email moves onto the company's deal.
    const companyId = (await one<{ id: string }>('SELECT company_id AS id FROM deals WHERE id = $1', [dealId]))!.id
    await query('UPDATE contacts SET company_id = $2 WHERE id = $1', [stranger.id, companyId])
    await propagateLink(pool, stranger.id, companyId, `stranger-${uniq}@elsewhere.test`, userId)
    const after = await one<{ deal_id: string | null; company_id: string | null }>('SELECT deal_id, company_id FROM activities WHERE id = $1', [act!.id])
    expect(after?.company_id).toBe(companyId)
    expect(after?.deal_id).toBe(dealId)
  })
})
