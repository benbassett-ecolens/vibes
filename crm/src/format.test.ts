import { describe, expect, it } from 'vitest'
import { initials, isRotting, relative } from './format'

describe('relative', () => {
  const now = Date.parse('2026-10-27T12:00:00Z')
  it('past and future', () => {
    expect(relative('2026-10-24T12:00:00Z', now)).toBe('3d ago')
    expect(relative('2026-10-27T14:00:00Z', now)).toBe('in 2h')
    expect(relative('2026-10-27T11:59:50Z', now)).toBe('just now')
    expect(relative(null, now)).toBe('—')
  })
})

describe('isRotting', () => {
  const now = Date.parse('2026-10-27T12:00:00Z')
  it('uses the later of stage entry and last activity', () => {
    expect(isRotting({ stage_entered_at: '2026-09-01T00:00:00Z', last_activity_at: null, rot_after_days: 14, stage_kind: 'open' }, now)).toBe(true)
    expect(isRotting({ stage_entered_at: '2026-09-01T00:00:00Z', last_activity_at: '2026-10-25T00:00:00Z', rot_after_days: 14, stage_kind: 'open' }, now)).toBe(false)
  })
  it('never rots closed deals or stages without a limit', () => {
    expect(isRotting({ stage_entered_at: '2026-01-01T00:00:00Z', last_activity_at: null, rot_after_days: null, stage_kind: 'open' }, now)).toBe(false)
    expect(isRotting({ stage_entered_at: '2026-01-01T00:00:00Z', last_activity_at: null, rot_after_days: 7, stage_kind: 'won' }, now)).toBe(false)
  })
})

describe('initials', () => {
  it('takes first two words', () => {
    expect(initials('Ben Bassett')).toBe('BB')
    expect(initials('riley')).toBe('R')
    expect(initials(null)).toBe('?')
  })
})
