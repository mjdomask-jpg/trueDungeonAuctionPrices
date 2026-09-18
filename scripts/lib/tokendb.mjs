// The tokendb.com reader: fixtures, HTML parsing, and reconciliation against
// `transmuteRecipes.csv`.
//
// Extracted from `tokendb-recipes.test.mjs` so the refresh script can fetch a
// page and reconcile it with EXACTLY the reader the test uses. Two parsers
// would drift, and a refresh that writes a manifest entry its own parser likes
// while the test's parser reads the page differently is the worst kind of
// green: the registry looks complete and the check is reading something else.
//
// Nothing here asserts or exits. Callers decide what a discrepancy means.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
export const fixtureDir = join(here, '..', '..', 'fixtures', 'tokendb');
export const manifestPath = join(fixtureDir, 'manifest.json');
export const csvPath = join(here, '..', '..', 'public', 'data', 'transmuteRecipes.csv');

// ---------------------------------------------------------------- fixtures --
// Mutable on purpose: the refresh script adds slugs and re-reconciles in one
// run, so `reconcile` must see what was just written rather than a snapshot.
export let manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
export function reloadManifest() {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  return manifest;
}

const pageCache = new Map();
export function page(slug) {
  if (pageCache.has(slug)) return pageCache.get(slug);
  const f = join(fixtureDir, slug + '.html.gz');
  const html = existsSync(f) ? gunzipSync(readFileSync(f)).toString('utf8') : null;
  pageCache.set(slug, html);
  return html;
}
export function forgetPage(slug) { pageCache.delete(slug); }
export const pageCacheSize = () => pageCache.size;

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

// ------------------------------------------------------------- provenance --
// `Source` is an OPTIONAL per-recipe column naming where a recipe's numbers came
// from. It exists because tokendb is not the first place a recipe appears: the
// company publishes proposed recipes as a forum PDF and tokendb may not carry
// the final version for MONTHS. Those recipes have no page to reconcile against
// and never will until tokendb catches up, so checking them is not "failing",
// it is asking a question the world cannot answer yet.
//
// Blank means `tokendb` -- the overwhelming default, and the reason the column
// needs no back-population. An UNRECOGNISED value is treated as checkable, not
// as preliminary: a typo must not silently switch the guard off, and
// `validate-recipes.mjs` warns on it separately.
export const SOURCE_TOKENDB = 'tokendb';
export const SOURCE_FORUM_PDF = 'forum-pdf';
export const SOURCE_VOCAB = [SOURCE_TOKENDB, SOURCE_FORUM_PDF];

export const normaliseSource = (v) => String(v ?? '').trim().toLowerCase();
export const isPreliminary = (v) => normaliseSource(v) === SOURCE_FORUM_PDF;

// --------------------------------------------------------- recipe groups --
// A "group" is one recipe: every CSV row sharing a Transmute (and, for the Omni
// tokens, a Year -- they carry two vintages under one name).
//
// Columns are read BY HEADER rather than by position, so adding a column cannot
// shift what this reads. `Source` absent entirely is the normal state until the
// workbook grows the column, and yields blank for every row.
export function readRecipeGroups(path = csvPath) {
  const rows = parseCSV(readFileSync(path, 'utf8')).filter((r) => r.length > 1);
  const header = rows[0].map((h) => h.trim());
  const at = (name) => header.indexOf(name);
  const iYear = at('Year'), iTransmute = at('Transmute'), iItem = at('Item');
  const iQty = at('Quantity'), iSource = at('Source');
  const cell = (r, i) => (i >= 0 ? (r[i] ?? '') : '');

  const groups = new Map();
  for (const r of rows.slice(1)) {
    const name = cell(r, iTransmute);
    if (!name || r.length <= 5) continue;
    const gkey = (name === 'Omni Cube' || name === 'Omni Orb')
      ? name + ' [' + cell(r, iYear) + ']'
      : name;
    if (!groups.has(gkey)) groups.set(gkey, { name, year: cell(r, iYear), source: '', items: [] });
    const g = groups.get(gkey);
    // One value per recipe, first non-blank wins -- the same tolerance
    // `Expires` gets for the sheet's habit of authoring on the first line or
    // filling down the block. validate-recipes flags rows that disagree.
    if (!g.source) g.source = cell(r, iSource).trim();
    g.items.push({ item: cell(r, iItem), qty: Number(cell(r, iQty)) });
  }
  return groups;
}

// The slug a name would take if it followed the documented rule, with the
// recipe-VARIANT suffixes stripped first. `Omni Orb Ultra Rare Recipe` is a
// second recipe on the `omni-orb` page, not a token of its own -- section 1 of
// the test already reduces a name this way to check the page title, so slug
// derivation uses the same reduction rather than inventing a second one.
export const VARIANT_SUFFIX =
  /\s*\(recipe \d\)|\s*\(set \d\)|\s*recipe \d$|\s*- trade \d recipe$|\s*ultra rare recipe$/g;
// Does this page belong to this recipe? The CSV shortens some names (drops a
// "Mythic " prefix, adds a "(Recipe 2)" disambiguator, names a companion
// generically), so the test is that the title RELATES to the name, not that it
// equals it. Shared so the refresh script accepts exactly the pages the check
// will later read -- a fetcher with a looser idea of "right page" would file a
// wrong page under a right-looking slug.
export function titleRelates(name, h1) {
  if (!h1) return false;
  const a = key(name).replace(VARIANT_SUFFIX, '').trim();
  const b = key(h1);
  return b === a || b === 'mythic ' + a || b.startsWith(a + ' ') || a.startsWith(b);
}
export function deriveSlug(name) {
  const base = key(name).replace(VARIANT_SUFFIX, '').trim();
  return base.replace(/['+]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}


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


// ------------------------------------------------------------------ exports --
export {
  dec, txt, matchBlock, parseList, blocks, recipeLists,
  TRADE, TRACKED, n, key, bare, parsePlain, splitTopLevelOr, parseItem,
  parseCSV, reconcile,
};
