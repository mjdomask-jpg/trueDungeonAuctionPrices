/**
 * Phase 4 — Auction-open automation.
 *
 * Watches the two places an 8K auction can open — Trent's shop page and the
 * forum's two auction categories — and proposes the `auctionMetadata` row each
 * new one needs. Proposals land in a review tab. A human ticks the ones that
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
 * saved copies of all three page shapes through the pure functions below and
 * asserts they reproduce what `auctionMetadata.csv` already records.
 *
 * Everything above `--- Apps Script entry points ---` is pure: no
 * SpreadsheetApp, no UrlFetchApp, no I/O, no globals mutated. That is what
 * makes it testable off-platform, and it is worth keeping that way.
 *
 * This file has no `onOpen`. All three .gs files in this project share ONE
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
var OPEN_VERSION = '2026-08-22.1';

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
 * Only these eleven are typed by a human at open time. `daysToClose`, `Status`,
 * `Open Month`, `Close Month`, `augmentedTotal`, `fundingNoAugment` and
 * `preorderTotal` are all formulas — verified arithmetically against all 289
 * recorded rows: `augmentedTotal` is the sum of the three augment columns with
 * 0 disagreements, `fundingNoAugment` is `targetFunding - augmentedTotal` with
 * 0, and `daysToClose` is `MAX(closeDate - openDate, 1)` with 0. Writing a
 * literal into any of them would replace a formula with a frozen number.
 *
 * `closeDate` stays blank on purpose: `Status` is `IF(closeDate="","Open",
 * "Closed")`, so a blank close date is what makes a new auction read as open.
 */
var OPEN_METADATA_FIELDS = [
  'auctionId', 'auctionSeason', 'auctionNumber', 'auctionName', 'auctionStyle',
  'completionStyle', 'auctioneer', 'Link', 'openDate', 'targetFunding', 'augmentated',
];

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
  var ordered = proposals.slice().sort(function (a, b) { return String(a.openDate).localeCompare(String(b.openDate)); });
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
  return 'trent:' + String(row[7] || '').trim().toLowerCase();
}

/**
 * A rescan rewrites the review tab, and must not throw away work.
 *
 * Anything the operator typed — the tick, and the four columns the scan
 * deliberately leaves empty — is carried across for a proposal that is still
 * proposed. Rows already promoted stay, greyed by their `status`, so the tab
 * doubles as a record of what this phase has done.
 */
function openMergeReview(existingRows, proposals) {
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
      for (var c = 12; c <= 15; c++) if (String(old[c] || '').trim()) row[c] = old[c];
    }
    rows.push(row);
  }
  for (i = 0; i < existingRows.length; i++) {
    var k = openReviewKey(existingRows[i]);
    if (!seen[k] && /^promoted/.test(String(existingRows[i][1] || ''))) keptPromoted.push(existingRows[i]);
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
  approved.sort(function (a, b) { return String(a.row[4]).localeCompare(String(b.row[4])); });

  var recordedTopics = openRecordedTopics(metaRows);
  var recordedTrent = openRecordedTrentNames(metaRows);
  var lastSeason = null;
  for (i = 0; i < metaRows.length; i++) lastSeason = String(metaRows[i].auctionSeason);

  var next = {}, out = [], problems = [], warnings = [];
  for (i = 0; i < approved.length; i++) {
    var row = approved[i].row;
    var name = String(row[7] || '').trim();
    var season = String(row[8] || '').trim();
    var link = String(row[11] || '').trim();
    var topicId = openTopicId(link);
    var label = name || link || ('review row ' + (approved[i].index + 2));

    if (!season) { problems.push(label + ': no season'); continue; }
    if (!String(row[4] || '').trim()) { problems.push(label + ': no openDate'); continue; }
    if (!name) { problems.push(label + ': no auctionName'); continue; }
    if (topicId && recordedTopics[topicId]) { problems.push(label + ': topic ' + topicId + ' is already recorded as ' + recordedTopics[topicId]); continue; }
    var trentKey = openTrentKey(season, name);
    if (!topicId && recordedTrent[trentKey]) { problems.push(label + ': "' + name + '" is already recorded as ' + recordedTrent[trentKey] + ' for season ' + season); continue; }

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
      openDate: String(row[4] || '').trim(),
      targetFunding: String(row[15] || '').trim(),
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
 *   - `write`  — one of the eleven columns this phase fills in.
 *   - `keep`   — the source cell holds a FORMULA, so the copy is already
 *                correct with its references shifted a row. `Status`,
 *                `daysToClose`, `Open Month` and the funding columns are these.
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
    if (value !== null && value !== undefined) { actions.push({ action: 'write', value: value }); continue; }
    var formula = String((sourceFormulas || [])[i] || '');
    actions.push(formula ? { action: 'keep', value: null } : { action: 'clear', value: '' });
  }
  return actions;
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

  var selection = openSelectFeedItems(feedItems, metaRows, {});
  var topics = [];
  for (i = 0; i < selection.selected.length; i++) {
    var item = selection.selected[i];
    var html = openFetch(openTopicUrl(item.catid, item.id));
    if (!html) { fetchNotes.push('Forum: topic ' + item.id + ' could not be fetched.'); continue; }
    topics.push({ item: item, topic: openParseTopic(html) });
  }

  var plan = openPlanScan({ metaRows: metaRows, trentPage: trentPage, topics: topics });
  plan.notes = plan.notes.concat(fetchNotes);
  plan.notes.push('Looked at forum topics with a post since ' + selection.cutoff + ': ' +
    selection.selected.length + ' fetched, ' + selection.skipped.recorded + ' already recorded, ' +
    selection.skipped.old + ' older than the cutoff' +
    (selection.skipped.offTopic ? ', ' + selection.skipped.offTopic + ' in the general category with no 8K signal' : '') +
    (selection.skipped.overflow ? ', ' + selection.skipped.overflow + ' left for the next run (fetch cap)' : '') + '.');

  openWriteReview(plan.proposals);
  ui.alert('Scan complete (script ' + OPEN_VERSION + ')', openDescribeScan(plan), ui.ButtonSet.OK);
}

/**
 * Rewrite the review tab, carrying over the operator's ticks and typed cells.
 * Creates the tab when it is missing; a new tab is the only thing this phase
 * makes without being asked.
 */
function openWriteReview(proposals) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(OPEN_TABS.review);
  var existing = [];
  if (!sheet) {
    sheet = ss.insertSheet(OPEN_TABS.review);
  } else {
    var values = sheet.getDataRange().getValues();
    if (values.length > 1) existing = values.slice(1);
  }
  var rows = openMergeReview(existing, proposals);

  // clear() leaves data validation behind, so a shorter rescan would strand
  // checkboxes below the last row — tickable, and attached to nothing.
  sheet.getRange(1, 1, sheet.getMaxRows(), 1).clearDataValidations();
  sheet.clear();
  sheet.getRange(1, 1, 1, OPEN_REVIEW_COLUMNS.length).setValues([OPEN_REVIEW_COLUMNS]).setFontWeight('bold');
  if (rows.length) {
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
  var reviewRows = reviewValues.length > 1 ? reviewValues.slice(1) : [];
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
    openShiftIsoDays: openShiftIsoDays,
    openParseTrentPage: openParseTrentPage,
    openParseFeed: openParseFeed,
    openParseTopic: openParseTopic,
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
    openHeaderProblems: openHeaderProblems,
    openDescribeScan: openDescribeScan,
    OPEN_REVIEW_COLUMNS: OPEN_REVIEW_COLUMNS,
    OPEN_METADATA_FIELDS: OPEN_METADATA_FIELDS,
    OPEN_TRENT_DEFAULTS: OPEN_TRENT_DEFAULTS,
    OPEN_TRENT_URL: OPEN_TRENT_URL,
    OPEN_FORUM_CATEGORIES: OPEN_FORUM_CATEGORIES,
    OPEN_SIGNAL_ONLY_CATEGORIES: OPEN_SIGNAL_ONLY_CATEGORIES,
    OPEN_VERSION: OPEN_VERSION,
  };
}
