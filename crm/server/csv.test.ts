import { describe, expect, it } from 'vitest'
import { toCsv } from './csv.js'

describe('toCsv', () => {
  it('quotes commas, quotes and newlines', () => {
    const out = toCsv([{ a: 'x,y', b: 'he said "hi"', c: 'line1\nline2' }], ['a', 'b', 'c'])
    expect(out).toBe('a,b,c\r\n"x,y","he said ""hi""","line1\nline2"\r\n')
  })
  it('renders null as empty and defuses formulas', () => {
    expect(toCsv([{ a: null, b: '=SUM(A1)' }], ['a', 'b'])).toBe("a,b\r\n,'=SUM(A1)\r\n")
  })
})
