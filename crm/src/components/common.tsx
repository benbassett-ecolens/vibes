import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../store'
import type { Person } from '../types'

export const BUSINESS_UNITS = ['ISV Services', 'VAR Services', 'AI - SMB', 'AI - Enterprise']
export const PARTNER_TYPES = ['ISV', 'VAR', 'Other']
export const ECOSYSTEMS = ['Microsoft', 'Acumatica', 'NetSuite', 'Sage', 'SAP-B1', 'Other']

export function Avatar({ person, size = 26 }: { person: Person | undefined; size?: number }) {
  if (!person) {
    return (
      <span className="avatar avatar-empty" style={{ width: size, height: size }} title="Unassigned">
        ?
      </span>
    )
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: person.color, fontSize: size * 0.4 }}
      title={person.name}
    >
      {person.initials}
    </span>
  )
}

export function usePerson(): (id: string) => Person | undefined {
  const { data } = useApp()
  return (id: string) => data.people.find((p) => p.id === id)
}

export function PersonSelect({
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = 'Anyone',
  className,
}: {
  value: string
  onChange: (id: string) => void
  allowEmpty?: boolean
  emptyLabel?: string
  className?: string
}) {
  const { data } = useApp()
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {data.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

/** Currency input that stores a number or null; accepts "90000", "90,000", "$90k". */
export function MoneyInput({
  value,
  onChange,
  placeholder = '$0',
  className,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  className?: string
}) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => {
    setText(value === null ? '' : String(value))
  }, [value])
  const commit = () => {
    const raw = text.trim().toLowerCase().replace(/[$,\s]/g, '')
    if (raw === '') return onChange(null)
    const mult = raw.endsWith('k') ? 1000 : raw.endsWith('m') ? 1_000_000 : 1
    const n = Number(raw.replace(/[km]$/, ''))
    onChange(Number.isFinite(n) ? Math.round(n * mult) : null)
  }
  return (
    <input
      className={`money ${className ?? ''}`}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** Chip-style multi-select for small fixed vocabularies (ecosystems, BUs). */
export function ChipSelect({
  options,
  value,
  onChange,
}: {
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
}) {
  const all = Array.from(new Set([...options, ...value]))
  return (
    <div className="chip-select" role="group">
      {all.map((opt) => {
        const on = value.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== opt) : [...value, opt])}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>
}

/** Inline editable text: click to edit, Enter/blur to commit. */
export function InlineText({
  value,
  onChange,
  className,
  placeholder = '—',
  as = 'span',
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
  as?: 'span' | 'h2'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (editing) {
    return (
      <input
        autoFocus
        className={`inline-input ${className ?? ''}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft.trim() && draft !== value) onChange(draft.trim())
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
      />
    )
  }
  const Tag = as
  return (
    <Tag
      className={`inline-text ${className ?? ''} ${value ? '' : 'placeholder'}`}
      title="Click to edit"
      onClick={() => setEditing(true)}
    >
      {value || placeholder}
    </Tag>
  )
}
