import { describe, expect, it } from 'vitest'
import { cleanLogText, isLogEmail } from './index.js'
import { extractBody, listAttachments } from '../google/parse.js'

describe('email text log', () => {
  it('recognises the log address or a log: subject', () => {
    expect(isLogEmail({ to: [{ name: null, email: 'Log@ecolens.io' }], cc: [], subject: 'hi' }, 'log@ecolens.io')).toBe(true)
    expect(isLogEmail({ to: [{ name: null, email: 'me@ecolens.io' }], cc: [], subject: 'Log: Rockton' }, 'log@ecolens.io')).toBe(true)
    expect(isLogEmail({ to: [{ name: null, email: 'me@ecolens.io' }], cc: [], subject: 'SMS - Rockton' }, 'log@ecolens.io')).toBe(true)
    expect(isLogEmail({ to: [{ name: null, email: 'me@ecolens.io' }], cc: [], subject: 'Catalog: new' }, 'log@ecolens.io')).toBe(false)
  })
  it('strips the prefix, forwarded headers and phone signatures', () => {
    const r = cleanLogText('Fwd: log: Rockton – pricing', '---------- Forwarded message ---------\nFrom: John\nDate: Mon\nSubject: hi\n\nCan you send pricing?\nThanks\n\nSent from my iPhone\nthis should go')
    expect(r.subject).toBe('Rockton – pricing')
    expect(r.text).toBe('Can you send pricing?\nThanks')
  })
  it('reads plain text first, falls back to html, and lists attachments', () => {
    const m = { id: 'x', threadId: 't', payload: { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/html', body: { data: Buffer.from('<p>Hello<br>world</p>').toString('base64url') } },
      { mimeType: 'image/jpeg', filename: 'shot.jpg', body: { attachmentId: 'a1', size: 10 } },
    ] } }
    expect(extractBody(m).trim()).toBe('Hello\nworld')
    expect(listAttachments(m)).toEqual([{ attachment_id: 'a1', name: 'shot.jpg', mimetype: 'image/jpeg', size: 10 }])
  })
})
