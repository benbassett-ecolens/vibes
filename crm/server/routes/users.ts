import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { audit } from '../audit.js'
import { one, pool, query } from '../db.js'
import { badRequest, notFound, parse, wrap } from '../http.js'
import type { User } from '../../shared/types.js'

export const usersRouter = Router()

usersRouter.get(
  '/',
  wrap(async (_req, res) => {
    const users = await query<User>('SELECT * FROM users ORDER BY is_active DESC, lower(name)')
    res.json({ items: users })
  }),
)

usersRouter.patch(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parse(z.object({ role: z.enum(['admin', 'member']).optional(), is_active: z.boolean().optional() }), req.body)
    const before = await one<User>('SELECT * FROM users WHERE id = $1', [req.params.id])
    if (!before) throw notFound('User')
    if (before.id === req.user.id && (body.role === 'member' || body.is_active === false)) {
      throw badRequest('You cannot demote or deactivate yourself')
    }
    const after = (await one<User>(
      `UPDATE users SET role = COALESCE($2, role), is_active = COALESCE($3, is_active) WHERE id = $1 RETURNING *`,
      [before.id, body.role ?? null, body.is_active ?? null],
    ))!
    await audit(pool, {
      entityType: 'user',
      entityId: after.id,
      action: 'update',
      actorId: req.user.id,
      changes: { role: { from: before.role, to: after.role }, is_active: { from: before.is_active, to: after.is_active } },
      summary: `${req.user.name} updated ${after.email}`,
    })
    res.json(after)
  }),
)
