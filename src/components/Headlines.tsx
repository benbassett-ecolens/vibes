import { useState } from 'react'
import type { HeadlineKind } from '../types'
import { today, useApp } from '../store'
import { EmptyState, PersonSelect, usePersonName } from './common'

const KIND_LABEL: Record<HeadlineKind, string> = {
  customer: 'Customer',
  employee: 'Employee',
  general: 'General',
}

export function Headlines() {
  const { data, actions } = useApp()
  const personName = usePersonName()
  const [text, setText] = useState('')
  const [authorId, setAuthorId] = useState('')
  const [kind, setKind] = useState<HeadlineKind>('general')

  const submit = () => {
    if (!text.trim()) return
    actions.addHeadline({
      text: text.trim(),
      authorId: authorId || data.people[0]?.id || '',
      date: today(),
      kind,
    })
    setText('')
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Headlines</h2>
          <p className="hint">
            Quick customer and employee news — good or bad, one line each, no discussion. Anything
            that needs discussion drops to the Issues List.
          </p>
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share a headline…"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as HeadlineKind)}>
          <option value="customer">Customer</option>
          <option value="employee">Employee</option>
          <option value="general">General</option>
        </select>
        <PersonSelect value={authorId} onChange={setAuthorId} emptyLabel="Shared by…" />
        <button type="submit" className="primary">
          Add headline
        </button>
      </form>

      {data.headlines.length === 0 ? (
        <EmptyState>No headlines yet. Share customer or employee news above.</EmptyState>
      ) : (
        <ul className="headline-list">
          {data.headlines.map((h) => (
            <li key={h.id} className="headline">
              <span className={`badge badge-${h.kind}`}>{KIND_LABEL[h.kind]}</span>
              <input
                className="ghost grow"
                value={h.text}
                onChange={(e) => actions.updateHeadline(h.id, { text: e.target.value })}
              />
              <span className="meta">
                {personName(h.authorId)} · {h.date}
              </span>
              <button
                className="icon-btn danger"
                title="Delete headline"
                onClick={() => actions.removeHeadline(h.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
