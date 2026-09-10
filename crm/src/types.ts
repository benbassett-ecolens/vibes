/** A teammate who can own deals and activities (the sheet's "Director/CPM"). */
export interface Person {
  id: string
  name: string
  initials: string
  /** Hex color used for the avatar chip; chosen from a fixed palette. */
  color: string
}

export type StageKind = 'open' | 'won' | 'lost' | 'deferred'

/** One column on the pipeline board. */
export interface Stage {
  id: string
  name: string
  kind: StageKind
  /** 0–100, used for the weighted pipeline figure. */
  probability: number
}

export type ForecastCategory = '' | 'commit' | 'forecast' | 'upside'

export interface Deal {
  id: string
  /** Prospect / organization name — the deal is named after the account. */
  title: string
  ownerId: string
  stageId: string
  /** What the prospect sells (the sheet's "Function"). */
  product: string
  /** Ecolens business units engaged, e.g. "ISV Services". */
  businessUnits: string[]
  /** ISV / VAR / Other. */
  partnerTypes: string[]
  /** ERP ecosystems the prospect plays in. */
  ecosystems: string[]
  retainerAcv: number | null
  performanceAcv: number | null
  /** Explicit total; null means "retainer + performance". */
  tcvOverride: number | null
  /** Pricing not yet known — shown as TBD instead of $0. */
  valueTbd: boolean
  /** Expected close (open deals) or actual close (won/lost). yyyy-mm-dd or ''. */
  closeDate: string
  /** For won deals: when the contract comes up for renewal. */
  renewalDate: string
  contractTermMonths: number
  forecast: ForecastCategory
  lostReason: string
  /** Free-form label chips. */
  tags: string[]
  createdAt: string
  /** Where the record came from — 'sheet' rows were imported from the pipeline spreadsheet. */
  source: 'sheet' | 'app'
  /** Normalized "Prospect Name" that links this deal to a sheet row; '' when not on the sheet. */
  sheetKey: string
  /** The sheet row's cells as of the last sync — the baseline for detecting sheet-side changes. */
  sheetSnapshot: SheetRow | null
}

/** One row of the pipeline sheet, cells kept as strings exactly as exported. */
export interface SheetRow {
  owner: string
  name: string
  product: string
  bu: string
  type: string
  eco: string
  retainer: string
  performance: string
  tcv: string
  stage: string
  close: string
  notes: string
}

/** Workspace-level settings and status (single document, id 'sync'). */
export interface Meta {
  id: string
  lastSheetSyncAt: string
  lastSheetSyncSummary: string
  lastSheetSyncBy: string
  /** Re-read the sheet automatically when the page opens and the last sync is stale. */
  autoSync: boolean
}

export interface Note {
  id: string
  dealId: string
  body: string
  authorId: string
  /** yyyy-mm-dd — the date the note refers to / was written. */
  date: string
  createdAt: string
}

export type ActivityType = 'call' | 'meeting' | 'email' | 'task' | 'deadline' | 'lunch'

export interface Activity {
  id: string
  dealId: string
  type: ActivityType
  subject: string
  /** yyyy-mm-dd or '' for unscheduled. */
  dueDate: string
  done: boolean
  ownerId: string
  note: string
  createdAt: string
}

export interface Contact {
  id: string
  name: string
  title: string
  organization: string
  dealId: string
  email: string
  phone: string
  note: string
}

export type WidgetType = 'kpi' | 'bar' | 'donut' | 'list' | 'table'
export type Metric = 'count' | 'tcv' | 'retainer' | 'performance' | 'weighted' | 'avg' | 'winRate'
export type Scope =
  | 'open'
  | 'won'
  | 'lost'
  | 'deferred'
  | 'all'
  | 'closed'
  | 'wonThisYear'
  | 'closingThisQuarter'
  | 'closingNext90'
export type GroupBy =
  | 'stage'
  | 'owner'
  | 'ecosystem'
  | 'businessUnit'
  | 'partnerType'
  | 'closeMonth'
  | 'forecast'
export type ListKind = 'renewals' | 'nextActivities' | 'overdue' | 'topOpen' | 'recentlyWon' | 'stale'
export type WidgetSize = 'sm' | 'md' | 'lg'

export interface Widget {
  id: string
  dashboardId: string
  title: string
  type: WidgetType
  metric: Metric
  scope: Scope
  groupBy: GroupBy
  listKind: ListKind
  size: WidgetSize
  /** How many rows a list/table shows. */
  limit: number
}

export interface Dashboard {
  id: string
  name: string
}

export interface AppData {
  people: Person[]
  stages: Stage[]
  deals: Deal[]
  notes: Note[]
  activities: Activity[]
  contacts: Contact[]
  dashboards: Dashboard[]
  widgets: Widget[]
  meta: Meta[]
}

export const COLLECTIONS = [
  'people',
  'stages',
  'deals',
  'notes',
  'activities',
  'contacts',
  'dashboards',
  'widgets',
  'meta',
] as const
export type CollectionName = (typeof COLLECTIONS)[number]
