import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError, type ZodSchema } from 'zod'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`)
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details)
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg)

/** Wrap an async handler so rejections reach the error middleware. */
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next)
  }

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data)
  } catch (e) {
    if (e instanceof ZodError) {
      throw badRequest('Validation failed', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
    }
    throw e
  }
}

/**
 * Sorting is whitelisted per endpoint: the client sends `sort=<key>&dir=asc|desc`
 * and we map the key to a SQL expression. Unknown keys fall back to the default.
 */
export function parseSort(
  q: Record<string, unknown>,
  allowed: Record<string, string>,
  defaultKey: string,
  defaultDir: 'asc' | 'desc' = 'asc',
): { sql: string; key: string; dir: 'asc' | 'desc' } {
  const key = typeof q.sort === 'string' && q.sort in allowed ? q.sort : defaultKey
  const dir = q.dir === 'desc' ? 'desc' : q.dir === 'asc' ? 'asc' : defaultDir
  const nulls = dir === 'asc' ? 'NULLS LAST' : 'NULLS LAST'
  return { sql: `${allowed[key]} ${dir.toUpperCase()} ${nulls}`, key, dir }
}

export function parsePaging(q: Record<string, unknown>, defaultLimit = 50, max = 500): { limit: number; offset: number } {
  const limit = Math.min(max, Math.max(1, Number(q.limit) || defaultLimit))
  const offset = Math.max(0, Number(q.offset) || 0)
  return { limit, offset }
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details })
    return
  }
  const e = err as { status?: number; type?: string; message?: string }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }
  console.error(err)
  res.status(500).json({ error: 'Internal server error' })
}
