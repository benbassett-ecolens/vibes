import { useState } from 'react'
import type { Meeting } from '../types'
import { today, useApp } from '../store'
import { EmptyState, usePersonName } from './common'

const AGENDA: Array<[string, string]> = [
  ['Segue', '5 min — good news, personal & business'],
  ['Scorecard', '5 min — on track / off track only'],
  ['Rock review', '5 min — on track / off track only'],
  ['Headlines', '5 min — customer & employee news'],
  ['To-do list', '5 min — done / not done'],
  ['IDS', '60 min — identify, discuss, solve issues'],
  ['Conclude', '5 min — recap, cascade, rate 1–10'],
]

function meetingAverage(m: Meeting): number | null {
  const scores = m.ratings.map((r) => r.score).filter((s) => s >= 1)
  if (scores.length === 0) return null
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
}

function MeetingCard({ meeting }: { meeting: Meeting }) {
  const { data, actions } = useApp()
  const personName = usePersonName()
  const avg = meetingAverage(meeting)

  return (
    <article className="meeting-card">
      <header className="meeting-head">
        <input
          type="date"
          value={meeting.date}
          onChange={(e) => actions.updateMeeting(meeting.id, { date: e.target.value })}
        />
        <span className={`avg-pill ${avg == null ? '' : avg >= 8 ? 'good' : avg >= 6 ? 'warn' : 'bad'}`}>
          {avg == null ? 'Not rated' : `Avg ${avg} / 10`}
        </span>
        <button
          className="icon-btn danger"
          title="Delete meeting"
          onClick={() => {
            if (confirm('Delete this meeting?')) actions.removeMeeting(meeting.id)
          }}
        >
          ✕
        </button>
      </header>

      <details className="attendee-picker">
        <summary>Attendees ({meeting.ratings.length})</summary>
        <div className="attendee-checks">
          {data.people.map((p) => (
            <label key={p.id}>
              <input
                type="checkbox"
                checked={meeting.ratings.some((r) => r.personId === p.id)}
                onChange={() => actions.toggleAttendee(meeting.id, p.id)}
              />
              {p.name}
            </label>
          ))}
        </div>
      </details>

      {meeting.ratings.length === 0 ? (
        <EmptyState>No attendees selected yet.</EmptyState>
      ) : (
        <ul className="rating-list">
          {meeting.ratings.map((r) => (
            <li key={r.personId}>
              <span className="grow">{personName(r.personId)}</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={r.score || 1}
                onChange={(e) => actions.setRating(meeting.id, r.personId, Number(e.target.value))}
              />
              <span className={`score ${r.score >= 1 ? '' : 'unset'}`}>
                {r.score >= 1 ? r.score : '—'}
              </span>
              {r.score < 1 && (
                <button
                  className="mini"
                  onClick={() => actions.setRating(meeting.id, r.personId, 8)}
                  title="Start rating (EOS aims for 8+)"
                >
                  rate
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <textarea
        className="notes"
        value={meeting.notes}
        placeholder="Cascading messages / notes…"
        onChange={(e) => actions.updateMeeting(meeting.id, { notes: e.target.value })}
      />
    </article>
  )
}

export function MeetingTab() {
  const { data, actions } = useApp()
  const [attendees, setAttendees] = useState<string[]>([])

  const toggle = (id: string) =>
    setAttendees((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Rate the Meeting</h2>
          <p className="hint">
            Every Level 10 Meeting ends with each attendee rating it 1–10. Anything under an 8
            deserves a conversation about why. The agenda below is the standard 90-minute L10.
          </p>
        </div>
      </div>

      <ol className="agenda">
        {AGENDA.map(([name, detail]) => (
          <li key={name}>
            <strong>{name}</strong> <span className="meta">{detail}</span>
          </li>
        ))}
      </ol>

      <div className="new-meeting">
        <h3>Start a meeting</h3>
        {data.people.length === 0 ? (
          <EmptyState>Add teammates in the Team tab first.</EmptyState>
        ) : (
          <>
            <div className="attendee-checks">
              {data.people.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={attendees.includes(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <button
              className="primary"
              disabled={attendees.length === 0}
              onClick={() => {
                actions.addMeeting(today(), attendees)
                setAttendees([])
              }}
            >
              Create meeting ({attendees.length} attendee{attendees.length === 1 ? '' : 's'})
            </button>
          </>
        )}
      </div>

      {data.meetings.length === 0 ? (
        <EmptyState>No meetings recorded yet.</EmptyState>
      ) : (
        <div className="meeting-list">
          {data.meetings.map((m) => (
            <MeetingCard key={m.id} meeting={m} />
          ))}
        </div>
      )}
    </section>
  )
}
