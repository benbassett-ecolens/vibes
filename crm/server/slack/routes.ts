import { Router } from 'express'
import express from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { one, pool, query, withTransaction } from '../db.js'
import { audit } from '../audit.js'
import { requireAuth } from '../auth.js'
import { forbidden, parse, wrap } from '../http.js'
import { crmUserForSlack, postTaskCard, slackCall, slackConfigured, slackUserIdFor, updateTaskCard, verifySlackSignature } from './client.js'
import type { SlackStatus } from '../../shared/types.js'

type RawReq = express.Request & { rawBody?: string }

const keepRaw = (req: RawReq, _res: express.Response, buf: Buffer) => {
  req.rawBody = buf.toString('utf8')
}

export const slackWebhookRouter = Router()
slackWebhookRouter.use(express.urlencoded({ extended: false, verify: keepRaw as never }))
slackWebhookRouter.use(express.json({ verify: keepRaw as never }))

function guard(req: RawReq): void {
  if (!slackConfigured()) throw forbidden('Slack is not configured')
  if (!verifySlackSignature(req.rawBody ?? '', req.headers['x-slack-request-timestamp'] as string | undefined, req.headers['x-slack-signature'] as string | undefined)) {
    throw forbidden('Bad Slack signature')
  }
}

/** Interactive components: "Mark done" / "Reopen" buttons on task cards. */
slackWebhookRouter.post(
  '/interactions',
  wrap(async (req, res) => {
    guard(req as RawReq)
    const payload = JSON.parse((req.body as { payload?: string }).payload ?? '{}') as {
      type: string
      user?: { id: string }
      actions?: Array<{ action_id: string; value?: string }>
    }
    res.status(200).end() // Slack wants an ack within 3s; we update the card via chat.update.
    if (payload.type !== 'block_actions') return
    const action = payload.actions?.[0]
    if (!action?.value || !payload.user) return
    const actor = await crmUserForSlack(payload.user.id)
    if (!actor) return
    if (action.action_id === 'task_done' || action.action_id === 'task_reopen') {
      const done = action.action_id === 'task_done'
      const before = await one<{ id: string; completed_at: string | null; subject: string; deal_id: string | null; type: string }>('SELECT id, completed_at, subject, deal_id, type FROM activities WHERE id = $1', [action.value])
      if (!before || before.type !== 'task') return
      if (done === !!before.completed_at) {
        await updateTaskCard(before.id, actor.name) // already in that state; just resync the card
        return
      }
      await withTransaction(async (client) => {
        await query('UPDATE activities SET completed_at = $2 WHERE id = $1', [before.id, done ? new Date().toISOString() : null], client)
        if (done && before.deal_id) await query('UPDATE deals SET last_activity_at = now() WHERE id = $1', [before.deal_id], client)
        await audit(client, { entityType: 'activity', entityId: before.id, action: done ? 'complete' : 'reopen', actorId: actor.id, changes: { completed_at: { from: before.completed_at, to: done ? 'now' : null }, via: 'slack' }, summary: `${done ? 'Completed' : 'Reopened'} task from Slack: ${before.subject}` })
      })
      await updateTaskCard(before.id, done ? actor.name : null)
    }
  }),
)

/** Slash command: /todo Send the proposal to Acme | 2026-11-03 14:00 */
slackWebhookRouter.post(
  '/commands',
  wrap(async (req, res) => {
    guard(req as RawReq)
    const body = req.body as { user_id: string; text?: string; command?: string }
    const actor = await crmUserForSlack(body.user_id)
    if (!actor) {
      res.json({ response_type: 'ephemeral', text: `I couldn't match your Slack account to a CRM user. Sign in to the CRM once with your @${config.allowedDomain} account first.` })
      return
    }
    const [rawSubject, rawDue] = (body.text ?? '').split('|').map((s) => s.trim())
    if (!rawSubject) {
      res.json({ response_type: 'ephemeral', text: 'Usage: `/todo <what> | <when>`  e.g. `/todo Send proposal to Acme | tomorrow 9am` or `| 2026-11-03`' })
      return
    }
    const due = parseWhen(rawDue)
    const a = (await one<{ id: string }>(
      `INSERT INTO activities (type, subject, owner_id, due_at, created_by) VALUES ('task', $1, $2, $3, $2) RETURNING id`,
      [rawSubject, actor.id, due],
    ))!
    await audit(pool, { entityType: 'activity', entityId: a.id, action: 'create', actorId: actor.id, changes: { type: 'task', subject: rawSubject, via: 'slack' }, summary: `Created task from Slack: ${rawSubject}` })
    await postTaskCard(a.id)
    res.json({ response_type: 'ephemeral', text: `Added to your CRM to-dos: *${rawSubject}*${due ? ` (due ${new Date(due).toLocaleString('en-US')})` : ''}. I've sent you the card as a DM. Attach it to a deal from the CRM's Tasks page.` })
  }),
)

/** Tiny natural-ish date parser for the slash command. Exported for tests. */
export function parseWhen(input: string | undefined, now = new Date()): string | null {
  if (!input) return null
  const s = input.toLowerCase().trim()
  const d = new Date(now)
  d.setSeconds(0, 0)
  const timeMatch = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  const applyTime = () => {
    if (timeMatch && (timeMatch[2] || timeMatch[3])) {
      let h = Number(timeMatch[1])
      if (timeMatch[3] === 'pm' && h < 12) h += 12
      if (timeMatch[3] === 'am' && h === 12) h = 0
      d.setHours(h, Number(timeMatch[2] ?? 0), 0, 0)
    } else d.setHours(9, 0, 0, 0)
  }
  const iso = s.match(/(\d{4}-\d{2}-\d{2})(?:[ t](\d{2}):(\d{2}))?/)
  if (iso) {
    const t = iso[2] ? new Date(`${iso[1]}T${iso[2]}:${iso[3]}:00`) : new Date(`${iso[1]}T09:00:00`)
    return Number.isNaN(t.getTime()) ? null : t.toISOString()
  }
  if (s.startsWith('today')) {
    applyTime()
    return d.toISOString()
  }
  if (s.startsWith('tomorrow')) {
    d.setDate(d.getDate() + 1)
    applyTime()
    return d.toISOString()
  }
  const inMatch = s.match(/^in (\d+) ?(h|hour|hours|d|day|days|w|week|weeks)$/)
  if (inMatch) {
    const n = Number(inMatch[1])
    const u = inMatch[2][0]
    if (u === 'h') d.setHours(d.getHours() + n)
    else if (u === 'd') d.setDate(d.getDate() + n)
    else d.setDate(d.getDate() + 7 * n)
    return d.toISOString()
  }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayIdx = days.findIndex((x) => s.startsWith(x) || s.startsWith(x.slice(0, 3)))
  if (dayIdx >= 0) {
    const delta = (dayIdx - d.getDay() + 7) % 7 || 7
    d.setDate(d.getDate() + delta)
    applyTime()
    return d.toISOString()
  }
  const t = new Date(input)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

// ---------- Session-protected status/link endpoints ----------

export const slackRouter = Router()
slackRouter.use(requireAuth)

slackRouter.get(
  '/status',
  wrap(async (req, res) => {
    const out: SlackStatus = { configured: slackConfigured(), me_linked: false, my_slack_user_id: null }
    const me = await one<{ slack_user_id: string | null }>('SELECT slack_user_id FROM users WHERE id = $1', [req.user.id])
    out.my_slack_user_id = me?.slack_user_id ?? null
    out.me_linked = !!me?.slack_user_id
    if (out.configured) {
      try {
        const t = await slackCall<{ team: string; user: string }>('auth.test', {})
        out.team_name = t.team
        out.bot_user = t.user
      } catch (e) {
        out.error = (e as Error).message
      }
    }
    res.json(out)
  }),
)

slackRouter.post(
  '/link',
  wrap(async (req, res) => {
    if (!slackConfigured()) throw forbidden('Slack is not configured')
    const body = parse(z.object({ slack_user_id: z.string().regex(/^[UW][A-Z0-9]{6,}$/).optional() }), req.body ?? {})
    if (body.slack_user_id) {
      // Manual link by member ID: verify the ID exists and belongs to a real, non-bot user.
      const info = await slackCall<{ user: { id: string; is_bot?: boolean; deleted?: boolean; profile?: { email?: string; real_name?: string } } }>('users.info', { user: body.slack_user_id })
      if (info.user.is_bot || info.user.deleted) throw forbidden('That Slack member ID is a bot or a deactivated account')
      const taken = await one<{ email: string }>('SELECT email FROM users WHERE slack_user_id = $1 AND id <> $2', [info.user.id, req.user.id])
      if (taken) throw forbidden(`That Slack account is already linked to ${taken.email}`)
      await query('UPDATE users SET slack_user_id = $2 WHERE id = $1', [req.user.id, info.user.id])
      await audit(pool, { entityType: 'user', entityId: req.user.id, action: 'update', actorId: req.user.id, changes: { slack_user_id: { from: null, to: info.user.id }, slack_email: info.user.profile?.email ?? null }, summary: `${req.user.name} linked Slack (${info.user.profile?.real_name ?? info.user.id})` })
      res.json({ slack_user_id: info.user.id, slack_email: info.user.profile?.email ?? null })
      return
    }
    const id = await slackUserIdFor(req.user.id)
    if (!id) throw forbidden(`No Slack user found with the email ${req.user.email}. Check the email on your Slack profile, or link by member ID.`)
    res.json({ slack_user_id: id })
  }),
)

slackRouter.delete(
  '/link',
  wrap(async (req, res) => {
    await query('UPDATE users SET slack_user_id = NULL WHERE id = $1', [req.user.id])
    res.json({ ok: true })
  }),
)

slackRouter.post(
  '/test',
  wrap(async (req, res) => {
    if (!slackConfigured()) throw forbidden('Slack is not configured')
    const id = await slackUserIdFor(req.user.id)
    if (!id) throw forbidden(`No Slack user found with the email ${req.user.email}`)
    await slackCall('chat.postMessage', { channel: id, text: `👋 Ecolens CRM is connected. Your tasks will show up here with a "Mark done" button.` })
    res.json({ ok: true })
  }),
)

/** Re-send cards for my open tasks (e.g. after linking Slack). */
slackRouter.post(
  '/resend',
  wrap(async (req, res) => {
    parse(z.object({}), req.body ?? {})
    const tasks = await query<{ id: string }>(`SELECT id FROM activities WHERE type = 'task' AND owner_id = $1 AND completed_at IS NULL AND slack_ts IS NULL ORDER BY due_at NULLS LAST LIMIT 50`, [req.user.id])
    for (const t of tasks) await postTaskCard(t.id)
    res.json({ sent: tasks.length })
  }),
)
