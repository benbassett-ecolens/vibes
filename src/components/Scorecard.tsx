import { useState } from 'react'
import type { Cadence, Comparator, Metric } from '../types'
import {
  formatValue,
  lastNPeriods,
  periodKey,
  periodLabel,
  rolling90DayAverage,
  shiftPeriod,
} from '../periods'
import { useApp } from '../store'
import { EmptyState, NumberInput, PersonSelect } from './common'

function TrendCell({ metric, cur, prev }: { metric: Metric; cur?: number; prev?: number }) {
  if (cur == null || prev == null) return <span className="trend trend-none">—</span>
  if (cur === prev) return <span className="trend trend-none">▬ flat</span>
  const up = cur > prev
  const good = metric.comparator === 'gte' ? up : !up
  return (
    <span className={`trend ${good ? 'trend-good' : 'trend-bad'}`}>
      {up ? '▲ up' : '▼ down'}
    </span>
  )
}

function MetricRow({ metric, cadence }: { metric: Metric; cadence: Cadence }) {
  const { actions } = useApp()
  const [expanded, setExpanded] = useState(false)

  const curKey = periodKey(new Date(), cadence)
  const prevKey = shiftPeriod(curKey, cadence, -1)
  const cur = metric.entries[curKey]
  const prev = metric.entries[prevKey]
  const avg = rolling90DayAverage(metric.entries, cadence)

  const goalMet = (v: number | undefined) =>
    v == null ? undefined : metric.comparator === 'gte' ? v >= metric.goal : v <= metric.goal

  const historyKeys = lastNPeriods(cadence === 'weekly' ? 13 : 6, cadence)

  return (
    <>
      <tr>
        <td>
          <button
            className="icon-btn"
            title="Show history (fills the 90-day average)"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </td>
        <td>
          <input
            className="ghost"
            value={metric.name}
            onChange={(e) => actions.updateMetric(metric.id, { name: e.target.value })}
          />
        </td>
        <td>
          <PersonSelect
            value={metric.ownerId}
            onChange={(ownerId) => actions.updateMetric(metric.id, { ownerId })}
          />
        </td>
        <td className="goal-cell">
          <select
            className="comparator"
            value={metric.comparator}
            onChange={(e) =>
              actions.updateMetric(metric.id, { comparator: e.target.value as Comparator })
            }
            title="≥ hit or exceed the goal · ≤ stay at or under it"
          >
            <option value="gte">≥</option>
            <option value="lte">≤</option>
          </select>
          <NumberInput
            className="num"
            value={metric.goal}
            onChange={(v) => actions.updateMetric(metric.id, { goal: v ?? 0 })}
          />
          <input
            className="unit"
            value={metric.unit}
            placeholder="unit"
            title="Unit ($, %, or a label)"
            onChange={(e) => actions.updateMetric(metric.id, { unit: e.target.value })}
          />
        </td>
        <td className={goalMet(cur) === true ? 'cell-good' : goalMet(cur) === false ? 'cell-bad' : ''}>
          <NumberInput
            className="num"
            value={cur ?? null}
            placeholder="—"
            onChange={(v) => actions.setMetricEntry(metric.id, curKey, v)}
          />
        </td>
        <td className={goalMet(prev) === true ? 'cell-good' : goalMet(prev) === false ? 'cell-bad' : ''}>
          <NumberInput
            className="num"
            value={prev ?? null}
            placeholder="—"
            onChange={(v) => actions.setMetricEntry(metric.id, prevKey, v)}
          />
        </td>
        <td className="avg">{formatValue(avg, metric.unit)}</td>
        <td>
          <TrendCell metric={metric} cur={cur} prev={prev} />
        </td>
        <td>
          <button
            className="icon-btn danger"
            title="Delete metric"
            onClick={() => {
              if (confirm(`Delete metric "${metric.name}"?`)) actions.removeMetric(metric.id)
            }}
          >
            ✕
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="history-row">
          <td colSpan={9}>
            <div className="history">
              <span className="history-label">
                {cadence === 'weekly' ? 'Last 13 weeks' : 'Last 6 months'} (rolling 90-day average
                uses the shaded window):
              </span>
              <div className="history-grid">
                {historyKeys.map((key) => (
                  <label key={key} className="history-cell">
                    <span>{periodLabel(key, cadence)}</span>
                    <NumberInput
                      className="num"
                      value={metric.entries[key] ?? null}
                      placeholder="—"
                      onChange={(v) => actions.setMetricEntry(metric.id, key, v)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddMetricForm({ cadence }: { cadence: Cadence }) {
  const { data, actions } = useApp()
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [goal, setGoal] = useState<number | null>(null)
  const [comparator, setComparator] = useState<Comparator>('gte')
  const [unit, setUnit] = useState('')

  const submit = () => {
    if (!name.trim()) return
    actions.addMetric({
      name: name.trim(),
      ownerId: ownerId || data.people[0]?.id || '',
      goal: goal ?? 0,
      comparator,
      unit: unit.trim(),
      cadence,
    })
    setName('')
    setGoal(null)
    setUnit('')
  }

  return (
    <form
      className="add-form"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New measurable (e.g. Sales calls made)"
      />
      <PersonSelect value={ownerId} onChange={setOwnerId} emptyLabel="Owner…" />
      <select value={comparator} onChange={(e) => setComparator(e.target.value as Comparator)}>
        <option value="gte">Goal ≥</option>
        <option value="lte">Goal ≤</option>
      </select>
      <NumberInput className="num" value={goal} onChange={setGoal} placeholder="Goal" />
      <input
        className="unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        placeholder="Unit"
      />
      <button type="submit" className="primary">
        Add metric
      </button>
    </form>
  )
}

export function Scorecard() {
  const { data } = useApp()
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const metrics = data.metrics.filter((m) => m.cadence === cadence)
  const curLabel = periodLabel(periodKey(new Date(), cadence), cadence)
  const prevLabel = periodLabel(shiftPeriod(periodKey(new Date(), cadence), cadence, -1), cadence)

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Scorecard</h2>
          <p className="hint">
            5–15 measurables with a goal and a single owner. Say each number out loud; anything off
            track drops to the Issues List. Expand a row (▸) to backfill history — the average is a
            rolling 90-day window.
          </p>
        </div>
        <div className="toggle" role="tablist" aria-label="Scorecard cadence">
          {(['weekly', 'monthly'] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={cadence === c}
              className={cadence === c ? 'active' : ''}
              onClick={() => setCadence(c)}
            >
              {c === 'weekly' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>
      </div>

      {metrics.length === 0 ? (
        <EmptyState>No {cadence} measurables yet — add one below.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="scorecard">
            <thead>
              <tr>
                <th></th>
                <th>Measurable</th>
                <th>Owner</th>
                <th>Goal</th>
                <th>
                  This {cadence === 'weekly' ? 'week' : 'month'}
                  <span className="th-sub">{curLabel}</span>
                </th>
                <th>
                  Last {cadence === 'weekly' ? 'week' : 'month'}
                  <span className="th-sub">{prevLabel}</span>
                </th>
                <th>90-day avg</th>
                <th>Trend</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <MetricRow key={m.id} metric={m} cadence={cadence} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddMetricForm cadence={cadence} />
    </section>
  )
}
