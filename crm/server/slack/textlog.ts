/**
 * "Share a text to the CRM bot, tap the deal."
 *
 * A rep shares a text message (or a screenshot of one) from their phone into a DM with the bot.
 * We store it in slack_inbox, reply with the deal it most likely belongs to as buttons, and on a
 * tap create a `text` activity on that deal (downloading any screenshot into `attachments`).
 * Nothing is typed, nothing is double-entered: the only decision the rep makes is the deal.
 */
import { config } from '../config.js'
import { audit } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { slackCall, SlackError } from './client.js'

export interface InboxRow {
  id: string
  event_id: string | null
  user_id: string
  slack_user_id: string
  channel: string
  ts: string
  card_ts: string | null
  text: string
  files: InboxFile[]
  status: 'pending' | 'logged' | 'dismissed'
  activity_id: string | null
  created_at: string
}
export interface InboxFile {
  id: string
  name: string
  mimetype: string
  url_private: string
  size: number
}
export interface Candidate {
  id: string
  title: string
  company_name: string | null
  score: number
}

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024

/** The rep's open deals, best guess first: a company or contact named in the text wins, then most recently touched. */
export async function rankDeals(userId: string, text: string): Promise<Candidate[]> {
  return query<Candidate>(
    `SELECT d.id, d.title, co.name AS company_name,
       (CASE WHEN co.name IS NOT NULL AND length(co.name) >= 3 AND position(lower(co.name) IN lower($2)) > 0 THEN 2 ELSE 0 END
        + CASE WHEN ct.id IS NOT NULL AND length(ct.first_name) >= 3 AND position(lower(ct.first_name) IN lower($2)) > 0 THEN 1 ELSE 0 END
        + CASE WHEN ct.id IS NOT NULL AND length(coalesce(ct.last_name, '')) >= 3 AND position(lower(ct.last_name) IN lower($2)) > 0 THEN 1 ELSE 0 END)::int AS score
     FROM deals d
     JOIN stages s ON s.id = d.stage_id
     LEFT JOIN companies co ON co.id = d.company_id
     LEFT JOIN contacts ct ON ct.id = d.contact_id
     WHERE d.owner_id = $1 AND s.kind = 'open'
     ORDER BY 4 DESC, d.last_activity_at DESC NULLS LAST, d.created_at DESC
     LIMIT 100`,
    [userId, text || ''],
  )
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const label = (c: Candidate) => clip(c.company_name && c.company_name !== c.title ? `${c.title} · ${c.company_name}` : c.title, 75)

function preview(row: InboxRow): string {
  const t = row.text.trim()
  const files = row.files.length ? `📎 ${row.files.map((f) => f.name).join(', ')}` : ''
  if (!t) return files || '(empty message)'
  return `> ${clip(t, 400).replace(/\n/g, '\n> ')}${files ? `\n${files}` : ''}`
}

export function pickerBlocks(row: InboxRow, candidates: Candidate[]): unknown[] {
  const top = candidates.slice(0, 4)
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `${preview(row)}\n*Which deal is this about?*` } },
  ]
  if (!candidates.length) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `You have no open deals in the CRM. <${config.appBaseUrl}/deals|Create one>, then tap *Retry*.` }] })
    blocks.push({ type: 'actions', elements: [
      { type: 'button', text: { type: 'plain_text', text: 'Retry' }, action_id: 'log_change', value: row.id },
      { type: 'button', text: { type: 'plain_text', text: 'Not a deal' }, action_id: 'log_dismiss', value: row.id },
    ] })
    return blocks
  }
  blocks.push({
    type: 'actions',
    elements: top.map((c, i) => ({
      type: 'button',
      text: { type: 'plain_text', text: label(c) },
      ...(i === 0 && c.score > 0 ? { style: 'primary' } : {}),
      action_id: `log_pick_${i}`,
      value: `${row.id}:${c.id}`,
    })),
  })
  const rest: unknown[] = []
  if (candidates.length > top.length) {
    rest.push({
      type: 'static_select',
      placeholder: { type: 'plain_text', text: 'Another deal…' },
      action_id: 'log_select',
      options: candidates.map((c) => ({ text: { type: 'plain_text', text: label(c) }, value: `${row.id}:${c.id}` })),
    })
  }
  rest.push({ type: 'button', text: { type: 'plain_text', text: 'Not a deal' }, action_id: 'log_dismiss', value: row.id })
  blocks.push({ type: 'actions', elements: rest })
  return blocks
}

export function confirmBlocks(row: InboxRow, deal: { id: string; title: string }, byName: string | null): unknown[] {
  const link = `${config.appBaseUrl}/deals/${deal.id}`
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `${preview(row)}\n✅ Logged as a *text message* on <${link}|${deal.title}>${byName ? ` by ${byName}` : ''}` } },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Add follow-up' }, style: 'primary', action_id: 'log_followup', value: row.id },
        { type: 'button', text: { type: 'plain_text', text: 'Change deal' }, action_id: 'log_change', value: row.id },
        { type: 'button', text: { type: 'plain_text', text: 'Open in CRM' }, url: link, action_id: 'log_open' },
      ],
    },
  ]
}

export function dismissedBlocks(row: InboxRow): unknown[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `${preview(row)}\n_Not logged._` } },
    { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Undo' }, action_id: 'log_change', value: row.id }] },
  ]
}

export async function loadInbox(id: string): Promise<InboxRow | null> {
  return one<InboxRow>('SELECT * FROM slack_inbox WHERE id = $1', [id])
}

/** A DM arrived. Store it and reply with the deal picker. Returns the inbox row, or null when ignored. */
export async function receiveDm(opts: { eventId: string | null; userId: string; slackUserId: string; channel: string; ts: string; text: string; files: InboxFile[] }): Promise<InboxRow | null> {
  if (!opts.text.trim() && !opts.files.length) return null
  const row = await one<InboxRow>(
    `INSERT INTO slack_inbox (event_id, user_id, slack_user_id, channel, ts, text, files)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id) DO NOTHING RETURNING *`,
    [opts.eventId, opts.userId, opts.slackUserId, opts.channel, opts.ts, opts.text, JSON.stringify(opts.files)],
  )
  if (!row) return null // Slack retry of an event we already handled
  await postPicker(row)
  return row
}

export async function postPicker(row: InboxRow): Promise<void> {
  const candidates = await rankDeals(row.user_id, row.text)
  const blocks = pickerBlocks(row, candidates)
  if (row.card_ts) {
    await slackCall('chat.update', { channel: row.channel, ts: row.card_ts, text: 'Which deal is this about?', blocks })
  } else {
    const r = await slackCall<{ ts: string }>('chat.postMessage', { channel: row.channel, text: 'Which deal is this about?', blocks })
    await query('UPDATE slack_inbox SET card_ts = $2 WHERE id = $1', [row.id, r.ts])
  }
}

async function downloadFile(f: InboxFile): Promise<Buffer | null> {
  if (!f.url_private || f.size > MAX_ATTACHMENT_BYTES) return null
  const res = await fetch(f.url_private, { headers: { Authorization: `Bearer ${config.slackBotToken}` }, redirect: 'follow' })
  if (!res.ok) throw new SlackError(`Slack file download failed: ${res.status}`)
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('text/html')) throw new SlackError('Slack file download returned HTML; the bot token probably lacks the files:read scope')
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length > MAX_ATTACHMENT_BYTES ? null : buf
}

/**
 * Attach the DM to a deal: create the `text` activity (or move an already-logged one), pull
 * screenshots into `attachments`, bump the deal's last activity, write the audit entry, update the card.
 */
export async function logInbox(inboxId: string, dealId: string, actor: { id: string; name: string }): Promise<{ activityId: string; deal: { id: string; title: string } }> {
  const row = await loadInbox(inboxId)
  if (!row) throw new SlackError('That message is no longer in the inbox')
  const deal = await one<{ id: string; title: string; company_id: string | null; contact_id: string | null }>('SELECT id, title, company_id, contact_id FROM deals WHERE id = $1', [dealId])
  if (!deal) throw new SlackError('That deal no longer exists')
  const subject = row.text.trim() ? clip(row.text.trim().replace(/\s+/g, ' '), 120) : `Text message${row.files.length ? ' (screenshot)' : ''}`

  const activityId = await withTransaction(async (client) => {
    let id = row.activity_id
    if (id && row.status === 'logged') {
      const before = await one<{ deal_id: string | null }>('SELECT deal_id FROM activities WHERE id = $1', [id], client)
      await query('UPDATE activities SET deal_id = $2, company_id = $3, contact_id = $4 WHERE id = $1', [id, deal.id, deal.company_id, deal.contact_id], client)
      await audit(client, { entityType: 'activity', entityId: id, action: 'update', actorId: actor.id, changes: { deal_id: { from: before?.deal_id ?? null, to: deal.id }, via: 'slack' }, summary: `Moved text message to ${deal.title}` })
    } else {
      const a = (await one<{ id: string }>(
        `INSERT INTO activities (type, subject, body, deal_id, contact_id, company_id, owner_id, completed_at, created_by, source, external_id, meta)
         VALUES ('text', $1, $2, $3, $4, $5, $6, now(), $6, 'slack', $7, $8) RETURNING id`,
        [subject, row.text.trim() || null, deal.id, deal.contact_id, deal.company_id, actor.id, `${row.channel}/${row.ts}`, JSON.stringify({ slack_channel: row.channel, slack_ts: row.ts })],
        client,
      ))!
      id = a.id
      for (const f of row.files) {
        try {
          const data = await downloadFile(f)
          if (!data) continue
          await query('INSERT INTO attachments (activity_id, filename, mimetype, size, data) VALUES ($1, $2, $3, $4, $5)', [id, f.name || 'attachment', f.mimetype || 'application/octet-stream', data.length, data], client)
        } catch (e) {
          console.warn('slack textlog: attachment skipped:', (e as Error).message)
        }
      }
      await audit(client, { entityType: 'activity', entityId: id, action: 'create', actorId: actor.id, changes: { type: 'text', subject, deal_id: deal.id, attachments: row.files.length, via: 'slack' }, summary: `Logged text message on ${deal.title}` })
    }
    await query('UPDATE deals SET last_activity_at = now() WHERE id = $1', [deal.id], client)
    await query(`UPDATE slack_inbox SET status = 'logged', activity_id = $2 WHERE id = $1`, [row.id, id], client)
    return id!
  })

  if (row.card_ts) {
    await slackCall('chat.update', { channel: row.channel, ts: row.card_ts, text: `Logged on ${deal.title}`, blocks: confirmBlocks({ ...row, status: 'logged', activity_id: activityId }, deal, null) }).catch((e) => console.warn('slack textlog: card update failed:', (e as Error).message))
  }
  return { activityId, deal: { id: deal.id, title: deal.title } }
}

export async function dismissInbox(inboxId: string, actor: { id: string }): Promise<void> {
  const row = await loadInbox(inboxId)
  if (!row) return
  await withTransaction(async (client) => {
    if (row.activity_id && row.status === 'logged') {
      await query('DELETE FROM activities WHERE id = $1', [row.activity_id], client)
      await audit(client, { entityType: 'activity', entityId: row.activity_id, action: 'delete', actorId: actor.id, changes: { via: 'slack' }, summary: 'Removed a logged text message (marked "not a deal" in Slack)' })
    }
    await query(`UPDATE slack_inbox SET status = 'dismissed', activity_id = NULL WHERE id = $1`, [row.id], client)
  })
  if (row.card_ts) await slackCall('chat.update', { channel: row.channel, ts: row.card_ts, text: 'Not logged', blocks: dismissedBlocks(row) }).catch(() => undefined)
}

/** Back to the picker (Change deal / Undo / Retry). */
export async function reopenInbox(inboxId: string): Promise<void> {
  const row = await loadInbox(inboxId)
  if (!row) return
  if (row.status === 'dismissed') await query(`UPDATE slack_inbox SET status = 'pending' WHERE id = $1`, [row.id])
  await postPicker({ ...row, status: row.status === 'dismissed' ? 'pending' : row.status })
}

/** The "Add follow-up" modal. */
export function followupView(inboxId: string, dealTitle: string): unknown {
  return {
    type: 'modal',
    callback_id: 'log_followup_submit',
    private_metadata: inboxId,
    title: { type: 'plain_text', text: 'Add follow-up' },
    submit: { type: 'plain_text', text: 'Add to-do' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Deal: *${clip(dealTitle, 100)}*` }] },
      { type: 'input', block_id: 'what', label: { type: 'plain_text', text: 'What' }, element: { type: 'plain_text_input', action_id: 'v', placeholder: { type: 'plain_text', text: 'Send pricing' } } },
      { type: 'input', block_id: 'when', optional: true, label: { type: 'plain_text', text: 'When' }, hint: { type: 'plain_text', text: 'tomorrow 9am · friday · 2026-11-14' }, element: { type: 'plain_text_input', action_id: 'v', placeholder: { type: 'plain_text', text: 'tomorrow 9am' } } },
    ],
  }
}

