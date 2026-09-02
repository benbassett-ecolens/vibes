import { useState } from 'react'
import { useApp } from '../store'
import { EmptyState } from './common'

export function Team() {
  const { data, actions } = useApp()
  const [name, setName] = useState('')

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Team</h2>
          <p className="hint">
            People listed here appear as owners on the Scorecard, Rocks, Issues, and as attendees
            when rating a meeting.
          </p>
        </div>
      </div>

      <form
        className="add-form"
        onSubmit={(e) => {
          e.preventDefault()
          actions.addPerson(name)
          setName('')
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Teammate name…"
        />
        <button type="submit" className="primary">
          Add teammate
        </button>
      </form>

      {data.people.length === 0 ? (
        <EmptyState>No teammates yet.</EmptyState>
      ) : (
        <ul className="team-list">
          {data.people.map((p) => (
            <li key={p.id}>
              <input
                className="ghost grow"
                value={p.name}
                onChange={(e) => actions.renamePerson(p.id, e.target.value)}
              />
              <button
                className="icon-btn danger"
                title="Remove teammate"
                onClick={() => {
                  if (confirm(`Remove ${p.name}? Items they own will show "—".`))
                    actions.removePerson(p.id)
                }}
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
