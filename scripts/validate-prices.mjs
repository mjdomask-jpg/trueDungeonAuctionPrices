// Reconciliation validator — Phase 1 of data-pipeline-plan.md.
//
// The other validators check *shape*: that the CSVs parse, join and stay
// internally consistent. Nothing compared a recorded price against the source
// it was derived from, and that is where every defect Phase 0 fixed actually
// lived. This script closes that gap. Seven checks, all file-vs-file, no
// network and no external dependency:
//
//   1. Trent min/max reconcile   — prices.csv vs rawPricesData.csv
//   2. Duplicate-block detector  — one auction's prices copied onto another
//   3. Quantity guard            — trentPrice / qty(lot name) === Price
//   4. Metadata hygiene          — ids, dates, daysToClose, numbering, Links
//   5. Non-numeric prices        — in every keyed price file
//   6. Onyx and context integrity
//   7. Closed vocabularies       — Phase 7's dropdowns, backstopped at the gate
//
// Exit non-zero on an ERROR. WARNs are things a human should look at that are
// not provably wrong; INFO is expected-but-worth-stating. Run:
//   node scripts/validate-prices.mjs [--check-links] [--data <dir>]
//
// --data points the run at a directory other than public/data, so a fresh
// export can be checked before it is copied into the repo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataArg = process.argv.indexOf('--data');
const dataDir = dataArg === -1 ? join(here, '..', 'public', 'data') : resolve(process.argv[dataArg + 1]);
const CHECK_LINKS = process.argv.includes('--check-links');

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
const load = (f) => objs(readFileSync(join(dataDir, f), 'utf8'));
const money = (s) => { const n = parseFloat((s ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };

// Sheets rounds half AWAY FROM ZERO; JS's Math.round is half-up and binary
// division leaves a tie sitting a hair below its true value ($8.29/2 lands on
// 4.14499…, not 4.145). Re-quantising to 12 significant digits erases that
// noise without reaching any real difference, then the sign is restored.
// Getting this wrong makes check 3 fire on 15 historical rows that are correct.
const round2 = (n) => {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.round(Number((Math.abs(n) * 100).toPrecision(12))) / 100;
};

let fail = 0, warn = 0;
const err = (m) => { console.error('  ✗ ' + m); fail++; };
const note = (m) => { console.warn('  ! ' + m); warn++; };
const info = (m) => { console.log('  · ' + m); };
const ok = (m) => { console.log('  ✓ ' + m); };
// Errors of one kind can arrive by the hundred from a single bad paste. Report
// the first few in full and count the rest, so the real signal stays readable.
const capped = (level, items, head = 20) => {
  for (const m of items.slice(0, head)) level(m);
  if (items.length > head) {
    const extra = items.length - head;
    const line = `  … and ${extra} more of the same kind`;
    if (level === err) { console.error(line); fail += extra; }
    else { console.warn(line); warn += extra; }
  }
};

// --- load ---
if (dataArg !== -1) console.log(`Validating ${dataDir}\n`);
const prices = load('prices.csv');
const raw = load('rawPricesData.csv');
const onyx = load('onyx.csv');
const meta = load('auctionMetadata.csv');
const ctx = load('contextItems.csv');
const metaById = new Map(meta.filter((m) => m.auctionId).map((m) => [m.auctionId, m]));

const key = (r) => `${r.auctionId}|${r.Item}`;
const groupBy = (rows, k, v) => {
  const m = new Map();
  for (const r of rows) { const g = k(r); (m.get(g) ?? m.set(g, []).get(g)).push(v(r)); }
  return m;
};

// ===========================================================================
// 1. Trent min/max reconcile
// ===========================================================================
// prices.csv stores a per-item summary of the per-lot rows in rawPricesData.
// The summary convention changed between eras and BOTH are live:
//   season 2024+  two rows per item, the min and the max of its lots (one row
//                 where every lot fetched the same price)
//   season 2023   a single averaged row — the first 15 Trent auctions
// So 2024+ is an exact set equality; for 2023 the strongest sound assertion is
// that the recorded price falls inside the lot range. A single-price era row
// outside its own range is a WARN, not an error: it is not provably a
// transcription defect the way a broken min/max is, and four such rows are
// live today.
console.log('1. Trent min/max reconcile (prices.csv vs rawPricesData.csv)');
const MINMAX_FROM_SEASON = 2024;
const rawLots = groupBy(raw.filter((r) => r.auctionId && r.Item), key, (r) => money(r.Price));
const priceRows = groupBy(prices.filter((r) => r.auctionId && r.Item), key, (r) => money(r.Price));
const rawAuctionIds = new Set(raw.map((r) => r.auctionId).filter(Boolean));
{
  const errs = [], warns = [];
  let checked = 0;
  for (const [k, lots] of rawLots) {
    const [auctionId, item] = k.split('|');
    const season = Number(metaById.get(auctionId)?.auctionSeason ?? auctionId.slice(0, 4));
    const values = lots.filter((v) => v != null);
    if (!values.length) continue;
    const recorded = priceRows.get(k);
    if (!recorded) {
      warns.push(`${auctionId} "${item}": ${values.length} lot(s) in rawPricesData but no row in prices.csv — the item is missing from the site entirely`);
      continue;
    }
    checked++;
    const min = Math.min(...values), max = Math.max(...values);
    if (season >= MINMAX_FROM_SEASON) {
      const want = min === max ? [min] : [min, max];
      const got = [...new Set(recorded.filter((v) => v != null))].sort((a, b) => a - b);
      if (got.length !== want.length || got.some((v, i) => Math.abs(v - want[i]) > 0.005))
        errs.push(`${auctionId} "${item}": prices.csv has [${got.join(', ')}] but its ${values.length} lot(s) give [${want.join(', ')}]`);
    } else {
      for (const v of recorded) {
        if (v == null) continue;
        if (v < min - 0.005 || v > max + 0.005)
          warns.push(`${auctionId} "${item}": recorded $${v} is outside its own lot range $${min}–$${max} (${values.length} lots, single-price era)`);
      }
    }
  }
  // The mirror direction: an auction with per-lot data carrying a priced item
  // lots behind it. Legitimate off-auction additions exist, so this is a WARN.
  for (const [k, vals] of priceRows) {
    const [auctionId, item] = k.split('|');
    if (rawAuctionIds.has(auctionId) && !rawLots.has(k))
      warns.push(`${auctionId} "${item}": priced at [${vals.join(', ')}] in prices.csv with no lots in rawPricesData`);
  }
  capped(err, errs); capped(note, warns);
  if (!errs.length) ok(`${checked} (auction, item) group(s) across ${rawAuctionIds.size} auction(s) with per-lot data reconcile to their lots`);
}

// ===========================================================================
// 2. Duplicate-block detector
// ===========================================================================
// Defects #1 and #2 were whole auctions whose price block was a verbatim copy
// of a neighbour's. Signature = every (item, sorted prices) pair in the
// auction, so two auctions collide only if they agree on every item to the
// cent. Blocks of one or two items can collide by chance; a real auction
// carries ~20, so only those are worth asserting on.
console.log('2. Duplicate-block detector (prices.csv)');
{
  const MIN_ITEMS = 5;
  const byAuction = new Map();
  for (const p of prices) {
    if (!p.auctionId || !p.Item) continue;
    const a = byAuction.get(p.auctionId) ?? byAuction.set(p.auctionId, new Map()).get(p.auctionId);
    (a.get(p.Item) ?? a.set(p.Item, []).get(p.Item)).push(money(p.Price));
  }
  const bySig = new Map();
  for (const [auctionId, items] of byAuction) {
    if (items.size < MIN_ITEMS) continue;
    const sig = [...items].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([item, vals]) => `${item}=${vals.filter((v) => v != null).sort((x, y) => x - y).join('/')}`).join('|');
    (bySig.get(sig) ?? bySig.set(sig, []).get(sig)).push(auctionId);
  }
  const errs = [];
  for (const ids of bySig.values()) {
    if (ids.length < 2) continue;
    const sorted = ids.sort();
    errs.push(`auctions ${sorted.join(', ')} have identical price blocks (${byAuction.get(sorted[0]).size} items, every price equal to the cent) — one is a copy of the other`);
  }
  capped(err, errs);
  if (!errs.length) ok(`no two of the ${[...byAuction.values()].filter((i) => i.size >= MIN_ITEMS).length} auctions with ${MIN_ITEMS}+ items share a price block`);
}

// ===========================================================================
// 3. Quantity guard
// ===========================================================================
// Trent sells multi-token lots; the per-token Price is the lot price divided by
// the quantity stated in the lot name. Verified against all 18,466 rows.
//
//   lead    = a leading "N x "                 -> per-unit multiplier
//   lotSize = "(N Tokens)" or a mid-name "xN"  -- these state the SAME number
//   qty     = lead x (lotSize or 1)
//
// "1,000 GP Gold Bar x4 #1 (4 Tokens)" is 4, not 16 — the x4 and the (4 Tokens)
// are one fact written twice. "3X Treasure Chips x 4 #1 (4 Tokens)" is 12: a
// leading 3 times a lot size of 4. Where the two spellings of lot size
// disagree, say so and never guess.
console.log('3. Quantity guard (rawPricesData.csv)');
function parseLotQuantity(name) {
  let s = name ?? '';
  const lead = s.match(/^(\d+)\s*[xX]\s+/);
  const leadN = lead ? parseInt(lead[1], 10) : 1;
  if (lead) s = s.slice(lead[0].length);
  const tokens = s.match(/\(\s*(\d+)\s*Tokens?\s*\)/i);
  const tokenN = tokens ? parseInt(tokens[1], 10) : null;
  const mid = s.match(/\s[xX]\s*(\d+)(?![\d.])/);
  const midN = mid ? parseInt(mid[1], 10) : null;
  const conflict = tokenN != null && midN != null && tokenN !== midN;
  const lotSize = tokenN ?? midN ?? 1;
  return { quantity: leadN * lotSize, conflict, tokenN, midN };
}
{
  const errs = [];
  let checked = 0;
  for (const r of raw) {
    if (!r.auctionId) continue;
    const { quantity, conflict, tokenN, midN } = parseLotQuantity(r.trentName);
    if (conflict) {
      errs.push(`${r.auctionId} "${r.trentName}": lot size stated twice and they disagree — "(${tokenN} Tokens)" vs "x${midN}"`);
      continue;
    }
    const lot = money(r.trentPrice), unit = money(r.Price);
    if (lot == null || unit == null) continue; // check 5 owns missing prices
    checked++;
    const expected = round2(lot / quantity);
    if (Math.abs(expected - unit) > 0.005)
      errs.push(`${r.auctionId} "${r.trentName}": $${lot} / ${quantity} = $${expected} but Price is $${unit}`);
  }
  capped(err, errs);
  if (!errs.length) ok(`${checked} lot(s) divide down to their recorded per-token price`);
}

// ===========================================================================
// 4. Metadata hygiene
// ===========================================================================
console.log('4. Metadata hygiene (auctionMetadata.csv)');
{
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const errs = [], warns = [];
  const seenId = new Set();
  const numbersBySeason = new Map();
  for (const m of meta) {
    if (!m.auctionId) continue;
    const where = `${m.auctionId} "${m.auctionName}"`;
    if (seenId.has(m.auctionId)) errs.push(`${where}: duplicate auctionId`);
    seenId.add(m.auctionId);
    if (m.auctionId !== `${m.auctionSeason}${m.auctionNumber}`)
      errs.push(`${where}: auctionId is not season+number (expected ${m.auctionSeason}${m.auctionNumber})`);
    for (const f of ['openDate', 'closeDate']) {
      const v = m[f];
      if (!v) { if (m.Status === 'Closed') warns.push(`${where}: Closed but ${f} is empty`); continue; }
      if (!ISO.test(v)) errs.push(`${where}: ${f} "${v}" is not zero-padded YYYY-MM-DD`);
    }
    if (ISO.test(m.openDate) && ISO.test(m.closeDate)) {
      const span = Math.round((Date.parse(m.closeDate) - Date.parse(m.openDate)) / 86400000);
      // An auction that opens and closes on the same date is a one-day auction,
      // not a zero-day one: all 16 of them carry daysToClose = 1, and every
      // other row in the file is the plain date difference.
      const days = Math.max(span, 1);
      if (span < 0) errs.push(`${where}: closeDate ${m.closeDate} is before openDate ${m.openDate}`);
      else if (m.daysToClose !== '' && Number(m.daysToClose) !== days)
        errs.push(`${where}: daysToClose is ${m.daysToClose} but ${m.openDate}→${m.closeDate} is ${days} day(s)`);
    }
    if (!m.Link) warns.push(`${where}: no Link`);
    else if (!/^https?:\/\/(www\.)?(truedungeon\.com|trenttokens\.com)\//i.test(m.Link))
      warns.push(`${where}: Link is not a truedungeon.com or trenttokens.com URL — ${m.Link}`);
    const season = Number(m.auctionSeason), number = Number(m.auctionNumber);
    if (Number.isFinite(season) && Number.isFinite(number)) {
      const s = numbersBySeason.get(season) ?? numbersBySeason.set(season, new Map()).get(season);
      (s.get(number) ?? s.set(number, []).get(number)).push(m.auctionId);
    }
  }
  // A repeated number inside a season is an error; a missing one is not. Gaps
  // are deleted Failed rows — a normal event that leaves no trace behind, so
  // they are stated and never counted against the run.
  for (const [season, numbers] of [...numbersBySeason].sort((a, b) => a[0] - b[0])) {
    for (const [n, ids] of numbers) if (ids.length > 1) errs.push(`season ${season}: auctionNumber ${n} used by ${ids.join(' and ')}`);
    const all = [...numbers.keys()].sort((a, b) => a - b);
    const gaps = [];
    for (let n = all[0]; n < all[all.length - 1]; n++) if (!numbers.has(n)) gaps.push(n);
    if (gaps.length) info(`season ${season}: auctionNumber gap(s) at ${gaps.join(', ')} (deleted Failed auctions — expected)`);
  }
  capped(err, errs); capped(note, warns);
  if (!errs.length) ok(`${seenId.size} auction(s): ids, dates, daysToClose and numbering are consistent`);

  if (CHECK_LINKS) {
    console.log('   checking Link reachability…');
    const links = meta.filter((m) => m.Link).map((m) => [m.auctionId, m.Link]);
    const dead = [];
    for (const [auctionId, link] of links) {
      try {
        const res = await fetch(link, { method: 'HEAD', redirect: 'follow' });
        if (!res.ok) dead.push(`${auctionId}: ${link} → HTTP ${res.status}`);
      } catch (e) { dead.push(`${auctionId}: ${link} → ${e.message}`); }
    }
    capped(note, dead);
    if (!dead.length) ok(`all ${links.length} Links resolve`);
  } else {
    info('Link reachability skipped — pass --check-links to hit the network (kept out of CI: a forum outage is not a data defect)');
  }
}

// ===========================================================================
// 5. A Price that is not a number, in every keyed price file
// ===========================================================================
// Two causes have been seen and neither is legitimate: "-" pasted out of the
// pivot table, and a blank left by a row created when the auction opened and
// never filled in. The blank is the dangerous one — parseSales silently drops
// any row it cannot price, so 42 empty rows sat in onyx.csv for months and
// moved no statistic on the site. A keyed row with no price means somebody
// meant to come back to it. Blank is NOT "unsold": a genuine no-sale emits no
// row at all.
console.log('5. Non-numeric prices (prices.csv, onyx.csv, rawPricesData.csv)');
{
  const errs = [];
  for (const [file, rows, fields] of [
    ['prices.csv', prices, ['Price']],
    ['onyx.csv', onyx, ['Price']],
    ['rawPricesData.csv', raw, ['trentPrice', 'Price']],
  ]) {
    for (const [i, r] of rows.entries()) {
      if (!r.auctionId) continue;
      for (const f of fields) {
        if (money(r[f]) != null) continue;
        const shown = r[f] === '' ? 'blank' : `"${r[f]}"`;
        errs.push(`${file} row ${i + 2}: ${r.auctionId} "${r.trentName || r.Item}" has ${f} = ${shown}`);
      }
    }
  }
  capped(err, errs);
  if (!errs.length) ok('every keyed row in all three price files carries a numeric price');
}

// ===========================================================================
// 6. Onyx and context integrity
// ===========================================================================
console.log('6. Onyx and context integrity (onyx.csv, contextItems.csv)');
{
  const errs = [], warns = [];
  for (const [i, r] of onyx.entries()) {
    if (!r.auctionId) continue;
    const where = `onyx.csv row ${i + 2} (${r.auctionId} "${r.Item}")`;
    if (r.Category !== 'Onyx Ultra Rare') errs.push(`${where}: Category is "${r.Category}", must be "Onyx Ultra Rare"`);
    if (r.Item !== r['Display Name']) errs.push(`${where}: Display Name "${r['Display Name']}" does not match Item`);
    // The Onyx marker arrives in eight different shapes across four
    // auctioneers — prefix, caps suffix, parenthetical, parenthetical with a
    // trailing year. Item is where the stripper's output lands, so any
    // surviving "onyx" is proof a shape was missed.
    if (/onyx/i.test(r.Item)) errs.push(`${where}: the Onyx marker was not stripped from Item`);
  }
  // An Onyx set is one full set of the season's chase URs plus the C/UC/R Set
  // row, so the row count is tightly constrained: measured across all 48
  // auctions it is 21 (x32), 20 (x15) or 40 (x1, a genuine two-set auction).
  // Anything else is either a partial transcription or a doubled block — which
  // is exactly how the placeholder blocks presented, as 42 rows that looked
  // like two sets until you noticed half of them had no price.
  const onyxByAuction = groupBy(onyx.filter((r) => r.auctionId), (r) => r.auctionId, (r) => r);
  const SET_SIZES = new Set([20, 21, 40, 42]);
  for (const [auctionId, rows] of [...onyxByAuction].sort())
    if (!SET_SIZES.has(rows.length))
      warns.push(`${auctionId}: ${rows.length} Onyx rows — expected 20–21 for one set or 40–42 for two`);

  // auctionStyle and the rows must agree in both directions. 16 auctions
  // violated this before the 2026-08-21 backfill; the count is zero today, so
  // any violation from here is a genuine defect rather than a backlog.
  for (const m of meta) {
    if (!m.auctionId) continue;
    const styled = /onyx/i.test(m.auctionStyle || '');
    const hasRows = onyxByAuction.has(m.auctionId);
    if (styled && !hasRows) errs.push(`${m.auctionId} "${m.auctionName}": auctionStyle "${m.auctionStyle}" says Onyx but onyx.csv has no rows`);
    if (!styled && hasRows) errs.push(`${m.auctionId} "${m.auctionName}": ${onyxByAuction.get(m.auctionId).length} onyx.csv rows but auctionStyle "${m.auctionStyle}" does not say Onyx`);
  }
  for (const auctionId of onyxByAuction.keys())
    if (!metaById.has(auctionId)) errs.push(`onyx.csv: rows for auction ${auctionId}, which is not in auctionMetadata.csv`);

  // The same agreement, for the OTHER thing auctionStyle predicts.
  //
  // A CONDENSED order — one whose style says Condensed without Super or Ultra —
  // includes two items the condensed formats do not: a bag of 120 random Rares
  // and a bag of 240 random Uncommons. `tokenMetadata` has carried both for
  // every season since 2012, under their own Category `Condensed`.
  //
  // Measured 2026-08-24: of the 8 auctions whose style says Condensed, 5 carry
  // their bag rows and 3 do not — 20192, 202111 and 20225. Two of those three
  // do state bag lots in their threads; nobody had a rule that said to look.
  //
  // A NOTE rather than an error, for two reasons. The gap is pre-existing, so
  // erroring would block every publish until three historical auctions are
  // filled in. And absence can be legitimate: 20192's thread sells no bags at
  // all despite the style, so the right resolution there may be the style
  // rather than the rows. The check says which auctions to look at; it does not
  // presume to know which way the disagreement resolves.
  const CONDENSED_ONLY = /condensed/i;
  const CONDENSED_EXCLUDES = /super|ultra/i;
  const bagsByAuction = groupBy(
    prices.filter((r) => r.auctionId && /^(Rare|Uncommon) Bag$/.test(r.Item)),
    (r) => r.auctionId, (r) => r);
  for (const m of meta) {
    if (!m.auctionId) continue;
    const style = m.auctionStyle || '';
    const isCondensed = CONDENSED_ONLY.test(style) && !CONDENSED_EXCLUDES.test(style);
    const hasBags = bagsByAuction.has(m.auctionId);
    if (isCondensed && !hasBags) {
      warns.push(`${m.auctionId} "${m.auctionName}": auctionStyle "${style}" is a Condensed order, ` +
        'which includes a Rare Bag and an Uncommon Bag, but prices.csv has neither');
    }
    if (!isCondensed && hasBags) {
      warns.push(`${m.auctionId} "${m.auctionName}": ${bagsByAuction.get(m.auctionId).length} bag row(s) ` +
        `but auctionStyle "${style}" is not a Condensed order`);
    }
  }

  // contextItems: a four-value vocabulary and an absolute sign convention.
  // withheld is what the auctioneer kept back, so it is a debit; token and
  // grunnel are what was sold, so they are credits. A sign flip here silently
  // inverts the funding analytics.
  const CATEGORIES = new Set(['token', 'grunnel', 'withheld', 'augment']);
  for (const [i, r] of ctx.entries()) {
    if (!r.auctionId) continue;
    const where = `contextItems.csv row ${i + 2} (${r.auctionId} "${r.Item}")`;
    if (!CATEGORIES.has(r.category)) errs.push(`${where}: category "${r.category}" is not one of ${[...CATEGORIES].join(', ')}`);
    const qty = Number(r.quantity);
    if (!Number.isInteger(qty) || qty <= 0) errs.push(`${where}: quantity "${r.quantity}" is not a positive integer`);
    const price = money(r.priceAugmented);
    if (price == null) continue; // withheld prices are computed by the sheet; blank is legitimate
    if (r.category === 'withheld' && price > 0) errs.push(`${where}: withheld price $${price} is positive — withheld is a debit`);
    if ((r.category === 'token' || r.category === 'grunnel') && price < 0) errs.push(`${where}: ${r.category} price $${price} is negative`);
  }
  capped(err, errs); capped(note, warns);
  if (!errs.length) ok(`${onyx.length} Onyx row(s) across ${onyxByAuction.size} auction(s) and ${ctx.length} context row(s) are internally consistent`);
  // Not checkable here: the plan's Trent-completeness partition (rawPricesData
  // lots + onyx rows + unsold === the source file's row count) needs Trent's
  // own close file, which never enters the repo. It belongs to Phase 2, at
  // ingest, while the file is in hand.
}

// ===========================================================================
// 7. Closed vocabularies
// ===========================================================================
// Phase 7's dropdowns, backstopped where it counts. A dropdown stops someone
// TYPING `SUper Condensed`; it does not stop a paste, and every routine update
// to this workbook is a paste. So the vocabulary is checked here too, where the
// gate actually is.
//
// The rule is NOT an allow-list, because two of these columns legitimately
// grow: `auctionStyle` gained `Safehold Onyx Super Condensed` and `Limited`,
// one auction each, and a validator that failed on a genuinely new format would
// block a publish for doing nothing wrong.
//
// What is never legitimate is a value that differs from an existing one only in
// CASE or WHITESPACE. That is a typo by construction — nobody means to record
// two auction styles that a reader cannot tell apart — and it is exactly the
// defect Phase 0 found: `SUper Condensed`, which survived a backfill because
// nothing compared it to the `Super Condensed` sitting beside it.
//
// So: a near-miss is an ERROR, a genuinely new value is stated and passes.
console.log('7. Closed vocabularies (auctionMetadata.csv, prices.csv, onyx.csv, rawPricesData.csv)');
{
  const tokens = load('tokenMetadata.csv');
  const errs = [], warns = [];
  const fold = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').trim();

  // `Category` is the one closed set that does NOT grow independently: every
  // category a price can carry has to exist in tokenMetadata, because that is
  // where the site reads a token's category from. A price row carrying one
  // tokenMetadata has never heard of is unjoinable, not merely unusual.
  const known = new Set(tokens.map((t) => t.Category).filter(Boolean));
  for (const [file, rows] of [['prices.csv', prices], ['rawPricesData.csv', raw]]) {
    const seen = new Map();
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i].Category;
      if (!rows[i].auctionId || !c || known.has(c)) continue;
      if (!seen.has(c)) seen.set(c, i + 2);
    }
    for (const [c, row] of seen) {
      const near = [...known].find((k) => fold(k) === fold(c));
      errs.push(near
        ? `${file} row ${row}: Category "${c}" differs from tokenMetadata's "${near}" only in case or spacing`
        : `${file} row ${row}: Category "${c}" is in no tokenMetadata row — nothing can join to it`);
    }
  }

  // The four hand-typed vocabulary columns. `Status` and `augmentated` are
  // genuinely closed — both are the output of a two-way decision — so anything
  // outside them is an error. `auctionStyle` and `completionStyle` may grow.
  const COLUMNS = [
    { field: 'auctionStyle', closed: false },
    { field: 'completionStyle', closed: false },
    { field: 'Status', closed: true, allowed: ['Open', 'Closed'] },
    { field: 'augmentated', closed: true, allowed: ['Yes', 'No'] },
  ];
  for (const col of COLUMNS) {
    const counts = new Map(), firstRow = new Map();
    for (let i = 0; i < meta.length; i++) {
      if (!meta[i].auctionId) continue;
      const v = meta[i][col.field];
      if (v === undefined || v === '') continue;
      counts.set(v, (counts.get(v) || 0) + 1);
      if (!firstRow.has(v)) firstRow.set(v, i + 2);
    }
    const values = [...counts.keys()];
    if (col.closed) {
      for (const v of values) {
        if (col.allowed.includes(v)) continue;
        const near = col.allowed.find((a) => fold(a) === fold(v));
        errs.push(`auctionMetadata.csv row ${firstRow.get(v)}: ${col.field} "${v}" is not ${col.allowed.join(' or ')}` +
          (near ? ` — it differs from "${near}" only in case or spacing` : ''));
      }
      continue;
    }
    // A growing vocabulary: fold every value and complain only where two
    // spellings collapse together. The one kept is whichever is commoner, so
    // the message names the odd one out rather than an arbitrary half of a pair.
    const byFold = new Map();
    for (const v of values) (byFold.get(fold(v)) ?? byFold.set(fold(v), []).get(fold(v))).push(v);
    for (const [, spellings] of byFold) {
      if (spellings.length < 2) continue;
      spellings.sort((a, b) => counts.get(b) - counts.get(a));
      const keep = spellings[0];
      for (const odd of spellings.slice(1)) {
        errs.push(`auctionMetadata.csv row ${firstRow.get(odd)}: ${col.field} "${odd}" (${counts.get(odd)} row(s)) ` +
          `differs from "${keep}" (${counts.get(keep)} row(s)) only in case or spacing`);
      }
    }
    const rare = values.filter((v) => counts.get(v) === 1);
    if (rare.length) {
      info(`${col.field}: ${values.length} distinct value(s); used once: ${rare.map((v) => `"${v}"`).join(', ')} ` +
        '(one-offs are normal here — new auction formats appear)');
    }
  }

  capped(err, errs); capped(note, warns);
  if (!errs.length) {
    ok(`${known.size} token categor(y/ies) cover every price row, and no vocabulary column carries two spellings of one value`);
  }
}

// ===========================================================================
// 8. One item, one spelling (contextItems.csv)
// ===========================================================================
// § 7 guards the vocabulary COLUMNS. `contextItems.Item` is not one of those —
// it is free text, and it has to be, because an augment can be any token ever
// printed. But free text is not licence to spell one item two ways, and nothing
// was checking it: the site groups these rows by `Item`, so two spellings are
// two series, each with half the history.
//
// This is a measured defect, not a hypothetical. The 2022 backfill wrote
// `Folio: Brawn` into eight rows from one auctioneer's shorthand, and a later
// pass — correcting the prefix to the official `Folio of X` but not the suffix —
// left `Folio of Reflex` beside `Folio of Reflexes`. A fix aimed at a split
// created one, and the PR gate would have passed it.
//
// TWO SEVERITIES, because the two cases are not equally certain:
//
//   ERROR   differs only in CASE or WHITESPACE. A typo by construction — the
//           same rule § 7 applies, for the same reason.
//   NOTE    differs only in PUNCTUATION or a trailing plural. Usually one item,
//           but not always: `+1 Turkey Leg` and `+1 Turkey Leg of Smiting` are
//           two different tokens whose names contain one another, and merging
//           that pair would collapse 87 lots of 2022 into one price series. So
//           this one is surfaced for a human, never asserted.
// It looks OUTSIDE contextItems too, because the split does. `Figurine of Power
// Phoenix` sits in contextItems while `Figurine of Power: Phoenix` sits in
// onyx.csv, and a check confined to one file cannot see that pair at all.
console.log('8. One item, one spelling (contextItems.csv)');
{
  const errs = [], warns = [];
  // Folds the apostrophe the way the resolver does — see foldName in
  // trentClose.gs. A curly and a straight apostrophe now RESOLVE alike, which
  // is why `Shaman's Belt` is findable at all; the data should still not lean
  // on that, because the two spellings still split a series here.
  const soft = (v) => String(v).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
  const hard = (v) => soft(v).replace(/[^a-z0-9]/g, '').replace(/(e?s)$/, '');

  const counts = new Map(), firstRow = new Map(), source = new Map();
  for (const [i, r] of ctx.entries()) {
    if (!r.auctionId || !r.Item) continue;
    counts.set(r.Item, (counts.get(r.Item) || 0) + 1);
    if (!firstRow.has(r.Item)) firstRow.set(r.Item, i + 2);
    source.set(r.Item, 'contextItems.csv');
  }
  // Every canonical name an item could have been spelled as. Only names that
  // COLLIDE with a context item are reported, so this adds no noise of its own.
  for (const [file, rows, fields] of [
    ['tokenMetadata.csv', load('tokenMetadata.csv'), ['Item', 'Display Name']],
    ['onyx.csv', onyx, ['Item']],
    ['prices.csv', prices, ['Item']],
  ]) {
    for (const r of rows) {
      for (const f of fields) {
        const v = r[f];
        if (!v || counts.has(v)) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
        if (!source.has(v)) source.set(v, file);
      }
    }
  }
  const names = [...counts.keys()];

  // Group twice. The commonest spelling is the one kept, so the message names
  // the odd one out rather than an arbitrary half of a pair.
  const group = (fold) => {
    const by = new Map();
    for (const n of names) {
      const k = fold(n);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(n);
    }
    return [...by.values()].filter((g) => g.length > 1)
      .map((g) => g.sort((a, b) => counts.get(b) - counts.get(a)));
  };
  const describe = (n) => `"${n}" [${source.get(n)}` +
    (firstRow.has(n) ? ` row ${firstRow.get(n)}` : '') + ']';
  // A group is only ours if a contextItems name is in it — two spellings that
  // both live in the price files are somebody else's problem, and § 7 owns them.
  const mine = (g) => g.some((n) => source.get(n) === 'contextItems.csv');

  const softGroups = group(soft).filter(mine);
  for (const g of softGroups) {
    for (const odd of g.slice(1)) {
      warns.push(`Item ${describe(odd)} differs from ${describe(g[0])} only in case, spacing or apostrophe — ` +
        'the resolver folds these together, but they are still two rows and two series here');
    }
  }
  // Only report a hard collision the soft pass did not already catch.
  const alreadyFlagged = new Set(softGroups.flat().map(soft));
  for (const g of group(hard).filter(mine)) {
    if (alreadyFlagged.has(soft(g[0]))) continue;
    warns.push(`Item ${describe(g[0])} and ${g.slice(1).map(describe).join(', ')} ` +
      'differ only in punctuation or a trailing plural — one item under two names, or two items? ' +
      '(never merged automatically: "+1 Turkey Leg" and "+1 Turkey Leg of Smiting" are different tokens)');
  }

  // ONE APOSTROPHE, THE STRAIGHT ONE. Maintainer's standard, 2026-08-24.
  //
  // `foldName` in trentClose.gs makes a curly apostrophe RESOLVE like a straight
  // one, which stops a lookup failing. It does not stop the data holding both,
  // and holding both splits a series here — `Shaman’s Belt` in tokenMetadata
  // against `Shaman's Belt` in contextItems is exactly that, and is very likely
  // how a real token came to be filed as a context item in the first place.
  //
  // ERROR, not a note: unlike the near-miss pairs above, there is nothing to
  // arbitrate. A curly apostrophe in a name is always wrong.
  //
  // Deliberately NOT auto-normalised anywhere in the pipeline. `Thor’' Mug of
  // Melee` carries a curly AND a straight one; folding it mechanically gives
  // `Thor''`, which is still wrong and now looks deliberate. A human has to
  // read these.
  const CURLY = /[‘’ʼ´]/;
  const NAME_FIELDS = ['Item', 'Display Name', 'key', 'Key'];
  for (const [file, rows] of [
    ['tokenMetadata.csv', load('tokenMetadata.csv')],
    ['contextItems.csv', ctx],
    ['onyx.csv', onyx],
    ['prices.csv', prices],
    ['transmuteRecipes.csv', load('transmuteRecipes.csv')],
  ]) {
    const seen = new Set();
    for (const [i, r] of rows.entries()) {
      for (const f of NAME_FIELDS) {
        const v = r[f];
        if (!v || !CURLY.test(v) || seen.has(v)) continue;
        seen.add(v);
        errs.push(`${file} row ${i + 2}: ${f} "${v}" uses a curly apostrophe — names are spelled with the straight one`);
      }
    }
  }

  capped(err, errs); capped(note, warns);
  const ctxNames = [...source].filter(([, s]) => s === 'contextItems.csv').length;
  if (errs.length) { /* the errors say it */ }
  else if (!warns.length) ok(`${ctxNames} distinct context item name(s), each spelled one way here and in the price files`);
  else ok(`${ctxNames} distinct context item name(s) checked against tokenMetadata, onyx and prices`);
}

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${fail} error(s), ${warn} warning(s)`);
process.exit(fail ? 1 : 0);
