import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { audit, diff } from '../audit.js'
import { one, pool, query, withTransaction } from '../db.js'
import { badRequest, notFound, parse, wrap } from '../http.js'
import type { LostReason, Pipeline, Stage } from '../../shared/types.js'

export const pipelinesRouter = Router()

export async function loadPipelines(): Promise<Pipeline[]> {
  const pipelines = await query<Pipeline>('SELECT * FROM pipelines ORDER BY position, created_at')
  const stages = await query<Stage>('SELECT * FROM stages ORDER BY pipeline_id, position, created_at')
  return pipelines.map((p) => ({ ...p, stages: stages.filter((s) => s.pipeline_id === p.id) }))
}

pipelinesRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json({ items: await loadPipelines() })
  }),
)

const stageSchema = z.object({
  name: z.string().trim().min(1).max(80),
  probability: z.number().int().min(0).max(100).optional(),
  kind: z.enum(['open', 'won', 'lost']).optional(),
  forecast_category: z.enum(['pipeline', 'best_case', 'commit', 'closed', 'omitted']).optional(),
  rot_after_days: z.number().int().positive().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).optional(),
})

pipelinesRouter.post(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(80) }), req.body)
    const created = await withTransaction(async (client) => {
      const p = (await one<Pipeline>(
        `INSERT INTO pipelines (name, position) VALUES ($1, (SELECT COALESCE(MAX(position), -1) + 1 FROM pipelines)) RETURNING *`,
        [body.name],
        client,
      ))!
      // Start every pipeline with a sensible skeleton.
      const seed: Array<[string, number, string, string, string]> = [
        ['New', 10, 'open', 'pipeline', '#2a78d6'],
        ['In progress', 50, 'open', 'best_case', '#1baf7a'],
        ['Won', 100, 'won', 'closed', '#008300'],
        ['Lost', 0, 'lost', 'omitted', '#e34948'],
      ]
      for (const [i, [name, prob, kind, fc, color]] of seed.entries()) {
        await query(
          `INSERT INTO stages (pipeline_id, name, position, probability, kind, forecast_category, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [p.id, name, i, prob, kind, fc, color],
          client,
        )
      }
      await audit(client, { entityType: 'pipeline', entityId: p.id, action: 'create', actorId: req.user.id, changes: { name: p.name }, summary: `Created pipeline ${p.name}` })
      return p
    })
    res.status(201).json((await loadPipelines()).find((p) => p.id === created.id))
  }),
)

pipelinesRouter.patch(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), is_default: z.boolean().optional() }), req.body)
    const before = await one<Pipeline>('SELECT * FROM pipelines WHERE id = $1', [req.params.id])
    if (!before) throw notFound('Pipeline')
    await withTransaction(async (client) => {
      if (body.is_default) await query('UPDATE pipelines SET is_default = false WHERE id <> $1', [before.id], client)
      const after = (await one<Pipeline>(
        'UPDATE pipelines SET name = COALESCE($2, name), is_default = COALESCE($3, is_default) WHERE id = $1 RETURNING *',
        [before.id, body.name ?? null, body.is_default ?? null],
        client,
      ))!
      await audit(client, { entityType: 'pipeline', entityId: after.id, action: 'update', actorId: req.user.id, changes: diff(before as never, after as never), summary: `Updated pipeline ${after.name}` })
    })
    res.json((await loadPipelines()).find((p) => p.id === before.id))
  }),
)

pipelinesRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const p = await one<Pipeline>('SELECT * FROM pipelines WHERE id = $1', [req.params.id])
    if (!p) throw notFound('Pipeline')
    const deals = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM deals WHERE pipeline_id = $1', [p.id])
    if (deals && deals.n > 0) throw badRequest(`Pipeline still has ${deals.n} deal(s). Move or delete them first.`)
    if (p.is_default) throw badRequest('Cannot delete the default pipeline')
    await withTransaction(async (client) => {
      await query('DELETE FROM pipelines WHERE id = $1', [p.id], client)
      await audit(client, { entityType: 'pipeline', entityId: p.id, action: 'delete', actorId: req.user.id, changes: { name: p.name }, summary: `Deleted pipeline ${p.name}` })
    })
    res.json({ ok: true })
  }),
)

pipelinesRouter.post(
  '/:id/stages',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parse(stageSchema, req.body)
    const p = await one<Pipeline>('SELECT * FROM pipelines WHERE id = $1', [req.params.id])
    if (!p) throw notFound('Pipeline')
    const stage = await withTransaction(async (client) => {
      const s = (await one<Stage>(
        `INSERT INTO stages (pipeline_id, name, position, probability, kind, forecast_category, rot_after_days, color)
         VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(MAX(position), -1) + 1 FROM stages WHERE pipeline_id = $1)), $4, $5, $6, $7, $8)
         RETURNING *`,
        [p.id, body.name, body.position ?? null, body.probability ?? 50, body.kind ?? 'open', body.forecast_category ?? 'pipeline', body.rot_after_days ?? null, body.color ?? '#2a78d6'],
        client,
      ))!
      await audit(client, { entityType: 'stage', entityId: s.id, action: 'create', actorId: req.user.id, changes: { name: s.name, pipeline: p.name }, summary: `Added stage ${s.name} to ${p.name}` })
      return s
    })
    res.status(201).json(stage)
  }),
)

pipelinesRouter.patch(
  '/:id/stages/:stageId',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parse(stageSchema.partial(), req.body)
    const before = await one<Stage>('SELECT * FROM stages WHERE id = $1 AND pipeline_id = $2', [req.params.stageId, req.params.id])
    if (!before) throw notFound('Stage')
    const after = await withTransaction(async (client) => {
      const s = (await one<Stage>(
        `UPDATE stages SET name = COALESCE($2, name), probability = COALESCE($3, probability), kind = COALESCE($4, kind),
           forecast_category = COALESCE($5, forecast_category),
           rot_after_days = CASE WHEN $6::boolean THEN $7 ELSE rot_after_days END,
           color = COALESCE($8, color), position = COALESCE($9, position)
         WHERE id = $1 RETURNING *`,
        [before.id, body.name ?? null, body.probability ?? null, body.kind ?? null, body.forecast_category ?? null, 'rot_after_days' in body, body.rot_after_days ?? null, body.color ?? null, body.position ?? null],
        client,
      ))!
      await audit(client, { entityType: 'stage', entityId: s.id, action: 'update', actorId: req.user.id, changes: diff(before as never, s as never), summary: `Updated stage ${s.name}` })
      return s
    })
    res.json(after)
  }),
)

/** Reorder: body.stage_ids in the desired order. */
pipelinesRouter.post(
  '/:id/stages/reorder',
  requireAdmin,
  wrap(async (req, res) => {
    const { stage_ids } = parse(z.object({ stage_ids: z.array(z.string().uuid()).min(1) }), req.body)
    await withTransaction(async (client) => {
      for (const [i, id] of stage_ids.entries()) {
        await query('UPDATE stages SET position = $1 WHERE id = $2 AND pipeline_id = $3', [i, id, req.params.id], client)
      }
      await audit(client, { entityType: 'pipeline', entityId: req.params.id as string, action: 'update', actorId: req.user.id, changes: { stage_order: stage_ids }, summary: 'Reordered stages' })
    })
    res.json((await loadPipelines()).find((p) => p.id === req.params.id))
  }),
)

pipelinesRouter.delete(
  '/:id/stages/:stageId',
  requireAdmin,
  wrap(async (req, res) => {
    const s = await one<Stage>('SELECT * FROM stages WHERE id = $1 AND pipeline_id = $2', [req.params.stageId, req.params.id])
    if (!s) throw notFound('Stage')
    const n = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM deals WHERE stage_id = $1', [s.id])
    if (n && n.n > 0) throw badRequest(`Stage still has ${n.n} deal(s). Move them first.`)
    await withTransaction(async (client) => {
      await query('DELETE FROM stages WHERE id = $1', [s.id], client)
      await audit(client, { entityType: 'stage', entityId: s.id, action: 'delete', actorId: req.user.id, changes: { name: s.name }, summary: `Deleted stage ${s.name}` })
    })
    res.json({ ok: true })
  }),
)

// ---- Lost reasons (small lookup table; lives here with the other pipeline settings) ----

export const lostReasonsRouter = Router()

lostReasonsRouter.get(
  '/',
  wrap(async (_req, res) => {
    res.json({ items: await query<LostReason>('SELECT * FROM lost_reasons ORDER BY position, label') })
  }),
)

lostReasonsRouter.post(
  '/',
  requireAdmin,
  wrap(async (req, res) => {
    const { label } = parse(z.object({ label: z.string().trim().min(1).max(80) }), req.body)
    const r = await one<LostReason>(
      `INSERT INTO lost_reasons (label, position) VALUES ($1, (SELECT COALESCE(MAX(position), -1) + 1 FROM lost_reasons))
       ON CONFLICT (label) DO UPDATE SET label = EXCLUDED.label RETURNING *`,
      [label],
    )
    await audit(pool, { entityType: 'lost_reason', entityId: r!.id, action: 'create', actorId: req.user.id, changes: { label }, summary: `Added lost reason ${label}` })
    res.status(201).json(r)
  }),
)

lostReasonsRouter.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const r = await one<LostReason>('DELETE FROM lost_reasons WHERE id = $1 RETURNING *', [req.params.id])
    if (!r) throw notFound('Lost reason')
    await audit(pool, { entityType: 'lost_reason', entityId: r.id, action: 'delete', actorId: req.user.id, changes: { label: r.label }, summary: `Removed lost reason ${r.label}` })
    res.json({ ok: true })
  }),
)
