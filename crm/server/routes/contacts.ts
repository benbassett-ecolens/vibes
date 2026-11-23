import { Router } from 'express'
import { z } from 'zod'
import { audit, diff } from '../audit.js'
import { one, pool, query, withTransaction } from '../db.js'
import { badRequest, notFound, parse, parsePaging, parseSort, wrap } from '../http.js'
import type { Contact } from '../../shared/types.js'
import { autoCompanyForEmail, propagateLink, suggestCompaniesForEmail } from './linker.js'

export const contactsRouter = Router()

const contactSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().max(100).optional().default(''),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(60).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  reports_to_id: z.string().uuid().nullable().optional(),
  department: z.string().trim().max(80).nullable().optional(),
  influence: z.enum(['decision_maker', 'champion', 'influencer', 'blocker', 'user']).nullable().optional(),
})

/** A manager must be a different contact at the same company, and must not report (transitively) to this contact. */
async function checkManager(contactId: string | null, companyId: string | null, managerId: string | null | undefined, client: { query: (t: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<void> {
  if (!managerId) return
  if (contactId && managerId === contactId) throw badRequest('A contact cannot report to themselves')
  const m = (await client.query('SELECT company_id FROM contacts WHERE id = $1 AND archived_at IS NULL', [managerId])).rows[0]
  if (!m) throw badRequest('Manager not found')
  if (companyId && m.company_id !== companyId) throw badRequest('The manager must be at the same company')
  if (contactId) {
    // Walk up from the manager; hitting ourselves would make a loop.
    let cur: string | null = managerId
    for (let i = 0; i < 50 && cur; i++) {
      const r = (await client.query('SELECT reports_to_id FROM contacts WHERE id = $1', [cur])).rows[0] as { reports_to_id: string | null } | undefined
      cur = r?.reports_to_id ?? null
      if (cur === contactId) throw badRequest('That would create a reporting loop')
    }
  }
}

const SORTS: Record<string, string> = {
  name: 'lower(ct.last_name), lower(ct.first_name)',
  first_name: 'lower(ct.first_name)',
  email: 'lower(ct.email)',
  title: 'lower(ct.title)',
  company: 'lower(co.name)',
  owner: 'lower(o.name)',
  last_activity: 'last_activity_at',
  created_at: 'ct.created_at',
  updated_at: 'ct.updated_at',
}

const LIST_SELECT = `
  SELECT ct.*, co.name AS company_name, o.name AS owner_name,
    NULLIF(TRIM(CONCAT(m.first_name, ' ', m.last_name)), '') AS reports_to_name,
    (SELECT COUNT(*)::int FROM contacts r WHERE r.reports_to_id = ct.id AND r.archived_at IS NULL) AS report_count,
    (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = ct.id) AS last_activity_at
  FROM contacts ct
  LEFT JOIN companies co ON co.id = ct.company_id
  LEFT JOIN contacts m ON m.id = ct.reports_to_id
  LEFT JOIN users o ON o.id = ct.owner_id`

contactsRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>
    const { sql } = parseSort(q, SORTS, 'name')
    const { limit, offset } = parsePaging(q)
    const where: string[] = [q.archived === 'true' ? 'ct.archived_at IS NOT NULL' : 'ct.archived_at IS NULL']
    const params: unknown[] = []
    if (typeof q.q === 'string' && q.q.trim()) {
      params.push(`%${q.q.trim()}%`)
      where.push(`(ct.first_name ILIKE $${params.length} OR ct.last_name ILIKE $${params.length} OR ct.email ILIKE $${params.length} OR co.name ILIKE $${params.length} OR ct.title ILIKE $${params.length})`)
    }
    if (typeof q.company_id === 'string' && q.company_id) {
      params.push(q.company_id)
      where.push(`ct.company_id = $${params.length}`)
    }
    if (typeof q.owner_id === 'string' && q.owner_id) {
      params.push(q.owner_id)
      where.push(`ct.owner_id = $${params.length}`)
    }
    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id ${whereSql}`, params))!.n
    const items = await query<Contact>(`${LIST_SELECT} ${whereSql} ORDER BY ${sql}, ct.id LIMIT ${limit} OFFSET ${offset}`, params)
    res.json({ items, total, limit, offset })
  }),
)

/** Company suggestions for an email address (used by the contact form as you type). */
contactsRouter.get(
  '/suggest-company',
  wrap(async (req, res) => {
    const email = typeof req.query.email === 'string' ? req.query.email : ''
    if (!email.includes('@')) {
      res.json({ items: [] })
      return
    }
    const s = await suggestCompaniesForEmail(email)
    res.json({ items: s.map((x) => ({ company_id: x.company.id, company_name: x.company.name, score: x.score, reason: x.reason })) })
  }),
)

contactsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const c = await one<Contact>(`${LIST_SELECT} WHERE ct.id = $1`, [req.params.id])
    if (!c) throw notFound('Contact')
    res.json(c)
  }),
)

contactsRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = parse(contactSchema, req.body)
    const companyId = body.company_id ?? (await autoCompanyForEmail(body.email))
    await checkManager(null, companyId, body.reports_to_id, pool)
    const created = await withTransaction(async (client) => {
      const c = (await one<Contact>(
        `INSERT INTO contacts (first_name, last_name, email, phone, title, notes, company_id, owner_id, created_by, reports_to_id, department, influence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [body.first_name, body.last_name ?? '', body.email ?? null, body.phone ?? null, body.title ?? null, body.notes ?? null, companyId, body.owner_id ?? req.user.id, req.user.id, body.reports_to_id ?? null, body.department ?? null, body.influence ?? null],
        client,
      ))!
      await audit(client, { entityType: 'contact', entityId: c.id, action: 'create', actorId: req.user.id, changes: { ...body, ...(companyId && !body.company_id ? { company_id: companyId, company_via: 'email domain' } : {}) }, summary: `Created contact ${c.first_name} ${c.last_name}`.trim() })
      if (companyId) await propagateLink(client, c.id, companyId, c.email, req.user.id)
      return c
    })
    res.status(201).json(await one<Contact>(`${LIST_SELECT} WHERE ct.id = $1`, [created.id]))
  }),
)

contactsRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const body = parse(contactSchema.partial(), req.body)
    const before = await one<Contact>('SELECT * FROM contacts WHERE id = $1', [req.params.id])
    if (!before) throw notFound('Contact')
    const next = { ...before, ...body }
    await checkManager(before.id, next.company_id ?? null, next.company_id === before.company_id ? next.reports_to_id : body.reports_to_id, pool)
    await withTransaction(async (client) => {
      const after = (await one<Contact>(
        `UPDATE contacts SET first_name = $2, last_name = $3, email = $4, phone = $5, title = $6, notes = $7, company_id = $8, owner_id = $9,
           reports_to_id = $10, department = $11, influence = $12
         WHERE id = $1 RETURNING *`,
        [before.id, next.first_name, next.last_name, next.email, next.phone, next.title, next.notes, next.company_id, next.owner_id,
          next.company_id === before.company_id ? (next.reports_to_id ?? null) : (body.reports_to_id ?? null), next.department ?? null, next.influence ?? null],
        client,
      ))!
      const changes = diff(before as never, after as never)
      if (Object.keys(changes).length) {
        await audit(client, { entityType: 'contact', entityId: after.id, action: 'update', actorId: req.user.id, changes, summary: `Updated ${Object.keys(changes).join(', ')}` })
      }
      if (after.company_id && after.company_id !== before.company_id) await propagateLink(client, after.id, after.company_id, after.email, req.user.id)
    })
    res.json(await one<Contact>(`${LIST_SELECT} WHERE ct.id = $1`, [before.id]))
  }),
)

contactsRouter.post(
  '/:id/archive',
  wrap(async (req, res) => {
    const restore = req.query.restore === 'true'
    const c = await one<Contact>(`UPDATE contacts SET archived_at = ${restore ? 'NULL' : 'now()'} WHERE id = $1 RETURNING *`, [req.params.id])
    if (!c) throw notFound('Contact')
    await withTransaction((client) =>
      audit(client, { entityType: 'contact', entityId: c.id, action: restore ? 'restore' : 'archive', actorId: req.user.id, summary: `${restore ? 'Restored' : 'Archived'} ${c.first_name} ${c.last_name}`.trim() }),
    )
    res.json(c)
  }),
)
