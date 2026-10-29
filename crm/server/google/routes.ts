import { Router } from 'express'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { config } from '../config.js'
import { one, query } from '../db.js'
import { audit } from '../audit.js'
import { badRequest, forbidden, notFound, parse, wrap, HttpError } from '../http.js'
import { requireAuth, SESSION_COOKIE, verifySession } from '../auth.js'
import { CALENDAR_SCOPE, GMAIL_SCOPE, SCOPES, loadConnection, oauthClient, revokeAndDelete, saveConnection, syncConfigured, pool } from './client.js'
import { syncAll, syncUser } from './sync.js'
import { autoCompanyForEmail, propagateLink } from '../routes/linker.js'
import { runMaintenance } from '../maintenance.js'
import type { GoogleConnection, GoogleStatus, SyncRun, UnmatchedItem } from '../../shared/types.js'

export const googleRouter = Router()

const STATE_COOKIE = 'crm_gstate'

function signState(payload: string): string {
  return `${payload}.${createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')}`
}
function verifyState(state: string): string | null {
  const i = state.lastIndexOf('.')
  if (i < 0) return null
  const payload = state.slice(0, i)
  const mac = state.slice(i + 1)
  const expected = createHmac('sha256', config.sessionSecret).update(payload).digest('base64url')
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  return payload
}

/** Step 1: send the signed-in user to Google's consent screen. */
googleRouter.get('/connect', requireAuth, (req, res) => {
  const client = oauthClient()
  const nonce = randomBytes(16).toString('base64url')
  const state = signState(`${req.user.id}:${nonce}`)
  res.cookie(STATE_COOKIE, nonce, { httpOnly: true, sameSite: 'lax', secure: config.isProduction, maxAge: 10 * 60 * 1000, path: '/api/google' })
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always returns a refresh token
    include_granted_scopes: true,
    scope: SCOPES,
    state,
    login_hint: req.user.email,
    hd: config.allowedDomain,
  })
  res.redirect(url)
})

/** Step 2: Google redirects back here with a code. */
googleRouter.get(
  '/callback',
  wrap(async (req, res) => {
    const done = (msg: string) => res.redirect(`/settings?google=${encodeURIComponent(msg)}`)
    const { code, state, error } = req.query as Record<string, string | undefined>
    if (error) return done(`error:${error}`)
    if (!code || !state) return done('error:missing_code')
    const payload = verifyState(state)
    const [userId, nonce] = (payload ?? '').split(':')
    if (!payload || !userId || nonce !== req.cookies?.[STATE_COOKIE]) return done('error:bad_state')
    res.clearCookie(STATE_COOKIE, { path: '/api/google' })
    // The state must belong to the user who is signed in right now.
    const session = verifySession(req.cookies?.[SESSION_COOKIE])
    if (!session || session.uid !== userId) return done('error:session_mismatch')

    const client = oauthClient()
    const { tokens } = await client.getToken(code)
    if (!tokens.refresh_token) return done('error:no_refresh_token')
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean)
    const ticket = tokens.id_token ? await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId }) : null
    const googleEmail = ticket?.getPayload()?.email?.toLowerCase()
    const user = await one<{ email: string; name: string }>('SELECT email, name FROM users WHERE id = $1', [userId])
    if (!user || !googleEmail || googleEmail !== user.email) {
      try {
        await client.revokeToken(tokens.refresh_token)
      } catch {
        /* ignore */
      }
      return done('error:wrong_account')
    }
    if (!scopes.includes(GMAIL_SCOPE) && !scopes.includes(CALENDAR_SCOPE)) {
      try {
        await client.revokeToken(tokens.refresh_token)
      } catch {
        /* ignore */
      }
      return done('error:no_scopes')
    }
    await saveConnection(userId, googleEmail, tokens.refresh_token, scopes)
    await query('UPDATE google_connections SET gmail_sync_enabled = $2, calendar_sync_enabled = $3 WHERE user_id = $1', [userId, scopes.includes(GMAIL_SCOPE), scopes.includes(CALENDAR_SCOPE)])
    await audit(pool, { entityType: 'user', entityId: userId, action: 'update', actorId: userId, changes: { google_connection: { from: null, to: googleEmail } }, summary: `${user.name} connected Google (${scopes.filter((s) => s.includes('gmail') || s.includes('calendar')).map((s) => s.split('/').pop()).join(', ')})` })
    // The client triggers the first sync as a normal request right after this redirect:
    // Cloud Run only guarantees CPU while a request is in flight, so no background work here.
    return done('connected')
  }),
)

// Everything below needs a session.
googleRouter.use(requireAuth)

async function status(userId: string): Promise<GoogleStatus> {
  const conn = await one<GoogleConnection & { refresh_token_enc?: string; calendar_sync_token?: string }>('SELECT * FROM google_connections WHERE user_id = $1', [userId])
  if (conn) {
    delete conn.refresh_token_enc
    delete conn.calendar_sync_token
  }
  const runs = await query<SyncRun>('SELECT * FROM sync_runs WHERE user_id = $1 ORDER BY started_at DESC LIMIT 12', [userId])
  const unmatched = (await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM sync_unmatched WHERE user_id = $1 AND dismissed_at IS NULL', [userId]))!.n
  const totals = (await one<{ emails: number; meetings: number }>(`SELECT COUNT(*) FILTER (WHERE source = 'gmail')::int AS emails, COUNT(*) FILTER (WHERE source = 'gcal')::int AS meetings FROM activities`))!
  return { configured: syncConfigured(), connection: conn, runs, unmatched_count: unmatched, totals, calendar_feature: config.calendarSyncEnabled }
}

googleRouter.get(
  '/status',
  wrap(async (req, res) => {
    res.json(await status(req.user.id))
  }),
)

googleRouter.patch(
  '/connection',
  wrap(async (req, res) => {
    const body = parse(z.object({ gmail_sync_enabled: z.boolean().optional(), calendar_sync_enabled: z.boolean().optional(), gmail_sync_window_days: z.number().int().min(1).max(365).optional() }), req.body)
    const conn = await loadConnection(req.user.id)
    if (!conn) throw notFound('Google connection')
    await query(
      `UPDATE google_connections SET gmail_sync_enabled = COALESCE($2, gmail_sync_enabled), calendar_sync_enabled = COALESCE($3, calendar_sync_enabled),
         gmail_sync_window_days = COALESCE($4, gmail_sync_window_days) WHERE user_id = $1`,
      [req.user.id, body.gmail_sync_enabled ?? null, body.calendar_sync_enabled ?? null, body.gmail_sync_window_days ?? null],
    )
    res.json(await status(req.user.id))
  }),
)

googleRouter.post(
  '/sync',
  wrap(async (req, res) => {
    const conn = await loadConnection(req.user.id)
    if (!conn) throw badRequest('Connect your Google account first')
    const trigger = req.query.first === 'true' ? 'connect' : 'manual'
    const result = await syncUser(req.user.id, trigger)
    res.json({ ...result, status: await status(req.user.id) })
  }),
)

googleRouter.delete(
  '/connection',
  wrap(async (req, res) => {
    await revokeAndDelete(req.user.id)
    await audit(pool, { entityType: 'user', entityId: req.user.id, action: 'update', actorId: req.user.id, changes: { google_connection: { from: 'connected', to: null } }, summary: `${req.user.name} disconnected Google` })
    res.json(await status(req.user.id))
  }),
)

/** Admin diagnostics: what the sync can see, to explain "logged 0" without database access. */
googleRouter.get(
  '/diagnostics',
  wrap(async (req, res) => {
    const conn = await loadConnection(req.user.id)
    const counts = (await one<Record<string, number>>(
      `SELECT
         (SELECT COUNT(*)::int FROM contacts WHERE archived_at IS NULL) AS contacts,
         (SELECT COUNT(*)::int FROM contacts WHERE archived_at IS NULL AND email IS NOT NULL) AS contacts_with_email,
         (SELECT COUNT(*)::int FROM contacts WHERE archived_at IS NULL AND company_id IS NOT NULL) AS contacts_with_company,
         (SELECT COUNT(*)::int FROM companies WHERE archived_at IS NULL AND domain IS NOT NULL) AS companies_with_domain,
         (SELECT COUNT(*)::int FROM activities WHERE source = 'gmail') AS gmail_activities,
         (SELECT COUNT(*)::int FROM activities WHERE source = 'gcal') AS calendar_activities,
         (SELECT COUNT(*)::int FROM activities WHERE source <> 'manual' AND deal_id IS NULL) AS synced_without_deal,
         (SELECT COUNT(*)::int FROM sync_unmatched WHERE user_id = $1 AND dismissed_at IS NULL) AS unmatched_pending,
         (SELECT COUNT(*)::int FROM sync_unmatched WHERE user_id = $1 AND dismissed_at IS NOT NULL) AS unmatched_dismissed,
         (SELECT COUNT(*)::int FROM sync_ignored_domains) AS ignored_domains`,
      [req.user.id],
    ))!
    // Pending unmatched items whose addresses now match a contact: these should log on the next sync.
    const matchable = await query<{ external_id: string; subject: string; email: string }>(
      `SELECT u.external_id, u.subject, c.email FROM sync_unmatched u
       JOIN LATERAL jsonb_array_elements(u.addresses) a ON true
       JOIN contacts c ON lower(c.email) = lower(a->>'email') AND c.archived_at IS NULL
       WHERE u.user_id = $1 AND u.dismissed_at IS NULL LIMIT 10`,
      [req.user.id],
    )
    // Recently created contacts and whether any synced activity references them.
    const recent = await query<{ email: string; company: string | null; activities: number; created_at: string }>(
      `SELECT c.email, co.name AS company, (SELECT COUNT(*)::int FROM activities a WHERE a.contact_id = c.id AND a.source <> 'manual') AS activities, c.created_at
       FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE c.email IS NOT NULL AND c.archived_at IS NULL ORDER BY c.created_at DESC LIMIT 15`,
    )
    res.json({ connection: conn ? { gmail_synced_through: conn.gmail_synced_through, gmail_last_synced_at: conn.gmail_last_synced_at, calendar_last_synced_at: conn.calendar_last_synced_at, last_error: conn.last_error } : null, counts, matchable_pending: matchable, recent_contacts: recent })
  }),
)

googleRouter.get(
  '/unmatched',
  wrap(async (req, res) => {
    const items = await query<UnmatchedItem>('SELECT * FROM sync_unmatched WHERE user_id = $1 AND dismissed_at IS NULL ORDER BY occurred_at DESC LIMIT 100', [req.user.id])
    res.json({ items })
  }),
)

/** Ignore a sender domain team-wide and dismiss every pending item that only involves ignored domains. */
googleRouter.post(
  '/ignore-domain',
  wrap(async (req, res) => {
    const { domain } = parse(z.object({ domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/) }), req.body)
    if (domain === config.allowedDomain) throw badRequest('That is your own domain')
    await query('INSERT INTO sync_ignored_domains (domain, created_by) VALUES ($1, $2) ON CONFLICT DO NOTHING', [domain, req.user.id])
    const dismissed = await query<{ id: number }>(
      `UPDATE sync_unmatched u SET dismissed_at = now() WHERE dismissed_at IS NULL AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(u.addresses) a
         WHERE split_part(a->>'email', '@', 2) NOT IN (SELECT domain FROM sync_ignored_domains)
       ) RETURNING id`,
    )
    await audit(pool, { entityType: 'user', entityId: req.user.id, action: 'update', actorId: req.user.id, changes: { ignored_domain: domain, dismissed: dismissed.length }, summary: `Ignored sender domain ${domain}` })
    res.json({ ok: true, dismissed: dismissed.length })
  }),
)

googleRouter.get(
  '/ignored-domains',
  wrap(async (_req, res) => {
    res.json({ items: await query<{ domain: string; created_at: string }>('SELECT domain, created_at FROM sync_ignored_domains ORDER BY domain') })
  }),
)

googleRouter.delete(
  '/ignored-domains/:domain',
  wrap(async (req, res) => {
    await query('DELETE FROM sync_ignored_domains WHERE domain = $1', [String(req.params.domain).toLowerCase()])
    res.json({ ok: true })
  }),
)

googleRouter.post(
  '/unmatched/:id/dismiss',
  wrap(async (req, res) => {
    await query('UPDATE sync_unmatched SET dismissed_at = now() WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
    res.json({ ok: true })
  }),
)

/** Create a contact from an unmatched sender and re-log that item against it. */
googleRouter.post(
  '/unmatched/:id/create-contact',
  wrap(async (req, res) => {
    const body = parse(z.object({ email: z.string().email(), first_name: z.string().trim().min(1), last_name: z.string().trim().optional().default(''), company_id: z.string().uuid().nullable().optional() }), req.body)
    const item = await one<UnmatchedItem>('SELECT * FROM sync_unmatched WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id])
    if (!item) throw notFound('Item')
    let contact = await one<{ id: string }>('SELECT id FROM contacts WHERE lower(email) = $1 AND archived_at IS NULL', [body.email.toLowerCase()])
    if (!contact) {
      contact = (await one<{ id: string }>(
        `INSERT INTO contacts (first_name, last_name, email, company_id, owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id`,
        [body.first_name, body.last_name, body.email.toLowerCase(), body.company_id ?? null, req.user.id],
      ))!
      await audit(pool, { entityType: 'contact', entityId: contact.id, action: 'create', actorId: req.user.id, changes: { email: body.email, from: 'synced email' }, summary: `Created contact ${body.first_name} ${body.last_name} from a synced ${item.source === 'gmail' ? 'email' : 'meeting'}`.trim() })
    }
    // Teach the company its email domain so future senders there attach automatically, and fill empty main-contact slots.
    const companyId = body.company_id ?? (await autoCompanyForEmail(body.email))
    if (companyId) {
      await query('UPDATE contacts SET company_id = COALESCE(company_id, $2) WHERE id = $1', [contact.id, companyId])
      await propagateLink(pool, contact.id, companyId, body.email, req.user.id)
    }
    // The client follows up with POST /api/google/sync so the re-check runs inside a request (Cloud Run gives no CPU after the response).
    res.status(201).json({ contact_id: contact.id })
  }),
)

/** Cloud Scheduler entry point: syncs every connected user. Protected by SYNC_SECRET, not a session. */
export const internalRouter = Router()
internalRouter.post(
  '/sync',
  wrap(async (req, res) => {
    const auth = req.headers.authorization ?? ''
    if (!config.syncSecret) throw new HttpError(503, 'SYNC_SECRET is not configured')
    const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''))
    const expected = Buffer.from(config.syncSecret)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw forbidden()
    const results = await syncAll('scheduled')
    const maintenance = await runMaintenance()
    res.json({ synced: results.length, results, maintenance })
  }),
)
