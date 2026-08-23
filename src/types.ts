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

export interface Rating {
  personId: string
  score: number // 1-10
}

export interface Meeting {
  id: string
  date: string
  ratings: Rating[]
  notes: string
}

export interface AppData {
  people: Person[]
  headlines: Headline[]
  metrics: Metric[]
  rocks: Rock[]
  issues: Issue[]
  meetings: Meeting[]
}
