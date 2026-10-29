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
