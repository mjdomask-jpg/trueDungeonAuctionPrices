// Tests for validate-context.mjs's withheld audit.
//
// The audit compares the live recompute against docs/withheld-recompute-preview.csv,
// an audited golden file. It used to compare the two as whole sets, which meant
// a new auction carrying withheld rows failed the PR check purely for existing
// — and since only a checkout can run gen-withheld-preview.mjs, that turned
// roughly one publish in ten into manual work at a keyboard. The comparison is
// now scoped to the intersection.
//
// That narrowing is only safe if it still catches real drift, so this proves
// all three behaviours against a mutated copy of the data rather than asserting
// the shape of the code:
//
//   a new auction with withheld rows  -> passes  (the case that blocked)
//   an audited value that moved       -> fails   (the audit's whole purpose)
//   a withheld row that disappeared   -> warns   (visible, not a blocker)
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
    mutate({ readFile, writeFile });
    const r = spawnSync(process.execPath, [script, '--data', data, '--docs', docs], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const append = (text, line) => text.replace(/\n?$/, '\n') + line + '\n';

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
