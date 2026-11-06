import { Router } from 'express'
import { one, query } from '../db.js'
import { badRequest, wrap } from '../http.js'
import { DEAL_SELECT, FLAG_SQL } from './deals.js'
import type { CycleSplitRow, Deal, ReportBasis, ReportSummary } from '../../shared/types.js'
import { DEAL_TYPE_LABEL } from '../../shared/pricing.js'

export const reportsRouter = Router()

interface Filters {
  pipelineId: string | null
  ownerId: string | null
  from: string // ISO date
  to: string // ISO date (inclusive)
  basis: ReportBasis
  dealType: string | null
  leadSource: string | null
  productId: string | null
  ecosystem: string | null
  partnerType: string | null
  stageId: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null)
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)

export function readFilters(q: Record<string, unknown>, today = new Date()): Filters {
  const iso = /^\d{4}-\d{2}-\d{2}$/
  const defFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1)
  const toIso = (d: Date) => d.toISOString().slice(0, 10)
  const from = typeof q.from === 'string' && iso.test(q.from) ? q.from : toIso(defFrom)
  const to = typeof q.to === 'string' && iso.test(q.to) ? q.to : toIso(today)
  if (from > to) throw badRequest('from must be on or before to')
  const basis = q.basis === 'created' || q.basis === 'expected' ? q.basis : 'closed'
  const dealType = ['new_business', 'renewal', 'upsell'].includes(String(q.deal_type)) ? String(q.deal_type) : null
  return {
    pipelineId: uuid(q.pipeline_id),
    ownerId: uuid(q.owner_id),
    from,
    to,
    basis,
    dealType,
    leadSource: str(q.lead_source),
    productId: uuid(q.product_id),
    ecosystem: str(q.ecosystem),
    partnerType: str(q.partner_type),
    stageId: uuid(q.stage_id),
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

export function uplift(wonValue: number, priorValue: number): number | null {
  return priorValue > 0 ? wonValue / priorValue - 1 : null
}

/** The column that decides whether a deal is "in range". */
export function rangeColumn(basis: ReportBasis): string {
  return basis === 'created' ? 'd.created_at' : basis === 'expected' ? 'd.expected_close_date' : 'd.closed_at'
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const CYCLE_BUCKETS = ['0–14', '15–30', '31–60', '61–90', '91–180', '180+']

/** The previous window of the same length, ending the day before `from`. */
export function previousWindow(from: string, to: string): { from: string; to: string } {
  const a = new Date(`${from}T00:00:00Z`)
  const b = new Date(`${to}T00:00:00Z`)
  const len = Math.round((b.getTime() - a.getTime()) / 86400000) + 1
  const pTo = new Date(a.getTime() - 86400000)
  const pFrom = new Date(pTo.getTime() - (len - 1) * 86400000)
  return { from: pFrom.toISOString().slice(0, 10), to: pTo.toISOString().slice(0, 10) }
}

reportsRouter.get(
  '/summary',
  wrap(async (req, res) => {
    const f = readFilters(req.query as Record<string, unknown>)
    const out = await computeSummary(f)
    const prevF = { ...f, ...previousWindow(f.from, f.to) }
    const prev = await computeSummary(prevF, true)
    out.previous = {
      from: prevF.from,
      to: prevF.to,
      open_deals: prev.open_deals,
      open_value: prev.open_value,
      won_deals: prev.won_deals,
      won_value: prev.won_value,
      lost_deals: prev.lost_deals,
      lost_value: prev.lost_value,
      win_rate: prev.win_rate,
      avg_deal_size: prev.avg_deal_size,
      median_cycle_days: prev.cycle.won_median_days,
      created_n: prev.flow_by_month.reduce((n, m) => n + m.created_n, 0),
      renewal_win_rate: prev.renewals.win_rate,
      mrr: prev.recurring.mrr,
    }
    res.json({ filters: f, ...out })
  }),
)

/** Everything on the Reports page for one filter set. `light` skips the per-deal lists (used for the prior period). */
export async function computeSummary(f: Filters, light = false): Promise<ReportSummary> {
    // One parameter list for every query. Postgres rejects a bind with more parameters than the
    // statement references, so GUARD references all of them (planner folds it away).
    //  $1 pipeline  $2 owner  $3 from  $4 to  $5 deal_type  $6 lead_source  $7 product
    //  $8 ecosystem  $9 partner_type  $10 stage  $11 basis
    const params = [f.pipelineId, f.ownerId, f.from, f.to, f.dealType, f.leadSource, f.productId, f.ecosystem, f.partnerType, f.stageId, f.basis]
    const GUARD = `($1::uuid IS NULL OR TRUE) AND ($2::uuid IS NULL OR TRUE) AND ($3::date IS NULL OR TRUE) AND ($4::date IS NULL OR TRUE)
      AND ($5::text IS NULL OR TRUE) AND ($6::text IS NULL OR TRUE) AND ($7::uuid IS NULL OR TRUE) AND ($8::text IS NULL OR TRUE)
      AND ($9::text IS NULL OR TRUE) AND ($10::uuid IS NULL OR TRUE) AND ($11::text IS NULL OR TRUE)`
    // Deal-level filters, on alias d.
    const dealFilter = `($5::text IS NULL OR d.deal_type = $5)
      AND ($6::text IS NULL OR lower(d.lead_source) = lower($6))
      AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM deal_products dpf WHERE dpf.deal_id = d.id AND dpf.product_id = $7))
      AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM companies cf WHERE cf.id = d.company_id AND $8 = ANY (cf.ecosystems)))
      AND ($9::text IS NULL OR EXISTS (SELECT 1 FROM companies cf WHERE cf.id = d.company_id AND cf.partner_type = $9))
      AND ($10::uuid IS NULL OR d.stage_id = $10)`
    const noDealFilter = `($5::text IS NULL AND $6::text IS NULL AND $7::uuid IS NULL AND $8::text IS NULL AND $9::text IS NULL AND $10::uuid IS NULL)`
    const scope = `d.archived_at IS NULL AND ($1::uuid IS NULL OR d.pipeline_id = $1) AND ($2::uuid IS NULL OR d.owner_id = $2) AND ${dealFilter} AND ${GUARD}`
    const col = rangeColumn(f.basis)
    const inRange = `${col} >= $3::date AND ${col} < ($4::date + interval '1 day')`
    // With the "expected close" basis the open pipeline is also limited to the window (that is the forecast).
    const openScope = f.basis === 'expected' ? `${scope} AND ${inRange}` : scope
    const defaultPipeline = `(SELECT id FROM pipelines ORDER BY is_default DESC, position LIMIT 1)`

    const open = (await one<{ n: number; value: number; weighted: number }>(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(d.amount), 0) AS value, COALESCE(SUM(d.amount * s.probability / 100.0), 0) AS weighted
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${openScope} AND s.kind = 'open'`,
      params,
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
       LEFT JOIN deals d ON d.stage_id = s.id AND d.archived_at IS NULL AND ($2::uuid IS NULL OR d.owner_id = $2) AND ${dealFilter}
         AND ((s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'}) OR (s.kind <> 'open' AND ${inRange}))
       WHERE s.pipeline_id = COALESCE($1::uuid, ${defaultPipeline}) AND ${GUARD}
       GROUP BY s.id ORDER BY s.position`,
      params,
    )

    const byForecast = await query<ReportSummary['by_forecast'][number]>(
      `SELECT s.forecast_category AS category, COUNT(d.id)::int AS deal_count, COALESCE(SUM(d.amount), 0) AS total_amount
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${openScope} AND s.kind = 'open'
       GROUP BY s.forecast_category ORDER BY array_position(ARRAY['commit','best_case','pipeline','closed','omitted'], s.forecast_category)`,
      params,
    )

    const wonByMonth = await query<ReportSummary['won_by_month'][number]>(
      `SELECT to_char(date_trunc('month', ${col}), 'YYYY-MM') AS month,
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
         COUNT(d.id) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'})::int AS open_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'}), 0) AS open_value,
         COUNT(d.id) FILTER (WHERE s.kind = 'won' AND ${inRange})::int AS won_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won' AND ${inRange}), 0) AS won_value,
         COUNT(d.id) FILTER (WHERE s.kind = 'lost' AND ${inRange})::int AS lost_count,
         (SELECT COUNT(*)::int FROM activities a WHERE a.created_by = u.id AND a.created_at >= $3::date AND a.created_at < ($4::date + interval '1 day')) AS activities
       FROM users u
       LEFT JOIN deals d ON d.owner_id = u.id AND d.archived_at IS NULL AND ($1::uuid IS NULL OR d.pipeline_id = $1) AND ${dealFilter}
       LEFT JOIN stages s ON s.id = d.stage_id
       WHERE u.is_active AND ($2::uuid IS NULL OR u.id = $2) AND ${GUARD}
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
       WHERE s.kind = 'open' AND s.pipeline_id = COALESCE($1::uuid, ${defaultPipeline})
       ORDER BY s.position`,
      params,
    )

    const activityByType = await query<ReportSummary['activity_by_type'][number]>(
      `SELECT a.type, COUNT(*)::int AS count FROM activities a
       LEFT JOIN deals d ON d.id = a.deal_id
       WHERE a.created_at >= $3::date AND a.created_at < ($4::date + interval '1 day')
         AND ($2::uuid IS NULL OR a.created_by = $2)
         AND ($1::uuid IS NULL OR d.pipeline_id = $1)
         AND (${noDealFilter} OR (d.id IS NOT NULL AND ${dealFilter})) AND ${GUARD}
       GROUP BY a.type ORDER BY count DESC`,
      params,
    )

    const byProduct = await query<ReportSummary['by_product'][number]>(
      `SELECT p.id AS product_id, p.name AS product_name, p.pricing_type,
         COUNT(DISTINCT d.id) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'})::int AS open_deals,
         COALESCE(SUM(CASE WHEN s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'} THEN
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
         COUNT(*) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'})::int AS open_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'}), 0) AS open_value,
         COUNT(*) FILTER (WHERE s.kind = 'won' AND ${inRange})::int AS won_count,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won' AND ${inRange}), 0) AS won_value
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope}
       GROUP BY d.deal_type ORDER BY array_position(ARRAY['new_business','renewal','upsell'], d.deal_type)`,
      params,
    )
    const closeOverdue = light ? [] : await query<Deal>(`${DEAL_SELECT} WHERE ${scope} AND ${FLAG_SQL.close_overdue} ORDER BY d.expected_close_date ASC LIMIT 50`, params)
    const activityOverdue = light ? [] : await query<Deal>(`${DEAL_SELECT} WHERE ${scope} AND ${FLAG_SQL.activity_overdue} ORDER BY next_activity_at ASC LIMIT 50`, params)

    const stale = light ? [] : await query<Deal>(
      `${DEAL_SELECT} WHERE ${scope} AND s.kind = 'open' AND s.rot_after_days IS NOT NULL
         AND COALESCE(d.last_activity_at, d.stage_entered_at) < now() - (s.rot_after_days || ' days')::interval
       ORDER BY COALESCE(d.last_activity_at, d.stage_entered_at) ASC LIMIT 50`,
      params,
    )

    // ---- Sales cycle: created → closed, for deals closed in range (by basis). ----
    const cycleCte = `WITH c AS (
      SELECT d.id, d.deal_type, COALESCE(NULLIF(d.lead_source, ''), 'Not recorded') AS lead_source, d.owner_id, COALESCE(u.name, 'Unassigned') AS owner_name,
        co.ecosystems, s.kind, EXTRACT(EPOCH FROM (d.closed_at - d.created_at)) / 86400.0 AS days
      FROM deals d JOIN stages s ON s.id = d.stage_id LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN companies co ON co.id = d.company_id
      WHERE ${scope} AND s.kind <> 'open' AND ${inRange} AND d.closed_at IS NOT NULL AND d.closed_at > d.created_at + interval '1 minute')`
    const cycleTotals = (await one<{ won_n: number; won_med: number | null; won_avg: number | null; won_p25: number | null; won_p75: number | null; lost_n: number; lost_med: number | null }>(
      `${cycleCte} SELECT
         COUNT(*) FILTER (WHERE kind = 'won')::int AS won_n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE kind = 'won') AS won_med,
         AVG(days) FILTER (WHERE kind = 'won') AS won_avg,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY days) FILTER (WHERE kind = 'won') AS won_p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY days) FILTER (WHERE kind = 'won') AS won_p75,
         COUNT(*) FILTER (WHERE kind = 'lost')::int AS lost_n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE kind = 'lost') AS lost_med
       FROM c`,
      params,
    ))!
    const histRows = await query<{ b: number; won: number; lost: number }>(
      `${cycleCte} SELECT width_bucket(days, ARRAY[15, 31, 61, 91, 181]) AS b,
         COUNT(*) FILTER (WHERE kind = 'won')::int AS won, COUNT(*) FILTER (WHERE kind = 'lost')::int AS lost
       FROM c GROUP BY 1`,
      params,
    )
    const histogram = CYCLE_BUCKETS.map((bucket, i) => {
      const r = histRows.find((x) => Number(x.b) === i)
      return { bucket, won: r?.won ?? 0, lost: r?.lost ?? 0 }
    })
    const splitSql = (keyExpr: string, labelExpr: string, from = 'c') => `${cycleCte} SELECT ${keyExpr} AS key, ${labelExpr} AS label,
         COUNT(*) FILTER (WHERE kind = 'won')::int AS won_n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE kind = 'won') AS won_median_days,
         AVG(days) FILTER (WHERE kind = 'won') AS won_avg_days,
         COUNT(*) FILTER (WHERE kind = 'lost')::int AS lost_n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE kind = 'lost') AS lost_median_days
       FROM ${from} GROUP BY 1, 2 ORDER BY won_n DESC, lost_n DESC, 2`
    const fixSplit = (rows: CycleSplitRow[]): CycleSplitRow[] => rows.map((r) => ({ ...r, won_median_days: num(r.won_median_days), won_avg_days: num(r.won_avg_days), lost_median_days: num(r.lost_median_days) }))
    const byType = fixSplit(await query<CycleSplitRow>(splitSql('deal_type', 'deal_type'), params)).map((r) => ({ ...r, label: DEAL_TYPE_LABEL[r.key as keyof typeof DEAL_TYPE_LABEL] ?? r.key }))
    const byOwnerCycle = fixSplit(await query<CycleSplitRow>(splitSql("COALESCE(owner_id::text, '')", 'owner_name'), params))
    const bySource = fixSplit(await query<CycleSplitRow>(splitSql('lead_source', 'lead_source'), params))
    const byEco = fixSplit(await query<CycleSplitRow>(splitSql('e', 'e', `(SELECT c.*, COALESCE(x.e, 'No ecosystem') AS e FROM c LEFT JOIN LATERAL unnest(c.ecosystems) AS x(e) ON TRUE) c2`), params))

    // ---- Time in each stage, won vs lost, for deals closed in range. ----
    const stageDurations = await query<ReportSummary['stage_durations'][number]>(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.position, s.color,
         COUNT(DISTINCT h.deal_id) FILTER (WHERE ds.kind = 'won')::int AS won_n,
         AVG(h.days) FILTER (WHERE ds.kind = 'won') AS won_avg_days,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY h.days) FILTER (WHERE ds.kind = 'won') AS won_median_days,
         COUNT(DISTINCT h.deal_id) FILTER (WHERE ds.kind = 'lost')::int AS lost_n,
         AVG(h.days) FILTER (WHERE ds.kind = 'lost') AS lost_avg_days,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY h.days) FILTER (WHERE ds.kind = 'lost') AS lost_median_days
       FROM stages s
       LEFT JOIN (
         SELECT h.deal_id, h.to_stage_id, EXTRACT(EPOCH FROM (COALESCE(h.exited_at, d.closed_at, now()) - h.entered_at)) / 86400.0 AS days
         FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id JOIN stages s2 ON s2.id = d.stage_id
         WHERE ${scope} AND s2.kind <> 'open' AND ${inRange}
       ) h ON h.to_stage_id = s.id
       LEFT JOIN deals dd ON dd.id = h.deal_id
       LEFT JOIN stages ds ON ds.id = dd.stage_id
       WHERE s.kind = 'open' AND s.pipeline_id = COALESCE($1::uuid, ${defaultPipeline})
       GROUP BY s.id ORDER BY s.position`,
      params,
    )

    // ---- Renewals ----
    const due = await query<ReportSummary['renewals']['due'][number]>(
      `SELECT w.win AS window, COUNT(d.id)::int AS deal_count, COALESCE(SUM(d.amount), 0) AS total_amount
       FROM (VALUES ('overdue', -100000, -1), ('30', 0, 30), ('60', 0, 60), ('90', 0, 90)) AS w(win, lo, hi)
       LEFT JOIN deals d ON d.deal_type = 'renewal' AND d.expected_close_date IS NOT NULL
         AND d.expected_close_date - current_date BETWEEN w.lo AND w.hi AND ${scope}
         AND EXISTS (SELECT 1 FROM stages s WHERE s.id = d.stage_id AND s.kind = 'open')
       GROUP BY w.win, w.hi ORDER BY w.hi`,
      params,
    )
    const renewalClosed = (await one<{ won_n: number; won_v: number; lost_n: number; lost_v: number; prior_v: number }>(
      `SELECT COUNT(*) FILTER (WHERE s.kind = 'won')::int AS won_n,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won'), 0) AS won_v,
         COUNT(*) FILTER (WHERE s.kind = 'lost')::int AS lost_n,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'lost'), 0) AS lost_v,
         COALESCE(SUM(p.amount) FILTER (WHERE s.kind = 'won' AND p.id IS NOT NULL), 0) AS prior_v
       FROM deals d JOIN stages s ON s.id = d.stage_id LEFT JOIN deals p ON p.id = d.renewal_of_deal_id
       WHERE ${scope} AND d.deal_type = 'renewal' AND s.kind <> 'open' AND ${inRange}`,
      params,
    ))!
    const unrenewed = (await one<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM deals d JOIN stages s ON s.id = d.stage_id
       WHERE ${scope} AND s.kind = 'won' AND d.renewal_created_at IS NULL AND d.contract_months IS NOT NULL AND d.contract_start_date IS NOT NULL
         AND (d.contract_start_date + (d.contract_months || ' months')::interval)::date BETWEEN current_date AND current_date + 90`,
      params,
    ))!
    const upcoming = light ? [] : await query<Deal>(
      `${DEAL_SELECT} WHERE ${scope} AND d.deal_type = 'renewal' AND s.kind = 'open' ORDER BY d.expected_close_date ASC NULLS LAST LIMIT 25`,
      params,
    )

    // ---- Stage conversion: of deals created in range that entered each open stage, what happened next. ----
    const conversion = await query<ReportSummary['conversion'][number]>(
      `WITH dd AS (
         SELECT d.id, s.kind AS final_kind, d.stage_id AS final_stage FROM deals d JOIN stages s ON s.id = d.stage_id
         WHERE ${scope} AND d.created_at >= $3::date AND d.created_at < ($4::date + interval '1 day')
       ), entered AS (
         SELECT DISTINCT h.deal_id, h.to_stage_id AS stage_id FROM deal_stage_history h JOIN dd ON dd.id = h.deal_id
       )
       SELECT s.id AS stage_id, s.name AS stage_name, s.position, s.color,
         COUNT(e.deal_id)::int AS entered,
         COUNT(e.deal_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM deal_stage_history h2 JOIN stages s2 ON s2.id = h2.to_stage_id
           WHERE h2.deal_id = e.deal_id AND s2.pipeline_id = s.pipeline_id AND ((s2.kind = 'open' AND s2.position > s.position) OR s2.kind = 'won')
             AND h2.entered_at > (SELECT MIN(h3.entered_at) FROM deal_stage_history h3 WHERE h3.deal_id = e.deal_id AND h3.to_stage_id = s.id)))::int AS advanced,
         COUNT(e.deal_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM deal_stage_history h2 JOIN stages s2 ON s2.id = h2.to_stage_id
           WHERE h2.deal_id = e.deal_id AND h2.from_stage_id = s.id AND s2.kind = 'won'))::int AS won_direct,
         COUNT(e.deal_id) FILTER (WHERE EXISTS (
           SELECT 1 FROM deal_stage_history h2 JOIN stages s2 ON s2.id = h2.to_stage_id
           WHERE h2.deal_id = e.deal_id AND h2.from_stage_id = s.id AND s2.kind = 'lost'))::int AS lost_here,
         COUNT(e.deal_id) FILTER (WHERE dd.final_stage = s.id)::int AS still_here
       FROM stages s
       LEFT JOIN entered e ON e.stage_id = s.id
       LEFT JOIN dd ON dd.id = e.deal_id
       WHERE s.kind = 'open' AND s.pipeline_id = COALESCE($1::uuid, ${defaultPipeline}) AND ${GUARD}
       GROUP BY s.id ORDER BY s.position`,
      params,
    )
    const moves = (await one<{ forward: number; backward: number; skipped: number }>(
      `SELECT COUNT(*) FILTER (WHERE t.position > fr.position)::int AS forward,
         COUNT(*) FILTER (WHERE t.position < fr.position AND t.kind = 'open')::int AS backward,
         COUNT(*) FILTER (WHERE t.kind = 'open' AND fr.kind = 'open' AND t.position > fr.position + 1)::int AS skipped
       FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id
       JOIN stages t ON t.id = h.to_stage_id LEFT JOIN stages fr ON fr.id = h.from_stage_id
       WHERE ${scope} AND h.from_stage_id IS NOT NULL AND h.entered_at >= $3::date AND h.entered_at < ($4::date + interval '1 day')`,
      params,
    ))!

    // ---- Pipeline flow: created vs closed per month, over the range (each event on its own date). ----
    const flow = await query<ReportSummary['flow_by_month'][number]>(
      `WITH months AS (SELECT generate_series(date_trunc('month', $3::date), date_trunc('month', $4::date), interval '1 month') AS m)
       SELECT to_char(m.m, 'YYYY-MM') AS month,
         (SELECT COUNT(*)::int FROM deals d WHERE ${scope} AND date_trunc('month', d.created_at) = m.m) AS created_n,
         (SELECT COALESCE(SUM(d.amount), 0) FROM deals d WHERE ${scope} AND date_trunc('month', d.created_at) = m.m) AS created_value,
         (SELECT COUNT(*)::int FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'won' AND date_trunc('month', d.closed_at) = m.m) AS won_n,
         (SELECT COALESCE(SUM(d.amount), 0) FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'won' AND date_trunc('month', d.closed_at) = m.m) AS won_value,
         (SELECT COUNT(*)::int FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'lost' AND date_trunc('month', d.closed_at) = m.m) AS lost_n,
         (SELECT COALESCE(SUM(d.amount), 0) FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'lost' AND date_trunc('month', d.closed_at) = m.m) AS lost_value
       FROM months m ORDER BY 1`,
      params,
    )

    // ---- Slippage: expected close dates pushed out (from the audit log), in range. ----
    const slipCte = `WITH p AS (
      SELECT l.entity_id AS deal_id,
        (l.changes->'expected_close_date'->>'to')::date - (l.changes->'expected_close_date'->>'from')::date AS delta
      FROM audit_log l JOIN deals d ON d.id = l.entity_id
      WHERE l.entity_type = 'deal' AND l.changes ? 'expected_close_date'
        AND (l.changes->'expected_close_date'->>'from') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND (l.changes->'expected_close_date'->>'to') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND l.created_at >= $3::date AND l.created_at < ($4::date + interval '1 day') AND ${scope})`
    const slipTotals = (await one<{ deals_pushed: number; pushes: number; avg_days: number | null; pulled_in: number }>(
      `${slipCte} SELECT COUNT(DISTINCT deal_id) FILTER (WHERE delta > 0)::int AS deals_pushed, COUNT(*) FILTER (WHERE delta > 0)::int AS pushes,
         AVG(delta) FILTER (WHERE delta > 0) AS avg_days, COUNT(*) FILTER (WHERE delta < 0)::int AS pulled_in FROM p`,
      params,
    ))!
    const offenders = light ? [] : await query<ReportSummary['slippage']['offenders'][number]>(
      `${slipCte} SELECT p.deal_id, d.title, u.name AS owner_name, COUNT(*)::int AS pushes, SUM(p.delta)::int AS days_pushed, d.expected_close_date, s.name AS stage_name
       FROM p JOIN deals d ON d.id = p.deal_id LEFT JOIN users u ON u.id = d.owner_id LEFT JOIN stages s ON s.id = d.stage_id
       WHERE p.delta > 0 GROUP BY p.deal_id, d.title, u.name, d.expected_close_date, s.name ORDER BY pushes DESC, days_pushed DESC LIMIT 15`,
      params,
    )

    // ---- Recurring revenue from monthly product lines. ----
    const monthlyLine = `CASE WHEN dp.pricing_type = 'monthly' THEN dp.quantity * dp.unit_price ELSE 0 END`
    const contractValue = `CASE dp.pricing_type WHEN 'monthly' THEN dp.quantity * dp.unit_price * COALESCE(d.contract_months, 12) WHEN 'percent' THEN dp.basis_amount * dp.unit_price / 100 ELSE dp.quantity * dp.unit_price END`
    const running = `s.kind = 'won' AND d.contract_start_date IS NOT NULL AND d.contract_months IS NOT NULL
      AND d.contract_start_date <= current_date AND (d.contract_start_date + (d.contract_months || ' months')::interval)::date > current_date`
    const recurring = (await one<{ active: number; mrr: number; pipeline_mrr: number; won_cv: number; won_fy: number; ending_n: number; ending_mrr: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND ${running}) AS active,
         (SELECT COALESCE(SUM(${monthlyLine}), 0) FROM deals d JOIN stages s ON s.id = d.stage_id JOIN deal_products dp ON dp.deal_id = d.id WHERE ${scope} AND ${running}) AS mrr,
         (SELECT COALESCE(SUM(${monthlyLine}), 0) FROM deals d JOIN stages s ON s.id = d.stage_id JOIN deal_products dp ON dp.deal_id = d.id WHERE ${openScope} AND s.kind = 'open') AS pipeline_mrr,
         (SELECT COALESCE(SUM(${contractValue}), 0) FROM deals d JOIN stages s ON s.id = d.stage_id JOIN deal_products dp ON dp.deal_id = d.id WHERE ${scope} AND s.kind = 'won' AND ${inRange}) AS won_cv,
         (SELECT COALESCE(SUM(d.amount), 0) FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND s.kind = 'won' AND ${inRange}) AS won_fy,
         (SELECT COUNT(*)::int FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope} AND ${running}
            AND (d.contract_start_date + (d.contract_months || ' months')::interval)::date <= current_date + 90) AS ending_n,
         (SELECT COALESCE(SUM(${monthlyLine}), 0) FROM deals d JOIN stages s ON s.id = d.stage_id JOIN deal_products dp ON dp.deal_id = d.id WHERE ${scope} AND ${running}
            AND (d.contract_start_date + (d.contract_months || ' months')::interval)::date <= current_date + 90) AS ending_mrr`,
      params,
    ))!

    // ---- Lead sources ----
    const leadSources = await query<ReportSummary['lead_sources'][number]>(
      `SELECT COALESCE(NULLIF(d.lead_source, ''), 'Not recorded') AS lead_source,
         COUNT(*) FILTER (WHERE d.created_at >= $3::date AND d.created_at < ($4::date + interval '1 day'))::int AS created_n,
         COUNT(*) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'})::int AS open_n,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'open' AND ${f.basis === 'expected' ? inRange : 'TRUE'}), 0) AS open_value,
         COUNT(*) FILTER (WHERE s.kind = 'won' AND ${inRange})::int AS won_n,
         COALESCE(SUM(d.amount) FILTER (WHERE s.kind = 'won' AND ${inRange}), 0) AS won_value,
         COUNT(*) FILTER (WHERE s.kind = 'lost' AND ${inRange})::int AS lost_n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.closed_at - d.created_at)) / 86400.0) FILTER (WHERE s.kind = 'won' AND ${inRange}) AS median_cycle_days
       FROM deals d JOIN stages s ON s.id = d.stage_id WHERE ${scope}
       GROUP BY 1 ORDER BY won_value DESC, created_n DESC, 1`,
      params,
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
      cycle: {
        won_n: cycleTotals.won_n,
        won_median_days: num(cycleTotals.won_med),
        won_avg_days: num(cycleTotals.won_avg),
        won_p25_days: num(cycleTotals.won_p25),
        won_p75_days: num(cycleTotals.won_p75),
        lost_n: cycleTotals.lost_n,
        lost_median_days: num(cycleTotals.lost_med),
        histogram,
        by: { deal_type: byType, owner: byOwnerCycle, lead_source: bySource, ecosystem: byEco },
      },
      stage_durations: stageDurations.map((r) => ({ ...r, won_avg_days: num(r.won_avg_days), won_median_days: num(r.won_median_days), lost_avg_days: num(r.lost_avg_days), lost_median_days: num(r.lost_median_days) })),
      renewals: {
        due: due.map((r) => ({ ...r, total_amount: Number(r.total_amount) })),
        won_n: renewalClosed.won_n,
        won_value: Number(renewalClosed.won_v),
        lost_n: renewalClosed.lost_n,
        lost_value: Number(renewalClosed.lost_v),
        win_rate: winRate(renewalClosed.won_n, renewalClosed.lost_n),
        prior_value: Number(renewalClosed.prior_v),
        uplift: uplift(Number(renewalClosed.won_v), Number(renewalClosed.prior_v)),
        unrenewed_ending_90: unrenewed.n,
        upcoming,
      },
      lead_sources: leadSources.map((r) => ({ ...r, open_value: Number(r.open_value), won_value: Number(r.won_value), win_rate: winRate(r.won_n, r.lost_n), median_cycle_days: num(r.median_cycle_days) })),
      conversion: conversion.map((r) => ({ ...r, conversion_rate: r.entered - r.still_here > 0 ? r.advanced / (r.entered - r.still_here) : null })),
      moves,
      flow_by_month: flow.map((m) => ({ ...m, created_value: Number(m.created_value), won_value: Number(m.won_value), lost_value: Number(m.lost_value) })),
      slippage: { deals_pushed: slipTotals.deals_pushed, pushes: slipTotals.pushes, avg_days_pushed: num(slipTotals.avg_days), pulled_in: slipTotals.pulled_in, offenders },
      recurring: {
        active_contracts: recurring.active,
        mrr: Number(recurring.mrr),
        arr: Number(recurring.mrr) * 12,
        pipeline_mrr: Number(recurring.pipeline_mrr),
        won_contract_value: Number(recurring.won_cv),
        won_first_year_value: Number(recurring.won_fy),
        ending_90: { deal_count: recurring.ending_n, mrr: Number(recurring.ending_mrr) },
      },
      previous: null,
    }
    return out
}
