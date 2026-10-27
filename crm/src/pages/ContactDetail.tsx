import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDateTime, money } from '../format'
import { useQuery } from '../hooks'
import { ActivityComposer } from '../components/ActivityComposer'
import { ContactForm, DealForm } from '../components/Forms'
import { Timeline } from '../components/Timeline'
import { Avatar, ConfirmButton, useToast } from '../components/ui'
import type { Activity, AuditEntry, Contact, Deal, Paged, TimelineItem } from '../../shared/types'

export function ContactDetail() {
  const { id } = useParams()
  const toast = useToast()
  const contact = useQuery(() => api.get<Contact>(`/api/contacts/${id}`), [id])
  const deals = useQuery(() => api.get<Paged<Deal>>(`/api/deals${qs({ contact_id: id, sort: 'updated_at', dir: 'desc', limit: 100 })}`), [id])
  const activities = useQuery(() => api.get<Paged<Activity>>(`/api/activities${qs({ contact_id: id, limit: 200 })}`), [id])
  const audit = useQuery(() => api.get<{ items: AuditEntry[] }>(`/api/audit${qs({ entity_type: 'contact', entity_id: id, limit: 100 })}`), [id])
  const [editing, setEditing] = useState(false)
  const [newDeal, setNewDeal] = useState(false)
  const c = contact.data
  const refreshAll = () => { contact.refresh(); activities.refresh(); audit.refresh(); deals.refresh() }
  const archive = async () => {
    if (!c) return
    await api.post(`/api/contacts/${c.id}/archive${c.archived_at ? '?restore=true' : ''}`)
    toast(c.archived_at ? 'Restored' : 'Archived')
    refreshAll()
  }
  if (contact.error) return <div className="content"><div className="error-box">{contact.error}</div></div>
  if (!c) return <div className="content muted">Loading…</div>
  const items: TimelineItem[] = [
    ...(activities.data?.items ?? []).map((a) => ({ kind: 'activity' as const, at: a.created_at, activity: a })),
    ...(audit.data?.items ?? []).map((a) => ({ kind: 'audit' as const, at: a.created_at, audit: a })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1))
  return (
    <>
      <div className="topbar">
        <div className="grow">
          <div className="small muted"><Link to="/contacts">Contacts</Link></div>
          <h1 className="row"><Avatar name={`${c.first_name} ${c.last_name}`} size="lg" /> {c.first_name} {c.last_name} {c.archived_at && <span className="badge warn">archived</span>}</h1>
        </div>
        <button className="btn" onClick={() => setNewDeal(true)}>+ Deal</button>
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
        <ConfirmButton className="btn" label={c.archived_at ? 'Restore' : 'Archive'} onConfirm={archive} />
      </div>
      <div className="content detail-layout">
        <div className="grid">
          <ActivityComposer contactId={c.id} companyId={c.company_id ?? undefined} onCreated={refreshAll} />
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
                <dt>Title</dt><dd>{c.title ?? '—'}</dd>
                <dt>Company</dt><dd>{c.company_id ? <Link to={`/companies/${c.company_id}`}>{c.company_name}</Link> : '—'}</dd>
                <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</dd>
                <dt>Phone</dt><dd>{c.phone ?? '—'}</dd>
                <dt>Owner</dt><dd>{c.owner_name ?? 'Unassigned'}</dd>
                <dt>Created</dt><dd>{fmtDateTime(c.created_at)}</dd>
                <dt>Updated</dt><dd>{fmtDateTime(c.updated_at)}</dd>
              </dl>
              {c.notes && <p className="small" style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{c.notes}</p>}
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
      {editing && <ContactForm initial={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refreshAll() }} />}
      {newDeal && <DealForm defaults={{ contact_id: c.id, contact_name: `${c.first_name} ${c.last_name}`, company_id: c.company_id, company_name: c.company_name }} onClose={() => setNewDeal(false)} onSaved={() => { setNewDeal(false); refreshAll() }} />}
    </>
  )
}
