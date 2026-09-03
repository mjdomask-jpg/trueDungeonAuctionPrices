/**
 * Phase 4 — Auction-open automation.
 *
 * Watches the three places an 8K auction can open — Trent's shop page, the
 * forum's two auction categories, and alesievauctions.com — and proposes the
 * `auctionMetadata` row each new one needs. Proposals land in a review tab. A human ticks the ones that
 * are real, and a second menu item appends those to `auctionMetadata`.
 *
 * NOTHING here writes to a live tab on its own. Phase 2's Trent importer is the
 * project's one unattended writer, and it earned that by reproducing 659 lots
 * exactly. This phase cannot make the same claim: category 584 carries charity
 * auctions, eBay listings, discussion threads and cancelled auctions alongside
 * the real ones, and no title test separates them reliably (measured — see
 * `openLooksLikeEightK`). So it proposes candidates, and a person decides.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It lives in the repo and is copied into the
 * workbook's Apps Script editor, not edited there. `npm run test:open` replays
 * saved copies of all four page shapes through the pure functions below and
 * asserts they reproduce what `auctionMetadata.csv` already records.
 *
 * Everything above `--- Apps Script entry points ---` is pure: no
 * SpreadsheetApp, no UrlFetchApp, no I/O, no globals mutated. That is what
 * makes it testable off-platform, and it is worth keeping that way.
 *
 * This file has no `onOpen`. All six .gs files in this project share ONE
 * global scope, so a second `onOpen` would replace the first rather than add to
 * it and a menu would silently vanish. `trentClose.gs`'s `onOpen` calls
 * `addOpenMenu` when this file is present. Every global here is prefixed
 * `OPEN_` / `open` for the same reason.
 */

// ===========================================================================
// Configuration
// ===========================================================================

/**
 * Shown in every dialog, so the copy pasted into the workbook can be told apart
 * from the copy in the repo at a glance. Bump it with any change to this file —
 * and check what the repo's `main` already holds first, because a bump that
 * matches the existing value is a silent no-op.
 */
var OPEN_VERSION = '2026-09-03.1';

var OPEN_TABS = {
  review: 'auctionOpenReview',
  metadata: 'auctionMetadata',
};

/** Retired tabs that still recalculate. Never write to one. */
var OPEN_OLD_TAB_RE = /OLD$/;

/**
 * Trent's page, and the URL every one of his 111 recorded rows already carries
 * verbatim. His auctions are not separate pages — the shop reuses one
 * collection and edits its description — so the Link cannot identify an
 * auction. The name can: every Trent row is `Trent Auction N`, and the page
 * states N.
 */
var OPEN_TRENT_URL = 'https://www.trenttokens.com/collections/current-auction';
var OPEN_TRENT_AUCTIONEER = 'Trent';

/**
 * Trent's constants, measured across all 111 recorded auctions: `Ultra
 * Condensed` 110/111, `Lightning` 111/111, `No` 110/111 (the exceptions are
 * both 202335, the Onyx one). Safe to propose; the operator still approves.
 *
 * NOT taken from the page. The page describes the ORDER — "This auction is for
 * a 2026 Super Condensed $8k order" — while the sheet records the AUCTION's
 * style, and for auction 33 those two disagree (`Super Condensed` on the page,
 * `Ultra Condensed` in the sheet). Reading the style off the page would have
 * been wrong for every Trent auction ever recorded.
 */
var OPEN_TRENT_DEFAULTS = {
  auctionStyle: 'Ultra Condensed',
  completionStyle: 'Lightning',
  augmentated: 'No',
  targetFunding: '$7,500.00',
};

/**
 * Both forum categories, settled. 176 recorded auctions live in 584 and 2 in
 * 602, and 602 carries auctions that never appear in 584's listing at all — so
 * watching only the busy one silently misses whole auctions.
 */
var OPEN_FORUM_CATEGORIES = ['584', '602'];

/**
 * Categories where a topic must LOOK like an 8K auction before its page is
 * fetched. This is the one place a title test is a filter, and it applies to
 * 602 only.
 *
 * 584 is the auction category: a thread there with no 8K signal is still quite
 * often an auction — seven recorded ones read that way today, because their
 * titles were edited after they closed. **602 is the general discussion
 * category.** A scan of it without this returns 13 threads about damage
 * reduction, fantasy football and how many rooms a run should have, every time,
 * and buries the one auction a year that lands there.
 *
 * What makes the asymmetry safe rather than convenient: the one recorded
 * auction that really does live in 602 — "Alesiev's 8K 2026 Super Condensed
 * Augmented Auction" — carries the signal in its title, and still carries it
 * after a season of title edits. Someone posting an 8K auction in the general
 * category says so in the subject line; that is how anyone finds it.
 *
 * (Two recorded Links say `catid=602`, but only one of those topics is listed
 * there. Kunena serves a topic under whatever catid the URL carries, so the
 * catid in a saved Link proves nothing about where the thread lives — which is
 * why every duplicate check here keys on the topic id alone.)
 *
 * The count of what this skipped is reported on every scan, never swallowed.
 */
var OPEN_SIGNAL_ONLY_CATEGORIES = { 602: true };

/**
 * The third source: alesievauctions.com, a purpose-built auction site.
 *
 * It is a different KIND of source from the other two and the difference is
 * what makes this side of the phase short. Trent's page is prose that has to be
 * pattern-matched, and a forum thread is prose an auctioneer edits all auction
 * long. This site renders one `<a class="auction-card">` per auction out of its
 * own database, with the style, the completion type and the augment flag as
 * discrete `tag-badge` chips rather than as words in a title. So the four
 * fields the forum path refuses to guess at are read here rather than guessed —
 * see OPEN_ALESIEV_TAGS for exactly how far that confidence goes.
 *
 * Two more consequences worth stating:
 *
 *   - **One fetch per scan.** Everything a row needs is on the listing page —
 *     sponsor, start, target and every badge — so no per-auction page is
 *     fetched at all. The forum path needs a feed AND a topic page because the
 *     feed's date is the last post; this listing states the start date itself.
 *   - **No triage.** Every card on a dedicated auction site is an auction, so
 *     there is no equivalent of category 584's charity threads and eBay
 *     listings and every proposal is a `candidate`. The title is still run
 *     through OPEN_PHRASE_HINTS, so if the site ever does carry something that
 *     is not an 8K auction it says so in the notes rather than passing silently.
 *
 * The page is server-rendered — this was checked rather than assumed, because
 * UrlFetchApp runs no JavaScript and a client-rendered listing would come back
 * as an empty shell that parses to zero cards and looks exactly like "no new
 * auctions". `openScanAlesievNotes` reports a zero-card parse as a problem for
 * that reason: on this source, nothing found is a claim worth doubting.
 */
var OPEN_ALESIEV_ORIGIN = 'https://alesievauctions.com';
var OPEN_ALESIEV_LISTING_URL = OPEN_ALESIEV_ORIGIN + '/auctions';
var OPEN_ALESIEV_SOURCE = 'alesievauctions.com';

/**
 * The style ladder this site's auctions sit on.
 *
 * `Ultra Condensed` is the baseline and an Onyx badge moves it to `Onyx Ultra
 * Condensed`. Both strings are already in `auctionMetadata`'s vocabulary — that
 * matters, because § 7 of `validate-prices.mjs` treats a style differing from
 * an existing one only by case or spacing as an ERROR at the PR gate, so a
 * plausible-looking `Onyx Ultra-Condensed` invented here would fail the publish
 * rather than the scan, a long way from the cause.
 */
var OPEN_ALESIEV_BASELINE_STYLE = 'Ultra Condensed';
var OPEN_ALESIEV_ONYX_STYLE = 'Onyx Ultra Condensed';
var OPEN_ALESIEV_LIGHTNING = 'Lightning';
var OPEN_ALESIEV_FIXED_DATE = 'Fixed Date';

/**
 * The three tag-badge axes, and how a card states each one.
 *
 * A badge carries the state TWICE — in its label and in a `tag-badge-active`
 * class — and both are read, because only one of the two was observable when
 * this was written. Both listed auctions render three badges in the same order,
 * and between them they show:
 *
 *   <span class="badge tag-badge tag-badge-active">Onyx</span>       (on)
 *   <span class="badge tag-badge">Non-Onyx</span>                    (off)
 *
 * So for Onyx the label flips AND the class drops, and the two agree. For
 * Augmented and Lightning only the ON rendering has ever been seen: both cards
 * carry both. The negative labels below are therefore a GUESS, and the guess is
 * safe in the one direction that matters — an unrecognised label matches no
 * axis, the axis reads as absent, and absent already means off. Guessing wrong
 * costs a note, never a value.
 *
 * `positive` and `negative` anchor with ^ and $ deliberately. A loose /onyx/
 * would match `Non-Onyx` too and read every non-Onyx auction as Onyx, which is
 * the exact mistake the forum path measured on thread titles: it reads "Non
 * Onyx" and "No Onyx SC" as Onyx and is wrong on 11 of the 66 it guesses at.
 * The badge is a field rather than prose, so anchoring it is honest here in a
 * way it could never be on a title.
 */
var OPEN_ALESIEV_TAGS = {
  onyx: {
    label: 'Onyx',
    positive: /^onyx$/i,
    negative: /^(?:non|no)[- ]?onyx$/i,
  },
  lightning: {
    label: 'Lightning',
    positive: /^lightning$/i,
    negative: /^(?:fixed[- ]?date|(?:non|no)[- ]?lightning)$/i,
  },
  augmented: {
    label: 'Augmented',
    positive: /^augmented$/i,
    negative: /^(?:non|un|no)[- ]?augmented$/i,
  },
};

/**
 * Status chips whose wording suggests the auction is over.
 *
 * Only `Upcoming` has ever been seen — the site went live carrying two
 * scheduled auctions and nothing else, so `badge-live` and whatever it uses for
 * a finished auction are both unobserved. This list exists to raise a NOTE, and
 * nothing here decides a value, so an unobserved wording costs the operator a
 * missing hint rather than a wrong cell. Whatever the chip says is reported
 * verbatim on every proposal either way.
 */
var OPEN_ALESIEV_ENDED_RE = /ended|closed|complete|finished|archiv|cancel/i;

/**
 * Title phrases from OPEN_PHRASE_HINTS that a badge now answers better.
 *
 * The hint list exists because a thread title is the only evidence the forum
 * path has. Here the same three facts come off the badges, so repeating them as
 * notes would add a line of noise to every single proposal and train the
 * operator to stop reading the column. The hints that survive are the ones no
 * badge covers: charity, eBay, cancelled, pre-order, Safehold, Golden Ticket.
 */
var OPEN_ALESIEV_BADGE_NOTE_RE = /condensed|onyx|augment|lightning/i;

/**
 * The category RSS feed, not the HTML listing. The feed is one request per
 * category, gives topic id, current title and last-post date in a stable
 * shape, and does not depend on Kunena's table markup.
 *
 * Two things about it are load-bearing and were measured, not assumed:
 *
 *   - `pubDate` is the LAST post, not the topic's creation. Topic 259798 opened
 *     2026-08-07 and its feed item reads 2026-08-18. So the feed can say WHICH
 *     topics to look at but never when one opened; that comes from the topic
 *     page.
 *   - `title` is the title RIGHT NOW, and auctioneers edit titles all auction
 *     long ("- COMPLETE", "- All Mail Delivered", "Ending short of funding").
 *     So a title captured at open is worth capturing, and matching a topic by
 *     title is not worth attempting. Topic id is the key.
 */
function openFeedUrl(catid) {
  return 'https://truedungeon.com/forum?view=category&catid=' + catid + '&format=feed&type=rss';
}

function openTopicUrl(catid, id) {
  return 'https://truedungeon.com/forum?view=topic&catid=' + catid + '&id=' + id;
}

/**
 * How far back a scan looks, and how many topic pages one run may fetch.
 *
 * The cutoff is the newest recorded `openDate` minus a margin. Filtering on the
 * feed's `pubDate` can only ever over-include: a topic's last post is never
 * earlier than its first, so nothing that opened after the cutoff can be
 * dropped by it. Without a cutoff the first run would treat all ~165 unrecorded
 * topics in the two feeds as new and fetch a page for each, which is both
 * pointless — the operator already decided not to record them — and close to
 * the 6-minute execution cap.
 */
var OPEN_LOOKBACK_MARGIN_DAYS = 21;
var OPEN_MAX_TOPIC_FETCHES = 25;

/**
 * Forum display names, mapped to the `auctioneer` value the sheet already uses.
 *
 * Most resolve mechanically — `openMatchAuctioneer` handles case, a trailing
 * ` - Alex`, a trailing parenthetical, and either name being a prefix of the
 * other, which between them cover "ralykam"/"Ralykam", "alesiev - Alex",
 * "Amanda (Magellan the Ferret Druid)", "Nick"/"Nick Braun" and
 * "Wade Schwendemann (Dr. Uid)"/"Wade S". This table is for the ones no rule
 * can reach, where the forum name and the recorded name share nothing.
 */
var OPEN_AUCTIONEER_ALIASES = {
  'utaku soto': 'Matt Soto',
};

/**
 * Phrases that suggest a topic is an 8K auction rather than one of the many
 * other things category 584 carries.
 *
 * This is a SORT ORDER, not a filter. Measured against the two live feeds: of
 * the 35 recorded auctions whose topics are still in them, the test catches 28,
 * and it also fires on 21 topics that are not auctions at all — discussion
 * threads ("Should TD continue to add items to 8K auctions?"), a $16k auction,
 * cancelled auctions, and an announcement of this very site. Both error
 * directions are common, so nothing is hidden and nothing is filled in blind;
 * candidates simply sort first.
 */
var OPEN_EIGHT_K_RE = /(\b8\s*k\b|\$\s*8\s*k|\b8,?000\b|super[- ]?condensed|ultra[- ]?condensed|\bcondensed\b|\bonyx\b)/i;

/**
 * Phrases that are evidence about style, completion or augments — reported as
 * a note, never written into a cell.
 *
 * Deriving those three from the title was measured and is not good enough:
 * `augmentated` from the title is right on 127 of 178 recorded forum auctions,
 * and `auctionStyle` is wrong on 11 of the 66 it will guess at — it reads "Non
 * Onyx" and "No Onyx SC" as Onyx, and three auctions titled "Super Condensed"
 * are recorded as "Ultra Condensed". A wrong value a human skims past is worse
 * than a blank cell they must fill, so the phrases go in the notes column and
 * the cells stay empty.
 */
var OPEN_PHRASE_HINTS = [
  { re: /super[- ]?condensed|\bSC\b/i, note: 'says super condensed' },
  { re: /ultra[- ]?condensed/i, note: 'says ultra condensed' },
  { re: /\bonyx\b/i, note: 'says onyx' },
  { re: /\bnon[- ]?onyx\b|\bno onyx\b/i, note: 'says NON-onyx' },
  { re: /augment/i, note: 'says augmented' },
  { re: /lightning/i, note: 'says lightning' },
  { re: /safehold/i, note: 'says safehold' },
  { re: /golden ticket|\bGT\b/i, note: 'mentions a golden ticket' },
  { re: /pre[- ]?order/i, note: 'says pre-order' },
  { re: /charity|st\.? jude|cancer|acs-can|shelter|legal aid|mary's hands/i, note: 'looks like a CHARITY auction' },
  { re: /\bebay\b/i, note: 'mentions eBay' },
  { re: /cancell?ed|failed|not funded|didn.t fund/i, note: 'says cancelled or failed' },
];

/**
 * Review columns that are written to the tab as PLAIN TEXT.
 *
 * 1-based, to match `getRange`. Without this Sheets reads what the scan writes
 * and decides it knows better: `2026-09-19` becomes a date, `11:00` becomes a
 * time, `$8,000.00` becomes the number 8000 — and `getValues()` then hands
 * back a Date or a number where the promote step expected the string it wrote.
 * That produced an `openDate` of "Sat Sep 19 2026 01:00:00 GMT-0500 (Central
 * Daylight Time)" in `auctionMetadata`.
 *
 * The number format has to be set BEFORE the values go in; setting it
 * afterwards reformats a value that has already been converted.
 *
 * This is the belt. `openIsoFromCell` and `openMoneyFromCell` are the braces,
 * because a tab written before this existed still holds coerced cells, and
 * because the operator can retype any of these by hand.
 */
var OPEN_REVIEW_TEXT_COLUMNS = [5, 6, 8, 12, 16];

/** The review tab's columns, in order. */
var OPEN_REVIEW_COLUMNS = [
  'Approve?', 'status', 'verdict', 'source', 'openDate', 'first post',
  'auctioneer', 'auctionName', 'season', 'number', 'auctionId', 'Link',
  'auctionStyle', 'completionStyle', 'augmentated', 'targetFunding', 'notes',
];

/**
 * The `auctionMetadata` columns this phase fills in, and the ones it must leave
 * alone.
 *
 * These eleven are the ones a promotion supplies a value for. `daysToClose`,
 * `Status`, `Open Month`, `Close Month`, `augmentedTotal`, `fundingNoAugment`
 * and `preorderTotal` are formulas and are never written; writing a literal
 * into one would replace a formula with a frozen number.
 *
 * `closeDate` stays blank on purpose: `Status` is `IF(closeDate="","Open",
 * "Closed")`, so a blank close date is what makes a new auction read as open.
 */
var OPEN_METADATA_FIELDS = [
  'auctionId', 'auctionSeason', 'auctionNumber', 'auctionName', 'auctionStyle',
  'completionStyle', 'auctioneer', 'Link', 'openDate', 'targetFunding', 'augmentated',
];

/**
 * Two of those eleven are FORMULAS in the workbook, so the formula wins.
 *
 * This was wrong from Phase 4 until 2026-08-24, and the way it was wrong is the
 * useful part. The original list was verified ARITHMETICALLY — does each
 * column's value equal what its formula would compute? — over all 289 recorded
 * rows. That check cannot tell a formula from a literal that agrees with it,
 * and these two agree with theirs on every row:
 *
 *   auctionId    =B2&C2                          always equals season+number
 *   augmentated  =IF(Q2&R2<>"","Yes","No")       always "No" at open time
 *
 * So both looked like inputs and were written as literals, replacing the
 * copied-down formula on every promoted row. Found by running Phase 7's column
 * classifier — which reads formulas rather than values — against a real export.
 *
 * `auctionId` was cosmetic: the literal is the right string. **`augmentated`
 * was not.** Its formula flips to `Yes` when augment values are later entered
 * beside it, and the site reads that column to decide whether an auction was
 * augmented at all. Frozen as a literal `No` at open time it stays `No` for
 * ever, and nothing downstream would ever say so.
 *
 * The value is still computed and still written WHERE THERE IS NO FORMULA TO
 * KEEP — a workbook whose `auctionId` column is genuinely typed still gets a
 * correct id rather than a blank. Which of the two it is gets read, never
 * assumed, exactly as the augment columns already are.
 */
var OPEN_DERIVED_FIELDS = ['auctionId', 'augmentated'];

var OPEN_MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// ===========================================================================
// Pure helpers — HTML and dates
// ===========================================================================

function openDecodeEntities(text) {
  return String(text == null ? '' : text)
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * HTML to plain text, one line per block element.
 *
 * Scripts and styles go first and that is not tidiness: Trent's page carries
 * ~60 KB of inline Shopify configuration containing the words "auction",
 * "start_bid" and "end_date", so any regex run over the raw source finds those
 * before it finds the description a human reads.
 */
function openHtmlToText(html) {
  var text = String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|td|section|article)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  text = openDecodeEntities(text);
  var lines = text.split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+/g, ' ').trim();
    if (line) out.push(line);
  }
  return out.join('\n');
}

/**
 * The innermost `<div>` whose opening tag matches `attr`, with its nesting
 * respected. Returns '' when there is no such div, and the caller falls back to
 * the whole document.
 */
function openSliceDiv(html, attr) {
  var start = html.indexOf(attr);
  if (start < 0) return '';
  var open = html.lastIndexOf('<div', start);
  if (open < 0) return '';
  var depth = 0, i = open;
  var tag = /<(\/?)div\b/gi;
  tag.lastIndex = open;
  var m;
  while ((m = tag.exec(html)) !== null) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { i = tag.lastIndex; break; }
  }
  var end = html.indexOf('>', i);
  return html.slice(open, end < 0 ? html.length : end + 1);
}

/** `MM/DD/YY` or `MM/DD/YYYY` to ISO. Two-digit years are 2000-based. */
function openIsoFromSlashes(mm, dd, yy) {
  var year = yy.length === 2 ? '20' + yy : yy;
  return year + '-' + (mm.length === 1 ? '0' : '') + mm + '-' + (dd.length === 1 ? '0' : '') + dd;
}

/** `07 Aug 2026` to `2026-08-07`. Returns null on anything else. */
function openIsoFromForumDate(dd, mon, yyyy) {
  var m = OPEN_MONTHS[String(mon).toLowerCase()];
  return m ? yyyy + '-' + m + '-' + dd : null;
}

function openShiftIsoDays(iso, days) {
  var parts = String(iso).split('-');
  var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  d.setUTCDate(d.getUTCDate() + days);
  var mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
}

/** RFC-822 (`Tue, 18 Aug 2026 07:29:46 -0500`) to ISO. Null when unparseable. */
function openIsoFromRfc822(value) {
  var m = String(value).match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return null;
  return openIsoFromForumDate(m[1].length === 1 ? '0' + m[1] : m[1], m[2], m[3]);
}

/**
 * A review-tab cell to the ISO date the scan put there.
 *
 * This exists because of a bug that reached `auctionMetadata` before it was
 * caught, and the shape of it is worth keeping in mind for any cell this
 * pipeline round-trips through a sheet.
 *
 * `openWriteReview` writes `openDate` as the STRING '2026-09-19'. Sheets does
 * not store it as one: it recognises the shape, coerces the cell to a real
 * date, and `getValues()` hands back a **JavaScript Date object** — at midnight
 * in the SPREADSHEET's timezone, which is not necessarily the script's. The old
 * `String(row[4])` then produced
 *
 *   Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)
 *
 * which is `Date.prototype.toString()`, and that went into the cell. It is not
 * a date Sheets can parse, so `daysToClose` and `Open Month` stop computing and
 * the exported CSV carries that string into the site's date parsing.
 *
 * Four inputs are accepted, and the last two are repair paths rather than
 * expected shapes: a Date, an ISO string, a Date that has ALREADY been
 * stringified (so a review tab written by the broken version fixes itself on
 * the next scan), and `M/D/YYYY` as Sheets displays a date in a US locale.
 *
 * A Date is read with LOCAL getters, which are the script's timezone. That is
 * right whenever the script and the spreadsheet share a timezone, and
 * `openNormaliseReviewValues` converts using the spreadsheet's own timezone
 * before this is ever reached, for when they do not. Anything unrecognised is
 * returned untouched so the caller can refuse it — see `openPlanPromotion`,
 * which will not promote an openDate that is not ISO.
 */
function openIsoFromCell(value) {
  if (value && typeof value.getFullYear === 'function' && typeof value.getTime === 'function' && isFinite(value.getTime())) {
    var y = value.getFullYear(), mo = value.getMonth() + 1, d = value.getDate();
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }
  var s = String(value == null ? '' : value).trim();
  if (!s) return '';

  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return m[1] + '-' + (m[2].length === 1 ? '0' : '') + m[2] + '-' + (m[3].length === 1 ? '0' : '') + m[3];

  // `Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)` — a Date that
  // has already been through String(). Repairing it rather than refusing it is
  // what lets a tab written by the broken version come good on a rescan.
  m = s.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})\b/);
  if (m) {
    var mon = OPEN_MONTHS[String(m[1]).toLowerCase()];
    if (mon) return m[3] + '-' + mon + '-' + (m[2].length === 1 ? '0' : '') + m[2];
  }

  // A date the operator typed, shown back by Sheets in a US locale. M/D/YYYY is
  // assumed, as it is everywhere else in this file — and a first field over 12
  // cannot be a month, so it is refused rather than read as D/M and guessed at.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m && parseInt(m[1], 10) >= 1 && parseInt(m[1], 10) <= 12) return openIsoFromSlashes(m[1], m[2], m[3]);

  return s;
}

/**
 * A review-tab cell to the money string the sheet records.
 *
 * The same coercion, one column over and less obvious: `$8,000.00` written as a
 * string becomes a currency cell, and `getValues()` returns the NUMBER 8000.
 * `String(8000)` is "8000", which lands in a currency-formatted
 * `targetFunding` cell and still DISPLAYS as $8,000.00 — so this one hides,
 * and it also made the drift note in `openMergeReview` fire on every rescan by
 * comparing "8000" against a freshly parsed "$8,000.00".
 */
function openMoneyFromCell(value) {
  if (typeof value === 'number' && isFinite(value)) {
    var neg = value < 0;
    var fixed = Math.abs(value).toFixed(2).split('.');
    var whole = fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-$' : '$') + whole + '.' + fixed[1];
  }
  return String(value == null ? '' : value).trim();
}

// ===========================================================================
// Pure parsers — the three page shapes
// ===========================================================================

/**
 * Trent's collection page.
 *
 * The description is stable and states everything a row needs in one place:
 *
 *   Auction 33 Start Date: 03/28/26
 *   Current Status: Closing
 *   This auction is for a 2026 Super Condensed $8k order.
 *   All tokens are available for auction except the 9 to 10 random Ultra Rare
 *   and the Golden Ticket. The combined reserve total for all listings in this
 *   auction is at least $7,500.
 *
 * `number` is TRENT'S own per-season count, which restarts every season and is
 * not the sheet's `auctionNumber` — auction 33 of 2026 is the sheet's auction
 * 43. It is the auction's name (`Trent Auction 33`) and the only thing that
 * identifies it, because all 111 of his rows share one Link.
 */
function openParseTrentPage(html) {
  var block = openSliceDiv(html, 'id="collection-description"');
  var text = openHtmlToText(block || html);
  var out = { number: null, startDate: null, status: null, season: null, reserve: null, withheld: null, orderStyle: null, text: text };

  var m = text.match(/Auction\s+(\d+)\s+Start Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (m) {
    out.number = m[1];
    out.startDate = openIsoFromSlashes(m[2], m[3], m[4]);
  }
  m = text.match(/Current Status:\s*([^\n]+)/i);
  if (m) out.status = m[1].trim();
  m = text.match(/for an?\s+(20\d{2})\b([^\n.]*?)\$?8\s*k\b/i);
  if (m) { out.season = m[1]; out.orderStyle = m[2].replace(/\s+/g, ' ').trim() || null; }
  if (!out.season) {
    m = text.match(/\b(20\d{2})\s+SEASON\b/i);
    if (m) out.season = m[1];
  }
  m = text.match(/reserve total[^\n$]*\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (m) out.reserve = m[1];
  m = text.match(/([^\n]*\bavailable for auction\b[^\n]*)/i);
  if (m) out.withheld = m[1].trim();
  return out;
}

/** A category RSS feed to `[{ id, title, pubDate, isoDate, catid }]`. */
function openParseFeed(xml, catid) {
  var items = String(xml).split(/<item>/i).slice(1);
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var chunk = items[i].split(/<\/item>/i)[0];
    var link = openTagText(chunk, 'link');
    var id = link.match(/[?&]id=(\d+)/);
    if (!id) continue;
    var pub = openTagText(chunk, 'pubDate');
    out.push({
      id: id[1],
      catid: String(catid),
      title: openTagText(chunk, 'title'),
      pubDate: pub,
      isoDate: openIsoFromRfc822(pub),
    });
  }
  return out;
}

function openTagText(chunk, tag) {
  var m = chunk.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  if (!m) return '';
  return openDecodeEntities(m[1].replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')).trim();
}

/**
 * A topic page's first post: when it was written, by whom, and the topic's
 * title.
 *
 * Kunena renders every post's real timestamp in a `title` attribute —
 * `<span class="kmsgdate" title="07 Aug 2026 19:46">2 weeks ago</span>` — so
 * the "5 days ago" text on the page is cosmetic and the exact time is one
 * extraction away. Page one is ordered oldest first, so the first `kmsgdate` is
 * the post that opened the topic and the first `kwho` after it is its author.
 *
 * The time is kept, not just the date. Two of the 27 auctions replayed in the
 * test opened at 22:51 and 23:01 in the forum's own timezone and are recorded
 * against the NEXT day — so a proposal near midnight is one a human should look
 * at twice, and they can only do that if the clock is on screen.
 */
function openParseTopic(html) {
  var out = { title: null, openDate: null, openTime: null, starter: null };
  var m = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (m) out.title = openDecodeEntities(m[1]).trim();
  if (!out.title) {
    m = html.match(/<h1[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
    if (m) out.title = openHtmlToText(m[1]).replace(/^TOPIC:\s*/i, '').trim();
  }
  var at = html.search(/class="kmsgdate/i);
  if (at < 0) return out;
  m = html.slice(at).match(/title="(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}:\d{2})"/);
  if (m) {
    out.openDate = openIsoFromForumDate(m[1].length === 1 ? '0' + m[1] : m[1], m[2], m[3]);
    out.openTime = m[4];
  }
  m = html.slice(at).match(/class="kwho[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (m) out.starter = openHtmlToText(m[1]).replace(/\s+/g, ' ').trim();
  return out;
}

// ===========================================================================
// Pure parsers — alesievauctions.com
// ===========================================================================

/**
 * The site's own auction id, from a link. Null for anything else.
 *
 * Strict about the host on purpose. A lenient `/auctions/(\d+)` would also fire
 * on a path that happened to look like one on another domain, and this id is
 * the whole duplicate defence for this source — the same job the topic id does
 * for the forum. A root-relative form is accepted because that is what the
 * listing page's own hrefs are (`href="/auctions/29"`); the absolute form is
 * what gets recorded in the `Link` column.
 */
function openAlesievId(link) {
  var s = String(link == null ? '' : link).trim();
  var m = s.match(/^https?:\/\/(?:www\.)?alesievauctions\.com\/auctions\/(\d+)/i);
  if (m) return m[1];
  m = s.match(/^\/auctions\/(\d+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function openAlesievUrl(id) {
  return OPEN_ALESIEV_ORIGIN + '/auctions/' + String(id);
}

/**
 * `11:00:00 AM` to `11:00`, `12:00:00 AM` to `00:00`, `11:59:00 PM` to `23:59`.
 *
 * 24-hour, because the review tab's time column already holds the forum's
 * 24-hour post times and the near-midnight check compares it as a string.
 * Returns '' rather than a wrong time when nothing parses.
 */
function openTimeTo24h(text) {
  var s = String(text == null ? '' : text);
  var m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?/);
  if (m) {
    var h = parseInt(m[1], 10) % 12;
    if (/p/i.test(m[3])) h += 12;
    return (h < 10 ? '0' : '') + h + ':' + m[2];
  }
  m = s.match(/\b(\d{1,2}):(\d{2})\b/);
  return m ? (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2] : '';
}

/**
 * The listing page to one object per auction card.
 *
 * Scripts and styles go first for the same reason they do on Trent's page: a
 * client-side template holding card-shaped markup would be found before the
 * cards a human sees. This page carries no such template today, which is
 * exactly why stripping costs nothing and is worth keeping.
 *
 * A card is an `<a>` and an `<a>` cannot nest, so the first `</a>` after the
 * opening tag ends it.
 */
function openParseAlesievListing(html) {
  var body = String(html == null ? '' : html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  var open = /<a\b[^>]*\bclass="[^"]*\bauction-card\b[^"]*"[^>]*>/gi;
  var cards = [], m;
  while ((m = open.exec(body)) !== null) {
    var start = m.index + m[0].length;
    var end = body.indexOf('</a>', start);
    cards.push(openParseAlesievCard(m[0], body.slice(start, end < 0 ? body.length : end)));
  }
  return cards;
}

/**
 * One card's opening tag and inner HTML, to the fields a metadata row needs.
 *
 * The `<li>` lines are matched by their LABEL rather than by position. The
 * template makes both `Sponsor:` and `Target:` conditional — each sits in its
 * own block in the served HTML — so a card without a sponsor renders one fewer
 * line and every position after it shifts. Reading `Ends:` as `Target:`
 * because a sponsor was missing is the kind of failure this pipeline has had
 * before, and matching on the label costs nothing.
 */
function openParseAlesievCard(openTag, inner) {
  var out = {
    href: '', id: null, title: '', intro: '',
    status: '', statusClass: '', tags: [], meta: [],
    sponsor: '', startDate: null, startTime: '', startRaw: '',
    endDate: null, endRaw: '', target: null, itemCount: null,
  };
  var m = String(openTag).match(/\bhref="([^"]*)"/i);
  if (m) {
    out.href = openDecodeEntities(m[1]).trim();
    out.id = openAlesievId(out.href);
  }

  // The status chip is a <div class="badge badge-something">. The tag badges
  // live in a <div class="tag-badge-group">, whose class ALSO contains the
  // characters "badge" with a word boundary in front of them, so the group has
  // to be excluded by name rather than by the class test alone.
  var chips = inner.match(/<div\b[^>]*\bclass="[^"]*\bbadge\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
  for (var c = 0; c < chips.length; c++) {
    var cls = (chips[c].match(/\bclass="([^"]*)"/i) || ['', ''])[1];
    if (/tag-badge/.test(cls)) continue;
    out.statusClass = (cls.match(/\bbadge-([a-z0-9-]+)/i) || ['', ''])[1] || '';
    out.status = openHtmlToText(chips[c].replace(/^<div[^>]*>/i, '').replace(/<\/div>\s*$/i, '')).trim();
    break;
  }

  var tagRe = /<span\b[^>]*\bclass="([^"]*\btag-badge\b[^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;
  var t;
  while ((t = tagRe.exec(inner)) !== null) {
    out.tags.push({
      label: openHtmlToText(t[2]).trim(),
      active: /\btag-badge-active\b/.test(t[1]),
    });
  }

  m = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (m) out.title = openHtmlToText(m[1]).replace(/\s+/g, ' ').trim();
  m = inner.match(/<p\b[^>]*\bclass="[^"]*\bauction-description\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (m) out.intro = openHtmlToText(m[1]).replace(/\s+/g, ' ').trim();

  var liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi, li;
  while ((li = liRe.exec(inner)) !== null) {
    var text = openHtmlToText(li[1]).replace(/\s+/g, ' ').trim();
    if (text) out.meta.push(text);
  }
  for (var i = 0; i < out.meta.length; i++) {
    var line = out.meta[i];
    if ((m = line.match(/^Sponsor:\s*(.+)$/i))) { out.sponsor = m[1].trim(); continue; }
    if ((m = line.match(/^Starts:\s*(.+)$/i))) {
      out.startRaw = m[1].trim();
      out.startDate = openAlesievDate(out.startRaw);
      out.startTime = openTimeTo24h(out.startRaw);
      continue;
    }
    if ((m = line.match(/^Ends:\s*(.+)$/i))) {
      out.endRaw = m[1].trim();
      out.endDate = openAlesievDate(out.endRaw);
      continue;
    }
    if ((m = line.match(/^Target:\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i))) { out.target = m[1]; continue; }
    if ((m = line.match(/^([\d,]+)\s*items?\b/i))) { out.itemCount = m[1]; continue; }
  }
  return out;
}

/** `9/19/2026, 11:00:00 AM` to `2026-09-19`. Null when no date is in there. */
function openAlesievDate(text) {
  var m = String(text == null ? '' : text).match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  return m ? openIsoFromSlashes(m[1], m[2], m[3]) : null;
}

/**
 * One tag axis, read off a card's badges.
 *
 * Three outcomes, and they are kept apart because they mean different things:
 *
 *   { state: true }             the badge says on, and its class agrees
 *   { state: false }            it says off, or no badge claims this axis
 *   { state: null, conflict }   the label and the class disagree
 *
 * The conflict case has never been seen and is not expected to be — the label
 * and the class have moved together on every card observed. It exists because
 * this reads a page nobody here controls: if the site starts rendering an
 * inactive `Onyx` chip as a placeholder, that shape means something new, and
 * the useful response is a blank cell and a loud note rather than a confident
 * `Onyx Ultra Condensed` the operator scrolls past.
 */
function openAlesievTag(card, axis) {
  var rule = OPEN_ALESIEV_TAGS[axis];
  var tags = (card && card.tags) || [];
  for (var i = 0; i < tags.length; i++) {
    var label = String(tags[i].label || '').trim();
    if (rule.negative.test(label)) {
      if (tags[i].active) {
        return {
          state: null, found: true, label: label,
          conflict: 'the "' + label + '" badge is marked ACTIVE — a negative label on an active badge is a shape this parser has never seen',
        };
      }
      return { state: false, found: true, label: label };
    }
    if (rule.positive.test(label)) {
      if (tags[i].active) return { state: true, found: true, label: label };
      return {
        state: false, found: true, label: label,
        note: 'the "' + label + '" badge is present but not active, so it is read as off',
      };
    }
  }
  return { state: false, found: false, label: '' };
}

/**
 * The four fields the badges decide, plus what to tell the operator about them.
 *
 * When a card carries NO tag badge at all the markup has changed shape, and all
 * three badge-derived cells are left blank rather than filled with the
 * baseline. That distinction is the point: "this card says non-Onyx" and "this
 * parser can no longer find the badges" both produce `Ultra Condensed` if you
 * are not careful, and only one of them is a fact.
 */
function openAlesievFields(card) {
  var out = { auctionStyle: '', completionStyle: '', augmentated: '', targetFunding: '', notes: [] };

  if (card.target) {
    out.targetFunding = '$' + card.target + (card.target.indexOf('.') < 0 ? '.00' : '');
  } else {
    out.notes.push('no Target line on the card — targetFunding left blank');
  }

  if (!card.tags.length) {
    out.notes.push('NO tag badges on this card — the listing markup has changed, so auctionStyle, completionStyle and augmentated are all left blank. Check the page and this parser.');
    return out;
  }

  var onyx = openAlesievTag(card, 'onyx');
  if (onyx.state === null) {
    out.notes.push('auctionStyle left blank: ' + onyx.conflict);
  } else {
    out.auctionStyle = onyx.state ? OPEN_ALESIEV_ONYX_STYLE : OPEN_ALESIEV_BASELINE_STYLE;
    if (!onyx.found) out.notes.push('no Onyx or Non-Onyx badge on this card, so the baseline ' + OPEN_ALESIEV_BASELINE_STYLE + ' is proposed — every card seen so far carries one, so check it');
    if (onyx.note) out.notes.push('auctionStyle: ' + onyx.note);
  }

  var lightning = openAlesievTag(card, 'lightning');
  if (lightning.state === null) {
    out.notes.push('completionStyle left blank: ' + lightning.conflict);
  } else {
    out.completionStyle = lightning.state ? OPEN_ALESIEV_LIGHTNING : OPEN_ALESIEV_FIXED_DATE;
    if (lightning.note) out.notes.push('completionStyle: ' + lightning.note);
  }

  var augment = openAlesievTag(card, 'augmented');
  if (augment.state === null) {
    out.notes.push('augmentated left blank: ' + augment.conflict);
  } else {
    out.augmentated = augment.state ? 'Yes' : 'No';
    if (augment.note) out.notes.push('augmentated: ' + augment.note);
  }
  return out;
}

// ===========================================================================
// Pure rules — numbering, names, triage
// ===========================================================================

/**
 * The next `auctionNumber` in a season: `max + 1`, never `count + 1`.
 *
 * A failed auction's row is deleted rather than kept, so the numbers it used
 * are burned and the sequence is legitimately sparse — measured: 2020 is
 * missing 8, 2025 is missing 18, 25 and 31, and 2026 is missing 3 and 38. In
 * 2026 a count-based increment would propose 46, which already exists.
 *
 * A season with no rows yet starts at 1.
 */
function openNextNumber(metaRows, season) {
  var max = 0;
  for (var i = 0; i < metaRows.length; i++) {
    if (String(metaRows[i].auctionSeason) !== String(season)) continue;
    var n = parseInt(metaRows[i].auctionNumber, 10);
    if (isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** `auctionId` is the season and the number run together — 289/289 recorded rows. */
function openAuctionId(season, number) {
  return String(season) + String(number);
}

/** The topic id in a forum Link, tolerating `www.`, `http`, and a `#post` anchor. */
function openTopicId(link) {
  var m = String(link == null ? '' : link).match(/[?&]id=(\d+)/);
  return m ? m[1] : null;
}

/** Every topic id `auctionMetadata` already records, as a lookup. */
function openRecordedTopics(metaRows) {
  var seen = {};
  for (var i = 0; i < metaRows.length; i++) {
    var id = openTopicId(metaRows[i].Link);
    if (id) seen[id] = metaRows[i].auctionId;
  }
  return seen;
}

/**
 * Every `auctionId` `auctionMetadata` records, as a lookup.
 *
 * Used to tell a review row's `promoted <id>` marker whether it is still
 * telling the truth. See `openMergeReview`.
 */
function openRecordedAuctionIds(metaRows) {
  var seen = {};
  for (var i = 0; i < metaRows.length; i++) {
    var id = String(metaRows[i].auctionId || '').trim();
    if (id) seen[id] = true;
  }
  return seen;
}

/**
 * The `auctionId` a review row's status claims it was promoted as, or null.
 *
 * Anchored on `promoted` so the `was promoted …` form this file writes for a
 * marker that has gone stale does not match — that one is a record, not a
 * claim, and must not be re-checked and re-cleared on every subsequent scan.
 */
function openPromotedId(status) {
  var m = String(status == null ? '' : status).match(/^promoted\s+(\S+)/i);
  return m ? m[1] : null;
}

/**
 * Every alesievauctions.com auction id `auctionMetadata` already records.
 *
 * The forum's duplicate defence is the topic id and Trent's is season-and-name;
 * this source has a stable per-auction URL, so the id in that URL is the key
 * and it is the strongest of the three. Keeping it in its own lookup rather
 * than folding it into `openRecordedTopics` is deliberate: the two id spaces
 * are unrelated, and site auction 29 must never collide with forum topic 29.
 */
function openRecordedAlesiev(metaRows) {
  var seen = {};
  for (var i = 0; i < metaRows.length; i++) {
    var id = openAlesievId(metaRows[i].Link);
    if (id) seen[id] = metaRows[i].auctionId;
  }
  return seen;
}

/**
 * Every Trent auction already recorded, keyed by SEASON AND NAME.
 *
 * The season is not decoration. Trent's own numbering restarts every season, so
 * the 111 recorded rows carry only 33 distinct names — there is a `Trent
 * Auction 5` in 2023, 2024, 2025 and 2026. Keyed by name alone, the first
 * auction of a new season would be read as a duplicate of last season's and
 * silently never proposed, which is the one failure this side of the phase has.
 */
function openRecordedTrentNames(metaRows) {
  var seen = {};
  for (var i = 0; i < metaRows.length; i++) {
    if (metaRows[i].auctioneer !== OPEN_TRENT_AUCTIONEER) continue;
    seen[openTrentKey(metaRows[i].auctionSeason, metaRows[i].auctionName)] = metaRows[i].auctionId;
  }
  return seen;
}

function openTrentKey(season, name) {
  return String(season).trim() + '|' + String(name).trim().toLowerCase();
}

function openNormaliseName(name) {
  return String(name == null ? '' : name)
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A forum display name, mapped to the `auctioneer` value the sheet already
 * uses. Returns the match and how it was reached, because "no rule reached
 * this" is information the review tab should show rather than swallow.
 *
 * Forum names and recorded names differ constantly: `Wade Schwendemann
 * (Dr. Uid)` is recorded as `Wade S`, `ralykam` as `Ralykam`, `alesiev - Alex`
 * as `alesiev`, `Nick` as `Nick Braun`, `Tyler Jakes` as `Tyler`. Prefix
 * matching in both directions covers all of those. What it cannot cover is a
 * name with nothing in common — `Utaku Soto` is recorded as `Matt Soto` — and
 * those live in OPEN_AUCTIONEER_ALIASES.
 */
function openMatchAuctioneer(display, knownNames) {
  var raw = String(display == null ? '' : display).trim();
  var base = openNormaliseName(raw);
  var lower = base.toLowerCase();
  if (!lower) return { auctioneer: '', how: 'none' };

  var alias = OPEN_AUCTIONEER_ALIASES[lower] || OPEN_AUCTIONEER_ALIASES[raw.toLowerCase()];
  if (alias) return { auctioneer: alias, how: 'alias' };

  var i;
  for (i = 0; i < knownNames.length; i++) {
    if (String(knownNames[i]).trim().toLowerCase() === lower) return { auctioneer: knownNames[i], how: 'exact' };
  }
  // Prefer the longest prefix match in either direction, so "Matt" does not win
  // over "Matthew Hayward" for a display name of "Matthew Hayward".
  var best = null;
  for (i = 0; i < knownNames.length; i++) {
    var k = String(knownNames[i]).trim();
    var kl = k.toLowerCase();
    if (!kl) continue;
    var hit = lower.indexOf(kl) === 0 || kl.indexOf(lower) === 0;
    if (hit && (!best || k.length > best.length)) best = k;
  }
  if (best) return { auctioneer: best, how: 'prefix' };
  return { auctioneer: base, how: 'new' };
}

/** Distinct `auctioneer` values already in the sheet, most recent first. */
function openKnownAuctioneers(metaRows) {
  var seen = {}, out = [];
  for (var i = metaRows.length - 1; i >= 0; i--) {
    var name = String(metaRows[i].auctioneer || '').trim();
    if (!name || seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = true;
    out.push(name);
  }
  return out;
}

/** Does this title read like an 8K auction? A sort order, not a filter. */
function openLooksLikeEightK(title) {
  return OPEN_EIGHT_K_RE.test(String(title == null ? '' : title));
}

/** Phrases worth showing the operator, as a comma-joined note. */
function openPhraseNotes(title) {
  var notes = [];
  for (var i = 0; i < OPEN_PHRASE_HINTS.length; i++) {
    if (OPEN_PHRASE_HINTS[i].re.test(String(title == null ? '' : title))) notes.push(OPEN_PHRASE_HINTS[i].note);
  }
  return notes;
}

/**
 * Which season a new auction belongs to.
 *
 * A year in the title wins: measured across the 178 recorded forum auctions it
 * is right 65 times and wrong once, but 112 titles carry no year at all. The
 * fallback is the season of the most recently opened auction, and it is
 * announced rather than assumed, because seasons overlap exactly when it
 * matters: season 2026's last auction opened 2026-08-07 and season 2027's first
 * will open weeks later, so between roughly August and November "the current
 * season" is genuinely ambiguous and the fallback will be wrong for every
 * auction of the new season until one is recorded by hand.
 */
function openInferSeason(title, openDate, metaRows) {
  var m = String(title == null ? '' : title).match(/\b(20\d{2})\b/);
  if (m) return { season: m[1], how: 'from the title' };

  var spans = openSeasonSpans(metaRows);
  var date = String(openDate || '');
  var latest = null, i;
  for (i = 0; i < spans.length; i++) {
    if (!latest || spans[i].last > latest.last) latest = spans[i];
    if (date && date >= spans[i].first && date <= spans[i].last) {
      return { season: spans[i].season, how: 'from the season running on ' + date };
    }
  }
  if (!latest) return { season: '', how: 'unknown' };

  // Not inside any recorded season. Either it is newer than everything — the
  // rollover case — or it fell in a gap between two seasons, which is the one
  // window where a date genuinely names no season.
  if (date && date < latest.last) {
    return {
      season: latest.season,
      how: 'ASSUMED — ' + date + ' falls BETWEEN recorded seasons, so no date can name one. Check it',
    };
  }
  return {
    season: latest.season,
    how: 'ASSUMED from the last recorded auction — nothing is recorded on or after ' + date + '. Check it',
  };
}

/**
 * The first and last open date of every recorded season.
 *
 * Seasons do not overlap — measured across all nine, every gap between one
 * season's last auction and the next season's first is positive — so a date
 * inside the recorded era names exactly one season, and asking which range
 * contains it beats assuming the newest.
 *
 * That assumption was wrong in the first real scan: a thread that opened
 * 2023-12-18 and had merely been replied to recently was proposed as season
 * 2026, and silently, because December is nowhere near the autumn rollover the
 * only check looked for. Old threads get bumped into the window all the time;
 * "recently active" says nothing about when something opened.
 */
function openSeasonSpans(metaRows) {
  var by = {}, order = [], i;
  for (i = 0; i < metaRows.length; i++) {
    var season = String(metaRows[i].auctionSeason || '').trim();
    var date = String(metaRows[i].openDate || '').trim();
    if (!season || !date) continue;
    if (!by[season]) { by[season] = { season: season, first: date, last: date }; order.push(by[season]); }
    if (date < by[season].first) by[season].first = date;
    if (date > by[season].last) by[season].last = date;
  }
  return order;
}

// ===========================================================================
// Pure planning — proposals for the review tab
// ===========================================================================

/**
 * Which feed items are worth fetching a topic page for.
 *
 * `pubDate` is the last post, which is never earlier than the first, so a
 * cutoff on it cannot drop a topic that opened after the cutoff. Already-
 * recorded topics drop out here too, which is the whole duplicate defence for
 * the forum side.
 */
function openSelectFeedItems(feedItems, metaRows, options) {
  options = options || {};
  var recorded = openRecordedTopics(metaRows);
  var cutoff = options.cutoff || openScanCutoff(metaRows);
  var limit = options.limit || OPEN_MAX_TOPIC_FETCHES;
  var selected = [], skipped = { recorded: 0, old: 0, offTopic: 0, overflow: 0 };

  var fresh = [];
  for (var i = 0; i < feedItems.length; i++) {
    var item = feedItems[i];
    if (recorded[item.id]) { skipped.recorded++; continue; }
    if (cutoff && item.isoDate && item.isoDate < cutoff) { skipped.old++; continue; }
    if (OPEN_SIGNAL_ONLY_CATEGORIES[item.catid] && !openLooksLikeEightK(item.title)) { skipped.offTopic++; continue; }
    fresh.push(item);
  }
  // Newest last post first: on the run where the cap bites, the topics most
  // likely to be a live auction are the ones that get looked at.
  fresh.sort(function (a, b) { return String(b.isoDate || '').localeCompare(String(a.isoDate || '')); });
  for (var j = 0; j < fresh.length; j++) {
    if (selected.length >= limit) { skipped.overflow++; continue; }
    selected.push(fresh[j]);
  }
  return { selected: selected, skipped: skipped, cutoff: cutoff };
}

/** The oldest last-post date a scan bothers with. */
function openScanCutoff(metaRows) {
  var latest = '';
  for (var i = 0; i < metaRows.length; i++) {
    var d = String(metaRows[i].openDate || '');
    if (d > latest) latest = d;
  }
  return latest ? openShiftIsoDays(latest, -OPEN_LOOKBACK_MARGIN_DAYS) : '';
}

/**
 * One forum proposal, from a feed item plus its fetched topic page.
 *
 * `auctionStyle`, `completionStyle`, `augmentated` and `targetFunding` are left
 * EMPTY on purpose — see OPEN_PHRASE_HINTS for the measurement that settled
 * that. The evidence goes in `notes`; the operator types the value.
 */
function openForumProposal(item, topic, metaRows, knownNames) {
  var title = topic.title || item.title || '';
  var openDate = topic.openDate || item.isoDate || '';
  var season = openInferSeason(title, openDate, metaRows);
  var who = openMatchAuctioneer(topic.starter, knownNames);
  var number = openNextNumber(metaRows, season.season);
  var notes = openPhraseNotes(title);

  notes.unshift('season ' + season.how);
  if (who.how === 'new') notes.unshift('NEW auctioneer "' + who.auctioneer + '" — no recorded auction uses that name');
  else if (who.how !== 'exact') notes.unshift('auctioneer matched by ' + who.how + ' from "' + String(topic.starter || '').trim() + '"');
  if (topic.openTime && (topic.openTime >= '22:00' || topic.openTime <= '02:00')) {
    notes.unshift('opened at ' + topic.openTime + ' — near midnight, check which day this belongs to');
  }
  if (!topic.openDate) notes.unshift('NO first-post timestamp found — the date shown is the last post, not the open');

  return {
    key: 'topic:' + item.id,
    source: 'forum ' + item.catid,
    verdict: openLooksLikeEightK(title) ? 'candidate' : 'no 8K signal',
    openDate: openDate,
    openTime: topic.openTime || '',
    auctioneer: who.auctioneer,
    auctionName: title,
    season: season.season,
    number: number,
    auctionId: season.season ? openAuctionId(season.season, number) : '',
    link: openTopicUrl(item.catid, item.id),
    auctionStyle: '',
    completionStyle: '',
    augmentated: '',
    targetFunding: '',
    notes: notes,
  };
}

/**
 * Trent's proposal, or an "already recorded" marker when his page shows an
 * auction the sheet has.
 *
 * The season and name together are the identity here, not the Link — all 111 of
 * his rows carry the same URL, so a Link comparison would call every auction a
 * duplicate, and his numbering restarts each season, so a name alone would call
 * every new season's first auction one too.
 */
function openTrentProposal(page, metaRows) {
  if (!page || !page.number || !page.startDate) return null;
  var name = 'Trent Auction ' + page.number;
  var season = page.season
    ? { season: page.season, how: 'from the page' }
    : openInferSeason(name, page.startDate, metaRows);

  var recorded = openRecordedTrentNames(metaRows);
  var already = recorded[openTrentKey(season.season, name)];
  if (already) return { alreadyRecorded: already, auctionName: name, season: season.season };

  var number = openNextNumber(metaRows, season.season);
  var notes = ['season ' + season.how];
  if (page.status) notes.push('page status: ' + page.status);
  if (page.orderStyle) notes.push('page calls the ORDER "' + page.orderStyle + '" — the sheet records the AUCTION as Ultra Condensed');
  if (page.withheld) notes.push('withheld: ' + page.withheld);

  var target = OPEN_TRENT_DEFAULTS.targetFunding;
  if (page.reserve) {
    var fromPage = '$' + page.reserve + (page.reserve.indexOf('.') < 0 ? '.00' : '');
    if (fromPage !== target) notes.push('page reserve is ' + fromPage + ', not the ' + target + ' every recorded Trent auction uses');
    target = fromPage;
  } else {
    notes.push('no reserve total on the page — using the recorded ' + target);
  }

  return {
    key: 'trent:' + name.toLowerCase(),
    source: 'trent',
    verdict: 'candidate',
    openDate: page.startDate,
    openTime: '',
    auctioneer: OPEN_TRENT_AUCTIONEER,
    auctionName: name,
    season: season.season,
    number: number,
    auctionId: season.season ? openAuctionId(season.season, number) : '',
    link: OPEN_TRENT_URL,
    auctionStyle: OPEN_TRENT_DEFAULTS.auctionStyle,
    completionStyle: OPEN_TRENT_DEFAULTS.completionStyle,
    augmentated: OPEN_TRENT_DEFAULTS.augmentated,
    targetFunding: target,
    notes: notes,
  };
}

/**
 * One proposal from one auction card.
 *
 * Unlike the forum path, this one FILLS IN `auctionStyle`, `completionStyle`,
 * `augmentated` and `targetFunding`. The forum path leaves them blank because
 * it would be reading a thread title, and that was measured: `auctionStyle`
 * guessed from a title is wrong on 11 of the 66 it would attempt. This reads
 * discrete badges the site renders from its own record of the auction, which is
 * a different claim entirely — and where a badge is missing, ambiguous or
 * self-contradictory the cell goes back to being blank with a note, so the
 * forum path's rule still holds wherever the evidence is as weak as the forum's.
 *
 * `closeDate` is deliberately not taken from the card's `Ends:` line even
 * though the line is right there and parses cleanly. `Ends` is the SCHEDULED
 * end; the sheet's `closeDate` is when the auction actually closed, and the two
 * differ whenever an auction is extended, ends early on funding, or fails. A
 * blank `closeDate` is also what makes `Status` compute `Open`, so writing the
 * scheduled date here would mark a brand-new auction closed. The scheduled date
 * goes in the notes, where it is useful and decides nothing.
 */
function openAlesievProposal(card, metaRows, knownNames) {
  var title = card.title || '';
  var openDate = card.startDate || '';
  var season = openInferSeason(title, openDate, metaRows);
  var who = openMatchAuctioneer(card.sponsor, knownNames);
  var fields = openAlesievFields(card);
  var number = openNextNumber(metaRows, season.season);

  var notes = [];
  if (!card.id) notes.push('NO auction id in the card link ("' + card.href + '") — this row cannot be checked for duplicates. Do not promote it.');
  if (!openDate) notes.push('NO Starts line on the card — openDate is blank and the row cannot be promoted without one');
  if (!title) notes.push('NO title on the card');
  if (!card.sponsor) notes.push('no Sponsor line on the card — auctioneer left blank');

  notes = notes.concat(fields.notes);
  notes.push('season ' + season.how);
  if (card.sponsor) {
    if (who.how === 'new') notes.push('NEW auctioneer "' + who.auctioneer + '" — no recorded auction uses that name');
    else if (who.how !== 'exact') notes.push('auctioneer matched by ' + who.how + ' from "' + card.sponsor + '"');
  }
  if (card.status) {
    notes.push('site status: ' + card.status);
    if (OPEN_ALESIEV_ENDED_RE.test(card.status) || OPEN_ALESIEV_ENDED_RE.test(card.statusClass)) {
      notes.push('that status reads as FINISHED rather than upcoming — check whether this auction has already closed, because a promoted row is created open');
    }
  }
  if (card.endRaw) {
    notes.push('site says it ends ' + (card.endDate || card.endRaw) + ' — closeDate stays blank on purpose and is filled when the auction actually closes');
  }
  if (card.startTime && (card.startTime >= '22:00' || card.startTime <= '02:00')) {
    notes.push('starts at ' + card.startTime + ' — the site renders times in its own timezone, so check which day this belongs to');
  }
  if (card.itemCount) notes.push(card.itemCount + ' items listed');
  if (card.intro && /withh(?:e|o)ld/i.test(card.intro)) notes.push('withheld: ' + card.intro);

  // The title says the same three things the badges do, so a disagreement
  // between them is worth surfacing. It is only ever a note: the badge is a
  // field and the title is prose, and where they differ the badge is the one to
  // believe — but not silently, because a title saying Onyx over a non-Onyx
  // badge is equally likely to be a mis-tagged auction.
  notes = notes.concat(openAlesievTitleConflicts(title, fields));
  var hints = openPhraseNotes(title);
  for (var h = 0; h < hints.length; h++) {
    if (!OPEN_ALESIEV_BADGE_NOTE_RE.test(hints[h])) notes.push(hints[h]);
  }

  return {
    key: 'alesiev:' + (card.id || title.toLowerCase()),
    source: OPEN_ALESIEV_SOURCE,
    verdict: 'candidate',
    openDate: openDate,
    openTime: card.startTime || '',
    auctioneer: card.sponsor ? who.auctioneer : '',
    auctionName: title,
    season: season.season,
    number: number,
    auctionId: season.season ? openAuctionId(season.season, number) : '',
    link: card.id ? openAlesievUrl(card.id) : (card.href || ''),
    auctionStyle: fields.auctionStyle,
    completionStyle: fields.completionStyle,
    augmentated: fields.augmentated,
    targetFunding: fields.targetFunding,
    notes: notes,
  };
}

/**
 * Where a card's title contradicts its own badges.
 *
 * `Aleisev's ... (8K) Onyx Option A` is tagged Onyx and reads Onyx; the two
 * agree today. They will not always, because the title is typed and the badges
 * are ticked, and the one that is wrong is not knowable from here.
 */
function openAlesievTitleConflicts(title, fields) {
  var text = String(title == null ? '' : title);
  var out = [];
  var saysNonOnyx = /\bnon[- ]?onyx\b|\bno onyx\b/i.test(text);
  var saysOnyx = !saysNonOnyx && /\bonyx\b/i.test(text);
  if (fields.auctionStyle) {
    var taggedOnyx = fields.auctionStyle === OPEN_ALESIEV_ONYX_STYLE;
    if (saysOnyx && !taggedOnyx) out.push('the TITLE says Onyx but the card is not tagged Onyx — the badge is what was used');
    if (saysNonOnyx && taggedOnyx) out.push('the TITLE says non-Onyx but the card IS tagged Onyx — the badge is what was used');
  }
  if (fields.augmentated && /augment/i.test(text) && fields.augmentated === 'No') {
    out.push('the TITLE mentions augments but the card is not tagged Augmented — the badge is what was used');
  }
  return out;
}

/**
 * Everything a scan proposes, numbered.
 *
 * Numbering happens LAST and across the whole batch, because
 * `openNextNumber` reads the sheet and the sheet does not change between
 * proposals: without this pass, two auctions opening the same day would both be
 * proposed as the same number. They are ordered by open date so the numbers run
 * the way the season did.
 */
function openPlanScan(input) {
  var metaRows = input.metaRows || [];
  var proposals = [];
  var notes = [];

  var trent = input.trentPage ? openTrentProposal(input.trentPage, metaRows) : null;
  if (trent && trent.alreadyRecorded) {
    notes.push('Trent: "' + trent.auctionName + '" is already recorded as ' + trent.alreadyRecorded + '.');
  } else if (trent) {
    proposals.push(trent);
  } else if (input.trentPage) {
    notes.push('Trent: could not read an auction number and start date from the page. It may be between auctions.');
  }

  var knownNames = openKnownAuctioneers(metaRows);
  var topics = input.topics || [];
  for (var i = 0; i < topics.length; i++) {
    proposals.push(openForumProposal(topics[i].item, topics[i].topic, metaRows, knownNames));
  }

  // alesievauctions.com. Its cards are filtered here rather than in the parser
  // so that the parse and the duplicate check stay separable — the test replays
  // the whole listing and then asserts what a scan against a sheet that already
  // holds those auctions proposes, which is nothing.
  var recordedSite = openRecordedAlesiev(metaRows);
  var cards = input.alesievCards || [];
  var seenSite = 0;
  for (var a = 0; a < cards.length; a++) {
    if (cards[a].id && recordedSite[cards[a].id]) { seenSite++; continue; }
    proposals.push(openAlesievProposal(cards[a], metaRows, knownNames));
  }
  if (seenSite) {
    notes.push(OPEN_ALESIEV_SOURCE + ': ' + seenSite + ' listed auction(s) are already recorded.');
  }

  proposals.sort(function (a, b) {
    if (a.verdict !== b.verdict) return a.verdict === 'candidate' ? -1 : 1;
    return String(a.openDate).localeCompare(String(b.openDate));
  });
  openRenumber(proposals, metaRows);
  return { proposals: proposals, notes: notes };
}

/**
 * Give every proposal its own number, season by season, continuing from what
 * the sheet already holds.
 */
function openRenumber(proposals, metaRows) {
  var next = {};
  // Date and then time: two auctions on one site can open the same day, and
  // they did on the very first listing scanned — one at 00:00 and one at 11:00.
  // Ordering on the date alone leaves those two in whatever order the page
  // happened to list them, which is newest-first, so the later auction would
  // take the lower number.
  var ordered = proposals.slice().sort(function (a, b) {
    return (String(a.openDate) + ' ' + String(a.openTime || '')).localeCompare(String(b.openDate) + ' ' + String(b.openTime || ''));
  });
  for (var i = 0; i < ordered.length; i++) {
    var p = ordered[i];
    if (!p.season) { p.number = ''; p.auctionId = ''; continue; }
    if (next[p.season] === undefined) next[p.season] = openNextNumber(metaRows, p.season);
    p.number = next[p.season]++;
    p.auctionId = openAuctionId(p.season, p.number);
  }
  return proposals;
}

// ===========================================================================
// Pure serialisation — the review tab
// ===========================================================================

function openReviewRow(proposal) {
  return [
    false, '', proposal.verdict, proposal.source, proposal.openDate, proposal.openTime,
    proposal.auctioneer, proposal.auctionName, proposal.season, proposal.number,
    proposal.auctionId, proposal.link,
    proposal.auctionStyle, proposal.completionStyle, proposal.augmentated,
    proposal.targetFunding, (proposal.notes || []).join(' · '),
  ];
}

/** The key a review row is identified by, for carrying ticks across a rescan. */
function openReviewKey(row) {
  var link = String(row[11] || '');
  var id = openTopicId(link);
  if (id) return 'topic:' + id;
  // Before the Trent fallback, not after it: an alesievauctions.com row carries
  // no topic id, so without this it would key as `trent:<its name>` and a
  // rescan would drop the operator's tick on the floor.
  var siteId = openAlesievId(link);
  if (siteId) return 'alesiev:' + siteId;
  return 'trent:' + String(row[7] || '').trim().toLowerCase();
}

/**
 * A rescan rewrites the review tab, and must not throw away work.
 *
 * Anything the operator typed — the tick, and the four columns the scan
 * deliberately leaves empty — is carried across for a proposal that is still
 * proposed. Rows already promoted stay, greyed by their `status`, so the tab
 * doubles as a record of what this phase has done.
 *
 * `recordedIds` is every `auctionId` `auctionMetadata` currently holds, and it
 * is what stops a `promoted <id>` marker from outliving the row it names. A
 * marker naming an id that is no longer recorded is making a false claim, and
 * it is a claim with teeth: `openIsApproved` refuses any row whose status
 * starts with `promoted`, so the operator can tick such a row all day and the
 * promote step will silently ignore it.
 *
 * **A deleted row used to be ambiguous, and is less so now.** Until DATA-6
 * there was no way to record a failure: `Status` was
 * `IF(closeDate="","Open","Closed")`, so a failed auction's row was DELETED,
 * and "promoted, then gone" was exactly as likely to be a failed auction as
 * deleted test data. A failed auction now keeps its row and says `Failed` in
 * `outcome`, so a missing row should mean the row was removed on purpose.
 *
 * "Should" is doing real work in that sentence, which is why nothing here got
 * cheaper. Every auction that failed BEFORE the column existed was deleted
 * under the old habit, the habit outlives the column that replaced it, and this
 * script cannot see either. So the behaviour is unchanged — the marker is
 * cleared, the tick is forced OFF, and the operator decides — and only the note
 * changes, to say which reading is now the likely one.
 *
 * Omit `recordedIds` and no marker is ever questioned, which is what this did
 * before.
 */
function openMergeReview(existingRows, proposals, recordedIds) {
  var byKey = {}, i;
  for (i = 0; i < existingRows.length; i++) {
    var key = openReviewKey(existingRows[i]);
    if (key) byKey[key] = existingRows[i];
  }
  var rows = [], keptPromoted = [], seen = {};
  for (i = 0; i < proposals.length; i++) {
    var row = openReviewRow(proposals[i]);
    var old = byKey[proposals[i].key];
    seen[proposals[i].key] = true;
    if (old) {
      row[0] = old[0];
      row[1] = old[1];
      var staleId = openPromotedId(old[1]);
      if (staleId && recordedIds && !recordedIds[staleId]) {
        // The marker outlived the row it names. Clear it so the row can be
        // approved again — and force the tick OFF, so re-approving is a
        // decision the operator makes after reading the note rather than one
        // an old tick makes for them.
        row[0] = false;
        row[1] = '';
        row[16] = String(row[16] || '') + ' · WAS PROMOTED as ' + staleId +
          ', and no row with that auctionId is in ' + OPEN_TABS.metadata +
          ' now. The marker has been cleared so this can be approved again. A failed auction KEEPS its row now (outcome = Failed), so this is most likely a row deleted on purpose — but an auction that failed before that column existed was deleted instead, so check before re-ticking.';
      }
      // What the tab already holds wins, because for the forum it is by
      // definition something the operator typed. For the two sources that
      // PREFILL these columns it could instead be a stale value from an earlier
      // scan, so a difference is called out rather than swallowed — a badge
      // flipped on the site would otherwise be invisible here for ever.
      var changed = [];
      for (var c = 12; c <= 15; c++) {
        // Column 16 is targetFunding, which Sheets returns as a number once it
        // has made a currency cell of it. Compared raw, "8000" differs from
        // "$8,000.00" and the drift note fires on every single rescan.
        var held = c === 15 ? openMoneyFromCell(old[c]) : String(old[c] == null ? '' : old[c]).trim();
        if (!held) continue;
        var fresh = String(row[c] == null ? '' : row[c]).trim();
        if (fresh && fresh !== held) changed.push(OPEN_REVIEW_COLUMNS[c] + ' is "' + held + '" here, "' + fresh + '" on the page');
        row[c] = held;
      }
      if (changed.length) {
        row[16] = String(row[16] || '') + ' · KEPT WHAT THIS TAB ALREADY HELD — ' + changed.join('; ');
      }
    }
    rows.push(row);
  }
  for (i = 0; i < existingRows.length; i++) {
    var k = existingRows[i] && openReviewKey(existingRows[i]);
    if (seen[k] || !/^(?:was )?promoted/i.test(String(existingRows[i][1] || ''))) continue;
    // A promoted row nothing proposes any more is history and is kept. If its
    // id has also gone from auctionMetadata the status is rewritten rather than
    // cleared: there is nothing here to approve, so the useful thing is a row
    // that no longer claims to be something it is not. `was promoted` still
    // matches the retention test above, so it survives every later rescan.
    var kept = existingRows[i].slice();
    var goneId = openPromotedId(kept[1]);
    if (goneId && recordedIds && !recordedIds[goneId]) {
      kept[0] = false;
      kept[1] = 'was promoted ' + goneId + ' — no longer in ' + OPEN_TABS.metadata;
    }
    keptPromoted.push(kept);
  }
  return rows.concat(keptPromoted);
}

/** True when the operator has ticked a review row that is not yet promoted. */
function openIsApproved(row) {
  if (/^promoted/i.test(String(row[1] || ''))) return false;
  var v = row[0];
  if (v === true) return true;
  return /^(true|yes|y|x|✓)$/i.test(String(v == null ? '' : v).trim());
}

/**
 * The rows to append to `auctionMetadata`, one per approved review row, plus
 * whatever the operator should be told before they land.
 *
 * Numbers are re-derived here rather than trusted from the review tab: a scan
 * may be hours old, an auction may have been added by hand since, and a
 * duplicate `auctionNumber` is the one failure this phase exists to prevent.
 */
function openPlanPromotion(reviewRows, metaRows, headers) {
  var approved = [], i;
  for (i = 0; i < reviewRows.length; i++) if (openIsApproved(reviewRows[i])) approved.push({ index: i, row: reviewRows[i] });
  approved.sort(function (a, b) { return openIsoFromCell(a.row[4]).localeCompare(openIsoFromCell(b.row[4])); });

  var recordedTopics = openRecordedTopics(metaRows);
  var recordedTrent = openRecordedTrentNames(metaRows);
  var recordedSite = openRecordedAlesiev(metaRows);
  var lastSeason = null;
  for (i = 0; i < metaRows.length; i++) lastSeason = String(metaRows[i].auctionSeason);

  var next = {}, out = [], problems = [], warnings = [];
  for (i = 0; i < approved.length; i++) {
    var row = approved[i].row;
    var name = String(row[7] || '').trim();
    var season = String(row[8] || '').trim();
    var link = String(row[11] || '').trim();
    // Read, not stringified. A cell Sheets coerced to a Date stringifies to
    // "Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)" — see
    // openIsoFromCell.
    var openDate = openIsoFromCell(row[4]);
    var topicId = openTopicId(link);
    var siteId = openAlesievId(link);
    var label = name || link || ('review row ' + (approved[i].index + 2));

    if (!season) { problems.push(label + ': no season'); continue; }
    if (!openDate) { problems.push(label + ': no openDate'); continue; }
    // The guard, and the point of it: converting is best-effort, refusing is
    // not. Anything that is not an ISO date is stopped HERE rather than written
    // into a column `daysToClose` and `Open Month` compute from and the site
    // parses as a date.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openDate)) {
      problems.push(label + ': openDate is "' + openDate + '", which is not a YYYY-MM-DD date. Fix that cell in ' + OPEN_TABS.review + ' and promote again');
      continue;
    }
    if (!name) { problems.push(label + ': no auctionName'); continue; }
    if (topicId && recordedTopics[topicId]) { problems.push(label + ': topic ' + topicId + ' is already recorded as ' + recordedTopics[topicId]); continue; }
    if (siteId && recordedSite[siteId]) { problems.push(label + ': ' + OPEN_ALESIEV_SOURCE + ' auction ' + siteId + ' is already recorded as ' + recordedSite[siteId]); continue; }
    // Only rows from neither of the id-bearing sources fall through to the
    // name check. Without the `siteId` guard an alesievauctions.com row would
    // be tested against Trent's names, match none of them, and be promoted with
    // no duplicate check at all — the one failure this phase exists to prevent.
    var trentKey = openTrentKey(season, name);
    if (!topicId && !siteId && recordedTrent[trentKey]) { problems.push(label + ': "' + name + '" is already recorded as ' + recordedTrent[trentKey] + ' for season ' + season); continue; }

    if (next[season] === undefined) next[season] = openNextNumber(metaRows, season);
    var number = next[season]++;
    var fields = {
      auctionId: openAuctionId(season, number),
      auctionSeason: season,
      auctionNumber: String(number),
      auctionName: name,
      auctionStyle: String(row[12] || '').trim(),
      completionStyle: String(row[13] || '').trim(),
      auctioneer: String(row[6] || '').trim(),
      Link: link,
      openDate: openDate,
      targetFunding: openMoneyFromCell(row[15]),
      augmentated: String(row[14] || '').trim(),
    };
    if (!fields.auctionStyle) warnings.push(label + ': auctionStyle is blank');
    if (!fields.completionStyle) warnings.push(label + ': completionStyle is blank');
    if (lastSeason && season !== lastSeason) {
      warnings.push(label + ': season ' + season + ' follows ' + lastSeason +
        ' — the copied "Open Month" formula still measures from season ' + lastSeason +
        "'s start date, so fix that cell after promoting");
    }
    out.push({ reviewIndex: approved[i].index, fields: fields, cells: openMetadataCells(fields, headers) });
  }
  return { rows: out, problems: problems, warnings: warnings, approved: approved.length };
}

/**
 * A field map to the cells of one `auctionMetadata` row, positioned by the
 * tab's own header row. `null` means "this phase has no value for that column".
 */
function openMetadataCells(fields, headers) {
  var cells = [];
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i]).trim();
    cells.push(Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : null);
  }
  return cells;
}

/**
 * What to do with each cell of a row copied down from the one above it.
 *
 * A copied row arrives carrying the PREVIOUS auction's everything. Three
 * outcomes are possible per column and only one of them is right:
 *
 *   - `write`  — one of the eleven columns this phase fills in, where the
 *                source cell is not already a formula computing it.
 *   - `keep`   — the source cell holds a FORMULA, so the copy is already
 *                correct with its references shifted a row. `Status`,
 *                `daysToClose`, `Open Month` and the funding columns are these,
 *                and so are `auctionId` and `augmentated` — the two that this
 *                phase can also compute, where the formula wins. See
 *                OPEN_DERIVED_FIELDS.
 *   - `clear`  — the source cell holds a LITERAL that this phase does not
 *                write. That is the previous auction's data and it is not true
 *                of this one. `closeDate` is the dangerous one: left copied,
 *                a brand-new auction inherits a close date, `Status` computes
 *                `Closed`, and the auction never appears as open anywhere on
 *                the site.
 *
 * The formula/literal split is READ from the source row rather than assumed,
 * because the workbook is not in this repo and the augment columns could
 * honestly be either. Reading it costs one `getFormulas()` call and removes the
 * guess entirely — a column that is a formula today and a literal next year is
 * handled correctly both times.
 */
function openRowActions(headers, sourceFormulas, cells) {
  var actions = [];
  for (var i = 0; i < headers.length; i++) {
    var value = cells[i];
    var formula = String((sourceFormulas || [])[i] || '');
    // A derived column's formula outranks the value this phase computed for it.
    // See OPEN_DERIVED_FIELDS: both of these produce exactly what the promotion
    // would write, which is why writing over them went unnoticed — and why
    // `augmentated` then stayed frozen at "No" for the life of the auction.
    if (formula && OPEN_DERIVED_FIELDS.indexOf(String(headers[i]).trim()) !== -1) {
      actions.push({ action: 'keep', value: null });
      continue;
    }
    if (value !== null && value !== undefined) { actions.push({ action: 'write', value: value }); continue; }
    actions.push(formula ? { action: 'keep', value: null } : { action: 'clear', value: '' });
  }
  return actions;
}

/**
 * Which derived columns carry a value from the review tab that the sheet's own
 * formula is about to win over, phrased for the dialog.
 *
 * Only reports where the proposal actually supplies something non-empty — a
 * blank `augmentated` losing to a formula is the normal case and saying so
 * every time would train the operator to skip the whole block.
 */
function openDerivedOverrides(headers, sourceFormulas, rows) {
  var out = [];
  for (var r = 0; r < rows.length; r++) {
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i]).trim();
      if (OPEN_DERIVED_FIELDS.indexOf(header) === -1) continue;
      if (!String((sourceFormulas || [])[i] || '')) continue;
      var value = rows[r].cells[i];
      if (value === null || value === undefined || String(value).trim() === '') continue;
      out.push(rows[r].fields.auctionId + ' ' + header + ': "' + value + '" — the column computes itself');
    }
  }
  return out;
}

/** Header names this phase expects to find, and does not. */
function openHeaderProblems(headers) {
  var problems = [], i, j;
  for (i = 0; i < OPEN_METADATA_FIELDS.length; i++) {
    var found = false;
    for (j = 0; j < headers.length; j++) if (String(headers[j]).trim() === OPEN_METADATA_FIELDS[i]) found = true;
    if (!found) problems.push('no "' + OPEN_METADATA_FIELDS[i] + '" column in ' + OPEN_TABS.metadata);
  }
  return problems;
}

function openDescribeScan(plan) {
  var lines = [], i;
  var candidates = 0;
  for (i = 0; i < plan.proposals.length; i++) if (plan.proposals[i].verdict === 'candidate') candidates++;
  lines.push(plan.proposals.length + ' proposed row(s): ' + candidates + ' look like 8K auctions, ' +
    (plan.proposals.length - candidates) + ' carry no 8K signal.');
  lines.push('');
  for (i = 0; i < plan.proposals.length; i++) {
    var p = plan.proposals[i];
    lines.push('  ' + (p.verdict === 'candidate' ? '*' : ' ') + ' ' + p.openDate + '  ' + p.auctionId + '  ' +
      p.auctioneer + ' — ' + p.auctionName);
  }
  if (plan.notes.length) {
    lines.push('');
    for (i = 0; i < plan.notes.length; i++) lines.push('  ' + plan.notes[i]);
  }
  lines.push('');
  lines.push('Nothing has been written to ' + OPEN_TABS.metadata + '. Tick the rows you want in ' +
    OPEN_TABS.review + ', fill in the blank columns, then run "Promote approved auctions".');
  return lines.join('\n');
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook or the network. Nothing above it does.
// ===========================================================================

/**
 * Contributes this phase's items to the one menu `trentClose.gs` builds.
 * There is deliberately no `onOpen` here; see the file header.
 */
function addOpenMenu(menu) {
  return menu
    .addSeparator()
    .addItem('Scan for new auctions…', 'scanAuctionOpens')
    .addItem('Promote approved auctions…', 'promoteAuctionOpens');
}

/** Read a tab as objects keyed by its header row, using displayed text. */
function openReadTab(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('no tab named "' + name + '"');
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).map(function (row) {
    var o = {};
    for (var i = 0; i < header.length; i++) o[header[i]] = String(row[i] == null ? '' : row[i]).trim();
    return o;
  });
}

function openHeaders(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('no tab named "' + name + '"');
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
}

/**
 * Dates and times Sheets handed back as Date objects, rendered as the strings
 * the scan originally wrote them as.
 *
 * The timezone is the SPREADSHEET's, not the script's, and that is the whole
 * reason this is here rather than left to `openIsoFromCell`'s local getters. A
 * date-only cell comes back as midnight in the spreadsheet's timezone; if the
 * script's timezone is behind it, midnight lands on the previous day and the
 * date is off by one. The two are usually the same and this usually changes
 * nothing — but the promotion that produced "01:00:00" proves they can differ
 * here, and being off by a day is worse than being off by an hour.
 *
 * Mutates the rows in place and returns them; they are a throwaway copy of the
 * grid in both callers.
 */
function openNormaliseReviewValues(rows, timeZone) {
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (row[4] instanceof Date) row[4] = Utilities.formatDate(row[4], timeZone, 'yyyy-MM-dd');
    if (row[5] instanceof Date) row[5] = Utilities.formatDate(row[5], timeZone, 'HH:mm');
  }
  return rows;
}

/** One GET. Returns null rather than throwing, so one dead source is not a dead run. */
function openFetch(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml' },
  });
  var code = response.getResponseCode();
  if (code < 200 || code >= 300) return null;
  return response.getContentText();
}

/**
 * Fetch both sources, propose rows, write the review tab. Writes NOTHING to
 * `auctionMetadata`.
 */
function scanAuctionOpens() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName(OPEN_TABS.metadata)) {
    ui.alert('Cannot run', 'No tab named "' + OPEN_TABS.metadata + '".', ui.ButtonSet.OK);
    return;
  }
  var headerProblems = openHeaderProblems(openHeaders(OPEN_TABS.metadata));
  if (headerProblems.length) {
    ui.alert('Cannot run', headerProblems.join('\n'), ui.ButtonSet.OK);
    return;
  }

  var metaRows = openReadTab(OPEN_TABS.metadata);
  var fetchNotes = [];

  var trentHtml = openFetch(OPEN_TRENT_URL);
  if (!trentHtml) fetchNotes.push('Trent: the page could not be fetched, so his side of this scan is empty.');
  var trentPage = trentHtml ? openParseTrentPage(trentHtml) : null;

  var feedItems = [], i;
  for (i = 0; i < OPEN_FORUM_CATEGORIES.length; i++) {
    var cat = OPEN_FORUM_CATEGORIES[i];
    var xml = openFetch(openFeedUrl(cat));
    if (!xml) { fetchNotes.push('Forum: category ' + cat + "'s feed could not be fetched."); continue; }
    feedItems = feedItems.concat(openParseFeed(xml, cat));
  }

  // One fetch, and everything a row needs is on it — no per-auction page.
  var alesievHtml = openFetch(OPEN_ALESIEV_LISTING_URL);
  var alesievCards = [];
  if (!alesievHtml) {
    fetchNotes.push(OPEN_ALESIEV_SOURCE + ': the listing could not be fetched, so that side of this scan is empty.');
  } else {
    alesievCards = openParseAlesievListing(alesievHtml);
    if (!alesievCards.length) {
      fetchNotes.push(OPEN_ALESIEV_SOURCE + ': the listing was fetched (' + alesievHtml.length +
        ' chars) but NO auction cards were found in it. Either it is genuinely empty or the markup ' +
        'has changed — open ' + OPEN_ALESIEV_LISTING_URL + ' and check, because a parser that finds ' +
        'nothing looks exactly like a site with no auctions.');
    }
  }

  var selection = openSelectFeedItems(feedItems, metaRows, {});
  var topics = [];
  for (i = 0; i < selection.selected.length; i++) {
    var item = selection.selected[i];
    var html = openFetch(openTopicUrl(item.catid, item.id));
    if (!html) { fetchNotes.push('Forum: topic ' + item.id + ' could not be fetched.'); continue; }
    topics.push({ item: item, topic: openParseTopic(html) });
  }

  var plan = openPlanScan({ metaRows: metaRows, trentPage: trentPage, topics: topics, alesievCards: alesievCards });
  plan.notes = plan.notes.concat(fetchNotes);
  plan.notes.push('Looked at forum topics with a post since ' + selection.cutoff + ': ' +
    selection.selected.length + ' fetched, ' + selection.skipped.recorded + ' already recorded, ' +
    selection.skipped.old + ' older than the cutoff' +
    (selection.skipped.offTopic ? ', ' + selection.skipped.offTopic + ' in the general category with no 8K signal' : '') +
    (selection.skipped.overflow ? ', ' + selection.skipped.overflow + ' left for the next run (fetch cap)' : '') + '.');
  plan.notes.push('Read ' + alesievCards.length + ' auction card(s) from ' + OPEN_ALESIEV_LISTING_URL + '.');

  openWriteReview(plan.proposals, openRecordedAuctionIds(metaRows));
  ui.alert('Scan complete (script ' + OPEN_VERSION + ')', openDescribeScan(plan), ui.ButtonSet.OK);
}

/**
 * Rewrite the review tab, carrying over the operator's ticks and typed cells.
 * Creates the tab when it is missing; a new tab is the only thing this phase
 * makes without being asked.
 */
function openWriteReview(proposals, recordedIds) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(OPEN_TABS.review);
  var existing = [];
  if (!sheet) {
    sheet = ss.insertSheet(OPEN_TABS.review);
  } else {
    var values = sheet.getDataRange().getValues();
    if (values.length > 1) existing = openNormaliseReviewValues(values.slice(1), ss.getSpreadsheetTimeZone());
  }
  var rows = openMergeReview(existing, proposals, recordedIds);

  // clear() leaves data validation behind, so a shorter rescan would strand
  // checkboxes below the last row — tickable, and attached to nothing.
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).clearDataValidations();
  sheet.clear();
  sheet.getRange(1, 1, 1, OPEN_REVIEW_COLUMNS.length).setValues([OPEN_REVIEW_COLUMNS]).setFontWeight('bold');
  if (rows.length) {
    // Formats first. Sheets decides what a value IS as it is written, so a
    // number format applied afterwards only restyles something already
    // converted. See OPEN_REVIEW_TEXT_COLUMNS.
    for (var t = 0; t < OPEN_REVIEW_TEXT_COLUMNS.length; t++) {
      sheet.getRange(2, OPEN_REVIEW_TEXT_COLUMNS[t], rows.length, 1).setNumberFormat('@');
    }
    sheet.getRange(2, 1, rows.length, OPEN_REVIEW_COLUMNS.length).setValues(rows);
    sheet.getRange(2, 1, rows.length, 1).insertCheckboxes();
  }
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(2, OPEN_REVIEW_COLUMNS.length - 1);
}

/**
 * Append the ticked rows to `auctionMetadata`, after showing exactly what will
 * be written and asking.
 *
 * The new row is COPIED from the last existing row first, then overwritten in
 * the eleven literal columns. That is what preserves `daysToClose`, `Status`,
 * `Open Month`, `Close Month`, `augmentedTotal`, `fundingNoAugment` and
 * `preorderTotal` as formulas — copying carries them down with their references
 * shifted a row, which is exactly what those formulas want. Writing a full row
 * of literals would freeze seven computed columns at whatever the previous
 * auction happened to hold.
 */
function promoteAuctionOpens() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var review = ss.getSheetByName(OPEN_TABS.review);
  if (!review) { ui.alert('No "' + OPEN_TABS.review + '" tab. Run "Scan for new auctions" first.'); return; }
  var meta = ss.getSheetByName(OPEN_TABS.metadata);
  if (!meta) { ui.alert('No tab named "' + OPEN_TABS.metadata + '".'); return; }
  if (OPEN_OLD_TAB_RE.test(meta.getName())) { ui.alert('Refusing to write to the retired tab "' + meta.getName() + '".'); return; }

  var headers = openHeaders(OPEN_TABS.metadata);
  var headerProblems = openHeaderProblems(headers);
  if (headerProblems.length) { ui.alert('Cannot run', headerProblems.join('\n'), ui.ButtonSet.OK); return; }

  var reviewValues = review.getDataRange().getValues();
  var reviewRows = reviewValues.length > 1
    ? openNormaliseReviewValues(reviewValues.slice(1), ss.getSpreadsheetTimeZone())
    : [];
  var metaRows = openReadTab(OPEN_TABS.metadata);
  var plan = openPlanPromotion(reviewRows, metaRows, headers);

  if (!plan.rows.length) {
    ui.alert('Nothing to promote (script ' + OPEN_VERSION + ')',
      plan.approved ? 'Every ticked row was refused:\n  • ' + plan.problems.join('\n  • ')
        : 'No row in ' + OPEN_TABS.review + ' is ticked.', ui.ButtonSet.OK);
    return;
  }

  var lines = ['Appending ' + plan.rows.length + ' row(s) to ' + OPEN_TABS.metadata + ':', ''];
  for (var i = 0; i < plan.rows.length; i++) {
    var f = plan.rows[i].fields;
    lines.push('  ' + f.auctionId + '  ' + f.openDate + '  ' + f.auctioneer + ' — ' + f.auctionName);
  }
  if (plan.problems.length) { lines.push('', 'Refused:'); for (i = 0; i < plan.problems.length; i++) lines.push('  • ' + plan.problems[i]); }
  if (plan.warnings.length) { lines.push('', 'CAUTION:'); for (i = 0; i < plan.warnings.length; i++) lines.push('  • ' + plan.warnings[i]); }
  lines.push('', 'Each row is copied down from the one above, so the formula columns keep their formulas.',
    'Every other column this phase does not fill is cleared — closeDate included, which is what makes Status read "Open".');

  // Say when a typed value is about to lose to a formula, rather than dropping
  // it silently. `augmentated` is the one that bites: an operator who knows the
  // auction is augmented types Yes, and the column computes itself from the
  // augment values instead — which is right, but only obvious if it is said.
  var derived = openDerivedOverrides(headers, meta.getRange(meta.getLastRow(), 1, 1, headers.length).getFormulas()[0], plan.rows);
  if (derived.length) {
    lines.push('', 'COMPUTED BY THE SHEET, so what the review tab says is ignored:');
    for (i = 0; i < derived.length; i++) lines.push('  • ' + derived[i]);
  }

  var answer = ui.alert('Promote (script ' + OPEN_VERSION + ')', lines.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;

  for (i = 0; i < plan.rows.length; i++) {
    var last = meta.getLastRow();
    var source = meta.getRange(last, 1, 1, headers.length);
    var formulas = source.getFormulas()[0];
    var target = meta.getRange(last + 1, 1, 1, headers.length);
    source.copyTo(target);

    var actions = openRowActions(headers, formulas, plan.rows[i].cells);
    for (var c = 0; c < actions.length; c++) {
      if (actions[c].action === 'keep') continue;
      target.getCell(1, c + 1).setValue(actions[c].value);
    }
    review.getRange(plan.rows[i].reviewIndex + 2, 1).setValue(false);
    review.getRange(plan.rows[i].reviewIndex + 2, 2).setValue('promoted ' + plan.rows[i].fields.auctionId);
  }
  SpreadsheetApp.flush();
  ui.alert('Promoted (script ' + OPEN_VERSION + ')',
    plan.rows.length + ' row(s) appended to ' + OPEN_TABS.metadata + '.\n\n' +
    'Check the derived columns on each new row, then publish when you are ready.', ui.ButtonSet.OK);
}

// Lets Node load the pure functions for testing; Apps Script has no `module`
// and skips this entirely.
if (typeof module !== 'undefined') {
  module.exports = {
    openDecodeEntities: openDecodeEntities,
    openHtmlToText: openHtmlToText,
    openSliceDiv: openSliceDiv,
    openIsoFromSlashes: openIsoFromSlashes,
    openIsoFromForumDate: openIsoFromForumDate,
    openIsoFromRfc822: openIsoFromRfc822,
    openIsoFromCell: openIsoFromCell,
    openMoneyFromCell: openMoneyFromCell,
    openShiftIsoDays: openShiftIsoDays,
    openParseTrentPage: openParseTrentPage,
    openParseFeed: openParseFeed,
    openParseTopic: openParseTopic,
    openAlesievId: openAlesievId,
    openAlesievUrl: openAlesievUrl,
    openTimeTo24h: openTimeTo24h,
    openAlesievDate: openAlesievDate,
    openParseAlesievListing: openParseAlesievListing,
    openParseAlesievCard: openParseAlesievCard,
    openAlesievTag: openAlesievTag,
    openAlesievFields: openAlesievFields,
    openAlesievProposal: openAlesievProposal,
    openAlesievTitleConflicts: openAlesievTitleConflicts,
    openRecordedAlesiev: openRecordedAlesiev,
    openRecordedAuctionIds: openRecordedAuctionIds,
    openPromotedId: openPromotedId,
    openNextNumber: openNextNumber,
    openAuctionId: openAuctionId,
    openTopicId: openTopicId,
    openRecordedTopics: openRecordedTopics,
    openRecordedTrentNames: openRecordedTrentNames,
    openTrentKey: openTrentKey,
    openKnownAuctioneers: openKnownAuctioneers,
    openMatchAuctioneer: openMatchAuctioneer,
    openNormaliseName: openNormaliseName,
    openLooksLikeEightK: openLooksLikeEightK,
    openPhraseNotes: openPhraseNotes,
    openInferSeason: openInferSeason,
    openScanCutoff: openScanCutoff,
    openSeasonSpans: openSeasonSpans,
    openSelectFeedItems: openSelectFeedItems,
    openForumProposal: openForumProposal,
    openTrentProposal: openTrentProposal,
    openPlanScan: openPlanScan,
    openRenumber: openRenumber,
    openReviewRow: openReviewRow,
    openReviewKey: openReviewKey,
    openMergeReview: openMergeReview,
    openIsApproved: openIsApproved,
    openPlanPromotion: openPlanPromotion,
    openMetadataCells: openMetadataCells,
    openRowActions: openRowActions,
    openDerivedOverrides: openDerivedOverrides,
    openHeaderProblems: openHeaderProblems,
    openDescribeScan: openDescribeScan,
    OPEN_REVIEW_COLUMNS: OPEN_REVIEW_COLUMNS,
    OPEN_REVIEW_TEXT_COLUMNS: OPEN_REVIEW_TEXT_COLUMNS,
    OPEN_METADATA_FIELDS: OPEN_METADATA_FIELDS,
    OPEN_DERIVED_FIELDS: OPEN_DERIVED_FIELDS,
    OPEN_TRENT_DEFAULTS: OPEN_TRENT_DEFAULTS,
    OPEN_TRENT_URL: OPEN_TRENT_URL,
    OPEN_FORUM_CATEGORIES: OPEN_FORUM_CATEGORIES,
    OPEN_SIGNAL_ONLY_CATEGORIES: OPEN_SIGNAL_ONLY_CATEGORIES,
    OPEN_ALESIEV_LISTING_URL: OPEN_ALESIEV_LISTING_URL,
    OPEN_ALESIEV_SOURCE: OPEN_ALESIEV_SOURCE,
    OPEN_ALESIEV_ONYX_STYLE: OPEN_ALESIEV_ONYX_STYLE,
    OPEN_ALESIEV_BASELINE_STYLE: OPEN_ALESIEV_BASELINE_STYLE,
    OPEN_ALESIEV_TAGS: OPEN_ALESIEV_TAGS,
    OPEN_VERSION: OPEN_VERSION,
  };
}
