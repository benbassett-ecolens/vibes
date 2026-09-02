import { useState } from 'react'
import type { Rock } from '../types'
import { useApp } from '../store'
import { EmptyState, PersonSelect, StatusSelect } from './common'

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - now.getTime()) / 86_400_000)
}

function RockCard({ rock }: { rock: Rock }) {
  const { data, actions } = useApp()
  const [msName, setMsName] = useState('')
  const [msOwnerId, setMsOwnerId] = useState('')

  const done = rock.milestones.filter((m) => m.status === 'completed').length
  const total = rock.milestones.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const days = daysUntil(rock.dueDate)

  const addMilestone = () => {
    if (!msName.trim()) return
    actions.addMilestone(rock.id, msName.trim(), msOwnerId || rock.ownerId)
    setMsName('')
  }

  return (
    <article className={`rock-card ${rock.status === 'completed' ? 'rock-done' : ''}`}>
      <header className="rock-head">
        <StatusSelect
          value={rock.status}
          onChange={(status) => actions.updateRock(rock.id, { status })}
          title="Rock status"
        />
        <input
          className="ghost rock-title"
          value={rock.name}
          onChange={(e) => actions.updateRock(rock.id, { name: e.target.value })}
        />
        <button
          className="icon-btn danger"
          title="Delete Rock"
          onClick={() => {
            if (confirm(`Delete Rock "${rock.name}"?`)) actions.removeRock(rock.id)
          }}
        >
          ✕
        </button>
      </header>

      <div className="rock-meta">
        <label>
          Owner
          <PersonSelect
            value={rock.ownerId}
            onChange={(ownerId) => actions.updateRock(rock.id, { ownerId })}
          />
        </label>
        <label>
          Due
          <input
            type="date"
            value={rock.dueDate}
            onChange={(e) => actions.updateRock(rock.id, { dueDate: e.target.value })}
          />
        </label>
        {days != null && rock.status !== 'completed' && (
          <span className={`badge ${days < 0 ? 'badge-bad' : days <= 14 ? 'badge-warn' : 'badge-ok'}`}>
            {days < 0 ? `${-days}d overdue` : `${days}d left`}
          </span>
        )}
      </div>

      <label className="blocker">
        <span className={rock.blocker ? 'blocker-flag active' : 'blocker-flag'}>
          ⚠ Blocker
        </span>
        <input
          className="ghost grow"
          value={rock.blocker}
          placeholder="None — add a note here if this Rock is blocked"
          onChange={(e) => actions.updateRock(rock.id, { blocker: e.target.value })}
        />
      </label>

      <div className="progress" title={`${done} of ${total} milestones done`}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <ul className="milestones">
        {rock.milestones.map((ms) => (
          <li key={ms.id}>
            <StatusSelect
              value={ms.status}
              onChange={(status) => actions.updateMilestone(rock.id, ms.id, { status })}
              title="Milestone status"
            />
            <input
              className={`ghost grow ${ms.status === 'completed' ? 'strike' : ''}`}
              value={ms.name}
              onChange={(e) => actions.updateMilestone(rock.id, ms.id, { name: e.target.value })}
            />
            <PersonSelect
              value={ms.ownerId}
              onChange={(ownerId) => actions.updateMilestone(rock.id, ms.id, { ownerId })}
            />
            <button
              className="icon-btn danger"
              title="Delete milestone"
              onClick={() => actions.removeMilestone(rock.id, ms.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <form
        className="add-form compact"
        onSubmit={(e) => {
          e.preventDefault()
          addMilestone()
        }}
      >
        <input
          value={msName}
          onChange={(e) => setMsName(e.target.value)}
          placeholder="Add milestone…"
        />
        <PersonSelect value={msOwnerId} onChange={setMsOwnerId} emptyLabel="Owner…" />
        <button type="submit">Add</button>
      </form>

      {data.people.length === 0 && <p className="hint">Add teammates in the Team tab to assign owners.</p>}
    </article>
  )
}

export function Rocks() {
  const { data, actions } = useApp()
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')

  const submit = () => {
    if (!name.trim()) return
    actions.addRock(name.trim(), ownerId || data.people[0]?.id || '', dueDate)
    setName('')
    setDueDate('')
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Quarterly Rocks</h2>
          <p className="hint">
            The 3–7 most important things to get done in the next 90 days. Each Rock has one owner
            and milestones that prove progress. In the L10, owners report only “on track” or “off
            track” — off-track Rocks drop to the Issues List.
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
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New Rock (specific, measurable, done in 90 days)…"
        />
        <PersonSelect value={ownerId} onChange={setOwnerId} emptyLabel="Owner…" />
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button type="submit" className="primary">
          Add Rock
        </button>
      </form>

      {data.rocks.length === 0 ? (
        <EmptyState>No Rocks yet. Set 3–7 quarterly priorities above.</EmptyState>
      ) : (
        <div className="rock-grid">
          {data.rocks.map((r) => (
            <RockCard key={r.id} rock={r} />
          ))}
        </div>
      )}
    </section>
  )
}
