// Run: node test.cjs   (parser sanity check against a synthetic grid shaped like the master sheet)
const fs = require('fs');
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8') + '\nthis.parsePeriod_ = parsePeriod_; this.parseLedger_ = parseLedger_; this.parseClients_ = parseClients_; this.parsePayments_ = parsePayments_;', ctx);
const assert = require('assert');

const R = (a, b, c, d) => [a, b, c, d, '', '', '', '', '', '', '', '', ''];
const grid = [
  ['', 'Monthly Retainer Fee Received', "Contractor's %", 'Payout', '', 'Max', 'Ben', 'David', 'Danica', 'Chris', 'Naomi', 'Brittany', 'Microsoft Hire #3'],
  ['Alpha - Retainer', 10000, '', '', '', 1500, 500, 1300, 0, 0, 0, 0, 0],
  ['Variable', 1000, '', ''],
  ['Max', '', 0.1, 1100],
  ['David', '', 0.2, 2200],
  ['Ecolens', '', 0.2, 2200],
  ['', '', '', ''],
  ['Beta - Retainer', 5000, '', ''],
  ['Variable', '', '', ''],
  ['David', '', 0.1, 500],
  ['Ecolens', '', 0.2, 1000],
  ['', '', '', ''],
  ['', '', '', ''],
  ['Variable', '', '', ''],
  ['David', '', 0.1, 0],
  ['', '', '', ''],
  ['Gamma - Retainer', 3000, '', ''],
  ['Variable', '', '', ''],
  ['David', '', 0.1, -200],
].map((r) => r.concat(Array(13).fill('')).slice(0, 13));
// right-hand totals live in row 2 (index 1); fix David's to match: 2200 + 500 - 200 = 2500
grid[1][7] = 2500;

let d = ctx.parsePeriod_(grid, 'David');
assert.strictEqual(d.lines.length, 3);
assert.strictEqual(d.blockTotal, 2500);
assert.strictEqual(d.total, 2500);
assert.strictEqual(d.other, 0);
assert.strictEqual(d.lines[0].basis, 11000);          // retainer + variable
assert.strictEqual(d.lines[2].payout, -200);          // clawback shows as negative

let m = ctx.parsePeriod_(grid, 'Max');                 // total in summary exceeds block payout
assert.strictEqual(m.blockTotal, 1100);
assert.strictEqual(m.total, 1500);
assert.strictEqual(m.other, 400);

let b = ctx.parsePeriod_(grid, 'Ben');                 // no block rows, only a summary total
assert.strictEqual(b.lines.length, 0);
assert.strictEqual(b.total, 500);
assert.strictEqual(b.other, 500);

let c = ctx.parsePeriod_(grid, 'Chris');
assert.strictEqual(JSON.stringify([c.lines.length, c.total]), '[0,0]');
// Team tab may hold full names while payout tabs use first names
assert.strictEqual(ctx.parsePeriod_(grid, 'David Gersten').total, 2500);
assert.strictEqual(ctx.parsePeriod_(grid, 'David Gersten').lines.length, 3);

// AI ledger
const ledger = [
  ['Date', 'Customer', 'Revenue type', 'Person', 'Basis', '%', 'Amount', 'Status', 'Paid date'],
  ['2026-10-15', 'Acme', 'Build out fee', 'Elevome', 1000, 0.4, 400, 'Owed', ''],
  ['2026-10-15', 'Acme', 'Build out fee', 'David Gersten', 1000, 0.1, 100, 'Paid', '2026-11-01'],
  ['2026-10-15', 'Acme', 'Build out fee', 'Ben Bassett', 1000, 0.25, 250, 'Owed', ''],
  [new Date(Date.UTC(2026, 10, 20)), 'Acme', 'License', 'David', 2000, 0.1, 200, 'Owed', ''],
  ['2026-11-20', 'Beta', 'License', 'David', 500, 0.1, 0, 'Owed', ''],
];
const fmtDate = (d) => d.toISOString().slice(0, 10);
let l = ctx.parseLedger_(ledger, 'David Gersten', fmtDate);
assert.strictEqual(JSON.stringify([l.earned, l.paid, l.owed]), '[300,100,200]');
assert.strictEqual(JSON.stringify(l.months.map((x) => x.month)), '["2026-11","2026-10"]');   // newest first
assert.strictEqual(l.months[0].lines[0].date, '2026-11-20');                     // Date cells formatted
assert.strictEqual(l.months[1].lines[0].paidDate, '2026-11-01');
let bl = ctx.parseLedger_(ledger, 'Ben Bassett', fmtDate);
assert.strictEqual(JSON.stringify([bl.earned, bl.paid, bl.owed]), '[250,0,250]');
assert.strictEqual(ctx.parseLedger_(ledger, 'Naomi Marti', fmtDate).months.length, 0);
assert.throws(() => ctx.parseLedger_([['Date', 'Person']], 'X', fmtDate));
// owed lines sort ahead of paid lines within a month
ledger.push(['2026-10-01', 'Z', '', 'Zed', 100, 0.1, 10, 'Paid', '2026-10-02']);
ledger.push(['2026-10-02', 'Z', '', 'Zed', 100, 0.1, 20, 'Owed', '']);
const z = ctx.parseLedger_(ledger, 'Zed', fmtDate);
assert.strictEqual(JSON.stringify(z.months[0].lines.map((x) => x.status)), '["owed","paid"]');

// Client revenue sidebar: one retainer + one variable amount per client
let cm = ctx.parseClients_(grid, 'Max Robbins', false);          // Max is only on Alpha
assert.strictEqual(cm.lines.length, 1);
assert.strictEqual(JSON.stringify([cm.lines[0].client, cm.lines[0].retainer, cm.lines[0].variable, cm.lines[0].total]), '["Alpha",10000,1000,11000]');
assert.strictEqual(ctx.parseClients_(grid, 'Ben Bassett', false).lines.length, 0);   // Ben is in no block
let ca = ctx.parseClients_(grid, 'Ben Bassett', true);            // admin view: everything with revenue
assert.strictEqual(JSON.stringify(ca.lines.map((x) => x.client)), '["Alpha","Beta","Gamma"]');  // unnamed $0 block skipped
assert.strictEqual(ca.total, 19000);
assert.strictEqual(ca.scope, 'all');
// Retainer payments: filtered by person + pay period, partial payments add up
const pay = [
  ['Pay period', 'Person', 'Amount', 'Paid date', 'Note'],
  ['2026-10-15', 'David Gersten', 500, '2026-10-20', 'first half'],
  [new Date(Date.UTC(2026, 9, 15)), 'David', 250, new Date(Date.UTC(2026, 9, 25)), ''],
  ['20261015', 'david gersten', 100, '', 'text period'],
  ['2026-09-15', 'David Gersten', 999, '2026-09-20', 'other period'],
  ['2026-10-15', 'Naomi Marti', 700, '', ''],
];
let pd = ctx.parsePayments_(pay, 'David Gersten', '2026-10-15', fmtDate);
assert.strictEqual(pd.paid, 850);
assert.strictEqual(pd.lines.length, 3);
assert.strictEqual(pd.lines[1].date, '2026-10-25');
assert.strictEqual(ctx.parsePayments_(pay, 'Chris McDonald', '2026-10-15', fmtDate).paid, 0);
assert.throws(() => ctx.parsePayments_([['Person', 'Amount']], 'X', '2026-10-15', fmtDate));
console.log('ok');
