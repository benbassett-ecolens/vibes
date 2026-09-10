/**
 * The Ecolens Sales Pipeline spreadsheet, imported as CRM records.
 *
 * Source: Google Sheet "Ecolens Sales Pipeline" (main tab, 46 rows, plus the
 * Forecast/Upside tab). Every deal, note, contact and activity here traces
 * back to a cell in that sheet. Ids are deterministic slugs so the same seed
 * can be written to the shared workspace and to a local browser without
 * producing duplicates.
 *
 * Interpretation rules used while importing (as of 2026-09-08):
 * - A note that records something that already happened ("Met with…",
 *   "Pinged…", "Emailed follow-up…") becomes a completed activity on that date.
 * - A note that names a next step with a date becomes a scheduled activity on
 *   that date (a past date shows as overdue — the sheet doesn't say it was done).
 * - A note that names a next step without a date is scheduled for the next
 *   working day (2026-09-09) and says so in its note.
 * - Rows from the Forecast tab attach as older notes (dated 2026-07-15, the
 *   week those notes reference) and set the deal's forecast category.
 * - "Select One or More" placeholders are treated as blank.
 */
import type {
  Activity,
  ActivityType,
  AppData,
  Contact,
  Dashboard,
  Deal,
  ForecastCategory,
  Meta,
  Note,
  Person,
  Stage,
  Widget,
} from './types'
import { SHEET_CSV_2026_09_08 } from './sheetSnapshot'
import { rowsFromCsv, sheetKeyOf } from './sheetSync'

export const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1-Pcn2rGjkQVBK3wTy0mm8ZzQKG1Z8aBULBf7fDeaatE/edit'

/** The day the sheet was imported; activity defaults are relative to it. */
export const IMPORT_DATE = '2026-09-08'
const NEXT_WORKING_DAY = '2026-09-09'
const FORECAST_TAB_DATE = '2026-07-15'
const CREATED_AT = '2026-09-08T09:00:00.000Z'

export const PEOPLE: Person[] = [
  { id: 'p-david', name: 'David Gersten', initials: 'DG', color: '#2a78d6' },
  { id: 'p-max', name: 'Max Robbins', initials: 'MR', color: '#eb6834' },
  { id: 'p-danica', name: 'Danica Weappa', initials: 'DW', color: '#1baf7a' },
  { id: 'p-chris', name: 'Chris McDonald', initials: 'CM', color: '#eda100' },
  { id: 'p-naomi', name: 'Naomi Marti', initials: 'NM', color: '#e87ba4' },
  { id: 'p-ben', name: 'Ben Bassett', initials: 'BB', color: '#4a3aa7' },
  { id: 'p-jenn', name: 'Jenn Andreas', initials: 'JA', color: '#008300' },
]

export const STAGES: Stage[] = [
  { id: 's-cold', name: 'Cold Prospect', kind: 'open', probability: 10 },
  { id: 's-intro', name: 'Introduction Made', kind: 'open', probability: 20 },
  { id: 's-discovery', name: 'Discovery of SOW', kind: 'open', probability: 40 },
  { id: 's-demo', name: 'Demo of Ecolens', kind: 'open', probability: 60 },
  { id: 's-proposal', name: 'Proposal', kind: 'open', probability: 75 },
  { id: 's-contract', name: 'Contract Sent', kind: 'open', probability: 90 },
  { id: 's-won', name: 'Closed Won', kind: 'won', probability: 100 },
  { id: 's-deferred', name: 'Deferred', kind: 'deferred', probability: 0 },
  { id: 's-lost', name: 'Closed Lost', kind: 'lost', probability: 0 },
]

const OWNER: Record<string, string> = {
  'David Gersten': 'p-david',
  'Max Robbins': 'p-max',
  'Danica Weappa': 'p-danica',
  'Chris McDonald': 'p-chris',
  'Naomi Marti': 'p-naomi',
  'Ben Bassett': 'p-ben',
  'Jenn Andreas': 'p-jenn',
}

const STAGE: Record<string, string> = {
  'Cold Prospect': 's-cold',
  'Introduction Made': 's-intro',
  'Discovery of SOW': 's-discovery',
  'Demo of Ecolens': 's-demo',
  Proposal: 's-proposal',
  'Contract Sent': 's-contract',
  'Closed Won': 's-won',
  Deferred: 's-deferred',
  'Closed Lost': 's-lost',
}

interface ActivitySeed {
  type: ActivityType
  subject: string
  due: string
  done?: boolean
  note?: string
}
interface ContactSeed {
  name: string
  title?: string
  note?: string
}

/** One sheet row plus the CRM-shaped extras derived from its notes. */
interface Row {
  slug: string
  owner: string
  name: string
  product: string
  bu: string
  type: string
  eco: string
  retainer: number | null
  performance: number | null
  /** Sheet "Total Contract Value"; null when the cell was blank. */
  tcv: number | null
  tbd?: boolean
  stage: string
  close: string
  /** Sheet note, kept verbatim, with the date it refers to when one is stated. */
  notes: Array<{ date: string; body: string }>
  lostReason?: string
  forecast?: ForecastCategory
  /** Rows from the Forecast/Upside tab, attached as older notes. */
  forecastNote?: string
  activities?: ActivitySeed[]
  contacts?: ContactSeed[]
  tags?: string[]
}

const md = (m: number, d: number, y = 2026) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

const ROWS: Row[] = [
  {
    slug: 'rockton', owner: 'David Gersten', name: 'Rockton Software', product: 'Pricing and other tools',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft, Acumatica', retainer: 180000, performance: 180000, tcv: 360000,
    stage: 'Closed Lost', close: md(5, 20), notes: [],
  },
  {
    slug: 'phocas', owner: 'David Gersten', name: 'Phocas', product: 'Reporting / Budgeting',
    bu: 'ISV Services', type: 'ISV', eco: 'Acumatica, Microsoft, NetSuite, Sage', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Closed Lost', close: md(6, 1), notes: [],
  },
  {
    slug: 'idynamics', owner: 'David Gersten', name: 'iDynamics', product: 'Commissions, Rebates, WMS',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 83000, performance: 20000, tcv: 103000,
    stage: 'Closed Won', close: md(6, 12), notes: [],
  },
  {
    slug: 'data-courage', owner: 'David Gersten', name: 'Data Courage', product: 'Projects and AI CFO tools',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 75000, performance: 40000, tcv: 115000,
    stage: 'Closed Won', close: md(6, 15), notes: [],
  },
  {
    slug: 'fazeshift', owner: 'Max Robbins', name: 'Fazeshift', product: 'AI Accounts Receivable',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft, NetSuite, Sage', retainer: 324000, performance: 324000, tcv: 648000,
    stage: 'Closed Won', close: md(7, 1), notes: [],
  },
  {
    slug: 'aqueducts', owner: 'David Gersten', name: 'Aqueducts Consulting', product: 'Reporting / Regression Testing',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 90000, performance: 250000, tcv: 340000,
    stage: 'Closed Won', close: md(7, 25),
    notes: [{ date: md(7, 20), body: 'Waiting on contract feedback. Terms agreed verbally. Target signature by 7/24' }],
    forecast: 'forecast', forecastNote: 'Send contract by EOW',
    activities: [{ type: 'deadline', subject: 'Target signature', due: md(7, 24), done: true }],
  },
  {
    slug: 'shiphawk', owner: 'David Gersten', name: 'Shiphawk', product: 'Shipping Management',
    bu: 'ISV Services', type: 'ISV', eco: 'Acumatica, NetSuite', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Closed Lost', close: md(7, 27),
    notes: [{ date: md(7, 27), body: "Doesn't see value, misaligned model." }],
    lostReason: "Doesn't see value, misaligned model",
  },
  {
    slug: 'cargas', owner: 'David Gersten', name: 'Cargas', product: '',
    bu: 'VAR Services', type: 'VAR', eco: 'Microsoft, Sage', retainer: null, performance: null, tcv: 0, tbd: true,
    stage: 'Closed Lost', close: md(8, 1),
    notes: [{ date: md(8, 3), body: 'Still need to work with Michelle more. Pinged Michelle on 8/3' }],
    activities: [{ type: 'email', subject: 'Pinged Michelle', due: md(8, 3), done: true }],
    contacts: [{ name: 'Michelle' }],
  },
  {
    slug: 'platform-transition', owner: 'Danica Weappa', name: 'Platform Transition Specialists', product: 'Data Migration',
    bu: 'ISV Services', type: 'Other', eco: 'Sage', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Closed Lost', close: md(9, 1),
    notes: [{
      date: md(8, 31),
      body: "From Hugh: Since we began our conversation with Ecolens, we've made a significant pivot in our sales and marketing direction and will be committing the majority of our resources to those initiatives. As a result, we must respectfully decline at this time.",
    }],
    lostReason: 'Pivoted sales & marketing direction; declined 8/31',
    forecast: 'upside', forecastNote: 'Regroup 7/22',
    activities: [{ type: 'meeting', subject: 'Regroup', due: md(7, 22), done: true }],
    contacts: [{ name: 'Hugh' }],
  },
  {
    slug: 'procurify', owner: 'David Gersten', name: 'Procurify', product: 'Procurement Management',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft, Sage', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Closed Lost', close: md(9, 2), notes: [{ date: md(9, 2), body: 'Closed Lost' }],
  },
  {
    slug: 'attivoerp', owner: 'Max Robbins', name: 'AttivoERP', product: '',
    bu: 'VAR Services', type: 'VAR', eco: 'Microsoft, Acumatica', retainer: 36000, performance: 5000, tcv: 41000,
    stage: 'Proposal', close: md(9, 15),
    notes: [{ date: IMPORT_DATE, body: 'Max to follow up with Dan to book next meeting' }],
    forecast: 'upside',
    forecastNote: 'Glenn wants to meet last week of July (then owned by Chris McDonald, Discovery of SOW, $90k / $90k)',
    activities: [{
      type: 'call', subject: 'Follow up with Dan to book next meeting', due: NEXT_WORKING_DAY,
      note: 'Scheduled from the sheet note; no date was given.',
    }],
    contacts: [{ name: 'Dan' }, { name: 'Glenn' }],
  },
  {
    slug: 'yavrio', owner: 'David Gersten', name: 'Yavrio', product: 'AR Automation + CC Payments',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Proposal', close: md(9, 15),
    notes: [{ date: md(9, 2), body: 'Follow up today 9/2/2026 - waiting on John' }],
    forecast: 'upside', forecastNote: 'Need to find investor. Ben to connect investor (Contract Sent, close 8/1)',
    activities: [
      { type: 'call', subject: 'Follow up — waiting on John', due: md(9, 2) },
    ],
    contacts: [{ name: 'John' }],
  },
  {
    slug: 'psi-software', owner: 'Chris McDonald', name: 'PSI Software',
    product: 'Optimization software for flow of energy and materials for utilities',
    bu: 'ISV Services', type: 'Other', eco: 'Other', retainer: 120000, performance: 50000, tcv: 170000,
    stage: 'Proposal', close: md(9, 15),
    notes: [{ date: md(9, 2), body: 'Met with Tim on 9/2 and pitched retainer. Should hear back this week.' }],
    activities: [
      { type: 'meeting', subject: 'Pitched retainer to Tim', due: md(9, 2), done: true },
      { type: 'deadline', subject: 'Expect decision from Tim', due: md(9, 11), note: '"Should hear back this week."' },
    ],
    contacts: [{ name: 'Tim' }],
  },
  {
    slug: 'hivecpq', owner: 'David Gersten', name: 'HiveCPQ', product: 'CPQ',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Closed Lost', close: md(9, 15), notes: [{ date: md(8, 10), body: 'Follow up week of 8/10' }],
  },
  {
    slug: 'powercloud', owner: 'Chris McDonald', name: 'PowerCloud', product: 'NetSuite VAR',
    bu: 'VAR Services', type: 'VAR', eco: 'NetSuite', retainer: 120000, performance: 50000, tcv: 170000,
    stage: 'Proposal', close: md(9, 30),
    notes: [{ date: md(9, 8), body: 'Meeting with them today- 9/8' }],
    activities: [{ type: 'meeting', subject: 'Meeting with PowerCloud', due: md(9, 8) }],
  },
  {
    slug: 'crstl', owner: 'Max Robbins', name: 'CRSTL', product: 'EDI',
    bu: 'ISV Services', type: 'ISV', eco: 'NetSuite', retainer: 120000, performance: 50000, tcv: 170000,
    stage: 'Proposal', close: md(9, 30),
    notes: [{ date: IMPORT_DATE, body: 'Max to follow up next week' }],
    activities: [{ type: 'call', subject: 'Follow up', due: md(9, 15), note: '"Next week" from the 9/8 sheet.' }],
  },
  {
    slug: 'aspen-real-life', owner: 'Danica Weappa', name: 'Aspen Real Life', product: 'AI Lab',
    bu: 'AI - SMB', type: 'Other', eco: 'Other', retainer: 10800, performance: null, tcv: 10800,
    stage: 'Proposal', close: md(9, 30),
    notes: [{ date: IMPORT_DATE, body: 'Verbal Yes TBD 9/11' }],
    activities: [{ type: 'deadline', subject: 'Confirm verbal yes', due: md(9, 11) }],
  },
  {
    slug: 'tasklet', owner: 'Naomi Marti', name: 'Tasklet', product: '',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft, Acumatica', retainer: 120000, performance: 50000, tcv: 170000,
    stage: 'Demo of Ecolens', close: md(9, 30),
    notes: [{ date: md(9, 2), body: 'Meeting happened 9/2 - internal meeting 9/8' }],
    activities: [
      { type: 'meeting', subject: 'Meeting with Tasklet', due: md(9, 2), done: true },
      { type: 'meeting', subject: 'Internal meeting re: Tasklet', due: md(9, 8) },
    ],
  },
  {
    slug: 'sourcetechnologies', owner: 'David Gersten', name: 'SourceTechnologies', product: 'AP and Documents',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: null, performance: null, tcv: null,
    stage: 'Demo of Ecolens', close: md(10, 1),
    notes: [{ date: md(9, 2), body: 'Follow up with team 9/2' }],
    activities: [{ type: 'task', subject: 'Follow up with team', due: md(9, 2) }],
  },
  {
    slug: 'primo-payday', owner: 'David Gersten', name: 'Primo Payday', product: 'Payroll',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 90000, performance: 90000, tcv: 180000,
    stage: 'Closed Lost', close: md(10, 1),
    notes: [{ date: md(7, 14), body: "Followed up 7/14. VP of sales needs help but doesn't know it yet. Following up again week of 7/20" }],
    activities: [{ type: 'call', subject: 'Followed up', due: md(7, 14), done: true }],
  },
  {
    slug: 'precoro', owner: 'Naomi Marti', name: 'Precoro', product: 'Procurement Management',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 90000, performance: 45000, tcv: 135000,
    stage: 'Proposal', close: md(10, 31),
    notes: [{
      date: IMPORT_DATE,
      body: 'Wants to meet at Summit - try to move in Q3 (F/U end of July Max). Negotiating on levers. Potentially removing leads. They are evaluating internal hire as well. More to come next week',
    }],
    activities: [{ type: 'task', subject: 'Update on levers / internal-hire decision', due: md(9, 15), note: '"More to come next week."' }],
  },
  {
    slug: 'evexso', owner: 'David Gersten', name: 'eveXso', product: 'WMS',
    bu: 'ISV Services', type: 'ISV', eco: 'Acumatica, Microsoft, SAP-B1', retainer: null, performance: null, tcv: 0, tbd: true,
    stage: 'Introduction Made', close: md(10, 31),
    notes: [{ date: md(9, 2), body: 'Follow up 9/2' }],
    activities: [{ type: 'task', subject: 'Follow up', due: md(9, 2) }],
  },
  {
    slug: 'worldmax', owner: 'Naomi Marti', name: 'WorldMax', product: '',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: null, performance: null, tcv: 90000,
    stage: 'Closed Lost', close: md(10, 31),
    notes: [
      { date: md(9, 8), body: 'WorldMax potentially folding' },
      { date: md(8, 27), body: 'Mary is reviewing numbers' },
    ],
    lostReason: 'Company potentially folding',
    contacts: [{ name: 'Mary' }],
  },
  {
    slug: 'istream', owner: 'Chris McDonald', name: 'iStream', product: 'Remote Capture / ACH Payments',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: null, performance: null, tcv: 0,
    stage: 'Proposal', close: md(10, 31),
    notes: [{ date: IMPORT_DATE, body: "Followed up but didn't hear back. Still shooting for Q4." }],
    forecast: 'upside', forecastNote: 'Discovery call 7/15. Reviewing deck. (Discovery of SOW, $90k / $90k)',
    activities: [
      { type: 'meeting', subject: 'Discovery call', due: md(7, 15), done: true },
      { type: 'call', subject: 'Follow up again — targeting Q4', due: md(9, 15), note: 'Scheduled from the sheet note; no date was given.' },
    ],
  },
  {
    slug: 'fingercheck', owner: 'Danica Weappa', name: 'Fingercheck', product: 'Time Keeping + Payroll',
    bu: 'ISV Services', type: 'ISV', eco: 'Sage, Acumatica, Microsoft, NetSuite, SAP-B1, Other',
    retainer: null, performance: null, tcv: 0,
    stage: 'Cold Prospect', close: md(10, 31),
    notes: [{ date: md(8, 31), body: "Danica's contact, Mike Halford, sent an intro to Fingercheck's CEO to explore an ERP VAR partnership opportunity with Ecolens." }],
    activities: [{ type: 'email', subject: 'Intro to CEO sent by Mike Halford', due: md(8, 31), done: true }],
    contacts: [{ name: 'Mike Halford', title: 'Referrer (Danica\'s contact)' }],
  },
  {
    slug: 'dokka', owner: 'David Gersten', name: 'Dokka', product: 'AI Accounts Payable',
    bu: 'ISV Services', type: 'ISV', eco: 'Acumatica, SAP-B1', retainer: 84000, performance: 50000, tcv: 134000,
    stage: 'Discovery of SOW', close: md(10, 31),
    notes: [{ date: IMPORT_DATE, body: 'David to follow up with Dokka' }],
    forecast: 'upside', forecastNote: 'Follow up week of the 20th (then owned by Jenn Andreas, Proposal, close 7/31)',
    activities: [{ type: 'call', subject: 'Follow up with Dokka', due: NEXT_WORKING_DAY, note: 'Scheduled from the sheet note; no date was given.' }],
  },
  {
    slug: 'dsd', owner: 'Danica Weappa', name: 'DSD', product: '',
    bu: 'VAR Services', type: '', eco: '', retainer: null, performance: null, tcv: 0,
    stage: 'Discovery of SOW', close: md(10, 31),
    notes: [{ date: md(9, 2), body: 'Follow up with Brett 9/2' }],
    activities: [{ type: 'task', subject: 'Follow up with Brett', due: md(9, 2) }],
    contacts: [{ name: 'Brett' }],
  },
  {
    slug: 'softel', owner: 'Max Robbins', name: 'Softel', product: 'Contact Center, Telecom',
    bu: 'ISV Services, AI - Enterprise', type: 'ISV, Other', eco: 'Other', retainer: 180000, performance: 90000, tcv: 270000,
    stage: 'Discovery of SOW', close: md(10, 31),
    notes: [{ date: md(9, 2), body: 'John said there is room for Ecolens support and wants to talk late September' }],
    forecast: 'forecast', forecastNote: 'Commercials on 7/15 - confirmed with Aaron and John. (Proposal, close 8/1, $120k / $90k)',
    activities: [
      { type: 'call', subject: 'Spoke with John', due: md(9, 2), done: true },
      { type: 'meeting', subject: 'Talk with John (late September)', due: md(9, 28), note: '"Late September" — pick the exact day with John.' },
    ],
    contacts: [{ name: 'John' }, { name: 'Aaron' }],
  },
  {
    slug: 'payroc', owner: 'Chris McDonald', name: 'Payroc / BlueSnap', product: 'Payment processor - BlueSnap',
    bu: 'ISV Services', type: '', eco: '', retainer: null, performance: null, tcv: 0,
    stage: 'Demo of Ecolens', close: md(11, 15),
    notes: [{ date: IMPORT_DATE, body: 'Heard back from Matt Finn. He wants to meet us at SuiteWorld.' }],
    activities: [{ type: 'task', subject: 'Book SuiteWorld meeting with Matt Finn', due: md(9, 15), note: 'Scheduled from the sheet note; no date was given.' }],
    contacts: [{ name: 'Matt Finn' }],
  },
  {
    slug: 'alpha-bold', owner: 'Chris McDonald', name: 'Alpha Bold / BuildFitters', product: 'Construction Management',
    bu: 'VAR Services, ISV Services', type: 'VAR, ISV', eco: 'NetSuite, Microsoft', retainer: 120000, performance: 60000, tcv: 180000,
    stage: 'Closed Lost', close: md(12, 1),
    notes: [{ date: IMPORT_DATE, body: 'Looks like a Q4 opportunity.' }],
    forecast: 'upside',
    forecastNote: 'AlphaBold went well. Interest in both ISV representation of their BuildFitters product and VAR services. Thinking of packaging them both together ($15k value) and providing for $10k retainer + outcomes. We may fly out the week of the 20th to seal the deal. (Naomi and Chris TBD)',
  },
  {
    slug: 'subcontractor-hub', owner: 'Ben Bassett', name: 'Subcontractor Hub', product: 'Solar proposal and CRM',
    bu: 'ISV Services', type: 'ISV', eco: 'Other', retainer: 90000, performance: 45000, tcv: 135000,
    stage: 'Deferred', close: md(12, 15),
    notes: [{ date: md(8, 26), body: 'Called Kronwald, lvm' }],
    activities: [{ type: 'call', subject: 'Called Kronwald — left voicemail', due: md(8, 26), done: true }],
    contacts: [{ name: 'Kronwald' }],
  },
  {
    slug: 'journyx', owner: 'Danica Weappa', name: 'Journyx', product: 'Time Keeping',
    bu: 'ISV Services', type: 'ISV', eco: 'Sage, Microsoft', retainer: null, performance: null, tcv: 0,
    stage: 'Deferred', close: md(3, 31, 2027),
    notes: [{ date: IMPORT_DATE, body: "Deferred. No budget in 2026. Let's discuss in December when we know our 2027 budget." }],
    activities: [{ type: 'call', subject: 'Revisit once 2027 budget is known', due: md(12, 1) }],
  },
  {
    slug: 'omzy', owner: 'Naomi Marti', name: 'Omzy', product: 'Project Management',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: null, performance: null, tcv: 0,
    stage: 'Cold Prospect', close: md(10, 31),
    notes: [{ date: md(9, 8), body: 'No response to all outreach 8/13, 8/17, 9/8 - multiple LinkedIn pings' }],
    activities: [
      { type: 'email', subject: 'Outreach', due: md(8, 13), done: true },
      { type: 'email', subject: 'Outreach', due: md(8, 17), done: true },
      { type: 'email', subject: 'LinkedIn ping', due: md(9, 8), done: true },
    ],
  },
  {
    slug: 'timecharge', owner: 'Ben Bassett', name: 'Timecharge', product: 'Power Charging Hardware',
    bu: 'ISV Services', type: 'Other', eco: 'Other', retainer: null, performance: null, tcv: 0,
    stage: 'Closed Won', close: '',
    notes: [{ date: md(8, 26), body: "Ben is intro'ing TimeCharge to some new VC firms. Also setting them up with Lightsmith for recurring revenue" }],
  },
  {
    slug: 'anchor-group', owner: 'Ben Bassett', name: 'Anchor Group', product: '',
    bu: 'VAR Services', type: 'VAR', eco: 'NetSuite', retainer: null, performance: null, tcv: 0,
    stage: 'Closed Won', close: '',
    notes: [{ date: md(8, 26), body: 'Ben is working through the leads analysis' }],
  },
  {
    slug: 'summit-stream', owner: 'Jenn Andreas', name: 'Summit Stream / Project Stream', product: 'Project Management',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: 90000, performance: null, tcv: 90000,
    stage: 'Closed Lost', close: '',
    notes: [{ date: md(8, 5), body: 'David reaching out 8/5' }],
  },
  {
    slug: 'border-foods', owner: 'Max Robbins', name: 'Border Foods', product: 'Franchisor',
    bu: 'AI - Enterprise', type: 'Other', eco: 'Other', retainer: null, performance: 25000, tcv: 25000,
    stage: 'Closed Lost', close: '',
    notes: [{ date: IMPORT_DATE, body: 'Decided to move forward with current IT Vendor' }],
    lostReason: 'Went with current IT vendor',
    forecast: 'forecast', forecastNote: 'Decision to do project then support contract. Verbal. (Proposal, close 7/24, $36k / $25k)',
  },
  {
    slug: 'growthstream', owner: 'Ben Bassett', name: 'Growthstream',
    product: 'Human-language business analytics for manufacturers and distributors',
    bu: 'ISV Services', type: 'ISV', eco: 'NetSuite', retainer: null, performance: null, tcv: 0,
    stage: 'Closed Lost', close: '',
    notes: [{
      date: md(7, 20),
      body: "Initially met at midwest NSUG. Ben getting coffee for quick discovery on July 20. Company needs to be PLG at their current price point. Can't afford Ecolens based on what they are charging for their product.",
    }],
    lostReason: "Can't afford Ecolens at their price point (needs PLG)",
    activities: [{ type: 'lunch', subject: 'Coffee / quick discovery', due: md(7, 20), done: true }],
  },
  {
    slug: 'vertical-bar', owner: 'Ben Bassett', name: 'Vertical Bar', product: 'DevOps for NetSuite',
    bu: 'ISV Services', type: 'ISV', eco: 'NetSuite', retainer: null, performance: null, tcv: 0,
    stage: 'Closed Lost', close: '',
    notes: [{ date: IMPORT_DATE, body: 'Ben to reach out to Sol (CEO). Note via LinkedIn sent.' }],
    contacts: [{ name: 'Sol', title: 'CEO' }],
  },
  {
    slug: 'wavetec', owner: 'Naomi Marti', name: 'Wavetec', product: '',
    bu: 'ISV Services', type: 'ISV', eco: '', retainer: null, performance: null, tcv: 0,
    stage: 'Closed Lost', close: '',
    notes: [{ date: IMPORT_DATE, body: 'Strategizing entry point with Naomi' }],
  },
  {
    slug: 'hytec', owner: 'Naomi Marti', name: 'Hytec', product: '',
    bu: '', type: '', eco: '', retainer: null, performance: null, tcv: 0,
    stage: 'Closed Lost', close: '',
    notes: [{ date: IMPORT_DATE, body: 'Waiting for the right timing' }],
  },
  {
    slug: 'cap-consulting', owner: 'Danica Weappa', name: 'CAP Consulting', product: 'Data and analytics platform for CRE',
    bu: '', type: '', eco: '', retainer: null, performance: null, tcv: 0,
    stage: 'Cold Prospect', close: '',
    notes: [{ date: IMPORT_DATE, body: 'Danica asked David for cold outreach examples' }],
  },
  {
    slug: 'greenshades', owner: 'Danica Weappa', name: 'Greenshades', product: 'Payroll',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: null, performance: null, tcv: null,
    stage: 'Cold Prospect', close: '',
    notes: [{
      date: IMPORT_DATE,
      body: "Is trying to rebuild its partner channel. Joe Pritchard has reportedly been given broader responsibility for partnerships. David Gersten or Naomi Marti can one of you work this one? I can't, it's my former employer.",
    }],
    contacts: [{ name: 'Joe Pritchard', title: 'Partnerships' }],
    tags: ['Needs new owner'],
  },
  {
    slug: 'yaveon', owner: 'Naomi Marti', name: 'Yaveon', product: 'ERP & Manufacturing',
    bu: 'ISV Services', type: 'ISV', eco: 'Microsoft', retainer: null, performance: null, tcv: null,
    stage: 'Introduction Made', close: md(10, 31),
    notes: [
      { date: md(9, 8), body: 'Emailed follow-up 8/26, and 9/1, 9/8 - waiting for response.' },
      { date: md(8, 25), body: 'Talked with Bob Buresh 8/25. Next step: set up a call to include George and Brittany and the Ecolens team to talk through our value prop.' },
    ],
    activities: [
      { type: 'call', subject: 'Talked with Bob Buresh', due: md(8, 25), done: true },
      { type: 'email', subject: 'Emailed follow-up', due: md(8, 26), done: true },
      { type: 'email', subject: 'Emailed follow-up', due: md(9, 1), done: true },
      { type: 'email', subject: 'Emailed follow-up', due: md(9, 8), done: true },
      { type: 'task', subject: 'Set up value-prop call with George, Brittany + Ecolens team', due: md(9, 15), note: 'Waiting on Yaveon to respond first.' },
    ],
    contacts: [{ name: 'Bob Buresh' }, { name: 'George' }, { name: 'Brittany' }],
  },
  {
    slug: 'revenova', owner: 'Chris McDonald', name: 'Revenova', product: 'TMS',
    bu: 'ISV Services', type: 'ISV', eco: 'Other', retainer: null, performance: null, tcv: null,
    stage: 'Cold Prospect', close: md(11, 15),
    notes: [{ date: IMPORT_DATE, body: 'Meet with Mike Berg next week. 9/15' }],
    activities: [{ type: 'meeting', subject: 'Meet with Mike Berg', due: md(9, 15) }],
    contacts: [{ name: 'Mike Berg' }],
  },
  {
    slug: 'miter', owner: 'Chris McDonald', name: 'Miter', product: 'HCM for Construction',
    bu: 'ISV Services', type: 'ISV', eco: 'Other, Acumatica, NetSuite, Sage', retainer: null, performance: null, tcv: null,
    stage: 'Cold Prospect', close: md(11, 15),
    notes: [{ date: IMPORT_DATE, body: 'Working to get in touch with Chase, VP of Sales' }],
    contacts: [{ name: 'Chase', title: 'VP of Sales' }],
  },
  // Only on the Forecast/Upside tab, not on the main pipeline tab.
  {
    slug: 'business-fitness', owner: 'Max Robbins', name: 'Business Fitness', product: '',
    bu: 'VAR Services', type: '', eco: '', retainer: 30000, performance: null, tcv: 30000,
    stage: 'Proposal', close: md(7, 30),
    notes: [{ date: IMPORT_DATE, body: 'Imported from the Forecast tab only — this row is not on the main pipeline tab. Confirm current status.' }],
    forecast: 'forecast',
    forecastNote: 'Ben and Max getting breakfast with Dave Hynek on 7/17. Pitching fractional partner marketing line item of VAR menu. I.e. Max coordinated Midwest NSUG.',
    activities: [{ type: 'lunch', subject: 'Breakfast with Dave Hynek (Ben + Max)', due: md(7, 17), done: true }],
    contacts: [{ name: 'Dave Hynek' }],
    tags: ['Forecast tab only'],
  },
]

const splitList = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && x !== 'Select One or More')

const addMonths = (iso: string, months: number): string => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + months, d))
  return date.toISOString().slice(0, 10)
}

export function seedData(): AppData {
  const deals: Deal[] = []
  const notes: Note[] = []
  const activities: Activity[] = []
  const contacts: Contact[] = []
  const snapshots = new Map(rowsFromCsv(SHEET_CSV_2026_09_08).map((r) => [sheetKeyOf(r.name), r]))

  for (const row of ROWS) {
    const id = `d-${row.slug}`
    const snapshot = snapshots.get(sheetKeyOf(row.name)) ?? null
    const ownerId = OWNER[row.owner]
    const stageId = STAGE[row.stage]
    const sum = (row.retainer ?? 0) + (row.performance ?? 0)
    const won = stageId === 's-won'
    deals.push({
      id,
      title: row.name,
      ownerId,
      stageId,
      product: row.product,
      businessUnits: splitList(row.bu),
      partnerTypes: splitList(row.type),
      ecosystems: splitList(row.eco),
      retainerAcv: row.retainer,
      performanceAcv: row.performance,
      tcvOverride: row.tcv !== null && row.tcv !== sum ? row.tcv : null,
      valueTbd: Boolean(row.tbd),
      closeDate: row.close,
      renewalDate: won && row.close ? addMonths(row.close, 12) : '',
      contractTermMonths: 12,
      forecast: row.forecast ?? '',
      lostReason: row.lostReason ?? '',
      tags: row.tags ?? [],
      createdAt: CREATED_AT,
      source: 'sheet',
      sheetKey: snapshot ? sheetKeyOf(row.name) : '',
      sheetSnapshot: snapshot,
    })
    row.notes.forEach((n, i) => {
      notes.push({
        id: `n-${row.slug}-${i}`,
        dealId: id,
        body: n.body,
        authorId: ownerId,
        date: n.date,
        createdAt: `${n.date}T12:00:00.000Z`,
      })
    })
    if (row.forecastNote) {
      notes.push({
        id: `n-${row.slug}-forecast`,
        dealId: id,
        body: `Forecast tab (${row.forecast ?? 'forecast'}): ${row.forecastNote}`,
        authorId: ownerId,
        date: FORECAST_TAB_DATE,
        createdAt: `${FORECAST_TAB_DATE}T12:00:00.000Z`,
      })
    }
    ;(row.activities ?? []).forEach((a, i) => {
      activities.push({
        id: `a-${row.slug}-${i}`,
        dealId: id,
        type: a.type,
        subject: a.subject,
        dueDate: a.due,
        done: Boolean(a.done),
        ownerId,
        note: a.note ?? '',
        createdAt: CREATED_AT,
      })
    })
    ;(row.contacts ?? []).forEach((c, i) => {
      contacts.push({
        id: `c-${row.slug}-${i}`,
        name: c.name,
        title: c.title ?? '',
        organization: row.name,
        dealId: id,
        email: '',
        phone: '',
        note: c.note ?? 'Named in the pipeline sheet notes.',
      })
    })
  }

  const dashboards: Dashboard[] = [
    { id: 'dash-overview', name: 'Sales overview' },
    { id: 'dash-revenue', name: 'Revenue & renewals' },
  ]

  const w = (
    id: string,
    dashboardId: string,
    title: string,
    partial: Partial<Widget>,
  ): Widget => ({
    id,
    dashboardId,
    title,
    type: 'kpi',
    metric: 'tcv',
    scope: 'open',
    groupBy: 'stage',
    listKind: 'renewals',
    size: 'sm',
    limit: 8,
    ...partial,
  })

  const widgets: Widget[] = [
    w('w-open', 'dash-overview', 'Open pipeline', { type: 'kpi', metric: 'tcv', scope: 'open' }),
    w('w-weighted', 'dash-overview', 'Weighted pipeline', { type: 'kpi', metric: 'weighted', scope: 'open' }),
    w('w-won', 'dash-overview', 'Won revenue (2026)', { type: 'kpi', metric: 'tcv', scope: 'wonThisYear' }),
    w('w-customers', 'dash-overview', 'Customers won', { type: 'kpi', metric: 'count', scope: 'won' }),
    w('w-winrate', 'dash-overview', 'Win rate', { type: 'kpi', metric: 'winRate', scope: 'closed' }),
    w('w-avg', 'dash-overview', 'Avg. won deal', { type: 'kpi', metric: 'avg', scope: 'won' }),
    w('w-q', 'dash-overview', 'Closing this quarter', { type: 'kpi', metric: 'tcv', scope: 'closingThisQuarter' }),
    w('w-opencount', 'dash-overview', 'Open deals', { type: 'kpi', metric: 'count', scope: 'open' }),
    w('w-bystage', 'dash-overview', 'Open pipeline by stage', { type: 'bar', metric: 'tcv', scope: 'open', groupBy: 'stage', size: 'md' }),
    w('w-byowner', 'dash-overview', 'Open pipeline by owner', { type: 'bar', metric: 'tcv', scope: 'open', groupBy: 'owner', size: 'md' }),
    w('w-bymonth', 'dash-overview', 'Expected close by month', { type: 'bar', metric: 'tcv', scope: 'open', groupBy: 'closeMonth', size: 'md' }),
    w('w-byeco', 'dash-overview', 'Open deals by ecosystem', { type: 'donut', metric: 'count', scope: 'open', groupBy: 'ecosystem', size: 'md' }),
    w('w-next', 'dash-overview', 'Next activities', { type: 'list', listKind: 'nextActivities', size: 'md', limit: 8 }),
    w('w-overdue', 'dash-overview', 'Overdue activities', { type: 'list', listKind: 'overdue', size: 'md', limit: 8 }),

    w('w-r-won', 'dash-revenue', 'Won contract value', { type: 'kpi', metric: 'tcv', scope: 'won' }),
    w('w-r-ret', 'dash-revenue', 'Won retainer ACV', { type: 'kpi', metric: 'retainer', scope: 'won' }),
    w('w-r-perf', 'dash-revenue', 'Won performance ACV', { type: 'kpi', metric: 'performance', scope: 'won' }),
    w('w-r-lost', 'dash-revenue', 'Lost contract value', { type: 'kpi', metric: 'tcv', scope: 'lost' }),
    w('w-r-renewals', 'dash-revenue', 'Upcoming renewals', { type: 'list', listKind: 'renewals', size: 'md', limit: 10 }),
    w('w-r-wonowner', 'dash-revenue', 'Won revenue by owner', { type: 'bar', metric: 'tcv', scope: 'won', groupBy: 'owner', size: 'md' }),
    w('w-r-wonmonth', 'dash-revenue', 'Won revenue by close month', { type: 'bar', metric: 'tcv', scope: 'won', groupBy: 'closeMonth', size: 'md' }),
    w('w-r-lostby', 'dash-revenue', 'Lost deals by ecosystem', { type: 'donut', metric: 'count', scope: 'lost', groupBy: 'ecosystem', size: 'md' }),
    w('w-r-top', 'dash-revenue', 'Largest open deals', { type: 'table', listKind: 'topOpen', size: 'lg', limit: 10 }),
  ]

  const meta: Meta[] = [
    {
      id: 'sync',
      lastSheetSyncAt: `${IMPORT_DATE}T09:00:00.000Z`,
      lastSheetSyncSummary: 'Initial import: 46 rows',
      lastSheetSyncBy: 'import',
      autoSync: true,
    },
  ]

  return {
    people: PEOPLE,
    stages: STAGES,
    deals,
    notes,
    activities,
    contacts,
    dashboards,
    widgets,
    meta,
  }
}
