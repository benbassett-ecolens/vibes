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
  Activity,
  AppData,
  Contact,
  Dashboard,
  Deal,
  Note,
  Person,
  Stage,
  Widget,
} from './types'
import { COLLECTIONS } from './types'
import { seedData } from './seed'
import { startSync, type SyncEngine, type SyncStatus } from './dbSync'
import { AVATAR_COLORS, addMonths, initialsOf, nowISO, today, uid } from './format'

const STORAGE_KEY = 'ecolens-crm-data-v1'

export function emptyData(): AppData {
  return {
    people: [],
    stages: [],
    deals: [],
    notes: [],
    activities: [],
    contacts: [],
    dashboards: [],
    widgets: [],
  }
}

export function isAppData(value: unknown): value is AppData {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return ['people', 'stages', 'deals'].every((k) => Array.isArray(v[k]))
}

export function normalizeData(raw: AppData): AppData {
  const data: AppData = { ...emptyData() }
  for (const name of COLLECTIONS) {
    const list = (raw as unknown as Record<string, unknown>)[name]
    ;(data as unknown as Record<string, unknown>)[name] = Array.isArray(list) ? list : []
  }
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
  // Inside the artifact viewer the shared workspace is the source of truth.
  if (typeof window !== 'undefined' && window.claude?.use) return emptyData()
  return seedData()
}

export interface NewDealInput {
  title: string
  ownerId: string
  stageId: string
  product?: string
  retainerAcv?: number | null
  performanceAcv?: number | null
  closeDate?: string
  ecosystems?: string[]
  businessUnits?: string[]
  partnerTypes?: string[]
}

function makeActions(setData: React.Dispatch<React.SetStateAction<AppData>>) {
  const patchList = <T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] =>
    list.map((item) => (item.id === id ? { ...item, ...patch } : item))

  return {
    // People
    addPerson(name: string): string {
      const id = uid()
      setData((d) => ({
        ...d,
        people: [
          ...d.people,
          {
            id,
            name: name.trim(),
            initials: initialsOf(name),
            color: AVATAR_COLORS[d.people.length % AVATAR_COLORS.length],
          },
        ],
      }))
      return id
    },
    updatePerson(id: string, patch: Partial<Person>) {
      setData((d) => ({
        ...d,
        people: patchList(d.people, id, {
          ...patch,
          ...(patch.name ? { initials: initialsOf(patch.name) } : {}),
        }),
      }))
    },
    removePerson(id: string) {
      setData((d) => ({ ...d, people: d.people.filter((p) => p.id !== id) }))
    },

    // Stages
    addStage(name: string) {
      setData((d) => {
        const firstClosed = d.stages.findIndex((s) => s.kind !== 'open')
        const stage: Stage = { id: uid(), name: name.trim(), kind: 'open', probability: 50 }
        const stages = [...d.stages]
        stages.splice(firstClosed === -1 ? stages.length : firstClosed, 0, stage)
        return { ...d, stages }
      })
    },
    updateStage(id: string, patch: Partial<Stage>) {
      setData((d) => ({ ...d, stages: patchList(d.stages, id, patch) }))
    },
    moveStage(id: string, dir: -1 | 1) {
      setData((d) => {
        const i = d.stages.findIndex((s) => s.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= d.stages.length) return d
        const stages = [...d.stages]
        ;[stages[i], stages[j]] = [stages[j], stages[i]]
        return { ...d, stages }
      })
    },
    removeStage(id: string, moveDealsTo: string) {
      setData((d) => ({
        ...d,
        stages: d.stages.filter((s) => s.id !== id),
        deals: d.deals.map((x) => (x.stageId === id ? { ...x, stageId: moveDealsTo } : x)),
      }))
    },

    // Deals
    addDeal(input: NewDealInput): string {
      const id = uid()
      const deal: Deal = {
        id,
        title: input.title.trim(),
        ownerId: input.ownerId,
        stageId: input.stageId,
        product: input.product ?? '',
        businessUnits: input.businessUnits ?? [],
        partnerTypes: input.partnerTypes ?? [],
        ecosystems: input.ecosystems ?? [],
        retainerAcv: input.retainerAcv ?? null,
        performanceAcv: input.performanceAcv ?? null,
        tcvOverride: null,
        valueTbd: false,
        closeDate: input.closeDate ?? '',
        renewalDate: '',
        contractTermMonths: 12,
        forecast: '',
        lostReason: '',
        tags: [],
        createdAt: nowISO(),
        source: 'app',
      }
      setData((d) => ({ ...d, deals: [deal, ...d.deals] }))
      return id
    },
    updateDeal(id: string, patch: Partial<Deal>) {
      setData((d) => ({ ...d, deals: patchList(d.deals, id, patch) }))
    },
    /** Move to a stage; sets close/renewal dates when the stage is terminal. */
    moveDeal(id: string, stageId: string) {
      setData((d) => {
        const stage = d.stages.find((s) => s.id === stageId)
        return {
          ...d,
          deals: d.deals.map((deal) => {
            if (deal.id !== id) return deal
            const patch: Partial<Deal> = { stageId }
            if (stage?.kind === 'won') {
              const close = deal.closeDate || today()
              patch.closeDate = close
              patch.renewalDate = deal.renewalDate || addMonths(close, deal.contractTermMonths || 12)
            } else if (stage?.kind === 'lost') {
              patch.closeDate = deal.closeDate || today()
            }
            return { ...deal, ...patch }
          }),
        }
      })
    },
    removeDeal(id: string) {
      setData((d) => ({
        ...d,
        deals: d.deals.filter((x) => x.id !== id),
        notes: d.notes.filter((n) => n.dealId !== id),
        activities: d.activities.filter((a) => a.dealId !== id),
        contacts: d.contacts.map((c) => (c.dealId === id ? { ...c, dealId: '' } : c)),
      }))
    },

    // Notes
    addNote(dealId: string, body: string, authorId: string) {
      const text = body.trim()
      if (!text) return
      const note: Note = {
        id: uid(),
        dealId,
        body: text,
        authorId,
        date: today(),
        createdAt: nowISO(),
      }
      setData((d) => ({ ...d, notes: [note, ...d.notes] }))
    },
    updateNote(id: string, patch: Partial<Note>) {
      setData((d) => ({ ...d, notes: patchList(d.notes, id, patch) }))
    },
    removeNote(id: string) {
      setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }))
    },

    // Activities
    addActivity(input: Omit<Activity, 'id' | 'createdAt' | 'done'>) {
      const activity: Activity = { ...input, id: uid(), done: false, createdAt: nowISO() }
      setData((d) => ({ ...d, activities: [activity, ...d.activities] }))
    },
    updateActivity(id: string, patch: Partial<Activity>) {
      setData((d) => ({ ...d, activities: patchList(d.activities, id, patch) }))
    },
    removeActivity(id: string) {
      setData((d) => ({ ...d, activities: d.activities.filter((a) => a.id !== id) }))
    },

    // Contacts
    addContact(input: Omit<Contact, 'id'>): string {
      const id = uid()
      setData((d) => ({ ...d, contacts: [{ ...input, id }, ...d.contacts] }))
      return id
    },
    updateContact(id: string, patch: Partial<Contact>) {
      setData((d) => ({ ...d, contacts: patchList(d.contacts, id, patch) }))
    },
    removeContact(id: string) {
      setData((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }))
    },

    // Dashboards & widgets
    addDashboard(name: string): string {
      const id = uid()
      const dash: Dashboard = { id, name: name.trim() || 'New dashboard' }
      setData((d) => ({ ...d, dashboards: [...d.dashboards, dash] }))
      return id
    },
    renameDashboard(id: string, name: string) {
      setData((d) => ({ ...d, dashboards: patchList(d.dashboards, id, { name }) }))
    },
    removeDashboard(id: string) {
      setData((d) => ({
        ...d,
        dashboards: d.dashboards.filter((x) => x.id !== id),
        widgets: d.widgets.filter((w) => w.dashboardId !== id),
      }))
    },
    addWidget(widget: Omit<Widget, 'id'>): string {
      const id = uid()
      setData((d) => ({ ...d, widgets: [...d.widgets, { ...widget, id }] }))
      return id
    },
    updateWidget(id: string, patch: Partial<Widget>) {
      setData((d) => ({ ...d, widgets: patchList(d.widgets, id, patch) }))
    },
    moveWidget(id: string, dir: -1 | 1) {
      setData((d) => {
        const w = d.widgets.find((x) => x.id === id)
        if (!w) return d
        const siblings = d.widgets.filter((x) => x.dashboardId === w.dashboardId)
        const others = d.widgets.filter((x) => x.dashboardId !== w.dashboardId)
        const i = siblings.findIndex((x) => x.id === id)
        const j = i + dir
        if (j < 0 || j >= siblings.length) return d
        ;[siblings[i], siblings[j]] = [siblings[j], siblings[i]]
        return { ...d, widgets: [...others, ...siblings] }
      })
    },
    removeWidget(id: string) {
      setData((d) => ({ ...d, widgets: d.widgets.filter((w) => w.id !== id) }))
    },
  }
}

export type Actions = ReturnType<typeof makeActions>

interface AppContextValue {
  data: AppData
  setData: React.Dispatch<React.SetStateAction<AppData>>
  actions: Actions
  syncStatus: SyncStatus
}

const AppContext = createContext<AppContextValue | null>(null)

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
      bootstrap: seedData,
      setStatus: setSyncStatus,
    }).then((engine) => {
      engineRef.current = engine
    })
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data }))
    } catch {
      // storage unavailable — app still works in-memory
    }
    engineRef.current?.onLocalChange(data)
  }, [data])

  const actions = useMemo(() => makeActions(setData), [])
  const value = useMemo(() => ({ data, setData, actions, syncStatus }), [data, actions, syncStatus])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
