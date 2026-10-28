import { OAuth2Client } from 'google-auth-library'
import { config } from '../config.js'
import { one, pool, query } from '../db.js'
import { decrypt, encrypt } from './crypto.js'
import { HttpError } from '../http.js'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const SCOPES = ['openid', 'email', GMAIL_SCOPE, CALENDAR_SCOPE]

export function syncConfigured(): boolean {
  return !!(config.googleClientId && config.googleClientSecret && config.appBaseUrl)
}

export function redirectUri(): string {
  return `${config.appBaseUrl}/api/google/callback`
}

export function oauthClient(): OAuth2Client {
  if (!syncConfigured()) throw new HttpError(503, 'Google sync is not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_BASE_URL)')
  return new OAuth2Client(config.googleClientId, config.googleClientSecret, redirectUri())
}

export interface ConnectionRow {
  user_id: string
  google_email: string
  refresh_token_enc: string
  scopes: string[]
  gmail_sync_window_days: number
  gmail_sync_enabled: boolean
  calendar_sync_enabled: boolean
  gmail_synced_through: string | null
  gmail_last_synced_at: string | null
  calendar_sync_token: string | null
  calendar_last_synced_at: string | null
  last_error: string | null
}

export async function loadConnection(userId: string): Promise<ConnectionRow | null> {
  return one<ConnectionRow>('SELECT * FROM google_connections WHERE user_id = $1', [userId])
}

export async function saveConnection(userId: string, googleEmail: string, refreshToken: string, scopes: string[]): Promise<void> {
  await query(
    `INSERT INTO google_connections (user_id, google_email, refresh_token_enc, scopes, last_error)
     VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (user_id) DO UPDATE SET google_email = EXCLUDED.google_email, refresh_token_enc = EXCLUDED.refresh_token_enc,
       scopes = EXCLUDED.scopes, last_error = NULL, calendar_sync_token = NULL`,
    [userId, googleEmail, encrypt(refreshToken), scopes],
  )
}

/**
 * Minimal Google REST client bound to one connection. google-auth-library handles
 * access-token refresh; we only ever send GETs to Gmail/Calendar.
 */
export type Params = Record<string, string | number | string[] | undefined>

export interface GoogleFetcher {
  get<T>(url: string, params?: Params): Promise<T>
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function fetcherFor(conn: ConnectionRow): GoogleFetcher {
  const client = oauthClient()
  client.setCredentials({ refresh_token: decrypt(conn.refresh_token_enc) })
  return {
    async get<T>(url: string, params: Params = {}): Promise<T> {
      const { token } = await client.getAccessToken()
      if (!token) throw new GoogleApiError(401, 'Could not obtain an access token; reconnect Google')
      const u = new URL(url)
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === '') continue
        for (const item of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(item))
      }
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(u, { headers: { Authorization: `Bearer ${token}` } })
        if (res.ok) return (await res.json()) as T
        const text = await res.text()
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
          continue
        }
        throw new GoogleApiError(res.status, `Google API ${res.status} for ${u.pathname}: ${text.slice(0, 300)}`)
      }
    },
  }
}

export async function revokeAndDelete(userId: string): Promise<void> {
  const conn = await loadConnection(userId)
  if (!conn) return
  try {
    await oauthClient().revokeToken(decrypt(conn.refresh_token_enc))
  } catch {
    /* token may already be revoked; still remove our copy */
  }
  await query('DELETE FROM google_connections WHERE user_id = $1', [userId])
}

export { pool }
