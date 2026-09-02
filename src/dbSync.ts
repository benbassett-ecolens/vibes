import type { AppData } from './types'

/**
 * Sync engine for the shared-workspace mode.
 *
 * When the app runs as a published claude.ai artifact with the `db`
 * capability, this module mirrors the app state into the artifact's
 * shared realtime document store, so everyone the page is shared with
 * sees the same data live. Anywhere else (local dev, self-hosted) it
 * resolves to null and the app keeps its localStorage-only behavior.
 *
 * Layout: one db collection per AppData collection, one document per
 * item (doc id = item id, body = item fields + `pos` for ordering).
 * Per-item documents mean concurrent edits to different items never
 * clobber each other; edits to the same item are last-writer-wins.
 */

export type SyncStatus = 'local' | 'connecting' | 'live'

export interface SyncEngine {
  onLocalChange(data: AppData): void
}

type Item = { id: string } & Record<string, unknown>

const COLLECTIONS = [
  'people',
  'headlines',
  'metrics',
  'rocks',
  'issues',
  'meetings',
  'ratings',
] as const
type CollectionName = (typeof COLLECTIONS)[number]

// Minimal structural view of the artifact `db` capability contract.
interface DocRef {
  set(data: Record<string, unknown>): Promise<void>
  delete(): Promise<void>
}
interface QuerySnap {
  docs: Array<{ id: string; exists: boolean; data(): Record<string, unknown> | undefined }>
}
interface CollRef {
  doc(id?: string): DocRef
  onSnapshot(next: (snap: QuerySnap) => void, error?: (e: unknown) => void): () => void
}
interface Db {
  collection(path: string): CollRef
}

/** Deterministic JSON (sorted keys) so content comparison is order-proof. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
}

/** How long after a local edit we hold off applying remote snapshots to
 * that collection, so a viewer's in-progress typing isn't stomped. */
const EDIT_QUIET_MS = 3000
/** Local changes are batched into one push per debounce window. */
const PUSH_DEBOUNCE_MS = 700

export async function startSync(opts: {
  getData: () => AppData
  applyRemote: (patch: Partial<AppData>) => void
  setStatus: (status: SyncStatus) => void
}): Promise<SyncEngine | null> {
  if (typeof window === 'undefined' || !window.claude?.use) {
    opts.setStatus('local')
    return null
  }
  opts.setStatus('connecting')
  let db: Db | null = null
  try {
    db = (await window.claude.use('db')) as Db | null
  } catch {
    db = null
  }
  if (!db) {
    opts.setStatus('local')
    return null
  }
  const store = db

  /** Per collection: id -> stable JSON of the doc body the server holds. */
  const server = new Map<CollectionName, Map<string, string>>()
  /** Per collection: the latest server-derived item arrays (pos stripped). */
  const latest = new Map<CollectionName, Item[]>()
  const editedAt = new Map<CollectionName, number>()
  const applyTimers = new Map<CollectionName, ReturnType<typeof setTimeout>>()
  const seen = new Set<CollectionName>()
  let live = false
  let pushTimer: ReturnType<typeof setTimeout> | null = null

  const withPos = (item: Item, pos: number): Record<string, unknown> => ({ ...item, pos })

  const applyCollection = (name: CollectionName) => {
    if (Date.now() - (editedAt.get(name) ?? 0) < EDIT_QUIET_MS) {
      clearTimeout(applyTimers.get(name))
      applyTimers.set(
        name,
        setTimeout(() => applyCollection(name), EDIT_QUIET_MS + 300),
      )
      return
    }
    const items = latest.get(name)
    if (!items) return
    const current = opts.getData()[name] as unknown as Item[]
    if (stableStringify(current) !== stableStringify(items)) {
      opts.applyRemote({ [name]: items } as Partial<AppData>)
    }
  }

  const handleSnapshot = (name: CollectionName, snap: QuerySnap) => {
    const map = new Map<string, string>()
    const rows: Array<{ pos: number; item: Item }> = []
    for (const doc of snap.docs) {
      if (!doc.exists) continue
      const body = doc.data()
      if (!body) continue
      map.set(doc.id, stableStringify(body))
      const { pos, ...fields } = body as { pos?: unknown } & Record<string, unknown>
      rows.push({
        pos: typeof pos === 'number' ? pos : Number.MAX_SAFE_INTEGER,
        item: { ...fields, id: doc.id } as Item,
      })
    }
    rows.sort((a, b) => a.pos - b.pos)
    server.set(name, map)
    latest.set(
      name,
      rows.map((r) => r.item),
    )
    if (!live) {
      seen.add(name)
      if (seen.size === COLLECTIONS.length) initialize()
      return
    }
    applyCollection(name)
  }

  const schedulePush = (delay = PUSH_DEBOUNCE_MS) => {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(() => {
      pushTimer = null
      if (live) pushAll()
    }, delay)
  }

  const pushCollection = (name: CollectionName, items: Item[]) => {
    let srv = server.get(name)
    if (!srv) {
      srv = new Map()
      server.set(name, srv)
    }
    const map = srv
    const desiredIds = new Set<string>()
    items.forEach((item, i) => {
      desiredIds.add(item.id)
      const body = withPos(item, i)
      const json = stableStringify(body)
      if (map.get(item.id) !== json) {
        store
          .collection(name)
          .doc(item.id)
          .set(body)
          .then(
            () => map.set(item.id, json),
            () => schedulePush(5000), // transient failure — retry later
          )
      }
    })
    for (const id of Array.from(map.keys())) {
      if (!desiredIds.has(id)) {
        store
          .collection(name)
          .doc(id)
          .delete()
          .then(
            () => map.delete(id),
            () => schedulePush(5000),
          )
      }
    }
  }

  const pushAll = () => {
    const data = opts.getData()
    for (const name of COLLECTIONS) pushCollection(name, data[name] as unknown as Item[])
  }

  const initialize = () => {
    const totalDocs = COLLECTIONS.reduce((n, c) => n + (server.get(c)?.size ?? 0), 0)
    const data = opts.getData()
    const localCount = COLLECTIONS.reduce((n, c) => n + (data[c]?.length ?? 0), 0)
    live = true
    opts.setStatus('live')
    if (totalDocs === 0 && localCount > 0) {
      // First writer bootstraps the shared workspace from this browser.
      pushAll()
    } else {
      const patch: Record<string, unknown> = {}
      for (const name of COLLECTIONS) patch[name] = latest.get(name) ?? []
      opts.applyRemote(patch as Partial<AppData>)
    }
  }

  for (const name of COLLECTIONS) {
    store.collection(name).onSnapshot(
      (snap) => handleSnapshot(name, snap),
      (e) => console.warn(`db subscription error on ${name}:`, e),
    )
  }

  return {
    onLocalChange(data: AppData) {
      if (!live) return
      let dirty = false
      for (const name of COLLECTIONS) {
        const items = data[name] as unknown as Item[]
        const srv = server.get(name)
        let collectionDirty = items.length !== (srv?.size ?? 0)
        if (!collectionDirty && srv) {
          for (let i = 0; i < items.length; i++) {
            if (srv.get(items[i].id) !== stableStringify(withPos(items[i], i))) {
              collectionDirty = true
              break
            }
          }
        }
        if (collectionDirty) {
          editedAt.set(name, Date.now())
          dirty = true
        }
      }
      if (dirty) schedulePush()
    },
  }
}
