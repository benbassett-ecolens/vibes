/** RFC 4180 CSV parser: quotes, escaped quotes, embedded newlines, CRLF. Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** "$1,234.50" / "1 234" / "(500)" -> number; empty/junk -> null. */
export function parseMoney(v: string | undefined): number | null {
  if (v === undefined) return null
  const s = v.trim()
  if (!s) return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  const digits = s.replace(/[^0-9.]/g, '')
  if (!/\d/.test(digits)) return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/** Accepts 5/20/2026, 05/20/26, 2026-05-20, 20 May 2026 -> YYYY-MM-DD, else null. */
export function parseDate(v: string | undefined): string | null {
  if (!v) return null
  const s = v.trim()
  if (!s) return null
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export const norm = (s: string): string => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
