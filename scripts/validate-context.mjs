// Validates the auction context layer outside the browser, mirroring
// src/lib/context.ts the way validate.mjs mirrors src/lib/data.ts.
//
// Two jobs:
//  1. Correctness: reproduce the withheld point-in-time recompute from the CSVs
//     and check it against the audited preview (docs/withheld-recompute-preview.csv).
//     A value that moved is only an ERROR when the INPUTS behind it did not —
//     the preview records each value's lookback window for exactly that reason.
//     Data moving is a note; the recompute moving is the alarm. See § 1.
//  2. Domain rules (data-audit.md §5): report targetFunding > $8k (a flagged
//     EXCEPTION, not fatal — Q4), Trent rows before season 2023, Golden-Ticket
//     sales before the guarantee era, Closed auctions with no sales, rows
//     pointing at an auction that does not exist, and Ultra-Rare-looking
//     augment names not in the Random-UR list.
//
// Exit non-zero only on a genuine inconsistency (recompute mismatch, or a hard
// domain violation). Run: node scripts/validate-context.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { buildWithheldIndex, valueWithheld } from './lib/withheld.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// --data / --docs point the run at directories other than the repo's own, so
// the test suite can check behaviour against a mutated copy without writing to
// public/data. Mirrors validate-prices.mjs's --data.
const dirArg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};
const dataDir = dirArg('--data', join(here, '..', 'public', 'data'));
const docsDir = dirArg('--docs', join(here, '..', 'docs'));

// --- tiny RFC-4180 CSV parser (mirror of parseCSV) ---
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function objs(text) {
  const r = parseCSV(text); if (!r.length) return [];
  const h = r[0].map((x) => x.trim());
  return r.slice(1).map((c) => Object.fromEntries(h.map((k, i) => [k, (c[i] ?? '').trim()])));
}
const read = (dir, f) => readFileSync(join(dir, f), 'utf8');
const money = (s) => { const n = parseFloat((s ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };
const dateKey = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '');
// Mirror of data.ts cleanName — strip a spreadsheet formula-guard so the join
// key matches what the app parses.
const cleanName = (s) => (s ?? '').replace(/^['`](?=[-+=@])/, '');

// --- load ---
// BOTH price feeds, as the site does. An auctioneer can withhold part of an
// Onyx order and those names are in no other file; prices.csv alone can never
// value one. The two share no display name, so this disturbs nothing else.
const priceRows = (file) => objs(read(dataDir, file))
  .map((o) => ({ auctionId: o.auctionId, season: o.auctionSeason, displayName: cleanName(o['Display Name']), price: money(o.Price) }))
  .filter((s) => s.auctionId && Number.isFinite(s.price));
const sales = [...priceRows('prices.csv'), ...priceRows('onyx.csv')];
const meta = objs(read(dataDir, 'auctionMetadata.csv')).filter((o) => o.auctionId && /^\d+$/.test(o.auctionSeason));
const ctx = objs(read(dataDir, 'contextItems.csv')).filter((o) => o.auctionId);
// Context layer is Closed-auctions-only (mirror of buildContextItems).
const closedAuctions = new Set(meta.filter((m) => m.Status === 'Closed').map((m) => m.auctionId));

// --- domain constants ---
const RANDOM_UR = new Set(['random ultra rare']);
const TRENT_START_SEASON = 2023;
const GT_ERA_DATE = '2024-11-27';

const metaById = new Map(meta.map((m) => [m.auctionId, m]));
// The recompute itself lives in scripts/lib/withheld.mjs, shared with
// gen-withheld-preview.mjs. It used to be copied into both, and when
// context.ts changed neither copy followed — the generator would have written
// a golden file this checker then passed, while the site disagreed with both.
const withheldIdx = buildWithheldIndex(sales, meta);

let fail = 0, warn = 0;
const err = (m) => { console.error('  ✗ ' + m); fail++; };
const note = (m) => { console.warn('  ! ' + m); warn++; };

// === 1. withheld recompute vs audited preview ===
const withheld = ctx.filter((r) => r.category === 'withheld' && closedAuctions.has(r.auctionId)).map((r) => {
  const qty = parseFloat(r.quantity) || 1;
  const name = cleanName(r.Item);
  const { value, window } = valueWithheld(name, r.auctionId, qty, money(r.priceAugmented), withheldIdx);
  return { auctionId: r.auctionId, name, value, qty, window };
});
const previewText = read(docsDir, 'withheld-recompute-preview.csv');
// Whether the golden file records its INPUTS at all. A preview generated before
// the `lookback_auctions` column existed cannot be asked which auctions fed a
// value, so drift against it is reported and never blocks — see below.
const hasWindowCol = (parseCSV(previewText)[0] ?? []).map((x) => x.trim()).includes('lookback_auctions');
const preview = objs(previewText)
  .filter((o) => o.auctionId && o.new_PIT_value !== '')
  .map((o) => ({
    auctionId: o.auctionId, name: cleanName(o['item(DisplayName)']),
    value: parseFloat(o.new_PIT_value), qty: parseFloat(o.quantity) || 1,
    window: o.lookback_auctions ?? '',
  }));

// Group by (auction, item) and compare sorted values within a 1-cent tolerance.
// The tolerance absorbs JS-vs-generator rounding while still catching any real
// (dollar) drift. One key can hold several values — 20236 withholds `Ring of
// the 4th Circle` at qty 2 and again at qty 1 — so quantities are carried and
// compared too. The lookback window does NOT depend on quantity, so it is one
// value per key.
const group = (arr) => {
  const m = new Map();
  for (const x of arr) {
    const k = `${x.auctionId}|${x.name}`;
    const g = m.get(k) ?? m.set(k, { values: [], qtys: [], window: x.window }).get(k);
    g.values.push(x.value); g.qtys.push(x.qty);
  }
  for (const g of m.values()) { g.values.sort((p, q) => p - q); g.qtys.sort((p, q) => p - q); }
  return m;
};
const A = group(withheld), B = group(preview);

// Compared on the INTERSECTION, not the union.
//
// What this file is actually guarding is that the shipped data and the live
// recompute still agree with the Phase-1 audit — i.e. that no withheld value
// DRIFTS without someone noticing. New auctions are not drift. Failing on them
// made a routine publish need a laptop: `gen-withheld-preview.mjs` has to run
// somewhere with the repo checked out, so every auction carrying withheld items
// (9 of the 88 in seasons 2025-26) blocked its own PR until a human did that by
// hand. That is a direct tax on the whole pipeline's reason for existing.
//
// A key only in the recompute is new data (INFO, never blocks) and a key only
// in the preview has been removed (WARN, worth seeing — the publisher's
// row-delta guard is what actually stops a mass deletion).
//
// A key in BOTH whose value moved is the interesting one, and until 2026-09-20
// it was flatly an ERROR on the strength of this claim:
//
//     a new auction cannot move an old estimate: valueWithheld only reads sales
//     closing STRICTLY BEFORE the withheld auction, so its window is closed by
//     the time a later auction exists.
//
// THAT IS FALSE, and it conflates RECORDED later with CLOSED later. A publish
// that backfills an auction which already closed drops it straight into a
// window this file believed was sealed. Measured: PR #236 filled in prices for
// seven Trent auctions closing 2026-09-19, one day before 20274, and 20274's
// withheld `Ultra Rare` went from a mean over 4 sales in 2 auctions to one over
// 18 sales in 9 — -502.62 to -593.42. Nothing was wrong. The publish went red,
// and the caution the publisher writes on every such PR ("start from main, not
// from this PR's branch") cannot fix it, because the data producing the new
// value exists only on the publish branch. Trent closes arrive in batches, on
// days that already carry alesiev auctions, so this recurs by construction.
//
// What this file is actually for is catching a value that moved when NOTHING
// BEHIND IT DID — a changed recompute. So the preview records its inputs, and
// a drifted key is triaged rather than failed:
//
//   inputs moved (the lookback gained or lost an auction, or a quantity
//     changed)                        -> NOTE, naming what entered and left
//   inputs identical, value moved     -> ERROR. The same auctions at the same
//     quantities produced a different number: either a price inside an
//     already-audited window was edited, or the recompute changed. Both want a
//     human before they ship.
//   preview predates lookback_auctions -> NOTE. It cannot be asked, so it is
//     unverified, not incorrect — the onyxcheck precedent. Regenerating the
//     preview arms it again, and the note says so on every run.
const shared = [...A.keys()].filter((k) => B.has(k));
const added = [...A.keys()].filter((k) => !B.has(k));
const removed = [...B.keys()].filter((k) => !A.has(k));
const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
const moved = shared.filter((k) => {
  const a = A.get(k), b = B.get(k);
  return a.values.length !== b.values.length || a.values.some((v, i) => Math.abs(v - b.values[i]) > 0.01);
});
const inputsMoved = (k) => !same(A.get(k).qtys, B.get(k).qtys) || A.get(k).window !== B.get(k).window;
const drifted = hasWindowCol ? moved.filter((k) => !inputsMoved(k)) : [];
const restated = hasWindowCol ? moved.filter(inputsMoved) : moved;
const shows = (k) => `now [${A.get(k).values.map((v) => v.toFixed(2)).join(', ')}], ` +
  `audited [${B.get(k).values.map((v) => v.toFixed(2)).join(', ')}]`;
const setOf = (s) => new Set(s ? s.split(';') : []);

console.log(`Withheld recompute: ${withheld.length} rows vs ${preview.length} audited preview rows ` +
  `(${shared.length} shared, ${added.length} new, ${removed.length} gone)`);
if (drifted.length) {
  err(`${drifted.length} withheld (auction,item) group(s) drifted from the audited preview:`);
  for (const k of drifted.slice(0, 8)) {
    console.error(`      ${k}: ${shows(k)}`);
    console.error(`        same lookback (${A.get(k).window || 'none'}), same quantities — the inputs did not move.`);
  }
  console.error('      A value moving with its inputs unchanged means a price inside an already-audited');
  console.error('      window was edited, or the recompute itself changed. Check which before shipping.');
  console.error('      If the edit was deliberate: node scripts/gen-withheld-preview.mjs');
} else if (!restated.length) {
  console.log(`  ✓ all ${shared.length} audited withheld value(s) still match (±$0.01)`);
}
for (const k of restated) {
  if (!hasWindowCol) {
    note(`withheld estimate moved, ${shows(k)} — the audited preview predates the ` +
      'lookback_auctions column, so this cannot be triaged. Run node scripts/gen-withheld-preview.mjs');
    continue;
  }
  const a = A.get(k), b = B.get(k);
  const entered = [...setOf(a.window)].filter((x) => !setOf(b.window).has(x));
  const left = [...setOf(b.window)].filter((x) => !setOf(a.window).has(x));
  const why = [
    entered.length ? `+${entered.join(' +')}` : '',
    left.length ? `-${left.join(' -')}` : '',
    same(a.qtys, b.qtys) ? '' : `quantity ${b.qtys.join('/')} -> ${a.qtys.join('/')}`,
  ].filter(Boolean).join(', ');
  note(`withheld estimate moved because its inputs did (${why}): ${k}, ${shows(k)}. ` +
    'Expected on a backfill — bring the audit forward with node scripts/gen-withheld-preview.mjs');
}
for (const k of removed) note(`withheld row no longer present, was in the audited preview: ${k}`);
if (added.length) {
  console.log(`  · ${added.length} withheld row(s) not in the preview yet — new auctions, not drift. ` +
    'Run gen-withheld-preview.mjs when convenient to bring the audit forward.');
}

// === 2. domain rules ===
console.log('Domain rules:');
const salesByAuction = new Set(sales.map((s) => s.auctionId));
for (const m of meta) {
  const tf = money(m.targetFunding);
  if (tf != null && tf > 8000) note(`targetFunding > $8,000: ${m.auctionId} "${m.auctionName}" = $${tf} (flagged exception — Q4)`);
  const src = (m.auctioneer || '').trim().toLowerCase() === 'trent' || /trenttokens\.com/i.test(m.Link || '') ? 'Trent' : 'Forum';
  if (src === 'Trent' && Number(m.auctionSeason) < TRENT_START_SEASON) err(`Trent auction before season ${TRENT_START_SEASON}: ${m.auctionId}`);
  if (m.Status === 'Closed' && !salesByAuction.has(m.auctionId)) note(`Closed auction with no sales: ${m.auctionId} "${m.auctionName}" (data gap — Q5)`);
}
for (const s of objs(read(dataDir, 'prices.csv'))) {
  if (s.Category === 'Golden Ticket') {
    const cd = metaById.get(s.auctionId)?.closeDate ?? '';
    if (!(dateKey(cd) >= GT_ERA_DATE)) err(`Golden Ticket sale before guarantee era (${GT_ERA_DATE}): ${s.auctionId}`);
  }
}
// Rows pointing at an auction that is not in auctionMetadata. Both files join
// to metadata to be read at all, so an orphan is not a loud failure — it is
// silently dropped, and the auction's provenance or sales simply stop existing
// with nothing on screen to say so. The way this happens is removing an auction
// from auctionMetadata (a Failed one, say) without removing its rows here.
// Reported per auction rather than per row: one deleted auction can strand
// dozens, and thirteen copies of the same sentence is not thirteen problems.
for (const [file, rows] of [['contextItems.csv', ctx], ['prices.csv', sales]]) {
  const orphans = new Map();
  for (const r of rows) if (!metaById.has(r.auctionId)) orphans.set(r.auctionId, (orphans.get(r.auctionId) ?? 0) + 1);
  for (const [auctionId, n] of [...orphans].sort())
    err(`${file}: ${n} row${n === 1 ? '' : 's'} for auction ${auctionId}, which is not in auctionMetadata.csv — delete the rows too, or restore the auction`);
}

// Random-UR-looking augment names not in the Random-UR list — catches a NEW
// wording for the random URs (which should be released-payment) while leaving
// genuine "Ultra Rare Set" augments alone.
for (const r of ctx) {
  if ((r.category === 'token' || r.category === 'augment') && /random.*ultra ?rare/i.test(r.Item) && !RANDOM_UR.has(r.Item.trim().toLowerCase()))
    note(`random-UR-looking augment name not in the Random-UR list: ${r.auctionId} "${r.Item}" (would classify as personal augment)`);
}

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${fail} error(s), ${warn} warning(s)`);
process.exit(fail ? 1 : 0);
