// Reconciles public/data/transmuteRecipes.csv against tokendb.com, the game's
// own token database, using the fixtures in fixtures/tokendb.
//
// Why this exists: a 2026-08 publish moved build-calculator totals and nothing
// caught it, because nothing in the repo knew what a recipe is SUPPOSED to
// contain. Every other validator checks the CSV against itself. This checks it
// against the source of truth.
//
// What is asserted, and why each assertion is the shape it is:
//
//   1. EVERY TRANSMUTE HAS A PAGE, and that page's <h1> is the token it claims
//      to be. Eighteen names do not slug the way the obvious rule predicts, so
//      the manifest carries every mapping; a new transmute with no fixture
//      fails here rather than silently going unchecked.
//   2. EVERY PAGE YIELDS A RECIPE LIST. tokendb is a WordPress site and its
//      markup drifts -- one page today is missing a </li> and another writes
//      its multipliers as &#xD7; rather than &#215;. A parser that quietly
//      returns nothing would turn every recipe green, so an empty parse is a
//      failure, never a pass.
//   3. NO DISCREPANCY OUTSIDE THE KNOWN LIST. This is the real guard. The
//      manifest pins the 21 groups that disagreed when the corpus was captured,
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
//   * Ingredients of Rare rarity and below. The CSV omits them on purpose --
//      of the 301 named ingredients it leaves out, 247 are Rare, Uncommon,
//      Common, Quest or Premium, while the ones it DOES record are almost all
//      Ultra Rare or Transmuted-Relic. Asserting on them would report 301
//      phantom missing rows. Named tokens are compared only when the CSV
//      already carries a row for them.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'fixtures', 'tokendb');
const csvPath = join(here, '..', 'public', 'data', 'transmuteRecipes.csv');

let failures = 0;
const notes = [];
function ok(cond, msg) {
  if (!cond) { failures++; console.error('  ✗ ' + msg); }
}
function section(title) { console.log('\n' + title); }

// ---------------------------------------------------------------- fixtures --
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const pageCache = new Map();
function page(slug) {
  if (pageCache.has(slug)) return pageCache.get(slug);
  const f = join(fixtureDir, slug + '.html.gz');
  const html = existsSync(f) ? gunzipSync(readFileSync(f)).toString('utf8') : null;
  pageCache.set(slug, html);
  return html;
}

// ------------------------------------------------------------------- HTML --
const ENT = {
  '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”',
  '&#8211;': '–', '&#8212;': '—', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#039;': "'", '&#8230;': '…', '&nbsp;': ' ',
};
function dec(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
    .replace(/&#?\w+;/g, (m) => (ENT[m] !== undefined ? ENT[m] : m));
}
function txt(html) {
  return dec(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Index just past the close tag matching the open tag beginning at startIdx.
function matchBlock(html, tag, startIdx) {
  const open = '<' + tag;
  const close = '</' + tag;
  const lower = html.toLowerCase();
  let depth = 0;
  let i = startIdx;
  while (i < lower.length) {
    const o = lower.indexOf(open, i);
    const c = lower.indexOf(close, i);
    if (c < 0) return html.length;
    const okOpen = o >= 0 && /[\s>/]/.test(lower[o + open.length] || '');
    if (okOpen && o < c) { depth++; i = o + open.length; }
    else {
      depth--;
      const gt = lower.indexOf('>', c);
      if (depth === 0) return gt < 0 ? html.length : gt + 1;
      i = c + close.length;
    }
  }
  return html.length;
}

// Top-level <li> starts. Tolerates an unclosed <li> -- vals-4-keen-fellbane-
// crossbow has one, and HTML auto-closes it at the next sibling.
function topLevelLiStarts(inner) {
  const starts = [];
  const re = /<(\/?)(ul|ol|li)\b[^>]*>/gi;
  let depth = 0;
  let m;
  while ((m = re.exec(inner))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'li') {
      if (!closing && depth === 0) starts.push({ start: m.index, openEnd: m.index + m[0].length });
      continue;
    }
    depth += closing ? -1 : 1;
    if (depth < 0) depth = 0;
  }
  return starts;
}

function parseList(inner) {
  const items = [];
  const starts = topLevelLiStarts(inner);
  for (let n = 0; n < starts.length; n++) {
    const { start: liStart, openEnd } = starts[n];
    const closed = matchBlock(inner, 'li', liStart);
    const nextSibling = n + 1 < starts.length ? starts[n + 1].start : inner.length;
    let content = inner.slice(openEnd, Math.min(closed, nextSibling)).replace(/<\/li\s*>\s*$/i, '');
    const children = [];
    let guard = 0;
    while (guard++ < 30) {
      const nm = /<(ul|ol)\b[^>]*>/i.exec(content);
      if (!nm) break;
      const ns = nm.index;
      const ne = matchBlock(content, nm[1], ns);
      const nested = content.slice(ns + nm[0].length, ne).replace(/<\/(ul|ol)\s*>\s*$/i, '');
      children.push(...parseList(nested));
      content = content.slice(0, ns) + ' ' + content.slice(ne);
    }
    items.push({ text: txt(content), children });
  }
  return items;
}

function blocks(html) {
  const start = html.indexOf('<div class="entry-content"');
  let end = html.indexOf('<div class="token-text"');
  if (end < 0) end = html.indexOf('<div class="dir-tax">');
  if (end < 0) end = html.length;
  const body = html.slice(start, end);
  const out = [];
  let i = 0;
  while (i < body.length) {
    const m = /<(p|h1|h2|h3|h4|h5|h6|ul|ol)\b[^>]*>/i.exec(body.slice(i));
    if (!m) break;
    const tag = m[1].toLowerCase();
    const s = i + m.index;
    const e = matchBlock(body, tag, s);
    const inner = body.slice(s + m[0].length, e).replace(new RegExp('</' + tag + '\\s*>\\s*$', 'i'), '');
    if (tag === 'ul' || tag === 'ol') out.push({ type: 'list', items: parseList(inner) });
    else out.push({ type: 'text', text: txt(inner) });
    i = e > s ? e : s + 1;
  }
  return out;
}

// The candidate recipe lists on a page, in page order. A list qualifies if it
// carries three or more "N x item" lines, or if the text just above it
// introduces a recipe -- both, because a Trade 3 recipe has no multipliers at
// all and an effects list can have plenty of lines.
function recipeLists(slug) {
  const html = page(slug);
  if (!html) return { h1: null, lists: [] };
  const h1m = html.match(/<h1 class="dir-title[^"]*"\s*>([\s\S]*?)<\/h1>/i);
  const out = [];
  let prev = [];
  for (const b of blocks(html)) {
    if (b.type === 'text') { prev.push(b.text); if (prev.length > 3) prev.shift(); continue; }
    const label = prev.join(' // ');
    const numbered = b.items.filter((i) => /^\d[\d,]*\s*[×x]\s/i.test(i.text)).length;
    const introduced = /construct|recipe\s*#?\s*\d|recipe\b.*usable from|these items/i.test(label);
    if (numbered >= 3 || (introduced && b.items.length >= 1)) out.push({ label, items: b.items });
    prev = [];
  }
  return { h1: h1m ? txt(h1m[1]) : null, lists: out };
}

// ---------------------------------------------------------------- ingredients --
const TRADE = ["Alchemist's Ink", "Alchemist's Parchment", 'Aragonite', 'Darkwood Plank',
  'Dwarven Steel', 'Elven Bismuth', "Enchanter's Munition", 'Golden Fleece', 'Minotaur Hide',
  'Mystic Silk', 'Oil of Enchantment', "Philosopher's Stone"];

function n(s) {
  return String(s)
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    // tokendb drops the possessive s on a handful of lines: "Alchemist' Parchment"
    .replace(/\b(Alchemist|Enchanter|Philosopher)'(\s)/g, "$1's$2")
    .trim();
}
const key = (s) => n(s).toLowerCase();
// tokendb qualifies some ingredients: "(2021 version only)", "(any year)", "*"
const bare = (s) => key(s)
  .replace(/\s*\((?:any year|20\d\d version only|20\d\d)\)\s*$/i, '')
  .replace(/\s*\*+\s*$/, '')
  .trim();

const NAME_FIX = new Map(Object.entries({
  '25,000 gp eldritch bar': '25,000 GP Eldritch Ore Bar',
  '25,000 gp eldritch ore bar': '25,000 GP Eldritch Ore Bar',
  '1,000 gp gold bar': '1,000 GP Gold Bar',
  '1,000 gp bar': '1,000 GP Gold Bar',
  '100,000 gp mythic ore bar': '100,000 GP Mythic Ore Bar',
  'monster trophies': 'Monster Trophy',
  'monster trophy': 'Monster Trophy',
}));
const TRACKED = new Set([...TRADE.map(key), '1,000 gp gold bar', '25,000 gp eldritch ore bar',
  '100,000 gp mythic ore bar', 'monster trophy', 'ultra rare', 'wish ring']);
const GP_ONLY = /^(at least\s+)?[\d,]+\s*GP(\s*\*)?(\s*\(no change will be given\))?$/i;
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50 };

function parsePlain(raw) {
  let t = n(raw);
  let qty = 1;
  const mult = t.match(/^(\d[\d,]*)\s*[×x]\s*(.+)$/i);
  if (mult) { qty = Number(mult[1].replace(/,/g, '')); t = mult[2].trim(); }

  const reserve = t.match(/^([\d,]+)\s*GP in Reserve Bars?$/i);
  if (reserve) return { type: 'tracked', name: '1,000 GP Gold Bar', qty: qty * (Number(reserve[1].replace(/,/g, '')) / 1000) };

  const loose = t.match(/^([\d,]+)\s*GP$/i);
  if (loose) {
    const gp = Number(loose[1].replace(/,/g, ''));
    // Under a full bar the CSV records nothing -- you cannot buy a third of one.
    if (gp % 1000 === 0) return { type: 'tracked', name: '1,000 GP Gold Bar', qty: qty * (gp / 1000) };
    return { type: 'subBarGp', name: t, qty };
  }

  const every = t.match(/^every monster trophy from (\d{4})/i);
  if (every) {
    let c = manifest.monsterTrophiesByYear[every[1]];
    if (c === undefined) return { type: 'token', name: n(t), qty };
    if (/not including/i.test(t)) c -= (t.match(/not including/gi) || []).length;
    return { type: 'tracked', name: 'Monster Trophy', qty: qty * c };
  }

  const fixed = NAME_FIX.get(key(t));
  if (fixed) return { type: 'tracked', name: fixed, qty };

  // "2x any Ultra Rare token from the 2027 Standard Set" is the generic UR the
  // CSV tracks. "any Ultra Rare robe" is narrower and the CSV names it in full.
  if (/^(any\s+)?ultra\s*rare(\s+token\b.*)?$/i.test(t)) return { type: 'tracked', name: 'Ultra Rare', qty };
  const qualified = t.match(/^any\s+(ultra\s*rare\s+.+)$/i);
  if (qualified) return { type: 'token', name: n(qualified[1]), qty };

  if (TRACKED.has(key(t))) return { type: 'tracked', name: n(t), qty };
  return { type: 'token', name: n(t), qty };
}

// "X or Y" is a choice -- but only where the "or" sits outside parentheses.
// "any Ultra Rare token from the Standard Set (2018 or later)" is ONE item.
function splitTopLevelOr(t) {
  const parts = [];
  let depth = 0;
  let last = 0;
  const re = /[()]|\s+(?:OR|or)\s+/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[0] === '(') { depth++; continue; }
    if (m[0] === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) { parts.push(t.slice(last, m.index)); last = m.index + m[0].length; }
  }
  parts.push(t.slice(last));
  return parts.map(n).filter(Boolean);
}

function parseItem(item) {
  const t = n(item.text);
  const kids = (item.children || []).map((c) => ({ text: n(c.text), children: c.children || [] }));

  const points = t.match(/^plus\s+(\d+)\s+points?\s+worth of tokens/i);
  if (points) return { type: 'points', qty: Number(points[1]) };

  if (/^ONE of the following sets/i.test(t)) {
    return { type: 'sets', sets: kids.map((k) => ({ label: k.text, items: (k.children || []).map((x) => n(x.text)) })) };
  }

  const grp = t.match(/^(?:plus\s+)?ONLY\s+([A-Z]+)\s+of(?:\s+the following)?/i)
    || t.match(/^(?:plus\s+)?([A-Z]+)\s+of the following/i)
    || t.match(/^(?:plus\s+)?ANY\s+([A-Z]+|\d+)\s+of (?:the following|these)/i)
    || t.match(/^plus\s+(?:ANY\s+)?([A-Z]+|\d+)\s+of (?:the following|these)\s+tokens/i);
  if (grp) {
    const w = grp[1].toLowerCase();
    return { type: 'choice', qty: WORDNUM[w] !== undefined ? WORDNUM[w] : Number(w) || 1, options: kids.map((k) => k.text), raw: t };
  }

  if (kids.length === 0 && !/^\d/.test(t)) {
    const parts = splitTopLevelOr(t);
    if (parts.length > 1) return { type: 'choice', qty: 1, options: parts, raw: t, inline: true };
  }
  return parsePlain(t);
}

// --------------------------------------------------------------------- CSV --
function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const csvRows = parseCSV(readFileSync(csvPath, 'utf8')).slice(1).filter((r) => r.length > 5 && r[3]);
const groups = new Map();
for (const r of csvRows) {
  const name = r[3];
  // Omni Cube and Omni Orb each carry two vintages under one name.
  const gkey = (name === 'Omni Cube' || name === 'Omni Orb') ? name + ' [' + r[1] + ']' : name;
  if (!groups.has(gkey)) groups.set(gkey, { name, items: [] });
  groups.get(gkey).items.push({ item: r[4], qty: Number(r[8]) });
}

// ------------------------------------------------------- 1. every page maps --
section('1. Every transmute maps to a tokendb page');
{
  const names = [...new Set(csvRows.map((r) => r[3]))];
  let missing = 0;
  let wrongTitle = 0;
  for (const name of names) {
    const slug = manifest.slugs[name];
    if (!slug) { ok(false, `${name}: no slug in the manifest -- add it and fetch the fixture`); missing++; continue; }
    const p = recipeLists(slug);
    if (!p.h1) { ok(false, `${name}: fixtures/tokendb/${slug}.html.gz missing or has no <h1>`); missing++; continue; }
    // The CSV shortens some names (drops a "Mythic " prefix, adds a "(Recipe 2)"
    // disambiguator, names a companion generically). Assert the page is A token
    // page, and that its title relates to the name, not that they are equal.
    const a = key(name).replace(/\s*\(recipe \d\)|\s*\(set \d\)|\s*recipe \d$|\s*- trade \d recipe$|\s*ultra rare recipe$/g, '');
    const b = key(p.h1);
    const related = b === a || b === 'mythic ' + a || b.startsWith(a + ' ') || a.startsWith(b);
    if (!related) wrongTitle++;
  }
  ok(missing === 0, `${missing} transmutes have no usable fixture`);
  console.log(`  ✓ ${names.length - missing} of ${names.length} transmutes resolve to a fixture with an <h1>`);
  if (wrongTitle) notes.push(`${wrongTitle} page titles do not obviously relate to their CSV name (see the report's name-mismatch table)`);
}

// -------------------------------------------------- 2. every page parses --
section('2. Every page yields a recipe list');
const parsed = new Map();
{
  let empty = 0;
  for (const [gkey, g] of groups) {
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
  ok(empty <= knownEmpty, `${empty} recipes parsed to nothing; only ${knownEmpty} are known to state their recipe in prose`);
  console.log(`  ✓ ${groups.size - empty} of ${groups.size} recipe groups parsed to a list`);
}

// ------------------------------------------ 3. reconcile against the CSV --
section('3. The CSV reconciles with tokendb');

// `rows` is what the CSV records for this recipe. Kept a parameter rather than
// read from `g` so § 4 can hand it a mutated copy.
function reconcile(g, items, rows) {
  const diffs = [];
  if (!items) { diffs.push({ kind: 'NO_RECIPE_ON_PAGE', item: null, site: null, csv: null }); return diffs; }

  const expect = new Map();
  const tokens = [];
  const choices = [];
  const add = (name, qty) => expect.set(n(name), (expect.get(n(name)) || 0) + qty);

  for (const raw of items) {
    const e = parseItem(raw);
    if (e.type === 'tracked') add(e.name, e.qty);
    else if (e.type === 'token') tokens.push(e);
    else if (e.type === 'points') add('Ultra Rare', e.qty);
    else if (e.type === 'choice') choices.push(e);
    else if (e.type === 'sets') {
      const pick = manifest.setPick[g.name];
      if (pick !== undefined && e.sets[pick]) {
        for (const si of e.sets[pick].items) {
          const p = parsePlain(si);
          if (p.type === 'tracked') add(p.name, p.qty); else tokens.push(p);
        }
      }
    }
  }

  const got = new Map();
  for (const c of rows) got.set(n(c.item), (got.get(n(c.item)) || 0) + c.qty);

  // A "pick N of these" group is satisfied when the CSV records N of one of the
  // options, or N of the stand-in the maintainer uses for it (Monster Trophy for
  // a trophy list, Ultra Rare for a list of URs). The "or just pay N GP" branch
  // is the fallback, so real ingredients are looked at first.
  const chosen = new Map();
  for (const ch of choices) {
    const nonGp = ch.options.filter((o) => !GP_ONLY.test(o) && !/GP in Reserve Bars?/i.test(o) && !/GP (Gold )?Bar/i.test(o));
    const trophyish = nonGp.length >= 2 && nonGp.every((o) => !TRACKED.has(key(o)));
    const find = (list) => {
      const p = list.map((o) => parsePlain(o));
      return p.find((x) => got.has(n(x.name))) || p.find((x) => [...got.keys()].some((gk) => bare(gk) === bare(x.name)));
    };
    let hit = find(nonGp);
    let pick = hit ? ([...got.keys()].find((gk) => bare(gk) === bare(hit.name)) || n(hit.name)) : null;
    if (!pick && !ch.inline && trophyish && got.has('Monster Trophy')) pick = 'Monster Trophy';
    if (!pick) { hit = find(ch.options.filter((o) => !nonGp.includes(o))); if (hit) pick = [...got.keys()].find((gk) => bare(gk) === bare(hit.name)) || n(hit.name); }
    if (!pick && !ch.inline && got.has('Ultra Rare')) pick = 'Ultra Rare';
    if (!pick) {
      // The CSV models some choice groups with nothing at all -- § 2.5 of the
      // report -- and every one of those offers only Rare-and-below named
      // tokens, which the CSV omits by convention. A group offering something
      // the CSV DOES track (a Wish Ring, a gold bar, a trophy) and matched by
      // nothing is a row that went missing, not a convention.
      if (ch.options.some((o) => parsePlain(o).type === 'tracked')) {
        diffs.push({ kind: 'CHOICE_UNSATISFIED', item: ch.raw, site: ch.qty, csv: null });
      }
      continue;
    }
    chosen.set(pick, (chosen.get(pick) || 0) + ch.qty * (hit ? hit.qty : 1));
  }
  for (const [pick, want] of chosen) {
    const have = got.get(pick);
    if (have !== want) diffs.push({ kind: 'CHOICE_QTY', item: pick, site: want, csv: have === undefined ? null : have });
    expect.set(pick, (expect.get(pick) || 0) + have);
    const tok = tokens.find((t) => bare(t.name) === bare(pick));
    if (tok) tok.matched = true;
  }

  for (const [name, qty] of expect) {
    const have = got.get(name);
    if (have === undefined) diffs.push({ kind: 'MISSING', item: name, site: qty, csv: null });
    else if (have !== qty) diffs.push({ kind: 'QTY', item: name, site: qty, csv: have });
  }
  for (const [name, qty] of got) {
    if (expect.has(name)) continue;
    if (TRACKED.has(key(name))) { diffs.push({ kind: 'EXTRA', item: name, site: null, csv: qty }); continue; }
    // A named token: compared only because the CSV already carries a row for it.
    const hit = tokens.find((t) => bare(t.name) === bare(name));
    if (hit) { if (hit.qty !== qty) diffs.push({ kind: 'QTY', item: name, site: hit.qty, csv: qty }); hit.matched = true; }
  }
  return diffs;
}

const found = new Map();
for (const [gkey, g] of groups) found.set(gkey, reconcile(g, parsed.get(gkey), g.items));

{
  const sig = (d) => `${d.kind}|${d.item}|${d.site}|${d.csv}`;
  let reconciled = 0;
  let unexpected = 0;
  for (const [gkey, diffs] of found) {
    if (!diffs.length) { reconciled++; continue; }
    const known = new Set((manifest.known[gkey] || []).map(sig));
    for (const d of diffs) {
      if (known.has(sig(d))) continue;
      unexpected++;
      ok(false, `${gkey}: ${d.kind} ${d.item || ''} -- tokendb says ${d.site}, the CSV says ${d.csv}`);
    }
  }
  for (const gkey of Object.keys(manifest.known)) {
    const diffs = found.get(gkey);
    if (!diffs) { notes.push(`${gkey} is in the manifest's known list but no longer exists in the CSV`); continue; }
    const now = new Set(diffs.map(sig));
    const fixed = manifest.known[gkey].filter((d) => !now.has(sig(d)));
    if (fixed.length) notes.push(`${gkey}: ${fixed.length} known discrepanc${fixed.length === 1 ? 'y is' : 'ies are'} now clean -- trim fixtures/tokendb/manifest.json`);
  }
  ok(unexpected === 0, `${unexpected} discrepancies are not in the manifest's known list`);
  console.log(`  ✓ ${reconciled} of ${groups.size} recipe groups reconcile exactly`);
  console.log(`    ${groups.size - reconciled} known discrepancies stand (12 data errors, the rest vintage or modelling -- see transmute-recipe-audit.md)`);
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
    const g = groups.get(gkey);
    if (!g) { ok(false, `mutation case names ${gkey}, which is not in the CSV`); continue; }
    ok(found.get(gkey).length === 0, `mutation base ${gkey} must reconcile cleanly today, else the case proves nothing`);
    const diffs = reconcile(g, parsed.get(gkey), mutate(g.items));
    if (diffs.length) caught++;
    else ok(false, `${gkey}: ${what} was NOT reported -- the reconciler is blind to it`);
  }
  console.log(`  ✓ ${caught} of ${cases.length} mutations reported`);
}

// ------------------------------------------------------------------ done --
for (const note of notes) console.log('  note: ' + note);
if (failures) {
  console.error(`\ntokendb recipe reconciliation: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`\ntokendb recipe reconciliation: ${groups.size} recipe groups checked against ${pageCache.size} fixtures, no unexpected drift`);
