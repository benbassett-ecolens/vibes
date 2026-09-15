export type SortDirection = 'asc' | 'desc'

export interface SortState<F extends string> {
  field: F | null
  direction: SortDirection
}

export function defaultSort<F extends string>(): SortState<F> {
  return { field: null, direction: 'asc' }
}

/** Nulls/undefined sort last in ascending order; booleans compare false-before-true. */
function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Returns a sorted copy of `items`. When no field is selected, returns
 * `items` itself unchanged — so "Default order" preserves whatever order
 * the underlying list already has (insertion order, most-recent-first,
 * whatever), rather than imposing one.
 */
export function sortItems<T, F extends string>(
  items: T[],
  sort: SortState<F>,
  getValue: (item: T, field: F) => unknown,
): T[] {
  if (!sort.field) return items
  const field = sort.field
  const sorted = [...items].sort((a, b) => compareValues(getValue(a, field), getValue(b, field)))
  return sort.direction === 'desc' ? sorted.reverse() : sorted
}
