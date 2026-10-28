import { Router } from 'express'
import { one, query } from '../db.js'
import { badRequest, wrap } from '../http.js'
import { DEAL_SELECT, FLAG_SQL } from './deals.js'
import type { Deal, ReportSummary } from '../../shared/types.js'

export const reportsRouter = Router()

interface Filters {
  pipelineId: string | null
  ownerId: string | null
  from: string // ISO date
  to: string // ISO date (inclusive)
}

function readFilters(q: Record<string, unknown>): Filters {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const today = new Date()
  const defFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1)
  const toIso = (d: Date) => d.toISOString().slice(0, 10)
  const from = typeof q.from === 'string' && iso.test(q.from) ? q.from : toIso(defFrom)
  const to = typeof q.to === 'string' && iso.test(q.to) ? q.to : toIso(today)
  if (from > to) throw badRequest('from must be on or before to')
  return {
    pipelineId: typeof q.pipeline_id === 'string' && q.pipeline_id ? q.pipeline_id : null,
    ownerId: typeof q.owner_id === 'string' && q.owner_id ? q.owner_id : null,
    from,
    to,
  }
}

/** Pure helpers (unit-tested). */
export function winRate(won: number, lost: number): number | null {
  const closed = won + lost
  return closed === 0 ? null : won / closed
}

export function salesVelocityPerDay(openDeals: number, rate: number | null, avgDealSize: number | null, avgCycleDays: number | null): number | null {
  if (rate === null || avgDealSize === null || !avgCycleDays) return null
  return (openDeals * rate * avgDealSize) / avgCycleDays
}

reportsRouter.get(
  '/summary',
  wrap(async (req, res) => {
    const f = readFilters(req.query as Record<string, unknown>)
    // $1 pipeline (nullable), $2 owner (nullable), $3 from, $4 to-exclusive
    const params = [f.pipelineId, f.ownerId, f.from, f.to]
    const scopeParams = [f.pipelineId, f.ownerId] // for queries that use only $1/$2
    const scope = `d.archived_at IS NULL AND ($1::uuid IS NULL OR d.pipeline_id = $1) AND ($2::uuid IS NULL OR d.owner_id = $2)`
    const inRange = `d.closed_at >= $3::date AND d.closed_at < ($4::date + interval '1 day')`

    const open = (await one<{ n: number; value: number; weighted: number }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(d.amount), 0) AS value, COALESCE(SUM(d.amount * s.probability / 100.0), 0) AS weighted
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'open'`,
      scopeParams,
    ))!

    const closed = (await one<{ won_n: number; won_v: number; lost_n: number; lost_v: number; avg_cycle: number | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE s.kind = 'won')::int AS won_n,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won'), 0) AS won_v,
         COUNT(*) FILTER (WHERE s.kind = 'lost')::int AS lost_n,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'lost'), 0) AS lost_v,
         AVG(EXTRACT(EPOCH FROM (d.closed_at - d.created_at)) / 86400.0) FILTER (WHERE s.kind = 'won') AS avg_cycle
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind <> 'open' AND ${inRange}`,
      params,
    ))!

    const byStage = await query<ReportSummary['by_stage'][number]>(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.kind AS stage_kind, s.position, s.probability, s.color,
         COUNT(d.id)::int AS deal_count,
         COALESCE(SUM(d.amount), 0) AS total_amount,
         COALESCE(SUM(d.amount * s.probability / 100.0), 0) AS weighted_amount,
         AVG(EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 86400.0) AS avg_days_in_stage
       FROM stages s
       LEFT JOIN deals d ON d.stage_id = s.id AND d.archived_at IS NULL AND ($2::uuid IS NULL OR d.owner_id = $2)
         AND (s.kind = 'open' OR (d.closed_at >= $3::date AND d.closed_at < ($4::date + interval '1 day')))
       WHERE ($1::uuid IS NULL OR s.pipeline_id = $1)
         AND ($1::uuid IS NOT NULL OR s.pipeline_id = (SELECT id FROM pipelines ORDER BY is_default DESC, position LIMIT 1))
       GROUP BY s.id ORDER BY s.position`,
      params,
    )

    const byForecast = await query<ReportSummary['by_forecast'][number]>(
      `SELECT s.forecast_category AS category, COUNT(d.id)::int AS deal_count, COALESCE(SUM(d.amount), 0) AS total_amount
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'open'
       GROUP BY s.forecast_category ORDER BY array_position(ARRAY['commit','best_case','pipeline','closed','omitted'], s.forecast_category)`,
      scopeParams,
    )

    const wonByMonth = await query<ReportSummary['won_by_month'][number]>(
      `SELECT to_char(date_trunc('month', d.closed_at), 'YYYY-MM') AS month,
         COUNT(*) FILTER (WHERE s.kind = 'won')::int AS won_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won'), 0) AS won_amount,
         COUNT(*) FILTER (WHERE s.kind = 'lost')::int AS lost_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'lost'), 0) AS lost_amount
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind <> 'open' AND ${inRange}
       GROUP BY 1 ORDER BY 1`,
      params,
    )

    const byOwner = await query<ReportSummary['by_owner'][number]>(
      `SELECT u.id AS owner_id, u.name AS owner_name,
         COUNT(d.id) FILTER (WHERE s.kind = 'open')::int AS open_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'open'), 0) AS open_value,
         COUNT(d.id) FILTER (WHERE s.kind = 'won' AND ${inRange})::int AS won_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won' AND ${inRange}), 0) AS won_value,
         COUNT(d.id) FILTER (WHERE s.kind = 'lost' AND ${inRange})::int AS lost_count,
         (SELECT COUNT(*)::int FROM activities a WHERE a.created_by = u.id AND a.created_at >= $3::date AND a.created_at < ($4::date + interval '1 day')) AS activities
       FROM users u
       LEFT JOIN deals d ON d.owner_id = u.id AND d.archived_at IS NULL AND ($1::uuid IS NULL OR d.pipeline_id = $1)
       LEFT JOIN stages s ON s.id = d.stage_id
       WHERE u.is_active AND ($2::uuid IS NULL OR u.id = $2)
       GROUP BY u.id ORDER BY won_value DESC, open_value DESC, u.name`,
      params,
    )

    const lostReasons = await query<ReportSummary['lost_reasons'][number]>(
      `SELECT COALESCE(NULLIF(d.lost_reason, ''), 'Not recorded') AS reason, COUNT(*)::int AS deal_count, COALESCE(SUM(d.amount), 0) AS total_amount
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'lost' AND ${inRange}
       GROUP BY 1 ORDER BY deal_count DESC, total_amount DESC`,
      params,
    )

    // Funnel: of deals created in range, how many ever reached each open stage (by stage order).
    const funnel = await query<ReportSummary['funnel'][number]>(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.position,
         (SELECT COUNT(DISTINCT h.deal_id)::int FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id
          JOIN stages hs ON hs.id = h.to_stage_id
          WHERE hs.pipeline_id = s.pipeline_id AND hs.position >= s.position AND ${scope}
            AND d.created_at >= $3::date AND d.created_at < ($4::date + interval '1 day')) AS reached
       FROM stages s
       WHERE s.kind = 'open' AND s.pipeline_id = COALESCE($1::uuid, (SELECT id FROM pipelines ORDER BY is_default DESC, position LIMIT 1))
       ORDER BY s.position`,
      params,
    )

    const activityByType = await query<ReportSummary['activity_by_type'][number]>(
      `SELECT a.type, COUNT(*)::int AS count FROM activities a
       LEFT JOIN deals d ON d.id = a.deal_id
       WHERE a.created_at >= $3::date AND a.created_at < ($4::date + interval '1 day')
         AND ($2::uuid IS NULL OR a.created_by = $2)
         AND ($1::uuid IS NULL OR d.pipeline_id = $1)
       GROUP BY a.type ORDER BY count DESC`,
      params,
    )

    const byProduct = await query<ReportSummary['by_product'][number]>(
      `SELECT p.id AS product_id, p.name AS product_name, p.pricing_type,
         COUNT(DISTINCT d.id) FILTER (WHERE s.kind = 'open')::int AS open_deals,
         COALESCE(SUM(CASE WHEN s.kind = 'open' THEN
           CASE dp.pricing_type WHEN 'percent' THEN dp.basis_amount * dp.unit_price / 100 WHEN 'monthly' THEN dp.quantity * dp.unit_price * dp.term_months ELSE dp.quantity * dp.unit_price END END), 0) AS open_amount,
         COUNT(DISTINCT d.id) FILTER (WHERE s.kind = 'won' AND ${inRange})::int AS won_deals,
         COALESCE(SUM(CASE WHEN s.kind = 'won' AND ${inRange} THEN
           CASE dp.pricing_type WHEN 'percent' THEN dp.basis_amount * dp.unit_price / 100 WHEN 'monthly' THEN dp.quantity * dp.unit_price * dp.term_months ELSE dp.quantity * dp.unit_price END END), 0) AS won_amount
       FROM products p
       LEFT JOIN deal_products dp ON dp.product_id = p.id
       LEFT JOIN deals d ON d.id = dp.deal_id AND ${scope}
       LEFT JOIN stages s ON s.id = d.stage_id
       GROUP BY p.id ORDER BY p.position, p.name`,
      params,
    )

    const byDealType = await query<ReportSummary['by_deal_type'][number]>(
      `SELECT d.deal_type,
         COUNT(*) FILTER (WHERE s.kind = 'open')::int AS open_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'open'), 0) AS open_value,
         COUNT(*) FILTER (WHERE s.kind = 'won' AND ${inRange})::int AS won_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won' AND ${inRange}), 0) AS won_value
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope}
       GROUP BY d.deal_type ORDER BY array_position(ARRAY['new_business','renewal','upsell'], d.deal_type)`,
      params,
    )
    const closeOverdue = await query<Deal>(`${DEAL_SELECT} WHERE ${scope} AND ${FLAG_SQL.close_overdue} ORDER BY d.expected_close_date ASC LIMIT 50`, scopeParams)
    const activityOverdue = await query<Deal>(`${DEAL_SELECT} WHERE ${scope} AND ${FLAG_SQL.activity_overdue} ORDER BY next_activity_at ASC LIMIT 50`, scopeParams)

    const stale = await query<Deal>(
      `${DEAL_SELECT} WHERE ${scope} AND s.kind = 'open' AND s.rot_after_days IS NOT NULL
         AND COALESCE(d.last_activity_at, d.stage_entered_at) < now() - (s.rot_after_days || ' days')::interval
       ORDER BY COALESCE(d.last_activity_at, d.stage_entered_at) ASC LIMIT 50`,
      scopeParams,
    )

    const rate = winRate(closed.won_n, closed.lost_n)
    const avgDeal = closed.won_n ? closed.won_v / closed.won_n : null
    const avgCycle = closed.avg_cycle === null || Number(closed.avg_cycle) <= 0 ? null : Number(closed.avg_cycle)

    const out: ReportSummary = {
      open_deals: open.n,
      open_value: Number(open.value),
      weighted_value: Number(open.weighted),
      won_deals: closed.won_n,
      won_value: Number(closed.won_v),
      lost_deals: closed.lost_n,
      lost_value: Number(closed.lost_v),
      win_rate: rate,
      avg_deal_size: avgDeal,
      avg_cycle_days: avgCycle,
      velocity_per_day: salesVelocityPerDay(open.n, rate, avgDeal, avgCycle),
      by_stage: byStage.map((r) => ({ ...r, avg_days_in_stage: r.avg_days_in_stage === null ? null : Number(r.avg_days_in_stage) })),
      by_forecast: byForecast,
      won_by_month: wonByMonth,
      by_owner: byOwner,
      lost_reasons: lostReasons,
      funnel,
      activity_by_type: activityByType,
      by_product: byProduct,
      by_deal_type: byDealType,
      close_overdue_deals: closeOverdue,
      activity_overdue_deals: activityOverdue,
      stale_deals: stale,
    }
    res.json({ filters: f, ...out })
  }),
)
