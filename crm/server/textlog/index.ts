/**
 * Text messages logged by email.
 *
 * Reps share a text (or a screenshot of one) from their phone to Mail, addressed to the log address
 * (LOG_INBOX_ADDRESS, default crmlog@<domain>), or put "log:" at the start of the subject. The Gmail sync
 * sees the sent copy in their own mailbox, pulls the full body, and attaches it to the deal named in the
 * subject or body. Anything it cannot place waits in Settings → "Text messages emailed in".
 */
import { config } from '../config.js'
import { audit } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { HttpError } from '../http.js'
import { fetcherFor, loadConnection, type GoogleFetcher } from '../google/client.js'
import { extractBody, listAttachments, type GmailMessage, type ParsedEmail } from '../google/parse.js'

export interface Candidate {
  id: string
  title: string
  company_name: string | null
  score: number
}
export interface InboxFile {
  attachment_id: string
  name: string
  mimetype: string
  size: number
}
export interface InboxRow {
  id: string
  user_id: string
  external_id: string
  gmail_id: string
  subject: string | null
  text: string
  files: InboxFile[]
  received_at: string
  status: 'pending' | 'logged' | 'dismissed'
  activity_id: string | null
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

export function logAddress(): string {
  return (config.logInboxAddress || `crmlog@${config.allowedDomain}`).toLowerCase()
}

/** Addressed to the log address, or subject starts with "log:" / "log -" / "log –". */
export function isLogEmail(email: Pick<ParsedEmail, 'to' | 'cc' | 'subject'>, address = logAddress()): boolean {
  if ([...email.to, ...email.cc].some((p) => p.email.toLowerCase() === address)) return true
  return /^\s*(log|text|sms)\s*[:\-–—]/i.test(email.subject)
}

/** Strip the subject prefix and phone/mail boilerplate so what is left is the message itself. */
export function cleanLogText(subject: string, body: string): { subject: string; text: string } {
  let subj = subject.trim()
  for (let i = 0; i < 4; i++) subj = subj.replace(/^\s*(fwd?|fw|re)\s*:\s*/i, '').replace(/^\s*(log|text|sms)\s*[:\-–—]\s*/i, '').trim()
  const lines = body.replace(/\r/g, '').split('\n')
  const out: string[] = []
  for (const raw of lines) {
    const l = raw.trimEnd()
    if (/^(sent from my|get outlook for|sent via|-- ?$|__+$)/i.test(l.trim())) break
    if (/^-+ ?forwarded message ?-+$/i.test(l.trim())) continue
    if (/^(from|to|date|subject|sent):\s/i.test(l) && out.length < 6) continue // forwarded headers at the top
    out.push(l)
  }
  return { subject: subj, text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}

/** The rep's open deals, best guess first: a company or contact named in the text wins, then most recently touched. */
export async function rankDeals(userId: string, text: string): Promise<Candidate[]> {
  return query<Candidate>(
    `SELECT d.id, d.title, co.name AS company_name,
       (CASE WHEN co.name IS NOT NULL AND length(co.name) >= 3 AND position(lower(co.name) IN lower($2)) > 0 THEN 2 ELSE 0 END
        + CASE WHEN length(d.title) >= 3 AND position(lower(d.title) IN lower($2)) > 0 THEN 2 ELSE 0 END
        + CASE WHEN ct.id IS NOT NULL AND length(ct.first_name) >= 3 AND position(lower(ct.first_name) IN lower($2)) > 0 THEN 1 ELSE 0 END
        + CASE WHEN ct.id IS NOT NULL AND length(coalesce(ct.last_name, '')) >= 3 AND position(lower(ct.last_name) IN lower($2)) > 0 THEN 1 ELSE 0 END)::int AS score
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN contacts ct ON ct.id = d.contact_id
     WHERE d.owner_id = $1 AND d.archived_at IS NULL AND s.kind = 'open'
     ORDER BY 4 DESC, d.last_activity_at DESC NULLS LAST, d.created_at DESC
     LIMIT 100`,
    [userId, text || ''],
  )
}

async function downloadAttachment(api: GoogleFetcher, gmailId: string, f: InboxFile): Promise<Buffer | null> {
  if (f.size > MAX_ATTACHMENT_BYTES) return null
  const r = await api.get<{ data?: string; size?: number }>(`${GMAIL}/messages/${gmailId}/attachments/${f.attachment_id}`)
  if (!r.data) return null
  const buf = Buffer.from(r.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return buf.length > MAX_ATTACHMENT_BYTES ? null : buf
}

/** Create the `text` activity on a deal (or move an already-logged one), pulling screenshots in. */
export async function attachToDeal(row: InboxRow, dealId: string, actorId: string, api: GoogleFetcher | null): Promise<string> {
  const deal = await one<{ id: string; title: string; company_id: string | null; contact_id: string | null }>('SELECT id, title, company_id, contact_id FROM deals WHERE id = $1', [dealId])
  if (!deal) throw new HttpError(404, 'That deal no longer exists')
  const subject = row.subject?.trim() || (row.text.trim() ? row.text.trim().replace(/\s+/g, ' ').slice(0, 120) : `Text message${row.files.length ? ' (screenshot)' : ''}`)
  return withTransaction(async (client) => {
    let id = row.activity_id
    if (id && row.status === 'logged') {
      const before = await one<{ deal_id: string | null }>('SELECT deal_id FROM activities WHERE id = $1', [id], client)
      await query('UPDATE activities SET deal_id = $2, company_id = $3, contact_id = $4 WHERE id = $1', [id, deal.id, deal.company_id, deal.contact_id], client)
      await audit(client, { entityType: 'activity', entityId: id, action: 'update', actorId, changes: { deal_id: { from: before?.deal_id ?? null, to: deal.id }, via: 'email' }, summary: `Moved text message to ${deal.title}` })
    } else {
      const a = (await one<{ id: string }>(
        `INSERT INTO activities (type, subject, body, deal_id, contact_id, company_id, owner_id, completed_at, created_by, created_at, source, external_id, meta)
         VALUES ('text', $1, $2, $3, $4, $5, $6, $7, $6, $7, 'gmail', $8, $9)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET deal_id = EXCLUDED.deal_id RETURNING id`,
        [subject, row.text.trim() || null, deal.id, deal.contact_id, deal.company_id, row.user_id, row.received_at, row.external_id, JSON.stringify({ gmail_id: row.gmail_id, log_email: true, synced_by: row.user_id })],
        client,
      ))!
      id = a.id
      if (api) {
        for (const f of row.files) {
          try {
            const data = await downloadAttachment(api, row.gmail_id, f)
            if (!data) continue
            await query('INSERT INTO attachments (activity_id, filename, mimetype, size, data) VALUES ($1, $2, $3, $4, $5)', [id, f.name || 'attachment', f.mimetype || 'application/octet-stream', data.length, data], client)
          } catch (e) {
            console.warn('textlog: attachment skipped:', (e as Error).message)
          }
        }
      }
      await audit(client, { entityType: 'activity', entityId: id, action: 'create', actorId, changes: { type: 'text', subject, deal_id: deal.id, attachments: row.files.length, via: 'email' }, summary: `Logged text message on ${deal.title}` })
    }
    await query('UPDATE deals SET last_activity_at = GREATEST(COALESCE(last_activity_at, $2), $2) WHERE id = $1', [deal.id, row.received_at], client)
    await query(`UPDATE log_inbox SET status = 'logged', activity_id = $2 WHERE id = $1`, [row.id, id], client)
    return id!
  })
}

/**
 * Called by the Gmail sync for each log email. Fetches the full body, cleans it, stores it in log_inbox and,
 * when a company/contact/deal is named in the subject or text, attaches it to that deal straight away.
 */
export async function processLogEmail(userId: string, api: GoogleFetcher, parsed: ParsedEmail): Promise<'logged' | 'pending' | 'skipped'> {
  const full = await api.get<GmailMessage>(`${GMAIL}/messages/${parsed.gmail_id}`, { format: 'full' })
  const { subject, text } = cleanLogText(parsed.subject, extractBody(full))
  const files: InboxFile[] = listAttachments(full).filter((f) => /^image\//.test(f.mimetype) || f.mimetype === 'application/pdf')
  if (!text && !files.length) return 'skipped'
  const row = await one<InboxRow>(
    `INSERT INTO log_inbox (user_id, external_id, gmail_id, subject, text, files, received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (external_id) DO NOTHING RETURNING *`,
    [userId, parsed.message_id, parsed.gmail_id, subject || null, text, JSON.stringify(files), parsed.date],
  )
  if (!row) return 'skipped'
  const best = (await rankDeals(userId, `${subject}\n${text}`))[0]
  if (best && best.score > 0) {
    await attachToDeal(row, best.id, userId, api)
    return 'logged'
  }
  return 'pending'
}

export async function loadInbox(id: string): Promise<InboxRow | null> {
  return one<InboxRow>('SELECT * FROM log_inbox WHERE id = $1', [id])
}

export async function logInboxItem(row: InboxRow, dealId: string, actorId: string): Promise<string> {
  const conn = await loadConnection(row.user_id)
  return attachToDeal(row, dealId, actorId, conn ? fetcherFor(conn) : null)
}

export async function dismissInboxItem(row: InboxRow, actorId: string): Promise<void> {
  await withTransaction(async (client) => {
    if (row.activity_id && row.status === 'logged') {
      await query('DELETE FROM activities WHERE id = $1', [row.activity_id], client)
      await audit(client, { entityType: 'activity', entityId: row.activity_id, action: 'delete', actorId, changes: { via: 'email' }, summary: 'Removed a logged text message (marked "not a deal")' })
    }
    await query(`UPDATE log_inbox SET status = 'dismissed', activity_id = NULL WHERE id = $1`, [row.id], client)
  })
}
