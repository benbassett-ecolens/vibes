import { describe, expect, it } from 'vitest'
import { isInternal, parseAddressList, parseCalendarEvent, parseGmailMessage, uniqueExternal } from './parse.js'

describe('parseAddressList', () => {
  it('handles names, quotes, bare addresses and commas inside quotes', () => {
    expect(parseAddressList('"Lee, Ann" <Ann@X.com>, bob@y.com , Carl <carl@z.io>')).toEqual([
      { name: 'Lee, Ann', email: 'ann@x.com' },
      { name: null, email: 'bob@y.com' },
      { name: 'Carl', email: 'carl@z.io' },
    ])
  })
  it('drops junk', () => {
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([])
    expect(parseAddressList(null)).toEqual([])
  })
})

describe('isInternal / uniqueExternal', () => {
  it('excludes the team domain and Google system senders', () => {
    expect(isInternal('ben@ecolens.io', 'ecolens.io')).toBe(true)
    expect(isInternal('calendar-notification@google.com', 'ecolens.io')).toBe(true)
    expect(isInternal('noreply@somesaas.com', 'ecolens.io')).toBe(true)
    expect(isInternal('ann@customer.com', 'ecolens.io')).toBe(false)
  })
  it('dedupes', () => {
    expect(uniqueExternal([{ name: null, email: 'a@c.com' }, { name: 'A', email: 'a@c.com' }, { name: null, email: 'me@ecolens.io' }], 'ecolens.io')).toEqual([{ name: null, email: 'a@c.com' }])
  })
})

describe('parseGmailMessage', () => {
  const msg = {
    id: 'g1',
    threadId: 't1',
    labelIds: ['INBOX'],
    snippet: 'Thanks for the proposal &amp; pricing',
    internalDate: '1761600000000',
    payload: {
      headers: [
        { name: 'From', value: 'Ann Lee <ann@customer.com>' },
        { name: 'To', value: 'Ben <ben@ecolens.io>' },
        { name: 'Cc', value: 'bob@customer.com' },
        { name: 'Subject', value: 'Re: Proposal' },
        { name: 'Message-ID', value: '<abc@mail.customer.com>' },
      ],
    },
  }
  it('extracts parties, direction and external addresses', () => {
    const p = parseGmailMessage(msg, 'ben@ecolens.io', 'ecolens.io')
    expect(p.direction).toBe('received')
    expect(p.message_id).toBe('abc@mail.customer.com')
    expect(p.subject).toBe('Re: Proposal')
    expect(p.snippet).toBe('Thanks for the proposal & pricing')
    expect(p.external.map((e) => e.email)).toEqual(['ann@customer.com', 'bob@customer.com'])
    expect(p.date).toBe('2025-10-27T21:20:00.000Z')
  })
  it('marks mail from the owner as sent and falls back to the gmail id', () => {
    const p = parseGmailMessage({ ...msg, payload: { headers: [{ name: 'From', value: 'ben@ecolens.io' }, { name: 'To', value: 'ann@customer.com' }] } }, 'ben@ecolens.io', 'ecolens.io')
    expect(p.direction).toBe('sent')
    expect(p.message_id).toBe('gmail:g1')
    expect(p.subject).toBe('(no subject)')
  })
})

describe('parseCalendarEvent', () => {
  it('maps a timed event', () => {
    const ev = parseCalendarEvent(
      {
        id: 'e1',
        iCalUID: 'uid1@google.com',
        status: 'confirmed',
        summary: 'Discovery call',
        description: '<b>Agenda</b> intro',
        htmlLink: 'https://calendar.google.com/event?eid=1',
        hangoutLink: 'https://meet.google.com/abc',
        start: { dateTime: '2026-11-01T10:00:00-07:00' },
        end: { dateTime: '2026-11-01T10:30:00-07:00' },
        attendees: [
          { email: 'ben@ecolens.io', self: true, responseStatus: 'accepted' },
          { email: 'Ann@customer.com', displayName: 'Ann', responseStatus: 'needsAction' },
          { email: 'room@resource.calendar.google.com', resource: true },
        ],
        organizer: { email: 'ben@ecolens.io' },
      },
      'ecolens.io',
    )
    expect(ev.uid).toBe('uid1@google.com')
    expect(ev.starts_at).toBe('2026-11-01T17:00:00.000Z')
    expect(ev.ends_at).toBe('2026-11-01T17:30:00.000Z')
    expect(ev.description).toBe('Agenda intro')
    expect(ev.external).toEqual([{ name: 'Ann', email: 'ann@customer.com', status: 'needsAction', organizer: undefined }])
    expect(ev.cancelled).toBe(false)
  })
  it('handles all-day and cancelled events', () => {
    const ev = parseCalendarEvent({ id: 'e2', status: 'cancelled', start: { date: '2026-11-02' }, end: { date: '2026-11-03' } }, 'ecolens.io')
    expect(ev.cancelled).toBe(true)
    expect(ev.all_day).toBe(true)
    expect(ev.uid).toBe('gcal:e2')
    expect(ev.subject).toBe('(no title)')
  })
})
