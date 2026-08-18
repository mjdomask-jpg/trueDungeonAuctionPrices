// Validates the auction context layer outside the browser, mirroring
// src/lib/context.ts the way validate.mjs mirrors src/lib/data.ts.
//
// Two jobs:
//  1. Correctness: reproduce the withheld point-in-time recompute from the CSVs
//     and assert it matches the audited preview (docs/withheld-recompute-preview.csv)
//     to the cent. This is the guard that the shipped data + logic still agree
//     with the Phase-1 audit.
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
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const docsDir = join(here, '..', 'docs');

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
const sales = objs(read(dataDir, 'prices.csv'))
  .map((o) => ({ auctionId: o.auctionId, season: o.auctionSeason, displayName: cleanName(o['Display Name']), price: money(o.Price) }))
  .filter((s) => s.auctionId && Number.isFinite(s.price));
const meta = objs(read(dataDir, 'auctionMetadata.csv')).filter((o) => o.auctionId && /^\d+$/.test(o.auctionSeason));
const ctx = objs(read(dataDir, 'contextItems.csv')).filter((o) => o.auctionId);
// Context layer is Closed-auctions-only (mirror of buildContextItems).
const closedAuctions = new Set(meta.filter((m) => m.Status === 'Closed').map((m) => m.auctionId));

// --- mirror of context.ts ordering + recompute ---
const RANDOM_UR = new Set(['random ultra rare']);
const TRENT_START_SEASON = 2023;
const GT_ERA_DATE = '2024-11-27';
const WITHHELD_LOOKBACK_AUCTIONS = 5; // mirror of ERAS.withheldLookbackAuctions

const metaById = new Map(meta.map((m) => [m.auctionId, m]));
function instant(m) {
  const k = dateKey(m.closeDate);
  if (k) return Date.parse(k);
  return -1e15 + Number(m.auctionSeason) * 1000 + Number(m.auctionNumber);
}
const instantById = new Map(meta.map((m) => [m.auctionId, instant(m)]));
const seasonById = new Map(meta.map((m) => [m.auctionId, m.auctionSeason]));
const salesByName = new Map();
for (const s of sales) {
  const inst = instantById.get(s.auctionId); if (inst == null) continue;
  (salesByName.get(s.displayName) ?? salesByName.set(s.displayName, []).get(s.displayName))
    .push({ season: s.season, inst, auctionId: s.auctionId, price: s.price });
}
function valueWithheld(name, auctionId, qty, refValue) {
  const season = seasonById.get(auctionId), wInst = instantById.get(auctionId);
  const prior = (salesByName.get(name) ?? []).filter((s) => s.season === season && wInst != null && s.inst < wInst);
  if (!prior.length) return { value: refValue ?? 0, n: 0 };
  // Keep the N most-recent prior auctions (close instant desc, id tiebreak).
  const instByAuction = new Map();
  for (const s of prior) instByAuction.set(s.auctionId, s.inst);
  const recent = new Set([...instByAuction.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
    .slice(0, WITHHELD_LOOKBACK_AUCTIONS).map(([id]) => id));
  const window = prior.filter((s) => recent.has(s.auctionId));
  const mean = window.reduce((a, s) => a + s.price, 0) / window.length;
  return { value: -mean * qty, n: window.length };
}

let fail = 0, warn = 0;
const err = (m) => { console.error('  ✗ ' + m); fail++; };
const note = (m) => { console.warn('  ! ' + m); warn++; };

// === 1. withheld recompute vs audited preview ===
const withheld = ctx.filter((r) => r.category === 'withheld' && closedAuctions.has(r.auctionId)).map((r) => {
  const qty = parseFloat(r.quantity) || 1;
  const name = cleanName(r.Item);
  const { value } = valueWithheld(name, r.auctionId, qty, money(r.priceAugmented));
  return { auctionId: r.auctionId, name, value };
});
const preview = objs(read(docsDir, 'withheld-recompute-preview.csv'))
  .filter((o) => o.auctionId && o.new_PIT_value !== '')
  .map((o) => ({ auctionId: o.auctionId, name: cleanName(o['item(DisplayName)']), value: parseFloat(o.new_PIT_value) }));

// Group by (auction, item) and compare sorted values within a 1-cent tolerance —
// duplicate (auction, item) rows carry identical values, and the tolerance
// absorbs JS-vs-generator rounding while still catching any real (dollar) drift.
const group = (arr) => {
  const m = new Map();
  for (const x of arr) { const k = `${x.auctionId}|${x.name}`; (m.get(k) ?? m.set(k, []).get(k)).push(x.value); }
  for (const v of m.values()) v.sort((p, q) => p - q);
  return m;
};
const A = group(withheld), B = group(preview);
let mismatch = 0;
for (const k of new Set([...A.keys(), ...B.keys()])) {
  const a = A.get(k) ?? [], b = B.get(k) ?? [];
  if (a.length !== b.length || a.some((v, i) => Math.abs(v - b[i]) > 0.01)) mismatch++;
}
console.log(`Withheld recompute: ${withheld.length} rows vs ${preview.length} audited preview rows`);
if (withheld.length !== preview.length) err(`row count differs (${withheld.length} vs ${preview.length})`);
if (mismatch) err(`${mismatch} withheld (auction,item) group(s) do not match the audited preview`);
else console.log('  ✓ every withheld value matches docs/withheld-recompute-preview.csv (±$0.01)');

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
