/** Pure helpers for turning Gmail / Calendar payloads into CRM shapes. Unit-tested. */
import type { EmailParty } from '../../shared/types.js'

/** Parse an RFC 5322 address list: `"Ann Lee" <ann@x.com>, bob@y.com`. */
export function parseAddressList(value: string | null | undefined): EmailParty[] {
  if (!value) return []
  const out: EmailParty[] = []
  // Split on commas that are not inside quotes or angle brackets.
  const parts: string[] = []
  let cur = ''
  let quoted = false
  let depth = 0
  for (const ch of value) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch === '<') depth++
    else if (!quoted && ch === '>') depth = Math.max(0, depth - 1)
    if (ch === ',' && !quoted && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  for (const raw of parts) {
    const part = raw.trim()
    if (!part) continue
    const m = part.match(/^(.*?)<([^>]+)>\s*$/)
    let name: string | null = null
    let email: string
    if (m) {
      name = m[1].trim().replace(/^"|"$/g, '').trim() || null
      email = m[2].trim()
    } else email = part.replace(/^<|>$/g, '').trim()
    email = email.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
    out.push({ name, email })
  }
  return out
}

export function domainOf(email: string): string {
  return email.toLowerCase().split('@')[1] ?? ''
}

/** Addresses that belong to the team's own domain (or Google system senders) are never contacts. */
export function isInternal(email: string, allowedDomain: string): boolean {
  const d = domainOf(email)
  if (d === allowedDomain.toLowerCase()) return true
  return /(^|\.)(google\.com|calendar-notification\.google\.com|docs\.google\.com|accounts\.google\.com)$/.test(d) || email.startsWith('noreply') || email.startsWith('no-reply')
}

export function uniqueExternal(parties: EmailParty[], allowedDomain: string): EmailParty[] {
  const seen = new Set<string>()
  const out: EmailParty[] = []
  for (const p of parties) {
    if (isInternal(p.email, allowedDomain) || seen.has(p.email)) continue
    seen.add(p.email)
    out.push(p)
  }
  return out
}

// ---------- Gmail ----------

export interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: { headers?: Array<{ name: string; value: string }> }
}

export interface ParsedEmail {
  gmail_id: string
  thread_id: string
  message_id: string // RFC Message-ID header, or gmail id as fallback
  subject: string
  snippet: string
  date: string // ISO
  from: EmailParty | null
  to: EmailParty[]
  cc: EmailParty[]
  direction: 'sent' | 'received'
  external: EmailParty[]
}

export function parseGmailMessage(m: GmailMessage, ownerEmail: string, allowedDomain: string): ParsedEmail {
  const h = (name: string) => m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())?.value ?? null
  const from = parseAddressList(h('From'))[0] ?? null
  const to = parseAddressList(h('To'))
  const cc = parseAddressList(h('Cc'))
  const date = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date(h('Date') ?? Date.now()).toISOString()
  const msgId = (h('Message-ID') ?? '').trim().replace(/^<|>$/g, '')
  const isSent = from?.email === ownerEmail.toLowerCase() || (m.labelIds ?? []).includes('SENT')
  return {
    gmail_id: m.id,
    thread_id: m.threadId,
    message_id: msgId || `gmail:${m.id}`,
    subject: (h('Subject') ?? '').trim() || '(no subject)',
    snippet: decodeEntities(m.snippet ?? ''),
    date,
    from,
    to,
    cc,
    direction: isSent ? 'sent' : 'received',
    external: uniqueExternal([...(from ? [from] : []), ...to, ...cc], allowedDomain),
  }
}

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

// ---------- Calendar ----------

export interface CalendarEvent {
  id: string
  iCalUID?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  hangoutLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean }>
  organizer?: { email?: string; displayName?: string }
  updated?: string
}

export interface ParsedEvent {
  event_id: string
  uid: string
  cancelled: boolean
  subject: string
  description: string | null
  location: string | null
  conference_url: string | null
  url: string | null
  starts_at: string | null
  ends_at: string | null
  all_day: boolean
  attendees: Array<EmailParty & { status?: string; organizer?: boolean }>
  external: EmailParty[]
}

export function parseCalendarEvent(e: CalendarEvent, allowedDomain: string): ParsedEvent {
  const toIso = (p?: { dateTime?: string; date?: string }, endOfDay = false): string | null => {
    if (!p) return null
    if (p.dateTime) return new Date(p.dateTime).toISOString()
    if (p.date) return new Date(`${p.date}T${endOfDay ? '23:59:59' : '09:00:00'}`).toISOString()
    return null
  }
  const attendees = (e.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) => ({ name: a.displayName ?? null, email: a.email!.toLowerCase(), status: a.responseStatus, organizer: a.organizer }))
  const organizer = e.organizer?.email ? [{ name: e.organizer.displayName ?? null, email: e.organizer.email.toLowerCase() }] : []
  return {
    event_id: e.id,
    uid: e.iCalUID || `gcal:${e.id}`,
    cancelled: e.status === 'cancelled',
    subject: (e.summary ?? '').trim() || '(no title)',
    description: e.description ? e.description.replace(/<[^>]+>/g, '').slice(0, 1000) : null,
    location: e.location ?? null,
    conference_url: e.hangoutLink ?? null,
    url: e.htmlLink ?? null,
    starts_at: toIso(e.start),
    ends_at: toIso(e.end, !e.end?.dateTime),
    all_day: !!e.start?.date,
    attendees,
    external: uniqueExternal([...attendees, ...organizer], allowedDomain),
  }
}
