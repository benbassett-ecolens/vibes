import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { config } from './config.js'
import { one, pool } from './db.js'
import { audit } from './audit.js'
import { HttpError, forbidden } from './http.js'
import type { User } from '../shared/types.js'

export const SESSION_COOKIE = 'crm_session'

declare module 'express-serve-static-core' {
  interface Request {
    user: User
  }
}

// ---------- Session token: base64url(json).base64url(hmac) ----------

interface SessionPayload {
  uid: string
  exp: number // unix seconds
}

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url')

export function signSession(payload: SessionPayload, secret = config.sessionSecret): string {
  const body = b64u(JSON.stringify(payload))
  const mac = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifySession(token: string | undefined, secret = config.sessionSecret, now = Date.now()): SessionPayload | null {
  if (!token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (typeof payload.uid !== 'string' || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < now) return null
    return payload
  } catch {
    return null
  }
}

export function setSessionCookie(res: Response, userId: string): void {
  const exp = Math.floor(Date.now() / 1000) + config.sessionHours * 3600
  res.cookie(SESSION_COOKIE, signSession({ uid: userId, exp }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

// ---------- Domain gate ----------

export interface VerifiedIdentity {
  email: string
  name: string
  picture: string | null
}

/**
 * The gate. An identity is accepted only if:
 *  - the email is verified by Google,
 *  - the `hd` (hosted domain) claim equals the allowed domain, which Google only
 *    sets for Google Workspace accounts, and
 *  - the email address itself is in that domain (belt and braces).
 */
export function isAllowedIdentity(
  claims: { email?: string; email_verified?: boolean; hd?: string },
  allowedDomain = config.allowedDomain,
): boolean {
  const email = (claims.email ?? '').toLowerCase()
  if (!email || claims.email_verified !== true) return false
  if ((claims.hd ?? '').toLowerCase() !== allowedDomain) return false
  return email.endsWith(`@${allowedDomain}`)
}

const googleClient = new OAuth2Client()

export async function verifyGoogleIdToken(idToken: string): Promise<VerifiedIdentity> {
  if (!config.googleClientId) throw new HttpError(500, 'GOOGLE_CLIENT_ID is not configured')
  let payload
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientId })
    payload = ticket.getPayload()
  } catch {
    throw new HttpError(401, 'Google sign-in could not be verified')
  }
  if (!payload || !isAllowedIdentity(payload)) {
    throw forbidden(`Only @${config.allowedDomain} Google Workspace accounts can sign in`)
  }
  return {
    email: payload.email!.toLowerCase(),
    name: payload.name ?? payload.email!,
    picture: payload.picture ?? null,
  }
}

// ---------- Users ----------

export async function upsertUserOnLogin(identity: VerifiedIdentity): Promise<User> {
  const existing = await one<User>('SELECT * FROM users WHERE email = $1', [identity.email])
  if (existing && !existing.is_active) throw forbidden('This account has been deactivated')
  const isAdmin = config.adminEmails.includes(identity.email)
  const user = existing
    ? (await one<User>(
        `UPDATE users SET name = COALESCE(NULLIF($2, ''), name), picture_url = COALESCE($3, picture_url), last_login_at = now(),
           role = CASE WHEN $4::boolean THEN 'admin' ELSE role END
         WHERE id = $1 RETURNING *`,
        [existing.id, identity.name, identity.picture, isAdmin],
      ))!
    : (await one<User>(
        `INSERT INTO users (email, name, picture_url, role, last_login_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING *`,
        [identity.email, identity.name || identity.email.split('@')[0], identity.picture, isAdmin ? 'admin' : 'member'],
      ))!
  await audit(pool, { entityType: 'user', entityId: user.id, action: 'login', actorId: user.id, summary: `${user.email} signed in` })
  return user
}

// ---------- Middleware ----------

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const payload = verifySession(req.cookies?.[SESSION_COOKIE])
    if (!payload) {
      res.status(401).json({ error: 'Not signed in' })
      return
    }
    const user = await one<User>('SELECT * FROM users WHERE id = $1', [payload.uid])
    if (!user || !user.is_active || !user.email.endsWith(`@${config.allowedDomain}`)) {
      clearSessionCookie(res)
      res.status(401).json({ error: 'Session is no longer valid' })
      return
    }
    req.user = user
    next()
  } catch (e) {
    next(e)
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    next(forbidden('Admin access required'))
    return
  }
  next()
}
