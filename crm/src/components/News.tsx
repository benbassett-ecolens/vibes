import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, qs } from '../api'
import { fmtDateTime } from '../format'
import { useQuery } from '../hooks'
import { ConfirmButton, useToast } from './ui'
import type { CompanyNews, PartnerKind } from '../../shared/types'
import { COMPANY_KIND_LABEL } from '../../shared/types'

/** Small, safe Markdown subset renderer (headings, lists, bold, links, paragraphs). No raw HTML. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: ReactNode[] = []
  let list: { ordered: boolean; items: ReactNode[] } | null = null
  const flush = () => {
    if (list) out.push(list.ordered ? <ol key={out.length}>{list.items}</ol> : <ul key={out.length}>{list.items}</ul>)
    list = null
  }
  lines.forEach((raw) => {
    const line = raw.trimEnd()
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    const li = line.match(/^\s*[-*•]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (h) { flush(); out.push(h[1].length <= 2 ? <h3 key={out.length}>{inline(h[2])}</h3> : <h4 key={out.length}>{inline(h[2])}</h4>) }
    else if (li || ol) {
      const ordered = !!ol
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push(<li key={list.items.length}>{inline((li ?? ol)![1])}</li>)
    } else if (!line.trim()) flush()
    else { flush(); out.push(<p key={out.length}>{inline(line)}</p>) }
  })
  flush()
  return <div className="md">{out}</div>
}

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**')) parts.push(<strong key={parts.length}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) parts.push(<code key={parts.length}>{t.slice(1, -1)}</code>)
    else parts.push(<a key={parts.length} href={m[2]} target="_blank" rel="noreferrer">{t.slice(1, t.indexOf(']'))}</a>)
    last = m.index + t.length
  }
  if (last < s.length) parts.push(s.slice(last))
  return parts
}

function NewsItem({ n, onDeleted, showCompany }: { n: CompanyNews; onDeleted: () => void; showCompany?: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(true)
  return (
    <div className="news-item">
      <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
        <button className="btn ghost sm" onClick={() => setOpen((v) => !v)} title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
        <strong className="grow">{n.question}</strong>
        <span className="muted small">{n.created_by_name ?? 'Someone'} · {fmtDateTime(n.created_at)}</span>
        <ConfirmButton className="btn ghost sm" label="delete" onConfirm={async () => { await api.delete(`/api/vars/news/${n.id}`); toast('Deleted'); onDeleted() }} />
      </div>
      {open && (
        <>
          {showCompany && n.company_name && n.company_id && <div className="small muted">About <Link to={`${COMPANY_KIND_LABEL[n.scope_kind].path}/${n.company_id}`}>{n.company_name}</Link></div>}
          <Markdown text={n.answer} />
          {n.sources.length > 0 && (
            <div className="small muted" style={{ marginTop: 6 }}>
              Sources: {n.sources.slice(0, 10).map((s, i) => <span key={s.url}>{i > 0 && ' · '}<a href={s.url} target="_blank" rel="noreferrer">{s.title ?? new URL(s.url).hostname}</a></span>)}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Ask a natural-language question about one VAR (companyId) or all VARs (no companyId). Shows the history. */
export function NewsCard({ companyId, kind = 'var', title }: { companyId?: string; kind?: PartnerKind; title?: string }) {
  const L = COMPANY_KIND_LABEL[kind]
  const toast = useToast()
  const status = useQuery(() => api.get<{ ai_configured: boolean }>('/api/vars/status'), [])
  const history = useQuery(() => api.get<{ items: CompanyNews[] }>(`/api/vars/news${qs({ company_id: companyId, kind: companyId ? undefined : kind })}`), [companyId, kind])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const ask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    try {
      await api.post(companyId ? `/api/vars/${companyId}/news/ask` : '/api/vars/news/ask', { question: q.trim(), ...(companyId ? {} : { kind }) })
      setQ('')
      await history.refresh()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const suggestions = companyId
    ? ['What is the latest news on this company?', 'Any leadership changes or acquisitions in the last year?', kind === 'erp' ? 'What changed in their partner program or licensing this year?' : 'What products and ERP ecosystems do they focus on today?']
    : kind === 'erp'
      ? ['What is the latest news across our ERPs this month?', 'Which ERP publishers changed partner programs or pricing this year?', 'What major releases or acquisitions did our ERPs announce?']
      : kind === 'isv'
        ? ['What is the latest news across our ISVs this month?', 'Which of our ISVs launched new products or integrations this year?', 'Which ISVs were acquired or raised money in the last year?']
        : ['What is the latest news across our VARs this month?', 'Which of our VARs were acquired or raised money in the last year?', 'Which VARs announced new Acumatica or NetSuite practices?']
  return (
    <div className="card">
      <div className="card-h"><h2>{title ?? 'News & research'}</h2><span className="muted small right">asks Claude with live web search · answers are saved here</span></div>
      <div className="card-b">
        {status.data && !status.data.ai_configured && <div className="error-box" style={{ marginBottom: 10 }}>Not configured on the server. Add the Claude API key (see README → VAR news) and redeploy.</div>}
        <form onSubmit={ask} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <textarea className="textarea grow" rows={2} placeholder={companyId ? `Ask anything about this ${L.one}…` : `Ask anything about your ${L.many}…`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(e as unknown as React.FormEvent) }} />
          <button className="btn primary" disabled={busy || !q.trim() || status.data?.ai_configured === false}>{busy ? 'Searching…' : 'Ask'}</button>
        </form>
        <div className="row wrap small" style={{ gap: 6, marginTop: 6 }}>
          {suggestions.map((s) => <button key={s} type="button" className="btn ghost sm" onClick={() => setQ(s)}>{s}</button>)}
        </div>
        {busy && <div className="muted small" style={{ marginTop: 8 }}>Searching the web and writing the answer. This takes 20–60 seconds.</div>}
        <div style={{ marginTop: 12 }}>
          {(history.data?.items ?? []).map((n) => <NewsItem key={n.id} n={n} onDeleted={() => void history.refresh()} showCompany={!companyId} />)}
          {history.data && !history.data.items.length && <div className="muted small">No questions asked yet.</div>}
        </div>
      </div>
    </div>
  )
}
