import type { PricingType } from './types.js'

export interface LineInput {
  pricing_type: PricingType
  quantity: number
  unit_price: number
  term_months: number
  basis_amount: number
}

/**
 * First-year value of a line. This is what the deal's amount is built from.
 *   one_time: qty x price          monthly: qty x price x 12          percent: basis x price%
 */
export function lineTotal(l: LineInput): number {
  const q = Number(l.quantity) || 0
  const p = Number(l.unit_price) || 0
  let total: number
  if (l.pricing_type === 'percent') total = (Number(l.basis_amount) || 0) * (p / 100)
  else if (l.pricing_type === 'monthly') total = q * p * 12
  else total = q * p
  return Math.round(total * 100) / 100
}

/** Value of a line over the whole contract (monthly x contract length). */
export function lineContractTotal(l: LineInput, contractMonths: number | null): number {
  if (l.pricing_type !== 'monthly') return lineTotal(l)
  const months = contractMonths ?? 12
  return Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * months * 100) / 100
}

/** First-year deal value. */
export function dealTotal(lines: LineInput[]): number {
  return Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100
}

/** Total contract value given the contract length. */
export function contractTotal(lines: LineInput[], contractMonths: number | null): number {
  return Math.round(lines.reduce((s, l) => s + lineContractTotal(l, contractMonths), 0) * 100) / 100
}

export const PRICING_LABEL: Record<PricingType, string> = { one_time: 'One-time $', monthly: 'Monthly $', percent: '% of basis' }

export const DEAL_TYPES = ['new_business', 'renewal', 'upsell'] as const
export const DEAL_TYPE_LABEL: Record<(typeof DEAL_TYPES)[number], string> = { new_business: 'New business', renewal: 'Renewal', upsell: 'Upsell' }
