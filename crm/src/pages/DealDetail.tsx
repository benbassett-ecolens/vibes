import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { daysBetween, fmtDate, fmtDateTime, money, relative } from '../format'
import { useQuery } from '../hooks'
import { useRefData } from '../refdata'
import { ActivityComposer } from '../components/ActivityComposer'
import { DealForm } from '../components/Forms'
import { Timeline } from '../components/Timeline'
import { Avatar, ConfirmButton, Modal, useToast } from '../components/ui'
import type { Deal, StageHistoryEntry, TimelineItem } from '../../shared/types'

export function DealDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { pipelines, lostReasons } = useRefData()
  const deal = useQuery(() => api.get<Deal>(`/api/deals/${id}`), [id])
  const timeline = useQuery(() => api.get<{ items: TimelineItem[]; stage_history: StageHistoryEntry[] }>(`/api/deals/${id}/timeline`), [id])
  const [editing, setEditing] = useState(false)
  const [lostFor, setLostFor] = useState<string | null>(null)
  const [lostReason, setLostReason] = useState('')
  const d = deal.data
  const pipeline = pipelines.find((p) => p.id === d?.pipeline_id)
  const refreshAll = () => { deal.refresh(); timeline.refresh() }

  const moveTo = async (stageId: string, lost_reason?: string) => {
    const stage = pipeline?.stages.find((s) => s.id === stageId)
    if (!stage || !d) return
    if (stage.kind === 'lost' && lost_reason === undefined) {
      setLostReason(lostReasons[0]?.label ?? '')
      setLostFor(stageId)
      return
    }
    try {
      await api.post(`/api/deals/${d.id}/move`, { stage_id: stageId, lost_reason })
      toast(`Moved to ${stage.name}`)
      refreshAll()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  const archive = async () => {
    if (!d) return
    try {
      await api.post(`/api/deals/${d.id}/archive${d.archived_at ? '?restore=true' : ''}`)
      toast(d.archived_at ? 'Restored' : 'Archived')
      refreshAll()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async () => {
    if (!d) return
    try {
      await api.delete(`/api/deals/${d.id}`)
      toast('Deal deleted')
      navigate('/deals')
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  if (deal.error) return <div className="content"><div className="error-box">{deal.error}</div></div>
  if (!d) return <div className="content muted">Loading…</div>
  const stageIdx = pipeline?.stages.findIndex((s) => s.id === d.stage_id) ?? -1
  const history = timeline.data?.stage_history ?? []
  const timeInStages = history.reduce<Record<string, number>>((acc, h) => {
    const ms = (h.exited_at ? new Date(h.exited_at).getTime() : Date.now()) - new Date(h.entered_at).getTime()
    acc[h.to_stage_name ?? h.to_stage_id] = (acc[h.to_stage_name ?? h.to_stage_id] ?? 0) + ms
    return acc
  }, {})

  return (
    <>
      <div className="topbar">
        <div className="grow">
          <div className="small muted"><Link to="/deals">Deals</Link> / {pipeline?.name}</div>
          <h1 className="row">{d.title} {d.archived_at && <span className="badge warn">archived</span>}</h1>
        </div>
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <ConfirmButton className="btn" label={d.archived_at ? 'Restore' : 'Archive'} onConfirm={archive} />
        <ConfirmButton label="Delete" confirmLabel="Really delete?" onConfirm={remove} className="btn danger" />
      </div>
      <div className="content">
        {/* Stage path (Salesforce-style) */}
        <div className="card pad" style={{ marginBottom: 16 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {pipeline?.stages.map((s, i) => {
              const active = s.id === d.stage_id
              const past = d.stage_kind === 'open' && i < stageIdx
              return (
                <button
                  key={s.id}
                  className="btn sm"
                  onClick={() => !active && moveTo(s.id)}
                  style={{
                    background: active ? s.color : past ? `${s.color}33` : undefined,
                    borderColor: active || past ? s.color : undefined,
                    color: active ? '#fff' : undefined,
                    fontWeight: active ? 600 : 500,
                  }}
                  title={`${s.probability}% · ${s.forecast_category.replace('_', ' ')}`}
                >
                  {s.kind === 'won' ? '✓ ' : s.kind === 'lost' ? '✕ ' : ''}{s.name}
                </button>
              )
            })}
            <span className="muted small right">
              In <strong>{d.stage_name}</strong> for {daysBetween(d.stage_entered_at)}d (since {fmtDateTime(d.stage_entered_at)})
              {d.closed_at && <> · closed {fmtDateTime(d.closed_at)}</>}
            </span>
          </div>
        </div>

        <div className="detail-layout">
          <div className="grid" style={{ gap: 16 }}>
            <ActivityComposer dealId={d.id} contactId={d.contact_id ?? undefined} companyId={d.company_id ?? undefined} onCreated={refreshAll} />
            <div className="card">
              <div className="card-h"><h2>Timeline</h2><span className="muted small right">Every change, stamped</span></div>
              <div className="card-b" style={{ paddingTop: 4 }}>
                {timeline.data ? <Timeline items={timeline.data.items} onChanged={refreshAll} /> : <div className="muted">Loading…</div>}
              </div>
            </div>
          </div>
          <div className="grid" style={{ gap: 16 }}>
            <div className="card">
              <div className="card-h"><h2>Details</h2></div>
              <div className="card-b">
                <dl className="kv">
                  <dt>Amount</dt><dd><strong>{money(d.amount, d.currency)}</strong> <span className="muted small">· {money(d.weighted_amount, d.currency)} weighted at {d.probability}%</span></dd>
                  <dt>Company</dt><dd>{d.company_id ? <Link to={`/companies/${d.company_id}`}>{d.company_name}</Link> : '—'}</dd>
                  <dt>Contact</dt><dd>{d.contact_id ? <Link to={`/contacts/${d.contact_id}`}>{d.contact_name}</Link> : '—'}</dd>
                  <dt>Owner</dt><dd className="row"><Avatar name={d.owner_name} /> {d.owner_name ?? 'Unassigned'}</dd>
                  <dt>Expected close</dt><dd>{fmtDate(d.expected_close_date)}{d.expected_close_date && d.stage_kind === 'open' && <span className="muted small"> ({relative(d.expected_close_date)})</span>}</dd>
                  {d.lost_reason && <><dt>Lost reason</dt><dd>{d.lost_reason}</dd></>}
                  <dt>Next activity</dt><dd>{d.next_activity_at ? <span className={(d.overdue_task_count ?? 0) > 0 ? 'error' : ''}>{fmtDateTime(d.next_activity_at)}</span> : <span className="muted">none scheduled</span>}</dd>
                  <dt>Last activity</dt><dd>{d.last_activity_at ? fmtDateTime(d.last_activity_at) : <span className="muted">never</span>}</dd>
                  <dt>Created</dt><dd>{fmtDateTime(d.created_at)}</dd>
                  <dt>Updated</dt><dd>{fmtDateTime(d.updated_at)}</dd>
                </dl>
                {d.description && <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }} className="small">{d.description}</p>}
              </div>
            </div>
            <div className="card">
              <div className="card-h"><h2>Time in stage</h2></div>
              <div className="card-b">
                <dl className="kv">
                  {Object.entries(timeInStages).map(([name, ms]) => (
                    <><dt key={`t${name}`}>{name}</dt><dd key={`d${name}`}>{Math.round(ms / 86400e3)}d</dd></>
                  ))}
                  {!history.length && <dd className="muted">No stage history.</dd>}
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
      {editing && <DealForm initial={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refreshAll() }} />}
      {lostFor && (
        <Modal title="Why was this deal lost?" onClose={() => setLostFor(null)} width={420}>
          <select className="select" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
            {lostReasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
          </select>
          <input className="input" style={{ marginTop: 8 }} placeholder="Or type a reason" onChange={(e) => setLostReason(e.target.value)} />
          <div className="form-actions">
            <button className="btn" onClick={() => setLostFor(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { const s = lostFor; setLostFor(null); moveTo(s, lostReason || 'Other') }}>Mark lost</button>
          </div>
        </Modal>
      )}
    </>
  )
}
