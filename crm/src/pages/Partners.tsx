import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDate } from '../format'
import { useDebounced, useQuery } from '../hooks'
import { CompanyForm } from '../components/Forms'
import { NewsCard } from '../components/News'
import { OwnerSelect } from '../components/Pickers'
import { Pager, SortableTable, useSort, type Column } from '../components/ui'
import type { Company, CompanyKind, Paged, PartnerKind } from '../../shared/types'
import { COMPANY_KIND_LABEL } from '../../shared/types'

/** VARs and ERPs share one list page: the only difference is the record kind. */
export function PartnersPage({ kind }: { kind: PartnerKind }) {
  const L = COMPANY_KIND_LABEL[kind as CompanyKind]
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
  const { data, loading, refresh } = useQuery(() => api.get<Paged<Company>>(`/api/companies${qs({ kind, q: dq, owner_id: owner, ecosystem, sort, dir, limit: 50, offset })}`), [kind, dq, owner, ecosystem, sort, dir, offset])
  const columns: Column<Company>[] = [
    { key: 'name', label: L.one, sortable: true, render: (c) => <strong>{c.name}</strong> },
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
        <h1>{L.many}</h1>
        <span className="muted small" style={{ marginLeft: 8 }}>{L.sub} · {data?.total ?? 0}</span>
        <div className="right"><button className="btn primary" onClick={() => setCreating(true)}>+ New {L.one}</button></div>
      </div>
      <div className="content">
        <div className="toolbar">
          <input className="input" placeholder={`Search ${L.many}`} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <OwnerSelect value={owner} onChange={setOwner} allowAll />
          <select className="select" value={ecosystem} onChange={(e) => setEcosystem(e.target.value)}>
            <option value="">Any ecosystem</option>
            {(ecosystems.data?.items ?? []).map((x) => <option key={x.value} value={x.value}>{x.value}</option>)}
          </select>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <SortableTable columns={columns} rows={data?.items ?? []} sort={sort} dir={dir} onSort={toggle} onRowClick={(c) => navigate(`${L.path}/${c.id}`)} loading={loading} empty={kind === 'var' ? 'No VARs yet. Add one, or import your pipeline sheet: rows typed VAR land here.' : kind === 'erp' ? 'No ERPs yet. Add the publishers your partners sell: Microsoft, Acumatica, NetSuite, Sage, SAP…' : 'No ISVs yet. Add the software vendors that build add-ons for your ecosystems; imported rows typed ISV land here.'} />
          <Pager total={data?.total ?? 0} limit={50} offset={offset} onChange={setOffset} />
        </div>
        <NewsCard kind={kind} title={`News across all ${L.many}`} />
      </div>
      {creating && <CompanyForm kind={kind} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); refresh(); navigate(`${L.path}/${c.id}`) }} />}
    </>
  )
}
