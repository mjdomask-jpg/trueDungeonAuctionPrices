// Tests for validate-context.mjs's withheld audit.
//
// The audit compares the live recompute against docs/withheld-recompute-preview.csv,
// an audited golden file. It used to compare the two as whole sets, which meant
// a new auction carrying withheld rows failed the PR check purely for existing
// — and since only a checkout can run gen-withheld-preview.mjs, that turned
// roughly one publish in ten into manual work at a keyboard. The comparison is
// now scoped to the intersection.
//
// That narrowing was only half the job. It let a new KEY through and still
// failed any audited value that MOVED — and an audited value moves whenever an
// auction is backfilled into a window that has already closed, which is a
// routine publish and not a defect. So the audit now records the INPUTS behind
// each value and triages instead of failing flat.
//
// Proved against a mutated copy of the data rather than by asserting the shape
// of the code:
//
//   a new auction with withheld rows     -> passes  (the 2026-09-19 block)
//   an auction backfilled into a window  -> notes   (the 2026-09-20 block, #236)
//   a value that moved with its inputs
//     unchanged                          -> fails   (the audit's whole purpose)
//   a preview with no recorded inputs    -> notes   (unverified, not incorrect)
//   a withheld row that disappeared      -> warns   (visible, not a blocker)
//
// The repo's own public/data and docs are never written to; everything runs
// against a temp copy via --data / --docs.
//
// Run: node scripts/validate-context.test.mjs

import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repoData = join(here, '..', 'public', 'data');
const repoDocs = join(here, '..', 'docs');
const script = join(here, 'validate-context.mjs');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`ok      ${name}`); pass++; return; }
  console.error(`FAIL    ${name}`);
  if (detail) console.error(String(detail).split('\n').slice(0, 10).map((l) => '        ' + l).join('\n'));
  fail++;
};

// Each case gets its own pristine copy, so one cannot contaminate the next.
function withCopy(mutate) {
  const work = mkdtempSync(join(tmpdir(), 'validate-context-'));
  const data = join(work, 'data'), docs = join(work, 'docs');
  cpSync(repoData, data, { recursive: true });
  mkdirSync(docs, { recursive: true });
  cpSync(join(repoDocs, 'withheld-recompute-preview.csv'), join(docs, 'withheld-recompute-preview.csv'));
  try {
    const readFile = (f) => readFileSync(join(data, f), 'utf8');
    const writeFile = (f, t) => writeFileSync(join(data, f), t);
    const readDoc = (f) => readFileSync(join(docs, f), 'utf8');
    const writeDoc = (f, t) => writeFileSync(join(docs, f), t);
    mutate({ readFile, writeFile }, { readDoc, writeDoc });
    const r = spawnSync(process.execPath, [script, '--data', data, '--docs', docs], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const append = (text, line) => text.replace(/\n?$/, '\n') + line + '\n';

// auctionMetadata quotes any field holding a comma — an auction name, and every
// money column. A plain split(',') shifts every index past the first such field,
// so closeDate stops being closeDate on exactly the rows most likely to matter.
const cells = (line) => {
  const out = []; let f = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out;
};
const CLOSE_DATE = 9; // auctionId,season,number,name,style,completion,auctioneer,Link,openDate,closeDate

console.log('Withheld audit\n');

// Baseline: the shipped data must pass, or nothing below means anything.
//
// THIS USED TO ASSERT `0 new, 0 gone`, WHICH PUT THE BLOCK BACK. The validator
// was narrowed to the intersection precisely so a publish carrying new withheld
// rows would not need a checkout — and then this line required the shipped repo
// to have no new rows, which is the same demand one layer down. On 2026-09-19
// the first 2027 close (20275, nine withheld Random Ultra Rares) reported
// "95 rows vs 84 audited" and failed here, second in the `npm test` chain, on a
// publish PR. Running `gen-withheld-preview.mjs` made it pass — and the
// validator itself had been green the whole time, with all 73 audited values
// matching to the cent. Nothing was ever wrong with the data.
//
// So the baseline asserts what a baseline is for and nothing more: the shipped
// data passes, and it is actually being compared against something. A count of
// new rows is a fact about how recently someone regenerated a golden file,
// which is not a property of the data and must never gate a publish.
const base = withCopy(() => {});
check('the shipped data passes the audit', base.code === 0, base.out);
const sharedCount = Number((base.out.match(/\((\d+) shared,/) || [])[1]);
check('the audit is comparing against a non-empty set of audited values',
  sharedCount > 0, base.out);

// 1. A NEW auction carrying withheld rows. This is the publish that used to
//    block, and the operator should never need a checkout for it.
const added = withCopy(({ readFile, writeFile }) => {
  const cols = readFile('auctionMetadata.csv').split('\n')[0].split(',').length;
  const row = ['202699', '2026', '99', 'Synthetic', 'Ultra Condensed', 'Lightning', 'Trent',
    'https://truedungeon.com/x', '2026-08-01', '2026-08-20', '19', 'Closed', '1', '1',
    '"$8,000.00"', 'No', '', '', '', '$0.00', '"$8,000.00"', '$0.00'].slice(0, cols).join(',');
  writeFile('auctionMetadata.csv', append(readFile('auctionMetadata.csv'), row));
  writeFile('prices.csv', append(readFile('prices.csv'),
    '202699,2026,99,Ultra Rare,95,Ultra Rare,Ultra Rare\n202699,2026,99,Ultra Rare,70,Ultra Rare,Ultra Rare'));
  writeFile('contextItems.csv', append(readFile('contextItems.csv'), '202699,2026,99,withheld,Ultra Rare,2,'));
});
check('a new auction with withheld rows PASSES', added.code === 0, added.out);
// Measured as a DELTA against the baseline, not as the absolute `1`.
//
// The absolute number is the repo's un-audited backlog plus this one synthetic
// row, so pinning it says "the golden file is fully caught up" — the same
// demand the baseline above used to make, hiding one line further down. It
// failed the moment the preview lagged by anything, which is the one state
// this case exists to bless.
//
// What is actually being asserted is that adding a withheld row adds exactly
// one un-audited key and changes nothing else. That holds whatever the backlog
// is, and it is the property that makes the narrowing safe: valueWithheld only
// reads sales closing STRICTLY BEFORE the withheld auction, so a later auction
// cannot reach back into a window that is already closed.
const newRows = (out) => Number((out.match(/(\d+) shared, (\d+) new/) || [])[2]);
check('the new row is reported as new data, not as drift',
  newRows(added.out) === newRows(base.out) + 1,
  `baseline ${newRows(base.out)} new, with the synthetic row ${newRows(added.out)}\n${added.out}`);
check('and it does not disturb any audited value',
  sharedCount > 0 && Number((added.out.match(/\((\d+) shared,/) || [])[1]) === sharedCount, added.out);

// 2. An audited value that MOVED. It has to be a price in a PRIOR auction:
//    the estimate reads sales closing strictly before the withheld auction, so
//    the auction's own prices sit outside its own window. That is the same
//    property that makes case 1 safe, seen from the other side.
const drifted = withCopy(({ readFile, writeFile }) => {
  const withheldRow = readFile('contextItems.csv').split('\n').find((l) => /,withheld,/.test(l)).split(',');
  const [auctionId, season] = withheldRow;
  const item = withheldRow[4];
  const closeOf = new Map(readFile('auctionMetadata.csv').split('\n').slice(1)
    .map((l) => l.split(',')).filter((c) => c[0]).map((c) => [c[0], c[8]]));
  const lines = readFile('prices.csv').split('\n');
  const i = lines.findIndex((l) => {
    const c = l.split(',');
    return c[1] === season && c[5] === item && closeOf.get(c[0]) && closeOf.get(c[0]) < closeOf.get(auctionId);
  });
  if (i === -1) throw new Error(`no prior ${season} sale of "${item}" to perturb`);
  const c = lines[i].split(',');
  c[4] = String(Number(c[4]) * 4 + 5);
  lines[i] = c.join(',');
  writeFile('prices.csv', lines.join('\n'));
});
check('a drifted audited value still FAILS', drifted.code !== 0, drifted.out);
check('the failure names the drift and how to resolve it',
  /drifted from the audited preview/.test(drifted.out) && /gen-withheld-preview\.mjs/.test(drifted.out), drifted.out);

// 2b. The same value moving, but because its INPUTS moved: an auction
//     BACKFILLED into a window that was already audited.
//
//     This is the case that reddened PR #236 and it is the reason case 2 above
//     is no longer the whole story. The narrowing used to rest on "a new
//     auction cannot move an old estimate, because valueWithheld only reads
//     sales closing strictly before the withheld auction" — which confuses
//     RECORDED later with CLOSED later. Seven Trent auctions closing
//     2026-09-19 were filled in on 2026-09-20; 20274 closes 2026-09-20, so
//     every one of them landed inside its window and its `Ultra Rare` estimate
//     moved -502.62 -> -593.42. Correct data, correct recompute, red publish —
//     and unfixable from main, since the data producing the new value lives
//     only on the publish branch.
//
//     So it must NOT block, and it must say which auctions entered.
const backfilled = withCopy(({ readFile, writeFile }) => {
  const withheldRow = readFile('contextItems.csv').split('\n').find((l) => /,withheld,/.test(l)).split(',');
  const [auctionId, season] = withheldRow;
  const item = withheldRow[4];
  const close = readFile('auctionMetadata.csv').split('\n').slice(1)
    .map(cells).find((c) => c[0] === auctionId)[CLOSE_DATE];
  // The day BEFORE the withheld auction closes: the latest an auction can close
  // and still be prior, so it is certain to enter the 5-most-recent window.
  const d = new Date(close + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  const eve = d.toISOString().slice(0, 10);
  const cols = readFile('auctionMetadata.csv').split('\n')[0].split(',').length;
  const row = ['999999', season, '98', 'Synthetic backfill', 'Ultra Condensed', 'Lightning', 'Tester',
    'https://truedungeon.com/x', eve, eve, '1', 'Closed', '1', '1', '"$8,000.00"', 'No',
    '', '', '', '$0.00', '"$8,000.00"', '$0.00'].slice(0, cols).join(',');
  writeFile('auctionMetadata.csv', append(readFile('auctionMetadata.csv'), row));
  writeFile('prices.csv', append(readFile('prices.csv'),
    `999999,${season},98,${item},9999,${item},${item}`));
});
check('an auction BACKFILLED into an audited window does not block', backfilled.code === 0, backfilled.out);
check('...and it is reported as inputs moving, naming what entered the lookback',
  /inputs did \(\+999999/.test(backfilled.out), backfilled.out);
check('...and is never called drift, which is what a red check would have claimed',
  !/drifted from the audited preview/.test(backfilled.out), backfilled.out);

// 2c. The guard cannot be armed by a preview that predates `lookback_auctions`.
//     Such a file cannot be asked which auctions fed a value, so every moved
//     value is UNVERIFIED, not incorrect — onyxcheck's precedent — and it says
//     so on every run rather than going quietly green.
const legacyPreview = withCopy(({ readFile, writeFile }, { readDoc, writeDoc }) => {
  const lines = readDoc('withheld-recompute-preview.csv').split('\n');
  const cut = lines[0].split(',').indexOf('lookback_auctions');
  writeDoc('withheld-recompute-preview.csv',
    lines.map((l) => (l.trim() ? l.split(',').filter((_, i) => i !== cut).join(',') : l)).join('\n'));
  // ...and move a value, so there is something for it to fail to triage.
  const withheldRow = readFile('contextItems.csv').split('\n').find((l) => /,withheld,/.test(l)).split(',');
  const [auctionId, season] = withheldRow;
  const item = withheldRow[4];
  const closeOf = new Map(readFile('auctionMetadata.csv').split('\n').slice(1)
    .map(cells).filter((c) => c[0]).map((c) => [c[0], c[CLOSE_DATE]]));
  const pl = readFile('prices.csv').split('\n');
  const i = pl.findIndex((l) => {
    const c = l.split(',');
    return c[1] === season && c[5] === item && closeOf.get(c[0]) && closeOf.get(c[0]) < closeOf.get(auctionId);
  });
  const c = pl[i].split(','); c[4] = String(Number(c[4]) * 4 + 5); pl[i] = c.join(',');
  writeFile('prices.csv', pl.join('\n'));
});
check('a preview with no recorded lookback cannot block a publish', legacyPreview.code === 0, legacyPreview.out);
check('...and names the column it is missing and how to get it',
  /predates the lookback_auctions column/.test(legacyPreview.out) &&
  /gen-withheld-preview\.mjs/.test(legacyPreview.out), legacyPreview.out);

// 3. A withheld row that DISAPPEARED. Visible, but not a blocker — the
//    publisher's row-delta guard is what stops a mass deletion.
const removed = withCopy(({ readFile, writeFile }) => {
  const lines = readFile('contextItems.csv').split('\n');
  lines.splice(lines.findIndex((l) => /,withheld,/.test(l)), 1);
  writeFile('contextItems.csv', lines.join('\n'));
});
check('a removed withheld row WARNS but does not block', removed.code === 0, removed.out);
check('the removal is named rather than absorbed silently',
  /no longer present/.test(removed.out), removed.out);

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
