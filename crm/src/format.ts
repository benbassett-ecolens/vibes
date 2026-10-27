export function money(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

export function compactMoney(n: number | null | undefined, currency = 'USD'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!iso) return '—'
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', opts)
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "3d ago", "in 2h", "just now". */
export function relative(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = t - now
  const abs = Math.abs(diff)
  const units: Array<[number, string]> = [
    [365 * 86400e3, 'y'],
    [30 * 86400e3, 'mo'],
    [7 * 86400e3, 'w'],
    [86400e3, 'd'],
    [3600e3, 'h'],
    [60e3, 'm'],
  ]
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms)
      return diff < 0 ? `${n}${label} ago` : `in ${n}${label}`
    }
  }
  return 'just now'
}

export function daysBetween(fromIso: string, toMs: number = Date.now()): number {
  return Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 86400e3))
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${Math.round(n * 100)}%`
}

export function toLocalInputDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInputDateTime(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Deal rotting (Pipedrive-style): idle longer than the stage allows. */
export function isRotting(deal: { last_activity_at: string | null; stage_entered_at: string; rot_after_days?: number | null; stage_kind?: string }, now: number = Date.now()): boolean {
  if (!deal.rot_after_days || deal.stage_kind !== 'open') return false
  const idleSince = deal.last_activity_at && deal.last_activity_at > deal.stage_entered_at ? deal.last_activity_at : deal.stage_entered_at
  return daysBetween(idleSince, now) >= deal.rot_after_days
}
