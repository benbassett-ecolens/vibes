import type { RockStatus } from '../types'
import { useApp } from '../store'

const STATUS_LABEL: Record<RockStatus, string> = {
  on_track: 'On Track',
  off_track: 'Off Track',
  completed: 'Completed',
}

/** The 3-way status selector used on Rocks and their milestones. */
export function StatusSelect({
  value,
  onChange,
  title,
}: {
  value: RockStatus
  onChange: (status: RockStatus) => void
  title?: string
}) {
  return (
    <select
      className={`status-select status-${value}`}
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value as RockStatus)}
    >
      {(Object.keys(STATUS_LABEL) as RockStatus[]).map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  )
}

export function PersonSelect({
  value,
  onChange,
  allowEmpty = true,
  emptyLabel = '—',
}: {
  value: string
  onChange: (id: string) => void
  allowEmpty?: boolean
  emptyLabel?: string
}) {
  const { data } = useApp()
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {data.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

export function usePersonName(): (id: string) => string {
  const { data } = useApp()
  return (id: string) => data.people.find((p) => p.id === id)?.name ?? '—'
}

/** Number input that reports null when cleared. */
export function NumberInput({
  value,
  onChange,
  placeholder,
  className,
  min,
  max,
}: {
  value: number | null | undefined
  onChange: (value: number | null) => void
  placeholder?: string
  className?: string
  min?: number
  max?: number
}) {
  return (
    <input
      type="number"
      className={className}
      value={value ?? ''}
      placeholder={placeholder}
      min={min}
      max={max}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') return onChange(null)
        const n = Number(raw)
        onChange(Number.isFinite(n) ? n : null)
      }}
    />
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="empty-state">{children}</p>
}
