import type { Cadence } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISODate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Monday-based start of week, at local midnight. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // Mon=0 ... Sun=6
  x.setDate(x.getDate() - day)
  return x
}

/** Period key for the period containing date d. */
export function periodKey(d: Date, cadence: Cadence): string {
  if (cadence === 'monthly') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  return toISODate(startOfWeek(d))
}

/** The date a period key starts on. */
export function periodStart(key: string, cadence: Cadence): Date {
  if (cadence === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    return new Date(y, m - 1, 1)
  }
  return parseISODate(key)
}

/** Shift a period key by delta periods (negative = into the past). */
export function shiftPeriod(key: string, cadence: Cadence, delta: number): string {
  if (cadence === 'monthly') {
    const [y, m] = key.split('-').map(Number)
    return periodKey(new Date(y, m - 1 + delta, 1), 'monthly')
  }
  const d = parseISODate(key)
  d.setDate(d.getDate() + 7 * delta)
  return toISODate(d)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function periodLabel(key: string, cadence: Cadence): string {
  const d = periodStart(key, cadence)
  if (cadence === 'monthly') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

/** The last n period keys ending with the current period, oldest first. */
export function lastNPeriods(n: number, cadence: Cadence, today = new Date()): string[] {
  const cur = periodKey(today, cadence)
  const keys: string[] = []
  for (let i = n - 1; i >= 0; i--) keys.push(shiftPeriod(cur, cadence, -i))
  return keys
}

/**
 * Rolling 90-day average: the mean of all recorded values whose period
 * starts within the last 90 days (inclusive of the current period).
 * Returns null when there is no data in the window.
 */
export function rolling90DayAverage(
  entries: Record<string, number>,
  cadence: Cadence,
  today = new Date(),
): number | null {
  const cutoff = new Date(today)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - 90)
  const values: number[] = []
  for (const [key, value] of Object.entries(entries)) {
    if (!Number.isFinite(value)) continue
    const start = periodStart(key, cadence)
    if (start >= cutoff && start <= today) values.push(value)
  }
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Format a number for display: thousands separators, max 2 decimals, optional unit. */
export function formatValue(n: number | null | undefined, unit = ''): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const rounded = Math.round(n * 100) / 100
  const text = rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (unit === '$') return `$${text}`
  if (unit === '%') return `${text}%`
  return unit ? `${text} ${unit}` : text
}
