import { Link } from 'react-router-dom'
import { fmtDateTime, relative } from '../format'
import type { Activity, AuditEntry, StageHistoryEntry, TimelineItem } from '../../shared/types'
import { api } from '../api'
import { useToast } from './ui'

export const ACTIVITY_ICON: Record<Activity['type'], string> = { note: '📝', call: '📞', email: '✉️', meeting: '📅', task: '☑️' }

const FIELD_LABELS: Record<string, string> = {
  amount: 'Amount', title: 'Name', owner_id: 'Owner', company_id: 'Company', contact_id: 'Contact', expected_close_date: 'Expected close',
  description: 'Description', lost_reason: 'Lost reason', stage: 'Stage', first_name: 'First name', last_name: 'Last name', email: 'Email',
  phone: 'Phone', notes: 'Notes', industry: 'Industry', domain: 'Domain', website: 'Website', address: 'Address', currency: 'Currency',
  subject: 'Subject', body: 'Body', due_at: 'Due', completed_at: 'Completed', role: 'Role', is_active: 'Active',
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDateTime(v)
  if (typeof v === 'object') return JSON.stringify(v)
  const s = String(v)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

export function AuditChanges({ changes }: { changes: AuditEntry['changes'] }) {
  const entries = Object.entries(changes ?? {})
  if (!entries.length) return null
  return (
    <div className="tl-changes">
      {entries.slice(0, 8).map(([k, v]) => {
        const c = v as { from?: unknown; to?: unknown }
        const isDiff = c && typeof c === 'object' && ('from' in c || 'to' in c)
        return (
          <span key={k}>
            <strong>{FIELD_LABELS[k] ?? k}</strong>: {isDiff ? <><code>{fmtVal(c.from)}</code> → <code>{fmtVal(c.to)}</code></> : <code>{fmtVal(v)}</code>}
          </span>
        )
      })}
    </div>
  )
}

function ActivityRow({ a, onChanged, showDeal }: { a: Activity; onChanged?: () => void; showDeal?: boolean }) {
  const toast = useToast()
  const isOpen = (a.type === 'task' || a.type === 'meeting' || a.due_at) && !a.completed_at
  const overdue = isOpen && a.due_at && new Date(a.due_at).getTime() < Date.now()
  const toggle = async () => {
    try {
      await api.patch(`/api/activities/${a.id}`, { completed: !a.completed_at })
      onChanged?.()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async () => {
    try {
      await api.delete(`/api/activities/${a.id}`)
      toast('Deleted')
      onChanged?.()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div className={`tl-item ${a.completed_at && (a.type === 'task' || a.type === 'meeting') ? 'done' : ''}`}>
      <div className="tl-ico">{ACTIVITY_ICON[a.type]}</div>
      <div>
        <div className="tl-head">
          {(a.type === 'task' || a.type === 'meeting' || a.due_at) && (
            <input type="checkbox" checked={!!a.completed_at} onChange={toggle} title={a.completed_at ? 'Reopen' : 'Mark done'} />
          )}
          {a.source === 'gmail' ? (
            <>
              <span className="who">{a.meta?.direction === 'sent' ? (a.owner_name ?? 'Someone') : (a.meta?.from?.name ?? a.meta?.from?.email ?? 'Someone')}</span>
              <span className="muted">{a.meta?.direction === 'sent' ? 'sent an email to' : 'emailed'} {a.meta?.direction === 'sent' ? (a.meta?.to ?? []).map((t) => t.name ?? t.email).join(', ') : (a.owner_name ?? 'us')}</span>
              <span className="subject">· {a.subject}</span>
              <span className="flag" title="Synced from Gmail">Gmail</span>
            </>
          ) : a.source === 'gcal' ? (
            <>
              <span className="who">{a.owner_name ?? 'Someone'}</span>
              <span className="muted">{a.completed_at ? 'met' : 'is meeting'} {(a.meta?.attendees ?? []).filter((x) => !x.email.endsWith('@ecolens.io')).map((x) => x.name ?? x.email).slice(0, 3).join(', ') || 'contacts'}</span>
              <span className="subject">· {a.subject}</span>
              <span className="flag" title="Synced from Google Calendar">Calendar</span>
            </>
          ) : (
            <>
              <span className="who">{a.created_by_name ?? 'Someone'}</span>
              <span className="muted">{a.completed_at && a.type !== 'task' && a.type !== 'meeting' ? 'logged' : 'scheduled'} {a.type === 'email' ? 'an email' : `a ${a.type}`}</span>
              <span className="subject">· {a.subject}</span>
              {a.slack_ts && <span className="flag" title="Mirrored to Slack">Slack</span>}
            </>
          )}
          {a.due_at && <span className={`flag ${overdue ? 'danger' : a.completed_at ? '' : 'warn'}`}>{a.completed_at ? 'done' : overdue ? 'overdue' : 'due'} {relative(a.due_at)}</span>}
          {a.owner_name && a.owner_name !== a.created_by_name && <span className="muted small">for {a.owner_name}</span>}
          <span className="when" title={fmtDateTime(a.created_at)}>{relative(a.created_at)}</span>
        </div>
        {a.body && <div className="tl-body">{a.body}</div>}
        <div className="row small muted" style={{ marginTop: 4, gap: 10 }}>
          {showDeal && a.deal_id && <Link to={`/deals/${a.deal_id}`}>{a.deal_title ?? 'Deal'}</Link>}
          {a.contact_name && a.contact_id && <Link to={`/contacts/${a.contact_id}`}>{a.contact_name}</Link>}
          {a.company_name && a.company_id && <Link to={`/companies/${a.company_id}`}>{a.company_name}</Link>}
          {a.external_url && <a href={a.external_url} target="_blank" rel="noreferrer">Open in {a.source === 'gmail' ? 'Gmail' : 'Calendar'} ↗</a>}
          {a.source === 'gcal' && a.meta?.conference_url && <a href={a.meta.conference_url} target="_blank" rel="noreferrer">Join call ↗</a>}
          {a.source === 'gmail' && (a.meta?.cc?.length ?? 0) > 0 && <span>cc {(a.meta?.cc ?? []).map((c) => c.email).join(', ')}</span>}
          {onChanged && a.source === 'manual' && <button className="btn ghost sm" style={{ color: 'var(--text-3)' }} onClick={remove}>delete</button>}
        </div>
      </div>
    </div>
  )
}

function AuditRow({ e }: { e: AuditEntry }) {
  return (
    <div className="tl-item">
      <div className="tl-ico audit">{e.action === 'create' ? '✦' : e.action === 'delete' || e.action === 'archive' ? '🗑' : '✎'}</div>
      <div>
        <div className="tl-head">
          <span className="who">{e.actor_name ?? 'System'}</span>
          <span className="muted">{e.summary ?? e.action}</span>
          <span className="when" title={fmtDateTime(e.created_at)}>{relative(e.created_at)}</span>
        </div>
        {e.action === 'update' && <AuditChanges changes={e.changes} />}
      </div>
    </div>
  )
}

function StageRow({ s }: { s: StageHistoryEntry }) {
  const days = s.exited_at ? Math.max(0, Math.round((new Date(s.exited_at).getTime() - new Date(s.entered_at).getTime()) / 86400e3)) : null
  return (
    <div className="tl-item">
      <div className="tl-ico stage">➜</div>
      <div>
        <div className="tl-head">
          <span className="who">{s.changed_by_name ?? 'System'}</span>
          <span className="muted">{s.from_stage_name ? <>moved <strong>{s.from_stage_name}</strong> → <strong>{s.to_stage_name}</strong></> : <>created in <strong>{s.to_stage_name}</strong></>}</span>
          {days !== null && <span className="flag">{days}d in {s.to_stage_name}</span>}
          <span className="when" title={fmtDateTime(s.entered_at)}>{relative(s.entered_at)}</span>
        </div>
      </div>
    </div>
  )
}

export function Timeline({ items, onChanged, showDeal }: { items: TimelineItem[]; onChanged?: () => void; showDeal?: boolean }) {
  if (!items.length) return <div className="empty">No activity yet.</div>
  return (
    <div className="timeline">
      {items.map((it, i) => {
        if (it.kind === 'activity' && it.activity) return <ActivityRow key={`a${it.activity.id}`} a={it.activity} onChanged={onChanged} showDeal={showDeal} />
        if (it.kind === 'audit' && it.audit) return <AuditRow key={`l${it.audit.id}`} e={it.audit} />
        if (it.kind === 'stage' && it.stage) return <StageRow key={`s${it.stage.id}`} s={it.stage} />
        return <div key={i} />
      })}
    </div>
  )
}
