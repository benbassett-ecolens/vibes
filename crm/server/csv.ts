/** RFC 4180-ish CSV: quote when needed, escape quotes, CRLF line endings. */
export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const lines = [columns.map(esc).join(',')]
  for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}
