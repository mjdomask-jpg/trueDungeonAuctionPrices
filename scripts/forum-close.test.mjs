// Tests for apps-script/forumClose.gs — Phase 5 (part one) of
// data-pipeline-plan.md.
//
// The importer is thin on purpose: every rule that decides a NUMBER belongs to
// trentClose.gs and is already covered by `npm run test:trent` against 18,466
// lots. What is tested here is the part that is new — reading a file shape that
// is not Trent's, and refusing one that looks importable and is not.
//
// The fixtures are three real files from ONE auctioneer, converted to CSV
// without changing a value. They are three different shapes, which is the
// finding that shaped this file:
//
//   Item | Number | Amount             one row per lot        -> 202647
//   Auction Item | Low Bid | High Bid  already aggregated     -> 202640
//   Row Labels | Min | Max | Average   a pivot over ALL bids  -> reconciles
//                                                                with nothing
//
// The first two are replayed against prices.csv and must reproduce it. The
// third must be REFUSED, and the test pins the measurement that justifies that:
// it matches no recorded auction on any item.
//
// Run: node scripts/forum-close.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const fixtureDir = join(here, '..', 'fixtures', 'forum');

// --- load BOTH scripts into ONE sandbox -------------------------------------
// That is not a convenience: in Apps Script every .gs file in a project shares
// one global scope, and forumClose.gs is written to call trentClose.gs's
// functions directly. Loading them together is what the real runtime does, and
// loading forumClose.gs alone would fail exactly as it would in the workbook if
// trentClose.gs were missing.
const sandbox = { module: { exports: {} }, console };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'trentClose.gs'), 'utf8'), sandbox);
const T = sandbox.module.exports;
sandbox.module = { exports: {} };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'forumClose.gs'), 'utf8'), sandbox);
const F = sandbox.module.exports;

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
const objs = (t) => { const r = parseCSV(t); const h = r[0].map((x) => x.trim()); return r.slice(1).map((c) => Object.fromEntries(h.map((k, i) => [k, (c[i] ?? '').trim()]))); };
const load = (dir, f) => objs(readFileSync(join(dir, f), 'utf8'));
const grid = (f) => parseCSV(readFileSync(join(fixtureDir, f), 'utf8'));
const money = (s) => { const n = parseFloat(String(s ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };

const PRICES = load(dataDir, 'prices.csv');
const TOKENS = load(dataDir, 'tokenMetadata.csv');
const META = load(dataDir, 'auctionMetadata.csv');
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name) => { console.log(`ok      ${name}`); pass++; };
const bad = (name, detail) => { console.error(`FAIL    ${name}`); if (detail) console.error(detail.split('\n').map((l) => '        ' + l).join('\n')); fail++; };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const eq = (name, got, want) => check(name, got === want, `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);

function recordedFor(auctionId) {
  const rec = new Map();
  for (const p of PRICES.filter((p) => p.auctionId === auctionId)) {
    if (!rec.has(p.Item)) rec.set(p.Item, []);
    rec.get(p.Item).push(money(p.Price));
  }
  return rec;
}

// ===========================================================================
// 1. Reading the shapes
// ===========================================================================
console.log('File shapes\n');
for (const f of manifest.files) {
  const staged = F.forumReadStaging(grid(f.file));
  if (f.refuse) {
    check(`${f.file}: refused`, !!staged.error, JSON.stringify(staged).slice(0, 200));
    check(`  ... and says why`, /every bid/i.test(staged.error || ''), staged.error);
    continue;
  }
  check(`${f.file}: read`, !staged.error, staged.error);
  eq(`  ... shape`, staged.shape, f.shape);
  eq(`  ... values read`, staged.lots.length, f.lots);
  eq(`  ... withheld rows`, staged.withheld.length, f.withheld ?? 0);
}

// ===========================================================================
// 2. Replay against the shipped prices
// ===========================================================================
console.log('\nReplay against prices.csv\n');
for (const f of manifest.files) {
  if (f.refuse) continue;
  const target = META.find((m) => m.auctionId === f.reconciles);
  const plan = F.forumPlanImport(grid(f.file), target.auctionSeason, TOKENS);
  const rec = recordedFor(f.reconciles);

  const got = new Map();
  for (const p of plan.prices || []) {
    if (!got.has(p.Item)) got.set(p.Item, []);
    got.get(p.Item).push(p.Price);
  }
  let same = 0; const diffs = [];
  for (const [item, vals] of got) {
    const r = rec.get(item);
    if (!r) { diffs.push(`${item} [${vals.join(', ')}] has no recorded row`); continue; }
    const a = [...vals].sort((x, y) => x - y), b = [...r].sort((x, y) => x - y);
    if (a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.005)) same++;
    else diffs.push(`${item}: got [${a.join(', ')}] recorded [${b.join(', ')}]`);
  }
  eq(`${f.reconciles}: items reproduced exactly`, same, f.reproduces);
  check(`  ... differences are only the known ones`,
    diffs.length === (f.knownDifferences || []).length,
    diffs.join('\n'));
  for (const known of f.knownDifferences || []) {
    check(`  ... ${known}`, diffs.some((d) => d.startsWith(known.split(':')[0])), diffs.join('\n'));
  }
}

// ===========================================================================
// 3. The per-lot file, in detail
// ===========================================================================
console.log('\nThe per-lot file (202647) — the format being asked for\n');
{
  const g = grid('alesiev-202647-per-lot.csv');
  const target = { auctionId: '202647', auctionSeason: '2026', auctionNumber: '47' };
  const plan = F.forumPlanImport(g, '2026', TOKENS);

  // Straight from the auctioneer, with no hand editing at all.
  eq('the raw file imports as sent', plan.ok, true);
  eq('  ... with nothing to fix first', plan.aborts.length, 0);
  eq('  ... 211 priced lots', plan.lots, 211);
  eq('  ... to rawPricesData', F.forumKeepsRawRows(plan), true);
  eq('  ... 211 per-lot rows', plan.raw.length, 211);
  eq('  ... and 36 price rows', plan.prices.length, 36);

  // The 17 rows that are not prices are recognised, not rejected.
  eq('17 rows are routed as context items', plan.context.length, 17);
  const rows = F.forumContextRows(plan.context, target);
  eq('  ... becoming 9 contextItems rows', rows.length, 9);

  const CI = load(dataDir, 'contextItems.csv').filter((c) => c.auctionId === '202647');
  const emitted = rows.map((r) => r[6]).sort((a, b) => a - b);
  // Golden Ticket is a resolvable token and comes through the price path, so it
  // is not one of the rows this block is responsible for.
  const recorded = CI.filter((c) => c.Item !== 'Golden Ticket').map((c) => money(c.priceAugmented)).sort((a, b) => a - b);
  eq('  ... whose prices match contextItems exactly', emitted.join(','), recorded.join(','));

  const randomUR = rows.find((r) => r[4] === 'Random UR');
  eq('Random UR is aggregated to one row', randomUR[5], 9);
  eq('  ... summing to what the sheet records', randomUR[6], 497);
  eq('  ... as a token', randomUR[3], 'token');

  // The lots of an aggregated item do NOT all sell at one price, and this file
  // is the proof: eight at $55 and one at $57. Summing each lot's own price is
  // what makes that come out right; quantity × a representative price is wrong
  // by $2 here — which is the error the sheet itself carried until it was
  // corrected from $495 to $497.
  const urLots = plan.context.filter((l) => /random ur/i.test(l.name)).map((l) => l.bid);
  eq('the nine lots are not all the same price', new Set(urLots).size, 2);
  eq('  ... 8 at $55', urLots.filter((p) => p === 55).length, 8);
  eq('  ... and 1 at $57', urLots.filter((p) => p === 57).length, 1);
  eq('  ... which sums to the recorded total', urLots.reduce((a, b) => a + b, 0), 497);
  check('  ... and 9 × any single price does NOT',
    ![55, 57].some((p) => p * 9 === 497), '9 × 55 = 495, 9 × 57 = 513');

  const breakdown = F.forumAggregateBreakdown(plan.context);
  eq('the dialog shows how the total was reached', breakdown.length, 1);
  eq('  ... spelled out', breakdown[0], 'Random UR: 8 @ $55 + 1 @ $57 = $497');

  const grunnel = rows.filter((r) => r[3] === 'grunnel');
  eq('each Grunnel Augment keeps its own row', grunnel.length, 6);
  check('  ... at the six recorded prices',
    grunnel.map((r) => r[6]).sort((a, b) => a - b).join(',') === '72,103,112,137,161,455',
    grunnel.map((r) => r[6]).join(','));
  check('  ... with the Item left blank for the operator', grunnel.every((r) => r[4] === ''), '');
  eq('  ... and two player augments as tokens', rows.filter((r) => r[3] === 'token' && r[4] === '').length, 2);

  check('the operator is told which rows still need a name',
    (plan.cautions || []).some((c) => /8 of them need a name/.test(c)), (plan.cautions || []).join(' | '));

  // The routing is a short list of KNOWN names, not a licence to guess. A name
  // nobody has classified still stops the run.
  const withUnknown = [g[0], ['Mystery Widget', '1', '25'], ...g.slice(1)];
  const stopped = F.forumPlanImport(withUnknown, '2026', TOKENS);
  eq('an unrecognised name still aborts', stopped.ok, false);
  check('  ... naming it', stopped.aborts.some((a) => /Mystery Widget/.test(a)), stopped.aborts.join(' | '));
}

// ===========================================================================
// 3b. Aggregating mixed prices, on cases the fixtures do not contain
// ===========================================================================
console.log('\nMixed prices in an aggregated row\n');
{
  const target = { auctionId: 'X', auctionSeason: '2026', auctionNumber: '1' };
  const run = (rows) => F.forumContextRows(
    F.forumReadStaging([['Item', 'Amount'], ...rows]).context, target);

  // Three different prices, none of them a clean multiple of the total.
  let r = run([['Random UR', '55'], ['Random UR', '57'], ['Random UR', '60']]);
  eq('three prices sum', r[0][6], 172);
  eq('  ... with the quantity counted', r[0][5], 3);

  // Cents, where a float sum would drift.
  r = run([['Random UR', '0.1'], ['Random UR', '0.2']]);
  eq('cents do not drift', r[0][6], 0.3);

  // One lot.
  r = run([['Random UR', '55']]);
  eq('a single lot is still a row', r[0][6], 55);
  eq('  ... of quantity 1', r[0][5], 1);

  // A quantity written into the name instead of spread over rows. Both
  // spellings mean nine tokens, and counting rows would call this one.
  r = run([['9x Random UR', '497']]);
  eq('"9x Random UR" on one row is nine tokens', r[0][5], 9);
  eq('  ... at the stated total', r[0][6], 497);

  // Mixed spellings in one file.
  r = run([['3x Random UR', '165'], ['Random UR', '57']]);
  eq('mixed spellings add up', r[0][5], 4);
  eq('  ... and so do their prices', r[0][6], 222);

  const b = F.forumAggregateBreakdown(
    F.forumReadStaging([['Item', 'Amount'], ['Random UR', '55'], ['Random UR', '55'], ['Random UR', '57']]).context);
  eq('the breakdown groups equal prices', b[0], 'Random UR: 2 @ $55 + 1 @ $57 = $167');

  // Grunnel augments are NOT aggregated, so mixed prices stay separate rows.
  const g = F.forumContextRows(
    F.forumReadStaging([['Item', 'Amount'], ['Grunnel Augment', '161'], ['Grunnel Augment', '72']]).context, target);
  eq('a non-aggregated name keeps one row per lot', g.length, 2);
  eq('  ... each at its own price', g.map((x) => x[6]).join(','), '161,72');

  // Context routing is per-lot only. An aggregated file has no lots to add up.
  const aggCtx = F.forumReadStaging([['Auction Item', 'Low Bid', 'High Bid'], ['Random UR', '41', '43']]);
  eq('an aggregated file does not route context names', aggCtx.context.length, 0);
  eq('  ... they stay lots, for the ordinary unresolved path', aggCtx.lots.length, 2);
  eq('  ... and is not summed', F.forumAggregateBreakdown(
    F.forumReadStaging([['Item', 'Amount'], ['Grunnel Augment', '161']]).context).length, 0);
}

// ===========================================================================
// 4. The aggregated file writes no per-lot rows, and is not trusted
// ===========================================================================
console.log('\nThe aggregated file (202640)\n');
{
  const g = grid('alesiev-202640-low-high.csv');
  const plan = F.forumPlanImport(g, '2026', TOKENS);
  eq('a low/high file contributes NO rawPricesData rows', F.forumKeepsRawRows(plan), false);
  check('  ... because its two values are a min and a max, not two sales', plan.columns === 2, '');
  check('the withheld Golden Ticket is reported, not imported',
    (plan.cautions || []).some((c) => /withheld/i.test(c) && /Golden Ticket/.test(c)),
    (plan.cautions || []).join(' | '));
  check('the shape itself raises a caution', (plan.cautions || []).some((c) => /WEAKER source/.test(c)),
    (plan.cautions || []).join(' | '));
  check('  ... carrying the measured disagreement', (plan.cautions || []).some((c) => /6 of 13/.test(c)),
    (plan.cautions || []).join(' | '));

  // Most of this file is not tokens at all — posters, prop sets, a zombie
  // swatter — so it aborts, exactly as a Trent file would.
  eq('it aborts on the rows that are not tokens', plan.ok, false);
  const index = T.buildTokenIndex(TOKENS);
  const keep = [g[0], ...g.slice(1).filter((r) => {
    const n = F.forumNormaliseName(r[0]);
    return n && T.resolveToken(T.stripDecorations(n), '2026', index);
  })];
  const clean = F.forumPlanImport(keep, '2026', TOKENS);
  eq('  ... and imports once they are moved out', clean.ok, true);
  check('  ... still saying the shape is already aggregated',
    /already aggregated/.test(F.forumDescribePlan(clean, '202640')), F.forumDescribePlan(clean, '202640'));
}

// ===========================================================================
// 5. Trailing quantities, and the shared parser left alone
// ===========================================================================
console.log('\nName normalisation\n');
{
  eq('"AI 10x" becomes "10x AI"', F.forumNormaliseName('AI 10x'), '10x AI');
  eq('"MH 1x" becomes "1x MH"', F.forumNormaliseName('MH 1x'), '1x MH');
  eq('  ... and the quantity then reads 10', T.parseQuantity(F.forumNormaliseName('AI 10x')).quantity, 10);
  eq('a leading quantity is left alone', F.forumNormaliseName('10x AI'), '10x AI');
  eq('a name with no quantity is untouched', F.forumNormaliseName('Wish Ring'), 'Wish Ring');
  // The shared rule must NOT have learned about trailing quantities: it is
  // verified against 18,466 Trent lots and there is no reason to disturb it.
  eq('the shared parser still reads "AI 10x" as one', T.parseQuantity('AI 10x').quantity, 1);
}

// ===========================================================================
// 6. The refusal
// ===========================================================================
console.log('\nRefusing an all-bids pivot\n');
{
  const g = grid('alesiev-202646-all-bids-pivot.csv');
  const staged = F.forumReadStaging(g);
  check('a file with an Average Bid column is refused', !!staged.error, '');
  check('  ... by naming the column', /average/i.test(staged.error), staged.error);
  check('  ... and saying what to ask for instead', /winning bids/i.test(staged.error), staged.error);

  // The measurement that justifies refusing it rather than importing it: read
  // as winning bids, it reconciles with NO auction that auctioneer ran.
  const index = T.buildTokenIndex(TOKENS);
  const header = g[0].map((h) => String(h).trim().toLowerCase());
  const lo = header.indexOf('minimum bid'), hi = header.indexOf('maximum bid');
  const agg = new Map();
  for (const row of g.slice(1)) {
    const name = F.forumNormaliseName(row[0]);
    if (!name || /^totals?$/i.test(name)) continue;
    const vals = [money(row[lo]), money(row[hi])].filter((n) => n !== null);
    if (!vals.length) continue;
    const qty = T.parseQuantity(name).quantity || 1;
    const token = T.resolveToken(T.stripDecorations(name), '2026', index);
    if (!token) continue;
    const per = vals.map((v) => T.roundCents(v / qty));
    const a = agg.get(token.Item);
    if (!a) agg.set(token.Item, { min: Math.min(...per), max: Math.max(...per) });
    else { a.min = Math.min(a.min, ...per); a.max = Math.max(a.max, ...per); }
  }
  check('  ... it resolves plenty of items', agg.size >= 15, `${agg.size} items`);
  let bestMatches = 0, bestId = null;
  for (const m of META.filter((m) => m.auctionSeason === '2026' && m.auctioneer === 'alesiev')) {
    const rec = recordedFor(m.auctionId);
    let n = 0;
    for (const [item, a] of agg) {
      const r = rec.get(item); if (!r) continue;
      if (Math.abs(Math.min(...r) - a.min) < 0.005 && Math.abs(Math.max(...r) - a.max) < 0.005) n++;
    }
    if (n > bestMatches) { bestMatches = n; bestId = m.auctionId; }
  }
  eq('  ... and matches ZERO items in ANY of that auctioneer\'s auctions', bestMatches, 0);
  check('  ... which is why the header is the only warning there is',
    bestId === null, `best was ${bestId}`);
}

// ===========================================================================
// 7. Guards inherited from Phase 2
// ===========================================================================
console.log('\nInherited guards\n');
{
  eq('an empty tab is refused', F.forumReadStaging([]).error, 'the staging tab is empty');
  const noCols = F.forumReadStaging([['Lot', 'Winner'], ['a', 'b']]);
  check('unknown headers are refused', /could not find/.test(noCols.error || ''), noCols.error);
  const wrongSeason = F.forumPlanImport(grid('alesiev-202647-per-lot.csv'), '2024', TOKENS);
  check('a season mismatch aborts', wrongSeason.aborts.some((a) => /looks like season/.test(a)),
    (wrongSeason.aborts || []).join(' | '));
  const totals = F.forumReadStaging([['Item', 'Amount'], ['Totals', '999'], ['Wish Ring', '10']]);
  eq('a Totals row is not a lot', totals.lots.length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
