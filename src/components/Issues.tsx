import { useState } from 'react'
import type { IssueTerm } from '../types'
import { useApp } from '../store'
import { EmptyState, PersonSelect } from './common'

export function Issues() {
  const { data, actions } = useApp()
  const [name, setName] = useState('')
  const [term, setTerm] = useState<IssueTerm>('short')
  const [raisedById, setRaisedById] = useState('')
  const [filter, setFilter] = useState<'all' | IssueTerm>('all')
  const [showSolved, setShowSolved] = useState(false)

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

  const issues = data.issues.filter(
    (i) => (filter === 'all' || i.term === filter) && (showSolved || !i.solved),
  )

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Issues List</h2>
          <p className="hint">
            Work the list with IDS: <strong>Identify</strong> the real issue,{' '}
            <strong>Discuss</strong> it once, <strong>Solve</strong> it with a decision and one
            person to implement it. Short-term issues get solved in this week's L10; long-term
            issues wait for the quarterly.
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

      <label className="show-solved">
        <input
          type="checkbox"
          checked={showSolved}
          onChange={(e) => setShowSolved(e.target.checked)}
        />
        Show solved issues
      </label>

      {issues.length === 0 ? (
        <EmptyState>No open issues match this filter. 🎉</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="issues">
            <thead>
              <tr>
                <th>Solved</th>
                <th>Issue</th>
                <th>Term</th>
                <th>Raised by</th>
                <th>Details</th>
                <th>Decision</th>
                <th>Implemented by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} className={issue.solved ? 'row-solved' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      title="Mark solved"
                      checked={issue.solved}
                      onChange={(e) => actions.updateIssue(issue.id, { solved: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      className={`ghost ${issue.solved ? 'strike' : ''}`}
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
                    <input
                      className="ghost"
                      value={issue.details}
                      placeholder="Context / details"
                      title={issue.details}
                      onChange={(e) => actions.updateIssue(issue.id, { details: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="ghost"
                      value={issue.decision}
                      placeholder="What did we decide?"
                      onChange={(e) => actions.updateIssue(issue.id, { decision: e.target.value })}
                    />
                  </td>
                  <td>
                    <PersonSelect
                      value={issue.implementerId}
                      onChange={(implementerId) => actions.updateIssue(issue.id, { implementerId })}
                    />
                  </td>
                  <td>
                    <button
                      className="icon-btn danger"
                      title="Delete issue"
                      onClick={() => actions.removeIssue(issue.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
