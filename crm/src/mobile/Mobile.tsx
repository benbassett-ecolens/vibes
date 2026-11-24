/**
 * Mobile view: the few things a rep does on a show floor, on a phone, in seconds.
 * Same auth, same API, same data as the desktop app; only the screens are different.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, qs } from '../api'
import { useAuth } from '../auth'
import { fmtDate, money, relative } from '../format'
import { useDebounced, useQuery } from '../hooks'
import { useRefData } from '../refdata'
import { useToast } from '../components/ui'
import { ACTIVITY_ICON } from '../components/Timeline'
import { DEAL_TYPE_LABEL, DEAL_TYPES } from '../../shared/pricing'
import type { Activity, ActivityType, Company, Contact, Deal, Paged } from '../../shared/types'

const isoIn = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
const atNineIn = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

// ---------- shell ----------

export function MobileShell() {
  const { user, logout } = useAuth()
  return (
    <div className="mshell">
      <main className="mmain">
        <Routes>
          <Route path="/" element={<MHome />} />
          <Route path="/log" element={<MLog />} />
          <Route path="/deal/new" element={<MNewDeal />} />
          <Route path="/deal/:id" element={<MDeal />} />
          <Route path="/contact/new" element={<MNewContact />} />
          <Route path="/more" element={<MMore name={user?.name ?? ''} email={user?.email ?? ''} onLogout={logout} />} />
          <Route path="*" element={<Navigate to="/m" replace />} />
        </Routes>
      </main>
      <nav className="mnav">
        <NavLink to="/m" end><span>⌂</span>Home</NavLink>
        <NavLink to="/m/log"><span>✎</span>Log</NavLink>
        <NavLink to="/m/deal/new" className="primary"><span>＋</span>Deal</NavLink>
        <NavLink to="/m/contact/new"><span>◉</span>Contact</NavLink>
        <NavLink to="/m/more"><span>⋯</span>More</NavLink>
      </nav>
    </div>
  )
}

function MHeader({ title, back, right }: { title: string; back?: string; right?: React.ReactNode }) {
  return (
    <header className="mhead">
      {back ? <Link to={back} className="mback" aria-label="Back">‹</Link> : <img src="/brand/logo.png" alt="" className="mlogo" />}
      <h1>{title}</h1>
      <div className="grow" />
      {right}
    </header>
  )
}

// ---------- home: search + quick actions + my deals + today ----------

function MHome() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 200)
  const deals = useQuery(() => api.get<Paged<Deal>>(`/api/deals${qs({ q: dq, owner_id: dq ? undefined : user?.id, status: 'open', sort: 'last_activity', dir: 'desc', limit: dq ? 15 : 8 })}`), [dq, user?.id])
  const companies = useQuery(() => (dq ? api.get<Paged<Company>>(`/api/companies${qs({ q: dq, kind: 'all', limit: 6 })}`) : Promise.resolve(null)), [dq])
  const contacts = useQuery(() => (dq ? api.get<Paged<Contact>>(`/api/contacts${qs({ q: dq, limit: 6 })}`) : Promise.resolve(null)), [dq])
  const today = useQuery(() => api.get<Paged<Activity>>(`/api/activities${qs({ owner_id: user?.id, status: 'open', sort: 'due_at', dir: 'asc', limit: 8 })}`), [user?.id])
  const overdueOrToday = (today.data?.items ?? []).filter((a) => a.due_at && new Date(a.due_at).getTime() < Date.now() + 86400e3)
  return (
    <>
      <MHeader title="Ecolens CRM" />
      <div className="msearch">
        <input className="minput" type="search" placeholder="Search deals, companies, people" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </div>
      {!dq && (
        <div className="mquick">
          <Link to="/m/deal/new" className="mqbtn primary"><span>＋</span>New deal</Link>
          <Link to="/m/log" className="mqbtn"><span>✎</span>Log a note</Link>
          <Link to="/m/contact/new" className="mqbtn"><span>◉</span>New contact</Link>
        </div>
      )}
      {dq && (companies.data?.items.length ?? 0) > 0 && (
        <section className="msec">
          <h2>Companies</h2>
          {companies.data!.items.map((c) => (
            <Link key={c.id} to={`/m/log?company=${c.id}`} className="mrow">
              <span className="grow"><strong>{c.name}</strong><small>{c.kind !== 'company' ? c.kind.toUpperCase() : c.industry ?? ''}{c.open_deal_count ? ` · ${c.open_deal_count} open` : ''}</small></span>
              <span className="chev">›</span>
            </Link>
          ))}
        </section>
      )}
      {dq && (contacts.data?.items.length ?? 0) > 0 && (
        <section className="msec">
          <h2>People</h2>
          {contacts.data!.items.map((c) => (
            <Link key={c.id} to={`/m/log?contact=${c.id}`} className="mrow">
              <span className="grow"><strong>{c.first_name} {c.last_name}</strong><small>{[c.title, c.company_name].filter(Boolean).join(' · ')}</small></span>
              <span className="chev">›</span>
            </Link>
          ))}
        </section>
      )}
      <section className="msec">
        <h2>{dq ? 'Deals' : 'My deals'}<span className="muted small"> {dq ? '' : '· most recent first'}</span></h2>
        {(deals.data?.items ?? []).map((d) => <DealRow key={d.id} d={d} />)}
        {deals.data && !deals.data.items.length && <div className="mempty">{dq ? 'No deals match.' : 'No open deals yet. Tap New deal.'}</div>}
      </section>
      {!dq && overdueOrToday.length > 0 && (
        <section className="msec">
          <h2>Due today</h2>
          {overdueOrToday.map((a) => (
            <Link key={a.id} to={a.deal_id ? `/m/deal/${a.deal_id}` : '/m/log'} className="mrow">
              <span className="ico">{ACTIVITY_ICON[a.type]}</span>
              <span className="grow"><strong>{a.subject}</strong><small>{a.deal_title ?? a.company_name ?? ''} · {relative(a.due_at)}</small></span>
            </Link>
          ))}
        </section>
      )}
    </>
  )
}

function DealRow({ d }: { d: Deal }) {
  return (
    <Link to={`/m/deal/${d.id}`} className="mrow">
      <span className="dot" style={{ background: d.stage_color ?? 'var(--border-strong)' }} />
      <span className="grow">
        <strong>{d.title}</strong>
        <small>{d.company_name ?? ''}{d.stage_name ? ` · ${d.stage_name}` : ''}{d.amount ? ` · ${money(d.amount)}` : ''}</small>
      </span>
      <span className="chev">›</span>
    </Link>
  )
}

// ---------- target picker (deal / company / contact) ----------

interface Target { kind: 'deal' | 'company' | 'contact'; id: string; label: string; sub?: string }

function TargetPicker({ value, onChange }: { value: Target | null; onChange: (t: Target | null) => void }) {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const dq = useDebounced(q, 200)
  const deals = useQuery(() => api.get<Paged<Deal>>(`/api/deals${qs({ q: dq, owner_id: dq ? undefined : user?.id, status: 'open', sort: 'last_activity', dir: 'desc', limit: dq ? 8 : 6 })}`), [dq, user?.id])
  const companies = useQuery(() => (dq ? api.get<Paged<Company>>(`/api/companies${qs({ q: dq, kind: 'all', limit: 5 })}`) : Promise.resolve(null)), [dq])
  const contacts = useQuery(() => (dq ? api.get<Paged<Contact>>(`/api/contacts${qs({ q: dq, limit: 5 })}`) : Promise.resolve(null)), [dq])
  if (value) {
    return (
      <div className="mtarget">
        <span className="grow"><small>{value.kind}</small><strong>{value.label}</strong>{value.sub && <small>{value.sub}</small>}</span>
        <button type="button" className="mlink" onClick={() => onChange(null)}>Change</button>
      </div>
    )
  }
  return (
    <div className="mpicker">
      <input className="minput" type="search" placeholder="Which deal, company or person?" value={q} onChange={(e) => setQ(e.target.value)} autoFocus autoComplete="off" />
      <div className="mlist">
        {(deals.data?.items ?? []).map((d) => <button type="button" key={d.id} className="mrow" onClick={() => onChange({ kind: 'deal', id: d.id, label: d.title, sub: d.company_name ?? undefined })}><span className="dot" style={{ background: d.stage_color ?? 'var(--border-strong)' }} /><span className="grow"><strong>{d.title}</strong><small>{d.company_name ?? ''} · {d.stage_name}</small></span></button>)}
        {(companies.data?.items ?? []).map((c) => <button type="button" key={c.id} className="mrow" onClick={() => onChange({ kind: 'company', id: c.id, label: c.name })}><span className="ico">▣</span><span className="grow"><strong>{c.name}</strong><small>company</small></span></button>)}
        {(contacts.data?.items ?? []).map((c) => <button type="button" key={c.id} className="mrow" onClick={() => onChange({ kind: 'contact', id: c.id, label: `${c.first_name} ${c.last_name}`, sub: c.company_name ?? undefined })}><span className="ico">◉</span><span className="grow"><strong>{c.first_name} {c.last_name}</strong><small>{c.company_name ?? 'contact'}</small></span></button>)}
        {!dq && <div className="mempty small">Your most recent deals. Type to find anything else.</div>}
      </div>
    </div>
  )
}

// ---------- log a note ----------

const NOTE_TYPES: ActivityType[] = ['note', 'meeting', 'call', 'text']

function MLog() {
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [target, setTarget] = useState<Target | null>(null)
  const [type, setType] = useState<ActivityType>('note')
  const [text, setText] = useState('')
  const [next, setNext] = useState('')
  const [nextDays, setNextDays] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  // Deep links: /m/log?deal=…, ?company=…, ?contact=…
  useEffect(() => {
    const deal = params.get('deal'); const company = params.get('company'); const contact = params.get('contact')
    if (deal) api.get<Deal>(`/api/deals/${deal}`).then((d) => setTarget({ kind: 'deal', id: d.id, label: d.title, sub: d.company_name ?? undefined })).catch(() => {})
    else if (company) api.get<Company>(`/api/companies/${company}`).then((c) => setTarget({ kind: 'company', id: c.id, label: c.name })).catch(() => {})
    else if (contact) api.get<Contact>(`/api/contacts/${contact}`).then((c) => setTarget({ kind: 'contact', id: c.id, label: `${c.first_name} ${c.last_name}`, sub: c.company_name ?? undefined })).catch(() => {})
  }, [params])
  const submit = async () => {
    if (!target || !text.trim()) return
    setBusy(true)
    try {
      const ids = { deal_id: target.kind === 'deal' ? target.id : null, company_id: target.kind === 'company' ? target.id : null, contact_id: target.kind === 'contact' ? target.id : null }
      await api.post('/api/activities', { type, subject: text.trim().slice(0, 120), body: text.trim().length > 120 ? text.trim() : null, ...ids })
      if (next.trim() && nextDays !== null) await api.post('/api/activities', { type: 'task', subject: next.trim(), due_at: atNineIn(nextDays), ...ids })
      toast('Logged')
      setText(''); setNext(''); setNextDays(null)
      if (target.kind === 'deal') navigate(`/m/deal/${target.id}`)
      else navigate('/m')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <MHeader title="Log" back="/m" />
      <div className="mform">
        <TargetPicker value={target} onChange={setTarget} />
        {target && (
          <>
            <div className="mchips">
              {NOTE_TYPES.map((t) => <button type="button" key={t} className={`mchip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>{ACTIVITY_ICON[t]} {t[0].toUpperCase() + t.slice(1)}</button>)}
            </div>
            <textarea className="mtext" rows={5} placeholder={type === 'meeting' ? 'Who you met and what they said…' : 'What happened…'} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <label className="mlabel">Next step <span className="muted">(optional)</span></label>
            <input className="minput" placeholder="e.g. Send pricing" value={next} onChange={(e) => setNext(e.target.value)} />
            {next.trim() && (
              <div className="mchips">
                {[[1, 'Tomorrow'], [2, 'In 2 days'], [7, 'Next week'], [14, 'In 2 weeks']].map(([d, l]) => <button type="button" key={d} className={`mchip ${nextDays === d ? 'on' : ''}`} onClick={() => setNextDays(d as number)}>{l}</button>)}
              </div>
            )}
            <button className="mbtn primary" disabled={busy || !text.trim() || (!!next.trim() && nextDays === null)} onClick={submit}>{busy ? 'Saving…' : 'Save'}</button>
          </>
        )}
      </div>
    </>
  )
}

// ---------- new deal: company → contact → go ----------

const SOURCES = ['Event', 'Referral', 'Inbound', 'Outbound', 'Partner']

function MNewDeal() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { pipelines } = useRefData()
  const [companyQ, setCompanyQ] = useState('')
  const dq = useDebounced(companyQ, 200)
  const [company, setCompany] = useState<{ id: string | null; name: string } | null>(null)
  const matches = useQuery(() => (dq && !company ? api.get<Paged<Company>>(`/api/companies${qs({ q: dq, kind: 'all', limit: 5 })}`) : Promise.resolve(null)), [dq, company])
  const existing = useQuery(() => (company?.id ? api.get<Paged<Contact>>(`/api/contacts${qs({ company_id: company.id, limit: 50 })}`) : Promise.resolve(null)), [company?.id])
  const [contact, setContact] = useState<{ id: string | null; first: string; last: string; email: string; title: string }>({ id: null, first: '', last: '', email: '', title: '' })
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('Event')
  const [dealType, setDealType] = useState<(typeof DEAL_TYPES)[number]>('new_business')
  const [close, setClose] = useState(isoIn(90))
  const [nextSubject, setNextSubject] = useState('Follow up after the show')
  const [nextDays, setNextDays] = useState(2)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const pipeline = pipelines.find((p) => p.is_default) ?? pipelines[0]
  const ready = !!company && !!contact.first.trim() && /\S+@\S+\.\S+/.test(contact.email)
  const submit = async () => {
    if (!company || !ready) return
    setBusy(true)
    try {
      const companyId = company.id ?? (await api.post<Company>('/api/companies', { name: company.name, owner_id: user?.id })).id
      const contactId = contact.id ?? (await api.post<Contact>('/api/contacts', { first_name: contact.first.trim(), last_name: contact.last.trim(), email: contact.email.trim(), title: contact.title.trim() || null, company_id: companyId, owner_id: user?.id })).id
      const d = await api.post<Deal>('/api/deals', {
        title: company.name,
        pipeline_id: pipeline?.id,
        amount: amount === '' ? 0 : Number(amount),
        currency: 'USD',
        company_id: companyId,
        contact_id: contactId,
        owner_id: user?.id,
        expected_close_date: close,
        lead_source: source,
        deal_type: dealType,
        next_activity: { subject: nextSubject.trim() || 'Follow up', due_at: atNineIn(nextDays), type: 'task' },
      })
      if (note.trim()) await api.post('/api/activities', { type: 'note', subject: note.trim().slice(0, 120), body: note.trim().length > 120 ? note.trim() : null, deal_id: d.id })
      toast('Deal created')
      navigate(`/m/deal/${d.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <MHeader title="New deal" back="/m" />
      <div className="mform">
        <label className="mlabel">Company</label>
        {company ? (
          <div className="mtarget"><span className="grow"><strong>{company.name}</strong>{!company.id && <small>new company</small>}</span><button type="button" className="mlink" onClick={() => { setCompany(null); setContact({ id: null, first: '', last: '', email: '', title: '' }) }}>Change</button></div>
        ) : (
          <>
            <input className="minput" placeholder="Company name" value={companyQ} onChange={(e) => setCompanyQ(e.target.value)} autoFocus autoComplete="organization" />
            {dq && (
              <div className="mlist">
                {(matches.data?.items ?? []).map((c) => <button type="button" key={c.id} className="mrow" onClick={() => setCompany({ id: c.id, name: c.name })}><span className="grow"><strong>{c.name}</strong><small>{c.kind !== 'company' ? c.kind.toUpperCase() : 'existing'}{c.open_deal_count ? ` · ${c.open_deal_count} open deal${c.open_deal_count === 1 ? '' : 's'}` : ''}</small></span></button>)}
                {!(matches.data?.items ?? []).some((c) => c.name.toLowerCase() === dq.toLowerCase()) && <button type="button" className="mrow new" onClick={() => setCompany({ id: null, name: companyQ.trim() })}><span className="grow"><strong>Create "{companyQ.trim()}"</strong><small>new company</small></span></button>}
              </div>
            )}
          </>
        )}
        {company && (
          <>
            <label className="mlabel">Main contact</label>
            {(existing.data?.items.length ?? 0) > 0 && !contact.id && (
              <div className="mchips">
                {existing.data!.items.slice(0, 6).map((c) => <button type="button" key={c.id} className="mchip" onClick={() => setContact({ id: c.id, first: c.first_name, last: c.last_name, email: c.email ?? '', title: c.title ?? '' })}>{c.first_name} {c.last_name}</button>)}
              </div>
            )}
            {contact.id ? (
              <div className="mtarget"><span className="grow"><strong>{contact.first} {contact.last}</strong><small>{contact.email || 'no email on file'}</small></span><button type="button" className="mlink" onClick={() => setContact({ id: null, first: '', last: '', email: '', title: '' })}>Change</button></div>
            ) : (
              <div className="mgrid2">
                <input className="minput" placeholder="First name" value={contact.first} onChange={(e) => setContact({ ...contact, first: e.target.value })} autoComplete="given-name" />
                <input className="minput" placeholder="Last name" value={contact.last} onChange={(e) => setContact({ ...contact, last: e.target.value })} autoComplete="family-name" />
                <input className="minput span2" type="email" placeholder="Email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" inputMode="email" />
                <input className="minput span2" placeholder="Title (optional)" value={contact.title} onChange={(e) => setContact({ ...contact, title: e.target.value })} autoComplete="organization-title" />
              </div>
            )}
            {contact.id && !contact.email && <input className="minput" type="email" placeholder="Email (required)" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} inputMode="email" />}

            <label className="mlabel">Lead source</label>
            <div className="mchips">{SOURCES.map((s) => <button type="button" key={s} className={`mchip ${source === s ? 'on' : ''}`} onClick={() => setSource(s)}>{s}</button>)}</div>
            <div className="mgrid2">
              <div><label className="mlabel">Type</label><select className="minput" value={dealType} onChange={(e) => setDealType(e.target.value as typeof dealType)}>{DEAL_TYPES.map((t) => <option key={t} value={t}>{DEAL_TYPE_LABEL[t]}</option>)}</select></div>
              <div><label className="mlabel">Amount</label><input className="minput" type="number" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div><label className="mlabel">Expected close</label><input className="minput" type="date" value={close} onChange={(e) => setClose(e.target.value)} /></div>
              <div><label className="mlabel">Follow up</label><select className="minput" value={nextDays} onChange={(e) => setNextDays(Number(e.target.value))}><option value={1}>Tomorrow</option><option value={2}>In 2 days</option><option value={7}>Next week</option><option value={14}>In 2 weeks</option></select></div>
            </div>
            <input className="minput" placeholder="Follow-up task" value={nextSubject} onChange={(e) => setNextSubject(e.target.value)} />
            <label className="mlabel">First note <span className="muted">(optional)</span></label>
            <textarea className="mtext" rows={3} placeholder="What they said at the booth…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="mbtn primary" disabled={busy || !ready} onClick={submit}>{busy ? 'Creating…' : 'Create deal'}</button>
            {!ready && <div className="mempty small">Needs a company, a contact name and an email.</div>}
          </>
        )}
      </div>
    </>
  )
}

// ---------- deal ----------

function MDeal() {
  const { id } = useParams()
  const toast = useToast()
  const { pipelines } = useRefData()
  const deal = useQuery(() => api.get<Deal>(`/api/deals/${id}`), [id])
  const acts = useQuery(() => api.get<Paged<Activity>>(`/api/activities${qs({ deal_id: id, sort: 'created_at', dir: 'desc', limit: 15 })}`), [id])
  const d = deal.data
  const stages = useMemo(() => pipelines.find((p) => p.id === d?.pipeline_id)?.stages ?? [], [pipelines, d?.pipeline_id])
  const move = async (stageId: string) => {
    if (!d || stageId === d.stage_id) return
    const target = stages.find((s) => s.id === stageId)
    try {
      if (target?.kind === 'won' && !d.contract_months) {
        const m = window.prompt('Contract length in months (required to close won)', '12')
        if (!m) return
        await api.post(`/api/deals/${d.id}/move`, { stage_id: stageId, contract_months: Number(m) })
      } else if (target?.kind === 'lost') {
        const r = window.prompt('Lost reason', 'No decision')
        if (r === null) return
        await api.post(`/api/deals/${d.id}/move`, { stage_id: stageId, lost_reason: r || null })
      } else await api.post(`/api/deals/${d.id}/move`, { stage_id: stageId })
      toast(`Moved to ${target?.name ?? 'stage'}`)
      deal.refresh(); acts.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const done = async (a: Activity) => {
    try {
      await api.patch(`/api/activities/${a.id}`, { completed: !a.completed_at })
      acts.refresh(); deal.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  if (deal.error) return <><MHeader title="Deal" back="/m" /><div className="mempty">{deal.error}</div></>
  if (!d) return <><MHeader title="Deal" back="/m" /><div className="mempty">Loading…</div></>
  return (
    <>
      <MHeader title={d.title} back="/m" right={<a className="mlink" href={`/deals/${d.id}`}>Desktop</a>} />
      <div className="mform">
        <div className="mkv">
          <div><small>Company</small><strong>{d.company_name ?? '—'}</strong></div>
          <div><small>Contact</small><strong>{d.contact_name ?? '—'}</strong></div>
          <div><small>Value</small><strong>{money(d.amount, d.currency)}</strong></div>
          <div><small>Expected close</small><strong>{fmtDate(d.expected_close_date)}</strong></div>
        </div>
        <label className="mlabel">Stage</label>
        <select className="minput" value={d.stage_id} onChange={(e) => move(e.target.value)}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {d.next_activity_at && <div className="mempty small">Next: {d.next_activity_subject ?? 'activity'} · {relative(d.next_activity_at)}</div>}
        <Link to={`/m/log?deal=${d.id}`} className="mbtn primary">✎ Log a note</Link>
        <h2 className="mh2">Recent</h2>
        {(acts.data?.items ?? []).map((a) => (
          <div key={a.id} className="mrow static">
            {(a.type === 'task' || a.type === 'meeting' || a.due_at) ? <input type="checkbox" checked={!!a.completed_at} onChange={() => done(a)} /> : <span className="ico">{ACTIVITY_ICON[a.type]}</span>}
            <span className="grow"><strong className={a.completed_at && a.type === 'task' ? 'done' : ''}>{a.subject}</strong><small>{a.created_by_name ?? a.owner_name ?? ''} · {relative(a.due_at && !a.completed_at ? a.due_at : a.created_at)}{a.body ? ` · ${a.body.slice(0, 80)}` : ''}</small></span>
          </div>
        ))}
        {acts.data && !acts.data.items.length && <div className="mempty small">Nothing logged yet.</div>}
      </div>
    </>
  )
}

// ---------- new contact ----------

function MNewContact() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [first, setFirst] = useState(''); const [last, setLast] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [title, setTitle] = useState('')
  const [companyQ, setCompanyQ] = useState('')
  const dq = useDebounced(companyQ, 200)
  const [company, setCompany] = useState<{ id: string | null; name: string } | null>(null)
  const matches = useQuery(() => (dq && !company ? api.get<Paged<Company>>(`/api/companies${qs({ q: dq, kind: 'all', limit: 5 })}`) : Promise.resolve(null)), [dq, company])
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!first.trim()) return
    setBusy(true)
    try {
      const companyId = company ? (company.id ?? (await api.post<Company>('/api/companies', { name: company.name, owner_id: user?.id })).id) : null
      const c = await api.post<Contact>('/api/contacts', { first_name: first.trim(), last_name: last.trim(), email: email.trim() || null, phone: phone.trim() || null, title: title.trim() || null, company_id: companyId, owner_id: user?.id })
      toast('Contact saved')
      navigate(`/m/log?contact=${c.id}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <MHeader title="New contact" back="/m" />
      <div className="mform">
        <div className="mgrid2">
          <input className="minput" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus autoComplete="given-name" />
          <input className="minput" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" />
          <input className="minput span2" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
          <input className="minput" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" />
          <input className="minput" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" />
        </div>
        <label className="mlabel">Company</label>
        {company ? (
          <div className="mtarget"><span className="grow"><strong>{company.name}</strong>{!company.id && <small>new company</small>}</span><button type="button" className="mlink" onClick={() => setCompany(null)}>Change</button></div>
        ) : (
          <>
            <input className="minput" placeholder="Company (optional)" value={companyQ} onChange={(e) => setCompanyQ(e.target.value)} autoComplete="organization" />
            {dq && (
              <div className="mlist">
                {(matches.data?.items ?? []).map((c) => <button type="button" key={c.id} className="mrow" onClick={() => setCompany({ id: c.id, name: c.name })}><span className="grow"><strong>{c.name}</strong></span></button>)}
                {!(matches.data?.items ?? []).some((c) => c.name.toLowerCase() === dq.toLowerCase()) && <button type="button" className="mrow new" onClick={() => setCompany({ id: null, name: companyQ.trim() })}><span className="grow"><strong>Create "{companyQ.trim()}"</strong></span></button>}
              </div>
            )}
          </>
        )}
        <button className="mbtn primary" disabled={busy || !first.trim()} onClick={submit}>{busy ? 'Saving…' : 'Save contact'}</button>
      </div>
    </>
  )
}

function MMore({ name, email, onLogout }: { name: string; email: string; onLogout: () => void }) {
  return (
    <>
      <MHeader title="More" back="/m" />
      <div className="mform">
        <div className="mtarget"><span className="grow"><strong>{name}</strong><small>{email}</small></span></div>
        <a className="mbtn" href="/?desktop=1">Open the full desktop CRM</a>
        <div className="mempty small">Add this page to your home screen for one-tap access: Share → Add to Home Screen on iPhone, or the install prompt in Chrome on Android.</div>
        <button className="mbtn" onClick={onLogout}>Sign out</button>
      </div>
    </>
  )
}
