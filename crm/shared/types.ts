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
  stale_deals: Deal[]
}
