import { describe, expect, it } from 'vitest'
import { dealTotal, lineTotal } from './pricing'

describe('pricing', () => {
  it('one-time, monthly and percent lines', () => {
    expect(lineTotal({ pricing_type: 'one_time', quantity: 2, unit_price: 1500, term_months: 12, basis_amount: 0 })).toBe(3000)
    expect(lineTotal({ pricing_type: 'monthly', quantity: 1, unit_price: 2500, term_months: 12, basis_amount: 0 })).toBe(30000)
    expect(lineTotal({ pricing_type: 'percent', quantity: 1, unit_price: 2.5, term_months: 12, basis_amount: 400000 })).toBe(10000)
  })
  it('sums and rounds', () => {
    expect(dealTotal([
      { pricing_type: 'one_time', quantity: 3, unit_price: 0.1, term_months: 0, basis_amount: 0 },
      { pricing_type: 'monthly', quantity: 1, unit_price: 99.99, term_months: 3, basis_amount: 0 },
    ])).toBe(300.27)
  })
})
