import { useState } from 'react'
import { today, useApp } from '../store'
import { EmptyState } from './common'

const AGENDA: Array<[string, string]> = [
  ['Segue', '5 min — good news, personal & business'],
  ['Headlines', '5 min — customer & employee news'],
  ['Scorecard', '5 min — on track / off track only'],
  ['Rock review', '5 min — on track / off track only'],
  ['IDS', '60 min — identify, discuss, solve issues'],
  ['Conclude', '5 min — recap, cascade, rate 1–10'],
]

export function StartMeeting() {
  const { data, actions } = useApp()
  const [pending, setPending] = useState<string[]>([])
  const todaysMeeting = data.meetings.find((m) => m.date === today())

  const togglePending = (id: string) =>
    setPending((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Start a Meeting</h2>
          <p className="hint">
            The standard 90-minute Level 10 Meeting runs the agenda below in order — work through
            the tabs across the top the same way. Pick who's attending today to get started.
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
        <h3>Who's attending today?</h3>
        {data.people.length === 0 ? (
          <EmptyState>Add teammates in the Team tab first.</EmptyState>
        ) : todaysMeeting ? (
          <>
            <div className="attendee-checks">
              {data.people.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={todaysMeeting.attendeeIds.includes(p.id)}
                    onChange={() => actions.toggleAttendee(todaysMeeting.id, p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <p className="meta">
              Meeting started for today · {todaysMeeting.attendeeIds.length} attending. Head to
              Segue next.
            </p>
          </>
        ) : (
          <>
            <div className="attendee-checks">
              {data.people.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={pending.includes(p.id)}
                    onChange={() => togglePending(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
            <button
              className="primary"
              disabled={pending.length === 0}
              onClick={() => {
                actions.addMeeting(today(), pending)
                setPending([])
              }}
            >
              Start meeting ({pending.length} attendee{pending.length === 1 ? '' : 's'})
            </button>
          </>
        )}
      </div>
    </section>
  )
}
