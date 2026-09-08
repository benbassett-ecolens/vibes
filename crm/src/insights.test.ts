import { describe, expect, it } from 'vitest'
import { seedData } from './seed'
import { computeMetric, groupDeals, scopeDeals, upcomingRenewals } from './insights'
import { dealValue } from './format'

const data = seedData()

describe('sheet import', () => {
  it('imports every pipeline row once', () => {
    expect(data.deals.length).toBe(47) // 46 main-tab rows + Business Fitness from the Forecast tab
    expect(new Set(data.deals.map((d) => d.id)).size).toBe(47)
  })
  it('keeps the sheet totals where they differ from retainer + performance', () => {
    const worldmax = data.deals.find((d) => d.title === 'WorldMax')!
    expect(dealValue(worldmax)).toBe(90000)
    const fazeshift = data.deals.find((d) => d.title === 'Fazeshift')!
    expect(fazeshift.tcvOverride).toBeNull()
    expect(dealValue(fazeshift)).toBe(648000)
  })
  it('gives won deals a renewal date one year out', () => {
    const idyn = data.deals.find((d) => d.title === 'iDynamics')!
    expect(idyn.renewalDate).toBe('2027-06-12')
    expect(upcomingRenewals(data)[0].title).toBe('iDynamics')
  })
  it('links every note, activity and contact to a real deal', () => {
    const ids = new Set(data.deals.map((d) => d.id))
    for (const n of data.notes) expect(ids.has(n.dealId)).toBe(true)
    for (const a of data.activities) expect(ids.has(a.dealId)).toBe(true)
    for (const c of data.contacts) expect(ids.has(c.dealId)).toBe(true)
  })
})

describe('insights', () => {
  it('sums won contract value from the sheet', () => {
    // iDynamics 103k + Data Courage 115k + Fazeshift 648k + Aqueducts 340k (+ two $0 wins)
    expect(computeMetric(data, 'tcv', 'won')).toBe(1_206_000)
    expect(computeMetric(data, 'count', 'won')).toBe(6)
  })
  it('computes win rate over won + lost only', () => {
    const won = scopeDeals(data, 'won').length
    const lost = scopeDeals(data, 'lost').length
    expect(computeMetric(data, 'winRate', 'closed')).toBeCloseTo((won / (won + lost)) * 100)
  })
  it('groups by stage in pipeline order', () => {
    const rows = groupDeals(data, 'count', 'open', 'stage')
    expect(rows.map((r) => r.label)).toEqual([
      'Cold Prospect',
      'Introduction Made',
      'Discovery of SOW',
      'Demo of Ecolens',
      'Proposal',
    ])
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(scopeDeals(data, 'open').length)
  })
  it('counts a deal once per ecosystem when grouping by ecosystem', () => {
    const rows = groupDeals(data, 'count', 'all', 'ecosystem')
    const ms = rows.find((r) => r.key === 'Microsoft')!
    expect(ms.count).toBe(data.deals.filter((d) => d.ecosystems.includes('Microsoft')).length)
  })
})
