import type { Queryable } from './db.js'
import { query } from './db.js'

export type AuditAction = 'create' | 'update' | 'delete' | 'archive' | 'restore' | 'stage_change' | 'complete' | 'reopen' | 'login'

/** Compute { field: {from,to} } for fields that actually changed. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  ignore: string[] = ['updated_at', 'created_at'],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignore.includes(key)) continue
    const a = normalize(before[key])
    const b = normalize(after[key])
    if (a !== b) out[key] = { from: before[key] ?? null, to: after[key] ?? null }
  }
  return out
}

function normalize(v: unknown): string {
  if (v === undefined || v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export async function audit(
  client: Queryable,
  entry: {
    entityType: string
    entityId: string
    action: AuditAction
    actorId: string | null
    changes?: Record<string, unknown>
    summary?: string
  },
): Promise<void> {
  await query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor_id, changes, summary)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [entry.entityType, entry.entityId, entry.action, entry.actorId, JSON.stringify(entry.changes ?? {}), entry.summary ?? null],
    client,
  )
}
