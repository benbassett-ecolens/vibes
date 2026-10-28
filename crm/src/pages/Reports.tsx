import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, qs } from '../api'
import { compactMoney, money, pct, relative } from '../format'
import { useQuery } from '../hooks'
import { useRefData } from '../refdata'
import { OwnerSelect } from '../components/Pickers'
import { Stat } from '../components/ui'
import type { ReportSummary } from '../../shared/types'
import { DEAL_TYPE_LABEL } from '../../shared/pricing'
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

export function ReportsPage() {
  const { pipelines } = useRefData()
  const [pipelineId, setPipelineId] = useState('')
  const [owner, setOwner] = useState<string | null>(null)
  const [from, setFrom] = useState(isoDaysAgo(180))
  const [to, setTo] = useState(isoDaysAgo(0))
  const { data: s, error, loading } = useQuery(() => api.get<ReportSummary>(`/api/reports/summary${qs({ pipeline_id: pipelineId, owner_id: owner, from, to })}`), [pipelineId, owner, from, to])
  const preset = (days: number) => { setFrom(isoDaysAgo(days)); setTo(isoDaysAgo(0)) }
  const tipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }

  return (
    <>
      <div className="topbar"><h1>Reports</h1></div>
      <div className="content viz-root">
        <div className="toolbar">
          <select className="select" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Default pipeline</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <OwnerSelect value={owner} onChange={setOwner} allowAll />
          <label className="row small muted">From <input className="input sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} /></label>
          <label className="row small muted">To <input className="input sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} /></label>
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
        {error && <div className="error-box">{error}</div>}
        {!s && loading && <div className="muted">Loading…</div>}
        {s && (
          <>
            <p className="muted small" style={{ marginBottom: 12 }}>Open-pipeline figures are as of now. Won/lost, win rate, cycle time and activity counts cover deals closed between {from} and {to}.</p>
            <div className="grid c4" style={{ marginBottom: 16 }}>
              <Stat label="Open pipeline" value={compactMoney(s.open_value)} sub={`${s.open_deals} deals · ${compactMoney(s.weighted_value)} weighted`} />
              <Stat label="Won" value={compactMoney(s.won_value)} sub={`${s.won_deals} deals · lost ${s.lost_deals} (${compactMoney(s.lost_value)})`} />
              <Stat label="Win rate" value={pct(s.win_rate)} sub={s.avg_deal_size ? `avg won deal ${money(s.avg_deal_size)}` : 'no closed deals in range'} />
              <Stat label="Sales velocity" value={s.velocity_per_day ? `${compactMoney(s.velocity_per_day)}/day` : '—'} sub={s.avg_cycle_days ? `${Math.round(s.avg_cycle_days)}-day avg cycle (create → close)` : 'needs won deals'} />
            </div>

            <div className="grid c2" style={{ marginBottom: 16 }}>
              <div className="card pad">
                <div className="chart-title">Pipeline by stage</div>
                <div className="chart-sub">Open value per stage; weighted = value × stage probability</div>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={s.by_stage.filter((r) => r.stage_kind === 'open')} margin={{ top: 8, right: 8, left: 8, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="stage_name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => compactMoney(v)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
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
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => compactMoney(v)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
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
