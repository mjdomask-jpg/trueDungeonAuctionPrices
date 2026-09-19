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
  const knownItems = new Set(TOKENS.map((t) => t.Item));
  const strayPrice = good.prices.map((r) => r.Item).filter((i) => !knownItems.has(i));
  eq('every priced Item is one tokenMetadata already holds', strayPrice.join(', '), '');
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
  check('  ... and it sets no price row', !p.prices.some((r) => /random/i.test(r.Item)),
    JSON.stringify(p.prices));

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
  // STEP 1 — a context rule names its own spelling. `Random URs` is the proof
  // rather than `Random Ultra Rare`, which tokenMetadata now also holds for
  // 2027: only the rule knows this spelling, so only the rule can have
  // resolved it. All 21 recorded appearances say `Random Ultra Rare`, and
  // forumClose.gs shipped `Random UR` — a name contextItems holds zero times.
  const agg = onyxPlan([['Random URs (1 of 9)', 'Withheld', '']]);
  check('a withheld aggregate resolves through the context rule', agg.ok, (agg.aborts || []).join('\n'));
  eq('  ... under the corpus spelling, not the file\'s',
    (agg.context[0] || {}).Item, 'Random Ultra Rare');
  eq('  ... still as withheld', (agg.context[0] || {}).category, 'withheld');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
