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

// Lot quantity, used by § 1 and § 3. Trent sells multi-token lots; the per-token
// Price is the lot price divided by the quantity stated in the lot name.
// Verified against all 18,466 rows.
//
//   lead    = a leading "N x "                 -> per-unit multiplier
//   lotSize = "(N Tokens)" or a mid-name "xN"  -- these state the SAME number
//   qty     = lead x (lotSize or 1)
//
// "1,000 GP Gold Bar x4 #1 (4 Tokens)" is 4, not 16 — the x4 and the (4 Tokens)
// are one fact written twice. "3X Treasure Chips x 4 #1 (4 Tokens)" is 12: a
// leading 3 times a lot size of 4. Where the two spellings of lot size
// disagree, say so and never guess.
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

// $0.25 is the opening bid. It is the lowest lot total anywhere in the corpus
// (166 lots sit there; the next distinct totals are $0.26 and $0.30, and nothing
// is below it), so a lot closing at $0.25 drew no competing bid.
//
// CONFIRMED by the maintainer on 2026-09-01: $0.25 is the minimum bid across
// all three sources — Trent, the forum, and alesievauctions.com. It was inferred
// from the shape of the corpus when this rule was written, and the inference
// held. One number, not three, so nothing here needs to vary by source.
const BID_FLOOR = 0.25;

// A lot that closes at the opening bid AND holds more than one token is not a
// market observation. Its per-token price is the unbid floor divided by the lot
// size, which is below any price the auction could have transacted: you cannot
// bid less than $0.25 for anything.
//
// Both halves matter. 165 of the 166 at-floor lots hold a SINGLE token, where
// $0.25 is exactly what somebody paid — the Adventurers' Guild Button closes
// there routinely, and excluding those would throw away a real fact about that
// token. Only the multi-token case divides, and the corpus holds exactly one:
// 20253 "Darkwood Plank (3 Tokens)" at $0.25, which published $0.08/token
// against eleven 10x lots of the same token at $0.83-$1.03.
//
// The rule is deliberately mechanical rather than statistical. A Tukey fence on
// the minimum moves 34 of 173 season pools, most of them by 1.01x-1.2x, and
// those are legitimate cheap sales (2022 "1,000 GP Gold Bar" $10.00 -> $11.00 —
// somebody really paid $10.00). And "drop the odd remainder lot" is simply not
// true of the data: across 716 groups the remainder lot's median is 97% of the
// standard lot's per-token rate and 35% of them clear ABOVE it.
//
// Applied identically in apps-script/trentClose.gs, which is what WRITES these
// summary rows. If the two ever disagree, one of two checks catches it: this
// section fails, or the trent-close replay in scripts/trent-close.test.mjs does.
const isBidFloorArtifact = (l) => l.lot != null && l.lot <= BID_FLOOR && l.quantity > 1;

// ===========================================================================
// 1. Trent min/max reconcile
// ===========================================================================
// prices.csv stores a per-item summary of the per-lot rows in rawPricesData:
// two rows per item, the min and the max of its lots, and a SINGLE row where
// the item had only one lot. One rule, exact set equality, every season.
//
// It was not always one rule. The first 15 Trent auctions — all of season 2023
// — recorded a single row per item instead, so this section carried an era
// split: exact equality from 2024, and for 2023 the weaker assertion that the
// recorded price fell inside its own lot range. Those auctions were backfilled
// to min/max pairs on 2026-09-02 (PR #169), which left the era branch with no
// data to run on: rawPricesData begins at 2023, so nothing reached it and
// nothing in validate-prices.test.mjs ever had. It came out with the backfill.
//
// The reason to delete it rather than leave it as history: an unreachable
// branch reads as a live rule. The next person to hit a single-row item would
// have found a documented carve-out saying that is allowed, when what it
// actually means now is that trentClose.gs wrote one row for a one-lot item.
//
// The set equality is computed over the ELIGIBLE lots, not over every lot —
// see isBidFloorArtifact above. That widens the contract rather than loosening
// it: the assertion is still exact equality to the cent, so a mistyped price
// still fails here. What changed is that the basis is now stated in one named
// predicate instead of being silently assumed to be "all lots". Relaxing the
// comparison instead (nearest lot, a percentage tolerance) would also stop
// catching the transcription defects this section exists for.
console.log('1. Trent min/max reconcile (prices.csv vs rawPricesData.csv)');
const rawLots = groupBy(raw.filter((r) => r.auctionId && r.Item), key, (r) => ({
  unit: money(r.Price),
  lot: money(r.trentPrice),
  quantity: parseLotQuantity(r.trentName).quantity,
}));
const priceRows = groupBy(prices.filter((r) => r.auctionId && r.Item), key, (r) => money(r.Price));
const rawAuctionIds = new Set(raw.map((r) => r.auctionId).filter(Boolean));
{
  const errs = [], warns = [];
  let checked = 0, excludedLots = 0;
  for (const [k, lots] of rawLots) {
    const [auctionId, item] = k.split('|');
    const priced = lots.filter((l) => l.unit != null);
    if (!priced.length) continue;
    const recorded = priceRows.get(k);
    if (!recorded) {
      warns.push(`${auctionId} "${item}": ${priced.length} lot(s) in rawPricesData but no row in prices.csv — the item is missing from the site entirely`);
      continue;
    }
    checked++;
    // Never exclude the whole group: an item sold only as at-floor multi-token
    // lots still has to publish the price it actually fetched.
    const eligible = priced.filter((l) => !isBidFloorArtifact(l));
    const basis = (eligible.length ? eligible : priced).map((l) => l.unit);
    const excluded = priced.length - basis.length;
    if (excluded) excludedLots += excluded;
    const values = basis;
    const min = Math.min(...values), max = Math.max(...values);
    const want = min === max ? [min] : [min, max];
    const got = [...new Set(recorded.filter((v) => v != null))].sort((a, b) => a - b);
    if (got.length !== want.length || got.some((v, i) => Math.abs(v - want[i]) > 0.005))
      errs.push(`${auctionId} "${item}": prices.csv has [${got.join(', ')}] but its ${values.length} eligible lot(s) give [${want.join(', ')}]`
        + (excluded ? ` (${excluded} at-the-$${BID_FLOOR}-floor multi-token lot(s) excluded — see isBidFloorArtifact)` : ''));
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
  // Surfaced every run, not silent: an exclusion that grows without anyone
  // noticing is how a rule stops being the narrow mechanical one it claims to
  // be. One lot corpus-wide is the measured figure today.
  if (excludedLots) info(`${excludedLots} lot(s) excluded from the reconcile basis as at-the-$${BID_FLOOR}-floor multi-token lots (isBidFloorArtifact)`);
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
// The lot-name quantity parse this section asserts on lives above, next to the
// helpers, because § 1 needs it too: an at-the-floor lot is only excluded from
// the reconcile basis when it holds more than one token.
console.log('3. Quantity guard (rawPricesData.csv)');
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
// 4b. preorderTotal recomputes from the price rows under it
// ===========================================================================
// `preorderTotal` is a formula in the workbook, not a typed value, and it is
// the sum of two QUERYs over `prices`:
//
//   max(Price where Item = 'Treasure Chip')  x  chips per 8K order
// + max(Price where Item = 'Preorder Bonus') x  32
//
// It exists here because it went WRONG and nothing noticed. Treasure Chips
// used to come 48 to an order in 3x lots — 16 physical lots — and `prices`
// recorded the price of a 3x lot, so the formula multiplied by 16. In 2026 the
// order became 50 chips in 10x lots, two lot sizes for one token. Rather than
// carry both, the maintainer refactored `prices` to hold the PER-CHIP price
// (2018-2025 divided by 3, 2026 by 10) — and the 2018-2025 formula kept its
// x16. Every pre-2026 preorderTotal was a third of what it should have been,
// on a column the site reads for Analytics -> Funding & Context. Corrected in
// the 2026-09-03 publish; this section is what stops it recurring.
//
// The multiplier is CHIPS PER ORDER, which is a fact about the order and not
// about the auction: 48 through 2025, 50 from 2026. Both halves of that were
// confirmed by the maintainer. A season this table does not know is a NOTE
// rather than a silent pass — when the order composition changes again, the
// honest outcome is "nobody has told me what 2027 is", not a green tick.
//
// Deliberately checked against `prices.csv` rather than against the formula
// text: the formula is not in the export, and a check that could only compare
// two spreadsheet strings would have said nothing about the years of wrong
// numbers underneath. The 133 auctions with no preorder rows at all reconcile
// as 0 = 0, so the count reported is the one that is actually load-bearing.
const CHIPS_PER_ORDER = [[2026, 50], [2018, 48]]; // [from season, chips], newest first
const chipsPerOrder = (season) => (CHIPS_PER_ORDER.find(([from]) => season >= from) ?? [])[1] ?? null;
const PREORDER_BONUS_PER_ORDER = 32;
console.log('4b. preorderTotal reconcile (auctionMetadata.csv vs prices.csv)');
{
  const errs = [], notes = [];
  let checked = 0, vacuous = 0;
  const pricesByAuction = new Map();
  for (const p of prices) {
    if (!p.auctionId) continue;
    if (!pricesByAuction.has(p.auctionId)) pricesByAuction.set(p.auctionId, []);
    pricesByAuction.get(p.auctionId).push(p);
  }
  const maxPrice = (id, item) => {
    const v = (pricesByAuction.get(id) ?? []).filter((r) => r.Item === item)
      .map((r) => money(r.Price)).filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  };
  const unknownSeasons = new Set();
  for (const m of meta) {
    if (!m.auctionId) continue;
    const recorded = money(m.preorderTotal);
    if (recorded == null) continue;
    const season = Number(m.auctionSeason);
    const chips = chipsPerOrder(season);
    if (chips == null) { unknownSeasons.add(season); continue; }
    const chip = maxPrice(m.auctionId, 'Treasure Chip');
    const bonus = maxPrice(m.auctionId, 'Preorder Bonus');
    if (chip == null && bonus == null) { vacuous++; }
    else checked++;
    const want = round2((chip ?? 0) * chips + (bonus ?? 0) * PREORDER_BONUS_PER_ORDER);
    if (Math.abs(recorded - want) > 0.02)
      errs.push(`${m.auctionId} "${m.auctionName}": preorderTotal is $${recorded} but its rows give $${want.toFixed(2)}`
        + ` (Treasure Chip ${chip == null ? 'none' : '$' + chip} x ${chips}`
        + `, Preorder Bonus ${bonus == null ? 'none' : '$' + bonus} x ${PREORDER_BONUS_PER_ORDER})`);
  }
  for (const s of [...unknownSeasons].sort())
    notes.push(`season ${s} is not in CHIPS_PER_ORDER, so its preorderTotal was not checked — add the chips-per-8K-order count for that season`);
  capped(err, errs); capped(note, notes);
  if (!errs.length) ok(`${checked} auction(s) with preorder rows reconcile to their preorderTotal (${vacuous} more have no preorder rows and reconcile as $0)`);
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
// 5b. An auction that has lost all of its prices
// ===========================================================================
// A row in `auctionMetadata` with nothing in `prices.csv` is an auction that
// silently disappeared from every statistic on the site. It has never been a
// legitimate state: measured over all 289 auctions of nine seasons, every one
// carries price rows — a failed auction is DELETED from the metadata rather
// than left empty, which is the settled convention (maintainer, 2026-08-26).
//
// WHY THIS EXISTS. Correcting the 20193/20196 transposition re-keyed 20195's
// twenty rows onto 20193 instead of swapping the intended pair, leaving 20193
// with two complete sets and 20195 with none — and the full validator passed
// with zero errors, because nothing looked at whether an auction still had any
// prices at all. An auction losing its entire price history is the largest
// silent data loss this file can be asked to catch, and it was the one shape
// it could not see.
//
// This is a STRUCTURAL check, not a count expectation: it says the rows are
// gone, not that there are the wrong number of them. Item counts per order are
// reported as evidence elsewhere and deliberately gate nothing.
console.log('5b. Every auction still has prices (auctionMetadata.csv vs prices.csv)');
{
  const priced = new Set(prices.map((r) => r.auctionId));
  const errs = [];
  for (const m of meta) {
    if (!m.auctionId || priced.has(m.auctionId)) continue;
    errs.push(`${m.auctionId} "${m.auctionName}" (${m.auctionSeason}, ${m.auctioneer}) is in auctionMetadata ` +
      'but has NO rows in prices.csv — the auction has lost its prices, or its rows were re-keyed onto another auction');
  }
  capped(err, errs);
  if (!errs.length) ok(`all ${meta.filter((m) => m.auctionId).length} auction(s) in auctionMetadata carry price rows`);
}

// ===========================================================================
// 5c. The same two questions of onyx.csv
// ===========================================================================
// § 5b asks whether an auction still has its prices. It cannot see the same
// loss in `onyx.csv`: 202234 lost ALL twenty of its Onyx rows to 202219 and
// § 5b never fired, because it reads `prices.csv` and 202234's price rows were
// intact. Two checks, and only the first of them would have caught that.
//
// AN ONYX ITEM RECORDED TWICE FOR ONE AUCTION IS THE SHAPE THAT CANNOT BE
// LEGITIMATE. `prices.csv` deliberately allows exactly two rows for one item —
// the min/max entry convention, which 119 auctions use (105 before the 2023
// backfill brought fifteen more onto it) — and that is why § 5b's
// note says 20193's duplicates could not be caught by counting. `onyx.csv` has
// no such convention: measured over all 1,118 rows of nine seasons, 52 of the
// 53 Onyx auctions carry each item exactly once, and the 53rd is 202219, which
// holds twenty pairs because 202234's twenty rows were keyed onto it. One
// offender, and it is the bug.
//
// So this is the counting check § 5b could not be, and it is only available
// here because the file has no two-row convention to hide behind.
console.log('5c. No auction records an Onyx item twice (onyx.csv)');
{
  const seen = new Map();
  for (const r of onyx) {
    if (!r.auctionId || !r.Item) continue;
    const key = `${r.auctionId} ${r.Item}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const errs = [];
  const byAuction = new Map();
  for (const [key, n] of seen) {
    if (n < 2) continue;
    const [id, item] = key.split(' ');
    if (!byAuction.has(id)) byAuction.set(id, []);
    byAuction.get(id).push(`${item} x${n}`);
  }
  for (const [id, items] of byAuction) {
    const m = metaById.get(id);
    errs.push(`${id} "${m ? m.auctionName : '?'}" records ${items.length} Onyx item(s) more than once ` +
      `(${items.slice(0, 3).join(', ')}${items.length > 3 ? ', …' : ''}) — an Onyx order holds each item once, ` +
      'so these are two auctions\' rows superimposed, or one pasted twice');
  }
  capped(err, errs);
  if (!errs.length) {
    ok(`each of ${new Set(onyx.map((r) => r.auctionId)).size} Onyx auction(s) records every item exactly once`);
  }
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
  // row, so the row count is tightly constrained: measured across all 53
  // auctions of nine seasons it is 21 (x38) or 20 (x14).
  //
  // THE 40 IS NOT A TWO-SET AUCTION, and this check used to say it was. That
  // allowance was written from one observation — 202219, the only auction in
  // the corpus with 40 rows — and it is the defect: 202219 holds its own twenty
  // rows AND 202234's, superimposed, while 202234 holds none. So the check was
  // shaped around the very row it should have caught, and 2022's Onyx
  // reconciliation carried it for three seasons as "the known 202219
  // double-recording problem".
  //
  // NO AUCTION IN THE CORPUS SELLS TWO ONYX SETS. Removing 40 and 42 costs
  // nothing real and the doubled-block case they were meant to describe is now
  // caught precisely, and as an ERROR, by § 5c.
  const onyxByAuction = groupBy(onyx.filter((r) => r.auctionId), (r) => r.auctionId, (r) => r);
  const SET_SIZES = new Set([20, 21]);
  for (const [auctionId, rows] of [...onyxByAuction].sort())
    if (!SET_SIZES.has(rows.length))
      warns.push(`${auctionId}: ${rows.length} Onyx rows — expected 20 or 21 for one set`);

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
