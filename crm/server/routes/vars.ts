import { Router } from 'express'
import { z } from 'zod'
import { one, pool, query } from '../db.js'
import { audit } from '../audit.js'
import { badRequest, forbidden, notFound, parse, wrap } from '../http.js'
import { aiConfigured, askNews, type NewsCompany } from '../ai/news.js'
import type { CompanyNews } from '../../shared/types.js'

/** VAR/ERP/ISV endpoints. The records themselves are companies with kind = 'var' | 'erp' | 'isv' (see /api/companies?kind=…). */
export const varsRouter = Router()

const NEWS_SELECT = `SELECT n.id, n.company_id, co.name AS company_name, n.scope_kind, n.question, n.answer, n.sources, n.model, n.created_at, u.name AS created_by_name
  FROM company_news n LEFT JOIN companies co ON co.id = n.company_id LEFT JOIN users u ON u.id = n.created_by`

const askSchema = z.object({ question: z.string().trim().min(3).max(1000) })

const kindOf = (v: unknown): 'var' | 'erp' | 'isv' => (v === 'erp' ? 'erp' : v === 'isv' ? 'isv' : 'var')

async function loadVar(id: string): Promise<NewsCompany & { id: string; kind: string }> {
  const c = await one<NewsCompany & { id: string; kind: string }>('SELECT id, kind, name, domain, website, ecosystems, partner_type, notes FROM companies WHERE id = $1 AND archived_at IS NULL', [id])
  if (!c) throw notFound('Record')
  return c
}

varsRouter.get(
  '/status',
  wrap(async (_req, res) => {
    res.json({ ai_configured: aiConfigured() })
  }),
)

/** Question history: ?company_id=<id> for one record, otherwise the cross-record questions for ?kind=var|erp. */
varsRouter.get(
  '/news',
  wrap(async (req, res) => {
    const cid = typeof req.query.company_id === 'string' && req.query.company_id ? req.query.company_id : null
    const items = cid
      ? await query<CompanyNews>(`${NEWS_SELECT} WHERE n.company_id = $1 ORDER BY n.created_at DESC LIMIT 50`, [cid])
      : await query<CompanyNews>(`${NEWS_SELECT} WHERE n.company_id IS NULL AND n.scope_kind = $1 ORDER BY n.created_at DESC LIMIT 50`, [kindOf(req.query.kind)])
    res.json({ items })
  }),
)

/** Ask about one VAR. */
varsRouter.post(
  '/:id/news/ask',
  wrap(async (req, res) => {
    if (!aiConfigured()) throw forbidden('News search is not configured. Set ANTHROPIC_API_KEY on the server.')
    const body = parse(askSchema, req.body)
    const c = await loadVar(String(req.params.id))
    const result = await askNews(body.question, [c], kindOf(c.kind))
    const row = (await one<{ id: string }>(
      'INSERT INTO company_news (company_id, scope_kind, question, answer, sources, model, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [c.id, kindOf(c.kind), body.question, result.answer, JSON.stringify(result.sources), result.model, req.user.id],
    ))!
    await audit(pool, { entityType: 'company', entityId: c.id, action: 'update', actorId: req.user.id, changes: { news_question: body.question, sources: result.sources.length }, summary: `Asked about ${c.name}: ${body.question.slice(0, 80)}` })
    res.json(await one<CompanyNews>(`${NEWS_SELECT} WHERE n.id = $1`, [row.id]))
  }),
)

/** Ask across all VARs or all ERPs (body.kind), or the ones named in company_ids. */
varsRouter.post(
  '/news/ask',
  wrap(async (req, res) => {
    if (!aiConfigured()) throw forbidden('News search is not configured. Set ANTHROPIC_API_KEY on the server.')
    const body = parse(askSchema.extend({ kind: z.enum(['var', 'erp', 'isv']).optional(), company_ids: z.array(z.string().uuid()).max(40).optional() }), req.body)
    const kind = body.kind ?? 'var'
    const companies = await query<NewsCompany & { id: string }>(
      `SELECT id, name, domain, website, ecosystems, partner_type, notes FROM companies
       WHERE kind = $2 AND archived_at IS NULL ${body.company_ids?.length ? 'AND id = ANY($1::uuid[])' : 'AND $1::uuid[] IS NULL'} ORDER BY name LIMIT 40`,
      [body.company_ids?.length ? body.company_ids : null, kind],
    )
    if (!companies.length) throw badRequest(`There are no ${kind.toUpperCase()} records to ask about yet`)
    const result = await askNews(body.question, companies, kind)
    const row = (await one<{ id: string }>(
      'INSERT INTO company_news (company_id, scope_kind, question, answer, sources, model, created_by) VALUES (NULL, $1, $2, $3, $4, $5, $6) RETURNING id',
      [kind, body.question, result.answer, JSON.stringify(result.sources), result.model, req.user.id],
    ))!
    res.json(await one<CompanyNews>(`${NEWS_SELECT} WHERE n.id = $1`, [row.id]))
  }),
)

varsRouter.delete(
  '/news/:newsId',
  wrap(async (req, res) => {
    await query('DELETE FROM company_news WHERE id = $1', [String(req.params.newsId)])
    res.json({ ok: true })
  }),
)
