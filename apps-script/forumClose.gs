/**
 * Phase 5 (part one) — forum close from a per-lot file.
 *
 * Some forum auctioneers hand over a spreadsheet of their results rather than
 * only posting them in the thread. Where that file exists it is the record and
 * the thread is the fallback, so it is the path worth automating first: the
 * numbers are already numbers, and no prose has to be parsed to find them.
 *
 * This file is deliberately thin. Everything that matters — the quantity rule,
 * the name resolution, the per-token division, the min/max, the Onyx routing,
 * the abort on an unresolved name — is `trentClose.gs`'s, unchanged and already
 * verified against 18,466 lots. All four .gs files share ONE global scope in
 * Apps Script, so those functions are simply in scope here. What this file adds
 * is the part that is genuinely different: reading a file shape that is not
 * Trent's.
 *
 * MEASURED, from three real files by the same auctioneer (see
 * `fixtures/forum/`). "One format" would have been the wrong assumption:
 *
 *   Item | Number | Amount              one row per lot, 228 rows   (202647)
 *   Auction Item | Low Bid | High Bid   already aggregated          (202640)
 *   Row Labels | Minimum Bid | Maximum Bid | Average Bid            (202646)
 *
 * They are not equally trustworthy, and the differences were measured against
 * the shipped CSVs rather than assumed:
 *
 *   - **The per-lot shape reproduces `prices.csv` on 19 of 20 items**, and the
 *     twentieth is a duplicated row in the sheet rather than a parser error.
 *     This is the shape to ask auctioneers for.
 *   - **The low/high shape agrees on 6 of 13 and differs on 7**, in BOTH
 *     directions — sometimes wider than the recorded range, sometimes
 *     narrower. It is imported with a loud caution rather than refused,
 *     because the file may well be right and the sheet's own rows for that
 *     auction are not internally consistent either.
 *   - **The all-bids pivot reconciles with NOTHING** — 0 of 17 items, against
 *     any of the five auctions that auctioneer ran. An `Average Bid` column is
 *     the signature of a summary of every bid received rather than a record of
 *     winning bids, and importing it would fill the price spine with losing
 *     offers. It is refused by name, and that refusal is the most valuable
 *     line in this file.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It lives in the repo and is copied into the
 * workbook's Apps Script editor. `npm run test:forum` replays all three files
 * against what `prices.csv` records.
 *
 * Everything above `--- Apps Script entry points ---` is pure. There is no
 * `onOpen` here; `trentClose.gs` calls `addForumMenu`. Every global is prefixed
 * `FORUM_` / `forum`.
 */

// ===========================================================================
// Configuration
// ===========================================================================

/** Bump with any change to this file; shown in every dialog. */
var FORUM_VERSION = '2026-08-22.2';

/** The tab the operator pastes the auctioneer's file into. */
var FORUM_STAGING_TAB = 'forumStaging';

/**
 * The item-name column. Three spellings across three files, and `Row Labels` is
 * what a spreadsheet pivot calls it rather than anything about tokens.
 */
var FORUM_NAME_HEADERS = ['item', 'auction item', 'row labels', 'product name', 'token', 'name'];

/** One price per row: the file lists lots. */
var FORUM_LOT_PRICE_HEADERS = ['amount', 'winning bid', 'winning amount', 'price', 'bid'];

/**
 * Two prices per row: the file is already aggregated per item. Each row becomes
 * TWO lots, which is not a trick — the min and max of a two-lot item are the two
 * values, so the same aggregation that serves a per-lot file reproduces an
 * already-aggregated one without a second code path.
 */
var FORUM_LOW_HEADERS = ['low bid', 'minimum bid', 'min bid', 'lowest bid'];
var FORUM_HIGH_HEADERS = ['high bid', 'maximum bid', 'max bid', 'highest bid'];

/**
 * Headers that mean the file is a pivot over ALL bids rather than a record of
 * winning bids. Refuse the file rather than import it.
 *
 * This is measured, not cautious: the one file carrying an `Average Bid` column
 * reconciles with NO recorded auction — 0 of 17 items match on min and max
 * against any of the five that auctioneer ran. Its ranges are far wider than
 * the winning prices, which is exactly what a column of losing offers looks
 * like.
 *
 * **Confirmed by the maintainer on 2026-08-22: that file was every bid, not the
 * winners.** So this is not a heuristic hedging against a possibility; it is a
 * known-bad shape being turned away. Nothing in the numbers says so — only the
 * header gives it away.
 */
var FORUM_REFUSE_HEADERS = ['average bid', 'average', 'avg bid', 'avg', 'mean bid'];

/** A row whose price cell says this is withheld, not sold. */
var FORUM_WITHHELD_RE = /^\s*(withheld|withdrawn|not sold|kept)\s*$/i;

/** A pivot's trailing total row, which is not a lot. */
var FORUM_TOTAL_RE = /^\s*(grand\s+)?totals?\s*$/i;

/**
 * `AI 10x` means the same as `10x AI`, and only the second form is what the
 * shared quantity rule reads. Rewriting it here keeps that rule — verified
 * against 18,466 Trent lots and all 491 normalization rows — completely
 * untouched. A trailing-quantity rule added to the shared parser would apply to
 * Trent's corpus too, for no reason and at some risk.
 */
function forumNormaliseName(name) {
  var s = String(name == null ? '' : name).trim();
  var trailing = s.match(/^(.*?)[\s,]+(\d+)\s*[xX]$/);
  if (trailing) return trailing[2] + 'x ' + trailing[1].trim();
  return s;
}

// ===========================================================================
// Pure reading
// ===========================================================================

function forumFindColumn(header, aliases) {
  for (var i = 0; i < header.length; i++) {
    if (aliases.indexOf(header[i]) !== -1) return i;
  }
  return -1;
}

/**
 * A pasted file to the same `{ lots: [{name, bid, row}] }` shape
 * `trentClose.gs`'s `readStaging` produces, so everything downstream is shared.
 */
function forumReadStaging(values) {
  if (!values || !values.length) return { error: 'the staging tab is empty' };
  var header = values[0].map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });

  var refused = [];
  for (var i = 0; i < header.length; i++) {
    if (FORUM_REFUSE_HEADERS.indexOf(header[i]) !== -1) refused.push(values[0][i]);
  }
  if (refused.length) {
    return {
      error: 'this file has an "' + refused.join('", "') + '" column, which means it is a summary of EVERY bid ' +
        'received rather than a record of the winning bids. Importing it would fill the price spine with ' +
        'losing offers. Ask the auctioneer for the winning bids — one row per lot, or a low/high pair per item.',
    };
  }

  var nameCol = forumFindColumn(header, FORUM_NAME_HEADERS);
  var lotCol = forumFindColumn(header, FORUM_LOT_PRICE_HEADERS);
  var lowCol = forumFindColumn(header, FORUM_LOW_HEADERS);
  var highCol = forumFindColumn(header, FORUM_HIGH_HEADERS);
  var priceCols = [];
  var shape = null;
  if (lowCol !== -1 && highCol !== -1) { priceCols = [lowCol, highCol]; shape = 'a low/high pair per item'; }
  else if (lotCol !== -1) { priceCols = [lotCol]; shape = 'one row per lot'; }
  else if (highCol !== -1) { priceCols = [highCol]; shape = 'one row per lot'; }

  if (nameCol === -1 || !priceCols.length) {
    return {
      error: 'could not find the name and price columns. Row 1 reads [' + header.join(' | ') + ']; expected a ' +
        'name column from [' + FORUM_NAME_HEADERS.join(', ') + '] and either a price column from [' +
        FORUM_LOT_PRICE_HEADERS.join(', ') + '] or a low/high pair.',
    };
  }

  var lots = [], withheld = [], blank = 0;
  for (var r = 1; r < values.length; r++) {
    var name = forumNormaliseName(values[r][nameCol]);
    if (!name || FORUM_TOTAL_RE.test(name)) continue;

    var isWithheld = false, values_ = [];
    for (var c = 0; c < priceCols.length; c++) {
      var raw = values[r][priceCols[c]];
      var text = String(raw == null ? '' : raw).replace(/[$,]/g, '').trim();
      if (FORUM_WITHHELD_RE.test(text)) { isWithheld = true; continue; }
      if (text === '') continue;
      var n = parseFloat(text);
      if (!isNaN(n)) values_.push(roundCents(n));
    }
    if (isWithheld && !values_.length) { withheld.push({ name: name, row: r + 1 }); continue; }
    if (!values_.length) { blank++; continue; }
    for (var v = 0; v < values_.length; v++) lots.push({ name: name, bid: values_[v], row: r + 1 });
  }
  return { lots: lots, withheld: withheld, blank: blank, shape: shape, columns: priceCols.length };
}

/**
 * The forum equivalent of `planImport`. Same aborts, same routing, same
 * numbers — the only differences are the file shape and the withheld list,
 * which a Trent file never carries.
 */
function forumPlanImport(values, targetSeason, tokenMetadataRows) {
  var staged = forumReadStaging(values);
  if (staged.error) return { ok: false, aborts: [staged.error], cautions: [], lots: 0 };
  if (!staged.lots.length) return { ok: false, aborts: ['no priced rows found in the staging tab'], cautions: [], lots: 0 };

  var index = buildTokenIndex(tokenMetadataRows);
  var names = [];
  for (var k = 0; k < staged.lots.length; k++) names.push(staged.lots[k].name);
  var seasons = inferSeasons(names, index);
  var result = processAuction(staged.lots, targetSeason, index);
  var aborts = result.aborts.slice();
  var cautions = [];

  // Same rule as Phase 2, deliberately: only a POSITIVE season mismatch aborts.
  // An inconclusive answer is not evidence of a mistake.
  if (!seasons.length || seasons.length > 1) {
    cautions.push('nothing in this file is unique to one season, so it could not be checked against season ' +
      targetSeason + ' — confirm you picked the right auction');
  } else if (seasons[0] !== String(targetSeason)) {
    aborts.push('this file looks like season ' + seasons[0] + ', but the chosen auction is season ' +
      targetSeason + ' — check you picked the right auction');
  }

  if (staged.withheld.length) {
    cautions.push(staged.withheld.length + ' row(s) marked withheld were NOT imported: ' +
      forumWithheldNames(staged.withheld).join(', ') + '. A withheld item belongs in contextItems, with no price.');
  }
  if (staged.blank) cautions.push(staged.blank + ' row(s) had no price and were skipped.');

  // An already-aggregated file is a WEAKER source than a per-lot one, and the
  // difference is measured rather than assumed. Replayed against the only
  // auction there is a file for, the per-lot shape reproduces the sheet on 19
  // of 20 items; the low/high shape agrees on 7 of 13 and disagrees on 6 — in
  // BOTH directions, sometimes wider than the sheet and sometimes narrower. One
  // of the two is wrong on those items and the file cannot say which, so this
  // shape is imported only with the operator's eyes on the numbers.
  if (staged.columns === 2) {
    cautions.push('this file is already aggregated to a low/high pair, which is a WEAKER source than a ' +
      'per-lot file and has not been shown to reproduce the sheet. Replayed against the one auction there ' +
      'is a file for, it agreed on 6 of 13 items and differed on 7 — in both directions, sometimes wider ' +
      'than the recorded range and sometimes narrower. Treat these numbers as a draft, check them, and ' +
      'ask for a per-lot file if the auctioneer can send one.');
  }

  return {
    ok: aborts.length === 0,
    aborts: aborts,
    cautions: cautions,
    seasons: seasons,
    shape: staged.shape,
    columns: staged.columns,
    lots: staged.lots.length,
    withheld: staged.withheld,
    raw: result.raw,
    prices: result.prices,
    onyx: result.onyx,
    unsold: result.unsold,
    unresolved: result.unresolved,
  };
}

function forumWithheldNames(withheld) {
  var out = [];
  for (var i = 0; i < withheld.length; i++) out.push(withheld[i].name);
  return out;
}

/**
 * Whether the per-lot rows are worth keeping.
 *
 * `rawPricesData` is the per-lot spine and drives the Quartiles view. A file
 * that is already aggregated has no per-lot rows to contribute — its two
 * "lots" per item are a min and a max, not two sales — so writing them would
 * invent sales that never happened. Only a genuine per-lot file feeds it.
 */
function forumKeepsRawRows(plan) {
  return plan.columns !== 2 && plan.shape === 'one row per lot';
}

function forumDescribePlan(plan, auctionId) {
  var lines = [];
  if (!plan.ok) {
    lines.push('NOTHING WILL BE WRITTEN — ' + plan.aborts.length + ' problem(s):');
    for (var i = 0; i < plan.aborts.length; i++) lines.push('  • ' + plan.aborts[i]);
    if (plan.cautions.length) {
      lines.push('');
      for (var c = 0; c < plan.cautions.length; c++) lines.push('  note: ' + plan.cautions[c]);
    }
    return lines.join('\n');
  }
  lines.push('Auction ' + auctionId + ' — ' + plan.lots + ' value(s) read (' + plan.shape + '):');
  if (forumKeepsRawRows(plan)) lines.push('  ' + plan.raw.length + ' priced lots  ->  rawPricesData');
  else lines.push('  no rawPricesData rows — this file is already aggregated, so there are no per-lot sales to record');
  lines.push('  ' + plan.prices.length + ' min/max rows  ->  prices');
  if (plan.onyx.length) lines.push('  ' + plan.onyx.length + ' Onyx rows  ->  onyx');
  if (plan.unsold.length) lines.push('  ' + plan.unsold.length + ' unsold lot(s) dropped');
  if (plan.cautions.length) {
    lines.push('');
    lines.push('CAUTION:');
    for (var j = 0; j < plan.cautions.length; j++) lines.push('  • ' + plan.cautions[j]);
  }
  return lines.join('\n');
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook. Nothing above it does.
// ===========================================================================

function addForumMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Import forum close from a file…', 'importForumClose')
    .addItem('Dry run — show what the file would import', 'dryRunForumClose');
}

function forumTargetAuction(ui, title) {
  var meta = readTab(TABS.metadata);
  var choice = ui.prompt(title, 'Target auctionId?', ui.ButtonSet.OK_CANCEL);
  if (choice.getSelectedButton() !== ui.Button.OK) return null;
  var auctionId = choice.getResponseText().trim();
  for (var i = 0; i < meta.length; i++) if (meta[i].auctionId === auctionId) return meta[i];
  ui.alert('No auction "' + auctionId + '" in ' + TABS.metadata + '.');
  return null;
}

function forumCheckTabs() {
  var ss = SpreadsheetApp.getActive();
  var problems = checkTabs();
  if (!ss.getSheetByName(FORUM_STAGING_TAB)) problems.push('no tab named "' + FORUM_STAGING_TAB + '"');
  return problems;
}

function dryRunForumClose() {
  var ui = SpreadsheetApp.getUi();
  var missing = forumCheckTabs();
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }
  var target = forumTargetAuction(ui, 'Dry run');
  if (!target) return;
  var staging = SpreadsheetApp.getActive().getSheetByName(FORUM_STAGING_TAB);
  var plan = forumPlanImport(staging.getDataRange().getDisplayValues(), target.auctionSeason, readTab(TABS.tokens));
  ui.alert('Dry run — nothing written (script ' + FORUM_VERSION + ')',
    forumDescribePlan(plan, target.auctionId), ui.ButtonSet.OK);
  showContextWorksheet(plan, target);
}

function importForumClose() {
  var ui = SpreadsheetApp.getUi();
  var missing = forumCheckTabs();
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }
  var target = forumTargetAuction(ui, 'Import forum close');
  if (!target) return;

  var staging = SpreadsheetApp.getActive().getSheetByName(FORUM_STAGING_TAB);
  var plan = forumPlanImport(staging.getDataRange().getDisplayValues(), target.auctionSeason, readTab(TABS.tokens));
  if (!plan.ok) {
    ui.alert('Cannot import (script ' + FORUM_VERSION + ')', forumDescribePlan(plan, target.auctionId), ui.ButtonSet.OK);
    showContextWorksheet(plan, target);
    return;
  }

  var answer = ui.alert('Import (script ' + FORUM_VERSION + ')',
    forumDescribePlan(plan, target.auctionId) + '\n\nWrite these rows?', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;

  if (forumKeepsRawRows(plan)) appendRows(TABS.raw, forumRawRows(plan, target));
  appendRows(TABS.prices, forumPriceRows(plan, target));
  if (plan.onyx.length) appendRows(TABS.onyx, forumOnyxRows(plan, target));
  SpreadsheetApp.flush();

  ui.alert('Imported (script ' + FORUM_VERSION + ')',
    forumDescribePlan(plan, target.auctionId) + '\n\nDone. Publish when you are ready.', ui.ButtonSet.OK);
  showContextWorksheet(plan, target);
}

function forumPriceRows(plan, target) {
  var rows = [];
  for (var i = 0; i < plan.prices.length; i++) {
    var p = plan.prices[i];
    rows.push([target.auctionId, target.auctionSeason, target.auctionNumber, p.Item, p.Price, p['Display Name'], p.Category]);
  }
  return rows;
}

function forumRawRows(plan, target) {
  var rows = [];
  for (var i = 0; i < plan.raw.length; i++) {
    var r = plan.raw[i];
    rows.push([target.auctionId, target.auctionSeason, target.auctionNumber,
      r.trentName, r.trentPrice, r.Item, r.Price, r.Category]);
  }
  return rows;
}

function forumOnyxRows(plan, target) {
  var rows = [];
  for (var i = 0; i < plan.onyx.length; i++) {
    var o = plan.onyx[i];
    rows.push([target.auctionId, target.auctionSeason, target.auctionNumber, o.Item, o.Price, o['Display Name'], o.Category]);
  }
  return rows;
}

// Lets Node load the pure functions for testing.
if (typeof module !== 'undefined') {
  module.exports = {
    forumNormaliseName: forumNormaliseName,
    forumReadStaging: forumReadStaging,
    forumPlanImport: forumPlanImport,
    forumDescribePlan: forumDescribePlan,
    forumKeepsRawRows: forumKeepsRawRows,
    forumFindColumn: forumFindColumn,
    FORUM_REFUSE_HEADERS: FORUM_REFUSE_HEADERS,
    FORUM_NAME_HEADERS: FORUM_NAME_HEADERS,
    FORUM_LOT_PRICE_HEADERS: FORUM_LOT_PRICE_HEADERS,
    FORUM_STAGING_TAB: FORUM_STAGING_TAB,
    FORUM_VERSION: FORUM_VERSION,
  };
}
