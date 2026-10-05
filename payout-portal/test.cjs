// Run: node test.cjs   (parser sanity check against a synthetic grid shaped like the master sheet)
const fs = require('fs');
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8') + '\nthis.parsePeriod_ = parsePeriod_;', ctx);
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
assert.deepStrictEqual([c.lines.length, c.total], [0, 0]);
console.log('ok');
