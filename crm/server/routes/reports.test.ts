import { describe, expect, it } from 'vitest'
import { salesVelocityPerDay, winRate } from './reports.js'

describe('report math', () => {
  it('win rate over closed deals', () => {
    expect(winRate(3, 1)).toBe(0.75)
    expect(winRate(0, 0)).toBeNull()
  })
  it('sales velocity = open * rate * avg size / cycle', () => {
    expect(salesVelocityPerDay(10, 0.5, 1000, 20)).toBe(250)
    expect(salesVelocityPerDay(10, null, 1000, 20)).toBeNull()
    expect(salesVelocityPerDay(10, 0.5, 1000, 0)).toBeNull()
  })
})

describe('report filters', () => {
  it('defaults to closed-date basis over the last six months', async () => {
    const { readFilters, rangeColumn, uplift } = await import('./reports.js')
    const f = readFilters({}, new Date('2026-11-06T12:00:00Z'))
    expect(f.basis).toBe('closed')
    expect(f.from).toBe('2026-06-01')
    expect(f.to).toBe('2026-11-06')
    expect(rangeColumn('expected')).toBe('d.expected_close_date')
    expect(uplift(110, 100)).toBeCloseTo(0.1)
    expect(uplift(50, 0)).toBeNull()
  })
  it('ignores malformed ids and unknown deal types', async () => {
    const { readFilters } = await import('./reports.js')
    const f = readFilters({ product_id: 'nope', deal_type: 'weird', lead_source: ' Referral ', basis: 'created', stage_id: '66411e91-e50e-47b7-81bc-936304172e4e' })
    expect(f.productId).toBeNull()
    expect(f.dealType).toBeNull()
    expect(f.leadSource).toBe('Referral')
    expect(f.basis).toBe('created')
    expect(f.stageId).toBe('66411e91-e50e-47b7-81bc-936304172e4e')
  })
})

describe('previous window', () => {
  it('is the same length, ending the day before the range starts', async () => {
    const { previousWindow } = await import('./reports.js')
    expect(previousWindow('2026-10-01', '2026-10-31')).toEqual({ from: '2026-08-31', to: '2026-09-30' })
    expect(previousWindow('2026-11-06', '2026-11-06')).toEqual({ from: '2026-11-05', to: '2026-11-05' })
  })
})
