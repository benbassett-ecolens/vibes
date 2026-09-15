import { useState } from 'react'
import type { HeadlineKind } from '../types'
import { today, useApp } from '../store'
import { defaultSort, sortItems, type SortState } from '../sort'
import { EmptyState, PersonSelect, SortSelect, usePersonName } from './common'

const KIND_LABEL: Record<HeadlineKind, string> = {
  customer: 'Customer',
  employee: 'Employee',
  general: 'General',
}

type HeadlineSortField = 'date' | 'author' | 'kind' | 'done'

export function Headlines() {
  const { data, actions } = useApp()
  const personName = usePersonName()
  const [text, setText] = useState('')
  const [authorId, setAuthorId] = useState('')
  const [kind, setKind] = useState<HeadlineKind>('general')
  const [sort, setSort] = useState<SortState<HeadlineSortField>>(defaultSort)

  const headlines = sortItems(data.headlines, sort, (h, field) => {
    switch (field) {
      case 'date':
        return h.date
      case 'author':
        return personName(h.authorId)
      case 'kind':
        return h.kind
      case 'done':
        return h.done
    }
  })

  const submit = () => {
    if (!text.trim()) return
    actions.addHeadline({
      text: text.trim(),
      authorId: authorId || data.people[0]?.id || '',
      date: today(),
      kind,
      done: false,
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
            that needs discussion drops to the Issues List. Check one off once it's been shared.
          </p>
        </div>
        <SortSelect
          value={sort}
          onChange={setSort}
          options={[
            { value: 'date', label: 'Date' },
            { value: 'author', label: 'Shared by' },
            { value: 'kind', label: 'Kind' },
            { value: 'done', label: 'Shared status' },
          ]}
        />
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

      {headlines.length === 0 ? (
        <EmptyState>No headlines yet. Share customer or employee news above.</EmptyState>
      ) : (
        <ul className="headline-list">
          {headlines.map((h) => (
            <li key={h.id} className={`headline ${h.done ? 'headline-done' : ''}`}>
              <input
                type="checkbox"
                checked={h.done}
                title="Mark shared"
                onChange={(e) => actions.updateHeadline(h.id, { done: e.target.checked })}
              />
              <span className={`badge badge-${h.kind}`}>{KIND_LABEL[h.kind]}</span>
              <input
                className={`ghost grow ${h.done ? 'strike' : ''}`}
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
