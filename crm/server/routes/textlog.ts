import { Router } from 'express'
import { z } from 'zod'
import { query } from '../db.js'
import { forbidden, parse, wrap } from '../http.js'
import { dismissInboxItem, loadInbox, logAddress, logInboxItem, rankDeals } from '../textlog/index.js'
import type { LogInboxItem } from '../../shared/types.js'

/** Text messages emailed to the log address that are not attached to a deal yet. */
export const textlogRouter = Router()

textlogRouter.get(
  '/status',
  wrap(async (_req, res) => {
    res.json({ address: logAddress() })
  }),
)

textlogRouter.get(
  '/inbox',
  wrap(async (req, res) => {
    const items = await query<LogInboxItem>(
      `SELECT i.id, i.subject, i.text, i.files, i.status, i.received_at, i.activity_id, a.deal_id, d.title AS deal_title
       FROM log_inbox i LEFT JOIN activities a ON a.id = i.activity_id LEFT JOIN deals d ON d.id = a.deal_id
       WHERE i.user_id = $1 AND i.status = 'pending' ORDER BY i.received_at DESC LIMIT 100`,
      [req.user.id],
    )
    res.json({ items })
  }),
)

textlogRouter.get(
  '/inbox/:id/candidates',
  wrap(async (req, res) => {
    const row = await loadInbox(String(req.params.id))
    if (!row || row.user_id !== req.user.id) throw forbidden('Not your message')
    res.json({ items: await rankDeals(req.user.id, `${row.subject ?? ''}\n${row.text}`) })
  }),
)

textlogRouter.post(
  '/inbox/:id/log',
  wrap(async (req, res) => {
    const body = parse(z.object({ deal_id: z.string().uuid() }), req.body ?? {})
    const row = await loadInbox(String(req.params.id))
    if (!row || row.user_id !== req.user.id) throw forbidden('Not your message')
    res.json({ activity_id: await logInboxItem(row, body.deal_id, req.user.id) })
  }),
)

textlogRouter.post(
  '/inbox/:id/dismiss',
  wrap(async (req, res) => {
    const row = await loadInbox(String(req.params.id))
    if (!row || row.user_id !== req.user.id) throw forbidden('Not your message')
    await dismissInboxItem(row, req.user.id)
    res.json({ ok: true })
  }),
)
