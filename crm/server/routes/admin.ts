/** Admin-only destructive operations. */
import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { audit } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { badRequest, parse, wrap } from '../http.js'

export const adminRouter = Router()
adminRouter.use(requireAdmin)

adminRouter.get(
  '/reset/preview',
  wrap(async (_req, res) => {
    const c = (await one<Record<string, number>>(
      `SELECT (SELECT COUNT(*)::int FROM deals) AS deals, (SELECT COUNT(*)::int FROM companies) AS companies,
              (SELECT COUNT(*)::int FROM contacts) AS contacts, (SELECT COUNT(*)::int FROM activities) AS activities,
              (SELECT COUNT(*)::int FROM sync_unmatched) AS unmatched, (SELECT COUNT(*)::int FROM audit_log) AS audit_entries`,
    ))!
    res.json(c)
  }),
)

/**
 * Start fresh: removes every deal, company, contact and activity (synced ones included) and the
 * unmatched-sender list, then rewinds the Google sync so the next run re-reads the 30-day window
 * against the clean slate. Keeps users, pipelines, stages, products, lost reasons, ignored domains,
 * Google/Slack connections and the audit log.
 */
adminRouter.post(
  '/reset',
  wrap(async (req, res) => {
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body)
    if (confirm !== 'RESET') throw badRequest('Type RESET to confirm')
    const before = (await one<Record<string, number>>(
      `SELECT (SELECT COUNT(*)::int FROM deals) AS deals, (SELECT COUNT(*)::int FROM companies) AS companies, (SELECT COUNT(*)::int FROM contacts) AS contacts, (SELECT COUNT(*)::int FROM activities) AS activities`,
    ))!
    await withTransaction(async (client) => {
      await query('DELETE FROM activities', [], client)
      await query('DELETE FROM deals', [], client) // cascades deal_products, deal_stage_history
      await query('DELETE FROM contacts', [], client)
      await query('DELETE FROM companies', [], client)
      await query('DELETE FROM sync_unmatched', [], client)
      await query('UPDATE google_connections SET gmail_synced_through = NULL, calendar_sync_token = NULL', [], client)
      await audit(client, { entityType: 'system', entityId: req.user.id, action: 'delete', actorId: req.user.id, changes: before, summary: `Data reset by ${req.user.name}: ${before.deals} deals, ${before.companies} companies, ${before.contacts} contacts, ${before.activities} activities removed` })
    })
    res.json({ ok: true, removed: before })
  }),
)
