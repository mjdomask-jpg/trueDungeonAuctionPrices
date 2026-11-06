// Tests for apps-script/utakuClose.gs — the auction.utakustradecaravan.com
// close (Phase 5, part four).
//
// Auction #1 (= 202722) is REAL data from both of the site's sources: the
// export the maintainer downloaded and the site's public /api/state. It has no
// recorded rows to replay against yet, so the numbers pinned below were worked
// out by hand from the export, not read back from the code — and the two
// sources are asserted to produce the SAME plan, which is the reconciliation
// this venue offers.
//
// Auctions #2 (= 202724, Onyx) and #3 (= 202728) are the maintainer's exports
// from 2026-11-06, with no API fixture: the API had moved on by then. Their
// pinned numbers were worked out by hand from the export too. Each fixture is
// a FILE, so pinning its own counts is safe; the shipped CSVs are only ever
// used relationally — membership, and "with the other one recorded".
//
// Run: node scripts/utaku-close.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const fixtureDir = join(here, '..', 'fixtures', 'utaku');

// One sandbox, as in Apps Script: the parser, the Eastern-time and cell
// helpers, and alesievClose.gs's fingerprint and style regex are all shared.
const sandbox = { module: { exports: {} }, console };
for (const f of ['trentClose.gs', 'auctionOpen.gs', 'alesievClose.gs', 'utakuClose.gs']) {
  sandbox.module = { exports: {} };
  runInNewContext(readFileSync(join(here, '..', 'apps-script', f), 'utf8'), sandbox);
}
const U = sandbox.module.exports;

function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const objs = (t) => { const r = parseCSV(t); const h = r[0].map((x) => x.trim()); return r.slice(1).map((c) => Object.fromEntries(h.map((k, i) => [k, (c[i] ?? '').trim()]))); };
const load = (f) => objs(readFileSync(join(dataDir, f), 'utf8'));

const TOKENS = load('tokenMetadata.csv');
const PRICES = load('prices.csv');
const ONYX = load('onyx.csv');
const META = load('auctionMetadata.csv');
const EXPORT = parseCSV(readFileSync(join(fixtureDir, 'utaku-auction-1-export.csv'), 'utf8'));
const EXPORT_2 = parseCSV(readFileSync(join(fixtureDir, 'utaku-auction-2-export.csv'), 'utf8'));
const EXPORT_3 = parseCSV(readFileSync(join(fixtureDir, 'utaku-auction-3-export.csv'), 'utf8'));
const STATE_TEXT = readFileSync(join(fixtureDir, 'api-state-auction-1.json'), 'utf8');
const STATE = JSON.parse(STATE_TEXT);
const TARGET = META.find((m) => m.auctionId === '202722');

let pass = 0, fail = 0;
const ok = (name) => { console.log(`ok      ${name}`); pass++; };
const bad = (name, detail) => { console.error(`FAIL    ${name}`); if (detail) console.error(String(detail).split('\n').map((l) => '        ' + l).join('\n')); fail++; };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);
const plain = (x) => JSON.parse(JSON.stringify(x)); // out of the vm realm

const HEADER = ['Item', 'Quantity', 'Price/unit', 'Line total'];
const grid = (rows) => [HEADER, ...rows.map(([n, q, u, t]) => [n, String(q), String(u), t === undefined ? String(Math.round(q * u * 100) / 100) : String(t)])];
const plan = (values, extra = {}) => U.utakuPlanImport(values, '2027', TOKENS, extra.priced ?? false,
  extra.style ?? 'Onyx Trade 2 Ultra Condensed', extra.prices ?? PRICES, '202722', extra.stickers ?? null);

// ===========================================================================
console.log('Names\n');
// ===========================================================================
{
  eq('a curly apostrophe is written straight', plain(U.utakuCleanName('Drake’s Elixir', '2027')), { name: "Drake's Elixir" });
  eq('Excel mojibake of the same name is repaired', plain(U.utakuCleanName('Drakeâ€™s Elixir', '2027')), { name: "Drake's Elixir" });
  check('any OTHER mojibake refuses rather than guessing', !!U.utakuCleanName('CafÃ© Token', '2027').problem);
  eq("the auction's own season comes off the front", U.utakuCleanName('2027 Treasure Chips', '2027').name, 'Treasure Chips');
  eq('a DIFFERENT season stays on, so it fails to resolve', U.utakuCleanName('2026 Treasure Chips', '2027').name, '2026 Treasure Chips');

  eq('a trailing (Onyx) is an Onyx lot', U.utakuOnyxItem('+1 Voidbane Cannon (Onyx)'), '+1 Voidbane Cannon');
  eq("the site's set name folds onto C/UC/R Set", U.utakuOnyxItem('Full Onyx C/U/R Set'), 'C/UC/R Set');
  eq('anchored: Non-Onyx is not Onyx', U.utakuOnyxItem('Non-Onyx Bundle'), null);
  eq('anchored: Onyx mid-name is not Onyx', U.utakuOnyxItem('Onyx Ring of Things'), null);
  eq('an ordinary name is not Onyx', U.utakuOnyxItem('Wish Ring'), null);
}

// ===========================================================================
console.log('\nVirtual lots\n');
// ===========================================================================
{
  const lots = (name, q, u, size) => plain(U.utakuVirtualLots({ name, quantity: q, unit: u, row: 2 }, size)).map((l) => `${l.name} @ ${l.bid}`);
  eq('12 Parchment is a 10x lot and a 2x lot', lots("Alchemist's Parchment", 12, 1.6, 10),
    ["10x Alchemist's Parchment @ 16", "2x Alchemist's Parchment @ 3.2"]);
  eq('a remainder of one keeps its 1x, as the corpus spells it', lots("Alchemist's Ink", 1, 2.25, 10), ["1x Alchemist's Ink @ 2.25"]);
  eq('26 gold bars are five 5x lots and a 1x', lots('1K Gold Bar', 26, 7, 5),
    ['5x 1K Gold Bar @ 35', '5x 1K Gold Bar @ 35', '5x 1K Gold Bar @ 35', '5x 1K Gold Bar @ 35', '5x 1K Gold Bar @ 35', '1x 1K Gold Bar @ 7']);
  eq('a single-token item is one bare row per token', lots('Shirt of Cat\'s Gift', 3, 66, 1),
    ["Shirt of Cat's Gift @ 66", "Shirt of Cat's Gift @ 66", "Shirt of Cat's Gift @ 66"]);

  const token = (item, cat) => ({ Item: item, Category: cat });
  eq('Trade 1 sells in tens', U.utakuLotSize(token('Darkwood Plank', 'Trade 1')), 10);
  eq('Treasure Chips in tens', U.utakuLotSize(token('Treasure Chip', 'Preorder')), 10);
  eq("gold bars in fives (alesievauctions.com's size, chosen 2026-09-29)", U.utakuLotSize(token('1,000 GP Gold Bar', 'Trade 2')), 5);
  eq("the Preorder Bonus slot in fours, whatever the season calls it", U.utakuLotSize(token('Preorder Bonus', 'Preorder')), 4);
  eq('a Trade 2 single is one', U.utakuLotSize(token('Aragonite', 'Trade 2')), 1);
  eq('a premium slot is one', U.utakuLotSize(token('1k Bonus', 'Premium')), 1);
}

// ===========================================================================
console.log('\nReading the grid\n');
// ===========================================================================
{
  const r = plain(U.utakuReadGrid(EXPORT, '2027'));
  eq('the real export: 73 bids, no problems', [r.bids.length, r.problems.length, r.cautions.length], [73, 0, 0]);

  const broken = plain(U.utakuReadGrid(grid([['Aragonite', 5, 7.25, 36.2]]), '2027'));
  check('a Line total that does not add up is a problem', broken.problems.length === 1 && /36\.25/.test(broken.problems[0]), broken.problems);
  const noTotal = plain(U.utakuReadGrid([['Item', 'Quantity', 'Price/unit'], ['Aragonite', '5', '7.25']], '2027'));
  check('no Line total column is a caution, not a refusal', noTotal.bids.length === 1 && noTotal.cautions.length === 1);
  const frac = plain(U.utakuReadGrid(grid([['Aragonite', 2.5, 7.25]]), '2027'));
  check('a fractional quantity is a problem', frac.problems.length === 1);
  const doubled = plain(U.utakuReadGrid(grid([['10x Darkwood Plank', 2, 5]]), '2027'));
  check('a name with its own quantity is a problem, not multiplied twice', doubled.problems.length === 1 && !doubled.bids.length);
  const money = plain(U.utakuReadGrid([HEADER, ['Aragonite', '5', '$7.25', '$36.25']], '2027'));
  check('currency-formatted cells read', money.bids.length === 1 && money.bids[0].unit === 7.25);
  check('a missing column is an error naming the header it saw', /Row 1 reads/.test(U.utakuReadGrid([['Name', 'Qty']], '2027').error));
}

// ===========================================================================
console.log('\nStickers\n');
// ===========================================================================
{
  const style = (o, c, t) => U.utakuStyleFromStickers({ onyx: o, condense: c, tradeGoods: t, augment: 'non_augmented' }).style;
  eq('#1: Onyx, Option B, Super Condensed', style('onyx', 'super_condensed', 'option_b'), 'Onyx Trade 2 Ultra Condensed');
  eq('non-Onyx Option B', style('non_onyx', 'super_condensed', 'option_b'), 'Trade 2 Ultra Condensed');
  eq('Onyx Option A', style('onyx', 'super_condensed', 'option_a'), 'Onyx Ultra Condensed');
  eq('the plain order', style('non_onyx', 'super_condensed', 'option_a'), 'Ultra Condensed');
  eq('plain "condensed" is NOT translated', style('onyx', 'condensed', 'option_b'), '');
  eq('a blank sticker blanks the whole style', style('', 'super_condensed', 'option_b'), '');
  eq('an unknown value blanks it too', style('onyx', 'hyper_condensed', 'option_b'), '');
  check('and says why', U.utakuStyleFromStickers({ onyx: 'onyx', condense: 'hyper_condensed', tradeGoods: 'option_b' }).notes.some((n) => /hyper_condensed/.test(n)));
  // Every value the page defines, and nothing else — pinned so a new one is a
  // decision rather than a silent blank.
  eq('the vocabulary is the page\'s', plain(sandbox.OPEN_UTAKU_STICKERS), {
    onyx: ['onyx', 'non_onyx'], condense: ['condensed', 'super_condensed'],
    augment: ['augmented', 'non_augmented'], tradeGoods: ['option_a', 'option_b'],
  });
}

// ===========================================================================
console.log('\nThe API\n');
// ===========================================================================
{
  // Nothing about a bidder, and not the seller's payment handles.
  for (const key of ['moniker', 'maxPrice', 'leaders', 'bidderCount', 'paymentNotes', '"qty"']) {
    check(`the fixture carries no ${key}`, !STATE_TEXT.includes(key));
  }
  check('202722 is in auctionMetadata', !!TARGET);

  const read = plain(U.utakuApiRead(STATE, [], TARGET));
  check('it reads', !read.error, read.error);
  eq('its grid is the export\'s four columns', read.grid[0], HEADER);
  check('and every row is four cells — nothing else rode along', read.grid.every((r) => r.length === 4));
  const key = (r) => `${r[0]}|${Number(r[1])}|${Number(r[2])}|${Number(r[3])}`;
  const tally = (rows) => rows.reduce((m, r) => (m[key(r)] = (m[key(r)] || 0) + 1, m), {});
  eq('the API\'s winners ARE the export, row for row', tally(read.grid.slice(1)), tally(EXPORT.slice(1)));
  eq('they sum to the site\'s raised', [read.lotSum, read.raised], [7007.45, 7007.45]);
  eq('the close is the site\'s, in Eastern', [read.closeDate, read.closeTime], ['2026-09-29', '19:10']);
  eq('site auction #1', read.siteNumber, '1');
  eq('no cautions on a clean close', read.cautions, []);

  const elsewhere = plain(U.utakuApiRead(STATE, [], { ...TARGET, openDate: '2026-09-20' }));
  check('a row that opened on another day is refused — the API holds a different auction', elsewhere.notCurrent && /pasted-export/.test(elsewhere.error));
  const archived = plain(U.utakuApiRead(STATE, [{ auctionNumber: 0, startedAt: '2026-09-20T15:00:00.000Z' }], { ...TARGET, openDate: '2026-09-20' }));
  check('and names the archived auction when history has it', /archived it as auction #0/.test(archived.error), archived.error);
  const displayed = plain(U.utakuApiRead(STATE, [], { ...TARGET, openDate: '9/24/2026' }));
  check('an openDate DISPLAYED as M/D/YYYY still matches', !displayed.error, displayed.error);

  const open = JSON.parse(STATE_TEXT); open.items[3].status = 'live';
  check('an auction with a live item is refused', /still OPEN/.test(U.utakuApiRead(open, [], TARGET).error));
  const short = JSON.parse(STATE_TEXT); short.settings.raised = 7000;
  check('winners that do not sum to raised are a caution', plain(U.utakuApiRead(short, [], TARGET)).cautions.some((c) => /7007\.45/.test(c)));
  const unsold = JSON.parse(STATE_TEXT); unsold.items[0].quantity = 60;
  check('an item that did not sell out is named', plain(U.utakuApiRead(unsold, [], TARGET)).cautions.some((c) => /Treasure Chips ×10/.test(c)));
  const moved = JSON.parse(STATE_TEXT); moved.lastClosed.current = false;
  const noClose = plain(U.utakuApiRead(moved, [], TARGET));
  check('a lastClosed that is not this auction gives no close date', noClose.closeDate === null && noClose.cautions.some((c) => /will be asked for/.test(c)));
}

// ===========================================================================
console.log('\nAuction #1, planned\n');
// ===========================================================================
{
  const p = plain(plan(EXPORT));
  check('it plans cleanly', p.ok && p.rowsComplete, p.aborts);
  eq('73 bids worth $7,007.45', [p.lots, p.exportTotal], [73, 7007.45]);
  eq('season 2027 and nothing else', p.seasons, ['2027']);

  // Worked out by hand from the export, lot by lot:
  //   chips 40+10 -> 4+1   Drake's 32 -> 8   Codex 1   Warden 8   Shirt 4
  //   Wish Ring 1   PYP 16   Ink 24/10/5/1 -> 3+1+1+1   Parchment 12/10/18 -> 2+1+2
  //   Aragonite 15   Darkwood 20/30 -> 2+3   Steel 10/30 -> 1+3   Bismuth 20
  //   Munition 15/5 -> 2+1   Hide 15/13/12 -> 2+2+2   Silk 5   Oil 20   Stone 5
  //   bars 2/17/26 -> 1+4+6   Patron 1
  eq('149 lots to rawPricesData', p.raw.length, 149);
  const count = {};
  for (const r of p.raw) count[r.Item] = (count[r.Item] || 0) + 1;
  eq('lots per Item', count, {
    'Treasure Chip': 5, 'Preorder Bonus': 8, '8k Bonus': 1, '1k Bonus': 8, '2k Bonus': 4, 'Wish Ring': 1,
    'Ultra Rare': 16, "Alchemist's Ink": 6, "Alchemist's Parchment": 5, Aragonite: 15, 'Darkwood Plank': 5,
    'Dwarven Steel': 4, 'Elven Bismuth': 20, "Enchanter's Munition": 3, 'Minotaur Hide': 6, 'Mystic Silk': 5,
    'Oil of Enchantment': 20, "Philosopher's Stone": 5, '1,000 GP Gold Bar': 11, 'Patron Pin': 1,
  });
  eq('the Parchment lots', p.raw.filter((r) => r.Item === "Alchemist's Parchment").map((r) => `${r.trentName} ${r.trentPrice} ${r.Price}`), [
    "10x Alchemist's Parchment 16 1.6", "2x Alchemist's Parchment 3.2 1.6", "10x Alchemist's Parchment 16 1.6",
    "10x Alchemist's Parchment 13.5 1.35", "8x Alchemist's Parchment 10.8 1.35",
  ]);
  const drake = p.raw.filter((r) => r.Item === 'Preorder Bonus');
  check("Drake's Elixir is 4x lots at $2.00, written with a straight apostrophe",
    drake.every((r) => r.trentName === "4x Drake's Elixir" && r.trentPrice === 2 && r.Price === 0.5), drake[0]);
  check('Treasure Chips lose their season prefix', p.raw.filter((r) => r.Item === 'Treasure Chip').every((r) => /^\d+x Treasure Chips$/.test(r.trentName)));
  check('no trentName carries a curly apostrophe', p.raw.every((r) => !/[‘’]/.test(r.trentName)));

  // max then min per Item, one row where an Item had one lot — processAuction's rule.
  const block = {};
  for (const r of p.prices) (block[r.Item] ??= []).push(r.Price);
  eq('the price block', block, {
    '1,000 GP Gold Bar': [7.25, 7], '1k Bonus': [61, 61], '2k Bonus': [66, 65], '8k Bonus': [1301],
    "Alchemist's Ink": [2.5, 2.25], "Alchemist's Parchment": [1.6, 1.35], Aragonite: [7.25, 7],
    'Darkwood Plank': [0.7, 0.5], 'Dwarven Steel': [1.75, 1.5], 'Elven Bismuth': [29.25, 29],
    "Enchanter's Munition": [3.6, 3.6], 'Minotaur Hide': [2.6, 2.35], 'Mystic Silk': [0.5, 0.5],
    'Oil of Enchantment': [41, 40.75], 'Patron Pin': [370], "Philosopher's Stone": [1.15, 1.15],
    'Preorder Bonus': [0.5, 0.5], 'Treasure Chip': [4.1, 3.85], 'Ultra Rare': [52, 51], 'Wish Ring': [101],
  });
  eq('37 price rows', p.prices.length, 37);

  eq('21 Onyx rows, the size of every Onyx order', p.onyx.length, 21);
  check('the set is C/UC/R Set', p.onyx.some((r) => r.Item === 'C/UC/R Set' && r.Price === 81));
  const knownOnyx = new Set(ONYX.map((r) => r.Item));
  const newOnyx = p.onyx.filter((r) => !knownOnyx.has(r.Item)).map((r) => r.Item);
  eq('every Onyx name is one onyx.csv already holds — no invented spelling', newOnyx, []);
  const known2027 = new Set(TOKENS.filter((t) => t.auctionSeason === '2027').map((t) => t.Item));
  eq('every price Item is a 2027 tokenMetadata Item', p.prices.filter((r) => !known2027.has(r.Item)).map((r) => r.Item), []);

  const written = p.raw.reduce((s, r) => s + r.trentPrice, 0) + p.onyx.reduce((s, r) => s + r.Price, 0);
  eq('every dollar lands exactly once', Math.round(written * 100) / 100, 7007.45);

  eq('an Onyx style gets no style caution', p.cautions.filter((c) => /auctionStyle/.test(c)), []);
  check('a pasted export gets no sticker check', p.cautions.every((c) => !/stickers/.test(c)));

  // The style 202722 was first recorded with, missing Onyx. CONSTRUCTED, not
  // read from auctionMetadata.csv: this test first read the shipped cell, and
  // when the workbook corrected it (#297, a pure-data publish that skips
  // test:code) main went red with nothing wrong in the data. A test pinned to a
  // shipped VALUE blocks the very fix it is about.
  const WRONG = 'Trade 2 Ultra Condensed';
  const recorded = plain(plan(EXPORT, { style: WRONG, stickers: STATE.settings.stickers }));
  check('a style missing Onyx still plans — a caution never blocks', recorded.ok);
  check('the stickers caution names the right style', recorded.cautions.some((c) => /stickers say "Onyx Trade 2 Ultra Condensed"/.test(c)), recorded.cautions);
  check('the Onyx lots caution names § 6', recorded.cautions.some((c) => /21 Onyx token\(s\).*§ 6/.test(c)), recorded.cautions);
  const right = plain(plan(EXPORT, { style: 'Onyx Trade 2 Ultra Condensed', stickers: STATE.settings.stickers }));
  eq('the corrected style draws no style caution', right.cautions.filter((c) => /auctionStyle/.test(c)), []);
}

// ===========================================================================
console.log('\nBoth sources, one plan\n');
// ===========================================================================
{
  const api = plain(U.utakuApiRead(STATE, [], TARGET));
  const a = plain(plan(api.grid, { stickers: api.stickers }));
  const e = plain(plan(EXPORT));
  check('the API grid plans cleanly', a.ok, a.aborts);
  // Row ORDER differs (the API lists winners per item in its own order), so
  // compare as sorted sets.
  const s = (rows) => rows.map((r) => JSON.stringify(r)).sort();
  eq('rawPricesData rows agree', s(a.raw), s(e.raw));
  eq('prices rows agree', s(a.prices), s(e.prices));
  eq('onyx rows agree', s(a.onyx), s(e.onyx));
}

// ===========================================================================
console.log('\nRefusals\n');
// ===========================================================================
{
  const p = plain(plan(EXPORT));
  const asOther = p.prices.map((r) => ({ auctionId: '209999', ...r }));
  const wrong = plain(plan(EXPORT, { prices: PRICES.concat(asOther) }));
  check('bids that fingerprint as another recorded auction abort, naming it', !wrong.ok && !wrong.rowsComplete &&
    wrong.aborts.some((x) => /these bids are auction 209999's/.test(x)), wrong.aborts);

  const again = plain(plan(EXPORT, { priced: true }));
  check('an auction already priced refuses to write, rows intact', !again.ok && again.rowsComplete && again.raw.length === 149);

  const odd = plain(plan(grid([['Aragonite', 2, 7.25], ['Mystery Crate', 3, 10]])));
  check('a name that resolves nowhere aborts', !odd.ok && odd.aborts.some((x) => /Mystery Crate/.test(x)));
  eq('...and reaches the context worksheet with its quantity and total', odd.unresolved.map((u) => [u.base, u.quantity, u.bid]), [['Mystery Crate', 3, 30]]);

  const twoOnyx = plain(plan(grid([['Bead of Need (Onyx)', 2, 71]])));
  check('two of one Onyx token aborts', !twoOnyx.ok && twoOnyx.aborts.some((x) => /Onyx token/.test(x)));

  const season = plain(U.utakuPlanImport(EXPORT, '2026', TOKENS, false, '', PRICES, '202622', null));
  check('the 2027 export picked against a 2026 auction aborts', !season.ok && season.aborts.some((x) => /looks like season 2027/.test(x)));
}

// ===========================================================================
console.log('\nAuctions #2 and #3, planned\n');
// ===========================================================================
{
  // Styles CONSTRUCTED, never read from auctionMetadata.csv — see WRONG above.
  const ONYX_STYLE = 'Onyx Trade 2 Ultra Condensed';
  const PLAIN_STYLE = 'Trade 2 Ultra Condensed';
  // The recorded prices WITHOUT either auction, so this suite says the same
  // thing before and after they are published; the publish case is built below.
  const BEFORE = PRICES.filter((r) => r.auctionId !== '202724' && r.auctionId !== '202728');
  const planFor = (values, id, style, prices = BEFORE) => plain(U.utakuPlanImport(values, '2027', TOKENS, false, style, prices, id, null));
  const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const lotsPerItem = (p) => { const c = {}; for (const r of p.raw) c[r.Item] = (c[r.Item] || 0) + 1; return sortKeys(c); };
  const priceBlock = (p) => { const b = {}; for (const r of p.prices) (b[r.Item] ??= []).push(r.Price); return sortKeys(b); };
  // The file's own Line total column, summed independently of the script.
  const lineTotal = (values) => Math.round(values.slice(1).filter((r) => r[0]).reduce((s, r) => s + Number(r[3]) * 100, 0)) / 100;
  const known2027 = new Set(TOKENS.filter((t) => t.auctionSeason === '2027').map((t) => t.Item));
  const knownOnyx = new Set(ONYX.map((r) => r.Item));

  const cases = [
    {
      label: '#2 (202724)', values: EXPORT_2, id: '202724', style: ONYX_STYLE, bids: 57, total: 7003, onyx: 21,
      // chips 5/45 -> 1+5   Drake's 32 -> 8   Codex 1   Warden 2+1+4+1   Shirt 2+2   Wish 1
      // PYP 1+6+1+5+3   Ink 40 -> 4   Parchment 40 -> 4   Aragonite 3+5+1+6   Darkwood 50 -> 5
      // Steel 20/20 -> 2+2   Bismuth 3+10+3+4   Munition 20 -> 2   Hide 40 -> 4   Silk 50 -> 5
      // Oil 20   Stone 50 -> 5   bars 45 -> 9   Patron 1
      raw: 142,
      lots: {
        'Treasure Chip': 6, 'Preorder Bonus': 8, '8k Bonus': 1, '1k Bonus': 8, '2k Bonus': 4, 'Wish Ring': 1,
        'Ultra Rare': 16, "Alchemist's Ink": 4, "Alchemist's Parchment": 4, Aragonite: 15, 'Darkwood Plank': 5,
        'Dwarven Steel': 4, 'Elven Bismuth': 20, "Enchanter's Munition": 2, 'Minotaur Hide': 4, 'Mystic Silk': 5,
        'Oil of Enchantment': 20, "Philosopher's Stone": 5, '1,000 GP Gold Bar': 9, 'Patron Pin': 1,
      },
      block: {
        '1,000 GP Gold Bar': [6.75, 6.75], '1k Bonus': [61, 60], '2k Bonus': [79, 79], '8k Bonus': [1210],
        "Alchemist's Ink": [2, 2], "Alchemist's Parchment": [1.5, 1.5], Aragonite: [7, 6.75],
        'Darkwood Plank': [0.75, 0.75], 'Dwarven Steel': [1.75, 1.5], 'Elven Bismuth': [31, 30],
        "Enchanter's Munition": [4, 4], 'Minotaur Hide': [2.75, 2.75], 'Mystic Silk': [1.25, 1.25],
        'Oil of Enchantment': [41, 41], 'Patron Pin': [405], "Philosopher's Stone": [1.25, 1.25],
        'Preorder Bonus': [0.75, 0.75], 'Treasure Chip': [6.25, 6], 'Ultra Rare': [49, 48], 'Wish Ring': [91],
      },
      split: ['Treasure Chips: 5 / 10+10+10+10+5 → 6 lot(s)', 'Dwarven Steel: 10+10 / 10+10 → 4 lot(s)', '1K Gold Bar: 5+5+5+5+5+5+5+5+5 → 9 lot(s)'],
    },
    {
      label: '#3 (202728)', values: EXPORT_3, id: '202728', style: PLAIN_STYLE, bids: 41, total: 7001, onyx: 0,
      // chips 50 -> 5   Drake's 32 -> 8   Codex 1   Warden 2+6   Shirt 1+1+1+1   Wish 1   PYP 3+31
      // Ink 2/38 -> 1+4   Parchment 40 -> 4   Aragonite 15   Darkwood 50 -> 5   Steel 5/12/23 -> 1+2+3
      // Bismuth 4+5+4+3+4   Munition 3/5/12 -> 1+1+2   Hide 40 -> 4   Silk 2/48 -> 1+5
      // Oil 2+3+4+1+10   Stone 50 -> 5   bars 1/4/40 -> 1+1+8   Patron 1
      raw: 166,
      lots: {
        'Treasure Chip': 5, 'Preorder Bonus': 8, '8k Bonus': 1, '1k Bonus': 8, '2k Bonus': 4, 'Wish Ring': 1,
        'Ultra Rare': 34, "Alchemist's Ink": 5, "Alchemist's Parchment": 4, Aragonite: 15, 'Darkwood Plank': 5,
        'Dwarven Steel': 6, 'Elven Bismuth': 20, "Enchanter's Munition": 4, 'Minotaur Hide': 4, 'Mystic Silk': 6,
        'Oil of Enchantment': 20, "Philosopher's Stone": 5, '1,000 GP Gold Bar': 10, 'Patron Pin': 1,
      },
      block: {
        '1,000 GP Gold Bar': [7, 6.75], '1k Bonus': [51, 50], '2k Bonus': [71, 70], '8k Bonus': [1255],
        "Alchemist's Ink": [2.5, 2.25], "Alchemist's Parchment": [1.5, 1.5], Aragonite: [8.25, 8.25],
        'Darkwood Plank': [0.75, 0.75], 'Dwarven Steel': [1.5, 1.25], 'Elven Bismuth': [33, 32],
        "Enchanter's Munition": [4.25, 4], 'Minotaur Hide': [2.75, 2.75], 'Mystic Silk': [1.25, 1],
        'Oil of Enchantment': [42, 41], 'Patron Pin': [360], "Philosopher's Stone": [1.5, 1.5],
        'Preorder Bonus': [0.75, 0.75], 'Treasure Chip': [4.75, 4.75], 'Ultra Rare': [56, 55], 'Wish Ring': [96],
      },
      split: ['Dwarven Steel: 5 / 10+2 / 10+10+3 → 6 lot(s)', '1K Gold Bar: 1 / 4 / 5+5+5+5+5+5+5+5 → 10 lot(s)', "Alchemist's Ink: 2 / 10+10+10+8 → 5 lot(s)"],
    },
  ];

  const plans = {};
  for (const c of cases) {
    const read = plain(U.utakuReadGrid(c.values, '2027'));
    eq(`${c.label}: the "updated format" is #1's four columns`, c.values[0], HEADER);
    eq(`${c.label}: ${c.bids} bids, no problems, no cautions`, [read.bids.length, read.problems.length, read.cautions.length], [c.bids, 0, 0]);

    const p = planFor(c.values, c.id, c.style);
    plans[c.id] = p;
    check(`${c.label}: it plans cleanly`, p.ok && p.rowsComplete, p.aborts);
    eq(`${c.label}: no cautions at all`, p.cautions, []);
    eq(`${c.label}: season 2027 and nothing else`, p.seasons, ['2027']);
    eq(`${c.label}: the bids total the file's own Line total column`, [p.exportTotal, lineTotal(c.values)], [c.total, c.total]);
    eq(`${c.label}: ${c.raw} lots to rawPricesData`, p.raw.length, c.raw);
    eq(`${c.label}: lots per Item`, lotsPerItem(p), sortKeys(c.lots));
    eq(`${c.label}: the price block, max then min`, priceBlock(p), sortKeys(c.block));
    eq(`${c.label}: ${p.prices.length} price rows — two per Item, one where it sold once`, p.prices.length,
      Object.values(c.block).reduce((s, v) => s + v.length, 0));
    eq(`${c.label}: ${c.onyx} Onyx rows`, p.onyx.length, c.onyx);
    eq(`${c.label}: every Onyx name is one onyx.csv already holds`, p.onyx.filter((r) => !knownOnyx.has(r.Item)).map((r) => r.Item), []);
    eq(`${c.label}: every price Item is a 2027 tokenMetadata Item`, p.prices.filter((r) => !known2027.has(r.Item)).map((r) => r.Item), []);
    check(`${c.label}: every lot's price is its bid's per-token price × its size`,
      p.raw.every((r) => { const n = r.trentName.match(/^(\d+)x /); return Math.round(r.Price * (n ? Number(n[1]) : 1) * 100) === Math.round(r.trentPrice * 100); }));
    check(`${c.label}: no trentName carries a curly apostrophe or a season`, p.raw.every((r) => !/[‘’]/.test(r.trentName) && !/\b2027\b/.test(r.trentName)));
    const written = p.raw.reduce((s, r) => s + r.trentPrice, 0) + p.onyx.reduce((s, r) => s + r.Price, 0);
    eq(`${c.label}: every dollar lands exactly once`, Math.round(written * 100) / 100, c.total);
    const text = U.utakuDescribePlan(p, c.id, null);
    for (const line of c.split) check(`${c.label}: the dialog shows "${line}"`, text.includes(line), text);
  }

  // The remainders #3 has and #1 did not.
  const bars3 = plans['202728'].raw.filter((r) => r.Item === '1,000 GP Gold Bar').map((r) => `${r.trentName} @ ${r.trentPrice}`);
  eq('#3: a single gold bar is a 1x lot, four are a 4x lot, before the 5x lots', bars3.slice(0, 3), ['1x 1K Gold Bar @ 7', '4x 1K Gold Bar @ 28', '5x 1K Gold Bar @ 33.75']);
  const steel3 = plans['202728'].raw.filter((r) => r.Item === 'Dwarven Steel').map((r) => r.trentName);
  eq('#3: Dwarven Steel 5 / 12 / 23', steel3, ['5x Dwarven Steel', '10x Dwarven Steel', '2x Dwarven Steel', '10x Dwarven Steel', '10x Dwarven Steel', '3x Dwarven Steel']);

  // The style cross-wiring: each export checked against the OTHER's style.
  const asPlain = planFor(EXPORT_2, '202724', PLAIN_STYLE);
  check('#2 under a non-Onyx style still plans, and cautions § 6', asPlain.ok && asPlain.cautions.some((c) => /21 Onyx token\(s\).*§ 6/.test(c)), asPlain.cautions);
  const asOnyx = planFor(EXPORT_3, '202728', ONYX_STYLE);
  check('#3 under an Onyx style cautions that it sells no Onyx', asOnyx.ok && asOnyx.cautions.some((c) => /sells no Onyx/.test(c)), asOnyx.cautions);

  // What the next publish creates: one of them recorded, then the other imported.
  // Both use the same staging tab, so the stale-tab case is THIS pair.
  const recorded = (id) => plans[id].prices.map((r) => ({ auctionId: id, ...r }));
  const third = planFor(EXPORT_3, '202728', PLAIN_STYLE, BEFORE.concat(recorded('202724')));
  check('#3 imports cleanly with #2 already recorded — their shared prices do not collide', third.ok, third.aborts);
  const second = planFor(EXPORT_2, '202724', ONYX_STYLE, BEFORE.concat(recorded('202728')));
  check('#2 imports cleanly with #3 already recorded', second.ok, second.aborts);
  const stale = planFor(EXPORT_2, '202728', PLAIN_STYLE, BEFORE.concat(recorded('202724')));
  check("#2's export left in the tab and picked as 202728 aborts, naming 202724", !stale.ok &&
    stale.aborts.some((x) => /these bids are auction 202724's/.test(x)), stale.aborts);
}

// ===========================================================================
console.log('\nPicker and dialog\n');
// ===========================================================================
{
  const site = META.filter((m) => U.utakuIsSiteRow(m)).map((m) => m.auctionId);
  // Membership, never a count: his next auction is a publish, and a publish
  // must not turn this suite red.
  check('202722 is a Utaku row', site.includes('202722'), site);
  check('...and every Utaku row carries the site\'s Link', META.filter((m) => U.utakuIsSiteRow(m))
    .every((m) => m.Link.startsWith('https://auction.utakustradecaravan.com')));
  check('a forum post mentioning the site is not a Utaku row',
    !U.utakuIsSiteRow({ Link: 'https://truedungeon.com/forum?q=auction.utakustradecaravan.com' }));
  const picker = plain(U.utakuPickerList(META));
  check('the picker lists it', picker.rows.some((r) => r.auctionId === '202722'), picker.rows.map((r) => r.auctionId));

  const text = U.utakuDescribePlan(plan(EXPORT), '202722', '2026-09-29', 'the site\'s close, 19:10 Eastern');
  check('the dialog names the lot count, the total and the close', /149 lots/.test(text) && /\$7007\.45/.test(text) && /closeDate 2026-09-29/.test(text));
  check('and shows how the bids were split, one line per item',
    text.includes("Alchemist's Parchment: 10+2 / 10 / 10+8 → 5 lot(s)") &&
    text.includes('one row per token: Ioun Stone Warden Wrath 8'), text);
  check('the script carries a version', /^\d{4}-\d{2}-\d{2}\.\d+$/.test(U.UTAKU_VERSION));
}

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
