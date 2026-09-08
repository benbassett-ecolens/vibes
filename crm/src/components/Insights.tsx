import { useState } from 'react'
import { useApp } from '../store'
import { useUI } from '../ui'
import type { GroupBy, ListKind, Metric, Scope, Widget, WidgetSize, WidgetType } from '../types'
import {
  GROUP_LABEL,
  METRIC_LABEL,
  MONEY_METRICS,
  SCOPE_LABEL,
  computeMetric,
  groupDeals,
  openActivities,
  scopeDeals,
  upcomingRenewals,
  type GroupRow,
} from '../insights'
import { ACTIVITY_ICON, daysUntil, dealValue, dealValueLabel, fmtDate, fmtMoney, fmtPct, fmtRelative } from '../format'
import { Avatar, EmptyState, Field, InlineText, Modal, usePerson } from './common'

const LIST_LABEL: Record<ListKind, string> = {
  renewals: 'Upcoming renewals',
  nextActivities: 'Next activities',
  overdue: 'Overdue activities',
  topOpen: 'Largest open deals',
  recentlyWon: 'Recently won',
  stale: 'Open deals with no next step',
}

export function Insights() {
  const { data, actions } = useApp()
  const [dashId, setDashId] = useState(data.dashboards[0]?.id ?? '')
  const [editing, setEditing] = useState(false)
  const [editWidget, setEditWidget] = useState<Widget | 'new' | null>(null)
  const dash = data.dashboards.find((d) => d.id === dashId) ?? data.dashboards[0]
  const widgets = dash ? data.widgets.filter((w) => w.dashboardId === dash.id) : []

  if (!dash) {
    return (
      <div className="panel">
        <EmptyState>No dashboards yet.</EmptyState>
        <button className="primary" onClick={() => setDashId(actions.addDashboard('Sales overview'))}>
          Create a dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="insights">
      <div className="board-toolbar">
        <div className="dash-tabs" role="tablist">
          {data.dashboards.map((d) => (
            <button
              key={d.id}
              role="tab"
              aria-selected={d.id === dash.id}
              className={d.id === dash.id ? 'on' : ''}
              onClick={() => setDashId(d.id)}
            >
              {d.id === dash.id && editing ? (
                <InlineText value={d.name} onChange={(name) => actions.renameDashboard(d.id, name)} />
              ) : (
                d.name
              )}
            </button>
          ))}
          <button
            className="icon-btn"
            title="New dashboard"
            onClick={() => {
              const name = prompt('Dashboard name', 'New dashboard')
              if (name) setDashId(actions.addDashboard(name))
            }}
          >
            +
          </button>
        </div>
        <div className="toolbar-actions">
          {editing && (
            <>
              <button onClick={() => setEditWidget('new')}>+ Add widget</button>
              <button
                className="danger-text"
                onClick={() => {
                  if (data.dashboards.length > 1 && confirm(`Delete dashboard "${dash.name}"?`)) {
                    actions.removeDashboard(dash.id)
                    setDashId(data.dashboards.find((d) => d.id !== dash.id)?.id ?? '')
                  }
                }}
                disabled={data.dashboards.length <= 1}
              >
                Delete dashboard
              </button>
            </>
          )}
          <button className={editing ? 'primary' : ''} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Done' : 'Edit dashboard'}
          </button>
        </div>
      </div>

      <div className={`widget-grid ${editing ? 'editing' : ''}`}>
        {widgets.map((w, i) => (
          <div key={w.id} className={`widget size-${w.size} type-${w.type}`}>
            {editing && (
              <div className="widget-tools">
                <button className="icon-btn" disabled={i === 0} onClick={() => actions.moveWidget(w.id, -1)} title="Move earlier">
                  ←
                </button>
                <button
                  className="icon-btn"
                  disabled={i === widgets.length - 1}
                  onClick={() => actions.moveWidget(w.id, 1)}
                  title="Move later"
                >
                  →
                </button>
                <button className="icon-btn" onClick={() => setEditWidget(w)} title="Edit widget">
                  ✎
                </button>
                <button className="icon-btn" onClick={() => actions.removeWidget(w.id)} title="Remove widget">
                  ✕
                </button>
              </div>
            )}
            <WidgetView widget={w} />
          </div>
        ))}
        {widgets.length === 0 && (
          <div className="widget size-lg">
            <EmptyState>
              This dashboard is empty. {editing ? 'Add a widget above.' : 'Click "Edit dashboard" to add widgets.'}
            </EmptyState>
          </div>
        )}
      </div>

      {editWidget && (
        <WidgetEditor
          initial={editWidget === 'new' ? null : editWidget}
          dashboardId={dash.id}
          onClose={() => setEditWidget(null)}
        />
      )}
    </div>
  )
}

function WidgetView({ widget }: { widget: Widget }) {
  const { data } = useApp()
  const money = MONEY_METRICS.includes(widget.metric)
  const fmt = (n: number) =>
    widget.metric === 'winRate' ? fmtPct(n) : money ? fmtMoney(n, { compact: true }) : String(Math.round(n))

  if (widget.type === 'kpi') {
    const value = computeMetric(data, widget.metric, widget.scope)
    const count = scopeDeals(data, widget.scope).length
    return (
      <div className="kpi">
        <div className="widget-title">{widget.title}</div>
        <div className="kpi-value">{widget.metric === 'winRate' ? fmtPct(value) : money ? fmtMoney(value) : Math.round(value)}</div>
        <div className="kpi-sub">
          {SCOPE_LABEL[widget.scope]} · {count} {count === 1 ? 'deal' : 'deals'}
        </div>
      </div>
    )
  }

  if (widget.type === 'bar' || widget.type === 'donut') {
    const rows = groupDeals(data, widget.metric, widget.scope, widget.groupBy)
    return (
      <div className="chart-widget">
        <div className="widget-title">{widget.title}</div>
        <div className="widget-sub">
          {METRIC_LABEL[widget.metric]} · {SCOPE_LABEL[widget.scope].toLowerCase()} · by {GROUP_LABEL[widget.groupBy].toLowerCase()}
        </div>
        {rows.length === 0 ? (
          <EmptyState>No deals in this scope.</EmptyState>
        ) : widget.type === 'bar' ? (
          <BarChart rows={rows} fmt={fmt} groupBy={widget.groupBy} />
        ) : (
          <Donut rows={rows} fmt={fmt} groupBy={widget.groupBy} />
        )}
      </div>
    )
  }

  return <ListWidget widget={widget} />
}

/** Series color by entity: stages use the ordinal blue ramp, everything else the fixed categorical order. */
function seriesColor(groupBy: GroupBy, index: number, total: number): string {
  if (groupBy === 'stage' || groupBy === 'closeMonth') {
    const ramp = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)', 'var(--seq-7)', 'var(--seq-8)', 'var(--seq-9)']
    if (total <= 1) return ramp[5]
    const pos = Math.round((index / Math.max(total - 1, 1)) * (ramp.length - 1))
    return ramp[Math.min(ramp.length - 1, Math.max(0, pos))]
  }
  return `var(--cat-${(index % 8) + 1})`
}

function BarChart({ rows, fmt, groupBy }: { rows: GroupRow[]; fmt: (n: number) => string; groupBy: GroupBy }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  const [hover, setHover] = useState<string | null>(null)
  return (
    <div className="bars" role="img" aria-label={rows.map((r) => `${r.label}: ${fmt(r.value)}`).join(', ')}>
      {rows.map((r, i) => (
        <div
          key={r.key}
          className={`bar-row ${hover === r.key ? 'hover' : ''}`}
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
        >
          <span className="bar-label" title={r.label}>
            {r.label}
          </span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                width: `${(r.value / max) * 100}%`,
                background: seriesColor(groupBy, groupBy === 'closeMonth' ? i : r.colorIndex, groupBy === 'closeMonth' ? rows.length : 9),
              }}
            />
          </span>
          <span className="bar-value">
            {fmt(r.value)}
            {hover === r.key && <span className="muted"> · {r.count} {r.count === 1 ? 'deal' : 'deals'}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function Donut({ rows, fmt, groupBy }: { rows: GroupRow[]; fmt: (n: number) => string; groupBy: GroupBy }) {
  const total = rows.reduce((n, r) => n + r.value, 0) || 1
  const [hover, setHover] = useState<string | null>(null)
  const R = 42
  const C = 2 * Math.PI * R
  let offset = 0
  const shown = rows.slice(0, 7)
  const rest = rows.slice(7)
  const list: GroupRow[] = rest.length
    ? [...shown, { key: 'other', label: 'Other', value: rest.reduce((n, r) => n + r.value, 0), count: rest.reduce((n, r) => n + r.count, 0), colorIndex: 7 }]
    : shown
  const active = list.find((r) => r.key === hover)
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 100 100" className="donut" role="img" aria-label={list.map((r) => `${r.label}: ${fmt(r.value)}`).join(', ')}>
        {list.map((r, i) => {
          const len = (r.value / total) * C
          const el = (
            <circle
              key={r.key}
              cx="50"
              cy="50"
              r={R}
              fill="none"
              stroke={seriesColor(groupBy, r.key === 'other' ? 7 : r.colorIndex, list.length)}
              strokeWidth={hover === r.key ? 14 : 11}
              strokeDasharray={`${Math.max(len - 1.2, 0)} ${C - Math.max(len - 1.2, 0)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'stroke-width .15s' }}
              data-i={i}
            />
          )
          offset += len
          return el
        })}
        <text x="50" y="47" textAnchor="middle" className="donut-center">
          {active ? fmt(active.value) : fmt(total)}
        </text>
        <text x="50" y="59" textAnchor="middle" className="donut-center-sub">
          {active ? active.label : 'total'}
        </text>
      </svg>
      <ul className="legend">
        {list.map((r) => (
          <li
            key={r.key}
            className={hover === r.key ? 'hover' : ''}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="swatch" style={{ background: seriesColor(groupBy, r.key === 'other' ? 7 : r.colorIndex, list.length) }} />
            <span className="legend-label">{r.label}</span>
            <span className="legend-value">
              {fmt(r.value)} <span className="muted">({Math.round((r.value / total) * 100)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ListWidget({ widget }: { widget: Widget }) {
  const { data } = useApp()
  const { openDeal } = useUI()
  const person = usePerson()
  const title = <div className="widget-title">{widget.title}</div>
  const dealOf = (id: string) => data.deals.find((d) => d.id === id)

  if (widget.listKind === 'renewals') {
    const rows = upcomingRenewals(data).slice(0, widget.limit)
    return (
      <div className="list-widget">
        {title}
        {rows.length === 0 ? (
          <EmptyState>No won deals with a renewal date.</EmptyState>
        ) : (
          <table className="mini-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Renews</th>
                <th className="num">Value</th>
                <th>Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const n = daysUntil(d.renewalDate)
                return (
                  <tr key={d.id} className="clickable" onClick={() => openDeal(d.id)}>
                    <td className="strong">{d.title}</td>
                    <td>
                      {fmtDate(d.renewalDate)}{' '}
                      <span className={`muted small ${n < 60 ? 'warn-text' : ''}`}>({n < 0 ? `${-n}d ago` : `${n}d`})</span>
                    </td>
                    <td className="num">{dealValueLabel(d, true)}</td>
                    <td>
                      <Avatar person={person(d.ownerId)} size={20} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    )
  }

  if (widget.listKind === 'nextActivities' || widget.listKind === 'overdue') {
    const rows = openActivities(data, widget.listKind === 'overdue' ? 'overdue' : 'upcoming').slice(0, widget.limit)
    return (
      <div className="list-widget">
        {title}
        {rows.length === 0 ? (
          <EmptyState>{widget.listKind === 'overdue' ? 'Nothing overdue. 🎉' : 'No activities scheduled.'}</EmptyState>
        ) : (
          <ul className="activity-list compact">
            {rows.map((a) => {
              const overdue = daysUntil(a.dueDate) < 0
              return (
                <li key={a.id} className={`activity ${overdue ? 'overdue' : ''}`}>
                  <span className="act-icon" aria-hidden="true">
                    {ACTIVITY_ICON[a.type]}
                  </span>
                  <div className="act-main">
                    <div>
                      <span className="strong">{a.subject}</span>
                      <button className="link-btn" onClick={() => openDeal(a.dealId)}>
                        {dealOf(a.dealId)?.title ?? '—'}
                      </button>
                    </div>
                    <div className="act-meta">
                      <span className={`when ${overdue ? 'overdue' : ''}`}>{fmtRelative(a.dueDate)}</span>
                      <span className="muted"> · {person(a.ownerId)?.name}</span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  if (widget.listKind === 'stale') {
    const openIds = new Set(data.stages.filter((s) => s.kind === 'open').map((s) => s.id))
    const withNext = new Set(data.activities.filter((a) => !a.done).map((a) => a.dealId))
    const rows = data.deals.filter((d) => openIds.has(d.stageId) && !withNext.has(d.id)).slice(0, widget.limit)
    return (
      <div className="list-widget">
        {title}
        {rows.length === 0 ? (
          <EmptyState>Every open deal has a next step.</EmptyState>
        ) : (
          <ul className="plain-list">
            {rows.map((d) => (
              <li key={d.id}>
                <button className="link-btn" onClick={() => openDeal(d.id)}>
                  {d.title}
                </button>
                <span className="muted small"> · {data.stages.find((s) => s.id === d.stageId)?.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // topOpen / recentlyWon → table
  const rows =
    widget.listKind === 'recentlyWon'
      ? scopeDeals(data, 'won')
          .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''))
          .slice(0, widget.limit)
      : scopeDeals(data, 'open')
          .sort((a, b) => dealValue(b) - dealValue(a))
          .slice(0, widget.limit)
  return (
    <div className="list-widget">
      {title}
      <table className="mini-table">
        <thead>
          <tr>
            <th>Deal</th>
            <th>Stage</th>
            <th>Owner</th>
            <th className="num">Retainer</th>
            <th className="num">Performance</th>
            <th className="num">Total</th>
            <th>{widget.listKind === 'recentlyWon' ? 'Won' : 'Close'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="clickable" onClick={() => openDeal(d.id)}>
              <td className="strong">{d.title}</td>
              <td>
                <span className={`stage-pill kind-${data.stages.find((s) => s.id === d.stageId)?.kind ?? 'open'}`}>
                  {data.stages.find((s) => s.id === d.stageId)?.name}
                </span>
              </td>
              <td>{person(d.ownerId)?.name ?? '—'}</td>
              <td className="num">{d.retainerAcv === null ? '—' : fmtMoney(d.retainerAcv)}</td>
              <td className="num">{d.performanceAcv === null ? '—' : fmtMoney(d.performanceAcv)}</td>
              <td className="num strong">{dealValueLabel(d)}</td>
              <td>{fmtDate(d.closeDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WidgetEditor({
  initial,
  dashboardId,
  onClose,
}: {
  initial: Widget | null
  dashboardId: string
  onClose: () => void
}) {
  const { actions } = useApp()
  const [w, setW] = useState<Omit<Widget, 'id'>>(
    initial ?? {
      dashboardId,
      title: 'Open pipeline',
      type: 'kpi',
      metric: 'tcv',
      scope: 'open',
      groupBy: 'stage',
      listKind: 'renewals',
      size: 'sm',
      limit: 8,
    },
  )
  const set = (patch: Partial<Widget>) => setW((x) => ({ ...x, ...patch }))
  const isList = w.type === 'list' || w.type === 'table'
  const isChart = w.type === 'bar' || w.type === 'donut'

  const save = () => {
    if (initial) actions.updateWidget(initial.id, w)
    else actions.addWidget(w)
    onClose()
  }

  return (
    <Modal title={initial ? 'Edit widget' : 'Add widget'} onClose={onClose}>
      <div className="form-grid">
        <Field label="Title">
          <input value={w.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Widget type">
          <select
            value={w.type}
            onChange={(e) => {
              const type = e.target.value as WidgetType
              set({
                type,
                size: type === 'kpi' ? 'sm' : type === 'table' ? 'lg' : w.size === 'sm' ? 'md' : w.size,
                ...(type === 'table' ? { listKind: w.listKind === 'topOpen' || w.listKind === 'recentlyWon' ? w.listKind : 'topOpen' } : {}),
                ...(type === 'list' && (w.listKind === 'topOpen' || w.listKind === 'recentlyWon') ? { listKind: 'renewals' } : {}),
              })
            }}
          >
            <option value="kpi">Number tile</option>
            <option value="bar">Bar chart</option>
            <option value="donut">Donut chart</option>
            <option value="list">List</option>
            <option value="table">Table</option>
          </select>
        </Field>
        {!isList && (
          <>
            <Field label="Measure">
              <select value={w.metric} onChange={(e) => set({ metric: e.target.value as Metric })}>
                {(Object.keys(METRIC_LABEL) as Metric[])
                  .filter((m) => w.type === 'kpi' || m !== 'winRate')
                  .map((m) => (
                    <option key={m} value={m}>
                      {METRIC_LABEL[m]}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Deals included">
              <select value={w.scope} onChange={(e) => set({ scope: e.target.value as Scope })}>
                {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {isChart && (
          <Field label="Group by">
            <select value={w.groupBy} onChange={(e) => set({ groupBy: e.target.value as GroupBy })}>
              {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isList && (
          <>
            <Field label="Shows">
              <select value={w.listKind} onChange={(e) => set({ listKind: e.target.value as ListKind })}>
                {(Object.keys(LIST_LABEL) as ListKind[])
                  .filter((k) => (w.type === 'table' ? k === 'topOpen' || k === 'recentlyWon' : k !== 'topOpen' && k !== 'recentlyWon'))
                  .map((k) => (
                    <option key={k} value={k}>
                      {LIST_LABEL[k]}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Rows">
              <input type="number" min={1} max={50} value={w.limit} onChange={(e) => set({ limit: Number(e.target.value) || 8 })} />
            </Field>
          </>
        )}
        <Field label="Width">
          <select value={w.size} onChange={(e) => set({ size: e.target.value as WidgetSize })}>
            <option value="sm">Small (¼)</option>
            <option value="md">Medium (½)</option>
            <option value="lg">Full width</option>
          </select>
        </Field>
        <div className="form-actions span-2">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>
            {initial ? 'Save' : 'Add widget'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
