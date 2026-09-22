// Tests for apps-script/trentClose.gs — Phase 2 of data-pipeline-plan.md.
//
// The script runs inside Google Apps Script, where nothing can test it. Its
// pure core is therefore written with no SpreadsheetApp dependency so it can be
// loaded here and replayed against real data.
//
// Two kinds of test:
//
//   1. REPLAY. rawPricesData.csv stores `trentName` and `trentPrice` — which
//      ARE Trent's two columns, one row per lot. So every auction the repo
//      holds per-lot data for can be fed back through the parser as if freshly
//      pasted, and the output compared against the shipped CSVs. That is
//      ~18,000 lots across 111 auctions, not a handful of samples.
//
//      110 of those are Trent's. The 111th, 202647, is alesiev's FORUM auction
//      — the first non-Trent auctioneer to supply per-lot data, so its rows
//      landed in rawPricesData too. It is replayed here deliberately: Phase 5
//      will read forum results through this same parser, and 202647 is the only
//      forum sample there is. It is also where every abbreviation and
//      truncation in EXCEPTIONS comes from; none of them is Trent's.
//
//   2. FIXTURES. The replay cannot cover what rawPricesData does not carry:
//      Onyx lots, unsold lots, and Trent's varying header shapes, all of which
//      were filtered out by hand before the paste. Those come from
//      fixtures/trent/, transcribed from real close files.
//
// Run: node scripts/trent-close.test.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const fixtureDir = join(here, '..', 'fixtures', 'trent');

// --- load the Apps Script's pure core ---------------------------------------
// A .gs file is plain JavaScript with no import/export, so it evaluates
// directly. Its module.exports guard hands back the pure functions; everything
// that touches SpreadsheetApp is only ever defined here, never called.
const sandbox = { module: { exports: {} }, console };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'trentClose.gs'), 'utf8'), sandbox);
const T = sandbox.module.exports;

// alesievClose.gs too, and only for one thing: the list of Items it publishes
// to the price spine WITHOUT going through this parser. They share one global
// scope in Apps Script, so loading them together is what the real runtime does,
// and asking the rule table beats hardcoding a name here that would then be
// wrong the day a second aggregate is added. auctionOpen.gs is its dependency.
sandbox.module = { exports: {} };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'auctionOpen.gs'), 'utf8'), sandbox);
sandbox.module = { exports: {} };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'alesievClose.gs'), 'utf8'), sandbox);
const A = sandbox.module.exports;
const SPINE_AGGREGATES = new Set(
  Object.keys(A.ALESIEV_CONTEXT_RULES)
    .map((k) => A.ALESIEV_CONTEXT_RULES[k])
    .filter((r) => r.spine)
    .map((r) => r.item),
);

// --- tiny RFC-4180 CSV parser (mirror of parseCSV) --------------------------
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
const load = (dir, f) => objs(readFileSync(join(dir, f), 'utf8'));
const money = (s) => { const n = parseFloat(String(s ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : null; };

let pass = 0, fail = 0;
const ok = (name) => { console.log(`ok      ${name}`); pass++; };
const bad = (name, detail) => { console.error(`FAIL    ${name}`); if (detail) console.error(detail.split('\n').map((l) => '        ' + l).join('\n')); fail++; };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));

// ===========================================================================
// Unit checks on the rules that are easy to get subtly wrong
// ===========================================================================
console.log('Parsing rules\n');
{
  const cases = [
    ['1,000 GP Gold Bar #1 (4 Tokens)', 4, '1,000 GP Gold Bar'],
    ['1,000 GP Gold Bar x4 #1 (4 Tokens)', 4, '1,000 GP Gold Bar'],
    ['1,000 GP Gold Bar x 4 #8 (4 Tokens)', 4, '1,000 GP Gold Bar'],
    ['3X Treasure Chips x 4 #1 (4 Tokens)', 12, 'Treasure Chips'],
    ['10x Darkwood Planks #10', 10, 'Darkwood Planks'],
    ["Philosopher's Stone (5 tokens)", 5, "Philosopher's Stone"],
    ['Wish Ring', 1, 'Wish Ring'],
  ];
  const wrong = cases.filter(([n, q]) => T.parseQuantity(n).quantity !== q)
    .map(([n, q]) => `${n} -> ${T.parseQuantity(n).quantity}, expected ${q}`);
  check('quantity: the x4 and the (4 Tokens) are one fact, not two', !wrong.length, wrong.join('\n'));

  const stripped = cases.filter(([n, , base]) => T.stripDecorations(n) !== base)
    .map(([n, , base]) => `${n} -> "${T.stripDecorations(n)}", expected "${base}"`);
  check('decorations: the lot number sits before the quantity', !stripped.length, stripped.join('\n'));

  const conflict = T.parseQuantity('1,000 GP Gold Bar x2 #9 (4 Tokens)');
  check('quantity: a contradictory lot size is flagged, never guessed', conflict.conflict === true);

  // $8.25/10 must give 0.83, and $8.29/2 must give 4.15 — both are exact ties
  // that binary division leaves a hair low.
  const ties = [[0.825, 0.83], [4.145, 4.15], [2.175, 2.18], [-0.825, -0.83]];
  const off = ties.filter(([n, want]) => T.roundCents(n) !== want).map(([n, want]) => `${n} -> ${T.roundCents(n)}, expected ${want}`);
  check('rounding: half away from zero, as Sheets does it', !off.length, off.join('\n'));

  const onyx = [
    ['+2 Sacred Sling - 2023 (Onyx)', '+2 Sacred Sling'],
    ['Common/Uncommon/Rare Set - 2023 (Onyx)', 'C/UC/R Set'],
    ['Onyx +2 Branding Mace', '+2 Branding Mace'],
    ['+2 Mug of Battle ONYX', '+2 Mug of Battle'],
    ['+2 Sacred Sling (Onyx)', '+2 Sacred Sling'],
  ];
  const missed = onyx.filter(([n, want]) => {
    const r = T.stripOnyxMarker(n);
    return !r.isOnyx || r.name !== want;
  }).map(([n, want]) => `${n} -> ${JSON.stringify(T.stripOnyxMarker(n))}, expected "${want}"`);
  check('Onyx: every marker shape is stripped, year included', !missed.length, missed.join('\n'));
  check('Onyx: a plain name is not mistaken for one', T.stripOnyxMarker('Wish Ring').isOnyx === false);
}

// ===========================================================================
// Replay every auction the repo holds per-lot data for
// ===========================================================================
console.log('\nReplay against the shipped data\n');
const raw = load(dataDir, 'rawPricesData.csv').filter((r) => r.auctionId);
const prices = load(dataDir, 'prices.csv').filter((r) => r.auctionId);
const tokens = load(dataDir, 'tokenMetadata.csv');

// Every auction with per-lot data is compared on its summary, not just its
// lots. The fifteen season-2023 Trent auctions used to be skipped here — they
// recorded one row per item rather than a min/max pair — until the 2026-09-02
// backfill (PR #169) put them on the same convention as everything after them.
// They are the whole reason the skip existed, so it went with them.

const byAuction = new Map();
for (const r of raw) (byAuction.get(r.auctionId) ?? byAuction.set(r.auctionId, []).get(r.auctionId)).push(r);

const pricesByAuction = new Map();
for (const p of prices) (pricesByAuction.get(p.auctionId) ?? pricesByAuction.set(p.auctionId, []).get(p.auctionId)).push(p);

{
  const aborted = [], unitWrong = [], itemWrong = [], summaryWrong = [], seasonWrong = [], countOdd = [];
  let lots = 0, auctions = 0, summarised = 0, skippedLots = 0;

  for (const [auctionId, allRows] of [...byAuction].sort()) {
    // AN AGGREGATE'S LOTS ARE NOT THIS PARSER'S TO REPRODUCE, and since
    // 2026-09-22 rawPricesData holds some.
    //
    // A sold Random Ultra Rare now reaches the price spine as nine separately
    // priced lots (PR #263), written by `alesievSpineRows` and NOT by
    // processAuction — because `Random Ultra Rare` is an aggregate's name and
    // has no tokenMetadata row in any season, by design. Replaying those rows
    // through the Trent parser asks it to resolve a name it is right to refuse,
    // and it aborted the whole auction: 18 rows took `20271` and `20272` down
    // with them on the publish that first carried them.
    //
    // So the replay's claim narrows to what it was always really asserting —
    // every lot THIS parser produced, it still produces. The excluded Items
    // come from the rule table rather than a literal, and the count is printed
    // below: an exclusion nobody can see is how a narrow rule quietly widens.
    const rows = allRows.filter((r) => !SPINE_AGGREGATES.has(r.Item));
    skippedLots += allRows.length - rows.length;
    if (!rows.length) continue;
    const season = rows[0].auctionSeason;
    // Reconstruct the paste: Trent's two columns, exactly as they arrived.
    const grid = [["Product Name", "Highest Bid"]].concat(rows.map((r) => [r.trentName, r.trentPrice]));
    const plan = T.planImport(grid, season, tokens);
    auctions++;
    lots += rows.length;

    if (plan.aborts.length) { aborted.push(`${auctionId}: ${plan.aborts.join('; ')}`); continue; }
    if (plan.seasons.indexOf(String(season)) === -1) seasonWrong.push(`${auctionId}: inferred ${plan.seasons.join('/')}, is ${season}`);

    // Per-lot: the canonical Item and the per-token price.
    for (let i = 0; i < rows.length; i++) {
      const want = rows[i], got = plan.raw[i];
      if (!got) { itemWrong.push(`${auctionId} row ${i + 2}: no output row`); continue; }
      if (got.Item !== want.Item) itemWrong.push(`${auctionId} "${want.trentName}": resolved to "${got.Item}", recorded as "${want.Item}"`);
      if (Math.abs(got.Price - money(want.Price)) > 0.005) unitWrong.push(`${auctionId} "${want.trentName}": ${got.Price}, recorded ${money(want.Price)}`);
    }

    // Per-item: the min/max summary. Compared as a set of distinct
    // (item, price) pairs, which is the semantics the site and
    // validate-prices.mjs both use — row order inside an auction is not
    // load-bearing, and the site groups on read.
    //
    // Only over items that HAVE lots. An auction can carry a priced item with
    // no Trent lot behind it — 202647's Golden Ticket was recorded
    // off-auction — and no parser can reproduce a row that was never in the
    // file. validate-prices.mjs is what watches that class.
    const withLots = new Set(rows.map((r) => r.Item));
    const recorded = (pricesByAuction.get(auctionId) ?? []).filter((r) => withLots.has(r.Item));
    const key = (r) => `${r.Item}|${money(r.Price).toFixed(2)}`;
    const wantSet = [...new Set(recorded.map(key))].sort();
    const gotSet = [...new Set(plan.prices.map(key))].sort();
    summarised++;
    if (wantSet.length !== gotSet.length || wantSet.some((v, i) => v !== gotSet[i])) {
      const missing = wantSet.filter((v) => !gotSet.includes(v));
      const extra = gotSet.filter((v) => !wantSet.includes(v));
      summaryWrong.push(`${auctionId}: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);
    }

    // Row COUNT is a separate question from row content. The rule is one row
    // for a one-lot item and a pair otherwise, and the sheet follows it in
    // 1,945 of 1,954 cases — the nine that don't are hand-editing noise (a
    // duplicate left in, or a duplicate deleted where both values were equal).
    // They cost nothing on the site, since every statistic groups by item, so
    // they are reported rather than failed.
    for (const item of new Set(recorded.map((r) => r.Item))) {
      const lotCount = rows.filter((r) => r.Item === item).length;
      if (!lotCount) continue;
      const want = lotCount === 1 ? 1 : 2;
      const got = recorded.filter((r) => r.Item === item).length;
      if (got !== want) countOdd.push(`${auctionId} "${item}": ${lotCount} lot(s) but ${got} summary row(s), the rule gives ${want}`);
    }
  }

  const show = (list, n = 6) => list.slice(0, n).join('\n') + (list.length > n ? `\n… and ${list.length - n} more` : '');
  check(`no auction aborts (${auctions} auctions, ${lots} lots — 110 Trent + 1 forum)`, !aborted.length, show(aborted));
  // Reported every run, never silent, for validate-prices § 1's reason: an
  // exclusion that grows without anyone noticing is how a rule stops being the
  // narrow mechanical one it claims to be.
  if (skippedLots) {
    console.log(`        · ${skippedLots} lot(s) skipped as aggregate rows this parser does not write: `
      + `${[...SPINE_AGGREGATES].sort().join(', ')}`);
  }
  check('every lot name resolves to the Item the sheet recorded', !itemWrong.length, show(itemWrong));
  check('every lot divides down to the per-token price the sheet recorded', !unitWrong.length, show(unitWrong));
  check(`every min/max summary is reproduced exactly (${summarised} auctions, every season)`, !summaryWrong.length, show(summaryWrong));
  check('every file identifies its own season from its own token names', !seasonWrong.length, show(seasonWrong));
  console.log(`        · ${countOdd.length} shipped item(s) carry a row count the singleton rule would not produce (sheet noise, harmless):`);
  for (const line of countOdd) console.log('          ' + line);
}

// ===========================================================================
// Fixtures: the shapes the replay cannot reach
// ===========================================================================
console.log('\nFixtures from real close files\n');
{
  const manifest = join(fixtureDir, 'manifest.json');
  if (!existsSync(manifest)) {
    bad('fixtures present', `no ${manifest}`);
  } else {
    for (const f of JSON.parse(readFileSync(manifest, 'utf8'))) {
      const grid = parseCSV(readFileSync(join(fixtureDir, f.file), 'utf8')).filter((r) => r.some((c) => c !== ''));
      const plan = T.planImport(grid, f.season, tokens);
      const problems = [];
      if (plan.aborts.length) problems.push('aborts: ' + plan.aborts.join('; '));
      if (plan.raw.length !== f.expect.priced) problems.push(`priced ${plan.raw.length}, expected ${f.expect.priced}`);
      if (plan.onyx.length !== f.expect.onyx) problems.push(`onyx ${plan.onyx.length}, expected ${f.expect.onyx}`);
      if (plan.unsold.length !== f.expect.unsold) problems.push(`unsold ${plan.unsold.length}, expected ${f.expect.unsold}`);
      if (plan.seasons.indexOf(String(f.season)) === -1) problems.push(`inferred season ${plan.seasons.join('/')}, expected ${f.season}`);
      check(`${f.file} — ${f.note}`, !problems.length, problems.join('\n'));

      // Where the auction is already in the repo, the fixture must reproduce it.
      if (f.reconciles) {
        const recorded = (load(dataDir, 'onyx.csv')).filter((r) => r.auctionId === f.reconciles);
        const key = (r) => `${r.Item}|${money(r.Price).toFixed(2)}`;
        const want = recorded.map(key).sort(), got = plan.onyx.map(key).sort();
        check(`${f.file} — its Onyx rows match auction ${f.reconciles} to the cent`,
          want.length === got.length && want.every((v, i) => v === got[i]),
          `missing [${want.filter((v) => !got.includes(v)).join(', ')}]\nextra [${got.filter((v) => !want.includes(v)).join(', ')}]`);
      }
    }
  }

  // Header handling, which varies file to file.
  const aliasGrid = [['Token', 'Price'], ['Wish Ring', '195']];
  check('headers: the "Token | Price" spelling is understood', !T.readStaging(aliasGrid).error);
  const offsetGrid = [['Auction Start Date', 'Auction End Date', 'Product Name', 'Highest Bid'], ['44904', '44916', 'Wish Ring', '195']];
  const offset = T.readStaging(offsetGrid);
  check('headers: name and price are found in columns C and D', !offset.error && offset.lots[0].name === 'Wish Ring' && offset.lots[0].bid === 195);
  const unknown = T.readStaging([['Thing', 'Amount'], ['Wish Ring', '195']]);
  check('headers: an unrecognised header row aborts rather than guessing', !!unknown.error);
  check('float noise is quantised on read', T.readStaging([['Token', 'Price'], ['Wish Ring', '70.099999999999994']]).lots[0].bid === 70.1);
}

// ===========================================================================
// Abort conditions — the three that earn the unattended write
// ===========================================================================
console.log('\nAbort conditions\n');
{
  const base = [['Product Name', 'Highest Bid'], ['Path to Enlightenment (Fragment 4)', '402'], ['Wish Ring', '135']];

  const good = T.planImport(base, '2026', tokens);
  check('a clean file plans a write', good.ok, good.aborts.join('\n'));

  const unresolved = T.planImport(base.concat([['Grunnel Scroll', '25']]), '2026', tokens);
  check('an unresolved lot name aborts the whole run', !unresolved.ok &&
    unresolved.aborts.some((a) => /Grunnel Scroll/.test(a)), unresolved.aborts.join('\n'));

  const wrongSeason = T.planImport(base, '2025', tokens);
  check('a season mismatch aborts — this is "pasted into the wrong auction"', !wrongSeason.ok &&
    wrongSeason.aborts.some((a) => /looks like season/.test(a)), wrongSeason.aborts.join('\n'));

  const contradiction = T.planImport(base.concat([['1,000 GP Gold Bar x2 #9 (4 Tokens)', '33.30']]), '2026', tokens);
  check('a contradictory quantity aborts', !contradiction.ok &&
    contradiction.aborts.some((a) => /disagree/.test(a)), contradiction.aborts.join('\n'));

  // "Wish Ring" is named the same in every season, so nothing in this file
  // picks one out. That is not evidence of a mismatch, so it cautions rather
  // than aborting — blocking a clean import because the file happened to carry
  // no season-specific token would be the wrong trade.
  const noSignal = T.planImport([['Product Name', 'Highest Bid'], ['Wish Ring', '135']], '2026', tokens);
  check('a file with nothing season-specific cautions, but does not abort', noSignal.ok &&
    noSignal.cautions.some((c) => /could not be checked/.test(c)),
    'aborts: ' + noSignal.aborts.join('; ') + '\ncautions: ' + noSignal.cautions.join('; '));
  check('the caution reaches the confirmation dialog', /CAUTION/.test(T.describePlan(noSignal, '202643')));

  check('an aborted plan writes nothing', !unresolved.ok && /NOTHING WILL BE WRITTEN/.test(T.describePlan(unresolved, '202643')));
}

// ===========================================================================
// Context items riding along in Trent's file
// ===========================================================================
// Trent's close file carries grunnel and other context lots inline. They are
// not tokens, so they abort — which is right, because category, quantity and
// withheld pricing are all judgement calls. What the script owes the operator
// is a report that says WHICH problem this is and hands over a worksheet.
//
// The names below are the real contextItems rows recorded against Trent
// auctions 202348 and 202647.
console.log('\nContext items\n');
{
  const contextNames = [
    ['2023', 'Small Favor Scroll'],
    ['2026', 'GenCon 2026 Tornado Bucket'],
    ['2026', 'Green Key'],
    ['2026', "Acorn from Felurian's Feast"],
    ['2026', 'Tomb of Terror Redux Banner'],
    ['2026', 'Borrowed Ring #4 St Lorca'],
    ['2026', 'Censer and 2 of each incense'],
    ['2026', '4x Baby Potatoes'],
    ['2026', 'Random UR'],
  ];
  const index = T.buildTokenIndex(tokens);
  const anywhere = contextNames.filter(([, n]) => T.seasonsResolving(T.stripDecorations(n), index, null).length)
    .map(([, n]) => n);
  check('a real context item resolves to a token in no season at all', !anywhere.length,
    `these did resolve somewhere: ${anywhere.join(', ')}`);

  // A CURLY apostrophe must resolve exactly like a straight one. Forum posts
  // arrive full of them — 43 of the 94 fetched 2022 thread pages carry at least
  // one — and the failure is invisible: the name looks right in every dialog,
  // resolves to nothing, and is then proposed as an AUGMENT. Twenty-five
  // tokenMetadata names contain an apostrophe, so twenty-five real tokens were
  // one paste away from being filed as somebody's personal item.
  const curlyBroken = [];
  for (const row of tokens) {
    for (const name of [row['Display Name'], row.Item]) {
      if (!name || !/'/.test(name)) continue;
      const straight = T.resolveToken(name, String(row.auctionSeason), index);
      const curly = T.resolveToken(name.replace(/'/g, '’'), String(row.auctionSeason), index);
      if (!straight || !curly || straight.Item !== curly.Item) curlyBroken.push(name);
    }
  }
  check('a curly apostrophe resolves the same as a straight one', !curlyBroken.length,
    `these differ: ${[...new Set(curlyBroken)].join(', ')}`);
  check('the fold is not vacuous — there are apostrophe names to protect',
    tokens.filter((r) => /'/.test(r.Item || '')).length >= 10);

  const bonus = ['Path to Enlightenment (Fragment 4)', '402'];
  const grid = [['Product Name', 'Highest Bid'], bonus,
    ['Green Key', '455'], ['4x Baby Potatoes', '51'], ['Random UR', '495']];
  const plan = T.planImport(grid, '2026', tokens);

  check('context lots abort the import', !plan.ok);
  check('the abort names the likely cause instead of just "no match"',
    plan.aborts.filter((a) => /most likely a context item/.test(a)).length === 3,
    plan.aborts.join('\n'));

  // A token that exists in another season is the OTHER failure, and the
  // operator's next move is completely different — so it must not be swept
  // into the context worksheet.
  const wrongSeason = T.planImport([['Product Name', 'Highest Bid'], bonus,
    ['Ring of the 5th Circle', '100']], '2026', tokens);
  check('a token from another season is diagnosed as a token problem, not a context item',
    wrongSeason.aborts.some((a) => /but it is in 2022/.test(a)),
    wrongSeason.aborts.join('\n'));

  // THE PATRON LOT, whose spelling changes almost every season — see
  // PATRON_PIN_RE. Trent has written it five ways across fifteen seasons and
  // dropped the pin entirely for 2027 (`2027 Patron Code`), which aborted the
  // whole import of that season's eighth auction: one unresolved name stops the
  // file, so 166 good lots went nowhere.
  //
  // Pinned to STRUCTURE, not to the spellings the corpus happens to hold. Each
  // of these is checked in three seasons deliberately, including seasons whose
  // own metadata cannot help — `Patron Code` resolves in 2027 with no rule at
  // all, because that season's `Display Name` IS `Patron Code`, and a test
  // that only ever asked 2027 would pass with the rule deleted.
  const patronSeasons = ['2027', '2026', '2021'];
  const foldsToPin = [
    '2027 Patron Code',                      // 2027: the pin is gone
    'Patron Code',                           // the same, with no year on it
    '2028 Patron Code',                      // a season with no metadata at all
    '2026 Patron Pin and Code',
    '2023 Patron Lapel Pin and Patron Code',
    '2022 Patron Lapel Code',
    'Patron Pin',
  ];
  for (const name of foldsToPin) {
    const got = patronSeasons.map((s) => T.resolveToken(T.stripDecorations(name), s, index)?.Item ?? 'UNRESOLVED');
    check(`"${name}" folds onto the canonical Patron Pin in every season`,
      got.every((x) => x === 'Patron Pin'), patronSeasons.map((s, i) => `${s}: ${got[i]}`).join('\n'));
  }

  // ...and what the rule REFUSES is the half that matters. `Patron Token 1` is
  // a different item with its own rows in every season since 2021. An
  // unresolved name aborts the import and the operator fixes it; a name folded
  // onto the wrong series is recorded, published, and caught by nothing.
  const neverPin = [
    'Patron Token 1',
    '2025 Patron Token 1',
    'Patron Token 1 and Code',
    '2021 Patron Token 1 and Patron Code',
  ];
  for (const name of neverPin) {
    const got = patronSeasons.map((s) => T.resolveToken(T.stripDecorations(name), s, index)?.Item ?? 'UNRESOLVED');
    check(`"${name}" is never folded onto Patron Pin`,
      got.every((x) => x !== 'Patron Pin'), patronSeasons.map((s, i) => `${s}: ${got[i]}`).join('\n'));
  }

  // The whole point, end to end: the lot imports rather than aborting, and it
  // lands on the canonical Item while keeping the season's own Display Name.
  const patronPlan = T.planImport([['Product Name', 'Highest Bid'],
    ['2027 Patron Code', '425']], '2027', tokens);
  const patronRow = patronPlan.prices.find((r) => r.Item === 'Patron Pin');
  check('a 2027 Patron Code lot imports and prices as Patron Pin',
    patronPlan.ok && patronRow && patronRow.Price === 425 && patronRow['Display Name'] === 'Patron Code',
    `${patronPlan.aborts.join('\n')}\n${JSON.stringify(patronPlan.prices)}`);

  const target = { auctionId: '202647', auctionSeason: '2026', auctionNumber: '47' };
  const rows = T.contextRows(plan, target);
  check('the worksheet carries one row per context lot', rows.length === 3, JSON.stringify(rows));
  check('the worksheet does not include the other-season token',
    !T.contextRows(wrongSeason, target).length, JSON.stringify(T.contextRows(wrongSeason, target)));

  const green = rows.find((r) => r[4] === 'Green Key');
  check('a worksheet row is keyed to the chosen auction and carries the lot price',
    green && green[0] === '202647' && green[1] === '2026' && green[2] === '47' && green[6] === 455,
    JSON.stringify(green));
  check('category is left blank — it is a judgement, not a lookup', rows.every((r) => r[3] === ''));
  check('a leading multiplier becomes the quantity',
    rows.find((r) => r[4] === 'Baby Potatoes')?.[5] === 4, JSON.stringify(rows));

  const text = T.contextWorksheetText(plan, target);
  check('the worksheet is tab-separated so it pastes across columns',
    text.split('\n')[0] === T.CONTEXT_COLUMNS.join('\t'), JSON.stringify(text.split('\n')[0]));
  check('the worksheet header matches contextItems.csv column for column',
    T.CONTEXT_COLUMNS.join(',') === Object.keys(load(dataDir, 'contextItems.csv')[0]).join(','),
    `script: ${T.CONTEXT_COLUMNS.join(',')}\ncsv:    ${Object.keys(load(dataDir, 'contextItems.csv')[0]).join(',')}`);


  // The worksheet is tab-separated, so a tab inside a value would shift every
  // later column of that row one place right — silently, with nothing on screen
  // to show it happened. Not hypothetical: contextItems.csv already carries
  // "HAMSTER with his own pet\t", a real Item name ending in a tab.
  check('a tab in a value cannot shift the pasted columns',
    T.tsvCell('HAMSTER with his own pet\t') === 'HAMSTER with his own pet ');
  check('a newline cannot split one row into two', T.tsvCell('a\nb') === 'a b');
  check('an ordinary value is left alone', T.tsvCell('Green Key') === 'Green Key');
  {
    const tabbed = T.planImport([['Product Name', 'Highest Bid'], bonus, ['Green\tKey', '455']], '2026', tokens);
    const line = T.contextWorksheetText(tabbed, target).split('\n')[1];
    const cols = line.split('\t').length;
    check('every worksheet row has exactly one cell per column',
      cols === T.CONTEXT_COLUMNS.length, `got ${cols} cells: ${JSON.stringify(line)}`);
  }

  const clean = T.planImport([['Product Name', 'Highest Bid'], bonus, ['Wish Ring', '135']], '2026', tokens);
  check('a clean file produces no worksheet', T.contextWorksheetText(clean, target) === '');
}

// ===========================================================================
// `outcome` — shared by all three close paths (backlog PIPE-9)
// ===========================================================================
// `Status` is `IF(outcome<>"", outcome, IF(closeDate="", "Open", "Closed"))`,
// so a non-blank `outcome` OUTRANKS `closeDate`. Importing a close and filling
// the date in does not make an auction Closed while a stale cell sits beside
// it — and a `Pending` row carrying a closeDate is a hard ERROR at the PR gate,
// which is where the first 2027 close found out.
console.log('\nThe outcome cell (PIPE-9)\n');
{
  // A Failed auction sold nothing, so a close cannot belong to it. This is the
  // one value that refuses, and it refuses at the auction PICKER — by the write
  // the operator has already approved a plan that was never going to be right.
  check('a Failed auction refuses a close import',
    /did not fund/.test(T.closeOutcomeProblem('Failed')), T.closeOutcomeProblem('Failed'));
  check('  ... and says both ways it can be wrong',
    /wrong auction/.test(T.closeOutcomeProblem('Failed')) && /Failed mark is wrong/.test(T.closeOutcomeProblem('Failed')),
    T.closeOutcomeProblem('Failed'));

  // The states an auction is actually IN when its close arrives. Refusing
  // these would refuse the normal case: every auction auctionOpen.gs promotes
  // ahead of its opening day carries `Pending`.
  for (const v of ['Pending', 'Ended', '', undefined]) {
    check(`${JSON.stringify(v)} does not block a close`, T.closeOutcomeProblem(v) === '', T.closeOutcomeProblem(v));
  }

  // What gets cleared. Both are TEMPORARY by design, and a close arriving is
  // the moment each stops being true.
  check('Pending is cleared', T.closeOutcomeClears('Pending'));
  check('Ended is cleared', T.closeOutcomeClears('Ended'));
  check('Failed is never cleared', !T.closeOutcomeClears('Failed'));
  // § 7 fences that column, so a value this does not know is one somebody
  // added deliberately. Deleting it would be the script overruling them.
  check('an unrecognised value is left alone', !T.closeOutcomeClears('Cancelled'));
  check('blank has nothing to clear', !T.closeOutcomeClears(''));

  // The reminder, for the two importers that do NOT write closeDate — this one
  // and forumClose.gs, where the operator types the date afterwards and
  // nothing is watching.
  check('nothing to say about a blank outcome', T.closeOutcomeReminder('20273', '') === '');
  check('nor about one that will not be cleared anyway', T.closeOutcomeReminder('20273', 'Cancelled') === '');
  const pending = T.closeOutcomeReminder('20273', 'Pending');
  check('a Pending target is named with its auction', /20273/.test(pending) && /Pending/.test(pending), pending);
  check('  ... and says WHY, not just what', /computes from outcome BEFORE closeDate/.test(pending), pending);
  check('  ... and that Pending in particular is a hard error', /hard ERROR/.test(pending), pending);
  const ended = T.closeOutcomeReminder('20273', 'Ended');
  check('an Ended target is named too', /REMEMBER/.test(ended) && /Ended/.test(ended), ended);
  // Ended + closeDate is legitimate — that is the whole point of the state —
  // so the reminder must not claim it is an error the way Pending's is.
  check('  ... without claiming Ended + closeDate is an error', !/hard ERROR/.test(ended), ended);
}

// ===========================================================================
// The shared close-path picker
//
// Three importers ask the same question first — which auction is this file
// for? — so the shortlist lives here and each path supplies only a predicate
// saying whether a row came from its source. It is shared because the two
// things that make it right are both easy to get wrong, and were: the alesiev
// picker sorted on `Number(auctionId)` and buried the current season, and
// filtered on `auctioneer` when the site hosts other people's auctions.
//
// Constructed rows, not the shipped CSV. auctionMetadata.csv is republished
// from the workbook constantly, and a suite pinning a count or a top row out
// of it is a publish blocked the next time an auction opens.
// ===========================================================================
console.log('\nThe shared close-path picker\n');
{
  // This suite reports with `check` alone; the picker cases read better as
  // comparisons, so the failure detail shows both sides.
  const eq = (name, got, want) => check(name, got === want, `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);
  const row = (o) => ({
    auctionId: '', auctionSeason: '', auctionNumber: '', auctionName: '',
    auctioneer: '', Link: '', closeDate: '', Status: '', ...o,
  });
  const any = () => true;
  const at = (season, number, o = {}) => row({
    auctionId: `${season}${number}`, auctionSeason: String(season),
    auctionNumber: String(number), auctionName: `Auction ${number}`, ...o,
  });

  // Ordering. The ids are season-prefixed, so reading one as a number ranks
  // 202647 above 20271 — six digits beating five — and puts the season that
  // just finished on top of the one being auctioned.
  eq('a five-digit 2027 id outranks a six-digit 2026 one',
    T.closeAuctionsFrom([at(2026, 47), at(2027, 1)], any)[0].auctionId, '20271');
  eq('within a season the highest number is first',
    T.closeAuctionsFrom([at(2027, 1), at(2027, 11), at(2027, 2)], any)
      .map((m) => m.auctionNumber).join(','), '11,2,1');
  eq('a row with no auctionId is not offered at all',
    T.closeAuctionsFrom([at(2027, 1), row({ auctionSeason: '2027' })], any).length, 1);
  // Blank numbers tie to NaN and must not throw the order away.
  eq('a blank auctionNumber falls back to the id',
    T.closeAuctionsFrom([at(2027, 1, { auctionNumber: '' }), at(2027, 2, { auctionNumber: '' })], any)
      .map((m) => m.auctionId).join(','), '20272,20271');

  // Scope. Newest season present, never a calendar year: a 2027 auction opens
  // in calendar 2026, so getFullYear() names the season being escaped.
  const scoped = T.closePickerList([at(2026, 47), at(2027, 1), at(2026, 12), at(2027, 2)], any);
  eq('the list is scoped to the newest season present', scoped.season, '2027');
  check('  ... so a finished season is not in it',
    scoped.rows.every((m) => m.auctionSeason === '2027'), JSON.stringify(scoped.rows.map((m) => m.auctionId)));
  eq('  ... and the rest are counted, not silently dropped', scoped.hidden, 2);
  const capped = T.closePickerList(Array.from({ length: 14 }, (_, i) => at(2027, i + 1)), any);
  eq('the list is capped', capped.rows.length, T.CLOSE_PICKER_LIMIT);
  eq('  ... with the remainder counted', capped.hidden, 14 - T.CLOSE_PICKER_LIMIT);
  const empty = T.closePickerList([], any);
  check('nothing to offer is an empty list, not a crash', !empty.rows.length && empty.season === '');

  // The line, and the prompt built from it.
  const line = T.closePickerLine(at(2027, 5, { auctioneer: 'Kusig', closeDate: '2026-09-19', Status: 'Closed' }));
  check('a line carries the id, the auctioneer and the close date',
    /20275/.test(line) && /Kusig/.test(line) && /closed 2026-09-19/.test(line), line);
  check('an unclosed row reports its own Status rather than a flat "open"',
    /\(pending\)/.test(T.closePickerLine(at(2027, 9, { Status: 'Pending' }))));
  check('  ... and falls back to "open" when Status is blank',
    /\(open\)/.test(T.closePickerLine(at(2027, 9))));
  const prompt = T.closePickerPrompt(scoped, 'a source', 'auctionMetadata');
  check('the prompt names the source and the season', /a source, season 2027/.test(prompt), prompt);
  check('  ... and says the older ones can still be typed',
    /2 older auction\(s\)/.test(prompt) && /can be typed/.test(prompt), prompt);
  eq('an empty list contributes no prompt at all', T.closePickerPrompt(empty, 'a source', 'auctionMetadata'), '');

  // Trent's membership test. By Link like the others, though for this source
  // the two agree exactly: all 119 shop rows say Trent and all 119 Trent rows
  // carry the shop URL.
  eq('the shop URL is a Trent row',
    T.trentIsShopRow(row({ Link: 'https://www.trenttokens.com/collections/current-auction' })), true);
  eq('a forum topic is not',
    T.trentIsShopRow(row({ Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=255533' })), false);
  eq('the auction site is not',
    T.trentIsShopRow(row({ Link: 'https://alesievauctions.com/auctions/29' })), false);
  eq('a blank Link is not', T.trentIsShopRow(row({ Link: '' })), false);

  const META = load(dataDir, 'auctionMetadata.csv');
  const trentRows = T.closeAuctionsFrom(META, T.trentIsShopRow);
  const real = T.closePickerList(META, T.trentIsShopRow);
  check('the shipped auctionMetadata has Trent auctions to offer', real.rows.length > 0);
  check('every auction offered is one of his',
    real.rows.every((m) => /trenttokens\.com/i.test(m.Link)),
    real.rows.map((m) => `${m.auctionId} ${m.Link}`).join('\n'));
  // The two tests agree on this source today. If they ever stop, the Link is
  // the one that decides — but it is worth knowing, so it is measured.
  const byName = META.filter((m) => (m.auctioneer || '').toLowerCase() === 'trent').length;
  console.log(`\nnote: ${trentRows.length} row(s) carry the shop URL, ${byName} say auctioneer Trent` +
    `; ${real.rows.length} listed for season ${real.season}, ${real.hidden} older not listed`);
}

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
