import { useState } from 'react'
import type { Milestone, Rock, RockStatus } from '../types'
import { useApp } from '../store'
import { defaultSort, sortItems, type SortState } from '../sort'
import {
  ArchiveButton,
  ArchiveToggle,
  ConfirmButton,
  EmptyState,
  PersonSelect,
  SortSelect,
  StatusSelect,
  usePersonName,
} from './common'

type RockSortField = 'name' | 'owner' | 'dueDate' | 'status' | 'progress'

const STATUS_RANK: Record<RockStatus, number> = { off_track: 0, on_track: 1, completed: 2 }

/** Progress counts active milestones only; archived ones are kept as history. */
function rockProgress(rock: Rock): number {
  const active = rock.milestones.filter((m) => !m.archivedAt)
  if (active.length === 0) return 0
  return active.filter((m) => m.status === 'completed').length / active.length
}

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null
  const [y, m, d] = dateStr.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - now.getTime()) / 86_400_000)
}

/** "Nd left" / "Nd overdue" pill. `quietWhenOk` hides it until the date is within `warnWithin` days. */
function DueBadge({
  days,
  warnWithin,
  quietWhenOk = false,
}: {
  days: number | null
  warnWithin: number
  quietWhenOk?: boolean
}) {
  if (days == null) return null
  if (quietWhenOk && days > warnWithin) return null
  return (
    <span className={`badge ${days < 0 ? 'badge-bad' : days <= warnWithin ? 'badge-warn' : 'badge-ok'}`}>
      {days < 0 ? `${-days}d overdue` : `${days}d left`}
    </span>
  )
}

function MilestoneRow({ rock, ms }: { rock: Rock; ms: Milestone }) {
  const { actions } = useApp()
  return (
    <li className={ms.archivedAt ? 'is-archived' : ''}>
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
      <input
        type="date"
        className="ms-date"
        title="Milestone due date"
        value={ms.dueDate}
        onChange={(e) => actions.updateMilestone(rock.id, ms.id, { dueDate: e.target.value })}
      />
      {ms.archivedAt ? (
        <span className="meta">archived {ms.archivedAt}</span>
      ) : (
        ms.status !== 'completed' && (
          <DueBadge days={daysUntil(ms.dueDate)} warnWithin={7} quietWhenOk />
        )
      )}
      <ArchiveButton
        archived={!!ms.archivedAt}
        noun="milestone"
        onChange={(archived) => actions.setMilestoneArchived(rock.id, ms.id, archived)}
      />
      <ConfirmButton
        title="Delete milestone permanently"
        onConfirm={() => actions.removeMilestone(rock.id, ms.id)}
      >
        ✕
      </ConfirmButton>
    </li>
  )
}

function RockCard({ rock }: { rock: Rock }) {
  const { data, actions } = useApp()
  const [msName, setMsName] = useState('')
  const [msOwnerId, setMsOwnerId] = useState('')
  const [msDueDate, setMsDueDate] = useState('')
  const [showArchivedMs, setShowArchivedMs] = useState(false)

  const activeMilestones = rock.milestones.filter((m) => !m.archivedAt)
  const archivedMilestones = rock.milestones.filter((m) => m.archivedAt)
  const done = activeMilestones.filter((m) => m.status === 'completed').length
  const total = activeMilestones.length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const days = daysUntil(rock.dueDate)

  const addMilestone = () => {
    if (!msName.trim()) return
    actions.addMilestone(rock.id, msName.trim(), msOwnerId || rock.ownerId, msDueDate)
    setMsName('')
    setMsDueDate('')
  }

  return (
    <article
      className={`rock-card ${rock.status === 'completed' ? 'rock-done' : ''} ${rock.archivedAt ? 'is-archived' : ''}`}
    >
      {rock.archivedAt && <p className="archived-note">Archived {rock.archivedAt}</p>}
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
        <ArchiveButton
          archived={!!rock.archivedAt}
          noun="Rock"
          onChange={(archived) => actions.setRockArchived(rock.id, archived)}
        />
        <ConfirmButton title="Delete Rock permanently" onConfirm={() => actions.removeRock(rock.id)}>
          ✕
        </ConfirmButton>
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
        {rock.status !== 'completed' && <DueBadge days={days} warnWithin={14} />}
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
        {activeMilestones.map((ms) => (
          <MilestoneRow key={ms.id} rock={rock} ms={ms} />
        ))}
      </ul>

      {archivedMilestones.length > 0 && (
        <div className="archived-milestones">
          <button
            type="button"
            className="text-btn"
            aria-expanded={showArchivedMs}
            onClick={() => setShowArchivedMs((v) => !v)}
          >
            {showArchivedMs ? '▾' : '▸'} {archivedMilestones.length} archived milestone
            {archivedMilestones.length === 1 ? '' : 's'}
          </button>
          {showArchivedMs && (
            <ul className="milestones">
              {archivedMilestones.map((ms) => (
                <MilestoneRow key={ms.id} rock={rock} ms={ms} />
              ))}
            </ul>
          )}
        </div>
      )}

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
        <input
          type="date"
          title="Milestone due date (optional)"
          value={msDueDate}
          onChange={(e) => setMsDueDate(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>

      {data.people.length === 0 && <p className="hint">Add teammates in the Team tab to assign owners.</p>}
    </article>
  )
}

export function Rocks() {
  const { data, actions } = useApp()
  const personName = usePersonName()
  const [name, setName] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [sort, setSort] = useState<SortState<RockSortField>>(defaultSort)
  const [showArchived, setShowArchived] = useState(false)

  const archivedCount = data.rocks.filter((r) => r.archivedAt).length
  const visible = data.rocks.filter((r) => (showArchived ? r.archivedAt : !r.archivedAt))

  const submit = () => {
    if (!name.trim()) return
    actions.addRock(name.trim(), ownerId || data.people[0]?.id || '', dueDate)
    setName('')
    setDueDate('')
  }

  const rocks = sortItems(visible, sort, (r, field) => {
    switch (field) {
      case 'name':
        return r.name
      case 'owner':
        return personName(r.ownerId)
      case 'dueDate':
        return r.dueDate
      case 'status':
        return STATUS_RANK[r.status]
      case 'progress':
        return rockProgress(r)
    }
  })

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Quarterly Rocks</h2>
          <p className="hint">
            The 3–7 most important things to get done in the next 90 days. Each Rock has one owner
            and milestones that prove progress. In the L10, owners report only “on track” or “off
            track” — off-track Rocks drop to the Issues List. Archive finished Rocks and milestones
            to keep them on record without cluttering the quarter.
          </p>
        </div>
        <SortSelect
          value={sort}
          onChange={setSort}
          options={[
            { value: 'name', label: 'Name' },
            { value: 'owner', label: 'Owner' },
            { value: 'dueDate', label: 'Due date' },
            { value: 'status', label: 'Status' },
            { value: 'progress', label: 'Progress' },
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

      <ArchiveToggle
        showArchived={showArchived}
        onChange={setShowArchived}
        count={archivedCount}
        noun="Rocks"
      />

      {rocks.length === 0 ? (
        <EmptyState>
          {showArchived ? 'No archived Rocks yet.' : 'No Rocks yet. Set 3–7 quarterly priorities above.'}
        </EmptyState>
      ) : (
        <div className="rock-grid">
          {rocks.map((r) => (
            <RockCard key={r.id} rock={r} />
          ))}
        </div>
      )}
    </section>
  )
}
