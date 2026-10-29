import { useEffect, useState } from 'react'
import { api, qs } from '../api'
import { useDebounced } from '../hooks'
import { useRefData } from '../refdata'
import type { Company, Contact } from '../../shared/types'

/**
 * Searchable combobox backed by the list endpoints. Always an input: focus it and start typing
 * to narrow the list; arrow keys + Enter select; Escape closes. Results render inline (not in
 * an absolutely positioned popup) so they are never clipped by a modal, and the list is tall
 * enough to show at least six names before scrolling.
 */
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
  const dq = useDebounced(q, 150)
  const [items, setItems] = useState<T[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    fetchItems(dq)
      .then((r) => {
        if (!alive) return
        setItems(r)
        setActive(0)
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [open, dq, fetchItems])

  const options: Array<{ id: string | null; text: string; item: T | null }> = [
    ...(allowNone && !q ? [{ id: null, text: 'None', item: null }] : []),
    ...items.map((it) => ({ id: it.id, text: itemLabel(it), item: it })),
  ]
  const pick = (o: { id: string | null; item: T | null }) => {
    onChange(o.id, o.item)
    setOpen(false)
    setQ('')
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (options[active]) pick(options[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setQ('')
    }
  }
  return (
    <div className="combo">
      <input
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        placeholder={value && label ? label : placeholder}
        value={open ? q : value ? label ?? '' : ''}
        onFocus={() => {
          setOpen(true)
          setQ('')
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value)
          if (!open) setOpen(true)
        }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="combo-list" role="listbox">
          {options.map((o, i) => (
            <li
              key={o.id ?? '__none'}
              role="option"
              aria-selected={o.id === value}
              className={`${i === active ? 'active' : ''} ${o.id === value ? 'selected' : ''} ${o.id === null ? 'muted' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o)
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.text}
            </li>
          ))}
          {!options.length && <li className="muted empty-row">{loading ? 'Searching…' : 'No matches'}</li>}
        </ul>
      )}
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
