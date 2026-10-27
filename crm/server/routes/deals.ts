import { Router } from 'express'
import { z } from 'zod'
import type pg from 'pg'
import { audit, diff } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { badRequest, notFound, parse, parsePaging, parseSort, wrap } from '../http.js'
import type { Activity, AuditEntry, Deal, Stage, StageHistoryEntry, TimelineItem } from '../../shared/types.js'

export const dealsRouter = Router()

const dealSchema = z.object({
  title: z.string().trim().min(1).max(200),
  pipeline_id: z.string().uuid().optional(),
  stage_id: z.string().uuid().optional(),
  amount: z.number().min(0).max(1e12).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  company_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  expected_close_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lost_reason: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(20000).nullable().optional(),
})

const SORTS: Record<string, string> = {
  title: 'lower(d.title)',
  amount: 'd.amount',
  weighted: 'weighted_amount',
  stage: 's.position',
  company: 'lower(co.name)',
  owner: 'lower(o.name)',
  expected_close_date: 'd.expected_close_date',
  closed_at: 'd.closed_at',
  stage_entered_at: 'd.stage_entered_at',
  last_activity: 'd.last_activity_at',
  next_activity: 'next_activity_at',
  created_at: 'd.created_at',
  updated_at: 'd.updated_at',
}

export const DEAL_SELECT = `
  SELECT d.*, s.name AS stage_name, s.kind AS stage_kind, s.probability, s.rot_after_days,
    co.name AS company_name, o.name AS owner_name,
    NULLIF(TRIM(CONCAT(ct.first_name, ' ', ct.last_name)), '') AS contact_name,
    ROUND(d.amount * s.probability / 100.0, 2) AS weighted_amount,
    (SELECT MIN(a.due_at) FROM activities a WHERE a.deal_id = d.id AND a.completed_at IS NULL AND a.due_at IS NOT NULL) AS next_activity_at,
    (SELECT COUNT(*)::int FROM activities a WHERE a.deal_id = d.id AND a.completed_at IS NULL AND a.due_at IS NOT NULL AND a.due_at < now()) AS overdue_task_count,
    (SELECT COUNT(*)::int FROM activities a WHERE a.deal_id = d.id AND a.completed_at IS NULL AND a.type = 'task') AS open_task_count
  FROM deals d
  JOIN stages s ON s.id = d.stage_id
  LEFT JOIN companies co ON co.id = d.company_id
  LEFT JOIN contacts ct ON ct.id = d.contact_id
  LEFT JOIN users o ON o.id = d.owner_id`

async function loadDeal(id: string, client?: pg.PoolClient): Promise<Deal | null> {
  return one<Deal>(`${DEAL_SELECT} WHERE d.id = $1`, [id], client)
}

function buildFilters(q: Record<string, unknown>): { where: string[]; params: unknown[] } {
  const where: string[] = [q.archived === 'true' ? 'd.archived_at IS NOT NULL' : 'd.archived_at IS NULL']
  const params: unknown[] = []
  const add = (sql: string, v: unknown) => {
    params.push(v)
    where.push(sql.replace('?', `$${params.length}`))
  }
  if (typeof q.pipeline_id === 'string' && q.pipeline_id) add('d.pipeline_id = ?', q.pipeline_id)
  if (typeof q.stage_id === 'string' && q.stage_id) add('d.stage_id = ?', q.stage_id)
  if (typeof q.owner_id === 'string' && q.owner_id) add('d.owner_id = ?', q.owner_id)
  if (typeof q.company_id === 'string' && q.company_id) add('d.company_id = ?', q.company_id)
  if (typeof q.contact_id === 'string' && q.contact_id) add('d.contact_id = ?', q.contact_id)
  if (typeof q.status === 'string' && ['open', 'won', 'lost'].includes(q.status)) add('s.kind = ?', q.status)
  if (typeof q.q === 'string' && q.q.trim()) {
    params.push(`%${q.q.trim()}%`)
    where.push(`(d.title ILIKE $${params.length} OR co.name ILIKE $${params.length} OR ct.first_name ILIKE $${params.length} OR ct.last_name ILIKE $${params.length})`)
  }
  if (typeof q.close_from === 'string' && q.close_from) add('d.expected_close_date >= ?', q.close_from)
  if (typeof q.close_to === 'string' && q.close_to) add('d.expected_close_date <= ?', q.close_to)
  return { where, params }
}

dealsRouter.get(
  '/',
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>
    const { sql } = parseSort(q, SORTS, 'updated_at', 'desc')
    const { limit, offset } = parsePaging(q)
    const { where, params } = buildFilters(q)
    const whereSql = `WHERE ${where.join(' AND ')}`
    const total = (await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM deals d JOIN stages s ON s.id = d.stage_id LEFT JOIN companies co ON co.id = d.company_id LEFT JOIN contacts ct ON ct.id = d.contact_id ${whereSql}`,
      params,
    ))!.n
    const items = await query<Deal>(`${DEAL_SELECT} ${whereSql} ORDER BY ${sql}, d.id LIMIT ${limit} OFFSET ${offset}`, params)
    res.json({ items, total, limit, offset })
  }),
)

/** Kanban payload: every non-archived deal in a pipeline, ordered for columns. */
dealsRouter.get(
  '/board',
  wrap(async (req, res) => {
    const q = req.query as Record<string, unknown>
    if (typeof q.pipeline_id !== 'string' || !q.pipeline_id) throw badRequest('pipeline_id is required')
    const { where, params } = buildFilters({ ...q, archived: 'false' })
    const items = await query<Deal>(`${DEAL_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.position, d.position, d.created_at`, params)
    res.json({ items })
  }),
)

dealsRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const d = await loadDeal(req.params.id as string)
    if (!d) throw notFound('Deal')
    res.json(d)
  }),
)

/** Activities, audit entries and stage moves for a deal, newest first. */
dealsRouter.get(
  '/:id/timeline',
  wrap(async (req, res) => {
    const id = req.params.id as string
    const d = await one<{ id: string }>('SELECT id FROM deals WHERE id = $1', [id])
    if (!d) throw notFound('Deal')
    const activities = await query<Activity>(
      `SELECT a.*, o.name AS owner_name, cb.name AS created_by_name,
         NULLIF(TRIM(CONCAT(ct.first_name, ' ', ct.last_name)), '') AS contact_name
       FROM activities a LEFT JOIN users o ON o.id = a.owner_id LEFT JOIN users cb ON cb.id = a.created_by
       LEFT JOIN contacts ct ON ct.id = a.contact_id
       WHERE a.deal_id = $1 ORDER BY a.created_at DESC`,
      [id],
    )
    const audits = await query<AuditEntry>(
      `SELECT l.*, u.name AS actor_name FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id
       WHERE l.entity_type = 'deal' AND l.entity_id = $1 ORDER BY l.created_at DESC LIMIT 500`,
      [id],
    )
    const stages = await query<StageHistoryEntry>(
      `SELECT h.*, f.name AS from_stage_name, t.name AS to_stage_name, u.name AS changed_by_name
       FROM deal_stage_history h LEFT JOIN stages f ON f.id = h.from_stage_id JOIN stages t ON t.id = h.to_stage_id
       LEFT JOIN users u ON u.id = h.changed_by WHERE h.deal_id = $1 ORDER BY h.entered_at DESC`,
      [id],
    )
    const items: TimelineItem[] = [
      ...activities.map((a) => ({ kind: 'activity' as const, at: a.created_at, activity: a })),
      ...audits.filter((a) => a.action !== 'stage_change').map((a) => ({ kind: 'audit' as const, at: a.created_at, audit: a })),
      ...stages.map((s) => ({ kind: 'stage' as const, at: s.entered_at, stage: s })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    res.json({ items, stage_history: stages })
  }),
)

async function stageFor(stageId: string, client: pg.PoolClient): Promise<Stage> {
  const s = await one<Stage>('SELECT * FROM stages WHERE id = $1', [stageId], client)
  if (!s) throw badRequest('Unknown stage')
  return s
}

/**
 * Apply a stage move inside a transaction: history row, timestamps, closed_at.
 * `position` is the kanban ordering inside the destination column.
 */
async function moveStage(
  client: pg.PoolClient,
  deal: Deal,
  toStageId: string,
  actorId: string,
  opts: { position?: number; lost_reason?: string | null } = {},
): Promise<void> {
  const to = await stageFor(toStageId, client)
  if (to.pipeline_id !== deal.pipeline_id) throw badRequest('Stage belongs to a different pipeline')
  const from = await one<Stage>('SELECT * FROM stages WHERE id = $1', [deal.stage_id], client)
  if (to.id === deal.stage_id) {
    if (opts.position !== undefined) await query('UPDATE deals SET position = $2 WHERE id = $1', [deal.id, opts.position], client)
    return
  }
  const closedAt = to.kind === 'open' ? null : new Date().toISOString()
  const lostReason = to.kind === 'lost' ? (opts.lost_reason ?? deal.lost_reason) : null
  await query('UPDATE deal_stage_history SET exited_at = now() WHERE deal_id = $1 AND exited_at IS NULL', [deal.id], client)
  await query(
    'INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by) VALUES ($1, $2, $3, $4)',
    [deal.id, deal.stage_id, to.id, actorId],
    client,
  )
  await query(
    `UPDATE deals SET stage_id = $2, stage_entered_at = now(), closed_at = $3, lost_reason = $4,
       position = COALESCE($5, (SELECT COALESCE(MAX(position), 0) + 1 FROM deals WHERE stage_id = $2))
     WHERE id = $1`,
    [deal.id, to.id, closedAt, lostReason, opts.position ?? null],
    client,
  )
  await audit(client, {
    entityType: 'deal',
    entityId: deal.id,
    action: 'stage_change',
    actorId,
    changes: { stage: { from: from?.name ?? null, to: to.name }, ...(lostReason ? { lost_reason: { from: deal.lost_reason, to: lostReason } } : {}) },
    summary: `Moved from ${from?.name ?? '—'} to ${to.name}`,
  })
}

dealsRouter.post(
  '/',
  wrap(async (req, res) => {
    const body = parse(dealSchema, req.body)
    const created = await withTransaction(async (client) => {
      let pipelineId = body.pipeline_id
      if (!pipelineId) {
        const def = await one<{ id: string }>('SELECT id FROM pipelines ORDER BY is_default DESC, position LIMIT 1', [], client)
        if (!def) throw badRequest('No pipeline exists')
        pipelineId = def.id
      }
      let stage: Stage
      if (body.stage_id) {
        stage = await stageFor(body.stage_id, client)
        if (stage.pipeline_id !== pipelineId) throw badRequest('Stage belongs to a different pipeline')
      } else {
        const first = await one<Stage>("SELECT * FROM stages WHERE pipeline_id = $1 AND kind = 'open' ORDER BY position LIMIT 1", [pipelineId], client)
        if (!first) throw badRequest('Pipeline has no open stage')
        stage = first
      }
      const closedAt = stage.kind === 'open' ? null : new Date().toISOString()
      const d = (await one<Deal>(
        `INSERT INTO deals (title, pipeline_id, stage_id, amount, currency, company_id, contact_id, owner_id, expected_close_date, lost_reason, description, closed_at, created_by, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, (SELECT COALESCE(MAX(position), 0) + 1 FROM deals WHERE stage_id = $3))
         RETURNING *`,
        [body.title, pipelineId, stage.id, body.amount ?? 0, body.currency ?? 'USD', body.company_id ?? null, body.contact_id ?? null, body.owner_id ?? req.user.id, body.expected_close_date ?? null, body.lost_reason ?? null, body.description ?? null, closedAt, req.user.id],
        client,
      ))!
      await query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by) VALUES ($1, NULL, $2, $3)', [d.id, stage.id, req.user.id], client)
      await audit(client, { entityType: 'deal', entityId: d.id, action: 'create', actorId: req.user.id, changes: { ...body, stage: stage.name }, summary: `Created deal ${d.title} in ${stage.name}` })
      return d
    })
    res.status(201).json(await loadDeal(created.id))
  }),
)

dealsRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    const body = parse(dealSchema.partial(), req.body)
    const before = await loadDeal(req.params.id as string)
    if (!before) throw notFound('Deal')
    await withTransaction(async (client) => {
      const next = { ...before, ...body }
      if (body.pipeline_id && body.pipeline_id !== before.pipeline_id) {
        // Moving pipelines: require (or pick) a stage in the new pipeline.
        const stage = body.stage_id
          ? await stageFor(body.stage_id, client)
          : await one<Stage>("SELECT * FROM stages WHERE pipeline_id = $1 AND kind = 'open' ORDER BY position LIMIT 1", [body.pipeline_id], client)
        if (!stage || stage.pipeline_id !== body.pipeline_id) throw badRequest('Choose a stage in the target pipeline')
        await query('UPDATE deals SET pipeline_id = $2, stage_id = $3, stage_entered_at = now(), closed_at = $4 WHERE id = $1', [before.id, body.pipeline_id, stage.id, stage.kind === 'open' ? null : new Date().toISOString()], client)
        await query('UPDATE deal_stage_history SET exited_at = now() WHERE deal_id = $1 AND exited_at IS NULL', [before.id], client)
        await query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by) VALUES ($1, $2, $3, $4)', [before.id, before.stage_id, stage.id, req.user.id], client)
        await audit(client, { entityType: 'deal', entityId: before.id, action: 'stage_change', actorId: req.user.id, changes: { pipeline: { from: before.pipeline_id, to: body.pipeline_id }, stage: { from: before.stage_name, to: stage.name } }, summary: `Moved to another pipeline (${stage.name})` })
      }
      // Plain field update first; a stage change (below) then owns closed_at / lost_reason.
      const after = (await one<Deal>(
        `UPDATE deals SET title = $2, amount = $3, currency = $4, company_id = $5, contact_id = $6, owner_id = $7,
           expected_close_date = $8, lost_reason = $9, description = $10
         WHERE id = $1 RETURNING *`,
        [before.id, next.title, next.amount, next.currency, next.company_id, next.contact_id, next.owner_id, next.expected_close_date, next.lost_reason, next.description],
        client,
      ))!
      const pick = (d: Deal) => ({ title: d.title, amount: d.amount, currency: d.currency, company_id: d.company_id, contact_id: d.contact_id, owner_id: d.owner_id, expected_close_date: d.expected_close_date, description: d.description, lost_reason: d.lost_reason })
      const fieldChanges = diff(pick(before), pick(after))
      const stageChanging = !(body.pipeline_id && body.pipeline_id !== before.pipeline_id) && !!body.stage_id && body.stage_id !== before.stage_id
      if (stageChanging) delete fieldChanges.lost_reason // recorded with the stage change below
      if (Object.keys(fieldChanges).length) {
        await audit(client, { entityType: 'deal', entityId: after.id, action: 'update', actorId: req.user.id, changes: fieldChanges, summary: `Updated ${Object.keys(fieldChanges).join(', ')}` })
      }
      if (stageChanging) {
        const current = (await loadDeal(before.id, client))!
        await moveStage(client, current, body.stage_id!, req.user.id, { lost_reason: body.lost_reason })
      }
    })
    res.json(await loadDeal(before.id))
  }),
)

/** Kanban drag/drop: move to a stage at a position. */
dealsRouter.post(
  '/:id/move',
  wrap(async (req, res) => {
    const body = parse(z.object({ stage_id: z.string().uuid(), position: z.number().optional(), lost_reason: z.string().trim().max(200).nullable().optional() }), req.body)
    const before = await loadDeal(req.params.id as string)
    if (!before) throw notFound('Deal')
    await withTransaction((client) => moveStage(client, before, body.stage_id, req.user.id, { position: body.position, lost_reason: body.lost_reason }))
    res.json(await loadDeal(before.id))
  }),
)

dealsRouter.post(
  '/:id/archive',
  wrap(async (req, res) => {
    const restore = req.query.restore === 'true'
    const d = await one<Deal>(`UPDATE deals SET archived_at = ${restore ? 'NULL' : 'now()'} WHERE id = $1 RETURNING *`, [req.params.id])
    if (!d) throw notFound('Deal')
    await withTransaction((client) =>
      audit(client, { entityType: 'deal', entityId: d.id, action: restore ? 'restore' : 'archive', actorId: req.user.id, summary: `${restore ? 'Restored' : 'Archived'} ${d.title}` }),
    )
    res.json(await loadDeal(d.id))
  }),
)

dealsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    const d = await one<Deal>('SELECT * FROM deals WHERE id = $1', [req.params.id])
    if (!d) throw notFound('Deal')
    if (req.user.role !== 'admin' && d.created_by !== req.user.id && d.owner_id !== req.user.id) throw badRequest('Only the owner or an admin can delete a deal')
    await withTransaction(async (client) => {
      await query('DELETE FROM deals WHERE id = $1', [d.id], client)
      await audit(client, { entityType: 'deal', entityId: d.id, action: 'delete', actorId: req.user.id, changes: { title: d.title, amount: d.amount }, summary: `Deleted deal ${d.title}` })
    })
    res.json({ ok: true })
  }),
)
