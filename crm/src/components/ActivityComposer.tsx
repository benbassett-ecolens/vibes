import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import { fromLocalInputDateTime } from '../format'
import { OwnerSelect } from './Pickers'
import { useToast } from './ui'
import { ACTIVITY_ICON } from './Timeline'
import type { Activity, ActivityType } from '../../shared/types'

const TYPES: ActivityType[] = ['note', 'call', 'email', 'meeting', 'task']

export function ActivityComposer({ dealId, contactId, companyId, onCreated }: { dealId?: string; contactId?: string; companyId?: string; onCreated: (a: Activity) => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const [type, setType] = useState<ActivityType>('note')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [owner, setOwner] = useState<string | null>(user?.id ?? null)
  const [busy, setBusy] = useState(false)
  const needsDue = type === 'task' || type === 'meeting'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim()) return
    setBusy(true)
    try {
      const a = await api.post<Activity>('/api/activities', {
        type,
        subject: subject.trim(),
        body: body || null,
        deal_id: dealId ?? null,
        contact_id: contactId ?? null,
        company_id: companyId ?? null,
        owner_id: owner,
        due_at: due ? fromLocalInputDateTime(due) : null,
      })
      setSubject('')
      setBody('')
      setDue('')
      toast(needsDue ? 'Scheduled' : 'Logged')
      onCreated(a)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="types">
        {TYPES.map((t) => (
          <button type="button" key={t} className={t === type ? 'active' : ''} onClick={() => setType(t)}>
            {ACTIVITY_ICON[t]} {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="body">
        <input className="input" placeholder={type === 'note' ? 'Add a note…' : type === 'task' ? 'What needs doing?' : `${type[0].toUpperCase() + type.slice(1)} subject`} value={subject} onChange={(e) => setSubject(e.target.value)} />
        {(type !== 'note' || body) && <textarea className="textarea" placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 56 }} />}
        {type === 'note' && !body && <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setBody(' ')}>+ details</button>}
        <div className="row wrap">
          {(needsDue || type !== 'note') && (
            <label className="row small muted">{needsDue ? 'Due' : 'Follow-up'} <input className="input sm" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 'auto' }} /></label>
          )}
          {needsDue && <label className="row small muted">Assign to <OwnerSelect className="select sm" value={owner} onChange={setOwner} /></label>}
          <button className="btn primary sm right" disabled={busy || !subject.trim()}>{needsDue ? 'Schedule' : 'Log'} {type}</button>
        </div>
      </div>
    </form>
  )
}
