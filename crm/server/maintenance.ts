/** Housekeeping run by the scheduled job: retention purges and Slack due-now nudges. */
import { config } from './config.js'
import { query } from './db.js'
import { slackCall, slackConfigured, slackSafe } from './slack/client.js'
import { createDueRenewals } from './routes/deals.js'

export async function runMaintenance(): Promise<{ audit_purged: number; unmatched_purged: number; nudged: number; renewals_created: number }> {
  const renewalsCreated = await createDueRenewals()
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
