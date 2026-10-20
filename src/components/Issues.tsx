import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { IssueTerm } from '../types'
import { useApp } from '../store'
import { defaultSort, sortItems, type SortState } from '../sort'
import {
  ArchiveButton,
  ArchiveToggle,
  ConfirmButton,
  EmptyState,
  PersonSelect,
  SortableHeader,
  usePersonName,
} from './common'

const SOLVED_WINDOW_DAYS = 7

type IssueSortField = 'solved' | 'name' | 'term' | 'raisedBy' | 'implementedBy'

function daysSince(dateStr: string): number | null {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const then = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((now.getTime() - then.getTime()) / 86_400_000)
}

export function Issues() {
  const { data, actions } = useApp()
  const personName = usePersonName()
  const [name, setName] = useState('')
  const [term, setTerm] = useState<IssueTerm>('short')
  const [raisedById, setRaisedById] = useState('')
  const [filter, setFilter] = useState<'all' | IssueTerm>('all')
  const [showAllSolved, setShowAllSolved] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [sort, setSort] = useState<SortState<IssueSortField>>(defaultSort)
  // Manual drag-and-drop ordering (only while no column sort is applied).
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const dropRef = useRef(drop)
  dropRef.current = drop
  const manual = !sort.field

  const submit = () => {
    if (!name.trim()) return
    actions.addIssue({
      name: name.trim(),
      term,
      raisedById: raisedById || data.people[0]?.id || '',
      details: '',
      decision: '',
      implementerId: '',
    })
    setName('')
  }

  const archivedCount = data.issues.filter((i) => i.archivedAt).length
  const filtered = data.issues.filter((i) => {
    if (filter !== 'all' && i.term !== filter) return false
    // The archive shows every archived issue, solved or not.
    if (showArchived) return !!i.archivedAt
    if (i.archivedAt) return false
    if (!i.solved) return true
    if (showAllSolved) return true
    const days = daysSince(i.solvedAt)
    return days != null && days <= SOLVED_WINDOW_DAYS
  })

  const issues = sortItems(filtered, sort, (issue, field) => {
    switch (field) {
      case 'solved':
        return issue.solved
      case 'name':
        return issue.name
      case 'term':
        return issue.term
      case 'raisedBy':
        return personName(issue.raisedById)
      case 'implementedBy':
        return personName(issue.implementerId)
    }
  })

  /** Which issue group is under the pointer, and whether it's the top or bottom half. */
  const dropTargetAt = (x: number, y: number) => {
    const group = document.elementFromPoint(x, y)?.closest<HTMLElement>('tbody.issue-group')
    const id = group?.dataset.issueId
    if (!group || !id) return null
    const rect = group.getBoundingClientRect()
    return { id, place: y < rect.top + rect.height / 2 ? ('before' as const) : ('after' as const) }
  }

  const startDrag = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (!manual || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragId(id)
    setDrop(null)
  }
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!dragId) return
    const target = dropTargetAt(e.clientX, e.clientY)
    setDrop(target && target.id !== dragId ? target : null)
  }
  const endDrag = () => {
    const target = dropRef.current
    if (dragId && target) actions.moveIssue(dragId, target.id, target.place)
    setDragId(null)
    setDrop(null)
  }
  /** Keyboard alternative: arrow keys move the issue one place among those shown. */
  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!manual) return
    const id = issues[index].id
    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault()
      actions.moveIssue(id, issues[index - 1].id, 'before')
    } else if (e.key === 'ArrowDown' && index < issues.length - 1) {
      e.preventDefault()
      actions.moveIssue(id, issues[index + 1].id, 'after')
    }
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Issues List</h2>
          <p className="hint">
            Work the list with IDS: <strong>Identify</strong> the real issue,{' '}
            <strong>Discuss</strong> it once, <strong>Solve</strong> it with a decision and one
            person to implement it. Short-term issues get solved in this week's L10; long-term
            issues wait for the quarterly. Issues solved in the last {SOLVED_WINDOW_DAYS} days
            stay visible so the team can see what got closed out. Archive an issue to take it off
            the list while keeping it on record.
          </p>
        </div>
        <div className="toggle" role="tablist" aria-label="Issue filter">
          {(['all', 'short', 'long'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'short' ? 'Short term' : 'Long term'}
            </button>
          ))}
        </div>
      </div>

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
          placeholder="Raise an issue…"
        />
        <select value={term} onChange={(e) => setTerm(e.target.value as IssueTerm)}>
          <option value="short">Short term</option>
          <option value="long">Long term</option>
        </select>
        <PersonSelect value={raisedById} onChange={setRaisedById} emptyLabel="Raised by…" />
        <button type="submit" className="primary">
          Add issue
        </button>
      </form>

      <ArchiveToggle
        showArchived={showArchived}
        onChange={setShowArchived}
        count={archivedCount}
        noun="issues"
      />

      <div className="issues-toolbar">
        {!showArchived && (
          <label className="show-solved">
            <input
              type="checkbox"
              checked={showAllSolved}
              onChange={(e) => setShowAllSolved(e.target.checked)}
            />
            Show all solved issues (older than {SOLVED_WINDOW_DAYS} days)
          </label>
        )}
        {manual ? (
          <span className="hint">Drag ⠿ to put issues in the order you'll work them.</span>
        ) : (
          <span className="hint">
            Sorted by column.{' '}
            <button type="button" className="text-btn" onClick={() => setSort(defaultSort())}>
              Back to manual order
            </button>
          </span>
        )}
      </div>

      {issues.length === 0 ? (
        <EmptyState>
          {showArchived ? 'No archived issues yet.' : 'No open issues match this filter. 🎉'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="issues">
            <thead>
              <tr>
                <SortableHeader field="solved" sort={sort} onChange={setSort}>
                  Solved
                </SortableHeader>
                <SortableHeader field="name" sort={sort} onChange={setSort}>
                  Issue
                </SortableHeader>
                <SortableHeader field="term" sort={sort} onChange={setSort}>
                  Term
                </SortableHeader>
                <SortableHeader field="raisedBy" sort={sort} onChange={setSort}>
                  Raised by
                </SortableHeader>
                <SortableHeader field="implementedBy" sort={sort} onChange={setSort}>
                  Implemented by
                </SortableHeader>
                <th></th>
              </tr>
            </thead>
            {issues.map((issue, index) => (
              // One tbody per issue: the issue line, then its details and decision
              // at full width underneath so long text has room.
              <tbody
                key={issue.id}
                data-issue-id={issue.id}
                className={[
                  'issue-group',
                  issue.solved ? 'row-solved' : '',
                  issue.archivedAt ? 'is-archived' : '',
                  dragId === issue.id ? 'is-dragging' : '',
                  drop?.id === issue.id ? `drop-${drop.place}` : '',
                ].join(' ')}
              >
                <tr>
                  <td>
                    <span className="solved-cell">
                      {manual && (
                        <button
                          type="button"
                          className="drag-handle"
                          title="Drag to reorder (or use the arrow keys)"
                          aria-label={`Reorder ${issue.name}`}
                          onPointerDown={(e) => startDrag(e, issue.id)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag}
                          onPointerCancel={() => {
                            setDragId(null)
                            setDrop(null)
                          }}
                          onKeyDown={(e) => keyMove(e, index)}
                        >
                          ⠿
                        </button>
                      )}
                      <input
                        type="checkbox"
                        title={issue.solved ? `Solved ${issue.solvedAt}` : 'Mark solved'}
                        checked={issue.solved}
                        onChange={(e) => actions.updateIssue(issue.id, { solved: e.target.checked })}
                      />
                    </span>
                  </td>
                  <td>
                    <input
                      className={`ghost issue-name ${issue.solved ? 'strike' : ''}`}
                      value={issue.name}
                      onChange={(e) => actions.updateIssue(issue.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={issue.term}
                      onChange={(e) =>
                        actions.updateIssue(issue.id, { term: e.target.value as IssueTerm })
                      }
                    >
                      <option value="short">Short</option>
                      <option value="long">Long</option>
                    </select>
                  </td>
                  <td>
                    <PersonSelect
                      value={issue.raisedById}
                      onChange={(raisedById) => actions.updateIssue(issue.id, { raisedById })}
                    />
                  </td>
                  <td>
                    <PersonSelect
                      value={issue.implementerId}
                      onChange={(implementerId) => actions.updateIssue(issue.id, { implementerId })}
                    />
                  </td>
                  <td className="issue-actions">
                    <ArchiveButton
                      archived={!!issue.archivedAt}
                      noun="issue"
                      onChange={(archived) => actions.setIssueArchived(issue.id, archived)}
                    />
                    <ConfirmButton
                      title="Delete issue permanently"
                      onConfirm={() => actions.removeIssue(issue.id)}
                    >
                      ✕
                    </ConfirmButton>
                  </td>
                </tr>
                <tr className="issue-notes-row">
                  <td></td>
                  <td colSpan={5}>
                    <div className="issue-notes">
                      <label>
                        <span>Details</span>
                        <textarea
                          className="issue-textarea"
                          rows={2}
                          value={issue.details}
                          placeholder="Context / details"
                          onChange={(e) => actions.updateIssue(issue.id, { details: e.target.value })}
                        />
                      </label>
                      <label>
                        <span>
                          Decision
                          {issue.archivedAt && ` · archived ${issue.archivedAt}`}
                        </span>
                        <textarea
                          className="issue-textarea"
                          rows={2}
                          value={issue.decision}
                          placeholder="What did we decide?"
                          onChange={(e) => actions.updateIssue(issue.id, { decision: e.target.value })}
                        />
                      </label>
                    </div>
                  </td>
                </tr>
              </tbody>
            ))}
          </table>
        </div>
      )}
    </section>
  )
}
