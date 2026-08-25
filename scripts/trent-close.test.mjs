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

// prices.csv only stores a min/max PAIR from season 2024 on. The fifteen
// season-2023 Trent auctions record a single averaged price instead, so the
// replay checks their per-lot output and skips the summary comparison.
const MINMAX_FROM_SEASON = 2024;

const byAuction = new Map();
for (const r of raw) (byAuction.get(r.auctionId) ?? byAuction.set(r.auctionId, []).get(r.auctionId)).push(r);

const pricesByAuction = new Map();
for (const p of prices) (pricesByAuction.get(p.auctionId) ?? pricesByAuction.set(p.auctionId, []).get(p.auctionId)).push(p);

{
  const aborted = [], unitWrong = [], itemWrong = [], summaryWrong = [], seasonWrong = [], countOdd = [];
  let lots = 0, auctions = 0, summarised = 0;

  for (const [auctionId, rows] of [...byAuction].sort()) {
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
    if (Number(season) < MINMAX_FROM_SEASON) continue;
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
  check('every lot name resolves to the Item the sheet recorded', !itemWrong.length, show(itemWrong));
  check('every lot divides down to the per-token price the sheet recorded', !unitWrong.length, show(unitWrong));
  check(`every season-${MINMAX_FROM_SEASON}+ min/max summary is reproduced exactly (${summarised} auctions)`, !summaryWrong.length, show(summaryWrong));
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

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
