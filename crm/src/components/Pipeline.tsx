import { useMemo, useState } from 'react'
import { useApp } from '../store'
import { useUI } from '../ui'
import type { Deal, Stage } from '../types'
import {
  ACTIVITY_ICON,
  activityUrgency,
  dealValue,
  dealValueLabel,
  fmtDate,
  fmtMoney,
  fmtRelative,
  nextActivity,
} from '../format'
import { Avatar, usePerson } from './common'
import { NewDealModal } from './NewDealModal'

export function useFilteredDeals(): Deal[] {
  const { data } = useApp()
  const { ownerFilter, search } = useUI()
  return useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.deals.filter((d) => {
      if (ownerFilter && d.ownerId !== ownerFilter) return false
      if (!q) return true
      const hay = [d.title, d.product, ...d.ecosystems, ...d.businessUnits, ...d.tags]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [data.deals, ownerFilter, search])
}

export function Pipeline() {
  const { data, actions } = useApp()
  const deals = useFilteredDeals()
  const [showClosed, setShowClosed] = useState(true)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const [addToStage, setAddToStage] = useState<string | null>(null)
  const { openDeal } = useUI()

  const stages = data.stages.filter((s) => showClosed || s.kind === 'open')
  const openTotal = deals
    .filter((d) => data.stages.find((s) => s.id === d.stageId)?.kind === 'open')
    .reduce((n, d) => n + dealValue(d), 0)

  const onDrop = (stageId: string) => {
    if (dragId) actions.moveDeal(dragId, stageId)
    setDragId(null)
    setOverStage(null)
  }

  return (
    <div className="pipeline">
      <div className="board-toolbar">
        <span className="muted">
          {deals.filter((d) => data.stages.find((s) => s.id === d.stageId)?.kind === 'open').length} open
          deals · {fmtMoney(openTotal)} in play
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show won / lost / deferred
        </label>
      </div>
      <div className="board" role="list" aria-label="Pipeline stages">
        {stages.map((stage) => {
          const cards = deals.filter((d) => d.stageId === stage.id)
          const total = cards.reduce((n, d) => n + dealValue(d), 0)
          return (
            <section
              key={stage.id}
              role="listitem"
              className={`column kind-${stage.kind} ${overStage === stage.id ? 'drag-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (overStage !== stage.id) setOverStage(stage.id)
              }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => onDrop(stage.id)}
            >
              <header className="column-head">
                <div>
                  <h2>{stage.name}</h2>
                  <div className="column-meta">
                    {fmtMoney(total, { compact: true })} · {cards.length} {cards.length === 1 ? 'deal' : 'deals'}
                    {stage.kind === 'open' && <span className="prob"> · {stage.probability}%</span>}
                  </div>
                </div>
                {stage.kind === 'open' && (
                  <button className="icon-btn" title="Add deal here" onClick={() => setAddToStage(stage.id)}>
                    +
                  </button>
                )}
              </header>
              <div className="cards">
                {cards.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stage={stage}
                    dragging={dragId === deal.id}
                    onDragStart={() => setDragId(deal.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setOverStage(null)
                    }}
                    onOpen={() => openDeal(deal.id)}
                  />
                ))}
                {cards.length === 0 && <div className="column-empty">Drop a deal here</div>}
              </div>
            </section>
          )
        })}
      </div>
      {addToStage && (
        <NewDealModal
          defaultStageId={addToStage}
          onClose={() => setAddToStage(null)}
          onCreate={(input) => {
            const id = actions.addDeal(input)
            setAddToStage(null)
            openDeal(id)
          }}
        />
      )}
    </div>
  )
}

function DealCard({
  deal,
  stage,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  deal: Deal
  stage: Stage
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}) {
  const { data } = useApp()
  const person = usePerson()(deal.ownerId)
  const next = nextActivity(data.activities, deal.id)
  const urgency = activityUrgency(next)
  const isOpen = stage.kind === 'open'

  return (
    <article
      className={`card ${dragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      tabIndex={0}
      role="button"
      aria-label={`${deal.title}, ${dealValueLabel(deal)}`}
    >
      <div className="card-top">
        <h3>{deal.title}</h3>
        <Avatar person={person} size={22} />
      </div>
      {deal.product && <div className="card-product">{deal.product}</div>}
      <div className="card-chips">
        {deal.ecosystems.slice(0, 3).map((e) => (
          <span key={e} className="tag">
            {e}
          </span>
        ))}
        {deal.ecosystems.length > 3 && <span className="tag">+{deal.ecosystems.length - 3}</span>}
        {deal.tags.map((t) => (
          <span key={t} className="tag warn-tag">
            {t}
          </span>
        ))}
      </div>
      <div className="card-foot">
        <span className="card-value">{dealValueLabel(deal, true)}</span>
        {isOpen ? (
          <span className={`next-act ${urgency}`} title={next ? `${next.subject} · ${fmtRelative(next.dueDate)}` : 'No activity scheduled'}>
            {next ? (
              <>
                <span aria-hidden="true">{ACTIVITY_ICON[next.type]}</span> {next.dueDate ? fmtDate(next.dueDate) : 'No date'}
              </>
            ) : (
              <>
                <span className="dot" aria-hidden="true" /> No activity
              </>
            )}
          </span>
        ) : (
          <span className="muted small">
            {stage.kind === 'won' && deal.renewalDate
              ? `Renews ${fmtDate(deal.renewalDate)}`
              : deal.closeDate
                ? fmtDate(deal.closeDate)
                : 'No date'}
          </span>
        )}
      </div>
    </article>
  )
}
