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
 * Those three are not three formats to support. They are one format and two
 * rejected drafts: the maintainer and the auctioneer spent the 2026 season
 * working out what the site actually needs, and **the per-lot shape is the
 * answer they arrived at**. Build for it; tolerate the second; turn the third
 * away.
 *
 *   - **The per-lot shape reproduces `prices.csv` on 19 of 20 items**, and the
 *     twentieth is a duplicated row in the sheet rather than a parser error.
 *     **This is the format to ask auctioneers for**, and the one this file is
 *     built around.
 *   - **The low/high shape agrees on 7 of 14 and differs on 7**, in BOTH
 *     directions — sometimes wider than the recorded range, sometimes
 *     narrower. An earlier draft. Imported with a loud caution rather than
 *     refused, since the sheet's own rows for that auction are not internally
 *     consistent either.
 *   - **The pivot reconciles with NOTHING** — 0 of 17 items, against any of the
 *     five auctions that auctioneer ran. A rejected draft, refused by its
 *     `Average Bid` header.
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
var FORUM_VERSION = '2026-08-26.1';

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
 * **What that file actually was (maintainer, 2026-08-22): a bad format.** It
 * came out of a back-and-forth with the auctioneer about what data the site
 * needs, and it was one of the attempts that did not work — not a record anyone
 * intended to be imported. Whether its columns are all bids or winning bids was
 * never settled and does not need to be: it reconciles with nothing, it is not
 * the format being asked for, and it should be turned away rather than guessed
 * at. Nothing in the numbers says so — only the header gives it away.
 */
var FORUM_REFUSE_HEADERS = ['average bid', 'average', 'avg bid', 'avg', 'mean bid'];

/**
 * Names that are CONTEXT ITEMS, not tokens — recognised rather than unresolved.
 *
 * Phase 2's rule is that an unresolved lot name aborts the run, and it is a good
 * rule: an unrecognised name is usually a token spelled a way the resolver does
 * not know, and guessing would put a wrong price in the spine. But these three
 * names are not unrecognised. They recur in every file this auctioneer sends,
 * they are never tokens, and where they belong is already known — so aborting on
 * them makes the operator hand-edit 17 rows out of the staging tab before a
 * clean file will import. Routing them is the same correction Phase 2 already
 * made for Onyx lots: rules, not an abort.
 *
 * `aggregate` is the difference between one context row and several, and it is
 * measured against what `contextItems` records for 202647:
 *
 *   - `Random UR` — 9 lots at 55,55,55,55,55,55,55,57,55 in the file, and ONE
 *     row in the sheet: quantity 9, $497. So the lots are summed.
 *   - `Grunnel Augment` — 6 lots at 161,137,103,72,455,112, and SIX rows in the
 *     sheet at exactly those prices, named Tomb of Terror Redux Banner, Acorn
 *     from Felurian's Feast, GenCon 2026 Tornado Bucket, Bead of the Lucky
 *     Traveler, Green Key and Borrowed Ring #4. One row per lot, and the NAME
 *     is left blank because it exists only in the thread. The file gives the
 *     prices; the thread gives the identities.
 *   - `Player Augment` — 2 lots at 47 and 51, and two rows, likewise named only
 *     in the thread ("Censer and 2 of each incense", "4x Baby Potatoes").
 *
 * Anything NOT in this table still aborts. That is the point: this is a list of
 * names whose meaning is known, not a licence to guess at unknown ones.
 */
var FORUM_CONTEXT_RULES = {
  'random ur': { category: 'token', aggregate: true, item: 'Random UR' },
  'random urs': { category: 'token', aggregate: true, item: 'Random UR' },
  'grunnel augment': { category: 'grunnel', aggregate: false },
  'player augment': { category: 'token', aggregate: false },
};

/**
 * The `Item` an aggregated row is written under.
 *
 * `item` on the rule, not the spelling the file happened to use. `contextItems`
 * records `Random UR`; a file writing `Random Urs` would otherwise create a
 * second, near-identical Item that every later grouping treats as a different
 * thing. The site joins on these names.
 */
function forumContextDisplayName(name) {
  var rule = forumContextRule(name);
  if (rule && rule.item) return rule.item;
  return String(name == null ? '' : name)
    .replace(/^\s*\d+\s*x\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

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

/**
 * The key a name is looked up under in FORUM_CONTEXT_RULES.
 *
 * A quantity can be spread over rows or written into the name, and a count can
 * be parenthesised — `Random UR` × 9, `9x Random UR`, `Random Urs (9-10)` are
 * all the same thing. Matching only the bare spelling would route the first and
 * abort on the other two, which is a distinction the auctioneer never intended
 * to make.
 *
 * This normalisation is used ONLY to look up this short table. Token resolution
 * is untouched by it.
 */
function forumContextKey(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/^\s*\d+\s*x\s+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function forumContextRule(name) {
  return FORUM_CONTEXT_RULES[forumContextKey(name)] || null;
}

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

  // Pull the known context names out BEFORE anything tries to resolve them as
  // tokens, so a file full of them imports rather than aborting 17 times.
  //
  // Per-lot files only. An aggregated file's two values for a row are a min and
  // a max, so there are no lots to add up and a total cannot be computed —
  // summing them would produce a number that means nothing. Those names fall
  // through to the ordinary unresolved path instead, where the operator decides.
  var context = [], kept = [];
  for (var k = 0; k < lots.length; k++) {
    if (priceCols.length === 1 && forumContextRule(lots[k].name)) context.push(lots[k]);
    else kept.push(lots[k]);
  }
  return {
    lots: kept, context: context, withheld: withheld, blank: blank,
    shape: shape, columns: priceCols.length,
  };
}

/**
 * The recognised context lots, as `contextItems` rows.
 *
 * Emitted in that tab's own column order so the block pastes straight in, with
 * `category` already filled — the one column Phase 2 deliberately leaves blank,
 * because there it is a judgement. Here it is not: the table says what these
 * names are.
 *
 * `Item` is left blank for the per-lot kind. The file calls six different
 * grunnel augments `Grunnel Augment`, and only the thread says which was which.
 * A blank cell asks the operator for the one fact the file genuinely lacks.
 */
function forumContextRows(contextLots, target) {
  var groups = {}, order = [], i;
  for (i = 0; i < contextLots.length; i++) {
    var lot = contextLots[i];
    var key = forumContextKey(lot.name);
    if (!groups[key]) { groups[key] = { name: forumContextDisplayName(lot.name), rule: forumContextRule(lot.name), lots: [] }; order.push(key); }
    groups[key].lots.push(lot);
  }
  var rows = [];
  for (i = 0; i < order.length; i++) {
    var g = groups[order[i]];
    if (g.rule.aggregate) {
      // Sum the lots' OWN prices; never quantity × a unit price. The lots of one
      // aggregated item routinely sell at different prices — 202647's nine
      // Random URs went eight at $55 and one at $57 — and the sheet records the
      // total, $497, not nine times anything. A unit-price model would have to
      // pick a representative and would be wrong by $2 here, which is precisely
      // the error this file's own history contains: the row read $495 (9 × $55)
      // until it was corrected.
      var total = 0, quantity = 0;
      for (var j = 0; j < g.lots.length; j++) {
        total = roundCents(total + g.lots[j].bid);
        // One row per lot is the usual spelling, but `9x Random UR` on a single
        // row means the same thing, and counting rows would call that one token.
        quantity += parseQuantity(g.lots[j].name).quantity || 1;
      }
      rows.push([target.auctionId, target.auctionSeason, target.auctionNumber,
        g.rule.category, g.name, quantity, total]);
    } else {
      for (var k = 0; k < g.lots.length; k++) {
        rows.push([target.auctionId, target.auctionSeason, target.auctionNumber,
          g.rule.category, '', 1, g.lots[k].bid]);
      }
    }
  }
  return rows;
}

/**
 * How an aggregated total was arrived at — `8 @ $55 + 1 @ $57 = $497`.
 *
 * `contextItems` has no column for this, so it goes in the dialog. A total is
 * not checkable on its own; the breakdown it came from is, and the plan already
 * settled that principle for Phase 5's prices — show the distribution beside the
 * number so an override is a judgement rather than a guess. It applies just as
 * well to a sum.
 */
function forumAggregateBreakdown(contextLots) {
  var lines = [], groups = {}, order = [], i;
  for (i = 0; i < contextLots.length; i++) {
    var key = forumContextKey(contextLots[i].name);
    var rule = FORUM_CONTEXT_RULES[key];
    if (!rule || !rule.aggregate) continue;
    if (!groups[key]) { groups[key] = { name: forumContextDisplayName(contextLots[i].name), prices: [] }; order.push(key); }
    groups[key].prices.push(contextLots[i].bid);
  }
  for (i = 0; i < order.length; i++) {
    var g = groups[order[i]];
    var counts = {}, seen = [], total = 0, p;
    for (var j = 0; j < g.prices.length; j++) {
      p = g.prices[j];
      if (counts[p] === undefined) { counts[p] = 0; seen.push(p); }
      counts[p]++;
      total = roundCents(total + p);
    }
    seen.sort(function (a, b) { return a - b; });
    var parts = [];
    for (var k = 0; k < seen.length; k++) parts.push(counts[seen[k]] + ' @ $' + seen[k]);
    lines.push(g.name + ': ' + parts.join(' + ') + ' = $' + total);
  }
  return lines;
}

/** The same block as tab-separated text, ready to paste. */
function forumContextWorksheetText(contextLots, target) {
  var rows = forumContextRows(contextLots, target);
  if (!rows.length) return '';
  var lines = [CONTEXT_COLUMNS.join('\t')];
  for (var i = 0; i < rows.length; i++) {
    var cells = [];
    for (var c = 0; c < rows[i].length; c++) cells.push(tsvCell(rows[i][c]));
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
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

  if (staged.context.length) {
    var named = 0;
    for (var n = 0; n < staged.context.length; n++) {
      if (!forumContextRule(staged.context[n].name).aggregate) named++;
    }
    cautions.push(staged.context.length + ' row(s) are context items, not prices, and are NOT written to any tab — ' +
      'copy the block into contextItems' +
      (named ? '. ' + named + ' of them need a name: the file calls them all the same thing and only the thread ' +
        'says which token each was' : '') + '.');
  }

  // An already-aggregated file is a WEAKER source than a per-lot one, and the
  // difference is measured rather than assumed. Replayed against the only
  // auction there is a file for, the per-lot shape reproduces the sheet on 19
  // of 20 items; the low/high shape agrees on 7 of 14 and disagrees on 7 — in
  // BOTH directions, sometimes wider than the sheet and sometimes narrower. One
  // of the two is wrong on those items and the file cannot say which, so this
  // shape is imported only with the operator's eyes on the numbers.
  if (staged.columns === 2) {
    cautions.push('this file is already aggregated to a low/high pair, which is a WEAKER source than a ' +
      'per-lot file and has not been shown to reproduce the sheet. Replayed against the one auction there ' +
      'is a file for, it agreed on 7 of 14 items and differed on 7 — in both directions, sometimes wider ' +
      'than the recorded range and sometimes narrower. Treat these numbers as a draft, check them, and ' +
      'ask for a per-lot file if the auctioneer can send one.');
  }

  return {
    ok: aborts.length === 0,
    aborts: aborts,
    cautions: cautions,
    seasons: seasons,
    context: staged.context,
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
  forumShowContext(plan, target);
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
    forumShowContext(plan, target);
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
  forumShowContext(plan, target);
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



/** The aggregate breakdowns as an HTML list, or empty when there are none. */
function forumBreakdownHtml(plan) {
  var lines = forumAggregateBreakdown(plan.context || []);
  if (!lines.length) return '';
  var html = '<p style="margin:.5em 0 0">How the summed rows add up:</p><ul style="margin:.2em 0">';
  for (var i = 0; i < lines.length; i++) {
    html += '<li><code>' + lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</code></li>';
  }
  return html + '</ul>';
}

/**
 * Show both context blocks: the recognised ones with their category filled in,
 * and Phase 2's block for anything that resolved to no token at all.
 */
function forumShowContext(plan, target) {
  var known = forumContextWorksheetText(plan.context || [], target);
  var unknown = contextWorksheetText(plan, target);
  if (!known && !unknown) return;

  var esc = function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var html = '<div style="font:13px/1.5 Arial,sans-serif">';
  if (known) {
    html += '<p>These rows are <b>context items</b>, not prices, and were not written to any tab. ' +
      'The <code>category</code> is already filled in. <b>Rows with a blank <code>Item</code> need a name</b> — ' +
      'the file calls every augment the same thing, and only the auction thread says which token each was.</p>' +
      forumBreakdownHtml(plan) +
      '<textarea readonly style="width:100%;height:8em;font:12px monospace" onclick="this.select()">' +
      esc(known) + '</textarea>';
  }
  if (unknown) {
    html += '<p style="margin-top:1em">These lots resolved to no token in any season, so nothing was imported ' +
      'for them. Fill in <code>category</code> (<code>token</code>, <code>grunnel</code>, <code>withheld</code> ' +
      'or <code>augment</code>), check the quantities, then paste into <code>contextItems</code>. ' +
      '<b>Do not put a price on a <code>withheld</code> row.</b></p>' +
      '<textarea readonly style="width:100%;height:8em;font:12px monospace" onclick="this.select()">' +
      esc(unknown) + '</textarea>';
  }
  html += '</div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(720).setHeight(430),
    'Context items — copy into contextItems');
}

// Lets Node load the pure functions for testing.
if (typeof module !== 'undefined') {
  module.exports = {
    forumNormaliseName: forumNormaliseName,
    forumReadStaging: forumReadStaging,
    forumPlanImport: forumPlanImport,
    forumDescribePlan: forumDescribePlan,
    forumKeepsRawRows: forumKeepsRawRows,
    forumContextKey: forumContextKey,
    forumContextDisplayName: forumContextDisplayName,
    forumContextRule: forumContextRule,
    forumContextRows: forumContextRows,
    forumAggregateBreakdown: forumAggregateBreakdown,
    forumContextWorksheetText: forumContextWorksheetText,
    FORUM_CONTEXT_RULES: FORUM_CONTEXT_RULES,
    forumFindColumn: forumFindColumn,
    FORUM_REFUSE_HEADERS: FORUM_REFUSE_HEADERS,
    FORUM_NAME_HEADERS: FORUM_NAME_HEADERS,
    FORUM_LOT_PRICE_HEADERS: FORUM_LOT_PRICE_HEADERS,
    FORUM_STAGING_TAB: FORUM_STAGING_TAB,
    FORUM_VERSION: FORUM_VERSION,
  };
}
