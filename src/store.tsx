import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AppData,
  Headline,
  Issue,
  Meeting,
  MeetingRating,
  Metric,
  Milestone,
  Person,
  Rock,
  RockStatus,
} from './types'
import { lastNPeriods, toISODate } from './periods'
import { startSync, type SyncEngine, type SyncStatus } from './dbSync'

const STORAGE_KEY = 'ecolens-l10-data-v1'

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`

export const today = (): string => toISODate(new Date())

export function emptyData(): AppData {
  return {
    people: [],
    headlines: [],
    metrics: [],
    rocks: [],
    issues: [],
    meetings: [],
    ratings: [],
  }
}

/** Sample data so the app demonstrates itself on first run. Replace via Team/Data controls. */
export function seedData(): AppData {
  const ben: Person = { id: uid(), name: 'Ben' }
  const sam: Person = { id: uid(), name: 'Sam' }
  const riley: Person = { id: uid(), name: 'Riley' }

  const weeklyHistory = (base: number, amplitude: number, drift: number) => {
    const entries: Record<string, number> = {}
    lastNPeriods(13, 'weekly').forEach((key, i) => {
      entries[key] = Math.max(0, Math.round(base + drift * i + amplitude * Math.sin(i * 1.3)))
    })
    return entries
  }

  const monthlyHistory = (values: number[]) => {
    const entries: Record<string, number> = {}
    lastNPeriods(values.length, 'monthly').forEach((key, i) => {
      entries[key] = values[i]
    })
    return entries
  }

  const metrics: Metric[] = [
    {
      id: uid(),
      name: 'New qualified leads',
      ownerId: ben.id,
      goal: 25,
      comparator: 'gte',
      unit: '',
      cadence: 'weekly',
      entries: weeklyHistory(22, 4, 0.5),
    },
    {
      id: uid(),
      name: 'Weekly revenue',
      ownerId: sam.id,
      goal: 40000,
      comparator: 'gte',
      unit: '$',
      cadence: 'weekly',
      entries: weeklyHistory(38000, 3500, 300),
    },
    {
      id: uid(),
      name: 'Support tickets open > 48h',
      ownerId: riley.id,
      goal: 5,
      comparator: 'lte',
      unit: '',
      cadence: 'weekly',
      entries: weeklyHistory(6, 2, -0.2),
    },
    {
      id: uid(),
      name: 'Monthly recurring revenue',
      ownerId: ben.id,
      goal: 165000,
      comparator: 'gte',
      unit: '$',
      cadence: 'monthly',
      entries: monthlyHistory([148000, 154000, 159000, 163000]),
    },
  ]

  const rocks: Rock[] = [
    {
      id: uid(),
      name: 'Launch customer sustainability dashboard v2',
      ownerId: ben.id,
      dueDate: toISODate(new Date(new Date().setDate(new Date().getDate() + 35))),
      status: 'on_track',
      blocker: '',
      milestones: [
        { id: uid(), name: 'Finalize dashboard spec', ownerId: ben.id, status: 'completed', dueDate: '' },
        { id: uid(), name: 'Beta with 3 pilot customers', ownerId: sam.id, status: 'on_track', dueDate: '' },
        { id: uid(), name: 'GA launch + announcement', ownerId: ben.id, status: 'on_track', dueDate: '' },
      ],
    },
    {
      id: uid(),
      name: 'Document core sales process',
      ownerId: sam.id,
      dueDate: toISODate(new Date(new Date().setDate(new Date().getDate() + 50))),
      status: 'off_track',
      blocker: 'Waiting on CRM export access',
      milestones: [
        { id: uid(), name: 'Map current pipeline stages', ownerId: sam.id, status: 'completed', dueDate: '' },
        { id: uid(), name: 'Write playbook draft', ownerId: riley.id, status: 'on_track', dueDate: '' },
      ],
    },
  ]

  const issues: Issue[] = [
    {
      id: uid(),
      name: 'Onboarding takes too long for new customers',
      term: 'short',
      raisedById: riley.id,
      details: '',
      decision: '',
      implementerId: '',
      solved: false,
      createdAt: today(),
    },
    {
      id: uid(),
      name: 'Do we expand into the EU market next year?',
      term: 'long',
      raisedById: ben.id,
      details: '',
      decision: '',
      implementerId: '',
      solved: false,
      createdAt: today(),
    },
  ]

  const headlines: Headline[] = [
    {
      id: uid(),
      text: 'Signed our largest customer to a 2-year renewal',
      authorId: sam.id,
      date: today(),
      kind: 'customer',
    },
    {
      id: uid(),
      text: 'Riley completed the data analytics certification',
      authorId: ben.id,
      date: today(),
      kind: 'employee',
    },
  ]

  return {
    people: [ben, sam, riley],
    headlines,
    metrics,
    rocks,
    issues,
    meetings: [],
    ratings: [],
  }
}

function isAppData(value: unknown): value is AppData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return ['people', 'headlines', 'metrics', 'rocks', 'issues', 'meetings'].every((k) =>
    Array.isArray(v[k]),
  )
}

/**
 * Accept data from older exports/storage where ratings lived inside each
 * meeting, and guarantee the `ratings` collection exists.
 */
export function normalizeData(raw: AppData): AppData {
  const data: AppData = { ...emptyData(), ...raw }
  data.ratings = Array.isArray(data.ratings) ? data.ratings : []
  data.issues = (raw.issues ?? []).map((i) => ({ ...i, details: i.details ?? '' }))
  data.rocks = (raw.rocks ?? []).map((r) => {
    const legacy = r as Rock & { completed?: boolean }
    const status: RockStatus = legacy.status ?? (legacy.completed ? 'completed' : 'on_track')
    const milestones = (r.milestones ?? []).map((m) => {
      const legacyM = m as Milestone & { done?: boolean }
      const mStatus: RockStatus = legacyM.status ?? (legacyM.done ? 'completed' : 'on_track')
      return { id: m.id, name: m.name, ownerId: m.ownerId, dueDate: m.dueDate, status: mStatus }
    })
    return {
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      dueDate: r.dueDate,
      blocker: r.blocker ?? '',
      status,
      milestones,
    }
  })
  data.meetings = (raw.meetings ?? []).map((m) => {
    const legacy = m as Meeting & { ratings?: Array<{ personId: string; score: number }> }
    if (Array.isArray(legacy.ratings)) {
      for (const r of legacy.ratings) {
        if (r.score >= 1) {
          data.ratings.push({
            id: `${m.id}~${r.personId}`,
            meetingId: m.id,
            personId: r.personId,
            score: r.score,
          })
        }
      }
      return {
        id: m.id,
        date: m.date,
        notes: m.notes ?? '',
        attendeeIds: legacy.ratings.map((r) => r.personId),
      }
    }
    return { ...m, attendeeIds: m.attendeeIds ?? [], notes: m.notes ?? '' }
  })
  return data
}

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (isAppData(parsed.data)) return normalizeData(parsed.data)
    }
  } catch {
    // storage unavailable or corrupt — fall through
  }
  // Inside the artifact viewer the shared workspace is the source of
  // truth, so a fresh browser starts empty instead of seeding samples.
  if (typeof window !== 'undefined' && window.claude?.use) return emptyData()
  return seedData()
}

interface AppContextValue {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  actions: ReturnType<typeof makeActions>
  /** 'live' = shared workspace (artifact db), 'local' = this browser only. */
  syncStatus: SyncStatus
}

const AppContext = createContext<AppContextValue | null>(null)

function makeActions(setData: React.Dispatch<React.SetStateAction<AppData>>) {
  const patchList = <T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] =>
    list.map((item) => (item.id === id ? { ...item, ...patch } : item))

  return {
    // People
    addPerson(name: string) {
      const trimmed = name.trim()
      if (!trimmed) return
      setData((d) => ({ ...d, people: [...d.people, { id: uid(), name: trimmed }] }))
    },
    renamePerson(id: string, name: string) {
      setData((d) => ({ ...d, people: patchList(d.people, id, { name }) }))
    },
    removePerson(id: string) {
      setData((d) => ({ ...d, people: d.people.filter((p) => p.id !== id) }))
    },

    // Headlines
    addHeadline(headline: Omit<Headline, 'id'>) {
      setData((d) => ({ ...d, headlines: [{ ...headline, id: uid() }, ...d.headlines] }))
    },
    updateHeadline(id: string, patch: Partial<Headline>) {
      setData((d) => ({ ...d, headlines: patchList(d.headlines, id, patch) }))
    },
    removeHeadline(id: string) {
      setData((d) => ({ ...d, headlines: d.headlines.filter((h) => h.id !== id) }))
    },

    // Scorecard metrics
    addMetric(metric: Omit<Metric, 'id' | 'entries'>) {
      setData((d) => ({ ...d, metrics: [...d.metrics, { ...metric, id: uid(), entries: {} }] }))
    },
    updateMetric(id: string, patch: Partial<Metric>) {
      setData((d) => ({ ...d, metrics: patchList(d.metrics, id, patch) }))
    },
    removeMetric(id: string) {
      setData((d) => ({ ...d, metrics: d.metrics.filter((m) => m.id !== id) }))
    },
    setMetricEntry(id: string, periodKey: string, value: number | null) {
      setData((d) => ({
        ...d,
        metrics: d.metrics.map((m) => {
          if (m.id !== id) return m
          const entries = { ...m.entries }
          if (value == null || !Number.isFinite(value)) delete entries[periodKey]
          else entries[periodKey] = value
          return { ...m, entries }
        }),
      }))
    },

    // Rocks
    addRock(name: string, ownerId: string, dueDate: string) {
      const rock: Rock = {
        id: uid(),
        name,
        ownerId,
        dueDate,
        status: 'on_track',
        blocker: '',
        milestones: [],
      }
      setData((d) => ({ ...d, rocks: [...d.rocks, rock] }))
    },
    updateRock(id: string, patch: Partial<Rock>) {
      setData((d) => ({ ...d, rocks: patchList(d.rocks, id, patch) }))
    },
    removeRock(id: string) {
      setData((d) => ({ ...d, rocks: d.rocks.filter((r) => r.id !== id) }))
    },
    addMilestone(rockId: string, name: string, ownerId: string) {
      const milestone: Milestone = { id: uid(), name, ownerId, status: 'on_track', dueDate: '' }
      setData((d) => ({
        ...d,
        rocks: d.rocks.map((r) =>
          r.id === rockId ? { ...r, milestones: [...r.milestones, milestone] } : r,
        ),
      }))
    },
    updateMilestone(rockId: string, milestoneId: string, patch: Partial<Milestone>) {
      setData((d) => ({
        ...d,
        rocks: d.rocks.map((r) =>
          r.id === rockId ? { ...r, milestones: patchList(r.milestones, milestoneId, patch) } : r,
        ),
      }))
    },
    removeMilestone(rockId: string, milestoneId: string) {
      setData((d) => ({
        ...d,
        rocks: d.rocks.map((r) =>
          r.id === rockId
            ? { ...r, milestones: r.milestones.filter((m) => m.id !== milestoneId) }
            : r,
        ),
      }))
    },

    // Issues
    addIssue(issue: Omit<Issue, 'id' | 'createdAt' | 'solved'>) {
      setData((d) => ({
        ...d,
        issues: [{ ...issue, id: uid(), createdAt: today(), solved: false }, ...d.issues],
      }))
    },
    updateIssue(id: string, patch: Partial<Issue>) {
      setData((d) => ({ ...d, issues: patchList(d.issues, id, patch) }))
    },
    removeIssue(id: string) {
      setData((d) => ({ ...d, issues: d.issues.filter((i) => i.id !== id) }))
    },

    // Meetings
    addMeeting(date: string, attendeeIds: string[]) {
      const meeting: Meeting = { id: uid(), date, attendeeIds, notes: '' }
      setData((d) => ({ ...d, meetings: [meeting, ...d.meetings] }))
    },
    updateMeeting(id: string, patch: Partial<Meeting>) {
      setData((d) => ({ ...d, meetings: patchList(d.meetings, id, patch) }))
    },
    setRating(meetingId: string, personId: string, score: number) {
      const id = `${meetingId}~${personId}`
      setData((d) => {
        const rating: MeetingRating = { id, meetingId, personId, score }
        const exists = d.ratings.some((r) => r.id === id)
        return {
          ...d,
          ratings: exists ? patchList(d.ratings, id, rating) : [...d.ratings, rating],
        }
      })
    },
    toggleAttendee(meetingId: string, personId: string) {
      setData((d) => {
        const meetings = d.meetings.map((m) => {
          if (m.id !== meetingId) return m
          const has = m.attendeeIds.includes(personId)
          return {
            ...m,
            attendeeIds: has
              ? m.attendeeIds.filter((id) => id !== personId)
              : [...m.attendeeIds, personId],
          }
        })
        const removed = d.meetings
          .find((m) => m.id === meetingId)
          ?.attendeeIds.includes(personId)
        return {
          ...d,
          meetings,
          ratings: removed
            ? d.ratings.filter((r) => !(r.meetingId === meetingId && r.personId === personId))
            : d.ratings,
        }
      })
    },
    removeMeeting(id: string) {
      setData((d) => ({
        ...d,
        meetings: d.meetings.filter((m) => m.id !== id),
        ratings: d.ratings.filter((r) => r.meetingId !== id),
      }))
    },
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(load)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() =>
    typeof window !== 'undefined' && window.claude?.use ? 'connecting' : 'local',
  )
  const dataRef = useRef(data)
  dataRef.current = data
  const engineRef = useRef<SyncEngine | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startSync({
      getData: () => dataRef.current,
      applyRemote: (patch) => setData((d) => ({ ...d, ...patch })),
      setStatus: setSyncStatus,
    }).then((engine) => {
      engineRef.current = engine
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data }))
    } catch {
      // storage unavailable (private mode, sandbox) — app still works in-memory
    }
    engineRef.current?.onLocalChange(data)
  }, [data])

  const actions = useMemo(() => makeActions(setData), [])
  const value = useMemo(
    () => ({ data, setData, actions, syncStatus }),
    [data, actions, syncStatus],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}

export { isAppData }
