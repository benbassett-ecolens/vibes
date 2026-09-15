import { describe, expect, it } from 'vitest'
import { defaultSort, sortItems } from './sort'

interface Row {
  id: string
  name: string
  score: number | null
  done: boolean
}

const rows: Row[] = [
  { id: 'c', name: 'Charlie', score: 5, done: true },
  { id: 'a', name: 'alice', score: 20, done: false },
  { id: 'b', name: 'Bob', score: null, done: false },
]

const getValue = (r: Row, field: 'name' | 'score' | 'done') => r[field]

describe('sortItems', () => {
  it('returns the same array unchanged when no field is selected (default order)', () => {
    const result = sortItems(rows, defaultSort<'name' | 'score' | 'done'>(), getValue)
    expect(result).toBe(rows) // same reference — no copy, no reorder
  })

  it('sorts strings case-insensitively, ascending', () => {
    const result = sortItems(rows, { field: 'name', direction: 'asc' }, getValue)
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('reverses for descending', () => {
    const result = sortItems(rows, { field: 'name', direction: 'desc' }, getValue)
    expect(result.map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('sorts numbers, with nulls sorting last in ascending order (and so first once reversed)', () => {
    const asc = sortItems(rows, { field: 'score', direction: 'asc' }, getValue)
    expect(asc.map((r) => r.id)).toEqual(['c', 'a', 'b']) // 5, 20, null

    const desc = sortItems(rows, { field: 'score', direction: 'desc' }, getValue)
    expect(desc.map((r) => r.id)).toEqual(['b', 'a', 'c']) // reverse of asc: null, 20, 5
  })

  it('sorts booleans false-before-true', () => {
    const result = sortItems(rows, { field: 'done', direction: 'asc' }, getValue)
    expect(result[result.length - 1].id).toBe('c') // only `done: true` row sorts last
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortItems(rows, { field: 'name', direction: 'asc' }, getValue)
    expect(rows).toEqual(copy)
  })
})
