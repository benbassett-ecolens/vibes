import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDate, relative } from '../format'
import { useDebounced, useQuery } from '../hooks'
import { ContactForm } from '../components/Forms'
import { OwnerSelect } from '../components/Pickers'
import { Avatar, Pager, SortableTable, useSort, type Column } from '../components/ui'
import type { Contact, Paged } from '../../shared/types'

export function ContactsPage() {
  const navigate = useNavigate()
  const { sort, dir, toggle } = useSort('name')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [owner, setOwner] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => setOffset(0), [dq, owner, sort, dir])
  const { data, loading } = useQuery(() => api.get<Paged<Contact>>(`/api/contacts${qs({ q: dq, owner_id: owner, sort, dir, limit: 50, offset })}`), [dq, owner, sort, dir, offset])
  const columns: Column<Contact>[] = [
    { key: 'name', label: 'Name', sortable: true, render: (c) => <span className="row"><Avatar name={`${c.first_name} ${c.last_name}`} /> <strong>{c.first_name} {c.last_name}</strong></span> },
    { key: 'title', label: 'Title', sortable: true, render: (c) => c.title ?? <span className="muted">—</span> },
    { key: 'company', label: 'Company', sortable: true, render: (c) => c.company_name ?? <span className="muted">—</span> },
    { key: 'email', label: 'Email', sortable: true, render: (c) => (c.email ? <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>{c.email}</a> : <span className="muted">—</span>) },
    { key: 'phone', label: 'Phone', render: (c) => c.phone ?? <span className="muted">—</span> },
    { key: 'owner', label: 'Owner', sortable: true, render: (c) => c.owner_name ?? '—' },
    { key: 'last_activity', label: 'Last activity', sortable: true, render: (c) => <span className="muted">{relative(c.last_activity_at)}</span> },
    { key: 'created_at', label: 'Created', sortable: true, render: (c) => <span className="muted">{fmtDate(c.created_at)}</span> },
  ]
  return (
    <>
      <div className="topbar">
        <h1>Contacts</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>+ New contact</button>
      </div>
      <div className="content">
        <div className="toolbar">
          <input className="input search" placeholder="Search name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} />
          <OwnerSelect value={owner} onChange={setOwner} allowAll />
          <a className="btn sm right" href="/api/export/contacts.csv" download>⤓ Export CSV</a>
        </div>
        <div className="table-wrap">
          <SortableTable columns={columns} rows={data?.items ?? []} sort={sort} dir={dir} onSort={toggle} onRowClick={(c) => navigate(`/contacts/${c.id}`)} loading={loading} empty="No contacts yet." />
          {data && <Pager total={data.total} limit={data.limit} offset={data.offset} onChange={setOffset} />}
        </div>
      </div>
      {creating && <ContactForm onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); navigate(`/contacts/${c.id}`) }} />}
    </>
  )
}
