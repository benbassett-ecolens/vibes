import { useState } from 'react'
import { useApp } from '../store'
import { useDataControls } from '../App'
import { SHEET_URL } from '../seed'
import type { StageKind } from '../types'
import { Avatar } from './common'
import { SheetSyncPanel } from './SheetSync'

export function Settings() {
  const { data, actions, syncStatus } = useApp()
  const { exportJson, importJson, resetToSheet, clearAll, fileRef } = useDataControls()
  const [newPerson, setNewPerson] = useState('')
  const [newStage, setNewStage] = useState('')

  return (
    <div className="settings">
      <section className="panel">
        <h3>Team</h3>
        <p className="muted small">Owners for deals and activities. Colors are assigned automatically.</p>
        <ul className="plain-list team-list">
          {data.people.map((p) => (
            <li key={p.id} className="team-row">
              <Avatar person={p} />
              <input className="ghost-input" value={p.name} onChange={(e) => actions.updatePerson(p.id, { name: e.target.value })} />
              <span className="muted small">
                {data.deals.filter((d) => d.ownerId === p.id).length} deals
              </span>
              <button
                className="icon-btn subtle"
                aria-label={`Remove ${p.name}`}
                onClick={() => {
                  if (confirm(`Remove ${p.name} from the team? Their deals stay, unassigned.`)) actions.removePerson(p.id)
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
        <form
          className="activity-composer"
          onSubmit={(e) => {
            e.preventDefault()
            if (newPerson.trim()) actions.addPerson(newPerson)
            setNewPerson('')
          }}
        >
          <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="Add a teammate" />
          <button className="primary" type="submit" disabled={!newPerson.trim()}>
            Add
          </button>
        </form>
      </section>

      <section className="panel">
        <h3>Pipeline stages</h3>
        <p className="muted small">
          Probability feeds the weighted-pipeline figure. Won / lost / deferred stages are the board's outcome columns.
        </p>
        <ul className="plain-list stage-list">
          {data.stages.map((s, i) => (
            <li key={s.id} className="stage-row">
              <span className="reorder">
                <button className="icon-btn subtle" disabled={i === 0} onClick={() => actions.moveStage(s.id, -1)} aria-label="Move up">
                  ↑
                </button>
                <button
                  className="icon-btn subtle"
                  disabled={i === data.stages.length - 1}
                  onClick={() => actions.moveStage(s.id, 1)}
                  aria-label="Move down"
                >
                  ↓
                </button>
              </span>
              <input className="ghost-input strong" value={s.name} onChange={(e) => actions.updateStage(s.id, { name: e.target.value })} />
              <select value={s.kind} onChange={(e) => actions.updateStage(s.id, { kind: e.target.value as StageKind })}>
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="deferred">Deferred</option>
              </select>
              <label className="prob-input">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={s.probability}
                  onChange={(e) => actions.updateStage(s.id, { probability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                />
                %
              </label>
              <span className="muted small">{data.deals.filter((d) => d.stageId === s.id).length} deals</span>
              <button
                className="icon-btn subtle"
                aria-label={`Delete stage ${s.name}`}
                disabled={data.stages.length <= 1}
                onClick={() => {
                  const fallback = data.stages.find((x) => x.id !== s.id)
                  if (fallback && confirm(`Delete "${s.name}"? Its deals move to "${fallback.name}".`))
                    actions.removeStage(s.id, fallback.id)
                }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
        <form
          className="activity-composer"
          onSubmit={(e) => {
            e.preventDefault()
            if (newStage.trim()) actions.addStage(newStage)
            setNewStage('')
          }}
        >
          <input value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="Add an open stage" />
          <button className="primary" type="submit" disabled={!newStage.trim()}>
            Add
          </button>
        </form>
      </section>

      <SheetSyncPanel />

      <section className="panel">
        <h3>Data</h3>
        <p className="muted small">
          {syncStatus === 'live'
            ? 'This is a shared workspace: everyone the page is shared with sees the same pipeline, live.'
            : 'Data is stored in this browser. Export to back it up or move it.'}{' '}
          The{' '}
          <a href={SHEET_URL} target="_blank" rel="noreferrer">
            pipeline sheet
          </a>{' '}
          was first imported on Sep 8, 2026; "Reset to sheet import" restores that snapshot.
        </p>
        <div className="data-controls">
          <button onClick={exportJson}>Export JSON</button>
          <button onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importJson(f)
              e.target.value = ''
            }}
          />
          <button onClick={resetToSheet}>Reset to sheet import</button>
          <button className="danger-text" onClick={clearAll}>
            Clear all deals
          </button>
        </div>
        <dl className="stats">
          <div>
            <dt>Deals</dt>
            <dd>{data.deals.length}</dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>{data.notes.length}</dd>
          </div>
          <div>
            <dt>Activities</dt>
            <dd>{data.activities.length}</dd>
          </div>
          <div>
            <dt>Contacts</dt>
            <dd>{data.contacts.length}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
