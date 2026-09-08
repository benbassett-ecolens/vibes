import { useState } from 'react'
import { useApp, type NewDealInput } from '../store'
import { ChipSelect, ECOSYSTEMS, Field, Modal, MoneyInput, PersonSelect } from './common'

export function NewDealModal({
  onClose,
  onCreate,
  defaultStageId,
}: {
  onClose: () => void
  onCreate: (input: NewDealInput) => void
  defaultStageId?: string
}) {
  const { data } = useApp()
  const openStages = data.stages.filter((s) => s.kind === 'open')
  const [title, setTitle] = useState('')
  const [product, setProduct] = useState('')
  const [ownerId, setOwnerId] = useState(data.people[0]?.id ?? '')
  const [stageId, setStageId] = useState(defaultStageId ?? openStages[0]?.id ?? '')
  const [retainer, setRetainer] = useState<number | null>(null)
  const [performance, setPerformance] = useState<number | null>(null)
  const [closeDate, setCloseDate] = useState('')
  const [ecosystems, setEcosystems] = useState<string[]>([])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate({
      title,
      product,
      ownerId,
      stageId,
      retainerAcv: retainer,
      performanceAcv: performance,
      closeDate,
      ecosystems,
    })
  }

  return (
    <Modal title="New deal" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="Prospect">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Company name" required />
        </Field>
        <Field label="What they sell">
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. AP automation" />
        </Field>
        <Field label="Owner">
          <PersonSelect value={ownerId} onChange={setOwnerId} allowEmpty={false} />
        </Field>
        <Field label="Stage">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {openStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Retainer ACV">
          <MoneyInput value={retainer} onChange={setRetainer} placeholder="$90,000" />
        </Field>
        <Field label="Performance ACV">
          <MoneyInput value={performance} onChange={setPerformance} placeholder="$90,000" />
        </Field>
        <Field label="Expected close">
          <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
        </Field>
        <div className="field span-2">
          <span className="field-label">Ecosystems</span>
          <ChipSelect options={ECOSYSTEMS} value={ecosystems} onChange={setEcosystems} />
        </div>
        <div className="form-actions span-2">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!title.trim()}>
            Add deal
          </button>
        </div>
      </form>
    </Modal>
  )
}
