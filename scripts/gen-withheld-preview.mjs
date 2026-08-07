// Regenerates docs/withheld-recompute-preview.csv from the current CSVs.
//
// The preview is the audited golden file that validate-context.mjs checks the
// live withheld recompute against. When the sheet re-exports prices.csv /
// auctionMetadata.csv / contextItems.csv, the point-in-time withheld estimates
// legitimately move, so this rebuilds the preview to match. It mirrors the same
// ordering + recompute as src/lib/context.ts (and validate-context.mjs) — run
// this, eyeball the diff, then run `npm run validate` to confirm they agree.
//
// Columns (unchanged from the Phase-1 audit): auctionId, item(DisplayName),
// quantity, n_prior_sales_in_lookback, old_value, new_PIT_value, delta, status.
//   old_value  = the spreadsheet's original withheld figure (priceAugmented);
//                blank when that cell was an error (#N/A / #VALUE!).
//   new_PIT_value = the recomputed point-in-time estimate (−mean(prior) × qty).
//   status     = FIXED_was_error when old_value was non-numeric, else recomputed
//                (no-prior if a row somehow has no in-season prior sales).
//
// Run: node scripts/gen-withheld-preview.mjs

import { readFileSync, writeFileSync } from 'node:fs';
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
const cleanName = (s) => (s ?? '').replace(/^['`](?=[-+=@])/, '');

// --- load (mirror of validate-context.mjs) ---
const sales = objs(read(dataDir, 'prices.csv'))
  .map((o) => ({ auctionId: o.auctionId, season: o.auctionSeason, displayName: cleanName(o['Display Name']), price: money(o.Price) }))
  .filter((s) => s.auctionId && Number.isFinite(s.price));
const meta = objs(read(dataDir, 'auctionMetadata.csv')).filter((o) => o.auctionId && /^\d+$/.test(o.auctionSeason));
const ctx = objs(read(dataDir, 'contextItems.csv')).filter((o) => o.auctionId);
const closedAuctions = new Set(meta.filter((m) => m.Status === 'Closed').map((m) => m.auctionId));

const WITHHELD_LOOKBACK_AUCTIONS = 5; // mirror of ERAS.withheldLookbackAuctions

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
  const instByAuction = new Map();
  for (const s of prior) instByAuction.set(s.auctionId, s.inst);
  const recent = new Set([...instByAuction.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
    .slice(0, WITHHELD_LOOKBACK_AUCTIONS).map(([id]) => id));
  const window = prior.filter((s) => recent.has(s.auctionId));
  const mean = window.reduce((a, s) => a + s.price, 0) / window.length;
  return { value: -mean * qty, n: window.length };
}

// Format like the Phase-1 Python generator: round to 2 dp, keep at least one
// decimal place so a whole dollar reads "-1.0" rather than "-1".
function fmt(x) {
  const r = Math.round(x * 100) / 100;
  let s = r.toFixed(2);
  s = s.replace(/0$/, '');       // -1.00 -> -1.0 ; -135.20 -> -135.2
  return s;
}
const csvField = (v) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = ['auctionId', 'item(DisplayName)', 'quantity', 'n_prior_sales_in_lookback', 'old_value', 'new_PIT_value', 'delta', 'status'];
const out = [header.join(',')];
let recomputed = 0, fixed = 0, noPrior = 0;

for (const r of ctx) {
  if (r.category !== 'withheld' || !closedAuctions.has(r.auctionId)) continue;
  const qty = parseFloat(r.quantity) || 1;
  const name = cleanName(r.Item);
  const old = money(r.priceAugmented); // null when the sheet cell was an error
  const { value, n } = valueWithheld(name, r.auctionId, qty, old);

  let status;
  if (old == null) { status = 'FIXED_was_error'; fixed++; }
  else if (n === 0) { status = 'no-prior'; noPrior++; }
  else { status = 'recomputed'; recomputed++; }

  const oldStr = old == null ? '' : String(old);
  const deltaStr = old == null ? '' : fmt(value - old);
  out.push([
    csvField(r.auctionId), csvField(name), qty, n, oldStr, fmt(value), deltaStr, status,
  ].join(','));
}

writeFileSync(join(docsDir, 'withheld-recompute-preview.csv'), out.join('\n') + '\n');
console.log(`Wrote ${out.length - 1} rows to docs/withheld-recompute-preview.csv`);
console.log(`  recomputed=${recomputed}  FIXED_was_error=${fixed}  no-prior=${noPrior}`);
