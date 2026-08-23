import { describe, expect, it } from 'vitest'
import {
  lastNPeriods,
  periodKey,
  periodLabel,
  rolling90DayAverage,
  shiftPeriod,
  startOfWeek,
} from './periods'

describe('periodKey', () => {
  it('uses the Monday of the week for weekly cadence', () => {
    // 2026-08-23 is a Sunday; its week starts Monday 2026-08-17
    expect(periodKey(new Date(2026, 7, 23), 'weekly')).toBe('2026-08-17')
    // A Monday maps to itself
    expect(periodKey(new Date(2026, 7, 17), 'weekly')).toBe('2026-08-17')
  })

  it('uses yyyy-mm for monthly cadence', () => {
    expect(periodKey(new Date(2026, 7, 23), 'monthly')).toBe('2026-08')
  })
})

describe('startOfWeek', () => {
  it('handles month boundaries', () => {
    // 2026-09-01 is a Tuesday; week starts Monday 2026-08-31
    const s = startOfWeek(new Date(2026, 8, 1))
    expect(s.getFullYear()).toBe(2026)
    expect(s.getMonth()).toBe(7)
    expect(s.getDate()).toBe(31)
  })
})

describe('shiftPeriod', () => {
  it('shifts weeks across month boundaries', () => {
    expect(shiftPeriod('2026-08-03', 'weekly', -1)).toBe('2026-07-27')
    expect(shiftPeriod('2026-08-31', 'weekly', 1)).toBe('2026-09-07')
  })

  it('shifts months across year boundaries', () => {
    expect(shiftPeriod('2026-01', 'monthly', -1)).toBe('2025-12')
    expect(shiftPeriod('2025-12', 'monthly', 1)).toBe('2026-01')
  })
})

describe('lastNPeriods', () => {
  it('returns n keys oldest-first ending at the current period', () => {
    const keys = lastNPeriods(3, 'weekly', new Date(2026, 7, 23))
    expect(keys).toEqual(['2026-08-03', '2026-08-10', '2026-08-17'])
  })

  it('works for monthly cadence', () => {
    const keys = lastNPeriods(3, 'monthly', new Date(2026, 0, 15))
    expect(keys).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('rolling90DayAverage', () => {
  const today = new Date(2026, 7, 23) // 2026-08-23

  it('averages only entries whose period starts within the last 90 days', () => {
    const entries: Record<string, number> = {
      '2026-08-17': 10, // this week — in window
      '2026-08-10': 20, // in window
      '2026-05-25': 30, // 90 days before 2026-08-23 is 2026-05-25 — inclusive boundary
      '2026-05-18': 999, // outside the window — excluded
    }
    expect(rolling90DayAverage(entries, 'weekly', today)).toBe(20)
  })

  it('returns null with no data in the window', () => {
    expect(rolling90DayAverage({}, 'weekly', today)).toBeNull()
    expect(rolling90DayAverage({ '2025-01-06': 5 }, 'weekly', today)).toBeNull()
  })

  it('handles monthly cadence (~3 months in 90 days)', () => {
    const entries: Record<string, number> = {
      '2026-08': 100,
      '2026-07': 200,
      '2026-06': 300,
      '2026-04': 999, // April 1 is > 90 days before Aug 23 — excluded
    }
    expect(rolling90DayAverage(entries, 'monthly', today)).toBe(200)
  })

  it('ignores future-dated entries', () => {
    const entries: Record<string, number> = {
      '2026-08-17': 10,
      '2026-09-07': 500, // future week — excluded
    }
    expect(rolling90DayAverage(entries, 'weekly', today)).toBe(10)
  })
})

describe('periodLabel', () => {
  it('formats weekly and monthly labels', () => {
    expect(periodLabel('2026-08-17', 'weekly')).toBe('Aug 17')
    expect(periodLabel('2026-08', 'monthly')).toBe('Aug 2026')
  })
})
