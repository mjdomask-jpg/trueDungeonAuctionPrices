// Regenerates docs/withheld-recompute-preview.csv from the current CSVs.
//
// The preview is the audited golden file that validate-context.mjs checks the
// live withheld recompute against. When the sheet re-exports prices.csv /
// auctionMetadata.csv / contextItems.csv, the point-in-time withheld estimates
// legitimately move, so this rebuilds the preview to match. It SHARES its
// recompute with validate-context.mjs (scripts/lib/withheld.mjs), which is a
// mirror of src/lib/context.ts — run this, eyeball the diff, then run
// `npm run validate` to confirm they agree.
//
// Columns: auctionId, item(DisplayName), quantity, n_prior_sales_in_lookback,
// old_value, new_PIT_value, delta, status — the Phase-1 audit's eight — plus
// lookback_auctions and direction.
//   old_value  = the spreadsheet's original withheld figure (priceAugmented);
//                blank when that cell was an error (#N/A / #VALUE!).
//   new_PIT_value = the recomputed point-in-time estimate (−mean(window) × qty).
//   status     = FIXED_was_error when old_value was non-numeric, else recomputed
//                (no-prior if a row has no in-season sale in either direction).
//   lookback_auctions = the auctions whose sales went into the mean, sorted,
//                ';'-joined; blank when there were none. This is the value's
//                INPUT, and it is here so the check can tell an estimate that
//                moved because the data moved from one that moved because the
//                recompute did. See validate-context.mjs § 1.
//   direction  = back | forward | none. `forward` marks the rows where nothing
//                comparable had sold yet and the estimate had to read LATER
//                auctions of the same season — a season's first Onyx auction
//                withholding part of its own set. A different KIND of estimate,
//                so a human eyeballing this diff should be able to see which
//                ones they are without recomputing anything.
//
// Run: node scripts/gen-withheld-preview.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildWithheldIndex, valueWithheld } from './lib/withheld.mjs';

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
const cleanName = (s) => (s ?? '').replace(/^['`](?=[-+=@])/, '');

// --- load (mirror of validate-context.mjs) ---
// BOTH price feeds. An Onyx chase token that was withheld appears in no other
// file, so a prices-only index writes it into the golden file as $0 — which is
// precisely the silent zero this preview exists to make visible.
const priceRows = (file) => objs(read(dataDir, file))
  .map((o) => ({ auctionId: o.auctionId, season: o.auctionSeason, displayName: cleanName(o['Display Name']), price: money(o.Price) }))
  .filter((s) => s.auctionId && Number.isFinite(s.price));
const sales = [...priceRows('prices.csv'), ...priceRows('onyx.csv')];
const meta = objs(read(dataDir, 'auctionMetadata.csv')).filter((o) => o.auctionId && /^\d+$/.test(o.auctionSeason));
const ctx = objs(read(dataDir, 'contextItems.csv')).filter((o) => o.auctionId);
const closedAuctions = new Set(meta.filter((m) => m.Status === 'Closed').map((m) => m.auctionId));

// The recompute is scripts/lib/withheld.mjs, shared with validate-context.mjs
// so the file this writes and the check that reads it cannot disagree.
const withheldIdx = buildWithheldIndex(sales, meta);

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

// `direction` is appended, not inserted: validate-context.mjs and its test both
// address columns by NAME, and a trailing column leaves an older reader intact.
const header = ['auctionId', 'item(DisplayName)', 'quantity', 'n_prior_sales_in_lookback', 'old_value', 'new_PIT_value', 'delta', 'status', 'lookback_auctions', 'direction'];
const out = [header.join(',')];
let recomputed = 0, fixed = 0, noPrior = 0, forward = 0;

for (const r of ctx) {
  if (r.category !== 'withheld' || !closedAuctions.has(r.auctionId)) continue;
  const qty = parseFloat(r.quantity) || 1;
  const name = cleanName(r.Item);
  const old = money(r.priceAugmented); // null when the sheet cell was an error
  const { value, n, window, direction } = valueWithheld(name, r.auctionId, qty, old, withheldIdx);

  let status;
  if (old == null) { status = 'FIXED_was_error'; fixed++; }
  else if (n === 0) { status = 'no-prior'; noPrior++; }
  else { status = 'recomputed'; recomputed++; }
  if (direction === 'forward') forward++;

  const oldStr = old == null ? '' : String(old);
  const deltaStr = old == null ? '' : fmt(value - old);
  out.push([
    csvField(r.auctionId), csvField(name), qty, n, oldStr, fmt(value), deltaStr, status,
    csvField(window ?? ''), direction,
  ].join(','));
}

writeFileSync(join(docsDir, 'withheld-recompute-preview.csv'), out.join('\n') + '\n');
console.log(`Wrote ${out.length - 1} rows to docs/withheld-recompute-preview.csv`);
console.log(`  recomputed=${recomputed}  FIXED_was_error=${fixed}  no-prior=${noPrior}  read-forward=${forward}`);
