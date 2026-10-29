import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDateTime, money } from '../format'
import { useQuery } from '../hooks'
import { ActivityComposer } from '../components/ActivityComposer'
import { CompanyForm, ContactForm, DealForm } from '../components/Forms'
import { Timeline } from '../components/Timeline'
import { Avatar, ConfirmButton, useToast } from '../components/ui'
import type { Activity, AuditEntry, Company, Contact, Deal, Paged, TimelineItem } from '../../shared/types'

export function CompanyDetail() {
  const { id } = useParams()
  const toast = useToast()
  const company = useQuery(() => api.get<Company>(`/api/companies/${id}`), [id])
  const contacts = useQuery(() => api.get<Paged<Contact>>(`/api/contacts${qs({ company_id: id, limit: 200 })}`), [id])
  const deals = useQuery(() => api.get<Paged<Deal>>(`/api/deals${qs({ company_id: id, sort: 'updated_at', dir: 'desc', limit: 100 })}`), [id])
  const activities = useQuery(() => api.get<Paged<Activity>>(`/api/activities${qs({ company_id: id, limit: 200 })}`), [id])
  const audit = useQuery(() => api.get<{ items: AuditEntry[] }>(`/api/audit${qs({ entity_type: 'company', entity_id: id, limit: 100 })}`), [id])
  const [editing, setEditing] = useState(false)
  const [newDeal, setNewDeal] = useState(false)
  const [newContact, setNewContact] = useState(false)
  const c = company.data
  const refreshAll = () => { company.refresh(); contacts.refresh(); deals.refresh(); activities.refresh(); audit.refresh() }
  const archive = async () => {
    if (!c) return
    await api.post(`/api/companies/${c.id}/archive${c.archived_at ? '?restore=true' : ''}`)
    toast(c.archived_at ? 'Restored' : 'Archived')
    refreshAll()
  }
  if (company.error) return <div className="content"><div className="error-box">{company.error}</div></div>
  if (!c) return <div className="content muted">Loading…</div>
  const items: TimelineItem[] = [
    ...(activities.data?.items ?? []).map((a) => ({ kind: 'activity' as const, at: a.created_at, activity: a })),
    ...(audit.data?.items ?? []).map((a) => ({ kind: 'audit' as const, at: a.created_at, audit: a })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
  const openValue = (deals.data?.items ?? []).filter((d) => d.stage_kind === 'open').reduce((s, d) => s + d.amount, 0)
  const wonValue = (deals.data?.items ?? []).filter((d) => d.stage_kind === 'won').reduce((s, d) => s + d.amount, 0)
  return (
    <>
      <div className="topbar">
        <div className="grow">
          <div className="small muted"><Link to="/companies">Companies</Link></div>
          <h1 className="row">{c.name} {c.archived_at && <span className="badge warn">archived</span>}</h1>
        </div>
        <button className="btn" onClick={() => setNewContact(true)}>+ Contact</button>
        <button className="btn" onClick={() => setNewDeal(true)}>+ Deal</button>
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <ConfirmButton className="btn" label={c.archived_at ? 'Restore' : 'Archive'} onConfirm={archive} />
      </div>
      <div className="content detail-layout">
        <div className="grid">
          <ActivityComposer companyId={c.id} onCreated={refreshAll} />
          <div className="card">
            <div className="card-h"><h2>Timeline</h2></div>
            <div className="card-b" style={{ paddingTop: 4 }}><Timeline items={items} onChanged={refreshAll} showDeal /></div>
          </div>
        </div>
        <div className="grid">
          <div className="card">
            <div className="card-h"><h2>Details</h2></div>
            <div className="card-b">
              <dl className="kv">
                <dt>Industry</dt><dd>{c.industry ?? '—'}</dd>
                <dt>Website</dt><dd>{c.website ? <a href={c.website} target="_blank" rel="noreferrer">{c.website}</a> : c.domain ?? '—'}</dd>
                <dt>Phone</dt><dd>{c.phone ?? '—'}</dd>
                <dt>Address</dt><dd>{c.address ?? '—'}</dd>
                <dt>Owner</dt><dd>{c.owner_name ?? 'Unassigned'}</dd>
                <dt>Open pipeline</dt><dd>{money(openValue)}</dd>
                <dt>Won to date</dt><dd>{money(wonValue)}</dd>
                <dt>Created</dt><dd>{fmtDateTime(c.created_at)}</dd>
                <dt>Updated</dt><dd>{fmtDateTime(c.updated_at)}</dd>
              </dl>
              {c.notes && <p className="small" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Contacts</h2><span className="muted small right">{contacts.data?.total ?? 0}</span></div>
            <div className="card-b" style={{ padding: 0 }}>
              {(contacts.data?.items ?? []).map((ct) => (
                <Link key={ct.id} to={`/contacts/${ct.id}`} className="row" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', color: 'inherit' }}>
                  <Avatar name={`${ct.first_name} ${ct.last_name}`} />
                  <span className="grow truncate">{ct.first_name} {ct.last_name}<span className="muted small"> {ct.title ? `· ${ct.title}` : ''}</span></span>
                </Link>
              ))}
              {!contacts.data?.items.length && <div className="empty small">No contacts</div>}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Deals</h2><span className="muted small right">{deals.data?.total ?? 0}</span></div>
            <div className="card-b" style={{ padding: 0 }}>
              {(deals.data?.items ?? []).map((d) => (
                <Link key={d.id} to={`/deals/${d.id}`} className="row" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', color: 'inherit' }}>
                  <span className="grow truncate">{d.title}</span>
                  <span className={`badge ${d.stage_kind === 'won' ? 'good' : d.stage_kind === 'lost' ? 'danger' : ''}`}>{d.stage_name}</span>
                  <span className="mono">{money(d.amount, d.currency)}</span>
                </Link>
              ))}
              {!deals.data?.items.length && <div className="empty small">No deals</div>}
            </div>
          </div>
        </div>
      </div>
      {editing && <CompanyForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refreshAll() }} />}
      {newDeal && <DealForm defaults={{ company_id: c.id, company_name: c.name }} onClose={() => setNewDeal(false)} onSaved={() => { setNewDeal(false); refreshAll() }} />}
      {newContact && <ContactForm defaults={{ company_id: c.id, company_name: c.name }} onClose={() => setNewContact(false)} onSaved={() => { setNewContact(false); refreshAll() }} />}
    </>
  )
}
