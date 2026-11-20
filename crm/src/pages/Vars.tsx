import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDate } from '../format'
import { useDebounced, useQuery } from '../hooks'
import { CompanyForm } from '../components/Forms'
import { NewsCard } from '../components/News'
import { OwnerSelect } from '../components/Pickers'
import { Pager, SortableTable, useSort, type Column } from '../components/ui'
import type { Company, Paged } from '../../shared/types'

export function VarsPage() {
  const navigate = useNavigate()
  const { sort, dir, toggle } = useSort('name')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [owner, setOwner] = useState<string | null>(null)
  const [ecosystem, setEcosystem] = useState('')
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => setOffset(0), [dq, owner, ecosystem, sort, dir])
  const ecosystems = useQuery(() => api.get<{ items: Array<{ value: string; n: number }> }>('/api/companies/ecosystems'), [])
  const { data, loading, refresh } = useQuery(() => api.get<Paged<Company>>(`/api/companies${qs({ kind: 'var', q: dq, owner_id: owner, ecosystem, sort, dir, limit: 50, offset })}`), [dq, owner, ecosystem, sort, dir, offset])
  const columns: Column<Company>[] = [
    { key: 'name', label: 'VAR', sortable: true, render: (c) => <strong>{c.name}</strong> },
    { key: 'ecosystems', label: 'Ecosystems', render: (c) => <span className="small">{c.ecosystems?.join(', ') || <span className="muted">—</span>}</span> },
    { key: 'domain', label: 'Website', render: (c) => c.website ?? c.domain ?? <span className="muted">—</span> },
    { key: 'contacts', label: 'Contacts', sortable: true, num: true, render: (c) => c.contact_count ?? 0 },
    { key: 'owner', label: 'Owner', sortable: true, render: (c) => c.owner_name ?? '—' },
    { key: 'notes', label: 'Notes', render: (c) => <span className="small muted truncate" style={{ maxWidth: 320, display: 'inline-block' }}>{c.notes ?? ''}</span> },
    { key: 'created_at', label: 'Added', sortable: true, render: (c) => <span className="muted">{fmtDate(c.created_at)}</span> },
  ]
  return (
    <>
      <div className="topbar">
        <h1>VARs</h1>
        <span className="muted small" style={{ marginLeft: 8 }}>value-added resellers · {data?.total ?? 0}</span>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}>+ New VAR</button></div>
      </div>
      <div className="content">
        <div className="toolbar">
          <input className="input" placeholder="Search VARs" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <OwnerSelect value={owner} onChange={setOwner} allowAll />
          <select className="select" value={ecosystem} onChange={(e) => setEcosystem(e.target.value)}>
            <option value="">Any ecosystem</option>
            {(ecosystems.data?.items ?? []).map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}
          </select>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <SortableTable columns={columns} rows={data?.items ?? []} sort={sort} dir={dir} onSort={toggle} onRowClick={(c) => navigate(`/vars/${c.id}`)} loading={loading} empty="No VARs yet. Add one, or import your pipeline sheet: rows typed VAR land here." />
          <Pager total={data?.total ?? 0} limit={50} offset={offset} onChange={setOffset} />
        </div>
        <NewsCard title="News across all VARs" />
      </div>
      {creating && <CompanyForm kind="var" onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); refresh(); navigate(`/vars/${c.id}`) }} />}
    </>
  )
}
