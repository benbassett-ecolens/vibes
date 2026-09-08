import type { Activity, AppData, Deal, GroupBy, Metric, Scope, Stage } from './types'
import { daysUntil, dealValue, fmtMonth, quarterRange, today } from './format'

/** The subset of deals a widget looks at. */
export function scopeDeals(data: AppData, scope: Scope): Deal[] {
  const kind = (d: Deal) => data.stages.find((s) => s.id === d.stageId)?.kind ?? 'open'
  const year = today().slice(0, 4)
  const q = quarterRange()
  switch (scope) {
    case 'open':
      return data.deals.filter((d) => kind(d) === 'open')
    case 'won':
      return data.deals.filter((d) => kind(d) === 'won')
    case 'lost':
      return data.deals.filter((d) => kind(d) === 'lost')
    case 'deferred':
      return data.deals.filter((d) => kind(d) === 'deferred')
    case 'closed':
      return data.deals.filter((d) => kind(d) === 'won' || kind(d) === 'lost')
    case 'wonThisYear':
      return data.deals.filter((d) => kind(d) === 'won' && d.closeDate.startsWith(year))
    case 'closingThisQuarter':
      return data.deals.filter(
        (d) => kind(d) === 'open' && d.closeDate >= q.start && d.closeDate <= q.end,
      )
    case 'closingNext90':
      return data.deals.filter((d) => {
        if (kind(d) !== 'open' || !d.closeDate) return false
        const n = daysUntil(d.closeDate)
        return n >= 0 && n <= 90
      })
    case 'all':
    default:
      return data.deals
  }
}

export const SCOPE_LABEL: Record<Scope, string> = {
  open: 'Open deals',
  won: 'Won deals',
  lost: 'Lost deals',
  deferred: 'Deferred deals',
  closed: 'Won + lost deals',
  all: 'All deals',
  wonThisYear: 'Won this year',
  closingThisQuarter: 'Open, closing this quarter',
  closingNext90: 'Open, closing in 90 days',
}

export const METRIC_LABEL: Record<Metric, string> = {
  count: 'Number of deals',
  tcv: 'Total contract value',
  retainer: 'Retainer ACV',
  performance: 'Performance ACV',
  weighted: 'Weighted value (× stage probability)',
  avg: 'Average deal value',
  winRate: 'Win rate (won ÷ won + lost)',
}

export const GROUP_LABEL: Record<GroupBy, string> = {
  stage: 'Stage',
  owner: 'Owner',
  ecosystem: 'Ecosystem',
  businessUnit: 'Ecolens BU',
  partnerType: 'ISV / VAR / Other',
  closeMonth: 'Close month',
  forecast: 'Forecast category',
}

export const MONEY_METRICS: Metric[] = ['tcv', 'retainer', 'performance', 'weighted', 'avg']

function metricValue(d: Deal, metric: Metric, stages: Stage[]): number {
  switch (metric) {
    case 'count':
      return 1
    case 'tcv':
    case 'avg':
      return dealValue(d)
    case 'retainer':
      return d.retainerAcv ?? 0
    case 'performance':
      return d.performanceAcv ?? 0
    case 'weighted': {
      const p = stages.find((s) => s.id === d.stageId)?.probability ?? 0
      return (dealValue(d) * p) / 100
    }
    default:
      return 0
  }
}

/** Aggregate one number for a KPI tile. */
export function computeMetric(data: AppData, metric: Metric, scope: Scope): number {
  const deals = scopeDeals(data, scope)
  if (metric === 'winRate') {
    const kind = (d: Deal) => data.stages.find((s) => s.id === d.stageId)?.kind
    const won = deals.filter((d) => kind(d) === 'won').length
    const lost = deals.filter((d) => kind(d) === 'lost').length
    return won + lost === 0 ? 0 : (won / (won + lost)) * 100
  }
  const total = deals.reduce((n, d) => n + metricValue(d, metric, data.stages), 0)
  if (metric === 'avg') {
    const valued = deals.filter((d) => dealValue(d) > 0).length
    return valued === 0 ? 0 : total / valued
  }
  return total
}

export interface GroupRow {
  key: string
  label: string
  value: number
  count: number
  /** Stable color index for the entity (owner order, stage order, vocabulary order). */
  colorIndex: number
}

const ECO_ORDER = ['Microsoft', 'Acumatica', 'NetSuite', 'Sage', 'SAP-B1', 'Other']
const BU_ORDER = ['ISV Services', 'VAR Services', 'AI - SMB', 'AI - Enterprise']
const TYPE_ORDER = ['ISV', 'VAR', 'Other']
const FORECAST_ORDER = ['commit', 'forecast', 'upside', '']

/** Group deals for a bar/donut widget. Multi-value fields count a deal once per value. */
export function groupDeals(data: AppData, metric: Metric, scope: Scope, groupBy: GroupBy): GroupRow[] {
  const deals = scopeDeals(data, scope)
  const rows = new Map<string, GroupRow>()
  const add = (key: string, label: string, colorIndex: number, d: Deal) => {
    const row = rows.get(key) ?? { key, label, value: 0, count: 0, colorIndex }
    row.value += metric === 'winRate' ? 0 : metricValue(d, metric, data.stages)
    row.count += 1
    rows.set(key, row)
  }
  for (const d of deals) {
    switch (groupBy) {
      case 'stage': {
        const i = data.stages.findIndex((s) => s.id === d.stageId)
        add(d.stageId, data.stages[i]?.name ?? 'Unknown', Math.max(i, 0), d)
        break
      }
      case 'owner': {
        const i = data.people.findIndex((p) => p.id === d.ownerId)
        add(d.ownerId || 'none', data.people[i]?.name ?? 'Unassigned', Math.max(i, 0), d)
        break
      }
      case 'ecosystem': {
        const list = d.ecosystems.length ? d.ecosystems : ['Not set']
        for (const e of list) add(e, e, ECO_ORDER.indexOf(e) === -1 ? 7 : ECO_ORDER.indexOf(e), d)
        break
      }
      case 'businessUnit': {
        const list = d.businessUnits.length ? d.businessUnits : ['Not set']
        for (const b of list) add(b, b, BU_ORDER.indexOf(b) === -1 ? 7 : BU_ORDER.indexOf(b), d)
        break
      }
      case 'partnerType': {
        const list = d.partnerTypes.length ? d.partnerTypes : ['Not set']
        for (const t of list) add(t, t, TYPE_ORDER.indexOf(t) === -1 ? 7 : TYPE_ORDER.indexOf(t), d)
        break
      }
      case 'closeMonth': {
        const key = d.closeDate ? d.closeDate.slice(0, 7) : 'none'
        add(key, key === 'none' ? 'No date' : fmtMonth(key), 0, d)
        break
      }
      case 'forecast': {
        const label = d.forecast ? d.forecast[0].toUpperCase() + d.forecast.slice(1) : 'Uncategorized'
        add(d.forecast || 'none', label, FORECAST_ORDER.indexOf(d.forecast), d)
        break
      }
    }
  }
  const list = Array.from(rows.values())
  if (metric === 'avg') for (const r of list) r.value = r.count ? r.value / r.count : 0
  if (groupBy === 'closeMonth') {
    list.sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.key.localeCompare(b.key)))
  } else if (groupBy === 'stage' || groupBy === 'owner' || groupBy === 'forecast') {
    list.sort((a, b) => a.colorIndex - b.colorIndex)
  } else {
    list.sort((a, b) => b.value - a.value || b.count - a.count)
  }
  return list
}

/** Open, dated activities sorted soonest-first: 'overdue' = past due only, 'upcoming' = today onward. */
export function openActivities(data: AppData, which: 'all' | 'overdue' | 'upcoming' = 'all'): Activity[] {
  const t = today()
  return data.activities
    .filter((a) => {
      if (a.done || !a.dueDate) return false
      if (which === 'overdue') return a.dueDate < t
      if (which === 'upcoming') return a.dueDate >= t
      return true
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

/** Won deals with a renewal date, soonest first. */
export function upcomingRenewals(data: AppData): Deal[] {
  return data.deals
    .filter((d) => d.renewalDate && data.stages.find((s) => s.id === d.stageId)?.kind === 'won')
    .sort((a, b) => a.renewalDate.localeCompare(b.renewalDate))
}
