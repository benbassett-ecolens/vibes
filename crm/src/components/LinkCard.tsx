import { useState } from 'react'
import { api } from '../api'
import { useQuery } from '../hooks'
import { CompanyPicker } from './Pickers'
import { useToast } from './ui'

interface Suggestion { company_id: string; company_name: string; score: number; reason: string }
interface Row { contact: { id: string; first_name: string; last_name: string; email: string }; domain: string; suggestions: Suggestion[] }

export function LinkCard() {
  const toast = useToast()
  const data = useQuery(() => api.get<{ items: Row[]; unlinked: number; with_suggestion: number }>('/api/link/suggestions'), [])
  const [choice, setChoice] = useState<Record<string, { id: string | null; name: string | null }>>({})
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ linked: number; deals_updated: number } | null>(null)
  const rows = data.data?.items ?? []
  const pick = (r: Row) => choice[r.contact.id] ?? (r.suggestions[0] ? { id: r.suggestions[0].company_id, name: r.suggestions[0].company_name } : { id: null, name: null })
  const isChecked = (r: Row) => checked[r.contact.id] ?? (r.suggestions[0]?.score ?? 0) >= 0.8
  const apply = async () => {
    const links = rows.filter((r) => isChecked(r) && pick(r).id).map((r) => ({ contact_id: r.contact.id, company_id: pick(r).id! }))
    if (!links.length) return toast('Nothing selected', 'error')
    setBusy(true)
    try {
      const r = await api.post<{ linked: number; deals_updated: number }>('/api/link/apply', { links })
      setResult(r)
      toast(`Linked ${r.linked} contacts`)
      setChoice({})
      setChecked({})
      await data.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const selectedCount = rows.filter((r) => isChecked(r) && pick(r).id).length
  return (
    <div className="card">
      <div className="card-h">
        <h2>Link contacts to companies</h2>
        <span className="muted small right">{data.data ? `${data.data.unlinked} contacts without a company · ${data.data.with_suggestion} with a suggested match` : '…'}</span>
      </div>
      <div className="card-b" style={{ padding: 0 }}>
        <p className="small muted" style={{ padding: '10px 16px 0' }}>
          Matches use the email domain against company names and known company domains. High-confidence rows are pre-ticked; change any row's company, untick doubtful ones, then Link. Linking also records the domain on the company (so future senders attach automatically) and sets the contact as main contact on the company's deals that have none.
        </p>
        <table className="table" style={{ marginTop: 8 }}>
          <thead><tr><th style={{ width: 32 }} /><th>Contact</th><th>Email domain</th><th>Company</th><th>Confidence</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = pick(r)
              const best = r.suggestions.find((s) => s.company_id === p.id)
              return (
                <tr key={r.contact.id}>
                  <td><input type="checkbox" checked={isChecked(r) && !!p.id} disabled={!p.id} onChange={(e) => setChecked({ ...checked, [r.contact.id]: e.target.checked })} /></td>
                  <td><strong>{r.contact.first_name} {r.contact.last_name}</strong><div className="muted small">{r.contact.email}</div></td>
                  <td className="small">{r.domain}</td>
                  <td style={{ minWidth: 240 }}><CompanyPicker value={p.id} label={p.name} onChange={(id, c) => { setChoice({ ...choice, [r.contact.id]: { id, name: c?.name ?? null } }); if (id) setChecked({ ...checked, [r.contact.id]: true }) }} /></td>
                  <td>{best ? <span className={`badge ${best.score >= 0.8 ? 'good' : best.score >= 0.6 ? 'warn' : ''}`}>{Math.round(best.score * 100)}% · {best.reason}</span> : p.id ? <span className="badge">manual</span> : <span className="muted small">no match</span>}</td>
                </tr>
              )
            })}
            {data.data && !rows.length && <tr><td colSpan={5} className="empty">Every contact with an email is linked to a company.</td></tr>}
          </tbody>
        </table>
        <div className="row" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
          {result && <span className="small muted">Last run: linked {result.linked} contacts, set main contact on {result.deals_updated} deals.</span>}
          <button className="btn primary right" disabled={busy || !selectedCount} onClick={apply}>Link {selectedCount} selected</button>
        </div>
      </div>
    </div>
  )
}
