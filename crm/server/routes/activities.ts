import { Router } from 'express'
import { z } from 'zod'
import { audit, diff } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { badRequest, notFound, parse, parsePaging, parseSort, wrap } from '../http.js'
import type { Activity } from '../../shared/types.js'
import { deleteTaskCard, postTaskCard, slackSafe, updateTaskCard } from '../slack/client.js'

export const activitiesRouter = Router()

const activitySchema = z.object({
  type: z.enum(['note', 'call', 'email', 'meeting', 'task']),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(20000).nullable().optional(),
  deal_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
  completed: z.boolean().optional(),
})

const SORTS: Record<string, string> = {
  due_at: 'a.due_at',
  created_at: 'a.created_at',
  type: 'a.type',
  subject: 'lower(a.subject)',
  owner: 'lower(o.name)',
  deal: 'lower(d.title)',
  completed_at: 'a.completed_at',
}

const SELECT = `
  SELECT a.*, o.name AS owner_name, cb.name AS created_by_name, d.title AS deal_title, co.name AS company_name,
    NULLIF(TRIM(CONCAT(ct.first_name, ' ', ct.last_name)), '') AS contact_name
  FROM activities a
  LEFT JOIN users o ON o.id = a.owner_id
  LEFT JOIN users cb ON cb.id = a.created_by
  LEFT JOIN deals d ON d.id = a.deal_id
  LEFT JOIN companies co ON co.id = a.company_id
  LEFT JOIN contacts ct ON ct.id = a.contact_id`

async function load(id: string): Promise<Activity | null> {
  return one<Activity>(`${SELECT} WHERE a.id = $1`, [id])
}

/** Anything logged against a deal counts as activity for rotting purposes. */
async function touchDeal(dealId: string | null | undefined, client: { query: (t: string, p?: unknown[]) => Promise<unknown> }): Promise<void> {
  if (!dealId) return
  await client.query('UPDATE deals SET last_activity_at = now() WHERE id = $1', [dealId])
}

activitiesRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>
    const { sql } = parseSort(q, SORTS, 'created_at', 'desc')
    const { limit, offset } = parsePaging(q)
    const where: string[] = []
    const params: unknown[] = []
    const add = (s: string, v: unknown) => {
      params.push(v)
      where.push(s.replace('?', `$${params.length}`))
    }
    if (typeof q.deal_id === 'string' && q.deal_id) add('a.deal_id = ?', q.deal_id)
    if (typeof q.contact_id === 'string' && q.contact_id) add('a.contact_id = ?', q.contact_id)
    if (typeof q.company_id === 'string' && q.company_id) add('a.company_id = ?', q.company_id)
    if (typeof q.owner_id === 'string' && q.owner_id) add('a.owner_id = ?', q.owner_id)
    if (typeof q.type === 'string' && q.type) add('a.type = ?', q.type)
    if (typeof q.source === 'string' && q.source) add('a.source = ?', q.source)
    if (q.status === 'open') where.push('a.completed_at IS NULL AND a.due_at IS NOT NULL')
    if (q.status === 'overdue') where.push('a.completed_at IS NULL AND a.due_at < now()')
    if (q.status === 'completed') where.push('a.completed_at IS NOT NULL')
    if (q.status === 'today') where.push("a.completed_at IS NULL AND a.due_at >= date_trunc('day', now()) AND a.due_at < date_trunc('day', now()) + interval '1 day'")
    if (typeof q.q === 'string' && q.q.trim()) {
      params.push(`%${q.q.trim()}%`)
      where.push(`(a.subject ILIKE $${params.length} OR a.body ILIKE $${params.length} OR d.title ILIKE $${params.length})`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM activities a LEFT JOIN deals d ON d.id = a.deal_id ${whereSql}`, params))!.n
    const items = await query<Activity>(`${SELECT} ${whereSql} ORDER BY ${sql}, a.id LIMIT ${limit} OFFSET ${offset}`, params)
    res.json({ items, total, limit, offset })
  }),
)

activitiesRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = parse(activitySchema, req.body)
    if (body.type !== 'task' && !body.deal_id && !body.contact_id && !body.company_id) throw badRequest('Attach the activity to a deal, contact or company')
    const created = await withTransaction(async (client) => {
      // Inherit company/contact from the deal when not given, so timelines line up.
      let { company_id, contact_id } = body
      if (body.deal_id && (!company_id || !contact_id)) {
        const d = await one<{ company_id: string | null; contact_id: string | null }>('SELECT company_id, contact_id FROM deals WHERE id = $1', [body.deal_id], client)
        company_id = company_id ?? d?.company_id ?? null
        contact_id = contact_id ?? d?.contact_id ?? null
      }
      // Notes/calls/emails are "logged" (already happened) unless given a future due date.
      const completed = body.completed ?? (body.type !== 'task' && body.type !== 'meeting' && !body.due_at)
      const a = (await one<Activity>(
        `INSERT INTO activities (type, subject, body, deal_id, contact_id, company_id, owner_id, due_at, completed_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [body.type, body.subject, body.body ?? null, body.deal_id ?? null, contact_id ?? null, company_id ?? null, body.owner_id ?? req.user.id, body.due_at ?? null, completed ? new Date().toISOString() : null, req.user.id],
        client,
      ))!
      await touchDeal(a.deal_id, client)
      await audit(client, { entityType: 'activity', entityId: a.id, action: 'create', actorId: req.user.id, changes: { type: a.type, subject: a.subject, deal_id: a.deal_id }, summary: `Logged ${a.type}: ${a.subject}` })
      return a
    })
    if (created.type === 'task' && !created.completed_at) slackSafe(postTaskCard(created.id))
    res.status(201).json(await load(created.id))
  }),
)

activitiesRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const body = parse(activitySchema.partial(), req.body)
    const before = await one<Activity>('SELECT * FROM activities WHERE id = $1', [req.params.id])
    if (!before) throw notFound('Activity')
    const next = { ...before, ...body }
    await withTransaction(async (client) => {
      let completedAt = before.completed_at
      if (body.completed === true && !before.completed_at) completedAt = new Date().toISOString()
      if (body.completed === false) completedAt = null
      const after = (await one<Activity>(
        `UPDATE activities SET type = $2, subject = $3, body = $4, deal_id = $5, contact_id = $6, company_id = $7, owner_id = $8, due_at = $9, completed_at = $10
         WHERE id = $1 RETURNING *`,
        [before.id, next.type, next.subject, next.body, next.deal_id, next.contact_id, next.company_id, next.owner_id, next.due_at, completedAt],
        client,
      ))!
      const changes = diff(before as never, after as never)
      if (Object.keys(changes).length) {
        const action = body.completed === true ? 'complete' : body.completed === false ? 'reopen' : 'update'
        await audit(client, { entityType: 'activity', entityId: after.id, action, actorId: req.user.id, changes, summary: action === 'complete' ? `Completed ${after.type}: ${after.subject}` : `Updated ${Object.keys(changes).join(', ')}` })
        if (action === 'complete') await touchDeal(after.deal_id, client)
      }
    })
    const after = await load(before.id)
    if (after?.type === 'task' || before.type === 'task') slackSafe(updateTaskCard(before.id, body.completed === true ? req.user.name : null))
    res.json(after)
  }),
)

activitiesRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const a = await one<Activity>('SELECT * FROM activities WHERE id = $1', [req.params.id])
    if (!a) throw notFound('Activity')
    await withTransaction(async (client) => {
      await query('DELETE FROM activities WHERE id = $1', [a.id], client)
      await audit(client, { entityType: 'activity', entityId: a.id, action: 'delete', actorId: req.user.id, changes: { type: a.type, subject: a.subject, deal_id: a.deal_id }, summary: `Deleted ${a.type}: ${a.subject}` })
    })
    slackSafe(deleteTaskCard(a))
    res.json({ ok: true })
  }),
)
