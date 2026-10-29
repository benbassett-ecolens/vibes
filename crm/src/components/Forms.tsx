import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useRefData } from '../refdata'
import { Field, Modal, useToast } from './ui'
import { toLocalInputDateTime, fromLocalInputDateTime } from '../format'
import { DEAL_TYPES, DEAL_TYPE_LABEL } from '../../shared/pricing'
import { CompanyPicker, ContactPicker, OwnerSelect } from './Pickers'
import type { Company, Contact, Deal } from '../../shared/types'

export function DealForm({ initial, onClose, onSaved, defaults }: { initial?: Deal; onClose: () => void; onSaved: (d: Deal) => void; defaults?: Partial<Deal> }) {
  const { pipelines } = useRefData()
  const { user } = useAuth()
  const toast = useToast()
  const base = initial ?? defaults
  const [pipelineId, setPipelineId] = useState(base?.pipeline_id ?? pipelines.find((p) => p.is_default)?.id ?? pipelines[0]?.id ?? '')
  const pipeline = pipelines.find((p) => p.id === pipelineId)
  const [form, setForm] = useState({
    title: base?.title ?? '',
    stage_id: base?.stage_id ?? pipeline?.stages.find((s) => s.kind === 'open')?.id ?? '',
    amount: base?.amount?.toString() ?? '',
    currency: base?.currency ?? 'USD',
    company_id: base?.company_id ?? null,
    company_name: base?.company_name ?? null,
    contact_id: base?.contact_id ?? null,
    contact_name: base?.contact_name ?? null,
    owner_id: base?.owner_id ?? user?.id ?? null,
    expected_close_date: base?.expected_close_date ?? '',
    lead_source: base?.lead_source ?? '',
    deal_type: base?.deal_type ?? 'new_business',
    contract_months: base?.contract_months?.toString() ?? '',
    contract_start_date: base?.contract_start_date ?? '',
    description: base?.description ?? '',
    contact_email: null as string | null,
    next_subject: '',
    next_due: toLocalInputDateTime(new Date(Date.now() + 2 * 86400e3).toISOString()).slice(0, 11) + '09:00',
    next_type: 'task' as 'task' | 'call' | 'email' | 'meeting',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (!initial) {
        if (!form.company_id) throw new Error('Company is required')
        if (!form.contact_id) throw new Error('Main contact is required')
        if (form.contact_email === '' ) throw new Error('The main contact needs an email address. Edit the contact first.')
        if (!form.next_subject.trim()) throw new Error('Next activity description is required')
        if (!form.next_due) throw new Error('Next activity date is required')
      }
      if (!form.expected_close_date) throw new Error('Expected close date is required')
      if (!form.lead_source.trim()) throw new Error('Lead source is required')
      const body = {
        title: form.title,
        pipeline_id: pipelineId,
        stage_id: form.stage_id || undefined,
        amount: form.amount === '' ? 0 : Number(form.amount),
        currency: form.currency,
        company_id: form.company_id,
        contact_id: form.contact_id,
        owner_id: form.owner_id,
        expected_close_date: form.expected_close_date || null,
        lead_source: form.lead_source.trim(),
        deal_type: form.deal_type,
        contract_months: form.contract_months === '' ? null : Number(form.contract_months),
        contract_start_date: form.contract_start_date || null,
        description: form.description || null,
        ...(initial ? {} : { next_activity: { subject: form.next_subject.trim(), due_at: fromLocalInputDateTime(form.next_due), type: form.next_type } }),
      }
      const d = initial ? await api.patch<Deal>(`/api/deals/${initial.id}`, body) : await api.post<Deal>('/api/deals', body)
      toast(initial ? 'Deal updated' : 'Deal created')
      onSaved(d)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Edit deal' : 'New deal'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Deal name" span2><input className="input" required autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Pipeline">
            <select className="select" value={pipelineId} onChange={(e) => { const p = pipelines.find((x) => x.id === e.target.value); setPipelineId(e.target.value); set({ stage_id: p?.stages.find((s) => s.kind === 'open')?.id ?? '' }) }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Stage">
            <select className="select" value={form.stage_id} onChange={(e) => set({ stage_id: e.target.value })}>
              {pipeline?.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={initial?.amount_from_products ? 'First-year value (from products)' : 'First-year value'}><input className="input" type="number" min="0" step="0.01" value={form.amount} disabled={!!initial?.amount_from_products} onChange={(e) => set({ amount: e.target.value })} /></Field>
          <Field label="Currency"><input className="input" maxLength={3} value={form.currency} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Company *"><CompanyPicker value={form.company_id} label={form.company_name} onChange={(id, c) => set({ company_id: id, company_name: c?.name ?? null })} /></Field>
          <Field label="Main contact *">
            <ContactPicker value={form.contact_id} label={form.contact_name} companyId={form.company_id} onChange={(id, c) => set({ contact_id: id, contact_name: c ? `${c.first_name} ${c.last_name}`.trim() : null, contact_email: c ? (c.email ?? '') : null })} />
            {form.contact_email === '' && <span className="error small">This contact has no email address. Main contacts need one.</span>}
            {form.contact_email && <span className="muted small">{form.contact_email}</span>}
          </Field>
          <Field label="Owner"><OwnerSelect value={form.owner_id} onChange={(id) => set({ owner_id: id })} /></Field>
          <Field label="Expected close *"><input className="input" type="date" required value={form.expected_close_date} onChange={(e) => set({ expected_close_date: e.target.value })} /></Field>
          <Field label="Lead source *"><input className="input" required list="lead-sources" placeholder="Referral, inbound, event…" value={form.lead_source} onChange={(e) => set({ lead_source: e.target.value })} /><datalist id="lead-sources"><option value="Referral" /><option value="Inbound" /><option value="Outbound" /><option value="Event" /><option value="Partner" /><option value="Existing customer" /><option value="Renewal" /></datalist></Field>
          <Field label="Deal type *">
            <select className="select" value={form.deal_type} onChange={(e) => set({ deal_type: e.target.value as typeof form.deal_type })}>
              {DEAL_TYPES.map((t) => <option key={t} value={t}>{DEAL_TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
          <Field label="Contract length (months)"><input className="input" type="number" min={1} max={240} placeholder="required to close won" value={form.contract_months} onChange={(e) => set({ contract_months: e.target.value })} /></Field>
          <Field label="Contract start date"><input className="input" type="date" value={form.contract_start_date} onChange={(e) => set({ contract_start_date: e.target.value })} /></Field>
          {!initial && (
            <>
              <Field label="Next activity *" span2>
                <div className="row">
                  <select className="select" value={form.next_type} onChange={(e) => set({ next_type: e.target.value as typeof form.next_type })} style={{ width: 'auto' }}>
                    <option value="task">Task</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option>
                  </select>
                  <input className="input grow" required placeholder="What happens next? e.g. Send proposal" value={form.next_subject} onChange={(e) => set({ next_subject: e.target.value })} />
                  <input className="input" type="datetime-local" required value={form.next_due} onChange={(e) => set({ next_due: e.target.value })} style={{ width: 'auto' }} />
                </div>
              </Field>
            </>
          )}
          <Field label="Description" span2><textarea className="textarea" value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
        </div>
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{initial ? 'Save' : 'Create deal'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function ContactForm({ initial, onClose, onSaved, defaults }: { initial?: Contact; onClose: () => void; onSaved: (c: Contact) => void; defaults?: Partial<Contact> }) {
  const { user } = useAuth()
  const toast = useToast()
  const base = initial ?? defaults
  const [form, setForm] = useState({
    first_name: base?.first_name ?? '',
    last_name: base?.last_name ?? '',
    email: base?.email ?? '',
    phone: base?.phone ?? '',
    title: base?.title ?? '',
    company_id: base?.company_id ?? null,
    company_name: base?.company_name ?? null,
    owner_id: base?.owner_id ?? user?.id ?? null,
    notes: base?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<{ company_id: string; company_name: string; score: number } | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const suggestCompany = () => {
    if (!form.email.includes('@')) return
    api.get<{ items: Array<{ company_id: string; company_name: string; score: number }> }>(`/api/contacts/suggest-company?email=${encodeURIComponent(form.email)}`).then((r) => {
      const best = r.items[0] ?? null
      setSuggestion(best)
      if (best && best.score >= 0.85 && !form.company_id) set({ company_id: best.company_id, company_name: best.company_name })
    }).catch(() => {})
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { first_name: form.first_name, last_name: form.last_name, email: form.email || null, phone: form.phone || null, title: form.title || null, company_id: form.company_id, owner_id: form.owner_id, notes: form.notes || null }
      const c = initial ? await api.patch<Contact>(`/api/contacts/${initial.id}`, body) : await api.post<Contact>('/api/contacts', body)
      toast(initial ? 'Contact updated' : 'Contact created')
      onSaved(c)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={initial ? 'Edit contact' : 'New contact'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="First name"><input className="input" required autoFocus value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Field>
          <Field label="Last name"><input className="input" value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} onBlur={suggestCompany} />
          </Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Job title"><input className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Company">
            <CompanyPicker value={form.company_id} label={form.company_name} onChange={(id, c) => set({ company_id: id, company_name: c?.name ?? null })} />
            {suggestion && !form.company_id && <span className="small muted">Suggested from the email domain: <a href="#" onClick={(e) => { e.preventDefault(); set({ company_id: suggestion.company_id, company_name: suggestion.company_name }) }}>{suggestion.company_name}</a> ({Math.round(suggestion.score * 100)}%)</span>}
          </Field>
          <Field label="Owner"><OwnerSelect value={form.owner_id} onChange={(id) => set({ owner_id: id })} /></Field>
          <Field label="Notes" span2><textarea className="textarea" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{initial ? 'Save' : 'Create contact'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function CompanyForm({ initial, onClose, onSaved }: { initial?: Company; onClose: () => void; onSaved: (c: Company) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    domain: initial?.domain ?? '',
    website: initial?.website ?? '',
    industry: initial?.industry ?? '',
    phone: initial?.phone ?? '',
    address: initial?.address ?? '',
    owner_id: initial?.owner_id ?? user?.id ?? null,
    notes: initial?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = { name: form.name, domain: form.domain || null, website: form.website || null, industry: form.industry || null, phone: form.phone || null, address: form.address || null, owner_id: form.owner_id, notes: form.notes || null }
      const c = initial ? await api.patch<Company>(`/api/companies/${initial.id}`, body) : await api.post<Company>('/api/companies', body)
      toast(initial ? 'Company updated' : 'Company created')
      onSaved(c)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={initial ? 'Edit company' : 'New company'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Name" span2><input className="input" required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Domain"><input className="input" placeholder="example.com" value={form.domain} onChange={(e) => set({ domain: e.target.value })} /></Field>
          <Field label="Website"><input className="input" value={form.website} onChange={(e) => set({ website: e.target.value })} /></Field>
          <Field label="Industry"><input className="input" value={form.industry} onChange={(e) => set({ industry: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
          <Field label="Address" span2><input className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} /></Field>
          <Field label="Owner"><OwnerSelect value={form.owner_id} onChange={(id) => set({ owner_id: id })} /></Field>
          <Field label="Notes" span2><textarea className="textarea" value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{initial ? 'Save' : 'Create company'}</button>
        </div>
      </form>
    </Modal>
  )
}
