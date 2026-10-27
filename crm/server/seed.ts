/**
 * Demo data for local development and first-run evaluation.
 * Usage: npm run seed   (refuses to run against a non-empty database unless --force)
 */
import { pool, query, one } from './db.js'

const force = process.argv.includes('--force')

const daysAgo = (n: number, hour = 10) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const daysAhead = (n: number) => daysAgo(-n)
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length]

async function main() {
  const n = (await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM deals'))!.n
  if (n > 0 && !force) {
    console.log(`Database already has ${n} deals. Re-run with --force to add demo data anyway.`)
    return
  }
  const users = [
    ['ben@ecolens.io', 'Ben Bassett', 'admin'],
    ['sam@ecolens.io', 'Sam Rivera', 'member'],
    ['riley@ecolens.io', 'Riley Chen', 'member'],
  ]
  const userIds: string[] = []
  for (const [email, name, role] of users) {
    const u = (await one<{ id: string }>(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [email, name, role],
    ))!
    userIds.push(u.id)
  }

  const pipeline = (await one<{ id: string }>('SELECT id FROM pipelines ORDER BY is_default DESC LIMIT 1'))!
  const stages = await query<{ id: string; name: string; kind: string; position: number }>('SELECT id, name, kind, position FROM stages WHERE pipeline_id = $1 ORDER BY position', [pipeline.id])
  const openStages = stages.filter((s) => s.kind === 'open')
  const won = stages.find((s) => s.kind === 'won')!
  const lost = stages.find((s) => s.kind === 'lost')!

  const companies = [
    ['Northwind Foods', 'northwind.example', 'Food & Beverage'],
    ['Cascade Apparel', 'cascadeapparel.example', 'Apparel'],
    ['Helios Energy', 'helios.example', 'Energy'],
    ['Bluewater Logistics', 'bluewater.example', 'Logistics'],
    ['Verdant Packaging', 'verdant.example', 'Packaging'],
    ['Summit Outdoor Co', 'summitoutdoor.example', 'Retail'],
    ['Meridian Cosmetics', 'meridian.example', 'Consumer goods'],
    ['Atlas Building Products', 'atlasbp.example', 'Construction'],
    ['Lumen Electronics', 'lumen.example', 'Electronics'],
    ['Harbor Coffee Roasters', 'harborcoffee.example', 'Food & Beverage'],
  ]
  const companyIds: string[] = []
  for (const [i, [name, domain, industry]] of companies.entries()) {
    const c = (await one<{ id: string }>(
      `INSERT INTO companies (name, domain, website, industry, owner_id, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $5, $6) RETURNING id`,
      [name, domain, `https://${domain}`, industry, pick(userIds, i), daysAgo(120 - i * 7)],
    ))!
    companyIds.push(c.id)
  }

  const firsts = ['Avery', 'Jordan', 'Morgan', 'Taylor', 'Casey', 'Quinn', 'Reese', 'Drew', 'Parker', 'Skyler', 'Emerson', 'Rowan']
  const lasts = ['Patel', 'Nguyen', 'Okafor', 'Schmidt', 'Garcia', 'Kim', 'Haddad', 'Lindqvist', 'Moreau', 'Silva', 'Walsh', 'Ito']
  const titles = ['Head of Sustainability', 'VP Operations', 'Procurement Lead', 'CFO', 'ESG Manager', 'Director of Supply Chain']
  const contactIds: string[] = []
  for (let i = 0; i < 18; i++) {
    const companyIdx = i % companyIds.length
    const c = (await one<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, title, company_id, owner_id, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7) RETURNING id`,
      [pick(firsts, i), pick(lasts, i * 5), `${pick(firsts, i).toLowerCase()}.${pick(lasts, i * 5).toLowerCase()}@${companies[companyIdx][1]}`, pick(titles, i), companyIds[companyIdx], pick(userIds, i), daysAgo(110 - i * 5)],
    ))!
    contactIds.push(c.id)
  }

  const dealTitles = ['Scope 3 baseline', 'Supplier emissions platform', 'LCA for product line', 'Annual ESG reporting', 'Packaging footprint study', 'Carbon accounting rollout', 'CSRD readiness', 'Fleet decarbonisation plan', 'Facility energy audit', 'Product passport pilot']
  type DealSpec = { stage: { id: string; name: string }; amount: number; createdDaysAgo: number; closedDaysAgo?: number; lostReason?: string }
  const specs: DealSpec[] = []
  for (let i = 0; i < 26; i++) {
    const r = i % 7
    if (r < 4) specs.push({ stage: pick(openStages, i), amount: 8000 + (i * 3700) % 60000, createdDaysAgo: 5 + i * 3 })
    else if (r < 6) specs.push({ stage: won, amount: 12000 + (i * 5100) % 80000, createdDaysAgo: 60 + i * 2, closedDaysAgo: Math.max(1, (i * 7) % 150) })
    else specs.push({ stage: lost, amount: 6000 + (i * 2900) % 40000, createdDaysAgo: 70 + i * 2, closedDaysAgo: Math.max(1, (i * 11) % 150), lostReason: pick(['Price', 'No budget', 'Went with competitor', 'Timing'], i) })
  }
  for (const [i, spec] of specs.entries()) {
    const companyIdx = i % companyIds.length
    const createdAt = daysAgo(spec.createdDaysAgo)
    const closedAt = spec.closedDaysAgo !== undefined ? daysAgo(Math.min(spec.closedDaysAgo, spec.createdDaysAgo - 1)) : null
    const ownerId = pick(userIds, i)
    const d = (await one<{ id: string }>(
      `INSERT INTO deals (title, pipeline_id, stage_id, amount, company_id, contact_id, owner_id, expected_close_date, closed_at, lost_reason, created_by, created_at, stage_entered_at, last_activity_at, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7, $11, $12, $13, $14) RETURNING id`,
      [`${companies[companyIdx][0]} – ${pick(dealTitles, i)}`, pipeline.id, spec.stage.id, spec.amount, companyIds[companyIdx], contactIds[i % contactIds.length], ownerId, daysAhead(10 + (i * 9) % 90).slice(0, 10), closedAt, spec.lostReason ?? null, createdAt, closedAt ?? daysAgo(Math.max(0, spec.createdDaysAgo - 3 - (i % 25))), i % 5 === 0 ? daysAgo(spec.createdDaysAgo - 1) : daysAgo(Math.max(0, i % 20)), i],
    ))!
    // Stage history: walk through the stages up to the current one.
    const path = spec.stage.id === won.id || spec.stage.id === lost.id ? [...openStages.slice(0, 2 + (i % 2)), spec.stage] : openStages.slice(0, openStages.findIndex((s) => s.id === spec.stage.id) + 1)
    let t = spec.createdDaysAgo
    for (const [j, st] of path.entries()) {
      const entered = daysAgo(t)
      const isLast = j === path.length - 1
      const step = Math.max(1, Math.floor((spec.createdDaysAgo - (spec.closedDaysAgo ?? 0)) / Math.max(1, path.length)))
      const exited = isLast ? null : daysAgo(Math.max(0, t - step))
      await query('INSERT INTO deal_stage_history (deal_id, from_stage_id, to_stage_id, changed_by, entered_at, exited_at) VALUES ($1, $2, $3, $4, $5, $6)', [d.id, j === 0 ? null : path[j - 1].id, st.id, ownerId, entered, exited])
      t = Math.max(0, t - step)
    }
    await query(`INSERT INTO audit_log (entity_type, entity_id, action, actor_id, changes, summary, created_at) VALUES ('deal', $1, 'create', $2, '{}', $3, $4)`, [d.id, ownerId, 'Created deal', createdAt])
    // A few activities per deal.
    const kinds = ['call', 'email', 'meeting', 'note', 'task'] as const
    for (let k = 0; k < 2 + (i % 3); k++) {
      const type = pick(kinds as unknown as string[], i + k)
      const isTask = type === 'task' || type === 'meeting'
      const due = isTask ? (k % 2 === 0 ? daysAhead(1 + k * 2) : daysAgo(2)) : null
      await query(
        `INSERT INTO activities (type, subject, body, deal_id, contact_id, company_id, owner_id, due_at, completed_at, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $7, $10)`,
        [type, pick(['Intro call', 'Sent proposal', 'Discovery meeting', 'Pricing follow-up', 'Send case study', 'Check in on timeline', 'Security questionnaire'], i + k), 'Seeded demo activity.', d.id, contactIds[i % contactIds.length], companyIds[companyIdx], ownerId, due, isTask ? null : daysAgo(spec.createdDaysAgo - k - 1), daysAgo(Math.max(0, spec.createdDaysAgo - k - 1))],
      )
    }
  }
  console.log(`Seeded ${users.length} users, ${companies.length} companies, ${contactIds.length} contacts, ${specs.length} deals.`)
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
