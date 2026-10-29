/**
 * Deal / company importer. Takes CSV text with a header row, maps headers to CRM fields by
 * name (several aliases each), and either previews or commits. Companies are created or
 * matched by name; owners are matched to users by name/email, or created from the owner map.
 */
import type pg from 'pg'
import { one, query, withTransaction } from '../db.js'
import { audit } from '../audit.js'
import { config } from '../config.js'
import { norm, parseCsv, parseDate, parseMoney } from './csv.js'
import type { Product, Stage } from '../../shared/types.js'

const ALIASES: Record<string, string[]> = {
  owner: ['director cpm', 'owner', 'deal owner', 'owner name', 'rep', 'account executive'],
  company: ['prospect name', 'company', 'company name', 'account', 'organization'],
  title: ['deal', 'deal name', 'title', 'opportunity', 'opportunity name'],
  industry: ['function', 'industry', 'vertical'],
  bu: ['ecolens bu', 'bu', 'business unit', 'product line'],
  partner_type: ['isv var other', 'partner type', 'type'],
  ecosystem: ['ecosystem', 'ecosystems', 'platforms'],
  retainer_acv: ['retainer acv', 'retainer', 'retainer annual'],
  performance_acv: ['performance acv', 'performance', 'closed won acv', 'closed won'],
  amount: ['total contract value', 'amount', 'deal value', 'value', 'first year value', 'acv'],
  stage: ['deal stage', 'stage', 'status'],
  close_date: ['close date', 'expected close', 'expected close date', 'closing date'],
  notes: ['notes', 'description', 'comments', 'next steps'],
  contact_name: ['contact', 'contact name', 'main contact', 'primary contact'],
  contact_email: ['contact email', 'email', 'main contact email'],
  contact_title: ['contact title', 'job title'],
  phone: ['phone', 'contact phone'],
  lead_source: ['lead source', 'source'],
  deal_type: ['deal type'],
  contract_months: ['contract length', 'contract months', 'term months', 'term'],
  website: ['website', 'domain', 'url'],
}

export interface ColumnMap { [field: string]: number }

export function mapHeaders(header: string[]): { map: ColumnMap; unmapped: string[] } {
  const map: ColumnMap = {}
  const unmapped: string[] = []
  header.forEach((h, i) => {
    const n = norm(h)
    if (!n) return
    const field = Object.entries(ALIASES).find(([, aliases]) => aliases.includes(n))?.[0]
    if (field && map[field] === undefined) map[field] = i
    else unmapped.push(h)
  })
  return { map, unmapped }
}

export interface ParsedDealRow {
  line: number
  owner: string | null
  company: string
  title: string
  industry: string | null
  bu: string | null
  partner_type: string | null
  ecosystem: string | null
  retainer_acv: number | null
  performance_acv: number | null
  amount: number | null
  stage: string | null
  close_date: string | null
  notes: string | null
  contact_name: string | null
  contact_email: string | null
  contact_title: string | null
  phone: string | null
  lead_source: string | null
  deal_type: string | null
  contract_months: number | null
  website: string | null
  problems: string[]
}

export function parseDealRows(csv: string): { header: string[]; map: ColumnMap; unmapped: string[]; rows: ParsedDealRow[] } {
  const all = parseCsv(csv)
  if (all.length < 2) return { header: all[0] ?? [], map: {}, unmapped: [], rows: [] }
  const header = all[0]
  const { map, unmapped } = mapHeaders(header)
  const get = (r: string[], f: string): string | null => (map[f] === undefined ? null : (r[map[f]] ?? '').trim() || null)
  const rows: ParsedDealRow[] = []
  all.slice(1).forEach((r, i) => {
    const company = get(r, 'company')
    const first = (r[0] ?? '').trim().toLowerCase()
    if (!company || first === 'totals' || first === 'total') return
    const problems: string[] = []
    const stage = get(r, 'stage')
    if (!stage) problems.push('no stage')
    const row: ParsedDealRow = {
      line: i + 2,
      owner: get(r, 'owner'),
      company,
      title: get(r, 'title') ?? company,
      industry: get(r, 'industry'),
      bu: get(r, 'bu'),
      partner_type: get(r, 'partner_type'),
      ecosystem: get(r, 'ecosystem'),
      retainer_acv: parseMoney(get(r, 'retainer_acv') ?? undefined),
      performance_acv: parseMoney(get(r, 'performance_acv') ?? undefined),
      amount: parseMoney(get(r, 'amount') ?? undefined),
      stage,
      close_date: parseDate(get(r, 'close_date') ?? undefined),
      notes: get(r, 'notes'),
      contact_name: get(r, 'contact_name'),
      contact_email: get(r, 'contact_email')?.toLowerCase() ?? null,
      contact_title: get(r, 'contact_title'),
      phone: get(r, 'phone'),
      lead_source: get(r, 'lead_source'),
      deal_type: get(r, 'deal_type'),
      contract_months: (() => {
        const v = get(r, 'contract_months')
        const n = v ? Number(v.replace(/[^0-9]/g, '')) : NaN
        return Number.isFinite(n) && n > 0 ? n : null
      })(),
      website: get(r, 'website'),
      problems,
    }
    if (get(r, 'close_date') && !row.close_date) problems.push(`unreadable close date "${get(r, 'close_date')}"`)
    rows.push(row)
  })
  return { header, map, unmapped, rows }
}

export interface ImportPreview {
  total_rows: number
  mapped_fields: string[]
  unmapped_columns: string[]
  owners: Array<{ name: string; rows: number; user_id: string | null; user_email: string | null }>
  stages: Array<{ name: string; rows: number; stage_id: string | null }>
  companies_new: number
  companies_existing: number
  deals_existing: number
  problems: Array<{ line: number; company: string; problems: string[] }>
}

async function resolveOwners(rows: ParsedDealRow[]): Promise<ImportPreview['owners']> {
  const users = await query<{ id: string; name: string; email: string }>('SELECT id, name, email FROM users')
  const counts = new Map<string, number>()
  for (const r of rows) if (r.owner) counts.set(r.owner, (counts.get(r.owner) ?? 0) + 1)
  return [...counts.entries()].map(([name, n]) => {
    const key = norm(name)
    const u = users.find((x) => norm(x.name) === key || x.email.toLowerCase() === name.toLowerCase() || norm(x.email.split('@')[0].replace('.', ' ')) === key)
    return { name, rows: n, user_id: u?.id ?? null, user_email: u?.email ?? null }
  })
}

async function resolveStages(rows: ParsedDealRow[], pipelineId: string): Promise<{ list: ImportPreview['stages']; byName: Map<string, Stage> }> {
  const stages = await query<Stage>('SELECT * FROM stages WHERE pipeline_id = $1 ORDER BY position', [pipelineId])
  const byName = new Map(stages.map((s) => [norm(s.name), s]))
  const counts = new Map<string, number>()
  for (const r of rows) if (r.stage) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1)
  return { list: [...counts.entries()].map(([name, n]) => ({ name, rows: n, stage_id: byName.get(norm(name))?.id ?? null })), byName }
}

export async function previewImport(csv: string, pipelineId: string): Promise<ImportPreview> {
  const { map, unmapped, rows } = parseDealRows(csv)
  const owners = await resolveOwners(rows)
  const { list: stages } = await resolveStages(rows, pipelineId)
  const names = [...new Set(rows.map((r) => r.company.toLowerCase()))]
  const existing = await query<{ name: string }>('SELECT lower(name) AS name FROM companies WHERE lower(name) = ANY($1::text[])', [names])
  const existingDeals = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM deals WHERE lower(title) = ANY($1::text[]) AND pipeline_id = $2`, [[...new Set(rows.map((r) => r.title.toLowerCase()))], pipelineId])
  return {
    total_rows: rows.length,
    mapped_fields: Object.keys(map),
    unmapped_columns: unmapped,
    owners,
    stages,
    companies_new: names.length - existing.length,
    companies_existing: existing.length,
    deals_existing: existingDeals[0]?.n ?? 0,
    problems: rows.filter((r) => r.problems.length).map((r) => ({ line: r.line, company: r.company, problems: r.problems })),
  }
}

export interface ImportOptions {
  pipelineId: string
  actorId: string
  /** owner name -> email. Users are created (inactive until first login) when missing. */
  ownerMap: Record<string, string>
  /** stage name in file -> stage id (overrides name matching). */
  stageMap: Record<string, string>
  defaultLeadSource: string
  skipExistingDeals: boolean
}

export interface ImportResult { deals_created: number; deals_skipped: number; companies_created: number; contacts_created: number; users_created: number; errors: Array<{ line: number; error: string }> }

function productFor(products: Product[], bu: string | null): Product | undefined {
  const b = (bu ?? '').toLowerCase()
  const find = (n: string) => products.find((p) => p.name.toLowerCase() === n.toLowerCase())
  if (b.includes('econet')) return find('EcoNet subscription fee') ?? find('Core ERP Monthly Retainer')
  if (b.includes('ai')) return find('AI monthly') ?? find('Core ERP Monthly Retainer')
  return find('Core ERP Monthly Retainer')
}

export async function commitImport(csv: string, opts: ImportOptions): Promise<ImportResult> {
  const { rows } = parseDealRows(csv)
  const result: ImportResult = { deals_created: 0, deals_skipped: 0, companies_created: 0, contacts_created: 0, users_created: 0, errors: [] }
  const { byName: stagesByName } = await resolveStages(rows, opts.pipelineId)
  const stageById = new Map((await query<Stage>('SELECT * FROM stages WHERE pipeline_id = $1', [opts.pipelineId])).map((s) => [s.id, s]))
  const products = await query<Product>('SELECT * FROM products')
  const perfProduct = products.find((p) => p.name.toLowerCase() === 'core erp closed won %')
  const owners = await resolveOwners(rows)
  const ownerIds = new Map<string, string>()

  await withTransaction(async (client: pg.PoolClient) => {
    // Owners
    for (const o of owners) {
      if (o.user_id) {
        ownerIds.set(o.name, o.user_id)
        continue
      }
      const email = (opts.ownerMap[o.name] ?? '').trim().toLowerCase()
      if (!email) continue
      if (!email.endsWith(`@${config.allowedDomain}`)) throw new Error(`Owner "${o.name}": ${email} is not an @${config.allowedDomain} address`)
      let u = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email], client)
      if (!u) {
        u = (await one<{ id: string }>(`INSERT INTO users (email, name, role) VALUES ($1, $2, 'member') RETURNING id`, [email, o.name], client))!
        result.users_created++
      }
      ownerIds.set(o.name, u.id)
    }

    for (const r of rows) {
      try {
        const stage = (r.stage && opts.stageMap[r.stage] && stageById.get(opts.stageMap[r.stage])) || (r.stage ? stagesByName.get(norm(r.stage)) : undefined)
        if (!stage) throw new Error(`unknown stage "${r.stage ?? ''}"`)
        if (opts.skipExistingDeals) {
          const dup = await one('SELECT 1 FROM deals WHERE lower(title) = $1 AND pipeline_id = $2', [r.title.toLowerCase(), opts.pipelineId], client)
          if (dup) {
            result.deals_skipped++
            continue
          }
        }
        const ownerId = r.owner ? ownerIds.get(r.owner) ?? null : null
        // Company
        let company = await one<{ id: string }>('SELECT id FROM companies WHERE lower(name) = $1', [r.company.toLowerCase()], client)
        const companyNotes = [r.partner_type && `Type: ${r.partner_type}`, r.ecosystem && `Ecosystem: ${r.ecosystem}`, r.bu && `Ecolens BU: ${r.bu}`].filter(Boolean).join('\n') || null
        if (!company) {
          company = (await one<{ id: string }>(
            `INSERT INTO companies (name, industry, website, notes, owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [r.company, r.industry, r.website, companyNotes, ownerId, opts.actorId],
            client,
          ))!
          result.companies_created++
          await audit(client, { entityType: 'company', entityId: company.id, action: 'create', actorId: opts.actorId, changes: { name: r.company, via: 'import' }, summary: `Imported company ${r.company}` })
        }
        // Contact (optional)
        let contactId: string | null = null
        if (r.contact_email || r.contact_name) {
          const existing = r.contact_email ? await one<{ id: string }>('SELECT id FROM contacts WHERE lower(email) = $1', [r.contact_email], client) : null
          if (existing) contactId = existing.id
          else {
            const [first, ...rest] = (r.contact_name ?? r.contact_email!.split('@')[0]).split(/\s+/)
            const c = (await one<{ id: string }>(
              `INSERT INTO contacts (first_name, last_name, email, title, phone, company_id, owner_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
              [first, rest.join(' '), r.contact_email, r.contact_title, r.phone, company.id, ownerId, opts.actorId],
              client,
            ))!
            contactId = c.id
            result.contacts_created++
          }
        }
        // Deal
        const closed = stage.kind !== 'open'
        const closeDate = r.close_date
        const closedAt = closed ? (closeDate ? `${closeDate}T12:00:00Z` : new Date().toISOString()) : null
        const lines: Array<{ product: Product; unit_price: number }> = []
        if (r.retainer_acv && r.retainer_acv > 0) {
          const p = productFor(products, r.bu)
          if (p) lines.push({ product: p, unit_price: p.pricing_type === 'monthly' ? Math.round((r.retainer_acv / 12) * 100) / 100 : r.retainer_acv })
        }
        if (r.performance_acv && r.performance_acv > 0 && perfProduct) lines.push({ product: perfProduct, unit_price: r.performance_acv })
        const lineTotal = lines.reduce((s, l) => s + (l.product.pricing_type === 'monthly' ? l.unit_price * 12 : l.unit_price), 0)
        const amount = lines.length ? Math.round(lineTotal * 100) / 100 : (r.amount ?? 0)
        const dealType = ['new_business', 'renewal', 'upsell'].includes((r.deal_type ?? '').toLowerCase().replace(' ', '_')) ? r.deal_type!.toLowerCase().replace(' ', '_') : 'new_business'
        const d = (await one<{ id: string }>(
          `INSERT INTO deals (title, pipeline_id, stage_id, amount, amount_from_products, company_id, contact_id, owner_id, expected_close_date, closed_at, lost_reason, lead_source, deal_type, contract_months, contract_start_date, description, created_by, stage_entered_at, created_at, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, COALESCE($10, now()), LEAST(COALESCE($10, now()), now()), (SELECT COALESCE(MAX(position), 0) + 1 FROM deals WHERE stage_id = $3)) RETURNING id`,
          [r.title, opts.pipelineId, stage.id, amount, lines.length > 0, company.id, contactId, ownerId, closeDate, closedAt, stage.kind === 'lost' ? 'Imported' : null, r.lead_source ?? opts.defaultLeadSource, dealType, r.contract_months, stage.kind === 'won' ? closeDate : null, r.notes, opts.actorId],
          client,
        ))!
        for (const [i, l] of lines.entries()) {
          await query(
            `INSERT INTO deal_products (deal_id, product_id, pricing_type, quantity, unit_price, term_months, basis_amount, position) VALUES ($1, $2, $3, 1, $4, 12, 0, $5)`,
            [d.id, l.product.id, l.product.pricing_type, l.unit_price, i],
            client,
          )
        }
        await query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, entered_at) VALUES ($1, NULL, $2, $3, COALESCE($4, now()))', [d.id, stage.id, opts.actorId, closedAt], client)
        await audit(client, { entityType: 'deal', entityId: d.id, action: 'create', actorId: opts.actorId, changes: { title: r.title, stage: stage.name, amount, via: 'import', line: r.line }, summary: `Imported from CSV (row ${r.line}) into ${stage.name}` })
        result.deals_created++
      } catch (e) {
        result.errors.push({ line: r.line, error: (e as Error).message })
      }
    }
    if (result.errors.length && result.deals_created === 0) throw new Error(`Nothing imported: ${result.errors[0].error} (row ${result.errors[0].line})`)
  })
  return result
}
