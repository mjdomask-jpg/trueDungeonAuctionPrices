/**
 * Phase 7 — harden the workbook in place.
 *
 * The plan calls this "~half a day · no code", meaning a human clicking through
 * the Sheets UI. It is code for two reasons.
 *
 * **It has to be re-runnable.** A one-time pass decays: every season adds ~1,500
 * price rows, Phase 4 adds auctions, and a tab gains a column when the site
 * needs one. Validation applied by hand in August is validation with a hole in
 * it by November, and nothing says so.
 *
 * **A manual pass is unverifiable afterwards.** "Is there numeric validation on
 * every price column in all three price tabs?" has no answer from outside the
 * workbook. This reports what it found before it changes anything, so the
 * answer is a dialog rather than a memory.
 *
 * WHAT IT DOES NOT DO, so expectations stay honest — this is the plan's own
 * caveat and it is still true: cells remain untyped underneath, and **a paste
 * bypasses data validation entirely**. Every routine update to this workbook is
 * a paste. So this is one of two layers, and the other one is the real gate:
 * `npm run validate` § 7 checks the same vocabularies at the PR, where a paste
 * cannot get past it. Neither layer is sufficient alone.
 *
 * NOTHING IS DISCOVERED BY ASSUMPTION. The column layouts are read from each
 * tab's header row, and a formula column is found by looking at what the cells
 * actually contain rather than by a hard-coded letter.
 *
 * That earned itself immediately. Run against a real export on 2026-08-24, the
 * discovery found TWO formula columns the repo's own map called inputs:
 * `auctionId` (`=B2&C2`, in all four tabs that carry it) and `augmentated`
 * (`=IF(Q2&R2<>"","Yes","No")`). Neither was findable by checking values,
 * because both formulas produce exactly what a human would have typed on all
 * 289 rows — which is also why `auctionOpen.gs` writes literals over both
 * without anything noticing. A script working from the stale map would have put
 * a dropdown on a formula column and left two others unprotected.
 *
 * Shares one global scope with the other .gs files. Every global is prefixed
 * `HARDEN_`/`harden`.
 */

var HARDEN_VERSION = '2026-08-24.1';

/**
 * Columns holding a price, by tab and header. Numeric-only validation goes on
 * these, and this is the item that matters most: it makes the `-` class
 * impossible. Six such rows existed before Phase 0, every one a real sale
 * recorded as if it had not happened.
 *
 * `contextItems.priceAugmented` is NOT here. Its withheld rows are a formula
 * and its token and grunnel rows are typed — 95 of 631 populated cells, in the
 * 2026-08-24 export — so the column is genuinely mixed. `hardenPlan` reports
 * mixed columns rather than acting on them.
 */
var HARDEN_PRICE_COLUMNS = [
  { tab: 'prices', header: 'Price' },
  { tab: 'onyx', header: 'Price' },
  { tab: 'rawPricesData', header: 'trentPrice' },
  { tab: 'offAuctionPrices', header: 'max Price' },
  { tab: 'offAuctionPrices', header: 'avg Price' },
  { tab: 'offAuctionPrices', header: 'min Price' },
];

/**
 * Columns holding a whole number of things.
 *
 * Kept separate from prices because the rule is different — a quantity of 2.5
 * is meaningless where a price of 2.5 is ordinary.
 */
var HARDEN_COUNT_COLUMNS = [
  { tab: 'contextItems', header: 'quantity' },
  { tab: 'auctionMetadata', header: 'auctionNumber' },
];

/**
 * Vocabulary columns and their values, measured from the shipped CSVs on
 * 2026-08-24 and shown with their counts so the list can be re-derived.
 *
 * `grows: true` means the dropdown is a HELP, not a fence: the auctioneers
 * invent formats, and `auctionStyle` has already gained `Safehold Onyx Super
 * Condensed` and `Limited` at one auction each. Those get a warning-only
 * dropdown, which Sheets calls "show a warning" rather than "reject input" —
 * so a genuinely new style can still be typed, and a typo still gets a red
 * flag while it is being typed.
 *
 * `grows: false` means the set is the output of a two-way decision and cannot
 * legitimately gain a member, so input is rejected outright.
 */
var HARDEN_VOCABULARY = [
  { tab: 'auctionMetadata', header: 'auctionStyle', grows: true, values: [
    'Ultra Condensed',              // 125
    'Super Condensed',              // 112
    'Onyx Super Condensed',         //  39
    'Onyx Condensed',               //   5
    'Condensed',                    //   3
    'Onyx Ultra Condensed',         //   3
    'Safehold Onyx Super Condensed',//   1
    'Limited',                      //   1
  ] },
  { tab: 'auctionMetadata', header: 'completionStyle', grows: true, values: [
    'Lightning',                    // 250
    'Fixed Date',                   //  32
    'Semi-Lightning',               //   7
  ] },
  { tab: 'contextItems', header: 'category', grows: false, values: ['token', 'grunnel', 'withheld', 'augment'] },
];

// `augmentated` is NOT here, and the reason is worth keeping. It reads like the
// obvious fourth dropdown — two values, hand-looking, `Yes`/`No` — and it is a
// FORMULA: `=IF(Q2&R2<>"","Yes","No")`, derived from the augment columns beside
// it. A dropdown on a formula column offers a choice nobody can take. It is
// protected instead, which the sweep below does on its own.
//
// This was found by running the plan against a real export rather than against
// the audit, and it is the second thing that export corrected: `auctionId` is a
// formula too (`=B2&C2`), in all four tabs that carry it.

/**
 * Named ranges that are unused AND WRONG, which is the dangerous combination.
 *
 * Unused on its own costs nothing: `auctionList`, `tokenDisplayNames` and
 * `onyxPriceTable` have no references and are whole-column, so reaching for one
 * next year does the right thing. These three are traps — two silently
 * truncated by thousands of rows, one pointing at `#REF!`. Reach for
 * `trentAuctionData` and you get an answer computed over 71% of the data with
 * no error to warn you.
 *
 * They are proposed for deletion and deleted only on an explicit confirmation,
 * because deleting a named range is the one thing here that cannot be undone by
 * re-running the script.
 */
var HARDEN_DEAD_RANGES = ['trentAuctionData', 'NamedRange1', 'categories'];

/**
 * Tabs this does not touch: the scratch surfaces the other scripts write.
 *
 * `trentStaging` and `forumStaging` hold a paste on its way in, and
 * `auctionOpenReview` and `forumThreadReview` hold proposals on their way to a
 * human. Nothing in them is a record of anything, they are rewritten wholesale
 * on every run, and a warn-only protection over a column the operator is
 * supposed to be editing is pure friction.
 *
 * They are empty in a clean workbook, so this changes nothing today — it stops
 * the first run that happens to follow an import from hardening a scratch pad.
 */
var HARDEN_SKIP_TABS = ['trentStaging', 'forumStaging', 'auctionOpenReview', 'forumThreadReview'];

/** A named range covering a data tab must be whole-column. See hardenNamedRanges. */
var HARDEN_WHOLE_COLUMN_TABS = [
  'prices', 'onyx', 'rawPricesData', 'auctionMetadata', 'contextItems',
  'tokenMetadata', 'transmuteRecipes', 'offAuctionPrices',
];

/**
 * A column is treated as a formula column when at least this share of its
 * populated cells carry one.
 *
 * Not 100%, because a column can legitimately be part formula and part typed
 * during a backfill — `transmuteRecipes!ResolvedYear` is 1,943 of 1,985 in the
 * live workbook and is plainly a formula column.
 *
 * The floor is ZERO, not a small share: a column is `typed` only when NOTHING
 * in it is a formula. A single formula in a column full of typed values is not
 * a rounding error, it is the thing worth seeing — and treating it as typed
 * would put numeric validation over a formula and say nothing about it.
 * Everything in between is REPORTED as mixed and left alone, because an honest
 * "I do not know what this column is" beats a confident wrong protection.
 */
var HARDEN_FORMULA_SHARE = 0.9;
var HARDEN_MIXED_SHARE = 0;

/**
 * How many data rows to read per tab when classifying columns.
 *
 * Reading everything would be ~350,000 cells — `rawPricesData` alone is 18,466
 * rows by 8 columns, and it is read twice, once for formulas and once for
 * displayed values. That is a script that times out rather than a script that
 * is slow.
 *
 * A sample is enough because the question is what KIND of column this is, not
 * what is in it, and these columns are uniform by construction: a formula
 * column is an ARRAYFORMULA or a filled-down VLOOKUP. The one thing a sample
 * could miss is a column that turns typed thousands of rows down — so the
 * report says how many rows it looked at, and never claims to have seen more.
 */
var HARDEN_SAMPLE_ROWS = 2000;

// ===========================================================================
// Pure rules
// ===========================================================================

/** Index of `header` in a header row, case- and space-insensitively, or -1. */
function hardenFindColumn(headers, header) {
  var want = String(header).toLowerCase().replace(/\s+/g, ' ').trim();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase().replace(/\s+/g, ' ').trim() === want) return i;
  }
  return -1;
}

/**
 * Classify one column from what its cells contain.
 *
 * `formulas` and `values` are parallel arrays of the column's DATA cells (row 2
 * down). A cell counts as populated when its displayed value is non-empty; a
 * column that is entirely empty is `'empty'` and nothing is done to it.
 */
function hardenClassifyColumn(formulas, values) {
  var populated = 0, withFormula = 0;
  for (var i = 0; i < values.length; i++) {
    var hasFormula = formulas[i] !== '' && formulas[i] != null;
    var hasValue = String(values[i] == null ? '' : values[i]).trim() !== '';
    if (!hasFormula && !hasValue) continue;
    populated++;
    if (hasFormula) withFormula++;
  }
  if (!populated) return { kind: 'empty', populated: 0, formulas: 0 };
  var share = withFormula / populated;
  var kind = share >= HARDEN_FORMULA_SHARE ? 'formula'
    : share <= HARDEN_MIXED_SHARE ? 'typed'
      : 'mixed';
  return { kind: kind, populated: populated, formulas: withFormula, share: share };
}

/**
 * Is this A1 reference safe against growth?
 *
 * `prices!$A:$G` is. `prices!$A$2:$G$8316` is not, and that is not a
 * hypothetical: `auctionFullData` was exactly that, with 563 rows of headroom
 * against ~1,500 added per season, so it would have stopped including new sales
 * roughly 40% of the way into 2027 — silently, with no `#REF!` and no `#N/A`,
 * just a withheld average computed over a truncated window. Wrong numbers that
 * look fine. It was repointed on 2026-08-20; this is the rule that keeps it
 * that way, and catches the next one.
 */
function hardenRangeVerdict(name, a1) {
  var text = String(a1 == null ? '' : a1);
  if (/#REF!/.test(text)) {
    return { level: 'dead', why: 'points at #REF! — it resolves to nothing' };
  }
  var parts = text.split('!');
  var tab = parts.length > 1 ? parts[0].replace(/^'|'$/g, '') : '';
  var ref = parts.length > 1 ? parts[1] : text;
  // A whole-column reference has no row numbers on either end: $A:$G.
  if (!/\d/.test(ref)) return { level: 'ok', why: 'whole-column', tab: tab };
  if (HARDEN_WHOLE_COLUMN_TABS.indexOf(tab) === -1) {
    return { level: 'ok', why: 'fixed bounds, but ' + (tab || 'this range') + ' is not a growing data tab', tab: tab };
  }
  var lastRow = null;
  var m = ref.match(/(\d+)\s*$/);
  if (m) lastRow = parseInt(m[1], 10);
  return {
    level: 'bounded',
    tab: tab,
    lastRow: lastRow,
    why: 'fixed bounds over ' + tab + ', which grows — it will stop including new rows without erroring',
  };
}

/**
 * Everything the operator needs to decide, from a description of the workbook.
 *
 * `book` is `{ tabs: { name: { headers: [], columns: [{formulas, values}], rows } },
 * namedRanges: [{name, a1}], validation: { 'tab!header': true } }`. Taking it as
 * a parameter rather than reading SpreadsheetApp is what makes every rule above
 * testable off-platform.
 */
function hardenPlan(book) {
  var actions = [], notes = [], problems = [], i, j;

  // --- 1. named ranges ------------------------------------------------------
  var ranges = book.namedRanges || [];
  for (i = 0; i < ranges.length; i++) {
    var verdict = hardenRangeVerdict(ranges[i].name, ranges[i].a1);
    var dead = HARDEN_DEAD_RANGES.indexOf(ranges[i].name) !== -1;
    if (dead) {
      actions.push({ kind: 'deleteRange', name: ranges[i].name, destructive: true,
        detail: ranges[i].name + ' -> ' + ranges[i].a1 + ' (' + verdict.why + ')' });
    } else if (verdict.level === 'bounded') {
      problems.push('named range ' + ranges[i].name + ' -> ' + ranges[i].a1 + ': ' + verdict.why +
        '. Repoint it to a whole-column reference by hand — widening a range that feeds a QUERY ' +
        'is inert today but is not something a script should do unasked.');
    } else if (verdict.level === 'dead') {
      problems.push('named range ' + ranges[i].name + ' ' + verdict.why +
        ', and it is not on the known-dead list. Check it by name in the UI before deleting.');
    }
  }
  if (!ranges.length) notes.push('no named ranges were readable — nothing checked there');

  // --- 2 & 4. per-column validation ----------------------------------------
  var wanted = [];
  for (i = 0; i < HARDEN_PRICE_COLUMNS.length; i++) {
    wanted.push({ tab: HARDEN_PRICE_COLUMNS[i].tab, header: HARDEN_PRICE_COLUMNS[i].header, rule: 'number' });
  }
  for (i = 0; i < HARDEN_COUNT_COLUMNS.length; i++) {
    wanted.push({ tab: HARDEN_COUNT_COLUMNS[i].tab, header: HARDEN_COUNT_COLUMNS[i].header, rule: 'wholeNumber' });
  }
  for (i = 0; i < HARDEN_VOCABULARY.length; i++) {
    var v = HARDEN_VOCABULARY[i];
    wanted.push({ tab: v.tab, header: v.header, rule: 'list', values: v.values, grows: v.grows });
  }

  for (i = 0; i < wanted.length; i++) {
    var want = wanted[i];
    var tab = (book.tabs || {})[want.tab];
    if (!tab) { problems.push('no tab named "' + want.tab + '" — cannot validate its ' + want.header + ' column'); continue; }
    var at = hardenFindColumn(tab.headers, want.header);
    if (at === -1) {
      problems.push('tab "' + want.tab + '" has no "' + want.header + '" column — its headers are: ' + tab.headers.join(', '));
      continue;
    }
    var column = tab.columns[at] || { formulas: [], values: [] };
    var shape = hardenClassifyColumn(column.formulas, column.values);
    if (shape.kind === 'formula') {
      notes.push(want.tab + '!' + want.header + ' is a formula column (' + shape.formulas + '/' + shape.populated +
        ' cells) — validating it would be pointless, and it is protected below instead');
      continue;
    }
    if (shape.kind === 'mixed') {
      problems.push(want.tab + '!' + want.header + ' is MIXED — ' + shape.formulas + ' of ' + shape.populated +
        ' populated cells carry a formula. Not touched: a rule for this column would be wrong for one half of it.');
      continue;
    }
    if (book.validation && book.validation[want.tab + '!' + want.header]) {
      notes.push(want.tab + '!' + want.header + ' already has data validation');
      continue;
    }
    actions.push({ kind: 'validate', tab: want.tab, header: want.header, column: at,
      rule: want.rule, values: want.values, grows: want.grows, rows: tab.rows,
      detail: want.tab + '!' + want.header + ' -> ' +
        (want.rule === 'list'
          ? (want.grows ? 'dropdown (warn only), ' : 'dropdown (reject), ') + want.values.length + ' value(s)'
          : want.rule === 'wholeNumber' ? 'whole numbers only' : 'numbers only') });
  }

  // --- 3. protect every formula column --------------------------------------
  var tabNames = [];
  for (var name in book.tabs) if (book.tabs.hasOwnProperty(name)) tabNames.push(name);
  tabNames.sort();
  for (i = 0; i < tabNames.length; i++) {
    var t = book.tabs[tabNames[i]];
    if (t.truncated) {
      notes.push(tabNames[i] + ': columns classified from the first ' + t.sampled + ' of ' + (t.rows - 1) +
        ' data rows — a column that changes kind further down would not be seen');
    }
    for (j = 0; j < t.headers.length; j++) {
      var col = t.columns[j] || { formulas: [], values: [] };
      var s = hardenClassifyColumn(col.formulas, col.values);
      // A MIXED column is reported wherever it is found, not only when it is on
      // one of the lists above — a column drifting from all-formula to
      // part-typed is precisely the change worth seeing, and it is invisible
      // from outside the workbook. `contextItems!priceAugmented` is the known
      // one: its withheld rows are a QUERY and its token and grunnel rows are
      // typed. Nothing is done to it either way.
      if (s.kind === 'mixed') {
        problems.push(tabNames[i] + '!' + t.headers[j] + ' is MIXED — ' + s.formulas + ' of ' + s.populated +
          ' populated cells carry a formula. Not touched: protecting it would lock cells a human has to edit, ' +
          'and leaving it unprotected lets someone overwrite a formula. Know which rows are which.');
        continue;
      }
      if (s.kind !== 'formula') continue;
      if (t.protectedColumns && t.protectedColumns.indexOf(j) !== -1) {
        notes.push(tabNames[i] + '!' + t.headers[j] + ' is already protected');
        continue;
      }
      actions.push({ kind: 'protect', tab: tabNames[i], header: t.headers[j], column: j, rows: t.rows,
        detail: tabNames[i] + '!' + t.headers[j] + ' (' + s.formulas + '/' + s.populated + ' cells are formulas)' });
    }
  }

  return { actions: actions, notes: notes, problems: problems };
}

/** The plan as text, for the dialog. */
function hardenDescribePlan(plan) {
  var out = [], i;
  var byKind = { validate: [], protect: [], deleteRange: [] };
  for (i = 0; i < plan.actions.length; i++) {
    var a = plan.actions[i];
    if (byKind[a.kind]) byKind[a.kind].push(a.detail);
  }

  out.push('WOULD CHANGE ' + plan.actions.length + ' thing(s).');
  out.push('');
  out.push('DATA VALIDATION — ' + byKind.validate.length);
  for (i = 0; i < byKind.validate.length; i++) out.push('  ' + byKind.validate[i]);
  out.push('');
  out.push('PROTECT FORMULA COLUMNS — ' + byKind.protect.length);
  for (i = 0; i < byKind.protect.length; i++) out.push('  ' + byKind.protect[i]);
  out.push('');
  if (byKind.deleteRange.length) {
    out.push('DELETE NAMED RANGES — ' + byKind.deleteRange.length + '  ** the only step that cannot be re-run away **');
    for (i = 0; i < byKind.deleteRange.length; i++) out.push('  ' + byKind.deleteRange[i]);
    out.push('');
  }
  if (plan.problems.length) {
    out.push('NEEDS A HUMAN — ' + plan.problems.length);
    for (i = 0; i < plan.problems.length; i++) out.push('  • ' + plan.problems[i]);
    out.push('');
  }
  out.push('ALREADY DONE OR NOT APPLICABLE — ' + plan.notes.length);
  for (i = 0; i < Math.min(plan.notes.length, 25); i++) out.push('  · ' + plan.notes[i]);
  if (plan.notes.length > 25) out.push('  · … and ' + (plan.notes.length - 25) + ' more');
  out.push('');
  out.push('Remember what this does NOT do: a PASTE bypasses data validation, and');
  out.push('every routine update to this workbook is a paste. The vocabularies are');
  out.push('checked again by `npm run validate` § 7, which is the gate a paste');
  out.push('cannot get past. This layer catches typing; that layer catches pasting.');
  return out.join('\n');
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook. Nothing above it does.
// ===========================================================================

function addHardenMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Harden the sheet — dry run', 'dryRunHardenSheet')
    .addItem('Harden the sheet — apply…', 'applyHardenSheet');
}

/**
 * Read the workbook into the plain object `hardenPlan` takes.
 *
 * Reads formulas and displayed values in two bulk calls per tab rather than
 * cell by cell — `rawPricesData` alone is ~18,500 rows by 8 columns, and a
 * per-cell read of that is a script that times out rather than a script that is
 * slow.
 */
function hardenReadBook() {
  var ss = SpreadsheetApp.getActive();
  var sheets = ss.getSheets();
  var book = { tabs: {}, namedRanges: [], validation: {} };

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var name = sheet.getName();
    if (OLD_TAB_RE.test(name)) continue;                       // retired tabs still recalculate; leave them be
    if (HARDEN_SKIP_TABS.indexOf(name) !== -1) continue;       // scratch surfaces the other scripts own
    var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) continue;

    var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    var sampled = Math.min(lastRow - 1, HARDEN_SAMPLE_ROWS);
    var body = sheet.getRange(2, 1, sampled, lastCol);
    var formulas = body.getFormulas();
    var values = body.getDisplayValues();

    var columns = [];
    for (var c = 0; c < lastCol; c++) {
      var f = [], v = [];
      for (var r = 0; r < formulas.length; r++) { f.push(formulas[r][c]); v.push(values[r][c]); }
      columns.push({ formulas: f, values: v });
    }

    // Which columns already carry validation, sampled at the first data row —
    // validation is applied to whole columns here, so the first row is
    // representative of one this script set.
    var firstRow = sheet.getRange(2, 1, 1, lastCol).getDataValidations()[0];
    for (var k = 0; k < lastCol; k++) {
      if (firstRow[k]) book.validation[name + '!' + String(headers[k]).trim()] = true;
    }

    var protectedColumns = [];
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var p = 0; p < protections.length; p++) {
      var rng = protections[p].getRange();
      if (!rng) continue;
      for (var q = rng.getColumn(); q < rng.getColumn() + rng.getNumColumns(); q++) protectedColumns.push(q - 1);
    }

    book.tabs[name] = { headers: headers, columns: columns, rows: lastRow,
      sampled: sampled, truncated: sampled < lastRow - 1, protectedColumns: protectedColumns };
  }

  var named = ss.getNamedRanges();
  for (var n = 0; n < named.length; n++) {
    var a1 = '';
    try { a1 = named[n].getRange().getA1Notation(); } catch (e) { a1 = '#REF!'; }
    var sheetName = '';
    try { sheetName = named[n].getRange().getSheet().getName(); } catch (e2) { sheetName = ''; }
    book.namedRanges.push({ name: named[n].getName(), a1: (sheetName ? sheetName + '!' : '') + a1 });
  }
  return book;
}

function dryRunHardenSheet() {
  var ui = SpreadsheetApp.getUi();
  var plan = hardenPlan(hardenReadBook());
  ui.alert('Harden — dry run, nothing written (script ' + HARDEN_VERSION + ')',
    hardenDescribePlan(plan), ui.ButtonSet.OK);
}

/**
 * Apply the plan. Validation and protection are idempotent and re-runnable;
 * deleting a named range is not, so it is confirmed separately.
 */
function applyHardenSheet() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var plan = hardenPlan(hardenReadBook());

  var answer = ui.alert('Harden the sheet (script ' + HARDEN_VERSION + ')',
    hardenDescribePlan(plan) + '\n\nApply the validation and protection steps?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  var applied = 0, failed = [];
  for (var i = 0; i < plan.actions.length; i++) {
    var a = plan.actions[i];
    if (a.destructive) continue;
    try {
      var sheet = ss.getSheetByName(a.tab);
      // Whole column below the header: `getMaxRows`, not `getLastRow`, so rows
      // added next season are covered without re-running this.
      var range = sheet.getRange(2, a.column + 1, sheet.getMaxRows() - 1, 1);
      if (a.kind === 'validate') {
        var builder = SpreadsheetApp.newDataValidation();
        if (a.rule === 'list') builder = builder.requireValueInList(a.values, true).setAllowInvalid(!!a.grows);
        else if (a.rule === 'wholeNumber') builder = builder.requireNumberGreaterThan(0).setAllowInvalid(false);
        else builder = builder.requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false);
        range.setDataValidation(builder.setHelpText(
          a.rule === 'list' ? 'One of: ' + a.values.join(', ') : 'A number. See docs/updating-the-data.md.').build());
      } else if (a.kind === 'protect') {
        var protection = range.protect().setDescription(
          'Phase 7: ' + a.tab + '!' + a.header + ' is a formula column (script ' + HARDEN_VERSION + ')');
        protection.setWarningOnly(true);
      }
      applied++;
    } catch (e) {
      failed.push(a.detail + ': ' + e.message);
    }
  }

  var deletions = [];
  for (i = 0; i < plan.actions.length; i++) if (plan.actions[i].destructive) deletions.push(plan.actions[i]);
  var deleted = 0;
  if (deletions.length) {
    var list = [];
    for (i = 0; i < deletions.length; i++) list.push('  ' + deletions[i].detail);
    var confirm = ui.alert('Delete ' + deletions.length + ' dead named range(s)?',
      list.join('\n') + '\n\nThis is the one step re-running the script cannot undo. ' +
      'Check each name in the UI first if you have not already.', ui.ButtonSet.YES_NO);
    if (confirm === ui.Button.YES) {
      var named = ss.getNamedRanges();
      for (i = 0; i < named.length; i++) {
        for (var d = 0; d < deletions.length; d++) {
          if (named[i].getName() === deletions[d].name) { named[i].remove(); deleted++; }
        }
      }
    }
  }

  var report = applied + ' change(s) applied, ' + deleted + ' named range(s) deleted.';
  if (failed.length) report += '\n\nFAILED — ' + failed.length + ':\n  • ' + failed.join('\n  • ');
  report += '\n\nRe-run the dry run to confirm. Validation and protection are ' +
    'idempotent, so running this again is safe and is how you re-cover new columns.';
  ui.alert('Harden — done (script ' + HARDEN_VERSION + ')', report, ui.ButtonSet.OK);
}

// Lets Node load the pure functions for testing.
if (typeof module !== 'undefined') {
  module.exports = {
    hardenFindColumn: hardenFindColumn,
    hardenClassifyColumn: hardenClassifyColumn,
    hardenRangeVerdict: hardenRangeVerdict,
    hardenPlan: hardenPlan,
    hardenDescribePlan: hardenDescribePlan,
    HARDEN_PRICE_COLUMNS: HARDEN_PRICE_COLUMNS,
    HARDEN_COUNT_COLUMNS: HARDEN_COUNT_COLUMNS,
    HARDEN_VOCABULARY: HARDEN_VOCABULARY,
    HARDEN_DEAD_RANGES: HARDEN_DEAD_RANGES,
    HARDEN_SKIP_TABS: HARDEN_SKIP_TABS,
    HARDEN_VERSION: HARDEN_VERSION,
  };
}
