import { today, useApp } from '../store'
import { EmptyState, usePersonName } from './common'

export function SegueTab() {
  const { data, actions } = useApp()
  const personName = usePersonName()
  const todaysMeeting = data.meetings.find((m) => m.date === today())

  return (
    <section>
      <div className="section-head">
        <div>
          <h2>Segue</h2>
          <p className="hint">
            One statement each — a personal best and a professional best since the last meeting.
            Good news only, no discussion.
          </p>
        </div>
      </div>

      {!todaysMeeting ? (
        <EmptyState>Start today's meeting first, on the Start a Meeting tab.</EmptyState>
      ) : todaysMeeting.attendeeIds.length === 0 ? (
        <EmptyState>No attendees yet — pick them on the Start a Meeting tab.</EmptyState>
      ) : (
        <ul className="segue-list">
          {todaysMeeting.attendeeIds.map((personId) => {
            const text =
              data.segues.find((s) => s.meetingId === todaysMeeting.id && s.personId === personId)
                ?.text ?? ''
            return (
              <li key={personId}>
                <span className="segue-name">{personName(personId)}</span>
                <input
                  className="ghost grow"
                  value={text}
                  placeholder="Personal and professional best…"
                  onChange={(e) => actions.setSegue(todaysMeeting.id, personId, e.target.value)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
