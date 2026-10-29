// Types shared by the server (API responses) and the client.

export type Role = 'admin' | 'member'

export interface User {
  id: string
  email: string
  name: string
  picture_url: string | null
  role: Role
  is_active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export type StageKind = 'open' | 'won' | 'lost'
export type DealType = 'new_business' | 'renewal' | 'upsell'
export type DealFlag = 'close_overdue' | 'activity_overdue' | 'no_next_step' | 'rotting'
export type ForecastCategory = 'pipeline' | 'best_case' | 'commit' | 'closed' | 'omitted'

export interface Stage {
  id: string
  pipeline_id: string
  name: string
  position: number
  probability: number
  kind: StageKind
  forecast_category: ForecastCategory
  rot_after_days: number | null
  color: string
  created_at: string
  updated_at: string
}

export interface Pipeline {
  id: string
  name: string
  is_default: boolean
  position: number
  created_at: string
  updated_at: string
  stages: Stage[]
}

export interface Company {
  id: string
  name: string
  domain: string | null
  website: string | null
  industry: string | null
  phone: string | null
  address: string | null
  notes: string | null
  owner_id: string | null
  owner_name?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  // list-view aggregates
  contact_count?: number
  open_deal_count?: number
  open_deal_value?: number
}

export interface Contact {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  title: string | null
  notes: string | null
  company_id: string | null
  company_name?: string | null
  owner_id: string | null
  owner_name?: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  last_activity_at?: string | null
}

export interface Deal {
  id: string
  title: string
  pipeline_id: string
  stage_id: string
  stage_name?: string
  stage_kind?: StageKind
  amount: number
  currency: string
  company_id: string | null
  company_name?: string | null
  contact_id: string | null
  contact_name?: string | null
  owner_id: string | null
  owner_name?: string | null
  expected_close_date: string | null
  closed_at: string | null
  lost_reason: string | null
  lead_source: string | null
  amount_from_products: boolean
  deal_type: DealType
  contract_months: number | null
  contract_start_date: string | null
  contract_end_date?: string | null
  renewal_due_date?: string | null
  renewal_of_deal_id: string | null
  renewal_of_title?: string | null
  renewal_deal_id?: string | null
  renewal_created_at: string | null
  contract_value?: number | null
  description: string | null
  position: number
  stage_entered_at: string
  last_activity_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
  // derived for the board
  next_activity_at?: string | null
  overdue_task_count?: number
  open_task_count?: number
  weighted_amount?: number
  probability?: number
  rot_after_days?: number | null
}

export type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'task'

export interface Activity {
  id: string
  type: ActivityType
  subject: string
  body: string | null
  deal_id: string | null
  deal_title?: string | null
  contact_id: string | null
  contact_name?: string | null
  company_id: string | null
  company_name?: string | null
  owner_id: string | null
  owner_name?: string | null
  due_at: string | null
  completed_at: string | null
  created_by: string | null
  created_by_name?: string | null
  created_at: string
  updated_at: string
  source: ActivitySource
  slack_channel?: string | null
  slack_ts?: string | null
  external_id: string | null
  external_url: string | null
  ends_at: string | null
  meta: ActivityMeta
}

export type ActivitySource = 'manual' | 'gmail' | 'gcal'

export interface EmailParty {
  name: string | null
  email: string
}

/** Extra data carried by synced activities. */
export interface ActivityMeta {
  direction?: 'sent' | 'received'
  from?: EmailParty
  to?: EmailParty[]
  cc?: EmailParty[]
  attendees?: Array<EmailParty & { status?: string; organizer?: boolean }>
  thread_id?: string
  location?: string | null
  conference_url?: string | null
  cancelled?: boolean
  synced_by?: string
}

export interface GoogleConnection {
  user_id: string
  google_email: string
  scopes: string[]
  gmail_sync_window_days: number
  gmail_sync_enabled: boolean
  calendar_sync_enabled: boolean
  gmail_synced_through: string | null
  gmail_last_synced_at: string | null
  calendar_last_synced_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface SyncRun {
  id: number
  user_id: string
  user_name?: string
  kind: 'gmail' | 'calendar'
  trigger: 'manual' | 'scheduled' | 'connect'
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'error'
  items_seen: number
  items_logged: number
  items_updated: number
  error: string | null
}

export interface UnmatchedItem {
  id: number
  user_id: string
  source: 'gmail' | 'gcal'
  external_id: string
  occurred_at: string
  subject: string | null
  addresses: EmailParty[]
  external_url: string | null
  created_at: string
  dismissed_at: string | null
}

export interface GoogleStatus {
  configured: boolean
  connection: GoogleConnection | null
  runs: SyncRun[]
  unmatched_count: number
  totals?: { emails: number; meetings: number }
}

export interface AuditEntry {
  id: number
  entity_type: string
  entity_id: string
  action: string
  actor_id: string | null
  actor_name?: string | null
  changes: Record<string, { from: unknown; to: unknown }> | Record<string, unknown>
  summary: string | null
  created_at: string
}

export interface StageHistoryEntry {
  id: number
  deal_id: string
  from_stage_id: string | null
  from_stage_name?: string | null
  to_stage_id: string
  to_stage_name?: string
  changed_by: string | null
  changed_by_name?: string | null
  entered_at: string
  exited_at: string | null
}

export type PricingType = 'one_time' | 'monthly' | 'percent'

export interface Product {
  id: string
  name: string
  sku: string | null
  pricing_type: PricingType
  unit_price: number
  description: string | null
  is_active: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface DealProduct {
  id: string
  deal_id: string
  product_id: string
  product_name?: string
  pricing_type: PricingType
  quantity: number
  unit_price: number
  term_months: number
  basis_amount: number
  notes: string | null
  position: number
  line_total?: number
  created_at: string
  updated_at: string
}

export interface SlackStatus {
  configured: boolean
  team_name?: string | null
  bot_user?: string | null
  me_linked: boolean
  my_slack_user_id: string | null
  error?: string | null
}

export interface LostReason {
  id: string
  label: string
  position: number
}

export interface Paged<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface TimelineItem {
  kind: 'activity' | 'audit' | 'stage'
  at: string
  activity?: Activity
  audit?: AuditEntry
  stage?: StageHistoryEntry
}

// ---- Reports ----

export interface ReportFilters {
  pipeline_id?: string
  owner_id?: string
  from?: string // ISO date, inclusive
  to?: string // ISO date, inclusive
}

export interface PipelineByStageRow {
  stage_id: string
  stage_name: string
  stage_kind: StageKind
  position: number
  probability: number
  color: string
  deal_count: number
  total_amount: number
  weighted_amount: number
  avg_days_in_stage: number | null
}

export interface ReportSummary {
  open_deals: number
  open_value: number
  weighted_value: number
  won_deals: number
  won_value: number
  lost_deals: number
  lost_value: number
  win_rate: number | null // 0..1 over closed deals in range
  avg_deal_size: number | null // won deals in range
  avg_cycle_days: number | null // created -> closed_at, won in range
  velocity_per_day: number | null // open deals * win rate * avg deal size / avg cycle days
  by_stage: PipelineByStageRow[]
  by_forecast: { category: ForecastCategory; deal_count: number; total_amount: number }[]
  won_by_month: { month: string; won_count: number; won_amount: number; lost_count: number; lost_amount: number }[]
  by_owner: { owner_id: string | null; owner_name: string; open_count: number; open_value: number; won_count: number; won_value: number; lost_count: number; activities: number }[]
  lost_reasons: { reason: string; deal_count: number; total_amount: number }[]
  funnel: { stage_id: string; stage_name: string; position: number; reached: number }[]
  activity_by_type: { type: ActivityType; count: number }[]
  by_deal_type: { deal_type: DealType; open_count: number; open_value: number; won_count: number; won_value: number }[]
  close_overdue_deals: Deal[]
  activity_overdue_deals: Deal[]
  by_product: { product_id: string; product_name: string; pricing_type: PricingType; open_deals: number; open_amount: number; won_deals: number; won_amount: number }[]
  stale_deals: Deal[]
}
