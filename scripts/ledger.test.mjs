// Tests for the Auction Ledger's balance (src/lib/contextAnalytics.ts, view 1).
//
// Loads src/lib the same way shopping-list.test.mjs does — copied to a temp
// directory with `.ts` appended to sibling imports and run through node's own
// type stripping. Nothing in the repo is written to.
//
// Every input here is SYNTHETIC. Nothing counts or sums a shipped CSV, because
// a test pinned to a shipped file's numbers blocks the workbook from publishing
// (see the publish-check memory); the shapes below are the real auctions the
// rule was argued from, with their figures copied in by hand.
//
// What it pins:
//
//   the goal offset's sign and baseline   the customary goal, not the order cost
//   a released fee is paid for by the     20274's shape: GT credited, $500 goal
//     $8,000 goal it comes with             debited, and neither is lost
//   a goal BELOW custom is a contribution 20275's shape: short without it
//   no single-order goal ⇒ no offset      blank, and the pooled $10,250 (20251)
//   which auctions the ledger lists       goal-only rows join when CLOSED, never
//                                         while open
//   Grunnel stays out unless asked        the toggle adds it on top of the offset
//   the aggregate carries the offset      and a null offset sums as $0
//
// Run: node scripts/ledger.test.mjs

import { readFileSync, mkdtempSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok    ${name}`); pass++; return; }
  console.error(`  FAIL  ${name}`);
  if (detail !== undefined) console.error('        ' + String(detail));
  fail++;
};
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.005;

// --- load src/lib through node's type stripping ---------------------------

const work = mkdtempSync(join(tmpdir(), 'ledger-test-'));
let an, ERAS;
try {
  const src = join(repo, 'src', 'lib');
  mkdirSync(join(work, 'lib'), { recursive: true });
  for (const f of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(src, f), 'utf8')
      .replace(/(\bfrom\s+'\.\/[A-Za-z0-9_]+)'/g, "$1.ts'");
    writeFileSync(join(work, 'lib', f), text);
  }
  const url = (f) => pathToFileURL(join(work, 'lib', f)).href;
  an = await import(url('contextAnalytics.ts'));
  ({ ERAS } = await import(url('eras.ts')));
} catch (e) {
  console.error('could not load src/lib:', e.message);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const { auctionLedger, ledgerBalanceOf, ledgerOverall, goalOffsetOf } = an;

// --- fixtures --------------------------------------------------------------

let n = 0;
const meta = (id, targetFunding, status = 'Closed') => ({
  auctionId: id, season: '2027', auctionNumber: ++n, name: `Auction ${id}`,
  auctioneer: `Auctioneer ${id}`, source: 'Forum', status, targetFunding,
});
const ctx = (released, augment, withheld, grunnel = 0) =>
  ({ released, augment, grunnel, withheld, augmentedTotal: released + augment + grunnel + withheld });

const M = [
  meta('custom', 7500),            // the custom: nothing to offset
  meta('gtIn', 8000),              // 20274: GT released, $8,000 goal
  meta('below', 6750),             // 20275: fee kept, goal below custom
  meta('pooled', 10250),           // 20251: several orders in one auction
  meta('blank', null),
  meta('goalOnly', 7150),          // no context rows at all, closed
  meta('goalOnlyCustom', 7500),    // no context, customary goal
  meta('openGoalOnly', 8000, 'Open'),
  meta('openWithCtx', 8000, 'Open'),
  meta('grunnel', 8000),
];
const C = new Map([
  ['custom', ctx(0, 300, -250)],
  ['gtIn', ctx(1251, 379.09, -593)],
  ['below', ctx(0, 492, -683)],
  ['pooled', ctx(900, 4027, -8175)],
  ['blank', ctx(0, 100, -150)],
  ['openWithCtx', ctx(0, 200, 0)],
  ['grunnel', ctx(0, 400, -100, 250)],
]);
const rows = auctionLedger(M, C);
const row = (id) => rows.find((r) => r.auctionId === id);

// --- the offset itself -------------------------------------------------------

console.log('goal offset');
check('the baseline is the customary goal, $500 under the order cost',
  ERAS.orderCost - ERAS.defaultTargetFunding === 500, `${ERAS.orderCost} / ${ERAS.defaultTargetFunding}`);
check('a customary goal offsets nothing', goalOffsetOf(ERAS.defaultTargetFunding) === 0);
check('a goal at the order cost is a $500 debit', goalOffsetOf(ERAS.orderCost) === -500);
check('a goal below custom is a credit', goalOffsetOf(7150) === 350);
check('no recorded goal ⇒ no offset (null, never the assumed default)', goalOffsetOf(null) === null);
check('a goal above the order cost (pooled) ⇒ no offset', goalOffsetOf(10250) === null);

// --- the balance -------------------------------------------------------------

console.log('balance');
check('customary goal: balance is included + augments − withheld',
  near(row('custom').balance, 50), row('custom').balance);
check('released fee at $8,000: GT credited AND the $500 goal debited (20274 → $537.09)',
  near(row('gtIn').balance, 1251 + 379.09 - 593 - 500), row('gtIn').balance);
check('goal below custom turns a short auction covered (20275: −$191 → +$559)',
  near(row('below').balance, 492 - 683 + 750) && row('below').covered, row('below').balance);
check('pooled auction: balance ignores its goal',
  near(row('pooled').balance, 900 + 4027 - 8175), row('pooled').balance);
check('blank goal counts as $0', near(row('blank').balance, -50) && row('blank').goalOffset === null);

// --- which auctions are listed ------------------------------------------------

console.log('membership');
check('a closed auction with no context but a non-customary goal is listed',
  row('goalOnly') && near(row('goalOnly').balance, 350) && row('goalOnly').covered);
check('a closed auction with no context and the customary goal is not',
  row('goalOnlyCustom') === undefined);
check('an OPEN auction is never listed on its goal alone', row('openGoalOnly') === undefined);
check('an open auction with context is listed, offset and all',
  row('openWithCtx') && near(row('openWithCtx').balance, -300));
check('every auction with context is listed', [...C.keys()].every((id) => row(id)));

// --- the Grunnel toggle and the aggregate -------------------------------------

console.log('grunnel and aggregate');
const g = row('grunnel');
check('Grunnel is out of the stored balance', near(g.balance, 400 - 100 - 500), g.balance);
check('the toggle adds Grunnel on top of the offset',
  near(ledgerBalanceOf(g, true), 400 - 100 - 500 + 250) && near(ledgerBalanceOf(g, false), g.balance));
const all = ledgerOverall(rows);
const offsets = rows.reduce((a, r) => a + (r.goalOffset ?? 0), 0);
check('the aggregate sums the offset, a null one as $0', near(all.goalOffset, offsets), all.goalOffset);
check('the aggregate balance is the sum of the row balances',
  near(all.balance, rows.reduce((a, r) => a + r.balance, 0)), all.balance);

rmSync(work, { recursive: true, force: true });
console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
