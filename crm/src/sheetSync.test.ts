import { describe, expect, it } from 'vitest'
import { seedData } from './seed'
import { SHEET_CSV_2026_09_08 } from './sheetSnapshot'
import { REMOVED_TAG, applySheetRows, parseCsv, parseMoney, parseSheetDate, rowsFromCsv } from './sheetSync'

const OPTS = { today: '2026-09-10', now: '2026-09-10T12:00:00.000Z' }
const baseline = rowsFromCsv(SHEET_CSV_2026_09_08)

describe('csv parsing', () => {
  it('handles quoted commas, doubled quotes and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
  })
  it('reads all 46 pipeline rows from the Sep 8 export', () => {
    expect(baseline.length).toBe(46)
    expect(baseline[0]).toMatchObject({ owner: 'David Gersten', name: 'Rockton Software', tcv: '$360,000' })
  })
  it('parses money and dates the way the sheet writes them', () => {
    expect(parseMoney('$90,000')).toBe(90000)
    expect(parseMoney('TBD')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseSheetDate('9/15/2026')).toBe('2026-09-15')
    expect(parseSheetDate('10/01/2026')).toBe('2026-10-01')
    expect(parseSheetDate('')).toBe('')
  })
})

describe('applySheetRows', () => {
  it('is a no-op when the sheet matches the snapshot', () => {
    const data = seedData()
    const { data: next, summary } = applySheetRows(data, baseline, OPTS)
    expect(summary.created).toEqual([])
    expect(summary.updated).toEqual([])
    expect(summary.notesAdded).toEqual([])
    expect(summary.removed).toEqual([])
    expect(next.deals.length).toBe(data.deals.length)
    expect(next.notes.length).toBe(data.notes.length)
  })

  it('applies a stage / value change from the sheet', () => {
    const data = seedData()
    const rows = baseline.map((r) =>
      r.name === 'Yavrio' ? { ...r, stage: 'Closed Won', retainer: '$100,000', tcv: '$190,000' } : r,
    )
    const { data: next, summary } = applySheetRows(data, rows, OPTS)
    const yavrio = next.deals.find((d) => d.title === 'Yavrio')!
    expect(summary.updated).toEqual(['Yavrio'])
    expect(yavrio.stageId).toBe('s-won')
    expect(yavrio.retainerAcv).toBe(100000)
    expect(yavrio.tcvOverride).toBeNull() // 100k + 90k = 190k, so no override needed
    expect(yavrio.renewalDate).toBe('2027-09-15') // won → renews a year after close
    expect(yavrio.sheetSnapshot?.stage).toBe('Closed Won')
  })

  it('keeps CRM edits to cells the sheet did not change', () => {
    const data = seedData()
    data.deals = data.deals.map((d) => (d.title === 'Dokka' ? { ...d, stageId: 's-proposal', product: 'AP automation' } : d))
    const rows = baseline.map((r) => (r.name === 'Dokka' ? { ...r, close: '11/30/2026' } : r))
    const { data: next } = applySheetRows(data, rows, OPTS)
    const dokka = next.deals.find((d) => d.title === 'Dokka')!
    expect(dokka.stageId).toBe('s-proposal') // CRM edit kept
    expect(dokka.product).toBe('AP automation') // CRM edit kept
    expect(dokka.closeDate).toBe('2026-11-30') // sheet change applied
  })

  it('creates deals for new rows, including an unknown owner, and adds their note', () => {
    const data = seedData()
    const rows = [
      ...baseline,
      {
        owner: 'Sam New',
        name: 'Acme Robotics',
        product: 'Warehouse robots',
        bu: 'ISV Services',
        type: 'ISV',
        eco: 'NetSuite, Other',
        retainer: '$60,000',
        performance: '$30,000',
        tcv: '$90,000',
        stage: 'Discovery of SOW',
        close: '12/15/2026',
        notes: 'Intro call went well',
      },
    ]
    const { data: next, summary } = applySheetRows(data, rows, OPTS)
    expect(summary.created).toEqual(['Acme Robotics'])
    expect(summary.peopleAdded).toEqual(['Sam New'])
    const acme = next.deals.find((d) => d.title === 'Acme Robotics')!
    expect(acme.stageId).toBe('s-discovery')
    expect(acme.ecosystems).toEqual(['NetSuite', 'Other'])
    expect(next.people.find((p) => p.id === acme.ownerId)?.name).toBe('Sam New')
    expect(next.notes.find((n) => n.dealId === acme.id)?.body).toBe('Intro call went well')
  })

  it('appends a note when the Notes cell changes and is idempotent on re-run', () => {
    const data = seedData()
    const rows = baseline.map((r) => (r.name === 'CRSTL' ? { ...r, notes: 'Signed SOW 9/10!' } : r))
    const first = applySheetRows(data, rows, OPTS)
    expect(first.summary.notesAdded).toEqual(['CRSTL'])
    const crstlNotes = first.data.notes.filter((n) => n.dealId === 'd-crstl')
    expect(crstlNotes[0].body).toBe('Signed SOW 9/10!')
    expect(crstlNotes.length).toBe(2) // old sheet note is kept
    const second = applySheetRows(first.data, rows, OPTS)
    expect(second.summary.notesAdded).toEqual([])
    expect(second.data.notes.length).toBe(first.data.notes.length)
  })

  it('tags deals whose rows left the sheet instead of deleting them', () => {
    const data = seedData()
    const rows = baseline.filter((r) => r.name !== 'Omzy')
    const { data: next, summary } = applySheetRows(data, rows, OPTS)
    expect(summary.removed).toEqual(['Omzy'])
    expect(next.deals.find((d) => d.title === 'Omzy')?.tags).toContain(REMOVED_TAG)
    // Coming back clears the tag.
    const back = applySheetRows(next, baseline, OPTS)
    expect(back.data.deals.find((d) => d.title === 'Omzy')?.tags).not.toContain(REMOVED_TAG)
  })

  it('creates an unknown stage as an open stage before the closed ones', () => {
    const data = seedData()
    const rows = baseline.map((r) => (r.name === 'Miter' ? { ...r, stage: 'Qualified' } : r))
    const { data: next, summary } = applySheetRows(data, rows, OPTS)
    expect(summary.stagesAdded).toEqual(['Qualified'])
    const idx = next.stages.findIndex((s) => s.name === 'Qualified')
    expect(next.stages[idx].kind).toBe('open')
    expect(next.stages[idx + 1].kind).toBe('won')
  })
})
