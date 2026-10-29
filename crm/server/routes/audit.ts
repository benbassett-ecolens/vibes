import { Router } from 'express'
import { query } from '../db.js'
import { parsePaging, wrap } from '../http.js'
import type { AuditEntry } from '../../shared/types.js'

export const auditRouter = Router()

/** Generic audit feed: per entity, per actor, or everything (dashboard "recent activity"). */
auditRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>
    const { limit, offset } = parsePaging(q, 50, 200)
    const where: string[] = []
    const params: unknown[] = []
    const add = (s: string, v: unknown) => {
      params.push(v)
      where.push(s.replace('?', `$${params.length}`))
    }
    if (typeof q.entity_type === 'string' && q.entity_type) add('l.entity_type = ?', q.entity_type)
    if (typeof q.entity_id === 'string' && q.entity_id) add('l.entity_id = ?', q.entity_id)
    if (typeof q.actor_id === 'string' && q.actor_id) add('l.actor_id = ?', q.actor_id)
    if (q.exclude_logins !== 'false') where.push("l.action <> 'login'")
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const items = await query<AuditEntry & { entity_label: string | null }>(
      `SELECT l.*, u.name AS actor_name,
         CASE l.entity_type
           WHEN 'deal' THEN (SELECT title FROM deals WHERE id = l.entity_id)
           WHEN 'company' THEN (SELECT name FROM companies WHERE id = l.entity_id)
           WHEN 'contact' THEN (SELECT TRIM(CONCAT(first_name, ' ', last_name)) FROM contacts WHERE id = l.entity_id)
           WHEN 'activity' THEN (SELECT subject FROM activities WHERE id = l.entity_id)
           WHEN 'user' THEN (SELECT email FROM users WHERE id = l.entity_id)
           WHEN 'pipeline' THEN (SELECT name FROM pipelines WHERE id = l.entity_id)
           WHEN 'stage' THEN (SELECT name FROM stages WHERE id = l.entity_id)
           ELSE NULL END AS entity_label
       FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
       ${whereSql} ORDER BY l.created_at DESC, l.id DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    )
    res.json({ items, limit, offset })
  }),
)
