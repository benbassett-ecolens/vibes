import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { clearSessionCookie, requireAuth, setSessionCookie, upsertUserOnLogin, verifyGoogleIdToken } from '../auth.js'
import { forbidden, parse, wrap } from '../http.js'

export const authRouter = Router()

/** Public: what the login page needs to render. */
authRouter.get('/config', (_req, res) => {
  res.json({ googleClientId: config.googleClientId, allowedDomain: config.allowedDomain, devMode: config.authDevMode })
})

authRouter.post(
  '/google',
  wrap(async (req, res) => {
    const { credential } = parse(z.object({ credential: z.string().min(10) }), req.body)
    const identity = await verifyGoogleIdToken(credential)
    const user = await upsertUserOnLogin(identity)
    setSessionCookie(res, user.id)
    res.json({ user })
  }),
)

/** Local development only (see AUTH_DEV_MODE). Never enabled in production. */
authRouter.post(
  '/dev',
  wrap(async (req, res) => {
    if (!config.authDevMode) throw forbidden('Dev login is disabled')
    const { email, name } = parse(z.object({ email: z.string().email(), name: z.string().min(1).optional() }), req.body)
    const lower = email.toLowerCase()
    if (!lower.endsWith(`@${config.allowedDomain}`)) throw forbidden(`Only @${config.allowedDomain} addresses can sign in`)
    const user = await upsertUserOnLogin({ email: lower, name: name ?? '', picture: null })
    setSessionCookie(res, user.id)
    res.json({ user })
  }),
)

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res)
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})
