import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { one, query } from '../db.js'
import type { Activity } from '../../shared/types.js'

export function slackConfigured(): boolean {
  return !!(config.slackBotToken && config.slackSigningSecret)
}

export class SlackError extends Error {}

export async function slackCall<T = Record<string, unknown>>(method: string, body: Record<string, unknown>): Promise<T & { ok: boolean }> {
  if (!config.slackBotToken) throw new SlackError('SLACK_BOT_TOKEN is not configured')
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${config.slackBotToken}` },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & { ok: boolean; error?: string }
  if (!data.ok) throw new SlackError(`Slack ${method}: ${data.error ?? res.status}`)
  return data
}

/** Slack request signing (v0). Needs the raw body. */
export function verifySlackSignature(rawBody: string, timestamp: string | undefined, signature: string | undefined, now = Date.now()): boolean {
  if (!config.slackSigningSecret || !timestamp || !signature) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > 60 * 5) return false // replay window
  const base = `v0:${timestamp}:${rawBody}`
  const expected = `v0=${createHmac('sha256', config.slackSigningSecret).update(base).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** CRM user -> Slack user id, cached on users.slack_user_id. */
export async function slackUserIdFor(userId: string): Promise<string | null> {
  const u = await one<{ email: string; slack_user_id: string | null }>('SELECT email, slack_user_id FROM users WHERE id = $1', [userId])
  if (!u) return null
  if (u.slack_user_id) return u.slack_user_id
  try {
    const r = await slackCall<{ user: { id: string } }>('users.lookupByEmail', { email: u.email })
    await query('UPDATE users SET slack_user_id = $2 WHERE id = $1', [userId, r.user.id])
    return r.user.id
  } catch {
    return null
  }
}

/** Slack user id -> CRM user (by cached id, else by the Slack profile email). */
export async function crmUserForSlack(slackUserId: string): Promise<{ id: string; name: string; email: string } | null> {
  const cached = await one<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE slack_user_id = $1 AND is_active', [slackUserId])
  if (cached) return cached
  const info = await slackCall<{ user: { profile?: { email?: string } } }>('users.info', { user: slackUserId })
  const email = info.user.profile?.email?.toLowerCase()
  if (!email || !email.endsWith(`@${config.allowedDomain}`)) return null
  const u = await one<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users WHERE email = $1 AND is_active', [email])
  if (u) await query('UPDATE users SET slack_user_id = $2 WHERE id = $1', [u.id, slackUserId])
  return u
}

// ---------- Task cards ----------

function fmtDue(iso: string | null): string {
  if (!iso) return 'no due date'
  const t = Math.floor(new Date(iso).getTime() / 1000)
  return `<!date^${t}^{date_short} at {time}|${iso}>`
}

export function taskBlocks(a: Activity, opts: { done: boolean; doneBy?: string | null }): unknown[] {
  const link = `${config.appBaseUrl}/deals/${a.deal_id}`
  const context = [a.deal_title ? `*Deal:* ${a.deal_id ? `<${link}|${a.deal_title}>` : a.deal_title}` : null, a.contact_name ? `*Contact:* ${a.contact_name}` : null, a.company_name ? `*Company:* ${a.company_name}` : null]
    .filter(Boolean)
    .join('   ')
  const head = opts.done ? `~${a.subject}~  ✅ *Done*${opts.doneBy ? ` by ${opts.doneBy}` : ''}` : `☐ *${a.subject}*`
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `${head}\n${opts.done ? '' : `Due ${fmtDue(a.due_at)}`}${a.body ? `\n${a.body.slice(0, 500)}` : ''}` } },
  ]
  if (context) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: context }] })
  blocks.push({
    type: 'actions',
    elements: opts.done
      ? [{ type: 'button', text: { type: 'plain_text', text: 'Reopen' }, action_id: 'task_reopen', value: a.id }]
      : [
          { type: 'button', text: { type: 'plain_text', text: 'Mark done' }, style: 'primary', action_id: 'task_done', value: a.id },
          ...(a.deal_id ? [{ type: 'button', text: { type: 'plain_text', text: 'Open in CRM' }, url: link, action_id: 'task_open' }] : []),
        ],
  })
  return blocks
}

export async function loadActivity(id: string): Promise<Activity | null> {
  return one<Activity>(
    `SELECT a.*, d.title AS deal_title, co.name AS company_name, o.name AS owner_name,
       NULLIF(TRIM(CONCAT(ct.first_name, ' ', ct.last_name)), '') AS contact_name
     FROM activities a LEFT JOIN deals d ON d.id = a.deal_id LEFT JOIN companies co ON co.id = a.company_id
     LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN users o ON o.id = a.owner_id WHERE a.id = $1`,
    [id],
  )
}

/** Post (or re-post) the task card as a DM to the assignee. */
export async function postTaskCard(activityId: string): Promise<void> {
  if (!slackConfigured()) return
  const a = await loadActivity(activityId)
  if (!a || a.type !== 'task' || !a.owner_id) return
  const slackUser = await slackUserIdFor(a.owner_id)
  if (!slackUser) return
  const r = await slackCall<{ channel: string; ts: string }>('chat.postMessage', {
    channel: slackUser,
    text: `To-do: ${a.subject}${a.due_at ? ` (due ${new Date(a.due_at).toLocaleString('en-US')})` : ''}`,
    blocks: taskBlocks(a, { done: !!a.completed_at }),
  })
  await query('UPDATE activities SET slack_channel = $2, slack_ts = $3 WHERE id = $1', [a.id, r.channel, r.ts])
}

export async function updateTaskCard(activityId: string, doneBy?: string | null): Promise<void> {
  if (!slackConfigured()) return
  const a = await loadActivity(activityId)
  if (!a || a.type !== 'task') return
  if (!a.slack_ts || !a.slack_channel) {
    if (a.owner_id && !a.completed_at) await postTaskCard(a.id)
    return
  }
  await slackCall('chat.update', {
    channel: a.slack_channel,
    ts: a.slack_ts,
    text: `${a.completed_at ? 'Done' : 'To-do'}: ${a.subject}`,
    blocks: taskBlocks(a, { done: !!a.completed_at, doneBy }),
  })
}

export async function deleteTaskCard(a: Pick<Activity, 'slack_channel' | 'slack_ts'>): Promise<void> {
  if (!slackConfigured() || !a.slack_ts || !a.slack_channel) return
  try {
    await slackCall('chat.delete', { channel: a.slack_channel, ts: a.slack_ts })
  } catch {
    /* already gone */
  }
}

/** Fire-and-forget wrapper so Slack problems never fail a CRM request. */
export function slackSafe(p: Promise<unknown>): void {
  p.catch((e) => console.warn('slack:', (e as Error).message))
}
