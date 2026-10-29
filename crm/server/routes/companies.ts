import { Router } from 'express'
import { z } from 'zod'
import { audit, diff } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { notFound, parse, parsePaging, parseSort, wrap } from '../http.js'
import type { Company } from '../../shared/types.js'

export const companiesRouter = Router()

const companySchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(200).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
})

const SORTS: Record<string, string> = {
  name: 'lower(c.name)',
  industry: 'lower(c.industry)',
  owner: 'lower(o.name)',
  contacts: 'contact_count',
  open_deals: 'open_deal_count',
  open_value: 'open_deal_value',
  created_at: 'c.created_at',
  updated_at: 'c.updated_at',
}

const LIST_SELECT = `
  SELECT c.*, o.name AS owner_name,
    (SELECT COUNT(*)::int FROM contacts ct WHERE ct.company_id = c.id AND ct.archived_at IS NULL) AS contact_count,
    (SELECT COUNT(*)::int FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.company_id = c.id AND d.archived_at IS NULL AND s.kind = 'open') AS open_deal_count,
    (SELECT COALESCE(SUM(d.amount), 0) FROM deals d JOIN stages s ON s.id = d.stage_id WHERE d.company_id = c.id AND d.archived_at IS NULL AND s.kind = 'open') AS open_deal_value
  FROM companies c LEFT JOIN users o ON o.id = c.owner_id`

companiesRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>
    const { sql } = parseSort(q, SORTS, 'name')
    const { limit, offset } = parsePaging(q)
    const where: string[] = []
    const params: unknown[] = []
    if (q.archived === 'true') where.push('c.archived_at IS NOT NULL')
    else where.push('c.archived_at IS NULL')
    if (typeof q.q === 'string' && q.q.trim()) {
      params.push(`%${q.q.trim()}%`)
      where.push(`(c.name ILIKE $${params.length} OR c.domain ILIKE $${params.length} OR c.industry ILIKE $${params.length})`)
    }
    if (typeof q.owner_id === 'string' && q.owner_id) {
      params.push(q.owner_id)
      where.push(`c.owner_id = $${params.length}`)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const total = (await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM companies c ${whereSql}`, params))!.n
    const items = await query<Company>(`${LIST_SELECT} ${whereSql} ORDER BY ${sql}, c.id LIMIT ${limit} OFFSET ${offset}`, params)
    res.json({ items, total, limit, offset })
  }),
)

companiesRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const c = await one<Company>(`${LIST_SELECT} WHERE c.id = $1`, [req.params.id])
    if (!c) throw notFound('Company')
    res.json(c)
  }),
)

companiesRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = parse(companySchema, req.body)
    const created = await withTransaction(async (client) => {
      const c = (await one<Company>(
        `INSERT INTO companies (name, domain, website, industry, phone, address, notes, owner_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [body.name, body.domain ?? null, body.website ?? null, body.industry ?? null, body.phone ?? null, body.address ?? null, body.notes ?? null, body.owner_id ?? req.user.id, req.user.id],
        client,
      ))!
      await audit(client, { entityType: 'company', entityId: c.id, action: 'create', actorId: req.user.id, changes: { ...body }, summary: `Created company ${c.name}` })
      return c
    })
    res.status(201).json(await one<Company>(`${LIST_SELECT} WHERE c.id = $1`, [created.id]))
  }),
)

companiesRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const body = parse(companySchema.partial(), req.body)
    const before = await one<Company>('SELECT * FROM companies WHERE id = $1', [req.params.id])
    if (!before) throw notFound('Company')
    const next = { ...before, ...body }
    await withTransaction(async (client) => {
      const after = (await one<Company>(
        `UPDATE companies SET name = $2, domain = $3, website = $4, industry = $5, phone = $6, address = $7, notes = $8, owner_id = $9
         WHERE id = $1 RETURNING *`,
        [before.id, next.name, next.domain, next.website, next.industry, next.phone, next.address, next.notes, next.owner_id],
        client,
      ))!
      const changes = diff(before as never, after as never)
      if (Object.keys(changes).length) {
        await audit(client, { entityType: 'company', entityId: after.id, action: 'update', actorId: req.user.id, changes, summary: `Updated ${Object.keys(changes).join(', ')}` })
      }
    })
    res.json(await one<Company>(`${LIST_SELECT} WHERE c.id = $1`, [before.id]))
  }),
)

companiesRouter.post(
  '/:id/archive',
  wrap(async (req, res) => {
    const restore = req.query.restore === 'true'
    const c = await one<Company>(
      `UPDATE companies SET archived_at = ${restore ? 'NULL' : 'now()'} WHERE id = $1 RETURNING *`,
      [req.params.id],
    )
    if (!c) throw notFound('Company')
    await withTransaction((client) =>
      audit(client, { entityType: 'company', entityId: c.id, action: restore ? 'restore' : 'archive', actorId: req.user.id, summary: `${restore ? 'Restored' : 'Archived'} ${c.name}` }),
    )
    res.json(c)
  }),
)
