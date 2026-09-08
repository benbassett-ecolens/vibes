import type { Activity, Deal, Stage } from './types'

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const toISODate = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const today = (): string => toISODate(new Date())

export const nowISO = (): string => new Date().toISOString()

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d + days)
  return toISODate(date)
}

export function addMonths(iso: string, months: number): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1 + months, d)
  return toISODate(date)
}

/** Days from today to `iso` (negative = past). */
export function daysUntil(iso: string, from = today()): number {
  const a = new Date(`${iso}T00:00:00`)
  const b = new Date(`${from}T00:00:00`)
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 15" or "Sep 15, 2027" when the year differs from the current one. */
export function fmtDate(iso: string, opts: { year?: boolean } = {}): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  const showYear = opts.year ?? y !== new Date().getFullYear()
  return `${MONTHS[m - 1]} ${d}${showYear ? `, ${y}` : ''}`
}

export function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number)
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`
}

/** Relative wording for activity dates: "Today", "Tomorrow", "3 days overdue", "in 12 days". */
export function fmtRelative(iso: string): string {
  if (!iso) return 'No date'
  const n = daysUntil(iso)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n < 0) return `${-n} days overdue`
  if (n < 14) return `in ${n} days`
  return fmtDate(iso)
}

export function fmtMoney(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
    if (Math.abs(n) >= 1000) return `$${Math.round(n / 1000)}k`
    return `$${n}`
  }
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`
}

/** Total contract value: explicit override, else retainer + performance. */
export function dealValue(d: Deal): number {
  if (d.tcvOverride !== null) return d.tcvOverride
  return (d.retainerAcv ?? 0) + (d.performanceAcv ?? 0)
}

export function dealValueLabel(d: Deal, compact = false): string {
  const v = dealValue(d)
  if (v === 0 && d.valueTbd) return 'TBD'
  if (v === 0) return '—'
  return fmtMoney(v, { compact })
}

export function stageById(stages: Stage[], id: string): Stage | undefined {
  return stages.find((s) => s.id === id)
}

/** The next open activity for a deal, soonest first; undated last. */
export function nextActivity(activities: Activity[], dealId: string): Activity | undefined {
  const open = activities.filter((a) => a.dealId === dealId && !a.done)
  open.sort((a, b) => {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate.localeCompare(b.dueDate)
  })
  return open[0]
}

export type ActivityUrgency = 'overdue' | 'today' | 'upcoming' | 'none'

export function activityUrgency(a: Activity | undefined): ActivityUrgency {
  if (!a || !a.dueDate) return 'none'
  const n = daysUntil(a.dueDate)
  if (n < 0) return 'overdue'
  if (n === 0) return 'today'
  return 'upcoming'
}

export const ACTIVITY_ICON: Record<Activity['type'], string> = {
  call: '📞',
  meeting: '👥',
  email: '✉️',
  task: '☑️',
  deadline: '⏰',
  lunch: '☕',
}

export const ACTIVITY_LABEL: Record<Activity['type'], string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  task: 'Task',
  deadline: 'Deadline',
  lunch: 'Lunch / coffee',
}

export function quarterRange(date = new Date()): { start: string; end: string } {
  const q = Math.floor(date.getMonth() / 3)
  const start = new Date(date.getFullYear(), q * 3, 1)
  const end = new Date(date.getFullYear(), q * 3 + 3, 0)
  return { start: toISODate(start), end: toISODate(end) }
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

/** Fixed avatar palette (the dataviz categorical order) so a teammate keeps their color. */
export const AVATAR_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
]
