import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { useUI } from '../ui'
import type { Activity } from '../types'
import { ACTIVITY_ICON, addDays, daysUntil, fmtDate, fmtRelative, today } from '../format'
import { Avatar, EmptyState, usePerson } from './common'

type Bucket = { label: string; items: Activity[]; tone?: 'bad' | 'warn' }

export function Activities() {
  const { data, actions } = useApp()
  const { openDeal, ownerFilter, search } = useUI()
  const person = usePerson()
  const [showDone, setShowDone] = useState(false)

  const dealName = (id: string) => data.deals.find((d) => d.id === id)?.title ?? '(deleted deal)'

  const buckets = useMemo<Bucket[]>(() => {
    const q = search.trim().toLowerCase()
    const t = today()
    const weekEnd = addDays(t, 7)
    const list = data.activities.filter((a) => {
      if (ownerFilter && a.ownerId !== ownerFilter) return false
      if (q && !`${a.subject} ${dealName(a.dealId)}`.toLowerCase().includes(q)) return false
      return showDone ? a.done : !a.done
    })
    const sorted = [...list].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    if (showDone) return [{ label: 'Done', items: sorted.reverse() }]
    const all: Bucket[] = [
      { label: 'Overdue', items: sorted.filter((a) => a.dueDate && a.dueDate < t), tone: 'bad' },
      { label: 'Today', items: sorted.filter((a) => a.dueDate === t), tone: 'warn' },
      { label: 'This week', items: sorted.filter((a) => a.dueDate > t && a.dueDate <= weekEnd) },
      { label: 'Later', items: sorted.filter((a) => a.dueDate > weekEnd) },
      { label: 'No date', items: sorted.filter((a) => !a.dueDate) },
    ]
    return all.filter((b) => b.items.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.activities, data.deals, ownerFilter, search, showDone])

  const noActivityDeals = useMemo(() => {
    const openStageIds = new Set(data.stages.filter((s) => s.kind === 'open').map((s) => s.id))
    const withOpen = new Set(data.activities.filter((a) => !a.done).map((a) => a.dealId))
    return data.deals.filter(
      (d) => openStageIds.has(d.stageId) && !withOpen.has(d.id) && (!ownerFilter || d.ownerId === ownerFilter),
    )
  }, [data, ownerFilter])

  return (
    <div className="activities-view">
      <div className="board-toolbar">
        <span className="seg">
          <button className={!showDone ? 'on' : ''} onClick={() => setShowDone(false)}>
            Planned
          </button>
          <button className={showDone ? 'on' : ''} onClick={() => setShowDone(true)}>
            Done
          </button>
        </span>
        <span className="muted">Activities live on deals — open a deal to add one.</span>
      </div>

      {buckets.length === 0 && <EmptyState>Nothing here.</EmptyState>}
      {buckets.map((b) => (
        <section key={b.label} className="panel bucket">
          <h3 className={`bucket-title ${b.tone ?? ''}`}>
            {b.label} <span className="count">{b.items.length}</span>
          </h3>
          <ul className="activity-list">
            {b.items.map((a) => {
              const overdue = !a.done && a.dueDate && daysUntil(a.dueDate) < 0
              return (
                <li key={a.id} className={`activity ${a.done ? 'done' : ''} ${overdue ? 'overdue' : ''}`}>
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
                    <div>
                      <span className="strong">{a.subject}</span>
                      <button className="link-btn" onClick={() => openDeal(a.dealId)}>
                        {dealName(a.dealId)}
                      </button>
                    </div>
                    <div className="act-meta">
                      <span className={`when ${overdue ? 'overdue' : ''}`}>
                        {a.dueDate ? `${fmtDate(a.dueDate)} · ${fmtRelative(a.dueDate)}` : 'No date'}
                      </span>
                      {a.note && <span className="muted"> · {a.note}</span>}
                    </div>
                  </div>
                  <span className="owner-cell small">
                    <Avatar person={person(a.ownerId)} size={20} />
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {!showDone && noActivityDeals.length > 0 && (
        <section className="panel bucket">
          <h3 className="bucket-title warn">
            Open deals with no next step <span className="count">{noActivityDeals.length}</span>
          </h3>
          <ul className="plain-list">
            {noActivityDeals.map((d) => (
              <li key={d.id}>
                <button className="link-btn" onClick={() => openDeal(d.id)}>
                  {d.title}
                </button>
                <span className="muted small">
                  {' '}
                  · {data.stages.find((s) => s.id === d.stageId)?.name} · {person(d.ownerId)?.name}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
