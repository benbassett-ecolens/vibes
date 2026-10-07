/**
 * Team payout portal.
 *
 * Runs as the sheet owner (so the master sheet stays restricted), identifies the
 * signed-in viewer by their Workspace email, and returns ONLY that person's
 * payout lines. Nothing about other people is ever sent to the browser.
 */

// ---- Configuration ---------------------------------------------------------
const SHEET_ID = 'PASTE_MASTER_SHEET_ID_HERE';
const ADMIN_EMAILS = ['ben@ecolens.io'];       // may use "View as" for any teammate
const TEAM_TAB = 'Team';                       // columns: Name | Email
const PERIOD_TAB_PATTERN = /^\d{8} Retainer\/variable payout$/; // e.g. "20261015 Retainer/variable payout"
const HEADER_ROW = 1;                          // row holding person names in the right-hand summary
const TOTALS_ROW = 2;                          // row holding each person's total payout
const SUMMARY_FIRST_COL = 6;                   // column F (1-based) where person columns start
const LEDGER_TAB = 'AI Ledger';                // running AI-line ledger (see README)
// Sidebar "Client revenue": 'mine' = only clients the viewer is on; 'all' = every client for everyone.
// Admins viewing their own page always see all clients.
const CLIENT_PANEL_SCOPE = 'mine';

// ---- Web app entry ---------------------------------------------------------
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('My Payout')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // allow embedding in Google Sites
}

// ---- API called from the page ----------------------------------------------
function getBootstrap() {
  const ctx = resolveViewer_(null);
  return {
    viewer: { name: ctx.viewer.name, isAdmin: ctx.isAdmin },
    people: ctx.isAdmin ? readTeam_().map(function (p) { return p.name; }) : [],
    periods: listPeriods_(),
  };
}

function getStatement(periodName, asName) {
  const ctx = resolveViewer_(asName);
  const periods = listPeriods_();
  if (!periods.some(function (p) { return p.name === periodName; })) {
    throw new Error('Unknown period.');
  }
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(periodName);
  const values = sheet.getDataRange().getValues();
  const statement = parsePeriod_(values, ctx.target.name);
  const showAll = CLIENT_PANEL_SCOPE === 'all' || (ctx.isAdmin && ctx.selfView);
  statement.clients = parseClients_(values, ctx.target.name, showAll);
  statement.person = ctx.target.name;
  statement.period = periodName;
  return statement;
}

function getAiStatement(asName) {
  const ctx = resolveViewer_(asName);
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(LEDGER_TAB);
  if (!sheet) return { enabled: false, months: [] };
  const tz = ss.getSpreadsheetTimeZone();
  return parseLedger_(sheet.getDataRange().getValues(), ctx.target.name, function (d) {
    return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  });
}

// ---- Identity --------------------------------------------------------------
function resolveViewer_(asName) {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Could not identify you. Sign in with your company Google account.');
  const team = readTeam_();
  const viewer = team.filter(function (p) { return p.email === email; })[0];
  const isAdmin = ADMIN_EMAILS.map(function (e) { return e.toLowerCase(); }).indexOf(email) !== -1;
  if (!viewer && !isAdmin) throw new Error('You are not set up for payout reporting. Contact Ben.');
  let target = viewer;
  if (asName) {
    if (!isAdmin) throw new Error('Not allowed.');          // never honour "view as" for non-admins
    target = team.filter(function (p) { return p.name === asName; })[0];
    if (!target) throw new Error('Unknown teammate.');
  }
  if (!target) throw new Error('Your email is not on the Team tab.');
  const selfView = !asName || (!!viewer && asName === viewer.name);
  return { viewer: viewer || target, target: target, isAdmin: isAdmin, selfView: selfView };
}

function readTeam_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TEAM_TAB);
  if (!sheet) throw new Error('Missing "' + TEAM_TAB + '" tab in the master sheet.');
  return sheet.getDataRange().getValues().slice(1)
    .map(function (r) { return { name: String(r[0]).trim(), email: String(r[1]).trim().toLowerCase() }; })
    .filter(function (p) { return p.name && p.email; });
}

function listPeriods_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return PERIOD_TAB_PATTERN.test(n); })
    .sort().reverse()
    .map(function (n) {
      const d = n.slice(0, 8);
      return { name: n, date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) };
    });
}

// ---- Parsing (pure; unit-tested in test.js) --------------------------------
function num_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function round2_(n) { return Math.round(n * 100) / 100; }

// Tabs use first names ("David"), the Team tab may use full names ("David Gersten"): accept either.
function aliases_(name) {
  const full = String(name).trim().toLowerCase();
  return [full, full.split(/\s+/)[0]];
}

/**
 * values: 2D array from the period tab. Blocks look like:
 *   "<Client> - Retainer" | retainer fee
 *   "Variable"            | optional variable revenue
 *   "<Person>"            | (blank) | % | payout     (one row per person, incl. Ecolens)
 *   (blank row ends the block)
 */
function parsePeriod_(values, personName) {
  const want = aliases_(personName);
  const lines = [];
  let block = null;
  let unnamed = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const label = String(row[0] || '').trim();
    if (!label) { block = null; continue; }

    const retainer = label.match(/^(.*?)\s*-\s*Retainer$/i);
    if (retainer) {
      block = { client: retainer[1].trim(), basis: num_(row[1]) };
    } else if (/^variable$/i.test(label)) {
      if (!block) block = { client: 'Unnamed client ' + (++unnamed), basis: 0 };
      block.basis += num_(row[1]);
    } else if (block && want.indexOf(label.toLowerCase()) !== -1) {
      const payout = num_(row[3]);
      if (payout !== 0) {
        lines.push({ client: block.client, basis: round2_(block.basis), pct: num_(row[2]), payout: round2_(payout) });
      }
    }
  }

  const blockTotal = round2_(lines.reduce(function (s, l) { return s + l.payout; }, 0));

  // The sheet's own per-person total (right-hand summary) is the source of truth.
  let total = null;
  const header = values[HEADER_ROW - 1] || [];
  const totals = values[TOTALS_ROW - 1] || [];
  for (let c = SUMMARY_FIRST_COL - 1; c < header.length; c++) {
    if (want.indexOf(String(header[c]).trim().toLowerCase()) !== -1) { total = round2_(num_(totals[c])); break; }
  }
  if (total === null) total = blockTotal;

  return { lines: lines, blockTotal: blockTotal, other: round2_(total - blockTotal), total: total };
}

/**
 * Column B revenue per client for the period: one retainer amount and one variable amount.
 * Blocks with no revenue are skipped. Unless showAll, only blocks the person appears in.
 */
function parseClients_(values, personName, showAll) {
  const want = aliases_(personName);
  const blocks = [];
  let block = null;
  let unnamed = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const label = String(row[0] || '').trim();
    if (!label) { block = null; continue; }

    const retainer = label.match(/^(.*?)\s*-\s*Retainer$/i);
    if (retainer) {
      block = { client: retainer[1].trim(), retainer: num_(row[1]), variable: 0, mine: false };
      blocks.push(block);
    } else if (/^variable$/i.test(label)) {
      if (!block) {
        block = { client: 'Unnamed client ' + (++unnamed), retainer: 0, variable: 0, mine: false };
        blocks.push(block);
      }
      block.variable += num_(row[1]);
    } else if (block && want.indexOf(label.toLowerCase()) !== -1) {
      block.mine = true;
    }
  }

  const lines = blocks
    .filter(function (b) { return (b.retainer !== 0 || b.variable !== 0) && (showAll || b.mine); })
    .map(function (b) {
      return { client: b.client, retainer: round2_(b.retainer), variable: round2_(b.variable), total: round2_(b.retainer + b.variable) };
    });
  const total = round2_(lines.reduce(function (s, l) { return s + l.total; }, 0));
  return { lines: lines, total: total, scope: showAll ? 'all' : 'mine' };
}

/**
 * AI Ledger tab: one row per payout line. Columns are found by header name:
 *   Date | Customer | Revenue type | Person | Basis | % | Amount | Status | Paid date
 * Status "Paid" counts as paid; anything else counts as owed.
 */
function parseLedger_(values, personName, fmtDate) {
  const empty = { enabled: true, earned: 0, paid: 0, owed: 0, months: [] };
  if (!values.length) return empty;
  const head = values[0].map(function (h) { return String(h).trim().toLowerCase(); });
  const col = {
    date: head.indexOf('date'), customer: head.indexOf('customer'), type: head.indexOf('revenue type'),
    person: head.indexOf('person'), basis: head.indexOf('basis'), pct: head.indexOf('%'),
    amount: head.indexOf('amount'), status: head.indexOf('status'), paidDate: head.indexOf('paid date'),
  };
  if (col.person < 0 || col.amount < 0 || col.status < 0) {
    throw new Error('AI Ledger needs Person, Amount and Status columns.');
  }
  const want = aliases_(personName);
  const get = function (row, i) { return i < 0 ? '' : row[i]; };
  const dateStr = function (v) { return Object.prototype.toString.call(v) === '[object Date]' ? fmtDate(v) : String(v || '').trim(); };

  const byMonth = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (want.indexOf(String(get(row, col.person)).trim().toLowerCase()) === -1) continue;
    const amount = round2_(num_(get(row, col.amount)));
    if (amount === 0) continue;
    const date = dateStr(get(row, col.date));
    const month = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : 'Undated';
    const paid = String(get(row, col.status)).trim().toLowerCase() === 'paid';
    const m = byMonth[month] || (byMonth[month] = { month: month, earned: 0, paid: 0, owed: 0, lines: [] });
    m.lines.push({
      date: date,
      customer: String(get(row, col.customer)).trim(),
      type: String(get(row, col.type)).trim(),
      basis: round2_(num_(get(row, col.basis))),
      pct: num_(get(row, col.pct)),
      amount: amount,
      status: paid ? 'paid' : 'owed',
      paidDate: dateStr(get(row, col.paidDate)),
    });
    m.earned = round2_(m.earned + amount);
    if (paid) m.paid = round2_(m.paid + amount); else m.owed = round2_(m.owed + amount);
  }

  const months = Object.keys(byMonth).sort().reverse().map(function (k) {
    byMonth[k].lines.sort(function (a, b) { return (a.status === b.status ? 0 : a.status === 'owed' ? -1 : 1); }); // owed first
    return byMonth[k];
  });
  const sum = function (f) { return round2_(months.reduce(function (s, m) { return s + m[f]; }, 0)); };
  return { enabled: true, earned: sum('earned'), paid: sum('paid'), owed: sum('owed'), months: months };
}
