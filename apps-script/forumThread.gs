/**
 * Phase 5 (part two) — forum close from the THREAD.
 *
 * Part one reads a per-lot spreadsheet an auctioneer hands over. Most of them
 * hand over nothing: the results are posted in the thread, usually edited into
 * post #1 after the auction closes, in whatever shape that auctioneer likes.
 * This file reads that.
 *
 * It is an ASSISTANT, not an importer, and the distinction is load-bearing.
 * `trentClose.gs` aborts on anything it cannot resolve because a Trent file is
 * a machine's output and an unknown name there means something is wrong. A
 * thread is prose. Something will always be unrecognised, and refusing to
 * proceed would mean refusing on every auction. So this file writes a REVIEW
 * TAB instead of writing prices: every proposal carries the distribution it
 * came from, every line it could not read is listed rather than dropped, and
 * the operator approves rows.
 *
 * MEASURED against 24 real threads spanning 20 auctioneers (see
 * `fixtures/forum-threads/`), replayed by `npm run test:thread`:
 *
 *   - **Twenty-three line grammars, not the four the plan expected**, across
 *     twenty-two auctioneers. Several use more than one inside a single post,
 *     and three of them — Casey Wren above all — write a different shape in
 *     each of their auctions, so the count grows with the corpus rather than
 *     converging on it. Assume the next auctioneer needs a new one.
 *   - **The results are not always in post #1.** Casey Wren and jpotter put
 *     them in post #2. But post #1 wins whenever it carries any, because Mike
 *     Steele reposts his whole table as a bid update and the biggest copy is a
 *     mid-auction snapshot — see threadPlan.
 *   - **Quantity-weighted mode reproduces `prices.csv`**, and Trent's min/max
 *     does not: across the corpus the mode matches 331 of 358 recorded items
 *     against 271 for min and 249 for max. That is the shape of the recorded
 *     data too — 170 of 178 forum auctions carry exactly ONE row per item,
 *     where Trent auctions carry a min/max pair.
 *   - **Ties are a coin flip and must not be decided silently.** §4 of the plan
 *     calls ties-low settled. It is not: of the ties measured against recorded
 *     prices, 8 resolve low, 5 resolve high, and one lands on the midpoint ($16
 *     and $17 recorded as $16.50). So a tie is FLAGGED, both candidates are
 *     shown, and the operator picks. This is the one place the assistant
 *     refuses to guess.
 *   - **A money-formatted column is not necessarily the price.** AlanP's table
 *     is headed `item name | Buy It Out | Bid | Bidder/Buyer Name`: the
 *     `$`-formatted column is a buy-it-now price identical down the whole
 *     table, and the winning bid is the bare column beside it. Reading the
 *     money column scored 6 of that auction's items; reading the header scores
 *     14. This is part one's "`Number` is a lot number, not a price" again, and
 *     the answer is the same: read the header, never the formatting.
 *
 * Shares one global scope with the other three .gs files, so `stripDecorations`,
 * `parseQuantity`, `stripOnyxMarker`, `buildTokenIndex`, `resolveToken`,
 * `roundCents` and `forumClose.gs`'s header aliases are all in scope here and
 * are used unchanged. Every global below is prefixed `THREAD_`/`thread`.
 */

var THREAD_VERSION = '2026-08-26.3';

/** Where proposals land for approval. Never written to by anything else. */
var THREAD_REVIEW_TAB = 'forumThreadReview';

/** Kunena serves 12 posts to a page. Used only to walk `&start=`. */
var THREAD_PAGE_SIZE = 12;

/** Refuse to walk past this. The longest thread in the corpus has 14 pages. */
var THREAD_MAX_PAGES = 30;

var THREAD_REVIEW_COLUMNS = [
  'Approve?', 'kind', 'Item', 'Display Name', 'Category', 'Price',
  'lots', 'quantity', 'distribution', 'flag', 'source line',
];

/**
 * Column headers that name a price which is NOT what an item sold for.
 *
 * `Buy It Out` is the measured case — AlanP's table carries it money-formatted
 * beside a bare `Bid` column, and it is the same number on every row of an
 * item. `Average Bid` is part one's refusal, kept here because a thread can
 * carry a pasted pivot just as a file can. The rest are the openings, not the
 * closings: a minimum bid is what the auctioneer would accept, not what anyone
 * paid.
 */
var THREAD_NEVER_PRICE_HEADERS = [
  'buy it out', 'buy it now', 'buyout', 'buy out',
  'average bid', 'average', 'avg bid', 'avg', 'mean bid',
  'min bid', 'minimum bid', 'min', 'minimum', 'starting bid', 'start bid',
  'opening bid', 'reserve', 'increment', 'bid increment',
];

/** Column headers that DO name what an item sold for. */
var THREAD_PRICE_HEADERS = [
  'bid', 'current bid', 'high bid', 'highest bid', 'winning bid', 'winner bid',
  'amount', 'price', 'sold', 'final bid', 'winning amount',
];

/** Column headers naming the item. */
var THREAD_NAME_HEADERS = [
  'item', 'item name', 'auction item', 'token', 'name', 'product name', 'description',
];

/** Column headers naming the buyer — never a price, never the item. */
var THREAD_BUYER_HEADERS = [
  'bidder', 'high bidder', 'winner', 'bid holder', 'bidder name',
  'bidder/buyer name', 'buyer', 'winning bidder', 'pseudonym',
];

/**
 * Column headers naming a lot NUMBER — an identifier, never a count.
 *
 * Part one's finding, in a thread instead of a file: reading `Number` as a
 * price put a $1 floor under every item, and reading it as a quantity would
 * say Wade S sold `4th Tooth` eight times over in lots of 1..8. Recognising
 * these keeps them from being mistaken for either.
 */
var THREAD_LOT_NUMBER_HEADERS = ['#', 'no', 'no.', 'number', 'lot', 'lot #', 'item #'];

/** Column headers naming an actual count of tokens. */
var THREAD_QUANTITY_HEADERS = ['qty', 'quantity', 'count', 'amount won', 'tokens'];

/**
 * Section headers that change where a line's lots are routed.
 *
 * `NON-8K STUFF` is the one that matters, and it used to route to a `drop`
 * kind that discarded its lots. The reasoning was that `20222` recorded none
 * of them — but "not recorded" was the state of a season nobody had backfilled
 * yet, not a decision, and reading intent from missing data was the error.
 * They are exactly what `contextItems` is for: the maintainer confirmed it,
 * and the same names are already recorded as context for other auctions —
 * `Ioun Stone Gold Nugget`, `Charm of the Faerie`, `+4 Rod of the Meek` and
 * eight `Folio` rows among them.
 *
 * `offorder` SCOPES and `context` does not, which is the whole reason they are
 * two kinds. "Not part of the 8K order" is a categorical statement about every
 * lot beneath it, so those lots go to `contextItems` whether or not their names
 * resolve — otherwise a personal sale of a current-season token lands in the
 * price spine, which is what dropping them was really guarding against. An
 * `Augmented Tokens:` heading claims nothing of the sort and must stay
 * advisory; see threadResolveLots for the 159-lot reason.
 */
var THREAD_SECTIONS = [
  { re: /^\W*non[\s-]*8\s*k\b|^\W*(not|nothing) (part of|in) the 8\s*k|^\W*personal (sale|stuff|items)/i, kind: 'offorder' },
  // "ONYX ITEMS" (Utaku) and "Onyx URs (16)" (Flik). NOT "Standard Onyx 8k
  // Items", which is Flik's heading for the ORDINARY tokens in an Onyx
  // auction — the word onyx there describes the order, not the tokens, and
  // routing them to onyx.csv would move Wish Ring and the Patron Pin out of
  // the price spine.
  { re: /^\W*onyx\s+(items?|tokens?|urs?|ultra\s*rares?)\b|^\W*onyx\s*:/i, kind: 'onyx' },
  { re: /^\W*augment(ing|ed)?\s*(tokens|items)?\s*[:\-]?\s*$|^\W*grunnel('s)?\s*(items|augments)/i, kind: 'context' },

  // "Augmented Ultra Rares:" and "Super Special Relics:"   Kusig.
  //
  // These SCOPE, where the advisory `Augmented Tokens:` above deliberately does
  // not, and the difference is what the heading NAMES. Mike Steele heads his
  // entire 159-lot results table `Augmented Tokens:` with nothing closing it, so
  // scoping on that form costs 16 reproduced items and buys nothing. A heading
  // that names a TIER is different: it introduces a handful of the auctioneer's
  // own tokens and is always followed by another heading.
  //
  // It has to scope, because in an Onyx auction these lots resolve perfectly
  // well. 202346's `Onyx:` section ran to the bottom of the post — neither of
  // these headings closed it — so Kusig's nine augments were proposed as ONYX
  // rows: 28 against the 21 recorded. Four of the 21 came out at the augment's
  // price rather than the Onyx lot's, because both lots resolve to one name and
  // the augment was cheaper — `+2 Sun Scimitar` at $51 against a recorded $67,
  // `Cloak of Retribution` $42 against $61, `Gauntlets of Divine Guidance` $46
  // against $61. Wrong numbers in onyx.csv, and nothing downstream can see them.
  //
  // The tier vocabulary is deliberately narrow, and `tokens|items` must stay out
  // of it or Mike Steele's heading matches here instead of above.
  { re: /^\W*augment(ing|ed)?\s+(ultra\s*rares?|urs?|relics?|legendar(y|ies))\b/i, kind: 'offorder' },
  { re: /^\W*(super\s+)?special\s+relics?\b/i, kind: 'offorder' },
];

/**
 * Headings that END whatever section is open, without opening one.
 *
 * Without this an `ONYX ITEMS` heading runs to the bottom of the post and the
 * trade goods beneath it are routed to `onyx.csv`: 20231 proposed 33 Onyx rows
 * against 21 recorded and lost eleven prices from the spine. A section has to
 * be closable, and the only thing that closes it in these posts is the next
 * heading.
 *
 * Two shapes qualify. A heading from this short vocabulary — the words
 * auctioneers actually use to divide a post — and any ALL-CAPS heading of two
 * or more words, which is how the older posts mark every division. One word is
 * not enough: `PYP` is all caps and is an item, not a section.
 */
var THREAD_SECTION_END_RE = new RegExp(
  '^\\W*(trade goods|pre-?order|special items|8\\s*k special|bonus items?|' +
  'marks and rings|ultra rares?|standard\\b.*\\bitems|8\\s*k\\b.*\\bitems)\\b', 'i');

/**
 * Lines that carry a price and are not a lot: the running total, the funding
 * percentage, the shipping line. Every results post ends with two or three of
 * them, and without this they arrive as context candidates called
 * "Current total" and "Free Shipping".
 */
var THREAD_NOT_A_LOT_RE = /^(grand\s+)?(current\s+)?(running\s+)?(total|totals|subtotal|percent|percentage|funding|goal|free shipping|shipping|remaining|to go|left to fund)\b/i;

/** kurtreznor's `ONYX or PYP` marker. See threadResolveLots for what it means. */
var THREAD_ONYX_OR_PYP_RE = /\bonyx\s*(or|\/)\s*pyp\b/i;

/**
 * The bags of random Rares and Uncommons a CONDENSED order includes.
 *
 * A Condensed auction sells two things a Super or Ultra Condensed one does not:
 * a bag of 120 random Rares and a bag of 240 random Uncommons. `tokenMetadata`
 * has carried them for every season since 2012 under their own Category,
 * `Condensed`, and every auctioneer spells them differently — NINE spellings
 * across the eight recorded Condensed auctions:
 *
 *   Bag of 120 random Rare tokens (rares only) #1-8    Matthew Hayward, Edwin
 *   Bag of 240 random Uncommon tokens #1-8
 *   8 x 120 Random Rare bag                            Cliff
 *   120 Rare 2021 Token Bag (8)                        Casey Wren
 *   Bag of 120x Rare Tokens                            Matt Soto
 *   8 bags of 120 rares (no Urs)                       Laz
 *   120x Random Rare                                   Nick Braun
 *
 * TWO of those nine also break the quantity rule, which is the part that
 * matters. `120x Random Rare` reads as a lot of 120 and `8 x 120 Random Rare
 * bag` as a lot of 8, so a $65 bag is divided down to $0.54 or $8.13 — a
 * plausible-looking trade-good price, in the price spine, with nothing to say
 * it is wrong. The number in a bag's name is its CONTENTS, exactly as the `4`
 * in `Path to Enlightenment (Fragment 4)` is the fragment: identity, not count.
 * So a bag never divides.
 *
 * Detection is deliberately loose on the noun and strict on the trigger: the
 * name must mention a bag or one of the two counts before either tier word is
 * read at all. Without that trigger `Proof set of 2018 Onyx Common/Uncommon/
 * Rare Tokens` and `Set of 2021 Rare Class Neck Items` would both be swept up,
 * and both are real lots from these same threads.
 */
// `120x?` rather than `120`, because `\b120\b` does not match `120x` — there is
// no word boundary between a digit and a letter. The two spellings that need
// this most are the two that also break the quantity rule.
var THREAD_BAG_TRIGGER_RE = /\bbags?\b|\b(?:120|240)x?\b/i;
var THREAD_BAG_UNCOMMON_RE = /\buncommons?\b|\bUC\b/i;
var THREAD_BAG_RARE_RE = /\brares?\b/i;
var THREAD_BAG_ULTRA_RE = /\bultra[\s-]*rares?\b|\bUR\b|\bPYP\b/i;

/**
 * A Treasure Draw is three Treasure Chips *(confirmed by the maintainer,
 * 2026-08-24)*, and every one of the 19 occurrences in the 2022 season writes
 * it `3x Treasure Draws`.
 *
 * So the `3x` and "a draw is three chips" are THE SAME FACT WRITTEN TWICE, and
 * the quantity rule has already applied it: $6.00 with a lot size of 3 gives
 * the $2.00 the sheet records. Multiplying by three again would divide to
 * $0.67 — this function exists to make sure that does not happen, and to cover
 * the bare spelling if one ever appears.
 *
 * Returns the lot size a Treasure Draw name implies, or 0 when the name is not
 * one. `trentClose.gs` reaches the same conclusion the same way for
 * `1,000 GP Gold Bar x4 #1 (4 Tokens)`, which is 4 tokens and not 16.
 */
function threadDrawLotSize(name, alreadyStated) {
  if (!/treasure draws?/i.test(String(name == null ? '' : name))) return 0;
  return alreadyStated > 1 ? alreadyStated : 3;
}

/**
 * CONSOLIDATED GOLD DIVIDES, ALWAYS — the number in the name is the lot size.
 *
 * A `5K Mithral Bar` is five 1,000 GP Gold Bars and a `25K Eldritch Ore Bar` is
 * twenty-five, so `25K Eldritch Ore Bar - $230` is 25 bars at $9.20. The
 * maintainer's rule *(2026-08-25)*: **treat these with the same heuristic as any
 * other trade good — 25K bar price ÷ 25 is the 1,000 GP Gold Bar price.**
 *
 * That REPLACES the earlier "an exact multiple means repackaging, under it means
 * a separate sale" reading, which made the arithmetic decide whether the lot was
 * gold at all. It no longer does: the name decides, and the price is whatever it
 * divides to. 20242 records $9.20 and 20244 $9.60 on exactly this basis, both
 * from a 25K bar priced below the auction's other gold.
 *
 * It also fixes a latent misread that predates any of this. `25,000 GP Reserve
 * Bar` already resolved to `1,000 GP Gold Bar` through the `reserve bar`
 * fallback but kept a lot size of ONE, so 202349's distribution read
 * `44 @ $13, 1 @ $250` — a single two-hundred-and-fifty-dollar gold bar sitting
 * in the spine. The mode saved that auction and would not save the next one.
 *
 * `> 1` because `1,000 GP Gold Bar` and `1k Gold Reserve Bar` are the bar
 * itself and must not divide by one thousand or by one. The gold word is
 * required and matched on word boundaries, so `Crowbar` and `Golden Fleece` are
 * out of reach.
 */
var THREAD_GOLD_WORD_RE = /\b(bar|mithral|mithril|eldritch|ore|reserve|gold|gp)\b/i;

/**
 * The auction styles whose gold is counted against 44 or 45 — every one that
 * says Super or Ultra, including `Onyx Super Condensed` and the lone
 * `Safehold Onyx Super Condensed`. A plain `Condensed` or `Onyx Condensed`
 * order follows a different rule set and is deliberately left out; see the check
 * itself in threadPlan for what is and is not known about it.
 */
var THREAD_GOLD_COUNTED_RE = /(super|ultra)\s+condensed/i;
function threadGoldBarSize(name) {
  var s = String(name == null ? '' : name);
  if (!THREAD_GOLD_WORD_RE.test(s)) return 0;
  var k = s.match(/(?:^|[^\w])(\d[\d,]*)\s*k\b/i);
  var gp = s.match(/(?:^|[^\w])(\d[\d,]*)\s*gp\b/i);
  var n = k ? Number(String(k[1]).replace(/,/g, ''))
    : gp ? Number(String(gp[1]).replace(/,/g, '')) / 1000 : 0;
  return n > 1 && n === Math.round(n) ? n : 0;
}

/** `'Rare Bag'`, `'Uncommon Bag'`, or null. */
function threadBagName(name) {
  var s = String(name == null ? '' : name);
  if (!THREAD_BAG_TRIGGER_RE.test(s)) return null;
  if (THREAD_BAG_ULTRA_RE.test(s)) return null;
  if (THREAD_BAG_UNCOMMON_RE.test(s)) return 'Uncommon Bag';
  if (THREAD_BAG_RARE_RE.test(s)) return 'Rare Bag';
  return null;
}

/** BBCode the forum leaks into rendered text — `[/size]`, `[b]`, `[color=#fff]`. */
var THREAD_BBCODE_RE = /\[\/?[a-z][a-z0-9]*(=[^\]]*)?\]/gi;

/**
 * Sentences worth quoting back as WITHHELD candidates.
 *
 * Deliberately loose, and deliberately quoted rather than parsed. The real hits
 * in the corpus are phrased six different ways — "I am keeping the 9-10 random
 * URs, 2 OE and 2 EB out", "Everything except the random URs and GT are
 * available", "will not be included in the auction", "If an item is not listed,
 * I am keeping it for myself", "I am keeping nothing!" — and the quantities are
 * sometimes ranges. No rule reads all of those correctly, and a rule that got
 * one wrong would put a wrong negative number in `contextItems`. So the
 * assistant surfaces the sentence and its post number and the operator writes
 * the row. `-(season average) × quantity` is the sheet's job either way.
 */
var THREAD_WITHHELD_RE = new RegExp(
  '\\b(keeping|kept|holding back|holding out|withheld|withhold(ing)?|' +
  'not (be )?(includ|auction|sell)|will not be included|excluded|' +
  'everything except|all except|except (for )?the|other than the)\\b', 'i');

/** Phrases that are about bidding, not about withholding. */
var THREAD_WITHHELD_NOISE_RE = /\b(keep (the )?(bid|bids|it up|going|track|in mind)|keeping (bidder|people|track)|keep this|winning bid)\b/i;

/**
 * Phrases that mark the auction as over.
 *
 * MEASURED, and the measurement is why this produces EVIDENCE rather than a
 * proposed date. Across the 24 threads a bracket built from these phrases
 * contains the recorded `closeDate` 7 times, misses it by 1-24 days 8 times
 * (almost always LATE — the announcement trails the close), and finds no
 * signal at all in 9. The plan's two worked examples both land (202342
 * brackets to Feb 23-27 against a recorded Feb 25; 202647 lands exactly on
 * the funding post) — but two of twenty-four is not a rule.
 *
 * The single most useful thing here is not the bracket at all: it is that a
 * closing phrase in POST #1 dates nothing, because post #1 is edited in place
 * after the close and keeps the thread's OPEN timestamp. kurtreznor's post #1
 * says "AUCTION IS CLOSED!" and is stamped 16 days before the auction closed.
 * Excluding post #1 moved two threads from wrong to right and moved none the
 * other way.
 */
var THREAD_CLOSING_RE = new RegExp(
  '(auction is (now )?closed|funded\\s*(&|and)\\s*closed|now funded and closed|' +
  'we have funded|order (has been |have been )?placed|orders? placed|' +
  'tokens (have been )?ordered|bids are finali[sz]ed|' +
  'auction (is )?(complete|successful)|fully funded)', 'i');

// ===========================================================================
// Pure reading — HTML to posts
// ===========================================================================

/** Entities, including the curly quotes threads are full of. */
function threadDecodeEntities(text) {
  return openDecodeEntities(text);
}

/**
 * One post's HTML to text, with TABS PRESERVED.
 *
 * `openHtmlToText` collapses every run of whitespace, which is right for
 * Trent's page and fatal here: several auctioneers paste a tab-separated table
 * straight out of a spreadsheet — a whole parse path of its own, see
 * threadTableLot — and collapsing the tabs merges the columns into an
 * unreadable run. Table cells are joined with a tab for the
 * same reason — Nick Braun's results are a real `<table>`, and without a
 * separator `2019 Orb of Dragonkind` `1` `+$5.00` `$605` `maelios` arrives as
 * one word.
 */
/**
 * A TABLE ROW IS ONE TAB-SEPARATED LINE, whatever the cells contain.
 *
 * `</td><td>` becomes a tab below, which is enough while a cell holds bare
 * text. alesiev centres his — `<td><div class="bbcode_center">$41</div></td>` —
 * and the `</div>` emits a newline BEFORE the tab, so his seven-column table
 * arrived as one cell per line with the tabs stranded on blank lines. Every one
 * of 202543's 21 items was unreadable and 119 lines went to `unparsed`: the
 * table reader never saw a row, and no line grammar can read a column.
 *
 * So the row is flattened here, structurally, rather than met with a grammar —
 * the shape is HTML, not an auctioneer's habit, and the reader downstream
 * already knows what to do with a tab-separated row. Cell markup collapses to
 * spaces, which is what a cell means; the `</td><td>` rule below still covers a
 * table written without `<tr>`.
 */
function threadFlattenRows(html) {
  return String(html).replace(/<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi, function (all, row) {
    var cells = [], cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]\s*>/gi, c;
    while ((c = cellRe.exec(row)) !== null) {
      cells.push(c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').replace(/^ | $/g, ''));
    }
    return cells.length ? '\n' + cells.join('\t') + '\n' : all;
  });
}

function threadHtmlToText(html) {
  var text = threadFlattenRows(String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' '))
    .replace(/<\/t[dh]\s*>\s*(?=<t[dh])/gi, '\t')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|table|section|article|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  text = threadDecodeEntities(text).replace(THREAD_BBCODE_RE, '');
  var lines = text.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    // Spaces and non-breaking spaces collapse; tabs survive.
    var line = lines[i].replace(/[  ]+/g, ' ').replace(/\s+$/, '').replace(/^ +/, '');
    out.push(line);
  }
  return out.join('\n');
}

var THREAD_MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** `07 Aug 2026 19:46` to `{ date: '2026-08-07', time: '19:46' }`. */
function threadPostStamp(title) {
  var m = String(title == null ? '' : title).match(/^(\d{1,2})\s+(\w{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/);
  if (!m) return { date: null, time: null };
  var mon = THREAD_MONTHS[m[2].toLowerCase()];
  if (!mon) return { date: null, time: null };
  return { date: m[3] + '-' + mon + '-' + (m[1].length === 1 ? '0' + m[1] : m[1]), time: m[4] || null };
}

/**
 * Every post on one page: `{ num, author, date, time, text }`.
 *
 * The three lists are read separately and zipped by position rather than by
 * slicing each post's markup out, because Kunena nests the profile block and
 * the message block in sibling table cells and there is no single element that
 * contains both. Position is reliable: the page emits one of each per post, in
 * order. A page that yields different counts is reported rather than guessed
 * at — see `threadPageProblems`.
 */
function threadPosts(html) {
  var source = String(html == null ? '' : html);
  var out = [], m;

  var stamps = [];
  var headerRe = /<span class="kmsgdate[^"]*"[\s\S]{0,80}?title="([^"]*)"[\s\S]*?rel="canonical">#(\d+)<\/a>/g;
  while ((m = headerRe.exec(source)) !== null) stamps.push({ title: m[1], num: parseInt(m[2], 10) });

  var authors = [];
  var authorRe = /<li class="kpost-username">\s*<strong>\s*<a [^>]*>([^<]*)<\/a>/g;
  while ((m = authorRe.exec(source)) !== null) authors.push(threadDecodeEntities(m[1]).replace(/\s+/g, ' ').trim());

  var bodies = [];
  var bodyRe = /<div class="kmsgtex">([\s\S]*?)<\/div>\s*(?:<div class="kmsgsignature">|<\/div>)/g;
  while ((m = bodyRe.exec(source)) !== null) bodies.push(threadHtmlToText(m[1]).replace(/^\n+|\n+$/g, ''));

  for (var i = 0; i < bodies.length; i++) {
    var stamp = threadPostStamp(stamps[i] ? stamps[i].title : null);
    out.push({
      num: stamps[i] ? stamps[i].num : i + 1,
      author: authors[i] || '',
      date: stamp.date,
      time: stamp.time,
      text: bodies[i],
    });
  }
  return out;
}

/** Counts that should agree, so a page shape change is visible rather than silent. */
function threadPageProblems(html) {
  var source = String(html == null ? '' : html);
  var count = function (re) { var n = 0; while (re.exec(source) !== null) n++; return n; };
  var stamps = count(/<span class="kmsgdate[^"]*"[\s\S]{0,80}?title="[^"]*"[\s\S]*?rel="canonical">#\d+<\/a>/g);
  var bodies = count(/<div class="kmsgtex">/g);
  var problems = [];
  if (!bodies) problems.push('no post bodies found — the page markup has changed, or this is not a topic page');
  else if (stamps !== bodies) problems.push('found ' + bodies + ' post bodies but ' + stamps + ' timestamps');
  return problems;
}

/** The `&start=` values this thread paginates over, `[0]` for a single page. */
function threadPageStarts(html) {
  var starts = { 0: true }, m;
  var re = /start=(\d+)/g;
  while ((m = re.exec(String(html == null ? '' : html))) !== null) {
    var n = parseInt(m[1], 10);
    if (n % THREAD_PAGE_SIZE === 0 && n / THREAD_PAGE_SIZE < THREAD_MAX_PAGES) starts[n] = true;
  }
  var out = [];
  for (var k in starts) if (starts.hasOwnProperty(k)) out.push(parseInt(k, 10));
  out.sort(function (a, b) { return a - b; });
  // Kunena links the pages it can reach from here; fill the gaps so a long
  // thread that elides the middle ("1 2 3 ... 14") is still walked whole.
  var full = [];
  for (var s = 0; s <= out[out.length - 1]; s += THREAD_PAGE_SIZE) full.push(s);
  return full;
}

// ===========================================================================
// Pure reading — a line to a lot
// ===========================================================================

function threadMoney(text) {
  return Number(String(text).replace(/[$,\s]/g, ''));
}

/**
 * The line grammars, most specific first. Each returns
 * `{ item, quantity, price, buyer }`; a null `item` means "the item is the
 * section header above this line".
 *
 * Order is the whole design. `Golden Ticket - $875 Dragon` and
 * `#1-3 : Lich - $100` both end in a dash and a price, and only trying the
 * narrower shape first tells them apart.
 */
var THREAD_RULES = [
  // "16 @ $7.50 - Bidder #4"     Matt Soto (44 auctions), Utaku, Edwin
  { id: 'qty-at-price', re: /^(\d+)\s*@\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–]\s*(.+)$/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), price: threadMoney(m[2]), buyer: m[3] }; } },

  // "21 @ $95 BAST"              Tyler — the same shape with the dash dropped.
  //
  // He uses the dashed form everywhere else in 20233, and drops it for his PYP
  // block alone, which is five lots and $3,230 of a $7,500 auction. Tried after
  // the dashed rule, so it only ever sees lines that one refused, and it demands
  // the `$` and a buyer starting with a letter — without that it would reach for
  // Laz's `2 @ 40$ 012`, where the trailing number is a bidder id and the rule
  // below owns it.
  { id: 'qty-at-price-buyer', re: /^(\d+)\s*@\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s+([A-Za-z].*)$/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), price: threadMoney(m[2]), buyer: m[3] }; } },

  // "1 @$310 #007"               Laz — the buyer is a NUMBER, not a name, and
  // the formatting is inconsistent in every way it can be: `2@$35 #018`,
  // `2@40$  012` with the dollar sign AFTER the price, `8@82 001` with none at
  // all, `17  @$.25 #006` with no leading zero, and the `#` optional. All of it
  // is one shape once the noise is allowed for. Anchored to end on the id so it
  // cannot read a trailing quantity as a buyer.
  { id: 'qty-at-price-id',
    re: /^(\d+)\s*@\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?|\.\d{1,2})\s*\$?\s*#?\s*(\d{2,4})\s*$/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), price: threadMoney(m[2]), buyer: '#' + m[3] }; } },

  // "#1-3 : Lich - $100"         Matthew Hayward — a LOT RANGE, not a quantity
  { id: 'lot-range', re: /^#(\d+)(?:\s*[-–]\s*(\d+))?\s*:\s*(.+?)\s*[-–]\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)$/,
    take: function (m) {
      return { item: null, quantity: m[2] ? (parseInt(m[2], 10) - parseInt(m[1], 10) + 1) : 1,
        price: threadMoney(m[4]), buyer: m[3] };
    } },

  // "(3) Lanfear====@ $105 each" Lord Brian
  //
  // `=+\s*@`, not `=+@`: he does not keep the rule-off run tight against the
  // `@`, and roughly a third of his lines carry a space there — `(1) Perrin===
  // @ $ 15.00 each`. Demanding they touch cost 202211 seven of its 23 items,
  // and silently, because a bid line no grammar reads used to be taken for a
  // section header (see threadLooksLikeHeader).
  // Steve writes the same shape three looser ways, and every one of them costs
  // a whole item because his post gives each item exactly one or two lines:
  //
  //   (8) Hermione==========.25     no `@` at all, and no leading zero
  //   (17)Nymphadora=========1.00   no `@`
  //   (10Moody=========@12.00       the closing paren simply missed
  //
  // So the `@` is optional, `.25` is a price, and the `)` may be absent. The
  // `=`-run is what makes this a bid line rather than prose and it is still
  // required, which is what keeps the relaxations safe. Between them these three
  // accounted for `3 Star`, `PCH` and `Preorder Bonus` in 202325, plus 10 of the
  // 44 gold bars — a quantity the weighted mode votes with.
  { id: 'qty-buyer-rule', re: /^\((\d+)\)?\s*(.*?)\s*=+\s*@?\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?|\.\d{1,2})/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), price: threadMoney(m[3]), buyer: m[2] }; } },

  // "Perrin =@ $ 200"            Lord Brian — one bidder took the whole lot, so
  // he drops the quantity parenthetical entirely. Anchored on a letter so it
  // cannot take the `(N) ...` lines the rule above owns, and it still demands
  // the `=`-run-then-`@` that makes this his format rather than prose.
  //
  // The `$` is optional because Steve omits it, and a ONE-OF-ONE lot is exactly
  // where he drops the parenthetical too — his premium items are written
  // `Dumbledore========@575.00` under a `Path of Enlightenment Fragment`
  // heading. That is 202325's `8k Bonus`, `Wish Ring` and `Patron Pin`: three
  // items, $1,265, and the three most valuable lots in the auction.
  //
  // The `@` is optional for the same reason it is optional in the rule above —
  // he drops it about a third of the time, and in his `Augmented items` block he
  // drops it every time: `Luna==========65.00`, `Viktor============80.00`. The
  // `=`-run remains mandatory and is what keeps this off prose. Anchoring on the
  // end of the line does the rest.
  { id: 'buyer-equals-price', re: /^([A-Za-z][^=]*?)\s*=+\s*@?\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?|\.\d{1,2})\s*$/,
    take: function (m) { return { item: null, quantity: 1, price: threadMoney(m[2]), buyer: m[1] }; } },

  // "Mark of the 1st Tenet (1) - Gortash $85"   WM13 — buyer middle, price last
  //
  // The dash is OPTIONAL because Fred K writes the same shape without one:
  // `AG Buttons (1) Wilem $0.25` is 202415's whole `Adventurers' Guild Button`
  // row. What keeps that relaxation safe is the buyer group, which must now
  // open on a LETTER: dropping the dash alone let Casey Wren's
  // `- Anton (1) $780` match with the SPACE before the price as its buyer and
  // `- Anton` as its item, which cost four of his threads every price they had
  // — 668 corpus items down to 600. A buyer field that can be blank is not a
  // buyer field.
  { id: 'item-qty-buyer-price',
    re: /^(.*?[A-Za-z].*?)\s*\((\d+)\)\s*[-–]?\s*([A-Za-z][^$]*?)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: parseInt(m[2], 10), price: threadMoney(m[4]), buyer: m[3] }; } },

  // "Ring of the 5th Circle (2) - Hank @ 75"   Josh M — buyer then `@` then a
  // price with NO dollar sign. Nothing else in this post varies; the missing
  // `$` alone is why 202216 read 0 of 23.
  { id: 'item-qty-buyer-at-price',
    re: /^(.*?[A-Za-z].*?)\s*\((\d+)\)\s*[-–—]\s*([^@]*?)\s*@\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: parseInt(m[2], 10), price: threadMoney(m[4]), buyer: m[3] }; } },

  // "Elven Bismuth (12) - Alfira 9.25"   WM13 — the same shape as
  // `item-qty-buyer-price` above with the `$` left off, on ONE line of a post
  // whose other twenty-one carry it. Auctioneers are not consistent with
  // themselves, and the cost of the omission is not the line: with no rule for
  // it, `Elven Bismuth (12) - Alfira 9.25` carries no `$` and no `@`, so the
  // price guard in threadLooksLikeHeader does not see a price either and the
  // line becomes the SECTION HEADING — the renaming failure, from a missing
  // dollar sign.
  //
  // Kept as a separate rule rather than by making the `$` optional above,
  // because the dash is what makes it safe: with the buyer required to start
  // with a letter and the number anchored to the end of the line, it cannot
  // reach `(1) $105 - Cinder`, `(1) - .$140 - Jo` or `(1) - $175.00 Abert`,
  // all of which the rules around it read.
  { id: 'item-qty-buyer-bare-price',
    re: /^(.*?[A-Za-z].*?)\s*\((\d+)\)\s*[-–—]\s*([A-Za-z][^$]*?)\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: parseInt(m[2], 10), price: threadMoney(m[4]), buyer: m[3] }; } },

  // "Wish Ring (1) - $175.00 Abert"   Beertram, Ralykam, Wade S from 2025
  // "Ioun Stone Platinum Nugget (1) $105 - Cinder"   Beertram — no dash between
  // the quantity and the price, where `item-qty-price` below requires one. He
  // writes both shapes in ONE section: 202331's `AUGMENTATION` block opens with
  // `Greater Ring of Havoc (1) - $265 - Felurian` and then drops the dash for
  // the next four lines. Demands the `$` and the dash before the buyer, so it
  // cannot reach for a bare `(1) 175 Abert`.
  { id: 'item-qty-price-dash-buyer',
    re: /^(.*?[A-Za-z].*?)\s*\((\d+)\)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–—]\s*([A-Za-z].*)$/,
    take: function (m) { return { item: m[1], quantity: parseInt(m[2], 10), price: threadMoney(m[3]), buyer: m[4] }; } },

  // A STRAY DOT BEFORE THE DOLLAR SIGN IS NOISE, NOT A DECIMAL POINT.
  // 20246's `Charm of Brooching (1) - .$140 - Jo` is the auction's one
  // unreadable line, and $140 of augment, in a post whose other 55 lines this
  // rule reads. The dot is skipped ONLY when a `$` follows it, which is what
  // keeps it away from `- .50 - Bob`: there the dot IS the decimal point and
  // dropping it would read fifty dollars for fifty cents. Same reasoning as
  // THREAD_BROKEN_MONEY_RE — the number itself is intact here, so this is
  // punctuation, not arbitration over a malformed price.
  { id: 'item-qty-price',
    re: /^(.*?[A-Za-z].*?)\s*\((\d+)\)\s*(?:\(\d+\)\s*)?[-–]\s*(?:\.(?=\s*\$))?\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)\s*(.*)$/,
    take: function (m) { return { item: m[1], quantity: parseInt(m[2], 10), price: threadMoney(m[3]), buyer: m[4] }; } },

  // "10x $25 - Miriam Dom" and "2 $5.00 - Ptah"   Flik, Azzy
  //
  // The count is tokens either way. What the `x` marks is that the PRICE is
  // for the whole lot rather than for one token — unless the heading above
  // says `individual`, and Flik writes both under one section headed
  // "Trade Goods (bidding on 10x lots or the specific amount)":
  //
  //     Alchemist's Ink (33)            10x $25   -> ten tokens for $25, $2.50 each
  //     Aragonite (12 - individual)      9x $11   -> nine tokens at $11 each
  //
  // Read the first line the second way and Alchemist's Ink is proposed at $25
  // against a recorded $2.50; read the second the first way and Aragonite comes
  // out at $1.22 against a recorded $11. Only the heading tells them apart, so
  // `xMarked` is resolved in threadScanPost where the heading is in hand.
  { id: 'xqty-price-buyer', re: /^(\d+)\s*x\s+\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–]\s*(.+)$/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), xMarked: true, price: threadMoney(m[2]), buyer: m[3] }; } },
  { id: 'qty-price-buyer', re: /^(\d+)\s+\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–]\s*(.+)$/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), price: threadMoney(m[2]), buyer: m[3] }; } },

  // "x35 @ $12.25 Tarantella"     kurtreznor — quantity written as a prefix
  { id: 'xqty-at-price', re: /^x\s*(\d+)\s*@?\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*(.*)$/i,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), price: threadMoney(m[2]), buyer: m[3] }; } },

  // "$0.50 - Florin"              Azzy, Flik, kurtreznor — one lot
  { id: 'price-buyer', re: /^\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–]\s*([A-Za-z].*)$/,
    take: function (m) { return { item: null, quantity: 1, price: threadMoney(m[1]), buyer: m[2] }; } },

  // "- Anton (1) $780" and "- 10x Chips = Calnasse (4) $33"   Casey Wren
  //
  // Casey Wren writes the lot size into the BUYER field rather than the
  // section heading, so the same `Nx` rule has to be read out of it: four lots
  // of ten at $33 is $3.30 a token, which is what 20242 records.
  // The leading dash is OPTIONAL: he uses it in 20242 and drops it in 20226 and
  // 202225, where the same line reads `Zani (1) $376`. Requiring it read those
  // two auctions as 0 of 23 and 0 of 22. Safe to relax because every rule that
  // could want an `Item (N) $price` line is tried first — item-qty-buyer-price
  // and item-qty-price both demand a dash after the parenthetical, which these
  // lines do not have.
  { id: 'buyer-qty-price', re: /^[-–]?\s*(.+?)\s*\((\d+)\)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) {
      var buyer = m[1], size = buyer.match(/^\s*(\d+)\s*x\b/i);
      return { item: null, quantity: parseInt(m[2], 10), lotSize: size ? parseInt(size[1], 10) : 1,
        price: threadMoney(m[3]), buyer: buyer };
    } },

  // "- Vestia (38) 5.50"          Casey Wren, the same line with the `$` simply
  // forgotten — once, in 202351, among thirty that have it. The LEADING DASH is
  // mandatory here where the rule above makes it optional: without the `$` there
  // is nothing else to say this is a bid line rather than `Orion's Belt (1) 150`,
  // and the dash is the mark he opens every bid line of that post with.
  { id: 'dash-buyer-qty-bare-price', re: /^[-–—]\s*(.+?)\s*\((\d+)\)\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) {
      var buyer = m[1], size = buyer.match(/^\s*(\d+)\s*x\b/i);
      return { item: null, quantity: parseInt(m[2], 10), lotSize: size ? parseInt(size[1], 10) : 1,
        price: threadMoney(m[3]), buyer: buyer };
    } },

  // "- Zani $105"                 Casey Wren — a ONE-OF-ONE lot, so he drops the
  // parenthetical the rule above needs. Twelve lines of 202351 are this shape
  // and every one of them is an item in its own right, because the post gives a
  // single-lot item exactly one line: `Patron Pin` and `Patron Token 1` (the
  // 2023 Charm of Biting) are two of the nineteen prices recorded for that
  // auction, and the other ten are the props and Legendaries his `Emporium`
  // section sells — $1,290 of context this thread had never yielded.
  //
  // Kept narrow by the leading dash and by forbidding a `(` in the buyer, so it
  // cannot reach a line the parenthetical rules own.
  { id: 'dash-buyer-price', re: /^[-–—]\s*([A-Za-z][^$(]*?)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: null, quantity: 1, price: threadMoney(m[2]), buyer: m[1] }; } },

  // "Selvra 2 @ $20.00" and "Anton $370.00"   Casey Wren again, a THIRD format —
  // 202247 drops the parenthetical and puts the quantity, when there is one,
  // after the buyer. The bare form is one token.
  //
  // The bare form is the loosest rule in the table, so it is fenced: the buyer
  // is at most three words of letters with NO dash and no digits, which keeps
  // it off `Wish Ring - Tiamat $200` (a dash, so item-buyer-price owns it) and
  // off prose. THREAD_NOT_A_LOT_RE has already removed the running totals.
  { id: 'buyer-qty-at-price', re: /^([A-Za-z][^@$\d]*?)\s+(\d+)\s*@\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: null, quantity: parseInt(m[2], 10), price: threadMoney(m[3]), buyer: m[1] }; } },
  { id: 'buyer-bare-price', re: /^([A-Za-z][A-Za-z.']*(?:\s+[A-Za-z.']+){0,2})\s+\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: null, quantity: 1, price: threadMoney(m[2]), buyer: m[1] }; } },

  // "+2 Branding Mace // $42 - Samantha"   Flik
  { id: 'item-slash-price-buyer',
    re: /^(.*?[A-Za-z].*?)\s*\/\/\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–]\s*(.+)$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[2]), buyer: m[3] }; } },

  // "Cloak of Blending - $55 - Quail"   Flik — a DASH before the buyer where
  // `item-price-buyer` below has a space, and otherwise the same shape. Tried
  // first because it is the narrower of the two: the rule below cannot read
  // these lines at all (its `\s+([A-Za-z].*)` will not start on a dash), which
  // is why 202236's whole `Augmented items:` section — six tokens, $485 — was
  // read as nothing while its title said "Augmented Auction". The section
  // HEADER was always recognised; only the line shape was missing.
  { id: 'item-price-dash-buyer',
    re: /^(.*?[A-Za-z].*?)\s*[-–—]\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*[-–—]\s*([A-Za-z].*)$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[2]), buyer: m[3] }; } },

  // "Grunnel Holiday Ornament - Belle Starr - $55.00"   David Harris — the
  // MIRROR of the rule above: buyer between the dashes, price at the end. The
  // two cannot be confused, because each demands the `$` on its own side, and
  // `Cloak of Blending - $55 - Quail` fails this one on the trailing `Quail`.
  //
  // A HYPHEN INSIDE A WORD IS NOT A SEPARATOR, and this rule's name group is
  // lazy, so it stops at the first dash it can — `2020 UR Semi-Lich Skull =
  // Nynaeve - $60` was read as an item called `2020 UR Semi` bought by
  // `Lich Skull = Nynaeve`. A proposal under a name that is half a word is
  // worse than none: nothing downstream can tell it is wrong. Every real
  // separator in this corpus carries a space on at least one side, and no
  // hyphenated word does — `Semi-Lich`, `One-Boot`, `Old-Style`,
  // `Silver-Ship`. (The rule below is safe without this because its name group
  // is greedy and takes the LAST dash.)
  { id: 'item-buyer-dash-price',
    re: /^(.*?[A-Za-z].*?)(?:\s+[-–—]\s*|\s*[-–—]\s+)([A-Za-z][^$]*?)\s*[-–—]\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[3]), buyer: m[2] }; } },

  // "2019 UR Ring of the Yeti = Lan - $85"   Lord Brian, the same line with his
  // two separators the other way round. He writes five of 202310's augments as
  // `Item - Buyer = $price` and three as `Item = Buyer - $price`, and only the
  // first had a rule — the other three were being read by the rule above,
  // splitting on whatever dash came first. That is how `Semi-Lich Skull` lost
  // its second half.
  //
  // The name is GREEDY up to the `=`, so a hyphenated item stays whole, and the
  // buyer may be a parenthetical: he marks a lot that went at its floor
  // `= (Min) -`.
  { id: 'item-equals-buyer-dash-price',
    re: /^(.*[A-Za-z].*?)\s*=\s*([^=]*?)\s*[-–—]\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[3]), buyer: m[2] }; } },

  // "Golden Ticket - $875 Dragon" Beertram, Ralykam — quantity implied 1
  { id: 'item-price-buyer',
    re: /^(.*?[A-Za-z].*?)\s*[-–]\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s+([A-Za-z].*)$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[2]), buyer: m[3] }; } },

  // "Wish Ring - Hand Witch @ 185"   Josh M again — the same shape as
  // item-qty-buyer-at-price above with the parenthetical dropped, which is how
  // he writes the one-off premium items. Greedy name and a dash-free buyer for
  // the reason item-buyer-price gives below: `Orb of Dragonkind Great Wrym  -
  // Hank @ 355` must keep the variant in the name.
  { id: 'item-buyer-at-price',
    re: /^(.*[A-Za-z].*?)\s*[-–—]\s*([A-Za-z][^-–—@]*?)\s*@\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[3]), buyer: m[2] }; } },

  // "20 Alchemist's Parchment - Flind $2" and "20 Alchemist Ink Kobold $7.25"
  // Fred K — the quantity is a PREFIX on the line rather than a parenthetical,
  // and the dash before the buyer is optional.
  //
  // Two rules because the dashed form can name its own item and the bare one
  // cannot: `20 Alchemist Ink Kobold $7.25` gives no way to tell where
  // "Alchemist Ink" ends and "Kobold" begins, so that form defers to the
  // section header — which is what it is written under. The dashed form must be
  // tried first or the bare pattern swallows it, dash and all.
  { id: 'qty-item-buyer-price',
    re: /^(\d+)\s+(.*[A-Za-z].*?)\s*[-–—]\s*([A-Za-z][^-–—$]*?)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[2], quantity: parseInt(m[1], 10), price: threadMoney(m[4]), buyer: m[3] }; } },
  // The dash is optional because he also writes the buyer alone: `25 - Kobold
  // $15` is twenty-five gold bars under a `1000 GP Gold Bars (...)` heading.
  //
  // `xMarked`, because the count in front means BOTH THINGS and Fred K writes
  // both in the same post — the same ambiguity `10x $25` carries, arriving from
  // the other end of the line:
  //
  //   20 Alchemist Ink Flumph $7.25    20221 — twenty inks at $7.25 EACH
  //   10 Treasure Chips (x3) Trip $31  202415 — ten chips for $31 the LOT
  //
  // and 20221 records `Alchemist's Ink` at $7.25 while 202415 records
  // `Treasure Chip` at $3.10. Read either one the other way and the price is
  // out by its own lot size. His clarification says which he means — "the bids
  // are for the line item rather than individual chips" — but only in 202415,
  // and only in prose.
  //
  // So the reading is not decided here: the lots go into the heading's group
  // and the spread decides, exactly as for `10x $25`. It separates these two
  // cleanly. The ink is $7.25 six times over lots of 20 and 10, so as unit
  // prices the spread is 1.0 and as lot prices it is 2.0; the chips are $31,
  // $31, $30 and $6 over lots of 10, 10, 10 and 2, so as unit prices the spread
  // is 5.2 and as lot prices 1.03. Bids on one item sit within an increment of
  // each other, so the tighter reading is the true one.
  { id: 'qty-header-buyer-price',
    re: /^(\d+)\s+[-–—]?\s*([A-Za-z][^$]*?)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: null, quantity: parseInt(m[1], 10), xMarked: true, price: threadMoney(m[3]), buyer: m[2] }; } },

  // "+1 Turkey Leg of Smiting - Tiamat $65"   Fred K — buyer BEFORE the price,
  // which is the mirror of item-price-buyer above and why that rule never read
  // this post.
  //
  // The name is matched GREEDILY and the buyer forbidden a dash, because he
  // writes `Orb of Dragonkind - Great Wrym - Bulette $450`: lazy matching takes
  // "Orb of Dragonkind" and hands "Great Wrym - Bulette" to the buyer, where
  // greedy takes the variant into the name and leaves "Bulette", which is what
  // the line means. Last of the item rules, so every narrower shape has already
  // had its chance.
  { id: 'item-buyer-price',
    re: /^(.*[A-Za-z].*?)\s*[-–—]\s*([A-Za-z][^-–—]*?)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)\s*$/,
    take: function (m) { return { item: m[1], quantity: 1, price: threadMoney(m[3]), buyer: m[2] }; } },

  // "Orion's Belt (1) 150 Chronos"   jpotter — NO dollar sign anywhere
  { id: 'item-qty-bare-price',
    re: /^(.*?[A-Za-z].*?)\s*\((\d+)\)\s+([\d][\d,]*(?:\.\d{1,2})?)\s+([A-Za-z].*)$/,
    take: function (m) { return { item: m[1], quantity: parseInt(m[2], 10), price: threadMoney(m[3]), buyer: m[4] }; } },
];

/**
 * A MALFORMED NUMBER IS NOT A CHEAP PRICE. `3..75` is not a number at all, and
 * most of these rules do not anchor on the end of the line, so the price group
 * matched the `3` and stopped — silently, and low.
 *
 * 202325's `(28)Harry======@3..75` is 28 of the auction's 48 Minotaur Hides,
 * so the quantity-weighted mode took $3.00 where the sheet records $3.75. That
 * is the shape of defect this whole file is built to avoid: a plausible wrong
 * number, in the price spine, with nothing downstream able to see it.
 *
 * Refused rather than repaired. Reading `3..75` as `3.75` is arbitration — the
 * typo could as easily have been a stray digit — and this file's design already
 * says where an unreadable line goes: to `unparsed`, where a human sees it. It
 * costs nothing here, because the item's other line prices it correctly.
 */
var THREAD_BROKEN_MONEY_RE = /\d\s*\.\s*\.\s*\d|\d\s*,\s*,\s*\d/;

/**
 * `Ring of the 3rd Circle Haliax $101` — NO SEPARATOR AT ALL between the item
 * and the buyer, which is how Fred K writes 202415 from end to end.
 *
 * Every rule in the table above keys on something between the two: a dash, an
 * `=`, an `@`, a `//`, a parenthesised quantity, a tab. This post has none of
 * them, and nothing in a line's SHAPE can say where `Ring of the 3rd Circle`
 * stops and `Haliax` begins. So this rule does not guess — it asks the token
 * index, and takes the LONGEST leading run of words that resolves for the
 * auction's own season. A line whose opening words are not a token it knows is
 * refused and stays in the unread list, which is the safe direction: 202415's
 * augment lines (`Greater Bead of Whispers Fella $146`) name tokens no season
 * has, and a rule that guessed would file each one under half its own name.
 *
 * That is also why this runs BEFORE the rule table rather than after it. The
 * loosest rule there, `buyer-bare-price`, matches any three words and a price
 * and takes its item from the heading above — so `Aragonite Puppet $5.75`
 * became twelve lots of `Alchemist Parchment (AP)`, two headings back, and
 * `Wish Ring Manet $146` became an `Ultra Rare` at $146 under a `PYPs (34)`
 * heading, against the $80 the auction records. A wrong price in the spine,
 * from the auction's most expensive single lot.
 *
 * The buyer is ONE word starting with a capital, and any word between the item
 * and it must be capitalised too. Both fences exist for prose: without them
 * `PYP's are only at $35 right now` reads as an Ultra Rare bought by "are only
 * at", since `PYP` resolves and the line ends in a price.
 *
 * A trailing `Xn` on the item is the LOT SIZE — `AI X10 Wilem $21` is ten inks
 * for twenty-one dollars, which is the $2.10 the sheet records. A trailing
 * `each` marks the opposite and is simply dropped, since a bid per token is
 * this rule's default reading anyway.
 */
var THREAD_BARE_SEPARATOR_RE = /[-–—=@]|\/\/|\t|\(\s*\d|\$/;

function threadBareLot(line, resolve) {
  if (!resolve) return null;
  var text = String(line == null ? '' : line).replace(/\s+/g, ' ').trim();
  if (THREAD_BROKEN_MONEY_RE.test(text)) return null;
  text = text.replace(/\s*\(?\s*each\s*\)?\s*$/i, '');
  var m = text.match(/^(.*[A-Za-z].*?)\s+([A-Z][A-Za-z.'-]*)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)$/);
  if (!m) return null;
  var head = m[1], lotSize = 1;
  if (THREAD_BARE_SEPARATOR_RE.test(head)) return null;
  head = head.replace(/\s+x\s*(\d+)\s*$/i, function (all, n) { lotSize = parseInt(n, 10); return ''; });

  var words = head.split(' ');
  for (var k = words.length; k >= 1; k--) {
    var candidate = words.slice(0, k).join(' ');
    if (!/[A-Za-z]/.test(candidate)) continue;
    var between = words.slice(k), ok = true;
    for (var j = 0; j < between.length; j++) if (!/^[A-Z]/.test(between[j])) ok = false;
    if (!ok) continue;
    if (!resolve(candidate)) continue;
    return { item: candidate, quantity: 1, lotSize: lotSize, price: threadMoney(m[3]),
      buyer: between.concat([m[2]]).join(' '), rule: 'item-buyer-bare' };
  }
  return null;
}

/**
 * The same no-separator line, for an item NO SEASON KNOWS — read by asking who
 * the post's buyers are.
 *
 * threadBareLot can only split a line it can resolve, so Fred K's augments are
 * exactly the lines it must refuse: `Greater Bead of Whispers Fella $146`,
 * `Ring of the 5th Circle Auri $175`, `25K bar Felurian $226`. Those are the
 * rows worth having — an augment is by definition a token the auction's own
 * season does not list — and 202415 records twenty-three of them.
 *
 * The discriminator is that AN AUCTION'S BUYERS ARE A SMALL, REPEATING SET.
 * Whoever won an unreadable lot almost always won a readable one too, so the
 * names the first pass collected say where the item stops. That is why this
 * function takes the post's own buyers rather than a pattern: it is evidence
 * out of the same post, not a guess about name shapes.
 *
 * It cannot reach the price spine. A line whose opening words resolve was read
 * by threadBareLot two rules earlier, so everything arriving here is a context
 * candidate by construction — the failure it can produce is a mis-split NAME on
 * a row a human reviews, never a wrong number on a row nobody checks.
 *
 * Fenced anyway: the item must open on a capital or a digit, the line must
 * carry none of the separators every other grammar keys on, and it must not
 * read as prose — `Thanks to Manet $146` is a sentence, and the buyer set alone
 * would let it through.
 */
function threadBuyerLot(line, buyers) {
  if (!buyers) return null;
  var text = String(line == null ? '' : line).replace(/\s+/g, ' ').trim();
  if (THREAD_BROKEN_MONEY_RE.test(text)) return null;
  var each = false;
  text = text.replace(/\s*\(?\s*each\s*\)?\s*$/i, function () { each = true; return ''; });
  var m = text.match(/^([A-Z0-9].*?)\s+([A-Z][A-Za-z.'-]*)\s*\$\s*([\d][\d,]*(?:\.\d{1,2})?)$/);
  if (!m) return null;
  if (THREAD_BARE_SEPARATOR_RE.test(m[1])) return null;
  if (!/[A-Za-z]/.test(m[1])) return null;
  if (!buyers[m[2].toLowerCase()]) return null;
  if (THREAD_PROSE_RE.test(text)) return null;
  var head = m[1], lotSize = 1, quantity = 1;
  head = head.replace(/\s+x\s*(\d+)\s*$/i, function (all, n) { lotSize = parseInt(n, 10); return ''; });
  // A LEADING COUNT, but only when the line says `each`. `24 Avery Potions Trip
  // $0.25 (each)` is twenty-four tokens at a quarter; without the count the two
  // lines of that group weigh 1 against 1 and the mode is a coin toss, where the
  // recorded price is the one 24 tokens went at. `each` is what licenses it —
  // the word says the price is per token, so the number in front is how many.
  // Bounded below 200 for the reason every count here is: a four-digit year in
  // that position multiplies.
  head = head.replace(/^(\d{1,3})\s+(?=\D)/, function (all, n) {
    if (!each) return all;
    quantity = parseInt(n, 10);
    return '';
  });
  return { item: head, quantity: quantity, lotSize: lotSize, price: threadMoney(m[3]),
    buyer: m[2], rule: 'item-buyer-known' };
}

function threadRuleLot(line) {
  if (THREAD_BROKEN_MONEY_RE.test(String(line))) return null;
  for (var i = 0; i < THREAD_RULES.length; i++) {
    var m = String(line).match(THREAD_RULES[i].re);
    if (m) {
      var lot = THREAD_RULES[i].take(m);
      lot.rule = THREAD_RULES[i].id;
      return lot;
    }
  }
  return null;
}

/**
 * Is this tab-separated line a TABLE HEADER? If so, what is each column?
 *
 * Returning `{ refuse: … }` rather than a column map is how `Buy It Out` and
 * `Average Bid` are turned away: a table whose only money column is one of
 * those has no winning bid in it at all, and importing it would be worse than
 * importing nothing.
 */
function threadTableHeader(cells) {
  var lower = [], i;
  for (i = 0; i < cells.length; i++) lower.push(String(cells[i]).trim().toLowerCase().replace(/[:*]+$/, ''));

  var cols = { name: -1, price: -1, buyer: -1, quantity: -1, lotNumber: -1 }, banned = [];
  var known = 0;
  for (i = 0; i < lower.length; i++) {
    if (cols.name < 0 && THREAD_NAME_HEADERS.indexOf(lower[i]) >= 0) { cols.name = i; known++; }
    else if (cols.price < 0 && THREAD_PRICE_HEADERS.indexOf(lower[i]) >= 0) { cols.price = i; known++; }
    else if (cols.buyer < 0 && THREAD_BUYER_HEADERS.indexOf(lower[i]) >= 0) { cols.buyer = i; known++; }
    else if (cols.quantity < 0 && THREAD_QUANTITY_HEADERS.indexOf(lower[i]) >= 0) { cols.quantity = i; known++; }
    else if (cols.lotNumber < 0 && THREAD_LOT_NUMBER_HEADERS.indexOf(lower[i]) >= 0) { cols.lotNumber = i; known++; }
    else if (THREAD_NEVER_PRICE_HEADERS.indexOf(lower[i]) >= 0) { banned.push(lower[i]); known++; }
  }
  // Two recognised columns is the floor. One is a coincidence — plenty of
  // ordinary sentences split on a tab into a cell reading "item".
  if (known < 2) return null;
  if (cols.price < 0 && banned.length) {
    return { refuse: 'the only bid column is "' + banned.join('", "') +
      '", which is not what anything sold for — ask for the winning bids' };
  }
  cols.banned = banned;
  return cols;
}

/**
 * A tab-separated line to a lot, under a remembered header when there is one.
 *
 * Without a header the money-formatted cell is the price and that is the right
 * guess: it is what Mike Steele's and Wade S's tables mean. WITH a header it is
 * the wrong guess often enough to matter, which is the AlanP finding — so the
 * header always wins where it exists.
 */
function threadTableLot(line, cols) {
  if (String(line).indexOf('\t') < 0) return null;
  var raw = String(line).split('\t');
  var cells = [];
  for (var i = 0; i < raw.length; i++) cells.push(raw[i].replace(/^\s+|\s+$/g, ''));

  if (cols) {
    var name = cols.name >= 0 ? cells[cols.name] : null;
    var priceCell = cols.price >= 0 ? cells[cols.price] : null;
    if (priceCell !== null && priceCell !== undefined && priceCell !== '' &&
        /^\$?\s*[\d][\d,]*(\.\d{1,2})?$/.test(priceCell)) {
      // Only a column the header CALLS a quantity is one. A `#` column is a lot
      // number: Wade S's `4th Tooth 1..8` is eight lots of one, not 36 tokens.
      var quantity = 1;
      if (cols.quantity >= 0 && /^\d+$/.test(cells[cols.quantity] || '')) quantity = parseInt(cells[cols.quantity], 10);
      return {
        item: name === '' ? null : name,
        quantity: quantity,
        price: threadMoney(priceCell),
        buyer: cols.buyer >= 0 ? cells[cols.buyer] : '',
        rule: 'table-header',
      };
    }
    // The header does not fit this line, so fall through to reading it
    // positionally rather than dropping it. Wade S's 2018 post is why: one
    // header covers the premium items, and the trade goods beneath it are a
    // narrower `qty | buyer | price` table with no header of its own. Held to
    // the first header those forty lines read as nothing at all.
  }

  // A SEPARATOR IN ITS OWN COLUMN IS NOT A FIELD. Kusig tabs around both of his
  // separators — `1 <tab><tab> Wish Ring <tab><tab> @ <tab> $190.00 <tab> - <tab>
  // Garfield` — so the dash arrives as a cell of its own, and the trailing-cell
  // search below would take it for the buyer. `@` was already dropped for the
  // same reason; the dash forms are the three characters auctioneers use.
  var kept = [];
  for (i = 0; i < cells.length; i++) {
    if (cells[i] !== '' && cells[i] !== '@' && !/^[-–—]$/.test(cells[i])) kept.push(cells[i]);
  }
  if (kept.length < 2) return null;
  var money = [];
  for (i = 0; i < kept.length; i++) if (/^\$\s*[\d][\d,]*(\.\d{1,2})?$/.test(kept[i])) money.push(i);
  if (money.length !== 1) return null;
  var at = money[0];
  var item = null, qty = 1, buyer = '', lotSize = 1;

  // What the FIRST cell is decides how the rest reads, and Wade S's 2018 post
  // is why it has to: it carries two tables. `4th Tooth | 1 | Foxtrot | $86` is
  // item, lot number, buyer, price — eight lots of one token. `10 | Echo |
  // $3.25` beneath a `Potion Distilled Healing` heading is quantity, buyer,
  // price — ten tokens in one lot. Both are three or four tab-separated cells
  // with one money cell, and only the type of the first cell tells them apart.
  // Reading the second table the first way makes `Echo` an item and loses
  // fifteen trade goods; reading the first table the second way makes eight
  // lots into thirty-six tokens.
  // A PARENTHESISED count in its own cell is a quantity, and the cell before it
  // is the buyer, not the item: `Calnasse | (5) | $91.00` under a
  // `+1 Turkey Leg of Smiting (4)` heading is Casey Wren's 202225 shape. Read
  // positionally the plain way, the first cell is taken for an item and six
  // trade goods are lost to bidder names. `(N)` is what separates it from Wade
  // S's `4th Tooth | 1 | Foxtrot | $86`, where the bare `1` is a lot number —
  // and the parenthesised form appears in exactly one thread across the fixture
  // corpus and all fifty 2022 threads, so it is not competing with anything.
  var parenAt = -1;
  for (i = 1; i < at; i++) if (/^\(\d+\)$/.test(kept[i])) { parenAt = i; break; }
  var xPrefix = at > 0 ? String(kept[0]).match(/^x\s*(\d+)$/i) : null;
  if (parenAt > 0 && !xPrefix) {
    qty = parseInt(kept[parenAt].replace(/[()]/g, ''), 10);
    buyer = kept[parenAt - 1];
  } else if (xPrefix) {
    // kurtreznor puts the count in its own cell as `x35`, and the `@` beside it
    // means the price is EACH: `x35 @ $12.25` is thirty-five gold bars at
    // $12.25, which is what 20222 records. That is the opposite of Flik's
    // `10x $25`, where the same `x` marks a lot price — the `@` is what tells
    // them apart, and reading this one Flik's way proposes $0.35 a bar.
    qty = parseInt(xPrefix[1], 10);
    for (i = 1; i < at; i++) if (!/^[\d.,$]+$/.test(kept[i])) { buyer = kept[i]; break; }
  } else if (at > 0 && /^\d+$/.test(kept[0])) {
    qty = parseInt(kept[0], 10);
    // WHERE THE BUYER SITS DECIDES WHAT THE MIDDLE CELL IS. Two tables begin
    // with a bare count and they mean opposite things by the cell after it:
    //
    //   10 | Echo               | $3.25            Wade S — buyer, item from the heading
    //   1  | Path to Enlightenment | $616.00 | Taz  Kusig  — ITEM, buyer at the end
    //
    // The tell is whether anything follows the price. Read Kusig's shape Wade's
    // way and the heading supplies the name for every lot, so `8k Exclusives:`
    // became the item for four of them and `Path to Enlightenment` was filed as
    // the buyer — the renaming failure this file's own design note warns about,
    // arriving through the table path rather than through a grammar. It also
    // silenced everything below the first real section heading: `Onyx:` clears
    // the heading, so all 21 Onyx lots and all 35 trade-good lots were dropped
    // as "no item name above it". 202336 and 202346 read 0 of 21 and 0 of 22.
    var trailing = -1;
    for (i = at + 1; i < kept.length; i++) {
      if (!/^[\d.,$]+$/.test(kept[i])) { trailing = i; break; }
    }
    if (trailing >= 0) {
      buyer = kept[trailing];
      for (i = 1; i < at; i++) if (item === null && !/^[\d.,$]+$/.test(kept[i])) item = kept[i];
    } else {
      for (i = 1; i < at; i++) if (!/^[\d.,$]+$/.test(kept[i])) { buyer = kept[i]; break; }
    }
  } else {
    for (i = 0; i < at; i++) {
      if (item === null && !/^\d+$/.test(kept[i])) item = kept[i];
    }
  }
  if (!buyer) {
    for (i = at + 1; i < kept.length; i++) if (!/^[\d.,$]+$/.test(kept[i])) { buyer = kept[i]; break; }
  }
  return { item: item, quantity: qty, lotSize: lotSize, price: threadMoney(kept[at]), buyer: buyer, rule: 'table-positional' };
}

/**
 * Prose, or a line that could name the item the lots beneath it belong to?
 *
 * Everything about this is a heuristic and it does not have to be right — a
 * header guessed wrong produces lots that resolve to no token, and those are
 * reported, not written. What it must not do is swallow a rules paragraph and
 * silently file forty lots under "Shipping will be $5".
 */
var THREAD_PROSE_RE = new RegExp(
  '(auction|bid|shipp|paypal|payment|total|funding|goal|thank|please|will be|' +
  'if you|increment|update|closed|winner|http|rules|posted|sent|will ship|' +
  'tokens? =|per token|reserve the right)', 'i');

function threadLooksLikeHeader(line) {
  var text = String(line).replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  // A line carrying a price is never an item NAME. Without this a bid line no
  // grammar could read became the section header and renamed every line under
  // it — 202211 lost seven items that way and grew thirteen phantom context
  // candidates literally named after bid lines, e.g. `(1) Perrin=== @ $ 15.00
  // each`. The design already says where such a line belongs: the caller drops
  // it into `unparsed`, and "the leftovers are the point".
  //
  // The exception is a PARENTHETICAL ABOUT THE BIDDING, stated in the heading
  // itself. Fred K writes `PYP's (68) (Minimum bid $50)` and
  // `AG Badges (16) (min $1 Bid)`, which are item headings that happen to quote
  // a floor, and — three times in 202415 — he explains the unit instead:
  //
  //   Aragonite (12) (Bids are for each Aragonite trade token)
  //   24 Elvish Bismuth (EB) (bids are for each EB trade token - bid can be …)
  //   Oil of Enchantment (OE) (15) (bids are for each OE token - you may bid …)
  //
  // Every one of them is an item name with an aside after it, and all three
  // were refused: the first two for prose, the third for both prose and the
  // 60-character limit. The cost is not the heading, it is the LINES BENEATH IT
  // — twelve Aragonite lots inherited `Alchemist Parchment (AP)` from two
  // headings earlier and were proposed under that name.
  //
  // So the parenthetical is removed before the test rather than allowed through
  // it, and the length and prose tests run on what is left: a heading may carry
  // an aside about bidding and nothing else. The price test runs on the probe
  // too — the word it objects to is `bid`, and it is inside the aside.
  var probe = text.replace(/\([^)]*\b(?:min(?:imum)?|bids?|bidding)\b[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!probe || probe.length > 60) return false;
  // `@\s*\$?\s*\.?\d`, not `@\s*\$`: A PRICE NEED NOT CARRY A DOLLAR SIGN, and
  // this guard was written against posts that always do. Steve writes none at
  // all — `(28)Harry======@3..75` — so the one line of 202325 the grammars
  // deliberately refuse (see THREAD_BROKEN_MONEY_RE) walked straight into this
  // function, became the section header, and renamed the Minotaur Hide lot
  // beneath it. Refusing one bad line therefore LOST the item, which is the
  // opposite of what refusing it was for.
  if (/\$\s*\d|\d+\s*@|@\s*\$?\s*\.?\d/.test(probe)) return false;
  if (THREAD_PROSE_RE.test(probe)) return false;
  if (/[.!?]$/.test(text) && text.split(' ').length > 6) return false;
  return true;
}

/**
 * A section header: `'drop'`, `'onyx'`, `'context'`, `'end'`, or null for a
 * line that is not one.
 */
function threadSectionOf(line) {
  var text = String(line).replace(/\s+/g, ' ').trim();
  // A LINE CARRYING A PRICE IS NEVER A SECTION HEADING — the same rule
  // threadLooksLikeHeader already applies, and for the same reason.
  //
  // Tyler writes his bidders in capitals, and two of them are two words:
  // `10 @ $3.00 - THE PRESENCE` and `3 @ $95 FIDDLER'S GREEN` reduce to
  // `THE PRESENCE` and `FIDDLERS GREEN`, which are all-caps, multi-word and
  // over eight characters — so each was read as a heading that CLOSED the open
  // section. The lot itself was then thrown away and, worse, the item heading
  // went with it, so the next line down ("4 @ $3.25 - AUBERON") had no name
  // above it either. 20233 read 3 of 23 with 52 phantom context candidates.
  //
  // THE GUARD USED TO SIT BELOW THE VOCABULARY, WHICH CLOSED ONE DOOR OF TWO.
  // The end-vocabulary contains `ultra rares?`, so every one of AlanP's
  // `Ultra Rare #1 <tab> $75 <tab> 57 <tab> Rockmobile` lines was read as a
  // heading that closed the open section — and 202540 lost its entire PYP
  // block, 34 lots and the auction's `Ultra Rare` price, without one line
  // reaching `unparsed`. A section heading names a division of the post; a
  // priced line is a lot, whatever words it opens with. Measured over the 106
  // threads on disk, no real heading quotes a price outside a parenthetical
  // about the bidding, which is stripped first exactly as
  // threadLooksLikeHeader strips it.
  var probe = text.replace(/\([^)]*\b(?:min(?:imum)?|bids?|bidding)\b[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (/\$\s*\d|\d+\s*@|@\s*\$/.test(probe)) return null;
  for (var i = 0; i < THREAD_SECTIONS.length; i++) {
    if (THREAD_SECTIONS[i].re.test(text)) return THREAD_SECTIONS[i].kind;
  }
  if (THREAD_SECTION_END_RE.test(text)) return 'end';
  var bare = text.replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim();
  if (bare.length >= 8 && bare.indexOf(' ') > 0 && bare === bare.toUpperCase()) return 'end';
  return null;
}

/**
 * An item name as a thread writes it, reduced to something resolvable.
 *
 * A header carries a trailing colon and a total-quantity parenthetical that a
 * lot line does not — `Drake's Draught (32 - individual):` — and both have to
 * come off before the shared resolver sees the name. The quantity in that
 * parenthetical is the count of tokens in the whole section, NOT a lot size,
 * so it must not reach `parseQuantity`: `Treasure Chips (5)` under a `10x`
 * prefix means five lots of ten, and multiplying by five as well would put the
 * price out by that factor.
 */
function threadTidyName(name) {
  return String(name == null ? '' : name)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(THREAD_BBCODE_RE, '')
    // AN ORPHANED BRACKET IS BBCODE THE AUTHOR MISTYPED. Lord Brian's
    // `Grunnel's +2 Pointy Stick ]` is a `[/b]` he broke, and the lone `]`
    // survives the tag strip above — so the 2k Bonus resolved to nothing and
    // was proposed as an augment at the auction's own recorded 2k price.
    //
    // Only when unmatched, so the `[Great Wyrm]` the fallback chain rewrites to
    // `(Great Wyrm)` keeps both of its brackets.
    .replace(/[\[\]]/g, function (b, i, whole) {
      var other = b === '[' ? ']' : '[';
      return whole.indexOf(other) < 0 ? '' : b;
    })
    .replace(/\s*[:–-]\s*$/, '')
    // A minimum quoted in the heading is not part of the name:
    // `PYP's (68) (Minimum bid $50)`. Stripped BEFORE the quantity
    // parenthetical below, which only fires when it is the trailing one — left
    // in place it shields the `(68)` and the whole heading is proposed as an
    // augment, which is how 20221's Ultra Rares read as eight non-standard lots.
    .replace(/\s*\([^)]*\bmin(?:imum)?\b[^)]*\)\s*/gi, ' ')
    // `(x51)` as well as `(51)`. Tyler heads every group with the stock
    // available and writes the `x` — `Alchemist's Ink (x51)`. Stripped HERE and
    // not only in the resolution fallbacks, for the same reason the leading tier
    // marker below is: a context CANDIDATE reports this name, so a token that
    // fails to resolve is proposed to the maintainer as `Charm of Treasure
    // Boosting (x3)` and is a different item from the `Charm of Treasure
    // Boosting` already recorded beside it.
    //
    // TWICE, because a heading can carry two of them: Fred K's
    // `Treasure Chips (3x) (32)` states the chip's draw count and the stock
    // available, and stripping only the last left `Treasure Chips (3x)`, which
    // resolves to nothing — so 202415's 32 chips were proposed as an augment
    // under that name. The pattern is anchored on the end and demands a leading
    // digit, `x`, `each` or `individual`, so a parenthesised part of a real name
    // is out of its reach either way: `Path to Enlightenment (Fragment 2)` and
    // `Orb of Dragonkind (Great Wyrm)` are untouched by both passes.
    .replace(/\s*\((?:x\s*)?(?:\d+[^()]*|each|individual)\)\s*$/i, '')
    .replace(/\s*\((?:x\s*)?(?:\d+[^()]*|each|individual)\)\s*$/i, '')
    .replace(/\s*\(w\/?\s*code\)/i, '')
    // A LEADING tier marker is decoration, exactly like the parentheticals
    // above. Lord Brian lists 202310's augments as `2021 UR Pants of Focus`,
    // and the sheet records `Pants of Focus` — left on, the same token reads as
    // a different item in every auction that labels its tier. Stripped HERE
    // rather than only in the resolution fallbacks, because a context candidate
    // reports this name, and the raw line is kept alongside it either way.
    //
    // `UR` only, never `PYP`: Ralykam numbers his lots `PYP 1` .. `PYP 16`, and
    // stripping that prefix leaves a bare `1`. The lookahead is the same guard
    // from the other end — something with a letter in it has to survive, so a
    // bare `UR` still reaches the fallback that turns it into `Ultra Rare`.
    //
    // The YEAR in front of the marker goes with it, and only there. Lord Brian
    // writes his augments both `2021 UR Pants of Focus - Lanfear = $50` and
    // `2021 UR Mad Evoker's Charm = (Min) - $30`, and the first form loses its
    // year to a grammar that reads the leading number as a quantity while the
    // second keeps it — so ONE auction proposed `Mad Evoker's Charm` and
    // `2021 UR Mad Evoker's Charm` as two separate context rows. A split of an
    // item against itself, out of one post. A bare leading year is left alone;
    // it is only decoration when it is labelling a tier.
    .replace(/^(?:(?:19|20)\d{2}\s+)?ur\s+(?=.*[A-Za-z])/i, '')
    // A trailing `#3` is the LOT NUMBER, in the name instead of its own column.
    // Left on, every lot of an item becomes a different item and no
    // distribution is ever built. `Path to Enlightenment (Fragment 4)` keeps
    // its number because that one is parenthesised and is the FRAGMENT — part
    // one's finding, and the reason this only strips a bare trailing `#N`.
    .replace(/\s+#\s*\d+\s*$/, '')
    // `Alchemist Parchment 10x Chip` -> `10x Alchemist Parchment`. Casey Wren
    // condenses his trade goods into chips of ten and says so in the HEADING,
    // where `parseQuantity` — which reads a lot size off the front of a name —
    // cannot see it. Moved to the front it both resolves and divides: 202247's
    // `Vestia 5 @ $30.00` is fifty tokens at $3.00, which is what is recorded.
    // Left alone the heading resolves to nothing and twenty-one trade-good
    // lines are proposed as augments.
    // ...and `Darkwood Plank 10x 3` is the same thing with the word `Chip`
    // dropped and a LOT NUMBER after it. Both are optional here, and the second
    // is why this cannot wait for the trailing-number fallback: that runs after
    // resolution, and by then the `10x` has already failed to be read.
    //
    // 20236 is the case. Its planks sold as ten lots of ten at $14.00 and seven
    // singles at $1.00; reading only the singles proposes **$1.00** against a
    // recorded **$1.40** — a plausible wrong number, which is the worst kind.
    .replace(/^(.*?)\s+(\d+)\s*x(?:\s*chips?)?(?:\s+\d+)?\s*$/i, function (m, base, n) { return n + 'x ' + base; })
    // ...and AlanP writes the `x` FIRST — `1k GP Bars x5 #1`, nine lots of five
    // that come to the 45 gold bars an 8K order holds. Same fact, opposite
    // order, and unread it cost all three of his 2025 auctions their whole
    // `1,000 GP Gold Bar` row. Safe as a suffix rule because no name in
    // `tokenMetadata`, `contextItems` or `prices` ends in ` xN` — the
    // parenthesised form (`Alchemist's Ink (x51)`) is stripped above as a stock
    // marker and never reaches this.
    .replace(/^(.*?)\s+x\s*(\d+)(?:\s+\d+)?\s*$/i, function (m, base, n) { return n + 'x ' + base; })
    // `(all 4)` IS A LOT SIZE, not a stock marker. The parenthetical strip
    // above wants a leading digit, so AlanP's
    // `Adventurer's Guild Codes & Buttons (all 4)` kept it, resolved to the
    // Guild Button and never divided: $2 proposed against a recorded $0.50 in
    // all three of his 2025 auctions. The word `all` is what makes it a lot —
    // he is selling the order's four codes as one lot — and it appears on
    // exactly these three lines in the 106 threads on disk, each dividing to
    // the recorded price to the cent.
    .replace(/^(.*?)\s*\(\s*all\s+(\d+)\s*\)\s*$/i, function (m, base, n) { return n + 'x ' + base; })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Onyx names a thread spells differently from `onyx.csv`.
 *
 * `Common UC Rare Set` IS `C/UC/R Set` — the Common, Uncommon and Rare set that
 * every Onyx order includes, spelled out instead of abbreviated. And AlanP's
 * `Shieldmaiden Bracers` is the sheet's `Shield Maiden Bracers`.
 *
 * Applied where the ONYX name is final rather than in threadTidyName, because
 * tidying runs before the `(Onyx)` marker comes off and `Common UC Rare Set
 * (Onyx)` is not the name this has to match. Not in THREAD_FALLBACKS either: an
 * Onyx lot never reaches threadResolveName, since `C/UC/R Set` is in no
 * tokenMetadata row at all — it exists only in onyx.csv — so whatever the thread
 * writes is what gets proposed.
 *
 * Unambiguous rather than inferred: onyx.csv holds 32 rows of it under that one
 * spelling and no other, and the price agrees exactly on both of Kusig's
 * auctions ($91 and $51). None of those rows came out of this pipeline, so this
 * is not the self-confirming trap that turned `Folio of X` into `Folio: X`. It
 * is still a NAME, so it was put to the maintainer rather than assumed —
 * CONFIRMED 2026-08-25. Settled; do not re-derive it from row counts.
 */
function threadOnyxSetName(name) {
  return String(name == null ? '' : name)
    // THE WORD `Full` GOES ON EITHER END, AND A DASH MAY LEAD. AlanP writes
    // `Full C/U/R Set` — the same three words abbreviated one letter further —
    // and Beertram and Matt Soto write `- C/UC/R Full Set`. All four lots close
    // at the price onyx.csv records to the cent ($110, $105, $95, $90), and
    // each was the one Onyx row of its auction that never reconciled.
    .replace(/^\s*[-–—]?\s*(?:full\s+)?c(?:ommons?)?[\s/]+u\.?\s*c?\.?(?:ommons?)?[\s/]+r\.?\s*a?r?e?s?[\s/]*(?:full\s+)?set\s*$/i, 'C/UC/R Set')
    // `Shield Maiden Bracers` IS THE OFFICIAL NAME — maintainer, 2026-08-26.
    // AlanP closes the space up in both of his 2025 Onyx auctions; Mike Steele
    // and Wade S keep it, and all ten shipped rows keep it. Put to him rather
    // than inferred from those row counts, because "match the shipped CSV" is
    // the heuristic that turned `Folio of X` into `Folio: X` — but here the
    // sheet and the majority of auctioneers agreed, and he confirmed both.
    .replace(/^\s*shieldmaiden\s+bracers\s*$/i, 'Shield Maiden Bracers');
}

/**
 * One post to lots and leftovers.
 *
 * The leftovers are the point. Every line carrying a price that no grammar read
 * is kept and reported — that is the whole reason a pattern-matching approach
 * is honest here, and the number is the coverage measurement.
 *
 * `resolve` is optional and takes a name to a token or null. Only
 * threadBareLot uses it, and only to refuse a line: without it that rule never
 * fires and this function behaves exactly as it did before, which is why every
 * caller that scans a post on its own can go on passing one argument.
 *
 * `buyers` is internal. The post is scanned TWICE — once to learn who bought
 * anything at all, then again with that set in hand so threadBuyerLot can use
 * it. A buyer's other line can sit anywhere in the post, above or below, so
 * there is no single-pass version of this.
 */
function threadScanPost(text, resolve, buyers) {
  var lines = String(text == null ? '' : text).split('\n');
  var lots = [], unparsed = [];
  var header = null, section = null, columns = null, refusals = [], alias = null;

  // DOES `Nx` MARK A LOT PRICE OR A QUANTITY? The line cannot say, and the two
  // readings differ by a factor of N:
  //
  //   Alchemist's Ink (33)   10x $25      Flik 2022 — ten tokens for $25
  //                          10x $25
  //                          10x $25.01
  //                           3x $7.50
  //   Alchemist's Ink (51)   21x $4.00    Flik 2023 — twenty-one at $4 each
  //                          20x $4.25
  //                          10x $4.25
  //
  // Identical in shape, opposite in meaning, and the SAME AUCTIONEER writes
  // both. Read the wrong way round, 202312's every trade good was divided twice
  // — Alchemist's Ink at $0.19 against a recorded $4.25, Ultra Rare at $5.94
  // against $95, and eighteen more — while the parse rated 21 of 22 items
  // matched throughout, because `matched` compares names.
  //
  // WHICH READING MAKES THE UNIT PRICES AGREE? Bids on one item in one auction
  // sit within a bid increment or two of each other, so the reading that spreads
  // them out is the wrong one. Above: as lots, 2022 gives $2.50/$2.50/$2.50/$2.50
  // and 2023 gives $0.19/$0.21/$0.43; as quantities, 2022 gives
  // $25/$25/$25.01/$7.50 and 2023 gives $4.00/$4.25/$4.25. Each year picks
  // itself.
  //
  // Not the sum of the counts against the heading's `(N)`, which was the first
  // thing tried and is worthless: the auctioneer sells the whole stock either
  // way, so both readings sum to the total. Flik's 2022 group sums to exactly
  // its 33.
  //
  // Decided per heading, so the transform below is applied optimistically and
  // undone here once the group is complete. A group of one, or one whose lines
  // are all identical, is a tie and keeps the long-standing lot reading.
  // ...and where the spread cannot tell, THE REST OF THE POST VOTES. A group
  // whose lines all carry the same count — 202312's `2x $8.00` and `2x $8.25`
  // under `Grunnel's +2 Pointy Stick (4)` — gives the two readings the identical
  // spread, so nothing local can separate them. But an auctioneer means one
  // thing by `Nx` throughout a post: every group of Flik's 2022 post that can be
  // decided reads as a lot, and every group of his 2023 post reads as a
  // quantity. So the decidable groups settle the undecidable ones, and with no
  // majority either way it stays the long-standing lot reading.
  //
  // Groups under an `(N - individual)` heading never enter this at all — that
  // heading has already said which it is — so they cannot skew the vote.
  // ...AND AN AUCTIONEER CAN MEAN BOTH THINGS IN ONE POST, IF HE SAYS SO.
  // 202413 is Flik again, and halfway down he writes
  //
  //     Trade Goods (bidding on 10x lots or the specific amount)
  //
  // Above that line `Nx` is a count — `4x $130` is four Rings of the 3rd Circle
  // at $130, which is what the sheet records, and his 34 PYPs at `12x $80`
  // decide it on their own spread. Below it `Nx` is a lot — `10x $35` is ten
  // Minotaur Hides for $35, the recorded $3.50. Read with one convention for the
  // whole post, four of the auction's prices come out wrong by their own lot
  // size: the 1k Bonus at $32.50 against $130, the 2k Bonus at $57.50 against
  // $115, the AG Button at $0.13 against $0.25.
  //
  // So a heading may DECLARE the convention for what follows, and the post-wide
  // vote is then taken only among the groups that declared nothing — which is
  // what makes the two halves of this post independent. `individual` and `each`
  // already worked this way from the other side; this is the same idea for the
  // word `lot`.
  //
  // Only the LOT declaration is standing. `individual` and `each` are written on
  // an ITEM heading — `Aragonite (12 - individual)` — and mean that item alone,
  // which the xMarked test below already handles by never grouping it. Made
  // standing as well, they turned every group below the first one into a count:
  // Flik writes three of them among his trade goods, and Enchanter's Munition
  // two headings later came out at $26 against a recorded $2.60.
  var xGroup = [], xGroups = [], xSaid = null;
  function xSpread(v) {
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    return lo > 0 ? hi / lo : Infinity;
  }
  function closeXGroup() {
    if (xGroup.length) xGroups.push({ lots: xGroup, said: xSaid });
    xGroup = [];
  }
  /** 'qty', 'lot', or null when the group cannot say. */
  function xVerdict(group) {
    if (group.length < 2) return null;
    var asLot = [], asQty = [];
    for (var g = 0; g < group.length; g++) {
      asLot.push(group[g].price / group[g].lotSize);
      asQty.push(group[g].price);
    }
    var lot = xSpread(asLot), qty = xSpread(asQty);
    // A TIE IS A TIE, and floating point does not agree. Minotaur Hide's four
    // lines are `10x $35, 10x $35, 10x $36, 10x $36`: the two readings differ by
    // a constant factor of ten, so their spreads are 36/35 and 3.6/3.5 — the
    // same number, and NOT the same double. The last bit decided it, silently,
    // for a group whose whole point is that it cannot be decided, and the
    // spurious verdict then voted in the post-wide fallback as well.
    if (qty < lot * (1 - 1e-9)) return 'qty';
    if (lot < qty * (1 - 1e-9)) return 'lot';
    return null;
  }
  function settleXGroups() {
    var votes = { qty: 0, lot: 0 }, verdicts = [], k;
    for (k = 0; k < xGroups.length; k++) {
      var v = xVerdict(xGroups[k].lots);
      verdicts.push(v);
      // Only a group that declared nothing votes: a declared group is already
      // answered, and letting it vote would carry one half of the post into the
      // other.
      if (v && !xGroups[k].said) votes[v]++;
    }
    var fallback = votes.qty > votes.lot ? 'qty' : 'lot';
    for (k = 0; k < xGroups.length; k++) {
      if ((verdicts[k] || xGroups[k].said || fallback) !== 'qty') continue;
      for (var g = 0; g < xGroups[k].lots.length; g++) {
        xGroups[k].lots[g].quantity = xGroups[k].lots[g].lotSize;
        xGroups[k].lots[g].lotSize = 1;
      }
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i].replace(/\s+$/, '');
    var line = raw.replace(/^\s+/, '');
    if (!line) continue;

    var found = threadSectionOf(line);
    // Tested before the branch, not inside the header branch, because the line
    // that declares it may be consumed as a SECTION instead: Flik's
    // `Trade Goods (bidding on 10x lots or the specific amount)` closes his
    // off-order section, so the header branch never sees it and the declaration
    // was silently lost. Whichever branch takes the line, the words are there.
    if ((found || threadLooksLikeHeader(line)) &&
        /\b\d+\s*x\s+lots?\b|\bin\s+lots?\s+of\b|\blots?\s+of\s+\d+/i.test(line)) {
      closeXGroup();
      xSaid = 'lot';
    }
    if (found) { closeXGroup(); section = found === 'end' ? null : found; header = null; alias = null; continue; }

    if (raw.indexOf('\t') >= 0) {
      var cells = raw.split('\t');
      var head = threadTableHeader(cells);
      if (head && head.refuse) { refusals.push(head.refuse); columns = null; continue; }
      if (head) { columns = head; continue; }
    }

    if (THREAD_NOT_A_LOT_RE.test(line)) continue;

    // A HEADING CAN DECLARE ITS OWN ABBREVIATION, and Fred K's trade-good
    // blocks do nothing else: `Alchemist Ink (AI)` heads eight lines that each
    // open with a bare `AI`. Expanding it here rather than keeping a table of
    // codes is what keeps this safe — the post says what its letters mean, so
    // there is no `AG` / `AG Codes` collision to arbitrate, and a block that
    // declares nothing expands nothing.
    var bare = line;
    if (alias && new RegExp('^' + alias.code + '\\b', 'i').test(bare)) {
      bare = alias.item + bare.slice(alias.code.length);
    }
    var lot = threadTableLot(raw, columns) || threadBareLot(bare, resolve) ||
      threadRuleLot(line) || threadBuyerLot(bare, buyers);
    if (lot) {
      // A FOUR-DIGIT YEAR IS NOT A QUANTITY, and this is the one misread that
      // does real damage, because it multiplies. Auctioneers date a prior-season
      // token in front of its name — Lord Brian's `2021 UR Pants of Focus -
      // Lanfear = $50` — and a rule reading a leading number as the count takes
      // 2021 of them, turning a $50 lot into a $101,050 one.
      //
      // Guarded HERE rather than in one grammar because every rule that reads a
      // leading or parenthesised number can hit it: 2022's
      // `Orb of Dragonkind (Dragonelle) (2017) - $705` was the same defect from
      // the other end of the line. Measured, the band is empty of real data:
      // the largest quantity contextItems records is 230, the largest this
      // corpus parses outside the band is 105, and NOTHING falls between 200
      // and 1899.
      if (lot.quantity >= 1900 && lot.quantity <= 2100) lot.quantity = 1;
      // A LINE LISTING SEVERAL PARENTHESISED COUNTS IS A BUNDLE, and none of
      // them is the lot's. 20246 sells
      // `Safehold III (1), Hireling Stewards (5), Underling Stewards (5), and
      // Follower Stewards (5) - $1,555 - Leela` as one lot; the grammar took the
      // LAST parenthetical for the quantity and proposed $7,775 — five times the
      // $1,555 the sheet records, and the same multiplying misread as the
      // four-digit year, which is why it is guarded in the same place.
      //
      // The test is that a bare `(N)` SURVIVES in the item text after the rule
      // has taken its own. A single quantity parenthetical leaves nothing
      // behind, and a name that legitimately parenthesises something —
      // `Path to Enlightenment (Fragment 2)`, `Herald Token (20 Unique)`,
      // `Alchemist's Ink (x51)` — has a letter inside the brackets and is out of
      // this pattern's reach.
      if (lot.quantity > 1 && /\(\s*\d+\s*\)/.test(String(lot.item == null ? '' : lot.item))) {
        lot.quantity = 1;
      }
      var fromHeader = !lot.item;
      if (!lot.item) lot.item = header;
      if (!lot.item) { unparsed.push({ line: line, why: 'no item name above it' }); continue; }
      if (THREAD_NOT_A_LOT_RE.test(lot.item)) continue;
      // `10x $25` under a plain heading is one lot of ten priced as a lot;
      // under an `(N - individual)` heading it is ten tokens priced each.
      if (lot.xMarked && !(fromHeader && /\b(individual|each)\b/i.test(lot.item))) {
        lot.lotSize = lot.quantity;
        lot.quantity = 1;
        // Provisional: closeXGroup undoes it if the counts under this heading
        // add up to the stock the heading says was on offer.
        if (fromHeader) xGroup.push(lot);
      }
      lot.line = line;
      lot.section = section;
      lots.push(lot);
      continue;
    }

    if (threadLooksLikeHeader(line)) {
      closeXGroup();
      header = line;
      // `Alchemist Ink (AI)`, `24 Elvish Bismuth (EB) (bids are for each …)`.
      // The code is two to four capitals in their own parentheses; what stands
      // in front of them is the item. Cleared on every heading, so a code never
      // outlives the block that declared it.
      // The stock on offer can stand in FRONT of the name as easily as behind
      // it — `24 Elvish Bismuth (EB)` beside `Oil of Enchantment (OE) (15)` in
      // the same post — and a leading count blocks resolution where a trailing
      // parenthetical is already stripped by threadTidyName. Dropped only here,
      // where the heading has declared a code and is therefore naming an item.
      var declared = line.match(/^\s*(.*?[A-Za-z].*?)\s*\(([A-Z]{2,4})\)/);
      alias = declared
        ? { code: declared[2], item: declared[1].replace(/^\s*\d+\s+/, '') }
        : null;
      continue;
    }
    if (/\$\s?\d|\d+\s*@/.test(line)) unparsed.push({ line: line, why: 'carries a price but matched no grammar' });
  }
  closeXGroup();
  settleXGroups();

  // ANOTHER PASS, while the buyer set is still growing. Who bought anything at
  // all in this post is only known once a pass has finished, and threadBuyerLot
  // needs it — and each pass that reads new lines can name buyers the one
  // before it could not. 202415's `Felurian` appears on three lines and all
  // three are `25K bar`, so nothing but a second round reaches him.
  //
  // A buyer field of several words is taken by its LAST word: the rules that
  // had a separator to work with put a name there (`Dr. Hooves`,
  // `Big McIntosh`), and the one rule that has none —
  // `10 Treasure Chips (x3) Trip $31` — leaves the item text in front of it.
  // Three letters and a capital, so `(4)` and `#007` cannot enter.
  //
  // It terminates because the set only ever grows and every pass that adds
  // nothing stops. In practice that is two rounds, three at the most.
  if (!buyers || buyers.$open) {
    var known = { $open: true }, added = false, b, w;
    for (b in (buyers || {})) if (b !== '$open') known[b] = true;
    for (b = 0; b < lots.length; b++) {
      var field = String(lots[b].buyer == null ? '' : lots[b].buyer).replace(/[.,;:!]+$/, '').trim();
      var words = field.split(/\s+/);
      w = words.length === 1 ? words[0] : words[words.length - 1];
      if (!/^[A-Z][A-Za-z.'-]{2,}$/.test(w)) continue;
      if (known[w.toLowerCase()]) continue;
      known[w.toLowerCase()] = true;
      added = true;
    }
    if (added) return threadScanPost(text, resolve, known);
  }
  return { lots: lots, unparsed: unparsed, refusals: refusals };
}

// ===========================================================================
// Pure rules — resolution and pricing
// ===========================================================================

/**
 * Rewrites tried, in order, ONLY after the shared resolver has already failed.
 *
 * A fallback cannot change a name that resolves, which is what makes this safe
 * to add without re-verifying the 18,466-lot Trent corpus: `resolveToken` runs
 * first and unchanged, and nothing here is reached unless it returned nothing.
 *
 * Every entry is a spelling counted across the 24 threads, not a guess:
 *
 *   trailing lot number   `PYP 1` .. `PYP 16`, `Ring of the 4th Circle 1` ..
 *                         `6`. Ralykam and Casey Wren both number lots without
 *                         a `#`, which is the only mark `stripDecorations`
 *                         looks for; 20236 alone carries 120 such lines. Only
 *                         ever a fallback — `Rod of Seven Parts Segment 5` and
 *                         `Patron Token 1` really do end in a number and
 *                         resolve before any of this runs. Its POSITION in the
 *                         list is load-bearing; see the rule.
 *   leading year          `2025 Treasure Chips`, `2023 Patron Lapel Pin`
 *   `of` for `to`         `Path of Enlightenment Fragment 4` — three auctions
 *                         write "of" and the sheet records "to".
 *   unparenthesised       `Fragment 4` for `(Fragment 4)`
 *   `&` for `and`         `Adventurer's Guild Button & code`
 *   code parentheticals   `Patron Pin (and code)`, `AG Button (and Code)`
 *   `Reserve` for `Gold`  `1k Gold Reserve Bar`, `1,000 GP Reserve Bar` —
 *                         5 auctions, the most common single miss there is.
 */
var THREAD_FALLBACKS = [
  // (`(xN)` — Tyler's stock-available marker — is stripped in threadTidyName,
  // not here. A fallback would make his items RESOLVE while still REPORTING the
  // name with the marker on, and a context candidate is reported by name.)

  // A TIER MARKER IN PARENTHESES IS NOT PART OF THE NAME, and this must run
  // first or nothing below it matches. `+1 Turkey Leg of Smiting (UR)`,
  // `+1 Turkey Leg (rare)`, `2022 Patron Lapel Pin (w/ all associated Codes)`.
  function (s) { return s.replace(/\s*\((?:ur|rare|uncommon|ultra rare(?: token)?|no pins? available|w\/[^)]*|with [^)]*|and [^)]*)\)\s*$/i, ''); },
  function (s) { return s.replace(/\s*[\(\[]?\s*(and|w\/?|with)\s+(vtd\s+)?codes?\s*[\)\]]?\s*$/i, ''); },
  function (s) { return s.replace(/\s*&\s*/g, ' and '); },
  function (s) { return s.replace(/\[([^\]]*)\]/, '($1)'); },   // [Great Wyrm] -> (Great Wyrm)
  function (s) { return s.replace(/\bpath of enlightenment\b/i, 'Path to Enlightenment'); },
  // `Path Fragment #3` — alesiev drops the middle of the name and keeps only
  // the two words that bracket it. Left unread it is the whole 8k Bonus row,
  // the single most valuable lot in the auction ($955), and it was proposed
  // as a context candidate called `Path Fragment`. The trailing `#3` has
  // already come off as a lot number by the time this runs, which costs
  // nothing: a season holds exactly one fragment, which is why the bare
  // `Fragment` rule below exists at all.
  function (s) { return s.replace(/\bpath fragment\b/i, 'Path to Enlightenment Fragment'); },
  function (s) { return s.replace(/\s+fragment\s+(\d+)\s*$/i, ' (Fragment $1)'); },
  // A BARE `Fragment` WITH NO NUMBER. Steve heads the lot `Path of Enlightenment
  // Fragment` — which fragment is not in doubt, because a season has exactly
  // one and `Path to Enlightenment` alone already resolves to it. Runs after
  // the numbered rule above, which has by then turned any `Fragment 1` into
  // `(Fragment 1)` and put it out of this one's reach.
  function (s) { return s.replace(/\s+fragments?\s*$/i, ''); },
  function (s) { return s.replace(/^.*\b(gold\s+)?reserve bar\b.*$/i, '1,000 GP Gold Bar'); },
  function (s) { return s.replace(/^.*\b1,?000 gp bars?\b.*$/i, '1,000 GP Gold Bar'); },
  // A CONSOLIDATED BAR IS GOLD, whatever it is called — `25K Eldritch Ore Bar`,
  // `5K Mithral Bar`, `5K bar`. The same test that gives the lot size gives the
  // name, so the two can never disagree: a bar this resolves must also divide.
  function (s) { return threadGoldBarSize(s) ? '1,000 GP Gold Bar' : s; },

  // TWO TOKENS, AND ONE NAME CONTAINS THE OTHER. `+1 Turkey Leg of Smiting` is
  // the 2k Bonus; `+1 Turkey Leg` is the Preorder Bonus. Threads write both
  // without the `+1`, so a rule that tests for "turkey leg" first collapses 87
  // lots across the 2022 season into one price series. Smiting is checked
  // first, and both are absolute rather than substitutions so they cannot
  // double-prefix a name that already carries the `+1`.
  function (s) { return /turkey leg of smiting/i.test(s) ? '+1 Turkey Leg of Smiting' : s; },
  function (s) { return /turkey leg/i.test(s) ? '+1 Turkey Leg' : s; },

  // A Treasure Draw is three Treasure Chips — see threadDrawLotSize for the
  // arithmetic, which is the part that matters.
  function (s) { return /treasure draws?/i.test(s) ? 'Treasure Chip' : s; },
  // Josh M calls the same thing a Treasure Token, and writes the three out:
  // `3x Treasure Tokens (16) – Reginald @ 7.25` is sixteen lots of three chips
  // at $2.42, which is what 202216 records. Anchored to the WHOLE name, unlike
  // the Draw rule above — "treasure token" is the community's generic term for
  // any token at all, and a loose match would swallow real ones.
  function (s) { return /^\s*treasure tokens?\s*$/i.test(s) ? 'Treasure Chip' : s; },

  // The CODE is the value; the pin is not. So a code sold without its pin is
  // still the Patron Pin item, and `2022 Patron Lapel Code (No Pins Available)`
  // belongs in that price series rather than beside it. Confirmed by the
  // maintainer 2026-08-24.
  function (s) { return /\bpatron\b/i.test(s) && /\b(pin|code)\b/i.test(s) ? 'Patron Pin' : s; },

  function (s) { return s.replace(/\bag buttons?\b/i, "Adventurers' Guild Button"); },
  function (s) { return s.replace(/^.*\badventurer'?s'? guild\b.*$/i, "Adventurers' Guild Button"); },
  function (s) { return s.replace(/\balchemist (ink|parchment)\b/i, function (m, w) { return "Alchemist's " + w; }); },
  function (s) { return s.replace(/\benchanter munition\b/i, "Enchanter's Munition"); },
  function (s) { return s.replace(/\belvish bismuth\b/i, 'Elven Bismuth'); },
  // `Avron's` for `Averon's`. Casey Wren drops the middle syllable, and 20242's
  // two Preorder Bonus lots — 32 tokens — were proposed as an augment named
  // after the typo, one of them at the auction's own recorded $0.50. No CSV
  // anywhere spells it `Avron`, so there is nothing here to arbitrate.
  function (s) { return s.replace(/\bavron(['’]s)?\b/i, "Averon's"); },
  // `Avery Potions` is Fred K's name for `Averon's Cherry Ale` — CONFIRMED by
  // the maintainer 2026-08-25, and asked rather than assumed because it is not a
  // contraction the way his `AI` and `AP` are, and `Averon's` also names a
  // `+3 Cherry Bomb`, a `Cherry Wine` and a `Cherry Mead`. The evidence that
  // made it worth asking: his heading says `Avery Potions (44)`, his two lines
  // are 24 and 20, and the first is priced at the $0.25 the sheet records as
  // 202415's Preorder Bonus.
  // Absolute, not a substitution, because the line carries a count in front of
  // it — `24 Avery Potions` — and a rewrite in place leaves `24 Averon's Cherry
  // Ale`, which resolves to nothing just as surely.
  function (s) { return /\bavery\s+potions?\b/i.test(s) ? "Averon's Cherry Ale" : s; },

  // AN ORDINAL SPELLED OUT IS THE SAME ORDINAL. Flik writes
  // `Mark of the Third Tenet` where the sheet writes `Mark of the 3rd Tenet` —
  // and says so himself in post #1, "I will be keeping ... two Mark of the
  // Third Tenets", against the two withheld `Mark of the 3rd Tenet` rows the
  // sheet records for that auction. Left unresolved it is the worst class this
  // file produces: 202413's own 2k Bonus, proposed as an augment at the 2k
  // Bonus's own recorded $115.
  //
  // First to fifth only. Those are the ordinals the Rings of the Circle and the
  // Marks of the Tenets use, and they are the whole reason this exists;
  // rewriting every ordinal in English would reach words that are not ordinals
  // at all in a name (`Second Wind`, and `First` in a title).
  function (s) {
    return s.replace(/\b(first|second|third|fourth|fifth)\b(?=\s+(?:circle|tenet|tooth|mark|ring))/gi,
      function (w) {
        return { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th' }[w.toLowerCase()];
      });
  },
  // ...and the same word AFTER an `of the`, which is how both of them are
  // actually written: `Mark of the Third Tenet`, `Ring of the Fifth Circle`.
  function (s) {
    return s.replace(/\bof the (first|second|third|fourth|fifth)\b/gi, function (all, w) {
      return 'of the ' + { first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th' }[w.toLowerCase()];
    });
  },

  // `3th` FOR `3rd`. Beertram writes `Ring of the 3th Circle` eight times in
  // 20246 — every 1k Bonus lot of the auction — and the name resolved to
  // nothing, so the 1k Bonus was missing from the prices and eight phantom
  // context candidates stood in its place.
  //
  // Only 1, 2 and 3 are rewritten, because only those three have a suffix other
  // than `th`; `4th` and `5th` are correct and this must not touch them. The
  // teens are excluded by the digit before, which is what makes `13th` safe.
  // Measured: no tokenMetadata name anywhere contains `1th`, `2th` or `3th`.
  function (s) {
    return s.replace(/(^|[^\d])([123])th\b/gi, function (all, pre, d) {
      return pre + d + (d === '1' ? 'st' : d === '2' ? 'nd' : 'rd');
    });
  },

  // THE ORDINAL MIGRATED TO THE FRONT OF THE NAME. The 2024 2k Bonus is
  // `Mark of the 3rd Tenet`, and Beertram writes `3rd Mark of the Tenet (UR)` —
  // four lots, $415, and the auction's whole 2k Bonus row. The ordinal is the
  // only part that moved, so it is moved back: a leading ordinal is pushed in
  // behind an `of the` that the rest of the name already carries.
  //
  // Safe because it needs BOTH ends — a leading ordinal and an `of the` — and
  // because no tokenMetadata name begins with an ordinal at all, so nothing
  // that already resolves can reach this. Note `Mark of the 3rd` on its own
  // resolves before any of this: the suffixed word is not what was missing.
  function (s) {
    return s.replace(/^\s*(\d+(?:st|nd|rd|th))\s+(.*?\bof the\b)\s+(.+)$/i,
      function (all, ord, head, tail) { return head + ' ' + ord + ' ' + tail; });
  },
  // A leading year, or a RUN of them: Lord Brian sells one PYP lot covering two
  // seasons and writes `2021 or 2022 PyP`. Stripping a single year left
  // `or 2022 PyP`, which resolves to nothing, so 202211's Ultra Rare row — 34
  // tokens at $105 — was proposed as three phantom augments instead.
  function (s) { return s.replace(/^(?:(?:19|20)\d{2}\s*(?:or|and|\/|&|[-–])\s*)*(?:19|20)\d{2}\s+/i, ''); },
  // A leading tier marker, for the case threadTidyName cannot reach: a name
  // whose year came off HERE, above, leaving `UR Pants of Focus` behind after
  // tidying already ran. `UR` only — see threadTidyName for why never `PYP`.
  // Measured safe: no tokenMetadata name begins with `UR` as a word, and none
  // even begins with those two letters.
  function (s) { return s.replace(/^ur\s+(?=.*[A-Za-z])/i, ''); },
  // A TRAILING LOT NUMBER, and its position in this list is the whole point.
  //
  // Casey Wren lists every lot on its own line — `Ring of the 4th Circle 1` ..
  // `6`, `PYP 1` .. `12` — so 20236 alone carries 120 of these. It used to sit
  // LAST, where two rules had already destroyed the name before it could act:
  // the `pyp` rule below turned `PYP 1` into a bare `1`, and the `of` rule near
  // the end turned `Ring of the 4th Circle 1` into `Ring the 4th Circle 1`,
  // which strips to a name no season has.
  //
  // It cannot move any earlier than this either: the fragment rule above needs
  // the number, because `Path to Enlightenment Fragment 4` becomes
  // `(Fragment 4)` and the 4 is part of the item. After the year strip and
  // before every semantic rewrite is the only place it works.
  //
  // Safe here for the reason it was always safe: `resolveToken` runs FIRST and
  // unchanged, so the four real names ending in a number — `Rod of Seven Parts
  // Segment 5/6/7` and `Patron Token 1` — resolve before any fallback is tried.
  function (s) { return s.replace(/\s+\d+\s*$/, ''); },

  // A TRAILING BARE `token`. Josh M writes `Ring of the 4th Circle token`, which
  // is the 1k Bonus and was proposed instead as an eight-count AUGMENT worth
  // $640 — a false augment for the auction's own standard content, which is the
  // most dangerous thing this file produces because the row looks right.
  //
  // Safe for the same reason the lot-number strip above is: `resolveToken` runs
  // first, so the three names that really end in the word — `Stalker Token`,
  // `Herald Token (20 Unique)` and `Patron Token 1` — resolve before any
  // fallback runs and never reach this.
  function (s) { return s.replace(/\s+tokens?\s*$/i, ''); },

  // `GibGub's Handy Acorn` closed up, for `Gib Gub's Handy Acorn` — the
  // Preorder Bonus. WM13 and David Harris both write it that way, and in both
  // auctions the lot was proposed as an augment of 32 at the recorded Preorder
  // Bonus price.
  function (s) { return s.replace(/\bgib\s*gub(['’]s)?\b/i, "Gib Gub's"); },

  // Fred K pluralises it. `PYP's` reaches the rule below as a name whose only
  // surviving word is `'s`, which resolves to nothing, so the possessive and
  // the plural are folded into the bare form first.
  // PYP IS AN ABBREVIATION, and Kusig writes it out: `Pick Your Purple URs`.
  // Folded to `PYP` first so the three rules below — the possessive, the marker
  // strip and the bare `URs` — all reach it unchanged. Without this his PYP lots
  // resolve to nothing and 202336 and 202346 each lose their `Ultra Rare` row
  // while proposing six phantom context candidates named after it.
  function (s) { return s.replace(/\bpick\s+your\s+purple\b/i, 'PYP'); },
  function (s) { return s.replace(/\bPYP['’]?s\b/i, 'PYP'); },
  // `PYP Ultra Rare` is an Ultra Rare. Dropping the marker only where a WORD
  // survives keeps a bare `PYP` — which EXCEPTIONS already resolves — from
  // becoming an empty string. A letter, not merely a non-empty string: with the
  // looser test `PYP 1` dropped to `1`, and a lot number is not a name.
  function (s) {
    if (!/\bpyp\b/i.test(s)) return s;
    var rest = s.replace(/\bpyp\b/i, '');
    return /[A-Za-z]/.test(rest) ? rest : s;
  },
  // What is left of `PYP URs` once the marker is gone. Anchored to the WHOLE
  // name so `Random UR` — a context item, not a token — stays unresolved.
  function (s) { return /^\s*urs?\s*$/i.test(s) ? 'Ultra Rare' : s; },
  // The Orb of Dragonkind's variant is parenthesised in `tokenMetadata` and
  // punctuated three ways in the threads: `[Great Wyrm]` (handled by the
  // bracket rewrite), `- Great Wrym` and a bare `Great Wrym`. Normalise the
  // separator and the transposition — `Wrym` for `Wyrm` is the single most
  // common typo in this corpus, and it is always the dragon.
  function (s) {
    return s.replace(/\borb of dragonkind\b\s*[-–—]?\s*\(?\s*([A-Za-z][A-Za-z ]*?)\s*\)?\s*$/i,
      function (m, v) { return 'Orb of Dragonkind (' + v.replace(/\bwrym\b/i, 'Wyrm') + ')'; });
  },
  // `Potion of Condensed Healing` is recorded as `Potion Condensed Healing`,
  // and Fred K shortens it again to `Condensed Healing`.
  function (s) { return /^\s*condensed healing\s*$/i.test(s) ? 'Potion Condensed Healing' : s; },
  function (s) { return s.replace(/\s+of\s+/i, ' '); },
];

/**
 * The shared resolver first, then the rewrites above, cumulatively.
 *
 * Cumulative rather than one at a time because the misses stack: `2023 Patron
 * Lapel Pin (and Code)` needs the parenthetical off AND the year off before any
 * table has a chance at it.
 */
function threadResolveName(base, season, index, bag) {
  var hit = resolveToken(base, season, index);
  if (hit) return { token: hit, as: base };
  // A recognised bag resolves to its canonical name before any rewrite is
  // tried, because none of them would reach it: `8 bags of 120 rares (no Urs)`
  // shares no prefix with `Rare Bag`.
  if (bag) {
    hit = resolveToken(bag, season, index);
    if (hit) return { token: hit, as: bag };
  }
  var name = base;
  for (var i = 0; i < THREAD_FALLBACKS.length; i++) {
    var next = THREAD_FALLBACKS[i](name).replace(/\s+/g, ' ').trim();
    if (next === name || !next) continue;
    name = next;
    hit = resolveToken(name, season, index);
    if (hit) return { token: hit, as: name };
  }
  return null;
}

/**
 * Every lot resolved against `tokenMetadata`, grouped by the `Item` the sheet
 * records, with Onyx routed out and everything unresolved kept as a context
 * candidate rather than aborting.
 *
 * That last part is the difference from `trentClose.gs`, and it is not a
 * loosening of the rule — it is the same rule reaching a different conclusion
 * on different evidence. In a Trent file an unresolved name means the file is
 * wrong. In a thread it usually means an augment or a prop, and the recorded
 * data agrees: 202632's unresolved lines are exactly the five `grunnel` and
 * `augment` rows `contextItems` carries for it.
 */
function threadResolveLots(lots, season, index) {
  var per = {}, order = [], onyx = {}, onyxOrder = [], context = [], ambiguous = [], unnamed = [], unsold = [];

  for (var i = 0; i < lots.length; i++) {
    var lot = lots[i];
    // A LOT PRICED AT ZERO WAS NOT SOLD. 202337 lists
    // `AG Button (and code) (4) - $0`, which is the auctioneer saying nobody bid
    // — and the sheet records no row for it, correctly. Proposed as a price it
    // would drag that item's whole series toward zero, and it looks like an
    // ordinary cheap lot.
    //
    // Measured rather than assumed: of 7,754 rows in prices.csv the lowest is
    // $0.03 and NONE is zero. Reported as a leftover, not dropped, because the
    // line was read perfectly well — what it says is that there was no sale.
    if (!(Number(lot.price) > 0)) { unsold.push(lot); continue; }
    var tidy = threadTidyName(lot.item);
    var marked = stripOnyxMarker(tidy);
    // `stripOnyxMarker` calls anything containing the word Onyx an Onyx lot,
    // which is right for Trent's file and wrong for prose: Mike Steele auctions
    // "Tabor's onyx dagger #3", a physical prop the sheet records as a grunnel
    // context item. Requiring that the marker actually sat in one of the three
    // positions the stripper knows — so that something came OFF the name —
    // keeps the shared rule untouched and keeps the prop out of onyx.csv.
    if (marked.isOnyx && marked.name === tidy) marked.isOnyx = false;
    // A lot under an `ONYX ITEMS` / `Onyx URs` heading is an Onyx lot even when
    // its own name carries no marker. Utaku writes both — `+2 Sacred Sling
    // (Onyx)` under `ONYX ITEMS` — but Flik writes only the heading, and his
    // sixteen chase tokens are indistinguishable from ordinary Ultra Rares
    // without it.
    if (lot.section === 'onyx') marked.isOnyx = true;

    // `ONYX or PYP`. kurtreznor marks nine lots this way and explains them:
    // "PYPs by default, but if you want to bid on that ONYX token, you may do
    // so — you must BEAT the PYP bids to win the ONYX token." All nine closed
    // at $110 to one bidder.
    //
    // The plan lists this as something to surface rather than decide, and the
    // recorded answer turns out to be BOTH: 20222 carries all nine as Onyx
    // rows AND records `Ultra Rare` at $110 in prices.csv. So they are proposed
    // as Onyx and listed separately, with what the sheet did last time.
    if (THREAD_ONYX_OR_PYP_RE.test(tidy)) {
      marked = stripOnyxMarker(tidy.replace(THREAD_ONYX_OR_PYP_RE, ''));
      marked.isOnyx = true;
      ambiguous.push({ name: marked.name, price: lot.price, line: lot.line });
    }
    // THIS SEASON'S OWN YEAR IN FRONT OF A NAME IS DECORATION, and it has to
    // come off HERE — before `parseQuantity` and `stripDecorations`, both of
    // which read a lot size off the FRONT of a name and are blocked by anything
    // standing there.
    //
    // 202312's chips are headed `2023 3x Treasure Chips (16)`. The `3x` was
    // therefore invisible: no lot size, no `stripDecorations`, no resolution —
    // so the auction's own Treasure Chips were proposed as an AUGMENT at $8.75
    // against a recorded $2.92, which is exactly $8.75 / 3. The resolution
    // fallbacks already strip a leading year, but by then the damage is done.
    //
    // ONLY the auction's own season. A year that is NOT is the mark of an
    // augment — a prior season's stock out of the auctioneer's own collection —
    // and 202331's `2022 10x Treasure Chips (Use by 1/4/23)` is recorded by the
    // maintainer under exactly that name, year and `10x` and all.
    var ownYear = String(marked.name).match(/^\s*((?:19|20)\d{2})\s+([\s\S]+)$/);
    if (ownYear && ownYear[1] === String(season)) marked.name = ownYear[2];
    var q = parseQuantity(marked.name);
    // Two places can state a lot size and both count: the item's own name
    // (`10x Darkwood Plank`, the rule verified against 18,466 Trent lots) and
    // the line the lot is on (`10x $25 - Miriam Dom`).
    //
    // A BAG NEVER DIVIDES. See THREAD_BAG_TRIGGER_RE: the 120 in
    // `120x Random Rare` is what is inside the bag, and dividing by it turns a
    // $65 bag into a $0.54 trade good that looks entirely reasonable.
    var bag = threadBagName(marked.name);
    var lotSize = bag ? 1 : (q.quantity || 1) * (lot.lotSize || 1);
    // A Treasure Draw states its own lot size — three chips — and usually
    // states it twice. See threadDrawLotSize.
    var draw = threadDrawLotSize(marked.name, lotSize);
    if (draw) lotSize = draw;
    // A consolidated gold bar states its own lot size and overrides whatever was
    // read off the line, because the number IS the name: `5K Mithril Bar 1` must
    // divide by five and not by the trailing lot number. See threadGoldBarSize.
    var bars = threadGoldBarSize(marked.name);
    if (bars) lotSize = bars;
    var base = stripDecorations(q.name === undefined ? marked.name : q.name);
    // Per TOKEN, never per lot: `10x Darkwood Plank` at $12 is $1.20 recorded.
    var unit = roundCents(lot.price / lotSize);
    var quantity = lot.quantity * lotSize;

    // AN OFF-ORDER HEADING OUTRANKS AN `(Onyx)` MARKER, so this test comes
    // first. The marker says what the token IS; the heading says whose it is,
    // and only the second decides which file the row belongs in.
    //
    // Kusig's `Augmented Ultra Rares:` block mixes the two — `+2 Sun Scimitar`
    // beside `+2 Chaos Cannon (Onyx)` — and they are all his own tokens. With
    // the marker tested first, the three that carry it were proposed as ONYX
    // rows for 202346 while the six that do not went to context: one section,
    // split down the middle by a suffix. An Onyx auction really does sell an
    // Onyx `+2 Chaos Cannon`, so the extra row looks entirely correct.
    if (lot.section === 'offorder') {
      if (!base) { unnamed.push(lot); continue; }
      context.push({ name: base, price: lot.price, quantity: lot.quantity, lot: lot,
        elsewhere: seasonsResolving(base, index, season) });
      continue;
    }

    if (marked.isOnyx) {
      var onyxName = threadOnyxSetName(base);
      if (!onyx[onyxName]) { onyx[onyxName] = { name: onyxName, obs: [] }; onyxOrder.push(onyxName); }
      onyx[onyxName].obs.push({ price: unit, quantity: quantity, lot: lot });
      continue;
    }

    // An `augment` section is DETECTED but deliberately does NOT route.
    //
    // It looks like it should: contextItems is where the sheet records
    // augments, and an auctioneer who augments with a current-season token
    // would have it proposed as a price. Measured, that rule costs 16
    // reproduced items and buys nothing, because an augment heading does not
    // reliably scope anything — Mike Steele's `Augmented Tokens:` heads his
    // ENTIRE results table, all 159 lots, with no heading after it to close it.
    // Resolution alone already does the job: 20264's fourteen augments include
    // `Ring of the 3rd Circle`, which resolves in 2024 and not in 2026, so it
    // lands in the context list on its own.
    // An `offorder` heading is the auctioneer saying these lots are not part of
    // the 8K order, which settles the question before resolution gets a vote:
    // they belong in contextItems whatever their names resolve to. Without this
    // a personal sale of a current-season token would be proposed as a price.
    // None of 20222's twenty resolve in 2022, so this changes nothing there —
    // it is here so the next thread's do not silently reach the spine.
    // (The `offorder` test itself now sits above the Onyx marker; see there.)
    var resolvedName = threadResolveName(base, season, index, bag);
    var token = resolvedName ? resolvedName.token : null;
    if (!token) {
      // A context candidate with no name is no use to anybody — it is a
      // parse failure wearing a category. Report it as an unread line instead.
      if (!base) { unnamed.push(lot); continue; }
      context.push({ name: base, price: lot.price, quantity: lot.quantity, lot: lot,
        elsewhere: seasonsResolving(base, index, season) });
      continue;
    }
    // A NAMED ULTRA RARE IS NEVER A PRICE ROW. The Ultra Rares an 8K order
    // contains are sold as PYP — the bidder picks the token afterwards — so the
    // spine records them under the single fungible item `Ultra Rare`. A lot that
    // names a SPECIFIC Ultra Rare is therefore something the auctioneer added:
    // either an Onyx lot, which the marker and the `Onyx:` section above have
    // already routed, or an augment out of their own collection.
    //
    // Measured across the whole of prices.csv rather than assumed: of 7,754
    // rows, and 100 named Ultra Rares in tokenMetadata, **zero** rows pair the
    // two. Not one season records a named Ultra Rare as a price.
    //
    // 202351's `Bead of Dark Resistance` is the case. A real 2023 Ultra Rare
    // sold in a Super Condensed auction with no heading to scope it, proposed as
    // a price and recorded by the maintainer as context — and resolution alone
    // could never have told, because it resolves perfectly well in season.
    //
    // Only the specific ones: `Ultra Rare` itself is the PYP lot and must stay
    // in the spine, which is exactly what this must not break.
    if (token.Category === 'Ultra Rare' && token.Item !== 'Ultra Rare') {
      context.push({ name: base, price: lot.price, quantity: lot.quantity, lot: lot,
        elsewhere: seasonsResolving(base, index, season) });
      continue;
    }
    if (!per[token.Item]) { per[token.Item] = { token: token, obs: [] }; order.push(token.Item); }
    per[token.Item].obs.push({ price: unit, quantity: quantity, lot: lot });
  }
  return { per: per, order: order, onyx: onyx, onyxOrder: onyxOrder, context: context, ambiguous: ambiguous, unnamed: unnamed, unsold: unsold };
}

/**
 * The proposed price for one item: the QUANTITY-WEIGHTED MODE, with a tie
 * flagged rather than broken.
 *
 * Weighted by tokens, not by lots, because a lot is whatever size the
 * auctioneer chose to sell — `50 @ $1.50` and `1 @ $1.75` are one lot each and
 * the market price is plainly $1.50.
 *
 * On a tie the LOW value is proposed so the cell is never blank, but `tie` is
 * set and both candidates are shown. See THREAD_CLOSING_RE's neighbour above
 * for why: the recorded corpus splits 8 low / 5 high / 1 midpoint, so there is
 * no rule to follow, only a judgement to make.
 */
function threadPropose(obs) {
  var weight = {}, seen = [], i, p;
  var lots = 0, quantity = 0;
  for (i = 0; i < obs.length; i++) {
    p = obs[i].price;
    if (weight[p] === undefined) { weight[p] = 0; seen.push(p); }
    weight[p] += obs[i].quantity;
    lots++;
    quantity += obs[i].quantity;
  }
  seen.sort(function (a, b) { return a - b; });

  var top = null, tied = [];
  for (i = 0; i < seen.length; i++) {
    if (top === null || weight[seen[i]] > weight[top]) { top = seen[i]; tied = [seen[i]]; }
    else if (weight[seen[i]] === weight[top]) tied.push(seen[i]);
  }
  var parts = [];
  for (i = 0; i < seen.length; i++) parts.push(weight[seen[i]] + ' @ $' + seen[i]);

  return {
    price: top,
    tie: tied.length > 1 ? tied : null,
    lots: lots,
    quantity: quantity,
    distribution: parts.join(', '),
  };
}

// ===========================================================================
// Pure rules — the assistant's other four outputs
// ===========================================================================

/**
 * Sentences that read like something was held back, quoted with their post.
 *
 * DEDUPED, and the deduping is not cosmetic. An auctioneer who reposts the
 * results also reposts the paragraph above them: Mike Steele's thread yields 71
 * candidates that are four distinct sentences, one of them repeated 62 times.
 * Sixty-two copies of the right answer read like noise and get skimmed past —
 * and that sentence, "I'm only keeping the eight Rings of the First Circle", is
 * exactly the `withheld | Ring of the 1st Circle | 8` row the sheet records.
 */
function threadWithheldCandidates(posts) {
  var seen = {}, order = [];
  for (var i = 0; i < posts.length; i++) {
    var sentences = String(posts[i].text).split(/\n/);
    var pieces = [];
    for (var s = 0; s < sentences.length; s++) {
      var parts = sentences[s].split(/(?<=[.!?])\s+/);
      for (var p = 0; p < parts.length; p++) pieces.push(parts[p]);
    }
    for (var j = 0; j < pieces.length; j++) {
      var text = pieces[j].replace(/\s+/g, ' ').trim();
      if (!text || text.length > 220) continue;
      if (!THREAD_WITHHELD_RE.test(text)) continue;
      if (THREAD_WITHHELD_NOISE_RE.test(text)) continue;
      var key = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (seen[key]) { seen[key].repeats++; seen[key].lastPost = posts[i].num; continue; }
      seen[key] = { post: posts[i].num, lastPost: posts[i].num, date: posts[i].date,
        author: posts[i].author, text: text, repeats: 1 };
      order.push(key);
    }
  }
  var out = [];
  for (i = 0; i < order.length; i++) out.push(seen[order[i]]);
  return out;
}

/**
 * Posts that say the auction is over, with a bracket around the close.
 *
 * Post #1 is excluded on purpose and the reason is in THREAD_CLOSING_RE.
 * `bracket` is EVIDENCE, not a proposal: it contained the recorded closeDate
 * in 7 of the 24 threads measured, and where it missed it was usually late,
 * because the announcement trails the close.
 */
function threadCloseEvidence(posts) {
  var hits = [];
  for (var i = 0; i < posts.length; i++) {
    if (posts[i].num <= 1) continue;
    if (!THREAD_CLOSING_RE.test(posts[i].text)) continue;
    var m = String(posts[i].text).match(new RegExp('[^\\n.!?]*' + THREAD_CLOSING_RE.source + '[^\\n.!?]*', 'i'));
    hits.push({ post: posts[i].num, date: posts[i].date, author: posts[i].author,
      quote: (m ? m[0] : '').replace(/\s+/g, ' ').trim().slice(0, 160) });
  }
  if (!hits.length) return { hits: [], bracket: null };
  var first = hits[0];
  var before = null;
  for (i = 0; i < posts.length; i++) {
    if (posts[i].num >= first.post) break;
    if (posts[i].date) before = posts[i].date;
  }
  return { hits: hits, bracket: { from: before || first.date, to: first.date } };
}

// ===========================================================================
// The plan
// ===========================================================================

/**
 * Everything the operator needs to decide, from the pages of one thread.
 *
 * `pages` is an array of raw HTML strings, in order. Kept as a parameter rather
 * than fetched inside so the whole of this file is testable against fixtures
 * with no network — which is what `npm run test:thread` does with 24 real
 * threads.
 */
function threadPlan(pages, target, tokenMetadataRows) {
  var problems = [], posts = [], i;
  for (i = 0; i < pages.length; i++) {
    var pageProblems = threadPageProblems(pages[i]);
    for (var p = 0; p < pageProblems.length; p++) problems.push('page ' + (i + 1) + ': ' + pageProblems[p]);
    posts = posts.concat(threadPosts(pages[i]));
  }
  if (!posts.length) {
    return { ok: false, problems: problems.concat(['no posts could be read from ' + pages.length + ' page(s)']),
      posts: 0, prices: [], onyx: [], context: [], unparsed: [], withheld: [], close: { hits: [], bracket: null } };
  }

  // Which post holds the results.
  //
  // POST #1 WINS WHENEVER IT CARRIES ANY, and that is not laziness about
  // position — it is the only rule that survives Mike Steele's thread. He
  // reposts the whole table as a bid update: 80 of its 165 posts carry a
  // near-complete copy, and the biggest copy is a MID-AUCTION snapshot whose
  // prices are lower than the final ones. "Most lots wins" picks that snapshot
  // and reproduces nothing. Post #1 is edited in place after the close, so it
  // is the final state by construction.
  //
  // Falling through to the best-scoring post covers the two auctioneers who
  // post results separately — Casey Wren and jpotter, both in post #2 — and
  // costs nothing, because in both threads post #1 carries no lots at all.
  // The token index is built BEFORE the posts are scanned, because one rule —
  // threadBareLot — needs it to tell an item from a buyer on a line that has no
  // separator between them. Nothing else in the scan is resolution-aware, and
  // that rule refuses a name the index does not know, so having the index here
  // can only ever make the scan read FEWER lines than a guess would.
  var index = buildTokenIndex(tokenMetadataRows);
  function resolveForScan(name) {
    return threadResolveName(threadTidyName(name), target.auctionSeason, index, null);
  }

  var scans = [], best = null, scan = null, snapshots = 0;
  for (i = 0; i < posts.length; i++) {
    var candidate = threadScanPost(posts[i].text, resolveForScan);
    scans.push({ post: posts[i], scan: candidate });
    if (posts[i].num === 1 && candidate.lots.length > 0) { scan = candidate; best = posts[i]; }
  }
  if (!scan) {
    for (i = 0; i < scans.length; i++) {
      if (!scan || scans[i].scan.lots.length > scan.lots.length) { scan = scans[i].scan; best = scans[i].post; }
    }
  }
  for (i = 0; i < scans.length; i++) {
    if (scans[i].post.num !== best.num && scans[i].scan.lots.length >= Math.max(3, scan.lots.length * 0.8)) snapshots++;
  }
  if (snapshots) {
    problems.push(snapshots + ' other post(s) carry a near-complete copy of the results — this auctioneer ' +
      'reposts the table as a bid update, and those copies are mid-auction prices. Post #' + best.num + ' was used.');
  }
  if (!scan.lots.length) {
    problems.push('no post in this thread carries lines any grammar could read as results — ' +
      'some auctioneers only link a spreadsheet');
  }

  var resolved = threadResolveLots(scan.lots, target.auctionSeason, index);
  var unparsed = scan.unparsed.slice();
  for (i = 0; i < resolved.unnamed.length; i++) {
    unparsed.push({ line: resolved.unnamed[i].line, why: 'read as a lot but its item name came out empty' });
  }
  for (i = 0; i < resolved.unsold.length; i++) {
    unparsed.push({ line: resolved.unsold[i].line, why: 'priced at zero — read as a lot that did not sell' });
  }

  var prices = [];
  for (i = 0; i < resolved.order.length; i++) {
    var item = resolved.order[i];
    var entry = resolved.per[item];
    var proposal = threadPropose(entry.obs);
    prices.push({
      Item: entry.token.Item,
      'Display Name': entry.token['Display Name'],
      Category: entry.token.Category,
      Price: proposal.price,
      lots: proposal.lots,
      quantity: proposal.quantity,
      distribution: proposal.distribution,
      tie: proposal.tie,
      line: entry.obs[0].lot.line,
    });
  }
  prices.sort(function (a, b) { return a.Item < b.Item ? -1 : a.Item > b.Item ? 1 : 0; });

  // THE GOLD IN A SUPER OR ULTRA CONDENSED 8K ORDER IS 44 OR 45 BARS
  // *(maintainer, 2026-08-25)*, so the bars such a thread sells should come to
  // that — and this is the only check there is on whether a CONSOLIDATED bar
  // belongs to the order at all.
  //
  // A PLAIN `Condensed` ORDER FOLLOWS A DIFFERENT RULE SET and is out of scope.
  // That is the same fact `auctionStyle` already carries elsewhere — Condensed
  // *without* Super or Ultra means the order included a `Rare Bag` and an
  // `Uncommon Bag` — and the counts agree that it is different: the five
  // Condensed threads on disk give 1, 1, 8, 8 and 64 bars, nowhere near 44.
  //
  // What they do NOT give is a number to check against instead. Every one of
  // those five is read too poorly to measure — 202020's 64 bars come out at
  // $1.75 against a recorded $14, and 202111's grammar is unsupported — so this
  // says nothing about Condensed rather than guessing at it.
  //
  // threadGoldBarSize divides every one of them, because 25 gold bars is what
  // the token IS. But a `25K Eldritch Ore Bar` the auctioneer added from his own
  // collection is an augment, and the arithmetic cannot tell it from the order's
  // own gold — only the TOTAL can. Measured over the 89 forum auctions of
  // 2022-2024, and it holds on 85 of them; every one of the four exceptions is
  // explained by a row the maintainer entered by hand:
  //
  //   20222   35 bars, 9 short  -> `1,000 GP Gold Bar` x9 recorded as WITHHELD
  //   202349  69 bars, 24 over  -> its `25,000 GP Reserve Bar` is a contextItems
  //                               row: 44 of the 69 are the order, the 25K bar
  //                               is not
  //   202415  90 bars, 45 over  -> exactly two orders' worth. Post #1 promises
  //                               to supplement the trade goods from his own
  //                               collection, and the sheet records
  //                               `1,000 GP Gold Bar (Bundle)` at 45 x $9
  //   20225   8 bars            -> a thread the grammars still read only in part
  //
  // Reported, never acted on. Which lots are the order's is a judgement — no
  // subset of 202415's three 25K and three 5K bars sums to 45 — so this says the
  // sum is wrong and leaves the split to the person reading it. Both totals are
  // accepted: 2022 and 2023 run to 44 and 2024 to 45.
  for (i = 0; THREAD_GOLD_COUNTED_RE.test(target.auctionStyle) && i < prices.length; i++) {
    if (prices[i].Item !== '1,000 GP Gold Bar') continue;
    var bars = prices[i].quantity;
    if (bars === 44 || bars === 45) break;
    problems.push('this thread sells ' + bars + ' gold bars and an 8K order holds 44 or 45. ' +
      (bars > 45
        ? 'The surplus is the auctioneer\'s own stock — a consolidated bar counted into the ' +
          'order here may be an augment, and belongs in contextItems rather than the price.'
        : 'Some gold was withheld, or a line carrying it went unread — check the leftovers.'));
    break;
  }

  var onyx = [];
  for (i = 0; i < resolved.onyxOrder.length; i++) {
    var o = resolved.onyx[resolved.onyxOrder[i]];
    var op = threadPropose(o.obs);
    onyx.push({ Item: o.name, 'Display Name': o.name, Category: ONYX_CATEGORY, Price: op.price,
      lots: op.lots, quantity: op.quantity, distribution: op.distribution, tie: op.tie,
      line: o.obs[0].lot.line });
  }
  onyx.sort(function (a, b) { return a.Item < b.Item ? -1 : a.Item > b.Item ? 1 : 0; });

  return {
    ok: prices.length > 0 || onyx.length > 0,
    problems: problems,
    posts: posts.length,
    pages: pages.length,
    resultsPost: best ? best.num : null,
    resultsAuthor: best ? best.author : null,
    prices: prices,
    onyx: onyx,
    context: resolved.context,
    ambiguous: resolved.ambiguous,
    unparsed: unparsed,
    refusals: scan.refusals,
    withheld: threadWithheldCandidates(posts),
    close: threadCloseEvidence(posts),
  };
}

/** The review tab's rows, in the order they are written. */
function threadReviewRows(plan) {
  var rows = [], i;
  var push = function (kind, row) {
    rows.push(['', kind, row.Item, row['Display Name'], row.Category, row.Price,
      row.lots, row.quantity, row.distribution,
      row.tie ? 'TIE — also $' + row.tie.slice(1).join(', $') : '',
      row.line || '']);
  };
  for (i = 0; i < plan.prices.length; i++) push('price', plan.prices[i]);
  for (i = 0; i < plan.onyx.length; i++) push('onyx', plan.onyx[i]);
  for (i = 0; i < plan.context.length; i++) {
    rows.push(['', 'context?', plan.context[i].name, '', '', plan.context[i].price,
      1, plan.context[i].quantity, '',
      plan.context[i].elsewhere.length ? 'resolves in ' + plan.context[i].elsewhere.join(', ') : 'not a token in any season',
      plan.context[i].lot.line]);
  }
  return rows;
}

/** The whole plan as text, for the dialog. */
function threadDescribePlan(plan, auctionId) {
  var out = [], i;
  out.push('Thread for ' + auctionId + ': ' + plan.pages + ' page(s), ' + plan.posts + ' posts.');
  if (plan.resultsPost) out.push('Results read from post #' + plan.resultsPost + ' by ' + plan.resultsAuthor + '.');
  out.push('');

  if (plan.problems.length) {
    out.push('PROBLEMS');
    for (i = 0; i < plan.problems.length; i++) out.push('  • ' + plan.problems[i]);
    out.push('');
  }
  if (plan.refusals && plan.refusals.length) {
    out.push('REFUSED A TABLE');
    for (i = 0; i < plan.refusals.length; i++) out.push('  • ' + plan.refusals[i]);
    out.push('');
  }

  out.push('PROPOSED PRICES — ' + plan.prices.length + ' item(s)');
  var ties = 0;
  for (i = 0; i < plan.prices.length; i++) {
    var r = plan.prices[i];
    if (r.tie) ties++;
    out.push('  ' + (r.tie ? 'TIE ' : '    ') + r.Item + ': $' + r.Price +
      '   [' + r.distribution + ']');
  }
  if (ties) {
    out.push('');
    out.push('  ' + ties + ' item(s) tied on quantity. The low value is proposed so the cell is');
    out.push('  never blank, but the recorded corpus splits 8 low / 5 high / 1 midpoint on');
    out.push('  ties, so there is no rule here — read the distribution and decide.');
  }
  out.push('');

  if (plan.onyx.length) {
    out.push('ONYX — ' + plan.onyx.length + ' item(s), for onyx.csv not prices.csv');
    for (i = 0; i < plan.onyx.length; i++) out.push('  ' + plan.onyx[i].Item + ': $' + plan.onyx[i].Price);
    out.push('');
  }
  if (plan.ambiguous && plan.ambiguous.length) {
    out.push('ONYX or PYP — ' + plan.ambiguous.length + ' lot(s) the auctioneer marked as either');
    for (i = 0; i < Math.min(plan.ambiguous.length, 12); i++) {
      out.push('  ' + plan.ambiguous[i].name + ': $' + plan.ambiguous[i].price);
    }
    out.push('  Proposed as Onyx. The one recorded precedent, 20222, took them BOTH ways:');
    out.push('  all nine are onyx.csv rows AND their price is what prices.csv records as');
    out.push('  Ultra Rare. Decide which this auction is.');
    out.push('');
  }
  if (plan.context.length) {
    out.push('NOT TOKENS — ' + plan.context.length + ' lot(s), most likely contextItems');
    for (i = 0; i < Math.min(plan.context.length, 20); i++) {
      out.push('  ' + plan.context[i].name + ': $' + plan.context[i].price +
        (plan.context[i].elsewhere.length ? '  (resolves in ' + plan.context[i].elsewhere.join(', ') + ')' : ''));
    }
    if (plan.context.length > 20) out.push('  … and ' + (plan.context.length - 20) + ' more');
    out.push('');
  }
  if (plan.withheld.length) {
    out.push('WITHHELD CANDIDATES — ' + plan.withheld.length + ' sentence(s), quoted not parsed');
    for (i = 0; i < Math.min(plan.withheld.length, 8); i++) {
      out.push('  #' + plan.withheld[i].post +
        (plan.withheld[i].repeats > 1 ? ' (repeated ' + plan.withheld[i].repeats + '×, to #' + plan.withheld[i].lastPost + ')' : '') +
        ' "' + plan.withheld[i].text + '"');
    }
    if (plan.withheld.length > 8) out.push('  … and ' + (plan.withheld.length - 8) + ' more');
    out.push('  Take the ITEM and QUANTITY only. The sheet computes the price as');
    out.push('  -(season average) × quantity; never read a price off the post.');
    out.push('');
  }
  if (plan.close.hits.length) {
    out.push('CLOSE DATE — evidence, not a proposal');
    out.push('  bracket: ' + plan.close.bracket.from + ' .. ' + plan.close.bracket.to);
    for (i = 0; i < Math.min(plan.close.hits.length, 5); i++) {
      out.push('  #' + plan.close.hits[i].post + ' ' + plan.close.hits[i].date + ' "' + plan.close.hits[i].quote + '"');
    }
    out.push('  Measured: this bracket contained the recorded closeDate in 7 of 24 threads,');
    out.push('  and missed LATE in most of the rest — the announcement trails the close.');
    out.push('');
  } else {
    out.push('CLOSE DATE — no post in this thread says the auction closed.');
    out.push('');
  }

  out.push('UNREAD LINES — ' + plan.unparsed.length);
  for (i = 0; i < Math.min(plan.unparsed.length, 15); i++) {
    out.push('  ' + plan.unparsed[i].line.slice(0, 110));
  }
  if (plan.unparsed.length > 15) out.push('  … and ' + (plan.unparsed.length - 15) + ' more');
  return out.join('\n');
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook or the network. Nothing above it does.
// ===========================================================================

function addThreadMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Read a forum close from the thread…', 'readForumThread');
}

/** Every page of one Kunena topic, in order. */
function threadFetchPages(url) {
  var first = openFetch(url);
  if (first === null) return { pages: [], error: 'could not fetch ' + url };
  var starts = threadPageStarts(first);
  var pages = [first];
  for (var i = 1; i < starts.length; i++) {
    var next = openFetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'start=' + starts[i]);
    if (next === null) return { pages: pages, error: 'page ' + (i + 1) + ' of the thread would not load' };
    pages.push(next);
  }
  return { pages: pages, error: null };
}

/**
 * Read the thread recorded against an auction, and write the review tab.
 *
 * Writes NOTHING to `prices`, `onyx`, `rawPricesData` or `contextItems`. The
 * review tab is the whole output, on purpose: nothing here is certain enough to
 * go straight into the spine.
 */
function readForumThread() {
  var ui = SpreadsheetApp.getUi();
  var missing = checkTabs();
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }

  var target = forumTargetAuction(ui, 'Read forum thread');
  if (!target) return;
  if (!target.Link || !/forum/i.test(target.Link)) {
    ui.alert('No thread', 'auctionMetadata has no forum Link for ' + target.auctionId + '.', ui.ButtonSet.OK);
    return;
  }

  var fetched = threadFetchPages(target.Link);
  if (!fetched.pages.length) { ui.alert('Cannot run', fetched.error, ui.ButtonSet.OK); return; }

  var plan = threadPlan(fetched.pages, target, readTab(TABS.tokens));
  if (fetched.error) plan.problems.push(fetched.error);

  threadWriteReview(plan, target);
  ui.alert('Forum thread read (script ' + THREAD_VERSION + ')',
    threadDescribePlan(plan, target.auctionId) +
    '\n\nProposals are in "' + THREAD_REVIEW_TAB + '". Nothing else was written.',
    ui.ButtonSet.OK);
}

/** Replace the review tab's contents with this plan's rows. */
function threadWriteReview(plan, target) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(THREAD_REVIEW_TAB);
  if (!sheet) sheet = ss.insertSheet(THREAD_REVIEW_TAB);
  sheet.clear();

  var rows = threadReviewRows(plan);
  var head = ['auctionId ' + target.auctionId, 'post #' + plan.resultsPost, '', '', '', '', '', '', '', '', ''];
  var all = [head, THREAD_REVIEW_COLUMNS].concat(rows);
  sheet.getRange(1, 1, all.length, THREAD_REVIEW_COLUMNS.length).setValues(all);
  sheet.setFrozenRows(2);
}

// Lets Node load the pure functions for testing.
if (typeof module !== 'undefined') {
  module.exports = {
    threadHtmlToText: threadHtmlToText,
    threadPosts: threadPosts,
    threadPageProblems: threadPageProblems,
    threadPageStarts: threadPageStarts,
    threadPostStamp: threadPostStamp,
    threadRuleLot: threadRuleLot,
    threadBareLot: threadBareLot,
    threadBuyerLot: threadBuyerLot,
    threadGoldBarSize: threadGoldBarSize,
    threadTableHeader: threadTableHeader,
    threadTableLot: threadTableLot,
    threadTidyName: threadTidyName,
    threadSectionOf: threadSectionOf,
    threadLooksLikeHeader: threadLooksLikeHeader,
    threadScanPost: threadScanPost,
    threadResolveLots: threadResolveLots,
    threadPropose: threadPropose,
    threadBagName: threadBagName,
    threadOnyxSetName: threadOnyxSetName,
    threadDrawLotSize: threadDrawLotSize,
    threadResolveName: threadResolveName,
    threadWithheldCandidates: threadWithheldCandidates,
    threadCloseEvidence: threadCloseEvidence,
    threadPlan: threadPlan,
    threadReviewRows: threadReviewRows,
    threadDescribePlan: threadDescribePlan,
    THREAD_RULES: THREAD_RULES,
    THREAD_NEVER_PRICE_HEADERS: THREAD_NEVER_PRICE_HEADERS,
    THREAD_REVIEW_COLUMNS: THREAD_REVIEW_COLUMNS,
    THREAD_REVIEW_TAB: THREAD_REVIEW_TAB,
    THREAD_VERSION: THREAD_VERSION,
  };
}
