import { useEffect, useState } from 'react'
import { api, qs } from '../api'
import { useDebounced } from '../hooks'
import { useRefData } from '../refdata'
import type { Company, Contact } from '../../shared/types'

/** Searchable picker backed by the list endpoints. Shows the current label even if it isn't in the result set. */
function SearchPicker<T extends { id: string }>({
  value,
  label,
  placeholder,
  fetchItems,
  itemLabel,
  onChange,
  allowNone = true,
}: {
  value: string | null
  label: string | null | undefined
  placeholder: string
  fetchItems: (q: string) => Promise<T[]>
  itemLabel: (t: T) => string
  onChange: (id: string | null, item: T | null) => void
  allowNone?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [items, setItems] = useState<T[]>([])
  useEffect(() => {
    if (!open) return
    let alive = true
    fetchItems(dq).then((r) => alive && setItems(r)).catch(() => {})
    return () => {
      alive = false
    }
  }, [open, dq, fetchItems])
  if (!open) {
    return (
      <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(true)}>
        {value ? label ?? '…' : <span className="muted">{placeholder}</span>}
      </button>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <input className="input" autoFocus placeholder="Type to search…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      <div className="card" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, maxHeight: 240, overflow: 'auto' }}>
        {allowNone && (
          <button type="button" className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0 }} onMouseDown={() => onChange(null, null)}>
            <span className="muted">None</span>
          </button>
        )}
        {items.map((it) => (
          <button key={it.id} type="button" className="btn ghost" style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0 }} onMouseDown={() => onChange(it.id, it)}>
            {itemLabel(it)}
          </button>
        ))}
        {items.length === 0 && <div className="empty small">No matches</div>}
      </div>
    </div>
  )
}

const fetchCompanies = (q: string) => api.get<{ items: Company[] }>(`/api/companies${qs({ q, limit: 20 })}`).then((r) => r.items)
export function CompanyPicker(props: { value: string | null; label?: string | null; onChange: (id: string | null, c: Company | null) => void }) {
  return <SearchPicker value={props.value} label={props.label} placeholder="Select company" fetchItems={fetchCompanies} itemLabel={(c) => c.name} onChange={props.onChange} />
}

export function ContactPicker(props: { value: string | null; label?: string | null; companyId?: string | null; onChange: (id: string | null, c: Contact | null) => void }) {
  const companyId = props.companyId ?? ''
  const fetchContacts = (q: string) => api.get<{ items: Contact[] }>(`/api/contacts${qs({ q, limit: 20, company_id: companyId })}`).then((r) => r.items)
  return (
    <SearchPicker
      key={companyId}
      value={props.value}
      label={props.label}
      placeholder="Select contact"
      fetchItems={fetchContacts}
      itemLabel={(c) => `${c.first_name} ${c.last_name}${c.company_name ? ` · ${c.company_name}` : ''}`.trim()}
      onChange={props.onChange}
    />
  )
}

export function OwnerSelect({ value, onChange, allowAll, className = 'select' }: { value: string | null; onChange: (id: string | null) => void; allowAll?: boolean; className?: string }) {
  const { users } = useRefData()
  return (
    <select className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{allowAll ? 'All owners' : 'Unassigned'}</option>
      {users.filter((u) => u.is_active || u.id === value).map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  )
}
