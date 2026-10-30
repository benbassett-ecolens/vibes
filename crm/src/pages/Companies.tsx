import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDate, money } from '../format'
import { useDebounced, useQuery } from '../hooks'
import { CompanyForm } from '../components/Forms'
import { OwnerSelect } from '../components/Pickers'
import { Pager, SortableTable, useSort, type Column } from '../components/ui'
import type { Company, Paged } from '../../shared/types'

export function CompaniesPage() {
  const navigate = useNavigate()
  const { sort, dir, toggle } = useSort('name')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [owner, setOwner] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => setOffset(0), [dq, owner, sort, dir])
  const { data, loading } = useQuery(() => api.get<Paged<Company>>(`/api/companies${qs({ q: dq, owner_id: owner, sort, dir, limit: 50, offset })}`), [dq, owner, sort, dir, offset])
  const columns: Column<Company>[] = [
    { key: 'name', label: 'Company', sortable: true, render: (c) => <strong>{c.name}</strong> },
    { key: 'industry', label: 'Industry', sortable: true, render: (c) => c.industry ?? <span className="muted">—</span> },
    { key: 'domain', label: 'Domain', render: (c) => c.domain ?? <span className="muted">—</span> },
    { key: 'ecosystems', label: 'Ecosystems', render: (c) => <span className="small">{c.ecosystems?.join(', ') || <span className="muted">—</span>}</span> },
    { key: 'partner_type', label: 'Type', sortable: true, render: (c) => c.partner_type ?? <span className="muted">—</span> },
    { key: 'owner', label: 'Owner', sortable: true, render: (c) => c.owner_name ?? '—' },
    { key: 'contacts', label: 'Contacts', sortable: true, num: true, render: (c) => c.contact_count ?? 0 },
    { key: 'open_deals', label: 'Open deals', sortable: true, num: true, render: (c) => c.open_deal_count ?? 0 },
    { key: 'open_value', label: 'Open value', sortable: true, num: true, render: (c) => money(c.open_deal_value) },
    { key: 'created_at', label: 'Created', sortable: true, render: (c) => <span className="muted">{fmtDate(c.created_at)}</span> },
  ]
  return (
    <>
      <div className="topbar">
        <h1>Companies</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New company</button>
      </div>
      <div className="content">
        <div className="toolbar">
          <input className="input search" placeholder="Search name, domain, industry…" value={q} onChange={(e) => setQ(e.target.value)} />
          <OwnerSelect value={owner} onChange={setOwner} allowAll />
          <a className="btn sm right" href="/api/export/companies.csv" download>⤓ Export CSV</a>
        </div>
        <div className="table-wrap">
          <SortableTable columns={columns} rows={data?.items ?? []} sort={sort} dir={dir} onSort={toggle} onRowClick={(c) => navigate(`/companies/${c.id}`)} loading={loading} empty="No companies yet." />
          {data && <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />}
        </div>
      </div>
      {creating && <CompanyForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); navigate(`/companies/${c.id}`) }} />}
    </>
  )
}
