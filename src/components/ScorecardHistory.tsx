import { useState } from 'react'
import type { MetricChange, MetricField } from '../types'
import { useApp } from '../store'
import { usePersonName } from './common'

const FIELD_LABEL: Record<MetricField, string> = {
  name: 'Renamed',
  ownerId: 'Owner',
  goal: 'Goal',
  comparator: 'Goal direction',
  unit: 'Unit',
  cadence: 'Cadence',
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * The scorecard's change history: what is being measured, not the results.
 * Lists every measurable added, removed, or redefined (name, owner, goal,
 * goal direction, unit, cadence), newest first.
 */
export function ScorecardHistory() {
  const { data } = useApp()
  const personName = usePersonName()
  const [open, setOpen] = useState(false)

  const changes = [...data.metricChanges].sort((a, b) => b.at.localeCompare(a.at))
  const currentName = (c: MetricChange) =>
    data.metrics.find((m) => m.id === c.metricId)?.name ?? c.metricName

  const show = (field: MetricChange['field'], value: string): string => {
    if (field === 'ownerId') return value ? personName(value) : 'no owner'
    if (field === 'comparator') return value === 'lte' ? '≤ (at or under)' : '≥ (at or above)'
    if (value === '') return '(none)'
    return value
  }

  return (
    <div className="change-history">
      <button
        type="button"
        className="text-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} Change history ({changes.length})
      </button>
      {open &&
        (changes.length === 0 ? (
          <p className="hint">
            No changes recorded yet. Adding, removing, or redefining a measurable (its name, owner,
            goal, unit, or cadence) is logged here. Weekly and monthly numbers are not.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Measurable</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id}>
                    <td className="when">{formatWhen(c.at)}</td>
                    <td>{currentName(c)}</td>
                    <td>
                      {c.kind === 'added' && (
                        <>
                          <span className="change-kind">Added</span> · {c.to}
                        </>
                      )}
                      {c.kind === 'removed' && (
                        <>
                          <span className="change-kind">Removed</span> · was {c.from}
                        </>
                      )}
                      {c.kind === 'edited' && c.field && (
                        <>
                          <span className="change-kind">{FIELD_LABEL[c.field]}</span>{' '}
                          <span className="change-from">{show(c.field, c.from)}</span> →{' '}
                          {show(c.field, c.to)}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  )
}
