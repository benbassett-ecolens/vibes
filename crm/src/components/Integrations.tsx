import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { fmtDateTime, relative } from '../format'
import { useQuery } from '../hooks'
import { Field, Modal, useToast } from './ui'
import { CompanyPicker } from './Pickers'
import type { GoogleStatus, SlackStatus, UnmatchedItem } from '../../shared/types'

const GOOGLE_MESSAGES: Record<string, string> = {
  connected: 'Google account connected. The first sync is running in the background.',
  'error:access_denied': 'You cancelled the Google consent screen.',
  'error:wrong_account': 'That Google account does not match your CRM login. Connect the same @ecolens.io account.',
  'error:no_refresh_token': 'Google did not return a long-lived token. Try again; if it persists, remove the app at myaccount.google.com/permissions and reconnect.',
  'error:no_scopes': 'You did not grant Gmail or Calendar access.',
  'error:bad_state': 'The sign-in flow expired. Try again.',
  'error:session_mismatch': 'Your CRM session changed during sign-in. Try again.',
}

function CreateContactFromItem({ item, onClose, onDone }: { item: UnmatchedItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const first = item.addresses[0]
  const guessName = first?.name ?? first?.email.split('@')[0] ?? ''
  const [email, setEmail] = useState(first?.email ?? '')
  const [firstName, setFirstName] = useState(guessName.split(/\s+/)[0] ?? '')
  const [lastName, setLastName] = useState(guessName.split(/\s+/).slice(1).join(' '))
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  // Suggest the company whose name contains the domain's label (rockton.com -> "Rockton Software").
  useEffect(() => {
    const label = (first?.email.split('@')[1] ?? '').split('.').slice(0, -1).join(' ').replace(/[-_]/g, ' ')
    if (label.length < 3) return
    api.get<{ items: Array<{ id: string; name: string }> }>(`/api/companies?q=${encodeURIComponent(label)}&limit=1`).then((r) => {
      if (r.items[0] && !companyId) { setCompanyId(r.items[0].id); setCompanyName(r.items[0].name) }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post(`/api/google/unmatched/${item.id}/create-contact`, { email, first_name: firstName, last_name: lastName, company_id: companyId })
      toast('Contact created; re-syncing')
      onDone()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }
  return (
    <Modal title="Create contact from this item" onClose={onClose} width={480}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Email" span2>
            <select className="select" value={email} onChange={(e) => { setEmail(e.target.value); const a = item.addresses.find((x) => x.email === e.target.value); const n = (a?.name ?? e.target.value.split('@')[0]).split(/\s+/); setFirstName(n[0] ?? ''); setLastName(n.slice(1).join(' ')) }}>
              {item.addresses.map((a) => <option key={a.email} value={a.email}>{a.name ? `${a.name} <${a.email}>` : a.email}</option>)}
            </select>
          </Field>
          <Field label="First name"><input className="input" required value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
          <Field label="Last name"><input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
          <Field label="Company" span2><CompanyPicker value={companyId} label={companyName} onChange={(id, c) => { setCompanyId(id); setCompanyName(c?.name ?? null) }} /></Field>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary">Create contact</button></div>
      </form>
    </Modal>
  )
}

function groupByDomain(items: UnmatchedItem[]): Array<{ domain: string; items: UnmatchedItem[]; people: UnmatchedItem['addresses'] }> {
  const groups = new Map<string, { domain: string; items: UnmatchedItem[]; people: UnmatchedItem['addresses'] }>()
  for (const it of items) {
    for (const a of it.addresses) {
      const domain = a.email.split('@')[1] ?? 'unknown'
      const g = groups.get(domain) ?? { domain, items: [], people: [] }
      if (!g.items.includes(it)) g.items.push(it)
      if (!g.people.some((p) => p.email === a.email)) g.people.push(a)
      groups.set(domain, g)
    }
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length)
}

interface Diag {
  connection: { gmail_synced_through: string | null; gmail_last_synced_at: string | null; calendar_last_synced_at: string | null; last_error: string | null } | null
  counts: Record<string, number>
  matchable_pending: Array<{ external_id: string; subject: string; email: string }>
  recent_contacts: Array<{ email: string; company: string | null; activities: number; created_at: string }>
}

export function GoogleCard() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const status = useQuery(() => api.get<GoogleStatus>('/api/google/status'), [])
  const unmatched = useQuery(() => api.get<{ items: UnmatchedItem[] }>('/api/google/unmatched'), [])
  const [busy, setBusy] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [showDiag, setShowDiag] = useState(false)
  const diag = useQuery(() => (showDiag ? api.get<Diag>('/api/google/diagnostics') : Promise.resolve(null)), [showDiag, status.data?.runs.length])
  const [creating, setCreating] = useState<UnmatchedItem | null>(null)
  const flash = params.get('google')
  useEffect(() => {
    if (!flash) return
    toast(GOOGLE_MESSAGES[flash] ?? flash, flash.startsWith('error') ? 'error' : 'info')
    const next = new URLSearchParams(params)
    next.delete('google')
    setParams(next, { replace: true })
    if (flash === 'connected') {
      // Kick off the first sync as a foreground request (see server/google/routes.ts).
      setBusy(true)
      api.post('/api/google/sync?first=true')
        .then(() => toast('First sync finished'))
        .catch((e) => toast((e as Error).message, 'error'))
        .finally(() => { setBusy(false); status.refresh(); unmatched.refresh() })
    }
  }, [flash]) // eslint-disable-line react-hooks/exhaustive-deps
  // Poll briefly after connecting so the first run shows up.
  useEffect(() => {
    if (!status.data?.connection) return
    const running = status.data.runs.some((r) => r.status === 'running')
    if (!running && status.data.runs.length) return
    const t = setTimeout(() => { status.refresh(); unmatched.refresh() }, 4000)
    return () => clearTimeout(t)
  }, [status.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const s = status.data
  const conn = s?.connection
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true)
    try {
      await fn()
      if (msg) toast(msg)
      await status.refresh()
      await unmatched.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <div className="card-h">
        <h2>Gmail &amp; Calendar sync</h2>
        <span className="muted small right">emails and meetings with known contacts are logged automatically</span>
      </div>
      <div className="card-b">
        {!s && <div className="muted">Loading…</div>}
        {s && !s.configured && <div className="error-box">Not configured on the server. Set GOOGLE_CLIENT_SECRET and APP_BASE_URL (see README).</div>}
        {s && s.configured && !conn && (
          <div className="row wrap">
            <p className="grow small muted">Connect your own Google account. We read message headers and snippets (never bodies or attachments) and calendar invites, and only keep the ones that involve a contact in this CRM.</p>
            <a className="btn primary" href="/api/google/connect">Connect Google</a>
          </div>
        )}
        {conn && (
          <>
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Account</dt><dd>{conn.google_email} {conn.last_error && <span className="badge danger" title={conn.last_error}>last run failed</span>}</dd>
              <dt>Gmail</dt><dd className="row"><label className="row"><input type="checkbox" checked={conn.gmail_sync_enabled} disabled={busy} onChange={(e) => run(() => api.patch('/api/google/connection', { gmail_sync_enabled: e.target.checked }))} /> on</label><span className="muted small">last synced {relative(conn.gmail_last_synced_at)}</span></dd>
              <dt>Calendar</dt><dd className="row"><label className="row"><input type="checkbox" checked={conn.calendar_sync_enabled} disabled={busy} onChange={(e) => run(() => api.patch('/api/google/connection', { calendar_sync_enabled: e.target.checked }))} /> on</label><span className="muted small">last synced {relative(conn.calendar_last_synced_at)}</span></dd>
              <dt>First-sync window</dt><dd>{conn.gmail_sync_window_days} days of mail</dd>
              <dt>Connected</dt><dd>{fmtDateTime(conn.created_at)}</dd>
              <dt>Logged so far</dt><dd><strong>{s.totals?.emails ?? 0}</strong> emails and <strong>{s.totals?.meetings ?? 0}</strong> meetings across the team <span className="muted small">· each run below counts only what it added</span></dd>
            </dl>
            {conn.last_error && <div className="error-box" style={{ marginBottom: 12 }}>{conn.last_error}</div>}
            <div className="row wrap" style={{ marginBottom: 12 }}>
              <button className="btn primary sm" disabled={busy} onClick={() => run(() => api.post<{ errors: string[]; gmail?: { logged: number }; calendar?: { logged: number } }>('/api/google/sync').then((r) => { if (r.errors.length) throw new Error(r.errors.join(' · ')); toast(`Sync finished: ${r.gmail?.logged ?? 0} emails, ${r.calendar?.logged ?? 0} meetings logged`) }))}>{busy ? 'Syncing…' : 'Sync now'}</button>
              <button className="btn sm" onClick={() => setShowDiag((v) => !v)}>Diagnostics</button>
              <button className="btn sm" onClick={() => setShowUnmatched((v) => !v)}>{s.unmatched_count} unmatched sender{s.unmatched_count === 1 ? '' : 's'}</button>
              <a className="btn sm" href="/api/google/connect">Reconnect</a>
              <button className="btn danger sm right" disabled={busy} onClick={() => run(() => api.delete('/api/google/connection'), 'Disconnected')}>Disconnect</button>
            </div>
            {showUnmatched && (
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table className="table">
                  <thead><tr><th>Sender domain</th><th className="num">Items</th><th>People seen</th><th>Latest</th><th /></tr></thead>
                  <tbody>
                    {groupByDomain(unmatched.data?.items ?? []).map((g) => (
                      <tr key={g.domain}>
                        <td><strong>{g.domain}</strong></td>
                        <td className="num">{g.items.length}</td>
                        <td className="small">{g.people.slice(0, 3).map((p) => p.name ?? p.email).join(', ')}{g.people.length > 3 ? ` +${g.people.length - 3}` : ''}</td>
                        <td className="small">{g.items[0].external_url ? <a href={g.items[0].external_url} target="_blank" rel="noreferrer">{g.items[0].subject}</a> : g.items[0].subject} <span className="muted">· {relative(g.items[0].occurred_at)}</span></td>
                        <td className="row">
                          <button className="btn sm primary" onClick={() => setCreating({ ...g.items[0], addresses: g.people })}>Create contact</button>
                          <button className="btn ghost sm" title="Never log mail from this domain; dismisses these items" onClick={() => run(() => api.post<{ dismissed: number }>('/api/google/ignore-domain', { domain: g.domain }).then((r) => toast(`Ignored ${g.domain} (${r.dismissed} items)`)))}>Ignore domain</button>
                        </td>
                      </tr>
                    ))}
                    {!unmatched.data?.items.length && <tr><td colSpan={5} className="empty">Nothing unmatched. Every synced item found a contact.</td></tr>}
                  </tbody>
                </table>
                <div className="small muted" style={{ padding: '8px 12px' }}>Creating a contact with a company teaches the company its email domain; later senders from that domain become contacts and get logged automatically. Ignored domains apply to the whole team.</div>
              </div>
            )}
            {showDiag && diag.data && (
              <div className="card pad" style={{ marginBottom: 12, background: 'var(--surface-2)' }}>
                <div className="row wrap small" style={{ gap: 12 }}>
                  {Object.entries(diag.data.counts).map(([k, v]) => <span key={k} className="badge">{k.replace(/_/g, ' ')}: <strong>{v}</strong></span>)}
                </div>
                {diag.data.connection?.last_error && <div className="error-box small" style={{ marginTop: 8 }}>{diag.data.connection.last_error}</div>}
                <div className="small" style={{ marginTop: 8 }}>
                  <strong>Pending items that now match a contact</strong> (should log on the next sync): {diag.data.matchable_pending.length ? diag.data.matchable_pending.map((m) => `${m.subject} ← ${m.email}`).join(' · ') : 'none'}
                </div>
                <table className="table" style={{ marginTop: 8 }}>
                  <thead><tr><th>Recent contact</th><th>Company</th><th className="num">Synced items</th></tr></thead>
                  <tbody>{diag.data.recent_contacts.map((c) => <tr key={c.email}><td className="small">{c.email}</td><td className="small">{c.company ?? <span className="muted">—</span>}</td><td className="num">{c.activities}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <table className="table">
              <thead><tr><th>Run</th><th>Kind</th><th>Started</th><th className="num">Seen</th><th className="num">Logged</th><th className="num">Updated</th><th>Status</th></tr></thead>
              <tbody>
                {s.runs.map((r) => (
                  <tr key={r.id}>
                    <td className="muted small">{r.trigger}</td><td>{r.kind}</td><td title={fmtDateTime(r.started_at)}>{relative(r.started_at)}</td>
                    <td className="num">{r.items_seen}</td><td className="num">{r.items_logged}</td><td className="num">{r.items_updated}</td>
                    <td>{r.status === 'ok' ? <span className="badge good">ok</span> : r.status === 'running' ? <span className="badge">running…</span> : <span className="badge danger" title={r.error ?? ''}>error</span>}</td>
                  </tr>
                ))}
                {!s.runs.length && <tr><td colSpan={7} className="empty">No sync runs yet.</td></tr>}
              </tbody>
            </table>
          </>
        )}
      </div>
      {creating && <CreateContactFromItem item={creating} onClose={() => setCreating(null)} onDone={() => { setCreating(null); run(() => api.post<{ errors: string[]; gmail?: { logged: number }; calendar?: { logged: number } }>('/api/google/sync').then((r) => { if (r.errors.length) throw new Error(r.errors.join(' · ')); toast(`Re-checked: ${r.gmail?.logged ?? 0} emails, ${r.calendar?.logged ?? 0} meetings logged`) })) }} />}
    </div>
  )
}

export function SlackCard() {
  const toast = useToast()
  const status = useQuery(() => api.get<SlackStatus>('/api/slack/status'), [])
  const [busy, setBusy] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [showManual, setShowManual] = useState(false)
  const s = status.data
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true)
    try {
      await fn()
      if (msg) toast(msg)
      await status.refresh()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card">
      <div className="card-h"><h2>Slack to-dos</h2><span className="muted small right">tasks are mirrored to Slack; done in either place = done in both</span></div>
      <div className="card-b">
        {!s && <div className="muted">Loading…</div>}
        {s && !s.configured && <div className="error-box">Not configured on the server. Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET (see README for the Slack app manifest).</div>}
        {s && s.configured && (
          <>
            <dl className="kv" style={{ marginBottom: 12 }}>
              <dt>Workspace</dt><dd>{s.error ? <span className="error">{s.error}</span> : <>{s.team_name} <span className="muted small">(bot {s.bot_user})</span></>}</dd>
              <dt>Your Slack</dt><dd>{s.me_linked ? <span className="badge good">linked · {s.my_slack_user_id}</span> : <span className="badge warn">not linked yet</span>}</dd>
            </dl>
            <p className="small muted" style={{ marginBottom: 10 }}>
              Each task assigned to you is sent to you as a Slack DM with a <strong>Mark done</strong> button. Completing it in Slack completes it here, and completing it here updates the Slack card.
              In Slack, <code>/todo Send proposal to Acme | tomorrow 9am</code> creates a task in the CRM. See <Link to="/activities">Tasks</Link>.
            </p>
            <div className="row wrap">
              {!s.me_linked && <button className="btn primary sm" disabled={busy} onClick={() => run(() => api.post('/api/slack/link'), 'Linked by email')}>Link my Slack account</button>}
              {!s.me_linked && <button className="btn sm" onClick={() => setShowManual((v) => !v)}>Link by member ID instead</button>}
              {s.me_linked && <button className="btn sm" disabled={busy} onClick={() => run(() => api.delete('/api/slack/link'), 'Unlinked')}>Unlink</button>}
              <button className="btn sm" disabled={busy || !s.me_linked} onClick={() => run(() => api.post('/api/slack/test'), 'Sent you a DM')}>Send test DM</button>
              <button className="btn sm" disabled={busy || !s.me_linked} onClick={() => run(() => api.post<{ sent: number }>('/api/slack/resend').then((r) => toast(`Sent ${r.sent} task card(s)`)))}>Send my open tasks to Slack</button>
            </div>
            {showManual && !s.me_linked && (
              <form className="row wrap" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); run(() => api.post('/api/slack/link', { slack_user_id: memberId.trim().toUpperCase() }), 'Linked').then(() => setShowManual(false)) }}>
                <span className="small muted">In Slack: your avatar → Profile → ⋮ (three dots) → <strong>Copy member ID</strong>. It starts with U or W.</span>
                <input className="input sm" placeholder="U0123ABCDEF" value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ width: 180 }} />
                <button className="btn primary sm" disabled={busy || !/^[UW][A-Z0-9]{6,}$/i.test(memberId.trim())}>Link</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
