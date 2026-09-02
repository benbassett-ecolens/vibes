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

export interface Milestone {
  id: string
  name: string
  ownerId: string
  done: boolean
  dueDate: string
}

export interface Rock {
  id: string
  name: string
  ownerId: string
  dueDate: string
  completed: boolean
  /** Empty string = no blocker */
  blocker: string
  milestones: Milestone[]
}

export type IssueTerm = 'short' | 'long'

export interface Issue {
  id: string
  name: string
  term: IssueTerm
  raisedById: string
  decision: string
  implementerId: string
  solved: boolean
  createdAt: string
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

export interface AppData {
  people: Person[]
  headlines: Headline[]
  metrics: Metric[]
  rocks: Rock[]
  issues: Issue[]
  meetings: Meeting[]
  ratings: MeetingRating[]
}
