// Tests for apps-script/alesievClose.gs — Phase 5 (part three) of
// data-pipeline-plan.md.
//
// WHAT THIS SUITE CAN AND CANNOT ASSERT, because it is unusual.
//
// Every other close-path suite in this repo replays a real file against the
// rows that file produced in the shipped CSVs. This one cannot: the maintainer
// confirmed on 2026-09-10 that the sample export's PRICES ARE DUMMY DATA — it
// is an extract showing which rows and columns a close carries, not a record of
// an auction that happened. There is no auction to reconcile it with.
//
// So the fixture pins GRAMMAR AND ROUTING, and never a number against
// prices.csv. Three things stand in for a reconciliation, and they are the same
// three that stood in when Phase 4 met this source for the first time:
//
//   1. The names the file resolves to are asserted to be Items that
//      tokenMetadata and contextItems ALREADY hold. A plausible invention like
//      `Random UR` passes a parser test and fails validate-prices § 8 at the PR
//      gate instead, a long way from the cause. (That is not hypothetical —
//      forumClose.gs shipped exactly that name.)
//   2. The season the file resolves to is asserted, because the file carries no
//      auction identifier and the season check is the only defence against
//      importing it onto the wrong auction.
//   3. The shapes nobody has observed — a withheld block, an Onyx lot, an
//      unknown augment kind, a multi-token Onyx lot — are CONSTRUCTED here.
//      The whole risk of reading an export someone else generates is the day it
//      changes shape.
//
// Run: node scripts/alesiev-close.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const fixtureDir = join(here, '..', 'fixtures', 'alesiev');

// --- load the scripts into ONE sandbox --------------------------------------
// In Apps Script every .gs file in a project shares one global scope, and
// alesievClose.gs is written to call trentClose.gs's parser directly.
// auctionOpen.gs comes along for openIsoFromCell, which the close-date write
// reads a cell back with — loading them together is what the real runtime does.
const sandbox = { module: { exports: {} }, console };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'trentClose.gs'), 'utf8'), sandbox);
const T = sandbox.module.exports;
sandbox.module = { exports: {} };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'auctionOpen.gs'), 'utf8'), sandbox);
sandbox.module = { exports: {} };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'alesievClose.gs'), 'utf8'), sandbox);
const A = sandbox.module.exports;

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
const objs = (t) => { const r = parseCSV(t); const h = r[0].map((x) => x.trim()); return r.slice(1).map((c) => Object.fromEntries(h.map((k, i) => [k, (c[i] ?? '').trim()]))); };
const load = (dir, f) => objs(readFileSync(join(dir, f), 'utf8'));
const grid = (f) => parseCSV(readFileSync(join(fixtureDir, f), 'utf8'));

const TOKENS = load(dataDir, 'tokenMetadata.csv');
const CONTEXT = load(dataDir, 'contextItems.csv');
const ONYX = load(dataDir, 'onyx.csv');
const PRICES = load(dataDir, 'prices.csv');
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const FIXTURE = manifest.files[0];
const SAMPLE = grid(FIXTURE.file);
const SEASON = FIXTURE.season;

let pass = 0, fail = 0;
const ok = (name) => { console.log(`ok      ${name}`); pass++; };
const bad = (name, detail) => { console.error(`FAIL    ${name}`); if (detail) console.error(String(detail).split('\n').map((l) => '        ' + l).join('\n')); fail++; };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const eq = (name, got, want) => check(name, got === want, `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);

/** A staging grid from `[name, category, currentBid]` triples. */
const staged = (rows) => [
  ['Item', 'Category', 'Starting Bid', 'Current Bid', 'Bid Count', 'High Bid', 'Average Bid', 'Median Bid', 'Low Bid'],
  ...rows.map(([n, c, bid]) => [n, c, '0.50', bid ?? '', '1', '9.99', '9.99', '9.99', '9.99']),
];
const plan = (rows, season = SEASON, priced = false, style = '') =>
  A.alesievPlanImport(staged(rows), season, TOKENS, priced, style);
/** The same, for an auction whose style says Onyx. */
const onyxPlan = (rows) => plan(rows, SEASON, false, 'Onyx Ultra Condensed');

// ===========================================================================
// 1. Column A grammar
// ===========================================================================
console.log('Column A grammar\n');
{
  // The lot marker. It is a NUMBER, not a quantity — read as a count,
  // `Aragonite (15 of 15)` would divide a single-token lot fifteen ways.
  const m = A.alesievStripLotMarker('Aragonite (15 of 15)');
  eq('"(N of M)" comes off the name', m.name, 'Aragonite');
  eq('  ... and is kept as a lot number', m.lot.number, 15);
  eq('  ... of a lot count', m.lot.count, 15);
  eq('  ... and never becomes a quantity', T.parseQuantity(m.name).quantity, 1);
  eq('a name with no marker is lot 1 of 1', A.alesievStripLotMarker('Wish Ring').lot, null);
  // Only trailing. A parenthetical inside a real token name must survive.
  eq('"(N of M)" is trailing-only',
    A.alesievStripLotMarker('Path to Enlightenment (Fragment 4)').name,
    'Path to Enlightenment (Fragment 4)');
  eq('  ... and a token whose own name ends in parentheses is untouched',
    A.alesievNormaliseName('Golem Piece (40 Unique)').name, 'Golem Piece (40 Unique)');

  // The literal quotes around a name containing a comma.
  eq('quotes come off a name', A.alesievUnquote('"5,000 GP Gold Bar"'), '5,000 GP Gold Bar');
  eq('  ... even with the lot marker outside them',
    A.alesievNormaliseName('"5,000 GP Gold Bar" (1 of 9)').name, '5x 1,000 GP Gold Bar');
  eq('  ... and with the quotes outside the marker',
    A.alesievNormaliseName('"5,000 GP Gold Bar (1 of 9)"').name, '5x 1,000 GP Gold Bar');

  // The gold bar. `1,000 GP Gold Bar` is the only one tokenMetadata holds.
  eq('a 1,000 GP bar is one token', A.alesievGoldBar('1,000 GP Gold Bar'), '1,000 GP Gold Bar');
  eq('a 5,000 GP bar is five', A.alesievGoldBar('5,000 GP Gold Bar'), '5x 1,000 GP Gold Bar');
  eq('  ... written without the comma too', A.alesievGoldBar('5000 GP Gold Bar'), '5x 1,000 GP Gold Bar');
  eq('  ... and pluralised', A.alesievGoldBar('2,000 GP Gold Bars'), '2x 1,000 GP Gold Bar');
  eq('the rewritten name divides by its own quantity',
    T.parseQuantity(A.alesievGoldBar('5,000 GP Gold Bar')).quantity, 5);
  // The guard. A denomination that is not a multiple of 1,000 is a real change
  // to how this source names things, and it must stop the run rather than be
  // rounded into 1.5 tokens.
  eq('a non-multiple of 1,000 is refused', A.alesievGoldBar('1,500 GP Gold Bar'), null);
  eq('  ... and so is a sub-1,000 bar', A.alesievGoldBar('500 GP Gold Bar'), null);
  check('  ... which leaves the name to abort as unresolved',
    plan([['1,500 GP Gold Bar', 'Trade', '10']]).aborts.some((a) => /not a token/.test(a)),
    plan([['1,500 GP Gold Bar', 'Trade', '10']]).aborts.join(' | '));

  // The trailing multiplier, same rewrite forumClose.gs makes.
  eq('a trailing 10x becomes a leading one',
    A.alesievNormaliseName("Alchemist's Ink 10x (1 of 4)").name, "10x Alchemist's Ink");
  eq('  ... and the shared quantity rule then reads it',
    T.parseQuantity("10x Alchemist's Ink").quantity, 10);
  eq('a leading 10x is left alone',
    A.alesievNormaliseName('10x Treasure Chip (1 of 5)').name, '10x Treasure Chip');
}

// ===========================================================================
// 2. Column B routing — anchored, and it refuses rather than guesses
// ===========================================================================
console.log('\nColumn B routing\n');
{
  eq('Trade is a price', A.alesievRoute('Trade').destination, 'price');
  eq('Premium is a price', A.alesievRoute('Premium').destination, 'price');
  eq('Ultra Rare is a price', A.alesievRoute('Ultra Rare').destination, 'price');
  eq('a blank category is a price', A.alesievRoute('').destination, 'price');

  eq('Augment - Player goes to contextItems', A.alesievRoute('Augment - Player').destination, 'context');
  eq('  ... as a token', A.alesievRoute('Augment - Player').category, 'token');
  eq('Augment - Grunnel goes to contextItems', A.alesievRoute('Augment - Grunnel').category, 'grunnel');
  eq('  ... case and spacing do not matter', A.alesievRoute('AUGMENT-grunnel').category, 'grunnel');
  eq('  ... nor does an en dash', A.alesievRoute('Augment – Player').category, 'token');
  eq('Withheld goes to contextItems', A.alesievRoute('Withheld').category, 'withheld');
  eq('Onyx goes to the onyx tab', A.alesievRoute('Onyx').destination, 'onyx');
  eq('  ... and so does "Onyx Ultra Rare"', A.alesievRoute('Onyx Ultra Rare').destination, 'onyx');

  // ANCHORED. A loose /onyx/ reads `Non-Onyx` as Onyx — the measured mistake
  // that keeps auctionOpen.gs from guessing a style off a title at all.
  eq('"Non-Onyx" is NOT Onyx', A.alesievRoute('Non-Onyx').destination, 'price');
  eq('  ... nor is "Onyx Excluded" a false positive the other way',
    A.alesievRoute('Onyx Excluded').destination, 'onyx');
  eq('"Not Withheld" is not withheld', A.alesievRoute('Not Withheld').destination, 'price');

  // An unknown augment kind is a decision about what the item was doing in the
  // auction. contextItems.category is a four-value vocabulary checked at the PR
  // gate, so a fifth spelling invented here would fail there instead.
  const unknown = A.alesievRoute('Augment - Sponsor');
  check('an unknown augment kind refuses', !!unknown.error, JSON.stringify(unknown));
  check('  ... and names the kinds it knows', /player.*grunnel|grunnel.*player/i.test(unknown.error), unknown.error);
  const p = plan([['Something', 'Augment - Sponsor', '10']]);
  check('  ... and it aborts the whole import', !p.ok, JSON.stringify(p.aborts));
}

// ===========================================================================
// 3. The sample export, end to end
// ===========================================================================
console.log(`\nThe sample export — ${FIXTURE.rows} rows, season ${SEASON}\n`);
{
  const read = A.alesievReadStaging(SAMPLE);
  check('the export reads', !read.error, read.error);
  eq('  ... the columns it ignores are the six named in the manifest',
    read.ignored.length, 6);
  check('  ... including Average Bid, which forumClose.gs refuses a file for',
    read.ignored.map((h) => h.toLowerCase()).includes('average bid'), read.ignored.join(', '));

  // The season check is the only defence against importing this onto the wrong
  // auction: the export carries no auction identifier at all.
  const names = read.lots.map((l) => l.name);
  const seasons = T.inferSeasons(names, T.buildTokenIndex(TOKENS));
  eq('the file says which season it is', seasons.join(','), SEASON);
  check('  ... unambiguously', seasons.length === 1, seasons.join(','));

  const good = A.alesievPlanImport(SAMPLE, SEASON, TOKENS, false);
  check('it imports cleanly', good.ok, (good.aborts || []).join('\n'));
  check('  ... producing per-lot rows', good.raw.length > 0, String(good.raw.length));
  check('  ... and min/max rows', good.prices.length > 0, String(good.prices.length));

  // EVERY name written must be one the data already holds. This is the
  // substitute for a reconciliation: a plausible invention passes a parser test
  // and fails validate-prices at the PR gate instead.
  // THE CORPUS IS tokenMetadata AND THE PRICE SPINE, for the same reason the
  // fee-name check widened on 2026-09-21: a name can legitimately live in one
  // file and not the other, and a check reading one file calls that an
  // invention. `Random Ultra Rare` is the live case — it is an AGGREGATE's
  // name, deliberately absent from the token dictionary (zero rows), and
  // published in `prices.csv` 22 times since 2026-09-22. Narrowing this to
  // tokenMetadata would mean the importer could never write a name the site
  // already shows.
  const knownItems = new Set([...TOKENS.map((t) => t.Item), ...PRICES.map((r) => r.Item)]);
  const strayPrice = good.prices.map((r) => r.Item).filter((i) => !knownItems.has(i));
  eq('every priced Item is one the corpus already holds', strayPrice.join(', '), '');
  check('  ... and the wider corpus still rejects a name nothing publishes',
    !knownItems.has('Random UR') && !knownItems.has('Pick Your Purple'),
    'a name no row uses resolved against the corpus');
  // The sample's only context row: four `Augment - Player` lots all drew no bid,
  // and there are no withheld or Onyx rows, so what is left is the nine
  // `Random Ultra Rare` lots — of which TWO sold. An unsold lucky-dip lot is
  // not part of the bundle that changed hands, so the quantity counts sales.
  eq('the sample produces exactly one context row', good.context.length, 1);
  eq('  ... which is the Random Ultra Rare bundle', good.context[0].Item, 'Random Ultra Rare');
  eq('  ... counting only the lots that sold', good.context[0].quantity, 2);
  const knownContext = new Set(CONTEXT.map((c) => c.Item));
  check('  ... under a name contextItems.csv already holds',
    knownContext.has(good.context[0].Item), good.context[0].Item);
  check('the four unsold augments are reported, not written',
    ['Bead of Asgard', 'Bead of Divine Choice', 'Bifrost Charm', 'Deathward Greaves']
      .every((n) => good.unsold.some((u) => u.rawName === n)),
    good.unsold.map((u) => u.rawName).join(', '));

  // A season mismatch aborts. Only a POSITIVE mismatch — Phase 2's rule.
  const wrong = A.alesievPlanImport(SAMPLE, '2024', TOKENS, false);
  check('the wrong season aborts', wrong.aborts.some((a) => /looks like season 2027/.test(a)),
    wrong.aborts.join(' | '));

  // Re-importing an export you can download twice is the easiest mistake here.
  const dupe = A.alesievPlanImport(SAMPLE, SEASON, TOKENS, true);
  check('an auction that already has prices aborts',
    dupe.aborts.some((a) => /already has rows/.test(a)), dupe.aborts.join(' | '));
}

// ===========================================================================
// 4. Pick Your Purple vs Random Ultra Rare — the split column B cannot make
// ===========================================================================
console.log('\nThe two names Category calls the same thing\n');
{
  // Both are labelled `Ultra Rare` in the export. One is a market observation
  // and one is a lucky dip, and they belong in different files.
  const p = plan([
    ['Pick Your Purple (1 of 2)', 'Ultra Rare', '30'],
    ['Pick Your Purple (2 of 2)', 'Ultra Rare', '10'],
    ['Random Ultra Rare (1 of 3)', 'Ultra Rare', '55'],
    ['Random Ultra Rare (2 of 3)', 'Ultra Rare', '55'],
    ['Random Ultra Rare (3 of 3)', 'Ultra Rare', '57'],
  ]);
  check('the plan is clean', p.ok, (p.aborts || []).join('\n'));

  const pyp = p.prices.filter((r) => r.Item === 'Ultra Rare');
  eq('Pick Your Purple prices as Ultra Rare', pyp.length, 2);
  eq('  ... at the max', Math.max(...pyp.map((r) => r.Price)), 30);
  eq('  ... and the min', Math.min(...pyp.map((r) => r.Price)), 10);
  check('  ... and it reaches rawPricesData',
    p.raw.filter((r) => r.Item === 'Ultra Rare').length === 2, JSON.stringify(p.raw));

  const rur = p.context.filter((r) => r.Item === 'Random Ultra Rare');
  eq('Random Ultra Rare is ONE contextItems row', rur.length, 1);
  eq('  ... as a token', rur[0].category, 'token');
  eq('  ... with the lots counted', rur[0].quantity, 3);
  // Summing each lot's OWN price, never quantity x a representative price.
  // 202647's row read $495 (9 x $55) until it was corrected to $497.
  eq('  ... and their prices SUMMED, not multiplied', rur[0].price, 167);

  // AND IT NOW SETS PRICE ROWS TOO — the change of 2026-09-22. It used to set
  // none, because the only Random Ultra Rare data anyone had was an aggregate.
  // This source gives three separately-priced lots, so there is nothing to
  // flatten: they reach rawPricesData like any other lot and publish a real
  // min/max. The split column B cannot make is untouched by that — a Pick Your
  // Purple still prices as `Ultra Rare` and a lucky dip as `Random Ultra Rare`,
  // which is the whole reason this block exists.
  const rurPrices = p.prices.filter((r) => r.Item === 'Random Ultra Rare');
  eq('  ... and it NOW sets a min/max pair as well', rurPrices.length, 2);
  eq('  ... at the max', Math.max(...rurPrices.map((r) => r.Price)), 57);
  eq('  ... and the min', Math.min(...rurPrices.map((r) => r.Price)), 55);
  eq('  ... under the spine\'s own category, not the context row\'s',
    [...new Set(rurPrices.map((r) => r.Category))].join(','), 'Ultra Rare');
  eq('  ... with every lot in rawPricesData',
    p.raw.filter((r) => r.Item === 'Random Ultra Rare').length, 3);
  // The two files say different things and neither can say the other's. Pinned
  // because deleting one as a duplicate is the obvious wrong move: $167 over
  // three is what Funding & Context reports, $57/$55 is what a buyer paid.
  check('  ... and the context TOTAL is not any price row',
    !rurPrices.some((r) => r.Price === rur[0].price), JSON.stringify(rurPrices));

  const breakdown = A.alesievAggregateBreakdown(p.contextLots);
  eq('the dialog shows how the total was reached',
    breakdown[0], 'Random Ultra Rare: 2 @ $55 + 1 @ $57 = $167');

  // The name is pinned to the shipped CSV, not to the export's spelling. This
  // is the assertion forumClose.gs did not have, and it wrote `Random UR` —
  // a name contextItems.csv holds zero times.
  check('the Item is what contextItems.csv actually holds',
    CONTEXT.some((c) => c.Item === 'Random Ultra Rare'), 'no recorded Random Ultra Rare row');
  check('  ... and `Random UR` is a name no recorded row uses',
    CONTEXT.every((c) => c.Item !== 'Random UR'), 'contextItems.csv holds a Random UR row');
  eq('  ... so an abbreviated spelling normalises to it',
    plan([['Random UR', 'Ultra Rare', '55']]).context[0].Item, 'Random Ultra Rare');
}

// ===========================================================================
// 5. Augments — the one place this source beats a forum file outright
// ===========================================================================
console.log('\nAugments\n');
{
  const p = plan([
    ['Bead of Asgard', 'Augment - Player', '120'],
    ['Green Key', 'Augment - Grunnel', '455'],
    ['Bifrost Charm', 'Augment - Player', ''],
  ]);
  check('the plan is clean', p.ok, (p.aborts || []).join('\n'));
  eq('a sold augment gets its own row', p.context.length, 2);
  eq('  ... a player augment is a token', p.context.find((r) => r.Item === 'Bead of Asgard').category, 'token');
  eq('  ... a grunnel augment is a grunnel', p.context.find((r) => r.Item === 'Green Key').category, 'grunnel');
  eq('  ... at its own price', p.context.find((r) => r.Item === 'Green Key').price, 455);

  // NOT resolved against tokenMetadata. An augment comes out of the
  // auctioneer's personal collection and can be any token ever printed;
  // contextItems stores those names as free text.
  check('an augment that is in no season still imports',
    !p.aborts.some((a) => /Bead of Asgard/.test(a)), p.aborts.join(' | '));
  check('  ... which is right, because contextItems stores such names verbatim',
    CONTEXT.some((c) => c.category === 'grunnel' && !TOKENS.some((t) => t.Item === c.Item)),
    'no recorded grunnel row names a non-token');

  // An augment that drew no bid contributed nothing and is reported, not
  // written — a contextItems row with no price would read as withheld.
  eq('an unsold augment writes no row', p.context.filter((r) => r.Item === 'Bifrost Charm').length, 0);
  check('  ... and is reported by name',
    p.cautions.some((c) => /Bifrost Charm/.test(c)), p.cautions.join(' | '));

  // The contrast worth keeping: forumClose.gs gets six lots all called
  // `Grunnel Augment` and has to leave the Item blank for the operator.
  check('every augment row this source produces is NAMED',
    p.context.every((r) => String(r.Item).trim().length > 0), JSON.stringify(p.context));
}

// ===========================================================================
// 6. Withheld — constructed, because the sample has none
// ===========================================================================
console.log('\nWithheld (a shape nobody has observed yet)\n');
{
  const p = plan([
    ['"5,000 GP Gold Bar" (1 of 2)', 'Withheld', ''],
    ['"5,000 GP Gold Bar" (2 of 2)', 'Withheld', ''],
    ['10x Darkwood Plank (1 of 3)', 'Withheld', ''],
    ['Wish Ring', 'Withheld', ''],
  ]);
  check('the plan is clean', p.ok, (p.aborts || []).join('\n'));
  eq('withheld rows are aggregated per Item', p.context.length, 3);

  const bar = p.context.find((r) => r.Item === '1,000 GP Gold Bar');
  eq('  ... summing TOKENS, not lots', bar.quantity, 10);
  eq('  ... as withheld', bar.category, 'withheld');
  // A withheld item did not sell, so there is no bid to transcribe, and the
  // workbook computes the negative figure as a query over `prices`.
  eq('  ... with NO price — the sheet computes it', bar.price, '');
  eq('a 10x withheld lot counts ten', p.context.find((r) => r.Item === 'Darkwood Plank').quantity, 10);
  eq('a single withheld token counts one', p.context.find((r) => r.Item === 'Wish Ring').quantity, 1);

  // The shape this matches. 20251 records 90 withheld gold bars as ONE row.
  const recorded = CONTEXT.filter((c) => c.auctionId === '20251' && c.category === 'withheld');
  check('which is the shape every recorded withheld block has',
    recorded.length > 0 && recorded.filter((c) => c.Item === '1,000 GP Gold Bar').length === 1,
    JSON.stringify(recorded.slice(0, 3)));

  // A withheld row is keyed to a token like any other.
  const stray = plan([['Grunnel Scroll', 'Withheld', '']]);
  check('a withheld name that is no token aborts',
    stray.aborts.some((a) => /withheld/.test(a) && /not a token/.test(a)), stray.aborts.join(' | '));

  // A withheld row carries no bid BY NATURE, so a blank price must not send it
  // down the unsold path.
  check('a blank price does not make a withheld row "unsold"',
    p.unsold.length === 0, JSON.stringify(p.unsold));
}

// ===========================================================================
// 6b. Withheld in a SPLIT Onyx order — the shape that aborted the import
// ===========================================================================
// 20275 sold 12 of its Onyx set and withheld 9, plus nine Random Ultra Rares.
// Every one of those eleven names failed `resolveToken`, so the whole import
// aborted and the 2027 Onyx set had to be typed into tokenMetadata by hand to
// get past it (backlog PIPE-8). These pin the three-step resolution that
// replaced it, and each step is proved by a name the NEXT step could not
// resolve — otherwise the case passes for the wrong reason.
console.log('\nWithheld in a split Onyx order (PIPE-8)\n');
{
  // STEP 1 — a context rule names its own spelling.
  //
  // This is called DIRECTLY rather than through a plan, and that is the point.
  // Every context rule is now also a fee name, so alesievReadStaging removes
  // all four before alesievWithheldRows can see them and no plan can reach this
  // step (see the fee section below). The step is still the thing standing
  // between a future non-fee aggregate and the PIPE-8 abort, so it is proved
  // here at the level that can still exercise it.
  //
  // `Random URs` is the proof rather than `Random Ultra Rare`, which
  // tokenMetadata now also holds for 2027: only the rule knows this spelling,
  // so only the rule can have resolved it. All 21 recorded appearances say
  // `Random Ultra Rare`, and forumClose.gs shipped `Random UR` — a name
  // contextItems holds zero times.
  const agg = A.alesievWithheldRows(
    [{ name: 'Random URs', rawName: 'Random URs (1 of 9)', bid: null, row: 2 }],
    SEASON, T.buildTokenIndex(TOKENS), true);
  eq('a withheld aggregate resolves through the context rule', agg.aborts.length, 0);
  eq('  ... under the corpus spelling, not the file\'s',
    (agg.rows[0] || {}).Item, 'Random Ultra Rare');
  eq('  ... still as withheld', (agg.rows[0] || {}).category, 'withheld');

  // STEP 2 — tokenMetadata still runs first, and this is the case that proves
  // step 3 is not a blanket bypass: inside an Onyx auction an ordinary
  // withheld token is resolved and divided exactly as before. 20222 withholds
  // fifteen such tokens beside a complete 21-row Onyx set, so this is the
  // common shape, not the exotic one.
  const ordinary = onyxPlan([['"5,000 GP Gold Bar" (1 of 2)', 'Withheld', '']]);
  eq('an ordinary withheld token still resolves in an Onyx auction',
    (ordinary.context[0] || {}).Item, '1,000 GP Gold Bar');
  eq('  ... and still divides by the name\'s own quantity',
    (ordinary.context[0] || {}).quantity, 5);
  check('  ... and is not reported as unchecked',
    !(ordinary.cautions || []).some((c) => /taken from the file as they stand/.test(c)),
    (ordinary.cautions || []).join(' | '));

  // STEP 3 — an Onyx chase token. `Bead of Asgard` stands in for one: it is in
  // no season's tokenMetadata, which is the NORMAL state for a chase token
  // (2026 has 12 of its 84 Onyx names there, 2018 has 12 of 63). A withheld one
  // is in no other file either — it is withheld precisely because it is not in
  // this file's Onyx block, and a season's first Onyx auction has no history.
  const chase = onyxPlan([['Bead of Asgard', 'Withheld', '']]);
  check('a withheld chase token imports in an Onyx auction', chase.ok, (chase.aborts || []).join('\n'));
  eq('  ... under the name the file gave it', (chase.context[0] || {}).Item, 'Bead of Asgard');
  check('  ... and every such name is reported for the operator to read',
    (chase.cautions || []).some((c) => /taken from the file as they stand/.test(c) && /Bead of Asgard/.test(c)),
    (chase.cautions || []).join(' | '));

  // And the fence. Outside an Onyx auction there is no step 3, so the
  // tokenMetadata check that catches a typo is exactly as strict as it was.
  const notOnyx = plan([['Bead of Asgard', 'Withheld', '']]);
  check('the same name outside an Onyx auction still ABORTS',
    notOnyx.aborts.some((a) => /not a token/.test(a) && /not an Onyx auction/.test(a)),
    notOnyx.aborts.join(' | '));

  // The style test is anchored, for the reason auctionOpen.gs learned: a loose
  // /onyx/ reads `Non-Onyx` as Onyx, which here would silently switch the
  // tokenMetadata check off for a whole auction.
  const nonOnyx = plan([['Bead of Asgard', 'Withheld', '']], SEASON, false, 'Non-Onyx Ultra Condensed');
  check('"Non-Onyx" is not an Onyx style', !nonOnyx.ok, JSON.stringify(nonOnyx.context));
  const safehold = plan([['Bead of Asgard', 'Withheld', '']], SEASON, false, 'Safehold Onyx Super Condensed');
  check('a style with Onyx in the middle IS one', safehold.ok, (safehold.aborts || []).join('\n'));

  // The name the missing normalisation forked. contextItems holds
  // `C-U-R Onyx Set` once; onyx.csv holds `C/UC/R Set` 24 times, and § 8's
  // near-miss detector cannot pair them — too far apart to be a typo.
  const set = onyxPlan([['C-U-R Onyx Set', 'Withheld', '']]);
  eq('the Onyx set folds onto the corpus spelling', (set.context[0] || {}).Item, 'C/UC/R Set');
  check('  ... which is the spelling onyx.csv actually uses',
    ONYX.filter((r) => r.Item === 'C/UC/R Set').length > 20,
    `onyx.csv holds it ${ONYX.filter((r) => r.Item === 'C/UC/R Set').length} time(s)`);

  // A caller that forgets the style would silently get the strict path back,
  // which is the bug all over again. Say so instead.
  const noStyle = plan([['+2 Sacred Sling', 'Onyx', '99'], ['Bead of Asgard', 'Withheld', '']]);
  check('an Onyx file with no style passed says which call site forgot',
    (noStyle.cautions || []).some((c) => /no auctionStyle was passed/.test(c)),
    (noStyle.cautions || []).join(' | '));
}

// ===========================================================================
// 6c. The auctioneer's fee is not a withheld row
// ===========================================================================
// The maintainer settled during the 2026 backfill that the fee — some Random
// Ultra Rares and a Golden Ticket — is never withheld. No earlier importer had
// to act on it, because a forum thread does not list the fee as a lot at all.
// This source does, tagged `Withheld` because it drew no bid, and on 20275 that
// was 10 of the 11 withheld rows.
console.log("\nThe auctioneer's fee (never a withheld row)\n");
{
  const fee = onyxPlan([
    ['Random Ultra Rare (1 of 9)', 'Withheld', ''],
    ['Random Ultra Rare (2 of 9)', 'Withheld', ''],
    ['Golden Ticket', 'Withheld', ''],
    ['Bead of Asgard', 'Withheld', ''],
  ]);
  check('the plan is clean', fee.ok, (fee.aborts || []).join('\n'));
  eq('a withheld Random Ultra Rare is written nowhere',
    fee.context.filter((r) => /Random/.test(r.Item)).length, 0);
  eq('a withheld Golden Ticket is written nowhere',
    fee.context.filter((r) => /Golden Ticket/.test(r.Item)).length, 0);
  eq('  ... and the genuine withheld token beside them still lands', fee.context.length, 1);
  eq('  ... under its own name', (fee.context[0] || {}).Item, 'Bead of Asgard');

  // Dropped rows are named individually, not counted. This caution is the only
  // place a wrongly-matched withheld token could ever surface.
  const dropped = (fee.cautions || []).filter((c) => /auctioneer's fee/.test(c));
  eq('the dropped lots are reported', dropped.length, 1);
  check('  ... naming every one of them',
    /Golden Ticket/.test(dropped[0]) && /Random Ultra Rare \(1 of 9\)/.test(dropped[0]) &&
    /Random Ultra Rare \(2 of 9\)/.test(dropped[0]), dropped[0]);
  check('  ... and saying they were written nowhere', /written nowhere/.test(dropped[0]), dropped[0]);

  // They are still READ. A file that is nothing but fee must not look like an
  // empty staging tab, which is a different error with a different remedy.
  eq('a dropped lot still counts as a lot read', fee.lots, 4);
  const allFee = onyxPlan([['Golden Ticket', 'Withheld', '']]);
  check('a file of nothing but fee is not "no lots"',
    !(allFee.aborts || []).some((a) => /no lots/.test(a)), (allFee.aborts || []).join(' | '));

  // A dropped fee lot is NOT an unsold lot. Both are dropped and both are
  // reported, but "drew no bid" is a remark about the market and this is a
  // statement about what the row means — the operator reads them differently.
  eq('a fee lot is not reported as unsold', allFee.unsold.length, 0);
  eq('  ... it is reported as fee', allFee.fee.length, 1);

  // Column B decides, not the name. A SOLD Random Ultra Rare is a lucky dip
  // somebody paid for, and it still aggregates into the one `token` row all 21
  // recorded appearances are shaped as.
  const sold = onyxPlan([
    ['Random Ultra Rare (1 of 2)', 'Ultra Rare', '55'],
    ['Random Ultra Rare (2 of 2)', 'Ultra Rare', '57'],
  ]);
  eq('a SOLD Random Ultra Rare is untouched by the fee rule', sold.context.length, 1);
  eq('  ... still aggregated under the corpus spelling',
    (sold.context[0] || {}).Item, 'Random Ultra Rare');
  eq('  ... as a token, not withheld', (sold.context[0] || {}).category, 'token');
  eq('  ... summing the lots\' OWN prices', (sold.context[0] || {}).price, 112);

  // Every key is a spelling the corpus already holds. A rule that DELETES rows
  // leans tight: a fee spelling this misses lands in contextItems where the
  // operator can see and delete it, but a withheld token it wrongly matched
  // would vanish from the funding rollups with nothing to say it existed.
  //
  // THE CORPUS HERE IS THE CONTEXT ROWS **AND THE PRICE SPINE**, and the second
  // half is not decoration. A fee name's job is to match what the data calls
  // the token, and which FILE names it is a recording decision that moves: the
  // Golden Ticket is a released payment the spine has carried since 2025 and
  // contextItems recorded in parallel for four auctions, and the moment those
  // four duplicates were deleted a check reading contextItems alone called
  // `golden ticket` an invented name. Narrowing the corpus to one file is what
  // turns a correct data change into a red check on the publish PR.
  const CORPUS_NAMES = new Set([
    ...CONTEXT.map((r) => r.Item),
    ...PRICES.map((r) => r.Item), ...PRICES.map((r) => r['Display Name']),
  ].filter(Boolean).map((s) => s.toLowerCase()));
  const invented = Object.keys(A.ALESIEV_FEE_NAMES).filter(
    (k) => !CORPUS_NAMES.has(k) && !Object.keys(A.ALESIEV_CONTEXT_RULES).includes(k));
  eq('every fee name is a spelling the corpus or a context rule already holds',
    invented.join(', '), '');
  check('  ... including the three Golden Ticket spellings the corpus records',
    ['golden ticket', 'golden ticket chance', 'chance at golden ticket']
      .every((k) => A.ALESIEV_FEE_NAMES[k] === true),
    JSON.stringify(Object.keys(A.ALESIEV_FEE_NAMES)));
  // Widening the corpus must not make the check vacuous: `Random UR` is the
  // name forumClose.gs once invented, and nothing in either file uses it.
  check('  ... and the wider corpus would still catch an invented spelling',
    !CORPUS_NAMES.has('random ur') && !CORPUS_NAMES.has('goldenticket'),
    'a name no row uses resolved against the corpus');

  // And the fence, in the other direction: nothing that is not on the list is
  // dropped, however much it looks like a fee.
  eq('a name merely containing "ticket" is not the fee',
    A.alesievIsFeeName('Golden Ticket Holder Pin'), false);
  eq('  ... nor one merely containing "random"',
    A.alesievIsFeeName('Random Rare'), false);
  eq('the lot marker and a leading multiplier are already off by then',
    A.alesievIsFeeName('Random Ultra Rare'), true);

  // THE ONE REAL RECONCILIATION THIS SUITE HAS.
  //
  // Everything else here pins grammar, because the fixture's prices are dummy
  // data and there is no auction to check them against. This is different:
  // 20275 is a real auction, it is the file that prompted the fee rule, and an
  // Onyx ORDER IS 21 ROWS — the invariant that holds across all 55 recorded
  // Onyx auctions. 20275 sold 12 and withheld the rest, so the two halves have
  // to add back up to the set.
  //
  // With the fee counted as withheld they add to 23, which is not a set. Take
  // the fee out and they add to 21 exactly. That is independent evidence for
  // this rule, arrived at from the corpus rather than from the file.
  //
  // PINNED TO THE ARITHMETIC, NOT TO THE NUMBERS. Both sides are counted from
  // the shipped CSVs, so deleting 20275's ten stale fee rows — which is the
  // matching data fix — leaves this passing. It fails if the set itself ever
  // stops adding up, which is the alarm worth having.
  const onyx20275 = ONYX.filter((r) => r.auctionId === '20275').length;
  const withheld20275 = CONTEXT.filter(
    (r) => r.auctionId === '20275' && r.category === 'withheld' && !A.alesievIsFeeName(r.Item));
  eq('20275 sold + withheld (fee excluded) is one complete Onyx set',
    onyx20275 + withheld20275.length, 21);
  // Deliberately NOT asserted: that the ten stale fee rows are still THERE.
  // It would pass today and fail the day they are deleted from the sheet —
  // a red check on the publish that carries the fix, which is how six
  // publishes have been blocked before. The invariant above is the durable
  // half and it holds either way.
}

// ===========================================================================
// 7. Onyx — also constructed
// ===========================================================================
console.log('\nOnyx (a shape nobody has observed yet)\n');
{
  const p = plan([
    ['+2 Sacred Sling', 'Onyx', '99'],
    ['Common/Uncommon/Rare Set', 'Onyx', '250'],
    ['+1 Mighty Long Bow (Onyx)', 'Onyx', '55'],
  ]);
  check('the plan is clean', p.ok, (p.aborts || []).join('\n'));
  eq('Onyx lots go to the onyx tab', p.onyx.length, 3);
  eq('  ... at the auction category the tab uses', p.onyx[0].Category, 'Onyx Ultra Rare');
  check('  ... which is the category every recorded Onyx row carries',
    ONYX.every((o) => o.Category === 'Onyx Ultra Rare'), 'onyx.csv holds another category');
  eq('  ... the name stored verbatim', p.onyx[0].Item, '+2 Sacred Sling');
  // The marker may be in the NAME as well as in column B, and it is always
  // stripped from the stored Item.
  eq('  ... with a marker in the name stripped too', p.onyx[2].Item, '+1 Mighty Long Bow');
  // ONYX_NORMALIZATION, shared with trentClose.gs.
  eq('  ... and the set name normalised the way the site stores it',
    p.onyx[1].Item, 'C/UC/R Set');
  check('  ... which is a name onyx.csv actually holds',
    ONYX.some((o) => o.Item === 'C/UC/R Set'), 'onyx.csv has no C/UC/R Set row');
  check('an Onyx lot never reaches the price spine',
    !p.prices.some((r) => /Sacred Sling/.test(r.Item)), JSON.stringify(p.prices));

  // All 1,155 recorded Onyx rows are single tokens, so a multi-token Onyx lot
  // is a shape nobody has seen and dividing it either way would be a guess.
  const multi = plan([['10x Onyx Trade Good', 'Onyx', '100']]);
  check('a multi-token Onyx lot aborts rather than guessing',
    multi.aborts.some((a) => /never seen|single tokens/i.test(a)), multi.aborts.join(' | '));

  // Two lots of one Onyx token breaks the 21-rows-per-order invariant.
  const twice = plan([['+2 Sacred Sling', 'Onyx', '99'], ['+2 Sacred Sling', 'Onyx', '95']]);
  check('two lots of one Onyx token are flagged',
    twice.cautions.some((c) => /21 rows/.test(c)), twice.cautions.join(' | '));
}

// ===========================================================================
// 8. The close date
// ===========================================================================
console.log('\nThe close date\n');
{
  eq('an ISO date is accepted', A.alesievCloseDateProblem('2026-09-19'), '');
  check('a blank is refused', !!A.alesievCloseDateProblem(''), 'blank accepted');
  // REFUSES rather than converts. `2026-09-19` written to a sheet comes back
  // from getValues() as a Date, and String() of that is
  // `Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)` — not a date
  // Sheets can parse, so daysToClose and Close Month stop computing.
  for (const bad of ['9/19/2026', '19-09-2026', 'Sat Sep 19 2026', '2026-9-19', '2026-13-01', '2026-09-32']) {
    check(`"${bad}" is refused rather than converted`, !!A.alesievCloseDateProblem(bad), bad);
  }
  check('  ... and the refusal says what to type',
    /YYYY-MM-DD/.test(A.alesievCloseDateProblem('9/19/2026')), A.alesievCloseDateProblem('9/19/2026'));
}

// ===========================================================================
// 9. Inherited guards — the ones this file gets from trentClose.gs
// ===========================================================================
console.log('\nInherited guards\n');
{
  eq('an empty tab is refused', A.alesievReadStaging([]).error, 'the staging tab is empty');
  const noCols = A.alesievReadStaging([['Lot', 'Winner'], ['a', 'b']]);
  check('unknown headers are refused', /could not find/.test(noCols.error || ''), noCols.error);
  check('  ... naming what is missing', /category column/.test(noCols.error || ''), noCols.error);

  // The bid-floor exclusion, unchanged. $0.25 is the minimum bid across ALL
  // three sources, confirmed by the maintainer on 2026-09-01 — the sample
  // export's $0.50 opening bids are dummy values in a test extract.
  const floor = plan([
    ['10x Darkwood Plank (1 of 2)', 'Trade', '0.25'],
    ['10x Darkwood Plank (2 of 2)', 'Trade', '10.00'],
  ]);
  const dp = floor.prices.filter((r) => r.Item === 'Darkwood Plank').map((r) => r.Price);
  check('an at-floor multi-token lot sets no published bound',
    !dp.includes(0.03) && !dp.includes(0.02), dp.join(', '));
  eq('  ... but is still recorded per-lot', floor.raw.filter((r) => r.Item === 'Darkwood Plank').length, 2);

  // A single-token lot at the floor IS a real price: somebody paid $0.25.
  const single = plan([['Wish Ring (1 of 2)', 'Trade', '0.25'], ['Wish Ring (2 of 2)', 'Trade', '9.00']]);
  const wr = single.prices.filter((r) => r.Item === 'Wish Ring').map((r) => r.Price).sort((a, b) => a - b);
  eq('a single-token lot at the floor still sets the min', wr.join(','), '0.25,9');

  // A one-lot item gets ONE row, not a min/max pair.
  const one = plan([['Wish Ring', 'Trade', '9.00']]);
  eq('a one-lot item gets a single row', one.prices.filter((r) => r.Item === 'Wish Ring').length, 1);

  // An unresolved price name aborts. That is the rule the whole phase rests on.
  const junk = plan([['Grunnel Scroll', 'Trade', '10']]);
  check('an unresolvable price name aborts', !junk.ok, JSON.stringify(junk.aborts));
  check('  ... and suggests contextItems', junk.aborts.some((a) => /contextItems/.test(a)), junk.aborts.join(' | '));

  // A lot with no bid is dropped, not written with an empty price.
  const unsold = plan([['Wish Ring', 'Trade', '']]);
  eq('an unsold lot writes nothing', unsold.raw.length, 0);
  eq('  ... and is reported', unsold.unsold.length, 1);
}

// ===========================================================================
// Clearing the outcome cell (backlog PIPE-9)
// ===========================================================================
// This is the only close path that writes to auctionMetadata, so it is the
// only one that can clear the cell rather than remind someone to. That makes
// it the one piece of workbook-WRITING logic in this file, and it is driven
// here against a fake sheet rather than left untested — `alesievClearOutcome`
// takes its sheet as an argument for exactly that reason.
console.log('\nClearing the outcome cell (PIPE-9)\n');
{
  // Enough of a Range/Sheet to drive the function. `cleared` records whether
  // clearContent() was actually called, so a test cannot pass on a message
  // alone while the cell keeps its value.
  const fakeSheet = (value, opts = {}) => {
    const state = { value, cleared: false, flushed: 0 };
    return {
      state,
      getRange: () => ({
        getFormula: () => opts.formula || '',
        clearContent: () => { state.cleared = true; if (!opts.sticky) state.value = ''; },
        getDisplayValue: () => state.value,
      }),
    };
  };
  sandbox.SpreadsheetApp = { flush: () => {} };

  const run = (value, opts) => {
    const sheet = fakeSheet(value, opts);
    const said = A.alesievClearOutcome(sheet, 5, 2, ['20275', '2027', value]);
    return { said, ...sheet.state };
  };

  // The case that cost the first 2027 close a hand edit and a red check.
  const pending = run('Pending');
  check('a Pending cell is cleared', pending.cleared && pending.value === '', JSON.stringify(pending));
  check('  ... and the report says so rather than changing it silently',
    /outcome was "Pending" and has been cleared/.test(pending.said), pending.said);
  check('  ... and says what it would have cost',
    /hard error at the PR gate/.test(pending.said), pending.said);

  const ended = run('Ended');
  check('an Ended cell is cleared too', ended.cleared && ended.value === '', JSON.stringify(ended));

  // Nothing to do, and nothing to say about it.
  const blank = run('');
  check('a blank cell is left alone and unremarked', !blank.cleared && blank.said === '', JSON.stringify(blank));

  // A value the script does not know is a decision somebody made. § 7 fences
  // that column, so clearing it would be the script overruling a person.
  const unknown = run('Cancelled');
  check('an unrecognised value is NOT cleared', !unknown.cleared, JSON.stringify(unknown));
  check('  ... but the operator is told Status will not read Closed',
    /CAUTION/.test(unknown.said) && /Cancelled/.test(unknown.said), unknown.said);

  // Same discipline as the closeDate write above: a formula computes itself.
  const formula = run('Pending', { formula: '=IF(1,"Pending","")' });
  check('a formula cell is left alone', !formula.cleared, JSON.stringify(formula));
  check('  ... and said so', /FORMULA/.test(formula.said), formula.said);

  // The read-back. A value this pipeline round-trips through a sheet is not
  // the value it wrote, and a clear that did not take must not report success.
  const stuck = run('Pending', { sticky: true });
  check('a clear that did not take is reported, not assumed',
    /tried to clear/.test(stuck.said) && /by hand/.test(stuck.said), stuck.said);

  // An older workbook without the column at all: absence yields a note, never
  // a crash, and names the column so the cause is not a mystery.
  const noCol = A.alesievClearOutcome(fakeSheet(''), 5, -1, ['20275']);
  check('a missing outcome column is a note, not a failure',
    /no "outcome" column/.test(noCol), noCol);
}

// ===========================================================================
// 10. The picker — which auctions the importer offers
//
// Two defects, both found by the operator rather than by this suite, because
// the shortlist lived inside a UI function where nothing could reach it:
//
//   1. It listed rows whose `auctioneer` was `alesiev`. The site hosts
//      auctions other people run, so four of the six site rows — Mike Steele,
//      Kusig, Flik, BasicBraining — were invisible, including `20275`, the one
//      real close this path has ever seen.
//   2. It sorted on `Number(auctionId)`, and the ids are season-prefixed, so
//      every 2026 auction (`202647`) outranked every 2027 one (`20271`). The
//      season just finished sat on top of the season being auctioned.
//
// Pinned on constructed rows, not on the shipped CSV: `auctionMetadata.csv` is
// republished from the workbook constantly, and a suite that pins a count or a
// top row out of it is a publish blocked the next time an auction opens. The
// checks against the real file below are invariants — shape, never size.
// ===========================================================================
console.log('\nThe picker\n');
{
  const row = (o) => ({
    auctionId: '', auctionSeason: '', auctionNumber: '', auctionName: '',
    auctioneer: '', Link: '', closeDate: '', Status: '', ...o,
  });
  const site = (id) => `https://alesievauctions.com/auctions/${id}`;
  const siteRow = (season, number, o = {}) => row({
    auctionId: `${season}${number}`, auctionSeason: String(season), auctionNumber: String(number),
    auctionName: `Auction ${number}`, Link: site(number), ...o,
  });

  // 1 — membership is the Link.
  const mixed = [
    siteRow(2027, 5, { auctioneer: 'Kusig' }),
    row({
      auctionId: '202647', auctionSeason: '2026', auctionNumber: '47', auctioneer: 'alesiev',
      auctionName: "Alesiev's FINAL 2026 Token Auction",
      Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=259000',
    }),
  ];
  const listedIds = A.alesievSiteAuctions(mixed).map((m) => m.auctionId);
  eq('an auction someone else ran on the site is listed', listedIds.includes('20275'), true);
  eq("  ... and alesiev's own FORUM auction is not", listedIds.includes('202647'), false);
  // The anchored parse, borrowed from auctionOpen.gs so there is one definition
  // of this source rather than two. A look-alike host is not this site.
  eq('a look-alike host is not the site',
    A.alesievSiteAuctions([siteRow(2027, 1, { Link: 'https://notalesievauctions.com/auctions/1' })]).length, 0);
  eq('a row with no Link at all is not listed',
    A.alesievSiteAuctions([siteRow(2027, 1, { Link: '' })]).length, 0);

  // 2 — newest first is season then number, not the id read as a number.
  eq('a five-digit 2027 id outranks a six-digit 2026 one',
    A.alesievSiteAuctions([siteRow(2026, 47), siteRow(2027, 1)])[0].auctionId, '20271');
  eq('within a season the highest number is first',
    A.alesievSiteAuctions([siteRow(2027, 1), siteRow(2027, 11), siteRow(2027, 2)])
      .map((m) => m.auctionNumber).join(','), '11,2,1');

  // 3 — the season scope, and what it does with the rest.
  const scoped = A.alesievPickerList([siteRow(2026, 47), siteRow(2027, 1), siteRow(2026, 12), siteRow(2027, 2)]);
  eq('the list is scoped to the newest season present', scoped.season, '2027');
  check('  ... so nothing from a finished season is in it',
    scoped.rows.every((m) => m.auctionSeason === '2027'), JSON.stringify(scoped.rows.map((m) => m.auctionId)));
  eq('  ... and the older ones are counted, not silently dropped', scoped.hidden, 2);

  // The cap survives a full season (2026 ran to 47 auctions).
  const many = A.alesievPickerList(Array.from({ length: 14 }, (_, i) => siteRow(2027, i + 1)));
  eq('the list is capped', many.rows.length, T.CLOSE_PICKER_LIMIT);
  eq('  ... and the remainder counted', many.hidden, 14 - T.CLOSE_PICKER_LIMIT);
  eq('  ... with the newest still first', many.rows[0].auctionNumber, '14');

  // Nothing to offer is not a crash: the prompt still takes a typed id.
  const none = A.alesievPickerList([]);
  eq('an empty tab yields an empty list', none.rows.length, 0);
  eq('  ... and no season', none.season, '');

  // 4 — the line itself.
  const closed = A.alesievPickerLine(siteRow(2027, 5, {
    auctioneer: 'Kusig', auctionName: 'TD Con Invite Patron (8K)', closeDate: '2026-09-19', Status: 'Closed',
  }));
  check('a line names the auctioneer, now that the list spans several',
    /Kusig/.test(closed), closed);
  check('  ... and when it closed', /closed 2026-09-19/.test(closed), closed);
  check('  ... and the id to type', /20275/.test(closed), closed);
  const pending = A.alesievPickerLine(siteRow(2027, 9, { auctioneer: 'BasicBraining', Status: 'Pending' }));
  check('an unclosed row reports its own Status rather than a flat "open"',
    /\(pending\)/.test(pending) && !/closed/.test(pending), pending);
  const statusless = A.alesievPickerLine(siteRow(2027, 9, { auctioneer: 'Flik' }));
  check('  ... and falls back to "open" when Status is blank', /\(open\)/.test(statusless), statusless);

  // 5 — invariants against the shipped file. Shape only.
  const META = load(dataDir, 'auctionMetadata.csv');
  const real = A.alesievPickerList(META);
  const fromSite = A.alesievSiteAuctions(META);
  check('the shipped auctionMetadata has site auctions to offer', real.rows.length > 0,
    'no alesievauctions.com Link in auctionMetadata.csv');
  check('every auction offered came from the site',
    real.rows.every((m) => /alesievauctions\.com/i.test(m.Link)),
    real.rows.map((m) => `${m.auctionId} ${m.Link}`).join('\n'));
  check('every auction offered is of the one season',
    real.rows.every((m) => m.auctionSeason === real.season),
    real.rows.map((m) => `${m.auctionId} ${m.auctionSeason}`).join(' '));
  check('that season is the newest the site has',
    real.season === String(Math.max(...fromSite.map((m) => Number(m.auctionSeason)))), real.season);
  check('the offered ids are the newest of that season',
    real.rows.every((m, i, a) => i === 0 || Number(a[i - 1].auctionNumber) >= Number(m.auctionNumber)),
    real.rows.map((m) => m.auctionId).join(' '));

  // Measured, not asserted: the day every site auction is his again, the old
  // filter would look correct, and a check on that would fail for no reason.
  const his = fromSite.filter((m) => m.auctioneer.toLowerCase() === 'alesiev').length;
  console.log(`\nnote: ${fromSite.length} site auction(s) recorded, ${his} run by alesiev himself` +
    ` — the auctioneer test this replaced would list ${his} of them`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
