// Integrity check for the transmute recipe table and its price sources.
// Usage: npm run validate   (or: node scripts/validate-recipes.mjs)
// Cross-checks transmuteRecipes / tokenMetadata / offAuctionPrices / prices for
// duplicate keys, bad ResolvedYear arithmetic, unresolvable ingredients, source
// cycles, and missing price coverage. See docs/expansion-plan.md §4.1-§4.3.
//
// These CSVs are exported from the source spreadsheet straight into public/data
// — there is no separate staging copy, so what the site serves is what this
// checks.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data') + '/';

// --- minimal RFC4180 CSV parser (handles quoted commas) ---
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}
const problems = [];
const add = (sev, cat, msg) => problems.push({ sev, cat, msg });

// ---------- schema guard ----------
// Every file below shares one vocabulary: a token is `Item`, its season is
// `auctionSeason` (or `Year` on the recipe side), its label is `Display Name`,
// its class is `Category`. The source spreadsheet is authored by hand, so a
// re-export under the pre-rename headers is the likely way this breaks — and it
// breaks silently, indexing every row under "undefined". Fail loudly instead.
// `renamed` maps each retired header to its replacement so the message says
// exactly what to fix in the sheet.
const SCHEMA = {
  'prices.csv': {
    required: ['auctionId', 'auctionSeason', 'auctionNumber', 'Item', 'Price', 'Display Name', 'Category'],
    renamed: {},
  },
  'tokenMetadata.csv': {
    required: ['key', 'auctionSeason', 'Item', 'Display Name', 'Category'],
    renamed: { year: 'auctionSeason', canonicalName: 'Item', displayName: 'Display Name', tokenCategory: 'Category' },
  },
  'transmuteRecipes.csv': {
    required: ['Key', 'Year', 'Level', 'Transmute', 'Item', 'ItemYear', 'ResolvedYear', 'Display Name', 'Quantity', 'IsSource'],
    renamed: { Good: 'Item', GoodYear: 'ItemYear', GoodDisplayName: 'Display Name' },
  },
  'offAuctionPrices.csv': {
    required: ['Key', 'Year', 'Category', 'Item', 'Display Name', 'max Price', 'avg Price', 'min Price'],
    renamed: { Good: 'Item' },
  },
};

const load = (f) => {
  const rows = parseCSV(readFileSync(ROOT + f, 'utf8'));
  const head = rows[0].map(h => h.trim());
  const spec = SCHEMA[f];
  if (spec) {
    const present = new Set(head);
    const missing = spec.required.filter(c => !present.has(c));
    // A retired header still in the file names the exact edit the sheet needs.
    const stale = Object.entries(spec.renamed).filter(([old]) => present.has(old));
    for (const [old, now] of stale)
      add('ERROR', 'schema', `${f}: stale column "${old}" — rename it to "${now}" in the source sheet`);
    const unexplained = missing.filter(c => !stale.some(([, now]) => now === c));
    // Spacing and capitalisation are the easy ones to get wrong by hand:
    // "DisplayName" for "Display Name", "item" for "Item". Point at the actual
    // cell rather than reporting the column as simply absent.
    const fold = s => s.toLowerCase().replace(/\s+/g, '');
    const nearMiss = new Map(head.map(h => [fold(h), h]));
    const typos = [], absent = [];
    for (const c of unexplained) {
      const got = nearMiss.get(fold(c));
      if (got !== undefined) typos.push([got, c]); else absent.push(c);
    }
    for (const [got, want] of typos)
      add('ERROR', 'schema', `${f}: column "${got}" should be "${want}" — spelling differs only in spacing/case`);
    if (absent.length)
      add('ERROR', 'schema', `${f}: missing column${absent.length > 1 ? 's' : ''} ${absent.map(c => `"${c}"`).join(', ')}`);
  }
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
};

// The root exports now carry the same filenames as their site/public/data
// counterparts, so a sync is a plain copy and this validator reads the exports.
const recipes = load('transmuteRecipes.csv');
const meta    = load('tokenMetadata.csv');
const fleece  = load('offAuctionPrices.csv');
const prices  = load('prices.csv');

// Every check below reads columns by name, so on a schema failure they would all
// fire at once against undefined values — thousands of lines burying the one
// message that matters. Report the schema and stop.
if (problems.some(p => p.cat === 'schema')) {
  for (const p of problems) console.log(`[${p.sev}] ${p.cat}: ${p.msg}`);
  console.log(`\n--- ${problems.length} schema errors; downstream checks skipped ---`);
  process.exit(1);
}

// ---------- indexes ----------
const metaByKey = new Map();          // auctionSeason+Item -> row
const metaDupes = new Map();
for (const m of meta) {
  const k = m.auctionSeason + m.Item;
  if (metaByKey.has(k)) metaDupes.set(k, (metaDupes.get(k) ?? 1) + 1);
  else metaByKey.set(k, m);
}
for (const [k, n] of metaDupes) add('WARN', 'tokenMetadata', `duplicate key "${k}" appears ${n}x`);

const transmuteNames = new Set(recipes.map(r => r.Transmute));
const fleeceYears = new Set(fleece.map(f => f.Year));
const fleeceGood  = new Set(fleece.map(f => f.Item));

// auction-priced (year, item) pairs
const pricedPairs = new Set(prices.map(p => p.auctionSeason + '|' + p.Item));
const pricedItems = new Set(prices.map(p => p.Item));
const pricedYears = new Set(prices.map(p => p.auctionSeason));

// ---------- per-row recipe checks ----------
const seenKeys = new Map();
const LEVELS = new Set(['Enhanced','Exalted','Relic','Legendary','Arcanum','Paragon','Mythic',
                        'Eldritch','Omni','Safehold','Patron']);
const unresolvedGoods = new Map();   // "year|good" -> count
const usedGoodYears = new Set();

for (const [i, r] of recipes.entries()) {
  const ln = i + 2;
  const yr = Number(r.Year), gy = r.ItemYear, rv = Number(r.ResolvedYear);

  // duplicate key
  if (seenKeys.has(r.Key)) add('ERROR', 'dup-key', `line ${ln}: Key duplicates line ${seenKeys.get(r.Key)} -> ${r.Key}`);
  else seenKeys.set(r.Key, ln);

  // key composition
  const expectKey = [r.Year, r.Transmute, r.Item, r.ItemYear, r.IsSource].join('|');
  if (r.Key !== expectKey) add('ERROR', 'key-formula', `line ${ln}: Key "${r.Key}" != composed "${expectKey}"`);

  // resolved year arithmetic
  const expectRY = gy === '' ? yr : (Number(gy) < 1900 ? yr + Number(gy) : Number(gy));
  if (rv !== expectRY) add('ERROR', 'resolved-year', `line ${ln}: ResolvedYear ${rv} != expected ${expectRY} (Year ${yr}, ItemYear "${gy}")`);

  // quantity
  if (!/^[0-9]+$/.test(r.Quantity)) add('ERROR', 'quantity', `line ${ln}: non-integer Quantity "${r.Quantity}" (${r.Transmute} / ${r.Item})`);
  else if (Number(r.Quantity) === 0) add('ERROR', 'quantity', `line ${ln}: zero Quantity (${r.Transmute} / ${r.Item})`);

  // IsSource
  if (!['TRUE','FALSE'].includes(r.IsSource.toUpperCase())) add('ERROR', 'issource', `line ${ln}: IsSource "${r.IsSource}"`);

  // level
  if (!LEVELS.has(r.Level)) add('WARN', 'level', `line ${ln}: unknown Level "${r.Level}" (${r.Transmute})`);

  // self reference
  if (r.Item === r.Transmute) add('ERROR', 'self-ref', `line ${ln}: ${r.Transmute} lists itself as an ingredient`);

  // good resolution
  const mk = rv + r.Item;
  const known = metaByKey.has(mk) || transmuteNames.has(r.Item) || fleeceGood.has(r.Item);
  if (!known) {
    const k = rv + '|' + r.Item;
    unresolvedGoods.set(k, (unresolvedGoods.get(k) ?? 0) + 1);
  }

  // display name agreement
  const m = metaByKey.get(mk);
  if (m && r["Display Name"] && r["Display Name"] !== m["Display Name"]
       && !r["Display Name"].endsWith('(transmute)')) {
    add('WARN', 'display-name', `line ${ln}: recipe Display Name "${r["Display Name"]}" != tokenMetadata "${m["Display Name"]}" for ${rv} ${r.Item}`);
  }

  usedGoodYears.add(rv);
}

for (const [k, n] of [...unresolvedGoods].sort()) {
  const [y, g] = k.split('|');
  add('ERROR', 'unknown-good', `"${g}" @ ${y} not in tokenMetadata / transmutes / fleece  (${n} row${n>1?'s':''})`);
}

// ---------- season fallback (expansion-plan.md §4.4) ----------
// nominal season -> priced season. Clamps into the range that actually has data:
//   below range -> earliest, full-year   |   above range -> latest, last-5
const priced = [...pricedYears].map(Number).sort((a, b) => a - b);
const earliestPriced = priced[0], latestPriced = priced[priced.length - 1];
function pricingSeason(nominal) {
  const n = Number(nominal);
  if (n < earliestPriced) return { season: earliestPriced, variant: 'full',  mapped: true };
  if (n > latestPriced)   return { season: latestPriced,   variant: 'last5', mapped: true };
  return { season: n, variant: 'full', mapped: false };
}

// ---------- cross-file coverage (post-fallback) ----------
const fleeceUseYears = new Set(recipes.filter(r => fleeceGood.has(r.Item)).map(r => r.ResolvedYear));
for (const y of [...fleeceUseYears].sort()) {
  if (fleeceYears.has(y)) continue;
  const ps = pricingSeason(y);
  if (fleeceYears.has(String(ps.season)))
    add('INFO', 'fleece-fallback', `Fleece @ ${y} -> ${ps.season} (${ps.variant}) via season fallback`);
  else
    add('ERROR', 'fleece-coverage', `recipes need Fleece @ ${y}; fallback season ${ps.season} also missing from pricesFleece`);
}
const trophyYears = new Set(recipes.filter(r => r.Item === 'Monster Trophy').map(r => r.ResolvedYear));
for (const y of [...trophyYears].sort()) {
  if (fleeceYears.has(y)) continue;
  const ps = pricingSeason(y);
  if (fleeceYears.has(String(ps.season)))
    add('INFO', 'derived-fallback', `Monster Trophy @ ${y} prices off Fleece @ ${ps.season} (${ps.variant})`);
  else
    add('ERROR', 'derived-price', `Monster Trophy @ ${y}: neither Fleece @ ${y} nor fallback ${ps.season} exists`);
}

// ---------- category agreement between metadata and the off-auction table ----------
const metaCatByName = new Map(meta.map(m => [m.Item, m.Category]));
for (const f of fleece) {
  const mc = metaCatByName.get(f.Item);
  if (mc && f.Category && mc !== f.Category && f.Category !== 'Transmute')
    add('WARN', 'category-mismatch', `"${f.Item}": tokenMetadata says "${mc}", pricesFleece says "${f.Category}"`);
  if (!mc && f.Item !== 'Fleece')
    add('WARN', 'off-auction-meta', `"${f.Item}" priced in pricesFleece but absent from tokenMetadata`);
  const expectKey = f.Year + f.Item;
  if (f.Key && f.Key !== expectKey)
    add('WARN', 'fleece-key', `pricesFleece Key "${f.Key}" != auctionSeason+Item "${expectKey}"`);
}

// ---------- source / recursion checks ----------
const bySrc = new Map();
for (const r of recipes) if (r.IsSource.toUpperCase() === 'TRUE') {
  const k = r.Year + '|' + r.Transmute;
  bySrc.set(k, [...(bySrc.get(k) ?? []), r.Item]);
}
for (const [k, goods] of bySrc) if (goods.length > 1)
  add('WARN', 'multi-source', `${k} has ${goods.length} IsSource rows: ${goods.join(', ')}`);

// A line naming another transmute is nearly always the upgrade-from token, so
// IsSource=FALSE on one is usually an authoring slip. The engine costs it
// either way (it recurses on any transmute-named good); what the flag decides
// is whether the "I already own the source" toggle can exclude it.
for (const r of recipes) {
  if (r.IsSource.toUpperCase() === 'TRUE' || !transmuteNames.has(r.Item)) continue;
  add('WARN', 'source-flag', `${r.Year} ${r.Transmute} consumes transmute "${r.Item}" @${r.ResolvedYear} with IsSource=FALSE — should this be TRUE?`);
}

// cycle detection over source edges within a season
const edges = new Map();
for (const r of recipes) if (r.IsSource.toUpperCase() === 'TRUE' && transmuteNames.has(r.Item))
  edges.set(r.Year + '|' + r.Transmute, r.ResolvedYear + '|' + r.Item);
for (const start of edges.keys()) {
  const seen = new Set(); let cur = start;
  while (edges.has(cur)) {
    if (seen.has(cur)) { add('ERROR', 'cycle', `source cycle involving ${start}`); break; }
    seen.add(cur); cur = edges.get(cur);
  }
}

// ---------- price coverage for leaf goods ----------
const missingPrice = new Map();
for (const r of recipes) {
  if (transmuteNames.has(r.Item) || fleeceGood.has(r.Item) || r.Item === 'Monster Trophy') continue;
  if (!pricedYears.has(r.ResolvedYear)) continue;          // whole season un-priced; reported separately
  if (!pricedPairs.has(r.ResolvedYear + '|' + r.Item)) {
    const k = r.ResolvedYear + '|' + r.Item;
    missingPrice.set(k, (missingPrice.get(k) ?? 0) + 1);
  }
}
for (const [k, n] of [...missingPrice].sort().slice(0, 25)) {
  const [y, g] = k.split('|');
  add('WARN', 'no-price', `no auction price for "${g}" @ ${y} (${n} row${n>1?'s':''})`);
}
if (missingPrice.size > 25) add('WARN', 'no-price', `... and ${missingPrice.size - 25} more (good,season) pairs with no auction price`);

const unpricedSeasons = [...usedGoodYears].filter(y => !pricedYears.has(String(y))).sort((a,b)=>a-b);
for (const y of unpricedSeasons) {
  const ps = pricingSeason(y);
  add('INFO', 'season-fallback', `season ${y} has no auction data -> prices from ${ps.season} (${ps.variant})`);
}

// ---------- report ----------
console.log(`recipes: ${recipes.length} rows | tokenMetadata: ${meta.length} | pricesFleece: ${fleece.length}`);
console.log(`recipe seasons: ${[...new Set(recipes.map(r=>r.Year))].sort().join(', ')}`);
console.log(`price data seasons: ${[...pricedYears].sort().join(', ')}`);
console.log(`fleece price seasons: ${[...fleeceYears].sort().join(', ')}`);
console.log('');
const order = { ERROR: 0, WARN: 1, INFO: 2 };
problems.sort((a, b) => order[a.sev] - order[b.sev] || a.cat.localeCompare(b.cat));
if (!problems.length) console.log('No problems found.');
for (const p of problems) console.log(`[${p.sev}] ${p.cat}: ${p.msg}`);
console.log(`\n--- ${problems.filter(p=>p.sev==='ERROR').length} errors, ${problems.filter(p=>p.sev==='WARN').length} warnings ---`);
