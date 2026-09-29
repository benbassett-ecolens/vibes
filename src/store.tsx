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
  MetricChange,
  MetricField,
  Milestone,
  Person,
  Rock,
  RockStatus,
  Segue,
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
    segues: [],
    metricChanges: [],
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
      archivedAt: '',
      milestones: [
        { id: uid(), name: 'Finalize dashboard spec', ownerId: ben.id, status: 'completed', dueDate: '', archivedAt: '' },
        { id: uid(), name: 'Beta with 3 pilot customers', ownerId: sam.id, status: 'on_track', dueDate: '', archivedAt: '' },
        { id: uid(), name: 'GA launch + announcement', ownerId: ben.id, status: 'on_track', dueDate: '', archivedAt: '' },
      ],
    },
    {
      id: uid(),
      name: 'Document core sales process',
      ownerId: sam.id,
      dueDate: toISODate(new Date(new Date().setDate(new Date().getDate() + 50))),
      status: 'off_track',
      blocker: 'Waiting on CRM export access',
      archivedAt: '',
      milestones: [
        { id: uid(), name: 'Map current pipeline stages', ownerId: sam.id, status: 'completed', dueDate: '', archivedAt: '' },
        { id: uid(), name: 'Write playbook draft', ownerId: riley.id, status: 'on_track', dueDate: '', archivedAt: '' },
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
      solvedAt: '',
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
      solvedAt: '',
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
      done: false,
      archivedAt: '',
    },
    {
      id: uid(),
      text: 'Riley completed the data analytics certification',
      authorId: ben.id,
      date: today(),
      kind: 'employee',
      done: false,
      archivedAt: '',
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
    segues: [],
    metricChanges: [],
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
  data.segues = Array.isArray(data.segues) ? data.segues : []
  data.metricChanges = Array.isArray(data.metricChanges) ? data.metricChanges : []
  data.headlines = (raw.headlines ?? []).map((h) => ({
    ...h,
    done: h.done ?? false,
    archivedAt: h.archivedAt ?? '',
  }))
  data.issues = (raw.issues ?? []).map((i) => ({
    ...i,
    details: i.details ?? '',
    // Backfill: an already-solved issue with no recorded solve date reads
    // as "solved this week" once, right after migration, rather than
    // disappearing from view entirely.
    solvedAt: i.solvedAt ?? (i.solved ? today() : ''),
  }))
  data.rocks = (raw.rocks ?? []).map((r) => {
    // Keep unknown fields (spread) so fields added by newer versions survive a
    // round trip through an older client; drop only the retired booleans.
    const { completed, ...rest } = r as Rock & { completed?: boolean }
    const status: RockStatus = r.status ?? (completed ? 'completed' : 'on_track')
    const milestones = (r.milestones ?? []).map((m) => {
      const { done, ...mRest } = m as Milestone & { done?: boolean }
      const mStatus: RockStatus = m.status ?? (done ? 'completed' : 'on_track')
      return {
        ...mRest,
        id: m.id,
        name: m.name,
        ownerId: m.ownerId,
        dueDate: m.dueDate,
        status: mStatus,
        archivedAt: m.archivedAt ?? '',
      }
    })
    return {
      ...rest,
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      dueDate: r.dueDate,
      blocker: r.blocker ?? '',
      status,
      milestones,
      archivedAt: r.archivedAt ?? '',
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

const METRIC_FIELDS: MetricField[] = ['name', 'ownerId', 'goal', 'comparator', 'unit', 'cadence']

/** Edits to the same field of the same measurable within this window merge into one entry,
 * so typing a new name letter by letter records one change, not one per keystroke. */
const MERGE_WINDOW_MS = 10 * 60 * 1000

function metricChange(
  metricId: string,
  metricName: string,
  kind: MetricChange['kind'],
  field: MetricChange['field'],
  from: string,
  to: string,
): MetricChange {
  return { id: uid(), metricId, metricName, at: new Date().toISOString(), kind, field, from, to }
}

/** One-line summary of a measurable's definition, kept on added/removed entries. */
export function describeMetric(m: Omit<Metric, 'id' | 'entries'>): string {
  const goal = `${m.comparator === 'gte' ? '≥' : '≤'} ${m.goal}${m.unit ? ` ${m.unit}` : ''}`
  return `${m.cadence}, goal ${goal}`
}

/** Record a field edit, folding it into a recent entry for the same field when there is one. */
export function logMetricEdit(
  changes: MetricChange[],
  metric: Metric,
  field: MetricField,
  from: string,
  to: string,
  now: Date = new Date(),
): MetricChange[] {
  const last = [...changes]
    .reverse()
    .find((c) => c.metricId === metric.id && c.kind !== 'removed')
  const mergeable =
    last &&
    last.kind === 'edited' &&
    last.field === field &&
    now.getTime() - new Date(last.at).getTime() < MERGE_WINDOW_MS
  if (mergeable) {
    // Back to where it started: the edit cancelled itself out.
    if (last.from === to) return changes.filter((c) => c.id !== last.id)
    return changes.map((c) =>
      c.id === last.id ? { ...c, to, at: now.toISOString(), metricName: metric.name } : c,
    )
  }
  return [
    ...changes,
    { ...metricChange(metric.id, metric.name, 'edited', field, from, to), at: now.toISOString() },
  ]
}

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
    /** Archive (or restore) a headline — it leaves the active list but stays on record. */
    setHeadlineArchived(id: string, archived: boolean) {
      setData((d) => ({
        ...d,
        headlines: patchList(d.headlines, id, { archivedAt: archived ? today() : '' }),
      }))
    },
    removeHeadline(id: string) {
      setData((d) => ({ ...d, headlines: d.headlines.filter((h) => h.id !== id) }))
    },

    // Scorecard metrics — definition edits are recorded in metricChanges
    addMetric(metric: Omit<Metric, 'id' | 'entries'>) {
      const id = uid()
      setData((d) => ({
        ...d,
        metrics: [...d.metrics, { ...metric, id, entries: {} }],
        metricChanges: [
          ...d.metricChanges,
          metricChange(id, metric.name, 'added', '', '', describeMetric(metric)),
        ],
      }))
    },
    updateMetric(id: string, patch: Partial<Metric>) {
      setData((d) => {
        const before = d.metrics.find((m) => m.id === id)
        if (!before) return d
        const after = { ...before, ...patch }
        let metricChanges = d.metricChanges
        for (const field of METRIC_FIELDS) {
          if (!(field in patch) || String(before[field]) === String(after[field])) continue
          metricChanges = logMetricEdit(metricChanges, after, field, String(before[field]), String(after[field]))
        }
        return { ...d, metrics: patchList(d.metrics, id, patch), metricChanges }
      })
    },
    removeMetric(id: string) {
      setData((d) => {
        const metric = d.metrics.find((m) => m.id === id)
        return {
          ...d,
          metrics: d.metrics.filter((m) => m.id !== id),
          metricChanges: metric
            ? [
                ...d.metricChanges,
                metricChange(id, metric.name, 'removed', '', describeMetric(metric), ''),
              ]
            : d.metricChanges,
        }
      })
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
        archivedAt: '',
      }
      setData((d) => ({ ...d, rocks: [...d.rocks, rock] }))
    },
    updateRock(id: string, patch: Partial<Rock>) {
      setData((d) => ({ ...d, rocks: patchList(d.rocks, id, patch) }))
    },
    setRockArchived(id: string, archived: boolean) {
      setData((d) => ({
        ...d,
        rocks: patchList(d.rocks, id, { archivedAt: archived ? today() : '' }),
      }))
    },
    removeRock(id: string) {
      setData((d) => ({ ...d, rocks: d.rocks.filter((r) => r.id !== id) }))
    },
    addMilestone(rockId: string, name: string, ownerId: string, dueDate = '') {
      const milestone: Milestone = { id: uid(), name, ownerId, status: 'on_track', dueDate, archivedAt: '' }
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
    setMilestoneArchived(rockId: string, milestoneId: string, archived: boolean) {
      setData((d) => ({
        ...d,
        rocks: d.rocks.map((r) =>
          r.id === rockId
            ? {
                ...r,
                milestones: patchList(r.milestones, milestoneId, {
                  archivedAt: archived ? today() : '',
                }),
              }
            : r,
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
    addIssue(issue: Omit<Issue, 'id' | 'createdAt' | 'solved' | 'solvedAt'>) {
      setData((d) => ({
        ...d,
        issues: [
          { ...issue, id: uid(), createdAt: today(), solved: false, solvedAt: '' },
          ...d.issues,
        ],
      }))
    },
    updateIssue(id: string, patch: Partial<Issue>) {
      setData((d) => ({
        ...d,
        issues: d.issues.map((i) => {
          if (i.id !== id) return i
          const next = { ...i, ...patch }
          // Stamp/clear solvedAt whenever `solved` changes, so callers
          // never have to remember to set it themselves.
          if ('solved' in patch) next.solvedAt = patch.solved ? today() : ''
          return next
        }),
      }))
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
          segues: removed
            ? d.segues.filter((s) => !(s.meetingId === meetingId && s.personId === personId))
            : d.segues,
        }
      })
    },
    removeMeeting(id: string) {
      setData((d) => ({
        ...d,
        meetings: d.meetings.filter((m) => m.id !== id),
        ratings: d.ratings.filter((r) => r.meetingId !== id),
        segues: d.segues.filter((s) => s.meetingId !== id),
      }))
    },
    setSegue(meetingId: string, personId: string, text: string) {
      const id = `${meetingId}~${personId}`
      setData((d) => {
        const segue: Segue = { id, meetingId, personId, text }
        const exists = d.segues.some((s) => s.id === id)
        return {
          ...d,
          segues: exists ? patchList(d.segues, id, segue) : [...d.segues, segue],
        }
      })
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
      // Normalize remote snapshots too — the shared db can hold older
      // shapes (e.g. rocks/milestones from before the status field)
      // written by a client that hasn't loaded this version yet.
      applyRemote: (patch) => setData((d) => normalizeData({ ...d, ...patch })),
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
