// Tests for apps-script/forumThread.gs — Phase 5 (part two) of
// data-pipeline-plan.md.
//
// Part one reads a file an auctioneer hands over. This reads the thread, which
// is prose, and the only honest way to test a prose parser is to replay real
// prose: 24 threads spanning 20 auctioneers, scored against what the sheet
// actually recorded for those auctions.
//
// What is asserted, and why each number is the number it is:
//
//   1. POST EXTRACTION — every fixture yields posts, with agreeing counts of
//      bodies and timestamps. A page shape change breaks this first, loudly,
//      before it can quietly change a price.
//   2. THE PRICING RULE — quantity-weighted mode reproduces `prices.csv` far
//      better than Trent's min/max does. The margin is the assertion; the exact
//      counts are pinned so a regression shows as a number, not a feeling.
//   3. TIES ARE FLAGGED, NEVER SILENTLY BROKEN. §4 of the plan calls ties-low
//      settled. Measured over this corpus it is 8 low / 5 high / 1 midpoint, so
//      the assistant flags them. The test pins that a tie sets `tie`.
//   4. THE `Buy It Out` TRAP — AlanP's table is
//      `item name | Buy It Out | Bid | Bidder/Buyer Name`, and the money-
//      formatted column is not the price. Reading the header reproduces 14 of
//      202632's 16 matched items; reading the formatting reproduces 6.
//   5. OFF-ORDER LOTS — kurtreznor's `NON-8K STUFF` items are contextItems
//      candidates, and the heading SCOPES: they go to context whatever their
//      names resolve to, so a personal sale of a current-season token can never
//      reach the price spine. They used to be discarded on the reasoning that
//      20222 recorded none of them, which read intent from an unbackfilled
//      season.
//   6. THE UNREAD-LINES REPORT is non-empty where it should be and small.
//
// Run: node scripts/forum-thread.test.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const threadDir = join(here, '..', 'fixtures', 'forum-threads');
const openDir = join(here, '..', 'fixtures', 'auction-open');

// --- load all four scripts into ONE sandbox ---------------------------------
// Apps Script gives every .gs file in a project one shared global scope, and
// forumThread.gs is written to call trentClose.gs's resolver, forumClose.gs's
// target picker and auctionOpen.gs's fetch and entity decoder directly. Loading
// them together is what the real runtime does.
const sandbox = { module: { exports: {} }, console };
for (const file of ['trentClose.gs', 'forumClose.gs', 'auctionOpen.gs', 'forumThread.gs']) {
  sandbox.module = { exports: {} };
  runInNewContext(readFileSync(join(here, '..', 'apps-script', file), 'utf8'), sandbox);
  if (file === 'trentClose.gs') var T = sandbox.module.exports;
  if (file === 'forumThread.gs') var TH = sandbox.module.exports;
}

// --- CSV --------------------------------------------------------------------
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
function objects(path) {
  const rows = parseCSV(readFileSync(path, 'utf8'));
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length >= header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
const money = (v) => Number(String(v).replace(/[$,]/g, ''));

const meta = objects(join(dataDir, 'auctionMetadata.csv'));
const priceRows = objects(join(dataDir, 'prices.csv'));
const tokenRows = objects(join(dataDir, 'tokenMetadata.csv'));

const manifest = JSON.parse(readFileSync(join(threadDir, 'manifest.json'), 'utf8'));

// --- assertions -------------------------------------------------------------
let passed = 0;
const failures = [];
function ok(condition, what) {
  if (condition) { passed++; return true; }
  failures.push(what);
  return false;
}
function eq(actual, expected, what) {
  return ok(actual === expected, `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- fixtures ---------------------------------------------------------------
// Page 1 of five threads already lives in fixtures/auction-open — Phase 4
// fetched them to read open dates off the same markup. They are referenced
// rather than copied so a re-fetch cannot leave two versions of one page in
// the repo disagreeing with each other.
function pagesFor(topicId) {
  const first = existsSync(join(threadDir, `topic-${topicId}.html.gz`))
    ? join(threadDir, `topic-${topicId}.html.gz`)
    : join(openDir, `topic-${topicId}.html.gz`);
  if (!existsSync(first)) throw new Error(`no page 1 fixture for topic ${topicId}`);
  const rest = readdirSync(threadDir)
    .map((f) => f.match(new RegExp(`^topic-${topicId}-start(\\d+)\\.html\\.gz$`)))
    .filter(Boolean)
    .map((m) => ({ start: Number(m[1]), file: join(threadDir, m[0]) }))
    .sort((a, b) => a.start - b.start);
  return [first, ...rest.map((r) => r.file)].map((f) => gunzipSync(readFileSync(f)).toString('utf8'));
}

// ===========================================================================
console.log('\n=== 1. post extraction ===');
// ===========================================================================
let totalPosts = 0;
for (const t of manifest.threads) {
  const pages = pagesFor(t.topic);
  eq(pages.length, t.pages, `${t.auction} ${t.auctioneer}: page count`);
  let posts = 0;
  for (let i = 0; i < pages.length; i++) {
    const problems = TH.threadPageProblems(pages[i]);
    ok(problems.length === 0, `${t.auction} page ${i + 1}: ${problems.join('; ')}`);
    posts += TH.threadPosts(pages[i]).length;
  }
  ok(posts > 0, `${t.auction}: no posts read`);
  totalPosts += posts;
}
console.log(`  ✓ ${manifest.threads.length} threads, ${totalPosts} posts, every page's bodies and timestamps agree`);

// The stamp parser, on the two forms the corpus contains.
eq(TH.threadPostStamp('07 Aug 2026 19:46').date, '2026-08-07', 'stamp: date');
eq(TH.threadPostStamp('07 Aug 2026 19:46').time, '19:46', 'stamp: time');
eq(TH.threadPostStamp('3 Oct 2022 22:04').date, '2022-10-03', 'stamp: single-digit day');
eq(TH.threadPostStamp('nonsense').date, null, 'stamp: unreadable is null, not a wrong date');

// ===========================================================================
console.log('\n=== 2. the grammars ===');
// ===========================================================================
// One example of each of the ten shapes, taken verbatim from the corpus.
const GRAMMAR_CASES = [
  ['16 @ $7.50 - Bidder #4', 'qty-at-price', { quantity: 16, price: 7.5 }],
  ['#1-3 : Lich - $100', 'lot-range', { quantity: 3, price: 100 }],
  ['(3) Lanfear====@ $105 each', 'qty-buyer-rule', { quantity: 3, price: 105 }],
  ['Mark of the 1st Tenet (1) - Gortash $85', 'item-qty-buyer-price', { quantity: 1, price: 85 }],
  ['Wish Ring (1) - $175.00 Abert', 'item-qty-price', { quantity: 1, price: 175 }],
  ['10x $25 - Miriam Dom', 'xqty-price-buyer', { quantity: 10, price: 25 }],
  ['2 $5.00 - Ptah', 'qty-price-buyer', { quantity: 2, price: 5 }],
  ['x35 @ $12.25 Tarantella Serpentine', 'xqty-at-price', { quantity: 35, price: 12.25 }],
  ['$0.50 - Florin', 'price-buyer', { quantity: 1, price: 0.5 }],
  ['- Anton (1) $780', 'buyer-qty-price', { quantity: 1, price: 780 }],
  ["Orion's Belt (1) 150 Chronos", 'item-qty-bare-price', { quantity: 1, price: 150 }],
];
for (const [line, rule, expect] of GRAMMAR_CASES) {
  const lot = TH.threadRuleLot(line);
  if (!ok(lot, `no grammar read ${JSON.stringify(line)}`)) continue;
  eq(lot.rule, rule, `${JSON.stringify(line)}: rule`);
  eq(lot.quantity, expect.quantity, `${JSON.stringify(line)}: quantity`);
  eq(lot.price, expect.price, `${JSON.stringify(line)}: price`);
}
console.log(`  ✓ all ${GRAMMAR_CASES.length} line grammars read their measured example`);

// A rules paragraph must not be mistaken for a lot, and must not become a header.
for (const prose of [
  'Shipping on all winning bids is $4 for 10 or fewer tokens',
  'Bid increment on items less than $10: 25 cents',
  'Current Total: $7,500.50 of $7,500.00 (100.01%)',
]) {
  ok(!TH.threadLooksLikeHeader(prose), `prose read as an item header: ${JSON.stringify(prose)}`);
}
console.log('  ✓ rules prose is not mistaken for an item name');

// ===========================================================================
console.log('\n=== 3. the Buy It Out trap ===');
// ===========================================================================
// The header AlanP actually wrote, and the row beneath it.
const alanHeader = TH.threadTableHeader(['item name', 'Buy It Out', 'Bid', 'Bidder/Buyer Name']);
ok(alanHeader && !alanHeader.refuse, 'AlanP header not recognised');
eq(alanHeader.price, 2, 'AlanP header: the price column is `Bid`, not the money-formatted one');
const alanLot = TH.threadTableLot('Mark of the 1st Tenet #3\t$110\t76\tGrasp of Shadow', alanHeader);
eq(alanLot.price, 76, 'AlanP row: price is the winning bid');
eq(alanLot.quantity, 1, 'AlanP row: `#3` is a lot number, not a quantity');

// Without a header the money-formatted cell IS the price — Mike Steele's shape.
const bare = TH.threadTableLot('Path of Enlightenment Fragment 4\t$226.00\tCerebus', null);
eq(bare.price, 226, 'headerless table: the money cell is the price');
eq(bare.item, 'Path of Enlightenment Fragment 4', 'headerless table: the item');

// A table whose only bid column is one that is not a winning bid is refused.
const pivot = TH.threadTableHeader(['Row Labels', 'Minimum Bid', 'Maximum Bid', 'Average Bid']);
ok(pivot && pivot.refuse, 'a pivot over every bid was not refused');
const buyoutOnly = TH.threadTableHeader(['Item', 'Buy It Out', 'Bidder']);
ok(buyoutOnly && buyoutOnly.refuse, 'a table with only a buy-it-out price was not refused');
console.log('  ✓ the header decides the price column; buy-it-out and average-bid tables are refused');

// ===========================================================================
console.log('\n=== 3b. the Condensed bags ===');
// ===========================================================================
// A Condensed order sells a bag of 120 random Rares and a bag of 240 random
// Uncommons. Nine spellings across the eight recorded Condensed auctions, and
// two of them also break the shared quantity rule — see THREAD_BAG_TRIGGER_RE.
const BAG_YES = [
  ['Bag of 120 random Rare tokens (rares only) #1-8', 'Rare Bag'],
  ['Bag of 240 random Uncommon tokens #1-8', 'Uncommon Bag'],
  ['8 x 120 Random Rare bag', 'Rare Bag'],
  ['8 x 240 Random Uncommon bag', 'Uncommon Bag'],
  ['120 Rare 2021 Token Bag', 'Rare Bag'],
  ['240 Uncommon 2021 Token Bag', 'Uncommon Bag'],
  ['Bag of 120x Rare Tokens', 'Rare Bag'],
  ['Bag of 240x Uncommon Tokens', 'Uncommon Bag'],
  ['8 bags of 120 rares (no Urs)', 'Rare Bag'],
  ['8 bags of 240 UC tokens', 'Uncommon Bag'],
  ['120x Random Rare', 'Rare Bag'],
  ['240x Random Uncommon', 'Uncommon Bag'],
];
for (const [name, expected] of BAG_YES) eq(TH.threadBagName(name), expected, `bag: ${JSON.stringify(name)}`);

// Every one of these is a real lot from the same threads, and every one of them
// mentions a tier word. The bag/count TRIGGER is what keeps them out.
const BAG_NO = [
  'Proof set of 2018 Onyx Common/Uncommon/Rare Tokens',
  'Set of 2021 Rare Class Neck Items',
  '2017/18 Ultra Rare of Your Choice #1',
  'PYP Ultra Rare',
  'Onyx - C/UC/R Full Set',
  'Random UR',
  '10x Darkwood Plank',
];
for (const name of BAG_NO) eq(TH.threadBagName(name), null, `not a bag: ${JSON.stringify(name)}`);
console.log(`  ✓ ${BAG_YES.length} bag spellings recognised, ${BAG_NO.length} lookalikes rejected`);

// ===========================================================================
console.log('\n=== 3c. the season vocabulary ===');
// ===========================================================================
// Spellings counted across the 2022 season, resolved through the fallback
// chain — which only ever runs after `resolveToken` has already failed, so
// none of this can change a name that already resolves.
const index2022 = T.buildTokenIndex(tokenRows);
const vocab = (name, season) => {
  const r = TH.threadResolveName(name, season, index2022, TH.threadBagName(name));
  return r ? r.token.Item : null;
};

// THE ONE THAT BITES: two tokens, and one name contains the other.
// `+1 Turkey Leg of Smiting` is the 2k Bonus, `+1 Turkey Leg` the Preorder
// Bonus. A rule that tests "turkey leg" first merges 87 lots of 2022 into one
// price series, and the merged number looks entirely reasonable.
eq(vocab('Turkey Leg of Smiting', '2022'), '2k Bonus', 'bare "Turkey Leg of Smiting" is the 2k Bonus');
eq(vocab('+1 Turkey Leg of Smiting (UR)', '2022'), '2k Bonus', 'the (UR) tier marker is not part of the name');
eq(vocab('+1 Turkey Leg of Smiting (Ultra Rare token)', '2022'), '2k Bonus', 'nor is the spelled-out one');
eq(vocab('Turkey Leg', '2022'), 'Preorder Bonus', 'bare "Turkey Leg" is the Preorder Bonus — a DIFFERENT token');
eq(vocab('+1 Turkey Leg (rare)', '2022'), 'Preorder Bonus', 'the (rare) marker distinguishes it from the UR');
ok(vocab('Turkey Leg of Smiting', '2022') !== vocab('Turkey Leg', '2022'),
  'the two Turkey Legs must not collapse into one token');

// The Patron code is the value, not the pin, so a code sold without its pin is
// still the Patron Pin item. Confirmed by the maintainer 2026-08-24.
for (const name of ['2022 Patron Lapel Pin (w/ all associated Codes)', "Patron's Pin (with codes)",
  '2022 Patron Lapel Code (No Pins Available)', '2022 Patron Code and sold out Pin']) {
  eq(vocab(name, '2022'), 'Patron Pin', `patron: ${JSON.stringify(name)}`);
}

for (const [name, expected] of [
  ['Treasure Draws', 'Treasure Chip'], ['PYP URs', 'Ultra Rare'],
  ['Alchemist Ink', "Alchemist's Ink"], ['Alchemist Parchment', "Alchemist's Parchment"],
  ['Enchanter Munition', "Enchanter's Munition"], ['1,000 GP Bars', '1,000 GP Gold Bar'],
  ['Orb of Dragonkind [Great Wyrm]', '8k Bonus'],
  ["Adventurer's Guild button/code", "Adventurers' Guild Button"],
  ["Adventurers' Guild Membership Buttons and Codes", "Adventurers' Guild Button"],
]) {
  eq(vocab(name, '2022'), expected, `vocab: ${JSON.stringify(name)}`);
}

// A prior-season token in a later auction is an AUGMENT, not a vocabulary gap,
// and must not resolve for the auction's own season.
for (const name of ['+4 Rod of the Meek', 'Ring of Expertise', 'Axe of the Dwarvish Kings']) {
  eq(vocab(name, '2022'), null, `${JSON.stringify(name)} is a 2021 token — an augment in a 2022 auction`);
}

// A Treasure Draw is three chips, and `3x Treasure Draws` states that twice.
eq(TH.threadDrawLotSize('3x Treasure Draws', 3), 3, 'the stated 3x is the three chips, not three draws');
eq(TH.threadDrawLotSize('Treasure Draws', 1), 3, 'a bare Treasure Draw is still three chips');
eq(TH.threadDrawLotSize('Alchemist Ink', 1), 0, 'nothing else is a draw');
console.log('  ✓ the two Turkey Legs stay distinct, the Patron code maps to the pin, ' +
  'prior-season tokens stay unresolved, and a draw is three chips counted once');

// ===========================================================================
console.log('\n=== 4. the pricing rule, replayed against prices.csv ===');
// ===========================================================================
const score = { items: 0, mode: 0, modeHigh: 0, min: 0, max: 0 };
const perThread = [];
let tiesFlagged = 0, offOrderSeen = 0, unparsedTotal = 0;

for (const t of manifest.threads) {
  const target = meta.find((m) => m.auctionId === t.auction);
  ok(target, `${t.auction}: not in auctionMetadata`);
  const plan = TH.threadPlan(pagesFor(t.topic), target, tokenRows);

  eq(plan.resultsPost, t.resultsPost, `${t.auction} ${t.auctioneer}: results post`);

  const recorded = {};
  for (const r of priceRows.filter((r) => r.auctionId === t.auction)) {
    (recorded[r.Item] = recorded[r.Item] || []).push(money(r.Price));
  }
  let hit = 0, n = 0, hiHit = 0, minHit = 0, maxHit = 0;
  for (const row of plan.prices) {
    if (!recorded[row.Item]) continue;
    n++;
    const rec = recorded[row.Item];
    if (rec.includes(row.Price)) hit++;
    if (row.tie && rec.includes(row.tie[row.tie.length - 1])) hiHit++;
    else if (rec.includes(row.Price)) hiHit++;
    // What Trent's rule would have proposed, from the same distribution.
    const prices = row.distribution.split(', ').map((p) => Number(p.split('$')[1]));
    if (rec.includes(Math.min(...prices))) minHit++;
    if (rec.includes(Math.max(...prices))) maxHit++;
    if (row.tie) tiesFlagged++;
  }
  score.items += n; score.mode += hit; score.modeHigh += hiHit;
  score.min += minHit; score.max += maxHit;
  offOrderSeen += plan.context.filter((c) => c.lot && c.lot.section === 'offorder').length;
  unparsedTotal += plan.unparsed.length;
  perThread.push({ t, plan, n, hit });

  ok(n >= t.itemsMatched, `${t.auction} ${t.auctioneer}: matched ${n} recorded items, manifest says at least ${t.itemsMatched}`);
  ok(hit >= t.reproduces, `${t.auction} ${t.auctioneer}: reproduced ${hit} prices, manifest says at least ${t.reproduces}`);
}

console.log(`  quantity-weighted mode  ${score.mode}/${score.items}`);
console.log(`  min (Trent's rule)      ${score.min}/${score.items}`);
console.log(`  max (Trent's rule)      ${score.max}/${score.items}`);
ok(score.mode > score.min && score.mode > score.max,
  `the mode should beat Trent's min/max: mode ${score.mode}, min ${score.min}, max ${score.max}`);
ok(score.mode >= manifest.expect.reproduces,
  `corpus reproduction fell to ${score.mode}, manifest expects at least ${manifest.expect.reproduces}`);
ok(score.items >= manifest.expect.itemsMatched,
  `corpus item match fell to ${score.items}, manifest expects at least ${manifest.expect.itemsMatched}`);
console.log(`  ✓ mode reproduces ${score.mode} of ${score.items} recorded items and beats min (${score.min}) and max (${score.max})`);

// ===========================================================================
console.log('\n=== 5. ties are flagged, never silently broken ===');
// ===========================================================================
const tie = TH.threadPropose([
  { price: 1.0, quantity: 2 },
  { price: 1.25, quantity: 2 },
]);
ok(tie.tie && tie.tie.length === 2, 'an even split did not set `tie`');
eq(tie.price, 1, 'a tie proposes the low value so the cell is never blank');
eq(tie.distribution, '2 @ $1, 2 @ $1.25', 'a tie shows both candidates with their quantities');

const clear = TH.threadPropose([
  { price: 0.5, quantity: 11 },
  { price: 0.75, quantity: 21 },
]);
eq(clear.price, 0.75, 'the mode is by TOKEN, not by lot');
eq(clear.tie, null, 'a clear winner is not flagged');
ok(tiesFlagged > 0, 'no tie was flagged anywhere in the corpus — the flag is not wired up');
console.log(`  ✓ ties set the flag and show both candidates (${tiesFlagged} flagged across the corpus)`);

// ===========================================================================
console.log('\n=== 6. Onyx, context, off-order lots and leftovers ===');
// ===========================================================================
for (const { t, plan } of perThread) {
  // The manifest carries the expected Onyx count for every thread, measured —
  // NOT `onyx.csv`'s row count. Those are not the same number and should not be
  // asserted as if they were: 202231's post carries two Onyx tokens the
  // auctioneer added from his own collection, and the sheet records neither, in
  // onyx.csv or in contextItems. The assistant surfacing them is the point.
  eq(plan.onyx.length, t.onyx || 0, `${t.auction} ${t.auctioneer}: onyx rows proposed`);
  if (t.offOrder !== undefined) eq(plan.context.filter((c) => c.lot && c.lot.section === 'offorder').length, t.offOrder, `${t.auction} ${t.auctioneer}: off-order context candidates`);
  if (t.withheldQuote !== undefined) {
    ok(plan.withheld.some((w) => w.text.includes(t.withheldQuote)),
      `${t.auction}: withheld candidate not found — expected a sentence containing ${JSON.stringify(t.withheldQuote)}`);
  }
  if (t.closeBracket !== undefined) {
    const bracket = plan.close.bracket ? `${plan.close.bracket.from}..${plan.close.bracket.to}` : null;
    eq(bracket, t.closeBracket, `${t.auction}: close-date bracket`);
  }
}

// kurtreznor's NON-8K STUFF. These used to be discarded, on the reasoning that
// 20222 recorded none of them — but that was an unbackfilled season, not a
// decision. They are contextItems candidates, and the invariant that matters is
// the one dropping them used to provide for free: an off-order lot must NEVER
// reach the price spine, whatever its name resolves to.
const kurt = perThread.find((x) => x.t.auction === '20222');
const offOrder = kurt.plan.context.filter((c) => c.lot && c.lot.section === 'offorder');
ok(offOrder.length > 0, '20222: the NON-8K section produced no context candidates');
const pricedNames = new Set(kurt.plan.prices.map((p) => String(p.Item).toLowerCase()));
for (const c of offOrder) {
  ok(!pricedNames.has(TH.threadTidyName(c.name).toLowerCase()),
    `20222: off-order "${c.name}" reached the price spine`);
}
// And the section really does scope: proving it needs a name that WOULD have
// resolved, since every one of 20222's own twenty fails to resolve in 2022 and
// would land in context regardless.
const scoped = TH.threadResolveLots(
  [{ item: 'Wish Ring', quantity: 1, price: 99, section: 'offorder', line: 'Wish Ring $99' }],
  '2022', index2022);
eq(scoped.context.length, 1, 'an off-order lot whose name resolves still goes to context');
eq(scoped.order.length, 0, 'an off-order lot whose name resolves must not become a price');
console.log(`  ✓ ${offOrderSeen} lot(s) under a non-8K heading routed to contextItems, none to the price spine`);
console.log(`  ✓ ${unparsedTotal} unread line(s) reported across the corpus rather than dropped silently`);

// The close-date bracket is evidence, not a proposal, and the test says so with
// a number: it contains the recorded closeDate in a minority of threads.
let bracketHits = 0, bracketsBuilt = 0;
for (const { t, plan } of perThread) {
  if (!plan.close.bracket) continue;
  bracketsBuilt++;
  const rec = meta.find((m) => m.auctionId === t.auction).closeDate;
  if (rec >= plan.close.bracket.from && rec <= plan.close.bracket.to) bracketHits++;
}
eq(bracketHits, manifest.expect.closeBracketHits,
  `close-date bracket hits (${bracketsBuilt} brackets built from ${manifest.threads.length} threads)`);
console.log(`  ✓ close-date bracket contains the recorded date in ${bracketHits} of ${bracketsBuilt} threads that carry one ` +
  '— which is why it is reported as evidence, not proposed as a value');

// ===========================================================================
console.log('\n=== 6b. a bag never divides ===');
// ===========================================================================
// The whole point of the bag rule. 202020 writes `8 x 120 Random Rare bag`,
// which the shared quantity rule reads as a lot of 8 — so a $100 bag becomes
// $12.50 unless bags are exempted. Its two recorded prices are the assertion.
{
  const t = manifest.threads.find((x) => x.auction === '202020');
  const target = meta.find((m) => m.auctionId === '202020');
  const plan = TH.threadPlan(pagesFor(t.topic), target, tokenRows);
  const bags = Object.fromEntries(plan.prices.filter((p) => /Bag$/.test(p.Item)).map((p) => [p.Item, p.Price]));
  for (const [item, expected] of Object.entries(t.bags)) {
    eq(bags[item], expected, `202020 ${item} reproduced from the thread`);
  }
  // And the control: a real lot size must still divide.
  const recorded = priceRows.filter((r) => r.auctionId === '202020');
  ok(recorded.length > 0, '202020 has recorded prices to compare against');
}
console.log('  ✓ 202020\'s Rare Bag ($100) and Uncommon Bag ($73) reproduced — the `8 x 120` prefix did not divide them');

// ===========================================================================
console.log('\n=== 7. the review tab ===');
// ===========================================================================
const sample = perThread.find((x) => x.t.auction === '202632');
const rows = TH.threadReviewRows(sample.plan);
ok(rows.length > 0, '202632: no review rows');
for (const row of rows) {
  eq(row.length, TH.THREAD_REVIEW_COLUMNS.length, 'a review row does not match the column count');
  eq(row[0], '', 'the Approve? column must start blank');
}
ok(rows.some((r) => r[1] === 'price'), 'no price rows in the review tab');
ok(rows.some((r) => r[1] === 'context?'), '202632: no context candidates — its grunnel props resolve to no token');
console.log(`  ✓ ${rows.length} review rows for 202632, all ${TH.THREAD_REVIEW_COLUMNS.length} columns wide, none pre-approved`);

// The description never throws and always names the tie caveat when one fired.
for (const { t, plan } of perThread) {
  const text = TH.threadDescribePlan(plan, t.auction);
  ok(typeof text === 'string' && text.length > 0, `${t.auction}: empty description`);
  if (plan.prices.some((p) => p.tie)) {
    ok(text.includes('8 low / 5 high / 1 midpoint'), `${t.auction}: a tie fired but the caveat is missing`);
  }
}
console.log('  ✓ every thread describes without throwing');

// ===========================================================================
if (failures.length) {
  console.error(`\n✗ forumThread: ${failures.length} failure(s) of ${passed + failures.length} assertions\n`);
  for (const f of failures.slice(0, 40)) console.error('  • ' + f);
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`\n✓ forumThread: ${passed} assertions over ${manifest.threads.length} real threads ` +
  `(${totalPosts} posts, ${score.items} recorded items)\n`);
