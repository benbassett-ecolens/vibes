/** Housekeeping run by the scheduled job: retention purges and Slack due-now nudges. */
import { config } from './config.js'
import { query } from './db.js'
import { slackCall, slackConfigured, slackSafe } from './slack/client.js'
import { createDueRenewals } from './routes/deals.js'
import { pickDeal } from './google/sync.js'

export async function runMaintenance(): Promise<{ audit_purged: number; unmatched_purged: number; nudged: number; renewals_created: number }> {
  const renewalsCreated = await createDueRenewals()
  // Activities logged against a contact before it had a company (or whose company gained a deal since):
  // attach them to the company and its best deal. Idempotent; covers contacts linked before this logic existed.
  await query(`UPDATE activities a SET company_id = c.company_id FROM contacts c WHERE a.contact_id = c.id AND a.company_id IS NULL AND c.company_id IS NOT NULL`)
  const orphans = await query<{ contact_id: string; company_id: string | null; email: string }>(
    `SELECT DISTINCT a.contact_id, c.company_id, COALESCE(c.email, '') AS email FROM activities a JOIN contacts c ON c.id = a.contact_id
     WHERE a.deal_id IS NULL AND a.source <> 'manual' AND c.company_id IS NOT NULL LIMIT 200`,
  )
  for (const o of orphans) {
    const deal = await pickDeal([{ id: o.contact_id, company_id: o.company_id, email: o.email }])
    if (!deal) continue
    await query(`UPDATE activities SET deal_id = $2 WHERE contact_id = $1 AND deal_id IS NULL AND source <> 'manual'`, [o.contact_id, deal.id])
    await query(`UPDATE deals SET last_activity_at = GREATEST(COALESCE(last_activity_at, to_timestamp(0)), (SELECT MAX(created_at) FROM activities WHERE deal_id = $1)) WHERE id = $1`, [deal.id])
  }
  // Runs that never finished (instance shut down mid-sync) must not look alive forever.
  await query(`UPDATE sync_runs SET status = 'error', finished_at = now(), error = 'Interrupted (server restarted); the next scheduled run will pick up where this left off'
               WHERE status = 'running' AND started_at < now() - interval '30 minutes'`)
  let auditPurged = 0
  if (config.auditRetentionMonths > 0) {
    const r = await query<{ id: number }>(`DELETE FROM audit_log WHERE created_at < now() - ($1 || ' months')::interval RETURNING id`, [String(config.auditRetentionMonths)])
    auditPurged = r.length
  }
  const u = await query<{ id: number }>(`DELETE FROM sync_unmatched WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`, [String(config.unmatchedRetentionDays)])

  // Nudge in the task's Slack thread when it becomes due (once).
  let nudged = 0
  if (slackConfigured()) {
    const due = await query<{ id: string; subject: string; slack_channel: string; slack_ts: string }>(
      `SELECT id, subject, slack_channel, slack_ts FROM activities
       WHERE type = 'task' AND completed_at IS NULL AND slack_ts IS NOT NULL AND due_at <= now() AND due_at > now() - interval '1 day'
         AND NOT (meta ? 'slack_nudged_at') LIMIT 100`,
    )
    for (const t of due) {
      slackSafe(slackCall('chat.postMessage', { channel: t.slack_channel, thread_ts: t.slack_ts, text: `⏰ Due now: *${t.subject}*` }))
      await query(`UPDATE activities SET meta = meta || jsonb_build_object('slack_nudged_at', now()::text) WHERE id = $1`, [t.id])
      nudged++
    }
  }
  return { audit_purged: auditPurged, unmatched_purged: u.length, nudged, renewals_created: renewalsCreated }
}
