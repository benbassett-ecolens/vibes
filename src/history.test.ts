import { describe, expect, it } from 'vitest'
import { logMetricEdit, normalizeData } from './store'
import type { AppData, Metric } from './types'

const metric: Metric = {
  id: 'm1',
  name: 'SQLs by week',
  ownerId: 'p1',
  goal: 5,
  comparator: 'gte',
  unit: 'each',
  cadence: 'weekly',
  entries: {},
}

const t0 = new Date('2026-09-29T15:00:00Z')
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000)

describe('logMetricEdit', () => {
  it('records a field edit with its before and after values', () => {
    const log = logMetricEdit([], metric, 'goal', '5', '7', t0)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ metricId: 'm1', kind: 'edited', field: 'goal', from: '5', to: '7' })
  })

  it('merges rapid edits to the same field into one entry', () => {
    let log = logMetricEdit([], metric, 'goal', '5', '0', t0)
    log = logMetricEdit(log, metric, 'goal', '0', '7', later(1))
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ from: '5', to: '7' })
  })

  it('drops the entry when an edit is undone', () => {
    let log = logMetricEdit([], metric, 'goal', '5', '7', t0)
    log = logMetricEdit(log, metric, 'goal', '7', '5', later(1))
    expect(log).toEqual([])
  })

  it('starts a new entry after the merge window or for another field', () => {
    let log = logMetricEdit([], metric, 'goal', '5', '7', t0)
    log = logMetricEdit(log, metric, 'goal', '7', '9', later(30))
    log = logMetricEdit(log, metric, 'ownerId', 'p1', 'p2', later(31))
    expect(log.map((c) => [c.field, c.from, c.to])).toEqual([
      ['goal', '5', '7'],
      ['goal', '7', '9'],
      ['ownerId', 'p1', 'p2'],
    ])
  })
})

describe('normalizeData archiving', () => {
  it('backfills archivedAt and metricChanges on data from before archiving existed', () => {
    const legacy = {
      people: [],
      headlines: [{ id: 'h1', text: 'x', authorId: 'p1', date: '2026-09-01', kind: 'general', done: true }],
      metrics: [],
      rocks: [
        {
          id: 'r1',
          name: 'Rock',
          ownerId: 'p1',
          dueDate: '',
          status: 'on_track',
          blocker: '',
          milestones: [{ id: 'ms1', name: 'M', ownerId: 'p1', status: 'on_track', dueDate: '' }],
        },
      ],
      issues: [],
      meetings: [],
    } as unknown as AppData

    const data = normalizeData(legacy)
    expect(data.headlines[0].archivedAt).toBe('')
    expect(data.rocks[0].archivedAt).toBe('')
    expect(data.rocks[0].milestones[0].archivedAt).toBe('')
    expect(data.metricChanges).toEqual([])
  })
})
