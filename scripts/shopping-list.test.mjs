// Tests for the Shopping List pricing branches and lib/shoppingList.ts.
//
// The other eight suites test .gs and .mjs files, which node can require
// directly. This one tests `src/lib`, which is TypeScript importing its
// siblings extensionlessly (`from './data'`) because Vite resolves that and
// node's ESM loader does not. Rather than add a test runner or a bundler step
// for one suite, the sources are copied to a temp directory with `.ts` appended
// to their internal imports and run through node's own type stripping — the
// same technique docs and CLAUDE.md already prescribe for analysing this engine.
// Nothing in the repo is written to.
//
// What it pins, and why each one is here rather than being left to inspection:
//
//   the four pricing branches       the whole point of the change
//   the pinned-Ultra-Rare pool      a decision, so it needs a witness
//   the pre-2018 clamp              the failure D4 exists to prevent
//   "no line loses a price"         the invariant every branch in the chain
//                                   is written to preserve
//   14 goods, one price each        NOT a tidiness check: the Shopping List
//                                   merges trade goods on name alone, and that
//                                   is only sound while this holds
//   the staleness threshold         a derived number, so the derivation is
//                                   asserted rather than the number alone
//
// Run: node scripts/shopping-list.test.mjs

import { readFileSync, mkdtempSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const dataDir = join(repo, 'public', 'data');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok    ${name}`); pass++; return; }
  console.error(`  FAIL  ${name}`);
  if (detail !== undefined) console.error(String(detail).split('\n').slice(0, 12).map((l) => '        ' + l).join('\n'));
  fail++;
};
const near = (a, b, eps = 0.005) => a !== null && b !== null && Math.abs(a - b) < eps;
const money = (n) => (n === null || n === undefined ? 'null' : `$${n.toFixed(2)}`);

// --- load src/lib through node's type stripping ---------------------------

const work = mkdtempSync(join(tmpdir(), 'shopping-list-test-'));
let lib;
try {
  const src = join(repo, 'src', 'lib');
  mkdirSync(join(work, 'lib'), { recursive: true });
  for (const f of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(src, f), 'utf8')
      // `from './categories'` -> `from './categories.ts'`. Only relative
      // sibling specifiers; anything else is left exactly as authored.
      .replace(/(\bfrom\s+'\.\/[A-Za-z0-9_]+)'/g, "$1.ts'");
    writeFileSync(join(work, 'lib', f), text);
  }
  const url = (f) => pathToFileURL(join(work, 'lib', f)).href;
  lib = {
    data: await import(url('data.ts')),
    transmutes: await import(url('transmutes.ts')),
    shoppingList: await import(url('shoppingList.ts')),
    shoppingExport: await import(url('shoppingExport.ts')),
    shoppingStorage: await import(url('shoppingStorage.ts')),
  };
} catch (e) {
  console.error('could not load src/lib:', e.message);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const { parseSales, parseMeta } = lib.data;
const {
  PriceIndex, CostEngine, parseRecipes, parseTokenMetadata, parseOffAuctionPrices,
  parseDerivedRules, isTradeCategory, TIER_PROXY,
} = lib.transmutes;
const { buildShoppingList, mergeKey, stalenessOf, STALE_THRESHOLD, noteLabel, stalenessNote,
  lotHintFor, LOT_SIZE } = lib.shoppingList;
const { toCSV, toTSV, toRows, toSheet, csvFile, guardFormula, exportFilename, EXPORT_COLUMNS } =
  lib.shoppingExport;
const { loadShopping, saveShopping, clearShopping } = lib.shoppingStorage;

const read = (f) => readFileSync(join(dataDir, f), 'utf8');
const sales = parseSales(read('prices.csv'));
const prices = new PriceIndex(
  sales,
  parseOffAuctionPrices(read('offAuctionPrices.csv')),
  parseDerivedRules(read('derivedPrices.csv')),
  parseTokenMetadata(read('tokenMetadata.csv')),
  parseMeta(read('auctionMetadata.csv')),
);
const recipes = parseRecipes(read('transmuteRecipes.csv'));

// Pinned, or every status assertion below decays as the calendar moves.
const TODAY = '2026-08-31';
const engine = new CostEngine(recipes, prices, { today: TODAY });
const engineRecent = new CostEngine(recipes, prices, { today: TODAY, recentPrices: true });

const costs = recipes.map((r) => engine.cost(r.transmute, r.year)).filter(Boolean);
const byKey = new Map(costs.map((c) => [c.key, c]));
const pickable = costs.filter((c) => c.status !== 'expired');
const isUR = (l) => l.good === 'Ultra Rare' || l.category === 'Ultra Rare';
const allLines = costs.flatMap((c) => c.lines.map((l) => ({ c, l })));

// =========================================================================
console.log('\n=== 1. the corpus these numbers are measured over ===');

check('174 recipes, priced', costs.length === 174, costs.length);
check('91 active / 12 future / 71 expired at ' + TODAY,
  costs.filter((c) => c.status === 'active').length === 91 &&
  costs.filter((c) => c.status === 'future').length === 12 &&
  costs.filter((c) => c.status === 'expired').length === 71,
  costs.reduce((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {}));
check('103 pickable recipes (active + future)', pickable.length === 103, pickable.length);
check('1,985 priced ingredient lines', allLines.length === 1985, allLines.length);

// =========================================================================
console.log('\n=== 2. branch S1 — a trade good prices at the current season ===');

const tradeLines = allLines.filter(({ l }) => isTradeCategory(l.category));
const pickableTrade = tradeLines.filter(({ c }) => c.status !== 'expired');
check('1,736 trade-good lines in all, 1,125 of them pickable',
  tradeLines.length === 1736 && pickableTrade.length === 1125,
  `${tradeLines.length} / ${pickableTrade.length}`);

const goods = [...new Set(tradeLines.map(({ l }) => l.good))].sort();
check('exactly 14 distinct trade goods', goods.length === 14, goods.join(', '));

// The premise under the Shopping List's merge key. If this ever fails, rows
// merged on name alone are summing two different prices under one heading.
const priceByGood = new Map();
const clashes = [];
for (const { l } of tradeLines) {
  const seen = priceByGood.get(l.good);
  if (seen === undefined) priceByGood.set(l.good, l.unitAvg);
  else if (seen !== l.unitAvg) clashes.push(`${l.good}: ${money(seen)} vs ${money(l.unitAvg)}`);
}
check('every trade good resolves to ONE price across all 174 recipes — the premise merging on name alone rests on',
  clashes.length === 0, clashes.slice(0, 8).join('\n'));

check('...and every one of them is priced from the current season',
  tradeLines.every(({ l }) => l.pricedYear === prices.latestPriced || l.source !== 'auction'),
  tradeLines.filter(({ l }) => l.pricedYear !== prices.latestPriced && l.source === 'auction')
    .slice(0, 5).map(({ c, l }) => `${c.key} ${l.good} -> ${l.pricedYear}`).join('\n'));

// The rule has to beat the expired window, which is the half of D1a that
// actually changes something: an expired recipe's Darkwood Plank is bought now.
const expiredTrade = tradeLines.filter(({ c }) => c.status === 'expired');
check('an EXPIRED recipe reads today\'s trade-good prices, not its build window\'s',
  expiredTrade.length === 611 && expiredTrade.every(({ l }) => l.basis !== 'window'),
  `${expiredTrade.length} lines, ${expiredTrade.filter(({ l }) => l.basis === 'window').length} still windowed`);

// =========================================================================
console.log('\n=== 3. branches S2/3/4 — an Ultra Rare reads its vintage ===');

const urPickable = allLines.filter(({ c, l }) => c.status !== 'expired' && isUR(l));
const L = prices.latestPriced;
const inPrint = urPickable.filter(({ l }) => l.nominalYear >= L - 1);
const oop = urPickable.filter(({ l }) => l.nominalYear < L - 1 && l.nominalYear >= prices.earliestPriced);
const preData = urPickable.filter(({ l }) => l.nominalYear < prices.earliestPriced);
check(`branch S2 covers 27 in-print lines (nominal >= ${L - 1})`, inPrint.length === 27, inPrint.length);
check('branch 3 covers 40 out-of-print lines', oop.length === 40, oop.length);
check('branch 4 covers 18 lines older than the auction data', preData.length === 18, preData.length);

check('an in-print Ultra Rare prices at the current season, not a pool',
  inPrint.every(({ l }) => l.source !== 'auction' || l.basis === 'season'),
  inPrint.filter(({ l }) => l.source === 'auction' && l.basis !== 'season')
    .slice(0, 5).map(({ c, l }) => `${c.key} ${l.good} ${l.nominalYear} ${l.basis}`).join('\n'));

check('an out-of-print Ultra Rare pools its own two seasons',
  oop.filter(({ l }) => l.basis === 'pool').length === oop.filter(({ l }) => l.source === 'auction').length,
  oop.filter(({ l }) => l.source === 'auction' && l.basis !== 'pool')
    .slice(0, 5).map(({ c, l }) => `${c.key} ${l.good} ${l.nominalYear} ${l.basis}`).join('\n'));

// D4's clamp, and the specific failure it exists to prevent: floating these
// would put a 2014 Legendary's Ultra Rare at the 2026 price ($59.50) when the
// closest thing to that era's baseline the data holds is 2018's ($111.50).
// All 18 are NAMED tokens rather than the bare tier, reaching their price
// through TIER_PROXY or their own off-auction row — which is why this asserts
// the clamp's EFFECT rather than filtering on `good === 'Ultra Rare'`.
const todayTier = prices.leafPrice('Ultra Rare', L, 'full').stats.avg;
check('a pre-2018 Ultra Rare never floats forward to the current season',
  preData.every(({ l }) => l.pricedYear < L),
  preData.filter(({ l }) => l.pricedYear >= L).slice(0, 5).map(({ c, l }) => `${c.key} ${l.nominalYear} -> ${l.pricedYear}`).join('\n'));
check("...it holds its era's baseline, dearer than today — the whole reason for the clamp",
  preData.every(({ l }) => l.unitAvg > todayTier),
  `today ${money(todayTier)}; the pre-2018 lines sit at ` +
  [...new Set(preData.map(({ l }) => money(l.unitAvg)))].sort().join(' / '));

// The chain must never cost a line a price it used to have. Every branch above
// is written as a fallback for this reason, so assert it directly.
check('no line anywhere is left unpriced', allLines.every(({ l }) => l.unitAvg !== null),
  allLines.filter(({ l }) => l.unitAvg === null).slice(0, 5).map(({ c, l }) => `${c.key} ${l.good}`).join('\n'));

// =========================================================================
console.log('\n=== 4. the decision: a PINNED Ultra Rare pools too ===');

// The authored lines, matched back through cost()'s stable source-first sort.
const pinnedUR = [];
for (const r of recipes) {
  const c = byKey.get(r.key); if (!c) continue;
  const authored = [...r.lines].sort((a, b) => Number(b.isSource) - Number(a.isSource));
  c.lines.forEach((l, i) => {
    if (authored[i].goodYear.trim() !== '' && isUR(l))
      pinnedUR.push({ key: r.key, status: c.status, l, pin: authored[i].goodYear.trim() });
  });
}
check('10 pinned Ultra Rare lines in the corpus, 7 of them on pickable recipes',
  pinnedUR.length === 10 && pinnedUR.filter((p) => p.status !== 'expired').length === 7,
  pinnedUR.map((p) => `${p.key} ${p.l.nominalYear}`).join('\n'));

// A pinned Ultra Rare now takes the SAME branch a blank one of its vintage
// takes, which is the decision. Scoped to the pins the pool actually governs
// — out of print, and inside the auction data; the in-print pins are next.
const poolable = pinnedUR.filter((p) => p.l.nominalYear >= prices.earliestPriced && p.l.nominalYear < L - 1);
check('every pinned OUT-OF-PRINT Ultra Rare pools its pinned vintage and the next',
  poolable.length === 6 && poolable.every((p) =>
    p.l.basis === 'pool' && p.l.poolYears[0] === p.l.nominalYear && p.l.poolYears[1] === p.l.nominalYear + 1),
  poolable.map((p) => `${p.key} pin=${p.pin} nom=${p.l.nominalYear} ${p.l.basis} ${JSON.stringify(p.l.poolYears)}`).join('\n'));

// The other half of "exactly as a blank one does". Before the Ultra Rare
// rules were applied as one set, a pinned 2025 line pooled while a blank 2025
// line read the current season — two prices for one vintage, decided by
// nothing but how the cell happened to be authored.
const inPrintPins = pinnedUR.filter((p) => p.l.nominalYear >= L - 1);
check('a pinned IN-PRINT Ultra Rare reads the current season, exactly as a blank one does',
  inPrintPins.length === 3 && inPrintPins.every((p) => p.l.basis === 'season' && p.l.pricedYear === L),
  inPrintPins.map((p) => `${p.key} pin=${p.pin} nom=${p.l.nominalYear} ${p.l.basis}/${p.l.pricedYear} ${money(p.l.unitAvg)}`).join('\n'));
check('...so a pinned and a blank line of the same vintage never disagree',
  new Set(allLines.filter(({ l }) => isUR(l) && l.nominalYear === L - 1 && l.source === 'auction')
    .map(({ l }) => l.unitAvg)).size === 1,
  [...new Set(allLines.filter(({ l }) => isUR(l) && l.nominalYear === L - 1).map(({ l }) => money(l.unitAvg)))].join(', '));

// The pin keys the pool, NOT the recipe -- the bug this decision would
// otherwise have introduced. Deathward Greaves is a 2026 recipe holding
// 2023/2024/2025 Ultra Rares, so recipe-keyed pooling would price all three
// identically.
const dgPins = pinnedUR.filter((p) => p.key === '2026|Deathward Greaves');
const dgPooled = dgPins.filter((p) => p.l.basis === 'pool');
check("the pool keys on the LINE's year, not the recipe's — Deathward Greaves' 2023 and 2024 pins pool their OWN vintages",
  dgPins.length === 3 && dgPooled.length === 2 &&
  dgPooled.every((p) => p.l.poolYears[0] === p.l.nominalYear && p.l.poolYears[1] === p.l.nominalYear + 1) &&
  new Set(dgPins.map((p) => p.l.unitAvg)).size === 3,
  dgPins.map((p) => `pin=${p.pin} nom=${p.l.nominalYear}: ${money(p.l.unitAvg)} ${p.l.basis} ${JSON.stringify(p.l.poolYears ?? null)}`).join('\n'));

// The two pins the pool cannot answer, which must fall through unchanged
// rather than losing their price: one older than the data, one a season ahead
// of it. The 2027 line survives because leafPrice's clamp reads the MAPPING's
// variant (last-5, a forward estimate) rather than the caller's.
const synergy = pinnedUR.find((p) => p.key === "2027|Smith's Charm of Unified Synergy (Set 2)");
check('a pin older than the auction data keeps its own hand-authored price ($140 off-auction), not the tier average',
  near(synergy.l.unitAvg, 140) && synergy.l.source === 'offAuction',
  `${money(synergy.l.unitAvg)} ${synergy.l.source}`);
// A vintage the data has not reached yet is not out of print either, so S2
// claims it and quotes today's market — the only market there is for it. It
// used to fall to the season clamp and inherit that clamp's forward last-5
// estimate ($59.69); it now reads the full season ($59.50), with the
// recent-prices toggle the one thing that decides between them.
const wealth2027 = pinnedUR.find((p) => p.key === '2027|Coin of Wealth' && p.l.nominalYear === 2027);
check("a pin a season AHEAD of the data prices at the current season, under the toggle like everything else",
  near(wealth2027.l.unitAvg, todayTier) && wealth2027.l.pricedYear === L,
  `${money(wealth2027.l.unitAvg)} py=${wealth2027.l.pricedYear} ${wealth2027.l.variant}`);

// =========================================================================
console.log('\n=== 5. lib/shoppingList.ts ===');

const pick = (key, qty) => ({ cost: byKey.get(key), qty });

// Merge keys: name alone for a trade good, name + vintage for everything else.
const someTrade = tradeLines[0].l, someUR = urPickable.find(({ l }) => l.good === 'Ultra Rare').l;
check('a trade good merges on name alone; everything else carries its vintage',
  mergeKey(someTrade) === `T|${someTrade.good}` && mergeKey(someUR) === `A|Ultra Rare|${someUR.nominalYear}`,
  `${mergeKey(someTrade)} | ${mergeKey(someUR)}`);

// The measurement the whole design rests on: trade goods do not grow with the
// list, additional items do.
const all2026 = costs.filter((c) => c.year === 2026 && c.status !== 'expired').map((c) => ({ cost: c, qty: 1 }));
const one = buildShoppingList([pick('2026|Deathward Greaves', 1)], engine);
const many = buildShoppingList(all2026, engine);
check('the trade-good table is BOUNDED at 14 however many recipes are picked',
  many.trade.length === 14 && one.trade.length <= 14 && many.trade.length - one.trade.length <= 1,
  `1 recipe -> ${one.trade.length} trade rows; ${all2026.length} recipes -> ${many.trade.length}`);
check('...while the additional-items table grows at roughly a row per recipe',
  many.additional.length > one.additional.length * 5,
  `${one.additional.length} -> ${many.additional.length} over ${all2026.length} recipes`);

// D2: on hand does NOT clamp, deliberately unlike the calculator.
const bigStash = buildShoppingList([pick('2026|Deathward Greaves', 1)], engine, {
  onHand: Object.fromEntries(one.all.map((r) => [r.id, r.quantity + 5])),
});
check('D2 — on hand does not clamp: surplus shows as spare and costs nothing',
  bigStash.all.every((r) => r.need === 0 && r.spare === 5 && r.extAvg === 0) && bigStash.totals.grandAvg === 0,
  bigStash.all.slice(0, 3).map((r) => `${r.good} need=${r.need} spare=${r.spare}`).join('\n'));

const doubled = buildShoppingList([pick('2026|Deathward Greaves', 2)], engine);
check('quantity scales the whole list linearly',
  near(doubled.totals.grandAvg, one.totals.grandAvg * 2, 0.01),
  `${money(one.totals.grandAvg)} x2 vs ${money(doubled.totals.grandAvg)}`);

const paused = buildShoppingList([pick('2026|Deathward Greaves', 0)], engine);
check('quantity 0 pauses a pick rather than removing it',
  paused.paused.length === 1 && paused.all.length === 0, JSON.stringify(paused.totals));

// What the plan is FOR, for the takeaway list's heading and the exports'
// preamble. A paused recipe is not being made, so it is not in here.
check('the list reports what it is being built for, in the order it was added',
  many.making.length === all2026.length &&
  many.making.every((m, i) => m.transmute === all2026[i].cost.transmute &&
    m.qty === all2026[i].qty && m.year === all2026[i].cost.year && !!m.displayName),
  JSON.stringify(many.making.slice(0, 3)));
check('...and a paused recipe is not something you are making',
  paused.making.length === 0 &&
  buildShoppingList([pick('2026|Deathward Greaves', 3)], engine).making[0].qty === 3,
  JSON.stringify(paused.making));

// D3: min is a footnote total, never a column.
check('D3 — a minimum-prices total is reported alongside the average one',
  many.totals.grandMin > 0 && many.totals.grandMin < many.totals.grandAvg,
  `${money(many.totals.grandMin)} min vs ${money(many.totals.grandAvg)} avg`);

// An override is the player saying what it really costs them, so it has to
// move the footnote total too or that total quotes a market minimum for a line
// they have already priced.
const target = one.trade[0];
const adjusted = buildShoppingList([pick('2026|Deathward Greaves', 1)], engine, { overrides: { [target.id]: 99 } });
const adjRow = adjusted.all.find((r) => r.id === target.id);
check('an override moves the average AND the minimum, and says "Price adjusted"',
  adjRow.unitAvg === 99 && adjRow.unitMin === 99 && adjRow.overridden &&
  adjRow.notes[0].kind === 'adjusted' && near(adjRow.extAvg, 99 * adjRow.need),
  JSON.stringify({ avg: adjRow.unitAvg, min: adjRow.unitMin, notes: adjRow.notes.map((n) => n.kind) }));

// D4: a source is one row priced at build cost, and does NOT recurse.
const withSource = many.all.filter((r) => r.isSource);
check('D4 — sources are single rows in Additional Items, categorised Transmute',
  withSource.length > 0 && withSource.every((r) => r.section === 'additional' && r.category === 'Transmute'),
  withSource.slice(0, 4).map((r) => `${r.good} ${r.section}/${r.category} ${money(r.unitAvg)}`).join('\n'));

// D5: the pair that makes you buy the Relic twice.
const chainPicks = [];
for (const c of pickable) {
  const src = c.lines.find((l) => l.isSource);
  if (src && pickable.some((o) => o.transmute === src.good)) {
    chainPicks.push({ cost: c, qty: 1 }, { cost: pickable.find((o) => o.transmute === src.good), qty: 1 });
    break;
  }
}
const chained = buildShoppingList(chainPicks, engine);
check('D5 — a source that is itself on the list is DETECTED', chained.chains.length === 1,
  JSON.stringify(chained.chains));
check('...and reported without being applied — netting stays opt-in',
  chained.all.find((r) => r.id === chained.chains[0].rowId).need === chained.chains[0].needed,
  JSON.stringify(chained.chains));
const netted = buildShoppingList(chainPicks, engine, { netCraftedSources: true });
const nettedRow = netted.all.find((r) => r.id === chained.chains[0].rowId);
check('...and netting it on removes exactly the ones being crafted',
  nettedRow.need === Math.max(0, chained.chains[0].needed - chained.chains[0].crafted) &&
  netted.totals.grandAvg < chained.totals.grandAvg,
  `need ${chained.all.find((r) => r.id === chained.chains[0].rowId).need} -> ${nettedRow.need}`);

// ...and SAYS so. The on-hand box on screen holds what the player typed, so a
// netted row reads "on hand 0, needed 3, buy 1" with nothing accounting for
// the missing two unless the row carries a note of its own.
const nettedNote = nettedRow.notes.find((n) => n.kind === 'netted');
check('...and the row says where the on-hand count came from',
  !!nettedNote && nettedNote.qty === Math.min(chained.chains[0].crafted, chained.chains[0].needed) &&
  nettedRow.onHand === nettedNote.qty,
  JSON.stringify({ notes: nettedRow.notes.map(noteLabel), onHand: nettedRow.onHand }));
check('...a note that names the toggle rather than restating the arithmetic',
  noteLabel({ kind: 'netted', qty: 2 }) === "2 counted as on hand — you're crafting them" &&
  noteLabel({ kind: 'netted', qty: 1 }) === "1 counted as on hand — you're crafting it",
  noteLabel({ kind: 'netted', qty: 2 }));
check('a row nobody is crafting never carries the note, netting on or off',
  !chained.all.some((r) => r.notes.some((n) => n.kind === 'netted')) &&
  netted.all.filter((r) => r.notes.some((n) => n.kind === 'netted')).length === chained.chains.length,
  netted.all.filter((r) => r.notes.some((n) => n.kind === 'netted')).map((r) => r.good).join(', '));

// Crafting MORE of a source than the list consumes must not invent a surplus.
// The toggle is derived, not typed, so D2's no-clamping rule does not cover it:
// counting both of two crafted items against a row that wants one used to
// report "1 spare" — stock the player does not hold.
const overCraft = buildShoppingList(
  chainPicks.map((p, i) => (i === 1 ? { ...p, qty: 2 } : p)), engine, { netCraftedSources: true });
const overRow = overCraft.all.find((r) => r.id === chained.chains[0].rowId);
check('netting never counts in more of a source than the row asks for',
  overCraft.chains[0].crafted === 2 && overCraft.chains[0].netted === overRow.quantity &&
  overRow.onHand === overRow.quantity && overRow.spare === 0 &&
  !overRow.notes.some((n) => n.kind === 'spare'),
  JSON.stringify({ chain: overCraft.chains[0], onHand: overRow.onHand, spare: overRow.spare }));
check('...and the offer quotes the same number the row applies',
  overCraft.chains.reduce((t, c) => t + c.netted, 0) ===
  overCraft.all.reduce((t, r) => t + (r.notes.find((n) => n.kind === 'netted')?.qty ?? 0), 0),
  JSON.stringify(overCraft.chains.map((c) => c.netted)));

// A count typed by hand comes off what the toggle has left to contribute, or
// the two would stack and cover the row twice over.
const typedFirst = buildShoppingList(chainPicks, engine, {
  netCraftedSources: true, onHand: { [chained.chains[0].rowId]: chained.chains[0].needed },
});
const typedRow = typedFirst.all.find((r) => r.id === chained.chains[0].rowId);
check('a hand-typed count reduces what netting adds, rather than stacking with it',
  typedFirst.chains[0].netted === 0 && typedRow.onHand === chained.chains[0].needed &&
  !typedRow.notes.some((n) => n.kind === 'netted'),
  JSON.stringify({ netted: typedFirst.chains[0].netted, onHand: typedRow.onHand }));

// `Priced as X` is suppressed where the row's Category already says X. Today
// that is EVERY case it can produce — TIER_PROXY holds one entry, Ultra Rare
// -> Ultra Rare — but the suppression is keyed on the value rather than on the
// note being deleted, so a future proxy naming something else still discloses.
check('TIER_PROXY still maps only Ultra Rare onto itself — the premise of the above',
  Object.entries(TIER_PROXY).length === 1 && TIER_PROXY['Ultra Rare'] === 'Ultra Rare',
  JSON.stringify(TIER_PROXY));
check('"Priced as X" never repeats the row\'s own Category',
  !many.all.some((r) => r.notes.some((n) => n.kind === 'pricedAs' && n.good === r.category)),
  many.all.filter((r) => r.notes.some((n) => n.kind === 'pricedAs'))
    .map((r) => `${r.displayName} [${r.category}]`).join(', ') || '(none survive)');

// The closed note vocabulary, in its fixed order.
const ORDER = ['adjusted', 'sourceFor', 'netted', 'for', 'pricedAs', 'spare', 'outOfPrint'];
const orderOK = many.all.every((r) => {
  const idx = r.notes.map((n) => ORDER.indexOf(n.kind));
  return idx.every((v) => v >= 0) && idx.every((v, i) => i === 0 || idx[i - 1] <= v);
});
check('notes come from the closed vocabulary, always in its fixed order', orderOK,
  many.all.find((r) => r.notes.length > 1)?.notes.map((n) => n.kind).join(' -> '));

// D6: the final list has its own order.
check('D6 — every trade good sorts first, alphabetically, with the Trade rungs intermixed',
  many.all.slice(0, many.trade.length).every((r) => r.section === 'trade') &&
  many.all.slice(many.trade.length).every((r) => r.section === 'additional') &&
  new Set(many.trade.map((r) => r.category)).size > 1,
  many.trade.map((r) => `${r.category} ${r.displayName}`).join(' | '));

// D7: one global Wish Ring toggle, and it has to actually move money.
const ring = buildShoppingList(all2026, engine, { path: 'ring' });
const gp = buildShoppingList(all2026, engine, { path: 'gp' });
check('D7 — the Wish Ring / GP toggle changes the list and drops the ring rows',
  ring.totals.grandAvg !== gp.totals.grandAvg &&
  ring.all.some((r) => r.good === 'Wish Ring') && !gp.all.some((r) => r.good === 'Wish Ring'),
  `ring ${money(ring.totals.grandAvg)} vs gp ${money(gp.totals.grandAvg)}`);

// Totals must be the parts, or the headline figure is its own third opinion.
check('the grand total is exactly the two subtotals',
  near(many.totals.grandAvg, many.totals.tradeAvg + many.totals.additionalAvg, 0.01),
  `${money(many.totals.tradeAvg)} + ${money(many.totals.additionalAvg)} vs ${money(many.totals.grandAvg)}`);

// =========================================================================
console.log('\n=== 6. the staleness flag (D1b) ===');

const stale = goods.map((g) => ({ g, s: stalenessOf(g, engine) })).filter((x) => x.s);
check('threshold is 35%', STALE_THRESHOLD === 0.35, STALE_THRESHOLD);
check('exactly two goods are flagged in season ' + L + ': Elven Bismuth and Oil of Enchantment',
  stale.length === 2 && stale.map((x) => x.g).sort().join(', ') === 'Elven Bismuth, Oil of Enchantment',
  stale.map((x) => `${x.g} ${money(x.s.seasonAvg)} -> ${money(x.s.recentAvg)} (${(x.s.divergence * 100).toFixed(0)}%)`).join('\n'));
check('both are UNDERSTATED by their season average, so the default under-quotes them',
  stale.every((x) => x.s.divergence > 0),
  stale.map((x) => `${x.g} ${(x.s.divergence * 100).toFixed(0)}%`).join(', '));

// The threshold is derived, so pin the derivation: the two populations are far
// enough apart that the exact cutoff does not decide the answer. If a future
// season narrows that gap, this fails and the number gets re-derived.
const divergences = new Map();
for (const g of goods) {
  const full = prices.leafPrice(g, L, 'full'), recent = prices.leafPrice(g, L, 'last5');
  if (!full || !recent || full.source !== 'auction' || recent.variant !== 'last5') continue;
  divergences.set(g, Math.abs(recent.stats.avg / full.stats.avg - 1));
}
const flaggedAt = (c) => [...divergences].filter(([, d]) => d >= c).map(([g]) => g).sort().join(',');
check('any cutoff from 20% to 50% flags the same two goods — the number is not load-bearing',
  [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].every((c) => flaggedAt(c) === flaggedAt(0.35)),
  [0.2, 0.3, 0.4, 0.5].map((c) => `${c}: ${flaggedAt(c)}`).join('\n'));
check('...because ordinary goods sit at most 17% out while the flagged pair are 56% and 100%',
  Math.max(...[...divergences].filter(([g]) => !stale.some((s) => s.g === g)).map(([, d]) => d)) < 0.2 &&
  Math.min(...stale.map((x) => Math.abs(x.s.divergence))) > 0.5,
  [...divergences].map(([g, d]) => `${g} ${(d * 100).toFixed(0)}%`).join(', '));

check('a good with no auction rows cannot be flagged rather than being flagged wrongly',
  stalenessOf('Golden Fleece', engine) === null, stalenessOf('Golden Fleece', engine));

// =========================================================================
console.log('\n=== 7. the recent-prices toggle still reaches every branch ===');

const recentCosts = recipes.map((r) => engineRecent.cost(r.transmute, r.year)).filter(Boolean);
const recentTrade = recentCosts.flatMap((c) => c.lines).filter((l) => isTradeCategory(l.category));
check('the last-5 toggle moves trade goods on expired recipes too, not just active ones',
  recentTrade.some((l) => l.variant === 'last5'),
  `${recentTrade.filter((l) => l.variant === 'last5').length} of ${recentTrade.length} on last5`);
check('and no line loses its price under the toggle',
  recentCosts.flatMap((c) => c.lines).every((l) => l.unitAvg !== null));

// =========================================================================
console.log('\n=== 8. the pricing basis ===');

const era = new CostEngine(recipes, prices, { today: TODAY, basis: 'era' });
const eraCosts = recipes.map((r) => era.cost(r.transmute, r.year)).filter(Boolean);
const eraLines = eraCosts.flatMap((c) => c.lines.map((l) => ({ c, l })));
const eraByKey = new Map(eraCosts.map((c) => [c.key, c]));

check("'today' is the engine default — the Shopping List and calculator never have to ask",
  new CostEngine(recipes, prices, { today: TODAY }).cost('Deathward Greaves', 2026).basis === 'today');
check('a cost carries the basis it was computed on, so a view can state it in prose',
  eraByKey.get('2026|Deathward Greaves').basis === 'era');

// The point of 'era': the Recipes view's historical section keeps answering
// "what did this cost when it was craftable".
const eraExpiredTrade = eraLines.filter(({ c, l }) => c.status === 'expired' && isTradeCategory(l.category));
// 469 of the 611 land on the window itself. The other 142 belong to the 12
// pre-2018 recipes, whose windows (2012-01-01 .. 2013-11-24 and friends) hold
// no auctions at all, so they fall back to the season path — documented
// behaviour, and the reason this asserts "not the current season" rather than
// "windowed", which would have been the tidier claim and the wrong one.
check("under 'era' NO expired trade good is priced from the current season",
  eraExpiredTrade.length === 611 && eraExpiredTrade.every(({ l }) => l.pricedYear !== L),
  `${eraExpiredTrade.filter(({ l }) => l.pricedYear === L).length} of ${eraExpiredTrade.length} still on ${L}`);
check("...469 of them over the build window, the rest on the pre-2018 fallback",
  eraExpiredTrade.filter(({ l }) => l.basis === 'window').length === 469,
  eraExpiredTrade.filter(({ l }) => l.basis === 'window').length);
check("...and under 'today' every one of the 611 IS on the current season",
  expiredTrade.every(({ l }) => l.basis !== 'window' && l.pricedYear === L));

// The 2027 preview keeps its forward last-5 estimate under 'era' (consequence
// B), which needs S2 gated as well as S1 — 8 of the 12 future recipes' Ultra
// Rare lines are in-print 2027s and would otherwise take S2.
const eraFuture = eraCosts.filter((c) => c.status === 'future');
const nowFuture = costs.filter((c) => c.status === 'future');
const total = (cs) => cs.reduce((t, c) => t + c.fullAvg, 0);
check("under 'era' the 2027 preview keeps its forward last-5 estimate",
  eraFuture.flatMap((c) => c.lines).some((l) => l.variant === 'last5') &&
  !nowFuture.flatMap((c) => c.lines).some((l) => l.variant === 'last5'),
  `era ${eraFuture.flatMap((c) => c.lines).filter((l) => l.variant === 'last5').length} last5 lines, ` +
  `today ${nowFuture.flatMap((c) => c.lines).filter((l) => l.variant === 'last5').length}`);
check("...so the two bases really do disagree about it",
  Math.abs(total(eraFuture) - total(nowFuture)) > 500,
  `era ${money(total(eraFuture))} vs today ${money(total(nowFuture))}`);

// How far the basis actually REACHES. An active recipe's own trade goods are
// identical either way — D3 already floats them to today — but its TOTAL can
// still move, and pinning the mechanism matters because the tempting summary
// ("the control only touches expired recipes") is false.
const activeTrade = costs.filter((c) => c.status === 'active')
  .flatMap((c) => c.lines.map((l, i) => ({ l, e: eraByKey.get(c.key).lines[i] })))
  .filter(({ l }) => isTradeCategory(l.category));
check("an ACTIVE recipe's own trade goods are identical under both bases — all 1,014",
  activeTrade.length === 1014 && activeTrade.every(({ l, e }) => l.unitAvg === e.unitAvg),
  `${activeTrade.filter(({ l, e }) => l.unitAvg !== e.unitAvg).length} of ${activeTrade.length} differ`);

const activeDiff = costs.filter((c) => c.status === 'active')
  .filter((c) => !near(c.fullAvg, eraByKey.get(c.key).fullAvg, 0.005));
const activeLineDiff = costs.filter((c) => c.status === 'active')
  .flatMap((c) => c.lines.map((l, i) => ({ l, e: eraByKey.get(c.key).lines[i] })))
  .filter(({ l, e }) => l.unitAvg !== e.unitAvg);
check('...but 49 of the 91 still move, through an expired SUB-RECIPE or an in-print Ultra Rare',
  activeDiff.length === 49 &&
  activeLineDiff.filter(({ l }) => l.source === 'build').length === 42 &&
  activeLineDiff.filter(({ l }) => l.source !== 'build').length === 13,
  `${activeDiff.length} recipes; ${activeLineDiff.filter(({ l }) => l.source === 'build').length} sub-builds, ` +
  `${activeLineDiff.filter(({ l }) => l.source !== 'build').length} leaf lines`);
check('...and every one of those leaf lines is an in-print Ultra Rare, which is S2 answering to the basis',
  activeLineDiff.filter(({ l }) => l.source !== 'build')
    .every(({ l }) => isUR(l) && l.nominalYear >= L - 1),
  activeLineDiff.filter(({ l }) => l.source !== 'build').slice(0, 4)
    .map(({ l, e }) => `${l.good} ${l.nominalYear}: ${money(l.unitAvg)} vs ${money(e.unitAvg)}`).join('\n'));

// The basis is NOT the year pin. Pinning the latest season quotes it for
// tokens that season never sold; 'today' moves only what is purchasable.
const pinLatest = new CostEngine(recipes, prices, { today: TODAY, priceYear: L });
let pinDiff = 0, pinDiffUR = 0;
for (const c of costs) {
  const p = pinLatest.cost(c.transmute, c.year);
  c.lines.forEach((l, i) => {
    if (l.unitAvg === p.lines[i].unitAvg) return;
    pinDiff++;
    if (isUR(l)) pinDiffUR++;
  });
}
check(`"today's prices" is NOT "${L} prices" — they differ on 150 lines, 90 of them Ultra Rares`,
  pinDiff === 150 && pinDiffUR === 90, `${pinDiff} lines, ${pinDiffUR} Ultra Rare`);
check('...and the difference is the right way round: the pin under-quotes what you cannot buy',
  costs.flatMap((c) => c.lines.map((l, i) => ({ l, p: pinLatest.cost(c.transmute, c.year).lines[i] })))
    .filter(({ l, p }) => isUR(l) && l.unitAvg !== p.unitAvg)
    .every(({ l, p }) => p.unitAvg < l.unitAvg));

// Neither basis may cost a line its price.
check('no line loses its price under either basis',
  eraLines.every(({ l }) => l.unitAvg !== null) && allLines.every(({ l }) => l.unitAvg !== null));

// =========================================================================
console.log('\n=== 9. the wording the tables and the CSV share ===');

const m = (n) => `$${n.toFixed(2)}`;
check('every note in the closed vocabulary renders, and none renders as undefined',
  [
    [{ kind: 'adjusted' }, 'Price adjusted'],
    [{ kind: 'sourceFor', transmute: 'Charm of Fate', qty: 2 }, 'Source for Charm of Fate ×2'],
    [{ kind: 'for', transmute: 'Omni Cube', qty: 3 }, 'For Omni Cube ×3'],
    [{ kind: 'pricedAs', good: 'Ultra Rare' }, 'Priced as Ultra Rare'],
    [{ kind: 'spare', qty: 5 }, '5 spare'],
    [{ kind: 'outOfPrint', years: [2022, 2023] }, 'Out of print'],
  ].every(([n, want]) => noteLabel(n) === want),
  [{ kind: 'adjusted' }, { kind: 'spare', qty: 5 }].map(noteLabel).join(' | '));

// The flag states a fact and stops. It must not acquire a direction: trade-good
// prices do not follow a reliable seasonal shape, so anything forward-looking
// here would be read as a forecast the data cannot support.
const bismuth = stalenessOf('Elven Bismuth', engine);
check('the staleness sentence names both measured numbers and predicts nothing',
  /^season avg \$[\d.,]+ · recent sales \$[\d.,]+ — this one is moving$/.test(stalenessNote(bismuth, m)),
  stalenessNote(bismuth, m));

// Every note a real list produces must come from the vocabulary — the tables
// join these with " · " and the CSV puts them in one cell, so an unrendered
// kind would show as "undefined" in both.
const everyNote = many.all.flatMap((r) => r.notes);
check(`all ${everyNote.length} notes on a ${all2026.length}-recipe list render to real text`,
  everyNote.length > 0 && everyNote.every((n) => typeof noteLabel(n) === 'string' && noteLabel(n).length > 0),
  everyNote.filter((n) => !noteLabel(n)).map((n) => n.kind).join(', '));

// D5's arithmetic, which the offer's button label quotes.
check('a netted chain removes exactly what is being crafted, and no more',
  chained.chains.every((c) => {
    const before = chained.all.find((r) => r.id === c.rowId);
    const after = netted.all.find((r) => r.id === c.rowId);
    return before.need - after.need === Math.min(c.crafted, before.need);
  }),
  JSON.stringify(chained.chains));

// =========================================================================
console.log('\n=== 10. Copy as TSV and Download CSV ===');

const exported = buildShoppingList(all2026, engine, {
  onHand: { [many.trade[0].id]: 3 },
  overrides: { [many.trade[1].id]: 9.99 },
});
const csv = toCSV(exported), tsv = toTSV(exported), grid = toRows(exported);
const sheet = toSheet(exported);
// Where the table starts inside the sheet: the "Making" heading, one row per
// transmute, and the blank row that separates the preamble from the header.
const TABLE_AT = exported.making.length + 2;

check('the TABLE is one header row plus one row per list row',
  grid.length === exported.all.length + 1 &&
  grid[0].join('|') === [...EXPORT_COLUMNS].join('|'),
  `${grid.length} rows, header ${grid[0].join('|')}`);

check('every table row has exactly as many cells as there are columns',
  grid.every((r) => r.length === EXPORT_COLUMNS.length),
  grid.filter((r) => r.length !== EXPORT_COLUMNS.length).length);

// The sheet leads with what the plan is FOR. Above the header, deliberately:
// a file of forty trade goods says nothing about what any of them is for.
check('the sheet opens with the plan, then a blank row, then the table',
  sheet[0][0] === 'Making' &&
  sheet.slice(1, TABLE_AT - 1).every((r, i) =>
    r.length === 2 && r[0] === exported.making[i].displayName && r[1] === String(exported.making[i].qty)) &&
  sheet[TABLE_AT - 1].length === 0 &&
  sheet[TABLE_AT].join('|') === [...EXPORT_COLUMNS].join('|'),
  JSON.stringify(sheet.slice(0, 3)));

check('both writers emit that same sheet, line for line',
  csv.trimEnd().split('\r\n').length === sheet.length &&
  tsv.split('\n').length === sheet.length,
  `${sheet.length} sheet, ${csv.trimEnd().split('\r\n').length} csv, ${tsv.split('\n').length} tsv`);

// A list with nothing active has no preamble to write — an orphan "Making"
// heading over an empty run would be worse than none.
check('...and a list with every recipe paused writes the table alone',
  toSheet(buildShoppingList([pick('2026|Deathward Greaves', 0)], engine))[0].join('|') ===
    [...EXPORT_COLUMNS].join('|'));

// The one name in the corpus with a comma in it. An unquoted writer shifts
// every column after it on that row, silently.
const goldRow = exported.all.find((r) => r.good === '1,000 GP Gold Bar');
check('the ONE name containing a comma is quoted in the CSV, so its row keeps its columns',
  goldRow !== undefined && csv.includes('"1,000 GP Gold Bar"'),
  csv.split('\r\n').find((l) => l.includes('GP Gold Bar')));
check('...and every CSV data row still parses to the right number of cells',
  csv.trimEnd().split('\r\n').slice(TABLE_AT).every((line) => {
    let cells = 1, inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (inQ && line[i + 1] === '"') i++; else inQ = !inQ; }
      else if (c === ',' && !inQ) cells++;
    }
    return cells === EXPORT_COLUMNS.length;
  }),
  csv.trimEnd().split('\r\n').slice(0, 3).join('\n'));

// Excel reads a cell starting with + - = @ as a formula. 33 display names in
// this corpus start with `+`.
const plusNames = exported.all.filter((r) => /^[+\-=@]/.test(r.displayName));
check('names beginning with a formula character are guarded on the COPY path',
  plusNames.length === 0 || plusNames.every((r) => tsv.includes(`'${r.displayName}\t`)),
  `${plusNames.length} such rows; ` + plusNames.slice(0, 3).map((r) => r.displayName).join(', '));
check('...and are NOT apostrophe-prefixed in the CSV, where quoting is the format\'s own answer',
  plusNames.every((r) => !csv.includes(`'${r.displayName}`)),
  plusNames.slice(0, 3).map((r) => r.displayName).join(', '));
check('guardFormula covers all four characters, and leaves ordinary text alone',
  guardFormula('+3 Mithral Bracers') === "'+3 Mithral Bracers" &&
  guardFormula('-1') === "'-1" && guardFormula('=SUM(A1)') === "'=SUM(A1)" &&
  guardFormula('@x') === "'@x" && guardFormula("Alchemist's Ink") === "Alchemist's Ink",
  guardFormula('+3 Mithral Bracers'));

// A shopping list you cannot sum is not worth exporting.
const priceCol = EXPORT_COLUMNS.indexOf('$ each'), costCol = EXPORT_COLUMNS.indexOf('Cost');
check('prices and costs export as plain NUMBERS, not as "$44.08"',
  grid.slice(1).every((r) => (r[priceCol] === '' || /^\d+\.\d{2}$/.test(r[priceCol])) &&
                             (r[costCol] === '' || /^\d+\.\d{2}$/.test(r[costCol]))),
  grid.slice(1, 4).map((r) => `${r[priceCol]} | ${r[costCol]}`).join('\n'));

// No cell may contain the delimiter of its own format unescaped.
check('no TSV cell contains a raw tab or newline',
  sheet.every((r) => r.every((c) => !/[\t\r\n]/.test(c))) &&
  tsv.split('\n').slice(TABLE_AT).every((line) => line.split('\t').length === EXPORT_COLUMNS.length),
  tsv.split('\n').slice(TABLE_AT).find((l) => l.split('\t').length !== EXPORT_COLUMNS.length));

// The export must carry the state the reader typed, or it is a export of a
// different list from the one on screen.
const onHandCol = EXPORT_COLUMNS.indexOf('On hand');
check('what the reader typed reaches the file — the on-hand count and the corrected price',
  grid.slice(1).some((r) => r[onHandCol] === '3') &&
  grid.slice(1).some((r) => r[priceCol] === '9.99'),
  grid.slice(1).filter((r) => r[onHandCol] !== '0').map((r) => r.join(' | ')).slice(0, 2).join('\n'));

// The Flags column is a NARROW replacement for Notes, not a shorter one: two
// values, both of which change what you should buy rather than explaining why
// a row is on the list.
const flagCol = EXPORT_COLUMNS.indexOf('Flags');
const flagged = grid.slice(1).map((r, i) => ({ row: exported.all[i], flags: r[flagCol] }));
check('Flags carries exactly the two purchase-changing facts, and nothing else',
  flagged.every(({ row, flags }) => {
    const want = [
      ...(row.outOfPrint && row.nominalYear !== null ? ['Out of print'] : []),
      ...(row.staleness ? ['Price moving'] : []),
    ].join(' · ');
    return flags === want;
  }),
  flagged.filter((f) => f.flags).map((f) => `${f.row.displayName}: ${f.flags}`).join(', '));
check('...and both of them actually occur in this corpus, or the check above proves nothing',
  flagged.some((f) => f.flags.includes('Out of print')) &&
  flagged.some((f) => f.flags.includes('Price moving')),
  flagged.filter((f) => f.flags).length + ' flagged rows');
// Staleness is only measured on trade goods; out-of-print is only tagged on
// Ultra Rares, which are never trade goods. So the Flags cell holds at most
// one value today, and the file holds no `·` at all — pinned because the
// separator's first real use should be a visible change rather than a
// surprise, and because it is what leaves the CSV pure ASCII.
check('the two flags are mutually exclusive by construction, so no cell joins them',
  exported.all.every((r) => !(r.staleness && r.outOfPrint)) &&
  flagged.every((f) => !f.flags.includes(' · ')),
  flagged.filter((f) => f.flags.includes(' · ')).map((f) => f.row.displayName).join(', '));
check('the per-recipe breakdown does NOT go to the file — it is the wall the column dropped',
  !csv.includes('For ') && !tsv.includes('Source for '),
  csv.split('\r\n').find((l) => l.includes('For ')));

// Excel opens a .csv in the system codepage, so the FILE needs a BOM or its
// UTF-8 arrives as Windows-1252: `x` as `A-`, `.` as `A.`, `--` as `a€"`.
check('the downloaded file leads with a UTF-8 BOM; toCSV itself does not',
  csvFile(exported).charCodeAt(0) === 0xfeff && csv.charCodeAt(0) !== 0xfeff &&
  csvFile(exported).slice(1) === csv,
  `csvFile starts 0x${csvFile(exported).charCodeAt(0).toString(16)}, toCSV 0x${csv.charCodeAt(0).toString(16)}`);
check('...and the clipboard does NOT get one — it carries text, not bytes',
  tsv.charCodeAt(0) !== 0xfeff && !tsv.includes('﻿'), tsv.charCodeAt(0));

check('the filename is dated so two exports in a season do not collide',
  exportFilename('csv', new Date('2026-08-31T12:00:00Z')) === 'td-shopping-list-2026-08-31.csv',
  exportFilename('csv', new Date('2026-08-31T12:00:00Z')));

// =========================================================================
console.log('\n=== 11. the 10x lot hint ===');

// Trade 1 tokens sell mostly as 10x bundles, so the "buy" count is not a number
// you can actually ask for. 8 of the 14 goods bundle; Trade 2-4 do not.
const lotRows = many.trade.filter((r) => lotHintFor(r) !== null);
check('the hint fires on the 8 Trade 1 goods and on nothing else',
  lotRows.length === 8 && lotRows.every((r) => r.category === 'Trade 1') &&
  many.trade.filter((r) => r.category !== 'Trade 1').every((r) => lotHintFor(r) === null),
  lotRows.map((r) => `${r.good} (${r.category})`).join(', '));

check('it rounds UP to whole lots and reports the overshoot',
  lotRows.every((r) => {
    const h = lotHintFor(r);
    return h.lots === Math.ceil(r.need / LOT_SIZE) && h.tokens === h.lots * LOT_SIZE &&
      h.over === h.tokens - r.need && h.over >= 0 && h.over < LOT_SIZE;
  }),
  lotRows.slice(0, 3).map((r) => { const h = lotHintFor(r); return `need ${r.need} -> ${h.lots} lots (${h.tokens}), ${h.over} over`; }).join('\n'));

// It is a HINT. Rounding fourteen goods up to lots would inflate a small plan
// by a third, and would be wrong for anyone buying singles.
const oneRecipe = buildShoppingList([pick('2026|Deathward Greaves', 1)], engine);
const lotted = oneRecipe.trade.reduce((t, r) => {
  const h = lotHintFor(r);
  return t + (h && r.unitAvg !== null ? h.tokens * r.unitAvg : (r.extAvg ?? 0));
}, 0);
check('...and it never moves a total — the list still costs what the singles cost',
  oneRecipe.totals.tradeAvg < lotted && lotHintFor(oneRecipe.trade[0]) !== undefined,
  `as listed ${money(oneRecipe.totals.tradeAvg)}, if rounded to lots ${money(lotted)}`);

check('a covered row gets no hint — there is nothing left to buy',
  bigStash.all.every((r) => lotHintFor(r) === null),
  bigStash.all.filter((r) => lotHintFor(r)).length);

// =========================================================================
console.log('\n=== 12. localStorage: the contents are DATA, not state ===');

// Nothing here touches a real browser; loadShopping is exercised through a
// stand-in Storage so the validation can be driven with values a person could
// have hand-edited into devtools.
const fakeStore = (initial) => {
  let held = initial;
  return {
    getItem: () => held,
    setItem: (_k, v) => { held = v; },
    removeItem: () => { held = null; },
    get value() { return held; },
  };
};
const withStore = (raw, fn) => {
  const g = globalThis;
  const had = 'window' in g ? g.window : undefined;
  const s = fakeStore(raw);
  g.window = { localStorage: s };
  try { return fn(s); } finally { if (had === undefined) delete g.window; else g.window = had; }
};

check('a round trip preserves the plan exactly',
  withStore(null, (s) => {
    saveShopping({ picks: [{ key: '2026|X', qty: 2 }], onHand: { 'T|Ink': 3 }, overrides: { 'T|Ink': 9.5 }, netCrafted: true });
    const back = loadShopping();
    return back.picks.length === 1 && back.picks[0].qty === 2 &&
      back.onHand['T|Ink'] === 3 && back.overrides['T|Ink'] === 9.5 && back.netCrafted === true &&
      typeof s.value === 'string';
  }));

check('storage that THROWS on access is survived, not crashed on',
  (() => {
    const g = globalThis; const had = 'window' in g ? g.window : undefined;
    g.window = { get localStorage() { throw new Error('blocked'); } };
    try {
      const r = loadShopping();
      saveShopping({ picks: [], onHand: {}, overrides: {}, netCrafted: false });
      clearShopping();
      return r === null;
    } finally { if (had === undefined) delete g.window; else g.window = had; }
  })(),
  'a private window raises on the property access itself, not on getItem');

check('corrupt JSON loads as nothing rather than throwing',
  withStore('{not json', () => loadShopping() === null));
check('a non-object payload loads as nothing', withStore('42', () => loadShopping() === null));
check('an empty slot loads as nothing', withStore(null, () => loadShopping() === null));

// Every field is re-validated: this survives deploys and is hand-editable.
const junk = JSON.stringify({
  picks: [
    { key: '2026|Good', qty: 2 },
    { key: '', qty: 1 },                 // no key
    { key: '2026|Bad', qty: -3 },        // negative
    { key: '2026|Frac', qty: 2.7 },      // fractional — would show as $12.3456
    { qty: 1 },                          // no key at all
    null, 'nope', 5,
  ],
  onHand: { 'T|Ink': 3, 'T|Bad': -1, 'T|NaN': 'x', '': 9 },
  overrides: { 'T|Ink': 9.5, 'T|Inf': Infinity },
  netCrafted: 'yes',                     // not a boolean
});
const cleaned = withStore(junk, () => loadShopping());
check('malformed picks are DROPPED, not repaired, and a fractional quantity is floored',
  cleaned.picks.length === 2 &&
  cleaned.picks[0].key === '2026|Good' && cleaned.picks[0].qty === 2 &&
  cleaned.picks[1].key === '2026|Frac' && cleaned.picks[1].qty === 2,
  JSON.stringify(cleaned.picks));
check('negative, non-numeric and unkeyed entries never reach the page',
  Object.keys(cleaned.onHand).length === 1 && cleaned.onHand['T|Ink'] === 3 &&
  Object.keys(cleaned.overrides).length === 1 && cleaned.overrides['T|Ink'] === 9.5,
  JSON.stringify({ onHand: cleaned.onHand, overrides: cleaned.overrides }));
check('netCrafted is only true when it is literally true',
  cleaned.netCrafted === false, cleaned.netCrafted);
check('Infinity does not survive JSON and does not survive validation either',
  cleaned.overrides['T|Inf'] === undefined);

// A row id that no longer matches anything is KEPT on purpose: that is what
// lets an on-hand count survive a recipe being removed and added back (D2).
check('an unknown row id is kept rather than pruned — D2 depends on it',
  withStore(JSON.stringify({ picks: [], onHand: { 'T|Gone': 7 }, overrides: {}, netCrafted: false }),
    () => loadShopping().onHand['T|Gone'] === 7));

rmSync(work, { recursive: true, force: true });
console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — shoppingList: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
