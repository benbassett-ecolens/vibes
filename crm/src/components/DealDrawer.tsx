import { useEffect, useState } from 'react'
import { useApp } from '../store'
import type { ActivityType, Deal, ForecastCategory } from '../types'
import {
  ACTIVITY_ICON,
  ACTIVITY_LABEL,
  addMonths,
  dealValue,
  dealValueLabel,
  fmtDate,
  fmtMoney,
  fmtRelative,
  daysUntil,
  today,
} from '../format'
import {
  Avatar,
  BUSINESS_UNITS,
  ChipSelect,
  ECOSYSTEMS,
  Field,
  InlineText,
  MoneyInput,
  PARTNER_TYPES,
  PersonSelect,
  usePerson,
} from './common'

type Tab = 'notes' | 'activities' | 'details' | 'contacts'

export function DealDrawer({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  const { data, actions } = useApp()
  const person = usePerson()
  const [tab, setTab] = useState<Tab>('notes')
  const stage = data.stages.find((s) => s.id === deal.stageId)
  const openStages = data.stages.filter((s) => s.kind === 'open')
  const stageIdx = openStages.findIndex((s) => s.id === deal.stageId)
  const won = data.stages.find((s) => s.kind === 'won')
  const lost = data.stages.find((s) => s.kind === 'lost')
  const deferred = data.stages.find((s) => s.kind === 'deferred')
  const firstOpen = openStages[0]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const notes = data.notes
    .filter((n) => n.dealId === deal.id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  const activities = data.activities.filter((a) => a.dealId === deal.id)
  const openActs = activities.filter((a) => !a.done).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  const doneActs = activities.filter((a) => a.done).sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  const contacts = data.contacts.filter((c) => c.dealId === deal.id)

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Deal: ${deal.title}`}>
        <header className="drawer-head">
          <div className="drawer-title-row">
            <InlineText as="h2" value={deal.title} onChange={(title) => actions.updateDeal(deal.id, { title })} />
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="drawer-sub">
            <span className="drawer-value">{dealValueLabel(deal)}</span>
            <span className="owner-cell">
              <Avatar person={person(deal.ownerId)} size={20} />
              <PersonSelect
                value={deal.ownerId}
                onChange={(ownerId) => actions.updateDeal(deal.id, { ownerId })}
                allowEmpty={false}
                className="ghost-select"
              />
            </span>
            <span className={`stage-pill kind-${stage?.kind ?? 'open'}`}>{stage?.name}</span>
            {deal.source === 'sheet' && <span className="tag" title="Imported from the Ecolens Sales Pipeline sheet">Sheet</span>}
          </div>

          {/* Stage progress — click a segment to move the deal */}
          <div className="stage-track" role="group" aria-label="Stage">
            {openStages.map((s, i) => (
              <button
                key={s.id}
                className={`stage-seg ${i <= stageIdx ? 'reached' : ''} ${s.id === deal.stageId ? 'current' : ''}`}
                title={`${s.name} · ${s.probability}%`}
                onClick={() => actions.moveDeal(deal.id, s.id)}
              >
                <span>{s.name}</span>
              </button>
            ))}
          </div>

          <div className="outcome-row">
            {stage?.kind === 'open' ? (
              <>
                {won && (
                  <button className="won-btn" onClick={() => actions.moveDeal(deal.id, won.id)}>
                    ✓ Won
                  </button>
                )}
                {lost && (
                  <button className="lost-btn" onClick={() => actions.moveDeal(deal.id, lost.id)}>
                    ✕ Lost
                  </button>
                )}
                {deferred && (
                  <button onClick={() => actions.moveDeal(deal.id, deferred.id)}>Defer</button>
                )}
              </>
            ) : (
              <>
                <span className="muted small">
                  {stage?.kind === 'won' && `Won ${fmtDate(deal.closeDate)}`}
                  {stage?.kind === 'lost' && `Lost ${fmtDate(deal.closeDate)}${deal.lostReason ? ` · ${deal.lostReason}` : ''}`}
                  {stage?.kind === 'deferred' && `Deferred — revisit ${fmtDate(deal.closeDate)}`}
                </span>
                {firstOpen && (
                  <button onClick={() => actions.moveDeal(deal.id, stageIdx >= 0 ? deal.stageId : openStages[openStages.length - 1]?.id ?? firstOpen.id)}>
                    Reopen
                  </button>
                )}
              </>
            )}
          </div>
        </header>

        <nav className="drawer-tabs" role="tablist">
          {(
            [
              ['notes', `Notes (${notes.length})`],
              ['activities', `Activities (${openActs.length})`],
              ['details', 'Details'],
              ['contacts', `Contacts (${contacts.length})`],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        <div className="drawer-body">
          {tab === 'notes' && <NotesTab dealId={deal.id} notes={notes} defaultAuthor={deal.ownerId} />}
          {tab === 'activities' && (
            <ActivitiesTab dealId={deal.id} ownerId={deal.ownerId} open={openActs} done={doneActs} />
          )}
          {tab === 'details' && <DetailsTab deal={deal} />}
          {tab === 'contacts' && <ContactsTab deal={deal} />}
        </div>
      </aside>
    </>
  )
}

function NotesTab({
  dealId,
  notes,
  defaultAuthor,
}: {
  dealId: string
  notes: ReturnType<typeof useApp>['data']['notes']
  defaultAuthor: string
}) {
  const { actions } = useApp()
  const person = usePerson()
  const [draft, setDraft] = useState('')
  const [author, setAuthor] = useState(defaultAuthor)
  const submit = () => {
    if (!draft.trim()) return
    actions.addNote(dealId, draft, author)
    setDraft('')
  }
  return (
    <div className="notes">
      <div className="note-composer">
        <textarea
          value={draft}
          placeholder="Add a note — what happened, what's next…"
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="composer-row">
          <PersonSelect value={author} onChange={setAuthor} allowEmpty={false} className="ghost-select" />
          <button className="primary" onClick={submit} disabled={!draft.trim()}>
            Add note
          </button>
        </div>
      </div>
      <ol className="timeline">
        {notes.map((n) => (
          <li key={n.id} className="note">
            <div className="note-meta">
              <Avatar person={person(n.authorId)} size={20} />
              <span className="strong">{person(n.authorId)?.name ?? 'Unknown'}</span>
              <input
                type="date"
                className="ghost-date"
                value={n.date}
                onChange={(e) => actions.updateNote(n.id, { date: e.target.value })}
                aria-label="Note date"
              />
              <button className="icon-btn subtle" onClick={() => actions.removeNote(n.id)} aria-label="Delete note">
                🗑
              </button>
            </div>
            <textarea
              className="note-body"
              value={n.body}
              rows={Math.min(8, Math.max(1, Math.ceil(n.body.length / 70)))}
              onChange={(e) => actions.updateNote(n.id, { body: e.target.value })}
            />
          </li>
        ))}
        {notes.length === 0 && <li className="empty-state">No notes yet.</li>}
      </ol>
    </div>
  )
}

const TYPES: ActivityType[] = ['call', 'meeting', 'email', 'task', 'deadline', 'lunch']

function ActivitiesTab({
  dealId,
  ownerId,
  open,
  done,
}: {
  dealId: string
  ownerId: string
  open: ReturnType<typeof useApp>['data']['activities']
  done: ReturnType<typeof useApp>['data']['activities']
}) {
  const { actions } = useApp()
  const person = usePerson()
  const [type, setType] = useState<ActivityType>('call')
  const [subject, setSubject] = useState('')
  const [due, setDue] = useState(today())
  const [owner, setOwner] = useState(ownerId)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim()) return
    actions.addActivity({ dealId, type, subject: subject.trim(), dueDate: due, ownerId: owner, note: '' })
    setSubject('')
  }

  const row = (a: (typeof open)[number]) => {
    const overdue = !a.done && a.dueDate && daysUntil(a.dueDate) < 0
    const isToday = !a.done && a.dueDate && daysUntil(a.dueDate) === 0
    return (
      <li key={a.id} className={`activity ${a.done ? 'done' : ''} ${overdue ? 'overdue' : ''} ${isToday ? 'today' : ''}`}>
        <input
          type="checkbox"
          checked={a.done}
          onChange={(e) => actions.updateActivity(a.id, { done: e.target.checked })}
          aria-label={`Mark ${a.subject} ${a.done ? 'not done' : 'done'}`}
        />
        <span className="act-icon" aria-hidden="true">
          {ACTIVITY_ICON[a.type]}
        </span>
        <div className="act-main">
          <input
            className="ghost-input"
            value={a.subject}
            onChange={(e) => actions.updateActivity(a.id, { subject: e.target.value })}
          />
          <div className="act-meta">
            <input
              type="date"
              className="ghost-date"
              value={a.dueDate}
              onChange={(e) => actions.updateActivity(a.id, { dueDate: e.target.value })}
            />
            <span className={`when ${overdue ? 'overdue' : ''}`}>{a.done ? 'Done' : fmtRelative(a.dueDate)}</span>
            <span className="muted">· {person(a.ownerId)?.name ?? '—'}</span>
            {a.note && <span className="muted"> · {a.note}</span>}
          </div>
        </div>
        <button className="icon-btn subtle" onClick={() => actions.removeActivity(a.id)} aria-label="Delete activity">
          🗑
        </button>
      </li>
    )
  }

  return (
    <div className="activities-tab">
      <form className="activity-composer" onSubmit={submit}>
        <select value={type} onChange={(e) => setType(e.target.value as ActivityType)} aria-label="Type">
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_ICON[t]} {ACTIVITY_LABEL[t]}
            </option>
          ))}
        </select>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Schedule an activity…" />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
        <PersonSelect value={owner} onChange={setOwner} allowEmpty={false} />
        <button type="submit" className="primary" disabled={!subject.trim()}>
          Add
        </button>
      </form>
      <h4>Planned</h4>
      <ul className="activity-list">
        {open.map(row)}
        {open.length === 0 && <li className="empty-state warn">No activity scheduled — add the next step.</li>}
      </ul>
      {done.length > 0 && (
        <>
          <h4>Done</h4>
          <ul className="activity-list">{done.map(row)}</ul>
        </>
      )}
    </div>
  )
}

function DetailsTab({ deal }: { deal: Deal }) {
  const { data, actions } = useApp()
  const stage = data.stages.find((s) => s.id === deal.stageId)
  const sum = (deal.retainerAcv ?? 0) + (deal.performanceAcv ?? 0)
  const set = (patch: Partial<Deal>) => actions.updateDeal(deal.id, patch)
  return (
    <div className="details">
      <div className="form-grid">
        <Field label="Retainer ACV">
          <MoneyInput value={deal.retainerAcv} onChange={(retainerAcv) => set({ retainerAcv })} />
        </Field>
        <Field label="Performance ACV">
          <MoneyInput value={deal.performanceAcv} onChange={(performanceAcv) => set({ performanceAcv })} />
        </Field>
        <Field
          label="Total contract value"
          hint={
            deal.tcvOverride === null
              ? `Auto: retainer + performance = ${fmtMoney(sum)}`
              : `Overridden (auto would be ${fmtMoney(sum)})`
          }
        >
          <div className="inline-row">
            <MoneyInput
              value={deal.tcvOverride ?? sum}
              onChange={(v) => set({ tcvOverride: v === null || v === sum ? null : v })}
            />
            {deal.tcvOverride !== null && (
              <button type="button" onClick={() => set({ tcvOverride: null })}>
                Use auto
              </button>
            )}
          </div>
        </Field>
        <Field label="Pricing">
          <label className="check">
            <input type="checkbox" checked={deal.valueTbd} onChange={(e) => set({ valueTbd: e.target.checked })} /> Value
            still TBD
          </label>
        </Field>
        <Field label={stage?.kind === 'open' ? 'Expected close' : 'Close date'}>
          <input type="date" value={deal.closeDate} onChange={(e) => set({ closeDate: e.target.value })} />
        </Field>
        <Field label="Forecast category">
          <select value={deal.forecast} onChange={(e) => set({ forecast: e.target.value as ForecastCategory })}>
            <option value="">—</option>
            <option value="commit">Commit</option>
            <option value="forecast">Forecast</option>
            <option value="upside">Upside</option>
          </select>
        </Field>
        <Field label="Contract term (months)">
          <input
            type="number"
            min={1}
            value={deal.contractTermMonths}
            onChange={(e) => {
              const months = Number(e.target.value) || 12
              set({
                contractTermMonths: months,
                renewalDate: stage?.kind === 'won' && deal.closeDate ? addMonths(deal.closeDate, months) : deal.renewalDate,
              })
            }}
          />
        </Field>
        <Field label="Renewal date" hint={deal.renewalDate ? `${daysUntil(deal.renewalDate)} days away` : 'Set when the deal is won'}>
          <input type="date" value={deal.renewalDate} onChange={(e) => set({ renewalDate: e.target.value })} />
        </Field>
        <Field label="What they sell">
          <input value={deal.product} onChange={(e) => set({ product: e.target.value })} />
        </Field>
        <Field label="Lost reason">
          <input value={deal.lostReason} onChange={(e) => set({ lostReason: e.target.value })} placeholder="Why did we lose?" />
        </Field>
        <div className="field span-2">
          <span className="field-label">Ecosystems</span>
          <ChipSelect options={ECOSYSTEMS} value={deal.ecosystems} onChange={(ecosystems) => set({ ecosystems })} />
        </div>
        <div className="field span-2">
          <span className="field-label">Ecolens business unit</span>
          <ChipSelect options={BUSINESS_UNITS} value={deal.businessUnits} onChange={(businessUnits) => set({ businessUnits })} />
        </div>
        <div className="field span-2">
          <span className="field-label">ISV / VAR / Other</span>
          <ChipSelect options={PARTNER_TYPES} value={deal.partnerTypes} onChange={(partnerTypes) => set({ partnerTypes })} />
        </div>
        <Field label="Tags" hint="Comma-separated">
          <input
            value={deal.tags.join(', ')}
            onChange={(e) =>
              set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })
            }
          />
        </Field>
        <Field label="Weighted value" hint={`${stage?.probability ?? 0}% stage probability`}>
          <div className="static-value">{fmtMoney((dealValue(deal) * (stage?.probability ?? 0)) / 100)}</div>
        </Field>
      </div>
      <div className="danger-zone">
        <button
          className="danger-text"
          onClick={() => {
            if (confirm(`Delete "${deal.title}" and its notes and activities?`)) actions.removeDeal(deal.id)
          }}
        >
          Delete deal
        </button>
      </div>
    </div>
  )
}

function ContactsTab({ deal }: { deal: Deal }) {
  const { data, actions } = useApp()
  const contacts = data.contacts.filter((c) => c.dealId === deal.id)
  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    actions.addContact({ name: name.trim(), title: title.trim(), organization: deal.title, dealId: deal.id, email: '', phone: '', note: '' })
    setName('')
    setTitle('')
  }
  return (
    <div>
      <form className="activity-composer" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title / role" />
        <button className="primary" type="submit" disabled={!name.trim()}>
          Add
        </button>
      </form>
      <ul className="contact-list">
        {contacts.map((c) => (
          <li key={c.id} className="contact-row">
            <div className="contact-main">
              <input className="ghost-input strong" value={c.name} onChange={(e) => actions.updateContact(c.id, { name: e.target.value })} />
              <input className="ghost-input" value={c.title} placeholder="Title" onChange={(e) => actions.updateContact(c.id, { title: e.target.value })} />
              <input className="ghost-input" value={c.email} placeholder="Email" onChange={(e) => actions.updateContact(c.id, { email: e.target.value })} />
              <input className="ghost-input" value={c.phone} placeholder="Phone" onChange={(e) => actions.updateContact(c.id, { phone: e.target.value })} />
            </div>
            <button className="icon-btn subtle" onClick={() => actions.removeContact(c.id)} aria-label="Remove contact">
              🗑
            </button>
          </li>
        ))}
        {contacts.length === 0 && <li className="empty-state">No contacts on this deal yet.</li>}
      </ul>
    </div>
  )
}
