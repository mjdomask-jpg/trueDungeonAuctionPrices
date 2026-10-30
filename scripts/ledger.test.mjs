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
//   the full-order lens (SITE-13)         $8,000 baseline + an estimated kept-fee
//                                         debit; season rates borrow only from
//                                         EARLIER seasons, else n/a; released or
//                                         withheld fee items are never debited
//                                         twice; Trent's points only on request
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

const { auctionLedger, ledgerBalanceOf, ledgerFiguresOf, ledgerOverall, goalOffsetOf } = an;

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
check('goal below custom lifts the NET (20275: −$191 → +$559)',
  near(row('below').balance, 492 - 683 + 750) && near(row('below').feeAndGoal, 750), row('below').balance);

// --- the two subtotals, and which one carries the verdict ----------------------

console.log('subtotals and verdict');
check('augments vs withheld is augments − withheld, nothing else',
  near(row('gtIn').augmentsVsWithheld, 379.09 - 593) && near(row('custom').augmentsVsWithheld, 50));
check('fee & goal is included + goal offset',
  near(row('gtIn').feeAndGoal, 1251 - 500) && near(row('custom').feeAndGoal, 0));
check('the net is the two subtotals added',
  rows.every((r) => near(r.balance, r.augmentsVsWithheld + r.feeAndGoal)));
check('the verdict reads augments vs withheld, NOT the net: a released Golden Ticket cannot cover a shortfall (20274)',
  row('gtIn').balance > 0 && !row('gtIn').covered);
check('…nor can a goal below custom (20275 stays Short)', row('below').balance > 0 && !row('below').covered);
check('pooled auction: balance ignores its goal',
  near(row('pooled').balance, 900 + 4027 - 8175), row('pooled').balance);
check('blank goal counts as $0', near(row('blank').balance, -50) && row('blank').goalOffset === null);

// --- which auctions are listed ------------------------------------------------

console.log('membership');
check('a closed auction with no context but a non-customary goal is listed',
  row('goalOnly') && near(row('goalOnly').balance, 350) && near(row('goalOnly').feeAndGoal, 350));
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
check('the toggle never moves augments vs withheld — a company drop is not an augment',
  near(ledgerFiguresOf(g, true).augmentsVsWithheld, 300) && near(ledgerFiguresOf(g, true).feeAndGoal, -500));
const all = ledgerOverall(rows);
const offsets = rows.reduce((a, r) => a + (r.goalOffset ?? 0), 0);
check('the aggregate sums the offset, a null one as $0', near(all.goalOffset, offsets), all.goalOffset);
check('the aggregate balance is the sum of the row balances',
  near(all.balance, rows.reduce((a, r) => a + r.balance, 0)), all.balance);
check('the aggregate verdict reads its augments vs withheld',
  near(all.augmentsVsWithheld, rows.reduce((a, r) => a + r.augmentsVsWithheld, 0))
  && all.covered === (all.augmentsVsWithheld >= 0));

// --- the full-order lens (SITE-13) ------------------------------------------
// Measured against the $8,000 order cost, with the fee the auctioneer KEPT
// debited at an estimate: nine Random Ultra Rares at the season's rate, plus a
// Golden Ticket in its era. Every figure below is constructed.

console.log('full-order lens');
const { fullOrderLedger, fullOrderBalanceOf, fullOrderFiguresOf, feeRatesBySeason, trentSubsidyOf } = an;

let fn = 0;
const fm = (id, season, targetFunding, closeDate, { status = 'Closed', source = 'Forum' } = {}) => ({
  auctionId: id, season, auctionNumber: ++fn, name: `Auction ${id}`,
  auctioneer: `Auctioneer ${id}`, source, status, targetFunding, closeDate,
});
const item = (auctionId, category, name, quantity, value) => ({
  auctionId, category, name, quantity, refValue: value, value,
  provenance: category === 'withheld' ? 'withheld'
    : /^(random ultra rare|golden ticket)$/i.test(name) ? 'released-payment' : 'augment',
  estimate: category === 'withheld',
});
const gtSale = (auctionId, season, price) => ({
  auctionId, season, auctionNumber: 0, item: 'Golden Ticket', price,
  displayName: 'Golden Ticket', category: 'Golden Ticket',
});

const FM = [
  fm('kept20', '2020', 7500, '2019-10-01'),            // before any Random UR sold
  fm('rur24', '2024', 8000, '2023-12-01'),             // sets 2024's rate: $50
  fm('plain24', '2024', 7500, '2024-01-10'),           // a season before the GT fee
  fm('early25', '2025', 7500, '2024-10-01'),           // 2025, closed before any GT SOLD
  fm('gtSold25', '2025', 8000, '2025-01-15'),          // sets 2025's GT rate: $1,100
  fm('rel26', '2026', 8000, '2025-12-01'),             // released the whole fee
  fm('gtOnly26', '2026', 8000, '2025-12-02'),          // 202718's shape
  fm('plain26', '2026', 7500, '2025-12-03'),           // the custom
  fm('part26', '2026', 7500, '2025-12-04'),            // released six of nine
  fm('pooled26', '2026', 10250, '2025-12-05'),         // 20251's shape
  fm('open26', '2026', 7500, '', { status: 'Open' }),
  fm('trent26', '2026', 7500, '2025-12-06', { source: 'Trent' }),
  fm('plain27', '2027', 7500, '2026-10-01'),           // no 2027 sales yet
];
const FI = [
  item('rur24', 'token', 'Random Ultra Rare', 9, 450),
  item('rel26', 'token', 'Random Ultra Rare', 9, 360),
  item('gtOnly26', 'token', 'Golden Ticket', 1, 800),
  item('gtOnly26', 'withheld', 'Random Ultra Rare', 9, -400),
  item('part26', 'token', 'Random Ultra Rare', 6, 270),
];
const FS = [gtSale('gtSold25', '2025', 1100), gtSale('rel26', '2026', 1000)];
const FC = new Map([
  ['rur24', ctx(450, 0, 0)],
  ['gtSold25', ctx(1100, 0, 0)],
  ['rel26', ctx(1360, 0, 0)],
  ['gtOnly26', ctx(800, 0, -400)],
  ['part26', ctx(270, 0, 0)],
]);

const rates = feeRatesBySeason(FM, FI, FS);
check('a Random UR rate is quantity-weighted over the season\'s lots ($630 / 15 = $42)',
  near(rates.get('2026').rur.rate, 42) && rates.get('2026').rur.n === 2, JSON.stringify(rates.get('2026')));
check('a Golden Ticket rate averages one price per auction, either feed ($1,000, $800)',
  near(rates.get('2026').gt.rate, 900) && rates.get('2026').gt.n === 2);
check('a season with no sales borrows the most recent EARLIER one',
  rates.get('2027').rur.season === '2026' && rates.get('2025').rur.season === '2024');
check('nothing is borrowed from a LATER season',
  rates.get('2020').rur === null && rates.get('2024').gt === null);

const full = fullOrderLedger(FM, FC, FI, FS);
const fr = (id) => full.find((r) => r.auctionId === id);
const fee26 = 9 * 42 + 900;

check('the custom: +$500 offset less the whole fee ($378 + $900)',
  near(fr('plain26').orderOffset, 500) && near(fr('plain26').feeKept.value, -fee26)
  && near(fr('plain26').fullBalance, 500 - fee26), fr('plain26').fullBalance);
check('the two lenses differ by $500 − fee value',
  near(fr('plain26').fullBalance - fr('plain26').balance, 500 - fee26));
check('the whole fee sold at $8,000, nothing withheld or added, nets $0 — a release is the baseline, not a credit',
  near(fr('rel26').feeKept.value, 0) && near(fr('rel26').fullFeeAndGoal, 0) && near(fr('rel26').fullBalance, 0),
  fr('rel26').fullBalance);
check('Random URs recorded WITHHELD are not debited twice',
  fr('gtOnly26').feeKept.rurKept === 0 && near(fr('gtOnly26').fullBalance, -400));
check('a partial release debits only what was kept (3 × $42 + GT), and credits nothing for the six sold',
  fr('part26').feeKept.rurKept === 3 && near(fr('part26').fullBalance, 500 - (126 + 900)));
check('augments vs withheld is the same under both lenses',
  (() => {
    const custom = auctionLedger(FM, FC);
    const both = custom.filter((c) => fr(c.auctionId));
    return both.length >= 4 && both.every((c) => near(c.augmentsVsWithheld, fr(c.auctionId).augmentsVsWithheld));
  })() && near(fr('gtOnly26').augmentsVsWithheld, -400));
check('a borrowed rate prices the start of a season',
  near(fr('plain27').feeKept.value, -fee26) && fr('plain27').feeKept.rur.season === '2026');
check('no Golden Ticket is owed before the 2025 season',
  fr('plain24').feeKept.gtKept === false && near(fr('plain24').fullBalance, 500 - 450));
check('the Golden Ticket is owed by SEASON — a 2025 auction closing before the first GT sold owes one',
  fr('early25').feeKept.gtKept === true && near(fr('early25').fullBalance, 500 - (450 + 1100)),
  fr('early25').fullBalance);
{
  const lone = [FM.find((m) => m.auctionId === 'rur24'), fm('lone25', '2025', 7500, '2024-10-01')];
  const r = fullOrderLedger(lone, FC, FI.filter((i) => i.auctionId === 'rur24'), [])
    .find((x) => x.auctionId === 'lone25');
  check('a GT owed with no GT sale in or before its season ⇒ not computable',
    r.feeKept === null && r.fullBalance === null);
}
check('no Random UR sale in or before the season ⇒ not computable',
  fr('kept20').feeKept === null && fullOrderBalanceOf(fr('kept20'), true, true) === null);
check('a pooled auction has no single-order offset ⇒ not computable',
  fr('pooled26').orderOffset === null && fr('pooled26').fullBalance === null);
check('every CLOSED auction is listed, context or not, and no open one',
  fr('plain26') && fr('trent26') && fr('open26') === undefined
  && full.length === FM.filter((m) => m.status === 'Closed').length);

check('Trent\'s points are 10% of the goal, and only at Trent',
  near(trentSubsidyOf(FM.find((m) => m.auctionId === 'trent26')), 750)
  && trentSubsidyOf(FM.find((m) => m.auctionId === 'plain26')) === 0);
check('the points count only when asked',
  near(fullOrderBalanceOf(fr('trent26'), false, false), 500 - fee26)
  && near(fullOrderBalanceOf(fr('trent26'), false, true), 500 - fee26 + 750));
check('the points go into fee & goal and NEVER into augments vs withheld — they must not decide the verdict',
  near(fullOrderFiguresOf(fr('trent26'), false, true).augmentsVsWithheld, 0)
  && near(fullOrderFiguresOf(fr('trent26'), false, true).feeAndGoal, 500 - fee26 + 750)
  && near(fullOrderFiguresOf(fr('trent26'), false, false).feeAndGoal, 500 - fee26));
check('a fee that cannot be priced blanks fee & goal and the net, never augments vs withheld',
  (() => { const x = fullOrderFiguresOf(fr('kept20'), false, false); return x.feeAndGoal === null && x.net === null && x.augmentsVsWithheld === 0; })());

rmSync(work, { recursive: true, force: true });
console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
