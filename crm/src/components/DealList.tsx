import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { useUI } from '../ui'
import type { Deal } from '../types'
import { activityUrgency, dealValue, dealValueLabel, fmtDate, fmtRelative, nextActivity } from '../format'
import { Avatar, usePerson } from './common'
import { useFilteredDeals } from './Pipeline'

type SortKey = 'title' | 'stage' | 'owner' | 'value' | 'close' | 'next'

export function DealList() {
  const { data } = useApp()
  const { openDeal } = useUI()
  const deals = useFilteredDeals()
  const person = usePerson()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'stage', dir: 1 })
  const [stageFilter, setStageFilter] = useState<'open' | 'all' | 'won' | 'lost'>('open')

  const stageIndex = (d: Deal) => data.stages.findIndex((s) => s.id === d.stageId)
  const rows = useMemo(() => {
    const list = deals.filter((d) => {
      const kind = data.stages.find((s) => s.id === d.stageId)?.kind
      if (stageFilter === 'all') return true
      if (stageFilter === 'open') return kind === 'open'
      return kind === stageFilter
    })
    const cmp: Record<SortKey, (a: Deal, b: Deal) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      stage: (a, b) => stageIndex(a) - stageIndex(b),
      owner: (a, b) => (person(a.ownerId)?.name ?? '').localeCompare(person(b.ownerId)?.name ?? ''),
      value: (a, b) => dealValue(a) - dealValue(b),
      close: (a, b) => (a.closeDate || '9999').localeCompare(b.closeDate || '9999'),
      next: (a, b) =>
        (nextActivity(data.activities, a.id)?.dueDate || '9999').localeCompare(
          nextActivity(data.activities, b.id)?.dueDate || '9999',
        ),
    }
    return [...list].sort((a, b) => cmp[sort.key](a, b) * sort.dir)
  }, [deals, sort, stageFilter, data, person])

  const th = (key: SortKey, label: string, numeric = false) => (
    <th
      className={`${numeric ? 'num' : ''} sortable ${sort.key === key ? 'sorted' : ''}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      {label} {sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? '↑' : '↓'}</span>}
    </th>
  )

  const total = rows.reduce((n, d) => n + dealValue(d), 0)

  return (
    <div className="panel">
      <div className="board-toolbar">
        <span className="seg">
          {(['open', 'won', 'lost', 'all'] as const).map((k) => (
            <button key={k} className={stageFilter === k ? 'on' : ''} onClick={() => setStageFilter(k)}>
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </span>
        <span className="muted">
          {rows.length} deals · ${Math.round(total).toLocaleString('en-US')}
        </span>
      </div>
      <div className="table-wrap">
        <table className="deals-table">
          <thead>
            <tr>
              {th('title', 'Deal')}
              {th('stage', 'Stage')}
              {th('owner', 'Owner')}
              <th>Ecosystem</th>
              {th('value', 'Retainer', true)}
              {th('value', 'Performance', true)}
              {th('value', 'Total', true)}
              {th('close', 'Close')}
              {th('next', 'Next activity')}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const stage = data.stages.find((s) => s.id === d.stageId)
              const next = nextActivity(data.activities, d.id)
              const urgency = activityUrgency(next)
              return (
                <tr key={d.id} onClick={() => openDeal(d.id)} className="clickable">
                  <td>
                    <div className="cell-title">{d.title}</div>
                    {d.product && <div className="muted small">{d.product}</div>}
                  </td>
                  <td>
                    <span className={`stage-pill kind-${stage?.kind ?? 'open'}`}>{stage?.name ?? '—'}</span>
                  </td>
                  <td>
                    <span className="owner-cell">
                      <Avatar person={person(d.ownerId)} size={20} /> {person(d.ownerId)?.name ?? '—'}
                    </span>
                  </td>
                  <td className="muted small">{d.ecosystems.join(', ') || '—'}</td>
                  <td className="num">{d.retainerAcv === null ? '—' : `$${d.retainerAcv.toLocaleString('en-US')}`}</td>
                  <td className="num">
                    {d.performanceAcv === null ? '—' : `$${d.performanceAcv.toLocaleString('en-US')}`}
                  </td>
                  <td className="num strong">{dealValueLabel(d)}</td>
                  <td>{fmtDate(d.closeDate)}</td>
                  <td>
                    {stage?.kind === 'open' ? (
                      <span className={`next-act ${urgency}`}>{next ? fmtRelative(next.dueDate) : 'None scheduled'}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
