/**
 * Phase 5 (part four) — close automation for auction.utakustradecaravan.com.
 *
 * Utaku's site is the fourth venue and the second auction SITE. Its first
 * close is `202722` (site auction #1, closed 2026-09-29), and this file reads
 * it into `rawPricesData`, `prices`, `onyx` and the auction's `closeDate`.
 *
 * ## The export is per BIDDER, not per lot
 *
 * Every other close path reads one row per lot. This site sells a quantity of
 * each item and lets every bidder name a quantity and a price per unit, so its
 * export is one row per winning bid: `Alchemist's Parchment, 12, 1.6, 19.2` is
 * somebody taking twelve at $1.60. The bidder's name is stripped from the
 * export and nothing here wants it.
 *
 * `rawPricesData` feeds Quartiles, which weighs every row equally, and the
 * other venues give it one row per 10-token Trade 1 lot. One row per token here
 * would give this venue ten times the weight; one row per bid would give a
 * bidder who took fifty the weight of one who took one. So a bid becomes
 * VIRTUAL LOTS of the size the other venues sell — `UTAKU_LOT_SIZES` — with the
 * remainder as a lot of its own (`12` is `10x` + `2x`). A remainder lot is not
 * new: `1x Alchemist's Ink` and `Alchemist's Ink (7 Tokens)` are both already
 * in the corpus. The per-token price is the bid's own and never changes.
 *
 * ## Two sources, one reader
 *
 * The site's page is rendered by JavaScript — its HTML is `Loading…` — so
 * there is nothing for Apps Script to scrape. But the page gets everything from
 * `GET /api/state`, which is public and needs no token, and which holds every
 * winner of the CURRENT auction. Measured on #1: its winners reproduce the
 * export 73 rows of 73, and sum to the site's own `raised`, $7,007.45.
 *
 * It only ever holds the current auction. `/api/history` keeps an archived
 * auction's dates and totals and NOT its items, so once Utaku launches the
 * next auction the last one's bids are gone from the API. The export pasted
 * into `utakuStaging` is therefore a named fallback that will be needed, not a
 * courtesy. Both become the same four-column grid, so from `utakuReadGrid` on
 * there is one path.
 *
 * ## What the API also says, and this file never reads
 *
 * Each winner carries `maxPrice` — the bidder's private ceiling — and a
 * moniker, and `settings.paymentNotes` holds the seller's payment handles. This
 * repository is public. `utakuApiRead` reads a winner's `allocated` and
 * `paidPrice` and nothing else, and the fixture is stripped to match; the test
 * fails if any of it comes back. Same rule as alesievauctions.com's bid
 * statistics.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It lives in the repo and is copied into the
 * workbook's Apps Script editor, not edited there. `npm run test:utaku`
 * replays auction #1 through the pure functions below, from both sources.
 *
 * Everything above `--- Apps Script entry points ---` is pure. Every global is
 * prefixed `UTAKU_` / `utaku`, because all the .gs files in this project share
 * ONE global scope. It needs three of them installed: `trentClose.gs` for the
 * parser and the picker, `auctionOpen.gs` for `openEasternFromInstant`,
 * `openIsoFromCell` and the site itself (`openUtakuApiGet`, `openIsUtakuLink`,
 * `openUtakuStyle` — the scan reads the same site), and `alesievClose.gs` for the wrong-auction fingerprint
 * and the close-date write — shared rather than copied, so the two site paths
 * cannot drift apart.
 */

// ===========================================================================
// Configuration
// ===========================================================================

/** Bump with any change to this file; shown in every dialog. */
var UTAKU_VERSION = '2026-09-29.2';

/** The tab the operator pastes the site's export into. */
var UTAKU_STAGING_TAB = 'utakuStaging';

// The site's host, its API and its sticker vocabulary are `auctionOpen.gs`'s
// (OPEN_UTAKU_*), which scans the same site for new auctions: one definition
// of "a Utaku row" and of what a sticker means, used by both files. Referenced
// only inside functions, never at the top level, because Apps Script does not
// promise which file's globals are set first.

/** The four columns, by header. The export's own are `Item`, `Quantity`, `Price/unit`, `Line total`. */
var UTAKU_NAME_HEADERS = ['item'];
var UTAKU_QUANTITY_HEADERS = ['quantity', 'qty'];
var UTAKU_UNIT_HEADERS = ['price/unit', 'price per unit', 'unit price'];
var UTAKU_TOTAL_HEADERS = ['line total', 'total'];

/**
 * How many tokens a virtual lot holds, by the `tokenMetadata` Item a bid
 * resolves to. Anything not here, and not Trade 1, is one token per row.
 *
 * Trade 1 and Treasure Chips are 10 at every venue. The other two have no
 * shared convention — Trent sells gold bars in fours and Drake's Elixir in
 * eights, alesievauctions.com in fives and fours — and the maintainer chose
 * alesievauctions.com's on 2026-09-29: it is the same Option B order this site
 * sells, and #1's 45 bars and 32 Elixirs divide into it evenly.
 *
 * Keyed on the Item rather than the display name because the Item is the SLOT
 * and survives the season: `Preorder Bonus` is Drake's Elixir in 2027 and was
 * Drake's Draught in 2026.
 */
var UTAKU_TRADE_1_LOT = 10;
var UTAKU_LOT_SIZES = {
  'Treasure Chip': 10,
  '1,000 GP Gold Bar': 5,
  'Preorder Bonus': 4,
};

/**
 * UTF-8 read as Windows-1252, which is what Excel does to this export when it
 * is opened by double-click: `Drake’s Elixir` becomes `Drakeâ€™s Elixir`. The
 * file itself is fine — this repairs the copy a round trip through Excel
 * leaves. Only the four punctuation marks the site's names use are repaired;
 * any OTHER mangled character refuses the row rather than being guessed at.
 */
var UTAKU_MOJIBAKE = [
  ['â€™', '’'], ['â€˜', '‘'], ['â€œ', '“'], ['â€\u009d', '”'],
];
var UTAKU_MOJIBAKE_LEFT_RE = /â€|Ã|Â/;

// ===========================================================================
// Pure — names
// ===========================================================================

/**
 * A cell from the export to the name the shared parser reads.
 *
 * `{ name }` or `{ problem }`. Three things, in order:
 *
 *  1. Excel's mojibake repaired (UTAKU_MOJIBAKE), and refused if any remains.
 *  2. Curly apostrophes to the straight one. `foldName` already matches them
 *     either way; this is so `trentName` is WRITTEN straight, since a curly
 *     apostrophe in a name is an error at the PR gate (§ 8). A fold that turns
 *     a name into something nothing recognises is harmless here, because the
 *     name still has to resolve before anything is written — which is the
 *     guard CLAUDE.md asks for before folding apostrophes at all.
 *  3. A leading season — `2027 Treasure Chips`, `2027 Patron Code` — removed,
 *     but ONLY when it is the target auction's own season. A different year is
 *     a different token and is left on, where it fails to resolve and stops the
 *     run.
 */
function utakuCleanName(raw, season) {
  var s = String(raw == null ? '' : raw).trim();
  for (var i = 0; i < UTAKU_MOJIBAKE.length; i++) s = s.split(UTAKU_MOJIBAKE[i][0]).join(UTAKU_MOJIBAKE[i][1]);
  if (UTAKU_MOJIBAKE_LEFT_RE.test(s)) {
    return {
      problem: '"' + String(raw).trim() + '" still has garbled characters after repairing apostrophes and ' +
        'quotes — the export was probably opened and re-saved in Excel. Paste from the original file ' +
        '(File > Import in Sheets reads it correctly).',
    };
  }
  s = s.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ');
  var lead = s.match(/^((?:19|20)\d{2})\s+(.+)$/);
  if (lead && season && lead[1] === String(season)) s = lead[2];
  return { name: s };
}

/**
 * Whether an export name is an Onyx lot, and its `onyx` Item. Null when not.
 *
 * ANCHORED: a trailing `(Onyx)`, or a whole name `ONYX_NORMALIZATION` knows
 * (`Full Onyx C/U/R Set`). `stripOnyxMarker` alone asks whether the word
 * appears ANYWHERE, which reads `Non-Onyx` as Onyx — the measured mistake the
 * other two routing layers are anchored against. A name mentioning Onyx any
 * other way goes down the price path and stops the run as unresolved.
 */
function utakuOnyxItem(name) {
  var s = String(name == null ? '' : name).trim();
  var known = ONYX_NORMALIZATION[foldName(s)];
  if (known) return known;
  if (!/\(\s*onyx\s*\)\s*$/i.test(s)) return null;
  return stripOnyxMarker(s).name;
}

/** Tokens per virtual lot for a resolved `tokenMetadata` row. */
function utakuLotSize(token) {
  if (!token) return 1;
  if (token.Category === 'Trade 1') return UTAKU_TRADE_1_LOT;
  return UTAKU_LOT_SIZES[token.Item] || 1;
}

/**
 * One winning bid to the lots `processAuction` reads: `{ name, bid, row }`,
 * where the name carries the lot size in the leading `Nx ` form the shared
 * quantity rule already reads, and `bid` is the LOT total.
 *
 * A single-token item (lot size 1) is a bare name per token. Anything sold in
 * lots keeps its `Nx` even when the remainder is one — `1x Alchemist's Ink`,
 * the corpus's own spelling — so a remainder is recognisably a short lot.
 *
 * The lot total is `n × unit`, which `processAuction` divides straight back:
 * the site prices in whole cents per token, so nothing is lost to rounding.
 */
function utakuVirtualLots(bid, lotSize) {
  var lots = [], left = bid.quantity;
  var size = lotSize > 1 ? lotSize : 1;
  while (left > 0) {
    var n = Math.min(size, left);
    lots.push({
      name: size > 1 ? n + 'x ' + bid.name : bid.name,
      bid: roundCents(n * bid.unit),
      row: bid.row,
    });
    left -= n;
  }
  return lots;
}

// ===========================================================================
// Pure — reading the grid
// ===========================================================================

function utakuFindColumn(header, aliases) {
  for (var i = 0; i < header.length; i++) if (aliases.indexOf(header[i]) !== -1) return i;
  return -1;
}

function utakuNumber(v) {
  var s = String(v == null ? '' : v).replace(/[$,\s]/g, '');
  if (s === '') return null;
  var n = Number(s);
  return isFinite(n) ? n : NaN;
}

/**
 * The grid — pasted export or API — to winning bids:
 * `{ bids: [{ name, rawName, quantity, unit, row }], problems, cautions }`.
 *
 * **`Line total` is the checksum and it is enforced.** Every row must satisfy
 * `Quantity × Price/unit = Line total` to the cent, or the row is a problem and
 * nothing is written; all 73 of #1's do. A missing total column is a caution,
 * not a refusal — the other three are the data.
 */
function utakuReadGrid(values, season) {
  if (!values || !values.length) return { error: 'the staging tab is empty' };
  var header = values[0].map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
  var cols = {
    name: utakuFindColumn(header, UTAKU_NAME_HEADERS),
    quantity: utakuFindColumn(header, UTAKU_QUANTITY_HEADERS),
    unit: utakuFindColumn(header, UTAKU_UNIT_HEADERS),
    total: utakuFindColumn(header, UTAKU_TOTAL_HEADERS),
  };
  if (cols.name === -1 || cols.quantity === -1 || cols.unit === -1) {
    return {
      error: 'could not find the Item, Quantity and Price/unit columns. Row 1 reads [' + header.join(' | ') +
        ']. Paste the export with its header row.',
    };
  }
  var out = { bids: [], problems: [], cautions: [] };
  if (cols.total === -1) {
    out.cautions.push('there is no Line total column, so no row could be checksummed against Quantity × Price/unit.');
  }
  for (var r = 1; r < values.length; r++) {
    var raw = values[r][cols.name];
    if (!String(raw == null ? '' : raw).trim()) continue;
    var where = 'row ' + (r + 1) + ' "' + String(raw).trim() + '"';
    var clean = utakuCleanName(raw, season);
    if (clean.problem) { out.problems.push(where + ': ' + clean.problem); continue; }

    var q = utakuNumber(values[r][cols.quantity]);
    var unit = utakuNumber(values[r][cols.unit]);
    if (q === 0) { out.cautions.push(where + ' has quantity 0 and was skipped.'); continue; }
    if (q === null || isNaN(q) || q < 0 || Math.floor(q) !== q) {
      out.problems.push(where + ': quantity "' + values[r][cols.quantity] + '" is not a whole number of tokens.');
      continue;
    }
    if (unit === null || isNaN(unit) || unit <= 0) {
      out.problems.push(where + ': price per unit "' + values[r][cols.unit] + '" is not a price.');
      continue;
    }
    unit = roundCents(unit);
    if (cols.total !== -1) {
      var total = utakuNumber(values[r][cols.total]);
      if (total === null || isNaN(total) || roundCents(total) !== roundCents(q * unit)) {
        out.problems.push(where + ': ' + q + ' × $' + unit + ' is $' + roundCents(q * unit) + ', but its Line total reads "' +
          values[r][cols.total] + '". A row that does not add up is not written.');
        continue;
      }
    }
    // The site's Quantity is a count of tokens. A name that states a lot size
    // of its own (`10x Treasure Chips`) would be multiplied twice.
    if (parseQuantity(clean.name).quantity > 1) {
      out.problems.push(where + ': the name states a quantity of its own, and this export\'s Quantity column ' +
        'already counts tokens. Multiplying the two would be a guess.');
      continue;
    }
    out.bids.push({ name: clean.name, rawName: String(raw).trim(), quantity: q, unit: unit, row: r + 1 });
  }
  return out;
}

// ===========================================================================
// Pure — reading the API
// ===========================================================================

/** The grid an API answer becomes: the export's own four columns. */
var UTAKU_GRID_HEADER = ['Item', 'Quantity', 'Price/unit', 'Line total'];

/**
 * `GET /api/state` (and, only to explain a refusal, `GET /api/history`) to the
 * grid a pasted export gives, for ONE metadata row.
 *
 * Returns `{ grid, siteNumber, title, closeDate, closeTime, raised, lotSum,
 * stickers, cautions }` or `{ error }`.
 *
 * **Which auction the answer is.** The API names only the current auction and
 * the site gives no auction a URL of its own, so nothing in the Link can say
 * which one a row is. The start date can: an auction's `startedAt` in Eastern —
 * the site shows every time in Eastern — must be the row's `openDate`, or this
 * refuses. Without that, picking last week's row after the next auction closed
 * would import the new auction's bids under the old id, complete and
 * well-formed and wrong, which is the defect this data set produces most. When
 * the row's date matches an ARCHIVED auction instead, the refusal names it and
 * sends the operator to the export.
 *
 * **Read per winner: `allocated` and `paidPrice`, nothing else.** See the file
 * header on `maxPrice`. `allocated` rather than the bid's `qty`, because `qty`
 * is what the bidder asked for and `allocated` is what they got.
 */
function utakuApiRead(state, history, target) {
  if (!state || typeof state !== 'object' || !state.settings || !Array.isArray(state.items)) {
    return { error: 'the site did not return its auction state' };
  }
  var s = state.settings;
  var number = s.auctionNumber == null ? '?' : String(s.auctionNumber);
  var started = openEasternFromInstant(s.startedAt);
  var openDate = openIsoFromCell(target.openDate);
  if (!started) return { error: 'the site\'s current auction #' + number + ' has no start time ("' + s.startedAt + '")' };
  if (!openDate || openDate !== started.date) {
    var archived = '';
    for (var h = 0; h < (history || []).length; h++) {
      var then = openEasternFromInstant(history[h] && history[h].startedAt);
      if (then && openDate && then.date === openDate) { archived = String(history[h].auctionNumber); break; }
    }
    return {
      notCurrent: true,
      error: 'auction ' + target.auctionId + ' opened ' + (openDate || '(no openDate)') + ', but the site\'s current ' +
        'auction #' + number + ' started ' + started.date + ' (Eastern), so the API is not holding this auction\'s ' +
        'bids. ' + (archived
          ? 'The site has archived it as auction #' + archived + ', and an archived auction keeps its totals but ' +
            'not its items. '
          : '') + 'Use the pasted-export fallback.',
    };
  }

  var live = [];
  for (var i = 0; i < state.items.length; i++) if (state.items[i] && state.items[i].status === 'live') live.push(state.items[i].name);
  if (live.length) {
    return {
      error: 'site auction #' + number + ' is still OPEN — ' + live.length + ' item(s) are live (' +
        live.slice(0, 5).join(', ') + (live.length > 5 ? ', …' : '') + '). Import it once it has closed.',
    };
  }

  var grid = [UTAKU_GRID_HEADER.slice()], lotSum = 0, unsold = [], cautions = [];
  for (var k = 0; k < state.items.length; k++) {
    var item = state.items[k] || {};
    var name = String(item.name == null ? '' : item.name).trim();
    if (!name) return { error: 'item ' + (k + 1) + ' has no name' };
    var winners = Array.isArray(item.winners) ? item.winners : [];
    var taken = 0;
    for (var w = 0; w < winners.length; w++) {
      var n = winners[w] ? winners[w].allocated : null, p = winners[w] ? winners[w].paidPrice : null;
      if (typeof n !== 'number' || n <= 0) continue;
      if (typeof p !== 'number' || !isFinite(p)) {
        return { error: '"' + name + '" has a winner with a paid price that is not a number: ' + JSON.stringify(p) };
      }
      taken += n;
      lotSum = roundCents(lotSum + n * p);
      grid.push([name, String(n), String(p), String(roundCents(n * p))]);
    }
    if (typeof item.quantity === 'number' && item.quantity > taken) unsold.push(name + ' ×' + (item.quantity - taken));
  }
  if (grid.length === 1) return { error: 'site auction #' + number + ' has no winning bids' };

  var raised = typeof s.raised === 'number' ? roundCents(s.raised) : null;
  if (raised !== null && raised !== lotSum) {
    cautions.push('the winning bids sum to $' + lotSum + ' but the site reports $' + raised + ' raised. ' +
      'The bids and the total disagree — check the auction on the site before writing.');
  }
  if (unsold.length) cautions.push(unsold.length + ' item(s) did not sell out and the rest is written nowhere: ' + unsold.join(', ') + '.');

  // `lastClosed` names the auction that closed and whether it is the one on
  // the page. Only then is its `closedAt` this auction's close.
  var lc = state.lastClosed || null;
  var closed = lc && lc.current === true && String(lc.auctionNumber) === number ? openEasternFromInstant(lc.closedAt) : null;
  if (!closed) cautions.push('the site does not say when auction #' + number + ' closed, so the close date will be asked for.');

  return {
    grid: grid, siteNumber: number, title: String(s.title == null ? '' : s.title),
    closeDate: closed ? closed.date : null, closeTime: closed ? closed.time : '',
    raised: raised, lotSum: lotSum, stickers: s.stickers || {}, cautions: cautions,
  };
}

// ===========================================================================
// Pure — the stickers
// ===========================================================================

/**
 * The page's four stickers to an `auctionStyle`, or blank with the reason.
 * The rule is `auctionOpen.gs`'s `openUtakuStyle` — the scan proposes a style
 * with it, and this file checks a recorded style against the same answer.
 */
function utakuStyleFromStickers(stickers) {
  return openUtakuStyle(stickers);
}

/**
 * The caution when a recorded `auctionStyle` disagrees with the evidence, or ''.
 *
 * Never a correction: the maintainer settled on 2026-09-29 that the close
 * WARNS and the sheet is fixed by hand. Two kinds of evidence, the second of
 * which both sources have:
 *
 *  - the stickers (API only) name the whole style;
 *  - the lots themselves say whether it was an Onyx order, which is the half
 *    `validate-prices.mjs` § 6 would otherwise fail the publish on.
 */
function utakuStyleCaution(recorded, stickers, onyxRowCount) {
  var have = String(recorded == null ? '' : recorded).trim();
  var saysOnyx = ALESIEV_ONYX_STYLE_RE.test(have);
  var onyxGap = onyxRowCount && !saysOnyx
    ? ' This close sells ' + onyxRowCount + ' Onyx token(s), so validate-prices § 6 will fail the publish until it is fixed.'
    : '';
  if (stickers) {
    var want = utakuStyleFromStickers(stickers);
    if (want.style && want.style !== have) {
      return ['auctionStyle reads "' + (have || '(blank)') + '", but the site\'s stickers say "' + want.style +
        '". Nothing here changes it — correct the cell in ' + TABS.metadata + ' before publishing.' + onyxGap];
    }
    if (!want.style && want.notes.length) {
      return ['the stickers could not be read as a style (' + want.notes.join('; ') + '), so auctionStyle "' +
        (have || '(blank)') + '" was not checked against them.' + onyxGap];
    }
  }
  if (onyxGap) return ['auctionStyle "' + (have || '(blank)') + '" is not an Onyx style.' + onyxGap + ' Fix the cell first.'];
  if (!onyxRowCount && saysOnyx) return ['auctionStyle "' + have + '" is an Onyx style, but this close sells no Onyx tokens.'];
  return [];
}

// ===========================================================================
// Pure — the plan
// ===========================================================================

/**
 * Everything the operator needs to decide whether to write. `ok` is false
 * whenever anything aborted; nothing is written then, and never part of an
 * auction.
 *
 * Arguments follow `alesievPlanImport`'s, plus `stickers` (null on the export
 * path, which has none).
 */
function utakuPlanImport(values, targetSeason, tokenMetadataRows, alreadyPriced, auctionStyle,
  recordedPrices, targetAuctionId, stickers) {
  var read = utakuReadGrid(values, targetSeason);
  if (read.error) return { ok: false, rowsComplete: false, aborts: [read.error], cautions: [], lots: 0, raw: [], prices: [], onyx: [], context: [] };
  if (!read.bids.length && !read.problems.length) {
    return { ok: false, rowsComplete: false, aborts: ['the grid has a header but no bids'], cautions: [], lots: 0, raw: [], prices: [], onyx: [], context: [] };
  }

  var index = buildTokenIndex(tokenMetadataRows);
  var aborts = read.problems.slice();
  var cautions = read.cautions.slice();
  var lots = [], onyx = [], expansion = [], split = {}, splitOrder = [], exportTotal = 0, i;

  for (i = 0; i < read.bids.length; i++) {
    var bid = read.bids[i];
    exportTotal = roundCents(exportTotal + bid.quantity * bid.unit);
    var onyxItem = utakuOnyxItem(bid.name);
    if (onyxItem) {
      // Every recorded Onyx row is ONE token, and an Onyx order holds each
      // token once. Two of one is a shape nobody has seen.
      if (bid.quantity !== 1) {
        aborts.push('row ' + bid.row + ' "' + bid.rawName + '": ' + bid.quantity + ' of one Onyx token. Every recorded ' +
          'Onyx row is a single token and an Onyx order holds each once — check the auction before writing.');
        continue;
      }
      onyx.push({ Item: onyxItem, Price: bid.unit, 'Display Name': onyxItem, Category: ONYX_CATEGORY });
      continue;
    }
    var token = resolveToken(stripDecorations(bid.name), targetSeason, index);
    // An unresolved name goes through as ONE lot of the whole bid, so
    // processAuction reports it — and hands it to the context worksheet — with
    // its real quantity and total.
    var size = utakuLotSize(token);
    var made = token
      ? utakuVirtualLots(bid, size)
      : [{ name: bid.quantity > 1 ? bid.quantity + 'x ' + bid.name : bid.name, bid: roundCents(bid.quantity * bid.unit), row: bid.row }];
    for (var m = 0; m < made.length; m++) lots.push(made[m]);
    if (token) {
      if (!split[bid.name]) { split[bid.name] = { size: size, bids: [], lots: 0 }; splitOrder.push(bid.name); }
      split[bid.name].bids.push(made.map(function (l) { return parseQuantity(l.name).quantity; }).join('+'));
      split[bid.name].lots += made.length;
    }
  }
  // For the dialog: one line per item sold in lots, one line for the rest.
  var singles = [];
  for (i = 0; i < splitOrder.length; i++) {
    var g = split[splitOrder[i]];
    if (g.size > 1) expansion.push(splitOrder[i] + ': ' + g.bids.join(' / ') + ' → ' + g.lots + ' lot(s)');
    else if (g.lots > 1) singles.push(splitOrder[i] + ' ' + g.lots);
  }
  if (singles.length) expansion.push('one row per token: ' + singles.join(', '));

  var names = [];
  for (i = 0; i < lots.length; i++) names.push(lots[i].name);
  var seasons = inferSeasons(names, index);
  if (!seasons.length || seasons.length > 1) {
    cautions.push('nothing in this file is unique to one season, so it could not be checked against season ' +
      targetSeason + ' — confirm you picked the right auction');
  } else if (seasons[0] !== String(targetSeason)) {
    aborts.push('this file looks like season ' + seasons[0] + ', but the chosen auction is season ' +
      targetSeason + ' — check you picked the right auction');
  }

  var result = processAuction(lots, targetSeason, index);
  for (i = 0; i < result.aborts.length; i++) aborts.push(result.aborts[i]);

  // EVERY DOLLAR ONCE. The virtual lots and the Onyx rows must add back up to
  // the bids exactly — a lot dropped or doubled in the expansion is invisible
  // in every row it did not touch.
  if (!result.aborts.length) {
    var written = 0;
    for (i = 0; i < result.raw.length; i++) written = roundCents(written + result.raw[i].trentPrice);
    for (i = 0; i < onyx.length; i++) written = roundCents(written + onyx[i].Price);
    if (written !== exportTotal) {
      aborts.push('the rows to be written total $' + written + ' but the bids total $' + exportTotal + '. The lot ' +
        'expansion lost or doubled something — this is a bug in the script, not the data.');
    }
  }

  if (recordedPrices && targetAuctionId) {
    var wrong = alesievWrongAuctionAbort(result.prices, targetAuctionId, recordedPrices);
    if (wrong) aborts.push(wrong.replace('this export is', 'these bids are'));
  } else {
    cautions.push('the wrong-auction check did not run: no recorded ' + TABS.prices + ' rows were supplied.');
  }

  var style = utakuStyleCaution(auctionStyle, stickers || null, onyx.length);
  for (i = 0; i < style.length; i++) cautions.push(style[i]);

  var writeRefusals = [];
  if (alreadyPriced) {
    writeRefusals.push('this auction already has rows in ' + TABS.prices + '. Importing again would double every ' +
      'price. If you meant to replace them, delete the existing rows first — or take the rows you are ' +
      'missing from the dry run and paste those.');
  }

  return {
    ok: aborts.length === 0 && writeRefusals.length === 0,
    aborts: aborts.concat(writeRefusals),
    rowsComplete: aborts.length === 0,
    cautions: cautions,
    seasons: seasons,
    lots: read.bids.length,
    exportTotal: exportTotal,
    expansion: expansion,
    raw: result.raw,
    prices: result.prices,
    onyx: onyx,
    // No context rows: the export cannot express a withheld item or an augment,
    // and a name that resolves nowhere stops the run instead. Kept as a field so
    // alesievShowContext can show a dry run unchanged.
    context: [],
    unresolved: result.unresolved,
  };
}

/** A short human summary of a plan, for the confirmation dialog. */
function utakuDescribePlan(plan, auctionId, closeDate, closeNote) {
  var lines = [], i;
  if (!plan.ok) {
    lines.push('NOTHING WILL BE WRITTEN — ' + plan.aborts.length + ' problem(s):');
    for (i = 0; i < plan.aborts.length; i++) lines.push('  • ' + plan.aborts[i]);
    lines.push('');
    lines.push(plan.rowsComplete
      ? 'The rows themselves are complete — what it would have written:'
      : 'What it got as far as building. INCOMPLETE — at least one bid produced no row, so this is not a set to paste:');
  }
  lines.push('Auction ' + auctionId + ' — ' + plan.lots + ' winning bids, $' + plan.exportTotal +
    (plan.source ? ', from ' + plan.source : '') + ':');
  lines.push('  ' + plan.raw.length + ' lots  ->  ' + TABS.raw);
  lines.push('  ' + plan.prices.length + ' min/max rows  ->  ' + TABS.prices);
  if (plan.onyx.length) lines.push('  ' + plan.onyx.length + ' Onyx rows  ->  ' + TABS.onyx);
  if (closeDate) lines.push('  closeDate ' + closeDate + (closeNote ? ' (' + closeNote + ')' : '') + '  ->  ' + TABS.metadata);
  if (plan.expansion && plan.expansion.length) {
    lines.push('');
    lines.push('Bids split into lots of the size other venues sell (each bid\'s lots, then the total):');
    for (i = 0; i < plan.expansion.length; i++) lines.push('  ' + plan.expansion[i]);
  }
  if (plan.cautions.length) {
    lines.push('');
    lines.push('CAUTION:');
    for (i = 0; i < plan.cautions.length; i++) lines.push('  • ' + plan.cautions[i]);
  }
  return lines.join('\n');
}

/**
 * Whether an auctionMetadata row came from this site. By the Link, like every
 * close path, and by the scan's own test (`openIsUtakuLink`), so "a Utaku row"
 * has one definition. The Link answers "which venue" and never "which
 * auction" — every Utaku row carries the same one; `utakuApiRead` identifies
 * the auction by its start date.
 */
function utakuIsSiteRow(m) {
  return openIsUtakuLink(m.Link);
}

function utakuPickerList(metaRows, limit) {
  return closePickerList(metaRows, utakuIsSiteRow, limit);
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook. Nothing above it does.
// ===========================================================================

/** `trentClose.gs`'s single onOpen calls this; there is no onOpen here. */
function addUtakuMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Import Utaku close…', 'importUtakuClose')
    .addItem('Dry run — show what Utaku\'s site would import', 'dryRunUtakuClose')
    .addItem('Import Utaku close from a pasted export (fallback)…', 'importUtakuCloseFromExport')
    .addItem('Dry run — Utaku pasted export (fallback)', 'dryRunUtakuCloseFromExport');
}

function utakuCheckTabs(fromExport) {
  var problems = checkTabs();
  if (fromExport && !SpreadsheetApp.getActive().getSheetByName(UTAKU_STAGING_TAB)) {
    problems.push('no tab named "' + UTAKU_STAGING_TAB + '" — create it and paste the export into it');
  }
  return problems;
}

/** The picker: this site's rows, newest first. A shortlist, never a gate. */
function utakuTargetAuction(ui, title) {
  var meta = readTab(TABS.metadata);
  var choice = ui.prompt(title, 'Target auctionId?' +
    closePickerPrompt(utakuPickerList(meta), 'auction.utakustradecaravan.com', TABS.metadata), ui.ButtonSet.OK_CANCEL);
  if (choice.getSelectedButton() !== ui.Button.OK) return null;
  var auctionId = choice.getResponseText().trim();
  for (var j = 0; j < meta.length; j++) {
    if (meta[j].auctionId !== auctionId) continue;
    var problem = closeOutcomeProblem(meta[j].outcome);
    if (problem) { ui.alert('Cannot import', 'Auction ' + auctionId + ': ' + problem, ui.ButtonSet.OK); return null; }
    return meta[j];
  }
  ui.alert('No auction "' + auctionId + '" in ' + TABS.metadata + '. Record it there first.');
  return null;
}

/** The bids for one auction, from the API (via `auctionOpen.gs`'s openUtakuApiGet) or the staging tab. */
function utakuReadLots(target, fromExport) {
  if (fromExport) {
    var staging = SpreadsheetApp.getActive().getSheetByName(UTAKU_STAGING_TAB);
    return { values: staging.getDataRange().getDisplayValues(), source: 'the pasted export in ' + UTAKU_STAGING_TAB, cautions: [], stickers: null };
  }
  var state = openUtakuApiGet('/state');
  if (state.error) return { error: state.error + '. The pasted-export fallback still works.' };
  var read = utakuApiRead(state.json, [], target);
  if (read.notCurrent) {
    // Only now is the history worth a request: to say where the auction went.
    var history = openUtakuApiGet('/history');
    if (!history.error && Array.isArray(history.json)) read = utakuApiRead(state.json, history.json, target);
  }
  if (read.error) return { error: read.error };
  return {
    values: read.grid, source: "the site's API — auction #" + read.siteNumber + ' "' + read.title + '"',
    cautions: read.cautions, stickers: read.stickers, closeDate: read.closeDate, closeTime: read.closeTime,
  };
}

function utakuBuildPlan(target, fromExport) {
  var lots = utakuReadLots(target, fromExport);
  if (lots.error) return { error: lots.error };
  var recordedPrices = readTab(TABS.prices);
  var alreadyPriced = false;
  for (var i = 0; i < recordedPrices.length; i++) {
    if (String(recordedPrices[i].auctionId).trim() === String(target.auctionId)) { alreadyPriced = true; break; }
  }
  var plan = utakuPlanImport(lots.values, target.auctionSeason, readTab(TABS.tokens), alreadyPriced,
    target.auctionStyle, recordedPrices, target.auctionId, lots.stickers);
  plan.source = lots.source;
  plan.cautions = lots.cautions.concat(plan.cautions);
  return { plan: plan, closeDate: lots.closeDate || null, closeTime: lots.closeTime || '' };
}

function dryRunUtakuClose() { utakuDryRun(false); }
function dryRunUtakuCloseFromExport() { utakuDryRun(true); }
function importUtakuClose() { utakuImport(false); }
function importUtakuCloseFromExport() { utakuImport(true); }

function utakuDryRun(fromExport) {
  var ui = SpreadsheetApp.getUi();
  var missing = utakuCheckTabs(fromExport);
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }
  var target = utakuTargetAuction(ui, fromExport ? 'Dry run — Utaku pasted export' : 'Dry run — Utaku');
  if (!target) return;
  var built = utakuBuildPlan(target, fromExport);
  if (built.error) { ui.alert('Cannot run (script ' + UTAKU_VERSION + ')', built.error, ui.ButtonSet.OK); return; }
  ui.alert('Dry run — nothing written (script ' + UTAKU_VERSION + ')',
    utakuDescribePlan(built.plan, target.auctionId, built.closeDate,
      built.closeDate ? "the site's close, " + built.closeTime + ' Eastern' : ''), ui.ButtonSet.OK);
  alesievShowContext(built.plan, target, true);
}

function utakuImport(fromExport) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var missing = utakuCheckTabs(fromExport);
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }
  var target = utakuTargetAuction(ui, fromExport ? 'Import Utaku close — pasted export' : 'Import Utaku close');
  if (!target) return;

  var built = utakuBuildPlan(target, fromExport);
  if (built.error) { ui.alert('Cannot import (script ' + UTAKU_VERSION + ')', built.error, ui.ButtonSet.OK); return; }
  var plan = built.plan;
  if (!plan.ok) {
    ui.alert('Import aborted — nothing written (script ' + UTAKU_VERSION + ')',
      utakuDescribePlan(plan, target.auctionId, null), ui.ButtonSet.OK);
    alesievShowContext(plan, target);
    return;
  }

  // The close date: the site's when it states one, never overwriting a
  // different recorded date without asking; otherwise typed, ISO only. The
  // same choices alesievImport offers, for the same reasons.
  var closeDate = null;
  var held = String(target.closeDate || '').trim();
  var siteClose = built.closeDate && !alesievCloseDateProblem(built.closeDate) ? built.closeDate : null;
  if (siteClose) {
    closeDate = siteClose;
    if (held && held !== siteClose) {
      var which = ui.alert('Close date',
        'Auction ' + target.auctionId + ' already records closeDate ' + held + ', but the site says it closed ' +
          siteClose + ' (' + built.closeTime + ' Eastern).\n\nYES: replace it with ' + siteClose +
          '.\nNO: keep ' + held + '.\nCANCEL: import nothing.', ui.ButtonSet.YES_NO_CANCEL);
      if (which === ui.Button.CANCEL || which === ui.Button.CLOSE) return;
      if (which === ui.Button.NO) closeDate = null;
    }
  } else {
    var dateChoice = ui.prompt('Close date',
      'Close date for auction ' + target.auctionId + ', as YYYY-MM-DD.\n\n' +
        (held ? 'This auction already records ' + held + '. Leave blank to keep it.'
              : 'Leave blank to skip — Status stays "Open" until closeDate is filled in.'),
      ui.ButtonSet.OK_CANCEL);
    if (dateChoice.getSelectedButton() !== ui.Button.OK) return;
    var typed = dateChoice.getResponseText().trim();
    if (typed) {
      var problem = alesievCloseDateProblem(typed);
      if (problem) { ui.alert('Cannot import', problem, ui.ButtonSet.OK); return; }
      if (held && held !== typed) {
        var overwrite = ui.alert('Overwrite the close date?',
          'Auction ' + target.auctionId + ' already records closeDate ' + held + '. Replace it with ' + typed + '?',
          ui.ButtonSet.OK_CANCEL);
        if (overwrite !== ui.Button.OK) return;
      }
      closeDate = typed;
    }
  }

  var destinations = [
    TABS.raw + ' from row ' + (ss.getSheetByName(TABS.raw).getLastRow() + 1),
    TABS.prices + ' from row ' + (ss.getSheetByName(TABS.prices).getLastRow() + 1),
  ];
  if (plan.onyx.length) destinations.push(TABS.onyx + ' from row ' + (ss.getSheetByName(TABS.onyx).getLastRow() + 1));
  if (closeDate) destinations.push(TABS.metadata + ' closeDate for ' + target.auctionId);

  var summary = utakuDescribePlan(plan, target.auctionId, closeDate,
    siteClose && closeDate === siteClose ? "the site's close, " + built.closeTime + ' Eastern' : '');
  var go = ui.alert('Import Utaku close (script ' + UTAKU_VERSION + ')',
    summary + '\n\nWriting to:\n  ' + destinations.join('\n  ') + '\n\nWrite these rows?', ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) return;

  var keyed = function (cells) { return [target.auctionId, target.auctionSeason, target.auctionNumber].concat(cells); };
  appendRows(TABS.raw, plan.raw.map(function (r) { return keyed([r.trentName, r.trentPrice, r.Item, r.Price, r.Category]); }));
  appendRows(TABS.prices, plan.prices.map(function (r) { return keyed([r.Item, r.Price, r['Display Name'], r.Category]); }));
  if (plan.onyx.length) {
    appendRows(TABS.onyx, plan.onyx.map(function (r) { return keyed([r.Item, r.Price, r['Display Name'], r.Category]); }));
  }
  var dateNote = closeDate ? '\n\n' + alesievWriteCloseDate(target.auctionId, closeDate) : '';
  SpreadsheetApp.flush();
  ui.alert('Imported (script ' + UTAKU_VERSION + ')', summary + dateNote + '\n\nWritten. Publish when you are ready.', ui.ButtonSet.OK);
}

// Lets Node load the pure functions for testing; Apps Script has no `module`.
if (typeof module !== 'undefined') {
  module.exports = {
    utakuCleanName: utakuCleanName,
    utakuOnyxItem: utakuOnyxItem,
    utakuLotSize: utakuLotSize,
    utakuVirtualLots: utakuVirtualLots,
    utakuReadGrid: utakuReadGrid,
    utakuApiRead: utakuApiRead,
    utakuStyleFromStickers: utakuStyleFromStickers,
    utakuStyleCaution: utakuStyleCaution,
    utakuPlanImport: utakuPlanImport,
    utakuDescribePlan: utakuDescribePlan,
    utakuIsSiteRow: utakuIsSiteRow,
    utakuPickerList: utakuPickerList,
    UTAKU_LOT_SIZES: UTAKU_LOT_SIZES,
    UTAKU_GRID_HEADER: UTAKU_GRID_HEADER,
    UTAKU_VERSION: UTAKU_VERSION,
  };
}
