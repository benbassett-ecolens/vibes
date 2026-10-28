import type { PricingType } from './types.js'

export interface LineInput {
  pricing_type: PricingType
  quantity: number
  unit_price: number
  term_months: number
  basis_amount: number
}

/** Line total for a deal product. percent: basis x price%. monthly: qty x price x months. one_time: qty x price. */
export function lineTotal(l: LineInput): number {
  const q = Number(l.quantity) || 0
  const p = Number(l.unit_price) || 0
  let total: number
  if (l.pricing_type === 'percent') total = (Number(l.basis_amount) || 0) * (p / 100)
  else if (l.pricing_type === 'monthly') total = q * p * (Number(l.term_months) || 0)
  else total = q * p
  return Math.round(total * 100) / 100
}

export function dealTotal(lines: LineInput[]): number {
  return Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100
}

export const PRICING_LABEL: Record<PricingType, string> = { one_time: 'One-time', monthly: 'Monthly', percent: '% of basis' }
