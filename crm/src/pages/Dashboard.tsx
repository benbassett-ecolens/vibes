import { Link } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import { compactMoney, fmtDateTime, money, pct, relative } from '../format'
import { useQuery } from '../hooks'
import { useRefData } from '../refdata'
import { ACTIVITY_ICON } from '../components/Timeline'
import { Stat, useToast } from '../components/ui'
import type { Activity, AuditEntry, Paged, ReportSummary } from '../../shared/types'

export function Dashboard() {
  const { user } = useAuth()
  const { pipelines } = useRefData()
  const toast = useToast()
  const summary = useQuery(() => api.get<ReportSummary>('/api/reports/summary'), [])
  const myTasks = useQuery(() => api.get<Paged<Activity>>(`/api/activities${qs({ status: 'open', owner_id: user?.id, sort: 'due_at', dir: 'asc', limit: 8 })}`), [user?.id])
  const overdue = useQuery(() => api.get<Paged<Activity>>(`/api/activities${qs({ status: 'overdue', owner_id: user?.id, limit: 1 })}`), [user?.id])
  const recent = useQuery(() => api.get<{ items: Array<AuditEntry & { entity_label: string | null }> }>('/api/audit?limit=12'), [])
  const s = summary.data
  const complete = async (a: Activity) => {
    try {
      await api.patch(`/api/activities/${a.id}`, { completed: true })
      toast('Done')
      myTasks.refresh()
      overdue.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const linkFor = (e: AuditEntry) => (e.entity_type === 'deal' ? `/deals/${e.entity_id}` : e.entity_type === 'contact' ? `/contacts/${e.entity_id}` : e.entity_type === 'company' ? `/companies/${e.entity_id}` : null)
  return (
    <>
      <div className="topbar"><h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user?.name.split(' ')[0]}</h1></div>
      <div className="content">
        <div className="grid c4" style={{ marginBottom: 16 }}>
          <Stat label="Open pipeline" value={compactMoney(s?.open_value)} sub={s ? `${s.open_deals} deals · ${compactMoney(s.weighted_value)} weighted` : '…'} />
          <Stat label="Won (last 6 months)" value={compactMoney(s?.won_value)} sub={s ? `${s.won_deals} deals · win rate ${pct(s.win_rate)}` : '…'} />
          <Stat label="Avg deal size" value={money(s?.avg_deal_size)} sub={s?.avg_cycle_days ? `${Math.round(s.avg_cycle_days)}-day avg cycle` : 'no closed deals yet'} />
          <Stat label="My open tasks" value={myTasks.data?.total ?? '…'} sub={overdue.data ? <span className={overdue.data.total ? 'error' : ''}>{overdue.data.total} overdue</span> : '…'} />
        </div>
        <div className="grid c2">
          <div className="card">
            <div className="card-h"><h2>My next steps</h2><Link to="/activities" className="small right">All tasks →</Link></div>
            <div className="card-b" style={{ padding: 0 }}>
              {(myTasks.data?.items ?? []).map((a) => {
                const late = a.due_at && new Date(a.due_at).getTime() < Date.now()
                return (
                  <div key={a.id} className="row" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" onChange={() => complete(a)} />
                    <span>{ACTIVITY_ICON[a.type]}</span>
                    <span className="grow truncate">{a.subject} {a.deal_id && <Link to={`/deals/${a.deal_id}`} className="muted small">· {a.deal_title}</Link>}</span>
                    <span className={`small ${late ? 'error' : 'muted'}`} title={fmtDateTime(a.due_at)}>{relative(a.due_at)}</span>
                  </div>
                )
              })}
              {myTasks.data && !myTasks.data.items.length && <div className="empty">Nothing scheduled. Add tasks from any deal.</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Pipeline by stage</h2><Link to="/reports" className="small right">Reports →</Link></div>
            <div className="card-b">
              <div className="bars">
                {(s?.by_stage ?? []).filter((r) => r.stage_kind === 'open').map((r) => {
                  const max = Math.max(1, ...(s?.by_stage ?? []).filter((x) => x.stage_kind === 'open').map((x) => x.total_amount))
                  return (
                    <div key={r.stage_id} className="bar-row">
                      <span className="truncate"><span className="color-dot" style={{ background: r.color }} />{r.stage_name}</span>
                      <div className="track"><div className="fill" style={{ width: `${(r.total_amount / max) * 100}%`, background: r.color }} /></div>
                      <span className="val">{r.deal_count} · {compactMoney(r.total_amount)}</span>
                    </div>
                  )
                })}
              </div>
              {pipelines.length > 1 && <p className="muted small" style={{ marginTop: 8 }}>Showing the default pipeline.</p>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Needs attention</h2><span className="muted small right">rotting deals</span></div>
            <div className="card-b" style={{ padding: 0 }}>
              {(s?.stale_deals ?? []).slice(0, 8).map((d) => (
                <Link key={d.id} to={`/deals/${d.id}`} className="row" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', color: 'inherit' }}>
                  <span className="grow truncate">{d.title}</span>
                  <span className="badge">{d.stage_name}</span>
                  <span className="small error">idle {relative(d.last_activity_at && d.last_activity_at > d.stage_entered_at ? d.last_activity_at : d.stage_entered_at)}</span>
                </Link>
              ))}
              {s && !s.stale_deals.length && <div className="empty">Nothing is rotting. Nice.</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Recent changes</h2><span className="muted small right">team-wide audit trail</span></div>
            <div className="card-b" style={{ padding: 0 }}>
              {(recent.data?.items ?? []).map((e) => {
                const href = linkFor(e)
                return (
                  <div key={e.id} className="row small" style={{ padding: '7px 16px', borderBottom: '1px solid var(--border)' }}>
                    <span className="grow truncate"><strong>{e.actor_name ?? 'System'}</strong> <span className="muted">{e.summary ?? e.action}</span> {href ? <Link to={href}>{e.entity_label}</Link> : e.entity_type !== 'activity' && <span>{e.entity_label}</span>}</span>
                    <span className="muted" title={fmtDateTime(e.created_at)}>{relative(e.created_at)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
