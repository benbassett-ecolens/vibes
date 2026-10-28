import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import { compactMoney, daysBetween, fmtDate, isRotting, money, relative } from '../format'
import { useDebounced, useLocalStorage, useQuery } from '../hooks'
import { useRefData } from '../refdata'
import { DealForm } from '../components/Forms'
import { OwnerSelect } from '../components/Pickers'
import { Avatar, Modal, Pager, SortableTable, useSort, useToast, type Column } from '../components/ui'
import type { Deal, DealFlag, Paged, Stage } from '../../shared/types'
import { DEAL_TYPES, DEAL_TYPE_LABEL } from '../../shared/pricing'
import { Field } from '../components/ui'
import { ApiError } from '../api'

// ---------- Kanban ----------

function DealCard({ d, onDragStart, dragging }: { d: Deal; onDragStart: (e: React.DragEvent) => void; dragging: boolean }) {
  const rotting = isRotting(d)
  const idle = daysBetween(d.last_activity_at && d.last_activity_at > d.stage_entered_at ? d.last_activity_at : d.stage_entered_at)
  const overdue = (d.overdue_task_count ?? 0) > 0
  const closeSoon = d.expected_close_date && d.stage_kind === 'open' && new Date(d.expected_close_date) < new Date(Date.now() + 7 * 86400e3)
  const closePast = d.expected_close_date && d.stage_kind === 'open' && new Date(`${d.expected_close_date}T23:59:59`) < new Date()
  return (
    <Link to={`/deals/${d.id}`} className={`dcard ${dragging ? 'dragging' : ''} ${rotting ? 'rotting' : ''}`} draggable onDragStart={onDragStart} style={{ color: 'inherit', textDecoration: 'none' }}>
      <div className="title">{d.title}</div>
      {d.company_name && <div className="company">{d.company_name}</div>}
      <div className="foot">
        <span className="amount">{money(d.amount, d.currency)}</span>
        <span className="muted" title={`Entered stage ${fmtDate(d.stage_entered_at)}`}>· {daysBetween(d.stage_entered_at)}d</span>
        <span className="flags">
          {overdue && <span className="flag danger" title={`${d.overdue_task_count} overdue task(s)`}>⚑ {d.overdue_task_count}</span>}
          {!overdue && d.next_activity_at && <span className="flag good" title={`Next activity ${relative(d.next_activity_at)}`}>▸ {relative(d.next_activity_at)}</span>}
          {!overdue && !d.next_activity_at && d.stage_kind === 'open' && <span className="flag warn" title="No activity scheduled">no next step</span>}
          {rotting && <span className="flag danger" title={`Idle ${idle}d, limit ${d.rot_after_days}d`}>rotting {idle}d</span>}
          {closePast && <span className="flag danger" title="Expected close date has passed">close overdue</span>}
          {!closePast && closeSoon && <span className="flag warn" title={`Expected close ${fmtDate(d.expected_close_date)}`}>closes {relative(d.expected_close_date!)}</span>}
          <Avatar name={d.owner_name} />
        </span>
      </div>
    </Link>
  )
}

function Column_({ stage, deals, onDrop, dragId, setDragId, draggingOver, setDraggingOver }: { stage: Stage; deals: Deal[]; onDrop: (dealId: string, stage: Stage, position: number) => void; dragId: string | null; setDragId: (id: string | null) => void; draggingOver: string | null; setDraggingOver: (id: string | null) => void }) {
  const total = deals.reduce((s, d) => s + d.amount, 0)
  const weighted = deals.reduce((s, d) => s + (d.weighted_amount ?? 0), 0)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/deal-id') || dragId
    setDraggingOver(null)
    if (!id) return
    // Position: insert before the card under the cursor, else at the end.
    const cards = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-deal-id]'))
    let before: Deal | null = null
    for (const el of cards) {
      const r = el.getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) {
        before = deals.find((d) => d.id === el.dataset.dealId) ?? null
        break
      }
    }
    const others = deals.filter((d) => d.id !== id)
    let position: number
    if (!before || before.id === id) position = (others[others.length - 1]?.position ?? 0) + 1
    else {
      const idx = others.findIndex((d) => d.id === before!.id)
      const prev = others[idx - 1]?.position ?? before.position - 1
      position = (prev + before.position) / 2
    }
    onDrop(id, stage, position)
  }
  return (
    <div
      className={`col ${draggingOver === stage.id ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (draggingOver !== stage.id) setDraggingOver(stage.id) }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDraggingOver(null) }}
      onDrop={handleDrop}
    >
      <div className="col-h" style={{ borderTopColor: stage.color }}>
        <div className="name">{stage.name} <span className="muted" style={{ fontWeight: 400 }}>{deals.length}</span>{stage.kind !== 'open' && <span className={`badge ${stage.kind === 'won' ? 'good' : 'danger'}`} style={{ marginLeft: 'auto' }}>{stage.kind}</span>}</div>
        <div className="meta"><span>{compactMoney(total)}</span>{stage.kind === 'open' && <span title="Weighted by stage probability">· {compactMoney(weighted)} weighted · {stage.probability}%</span>}</div>
      </div>
      <div className="cards">
        {deals.map((d) => (
          <div key={d.id} data-deal-id={d.id}>
            <DealCard d={d} dragging={dragId === d.id} onDragStart={(e) => { e.dataTransfer.setData('text/deal-id', d.id); e.dataTransfer.effectAllowed = 'move'; setDragId(d.id) }} />
          </div>
        ))}
      </div>
    </div>
  )
}

function LostReasonPrompt({ deal, onPick, onCancel }: { deal: Deal; onPick: (reason: string) => void; onCancel: () => void }) {
  const { lostReasons } = useRefData()
  const [reason, setReason] = useState(lostReasons[0]?.label ?? '')
  const [other, setOther] = useState('')
  return (
    <Modal title={`Mark "${deal.title}" as lost`} onClose={onCancel} width={440}>
      <div className="field">
        <label>Why was it lost?</label>
        <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
          {lostReasons.map((r) => <option key={r.id} value={r.label}>{r.label}</option>)}
          <option value="__other">Other…</option>
        </select>
        {reason === '__other' && <input className="input" style={{ marginTop: 8 }} placeholder="Reason" value={other} onChange={(e) => setOther(e.target.value)} autoFocus />}
      </div>
      <div className="form-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn primary" onClick={() => onPick(reason === '__other' ? other.trim() || 'Other' : reason)}>Mark lost</button>
      </div>
    </Modal>
  )
}

export function Kanban({ pipelineId, filters }: { pipelineId: string; filters: Record<string, string> }) {
  const { pipelines } = useRefData()
  const toast = useToast()
  const pipeline = pipelines.find((p) => p.id === pipelineId)
  const { data, refresh, setData } = useQuery(() => api.get<{ items: Deal[] }>(`/api/deals/board${qs({ pipeline_id: pipelineId, ...filters })}`), [pipelineId, JSON.stringify(filters)])
  const [dragId, setDragId] = useState<string | null>(null)
  const [draggingOver, setDraggingOver] = useState<string | null>(null)
  const [lostPrompt, setLostPrompt] = useState<{ deal: Deal; stage: Stage; position: number } | null>(null)
  const [wonPrompt, setWonPrompt] = useState<{ deal: Deal; stage: Stage; position: number } | null>(null)
  const [contractMonths, setContractMonths] = useState('12')
  const [contractStart, setContractStart] = useState(new Date().toISOString().slice(0, 10))
  const [hideClosed, setHideClosed] = useLocalStorage('crm.board.hideClosed', false)

  const move = async (dealId: string, stage: Stage, position: number, lost_reason?: string, contract_months?: number, contract_start_date?: string) => {
    setDragId(null)
    const deal = data?.items.find((d) => d.id === dealId)
    if (!deal) return
    if (stage.kind === 'lost' && deal.stage_id !== stage.id && lost_reason === undefined) {
      setLostPrompt({ deal, stage, position })
      return
    }
    if (stage.kind === 'won' && deal.stage_id !== stage.id && !deal.contract_months && contract_months === undefined) {
      setContractMonths('12')
      setWonPrompt({ deal, stage, position })
      return
    }
    // Optimistic update.
    setData({ items: (data?.items ?? []).map((d) => (d.id === dealId ? { ...d, stage_id: stage.id, stage_name: stage.name, stage_kind: stage.kind, position, probability: stage.probability, weighted_amount: Math.round(d.amount * stage.probability) / 100, stage_entered_at: d.stage_id === stage.id ? d.stage_entered_at : new Date().toISOString() } : d)) })
    try {
      await api.post(`/api/deals/${dealId}/move`, { stage_id: stage.id, position, lost_reason, contract_months, contract_start_date })
      if (deal.stage_id !== stage.id) toast(stage.kind === 'won' ? 'Closed won. Renewal deal will be created 45 days into the contract.' : `Moved to ${stage.name}`)
    } catch (e) {
      if (e instanceof ApiError && (e.details as { code?: string } | undefined)?.code === 'contract_months_required') {
        setContractMonths('12')
        setWonPrompt({ deal, stage, position })
        return
      }
      toast((e as Error).message, 'error')
    } finally {
      refresh()
    }
  }

  if (!pipeline) return <div className="empty">Pipeline not found.</div>
  const stages = pipeline.stages.filter((s) => !hideClosed || s.kind === 'open')
  const byStage = new Map<string, Deal[]>()
  for (const d of data?.items ?? []) byStage.set(d.stage_id, [...(byStage.get(d.stage_id) ?? []), d])
  return (
    <>
      <div className="row small muted" style={{ marginBottom: 8 }}>
        <label className="row"><input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} /> Hide won/lost columns</label>
        <span className="right">Drag cards between stages. Red edge = rotting (idle past the stage limit).</span>
      </div>
      <div className="board" onDragEnd={() => { setDragId(null); setDraggingOver(null) }}>
        {stages.map((s) => (
          <Column_ key={s.id} stage={s} deals={(byStage.get(s.id) ?? []).sort((a, b) => a.position - b.position)} onDrop={move} dragId={dragId} setDragId={setDragId} draggingOver={draggingOver} setDraggingOver={setDraggingOver} />
        ))}
      </div>
      {wonPrompt && (
        <Modal title={`Close "${wonPrompt.deal.title}" as won`} onClose={() => { setWonPrompt(null); refresh() }} width={420}>
          <p className="small muted" style={{ marginBottom: 10 }}>Contract length is required to close won. The renewal deal is created 45 days after the contract starts, with expected close = contract end.</p>
          <div className="form-grid">
            <Field label="Contract length (months)"><input className="input" type="number" min={1} max={240} autoFocus value={contractMonths} onChange={(e) => setContractMonths(e.target.value)} /></Field>
            <Field label="Contract start date"><input className="input" type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} /></Field>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => { setWonPrompt(null); refresh() }}>Cancel</button>
            <button className="btn primary" disabled={!Number(contractMonths) || !contractStart} onClick={() => { const p = wonPrompt; setWonPrompt(null); move(p.deal.id, p.stage, p.position, undefined, Number(contractMonths), contractStart) }}>Close won</button>
          </div>
        </Modal>
      )}
      {lostPrompt && (
        <LostReasonPrompt deal={lostPrompt.deal} onCancel={() => { setLostPrompt(null); refresh() }} onPick={(reason) => { const p = lostPrompt; setLostPrompt(null); move(p.deal.id, p.stage, p.position, reason) }} />
      )}
    </>
  )
}

/** Attention flags shown in lists and on cards. Mirrors FLAG_SQL on the server. */
export function dealFlags(d: Deal): Array<{ key: DealFlag; label: string; kind: 'danger' | 'warn' }> {
  if (d.stage_kind !== 'open') return []
  const out: Array<{ key: DealFlag; label: string; kind: 'danger' | 'warn' }> = []
  if (d.expected_close_date && new Date(`${d.expected_close_date}T23:59:59`) < new Date()) out.push({ key: 'close_overdue', label: 'close overdue', kind: 'danger' })
  if ((d.overdue_task_count ?? 0) > 0) out.push({ key: 'activity_overdue', label: `${d.overdue_task_count} overdue`, kind: 'danger' })
  if (!d.next_activity_at) out.push({ key: 'no_next_step', label: 'no next step', kind: 'warn' })
  if (isRotting(d)) out.push({ key: 'rotting', label: 'rotting', kind: 'danger' })
  return out
}

const FLAG_LABEL: Record<DealFlag, string> = { close_overdue: 'Close date overdue', activity_overdue: 'Overdue activity', no_next_step: 'No next step', rotting: 'Rotting' }

// ---------- List ----------

function DealList({ pipelineId, filters }: { pipelineId: string; filters: Record<string, string> }) {
  const navigate = useNavigate()
  const { sort, dir, toggle } = useSort('updated_at', 'desc')
  const [offset, setOffset] = useState(0)
  useEffect(() => setOffset(0), [pipelineId, JSON.stringify(filters), sort, dir])
  const { data, loading } = useQuery(() => api.get<Paged<Deal>>(`/api/deals${qs({ pipeline_id: pipelineId, ...filters, sort, dir, limit: 50, offset })}`), [pipelineId, JSON.stringify(filters), sort, dir, offset])
  const columns: Column<Deal>[] = [
    { key: 'title', label: 'Deal', sortable: true, render: (d) => <strong>{d.title}</strong> },
    { key: 'company', label: 'Company', sortable: true, render: (d) => d.company_name ?? <span className="muted">—</span> },
    { key: 'stage', label: 'Stage', sortable: true, render: (d) => <span className={`badge ${d.stage_kind === 'won' ? 'good' : d.stage_kind === 'lost' ? 'danger' : ''}`}>{d.stage_name}</span> },
    { key: 'amount', label: 'Amount', sortable: true, num: true, render: (d) => money(d.amount, d.currency) },
    { key: 'weighted', label: 'Weighted', sortable: true, num: true, render: (d) => <span className="muted">{money(d.weighted_amount, d.currency)}</span> },
    { key: 'owner', label: 'Owner', sortable: true, render: (d) => <span className="row"><Avatar name={d.owner_name} /> {d.owner_name ?? '—'}</span> },
    { key: 'type', label: 'Type', render: (d) => <span className="muted small">{DEAL_TYPE_LABEL[d.deal_type]}</span> },
    { key: 'expected_close_date', label: 'Expected close', sortable: true, render: (d) => <span className={d.stage_kind === 'open' && d.expected_close_date && new Date(`${d.expected_close_date}T23:59:59`) < new Date() ? 'error' : ''}>{fmtDate(d.expected_close_date)}</span> },
    { key: 'flags', label: 'Flags', render: (d) => <span className="row wrap" style={{ gap: 4 }}>{dealFlags(d).map((f) => <span key={f.key} className={`flag ${f.kind}`}>{f.label}</span>)}</span> },
    { key: 'stage_entered_at', label: 'In stage', sortable: true, num: true, render: (d) => `${daysBetween(d.stage_entered_at)}d` },
    { key: 'next_activity', label: 'Next activity', sortable: true, render: (d) => (d.next_activity_at ? <span className={(d.overdue_task_count ?? 0) > 0 ? 'error' : ''}>{relative(d.next_activity_at)}</span> : <span className="muted">none</span>) },
    { key: 'last_activity', label: 'Last activity', sortable: true, render: (d) => <span className={isRotting(d) ? 'error' : 'muted'}>{relative(d.last_activity_at)}</span> },
    { key: 'updated_at', label: 'Updated', sortable: true, render: (d) => <span className="muted">{relative(d.updated_at)}</span> },
  ]
  return (
    <div className="table-wrap">
      <SortableTable columns={columns} rows={data?.items ?? []} sort={sort} dir={dir} onSort={toggle} onRowClick={(d) => navigate(`/deals/${d.id}`)} loading={loading} empty="No deals match." />
      {data && <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />}
    </div>
  )
}

// ---------- Page ----------

export function DealsPage() {
  const { pipelines, loaded } = useRefData()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useLocalStorage<'board' | 'list'>('crm.deals.view', 'board')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q)
  const pipelineId = params.get('pipeline') ?? pipelines.find((p) => p.is_default)?.id ?? pipelines[0]?.id ?? ''
  const owner = params.get('owner') ?? ''
  const status = params.get('status') ?? ''
  const flag = params.get('flag') ?? ''
  const dealType = params.get('type') ?? ''
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const filters = useMemo(() => ({ q: dq, owner_id: owner, flag, deal_type: dealType, ...(view === 'list' && status ? { status } : {}) }), [dq, owner, status, view, flag, dealType])

  if (!loaded) return <div className="content muted">Loading…</div>
  if (!pipelines.length) return <div className="content"><div className="card pad">No pipelines yet. Create one in Settings.</div></div>
  return (
    <>
      <div className="topbar">
        <h1>Deals</h1>
        <div className="seg">
          <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>▦ Board</button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>☰ List</button>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New deal</button>
      </div>
      <div className={`content ${view === 'board' ? 'full' : ''}`}>
        <div className="toolbar">
          {pipelines.length > 1 && (
            <select className="select" value={pipelineId} onChange={(e) => setParam('pipeline', e.target.value)}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <input className="input search" placeholder="Search deals, companies, contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
          <OwnerSelect value={owner || null} onChange={(id) => setParam('owner', id ?? '')} allowAll />
          <button className={`btn sm ${owner === user?.id ? 'primary' : ''}`} onClick={() => setParam('owner', owner === user?.id ? '' : user?.id ?? '')}>My deals</button>
          <select className="select" value={flag} onChange={(e) => setParam('flag', e.target.value)} title="Attention flags">
            <option value="">All deals</option>
            {(Object.keys(FLAG_LABEL) as DealFlag[]).map((f) => <option key={f} value={f}>⚑ {FLAG_LABEL[f]}</option>)}
          </select>
          <select className="select" value={dealType} onChange={(e) => setParam('type', e.target.value)}>
            <option value="">All types</option>
            {DEAL_TYPES.map((t) => <option key={t} value={t}>{DEAL_TYPE_LABEL[t]}</option>)}
          </select>
          {view === 'list' && (
            <select className="select" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
            </select>
          )}
          <a className="btn sm right" href="/api/export/deals.csv" download>⤓ Export CSV</a>
        </div>
        {view === 'board' ? <Kanban pipelineId={pipelineId} filters={filters} /> : <DealList pipelineId={pipelineId} filters={filters} />}
      </div>
      {creating && <DealForm defaults={{ pipeline_id: pipelineId }} onClose={() => setCreating(false)} onSaved={(d) => { setCreating(false); navigate(`/deals/${d.id}`) }} />}
    </>
  )
}
