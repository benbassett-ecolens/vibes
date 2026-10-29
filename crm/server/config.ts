import 'dotenv/config'

const env = process.env

function int(name: string, fallback: number): number {
  const v = env[name]
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${v}"`)
  return n
}

export const config = {
  port: int('PORT', 8080),
  isProduction: env.NODE_ENV === 'production',
  // Deployment label shown in the UI when it is not 'production' (e.g. 'staging').
  appEnv: env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'development'),
  databaseUrl: env.DATABASE_URL ?? '',
  cloudSql: {
    connectionName: env.CLOUD_SQL_CONNECTION_NAME ?? '',
    user: env.DB_USER ?? '',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME ?? 'crm',
  },
  googleClientId: env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
  // Public origin of the app, used to build the OAuth redirect URI.
  appBaseUrl: (env.APP_BASE_URL ?? '').replace(/\/$/, ''),
  // Key for encrypting Google refresh tokens at rest; falls back to SESSION_SECRET.
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY ?? env.SESSION_SECRET ?? '',
  // Shared secret for the scheduled /api/internal/sync endpoint (Cloud Scheduler).
  syncSecret: env.SYNC_SECRET ?? '',
  // Optional in-process sync timer (minutes). 0 = off; use Cloud Scheduler instead.
  syncIntervalMinutes: int('SYNC_INTERVAL_MINUTES', 0),
  // Google Calendar sync is off unless CALENDAR_SYNC=on (meetings were more noise than signal).
  calendarSyncEnabled: env.CALENDAR_SYNC === 'on',
  // Slack two-way task sync.
  slackBotToken: env.SLACK_BOT_TOKEN ?? '',
  slackSigningSecret: env.SLACK_SIGNING_SECRET ?? '',
  // Audit rows older than this are purged by the maintenance job. 0 = keep forever.
  auditRetentionMonths: int('AUDIT_RETENTION_MONTHS', 12),
  // Days after a won deal's contract start at which its renewal deal is created.
  renewalLeadDays: int('RENEWAL_LEAD_DAYS', 45),
  // Unmatched sync items older than this are purged.
  unmatchedRetentionDays: int('UNMATCHED_RETENTION_DAYS', 90),
  allowedDomain: (env.ALLOWED_DOMAIN ?? 'ecolens.io').toLowerCase(),
  adminEmails: (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  sessionSecret: env.SESSION_SECRET ?? '',
  sessionHours: int('SESSION_HOURS', 72),
  // Dev-only password-less login. Hard-off in production regardless of the flag.
  authDevMode: env.AUTH_DEV_MODE === 'true' && env.NODE_ENV !== 'production',
}

export function assertConfig(): void {
  const problems: string[] = []
  if (!config.sessionSecret || (config.isProduction && config.sessionSecret.length < 32)) {
    problems.push('SESSION_SECRET must be set (32+ chars in production)')
  }
  if (config.isProduction && !config.googleClientId) problems.push('GOOGLE_CLIENT_ID is required in production')
  if (!config.databaseUrl && !config.cloudSql.connectionName) {
    problems.push('Set DATABASE_URL or CLOUD_SQL_CONNECTION_NAME (+ DB_USER/DB_PASSWORD/DB_NAME)')
  }
  if (problems.length) throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`)
}
