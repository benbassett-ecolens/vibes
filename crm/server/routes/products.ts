import { Router } from 'express'
import { z } from 'zod'
import type pg from 'pg'
import { requireAdmin } from '../auth.js'
import { audit, diff } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { badRequest, notFound, parse, wrap } from '../http.js'
import { dealTotal, lineTotal } from '../../shared/pricing.js'
import type { DealProduct, Product } from '../../shared/types.js'

export const productsRouter = Router()

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).nullable().optional(),
  pricing_type: z.enum(['one_time', 'monthly', 'percent']).optional(),
  unit_price: z.number().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
})

productsRouter.get(
  '/',
  wrap(async (req, res) => {
    const all = req.query.all === 'true'
    res.json({ items: await query<Product>(`SELECT * FROM products ${all ? '' : 'WHERE is_active'} ORDER BY position, name`) })
  }),
)

productsRouter.post(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const b = parse(productSchema, req.body)
    const p = (await one<Product>(
      `INSERT INTO products (name, sku, pricing_type, unit_price, description, is_active, position)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, (SELECT COALESCE(MAX(position), -1) + 1 FROM products))) RETURNING *`,
      [b.name, b.sku ?? null, b.pricing_type ?? 'one_time', b.unit_price ?? 0, b.description ?? null, b.is_active ?? true, b.position ?? null],
    ))!
    await withTransaction((c) => audit(c, { entityType: 'product', entityId: p.id, action: 'create', actorId: req.user.id, changes: { ...b }, summary: `Added product ${p.name}` }))
    res.status(201).json(p)
  }),
)

productsRouter.patch(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const b = parse(productSchema.partial(), req.body)
    const before = await one<Product>('SELECT * FROM products WHERE id = $1', [req.params.id])
    if (!before) throw notFound('Product')
    const n = { ...before, ...b }
    const after = (await one<Product>(
      `UPDATE products SET name = $2, sku = $3, pricing_type = $4, unit_price = $5, description = $6, is_active = $7, position = $8 WHERE id = $1 RETURNING *`,
      [before.id, n.name, n.sku, n.pricing_type, n.unit_price, n.description, n.is_active, n.position],
    ))!
    const changes = diff(before as never, after as never)
    if (Object.keys(changes).length) await withTransaction((c) => audit(c, { entityType: 'product', entityId: after.id, action: 'update', actorId: req.user.id, changes, summary: `Updated product ${after.name}` }))
    res.json(after)
  }),
)

productsRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const used = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM deal_products WHERE product_id = $1', [req.params.id])
    if (used && used.n > 0) throw badRequest(`Product is on ${used.n} deal(s). Deactivate it instead.`)
    const p = await one<Product>('DELETE FROM products WHERE id = $1 RETURNING *', [req.params.id])
    if (!p) throw notFound('Product')
    await withTransaction((c) => audit(c, { entityType: 'product', entityId: p.id, action: 'delete', actorId: req.user.id, changes: { name: p.name }, summary: `Deleted product ${p.name}` }))
    res.json({ ok: true })
  }),
)

// ---------- Deal line items (mounted at /api/deals/:dealId/products) ----------

export const dealProductsRouter = Router({ mergeParams: true })

const LINE_SELECT = `SELECT dp.*, p.name AS product_name FROM deal_products dp JOIN products p ON p.id = dp.product_id`

export async function loadLines(dealId: string, client?: pg.PoolClient): Promise<DealProduct[]> {
  const rows = await query<DealProduct>(`${LINE_SELECT} WHERE dp.deal_id = $1 ORDER BY dp.position, dp.created_at`, [dealId], client)
  return rows.map((r) => ({ ...r, line_total: lineTotal(r) }))
}

/** Deal amount follows its line items whenever it has any. */
async function recomputeAmount(dealId: string, actorId: string, client: pg.PoolClient): Promise<void> {
  const lines = await loadLines(dealId, client)
  const before = (await one<{ amount: number }>('SELECT amount FROM deals WHERE id = $1', [dealId], client))!
  if (!lines.length) {
    await query('UPDATE deals SET amount_from_products = false WHERE id = $1', [dealId], client)
    return
  }
  const total = dealTotal(lines)
  await query('UPDATE deals SET amount = $2, amount_from_products = true WHERE id = $1', [dealId, total], client)
  if (Number(before.amount) !== total) {
    await audit(client, { entityType: 'deal', entityId: dealId, action: 'update', actorId, changes: { amount: { from: before.amount, to: total } }, summary: 'First-year value recalculated from products' })
  }
}

const lineSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().min(0).optional(),
  unit_price: z.number().min(0).optional(),
  term_months: z.number().int().min(0).max(240).optional(),
  basis_amount: z.number().min(0).optional(),
  notes: z.string().max(500).nullable().optional(),
})

dealProductsRouter.get(
  '/',
  wrap(async (req, res) => {
    res.json({ items: await loadLines(req.params.dealId as string) })
  }),
)

dealProductsRouter.post(
  '/',
  wrap(async (req, res) => {
    const dealId = req.params.dealId as string
    const b = parse(lineSchema, req.body)
    const product = await one<Product>('SELECT * FROM products WHERE id = $1', [b.product_id])
    if (!product) throw badRequest('Unknown product')
    if (!(await one('SELECT 1 FROM deals WHERE id = $1', [dealId]))) throw notFound('Deal')
    await withTransaction(async (client) => {
      const line = (await one<DealProduct>(
        `INSERT INTO deal_products (deal_id, product_id, pricing_type, quantity, unit_price, term_months, basis_amount, notes, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, (SELECT COALESCE(MAX(position), -1) + 1 FROM deal_products WHERE deal_id = $1)) RETURNING *`,
        [dealId, product.id, product.pricing_type, b.quantity ?? 1, b.unit_price ?? product.unit_price, b.term_months ?? 12, b.basis_amount ?? 0, b.notes ?? null],
        client,
      ))!
      await audit(client, { entityType: 'deal', entityId: dealId, action: 'update', actorId: req.user.id, changes: { product_added: product.name, line_total: lineTotal(line) }, summary: `Added product ${product.name}` })
      await recomputeAmount(dealId, req.user.id, client)
    })
    res.status(201).json({ items: await loadLines(dealId) })
  }),
)

dealProductsRouter.patch(
  '/:lineId',
  wrap(async (req, res) => {
    const dealId = req.params.dealId as string
    const b = parse(lineSchema.partial().omit({ product_id: true }), req.body)
    const before = await one<DealProduct>('SELECT * FROM deal_products WHERE id = $1 AND deal_id = $2', [req.params.lineId, dealId])
    if (!before) throw notFound('Line item')
    const n = { ...before, ...b }
    await withTransaction(async (client) => {
      const after = (await one<DealProduct>(
        `UPDATE deal_products SET quantity = $2, unit_price = $3, term_months = $4, basis_amount = $5, notes = $6 WHERE id = $1 RETURNING *`,
        [before.id, n.quantity, n.unit_price, n.term_months, n.basis_amount, n.notes],
        client,
      ))!
      const changes = diff(before as never, after as never)
      if (Object.keys(changes).length) await audit(client, { entityType: 'deal', entityId: dealId, action: 'update', actorId: req.user.id, changes, summary: 'Updated a product line' })
      await recomputeAmount(dealId, req.user.id, client)
    })
    res.json({ items: await loadLines(dealId) })
  }),
)

dealProductsRouter.delete(
  '/:lineId',
  wrap(async (req, res) => {
    const dealId = req.params.dealId as string
    await withTransaction(async (client) => {
      const line = await one<DealProduct & { product_name: string }>(`${LINE_SELECT} WHERE dp.id = $1 AND dp.deal_id = $2`, [req.params.lineId, dealId], client)
      if (!line) throw notFound('Line item')
      await query('DELETE FROM deal_products WHERE id = $1', [line.id], client)
      await audit(client, { entityType: 'deal', entityId: dealId, action: 'update', actorId: req.user.id, changes: { product_removed: line.product_name }, summary: `Removed product ${line.product_name}` })
      await recomputeAmount(dealId, req.user.id, client)
    })
    res.json({ items: await loadLines(dealId) })
  }),
)
