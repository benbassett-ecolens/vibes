/** Link contacts to companies by email domain + company name, in bulk (review screen) and automatically. */
import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../auth.js'
import { audit } from '../audit.js'
import { one, query, withTransaction } from '../db.js'
import { parse, wrap } from '../http.js'
import { config } from '../config.js'
import { FREE_MAIL, bestCompanyForDomain } from '../../shared/match.js'

type CompanyLite = { id: string; name: string; domain: string | null }

export async function suggestCompaniesForEmail(email: string): Promise<Array<{ company: CompanyLite; score: number; reason: string }>> {
  const domain = email.toLowerCase().split('@')[1] ?? ''
  if (!domain || domain === config.allowedDomain || FREE_MAIL.has(domain)) return []
  const companies = await query<CompanyLite>('SELECT id, name, domain FROM companies WHERE archived_at IS NULL')
  return bestCompanyForDomain(domain, companies)
}

/** Called on contact creation: a confident match (company domain or near-exact name) links automatically. */
export async function autoCompanyForEmail(email: string | null | undefined): Promise<string | null> {
  if (!email) return null
  const s = await suggestCompaniesForEmail(email)
  return s[0] && s[0].score >= 0.85 ? s[0].company.id : null
}

/** After linking a contact, record the domain on the company and fill empty main-contact slots on its deals. */
export async function propagateLink(client: { query: (t: string, p?: unknown[]) => Promise<unknown> }, contactId: string, companyId: string, email: string | null, actorId: string | null): Promise<number> {
  const domain = (email ?? '').toLowerCase().split('@')[1]
  if (domain && domain !== config.allowedDomain && !FREE_MAIL.has(domain)) {
    await client.query('UPDATE companies SET domain = $2 WHERE id = $1 AND domain IS NULL', [companyId, domain])
  }
  const n = (await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM contacts WHERE company_id = $1 AND archived_at IS NULL', [companyId], client as never))!.n
  if (n !== 1) return 0
  const deals = await query<{ id: string; title: string }>('UPDATE deals SET contact_id = $2 WHERE company_id = $1 AND contact_id IS NULL AND archived_at IS NULL RETURNING id, title', [companyId, contactId], client as never)
  for (const d of deals) {
    await audit(client as never, { entityType: 'deal', entityId: d.id, action: 'update', actorId, changes: { contact_id: { from: null, to: contactId } }, summary: 'Main contact set from the company\'s only contact' })
  }
  return deals.length
}

export const linkerRouter = Router()
linkerRouter.use(requireAdmin)

linkerRouter.get(
  '/suggestions',
  wrap(async (_req, res) => {
    const contacts = await query<{ id: string; first_name: string; last_name: string; email: string }>(
      `SELECT id, first_name, last_name, email FROM contacts WHERE company_id IS NULL AND email IS NOT NULL AND archived_at IS NULL ORDER BY lower(email)`,
    )
    const companies = await query<CompanyLite>('SELECT id, name, domain FROM companies WHERE archived_at IS NULL')
    const items = contacts.map((c) => {
      const domain = c.email.toLowerCase().split('@')[1] ?? ''
      const suggestions = domain === config.allowedDomain || FREE_MAIL.has(domain) ? [] : bestCompanyForDomain(domain, companies)
      return { contact: c, domain, suggestions: suggestions.map((s) => ({ company_id: s.company.id, company_name: s.company.name, score: s.score, reason: s.reason })) }
    })
    res.json({ items, unlinked: contacts.length, with_suggestion: items.filter((i) => i.suggestions.length).length })
  }),
)

linkerRouter.post(
  '/apply',
  wrap(async (req, res) => {
    const { links } = parse(z.object({ links: z.array(z.object({ contact_id: z.string().uuid(), company_id: z.string().uuid() })).min(1).max(2000) }), req.body)
    let linked = 0
    let dealsUpdated = 0
    await withTransaction(async (client) => {
      for (const l of links) {
        const c = await one<{ id: string; email: string | null; company_id: string | null; first_name: string; last_name: string }>('SELECT id, email, company_id, first_name, last_name FROM contacts WHERE id = $1', [l.contact_id], client)
        const co = await one<{ id: string; name: string }>('SELECT id, name FROM companies WHERE id = $1', [l.company_id], client)
        if (!c || !co || c.company_id === co.id) continue
        await query('UPDATE contacts SET company_id = $2 WHERE id = $1', [c.id, co.id], client)
        await audit(client, { entityType: 'contact', entityId: c.id, action: 'update', actorId: req.user.id, changes: { company_id: { from: c.company_id, to: co.id }, company: co.name, via: 'domain match' }, summary: `Linked to ${co.name}` })
        linked++
        dealsUpdated += await propagateLink(client, c.id, co.id, c.email, req.user.id)
      }
    })
    res.json({ linked, deals_updated: dealsUpdated })
  }),
)
