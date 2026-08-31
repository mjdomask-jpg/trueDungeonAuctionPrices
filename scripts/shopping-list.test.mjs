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
  };
} catch (e) {
  console.error('could not load src/lib:', e.message);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}

const { parseSales, parseMeta } = lib.data;
const {
  PriceIndex, CostEngine, parseRecipes, parseTokenMetadata, parseOffAuctionPrices,
  parseDerivedRules, isTradeCategory,
} = lib.transmutes;
const { buildShoppingList, mergeKey, stalenessOf, STALE_THRESHOLD } = lib.shoppingList;

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

// The closed note vocabulary, in its fixed order.
const ORDER = ['adjusted', 'sourceFor', 'for', 'pricedAs', 'spare', 'outOfPrint'];
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

rmSync(work, { recursive: true, force: true });
console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — shoppingList: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
