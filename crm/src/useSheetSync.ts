import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './store'
import { syncMeta } from './store'
import { SHEET_FILE_ID, applySheetRows, decodeBase64Utf8, rowsFromCsv, summaryText, type SyncSummary } from './sheetSync'
import { nowISO, today } from './format'

/** Connector display name + tool the page is allowed to call (declared in the artifact manifest). */
export const DRIVE_SERVER = 'Google Drive'
export const DRIVE_TOOL = 'download_file_content'

/** Re-read the sheet on open when the last sync is older than this. */
const STALE_MS = 60 * 60 * 1000

interface McpError {
  code: string
  message: string
  server?: string
  retryable?: boolean
  retryAfterMs?: number
}
interface McpNamespace {
  callTool(server: string, tool: string, input?: unknown, options?: unknown): Promise<{ payload?: unknown }>
}

export type SheetSyncState =
  | { kind: 'unavailable' } // not inside the artifact viewer, or MCP not granted
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'done'; summary: SyncSummary; at: string }
  | { kind: 'error'; code: string; message: string }

/** Human wording per error code — each branch names the fix. */
export function describeSyncError(code: string, message: string): string {
  switch (code) {
    case 'needs_reauth':
      return 'Google Drive needs to be reconnected. Open claude.ai Settings → Connectors and reconnect Google Drive, then sync again.'
    case 'server_not_connected':
      return 'Google Drive is not connected for your account. Add it in claude.ai Settings → Connectors, then sync again.'
    case 'selection_required':
      return 'You have more than one Google Drive connector. Pick one when the page asks, then sync again.'
    case 'not_in_manifest':
    case 'not_granted':
    case 'capability_disabled':
    case 'capability_removed':
      return 'This page was not granted access to Google Drive in your session. Reload and allow the connector when prompted.'
    case 'blocked_by_policy':
    case 'approval_required':
      return 'Your organization’s policy blocks this page from reading Google Drive.'
    case 'server_unavailable':
    case 'rate_limited':
      return 'Google Drive did not answer in time. Try again in a moment.'
    case 'tool_error':
      return `Google Drive could not export the sheet: ${message}`
    case 'bad_sheet':
      return message
    default:
      return `Sync failed (${code}): ${message}`
  }
}

export function useSheetSync() {
  const { data, setData, actions, syncStatus } = useApp()
  const [state, setState] = useState<SheetSyncState>({ kind: 'unavailable' })
  const mcpRef = useRef<McpNamespace | null>(null)
  const autoRan = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data

  // Resolve the capability once; it settles later than first render and may be null.
  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined' || !window.claude?.use) return
    window.claude
      .use('mcp')
      .then((ns) => {
        if (cancelled) return
        mcpRef.current = (ns as McpNamespace | null) ?? null
        setState(mcpRef.current ? { kind: 'idle' } : { kind: 'unavailable' })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sync = useCallback(
    async (by: 'manual' | 'auto' = 'manual') => {
      const mcp = mcpRef.current
      if (!mcp) return
      setState({ kind: 'syncing' })
      let attempt = 0
      // One retry, only for errors the runtime stamps retryable.
      for (;;) {
        try {
          const result = await mcp.callTool(
            DRIVE_SERVER,
            DRIVE_TOOL,
            { fileId: SHEET_FILE_ID, exportMimeType: 'text/csv' },
            { cache: false },
          )
          let payload = result.payload
          if (typeof payload === 'string') {
            try {
              payload = JSON.parse(payload)
            } catch {
              // a bare string is not the expected export envelope
            }
          }
          const content = (payload as { content?: unknown } | undefined)?.content
          if (typeof content !== 'string') {
            throw { code: 'bad_sheet', message: 'The sheet export did not contain any CSV content.' }
          }
          const rows = rowsFromCsv(decodeBase64Utf8(content))
          if (rows.length === 0) {
            throw { code: 'bad_sheet', message: 'The sheet export had no pipeline rows.' }
          }
          const at = nowISO()
          let summary: SyncSummary | null = null
          setData((d) => {
            const r = applySheetRows(d, rows, { today: today(), now: at })
            summary = r.summary
            return r.data
          })
          // setData's updater runs synchronously for a state update outside a batch, but guard anyway.
          const finalSummary: SyncSummary =
            summary ?? applySheetRows(dataRef.current, rows, { today: today(), now: at }).summary
          actions.updateMeta({
            lastSheetSyncAt: at,
            lastSheetSyncSummary: summaryText(finalSummary),
            lastSheetSyncBy: by,
          })
          setState({ kind: 'done', summary: finalSummary, at })
          return
        } catch (e) {
          const err = (e ?? {}) as Partial<McpError> & { message?: string }
          const code = err.code ?? 'upstream_error'
          if (err.retryable && attempt === 0) {
            attempt++
            await new Promise((r) => setTimeout(r, Math.min(err.retryAfterMs ?? 800 + Math.random() * 700, 60000)))
            continue
          }
          setState({ kind: 'error', code, message: err.message ?? String(e) })
          return
        }
      }
    },
    [setData, actions],
  )

  // Auto-refresh on open, once, when the workspace is live and the last sync is stale.
  useEffect(() => {
    if (autoRan.current || state.kind !== 'idle' || syncStatus !== 'live') return
    const meta = syncMeta(data)
    if (!meta.autoSync) return
    const last = meta.lastSheetSyncAt ? Date.parse(meta.lastSheetSyncAt) : 0
    if (Date.now() - last < STALE_MS) return
    autoRan.current = true
    void sync('auto')
  }, [state.kind, syncStatus, data, sync])

  return { state, sync, available: state.kind !== 'unavailable' }
}
