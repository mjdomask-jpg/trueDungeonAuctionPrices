// Fetches token pages from tokendb.com and writes BOTH the fixture and the
// manifest entry, so adding a recipe to the sheet never requires a hand edit
// in this repo.
//
// Why this is a script and not part of the check: `test:tokendb` runs in CI,
// which has no network by design -- the fixtures are checked in precisely so
// the check is reproducible. This is the other half of that bargain. Run it
// when you have added recipes; commit what it writes.
//
//   npm run tokendb:refresh                 every unmapped, non-preliminary name
//   npm run tokendb:refresh -- --name="X"   just that transmute
//   npm run tokendb:refresh -- --stale      re-fetch every page already mapped
//   npm run tokendb:refresh -- --dry-run    fetch and report, write nothing
//
// It refuses to guess. A page whose <h1> does not RELATE to the CSV name is
// rejected rather than filed under a right-looking slug -- the failure mode
// that matters here is a wrong page mapped to a right name, because the check
// would then read a real recipe off the wrong token and go green.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import {
  manifest, manifestPath, fixtureDir, reloadManifest, forgetPage,
  readRecipeGroups, isPreliminary, deriveSlug, titleRelates,
  recipeLists, reconcile, txt,
} from './lib/tokendb.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const a = args.find((x) => x.startsWith(f + '=')); return a ? a.slice(f.length + 1).replace(/^["']|["']$/g, '') : null; };
const DRY = has('--dry-run');
const STALE = has('--stale');
const ONLY = val('--name');
const BASE = 'https://tokendb.com/token/';

// ------------------------------------------------------------ candidates --
// deriveSlug agrees with 167 of the 175 recorded slugs. The eight it misses are
// a small number of shapes, so try them in order rather than making the
// maintainer look one up: a Mythic token's page is prefixed, one name is a
// possessive the CSV drops, and one names a class the CSV leaves off.
function candidates(name) {
  const d = deriveSlug(name);
  const out = [d, 'mythic-' + d];
  // "One Boot Billy Map" -> "one-boot-billys-map": the page keeps a possessive
  // the CSV does not.
  const parts = d.split('-');
  for (let i = 0; i < parts.length; i++) {
    const p = parts.slice();
    p[i] = p[i] + 's';
    out.push(p.join('-'));
  }
  return [...new Set(out)];
}

// ----------------------------------------------------------------- fetch --
async function get(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      // Identify the caller honestly. This is a public token page and the
      // request is a plain read, but a bare scripted UA is rude.
      'User-Agent': 'td-auctions-fixture-refresh/1.0 (+https://td-auctions.com)',
      'Accept': 'text/html',
    },
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, html: await res.text() };
}

const h1of = (html) => {
  const m = html.match(/<h1 class="dir-title[^"]*"\s*>([\s\S]*?)<\/h1>/i);
  return m ? txt(m[1]) : null;
};

// Is this page MEANINGFULLY different from the one on disk? Cloudflare stamps
// a fresh challenge nonce into every response, so a straight byte compare calls
// every page changed: measured on omni-orb, two consecutive fetches differ by
// exactly that nonce and a WordPress version string. Without this a --stale run
// would rewrite all 173 fixtures and bury a real change among 172 empty ones.
//
// Masking is for the COMPARISON only. What gets written is still the verbatim
// response, because the manifest's whole reason for storing untrimmed pages is
// that a recipe read off the wrong list cannot be seen in a trimmed one.
const stable = (html) => html
  .replace(/window\.__CF\$cv\$params\s*=\s*\{[^}]*\}/g, 'CF_PARAMS')
  .replace(/\bnonce=["'][^"']*["']/g, 'nonce=""');

// Wait between requests. One page per recipe is a handful of requests on a
// normal run; --stale is 173 and has no business arriving all at once.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ list index --
// A page can carry more than one recipe (the Omni tokens carry a main recipe
// and an Ultra-Rare-only alternate). Rather than guess from the heading, try
// each candidate list and keep whichever RECONCILES best against what the CSV
// already records -- a measurable answer instead of a plausible one.
function bestListIndex(slug, name, groups) {
  const p = recipeLists(slug);
  if (p.lists.length <= 1) return { index: 0, lists: p.lists.length, decided: true };
  const mine = [...groups.values()].filter((g) => g.name === name);
  if (!mine.length) return { index: 0, lists: p.lists.length, decided: false };
  const scores = p.lists.map((list, i) => {
    let diffs = 0;
    for (const g of mine) diffs += reconcile(g, list.items, g.items).length;
    return { i, diffs };
  }).sort((a, b) => a.diffs - b.diffs);
  const tied = scores.filter((s) => s.diffs === scores[0].diffs).length > 1;
  return { index: scores[0].i, lists: p.lists.length, decided: !tied, scores };
}

// --------------------------------------------------------------- manifest --
// The manifest is CRLF with 1-space indent; rewriting it with defaults would
// show every line as changed and bury the two that matter.
function writeManifest(m) {
  const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])));
  m.slugs = sortKeys(m.slugs);
  const json = JSON.stringify(m, null, 1) + '\n';
  writeFileSync(manifestPath, Buffer.from(json.replace(/\r?\n/g, '\r\n'), 'utf8'));
}

// ------------------------------------------------------------------ main --
const groups = readRecipeGroups();

const wanted = new Map(); // name -> why
for (const [, g] of groups) {
  if (ONLY) { if (g.name === ONLY) wanted.set(g.name, 'named on the command line'); continue; }
  if (isPreliminary(g.source)) continue;
  if (STALE) { if (manifest.slugs[g.name]) wanted.set(g.name, 're-fetch'); continue; }
  if (!manifest.slugs[g.name]) wanted.set(g.name, 'no slug in the manifest');
}

if (!wanted.size) {
  if (ONLY) { console.error('No recipe named "' + ONLY + '" in transmuteRecipes.csv.'); process.exit(1); }
  console.log('Nothing to fetch: every non-preliminary recipe already maps to a fixture.');
  process.exit(0);
}

console.log((DRY ? '[dry run] ' : '') + wanted.size + ' page(s) to fetch\n');

const added = [];
const refetched = [];
const failed = [];
const needsChoice = [];
let first = true;

for (const [name, why] of wanted) {
  if (!first) await pause(750);
  first = false;

  const known = manifest.slugs[name];
  const tries = known ? [known] : candidates(name);
  let hit = null;
  for (const slug of tries) {
    const r = await get(BASE + slug + '/');
    if (!r.ok) { if (tries.length > 1) await pause(400); continue; }
    const h1 = h1of(r.html);
    if (!titleRelates(name, h1)) {
      console.log('  -  ' + name + ': ' + slug + ' is a page, but its title is "' + h1 + '" -- not accepted');
      continue;
    }
    hit = { slug, html: r.html, h1 };
    break;
  }

  if (!hit) {
    failed.push(name);
    console.log('  ✗  ' + name + ' (' + why + ') -- tried ' + tries.join(', '));
    continue;
  }

  const file = join(fixtureDir, hit.slug + '.html.gz');
  let changed = true;
  try {
    changed = stable(gunzipSync(readFileSync(file)).toString('utf8')) !== stable(hit.html);
  } catch { /* no fixture yet */ }

  if (!DRY) {
    if (changed) writeFileSync(file, gzipSync(Buffer.from(hit.html, 'utf8')));
    forgetPage(hit.slug);
    manifest.slugs[name] = hit.slug;
  }

  // Read the list structure back through the SAME parser the check uses.
  const li = DRY && changed ? null : bestListIndex(hit.slug, name, groups);
  if (li && li.lists > 1) {
    if (li.decided) {
      // Only ever ADD an entry. The manifest's own note says a page not named
      // here uses list 0, so writing an explicit 0 is redundant -- but silently
      // DELETING one somebody chose to write is an unrelated change buried in a
      // refresh diff, and the point of this script is that its diffs are
      // reviewable.
      if (li.index !== 0) manifest.listIndex[name] = li.index;
      console.log('  ✓  ' + name + ' -> ' + hit.slug + '  (' + li.lists + ' recipe lists, best match is #' + li.index + ')');
    } else {
      needsChoice.push({ name, slug: hit.slug, scores: li.scores });
      console.log('  !  ' + name + ' -> ' + hit.slug + '  (' + li.lists + ' recipe lists, NONE clearly better -- listIndex left alone)');
    }
  } else {
    console.log('  ✓  ' + name + ' -> ' + hit.slug + (changed ? '' : '  (unchanged)'));
  }

  (known ? refetched : added).push(name);
}

if (!DRY && (added.length || refetched.length)) {
  manifest.fetched = new Date().toISOString().slice(0, 10);
  writeManifest(manifest);
  reloadManifest();
}

console.log('\n' + (DRY ? '[dry run] nothing written. ' : '') +
  added.length + ' mapped, ' + refetched.length + ' re-fetched, ' + failed.length + ' not found.');

if (needsChoice.length) {
  console.log('\nThese pages carry several recipes and the CSV did not pick one clearly.');
  console.log('Set fixtures/tokendb/manifest.json listIndex by hand after looking at the page:');
  for (const c of needsChoice) console.log('  ' + c.name + '  (' + BASE + c.slug + '/)  scores: ' + c.scores.map((s) => '#' + s.i + '=' + s.diffs).join(' '));
}

if (failed.length) {
  console.log('\nNot found on tokendb. If these are proposed recipes from a forum PDF,');
  console.log('set Source=forum-pdf in the workbook and they will stop being asked about:');
  for (const f of failed) console.log('  ' + f);
}

if (!DRY && added.length) {
  console.log('\nNow run `npm run test:tokendb`. A newly mapped recipe is CHECKED from');
  console.log('here on, so a genuine disagreement will fail -- that is the point, and');
  console.log('`TOKENDB_EMIT_KNOWN=1 npm run test:tokendb` prints the block to record a');
  console.log('difference that is a modelling question rather than an error.');
}

// Set the code and let the loop drain rather than calling process.exit(): on
// Windows, exiting while undici still holds a keep-alive socket trips a libuv
// assertion (`UV_HANDLE_CLOSING`) and the process dies with 127 AFTER doing
// all its work correctly -- which would read as a failed refresh.
process.exitCode = failed.length ? 1 : 0;
const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')];
if (dispatcher && typeof dispatcher.close === 'function') await dispatcher.close();
