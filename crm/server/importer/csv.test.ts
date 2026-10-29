import { describe, expect, it } from 'vitest'
import { parseCsv, parseDate, parseMoney } from './csv.js'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n,,\r\n')
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2']])
  })
  it('strips a BOM', () => {
    expect(parseCsv('﻿name\nBob')).toEqual([['name'], ['Bob']])
  })
})

describe('parseMoney / parseDate', () => {
  it('money', () => {
    expect(parseMoney('$1,468,000')).toBe(1468000)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('(500)')).toBe(-500)
    expect(parseMoney('N/A')).toBeNull()
  })
  it('dates', () => {
    expect(parseDate('5/20/2026')).toBe('2026-05-20')
    expect(parseDate('12/01/26')).toBe('2026-12-01')
    expect(parseDate('2026-1-5')).toBe('2026-01-05')
    expect(parseDate('')).toBeNull()
    expect(parseDate('whenever')).toBeNull()
  })
})
