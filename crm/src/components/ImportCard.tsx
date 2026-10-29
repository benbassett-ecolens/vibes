import { useState } from 'react'
import { api } from '../api'
import { useRefData } from '../refdata'
import { Field, useToast } from './ui'

interface Preview {
  total_rows: number
  mapped_fields: string[]
  unmapped_columns: string[]
  owners: Array<{ name: string; rows: number; user_id: string | null; user_email: string | null }>
  stages: Array<{ name: string; rows: number; stage_id: string | null }>
  companies_new: number
  companies_existing: number
  deals_existing: number
  problems: Array<{ line: number; company: string; problems: string[] }>
}
interface Result { deals_created: number; deals_skipped: number; companies_created: number; contacts_created: number; users_created: number; errors: Array<{ line: number; error: string }> }

export function ImportCard() {
  const toast = useToast()
  const { pipelines, refresh } = useRefData()
  const [pipelineId, setPipelineId] = useState('')
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [ownerMap, setOwnerMap] = useState<Record<string, string>>({})
  const [stageMap, setStageMap] = useState<Record<string, string>>({})
  const [leadSource, setLeadSource] = useState('Pipeline sheet')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines.find((p) => p.is_default) ?? pipelines[0]

  const onFile = (f: File | undefined) => {
    if (!f) return
    setFileName(f.name)
    f.text().then((t) => { setCsv(t); setPreview(null); setResult(null) })
  }
  const run = async () => {
    setBusy(true)
    try {
      const p = await api.post<Preview>('/api/import/preview', { csv, pipeline_id: pipeline?.id })
      setPreview(p)
      setOwnerMap(Object.fromEntries(p.owners.filter((o) => !o.user_id).map((o) => [o.name, ''])))
      setStageMap({})
      setResult(null)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const commit = async () => {
    if (!preview) return
    const missingOwner = preview.owners.filter((o) => !o.user_id && !ownerMap[o.name]?.trim())
    if (missingOwner.length) {
      toast(`Give an email for: ${missingOwner.map((o) => o.name).join(', ')}`, 'error')
      return
    }
    const missingStage = preview.stages.filter((s) => !s.stage_id && !stageMap[s.name])
    if (missingStage.length) {
      toast(`Pick a stage for: ${missingStage.map((s) => s.name).join(', ')}`, 'error')
      return
    }
    setBusy(true)
    try {
      const r = await api.post<Result>('/api/import/commit', { csv, pipeline_id: pipeline?.id, owner_map: ownerMap, stage_map: stageMap, default_lead_source: leadSource, skip_existing: true })
      setResult(r)
      toast(`Imported ${r.deals_created} deals`)
      await refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const ready = csv.trim().length > 0

  return (
    <div className="card">
      <div className="card-h"><h2>Import deals from CSV</h2><span className="muted small right">Google Sheets → File → Download → CSV</span></div>
      <div className="card-b">
        <p className="small muted" style={{ marginBottom: 10 }}>
          Header row required. Recognised columns: owner (Director/CPM), company (Prospect Name), function, Ecolens BU, ISV/VAR/Other, ecosystem, Retainer ACV, Performance ACV, Total Contract Value, deal stage, close date, notes, and optional contact name/email/title, lead source, deal type, contract length. Retainer ACV becomes the monthly retainer product (ACV ÷ 12 per month) and Performance ACV becomes Core ERP Closed Won %, so first-year value equals retainer + performance.
        </p>
        <div className="row wrap" style={{ marginBottom: 10 }}>
          <label className="btn">
            Choose CSV file <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <span className="small muted">{fileName || 'or paste below'}</span>
          {pipelines.length > 1 && (
            <select className="select" value={pipeline?.id ?? ''} onChange={(e) => setPipelineId(e.target.value)} style={{ width: 'auto' }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button className="btn primary right" disabled={!ready || busy} onClick={run}>Preview</button>
        </div>
        <textarea className="textarea" placeholder="Director/CPM,Prospect Name,Function,…" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null) }} style={{ minHeight: 70, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div className="row wrap small" style={{ gap: 12, marginBottom: 10 }}>
              <span className="badge brand">{preview.total_rows} deal rows</span>
              <span className="badge">{preview.companies_new} new companies · {preview.companies_existing} existing</span>
              {preview.deals_existing > 0 && <span className="badge warn">{preview.deals_existing} deals already exist (will be skipped)</span>}
              {preview.unmapped_columns.length > 0 && <span className="badge" title={preview.unmapped_columns.join(', ')}>ignored columns: {preview.unmapped_columns.join(', ')}</span>}
            </div>
            <div className="form-grid">
              <div>
                <h3 style={{ marginBottom: 6 }}>Owners</h3>
                {preview.owners.map((o) => (
                  <div key={o.name} className="row" style={{ marginBottom: 6 }}>
                    <span style={{ width: 160 }} className="truncate">{o.name} <span className="muted small">({o.rows})</span></span>
                    {o.user_id ? <span className="badge good">{o.user_email}</span> : <input className="input sm" placeholder="their @ecolens.io email" value={ownerMap[o.name] ?? ''} onChange={(e) => setOwnerMap({ ...ownerMap, [o.name]: e.target.value })} />}
                  </div>
                ))}
                {!preview.owners.length && <span className="muted small">No owner column.</span>}
              </div>
              <div>
                <h3 style={{ marginBottom: 6 }}>Stages</h3>
                {preview.stages.map((s) => (
                  <div key={s.name} className="row" style={{ marginBottom: 6 }}>
                    <span style={{ width: 160 }} className="truncate">{s.name} <span className="muted small">({s.rows})</span></span>
                    {s.stage_id ? <span className="badge good">matched</span> : (
                      <select className="select sm" value={stageMap[s.name] ?? ''} onChange={(e) => setStageMap({ ...stageMap, [s.name]: e.target.value })}>
                        <option value="">Choose stage…</option>
                        {pipeline?.stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                    )}
                  </div>
                ))}
              </div>
              <Field label="Lead source for rows without one"><input className="input sm" value={leadSource} onChange={(e) => setLeadSource(e.target.value)} /></Field>
            </div>
            {preview.problems.length > 0 && (
              <div className="error-box" style={{ marginTop: 10 }}>
                {preview.problems.slice(0, 10).map((p) => <div key={p.line}>Row {p.line} ({p.company}): {p.problems.join('; ')}</div>)}
                {preview.problems.length > 10 && <div>…and {preview.problems.length - 10} more</div>}
              </div>
            )}
            <div className="form-actions"><button className="btn primary" disabled={busy} onClick={commit}>Import {preview.total_rows} deals</button></div>
          </div>
        )}
        {result && (
          <div className={result.errors.length ? 'error-box' : 'badge good'} style={{ marginTop: 10, display: 'block', padding: '8px 12px' }}>
            Imported {result.deals_created} deals, {result.companies_created} companies, {result.contacts_created} contacts; created {result.users_created} user placeholders; skipped {result.deals_skipped} existing.
            {result.errors.slice(0, 10).map((e) => <div key={e.line}>Row {e.line}: {e.error}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}
