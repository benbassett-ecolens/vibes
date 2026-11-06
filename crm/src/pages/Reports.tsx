import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, qs } from '../api'
import { compactMoney, money, pct, relative } from '../format'
import { useQuery } from '../hooks'
import { useRefData } from '../refdata'
import { OwnerSelect } from '../components/Pickers'
import { Stat } from '../components/ui'
import type { CycleSplitRow, Product, ReportBasis, ReportSummary } from '../../shared/types'
import { DEAL_TYPES, DEAL_TYPE_LABEL } from '../../shared/pricing'
import { fmtDate } from '../format'

const SERIES = { won: '#1baf7a', lost: '#e34948', s1: '#2a78d6' }
const FORECAST_LABEL: Record<string, string> = { commit: 'Commit', best_case: 'Best case', pipeline: 'Pipeline', closed: 'Closed', omitted: 'Omitted' }

function monthLabel(m: string): string {
  const [y, mo] = m.split('-')
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const BASIS_LABEL: Record<ReportBasis, string> = { closed: 'Closed in range', created: 'Created in range', expected: 'Expected to close in range' }
const days = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${Math.round(n)}d`)

function CycleSplit({ rows }: { rows: CycleSplitRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.won_median_days ?? 0))
  return (
    <table className="table">
      <thead><tr><th></th><th className="num">Won</th><th className="num">Median</th><th className="num">Avg</th><th className="num">Lost</th><th className="num">Lost median</th><th style={{ width: '30%' }}></th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>{r.label}</td><td className="num">{r.won_n}</td><td className="num">{days(r.won_median_days)}</td><td className="num">{days(r.won_avg_days)}</td><td className="num">{r.lost_n}</td><td className="num">{days(r.lost_median_days)}</td>
            <td><div className="track"><div className="fill" style={{ width: `${((r.won_median_days ?? 0) / max) * 100}%`, background: SERIES.won }} /></div></td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={7} className="empty">No closed deals with a measurable cycle in range.</td></tr>}
      </tbody>
    </table>
  )
}

export function ReportsPage() {
  const { pipelines } = useRefData()
  const [params, setParams] = useSearchParams()
  const get = (k: string, d = '') => params.get(k) ?? d
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const pipelineId = get('pipeline')
  const owner = get('owner') || null
  const from = get('from', isoDaysAgo(180))
  const to = get('to', isoDaysAgo(0))
  const basis = (['closed', 'created', 'expected'].includes(get('basis')) ? get('basis') : 'closed') as ReportBasis
  const dealType = get('type')
  const leadSource = get('source')
  const productId = get('product')
  const ecosystem = get('ecosystem')
  const partnerType = get('partner')
  const stageId = get('stage')
  const extraFilters = [dealType, leadSource, productId, ecosystem, partnerType, stageId].filter(Boolean).length
  const products = useQuery(() => api.get<{ items: Product[] }>('/api/products?all=true'), [])
  const ecosystems = useQuery(() => api.get<{ items: Array<{ value: string; n: number }> }>('/api/companies/ecosystems'), [])
  const sources = useQuery(() => api.get<{ items: Array<{ value: string; n: number }> }>('/api/deals/lead-sources'), [])
  const stages = useMemo(() => (pipelines.find((p) => p.id === pipelineId) ?? pipelines.find((p) => p.is_default) ?? pipelines[0])?.stages ?? [], [pipelines, pipelineId])
  const [cycleSplit, setCycleSplit] = useState<keyof ReportSummary['cycle']['by']>('deal_type')
  const url = `/api/reports/summary${qs({ pipeline_id: pipelineId, owner_id: owner, from, to, basis, deal_type: dealType, lead_source: leadSource, product_id: productId, ecosystem, partner_type: partnerType, stage_id: stageId })}`
  const { data: s, error, loading } = useQuery(() => api.get<ReportSummary>(url), [url])
  const preset = (days: number) => {
    const next = new URLSearchParams(params)
    next.set('from', isoDaysAgo(days))
    next.set('to', isoDaysAgo(0))
    setParams(next, { replace: true })
  }
  const tipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }

  return (
    <>
      <div className="topbar"><h1>Reports</h1></div>
      <div className="content viz-root">
        <div className="toolbar">
          <select className="select" value={pipelineId} onChange={(e) => { setParam('pipeline', e.target.value); setParam('stage', null) }}>
            <option value="">Default pipeline</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <OwnerSelect value={owner} onChange={(id) => setParam('owner', id)} allowAll />
          <div className="seg" title="Which date puts a deal in the range">
            {(['closed', 'created', 'expected'] as ReportBasis[]).map((b) => <button key={b} className={basis === b ? 'active' : ''} onClick={() => setParam('basis', b === 'closed' ? null : b)}>{b === 'closed' ? 'Closed' : b === 'created' ? 'Created' : 'Expected close'}</button>)}
          </div>
          <label className="row small muted">From <input className="input sm" type="date" value={from} onChange={(e) => setParam('from', e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row small muted">To <input className="input sm" type="date" value={to} onChange={(e) => setParam('to', e.target.value)} style={{ width: 'auto' }} /></label>
          <div className="seg">
            <button onClick={() => preset(30)}>30d</button>
            <button onClick={() => preset(90)}>90d</button>
            <button onClick={() => preset(180)}>6mo</button>
            <button onClick={() => preset(365)}>1y</button>
          </div>
          <div className="right row">
            <a className="btn sm" href="/api/export/deals.csv" download>⤓ Deals CSV</a>
            <a className="btn sm" href="/api/export/stage_history.csv" download>⤓ Stage history CSV</a>
            <a className="btn sm" href="/api/export/audit_log.csv" download>⤓ Audit CSV</a>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: -6 }}>
          <select className="select" value={dealType} onChange={(e) => setParam('type', e.target.value)} title="Deal type">
            <option value="">All deal types</option>
            {DEAL_TYPES.map((t) => <option key={t} value={t}>{DEAL_TYPE_LABEL[t]}</option>)}
          </select>
          <select className="select" value={leadSource} onChange={(e) => setParam('source', e.target.value)} title="Lead source">
            <option value="">Any lead source</option>
            {(sources.data?.items ?? []).map((x) => <option key={x.value} value={x.value}>{x.value} ({x.n})</option>)}
          </select>
          <select className="select" value={productId} onChange={(e) => setParam('product', e.target.value)} title="Deals carrying this product">
            <option value="">Any product</option>
            {(products.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="select" value={ecosystem} onChange={(e) => setParam('ecosystem', e.target.value)} title="Company ecosystem">
            <option value="">Any ecosystem</option>
            {(ecosystems.data?.items ?? []).map((x) => <option key={x.value} value={x.value}>{x.value} ({x.n})</option>)}
          </select>
          <select className="select" value={partnerType} onChange={(e) => setParam('partner', e.target.value)} title="Partner type">
            <option value="">Any partner type</option>
            {['ISV', 'VAR', 'ISV, VAR', 'Other'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select className="select" value={stageId} onChange={(e) => setParam('stage', e.target.value)} title="Current stage">
            <option value="">Any stage</option>
            {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
          {extraFilters > 0 && <button className="btn sm ghost" onClick={() => { const next = new URLSearchParams(params); for (const k of ['type', 'source', 'product', 'ecosystem', 'partner', 'stage']) next.delete(k); setParams(next, { replace: true }) }}>Clear filters ({extraFilters})</button>}
        </div>
        {error && <div className="error-box">{error}</div>}
        {!s && loading && <div className="muted">Loading…</div>}
        {s && (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>
              {basis === 'expected'
                ? <>Everything below covers deals <strong>expected to close</strong> between {from} and {to}, open and closed: this is the forecast view.</>
                : <>Open-pipeline figures are as of now. Won/lost, win rate, cycle time and activity counts cover deals <strong>{basis === 'created' ? 'created' : 'closed'}</strong> between {from} and {to}.</>}
              {extraFilters > 0 && <> Filtered by {[dealType && DEAL_TYPE_LABEL[dealType as keyof typeof DEAL_TYPE_LABEL], leadSource, products.data?.items.find((p) => p.id === productId)?.name, ecosystem, partnerType, stages.find((x) => x.id === stageId)?.name].filter(Boolean).join(' · ')}.</>}
            </p>
            <div className="grid c4" style={{ marginBottom: 16 }}>
              <Stat label={basis === 'expected' ? 'Open in window' : 'Open pipeline'} value={compactMoney(s.open_value)} sub={`${s.open_deals} deals · ${compactMoney(s.weighted_value)} weighted`} />
              <Stat label="Won" value={compactMoney(s.won_value)} sub={`${s.won_deals} deals · lost ${s.lost_deals} (${compactMoney(s.lost_value)})`} />
              <Stat label="Win rate" value={pct(s.win_rate)} sub={s.avg_deal_size ? `avg won deal ${money(s.avg_deal_size)}` : 'no closed deals in range'} />
              <Stat label="Sales cycle (median)" value={s.cycle.won_median_days === null ? '—' : `${Math.round(s.cycle.won_median_days)} days`} sub={s.cycle.won_median_days === null ? 'needs won deals with a create → close span' : `avg ${days(s.cycle.won_avg_days)} · velocity ${s.velocity_per_day ? `${compactMoney(s.velocity_per_day)}/day` : '—'}`} />
            </div>

            <div className="grid c2" style={{ marginBottom: 16 }}>
              <div className="card pad">
                <div className="chart-title">Sales cycle</div>
                <div className="chart-sub">Create → close for deals {BASIS_LABEL[basis].toLowerCase()}. Middle half of won deals: {days(s.cycle.won_p25_days)} to {days(s.cycle.won_p75_days)}. Lost deals linger a median {days(s.cycle.lost_median_days)}.</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={s.cycle.histogram} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="25%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip contentStyle={tipStyle} formatter={(v: number, name: string) => [v, name === 'won' ? 'Won' : 'Lost']} labelFormatter={(l: string) => `${l} days`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => (v === 'won' ? 'Won' : 'Lost')} />
                    <Bar dataKey="won" fill={SERIES.won} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="lost" fill={SERIES.lost} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Stage</th><th className="num">Won deals</th><th className="num">Median days (won)</th><th className="num">Lost deals</th><th className="num">Median days (lost)</th></tr></thead>
                  <tbody>
                    {s.stage_durations.map((r) => (
                      <tr key={r.stage_id}><td><span className="color-dot" style={{ background: r.color }} />{r.stage_name}</td><td className="num">{r.won_n}</td><td className="num">{days(r.won_median_days)}</td><td className="num">{r.lost_n}</td><td className="num">{days(r.lost_median_days)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ marginTop: 6 }}>Time spent in each stage by deals that closed in range. Where lost deals sit longer than won ones is where deals die.</div>
              </div>
              <div className="card pad">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div><div className="chart-title">Cycle by …</div><div className="chart-sub">Median create → close, split</div></div>
                  <div className="seg">
                    {([['deal_type', 'Deal type'], ['owner', 'Owner'], ['lead_source', 'Lead source'], ['ecosystem', 'Ecosystem']] as const).map(([k, label]) => <button key={k} className={cycleSplit === k ? 'active' : ''} onClick={() => setCycleSplit(k)}>{label}</button>)}
                  </div>
                </div>
                <div style={{ marginTop: 8 }}><CycleSplit rows={s.cycle.by[cycleSplit]} /></div>
              </div>
            </div>

            <div className="grid c2" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="card-h"><h2>Renewals</h2><span className="muted small right">open renewals by due date · outcomes {BASIS_LABEL[basis].toLowerCase()}</span></div>
                <div className="card-b">
                  <div className="grid c4" style={{ marginBottom: 12 }}>
                    {s.renewals.due.map((w) => (
                      <Stat key={w.window} label={w.window === 'overdue' ? 'Past due' : `Due in ${w.window} days`} value={compactMoney(w.total_amount)} sub={`${w.deal_count} renewal${w.deal_count === 1 ? '' : 's'}`} />
                    ))}
                  </div>
                  <div className="grid c4" style={{ marginBottom: 12 }}>
                    <Stat label="Renewal win rate" value={pct(s.renewals.win_rate)} sub={`${s.renewals.won_n} won · ${s.renewals.lost_n} lost`} />
                    <Stat label="Renewed value" value={compactMoney(s.renewals.won_value)} sub={s.renewals.prior_value ? `replaced ${compactMoney(s.renewals.prior_value)}` : 'no prior contract linked'} />
                    <Stat label="Uplift" value={s.renewals.uplift === null ? '—' : `${s.renewals.uplift >= 0 ? '+' : ''}${Math.round(s.renewals.uplift * 100)}%`} sub="renewed vs the contracts they replaced" />
                    <Stat label="Churned" value={compactMoney(s.renewals.lost_value)} sub={`${s.renewals.lost_n} lost renewal${s.renewals.lost_n === 1 ? '' : 's'}${s.renewals.unrenewed_ending_90 ? ` · ${s.renewals.unrenewed_ending_90} contract(s) end within 90d with no renewal deal yet` : ''}`} />
                  </div>
                  <table className="table">
                    <thead><tr><th>Renewal</th><th>Owner</th><th>Stage</th><th className="num">Value</th><th>Due</th></tr></thead>
                    <tbody>
                      {s.renewals.upcoming.map((d) => (
                        <tr key={d.id}><td><Link to={`/deals/${d.id}`}>{d.title}</Link></td><td>{d.owner_name ?? '—'}</td><td>{d.stage_name}</td><td className="num">{money(d.amount)}</td><td className={d.expected_close_date && d.expected_close_date < isoDaysAgo(0) ? 'error' : ''}>{fmtDate(d.expected_close_date)}</td></tr>
                      ))}
                      {!s.renewals.upcoming.length && <tr><td colSpan={5} className="empty">No open renewal deals{extraFilters || owner ? ' match the filters' : ''}.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="card">
                <div className="card-h"><h2>Lead sources</h2><span className="muted small right">created in range · open now · outcomes {BASIS_LABEL[basis].toLowerCase()}</span></div>
                <table className="table">
                  <thead><tr><th>Source</th><th className="num">Created</th><th className="num">Open</th><th className="num">Open value</th><th className="num">Won</th><th className="num">Won value</th><th className="num">Lost</th><th className="num">Win rate</th><th className="num">Median cycle</th></tr></thead>
                  <tbody>
                    {s.lead_sources.map((r) => (
                      <tr key={r.lead_source}><td>{r.lead_source}</td><td className="num">{r.created_n}</td><td className="num">{r.open_n}</td><td className="num">{money(r.open_value)}</td><td className="num">{r.won_n}</td><td className="num">{money(r.won_value)}</td><td className="num">{r.lost_n}</td><td className="num">{pct(r.win_rate)}</td><td className="num">{days(r.median_cycle_days)}</td></tr>
                    ))}
                    {!s.lead_sources.length && <tr><td colSpan={9} className="empty">No deals match.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid c2" style={{ marginBottom: 16 }}>
              <div className="card pad">
                <div className="chart-title">Pipeline by stage</div>
                <div className="chart-sub">Open value per stage; weighted = value × stage probability</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={s.by_stage.filter((r) => r.stage_kind === 'open')} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="stage_name" tick={{ fontSize: 12, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => compactMoney(v)} tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip contentStyle={tipStyle} formatter={(v: number, name: string) => [money(v), name === 'total_amount' ? 'Total' : 'Weighted']} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => (v === 'total_amount' ? 'Total' : 'Weighted')} />
                    <Bar dataKey="total_amount" fill={SERIES.s1} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    <Bar dataKey="weighted_amount" fill="#9ec5f4" radius={[4, 4, 0, 0]} maxBarSize={48} />
                  </BarChart>
                </ResponsiveContainer>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Stage</th><th className="num">Deals</th><th className="num">Value</th><th className="num">Weighted</th><th className="num">Avg days in stage</th></tr></thead>
                  <tbody>
                    {s.by_stage.map((r) => (
                      <tr key={r.stage_id}><td><span className="color-dot" style={{ background: r.color }} />{r.stage_name} <span className="muted small">{r.probability}%</span></td><td className="num">{r.deal_count}</td><td className="num">{money(r.total_amount)}</td><td className="num">{r.stage_kind === 'open' ? money(r.weighted_amount) : '—'}</td><td className="num">{r.avg_days_in_stage === null ? '—' : Math.round(r.avg_days_in_stage)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card pad">
                <div className="chart-title">Won vs lost by month</div>
                <div className="chart-sub">Closed deals by close date</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={s.won_by_month.map((m) => ({ ...m, label: monthLabel(m.month) }))} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => compactMoney(v)} tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} width={56} />
                    <Tooltip contentStyle={tipStyle} formatter={(v: number, name: string) => [money(v), name === 'won_amount' ? 'Won' : 'Lost']} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v: string) => (v === 'won_amount' ? 'Won' : 'Lost')} />
                    <Bar dataKey="won_amount" fill={SERIES.won} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar dataKey="lost_amount" fill={SERIES.lost} radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Month</th><th className="num">Won</th><th className="num">Won value</th><th className="num">Lost</th><th className="num">Lost value</th><th className="num">Win rate</th></tr></thead>
                  <tbody>
                    {s.won_by_month.map((m) => (
                      <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="num">{m.won_count}</td><td className="num">{money(m.won_amount)}</td><td className="num">{m.lost_count}</td><td className="num">{money(m.lost_amount)}</td><td className="num">{pct(m.won_count + m.lost_count ? m.won_count / (m.won_count + m.lost_count) : null)}</td></tr>
                    ))}
                    {!s.won_by_month.length && <tr><td colSpan={6} className="empty">No closed deals in range.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid c3" style={{ marginBottom: 16 }}>
              <div className="card pad">
                <div className="chart-title">Forecast categories</div>
                <div className="chart-sub">Open deals grouped by their stage's forecast category</div>
                <div className="bars">
                  {s.by_forecast.map((f) => {
                    const max = Math.max(1, ...s.by_forecast.map((x) => x.total_amount))
                    return (
                      <div key={f.category} className="bar-row">
                        <span>{FORECAST_LABEL[f.category] ?? f.category}</span>
                        <div className="track"><div className="fill" style={{ width: `${(f.total_amount / max) * 100}%`, background: SERIES.s1 }} /></div>
                        <span className="val">{f.deal_count} · {compactMoney(f.total_amount)}</span>
                      </div>
                    )
                  })}
                  {!s.by_forecast.length && <div className="muted small">No open deals.</div>}
                </div>
              </div>
              <div className="card pad">
                <div className="chart-title">Funnel</div>
                <div className="chart-sub">Of deals created in range, how many reached each stage</div>
                <div className="bars">
                  {s.funnel.map((f, i) => {
                    const first = s.funnel[0]?.reached || 1
                    const prev = i === 0 ? f.reached : s.funnel[i - 1].reached
                    return (
                      <div key={f.stage_id} className="bar-row">
                        <span className="truncate">{f.stage_name}</span>
                        <div className="track"><div className="fill" style={{ width: `${(f.reached / first) * 100}%`, background: SERIES.s1 }} /></div>
                        <span className="val">{f.reached} <span className="muted">({prev ? Math.round((f.reached / prev) * 100) : 0}%)</span></span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="card pad">
                <div className="chart-title">Lost reasons</div>
                <div className="chart-sub">Deals lost in range</div>
                <div className="bars">
                  {s.lost_reasons.map((r) => {
                    const max = Math.max(1, ...s.lost_reasons.map((x) => x.deal_count))
                    return (
                      <div key={r.reason} className="bar-row">
                        <span className="truncate">{r.reason}</span>
                        <div className="track"><div className="fill" style={{ width: `${(r.deal_count / max) * 100}%`, background: SERIES.lost }} /></div>
                        <span className="val">{r.deal_count} · {compactMoney(r.total_amount)}</span>
                      </div>
                    )
                  })}
                  {!s.lost_reasons.length && <div className="muted small">No lost deals in range.</div>}
                </div>
              </div>
            </div>

            <div className="grid c2" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="card-h"><h2>Leaderboard</h2><span className="muted small right">won in range · open now</span></div>
                <table className="table">
                  <thead><tr><th>Owner</th><th className="num">Won</th><th className="num">Won value</th><th className="num">Lost</th><th className="num">Open</th><th className="num">Open value</th><th className="num">Activities</th></tr></thead>
                  <tbody>
                    {s.by_owner.map((o) => (
                      <tr key={o.owner_id ?? 'none'}><td>{o.owner_name}</td><td className="num">{o.won_count}</td><td className="num">{money(o.won_value)}</td><td className="num">{o.lost_count}</td><td className="num">{o.open_count}</td><td className="num">{money(o.open_value)}</td><td className="num">{o.activities}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div className="card-h"><h2>Activity mix</h2><span className="muted small right">logged in range</span></div>
                <div className="card-b">
                  <div className="bars">
                    {s.activity_by_type.map((a) => {
                      const max = Math.max(1, ...s.activity_by_type.map((x) => x.count))
                      return (
                        <div key={a.type} className="bar-row">
                          <span>{a.type}</span>
                          <div className="track"><div className="fill" style={{ width: `${(a.count / max) * 100}%`, background: SERIES.s1 }} /></div>
                          <span className="val">{a.count}</span>
                        </div>
                      )
                    })}
                    {!s.activity_by_type.length && <div className="muted small">No activity in range.</div>}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid c2" style={{ marginBottom: 16 }}>
              <div className="card">
                <div className="card-h"><h2>By deal type</h2><span className="muted small right">new business vs renewal vs upsell</span></div>
                <table className="table">
                  <thead><tr><th>Type</th><th className="num">Open</th><th className="num">Open value</th><th className="num">Won</th><th className="num">Won value</th></tr></thead>
                  <tbody>
                    {s.by_deal_type.map((t) => (
                      <tr key={t.deal_type}><td>{DEAL_TYPE_LABEL[t.deal_type]}</td><td className="num">{t.open_count}</td><td className="num">{money(t.open_value)}</td><td className="num">{t.won_count}</td><td className="num">{money(t.won_value)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <div className="card-h"><h2>Overdue</h2><span className="muted small right">close dates and activities past due</span></div>
                <table className="table">
                  <thead><tr><th>Deal</th><th>Owner</th><th>Flag</th></tr></thead>
                  <tbody>
                    {s.close_overdue_deals.map((d) => (
                      <tr key={`c${d.id}`}><td><Link to={`/deals/${d.id}`}>{d.title}</Link></td><td>{d.owner_name ?? '—'}</td><td><span className="flag danger">close overdue · {fmtDate(d.expected_close_date)}</span></td></tr>
                    ))}
                    {s.activity_overdue_deals.map((d) => (
                      <tr key={`a${d.id}`}><td><Link to={`/deals/${d.id}`}>{d.title}</Link></td><td>{d.owner_name ?? '—'}</td><td><span className="flag danger">{d.overdue_task_count} overdue activit{d.overdue_task_count === 1 ? 'y' : 'ies'}</span></td></tr>
                    ))}
                    {!s.close_overdue_deals.length && !s.activity_overdue_deals.length && <tr><td colSpan={3} className="empty">Nothing overdue.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-h"><h2>Revenue by product</h2><span className="muted small right">line totals on open deals now, and on deals won in range</span></div>
              <table className="table">
                <thead><tr><th>Product</th><th>Pricing</th><th className="num">Open deals</th><th className="num">Open first-year value</th><th className="num">Won deals</th><th className="num">Won first-year value</th></tr></thead>
                <tbody>
                  {s.by_product.map((p) => (
                    <tr key={p.product_id}><td>{p.product_name}</td><td className="muted small">{p.pricing_type.replace('_', ' ')}</td><td className="num">{p.open_deals}</td><td className="num">{money(p.open_amount)}</td><td className="num">{p.won_deals}</td><td className="num">{money(p.won_amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-h"><h2>Rotting deals</h2><span className="muted small right">open deals idle past their stage limit</span></div>
              <table className="table">
                <thead><tr><th>Deal</th><th>Stage</th><th>Owner</th><th className="num">Amount</th><th>Last activity</th><th>In stage since</th></tr></thead>
                <tbody>
                  {s.stale_deals.map((d) => (
                    <tr key={d.id}><td><Link to={`/deals/${d.id}`}>{d.title}</Link></td><td>{d.stage_name}</td><td>{d.owner_name ?? '—'}</td><td className="num">{money(d.amount, d.currency)}</td><td className="error">{relative(d.last_activity_at) }</td><td>{relative(d.stage_entered_at)}</td></tr>
                  ))}
                  {!s.stale_deals.length && <tr><td colSpan={6} className="empty">Nothing is rotting.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  )
}
