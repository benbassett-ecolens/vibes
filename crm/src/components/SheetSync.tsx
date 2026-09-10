import { useApp, syncMeta } from '../store'
import { useUI } from '../ui'
import { SHEET_URL } from '../seed'
import { describeSyncError } from '../useSheetSync'
import { summaryText } from '../sheetSync'

function ago(iso: string): string {
  if (!iso) return 'never'
  const ms = Date.now() - Date.parse(iso)
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

/** Top-bar control: one click re-reads the sheet; shows last sync and any error. */
export function SheetSyncButton() {
  const { data } = useApp()
  const { sheet } = useUI()
  if (!sheet.available) return null
  const meta = syncMeta(data)
  const busy = sheet.state.kind === 'syncing'
  const title =
    sheet.state.kind === 'error'
      ? describeSyncError(sheet.state.code, sheet.state.message)
      : sheet.state.kind === 'done'
        ? `Synced just now: ${summaryText(sheet.state.summary)}`
        : `Last synced ${ago(meta.lastSheetSyncAt)}${meta.lastSheetSyncSummary ? ` · ${meta.lastSheetSyncSummary}` : ''}`
  return (
    <button
      className={`sheet-sync ${sheet.state.kind}`}
      onClick={() => sheet.sync('manual')}
      disabled={busy}
      title={title}
      aria-live="polite"
    >
      <span aria-hidden="true" className={busy ? 'spin' : ''}>
        ⟳
      </span>{' '}
      {busy ? 'Syncing…' : sheet.state.kind === 'error' ? 'Sync failed' : 'Sync sheet'}
      {!busy && sheet.state.kind !== 'error' && (
        <span className="sync-when">{ago(sheet.state.kind === 'done' ? sheet.state.at : meta.lastSheetSyncAt)}</span>
      )}
    </button>
  )
}

/** Settings panel: status, auto-sync toggle, and the merge rules in plain words. */
export function SheetSyncPanel() {
  const { data, actions, syncStatus } = useApp()
  const { sheet } = useUI()
  const meta = syncMeta(data)
  return (
    <section className="panel">
      <h3>Google Sheet</h3>
      <p className="muted small">
        Deals mirror the{' '}
        <a href={SHEET_URL} target="_blank" rel="noreferrer">
          Ecolens Sales Pipeline
        </a>{' '}
        sheet. The sheet stays the place to add rows and update stage, values, dates and the Notes column;
        the CRM adds activities, contacts, dashboards and a notes history on top.
      </p>

      <dl className="stats">
        <div>
          <dt>Last synced</dt>
          <dd className="small-dd">{meta.lastSheetSyncAt ? `${ago(meta.lastSheetSyncAt)}` : 'Never'}</dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd className="small-dd">{meta.lastSheetSyncSummary || '—'}</dd>
        </div>
        <div>
          <dt>Triggered by</dt>
          <dd className="small-dd">{meta.lastSheetSyncBy || '—'}</dd>
        </div>
      </dl>

      {sheet.available ? (
        <div className="data-controls">
          <button className="primary" onClick={() => sheet.sync('manual')} disabled={sheet.state.kind === 'syncing'}>
            {sheet.state.kind === 'syncing' ? 'Syncing…' : 'Sync from sheet now'}
          </button>
          <label className="toggle">
            <input
              type="checkbox"
              checked={meta.autoSync}
              onChange={(e) => actions.updateMeta({ autoSync: e.target.checked })}
            />
            Re-read the sheet automatically when the page opens (if the last sync is over an hour old)
          </label>
        </div>
      ) : (
        <p className="empty-state">
          {syncStatus === 'live'
            ? 'Google Drive access was not granted to this page. Reload and allow the connector when prompted, or add Google Drive under claude.ai Settings → Connectors.'
            : 'Sheet sync runs inside the published claude.ai page, where it reads the sheet through your Google Drive connector. In local mode use “Reset to sheet import” below for the Sep 8 snapshot.'}
        </p>
      )}

      {sheet.state.kind === 'error' && (
        <p className="sync-error" role="alert">
          {describeSyncError(sheet.state.code, sheet.state.message)}
        </p>
      )}
      {sheet.state.kind === 'done' && (
        <div className="sync-result">
          <strong>Synced:</strong> {summaryText(sheet.state.summary)}
          {sheet.state.summary.created.length > 0 && <div className="small muted">New: {sheet.state.summary.created.join(', ')}</div>}
          {sheet.state.summary.updated.length > 0 && <div className="small muted">Updated: {sheet.state.summary.updated.join(', ')}</div>}
          {sheet.state.summary.removed.length > 0 && (
            <div className="small muted">No longer on the sheet: {sheet.state.summary.removed.join(', ')}</div>
          )}
        </div>
      )}

      <details className="merge-rules">
        <summary>How changes are merged</summary>
        <ul className="small muted">
          <li>A deal is matched to a row by its Prospect Name. Renaming a row on the sheet creates a new deal.</li>
          <li>A cell that changed on the sheet since the last sync updates the matching field here, even if someone edited it in the CRM.</li>
          <li>A field edited in the CRM is kept as long as its sheet cell did not change.</li>
          <li>A changed Notes cell is added as a new note; earlier notes stay in the timeline.</li>
          <li>New rows become new deals. Unknown owners and stages are created.</li>
          <li>A row removed from the sheet tags its deal “Removed from sheet” rather than deleting it.</li>
          <li>Changes made here are not written back to the sheet.</li>
        </ul>
      </details>
    </section>
  )
}
