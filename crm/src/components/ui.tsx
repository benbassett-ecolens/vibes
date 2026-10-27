import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { initials } from '../format'

// ---------- Toasts ----------
interface Toast { id: number; text: string; kind: 'info' | 'error' }
const ToastCtx = createContext<(text: string, kind?: 'info' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = (text: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { width: `min(${width}px, 100%)` } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <h2 className="grow">{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  )
}

export function ConfirmButton({ label, confirmLabel = 'Confirm?', onConfirm, className = 'btn danger sm' }: { label: string; confirmLabel?: string; onConfirm: () => void; className?: string }) {
  const [arm, setArm] = useState(false)
  useEffect(() => {
    if (!arm) return
    const t = setTimeout(() => setArm(false), 3000)
    return () => clearTimeout(t)
  }, [arm])
  return (
    <button
      className={className}
      onClick={() => {
        if (arm) {
          setArm(false)
          onConfirm()
        } else setArm(true)
      }}
    >
      {arm ? confirmLabel : label}
    </button>
  )
}

// ---------- Avatar ----------
export function Avatar({ name, src, size }: { name: string | null | undefined; src?: string | null; size?: 'lg' }) {
  return (
    <span className={`avatar ${size ?? ''}`} title={name ?? undefined}>
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  )
}

// ---------- Sortable table ----------
export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  num?: boolean
  width?: string
  render: (row: T) => ReactNode
}

export function SortableTable<T extends { id: string }>({
  columns,
  rows,
  sort,
  dir,
  onSort,
  onRowClick,
  empty = 'Nothing here yet.',
  loading,
}: {
  columns: Column<T>[]
  rows: T[]
  sort: string
  dir: 'asc' | 'desc'
  onSort: (key: string) => void
  onRowClick?: (row: T) => void
  empty?: string
  loading?: boolean
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              className={`${c.sortable ? 'sortable' : ''} ${sort === c.key ? 'sorted' : ''} ${c.num ? 'num' : ''}`}
              style={c.width ? { width: c.width } : undefined}
              onClick={c.sortable ? () => onSort(c.key) : undefined}
              aria-sort={sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
            >
              {c.label}
              {c.sortable && <span className="arrow">{sort === c.key ? (dir === 'asc' ? '▲' : '▼') : '⇅'}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="empty">{loading ? 'Loading…' : empty}</td>
          </tr>
        )}
        {rows.map((r) => (
          <tr key={r.id} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {columns.map((c) => (
              <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return <div className="pager">{total} {total === 1 ? 'record' : 'records'}</div>
  const page = Math.floor(offset / limit) + 1
  const pages = Math.ceil(total / limit)
  return (
    <div className="pager">
      <span>{offset + 1}–{Math.min(total, offset + limit)} of {total}</span>
      <span className="right" />
      <button className="btn sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>‹ Prev</button>
      <span>Page {page} of {pages}</span>
      <button className="btn sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Next ›</button>
    </div>
  )
}

/** Hook for list pages: sort key/dir + offset in URL-agnostic local state. */
export function useSort(defaultKey: string, defaultDir: 'asc' | 'desc' = 'asc') {
  const [sort, setSort] = useState(defaultKey)
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultDir)
  const toggle = (key: string) => {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc')
    else {
      setSort(key)
      setDir(key === defaultKey ? defaultDir : 'asc')
    }
  }
  return { sort, dir, toggle }
}

export function Field({ label, children, span2 }: { label: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={`field ${span2 ? 'span2' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  )
}
