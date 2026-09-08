import { COLLECTIONS, type AppData, type CollectionName } from './types'

/**
 * Shared-workspace sync. When the app runs as a published claude.ai artifact
 * with the `db` capability, app state is mirrored into the artifact's shared
 * realtime store so everyone the page is shared with sees the same pipeline,
 * live. Anywhere else it resolves to null and the app stays localStorage-only.
 *
 * Layout: one db collection per AppData collection, one document per record
 * (doc id = record id, body = fields + `pos` for ordering). Per-record docs
 * mean two people editing different deals never clobber each other; edits to
 * the same record are last-writer-wins.
 */

export type SyncStatus = 'local' | 'connecting' | 'live'

export interface SyncEngine {
  onLocalChange(data: AppData): void
}

type Item = { id: string } & Record<string, unknown>

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

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
}

const EDIT_QUIET_MS = 3000
const PUSH_DEBOUNCE_MS = 700

export async function startSync(opts: {
  getData: () => AppData
  applyRemote: (patch: Partial<AppData>) => void
  /** Called once when the shared store is completely empty; return the data to bootstrap with. */
  bootstrap: () => AppData
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

  const server = new Map<CollectionName, Map<string, string>>()
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
      applyTimers.set(name, setTimeout(() => applyCollection(name), EDIT_QUIET_MS + 300))
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
    latest.set(name, rows.map((r) => r.item))
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
            () => schedulePush(5000),
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
    live = true
    opts.setStatus('live')
    if (totalDocs === 0) {
      // Empty shared workspace: the first viewer seeds it.
      const seed = opts.bootstrap()
      opts.applyRemote(seed)
      for (const name of COLLECTIONS) pushCollection(name, seed[name] as unknown as Item[])
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
