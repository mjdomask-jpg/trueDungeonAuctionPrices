/**
 * Phase 5 (part three) — close automation for alesievauctions.com.
 *
 * Phase 4 already watches that site and proposes its auctions into
 * `auctionMetadata` from server-rendered cards. This is the other half: the
 * export the site produces when an auction closes, read straight into
 * `rawPricesData`, `prices`, `onyx`, `contextItems` and the auction's
 * `closeDate`.
 *
 * **It is treated like Trent's close, not like a forum close, and the reason is
 * the source rather than the shape.** A forum auctioneer writes a spreadsheet
 * by hand and three files from ONE auctioneer had three different layouts, so
 * `forumClose.gs` has to sniff its columns and hedge its output. This file
 * comes out of a database with one row per lot, always the same columns, and a
 * `Category` column that states where a row belongs instead of leaving it to be
 * inferred from a name. That is Trent's situation, and it earns Trent's
 * treatment: min/max straight into `prices`, per-lot rows into
 * `rawPricesData`, no intermediate proposal step.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It lives in the repo and is copied into the
 * workbook's Apps Script editor, not edited there. `npm run test:alesiev`
 * replays the sample export through the pure functions below.
 *
 * Everything above `--- Apps Script entry points ---` is pure: no
 * SpreadsheetApp, no I/O. Every global is prefixed `ALESIEV_` / `alesiev`,
 * because all the .gs files in this project share ONE global scope — which is
 * also why this file can call `trentClose.gs`'s parser directly, and why it
 * needs that file installed to work at all. `auctionOpen.gs` is the second
 * dependency: `openIsoFromCell` reads the close date back, and `openAlesievId`
 * decides whether a metadata row came from this site — the same anchored parse
 * the scan keys duplicates on, rather than a second one that would drift.
 *
 * WHAT IS SHARED AND WHAT IS NEW. The quantity rule, the name resolution, the
 * per-token division, the min/max, the bid-floor exclusion and the season check
 * are all `trentClose.gs`'s, verified against 18,466 lots. New here: three
 * column-A grammar rules, and a routing layer driven by column B.
 */

// ===========================================================================
// Configuration
// ===========================================================================

/** Bump with any change to this file; shown in every dialog. */
var ALESIEV_VERSION = '2026-09-20.1';

/** The tab the operator pastes the site's export into. */
var ALESIEV_STAGING_TAB = 'alesievStaging';

/**
 * The three columns this file reads, by header.
 *
 * The export's real header row is
 *
 *   Item | Category | Starting Bid | Current Bid | Bid Count | High Bid |
 *   Average Bid | Median Bid | Low Bid
 *
 * and only `Item`, `Category` and `Current Bid` are read. `Current Bid` is the
 * ENDING bid — the price the lot actually closed at. The aliases are short
 * because this source has one shape; they exist so a renamed column fails with
 * a readable message rather than a wrong one.
 */
var ALESIEV_NAME_HEADERS = ['item', 'lot', 'product name'];
var ALESIEV_CATEGORY_HEADERS = ['category'];
var ALESIEV_PRICE_HEADERS = ['current bid', 'winning bid', 'final bid'];

/**
 * Columns that are deliberately ignored, listed so the intent is legible in the
 * dialog rather than only in this comment.
 *
 * **`Average Bid` is why this file exists as its own reader.** `forumClose.gs`
 * REFUSES any file carrying that header, and it is right to: the one forum file
 * that had it was a pivot over every bid received, and it reconciled with
 * nothing. Here the same header sits beside a genuine `Current Bid`, and it is
 * a per-lot bid statistic rather than the price. Same word, different file,
 * opposite meaning — so do not "unify" the two readers, and do not route this
 * export through `forumReadStaging`.
 *
 * `Starting Bid` is ignored too. It is tempting as a per-row bid floor, since
 * `isBidFloorArtifact` currently uses one corpus-wide constant. Left alone
 * deliberately: the maintainer confirmed on 2026-09-01 that $0.25 is the
 * minimum bid across ALL sources, and the sample export's $0.50 opening bids
 * are dummy values in a test extract, not evidence of a different floor.
 */
var ALESIEV_IGNORED_HEADERS = [
  'starting bid', 'bid count', 'high bid', 'average bid', 'median bid', 'low bid',
];

/**
 * Column B routing. **Anchored, every one of them.**
 *
 * A loose `/onyx/` reads `Non-Onyx` as Onyx — the measured mistake that keeps
 * `auctionOpen.gs` from guessing a style off a title at all — and the same trap
 * is here: a category could one day read `Non-Onyx` or `Onyx Excluded`. Match
 * the start of the value or do not match.
 *
 * Anything matching NONE of these is a price: `Trade`, `Premium`, `Bonus`,
 * `Ultra Rare` and a blank cell all mean "an ordinary lot of the auction's own
 * tokens". That default is safe because an unresolvable name still aborts.
 */
var ALESIEV_AUGMENT_RE = /^augment\s*[-–—:]\s*(.+)$/i;
var ALESIEV_WITHHELD_RE = /^withheld\b/i;
var ALESIEV_ONYX_RE = /^onyx\b/i;

/**
 * Whether an `auctionStyle` names an Onyx order.
 *
 * Anchored to the start, which is not fussiness: every recorded Onyx style
 * begins with the word (`Onyx Ultra Condensed`, `Onyx Super Condensed`,
 * `Safehold Onyx Super Condensed` being the one exception, handled by the
 * word-boundary alternative). A loose `/onyx/` reads `Non-Onyx` as Onyx, which
 * is the measured mistake that keeps `auctionOpen.gs` from guessing at all.
 *
 * Getting this wrong in the permissive direction switches off the
 * `tokenMetadata` check on every withheld name in a NON-Onyx auction, so the
 * default when it does not match is the stricter path.
 */
var ALESIEV_ONYX_STYLE_RE = /(^|\s)onyx\b/i;

/**
 * Which `contextItems.category` an `Augment - <kind>` becomes.
 *
 * `Augment - Player` is a token out of the auctioneer's own collection and is
 * recorded as `token`; `Augment - Grunnel` is recorded as `grunnel`. That is
 * the same pair `forumClose.gs` already maps for `Player Augment` /
 * `Grunnel Augment`, so the two sources agree on the vocabulary.
 *
 * An `Augment - <something else>` is NOT guessed at. `contextItems.category` is
 * a four-value vocabulary that `validate-prices.mjs` § 7 checks at the PR gate,
 * and a new kind is a decision about what the item was doing in the auction —
 * exactly the judgement Phase 2 refuses to make from a name.
 */
var ALESIEV_AUGMENT_CATEGORIES = { player: 'token', grunnel: 'grunnel' };

/**
 * `(N of M)` — lot N of M lots of the same item. Trailing only.
 *
 * **It is a lot NUMBER, not a quantity**, and the distinction is the whole
 * reason it is stripped here rather than left for `parseQuantity`. Read as a
 * count, `Aragonite (15 of 15)` would divide a single-token lot fifteen ways.
 * The absence of the marker means "lot 1 of 1", so nothing needs it to be
 * present.
 *
 * `parseQuantity` does not in fact read it — `(N of M)` matches neither
 * `(N Tokens)` nor a mid-name `xN` — but `stripDecorations` does not remove it
 * either, so every name in the export fails to resolve until it comes off.
 * Measured on the sample: 116 of 163 lots resolve with this rule and the two
 * below, and 0 of 163 without them.
 */
var ALESIEV_LOT_OF_RE = /\s*\(\s*(\d+)\s*of\s*(\d+)\s*\)\s*$/i;

/**
 * `5,000 GP Gold Bar` is five `1,000 GP Gold Bar` tokens, not a denomination.
 *
 * `1,000 GP Gold Bar` is the only gold bar `tokenMetadata` has ever held, in
 * every season, and `prices.csv` has no other. So the leading number is a
 * quantity written into the name, and the lot divides by it.
 *
 * The multiple-of-1000 test is the guard. A name this does not match is left
 * exactly as it is and falls through to the ordinary unresolved path, where it
 * aborts — `1,500 GP Gold Bar` would be a real change to how this source names
 * things and it should stop the run, not be silently rounded into 1.5 tokens.
 */
var ALESIEV_GOLD_BAR_RE = /^([\d,]+)\s+GP\s+Gold\s+Bars?$/i;

/**
 * Names that are CONTEXT ITEMS whatever column B says.
 *
 * Column B cannot make this split: it labels `Pick Your Purple` and
 * `Random Ultra Rare` **both** `Ultra Rare`, and they belong in different
 * files. A PYP is a buyer choosing any Ultra Rare, which is a market
 * observation and goes in the price spine as `Ultra Rare`. A Random Ultra Rare
 * is a lucky dip, and `contextItems` records all 21 of its recorded
 * appearances as ONE aggregated `token` row — `202647` is quantity 9 at
 * $497.00.
 *
 * `aggregate` sums the lots' OWN prices and never quantity × a representative
 * price. That is not a stylistic choice: `202647`'s nine lots went eight at $55
 * and one at $57, and the row read $495 (9 × $55) until it was corrected to
 * $497.
 *
 * **The Item is the rule's spelling, not the file's.** All 21 recorded rows say
 * `Random Ultra Rare`; a file writing `Random URs` must not fork that series in
 * two. (`forumClose.gs` had this backwards until 2026-09-10 — it wrote
 * `Random UR`, which appears nowhere in `contextItems.csv`.)
 */
var ALESIEV_CONTEXT_RULES = {
  'random ultra rare': { category: 'token', aggregate: true, item: 'Random Ultra Rare' },
  'random ultra rares': { category: 'token', aggregate: true, item: 'Random Ultra Rare' },
  'random ur': { category: 'token', aggregate: true, item: 'Random Ultra Rare' },
  'random urs': { category: 'token', aggregate: true, item: 'Random Ultra Rare' },
};

/**
 * Names that are the auctioneer's FEE when withheld, and are written NOWHERE.
 *
 * The auctioneer takes a fee for running the auction — some Random Ultra Rares
 * and a Golden Ticket — and it is paid out of the order rather than sold. The
 * maintainer settled during the 2026 backfill that **the fee is never a
 * withheld row**: withheld means the auctioneer kept back a token that the
 * order bought and the buyers did not get to bid on, which is a fact about how
 * much of the order reached the group. A fee is the cost of running the thing,
 * and counting it as withheld overstates the withheld block and every funding
 * rollup sitting above it.
 *
 * **This source is the first one that can state it, and the first that gets it
 * wrong.** A forum thread does not list the fee as a lot at all, so no earlier
 * importer ever had to decide. alesievauctions.com lists it — it is a row in
 * the database like any other — and tags it `Withheld`, because from the site's
 * point of view it is a lot that drew no bid. That is not our `withheld`.
 * Measured on `20275`, the first real file: 10 of its 11 withheld rows were the
 * fee (9 x `Random Ultra Rare` plus `Golden Ticket`). Corroboration from the
 * other direction — all four recorded `Golden Ticket` rows in
 * `contextItems.csv` are `token` rows with a price (`20266` at $1,254,
 * `202644` at $855, `202645` at $701, `202647` at $652), and not one is
 * withheld.
 *
 * ## Why this list is deliberately TIGHT
 *
 * Every other name rule in this file routes a row; this one DELETES it, and
 * that inverts which way to lean. `forumThread.gs`'s lesson — write a rule
 * looser than the one example you have — is about auctioneers being
 * inconsistent with themselves in prose. It does not transfer to a rule that
 * drops data:
 *
 *   - Too tight, and a fee spelling nobody has seen lands in `contextItems` as
 *     withheld. That is today's behaviour, it is visible in the review, and the
 *     operator deletes one row.
 *   - Too loose, and a genuine withheld token disappears from the funding
 *     rollups with nothing anywhere to say it ever existed.
 *
 * So every key here is a spelling the CORPUS already holds for these two
 * things, and nothing is invented. The Random UR keys are `ALESIEV_CONTEXT_RULES`'
 * own; the Golden Ticket keys are the three `contextItems.csv` records
 * (`Golden Ticket`, `Golden Ticket Chance`, `Chance at Golden Ticket`).
 *
 * ## It applies on the WITHHELD path only
 *
 * A SOLD `Random Ultra Rare` is a lucky dip somebody paid for, which is a real
 * market observation, and `ALESIEV_CONTEXT_RULES` still aggregates it into one
 * `token` row the way all 21 recorded appearances are shaped. Same name,
 * opposite treatment, and the thing that decides is column B.
 */
var ALESIEV_FEE_NAMES = {
  'random ultra rare': true,
  'random ultra rares': true,
  'random ur': true,
  'random urs': true,
  'golden ticket': true,
  'golden ticket chance': true,
  'chance at golden ticket': true,
};

/**
 * The tab context rows are written to.
 *
 * Not in `TABS`, deliberately: that map is `trentClose.gs`'s and `checkTabs()`
 * walks every entry in it, so adding one there would make the Trent importer
 * refuse to run in a workbook without this tab.
 */
var ALESIEV_CONTEXT_TAB = 'contextItems';

/** An ISO date, and nothing else. See alesievCloseDateProblem. */
var ALESIEV_ISO_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// ===========================================================================
// Pure — column A grammar
// ===========================================================================

/**
 * Drop one layer of literal double quotes from around a name.
 *
 * The export wraps a name containing a comma in quotes of its own, INSIDE the
 * CSV quoting — the raw field is `"""5,000 GP Gold Bar"" (1 of 9)"`, so the
 * cell value is `"5,000 GP Gold Bar" (1 of 9)`. Both placements are handled:
 * the quotes can wrap the whole cell or just the name, with the lot marker
 * outside them.
 */
function alesievUnquote(s) {
  var t = String(s == null ? '' : s).trim();
  var m = t.match(/^"(.*)"$/);
  return m ? m[1].trim() : t;
}

/** Split a trailing `(N of M)` off a name. `lot` is null when there is none. */
function alesievStripLotMarker(name) {
  var s = String(name == null ? '' : name).trim();
  var m = s.match(ALESIEV_LOT_OF_RE);
  if (!m) return { name: s, lot: null };
  return {
    name: s.slice(0, s.length - m[0].length).trim(),
    lot: { number: parseInt(m[1], 10), count: parseInt(m[2], 10) },
  };
}

/**
 * `5,000 GP Gold Bar` -> `5x 1,000 GP Gold Bar`, so the SHARED quantity rule
 * reads it. Returns null when the name is not a gold bar at all.
 *
 * Rewriting into the leading-`N x ` form rather than teaching `parseQuantity` a
 * new shape is the same move `forumClose.gs` makes for a trailing `10x`: the
 * rule verified against 18,466 Trent lots stays untouched.
 */
function alesievGoldBar(name) {
  var m = String(name == null ? '' : name).trim().match(ALESIEV_GOLD_BAR_RE);
  if (!m) return null;
  var gp = parseInt(String(m[1]).replace(/,/g, ''), 10);
  if (!isFinite(gp) || gp < 1000 || gp % 1000 !== 0) return null;
  var n = gp / 1000;
  return n === 1 ? '1,000 GP Gold Bar' : n + 'x 1,000 GP Gold Bar';
}

/**
 * A column A cell to the name the shared parser expects, plus the lot marker
 * that was taken off it.
 *
 * Order matters and is not arbitrary. The quotes come off first because they
 * can sit outside the lot marker; the marker comes off next because the gold
 * bar and trailing-`Nx` rules are both end-anchored and neither fires while it
 * is still there.
 */
function alesievNormaliseName(raw) {
  var s = alesievUnquote(raw);
  var split = alesievStripLotMarker(s);
  s = alesievUnquote(split.name);

  var bar = alesievGoldBar(s);
  if (bar) return { name: bar, lot: split.lot };

  // `Alchemist's Ink 10x` means what `10x Alchemist's Ink` means, and only the
  // second is what the shared quantity rule reads. Same rewrite
  // `forumNormaliseName` makes, repeated rather than called so this file's
  // grammar is readable in one place.
  var trailing = s.match(/^(.*?)[\s,]+(\d+)\s*[xX]$/);
  if (trailing) return { name: trailing[2] + 'x ' + trailing[1].trim(), lot: split.lot };

  return { name: s, lot: split.lot };
}

// ===========================================================================
// Pure — column B routing
// ===========================================================================

/**
 * A column B value to a destination.
 *
 * Returns `{ destination, category }`, or `{ error }` for an `Augment - <kind>`
 * this does not know. Never guesses: the four-value `contextItems` vocabulary
 * is checked at the PR gate and a fifth spelling invented here would fail there
 * instead, a long way from the cause.
 */
function alesievRoute(value) {
  var s = String(value == null ? '' : value).trim();
  if (ALESIEV_ONYX_RE.test(s)) return { destination: 'onyx', category: null };
  if (ALESIEV_WITHHELD_RE.test(s)) return { destination: 'context', category: 'withheld' };
  var aug = s.match(ALESIEV_AUGMENT_RE);
  if (aug) {
    var kind = String(aug[1]).trim().toLowerCase();
    var category = ALESIEV_AUGMENT_CATEGORIES[kind];
    if (!category) {
      return {
        error: '"' + s + '" is an augment of a kind this script does not know. Known kinds: ' +
          Object.keys(ALESIEV_AUGMENT_CATEGORIES).join(', ') +
          '. Add it to ALESIEV_AUGMENT_CATEGORIES with the contextItems category it should take.',
      };
    }
    return { destination: 'context', category: category };
  }
  return { destination: 'price', category: null };
}

/** The key a name is looked up under in ALESIEV_CONTEXT_RULES. */
function alesievContextKey(name) {
  return String(name == null ? '' : name)
    .toLowerCase()
    .replace(/^\s*\d+\s*x\s+/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function alesievContextRule(name) {
  return ALESIEV_CONTEXT_RULES[alesievContextKey(name)] || null;
}

/**
 * Whether a withheld lot is really the auctioneer's fee. See ALESIEV_FEE_NAMES.
 *
 * Keyed the same way as a context rule, so the lot marker and a leading `9x`
 * are already off by the time this is asked — `alesievReadStaging` has run
 * `alesievNormaliseName` and `alesievContextKey` strips the rest.
 */
function alesievIsFeeName(name) {
  return ALESIEV_FEE_NAMES[alesievContextKey(name)] === true;
}

// ===========================================================================
// Pure — reading the staged export
// ===========================================================================

function alesievFindColumn(header, aliases) {
  for (var i = 0; i < header.length; i++) if (aliases.indexOf(header[i]) !== -1) return i;
  return -1;
}

/**
 * Read the pasted export into routed buckets.
 *
 * `lots` carry the same `{ name, bid, row }` shape `trentClose.gs`'s
 * `readStaging` produces, so `processAuction` can take them unchanged.
 */
function alesievReadStaging(values) {
  if (!values || !values.length) return { error: 'the staging tab is empty' };
  var header = values[0].map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });

  var nameCol = alesievFindColumn(header, ALESIEV_NAME_HEADERS);
  var catCol = alesievFindColumn(header, ALESIEV_CATEGORY_HEADERS);
  var priceCol = alesievFindColumn(header, ALESIEV_PRICE_HEADERS);
  if (nameCol === -1 || catCol === -1 || priceCol === -1) {
    var missing = [];
    if (nameCol === -1) missing.push('a name column from [' + ALESIEV_NAME_HEADERS.join(', ') + ']');
    if (catCol === -1) missing.push('a category column from [' + ALESIEV_CATEGORY_HEADERS.join(', ') + ']');
    if (priceCol === -1) missing.push('a price column from [' + ALESIEV_PRICE_HEADERS.join(', ') + ']');
    return {
      error: 'could not find ' + missing.join(', ') + '. Row 1 reads [' + header.join(' | ') + '].',
    };
  }

  var out = {
    lots: [], onyx: [], withheld: [], augments: [], context: [],
    unsold: [], fee: [], routeErrors: [], ignored: [],
  };
  for (var i = 0; i < header.length; i++) {
    if (ALESIEV_IGNORED_HEADERS.indexOf(header[i]) !== -1) out.ignored.push(values[0][i]);
  }

  for (var r = 1; r < values.length; r++) {
    var rawName = values[r][nameCol];
    if (!String(rawName == null ? '' : rawName).trim()) continue;

    var parsed = alesievNormaliseName(rawName);
    var route = alesievRoute(values[r][catCol]);
    var where = 'row ' + (r + 1) + ' "' + String(rawName).trim() + '"';
    if (route.error) { out.routeErrors.push(where + ': ' + route.error); continue; }

    var text = String(values[r][priceCol] == null ? '' : values[r][priceCol]).replace(/[$,]/g, '').trim();
    var bid = text === '' ? null : roundCents(parseFloat(text));
    if (bid !== null && isNaN(bid)) bid = null;

    var lot = {
      name: parsed.name, rawName: String(rawName).trim(), bid: bid, row: r + 1,
      lot: parsed.lot, category: route.category,
    };

    // A withheld item never sold, so a blank price is its EXPECTED shape rather
    // than a missing value. Every other destination needs a bid.
    //
    // The fee is taken out FIRST. The site tags it `Withheld` because it is a
    // lot that drew no bid, but it is the cost of running the auction rather
    // than a token kept back from the group — see ALESIEV_FEE_NAMES. It is
    // written nowhere, and alesievPlanImport names every lot this dropped.
    if (route.destination === 'context' && route.category === 'withheld') {
      if (alesievIsFeeName(lot.name)) out.fee.push(lot);
      else out.withheld.push(lot);
      continue;
    }
    if (bid === null) { out.unsold.push(lot); continue; }

    if (route.destination === 'onyx') { out.onyx.push(lot); continue; }
    if (route.destination === 'context') { out.augments.push(lot); continue; }
    if (alesievContextRule(lot.name)) { out.context.push(lot); continue; }
    out.lots.push(lot);
  }
  return out;
}

// ===========================================================================
// Pure — building the output rows
// ===========================================================================

/**
 * Onyx lots to `onyx` rows.
 *
 * No division, matching `processAuction`: all 1,155 recorded Onyx rows are
 * single tokens, so a multi-token Onyx lot is a shape nobody has seen and
 * dividing it would be a guess. It aborts instead.
 *
 * `stripOnyxMarker` still runs even though column B has already routed the row,
 * because the name may ALSO carry the marker — `+2 Sacred Sling - 2023 (Onyx)`
 * — and it is always stripped from the stored `Item`.
 *
 * `ONYX_NORMALIZATION` is then applied SEPARATELY, and that is not redundant.
 * `stripOnyxMarker` returns early on any name not containing the word "onyx",
 * so on the Trent and forum paths — where the marker is always in the name —
 * the normalisation always runs, and here, where column B carries the marker
 * instead, it never would. That is the one behaviour this routing quietly
 * changes, and `Common/Uncommon/Rare Set` reaching `onyx` under its long name
 * instead of `C/UC/R Set` is what it costs: a 22nd distinct Item across a
 * corpus where every order is exactly 21 rows.
 */
function alesievOnyxRows(onyxLots) {
  var rows = [], aborts = [], cautions = [], seen = {};
  for (var i = 0; i < onyxLots.length; i++) {
    var lot = onyxLots[i];
    var q = parseQuantity(lot.name);
    if (q.quantity > 1) {
      aborts.push('row ' + lot.row + ' "' + lot.rawName + '": an Onyx lot holding ' + q.quantity +
        ' tokens is a shape this pipeline has never seen — all 1,155 recorded Onyx rows are single ' +
        'tokens. Split it by hand rather than letting the script guess whether the price divides.');
      continue;
    }
    // The marker may not be in the name at all here; take the stripped name
    // either way, since stripOnyxMarker leaves a clean name untouched.
    var marked = stripOnyxMarker(stripDecorations(lot.name));
    var item = ONYX_NORMALIZATION[foldName(marked.name)] || marked.name;
    if (seen[item]) {
      cautions.push('"' + item + '" appears as ' + (seen[item] + 1) + ' Onyx lots. An Onyx order is 21 rows, ' +
        'one per token, so two rows for one token is worth a look before you write.');
    }
    seen[item] = (seen[item] || 0) + 1;
    rows.push({ Item: item, Price: lot.bid, 'Display Name': item, Category: ONYX_CATEGORY });
  }
  return { rows: rows, aborts: aborts, cautions: cautions };
}

/**
 * Withheld lots to ONE `contextItems` row per resolved Item, quantities summed.
 *
 * That is how every recorded withheld block is shaped — `20251` records 90
 * withheld `1,000 GP Gold Bar` and 226 `Darkwood Plank` as one row each, not
 * one row per lot — and it is what the funding rollups above it expect.
 *
 * **`priceAugmented` is left blank on purpose.** A withheld item did not sell,
 * so there is no bid to transcribe, and the workbook computes the negative
 * figure as a query over `prices`. Writing a literal there would fight the
 * formula.
 *
 * ## The name is resolved in three steps, and the third one is the point
 *
 * This asked `tokenMetadata` and nothing else until 2026-09-19, when the first
 * split Onyx order arrived and it aborted the whole import. `20275` sold 12
 * Onyx tokens and WITHHELD 9 of the same set, plus nine Random Ultra Rares —
 * and not one of those eleven names can be in `tokenMetadata`:
 *
 *  1. **A context rule names its own canonical spelling.**
 *     `Random Ultra Rare` is an aggregate, not a token; it is the name
 *     `contextItems` records all 21 of its appearances under, and asking
 *     `tokenMetadata` for it is asking the wrong file. The rules were already
 *     written — `ALESIEV_CONTEXT_RULES` — and were simply never consulted on
 *     this path.
 *
 *     **No withheld lot reaches this step today, and it stays anyway.** Every
 *     one of the four current context rules is a Random UR spelling, and as of
 *     2026-09-19 those are also `ALESIEV_FEE_NAMES`, so `alesievReadStaging`
 *     takes them out before this function ever sees them. The branch is kept
 *     because the two lists answer different questions — "what does
 *     `contextItems` call this?" and "is this the auctioneer's fee?" — and a
 *     context rule for something that is NOT a fee would land here and abort
 *     exactly as the Random URs did before PIPE-8. `npm run test:alesiev`
 *     calls this function directly to keep the step proved while nothing
 *     upstream can exercise it.
 *
 *  2. **Then `tokenMetadata`, after the Onyx marker comes off.** This is the
 *     step that keeps ordinary withheld tokens honest, and it is not
 *     decorative: `20222` withholds fifteen of them (gold bars, trade goods, a
 *     Patron Pin) inside an Onyx auction, and a typo in any of those still
 *     stops the run. `stripOnyxMarker` and `ONYX_NORMALIZATION` run first, the
 *     same pairing and for the same reason as `alesievOnyxRows`.
 *
 *  3. **Then, in an ONYX auction only, the name is accepted as it stands.**
 *     An Onyx chase token is deliberately absent from `tokenMetadata` —
 *     measured across the corpus, 2026 has 12 of its 84 Onyx names there and
 *     2018 has 12 of 63 — which is exactly why `alesievOnyxRows` does not
 *     resolve a SOLD Onyx lot either. A withheld one is the same token on the
 *     other side of the sale, so it gets the same treatment, and there is
 *     nothing it could be checked against: it is withheld precisely because it
 *     is not in this file's Onyx block, and in a season's first Onyx auction it
 *     is in no other file either.
 *
 * Step 3 raises a CAUTION naming every lot it let through, because that is the
 * one thing left that can catch a misspelling here — the operator reads them in
 * the confirm dialog. Outside an Onyx auction there is no step 3 and an
 * unresolved name still aborts.
 */
function alesievWithheldRows(withheldLots, season, index, isOnyxAuction) {
  var groups = {}, order = [], aborts = [], cautions = [], unchecked = [], i;
  for (i = 0; i < withheldLots.length; i++) {
    var lot = withheldLots[i];
    var base = stripDecorations(lot.name);
    var name = null;

    var rule = alesievContextRule(lot.name);
    if (rule) {
      name = rule.item;
    } else {
      // Same pairing as alesievOnyxRows: the stripper returns early on a name
      // with no "onyx" in it, so the normalisation has to be applied separately
      // or a clean `Common/Uncommon/Rare Set` never reaches it.
      var marked = stripOnyxMarker(base);
      var normalised = ONYX_NORMALIZATION[foldName(marked.name)] || marked.name;
      var token = resolveToken(normalised, season, index);
      if (token) {
        name = token.Item;
      } else if (isOnyxAuction) {
        name = normalised;
        unchecked.push('"' + normalised + '"');
      } else {
        aborts.push('row ' + lot.row + ' "' + lot.rawName + '": withheld, but "' + base +
          '" is not a token in season ' + season + ' and this is not an Onyx auction. A withheld row is ' +
          'keyed to a token like any other, so this either needs a tokenMetadata row or is not really withheld.');
        continue;
      }
    }

    var q = parseQuantity(lot.name).quantity || 1;
    if (!groups[name]) { groups[name] = 0; order.push(name); }
    groups[name] += q;
  }
  if (unchecked.length) {
    cautions.push(unchecked.length + ' withheld name(s) were taken from the file as they stand, because an Onyx ' +
      'chase token is not in tokenMetadata and a withheld one is in no other file either: ' +
      unchecked.join(', ') + '. Nothing can check these spellings but you — one wrong letter starts a second ' +
      'series with half the history.');
  }
  order.sort();
  var rows = [];
  for (i = 0; i < order.length; i++) rows.push({ category: 'withheld', Item: order[i], quantity: groups[order[i]], price: '' });
  return { rows: rows, aborts: aborts, cautions: cautions };
}

/**
 * Augment lots to `contextItems` rows — one per lot, name kept verbatim.
 *
 * Deliberately NOT resolved against `tokenMetadata`. An augment comes out of
 * the auctioneer's personal collection and can be any token ever printed, so it
 * is almost never in the season's own metadata; `contextItems` stores those
 * names as free text (`Green Key`, `Boots of Protection`, `2024 Ultra Rare
 * Set`) and § 8 of `validate-prices.mjs` is what guards their spelling.
 *
 * This is also the one place this source beats the forum file path outright.
 * `forumClose.gs` gets six lots all called `Grunnel Augment` and has to leave
 * the `Item` blank for the operator to fill in from the thread. The site names
 * every augment individually, so the row is complete.
 */
function alesievAugmentRows(augmentLots) {
  var rows = [];
  for (var i = 0; i < augmentLots.length; i++) {
    var lot = augmentLots[i];
    rows.push({
      category: lot.category,
      Item: stripDecorations(lot.name),
      quantity: parseQuantity(lot.name).quantity || 1,
      price: lot.bid,
    });
  }
  return rows;
}

/**
 * Name-routed context lots (`Random Ultra Rare`) to aggregated
 * `contextItems` rows. Sums the lots' own prices — see ALESIEV_CONTEXT_RULES.
 */
function alesievNamedContextRows(contextLots) {
  var groups = {}, order = [], i;
  for (i = 0; i < contextLots.length; i++) {
    var key = alesievContextKey(contextLots[i].name);
    var rule = alesievContextRule(contextLots[i].name);
    if (!groups[key]) { groups[key] = { rule: rule, lots: [] }; order.push(key); }
    groups[key].lots.push(contextLots[i]);
  }
  var rows = [];
  for (i = 0; i < order.length; i++) {
    var g = groups[order[i]];
    var total = 0, quantity = 0;
    for (var j = 0; j < g.lots.length; j++) {
      total = roundCents(total + g.lots[j].bid);
      quantity += parseQuantity(g.lots[j].name).quantity || 1;
    }
    rows.push({ category: g.rule.category, Item: g.rule.item, quantity: quantity, price: total });
  }
  return rows;
}

/**
 * How an aggregated total was arrived at — `8 @ $55 + 1 @ $57 = $497`.
 *
 * A total is not checkable on its own; the distribution it came from is. Same
 * principle, and the same wording, as `forumAggregateBreakdown`.
 */
function alesievAggregateBreakdown(contextLots) {
  var groups = {}, order = [], lines = [], i;
  for (i = 0; i < contextLots.length; i++) {
    var key = alesievContextKey(contextLots[i].name);
    var rule = alesievContextRule(contextLots[i].name);
    if (!rule || !rule.aggregate) continue;
    if (!groups[key]) { groups[key] = { name: rule.item, prices: [] }; order.push(key); }
    groups[key].prices.push(contextLots[i].bid);
  }
  for (i = 0; i < order.length; i++) {
    var g = groups[order[i]], counts = {}, seen = [], total = 0, p;
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

// ===========================================================================
// Pure — the plan
// ===========================================================================

/**
 * Everything the operator needs to decide whether to write, in one object.
 * `ok` is false whenever any abort fired; nothing is written in that case, and
 * never a partial auction.
 *
 * `recordedIds` is every `auctionId` that already has a row in `prices`. An
 * auction that has already been imported aborts rather than doubling. Neither
 * `trentClose.gs` nor `forumClose.gs` checks this; it is cheap here because the
 * whole file is one auction, and re-importing is the easiest mistake to make
 * with an export you can download twice.
 */
function alesievPlanImport(values, targetSeason, tokenMetadataRows, alreadyPriced, auctionStyle) {
  var staged = alesievReadStaging(values);
  if (staged.error) return { ok: false, aborts: [staged.error], cautions: [], lots: 0 };

  var total = staged.lots.length + staged.onyx.length + staged.withheld.length +
    staged.augments.length + staged.context.length + staged.unsold.length + staged.fee.length;
  if (!total) return { ok: false, aborts: ['the staging tab has a header but no lots'], cautions: [], lots: 0 };

  var index = buildTokenIndex(tokenMetadataRows);
  var aborts = staged.routeErrors.slice();
  var cautions = [];

  // The season the file thinks it is, versus the auction the operator picked.
  // Only the PRICE lots vote: an Onyx chase token and an augment out of a
  // personal collection are not in any season's metadata, so counting them
  // would just add noise equally to every season. Same rule as Phase 2 — only a
  // POSITIVE mismatch aborts, because an inconclusive answer is not evidence of
  // a mistake.
  var names = [];
  for (var n = 0; n < staged.lots.length; n++) names.push(staged.lots[n].name);
  var seasons = inferSeasons(names, index);
  if (!seasons.length || seasons.length > 1) {
    cautions.push('nothing in this file is unique to one season, so it could not be checked against season ' +
      targetSeason + ' — confirm you picked the right auction');
  } else if (seasons[0] !== String(targetSeason)) {
    aborts.push('this file looks like season ' + seasons[0] + ', but the chosen auction is season ' +
      targetSeason + ' — check you picked the right auction');
  }

  if (alreadyPriced) {
    aborts.push('this auction already has rows in ' + TABS.prices + '. Importing again would double every ' +
      'price. If you meant to replace them, delete the existing rows first.');
  }

  var result = processAuction(staged.lots, targetSeason, index);
  for (var a = 0; a < result.aborts.length; a++) aborts.push(result.aborts[a]);

  var onyx = alesievOnyxRows(staged.onyx);
  for (var o = 0; o < onyx.aborts.length; o++) aborts.push(onyx.aborts[o]);
  for (var c = 0; c < onyx.cautions.length; c++) cautions.push(onyx.cautions[c]);

  // ANCHORED, for the reason auctionOpen.gs learned the hard way: a loose
  // /onyx/ reads `Non-Onyx` as Onyx, and here that would switch off the
  // tokenMetadata check on every withheld name in a non-Onyx auction.
  var isOnyxAuction = ALESIEV_ONYX_STYLE_RE.test(String(auctionStyle == null ? '' : auctionStyle).trim());
  var withheld = alesievWithheldRows(staged.withheld, targetSeason, index, isOnyxAuction);
  for (var w = 0; w < withheld.aborts.length; w++) aborts.push(withheld.aborts[w]);
  for (var wc = 0; wc < withheld.cautions.length; wc++) cautions.push(withheld.cautions[wc]);

  // An Onyx auction the caller did not name the style of. The withheld path
  // then has no step 3 and aborts on a chase token, which is the bug this
  // parameter exists to fix — so say which call site forgot rather than
  // letting it look like bad data.
  if (!auctionStyle && staged.onyx.length) {
    cautions.push('no auctionStyle was passed for this auction, so withheld names could only be checked ' +
      'against tokenMetadata. This file sells Onyx lots, so it is almost certainly an Onyx auction — ' +
      'if a withheld chase token aborted below, that is why.');
  }

  var context = withheld.rows
    .concat(alesievAugmentRows(staged.augments))
    .concat(alesievNamedContextRows(staged.context));

  if (staged.unsold.length) {
    cautions.push(staged.unsold.length + ' lot(s) drew no bid and were dropped: ' +
      alesievLotNames(staged.unsold).join(', ') + '.');
  }
  // Named individually rather than counted. The fee is the one thing this
  // importer throws away on purpose, and a row that is silently discarded is a
  // row nobody can check — if a real withheld token ever matches this list,
  // this line is the only place it will show up.
  if (staged.fee.length) {
    cautions.push(staged.fee.length + " lot(s) are the auctioneer's fee and were written nowhere: " +
      alesievLotNames(staged.fee).join(', ') + '. The site tags the fee `Withheld` because it drew no ' +
      'bid, but a fee is the cost of running the auction rather than a token kept back from the group, ' +
      'so it is not a withheld row. Anything in that list that IS genuinely withheld has to be added by ' +
      'hand.');
  }
  if (staged.ignored.length) {
    cautions.push('columns read: Item, Category and the ending bid. Ignored: ' + staged.ignored.join(', ') +
      '. "Average Bid" here is a per-lot bid statistic, NOT the pivot-over-all-bids column that ' +
      'forumClose.gs refuses a file for.');
  }

  return {
    ok: aborts.length === 0,
    aborts: aborts,
    cautions: cautions,
    seasons: seasons,
    lots: total,
    raw: result.raw,
    prices: result.prices,
    onyx: onyx.rows,
    context: context,
    contextLots: staged.context,
    unsold: staged.unsold,
    fee: staged.fee,
    unresolved: result.unresolved,
    withheldLots: staged.withheld,
    augmentLots: staged.augments,
  };
}

function alesievLotNames(lots) {
  var out = [];
  for (var i = 0; i < lots.length; i++) out.push(lots[i].rawName);
  return out;
}

/** A short human summary of a plan, for the confirmation dialog. */
function alesievDescribePlan(plan, auctionId, closeDate) {
  var lines = [], i;
  if (!plan.ok) {
    lines.push('NOTHING WILL BE WRITTEN — ' + plan.aborts.length + ' problem(s):');
    for (i = 0; i < plan.aborts.length; i++) lines.push('  • ' + plan.aborts[i]);
    if (plan.cautions.length) {
      lines.push('');
      for (i = 0; i < plan.cautions.length; i++) lines.push('  note: ' + plan.cautions[i]);
    }
    return lines.join('\n');
  }
  lines.push('Auction ' + auctionId + ' — ' + plan.lots + ' rows read:');
  lines.push('  ' + plan.raw.length + ' priced lots  ->  ' + TABS.raw);
  lines.push('  ' + plan.prices.length + ' min/max rows  ->  ' + TABS.prices);
  if (plan.onyx.length) lines.push('  ' + plan.onyx.length + ' Onyx rows  ->  ' + TABS.onyx);
  if (plan.context.length) {
    lines.push('  ' + plan.context.length + ' context rows  ->  ' + ALESIEV_CONTEXT_TAB + ':');
    for (i = 0; i < plan.context.length; i++) {
      var row = plan.context[i];
      lines.push('      ' + row.category + '  ' + row.Item + '  x' + row.quantity +
        (row.price === '' ? '  (no price — the sheet computes it)' : '  $' + row.price));
    }
  }
  if (closeDate) lines.push('  closeDate ' + closeDate + '  ->  ' + TABS.metadata);
  var breakdown = alesievAggregateBreakdown(plan.contextLots || []);
  if (breakdown.length) {
    lines.push('');
    lines.push('How the summed rows add up:');
    for (i = 0; i < breakdown.length; i++) lines.push('  ' + breakdown[i]);
  }
  if (plan.cautions.length) {
    lines.push('');
    lines.push('CAUTION:');
    for (i = 0; i < plan.cautions.length; i++) lines.push('  • ' + plan.cautions[i]);
  }
  return lines.join('\n');
}

/**
 * Why a typed close date cannot be used, or '' when it can.
 *
 * **This refuses rather than converts, and that is the lesson of Phase 4's
 * worst bug.** `2026-09-19` written to a sheet comes back from `getValues()` as
 * a JavaScript `Date`, and `String()` of that is
 * `Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)` — which is not a
 * date Sheets can parse, so `daysToClose` and `Close Month` stop computing and
 * the string reaches the site. Accepting only one shape on the way in is half
 * the defence; reading the cell back afterwards is the other half.
 */
function alesievCloseDateProblem(text) {
  var s = String(text == null ? '' : text).trim();
  if (!s) return 'no close date given';
  if (!ALESIEV_ISO_RE.test(s)) {
    return '"' + s + '" is not an ISO date. Type it as YYYY-MM-DD (for example 2026-09-19) — ' +
      'any other shape gets coerced by Sheets on the way in and stops daysToClose and Close Month computing.';
  }
  return '';
}

/** The contextItems block as tab-separated text, ready to paste or to check. */
function alesievContextWorksheetText(plan, target) {
  if (!plan.context || !plan.context.length) return '';
  var lines = [CONTEXT_COLUMNS.join('\t')];
  for (var i = 0; i < plan.context.length; i++) {
    var row = plan.context[i];
    var cells = [target.auctionId, target.auctionSeason, target.auctionNumber,
      row.category, row.Item, row.quantity, row.price];
    var out = [];
    for (var c = 0; c < cells.length; c++) out.push(tsvCell(cells[c]));
    lines.push(out.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Whether an auctionMetadata row came from alesievauctions.com.
 *
 * MEMBERSHIP IS THE LINK, NOT THE AUCTIONEER. Until 2026-09-20 the picker
 * listed rows whose `auctioneer` was `alesiev`, which reads like the obvious
 * test and is the wrong one: the site hosts auctions other people run. Of the
 * six site rows recorded on the day this changed, two are his — the other four
 * are Mike Steele, Kusig, Flik and BasicBraining, and none of them appeared.
 * `20275` is among them, and it is the ONE real close this path has ever seen:
 * the importer hid exactly the auctions it exists to read, and the operator
 * had to know the id already.
 *
 * `openAlesievId` is the same anchored parse `auctionOpen.gs` keys this
 * source's duplicates on, so "a row from this site" has one definition instead
 * of two that drift.
 */
function alesievIsSiteRow(m) {
  return !!openAlesievId(m.Link);
}

/** Every alesievauctions.com row, newest first. Ordering lives in trentClose.gs. */
function alesievSiteAuctions(metaRows) {
  return closeAuctionsFrom(metaRows, alesievIsSiteRow);
}

/** The shortlist the picker shows: this season's site auctions, capped. */
function alesievPickerList(metaRows, limit) {
  return closePickerList(metaRows, alesievIsSiteRow, limit);
}

/** One line of it. */
function alesievPickerLine(m) {
  return closePickerLine(m);
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook. Nothing above it does.
// ===========================================================================

/** `trentClose.gs`'s single onOpen calls this; there is no onOpen here. */
function addAlesievMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Import alesievauctions.com close…', 'importAlesievClose')
    .addItem('Dry run — show what the export would import', 'dryRunAlesievClose');
}

function alesievCheckTabs() {
  var ss = SpreadsheetApp.getActive();
  var problems = checkTabs();
  if (!ss.getSheetByName(ALESIEV_STAGING_TAB)) problems.push('no tab named "' + ALESIEV_STAGING_TAB + '"');
  if (!ss.getSheetByName(ALESIEV_CONTEXT_TAB)) problems.push('no tab named "' + ALESIEV_CONTEXT_TAB + '"');
  return problems;
}

/**
 * Pick the target auction: the site's rows, newest first, this season.
 *
 * The list is a shortlist, never a gate. The id the operator types is looked up
 * across the whole tab, so an auction from an older season — or one recorded
 * with no Link at all — still imports, and the season check inside the plan is
 * what actually guards the choice.
 */
function alesievTargetAuction(ui, title) {
  var meta = readTab(TABS.metadata);
  var prompt = 'Target auctionId?' +
    closePickerPrompt(alesievPickerList(meta), 'alesievauctions.com', TABS.metadata);
  var choice = ui.prompt(title, prompt, ui.ButtonSet.OK_CANCEL);
  if (choice.getSelectedButton() !== ui.Button.OK) return null;

  var auctionId = choice.getResponseText().trim();
  for (var j = 0; j < meta.length; j++) {
    if (meta[j].auctionId !== auctionId) continue;
    // A Failed auction sold nothing, so a close cannot belong to it. Refused
    // here rather than at the write, because by the write the operator has
    // already read and approved a plan that was never going to be right.
    var problem = closeOutcomeProblem(meta[j].outcome);
    if (problem) { ui.alert('Cannot import', 'Auction ' + auctionId + ': ' + problem, ui.ButtonSet.OK); return null; }
    return meta[j];
  }
  ui.alert('No auction "' + auctionId + '" in ' + TABS.metadata + '. Run the auction scan and promote it first.');
  return null;
}

/** Whether `prices` already holds rows for this auction. */
function alesievAlreadyPriced(auctionId) {
  var rows = readTab(TABS.prices);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].auctionId).trim() === String(auctionId)) return true;
  return false;
}

function alesievBuildPlan(target) {
  var staging = SpreadsheetApp.getActive().getSheetByName(ALESIEV_STAGING_TAB);
  return alesievPlanImport(
    staging.getDataRange().getDisplayValues(),
    target.auctionSeason,
    readTab(TABS.tokens),
    alesievAlreadyPriced(target.auctionId),
    target.auctionStyle);
}

function dryRunAlesievClose() {
  var ui = SpreadsheetApp.getUi();
  var missing = alesievCheckTabs();
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }
  var target = alesievTargetAuction(ui, 'Dry run');
  if (!target) return;
  var plan = alesievBuildPlan(target);
  ui.alert('Dry run — nothing written (script ' + ALESIEV_VERSION + ')',
    alesievDescribePlan(plan, target.auctionId, null), ui.ButtonSet.OK);
  alesievShowContext(plan, target);
}

function importAlesievClose() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var missing = alesievCheckTabs();
  if (missing.length) {
    ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • ') +
      '\n\nFix the names at the top of the script, or create the tab.', ui.ButtonSet.OK);
    return;
  }
  var target = alesievTargetAuction(ui, 'Import alesievauctions.com close');
  if (!target) return;

  var plan = alesievBuildPlan(target);
  if (!plan.ok) {
    ui.alert('Import aborted — nothing written (script ' + ALESIEV_VERSION + ')',
      alesievDescribePlan(plan, target.auctionId, null), ui.ButtonSet.OK);
    alesievShowContext(plan, target);
    return;
  }

  // The close date is not in the export. Ask for it, refuse anything but ISO,
  // and let the operator skip it — the rows are still worth writing without it,
  // and a blank closeDate simply leaves Status computing `Open`.
  var closeDate = null;
  var held = String(target.closeDate || '').trim();
  var dateChoice = ui.prompt('Close date',
    'Close date for auction ' + target.auctionId + ', as YYYY-MM-DD.\n\n' +
      (held ? 'This auction already records ' + held + '. Leave blank to keep it.\n\n'
            : 'Leave blank to skip — Status stays "Open" until closeDate is filled in.\n\n') +
      'This is when the auction ACTUALLY closed, which is not the "Ends:" date on the card.',
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

  var destinations = [
    TABS.raw + ' from row ' + (ss.getSheetByName(TABS.raw).getLastRow() + 1),
    TABS.prices + ' from row ' + (ss.getSheetByName(TABS.prices).getLastRow() + 1),
  ];
  if (plan.onyx.length) destinations.push(TABS.onyx + ' from row ' + (ss.getSheetByName(TABS.onyx).getLastRow() + 1));
  if (plan.context.length) {
    destinations.push(ALESIEV_CONTEXT_TAB + ' from row ' + (ss.getSheetByName(ALESIEV_CONTEXT_TAB).getLastRow() + 1));
  }
  if (closeDate) destinations.push(TABS.metadata + ' closeDate for ' + target.auctionId);

  var summary = alesievDescribePlan(plan, target.auctionId, closeDate);
  var go = ui.alert('Import alesievauctions.com close (script ' + ALESIEV_VERSION + ')',
    summary + '\n\nWriting to:\n  ' + destinations.join('\n  ') + '\n\nWrite these rows?', ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) return;

  var keyed = function (cells) { return [target.auctionId, target.auctionSeason, target.auctionNumber].concat(cells); };

  appendRows(TABS.raw, plan.raw.map(function (r) {
    return keyed([r.trentName, r.trentPrice, r.Item, r.Price, r.Category]);
  }));
  appendRows(TABS.prices, plan.prices.map(function (r) {
    return keyed([r.Item, r.Price, r['Display Name'], r.Category]);
  }));
  if (plan.onyx.length) {
    appendRows(TABS.onyx, plan.onyx.map(function (r) {
      return keyed([r.Item, r.Price, r['Display Name'], r.Category]);
    }));
  }
  if (plan.context.length) {
    appendRows(ALESIEV_CONTEXT_TAB, plan.context.map(function (r) {
      return keyed([r.category, r.Item, r.quantity, r.price]);
    }));
  }

  var dateNote = '';
  if (closeDate) dateNote = '\n\n' + alesievWriteCloseDate(target.auctionId, closeDate);
  SpreadsheetApp.flush();

  ui.alert('Imported (script ' + ALESIEV_VERSION + ')',
    summary + dateNote + '\n\nWritten. Publish when you are ready.', ui.ButtonSet.OK);
}

/**
 * Write `closeDate` for one auction, then READ THE CELL BACK.
 *
 * The read-back is the point. `closeDate` is a literal column, and a value this
 * pipeline round-trips through a sheet is not the value it wrote: an ISO string
 * gets coerced to a real date cell, and how that cell then DISPLAYS depends on
 * the column's number format. `getDisplayValues()` is what `publishToSite.gs`
 * exports, so a cell displaying `9/19/2026` publishes `9/19/2026` — and the
 * `$8,000.00` half of that same bug hid completely, because a currency format
 * made a wrong value look right.
 *
 * So: force the cell to text format BEFORE writing, write, read the display
 * back, and say plainly what the cell now holds rather than assuming.
 */
function alesievWriteCloseDate(auctionId, isoDate) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(TABS.metadata);
  if (!sheet) throw new Error('no tab named "' + TABS.metadata + '"');
  var values = sheet.getDataRange().getDisplayValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var idCol = header.indexOf('auctionId');
  var dateCol = header.indexOf('closeDate');
  if (idCol === -1 || dateCol === -1) {
    return 'closeDate NOT written: ' + TABS.metadata + ' has no ' +
      (idCol === -1 ? 'auctionId' : 'closeDate') + ' column.';
  }
  var outcomeCol = header.indexOf('outcome');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idCol]).trim() !== String(auctionId)) continue;
    var cell = sheet.getRange(r + 1, dateCol + 1);
    if (String(cell.getFormula() || '')) {
      return 'closeDate NOT written: that cell holds a FORMULA, so it computes itself. Left alone.';
    }
    cell.setNumberFormat('@');
    cell.setValue(isoDate);
    SpreadsheetApp.flush();
    var readBack = openIsoFromCell(cell.getDisplayValue());
    if (readBack !== isoDate) {
      return 'closeDate was written as "' + isoDate + '" but the cell now reads "' + cell.getDisplayValue() +
        '". Fix it by hand before publishing — daysToClose and Close Month will not compute from that.';
    }
    return 'closeDate set to ' + isoDate + '. Status and daysToClose recompute from it.' +
      alesievClearOutcome(sheet, r, outcomeCol, values[r]);
  }
  return 'closeDate NOT written: no row for auction ' + auctionId + ' in ' + TABS.metadata + '.';
}

/**
 * Clear a stale `outcome` beside the `closeDate` just written, and say so.
 *
 * **Writing `closeDate` is not what makes an auction Closed.** `Status` is
 * `IF(outcome<>"", outcome, IF(closeDate="", "Open", "Closed"))`, so a
 * left-behind `Pending` outranks the date and the row stays Pending — AND
 * trips `validate-prices.mjs` § 4, which errors on a Pending row carrying a
 * closeDate because an auction cannot have closed before it started. Every
 * auction `auctionOpen.gs` promotes before its opening day carries that cell,
 * so this is the common case rather than the exotic one. It cost the first
 * 2027 close a hand edit and a red publish check.
 *
 * Returns a sentence to append to the caller's report, always — a cell this
 * silently changed would be worse than the bug.
 *
 * The read-back is the same discipline `alesievWriteCloseDate` uses above, and
 * for the same reason: a value this pipeline round-trips through a sheet is
 * not the value it wrote.
 */
function alesievClearOutcome(sheet, rowIndex, outcomeCol, rowValues) {
  if (outcomeCol === -1) {
    return '\n\nNote: ' + TABS.metadata + ' has no "outcome" column, so nothing could be cleared. ' +
      'If Status does not read Closed after this, that column is why.';
  }
  var current = String(rowValues[outcomeCol] == null ? '' : rowValues[outcomeCol]).trim();
  if (!current) return '';
  if (!closeOutcomeClears(current)) {
    return '\n\nCAUTION: outcome still reads "' + current + '", which this script does not clear on its own. ' +
      'Status computes from outcome BEFORE closeDate, so the auction will not read Closed until you ' +
      'empty that cell yourself.';
  }
  var cell = sheet.getRange(rowIndex + 1, outcomeCol + 1);
  if (String(cell.getFormula() || '')) {
    return '\n\nCAUTION: outcome reads "' + current + '" but that cell holds a FORMULA, so it was left alone. ' +
      'Status will not read Closed until it stops returning a value.';
  }
  cell.clearContent();
  SpreadsheetApp.flush();
  var after = String(cell.getDisplayValue() || '').trim();
  if (after) {
    return '\n\nCAUTION: tried to clear outcome ("' + current + '") but the cell now reads "' + after +
      '". Clear it by hand — Status will not read Closed until you do.';
  }
  return '\n\noutcome was "' + current + '" and has been cleared, so Status now computes Closed from the ' +
    'closeDate. (A left-behind "' + current + '" is a hard error at the PR gate, not just a wrong label.)';
}

/**
 * Show the contextItems block in a copyable box AFTER a dry run.
 *
 * On a real import those rows are written, not pasted — this source names every
 * augment individually, which is what makes writing them safe. The box is here
 * so a dry run can be checked, and so a failed import still hands over what it
 * had worked out.
 */
function alesievShowContext(plan, target) {
  var text = alesievContextWorksheetText(plan, target);
  var unknown = plan.unresolved ? contextWorksheetText(plan, target) : '';
  if (!text && !unknown) return;
  var esc = function (t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var html = '<div style="font:13px/1.5 Arial,sans-serif">';
  if (text) {
    html += '<p>The <b>contextItems</b> rows this export produces. On a real import they are ' +
      '<b>written for you</b> — the site names every augment individually, unlike a forum file. ' +
      'This box is here so a dry run can be checked. A <code>withheld</code> row carries ' +
      '<b>no price</b>: the workbook computes that figure from live sales.</p>' +
      '<textarea readonly style="width:100%;height:9em;font:12px monospace" onclick="this.select()">' +
      esc(text) + '</textarea>';
  }
  if (unknown) {
    html += '<p style="margin-top:1em">These lots resolved to no token in any season, so nothing was ' +
      'imported for them. Fill in <code>category</code>, check the quantities, then paste into ' +
      '<code>contextItems</code>.</p>' +
      '<textarea readonly style="width:100%;height:7em;font:12px monospace" onclick="this.select()">' +
      esc(unknown) + '</textarea>';
  }
  html += '</div>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(720).setHeight(430),
    'Context items');
}

// Lets Node load the pure functions for testing; Apps Script has no `module`.
if (typeof module !== 'undefined') {
  module.exports = {
    alesievUnquote: alesievUnquote,
    alesievStripLotMarker: alesievStripLotMarker,
    alesievGoldBar: alesievGoldBar,
    alesievNormaliseName: alesievNormaliseName,
    alesievRoute: alesievRoute,
    alesievContextKey: alesievContextKey,
    alesievContextRule: alesievContextRule,
    alesievIsFeeName: alesievIsFeeName,
    alesievFindColumn: alesievFindColumn,
    alesievReadStaging: alesievReadStaging,
    alesievOnyxRows: alesievOnyxRows,
    alesievWithheldRows: alesievWithheldRows,
    alesievAugmentRows: alesievAugmentRows,
    alesievNamedContextRows: alesievNamedContextRows,
    alesievAggregateBreakdown: alesievAggregateBreakdown,
    alesievPlanImport: alesievPlanImport,
    alesievDescribePlan: alesievDescribePlan,
    alesievCloseDateProblem: alesievCloseDateProblem,
    alesievClearOutcome: alesievClearOutcome,
    alesievContextWorksheetText: alesievContextWorksheetText,
    alesievSiteAuctions: alesievSiteAuctions,
    alesievPickerList: alesievPickerList,
    alesievPickerLine: alesievPickerLine,
    ALESIEV_CONTEXT_RULES: ALESIEV_CONTEXT_RULES,
    ALESIEV_FEE_NAMES: ALESIEV_FEE_NAMES,
    ALESIEV_AUGMENT_CATEGORIES: ALESIEV_AUGMENT_CATEGORIES,
    ALESIEV_IGNORED_HEADERS: ALESIEV_IGNORED_HEADERS,
    ALESIEV_STAGING_TAB: ALESIEV_STAGING_TAB,
    ALESIEV_VERSION: ALESIEV_VERSION,
  };
}
