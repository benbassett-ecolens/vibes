import { describe, expect, it } from 'vitest'
import { stableStringify } from './dbSync'
import { normalizeData } from './store'
import type { AppData, Meeting } from './types'

describe('stableStringify', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      stableStringify({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    )
  })

  it('distinguishes different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }))
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify('x')).toBe('"x"')
    expect(stableStringify(5)).toBe('5')
  })
})

describe('normalizeData', () => {
  it('migrates legacy meetings with embedded ratings', () => {
    const legacy = {
      people: [],
      headlines: [],
      metrics: [],
      rocks: [],
      issues: [],
      meetings: [
        {
          id: 'm1',
          date: '2026-08-23',
          notes: 'n',
          ratings: [
            { personId: 'p1', score: 9 },
            { personId: 'p2', score: 0 },
          ],
        } as unknown as Meeting,
      ],
    } as unknown as AppData

    const data = normalizeData(legacy)
    expect(data.meetings[0].attendeeIds).toEqual(['p1', 'p2'])
    expect((data.meetings[0] as { ratings?: unknown }).ratings).toBeUndefined()
    // only actual scores (>=1) become rating records
    expect(data.ratings).toEqual([
      { id: 'm1~p1', meetingId: 'm1', personId: 'p1', score: 9 },
    ])
  })

  it('passes through current-shape data and guarantees ratings exists', () => {
    const current = {
      people: [],
      headlines: [],
      metrics: [],
      rocks: [],
      issues: [],
      meetings: [{ id: 'm1', date: '2026-08-23', attendeeIds: ['p1'], notes: '' }],
    } as unknown as AppData

    const data = normalizeData(current)
    expect(data.ratings).toEqual([])
    expect(data.meetings[0].attendeeIds).toEqual(['p1'])
  })

  it('migrates legacy rock/milestone completed booleans to status', () => {
    const legacy = {
      people: [],
      headlines: [],
      metrics: [],
      issues: [],
      meetings: [],
      rocks: [
        {
          id: 'r1',
          name: 'Ship v2',
          ownerId: 'p1',
          dueDate: '2026-09-30',
          completed: true,
          blocker: '',
          milestones: [
            { id: 'm1', name: 'Spec', ownerId: 'p1', done: true, dueDate: '' },
            { id: 'm2', name: 'Beta', ownerId: 'p1', done: false, dueDate: '' },
          ],
        },
      ],
    } as unknown as AppData

    const data = normalizeData(legacy)
    expect(data.rocks[0].status).toBe('completed')
    expect((data.rocks[0] as { completed?: unknown }).completed).toBeUndefined()
    expect(data.rocks[0].milestones[0].status).toBe('completed')
    expect(data.rocks[0].milestones[1].status).toBe('on_track')
    expect((data.rocks[0].milestones[0] as { done?: unknown }).done).toBeUndefined()
  })

  it('passes through current-shape rocks with an existing status', () => {
    const current = {
      people: [],
      headlines: [],
      metrics: [],
      issues: [],
      meetings: [],
      rocks: [
        {
          id: 'r1',
          name: 'Ship v2',
          ownerId: 'p1',
          dueDate: '2026-09-30',
          status: 'off_track',
          blocker: 'waiting on legal',
          milestones: [{ id: 'm1', name: 'Spec', ownerId: 'p1', status: 'off_track', dueDate: '' }],
        },
      ],
    } as unknown as AppData

    const data = normalizeData(current)
    expect(data.rocks[0].status).toBe('off_track')
    expect(data.rocks[0].blocker).toBe('waiting on legal')
    expect(data.rocks[0].milestones[0].status).toBe('off_track')
  })
})
