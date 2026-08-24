// Tests for apps-script/hardenSheet.gs — Phase 7 of data-pipeline-plan.md.
//
// The workbook itself cannot be tested from here, so what is tested is the part
// that decides: the column classifier, the named-range verdict, and the plan
// they produce. The workbook is stood up from the shipped CSVs — every tab's
// real headers and real row counts, with formulas synthesised onto the columns
// the audit says carry them.
//
// The most valuable assertion is the last one: **the vocabulary lists in
// hardenSheet.gs must still match what the CSVs actually contain.** A dropdown
// listing eight auction styles when the data has nine is a dropdown that
// rejects a real value, and nothing else in the repo would notice.
//
// Run: node scripts/harden-sheet.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');

// trentClose.gs first: hardenReadBook uses its OLD_TAB_RE, and loading them
// together is what the shared Apps Script scope does.
const sandbox = { module: { exports: {} }, console };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'trentClose.gs'), 'utf8'), sandbox);
sandbox.module = { exports: {} };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'hardenSheet.gs'), 'utf8'), sandbox);
const H = sandbox.module.exports;

// --- CSV --------------------------------------------------------------------
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

let passed = 0;
const failures = [];
const ok = (c, what) => { if (c) { passed++; return true; } failures.push(what); return false; };
const eq = (a, b, what) => ok(a === b, `${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);

// --- a workbook built from the real CSVs ------------------------------------
// The formula columns, READ FROM A REAL EXPORT of the workbook on 2026-08-24 —
// not from the 2026-08-20 audit, which was wrong about them in two ways that
// mattered:
//
//   - `auctionId` is a formula (`=B2&C2`) in ALL FOUR tabs that carry it. The
//     audit listed it as an input column, and no arithmetic check could have
//     told the difference: the formula's output is exactly what a human would
//     type, on all 289 rows.
//   - `augmentated` is a formula (`=IF(Q2&R2<>"","Yes","No")`), not the
//     hand-typed Yes/No it looks like. That is why it is not in
//     HARDEN_VOCABULARY: a dropdown on a formula column offers a choice nobody
//     can take.
//
// The list is declared here, in the TEST, and discovered by the script. That
// division is the point — when this goes stale the script still reads the live
// sheet correctly and only these fixtures need updating.
const FORMULA_COLUMNS = {
  auctionMetadata: ['auctionId', 'daysToClose', 'Status', 'Open Month', 'Close Month',
    'augmentated', 'augmentTokens', 'augmentGrunnel', 'augmentWithheld',
    'augmentedTotal', 'fundingNoAugment', 'preorderTotal'],
  prices: ['auctionId', 'Display Name', 'Category'],
  onyx: ['auctionId'],
  rawPricesData: ['auctionId', 'Item', 'Price', 'Category'],
  contextItems: ['auctionId'],
  tokenMetadata: ['key'],
  offAuctionPrices: ['Key'],
};
// Genuinely mixed columns, also measured from the real export. `priceAugmented`
// is 95 of 631 populated cells — withheld rows are a QUERY, token and grunnel
// rows are typed. `offAuctionPrices` carries two more nobody had noticed.
const MIXED = {
  contextItems: ['priceAugmented'],
  offAuctionPrices: ['Category', 'Display Name'],
};

function buildBook(files) {
  const tabs = {};
  for (const file of files) {
    const name = file.replace(/\.csv$/, '');
    const rows = parseCSV(readFileSync(join(dataDir, file), 'utf8')).filter((r) => r.length > 1);
    const headers = rows[0];
    const body = rows.slice(1);
    const columns = headers.map((h, c) => {
      const values = body.map((r) => r[c] ?? '');
      const isFormula = (FORMULA_COLUMNS[name] || []).includes(h);
      const isMixed = (MIXED[name] || []).includes(h);
      const formulas = values.map((v, i) => {
        if (isFormula) return v === '' ? '' : '=VLOOKUP(A1,X,2,FALSE)';
        if (isMixed) return i % 3 === 0 ? '=QUERY(augmentData,"select avg(E)*-1")' : '';
        return '';
      });
      return { formulas, values };
    });
    tabs[name] = { headers, columns, rows: body.length + 1, protectedColumns: [] };
  }
  return { tabs, namedRanges: [], validation: {} };
}

const FILES = ['auctionMetadata.csv', 'prices.csv', 'onyx.csv', 'rawPricesData.csv',
  'contextItems.csv', 'tokenMetadata.csv', 'offAuctionPrices.csv'];

// ===========================================================================
console.log('\n=== 1. finding a column by header ===');
// ===========================================================================
const headers = ['auctionId', 'auctionSeason', 'Open Month', 'Price'];
eq(H.hardenFindColumn(headers, 'Price'), 3, 'exact match');
eq(H.hardenFindColumn(headers, 'price'), 3, 'case-insensitive');
eq(H.hardenFindColumn(headers, 'Open  Month'), 2, 'internal spacing collapses');
eq(H.hardenFindColumn(headers, 'nope'), -1, 'a header that is not there is -1, not 0');
console.log('  ✓ headers match on name, not on position');

// ===========================================================================
console.log('\n=== 2. classifying a column from its cells ===');
// ===========================================================================
const F = (n) => Array(n).fill('=A1');
const V = (n) => Array(n).fill('x');
const E = (n) => Array(n).fill('');
eq(H.hardenClassifyColumn(F(10), V(10)).kind, 'formula', 'all formulas');
eq(H.hardenClassifyColumn(E(10), V(10)).kind, 'typed', 'all typed');
eq(H.hardenClassifyColumn(E(10), E(10)).kind, 'empty', 'an empty column is left alone');
// A column half formula and half typed must be reported, never acted on: a
// numeric rule would be wrong for the formula half and a protection would be
// wrong for the typed half.
eq(H.hardenClassifyColumn([...F(5), ...E(5)], V(10)).kind, 'mixed', 'half and half is mixed');
// A backfill in progress is still a formula column.
eq(H.hardenClassifyColumn([...F(19), ...E(1)], V(20)).kind, 'formula', '95% formulas');
console.log('  ✓ formula, typed, mixed and empty are told apart by content');

// ===========================================================================
console.log('\n=== 3. named-range verdicts ===');
// ===========================================================================
// The one that actually happened: 563 rows of headroom against ~1,500 added a
// season, so it would have truncated partway into 2027 with no error at all.
const bounded = H.hardenRangeVerdict('auctionFullData', 'prices!$A$2:$G$8316');
eq(bounded.level, 'bounded', 'a fixed-bound range over a growing tab');
eq(bounded.lastRow, 8316, 'the last row it covers is named, so the headroom is visible');
eq(H.hardenRangeVerdict('auctionFullData', 'prices!$A:$G').level, 'ok', 'whole-column is fine');
eq(H.hardenRangeVerdict('augmentData', 'contextItems!$A:$G').level, 'ok', 'whole-column on another tab');
eq(H.hardenRangeVerdict('categories', '#REF!').level, 'dead', '#REF! is dead, not merely bounded');
// A fixed range over a tab that does not grow is not a hazard.
eq(H.hardenRangeVerdict('startDates', 'startDates!$A$1:$B$20').level, 'ok', 'fixed bounds on a non-growing tab');
console.log('  ✓ bounded, dead and safe ranges are told apart');

// ===========================================================================
console.log('\n=== 4. the plan over the real workbook ===');
// ===========================================================================
const book = buildBook(FILES);
book.namedRanges = [
  { name: 'auctionFullData', a1: 'prices!$A:$G' },
  { name: 'augmentData', a1: 'contextItems!$A:$G' },
  { name: 'trentNormalizedQty', a1: 'trentNormalization!$A$2:$C$1030' },
  { name: 'trentAuctionData', a1: 'rawPricesData!$B$2:$G$13176' },
  { name: 'NamedRange1', a1: 'rawPricesData!$B$2:$G$9944' },
  { name: 'categories', a1: '#REF!' },
];
const plan = H.hardenPlan(book);

const kinds = (k) => plan.actions.filter((a) => a.kind === k);
ok(plan.actions.length > 0, 'the plan proposes nothing at all');

// Every price column gets numeric validation, and `prices!Price` is the one
// that makes the `-` class impossible.
const validated = new Set(kinds('validate').map((a) => `${a.tab}!${a.header}`));
for (const c of H.HARDEN_PRICE_COLUMNS) {
  ok(validated.has(`${c.tab}!${c.header}`), `no numeric validation proposed for ${c.tab}!${c.header}`);
}
for (const v of H.HARDEN_VOCABULARY) {
  ok(validated.has(`${v.tab}!${v.header}`), `no dropdown proposed for ${v.tab}!${v.header}`);
}
console.log(`  ✓ ${kinds('validate').length} validation rule(s), covering every price and vocabulary column`);

// Every formula column is protected, and only formula columns are.
const protectedCols = new Set(kinds('protect').map((a) => `${a.tab}!${a.header}`));
for (const [tab, cols] of Object.entries(FORMULA_COLUMNS)) {
  for (const c of cols) ok(protectedCols.has(`${tab}!${c}`), `formula column ${tab}!${c} is not protected`);
}
eq(protectedCols.has('prices!Price'), false, 'prices!Price is typed and must NOT be protected');
eq(protectedCols.has('contextItems!priceAugmented'), false,
  'contextItems!priceAugmented is MIXED and must not be protected — half of it is hand-typed');
ok(plan.problems.some((p) => /contextItems!priceAugmented is MIXED/.test(p)),
  'the mixed column is not reported as needing a human');
console.log(`  ✓ ${kinds('protect').length} formula column(s) protected; the mixed column is reported, not touched`);

// The three traps are proposed for deletion, marked destructive; the correct
// unused ranges are left alone. Unused is not the hazard — unused AND WRONG is.
const deletions = kinds('deleteRange').map((a) => a.name);
eq(deletions.sort().join(','), 'NamedRange1,categories,trentAuctionData', 'the dead named ranges proposed for deletion');
ok(kinds('deleteRange').every((a) => a.destructive), 'a deletion is not marked destructive');
ok(!deletions.includes('trentNormalizedQty'), 'a range that is in use was proposed for deletion');
ok(!deletions.includes('auctionFullData'), 'a correct range was proposed for deletion');
console.log('  ✓ the three traps are proposed for deletion, marked destructive; ranges in use are untouched');

// Nothing is proposed twice — running this after a partial apply must converge.
const seen = new Set();
for (const a of plan.actions) {
  const k = `${a.kind}|${a.tab || a.name}|${a.header || ''}`;
  ok(!seen.has(k), `duplicate action: ${k}`);
  seen.add(k);
}
// And a workbook that already has everything proposes nothing.
const done = buildBook(FILES);
done.namedRanges = [{ name: 'auctionFullData', a1: 'prices!$A:$G' }];
for (const a of H.hardenPlan(done).actions) {
  if (a.kind === 'validate') done.validation[`${a.tab}!${a.header}`] = true;
  if (a.kind === 'protect') done.tabs[a.tab].protectedColumns.push(a.column);
}
eq(H.hardenPlan(done).actions.length, 0, 'a second run over an already-hardened workbook still proposes work');
console.log('  ✓ idempotent — a second run over a hardened workbook proposes nothing');

// ===========================================================================
console.log('\n=== 5. the dropdowns still match the data ===');
// ===========================================================================
// The assertion that earns its place. A dropdown built from a list that has
// drifted from the CSVs rejects a value the sheet legitimately holds, and
// nothing else in the repo compares the two.
for (const v of H.HARDEN_VOCABULARY) {
  const rows = parseCSV(readFileSync(join(dataDir, `${v.tab}.csv`), 'utf8')).filter((r) => r.length > 1);
  const at = rows[0].indexOf(v.header);
  if (!ok(at >= 0, `${v.tab}.csv has no ${v.header} column`)) continue;
  const actual = new Set(rows.slice(1).map((r) => (r[at] ?? '').trim()).filter(Boolean));
  const missing = [...actual].filter((a) => !v.values.includes(a));
  ok(missing.length === 0,
    `${v.tab}!${v.header}: the data holds ${missing.map((m) => JSON.stringify(m)).join(', ')} ` +
    `but the dropdown does not offer ${missing.length > 1 ? 'them' : 'it'} — the dropdown would reject a real value`);
  const unused = v.values.filter((val) => !actual.has(val));
  if (unused.length) {
    console.log(`  · ${v.tab}!${v.header} offers ${unused.map((u) => JSON.stringify(u)).join(', ')}, ` +
      'not currently in the data — allowed, a dropdown may lead the data');
  }
  passed++;
}
console.log('  ✓ every value the CSVs hold is offered by its dropdown');

// ===========================================================================
if (failures.length) {
  console.error(`\n✗ hardenSheet: ${failures.length} failure(s) of ${passed + failures.length} assertions\n`);
  for (const f of failures.slice(0, 30)) console.error('  • ' + f);
  process.exit(1);
}
console.log(`\n✓ hardenSheet: ${passed} assertions over the real ${FILES.length}-tab workbook shape\n`);
