import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import { fmtDateTime, relative } from '../format'
import { useDebounced, useQuery } from '../hooks'
import { OwnerSelect } from '../components/Pickers'
import { ACTIVITY_ICON } from '../components/Timeline'
import { Pager, SortableTable, useSort, useToast, type Column } from '../components/ui'
import type { Activity, Paged } from '../../shared/types'

export function ActivitiesPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [status, setStatus] = useState<'open' | 'overdue' | 'today' | 'completed' | ''>('open')
  const [owner, setOwner] = useState<string | null>(user?.id ?? null)
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [offset, setOffset] = useState(0)
  const { sort, dir, toggle } = useSort('due_at', 'asc')
  useEffect(() => setOffset(0), [status, owner, type, dq, sort, dir])
  const { data, loading, refresh } = useQuery(
    () => api.get<Paged<Activity>>(`/api/activities${qs({ status, owner_id: owner, type, q: dq, sort: status === 'completed' || status === '' ? (sort === 'due_at' ? 'created_at' : sort) : sort, dir: status === '' && sort === 'due_at' ? 'desc' : dir, limit: 50, offset })}`),
    [status, owner, type, dq, sort, dir, offset],
  )
  const toggleDone = async (a: Activity) => {
    try {
      await api.patch(`/api/activities/${a.id}`, { completed: !a.completed_at })
      refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const columns: Column<Activity>[] = [
    { key: 'done', label: '', width: '32px', render: (a) => ((a.type === 'task' || a.type === 'meeting' || a.due_at) ? <input type="checkbox" checked={!!a.completed_at} onChange={() => toggleDone(a)} /> : null) },
    { key: 'type', label: 'Type', sortable: true, render: (a) => <span>{ACTIVITY_ICON[a.type]} {a.type}</span> },
    { key: 'subject', label: 'Subject', sortable: true, render: (a) => <span><strong>{a.subject}</strong>{a.body && <span className="muted small"> — {a.body.slice(0, 80)}</span>}</span> },
    { key: 'deal', label: 'Deal', sortable: true, render: (a) => (a.deal_id ? <Link to={`/deals/${a.deal_id}`}>{a.deal_title}</Link> : a.contact_id ? <Link to={`/contacts/${a.contact_id}`}>{a.contact_name}</Link> : a.company_id ? <Link to={`/companies/${a.company_id}`}>{a.company_name}</Link> : '—') },
    { key: 'owner', label: 'Assigned to', sortable: true, render: (a) => a.owner_name ?? '—' },
    { key: 'due_at', label: 'Due', sortable: true, render: (a) => (a.due_at ? <span className={!a.completed_at && new Date(a.due_at).getTime() < Date.now() ? 'error' : ''} title={fmtDateTime(a.due_at)}>{relative(a.due_at)}</span> : <span className="muted">—</span>) },
    { key: 'completed_at', label: 'Completed', sortable: true, render: (a) => <span className="muted">{a.completed_at ? fmtDateTime(a.completed_at) : '—'}</span> },
    { key: 'created_at', label: 'Logged', sortable: true, render: (a) => <span className="muted" title={fmtDateTime(a.created_at)}>{relative(a.created_at)} by {a.created_by_name}</span> },
  ]
  return (
    <>
      <div className="topbar"><h1>Tasks &amp; activity</h1></div>
      <div className="content">
        <div className="toolbar">
          <div className="seg">
            {([['open', 'Open'], ['overdue', 'Overdue'], ['today', 'Today'], ['completed', 'Completed'], ['', 'All activity']] as const).map(([v, l]) => (
              <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>
            ))}
          </div>
          <OwnerSelect value={owner} onChange={setOwner} allowAll />
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {(['task', 'meeting', 'call', 'email', 'note'] as const).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="input search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="btn sm right" href="/api/export/activities.csv" download>⤓ Export CSV</a>
        </div>
        <div className="table-wrap">
          <SortableTable columns={columns} rows={data?.items ?? []} sort={sort} dir={dir} onSort={toggle} loading={loading} empty="Nothing here." />
          {data && <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />}
        </div>
      </div>
    </>
  )
}
