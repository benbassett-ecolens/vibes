import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { config } from '../config.js'
import { verifySlackSignature } from './client.js'
import { parseWhen } from './routes.js'

describe('verifySlackSignature', () => {
  it('accepts a correctly signed request inside the replay window and rejects others', () => {
    config.slackSigningSecret = 'shh'
    const ts = String(Math.floor(Date.now() / 1000))
    const body = 'payload=%7B%7D'
    const sig = `v0=${createHmac('sha256', 'shh').update(`v0:${ts}:${body}`).digest('hex')}`
    expect(verifySlackSignature(body, ts, sig)).toBe(true)
    expect(verifySlackSignature(body + 'x', ts, sig)).toBe(false)
    expect(verifySlackSignature(body, ts, sig.replace(/.$/, '0'))).toBe(false)
    expect(verifySlackSignature(body, String(Number(ts) - 1000), sig)).toBe(false)
  })
})

describe('parseWhen', () => {
  const now = new Date('2026-10-28T15:00:00') // Wednesday, local time
  it('handles iso, today/tomorrow with times, relative and weekday forms', () => {
    expect(parseWhen('2026-11-03', now)).toBe(new Date('2026-11-03T09:00:00').toISOString())
    expect(parseWhen('2026-11-03 14:30', now)).toBe(new Date('2026-11-03T14:30:00').toISOString())
    expect(parseWhen('tomorrow 9am', now)).toBe(new Date('2026-10-29T09:00:00').toISOString())
    expect(parseWhen('today 4:15pm', now)).toBe(new Date('2026-10-28T16:15:00').toISOString())
    expect(parseWhen('in 2 days', now)).toBe(new Date('2026-10-30T15:00:00').toISOString())
    expect(parseWhen('friday', now)).toBe(new Date('2026-10-30T09:00:00').toISOString())
    expect(parseWhen('wed', now)).toBe(new Date('2026-11-04T09:00:00').toISOString())
    expect(parseWhen(undefined, now)).toBeNull()
    expect(parseWhen('whenever', now)).toBeNull()
  })
})
