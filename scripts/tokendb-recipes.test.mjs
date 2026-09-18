// Reconciles public/data/transmuteRecipes.csv against tokendb.com, the game's
// own token database, using the fixtures in fixtures/tokendb.
//
// Why this exists: a 2026-08 publish moved build-calculator totals and nothing
// caught it, because nothing in the repo knew what a recipe is SUPPOSED to
// contain. Every other validator checks the CSV against itself. This checks it
// against the source of truth.
//
// WHAT THIS CHECK IS NOT ALLOWED TO DO, and why (2026-09-18):
//
//   It must never block a publish because the REPO is missing scaffolding.
//   tokendb is not where a recipe first appears -- the company publishes
//   proposed recipes as a forum PDF and tokendb may not carry the final
//   version for MONTHS -- and old recipes get backfilled into the sheet long
//   after their pages existed. In both cases the CSV is correct and the
//   fixture simply is not here. Until 2026-09-18 that was five hard failures
//   (PR #199): one new recipe with no manifest entry cascaded through all three
//   sections and blocked an unrelated auction update, having proved nothing
//   about correctness -- once mapped it reconciled exactly.
//
//   So: a recipe this suite CANNOT read is UNVERIFIED, never INCORRECT. It
//   comes out of the denominator with its reason, the way onyxcheck.mjs treats
//   an unreconcilable row, because a permanently short score teaches the next
//   reader to hunt a bug that is not there. Only a recipe that DOES resolve to
//   a page and DISAGREES with it fails.
//
// What is asserted, and why each assertion is the shape it is:
//
//   1. EVERY CHECKABLE TRANSMUTE HAS A PAGE. A name with no slug, or a slug
//      with no fixture, is reported as UNMAPPED with the lines to add and the
//      command that adds them -- a note, not a failure. Preliminary recipes
//      (Source=forum-pdf) are not even asked.
//   2. EVERY MAPPED PAGE YIELDS A RECIPE LIST. tokendb is a WordPress site and
//      its markup drifts -- one page today is missing a </li> and another
//      writes its multipliers as &#xD7; rather than &#215;. A parser that
//      quietly returns nothing would turn every recipe green, so an empty parse
//      of a page we HAVE is a failure. This is about the parser, so a page we
//      do not have is not its business.
//   3. NO DISCREPANCY OUTSIDE THE KNOWN LIST. This is the real guard. The
//      manifest pins the groups that disagreed when the corpus was captured,
//      with their measured deltas; anything new -- a quantity that drifts, an
//      ingredient that appears or vanishes -- fails.
//
// What is deliberately NOT asserted:
//
//   * The reconciled count is reported, not pinned to an exact number. A test
//      pinned to a VALUE is a hard block on the workbook reaching the site, and
//      correcting one of the 12 known data errors must not turn a publish PR
//      red. A known entry that goes clean prints as a note asking for the
//      manifest to be trimmed.
//   * The number of unmapped or preliminary recipes. Pinning it would just
//      re-create the block this check was rewritten to remove.
//   * Ingredients of Rare rarity and below. The CSV omits them on purpose --
//      of the 301 named ingredients it leaves out, 247 are Rare, Uncommon,
//      Common, Quest or Premium, while the ones it DOES record are almost all
//      Ultra Rare or Transmuted-Relic. Asserting on them would report 301
//      phantom missing rows. Named tokens are compared only when the CSV
//      already carries a row for them.

import {
  manifest, recipeLists, reconcile, readRecipeGroups, isPreliminary,
  deriveSlug, normaliseSource, SOURCE_VOCAB, TRADE, key, pageCacheSize,
} from './lib/tokendb.mjs';

let failures = 0;
const notes = [];
function ok(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
}
function section(title) { console.log('\n' + title); }

const groups = readRecipeGroups();

// ------------------------------------------------------------- triage --
// Every group lands in exactly one of three buckets before a single assertion
// runs, so each section can say plainly what it is and is not talking about.
const preliminary = new Map(); // no tokendb page exists yet, by design
const unmapped = new Map();    // should have a page; we do not hold one
const checked = new Map();     // resolves to a fixture -- the real corpus
for (const [gkey, g] of groups) {
  if (isPreliminary(g.source)) { preliminary.set(gkey, g); continue; }
  const slug = manifest.slugs[g.name];
  if (!slug) { unmapped.set(gkey, { g, why: 'no slug in the manifest' }); continue; }
  if (!recipeLists(slug).h1) {
    unmapped.set(gkey, { g, why: 'fixtures/tokendb/' + slug + '.html.gz is missing or has no <h1>' });
    continue;
  }
  checked.set(gkey, g);
}

// One line per unmapped NAME (not per group -- the Omni tokens would say it
// twice), naming the remedy. The refresh script fetches the page and writes the
// manifest entry, so the note points at it rather than describing an edit.
{
  const byName = new Map();
  for (const [, u] of unmapped) if (!byName.has(u.g.name)) byName.set(u.g.name, u.why);
  for (const [name, why] of byName) {
    notes.push('UNMAPPED "' + name + '" -- ' + why
      + '; run `npm run tokendb:refresh -- --name="' + name + '"` (derived slug would be "'
      + deriveSlug(name) + '"). Not checked against tokendb until then.');
  }
}

// ------------------------------------------------------- 1. every page maps --
section('1. Every transmute maps to a tokendb page');
{
  const prelimNames = new Set();
  for (const [, g] of preliminary) prelimNames.add(g.name);
  for (const [, g] of groups) if (!isPreliminary(g.source)) prelimNames.delete(g.name);

  const names = [...new Set([...groups.values()].map((g) => g.name))];
  const checkable = names.filter((nm) => !prelimNames.has(nm));
  const unmappedNames = new Set([...unmapped.values()].map((u) => u.g.name));
  let wrongTitle = 0;
  for (const name of checkable) {
    if (unmappedNames.has(name)) continue;
    const p = recipeLists(manifest.slugs[name]);
    // The CSV shortens some names (drops a "Mythic " prefix, adds a "(Recipe 2)"
    // disambiguator, names a companion generically). Assert the page is A token
    // page, and that its title relates to the name, not that they are equal.
    const a = key(name).replace(/\s*\(recipe \d\)|\s*\(set \d\)|\s*recipe \d$|\s*- trade \d recipe$|\s*ultra rare recipe$/g, '');
    const b = key(p.h1);
    const related = b === a || b === 'mythic ' + a || b.startsWith(a + ' ') || a.startsWith(b);
    if (!related) wrongTitle++;
  }
  const resolved = checkable.length - unmappedNames.size;
  console.log('  ✓ ' + resolved + ' of ' + checkable.length + ' checkable transmutes resolve to a fixture with an <h1>');
  if (unmappedNames.size) console.log('    ' + unmappedNames.size + ' unmapped (reported below, not a failure)');
  if (prelimNames.size) console.log('    ' + prelimNames.size + ' preliminary, not expected on tokendb yet');
  if (wrongTitle) notes.push(wrongTitle + ' page titles do not obviously relate to their CSV name (see the report\'s name-mismatch table)');
}

// -------------------------------------------------- 2. every page parses --
section('2. Every mapped page yields a recipe list');
const parsed = new Map();
{
  let empty = 0;
  for (const [gkey, g] of checked) {
    const slug = manifest.slugs[g.name];
    const p = recipeLists(slug);
    const idx = manifest.listIndex[g.name] !== undefined ? manifest.listIndex[g.name] : 0;
    const list = p.lists[idx];
    // Golden Fleece states its recipe in prose, with no list at all.
    if (!list) { empty++; parsed.set(gkey, null); continue; }
    let items = list.items.slice();
    const extra = manifest.extraPages[g.name];
    if (extra) {
      const ep = recipeLists(extra);
      if (ep.lists[0]) {
        items = items.filter((i) => !/\(Under Construction\)/i.test(i.text)).concat(ep.lists[0].items);
      }
    }
    parsed.set(gkey, items);
  }
  const knownEmpty = Object.keys(manifest.known).filter((k) => manifest.known[k].some((e) => e.kind === 'NO_RECIPE_ON_PAGE')).length;
  ok(empty <= knownEmpty, empty + ' recipes parsed to nothing; only ' + knownEmpty + ' are known to state their recipe in prose');
  console.log('  ✓ ' + (checked.size - empty) + ' of ' + checked.size + ' mapped recipe groups parsed to a list');
}

// ------------------------------------------ 3. reconcile against the CSV --
section('3. The CSV reconciles with tokendb');

const found = new Map();
for (const [gkey, g] of checked) found.set(gkey, reconcile(g, parsed.get(gkey), g.items));

{
  const sig = (d) => d.kind + '|' + d.item + '|' + d.site + '|' + d.csv;

  // Trimming the manifest by hand after a batch of corrections is how a known
  // list goes stale, and a stale list is how a real discrepancy hides inside an
  // entry nobody re-read. `TOKENDB_EMIT_KNOWN=1 npm run test:tokendb` prints the
  // block to paste back in, measured rather than remembered.
  if (process.env.TOKENDB_EMIT_KNOWN) {
    const out = {};
    for (const [gkey, diffs] of found) if (diffs.length) out[gkey] = diffs;
    console.log('\n--- known (paste into fixtures/tokendb/manifest.json) ---');
    console.log(JSON.stringify(out, null, 1));
  }

  let reconciled = 0;
  let unexpected = 0;
  for (const [gkey, diffs] of found) {
    if (!diffs.length) { reconciled++; continue; }
    const known = new Set((manifest.known[gkey] || []).map(sig));
    for (const d of diffs) {
      if (known.has(sig(d))) continue;
      unexpected++;
      ok(false, gkey + ': ' + d.kind + ' ' + (d.item || '') + ' -- tokendb says ' + d.site + ', the CSV says ' + d.csv);
    }
  }
  for (const gkey of Object.keys(manifest.known)) {
    const diffs = found.get(gkey);
    if (!diffs) {
      // Distinguish "gone from the CSV" from "still there, not checked this
      // run" -- they want opposite responses, and conflating them would ask
      // someone to delete a known entry that is merely resting.
      if (preliminary.has(gkey)) notes.push(gkey + ' is in the known list but is now Source=forum-pdf, so it was not checked');
      else if (unmapped.has(gkey)) notes.push(gkey + ' is in the known list but is unmapped, so it was not checked');
      else notes.push(gkey + ' is in the manifest\'s known list but no longer exists in the CSV');
      continue;
    }
    const now = new Set(diffs.map(sig));
    const fixed = manifest.known[gkey].filter((d) => !now.has(sig(d)));
    if (fixed.length) notes.push(gkey + ': ' + fixed.length + ' known discrepanc' + (fixed.length === 1 ? 'y is' : 'ies are') + ' now clean -- trim fixtures/tokendb/manifest.json');
  }
  ok(unexpected === 0, unexpected + ' discrepancies are not in the manifest\'s known list');
  console.log('  ✓ ' + reconciled + ' of ' + checked.size + ' checked recipe groups reconcile exactly');
  console.log('    ' + (checked.size - reconciled) + ' known discrepancies stand, all vintage or modelling questions -- see docs/tokendb-recipe-audit.md');
  // A "pick any N of these" recipe reconciles by construction: the resolver
  // accepts whichever member the CSV names. It cannot tell a well-chosen
  // representative from a badly-chosen one, so § 2.2 of the audit is invisible
  // here by design, not absent.
}

// ------------------------------------------------- 4. the guard has teeth --
// A reconciler that reports nothing turns every recipe green, which is exactly
// how the defect this suite exists to catch would hide. Each case perturbs a
// recipe that reconciles today and asserts the perturbation is reported.
section('4. Mutations of a clean recipe are caught');
{
  const cases = [
    ['+3 Holy Avenger', 'a trade good goes up', (r) => r.map((x) => (x.item === 'Mystic Silk' ? { ...x, qty: x.qty + 5 } : x))],
    ['+3 Holy Avenger', 'a trade good goes down', (r) => r.map((x) => (x.item === 'Darkwood Plank' ? { ...x, qty: 1 } : x))],
    ['+3 Holy Avenger', 'a trade good is dropped', (r) => r.filter((x) => x.item !== 'Aragonite')],
    ['+3 Holy Avenger', 'a trade good is invented', (r) => [...r, { item: 'Elven Bismuth', qty: 99 }]],
    ['+3 Holy Avenger', 'gold bars drift', (r) => r.map((x) => (x.item === '1,000 GP Gold Bar' ? { ...x, qty: 2 } : x))],
    ['Khing\'s Ring of Supreme Evasion', 'the Eldritch Ore Bar vanishes', (r) => r.filter((x) => x.item !== '25,000 GP Eldritch Ore Bar')],
    ['Khing\'s Ring of Supreme Evasion', 'the Wish Ring choice is dropped', (r) => r.filter((x) => x.item !== 'Wish Ring')],
    ['Divine Water', 'a Monster Trophy count drifts', (r) => r.map((x) => (x.item === 'Monster Trophy' ? { ...x, qty: 3 } : x))],
    ['Earcuff of Greater Glory', 'the trophy census drifts by one', (r) => r.map((x) => (x.item === 'Monster Trophy' ? { ...x, qty: x.qty - 1 } : x))],
    ['Kilgor\'s +4 Savage Sword (Recipe 1)', 'an ingredient name is misspelt', (r) => r.map((x) => (x.item === 'Mystic Silk' ? { ...x, item: 'Mystik Silk' } : x))],
    ['Safehold IV', 'the Under-Construction stage is lost', (r) => r.filter((x) => !TRADE.includes(x.item))],
    ['Charm of Avarice Recipe 3', 'the Ultra Rare point total drifts', (r) => r.map((x) => (x.item === 'Ultra Rare' ? { ...x, qty: 8 } : x))],
  ];
  let caught = 0;
  for (const [gkey, what, mutate] of cases) {
    const g = checked.get(gkey);
    // A mutation base that stopped being CHECKED is a silent loss of coverage:
    // marking a recipe preliminary, or losing its fixture, would otherwise
    // retire a case with no sign that it had gone.
    if (!g) {
      ok(false, 'mutation case names ' + gkey + ', which is not in the checked corpus'
        + (groups.has(gkey) ? ' (it is ' + (preliminary.has(gkey) ? 'preliminary' : 'unmapped') + ')' : ' (not in the CSV)'));
      continue;
    }
    ok(found.get(gkey).length === 0, 'mutation base ' + gkey + ' must reconcile cleanly today, else the case proves nothing');
    const diffs = reconcile(g, parsed.get(gkey), mutate(g.items));
    if (diffs.length) caught++;
    else ok(false, gkey + ': ' + what + ' was NOT reported -- the reconciler is blind to it');
  }
  console.log('  ✓ ' + caught + ' of ' + cases.length + ' mutations reported');
}

// --------------------------------------------- 5. the Source column itself --
section('5. Source is a vocabulary, and blank means tokendb');
{
  let bad = 0;
  for (const [gkey, g] of groups) {
    const v = normaliseSource(g.source);
    if (!v || SOURCE_VOCAB.includes(v)) continue;
    bad++;
    // An unrecognised value is treated as CHECKABLE upstream, so a typo cannot
    // quietly switch the guard off. It is still worth naming loudly.
    ok(false, gkey + ': Source "' + g.source + '" is not one of ' + SOURCE_VOCAB.join(', ')
      + ' -- treated as checkable, so the guard stayed on');
  }
  if (!bad) console.log('  ✓ every authored Source is one of ' + SOURCE_VOCAB.join(', ') + ' (blank = ' + SOURCE_VOCAB[0] + ')');
  console.log('  ✓ ' + preliminary.size + ' preliminary, ' + unmapped.size + ' unmapped, ' + checked.size + ' checked, of ' + groups.size + ' recipe groups');
}

// ------------------------------------------------------------------ done --
for (const note of notes) console.log('  note: ' + note);
if (failures) {
  console.error('\ntokendb recipe reconciliation: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\ntokendb recipe reconciliation: ' + checked.size + ' recipe groups checked against ' + pageCacheSize() + ' fixtures, no unexpected drift');
