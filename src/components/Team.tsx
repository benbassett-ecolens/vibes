import { useState } from 'react'
import { useApp } from '../store'
import { defaultSort, sortItems, type SortState } from '../sort'
import { ConfirmButton, EmptyState, SortSelect } from './common'

type TeamSortField = 'name'

export function Team() {
  const { data, actions } = useApp()
  const [name, setName] = useState('')
  const [sort, setSort] = useState<SortState<TeamSortField>>(defaultSort)

  const people = sortItems(data.people, sort, (p, field) => {
    switch (field) {
      case 'name':
        return p.name
    }
  })

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
        <SortSelect value={sort} onChange={setSort} options={[{ value: 'name', label: 'Name' }]} />
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

      {people.length === 0 ? (
        <EmptyState>No teammates yet.</EmptyState>
      ) : (
        <ul className="team-list">
          {people.map((p) => (
            <li key={p.id}>
              <input
                className="ghost grow"
                value={p.name}
                onChange={(e) => actions.renamePerson(p.id, e.target.value)}
              />
              <ConfirmButton
                title={`Remove teammate — items they own will show "—"`}
                onConfirm={() => actions.removePerson(p.id)}
              >
                ✕
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
