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
  const statement = parsePeriod_(sheet.getDataRange().getValues(), ctx.target.name);
  statement.person = ctx.target.name;
  statement.period = periodName;
  return statement;
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
  return { viewer: viewer || target, target: target, isAdmin: isAdmin };
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

/**
 * values: 2D array from the period tab. Blocks look like:
 *   "<Client> - Retainer" | retainer fee
 *   "Variable"            | optional variable revenue
 *   "<Person>"            | (blank) | % | payout     (one row per person, incl. Ecolens)
 *   (blank row ends the block)
 */
function parsePeriod_(values, personName) {
  const want = personName.toLowerCase();
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
    } else if (block && label.toLowerCase() === want) {
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
    if (String(header[c]).trim().toLowerCase() === want) { total = round2_(num_(totals[c])); break; }
  }
  if (total === null) total = blockTotal;

  return { lines: lines, blockTotal: blockTotal, other: round2_(total - blockTotal), total: total };
}
