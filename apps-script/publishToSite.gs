/**
 * Phase 3 — Auto-publish: the sheet edit IS the deploy.
 *
 * Serialises the eight sheet-backed tabs to CSV, compares each against what the
 * repository already holds, and commits only what changed as ONE commit on a
 * new branch, then opens a pull request with auto-merge enabled. GitHub Actions
 * takes it from there. That collapses runbook steps 2-7 — export, rename,
 * place, validate, commit, push, watch — into one menu click.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It lives in the repo and is copied into the
 * workbook's Apps Script editor, not edited there. `npm run test:publish`
 * replays every shipped CSV through the pure functions below and asserts they
 * reproduce it byte for byte; an edit made only in the editor is an edit
 * nothing tests.
 *
 * Everything above `--- Apps Script entry points ---` is pure: no
 * SpreadsheetApp, no UrlFetchApp, no I/O, no globals mutated.
 *
 * ---------------------------------------------------------------------------
 * THREE RULES THIS FILE EXISTS TO ENFORCE
 *
 * 1. An EXPLICIT ALLOW-LIST of eight filenames. `derivedPrices.csv` and
 *    `tokenGroups.csv` are hand-authored in the repo with no tab behind them.
 *    Publishing "every tab" would overwrite both with whatever a same-named tab
 *    happened to contain — or, if no such tab exists, is the one bug that could
 *    silently destroy hand-written data. It is the most destructive thing this
 *    phase could do, so the guard is a table plus an assertion, and the test
 *    suite tries to sneak both names past it.
 *
 * 2. A BRANCH AND A PULL REQUEST, never a direct commit to `main`.
 *    `deploy.yml` runs on push to `main` and does NOT run `npm run validate`;
 *    only `pr-checks.yml` does, and only on pull requests. Committing straight
 *    to `main` would bypass every validator Phases 1 and 2 built, which is the
 *    opposite of the point. The PR route costs ~90 seconds of CI.
 *
 * 3. getDisplayValues(), NEVER getValues(). The CSVs in the repo came from
 *    Google's own File > Download > CSV, which writes what each cell DISPLAYS:
 *    `$8,000.00`, not `8000`; `2026-08-20`, not a date serial. getValues()
 *    returns the underlying value and would silently reformat every currency
 *    and date column in the repo on the first publish.
 * ---------------------------------------------------------------------------
 *
 * A NOTE ON GLOBALS. Every .gs file in an Apps Script project shares ONE global
 * scope, so a `var` or `function` declared here silently overwrites the same
 * name in `trentClose.gs`. That is why everything in this file is prefixed
 * `publish` / `PUBLISH_` — including the version constant, which would
 * otherwise make Phase 2's dialogs report Phase 3's version. The menu is added
 * by `trentClose.gs`'s `onOpen`, which calls `addPublishMenu` when this file is
 * present; there is deliberately no second `onOpen` here, because the two would
 * collide and one menu would vanish.
 */

// ===========================================================================
// Configuration
// ===========================================================================

/**
 * Shown in every dialog, so the copy pasted into the workbook can be told apart
 * from the copy in the repo at a glance. Bump it with any change to this file.
 */
var PUBLISH_SCRIPT_VERSION = '2026-08-21.1';

/**
 * The repository this publishes into. All three values are public facts and
 * belong in the script; the token does not, and is read from script properties
 * at run time — see publishToken().
 *
 * `dataPath` is relative to the REPO ROOT, and the repo root is the `site`
 * directory, not its parent. `C:\claude` is a working folder that happens to
 * contain the checkout; `C:\claude\site` is the git repo.
 */
var PUBLISH_REPO = {
  owner: 'mjdomask-jpg',
  repo: 'trueDungeonAuctionPrices',
  baseBranch: 'main',
  dataPath: 'public/data',
};

/** Script property holding the fine-grained PAT. Never hard-code the token. */
var PUBLISH_TOKEN_PROPERTY = 'GITHUB_TOKEN';

/**
 * THE ALLOW-LIST. Tab in the workbook -> file in public/data.
 *
 * Eight entries, and eight is the whole set: the ten CSVs the site reads, minus
 * the two that have no tab behind them. Since `pricesOnyx` was renamed to
 * `onyx` on 2026-08-21 every tab shares its name with the file it becomes, so
 * both columns read the same today — but they are kept separate anyway, because
 * the mapping is the load-bearing fact and a future rename should be a one-line
 * edit here rather than a rediscovery.
 */
var PUBLISH_FILES = [
  { tab: 'auctionMetadata', file: 'auctionMetadata.csv' },
  { tab: 'prices', file: 'prices.csv' },
  { tab: 'onyx', file: 'onyx.csv' },
  { tab: 'contextItems', file: 'contextItems.csv' },
  { tab: 'tokenMetadata', file: 'tokenMetadata.csv' },
  { tab: 'transmuteRecipes', file: 'transmuteRecipes.csv' },
  { tab: 'offAuctionPrices', file: 'offAuctionPrices.csv' },
  { tab: 'rawPricesData', file: 'rawPricesData.csv' },
];

/**
 * Hand-authored in the repo, with NO tab behind them. Publishing either would
 * destroy content that exists nowhere else.
 *
 * `tokenGroups.csv` carries the Timelines chart groupings and line colours;
 * `derivedPrices.csv` carries the Monster-Trophy-is-Fleece-over-ten rule. Both
 * are edited directly in `public/data/` and committed by hand. Listing them
 * here is belt to the allow-list's braces: the guard refuses a name that is not
 * on the allow-list AND refuses a name that is on this list, so adding a ninth
 * entry to PUBLISH_FILES by mistake cannot reach either file.
 */
var PUBLISH_NEVER = ['derivedPrices.csv', 'tokenGroups.csv'];

/**
 * Retired tabs that still recalculate — `auctionPricesOLD`, `transmutesOLD`.
 * Same guard Phase 2 uses. Reading one would publish a stale recalculating copy
 * of a live tab, which is exactly the shape of defect the plan's own
 * `auctionPrices`/`auctionPricesOLD` mix-up nearly caused.
 */
var PUBLISH_OLD_TAB_RE = /OLD$/;

/**
 * Spreadsheet error text, plus the workbook's own IFERROR sentinel.
 *
 * These are matched as SUBSTRINGS, not whole cells, because a broken reference
 * can land inside a concatenated key (`2026#REF!`). That is safe here only
 * because each token is distinctive: lot names carry `#1` and `#44` but never
 * `#N/A`, and the substring scan finds exactly two hits across all ten shipped
 * CSVs, both genuine (see below).
 *
 * `No Match Found` is not a spreadsheet error — it is what
 * `prices!F/G`'s IFERROR writes when a VLOOKUP misses. workbook-findings.md
 * calls it out precisely because it looks like data: nothing tells you a name
 * went unmatched unless you look. So it is treated as an error here.
 */
var PUBLISH_ERROR_TEXT = ['#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#ERROR!', 'No Match Found'];

/**
 * Price columns that must hold a number, per Phase 1's settled rule: a
 * non-numeric price is an ERROR in every KEYED price file, and blank is the
 * dangerous half of it. The site's parser silently drops a row it cannot price,
 * so 42 empty rows sat in `onyx.csv` for months and moved no statistic.
 *
 * `contextItems.priceAugmented` is deliberately NOT here. A `withheld` row is
 * supposed to have no price — the item never sold and the site recomputes what
 * it displays — so requiring a number there would fight the data model.
 */
var PUBLISH_PRICE_COLUMNS = {
  'prices.csv': ['Price'],
  'onyx.csv': ['Price'],
  'rawPricesData.csv': ['trentPrice', 'Price'],
};

/** Files whose every non-blank row must carry an auctionId. */
var PUBLISH_ID_FILES = ['auctionMetadata.csv', 'prices.csv', 'onyx.csv', 'contextItems.csv', 'rawPricesData.csv'];

/**
 * How far a row count may move before the publish is refused.
 *
 * The plan says "a row count that has moved by more than a sane delta" and does
 * not pick a number, so these are chosen from what the files actually do, and
 * they are deliberately asymmetric because the risks are:
 *
 *   SHRINK is the dangerous direction. A stray filter, a sort that clipped the
 *   range, a tab half-deleted — all publish a truncated file that the site will
 *   render as though those auctions never happened. Allowance is 2% or 3 rows,
 *   whichever is larger: 370 rows on rawPricesData, 3 on offAuctionPrices.
 *
 *   GROWTH is usually legitimate — a Trent import adds ~160 raw rows and ~20
 *   price rows, a season backfill adds thousands. And the growth failure mode
 *   that matters, a duplicated block, is caught by validate-prices.mjs check 2
 *   in CI. So the allowance is loose: 25% or 200 rows, whichever is larger.
 *
 * A file that arrives with NO data rows always aborts, whatever the fractions
 * say. An empty tab is never a legitimate publish.
 */
var PUBLISH_ROW_DELTA = { shrinkFraction: 0.02, shrinkFloor: 3, growthFraction: 0.25, growthFloor: 200 };

// ===========================================================================
// Pure core
// ===========================================================================

/**
 * Quote a CSV field exactly the way Google's own export does: only when the
 * value contains a comma, a double quote or a line break, with `"` doubled.
 *
 * Measured against all ten shipped CSVs: zero fields are quoted that do not
 * need to be, and zero fields that need quoting are missing it. In particular
 * leading and trailing SPACES are left unquoted and unchanged — `onyx.csv`
 * writes prices as `$110.00 ` with a trailing space, and `rawPricesData.csv`
 * has 840 such fields. Trimming them here would rewrite 840 rows on the first
 * publish and bury the real change in the diff.
 */
function publishCsvField(value) {
  var s = value == null ? '' : String(value);
  if (s.indexOf('"') === -1 && s.indexOf(',') === -1 && s.indexOf('\n') === -1 && s.indexOf('\r') === -1) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Serialise a grid of display values to CSV.
 *
 * Two details are load-bearing and both are invisible until they corrupt a
 * diff, so they are asserted byte for byte by the round-trip test:
 *
 *   CRLF between rows. All ten shipped files use it.
 *   NO terminator after the last row. Google's export ends on the last data
 *     character — `prices.csv` ends `...,Ultra Rare` with no newline. Adding
 *     one would mark every file changed on the first publish.
 *
 * (The two hand-authored files DO end with CRLF, which is a neat accident of
 * having been written by an editor rather than exported. Not relied on.)
 */
function publishSerializeCsv(grid) {
  var lines = [];
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r], fields = [];
    for (var c = 0; c < row.length; c++) fields.push(publishCsvField(row[c]));
    lines.push(fields.join(','));
  }
  return lines.join('\r\n');
}

/**
 * The bytes the REPOSITORY stores, which are not the bytes Google exports.
 *
 * Measured, not assumed: `git cat-file` on all ten blobs shows LF line endings
 * and no trailing newline, while the working copies on disk are CRLF —
 * `onyx.csv` is 78,764 bytes on disk and 77,752 in the repo, exactly one byte
 * per line separator. The maintainer's Windows checkout has `core.autocrlf =
 * true`, so git strips the CR on commit and restores it on checkout, and the
 * repository never sees a CR.
 *
 * This matters twice, and both failures are silent:
 *
 *   The GitHub API writes RAW BYTES. Nothing normalises them server-side. So
 *   committing the CRLF text would rewrite every line of all eight files on the
 *   first publish — 28,000 rows of diff hiding whatever actually changed.
 *
 *   Worse, the diff would then never fire again. A CRLF blob can never hash to
 *   the LF sha the tree carries, so every file would read as changed on every
 *   publish, and "skip anything byte-identical" would be dead code.
 *
 * Serialise to Google's shape, commit git's shape. `publishSerializeCsv` owns
 * the first, this owns the second, and both are asserted byte for byte by the
 * test suite — the second against the shas git itself recorded.
 */
function publishRepoText(csvText) {
  return csvText.replace(/\r\n/g, '\n');
}

/**
 * RFC-4180 parse, used only on what the repository already holds — to read its
 * header row and count its rows for the drift and delta checks. The sheet side
 * never needs parsing; it arrives as a grid already. Handles either line ending,
 * because the repository's copies are LF and a local download is CRLF.
 */
function publishParseCsv(text) {
  var rows = [], row = [], field = '', quoted = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Byte length of a string as UTF-8.
 *
 * Not the same as `.length`, and the difference is not academic: three of the
 * eight files carry curly quotes (`’` in "Adventurers’", `“` in an auction
 * name), so `auctionMetadata.csv` is 62,983 characters and 62,995 bytes. Git's
 * blob hash prefixes the BYTE length, so using `.length` yields a wrong hash
 * for exactly those three files — they would read as changed on every single
 * publish, defeating the diff and filling the history with no-op commits.
 */
function publishUtf8ByteLength(text) {
  var bytes = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; i++; }  // surrogate pair
    else bytes += 3;
  }
  return bytes;
}

/**
 * The exact byte sequence git hashes to identify a blob: `blob <bytes>\0<content>`.
 *
 * Hashing this and comparing against the sha the repository's tree already
 * carries IS the diff — it needs no download of the old file at all, which
 * matters because `rawPricesData.csv` is 1.4 MB and the Contents API refuses to
 * return content above 1 MB in the first place.
 *
 * It is also the fidelity test the plan asks for, for free: the repo's copies
 * came from Google's own Download as CSV, so if this script's serialisation of
 * an UNCHANGED tab hashes to the sha already in the tree, the serialiser is
 * byte-identical to Google's export. That is what the Dry run reports.
 */
function publishGitBlobPreimage(text) {
  return 'blob ' + publishUtf8ByteLength(text) + '\u0000' + text;
}

/**
 * Refuse a filename that is not on the allow-list, or that is one of the
 * hand-authored files. Returns a reason string, or null when the file is safe.
 *
 * Called twice on purpose — once when the grid is read out of the sheet, once
 * again on every path immediately before it becomes a git blob. Two cheap
 * checks around the one operation in this phase that could destroy data nothing
 * else holds a copy of.
 */
function publishFileRefusal(file) {
  for (var i = 0; i < PUBLISH_NEVER.length; i++) {
    if (PUBLISH_NEVER[i] === file) return '"' + file + '" is hand-authored in the repo and has no tab behind it';
  }
  for (var j = 0; j < PUBLISH_FILES.length; j++) if (PUBLISH_FILES[j].file === file) return null;
  return '"' + file + '" is not one of the ' + PUBLISH_FILES.length + ' sheet-backed files';
}

/**
 * Validate the allow-list table itself. A duplicate entry, a retired tab or a
 * hand-authored filename is a bug in the configuration above, not in the data,
 * so it should stop the run before a single cell is read.
 */
function publishConfigProblems() {
  var problems = [], seenTab = {}, seenFile = {};
  for (var i = 0; i < PUBLISH_FILES.length; i++) {
    var entry = PUBLISH_FILES[i];
    if (PUBLISH_OLD_TAB_RE.test(entry.tab)) problems.push('tab "' + entry.tab + '" is a retired tab');
    var refusal = publishFileRefusal(entry.file);
    if (refusal) problems.push(refusal);
    if (seenTab[entry.tab]) problems.push('tab "' + entry.tab + '" is listed twice');
    if (seenFile[entry.file]) problems.push('file "' + entry.file + '" is listed twice');
    seenTab[entry.tab] = true; seenFile[entry.file] = true;
  }
  return problems;
}

/** Column index by header name, or -1. */
function publishColumnIndex(grid, name) {
  if (!grid.length) return -1;
  for (var i = 0; i < grid[0].length; i++) if (String(grid[0][i]).trim() === name) return i;
  return -1;
}

function publishRowIsBlank(row) {
  for (var i = 0; i < row.length; i++) if (String(row[i] == null ? '' : row[i]).trim() !== '') return false;
  return true;
}

/**
 * Preflight 1 — any spreadsheet error text, anywhere in the grid.
 *
 * Run on all eight tabs, not just the ones that changed: a `#REF!` sitting in a
 * tab this publish is not touching still means the workbook is broken, and
 * finding out in the sheet is the entire point of preflighting. Reports at most
 * a handful, since one broken ARRAYFORMULA produces thousands.
 */
function publishScanErrorCells(file, grid) {
  var found = [], LIMIT = 6;
  for (var r = 0; r < grid.length && found.length < LIMIT; r++) {
    for (var c = 0; c < grid[r].length && found.length < LIMIT; c++) {
      var cell = String(grid[r][c] == null ? '' : grid[r][c]);
      for (var e = 0; e < PUBLISH_ERROR_TEXT.length; e++) {
        if (cell.indexOf(PUBLISH_ERROR_TEXT[e]) !== -1) {
          var header = grid.length && grid[0][c] != null ? String(grid[0][c]) : 'column ' + (c + 1);
          found.push(file + ' row ' + (r + 1) + ' (' + header + '): ' + cell);
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Preflight 2 — a Price that is not a number, in a keyed price file.
 *
 * `$` and thousands separators are stripped, matching how the site parses them.
 * Blank counts as a failure: the plan is explicit that blank is the dangerous
 * one, because a keyed row with no price means someone meant to come back to
 * it, and a silent drop is indistinguishable from correct behaviour.
 */
function publishCheckPrices(file, grid) {
  var columns = PUBLISH_PRICE_COLUMNS[file];
  if (!columns || grid.length < 2) return [];
  var found = [], LIMIT = 6;
  for (var k = 0; k < columns.length; k++) {
    var idx = publishColumnIndex(grid, columns[k]);
    if (idx === -1) { found.push(file + ': no "' + columns[k] + '" column — was it renamed in the sheet?'); continue; }
    for (var r = 1; r < grid.length && found.length < LIMIT; r++) {
      if (publishRowIsBlank(grid[r])) continue;
      var raw = String(grid[r][idx] == null ? '' : grid[r][idx]).replace(/[$,\s]/g, '');
      if (raw === '' || isNaN(Number(raw))) {
        found.push(file + ' row ' + (r + 1) + ': ' + columns[k] + ' is ' +
          (raw === '' ? 'blank' : '"' + grid[r][idx] + '"'));
      }
    }
  }
  return found;
}

/**
 * Preflight 3 — a keyed row with no auctionId.
 *
 * Fully blank rows are skipped: the site drops them on load and they are
 * harmless, so failing on one would block a publish over an empty row someone
 * left at the bottom of a tab.
 */
function publishCheckAuctionIds(file, grid) {
  var keyed = false;
  for (var i = 0; i < PUBLISH_ID_FILES.length; i++) if (PUBLISH_ID_FILES[i] === file) keyed = true;
  if (!keyed || grid.length < 2) return [];
  var idx = publishColumnIndex(grid, 'auctionId');
  if (idx === -1) return [file + ': no "auctionId" column — was it renamed in the sheet?'];
  var found = [], LIMIT = 6;
  for (var r = 1; r < grid.length && found.length < LIMIT; r++) {
    if (publishRowIsBlank(grid[r])) continue;
    if (String(grid[r][idx] == null ? '' : grid[r][idx]).trim() === '') {
      found.push(file + ' row ' + (r + 1) + ': no auctionId');
    }
  }
  return found;
}

/**
 * Preflight 4 — an implausible row-count move. See PUBLISH_ROW_DELTA for why
 * the two directions get very different allowances.
 *
 * `previousRows` is null for a file the repository does not have yet, which is
 * not a delta at all and cannot be judged.
 */
function publishCheckRowDelta(file, rows, previousRows) {
  if (rows <= 0) return [file + ': the tab has no data rows at all'];
  if (previousRows === null || previousRows === undefined) return [];
  var delta = rows - previousRows;
  if (delta < 0) {
    var allowed = Math.max(PUBLISH_ROW_DELTA.shrinkFloor, Math.floor(previousRows * PUBLISH_ROW_DELTA.shrinkFraction));
    if (-delta > allowed) {
      return [file + ': ' + previousRows + ' rows -> ' + rows + ' (' + delta + '). Losing more than ' +
        allowed + ' rows is refused — check for a filter, a clipped sort, or a half-deleted tab.'];
    }
  } else if (delta > 0) {
    var cap = Math.max(PUBLISH_ROW_DELTA.growthFloor, Math.floor(previousRows * PUBLISH_ROW_DELTA.growthFraction));
    if (delta > cap) {
      return [file + ': ' + previousRows + ' rows -> ' + rows + ' (+' + delta + '). Gaining more than ' +
        cap + ' rows is refused — confirm this is a backfill and not a duplicated block.'];
    }
  }
  return [];
}

/**
 * A changed header row is a CAUTION, not an abort.
 *
 * Renaming a column in the sheet breaks the site, and `npm run validate` names
 * the exact column — so the PR check catches it either way. But ADDING a column
 * is legitimate and has happened twice (`transmuteRecipes` gained `Expires` and
 * `IngredientType`), so refusing on any header change would block real work.
 * Surfacing it on the confirmation dialog gets the operator to look without
 * standing in the way.
 */
function publishHeaderDrift(file, header, previousHeader) {
  if (!previousHeader) return null;
  if (header.join('\u0001') === previousHeader.join('\u0001')) return null;
  return file + ': the header row changed\n      was: ' + previousHeader.join(', ') + '\n      now: ' + header.join(', ');
}

/**
 * Decide the whole publish from serialised tabs plus what the repository holds.
 *
 * `entries` are `{ file, tab, grid, text, blob, sha, previous }` — `text` is
 * Google's shape and `blob` is git's (see publishRepoText); `previous` is
 * `{ sha, rows, header }` or null when the repository has no such file. Returns
 * `{ ok, aborts, cautions, changed, unchanged }` and writes nothing.
 */
function publishPlan(entries) {
  var aborts = [], cautions = [], changed = [], unchanged = [];
  var config = publishConfigProblems();
  for (var p = 0; p < config.length; p++) aborts.push('configuration: ' + config[p]);

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var refusal = publishFileRefusal(e.file);
    if (refusal) { aborts.push('refusing to publish ' + refusal); continue; }

    var rows = Math.max(0, e.grid.length - 1);
    aborts = aborts.concat(publishScanErrorCells(e.file, e.grid));
    aborts = aborts.concat(publishCheckPrices(e.file, e.grid));
    aborts = aborts.concat(publishCheckAuctionIds(e.file, e.grid));

    var previousSha = e.previous ? e.previous.sha : null;
    var previousRows = e.previous ? e.previous.rows : null;
    // Row delta and header drift compare against the repository's copy, so they
    // can only be judged for a file that actually changed — an unchanged file
    // was not downloaded and its delta is zero by definition.
    var blob = e.blob === undefined || e.blob === null ? publishRepoText(e.text) : e.blob;
    if (e.sha === previousSha) {
      unchanged.push({ file: e.file, rows: rows, bytes: publishUtf8ByteLength(blob), sha: e.sha });
      continue;
    }
    aborts = aborts.concat(publishCheckRowDelta(e.file, rows, previousRows));
    var drift = publishHeaderDrift(e.file, e.grid.length ? e.grid[0] : [], e.previous ? e.previous.header : null);
    if (drift) cautions.push(drift);
    changed.push({
      file: e.file, rows: rows, bytes: publishUtf8ByteLength(blob), sha: e.sha,
      previousRows: previousRows, previousSha: previousSha, text: e.text, blob: blob,
    });
  }

  if (!aborts.length && !changed.length) cautions.push('Nothing changed — every tab already matches the repository.');
  return { ok: aborts.length === 0, aborts: aborts, cautions: cautions, changed: changed, unchanged: unchanged };
}

/** Branch names must be unique per run; the stamp comes from the caller. */
function publishBranchName(stamp) { return 'publish/' + stamp; }

function publishCommitMessage(plan) {
  var names = [];
  for (var i = 0; i < plan.changed.length; i++) names.push(plan.changed[i].file);
  if (!names.length) return 'Publish from sheet: no changes';
  var subject = names.length <= 3 ? names.join(', ') : names.length + ' data files';
  var lines = ['Publish from sheet: ' + subject, ''];
  for (var j = 0; j < plan.changed.length; j++) {
    var c = plan.changed[j];
    lines.push('  ' + c.file + ': ' + (c.previousRows === null ? 'new file, ' : c.previousRows + ' -> ') + c.rows + ' rows');
  }
  lines.push('', 'Exported by apps-script/publishToSite.gs ' + PUBLISH_SCRIPT_VERSION + '.');
  return lines.join('\n');
}

function publishPullRequestBody(plan) {
  var lines = ['Automated publish from the workbook (`publishToSite.gs` ' + PUBLISH_SCRIPT_VERSION + ').', '',
    '| File | Rows | Was |', '|---|---:|---:|'];
  for (var i = 0; i < plan.changed.length; i++) {
    var c = plan.changed[i];
    lines.push('| `' + c.file + '` | ' + c.rows + ' | ' + (c.previousRows === null ? 'new' : c.previousRows) + ' |');
  }
  if (plan.cautions.length) {
    lines.push('', '**Cautions raised in the sheet:**');
    for (var j = 0; j < plan.cautions.length; j++) lines.push('- ' + plan.cautions[j].split('\n')[0]);
  }
  lines.push('', 'Serialised with `getDisplayValues()`, so the text matches Google\'s own',
    '*Download as CSV*. The PR check runs `npm run build`, `npm run validate` and',
    '`npm test` — do not merge this past a red check.');
  return lines.join('\n');
}

/** A human summary of a plan, for the confirmation and dry-run dialogs. */
function publishDescribePlan(plan) {
  var lines = [];
  if (!plan.ok) {
    // Each check stops collecting after a handful, but eight tabs can still
    // produce a list too long for a dialog. One broken ARRAYFORMULA is one
    // fix, however many cells it touched.
    var SHOWN = 20;
    lines.push('NOTHING WILL BE PUBLISHED — ' + plan.aborts.length + ' problem(s):');
    for (var i = 0; i < plan.aborts.length && i < SHOWN; i++) lines.push('  • ' + plan.aborts[i]);
    if (plan.aborts.length > SHOWN) lines.push('  … and ' + (plan.aborts.length - SHOWN) + ' more');
    lines.push('', 'Fix these in the sheet and run again. The publish is all-or-nothing.');
    return lines.join('\n');
  }
  for (var c = 0; c < plan.cautions.length; c++) lines.push('CAUTION: ' + plan.cautions[c]);
  if (plan.cautions.length) lines.push('');
  if (plan.changed.length) {
    lines.push(plan.changed.length + ' file(s) to publish:');
    for (var j = 0; j < plan.changed.length; j++) {
      var f = plan.changed[j];
      lines.push('  ' + f.file + '  ' + f.rows + ' rows, ' + f.bytes + ' bytes' +
        (f.previousRows === null ? '  (new)' : '  (was ' + f.previousRows + ' rows)'));
    }
  }
  if (plan.unchanged.length) {
    lines.push('', plan.unchanged.length + ' unchanged, byte-identical to the repository:');
    for (var k = 0; k < plan.unchanged.length; k++) lines.push('  ' + plan.unchanged[k].file);
  }
  return lines.join('\n');
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook, the network, or script properties.
// Nothing above it does.
// ===========================================================================

/**
 * Called by trentClose.gs's onOpen. There is no onOpen here on purpose — see
 * the note on globals at the top of this file.
 *
 * If you install this file WITHOUT trentClose.gs, add one:
 *   function onOpen() { addPublishMenu(SpreadsheetApp.getUi().createMenu('TD auctions')).addToUi(); }
 */
function addPublishMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Publish to site…', 'publishToSite')
    .addItem('Dry run — what would be published', 'dryRunPublish');
}

/**
 * The fine-grained, single-repository PAT, from script properties.
 *
 * It is NEVER in this file. The script body is visible to anyone with edit
 * access to the spreadsheet, and a token in it would be a token shared with
 * every collaborator, forever, in the version history. See the runbook for how
 * to create and store it: Project Settings > Script Properties.
 */
function publishToken() {
  var token = PropertiesService.getScriptProperties().getProperty(PUBLISH_TOKEN_PROPERTY);
  if (!token) {
    throw new Error('No GitHub token. In the Apps Script editor: Project Settings > Script Properties > ' +
      'Add script property, name "' + PUBLISH_TOKEN_PROPERTY + '", value a fine-grained personal access ' +
      'token scoped to ' + PUBLISH_REPO.owner + '/' + PUBLISH_REPO.repo + ' with Contents: Read and write ' +
      'and Pull requests: Read and write. See docs/updating-the-data.md.');
  }
  return token;
}

function publishApiBase() {
  return 'https://api.github.com/repos/' + PUBLISH_REPO.owner + '/' + PUBLISH_REPO.repo;
}

/**
 * One GitHub REST call. Throws with the response body on anything but 2xx —
 * a half-finished publish is worse than a loud failure, and the Git Data API
 * sequence below is ordered so that a throw before the final ref update leaves
 * only unreferenced blobs, which GitHub garbage-collects.
 */
function publishApi(method, url, payload) {
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + publishToken(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (payload) { options.contentType = 'application/json'; options.payload = JSON.stringify(payload); }
  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) throw new Error(method + ' ' + url + ' -> ' + code + '\n' + body.slice(0, 500));
  return body ? JSON.parse(body) : null;
}

/** Git blob sha of a string, computed the way git computes it. */
function publishBlobSha(text) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_1, publishGitBlobPreimage(text), Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < digest.length; i++) {
    var byte = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += (byte < 16 ? '0' : '') + byte.toString(16);
  }
  return hex;
}

/**
 * Confirm every tab exists and none is a retired copy, BEFORE anything is read.
 * Same guard as Phase 2's checkTabs, and for the same reason: getting a tab
 * name wrong is not hypothetical — the plan itself named a price tab that does
 * not exist while a retired `auctionPricesOLD` did.
 */
function publishCheckTabs() {
  var ss = SpreadsheetApp.getActive(), problems = publishConfigProblems();
  for (var i = 0; i < PUBLISH_FILES.length; i++) {
    var tab = PUBLISH_FILES[i].tab;
    if (!ss.getSheetByName(tab)) problems.push('no tab named "' + tab + '" (for ' + PUBLISH_FILES[i].file + ')');
  }
  return problems;
}

/**
 * Read every allow-listed tab and serialise it.
 *
 * getDisplayValues, never getValues — see rule 3 at the top of this file.
 */
function publishReadTabs() {
  var ss = SpreadsheetApp.getActive(), entries = [];
  for (var i = 0; i < PUBLISH_FILES.length; i++) {
    var target = PUBLISH_FILES[i];
    var refusal = publishFileRefusal(target.file);
    if (refusal) throw new Error('refusing to read for ' + refusal);
    var sheet = ss.getSheetByName(target.tab);
    if (!sheet) throw new Error('no tab named "' + target.tab + '"');
    var grid = sheet.getDataRange().getDisplayValues();
    var text = publishSerializeCsv(grid);
    var blob = publishRepoText(text);
    entries.push({
      file: target.file, tab: target.tab, grid: grid,
      text: text, blob: blob, sha: publishBlobSha(blob), previous: null,
    });
  }
  return entries;
}

/** path -> blob sha for everything under dataPath on the base branch. */
function publishRepoState() {
  var ref = publishApi('get', publishApiBase() + '/git/ref/heads/' + PUBLISH_REPO.baseBranch);
  var commit = publishApi('get', publishApiBase() + '/git/commits/' + ref.object.sha);
  var tree = publishApi('get', publishApiBase() + '/git/trees/' + commit.tree.sha + '?recursive=1');
  var blobs = {};
  for (var i = 0; i < tree.tree.length; i++) {
    var node = tree.tree[i];
    if (node.type === 'blob' && node.path.indexOf(PUBLISH_REPO.dataPath + '/') === 0) blobs[node.path] = node.sha;
  }
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha, blobs: blobs, truncated: tree.truncated === true };
}

/**
 * Fetch one blob's text.
 *
 * Via the Git Data blob endpoint, NOT the Contents API: Contents refuses to
 * return content above 1 MB and hands back an empty string with
 * `encoding: "none"`, and `rawPricesData.csv` is 1.4 MB. Blobs go to 100 MB.
 * Only ever called for a file whose sha already differs, so an unchanged
 * publish downloads nothing.
 */
function publishFetchBlobText(sha) {
  var blob = publishApi('get', publishApiBase() + '/git/blobs/' + sha);
  if (blob.encoding !== 'base64') throw new Error('blob ' + sha + ' came back as "' + blob.encoding + '"');
  return Utilities.newBlob(Utilities.base64Decode(blob.content.replace(/\n/g, ''))).getDataAsString('UTF-8');
}

/** Read the tabs, diff against the repo, and build the plan. Writes nothing. */
function publishBuildPlan() {
  var entries = publishReadTabs();
  var state = publishRepoState();
  if (state.truncated) throw new Error('the repository tree came back truncated; cannot diff safely');
  for (var i = 0; i < entries.length; i++) {
    var path = PUBLISH_REPO.dataPath + '/' + entries[i].file;
    var sha = state.blobs[path] || null;
    if (sha === null) continue;                       // new file: nothing to compare
    if (sha === entries[i].sha) { entries[i].previous = { sha: sha, rows: null, header: null }; continue; }
    var previousGrid = publishParseCsv(publishFetchBlobText(sha));
    entries[i].previous = {
      sha: sha,
      rows: Math.max(0, previousGrid.length - 1),
      header: previousGrid.length ? previousGrid[0] : [],
    };
  }
  return { plan: publishPlan(entries), state: state };
}

/**
 * Everything publishToSite does except the writing.
 *
 * Run this before any publish. It still needs the token — the diff is against
 * the live repository — but it makes no write of any kind.
 *
 * Every tab you have not edited should report as unchanged, and that is the
 * fidelity proof the plan asks for: the repository's copies came from Google's
 * own Download as CSV, so if this script's output hashes to the sha already in
 * the tree, the serialisation IS Google's. A tab you did not touch reporting as
 * CHANGED means the two have diverged — chase that before publishing.
 */
function dryRunPublish() {
  var ui = SpreadsheetApp.getUi();
  var problems = publishCheckTabs();
  if (problems.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + problems.join('\n  • '), ui.ButtonSet.OK); return; }
  var built;
  try { built = publishBuildPlan(); }
  catch (err) { ui.alert('Dry run failed', String(err.message || err), ui.ButtonSet.OK); return; }
  ui.alert('Dry run — nothing published (script ' + PUBLISH_SCRIPT_VERSION + ')',
    publishDescribePlan(built.plan), ui.ButtonSet.OK);
}

/**
 * Publish: one commit on a new branch, then a pull request with auto-merge.
 *
 * The Git Data API in five steps rather than the Contents API's one-file-per-
 * call: Contents would land a multi-file update as several commits and could
 * leave the repository mid-update if one call failed.
 */
function publishToSite() {
  var ui = SpreadsheetApp.getUi();

  var problems = publishCheckTabs();
  if (problems.length) {
    ui.alert('Cannot run', 'Tab problems:\n  • ' + problems.join('\n  • ') +
      '\n\nFix the names in PUBLISH_FILES at the top of the script, or create the tab.', ui.ButtonSet.OK);
    return;
  }

  var built;
  try { built = publishBuildPlan(); }
  catch (err) { ui.alert('Publish failed', String(err.message || err), ui.ButtonSet.OK); return; }
  var plan = built.plan, state = built.state;
  var summary = publishDescribePlan(plan);

  if (!plan.ok) { ui.alert('Publish aborted — nothing written (script ' + PUBLISH_SCRIPT_VERSION + ')', summary, ui.ButtonSet.OK); return; }
  if (!plan.changed.length) { ui.alert('Nothing to publish (script ' + PUBLISH_SCRIPT_VERSION + ')', summary, ui.ButtonSet.OK); return; }

  var branch = publishBranchName(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd-HHmmss'));
  var go = ui.alert('Publish to site (script ' + PUBLISH_SCRIPT_VERSION + ')',
    summary + '\n\nThis opens a pull request on branch ' + branch + ' with auto-merge enabled.\n' +
    'It never commits to ' + PUBLISH_REPO.baseBranch + ' directly — that path skips npm run validate.\n\nPublish?',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) return;

  try {
    var treeEntries = [];
    for (var i = 0; i < plan.changed.length; i++) {
      var changed = plan.changed[i];
      // The allow-list, checked once more at the last possible moment.
      var refusal = publishFileRefusal(changed.file);
      if (refusal) throw new Error('refusing to commit ' + refusal);
      // changed.blob, not changed.text — git's shape, not Google's.
      var blob = publishApi('post', publishApiBase() + '/git/blobs', {
        content: Utilities.base64Encode(changed.blob, Utilities.Charset.UTF_8), encoding: 'base64',
      });
      if (blob.sha !== changed.sha) {
        throw new Error(changed.file + ': GitHub stored blob ' + blob.sha + ' but the diff was computed ' +
          'against ' + changed.sha + '. The hash and the upload disagree — publishing would be unsafe.');
      }
      treeEntries.push({ path: PUBLISH_REPO.dataPath + '/' + changed.file, mode: '100644', type: 'blob', sha: blob.sha });
    }

    var tree = publishApi('post', publishApiBase() + '/git/trees', { base_tree: state.treeSha, tree: treeEntries });
    var commit = publishApi('post', publishApiBase() + '/git/commits', {
      message: publishCommitMessage(plan), tree: tree.sha, parents: [state.commitSha],
    });
    publishApi('post', publishApiBase() + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha });

    var pr = publishApi('post', publishApiBase() + '/pulls', {
      title: publishCommitMessage(plan).split('\n')[0],
      head: branch, base: PUBLISH_REPO.baseBranch, body: publishPullRequestBody(plan),
    });

    var autoMerge = publishEnableAutoMerge(pr.node_id);
    ui.alert('Published (script ' + PUBLISH_SCRIPT_VERSION + ')',
      summary + '\n\nPull request #' + pr.number + '\n' + pr.html_url + '\n\n' + autoMerge, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('Publish failed part-way (script ' + PUBLISH_SCRIPT_VERSION + ')',
      String(err.message || err) +
      '\n\nNothing was merged. If a branch "' + branch + '" exists, delete it on GitHub and run again.',
      ui.ButtonSet.OK);
  }
}

/**
 * Ask GitHub to merge the PR once its checks pass.
 *
 * Only GraphQL can do this; there is no REST equivalent. It fails when the
 * repository has "Allow auto-merge" switched off, or when no branch protection
 * rule makes a check REQUIRED — with nothing to wait for, GitHub says the PR is
 * already mergeable and refuses to queue it. Both are settings on the
 * repository, not something the script can fix, so a failure here is reported
 * and the PR is left open rather than merged some other way. Never fall back to
 * committing to the base branch: that is the one thing this design exists to
 * prevent.
 */
function publishEnableAutoMerge(pullRequestNodeId) {
  var query = 'mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:SQUASH})' +
    '{pullRequest{autoMergeRequest{enabledAt}}}}';
  var response = UrlFetchApp.fetch('https://api.github.com/graphql', {
    method: 'post',
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + publishToken() },
    payload: JSON.stringify({ query: query, variables: { id: pullRequestNodeId } }),
  });
  var body = {};
  try { body = JSON.parse(response.getContentText()); } catch (e) { body = {}; }
  if (response.getResponseCode() === 200 && body.data && body.data.enablePullRequestAutoMerge) {
    return 'Auto-merge is on: it merges itself when the PR check goes green.';
  }
  var why = body.errors && body.errors.length ? body.errors[0].message : 'HTTP ' + response.getResponseCode();
  return 'Auto-merge could NOT be enabled (' + why + ').\nMerge the pull request yourself once its check is green.';
}

// Lets Node load the pure functions for testing; Apps Script has no `module`
// and skips this entirely.
if (typeof module !== 'undefined') {
  module.exports = {
    publishCsvField: publishCsvField,
    publishSerializeCsv: publishSerializeCsv,
    publishParseCsv: publishParseCsv,
    publishRepoText: publishRepoText,
    publishUtf8ByteLength: publishUtf8ByteLength,
    publishGitBlobPreimage: publishGitBlobPreimage,
    publishFileRefusal: publishFileRefusal,
    publishConfigProblems: publishConfigProblems,
    publishScanErrorCells: publishScanErrorCells,
    publishCheckPrices: publishCheckPrices,
    publishCheckAuctionIds: publishCheckAuctionIds,
    publishCheckRowDelta: publishCheckRowDelta,
    publishHeaderDrift: publishHeaderDrift,
    publishPlan: publishPlan,
    publishBranchName: publishBranchName,
    publishCommitMessage: publishCommitMessage,
    publishPullRequestBody: publishPullRequestBody,
    publishDescribePlan: publishDescribePlan,
    PUBLISH_FILES: PUBLISH_FILES,
    PUBLISH_NEVER: PUBLISH_NEVER,
    PUBLISH_REPO: PUBLISH_REPO,
    PUBLISH_ROW_DELTA: PUBLISH_ROW_DELTA,
    PUBLISH_SCRIPT_VERSION: PUBLISH_SCRIPT_VERSION,
  };
}
