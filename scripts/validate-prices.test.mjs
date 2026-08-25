// Mutation test for validate-prices.mjs.
//
// A validator that has never seen a defect is a validator nobody has tested.
// This copies public/data, injects exactly one known defect into the copy, and
// asserts the matching check reports it — one case per defect class the six
// checks exist to catch. The repo's own data is never written to.
//
// Cases are pinned to specific rows, so a re-export can move a target out from
// under one. That is why each case verifies its edit actually landed: a stale
// target reports STALE (fix the case), which is a different problem from
// MISSED (fix the validator).
//
// Run: node scripts/validate-prices.test.mjs

import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'public', 'data');
const SCRIPT = join(here, 'validate-prices.mjs');
const WORK = mkdtempSync(join(tmpdir(), 'validate-prices-'));
const TMP = join(WORK, 'data');

const run = () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--data', TMP], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const fresh = () => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); cpSync(SRC, TMP, { recursive: true }); };
const lines = (t) => t.split('\n');
let touched = false;
const edit = (file, fn) => {
  const p = join(TMP, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) touched = true;
  writeFileSync(p, after);
};

// [name, mutate, expected message, level] — level defaults to 'error', meaning
// the run must also exit non-zero. 'warn' cases must be reported and must NOT
// fail the run.
const cases = [
  ['1  min/max broken', () => edit('prices.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202642,2026,42,Aragonite,15,'));
    L[i] = L[i].replace(',Aragonite,15,', ',Aragonite,19,'); return L.join('\n');
  }), /prices\.csv has \[12\.59, 19\] but its .* lot\(s\) give \[12\.59, 15\]/],

  ['1  item dropped from prices.csv', () => edit('prices.csv', (t) =>
    lines(t).filter((l) => !l.startsWith('202642,2026,42,Aragonite,')).join('\n')),
    /202642 "Aragonite": 12 lot\(s\) in rawPricesData but no row in prices\.csv/, 'warn'],

  ['2  price block copied onto another auction', () => edit('prices.csv', (t) => {
    const L = lines(t);
    const donor = L.filter((l) => l.startsWith('202641,'));
    const kept = L.filter((l) => !l.startsWith('202642,'));
    return [...kept, ...donor.map((l) => l.replace(/^202641,2026,41,/, '202642,2026,42,'))].join('\n');
  }), /have identical price blocks/],

  ['3  a lot not divided down to its per-token price', () => edit('rawPricesData.csv', (t) =>
    t.replace('20253,2025,3,10x Dwarven Steels #8,$43.00,Dwarven Steel,$4.30,Trade 1',
              '20253,2025,3,10x Dwarven Steels #8,$43.00,Dwarven Steel,$43.00,Trade 1')),
    /\$43 \/ 10 = \$4\.3 but Price is \$43/],

  ['3  lot size stated twice, disagreeing', () => edit('rawPricesData.csv', (t) =>
    t.replace('"1,000 GP Gold Bar x4 #9 (4 Tokens)"', '"1,000 GP Gold Bar x2 #9 (4 Tokens)"')),
    /lot size stated twice and they disagree/],

  ['4  auctionId not season+number', () => edit('auctionMetadata.csv', (t) =>
    t.replace('\n202642,2026,42,', '\n202641,2026,42,')),
    /auctionId is not season\+number/],

  ['4  auctionNumber collision', () => edit('auctionMetadata.csv', (t) =>
    t.replace('\n202642,2026,42,', '\n202642,2026,41,')),
    /auctionNumber 41 used by/],

  ['4  unpadded date', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',2026-02-22,', ',2026-2-22,')),
    /is not zero-padded YYYY-MM-DD/],

  ['4  daysToClose disagrees with the dates', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202642,'));
    const c = L[i].split(','); const d = c.indexOf('Closed'); c[d - 1] = String(Number(c[d - 1]) + 3);
    L[i] = c.join(','); return L.join('\n');
  }), /daysToClose is \d+ but .* day\(s\)/],

  ['5  a "-" price', () => edit('prices.csv', (t) =>
    t.replace('202642,2026,42,Aragonite,15,', '202642,2026,42,Aragonite,-,')),
    /has Price = "-"/],

  ['5  a blank price', () => edit('onyx.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('20222,'));
    L[i] = L[i].replace(/,\$[\d.]+,/, ',,'); return L.join('\n');
  }), /has Price = blank/],

  ['6  Onyx marker left in Item', () => edit('onyx.csv', (t) =>
    t.replace('20222,2022,2,+2 Chaos Cannon,', '20222,2022,2,+2 Chaos Cannon (Onyx),')),
    /the Onyx marker was not stripped from Item/],

  ['6  Onyx rows with no Onyx auctionStyle', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('20222,'));
    L[i] = L[i].replace(/Onyx Super Condensed/, 'Super Condensed'); return L.join('\n');
  }), /onyx\.csv rows but auctionStyle .* does not say Onyx/],

  ['6  half an Onyx set', () => edit('onyx.csv', (t) => {
    let n = 0;
    return lines(t).filter((l) => !(l.startsWith('20222,') && n++ < 5)).join('\n');
  }), /Onyx rows — expected 20–21 for one set/, 'warn'],

  ['6  withheld recorded as a credit', () => edit('contextItems.csv', (t) =>
    t.replace('20183,2018,3,withheld,Patron Pin,1,-$114.30', '20183,2018,3,withheld,Patron Pin,1,$114.30')),
    /withheld price \$114\.3 is positive/],

  ['6  unknown context category', () => edit('contextItems.csv', (t) =>
    t.replace('20183,2018,3,withheld,Patron Pin,', '20183,2018,3,retained,Patron Pin,')),
    /category "retained" is not one of/],

  // --- 7. closed vocabularies -----------------------------------------------
  // The defect Phase 0 actually found, reinjected: a style that differs from
  // the one beside it only in case. This is the case the dropdown is meant to
  // prevent and the validator has to catch anyway, because a paste bypasses
  // the dropdown.
  ['7  auctionStyle typo differing only in case', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',Super Condensed,Fixed Date,Wade S,', ',SUper Condensed,Fixed Date,Wade S,')),
    /auctionStyle "SUper Condensed" \(1 row\(s\)\) differs from "Super Condensed" .* only in case or spacing/],

  // An INTERNAL double space, not a trailing one. `load()` trims every value,
  // so leading and trailing whitespace provably cannot reach the repo — which
  // is a real division of labour rather than a gap: whitespace at the ends is
  // the SHEET's problem (Phase 7's dropdown and numeric validation), and what
  // gets past the export to here is case and internal spacing.
  ['7  completionStyle with an internal double space', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',Super Condensed,Fixed Date,Wade S,', ',Super Condensed,Fixed  Date,Wade S,')),
    /completionStyle "Fixed {2}Date" .* differs from "Fixed Date" .* only in case or spacing/],

  // A genuinely new auction style must NOT fail — the vocabulary grows, and a
  // validator that blocked a publish for a new format would be worse than none.
  ['7  a genuinely new auction style passes', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',Super Condensed,Fixed Date,Wade S,', ',Quantum Condensed,Fixed Date,Wade S,')),
    /auctionStyle: 9 distinct value\(s\)/, 'warn'],

  // `Status` is a formula — `IF(closeDate="","Open","Closed")` — so `Failed` is
  // unrepresentable in the sheet today (workbook-findings.md, Issue 3). The
  // check exists for the day that changes, and for a hand-edited export.
  ['7  Status outside its two values', () => edit('auctionMetadata.csv', (t) =>
    t.replace('2018-09-27,2018-09-30,3,Closed,', '2018-09-27,2018-09-30,3,Failed,')),
    /Status "Failed" is not Open or Closed/],

  ['7  augmentated says TRUE instead of Yes', () => edit('auctionMetadata.csv', (t) =>
    t.replace(/,"\$8,000\.00",No,/, ',"$8,000.00",TRUE,')),
    /augmentated "TRUE" is not Yes or No/],

  // A Category no tokenMetadata row carries is unjoinable — the site reads a
  // token's category from there, so nothing can look this one up.
  ['7  price Category not in tokenMetadata', () => edit('prices.csv', (t) =>
    t.replace('20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",Trade 2',
      '20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",Trade 9')),
    /Category "Trade 9" is in no tokenMetadata row/],

  ['7  price Category differing only in case', () => edit('prices.csv', (t) =>
    t.replace('20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",Trade 2',
      '20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",trade 2')),
    /Category "trade 2" differs from tokenMetadata's "Trade 2" only in case or spacing/],

  // § 8. All warnings: these are real defects in shipped data that a human has
  // to arbitrate, and failing the gate on one would block a publish for a row
  // nobody has been shown yet.
  ['8  one context item spelled two ways', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,bead of the  lucky traveler,1,$145.00')),
    /differs from .* only in case, spacing or apostrophe/, 'warn'],

  ['8  a curly apostrophe splits a series', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,Bead of the Lucky Traveler’s,1,$145.00')),
    /only in punctuation or a trailing plural/, 'warn'],

  // The cross-file half: a context item spelled unlike the canonical token.
  // Confined to contextItems, this pair is invisible.
  ['8  context item disagrees with tokenMetadata', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,Wish  Ring,1,$145.00')),
    /\[tokenMetadata\.csv\]|\[prices\.csv\]|\[onyx\.csv\]/, 'warn'],
];

// The shipped data must be clean first: every case below asserts that ONE
// injected defect is reported, which says nothing if the baseline is already
// failing for other reasons.
fresh();
const base = run();
if (base.code !== 0) {
  console.error('Baseline public/data does not pass validate-prices.mjs — fix that first:\n');
  console.error(base.out);
  rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
}
console.log('baseline public/data is clean\n');

let pass = 0, missed = 0, stale = 0;
for (const [name, mutate, expect, level = 'error'] of cases) {
  fresh();
  touched = false;
  mutate();
  if (!touched) { console.error(`STALE   ${name} — the row this case edits is no longer in public/data`); stale++; continue; }
  const r = run();
  const reported = expect.test(r.out);
  const exitedRight = level === 'warn' ? r.code === 0 : r.code !== 0;
  if (reported && exitedRight) { console.log(`ok      ${name}`); pass++; continue; }
  missed++;
  console.error(`MISSED  ${name}`);
  if (!reported) console.error(`        expected a report matching ${expect}`);
  if (!exitedRight) console.error(`        expected exit ${level === 'warn' ? '0 (warning only)' : 'non-zero'}, got ${r.code}`);
}

rmSync(WORK, { recursive: true, force: true });
console.log(`\n${missed || stale ? '✗ FAIL' : '✓ OK'} — ${pass} caught, ${missed} missed, ${stale} stale`);
process.exit(missed || stale ? 1 : 0);
