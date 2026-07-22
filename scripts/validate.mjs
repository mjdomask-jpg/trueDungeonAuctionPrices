// One-season validation of the aggregation logic.
// Usage: node scripts/validate.mjs [season]   (defaults to 2025)
// Reads the two source CSVs, joins on auctionId, and prints per-Item
// min/max/avg for (a) the full season and (b) the "last 5 auctions" under
// BOTH candidate definitions, so we can match against the existing sheet.
//
// This is the script src/lib/data.ts was ported from; it stays as an
// independent check on the aggregation, runnable against any season.

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const SEASON = process.argv[2] || '2025';
const PRICES = join(DATA, 'prices.csv');
const META = join(DATA, 'auctionMetadata.csv');

// --- Minimal RFC-4180 CSV parser (handles quoted fields with commas) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toObjects(rows) {
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

const load = f => toObjects(parseCSV(fs.readFileSync(f, 'utf8')));

// --- Load data ---
const meta = load(META);
const prices = load(PRICES);

// metadata lookup by auctionId
const metaById = new Map();
for (const m of meta) if (m.auctionId) metaById.set(m.auctionId, m);

// keep only real sales rows in the target season with a numeric price
const sales = prices.filter(p => {
  if (p.auctionSeason !== SEASON) return false;
  const price = parseFloat((p.Price || '').replace(/,/g, ''));
  if (!isFinite(price)) return false;
  p._price = price;
  p._num = parseInt(p.auctionNumber, 10); // ordering key within season
  return true;
});

if (!sales.length) { console.log(`No sales for season ${SEASON}`); process.exit(0); }

// The set of auctions (by number) that actually have sales this season, sorted.
const auctionNums = [...new Set(sales.map(s => s._num))].sort((a, b) => a - b);
const last5Overall = new Set(auctionNums.slice(-5)); // interpretation A

const stats = arr => {
  const v = arr.map(x => x._price);
  const sum = v.reduce((a, b) => a + b, 0);
  return { n: v.length, min: Math.min(...v), max: Math.max(...v), avg: sum / v.length };
};

// group by Item
const byItem = new Map();
for (const s of sales) {
  if (!byItem.has(s.Item)) byItem.set(s.Item, []);
  byItem.get(s.Item).push(s);
}

const fmt = n => (n == null ? '' : n.toFixed(2).padStart(8));
const pad = (s, w) => String(s).padEnd(w).slice(0, w);

console.log(`\nSeason ${SEASON}: ${sales.length} sales across ${auctionNums.length} auctions ` +
  `(numbers ${auctionNums[0]}..${auctionNums[auctionNums.length - 1]})`);
console.log(`"Last 5 overall" = auction numbers [${[...last5Overall].sort((a,b)=>a-b).join(', ')}]\n`);

console.log(
  pad('Item', 24), pad('Cat', 12),
  '| FULL SEASON  n   min      max      avg',
  '  | LAST5(overall)  min      max      avg',
  '  | LAST5(per-item)  min      max      avg'
);
console.log('-'.repeat(150));

for (const [item, rows] of [...byItem.entries()].sort()) {
  const full = stats(rows);

  const aRows = rows.filter(r => last5Overall.has(r._num));           // A: last 5 overall
  const a = aRows.length ? stats(aRows) : null;

  const itemNums = [...new Set(rows.map(r => r._num))].sort((x, y) => x - y).slice(-5);
  const bSet = new Set(itemNums);
  const b = stats(rows.filter(r => bSet.has(r._num)));                 // B: last 5 for this item

  console.log(
    pad(item, 24), pad(rows[0].Category, 12),
    '|', String(full.n).padStart(4), fmt(full.min), fmt(full.max), fmt(full.avg),
    '  |', a ? fmt(a.min) : '     -  ', a ? fmt(a.max) : '', a ? fmt(a.avg) : '',
    '  |', fmt(b.min), fmt(b.max), fmt(b.avg)
  );
}
