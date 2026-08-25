// Tests for apps-script/publishToSite.gs — Phase 3 of data-pipeline-plan.md.
//
// The script runs inside Google Apps Script, where nothing can test it. Its
// pure core is therefore written with no SpreadsheetApp / UrlFetchApp
// dependency so it can be loaded here and exercised against real data.
//
// Three kinds of test:
//
//   1. ROUND-TRIP FIDELITY, and it is the one that matters. Every shipped CSV
//      is parsed to a grid of display values and re-serialised, and the result
//      must equal the file BYTE FOR BYTE. Those files came from Google's own
//      Download as CSV, so reproducing them exactly is the proof that the
//      script's serialiser writes what Google writes — quoting, embedded
//      commas and quotes, CRLF, and the absent trailing newline. Get any of
//      those wrong and the first publish rewrites all eight files and buries
//      the real change; get the quoting wrong and it corrupts the data.
//      rawPricesData.csv is the real exercise: 18,466 rows and 1,452 lines
//      carrying quoted fields with commas inside ("1,000 GP Gold Bar").
//
//   2. THE ALLOW-LIST GUARD. The two hand-authored files must be refused, and
//      so must anything not on the list. This is the single most destructive
//      thing the phase could do, so it is attacked directly.
//
//   3. THE PREFLIGHTS AND THE DIFF. Each preflight gets a fault injected into
//      real data and must fire; the diff must skip a byte-identical file and
//      must not skip a changed one.
//
// Run: node scripts/publish-to-site.test.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const dataDir = join(repoRoot, 'public', 'data');

// --- load the Apps Script's pure core ---------------------------------------
// A .gs file is plain JavaScript with no import/export, so it evaluates
// directly. Its module.exports guard hands back the pure functions; everything
// that touches SpreadsheetApp or UrlFetchApp is only ever defined here, never
// called.
const sandbox = { module: { exports: {} }, console };
runInNewContext(readFileSync(join(repoRoot, 'apps-script', 'publishToSite.gs'), 'utf8'), sandbox);
const P = sandbox.module.exports;

let pass = 0, fail = 0;
const ok = (name) => { console.log(`ok      ${name}`); pass++; };
const bad = (name, detail) => { console.error(`FAIL    ${name}`); if (detail) console.error(String(detail).split('\n').map((l) => '        ' + l).join('\n')); fail++; };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));

const sheetBacked = P.PUBLISH_FILES.map((f) => f.file);
const readCsv = (file) => readFileSync(join(dataDir, file), 'utf8');

// ===========================================================================
// 1. Serialisation fidelity — the shipped CSVs, byte for byte
// ===========================================================================
console.log('Serialisation fidelity\n');
{
  // Every one of the ten, not just the eight: derivedPrices.csv and
  // tokenGroups.csv are never published, but they are the only files in the
  // repo written by hand rather than exported, so they are the only evidence
  // that the serialiser is not merely reproducing one tool's quirks.
  const all = readdirSync(dataDir).filter((f) => f.endsWith('.csv')).sort();
  check('all ten CSVs are present', all.length === 10, all.join(', '));

  // The line endings on disk depend on the CHECKOUT, not on the data: this
  // machine has core.autocrlf=true so the working tree is CRLF, while CI on
  // Linux checks the same commit out as LF. The serialiser always writes
  // Google's shape (CRLF), so compare against whichever shape this checkout
  // has — the quoting, the field content and the absent trailing newline are
  // what the comparison is actually for, and none of them depends on the
  // checkout.
  const diskIsCrlf = readCsv('prices.csv').includes('\r\n');
  console.log(`        (working tree is ${diskIsCrlf ? 'CRLF' : 'LF'}; the repository stores LF either way)\n`);

  const broken = [];
  for (const file of all) {
    const text = readCsv(file);
    const grid = P.publishParseCsv(text);
    let round = P.publishSerializeCsv(grid);
    if (!diskIsCrlf) round = P.publishRepoText(round);
    // The two hand-authored files end with a line break that Google's export
    // does not write. The serialiser follows Google, so allow that one
    // difference for the files it will never touch.
    if (!sheetBacked.includes(file) && /\r?\n$/.test(text)) round += diskIsCrlf ? '\r\n' : '\n';
    if (round !== text) {
      let at = 0;
      while (at < round.length && at < text.length && round[at] === text[at]) at++;
      broken.push(`${file}: diverges at byte ${at}\n  want ${JSON.stringify(text.slice(Math.max(0, at - 30), at + 30))}` +
        `\n  got  ${JSON.stringify(round.slice(Math.max(0, at - 30), at + 30))}`);
    }
  }
  check('every shipped CSV round-trips byte for byte', !broken.length, broken.join('\n'));

  // Name the properties the round-trip is silently asserting, so a future
  // change that breaks one gets a message rather than a byte offset.
  const raw = readCsv('rawPricesData.csv');
  check('rawPricesData.csv is the real exercise: 18,466 rows',
    P.publishParseCsv(raw).length - 1 === 18466, String(P.publishParseCsv(raw).length - 1));
  check('...with quoted fields carrying commas', raw.includes('"1,000 GP Gold Bar'));
  check('the serialiser writes CRLF between rows and NOTHING after the last one',
    P.publishSerializeCsv([['a', 'b'], ['c', 'd']]) === 'a,b\r\nc,d',
    JSON.stringify(P.publishSerializeCsv([['a', 'b'], ['c', 'd']])));
  check('a one-row grid gets no line break at all',
    P.publishSerializeCsv([['only']]) === 'only');
  check('the shipped files carry no trailing line break either',
    sheetBacked.every((f) => !readCsv(f).endsWith('\n')),
    sheetBacked.filter((f) => readCsv(f).endsWith('\n')).join(', '));

  const cases = [
    ['plain', 'plain'],
    ['1,000 GP Gold Bar', '"1,000 GP Gold Bar"'],
    ['say "hi"', '"say ""hi"""'],
    ['$110.00 ', '$110.00 '],          // trailing space: unquoted, and kept
    [' leading', ' leading'],
    ['two\r\nlines', '"two\r\nlines"'],
    ['', ''],
    [null, ''],
  ];
  const wrong = cases.filter(([v, want]) => P.publishCsvField(v) !== want)
    .map(([v, want]) => `${JSON.stringify(v)} -> ${JSON.stringify(P.publishCsvField(v))}, expected ${JSON.stringify(want)}`);
  check('fields are quoted only when they must be, and never trimmed', !wrong.length, wrong.join('\n'));
}

// ===========================================================================
// 2. The diff: git blob shas, computed without downloading anything
// ===========================================================================
console.log('\nDiff by git blob sha\n');
{
  const gitSha = (text) => createHash('sha1').update(Buffer.from(P.publishGitBlobPreimage(text), 'utf8')).digest('hex');
  const repoSha = (file) => gitSha(P.publishRepoText(readCsv(file)));

  // The repository stores LF and the working tree holds CRLF — `core.autocrlf`
  // strips the CR on commit. Measured, not assumed: onyx.csv is 78,764 bytes
  // on disk and 77,752 in the repo, one byte per line separator. The GitHub API
  // writes raw bytes with no normalisation, so committing the CRLF text would
  // rewrite all eight files on the first publish AND leave the diff permanently
  // broken, since a CRLF blob can never hash to the LF sha in the tree.
  check('the repo shape is the CSV with its CRs stripped, and nothing else',
    P.publishRepoText('a,b\r\nc,d') === 'a,b\nc,d' && P.publishRepoText('a,b\nc,d') === 'a,b\nc,d');

  // git ls-files -s prints the blob sha git itself recorded, so this compares
  // the script's hash against git's own answer rather than against another
  // implementation of the same idea.
  let indexed = null;
  try {
    indexed = Object.fromEntries(execFileSync('git', ['ls-files', '-s', 'public/data'], { cwd: repoRoot, encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .map((line) => { const [meta, path] = line.split('\t'); return [path.split('/').pop(), meta.split(' ')[1]]; }));
  } catch { /* not a git checkout; the round-trip tests still stand */ }

  if (indexed && Object.keys(indexed).length === 10) {
    const mismatched = Object.keys(indexed).filter((f) => repoSha(f) !== indexed[f]);
    check('the blob sha matches what git recorded, for all ten files', !mismatched.length,
      mismatched.map((f) => `${f}: ${repoSha(f)} != ${indexed[f]}`).join('\n'));
    check('hashing the CRLF text instead would match nothing — the diff would never skip a file',
      Object.keys(indexed).every((f) => readCsv(f).includes('\r\n') ? gitSha(readCsv(f)) !== indexed[f] : true));
  } else {
    console.log('skip    git index unavailable — blob sha compared against a known value instead');
    check('the blob sha of the empty string is git\'s',
      gitSha('') === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  }

  // The length in the preimage is the BYTE length. Any file carrying a
  // multi-byte character gets a wrong sha from a character count, so it would
  // read as changed on every publish and the diff would never skip anything.
  //
  // DERIVED, not listed. This named three files until 2026-08-24, when
  // straightening two curly apostrophes left tokenMetadata and transmuteRecipes
  // pure ASCII and the hard-coded three became a failing assertion about data
  // rather than about the code. What the check is really for is that
  // publishUtf8ByteLength counts bytes — so find the files that can show it.
  const multiByte = readdirSync(dataDir).filter((f) => f.endsWith('.csv'))
    .filter((f) => Buffer.byteLength(readCsv(f), 'utf8') !== readCsv(f).length);
  check('at least one published file carries a multi-byte character, so this is not vacuous',
    multiByte.length > 0,
    'every published CSV is pure ASCII — this check can no longer demonstrate anything');
  const lengthAgrees = multiByte.filter((f) => P.publishUtf8ByteLength(readCsv(f)) === readCsv(f).length);
  check(`UTF-8 byte length differs from character length on all ${multiByte.length} multi-byte file(s)`,
    !lengthAgrees.length, `character count would have sufficed for: ${lengthAgrees.join(', ')}`);
  const wrongLen = ['a', 'é', '’', '中', '😀', 'Adventurers’ Guild']
    .filter((s) => P.publishUtf8ByteLength(s) !== Buffer.byteLength(s, 'utf8'));
  check('UTF-8 byte length agrees with Node for 1-, 2-, 3- and 4-byte characters', !wrongLen.length,
    wrongLen.map((s) => `${JSON.stringify(s)}: ${P.publishUtf8ByteLength(s)} != ${Buffer.byteLength(s, 'utf8')}`).join('\n'));
}

// ===========================================================================
// 3. The allow-list — the guard on the one destructive mistake available here
// ===========================================================================
console.log('\nThe allow-list\n');
{
  check('the configuration table itself is clean', !P.publishConfigProblems().length,
    P.publishConfigProblems().join('\n'));

  check('exactly eight files are publishable', P.PUBLISH_FILES.length === 8,
    sheetBacked.join(', '));

  const onDisk = readdirSync(dataDir).filter((f) => f.endsWith('.csv')).sort();
  const expected = onDisk.filter((f) => !P.PUBLISH_NEVER.includes(f));
  check('the allow-list is exactly the CSVs on disk minus the two hand-authored ones',
    sheetBacked.slice().sort().join(',') === expected.join(','),
    `allow-list: ${sheetBacked.slice().sort().join(',')}\non disk:    ${expected.join(',')}`);

  for (const file of P.PUBLISH_NEVER) {
    check(`${file} is refused — it is hand-authored and has no tab`, P.publishFileRefusal(file) !== null,
      P.publishFileRefusal(file));
  }
  for (const file of ['auctionPricesOLD.csv', 'transmutesOLD.csv', 'prices.csv.bak', '', 'anything.csv']) {
    check(`${JSON.stringify(file)} is refused — not on the allow-list`, P.publishFileRefusal(file) !== null);
  }
  check('every allow-listed file is accepted',
    sheetBacked.every((f) => P.publishFileRefusal(f) === null),
    sheetBacked.filter((f) => P.publishFileRefusal(f) !== null).join(', '));

  // The plan-level guard, not just the helper: a hand-authored file smuggled
  // into a plan must abort the whole run, not merely be skipped.
  const smuggled = P.publishPlan([{
    file: 'tokenGroups.csv', tab: 'tokenGroups', grid: [['Category'], ['Trade 1']],
    text: 'Category\r\nTrade 1', sha: 'deadbeef', previous: null,
  }]);
  check('a hand-authored file inside a plan aborts the whole publish',
    !smuggled.ok && smuggled.aborts.some((a) => /hand-authored/.test(a)) && !smuggled.changed.length,
    JSON.stringify(smuggled.aborts));
}

// ===========================================================================
// 4. Preflight — one injected fault per check, against real data
// ===========================================================================
console.log('\nPreflight checks\n');

/** A real file's grid, with one cell replaced. */
function gridWith(file, row, column, value) {
  const grid = P.publishParseCsv(readCsv(file));
  const col = grid[0].indexOf(column);
  if (col === -1) throw new Error(`${file} has no column ${column}`);
  grid[row][col] = value;
  return grid;
}

{
  const clean = Object.fromEntries(sheetBacked.map((f) => [f, P.publishParseCsv(readCsv(f))]));

  // --- error cells ---------------------------------------------------------
  for (const token of ['#N/A', '#REF!', '#VALUE!', '#DIV/0!', 'No Match Found']) {
    const grid = gridWith('prices.csv', 5, 'Display Name', token);
    check(`error text ${token} in any cell is caught`,
      P.publishScanErrorCells('prices.csv', grid).length === 1,
      JSON.stringify(P.publishScanErrorCells('prices.csv', grid)));
  }
  check('a broken reference concatenated into a key is caught too',
    P.publishScanErrorCells('tokenMetadata.csv', gridWith('tokenMetadata.csv', 3, 'key', '2026#REF!')).length === 1);
  check('a lot number is not mistaken for an error',
    !P.publishScanErrorCells('rawPricesData.csv',
      gridWith('rawPricesData.csv', 4, 'trentName', '1,000 GP Gold Bar #44 (4 Tokens)')).length);

  // --- non-numeric price ---------------------------------------------------
  for (const [file, column] of [['prices.csv', 'Price'], ['onyx.csv', 'Price'], ['rawPricesData.csv', 'trentPrice']]) {
    check(`a "-" in ${file} ${column} is caught`,
      P.publishCheckPrices(file, gridWith(file, 7, column, '-')).length === 1);
    check(`a BLANK in ${file} ${column} is caught — the dangerous one`,
      P.publishCheckPrices(file, gridWith(file, 7, column, '')).length === 1);
  }
  check('$ and thousands separators still parse as numbers',
    !P.publishCheckPrices('prices.csv', gridWith('prices.csv', 7, 'Price', '$1,160.00 ')).length,
    JSON.stringify(P.publishCheckPrices('prices.csv', gridWith('prices.csv', 7, 'Price', '$1,160.00 '))));
  check('a renamed Price column is caught',
    P.publishCheckPrices('prices.csv', gridWith('prices.csv', 0, 'Price', 'price')).length >= 1);
  check("contextItems' priceAugmented is deliberately not price-checked — a withheld row has no price",
    !P.publishCheckPrices('contextItems.csv', clean['contextItems.csv']).length);

  // --- missing auctionId ---------------------------------------------------
  for (const file of ['auctionMetadata.csv', 'prices.csv', 'onyx.csv', 'contextItems.csv', 'rawPricesData.csv']) {
    check(`a row in ${file} with no auctionId is caught`,
      P.publishCheckAuctionIds(file, gridWith(file, 9, 'auctionId', '')).length === 1);
  }
  {
    const grid = P.publishParseCsv(readCsv('prices.csv'));
    grid.push(grid[0].map(() => ''));
    check('a wholly blank row is not a missing auctionId — the site drops it on load',
      !P.publishCheckAuctionIds('prices.csv', grid).length);
  }
  check('a file with no auctionId column is not checked for one',
    !P.publishCheckAuctionIds('tokenMetadata.csv', clean['tokenMetadata.csv']).length);

  // --- row-count delta -----------------------------------------------------
  check('an emptied tab always aborts', P.publishCheckRowDelta('prices.csv', 0, 7753).length === 1);
  check('an emptied tab aborts even with no previous to compare',
    P.publishCheckRowDelta('prices.csv', 0, null).length === 1);
  check('a truncated rawPricesData aborts (18,466 -> 12,000)',
    P.publishCheckRowDelta('rawPricesData.csv', 12000, 18466).length === 1);
  check('a small correction is allowed (18,466 -> 18,400, 66 rows)',
    !P.publishCheckRowDelta('rawPricesData.csv', 18400, 18466).length);
  check('a tiny file may lose up to 3 rows (26 -> 23) but not 4 (26 -> 22)',
    !P.publishCheckRowDelta('offAuctionPrices.csv', 23, 26).length &&
    P.publishCheckRowDelta('offAuctionPrices.csv', 22, 26).length === 1);
  check('a Trent import\'s growth is allowed (7,753 -> 7,790)',
    !P.publishCheckRowDelta('prices.csv', 7790, 7753).length);
  check('a duplicated block\'s growth is refused (7,753 -> 15,506)',
    P.publishCheckRowDelta('prices.csv', 15506, 7753).length === 1);
  check('no previous file means no delta to judge', !P.publishCheckRowDelta('prices.csv', 40, null).length);

  // --- header drift --------------------------------------------------------
  const header = clean['prices.csv'][0];
  check('an unchanged header raises nothing', P.publishHeaderDrift('prices.csv', header, header.slice()) === null);
  check('a renamed column is surfaced',
    /header row changed/.test(P.publishHeaderDrift('prices.csv', ['auctionId', 'season'], ['auctionId', 'auctionSeason']) || ''));
  check('a header change is a CAUTION, not an abort — adding a column is legitimate', (() => {
    const plan = P.publishPlan([{
      file: 'prices.csv', tab: 'prices', grid: [['auctionId', 'Price', 'Extra'], ['202647', '55', 'x']],
      text: 'x', sha: 'new', previous: { sha: 'old', rows: 1, header: ['auctionId', 'Price'] },
    }]);
    return plan.ok && plan.cautions.some((c) => /header row changed/.test(c)) && plan.changed.length === 1;
  })());
}

// ===========================================================================
// 5. The plan: diffing, skipping, and the shape of what gets committed
// ===========================================================================
console.log('\nThe publish plan\n');
{
  const entry = (file, sha, previousSha, rows) => {
    const grid = P.publishParseCsv(readCsv(file));
    if (rows !== undefined) grid.length = rows + 1;
    const text = P.publishSerializeCsv(grid);
    return { file, tab: file.replace(/\.csv$/, ''), grid, text, sha, previous: previousSha === null ? null
      : { sha: previousSha, rows: P.publishParseCsv(readCsv(file)).length - 1, header: grid[0] } };
  };

  const same = P.publishPlan([entry('onyx.csv', 'abc', 'abc')]);
  check('a byte-identical file is skipped, not committed',
    same.ok && !same.changed.length && same.unchanged.length === 1, JSON.stringify(same.aborts));
  check('a publish with nothing to do says so',
    same.cautions.some((c) => /Nothing changed/.test(c)), JSON.stringify(same.cautions));

  const moved = P.publishPlan([entry('onyx.csv', 'abc', 'abc'), entry('prices.csv', 'new', 'old')]);
  check('only the changed file is committed', moved.ok && moved.changed.length === 1 &&
    moved.changed[0].file === 'prices.csv' && moved.unchanged.length === 1, JSON.stringify(moved));
  check('the plan carries Google\'s shape for display and git\'s shape for the commit',
    moved.changed[0].text.includes('\r\n') && !moved.changed[0].blob.includes('\r') &&
    moved.changed[0].blob === P.publishRepoText(moved.changed[0].text));
  check('what gets committed hashes to the sha the diff was decided on', (() => {
    const grid = P.publishParseCsv(readCsv('onyx.csv'));
    const blob = P.publishRepoText(P.publishSerializeCsv(grid));
    const sha = createHash('sha1').update(Buffer.from(P.publishGitBlobPreimage(blob), 'utf8')).digest('hex');
    const plan = P.publishPlan([{ file: 'onyx.csv', tab: 'onyx', grid, text: P.publishSerializeCsv(grid), blob, sha, previous: null }]);
    return plan.ok && plan.changed[0].blob === blob;
  })());

  const message = P.publishCommitMessage(moved);
  check('the commit message names the file and the row move',
    /^Publish from sheet: prices\.csv$/m.test(message) && /prices\.csv: 7753 -> 7753 rows/.test(message), message);
  check('the commit message names the script version', message.includes(P.PUBLISH_SCRIPT_VERSION));

  const many = P.publishPlan(['prices.csv', 'onyx.csv', 'contextItems.csv', 'tokenMetadata.csv']
    .map((f) => entry(f, 'new-' + f, 'old-' + f)));
  check('four files collapse to one commit subject',
    /^Publish from sheet: 4 data files$/m.test(P.publishCommitMessage(many)), P.publishCommitMessage(many));
  check('all four are in ONE plan, so they land as one commit', many.changed.length === 4);

  const body = P.publishPullRequestBody(moved);
  check('the PR body tabulates every changed file', /\| `prices\.csv` \| 7753 \|/.test(body), body);

  check('the branch is never the base branch',
    P.publishBranchName('2026-08-21-143000') !== P.PUBLISH_REPO.baseBranch &&
    P.publishBranchName('2026-08-21-143000').startsWith('publish/'));

  // An abort must produce no changed set at all — all of the publish or none.
  const broken = P.publishPlan([entry('prices.csv', 'new', 'old'),
    { file: 'onyx.csv', tab: 'onyx', grid: [['auctionId', 'Price'], ['202647', '#REF!']], text: 'x', sha: 'n', previous: null }]);
  check('one bad tab aborts the whole publish, including the good tabs',
    !broken.ok && /NOTHING WILL BE PUBLISHED/.test(P.publishDescribePlan(broken)), P.publishDescribePlan(broken));
}

// ===========================================================================
// 6. The shipped data, as the script would see it today
// ===========================================================================
console.log('\nThe shipped data through the preflights\n');
{
  const problems = [];
  for (const file of sheetBacked) {
    const grid = P.publishParseCsv(readCsv(file));
    problems.push(...P.publishScanErrorCells(file, grid), ...P.publishCheckPrices(file, grid), ...P.publishCheckAuctionIds(file, grid));
  }
  // This is a REPORT, not an assertion. The preflights run against the live
  // workbook, and the repo's copies are the closest stand-in available — so a
  // problem here is a problem the operator will hit on the next publish, and
  // it should be visible every run rather than only when someone thinks to
  // look. Failing the build on it would be wrong: these are sheet defects, and
  // the sheet is not in this repo.
  if (problems.length) {
    console.log(`note    ${problems.length} preflight problem(s) in the SHIPPED data — publish would abort until fixed in the sheet:`);
    for (const p of problems) console.log(`          ${p}`);
  } else {
    ok('the shipped data passes every preflight');
  }
}


// ===========================================================================
// The two gaps the first real publish exposed
// ===========================================================================
console.log('\nGaps found by the first real publish\n');
{
  // GAP 1 — a custom IFERROR sentinel is not a native error value, so the
  // original token list missed it. `transmuteRecipes.csv` shipped carrying
  // `⚠ check name` where an ingredient name belonged, because a trailing space
  // had been typed into tokenMetadata's `Charm of Coordination`.
  const recipeGrid = [
    ['Key', 'Year', 'Tier', 'Item', 'Display Name'],
    ['2027|Smith|Charm', '2027', 'Legendary', 'Smith', '⚠ check name'],
  ];
  const caught = P.publishScanErrorCells('transmuteRecipes.csv', recipeGrid);
  check('a ⚠ sentinel aborts the publish', caught.length === 1 && /⚠/.test(caught[0]), caught.join('\n'));

  check('the older "No Match Found" sentinel still aborts',
    P.publishScanErrorCells('prices.csv', [['Item', 'Display Name'], ['1k Bonus', 'No Match Found']]).length === 1);

  // The glyph must not collide with real data — it appears in none of the ten
  // shipped CSVs, which is what makes a bare substring match safe.
  const glyphInData = readdirSync(dataDir).filter((f) => f.endsWith(".csv")).filter((f) => readCsv(f).indexOf('⚠') !== -1);
  check('⚠ appears in no shipped CSV, so matching the bare glyph is safe',
    !glyphInData.length, `found in: ${glyphInData.join(', ')}`);

  // GAP 2 — docs/withheld-recompute-preview.csv is an audited golden file in
  // the repo with no tab behind it, so a publish can red the PR check through
  // a file it never wrote and cannot regenerate. Deleting two withheld rows in
  // the sheet took the recompute from 68 to 66 while the preview still said 68.
  const withheldGrid = (n) => {
    const rows = [['auctionId', 'auctionSeason', 'auctionNumber', 'category', 'Item', 'quantity', 'priceAugmented']];
    for (let i = 0; i < n; i++) rows.push(['20242', '2024', '2', 'withheld', `Item ${i}`, '1', '-$1.00']);
    rows.push(['20242', '2024', '2', 'token', 'Not withheld', '1', '$5.00']);
    return rows;
  };
  check('withheld rows are counted, and other categories are not',
    P.publishWithheldRowCount(withheldGrid(68)) === 68);
  check('a file with no category column counts nothing',
    P.publishWithheldRowCount([['auctionId', 'Item'], ['20242', 'x']]) === null);

  const planWith = (file, withheld, previousWithheld) => ({
    ok: true, aborts: [], cautions: [], unchanged: [],
    changed: [{ file, rows: 10, previousRows: 10, withheld, previousWithheld }],
  });

  const dropped = P.publishWithheldPreviewNotice(planWith('contextItems.csv', 66, 68));
  check('a changed withheld row count is reported with both numbers',
    dropped && /68 -> 66/.test(dropped), dropped);
  check('the notice names the file the publish cannot write',
    dropped && /withheld-recompute-preview\.csv/.test(dropped) && /gen-withheld-preview\.mjs/.test(dropped), dropped);

  // The notice must not threaten a failure that no longer happens.
  // validate-context.mjs compares the audited preview on the intersection, so
  // new withheld rows are new data, not drift — and a routine publish of an
  // auction with withheld items goes green without anyone opening a checkout.
  const notices = [dropped, P.publishWithheldPreviewNotice(planWith('prices.csv', null, null))];
  check('no notice claims new rows will fail the check',
    notices.every((n) => n && /will NOT fail/.test(n) && !/WILL fail/.test(n)), notices.join('\n---\n'));
  check('regenerating is framed as housekeeping, not a blocker',
    notices.every((n) => /when convenient/.test(n)), notices.join('\n---\n'));

  check('a publish touching none of the withheld inputs says nothing',
    P.publishWithheldPreviewNotice(planWith('onyx.csv', null, null)) === null);

  // The notice has to reach both places the operator actually looks.
  const plan = P.publishPlan([]);
  plan.changed = [{ file: 'contextItems.csv', rows: 631, previousRows: 633, withheld: 66, previousWithheld: 68 }];
  check('the PR body carries the regeneration commands, not just a headline',
    /gen-withheld-preview\.mjs/.test(P.publishPullRequestBody(plan)));

  // And the inputs list must match what validate-context.mjs actually reads —
  // if that ever gains a fourth input this test is the thing that notices.
  const contextValidator = readFileSync(join(here, '..', 'scripts', 'validate-context.mjs'), 'utf8');
  const missed = P.PUBLISH_WITHHELD_INPUTS.filter((f) => contextValidator.indexOf(f) === -1);
  check('every file in PUBLISH_WITHHELD_INPUTS is one validate-context.mjs reads',
    !missed.length, `not read by the validator: ${missed.join(', ')}`);
}

console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
