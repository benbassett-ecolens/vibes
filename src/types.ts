export type Cadence = 'weekly' | 'monthly'
/** Goal direction: gte = "hit or exceed the goal", lte = "stay at or under the goal" */
export type Comparator = 'gte' | 'lte'

export interface Person {
  id: string
  name: string
}

export type HeadlineKind = 'customer' | 'employee' | 'general'

export interface Headline {
  id: string
  text: string
  authorId: string
  date: string // yyyy-mm-dd
  kind: HeadlineKind
  done: boolean
  /** yyyy-mm-dd when archived; empty string = active. Archived items are kept as history. */
  archivedAt: string
}

export interface Metric {
  id: string
  name: string
  ownerId: string
  goal: number
  comparator: Comparator
  unit: string // '$', '%', or any suffix like 'leads'
  cadence: Cadence
  /** Values keyed by period key: weekly = ISO date of the Monday, monthly = yyyy-mm */
  entries: Record<string, number>
}

export type RockStatus = 'on_track' | 'off_track' | 'completed'

export interface Milestone {
  id: string
  name: string
  ownerId: string
  status: RockStatus
  dueDate: string
  /** yyyy-mm-dd when archived; empty string = active. */
  archivedAt: string
}

export interface Rock {
  id: string
  name: string
  ownerId: string
  dueDate: string
  status: RockStatus
  /** Empty string = no blocker */
  blocker: string
  milestones: Milestone[]
  /** yyyy-mm-dd when archived; empty string = active. */
  archivedAt: string
}

export type IssueTerm = 'short' | 'long'

export interface Issue {
  id: string
  name: string
  term: IssueTerm
  raisedById: string
  /** Context for the discussion — the "Issue Details" column of the L10 sheet. */
  details: string
  decision: string
  implementerId: string
  solved: boolean
  /** Set when `solved` turns true, cleared when it turns false. Drives the "solved this week" view. */
  solvedAt: string
  createdAt: string
  /** yyyy-mm-dd when archived; empty string = active. */
  archivedAt: string
}

export interface Meeting {
  id: string
  date: string
  attendeeIds: string[]
  notes: string
}

/**
 * One attendee's 1–10 rating of one meeting. Stored as its own record
 * (id = `${meetingId}~${personId}`) so several people rating at once
 * from different devices never overwrite each other.
 */
export interface MeetingRating {
  id: string
  meetingId: string
  personId: string
  score: number // 1-10, 0 = not yet rated
}

/**
 * One attendee's Segue statement for one meeting (personal + professional
 * best). Stored as its own record (id = `${meetingId}~${personId}`) for the
 * same concurrent-edit-safety reason as MeetingRating.
 */
export interface Segue {
  id: string
  meetingId: string
  personId: string
  text: string
}

/** The parts of a measurable whose edits are recorded in the scorecard change history. */
export type MetricField = 'name' | 'ownerId' | 'goal' | 'comparator' | 'unit' | 'cadence'

/**
 * One entry in the scorecard change history: a measurable was added,
 * removed, or had one of its definition fields edited. Results (entries)
 * are not logged here. Values are stored as strings; `ownerId` values are
 * person ids.
 */
export interface MetricChange {
  id: string
  metricId: string
  /** The measurable's name when the change was made (kept after it is removed). */
  metricName: string
  /** ISO timestamp */
  at: string
  kind: 'added' | 'edited' | 'removed'
  /** Empty for added/removed. */
  field: MetricField | ''
  from: string
  to: string
}

export interface AppData {
  people: Person[]
  headlines: Headline[]
  metrics: Metric[]
  rocks: Rock[]
  issues: Issue[]
  meetings: Meeting[]
  ratings: MeetingRating[]
  segues: Segue[]
  metricChanges: MetricChange[]
}
