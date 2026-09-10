/**
 * Keeps the CRM in step with the Ecolens Sales Pipeline sheet.
 *
 * The sheet has no row ids, so a deal is linked to a row by its normalized
 * "Prospect Name" (`deal.sheetKey`). Each linked deal also keeps the row's
 * cells as of the last sync (`deal.sheetSnapshot`). A sync is a three-way
 * merge per cell:
 *
 *   sheet cell changed since the snapshot  → the sheet wins (CRM field updated)
 *   sheet cell unchanged, CRM field edited → the CRM edit is kept
 *   new row                                → new deal (plus its note)
 *   Notes cell changed                     → a new note is appended (old ones stay)
 *   row gone from the sheet                → deal tagged, never deleted
 *
 * Everything here is pure so it can be unit-tested; the connector call that
 * fetches the CSV lives in useSheetSync.
 */
import type { AppData, Deal, Note, Person, SheetRow, Stage } from './types'
import { AVATAR_COLORS, addMonths, initialsOf } from './format'

export const SHEET_FILE_ID = '1-Pcn2rGjkQVBK3wTy0mm8ZzQKG1Z8aBULBf7fDeaatE'
export const REMOVED_TAG = 'Removed from sheet'

/** RFC-4180-ish CSV parser: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const HEADERS: Record<keyof SheetRow, string> = {
  owner: 'director/cpm',
  name: 'prospect name',
  product: 'function',
  bu: 'ecolens bu',
  type: 'isv/var/other',
  eco: 'ecosystem',
  retainer: 'retainer acv',
  performance: 'performance acv',
  tcv: 'total contract value',
  stage: 'deal stage',
  close: 'close date',
  notes: 'notes',
}

/** Rows of the first table in the CSV whose header matches the pipeline layout. */
export function rowsFromCsv(text: string): SheetRow[] {
  const grid = parseCsv(text)
  const headerIdx = grid.findIndex((r) => r.some((c) => c.trim().toLowerCase() === HEADERS.name))
  if (headerIdx === -1) throw new Error('Could not find a "Prospect Name" column in the sheet.')
  const header = grid[headerIdx].map((c) => c.trim().toLowerCase())
  const col = (key: keyof SheetRow) => header.indexOf(HEADERS[key])
  const idx = Object.fromEntries(
    (Object.keys(HEADERS) as Array<keyof SheetRow>).map((k) => [k, col(k)]),
  ) as Record<keyof SheetRow, number>
  const rows: SheetRow[] = []
  for (const r of grid.slice(headerIdx + 1)) {
    const cell = (k: keyof SheetRow) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '')
    const name = cell('name')
    if (!name) {
      // A blank row ends the table (the forecast table below has a different layout).
      if (r.every((c) => !c.trim())) break
      continue
    }
    if (name.toLowerCase() === HEADERS.name) continue
    rows.push({
      owner: cell('owner'),
      name,
      product: cell('product'),
      bu: cell('bu'),
      type: cell('type'),
      eco: cell('eco'),
      retainer: cell('retainer'),
      performance: cell('performance'),
      tcv: cell('tcv'),
      stage: cell('stage'),
      close: cell('close'),
      notes: cell('notes'),
    })
  }
  return rows
}

export const sheetKeyOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const slug = (s: string) => sheetKeyOf(s).replace(/\s+/g, '-')

const PLACEHOLDER = /^select one or more$/i

export const splitList = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !PLACEHOLDER.test(x))

/** "$90,000" → 90000; "" or "TBD" → null. */
export function parseMoney(s: string): number | null {
  const raw = s.replace(/[$,\s]/g, '')
  if (!raw || /^tbd$/i.test(raw)) return null
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** "9/15/2026" or "10/01/2026" → "2026-09-15"; anything else → ''. */
export function parseSheetDate(s: string): string {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return ''
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

const cleanProduct = (s: string) => (/^n\/a$/i.test(s.trim()) ? '' : s.trim())

/** Small stable hash so two viewers syncing the same change write the same note id. */
export function hashText(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export interface SyncSummary {
  created: string[]
  updated: string[]
  notesAdded: string[]
  removed: string[]
  unchanged: number
  peopleAdded: string[]
  stagesAdded: string[]
}

export function summaryText(s: SyncSummary): string {
  const parts: string[] = []
  if (s.created.length) parts.push(`${s.created.length} new`)
  if (s.updated.length) parts.push(`${s.updated.length} updated`)
  if (s.notesAdded.length) parts.push(`${s.notesAdded.length} notes`)
  if (s.removed.length) parts.push(`${s.removed.length} removed from sheet`)
  if (s.peopleAdded.length) parts.push(`${s.peopleAdded.length} new owners`)
  if (s.stagesAdded.length) parts.push(`${s.stagesAdded.length} new stages`)
  return parts.length ? parts.join(', ') : 'No changes'
}

const SHEET_FIELDS: Array<keyof SheetRow> = [
  'owner',
  'product',
  'bu',
  'type',
  'eco',
  'retainer',
  'performance',
  'tcv',
  'stage',
  'close',
]

/** Apply the sheet rows to the app data. Pure: returns new data and a summary. */
export function applySheetRows(
  data: AppData,
  rows: SheetRow[],
  opts: { today: string; now: string },
): { data: AppData; summary: SyncSummary } {
  const summary: SyncSummary = {
    created: [],
    updated: [],
    notesAdded: [],
    removed: [],
    unchanged: 0,
    peopleAdded: [],
    stagesAdded: [],
  }
  const people = [...data.people]
  const stages = [...data.stages]
  const notes = [...data.notes]

  const personFor = (name: string): string => {
    const n = name.trim()
    if (!n) return ''
    const found = people.find((p) => p.name.trim().toLowerCase() === n.toLowerCase())
    if (found) return found.id
    const person: Person = {
      id: `p-sheet-${slug(n)}`,
      name: n,
      initials: initialsOf(n),
      color: AVATAR_COLORS[people.length % AVATAR_COLORS.length],
    }
    people.push(person)
    summary.peopleAdded.push(n)
    return person.id
  }

  const stageFor = (name: string): Stage | undefined => {
    const n = name.trim()
    if (!n) return undefined
    const found = stages.find((s) => s.name.trim().toLowerCase() === n.toLowerCase())
    if (found) return found
    const stage: Stage = { id: `s-sheet-${slug(n)}`, name: n, kind: 'open', probability: 50 }
    const firstClosed = stages.findIndex((s) => s.kind !== 'open')
    stages.splice(firstClosed === -1 ? stages.length : firstClosed, 0, stage)
    summary.stagesAdded.push(n)
    return stage
  }

  /** CRM field values derived from a row. */
  const derive = (row: SheetRow, current?: Deal): Partial<Deal> => {
    const retainer = parseMoney(row.retainer)
    const performance = parseMoney(row.performance)
    const tcv = parseMoney(row.tcv)
    const sum = (retainer ?? 0) + (performance ?? 0)
    const stage = stageFor(row.stage)
    const close = parseSheetDate(row.close)
    const out: Partial<Deal> = {}
    out.ownerId = personFor(row.owner) || current?.ownerId || ''
    out.product = cleanProduct(row.product)
    out.businessUnits = splitList(row.bu)
    out.partnerTypes = splitList(row.type)
    out.ecosystems = splitList(row.eco)
    out.retainerAcv = retainer
    out.performanceAcv = performance
    out.tcvOverride = tcv !== null && tcv !== sum ? tcv : null
    out.valueTbd = /tbd/i.test(`${row.retainer} ${row.performance}`)
    if (stage) out.stageId = stage.id
    out.closeDate = close
    return out
  }

  /** Which CRM fields a given sheet column drives. */
  const fieldsFor: Record<keyof SheetRow, Array<keyof Deal>> = {
    owner: ['ownerId'],
    name: [],
    product: ['product'],
    bu: ['businessUnits'],
    type: ['partnerTypes'],
    eco: ['ecosystems'],
    retainer: ['retainerAcv', 'tcvOverride', 'valueTbd'],
    performance: ['performanceAcv', 'tcvOverride', 'valueTbd'],
    tcv: ['tcvOverride'],
    stage: ['stageId'],
    close: ['closeDate'],
    notes: [],
  }

  const byKey = new Map<string, Deal>()
  for (const d of data.deals) {
    const key = d.sheetKey || (d.source === 'sheet' ? sheetKeyOf(d.title) : '')
    if (key && !byKey.has(key)) byKey.set(key, d)
  }

  const seen = new Set<string>()
  const patched = new Map<string, Deal>()
  const created: Deal[] = []

  for (const row of rows) {
    const key = sheetKeyOf(row.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const existing = byKey.get(key) ?? data.deals.find((d) => sheetKeyOf(d.title) === key)

    if (!existing) {
      const derived = derive(row)
      const id = `d-sheet-${slug(row.name)}`
      const stage = stages.find((s) => s.id === derived.stageId)
      const deal: Deal = {
        id,
        title: row.name,
        ownerId: derived.ownerId ?? '',
        stageId: derived.stageId ?? stages.find((s) => s.kind === 'open')?.id ?? stages[0]?.id ?? '',
        product: derived.product ?? '',
        businessUnits: derived.businessUnits ?? [],
        partnerTypes: derived.partnerTypes ?? [],
        ecosystems: derived.ecosystems ?? [],
        retainerAcv: derived.retainerAcv ?? null,
        performanceAcv: derived.performanceAcv ?? null,
        tcvOverride: derived.tcvOverride ?? null,
        valueTbd: derived.valueTbd ?? false,
        closeDate: derived.closeDate ?? '',
        renewalDate:
          stage?.kind === 'won' && derived.closeDate ? addMonths(derived.closeDate, 12) : '',
        contractTermMonths: 12,
        forecast: '',
        lostReason: '',
        tags: [],
        createdAt: opts.now,
        source: 'sheet',
        sheetKey: key,
        sheetSnapshot: row,
      }
      created.push(deal)
      summary.created.push(row.name)
      if (row.notes) {
        notes.unshift({
          id: `n-sheet-${id}-${hashText(row.notes)}`,
          dealId: id,
          body: row.notes,
          authorId: deal.ownerId,
          date: opts.today,
          createdAt: opts.now,
        })
        summary.notesAdded.push(row.name)
      }
      continue
    }

    const snap = existing.sheetSnapshot ?? null
    const derived = derive(row, existing)
    const patch: Partial<Deal> = {}
    let changed = false
    for (const col of SHEET_FIELDS) {
      // No snapshot yet: treat every cell as authoritative for its fields.
      const cellChanged = snap ? row[col] !== snap[col] : true
      if (!cellChanged) continue
      for (const f of fieldsFor[col]) {
        const next = derived[f]
        if (next === undefined) continue
        if (JSON.stringify(next) !== JSON.stringify(existing[f])) {
          ;(patch as Record<string, unknown>)[f] = next
          changed = true
        }
      }
    }
    if (patch.stageId) {
      const stage = stages.find((s) => s.id === patch.stageId)
      const close = patch.closeDate ?? existing.closeDate
      if (stage?.kind === 'won' && !existing.renewalDate && close) {
        patch.renewalDate = addMonths(close, existing.contractTermMonths || 12)
      }
    }
    const notesChanged = row.notes && (snap ? row.notes !== snap.notes : true)
    if (notesChanged) {
      const already = notes.some((n) => n.dealId === existing.id && n.body.trim() === row.notes.trim())
      if (!already) {
        notes.unshift({
          id: `n-sheet-${existing.id}-${hashText(row.notes)}`,
          dealId: existing.id,
          body: row.notes,
          authorId: patch.ownerId ?? existing.ownerId,
          date: opts.today,
          createdAt: opts.now,
        })
        summary.notesAdded.push(existing.title)
        changed = true
      }
    }
    const tags = existing.tags.includes(REMOVED_TAG)
      ? existing.tags.filter((t) => t !== REMOVED_TAG)
      : existing.tags
    if (tags !== existing.tags) changed = true
    const snapshotChanged = JSON.stringify(snap) !== JSON.stringify(row) || existing.sheetKey !== key
    if (changed) summary.updated.push(existing.title)
    else if (!snapshotChanged) summary.unchanged += 1
    if (changed || snapshotChanged) {
      patched.set(existing.id, { ...existing, ...patch, tags, sheetKey: key, sheetSnapshot: row })
    }
  }

  // Rows that disappeared from the sheet: tag, don't delete.
  for (const d of data.deals) {
    const key = d.sheetKey
    if (key && !seen.has(key) && !d.tags.includes(REMOVED_TAG)) {
      const base = patched.get(d.id) ?? d
      patched.set(d.id, { ...base, tags: [...base.tags, REMOVED_TAG] })
      summary.removed.push(d.title)
    }
  }

  const deals = [...created, ...data.deals.map((d) => patched.get(d.id) ?? d)]
  const noteIds = new Set<string>()
  const dedupedNotes: Note[] = notes.filter((n) => (noteIds.has(n.id) ? false : (noteIds.add(n.id), true)))
  return { data: { ...data, people, stages, deals, notes: dedupedNotes }, summary }
}

/** Decode the Drive connector's CSV export (base64 → UTF-8 text). */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}
