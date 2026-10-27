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
  databaseUrl: env.DATABASE_URL ?? '',
  cloudSql: {
    connectionName: env.CLOUD_SQL_CONNECTION_NAME ?? '',
    user: env.DB_USER ?? '',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_NAME ?? 'crm',
  },
  googleClientId: env.GOOGLE_CLIENT_ID ?? '',
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
