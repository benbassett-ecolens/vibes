import { describe, expect, it } from 'vitest'
import { contractTotal, dealTotal, lineTotal } from './pricing'

const retainer = { pricing_type: 'monthly' as const, quantity: 1, unit_price: 2500, term_months: 12, basis_amount: 0 }
const sql = { pricing_type: 'one_time' as const, quantity: 1, unit_price: 15000, term_months: 0, basis_amount: 0 }
const closedWon = { pricing_type: 'one_time' as const, quantity: 1, unit_price: 8000, term_months: 0, basis_amount: 0 }

describe('pricing', () => {
  it('first-year value: monthly x 12, one-time as entered, percent of basis', () => {
    expect(lineTotal(retainer)).toBe(30000)
    expect(lineTotal(sql)).toBe(15000)
    expect(lineTotal({ pricing_type: 'percent', quantity: 1, unit_price: 2.5, term_months: 12, basis_amount: 400000 })).toBe(10000)
  })
  it('deal value = retainer x 12 + SQL + closed won', () => {
    expect(dealTotal([retainer, sql, closedWon])).toBe(53000)
  })
  it('contract value scales monthly lines by contract length', () => {
    expect(contractTotal([retainer, sql, closedWon], 36)).toBe(113000)
    expect(contractTotal([retainer, sql, closedWon], null)).toBe(53000)
  })
  it('rounds', () => {
    expect(dealTotal([{ pricing_type: 'one_time', quantity: 3, unit_price: 0.1, term_months: 0, basis_amount: 0 }])).toBe(0.3)
  })
})
