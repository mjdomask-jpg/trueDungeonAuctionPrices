/**
 * Phase 2 — Trent close automation.
 *
 * Paste the two columns of Trent's close file into the `trentStaging` tab, pick
 * the target auction, click one menu item. This script parses the lot names,
 * resolves each to its canonical `Item`, divides multi-token lots down to a
 * per-token price, and appends the results to `rawPricesData`, `prices`
 * and `onyx` — keyed to an auctionId the script derives, never to rows a
 * human selects.
 *
 * That last part is the point. The operator never chooses a paste target, so
 * "pasted into the wrong auction" — the defect that put a verbatim copy of one
 * auction's prices onto another, twice — becomes impossible rather than merely
 * detectable.
 *
 * THIS FILE IS THE SOURCE OF TRUTH. It lives in the repo and is copied into the
 * workbook's Apps Script editor, not edited there. `npm run test:trent` replays
 * every Trent auction the repo already holds through the pure functions below
 * and asserts they reproduce the shipped CSVs exactly; an edit made only in the
 * editor is an edit nothing tests.
 *
 * Everything above `--- Apps Script entry points ---` is pure: no
 * SpreadsheetApp, no I/O, no globals mutated. That is what makes it testable
 * off-platform, and it is worth keeping that way.
 */

// ===========================================================================
// Configuration
// ===========================================================================

/**
 * Tab names in the workbook, verified against the 2026-08-20 export.
 *
 * The price tab is `prices`. It is NOT `auctionPrices` — that name appears in
 * older runbook text and in the plan, and it is wrong. What does exist is
 * `auctionPricesOLD`, a retired copy that still recalculates; writing to it
 * would put rows somewhere nothing exports while the real tab stayed empty.
 * Hence the OLD_TAB_RE guard below, and hence checkTabs() runs before anything
 * is written.
 */
var TABS = {
  staging: 'trentStaging',
  prices: 'prices',
  raw: 'rawPricesData',
  onyx: 'onyx',
  metadata: 'auctionMetadata',
  tokens: 'tokenMetadata',
};

/** Retired tabs that still recalculate. Never write to one. */
var OLD_TAB_RE = /OLD$/;

/**
 * Shown in every dialog, so the copy pasted into the workbook can be told apart
 * from the copy in the repo at a glance. Bump it with any change to this file —
 * otherwise "do I need to update the script?" has no answer but "re-paste and
 * hope".
 */
var SCRIPT_VERSION = '2026-08-21.4';

/**
 * Trent's headers are not stable and neither are their positions: four sample
 * files say `Product Name | Highest Bid`, one says `Token | Price`, and one
 * puts the pair in columns C and D behind two date columns. Matching by
 * position fails and matching one exact header fails, so match by alias.
 */
var NAME_HEADERS = ['product name', 'token', 'item'];
var PRICE_HEADERS = ['highest bid', 'price', 'winning bid'];

/**
 * Lot names that `tokenMetadata`'s per-season display names cannot resolve.
 * Keyed by the lowercased name with its decorations already stripped.
 *
 * This replaces the old `trentNormalization` tab, which enumerated every
 * individual lot name *including its lot number* — 491 rows, `1,000 GP Gold Bar
 * #1` through `#44`, then again for each `x 4` spelling — so it needed a new
 * entry every time Trent sold a 45th gold bar, and returned `#N/A` until
 * someone added it. Stripping decorations first collapses those 491 rows to 74
 * base names, of which `tokenMetadata` already resolves the large majority.
 * What is left is genuinely irregular, and none of it grows with the lot count.
 *
 * Measured against all 18,466 rows of `rawPricesData`: these entries plus
 * `tokenMetadata` resolve every one, with zero names mapping to two `Item`s.
 *
 * THE TABLE IS TWO VOCABULARIES, and they do not overlap at all. Trent needs
 * four entries; the other fourteen come from `202647`, which is *not* a Trent
 * auction — it is alesiev's forum auction, the first to supply per-lot data.
 * Keeping both here is deliberate: Phase 5 reads forum results through this
 * same parser, so the forum vocabulary is where it will be needed. But do not
 * read the abbreviations as "how Trent writes lot names", because they are not.
 */
var EXCEPTIONS = {
  // --- Trent ---------------------------------------------------------------
  // PYP aliases — by far the biggest, 3,700+ lots.
  'ultra rare pyp': 'Ultra Rare',
  'gold ultra rare pyp': 'Ultra Rare',
  // Packaging noise: the physical button ships with a code.
  "adventurers' guild button and vtd code": "Adventurers' Guild Button",
  // (the Patron Pin year-variants are PATRON_PIN_RE, below)

  // --- Forum (alesiev, 202647) ---------------------------------------------
  'pyp': 'Ultra Rare',
  'ag codes': "Adventurers' Guild Button",
  '1k gp': '1,000 GP Gold Bar',
  // Community abbreviations, as printed on the game pieces. Mirrors
  // src/lib/tokenAbbreviations.ts. Note "ag" is Aragonite while "ag codes"
  // above is the Guild Button — and BOTH appear in the same file, which is why
  // these are exact keys and why the prefix rule has a length floor.
  'ai': "Alchemist's Ink",
  'ap': "Alchemist's Parchment",
  'ds': 'Dwarven Steel',
  'ms': 'Mystic Silk',
  'em': "Enchanter's Munition",
  'mh': 'Minotaur Hide',
  'ps': "Philosopher's Stone",
  'dp': 'Darkwood Plank',
  'oe': 'Oil of Enchantment',
  'eb': 'Elven Bismuth',
  'ag': 'Aragonite',
};

/** Patron pin ships with a code and the name carries the year. */
var PATRON_PIN_RE = /^\d{4} patron (lapel )?pin and (patron )?code$/;

/** The one Onyx name that differs from how the site stores it. */
var ONYX_NORMALIZATION = { 'common/uncommon/rare set': 'C/UC/R Set' };

var ONYX_CATEGORY = 'Onyx Ultra Rare';

// ===========================================================================
// Pure core
// ===========================================================================

/**
 * Round to cents the way Sheets does: half AWAY from zero.
 *
 * `Math.round` is half-UP, and binary division leaves a tie sitting a hair
 * below its true value — $8.29/2 is 4.14499…, not 4.145 — so the naive version
 * rounds 15 of the shipped rows the wrong way. Re-quantising to 12 significant
 * digits erases that noise without reaching any real difference.
 */
function roundCents(n) {
  var sign = n < 0 ? -1 : 1;
  return sign * Math.round(Number((Math.abs(n) * 100).toPrecision(12))) / 100;
}

/**
 * Strip the decorations Trent hangs off a display name.
 *
 * The grammar is `<Display Name> [#lot] [(N Tokens)]`, and the lot number sits
 * BEFORE the quantity — `1,000 GP Gold Bar #1 (4 Tokens)`. So this tokenises
 * rather than suffix-stripping; an end-anchored `#\d+$` drops 11 lots on the
 * floor.
 */
function stripDecorations(name) {
  var s = ' ' + String(name == null ? '' : name) + ' ';
  s = s.replace(/^\s*\d+\s*[xX]\s+/, ' ');          // leading "N x " multiplier
  s = s.replace(/\(\s*\d+\s*Tokens?\s*\)/gi, ' ');  // "(N Tokens)"
  s = s.replace(/#\s*\d+/g, ' ');                   // lot number, anywhere
  s = s.replace(/\s[xX]\s*\d+(?![\d.])/g, ' ');     // mid-name "xN"
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Quantity of tokens in a lot.
 *
 *   lead    = a leading "N x "                 -> per-unit multiplier
 *   lotSize = "(N Tokens)" or a mid-name "xN"  -- these state the SAME number
 *   qty     = lead x (lotSize or 1)
 *
 * `1,000 GP Gold Bar x4 #1 (4 Tokens)` is 4, not 16 — the `x4` and the
 * `(4 Tokens)` are one fact written twice. `3X Treasure Chips x 4 #1
 * (4 Tokens)` is 12: a leading 3 times a lot size of 4. Where the two
 * spellings of lot size disagree, say so and never guess.
 *
 * Verified against all 18,466 rows of `rawPricesData` and all 491 rows of the
 * old `trentNormalization` tab: zero disagreements.
 */
function parseQuantity(name) {
  var s = String(name == null ? '' : name);
  var lead = s.match(/^(\d+)\s*[xX]\s+/);
  var leadN = lead ? parseInt(lead[1], 10) : 1;
  if (lead) s = s.slice(lead[0].length);
  var tokens = s.match(/\(\s*(\d+)\s*Tokens?\s*\)/i);
  var tokenN = tokens ? parseInt(tokens[1], 10) : null;
  var mid = s.match(/\s[xX]\s*(\d+)(?![\d.])/);
  var midN = mid ? parseInt(mid[1], 10) : null;
  var conflict = tokenN !== null && midN !== null && tokenN !== midN;
  var lotSize = tokenN !== null ? tokenN : (midN !== null ? midN : 1);
  return { quantity: leadN * lotSize, conflict: conflict, tokenN: tokenN, midN: midN };
}

/**
 * Detect and strip the Onyx marker.
 *
 * It sits in a different place for every auctioneer and is always stripped
 * from the stored `Item`. Trent's own file uses the last form —
 * `+2 Sacred Sling - 2023 (Onyx)` — where the trailing ` - <year>` has to come
 * off as well. The other three are here because Phase 5 reads the same shapes
 * out of forum posts and there is no reason to write this twice.
 */
function stripOnyxMarker(name) {
  var s = String(name == null ? '' : name).trim();
  if (!/onyx/i.test(s)) return { isOnyx: false, name: s };
  s = s.replace(/\s*\(\s*onyx\s*\)\s*/i, ' ');   // "+2 Sacred Sling (Onyx)"
  s = s.replace(/^\s*onyx\s+/i, '');             // "Onyx +2 Branding Mace"
  s = s.replace(/\s+onyx\s*$/i, '');             // "+2 Mug of Battle ONYX"
  s = s.replace(/\s*-\s*(19|20)\d{2}\s*$/, '');  // the trailing " - 2023"
  s = s.replace(/\s+/g, ' ').trim();
  var normalized = ONYX_NORMALIZATION[s.toLowerCase()];
  return { isOnyx: true, name: normalized || s };
}

/**
 * Index `tokenMetadata` rows for lookup: season -> lowercased name -> row.
 * Both `Display Name` and `Item` are indexed, so either spelling resolves.
 */
function buildTokenIndex(rows) {
  var index = {};
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r.auctionSeason || !r.Item) continue;
    var season = String(r.auctionSeason);
    if (!index[season]) index[season] = { byName: {}, names: [] };
    var names = [r['Display Name'], r.Item];
    for (var j = 0; j < names.length; j++) {
      if (!names[j]) continue;
      var lower = String(names[j]).toLowerCase();
      if (!index[season].byName[lower]) index[season].names.push(lower);
      index[season].byName[lower] = r;
    }
  }
  return index;
}

/** Shortest name a prefix match will consider. See resolveBySeasonNames. */
var MIN_PREFIX_LENGTH = 8;

/**
 * Resolve against ONE season's own names — display names first, then the
 * plural and variant spellings Trent uses, then an unambiguous prefix.
 *
 * Kept separate from resolveToken because only this half is
 * season-discriminating: the exception list is global, so a name that resolves
 * only through it says nothing about which season the file belongs to.
 * inferSeasons depends on that distinction.
 */
function resolveBySeasonNames(base, season, index) {
  var entry = index[String(season)];
  if (!entry || !base) return null;
  var byName = entry.byName;

  function look(name) { return name ? byName[String(name).toLowerCase()] || null : null; }

  var hit = look(base);
  if (hit) return hit;

  // Trent pluralises multi-token lots: "10x Darkwood Planks".
  var plurals = [base.replace(/s$/, ''), base.replace(/ies$/, 'y'), base.replace(/es$/, '')];
  for (var i = 0; i < plurals.length; i++) {
    if (plurals[i] !== base) { hit = look(plurals[i]); if (hit) return hit; }
  }

  // Year and colour variants of the Patron tokens:
  // "Underling Dwarf Fighter - 2025 (White)", "Hireling Baker (Yearless) - White".
  var trimmed = base
    .replace(/\s*\(\s*yearless\s*\)/i, '')
    .replace(/\s*-\s*(19|20)\d{2}\b/, '')
    .replace(/\s*[-(]\s*(white|black|gold|silver)\s*\)?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed && trimmed !== base) { hit = look(trimmed); if (hit) return hit; }

  // Truncations. The bonus tokens get typed short — "Path to Enlightenment"
  // for "Path to Enlightenment (Fragment 4)", "Mark of the 1st" for "Mark of
  // the 1st Tenet" — and once as an outright typo, "Ring of the 1st Circl".
  // (All three are alesiev's forum file, not Trent's; see EXCEPTIONS.)
  // A prefix match covers all three without an entry each, but only when it
  // picks out exactly ONE name in the season: two candidates means guessing,
  // and guessing is the thing this whole phase exists to remove. The length
  // floor keeps two-letter abbreviations out; those are exceptions, and "AG"
  // is Aragonite rather than the Adventurers' Guild Button precisely because
  // someone decided that, not because a prefix rule inferred it.
  if (base.length >= MIN_PREFIX_LENGTH) {
    var lowerBase = base.toLowerCase(), found = null, count = 0;
    for (var n = 0; n < entry.names.length; n++) {
      if (entry.names[n].indexOf(lowerBase) === 0) { count++; found = entry.names[n]; }
    }
    if (count === 1) return byName[found];
  }
  return null;
}

/**
 * Resolve a stripped lot name to its `tokenMetadata` row for a season: the
 * season's own names first, then the global exception list.
 *
 * That order is what makes the exception list safe. An entry can only fire
 * where the season had no name of its own to offer, so adding one can never
 * shadow real metadata.
 */
function resolveToken(base, season, index) {
  var hit = resolveBySeasonNames(base, season, index);
  if (hit) return hit;
  var lower = String(base || '').toLowerCase();
  var canonical = EXCEPTIONS[lower] || (PATRON_PIN_RE.test(lower) ? 'Patron Pin' : null);
  return canonical ? resolveBySeasonNames(canonical, season, index) : null;
}

/** Every season whose own names resolve this one, excluding `skip`. */
function seasonsResolving(base, index, skip) {
  var found = [], seasons = Object.keys(index).sort();
  for (var i = 0; i < seasons.length; i++) {
    if (seasons[i] === String(skip)) continue;
    if (resolveBySeasonNames(base, seasons[i], index)) found.push(seasons[i]);
  }
  return found;
}

/**
 * Infer the season from the file's own contents.
 *
 * Trent's file carries NO auction identifier, and the year in its filename is a
 * CALENDAR year, not a season — they diverge for every autumn auction, so
 * "Trent Auction 5 2023" is season 2024. But most tokens are named differently
 * each season (Ring of the 5th/4th/3rd/2nd/1st Circle for the 1k bonus across
 * 2022-2026), so the file can say which season it is and be checked against the
 * auction the operator picked. That catches "pasted into the wrong auction" at
 * the season level — defect #1 and #2, one level up.
 *
 * Counts how many lot names each season can resolve FROM ITS OWN NAMES; the
 * exception list is deliberately excluded, since it is global and would give
 * every season the same credit. Names shared across seasons — most of the trade
 * goods — score equally everywhere and cannot break the tie, which is fine:
 * only the discriminating names move the answer.
 *
 * Returns every season tied for the best score. Exactly one is a confident
 * answer; several means the file carries nothing season-specific, which is not
 * the same as a mismatch and must not be treated as one.
 */
function inferSeasons(names, index) {
  var seasons = Object.keys(index);
  var counts = {}, bases = [];
  for (var s = 0; s < seasons.length; s++) counts[seasons[s]] = 0;
  for (var i = 0; i < names.length; i++) bases.push(stripDecorations(names[i]));

  for (var j = 0; j < seasons.length; j++) {
    for (var b = 0; b < bases.length; b++) {
      if (resolveBySeasonNames(bases[b], seasons[j], index)) counts[seasons[j]]++;
    }
  }
  var best = 0;
  for (var k = 0; k < seasons.length; k++) best = Math.max(best, counts[seasons[k]]);
  if (best === 0) return [];
  var winners = [];
  for (var m = 0; m < seasons.length; m++) if (counts[seasons[m]] === best) winners.push(seasons[m]);
  return winners;
}

/**
 * Find the name and price columns in a pasted grid and return its lots.
 * Blank trailing rows are ignored; a row with a name but no bid is kept, since
 * an empty bid is the real no-sale signal and the caller must count them.
 */
function readStaging(values) {
  if (!values || !values.length) return { error: 'the staging tab is empty' };
  var header = values[0].map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
  var nameCol = -1, priceCol = -1;
  for (var i = 0; i < header.length; i++) {
    if (nameCol === -1 && NAME_HEADERS.indexOf(header[i]) !== -1) nameCol = i;
    if (priceCol === -1 && PRICE_HEADERS.indexOf(header[i]) !== -1) priceCol = i;
  }
  if (nameCol === -1 || priceCol === -1) {
    return {
      error: 'could not find the name and price columns. Row 1 reads [' + header.join(' | ') +
        ']; expected one of [' + NAME_HEADERS.join(', ') + '] and one of [' + PRICE_HEADERS.join(', ') + '].',
    };
  }
  var lots = [];
  for (var r = 1; r < values.length; r++) {
    var name = String(values[r][nameCol] == null ? '' : values[r][nameCol]).trim();
    if (!name) continue;
    var rawBid = values[r][priceCol];
    var bidText = String(rawBid == null ? '' : rawBid).replace(/[$,]/g, '').trim();
    // Trent's .xlsx carries raw float noise — one bid is stored as
    // 70.099999999999994 — so quantise on read.
    var bid = bidText === '' ? null : roundCents(parseFloat(bidText));
    lots.push({ name: name, bid: isNaN(bid) ? null : bid, row: r + 1 });
  }
  return { lots: lots };
}

/**
 * The whole routing pass. Takes the staged lots and returns what belongs in
 * each output, plus the reasons to abort.
 *
 * Trent's file is COMPLETE: it carries Onyx lots and unsold lots inline
 * alongside the price spine, and the person doing this by hand was filtering
 * them out correctly. So this needs routing rules, not an abort:
 *
 *   `<Item> - <year> (Onyx)`   -> onyx, marker and year stripped
 *   blank bid                  -> dropped, genuinely unsold, reported
 *   anything else resolvable   -> prices + rawPricesData
 *   anything unresolvable      -> ABORT and list it
 *
 * That last line is why no separate check is needed for context items: a
 * grunnel row says "Grunnel Scroll", which is not a token and resolves to
 * nothing, so it stops the run and asks — exactly right.
 */
function processAuction(lots, season, index) {
  var aborts = [], unsold = [], onyx = [], perItem = {}, order = [], raw = [], unresolved = [];

  for (var i = 0; i < lots.length; i++) {
    var lot = lots[i];
    var where = 'row ' + lot.row + ' "' + lot.name + '"';

    var marked = stripOnyxMarker(lot.name);
    if (marked.isOnyx) {
      // Onyx names are chase Ultra Rares and are stored verbatim — they are not
      // in tokenMetadata, so they neither resolve nor need to.
      if (lot.bid === null) { unsold.push(lot); continue; }
      onyx.push({ Item: marked.name, Price: lot.bid, 'Display Name': marked.name, Category: ONYX_CATEGORY });
      continue;
    }

    // An empty bid is the real no-sale signal. Emit no row at all — a keyed
    // row with no price reads as "somebody meant to come back to this", and
    // the site drops it silently, which is indistinguishable from correct.
    if (lot.bid === null) { unsold.push(lot); continue; }

    var q = parseQuantity(lot.name);
    if (q.conflict) {
      aborts.push(where + ': lot size stated twice and they disagree — "(' + q.tokenN + ' Tokens)" vs "x' + q.midN + '"');
      continue;
    }

    var base = stripDecorations(lot.name);
    var token = resolveToken(base, season, index);
    if (!token) {
      // Two very different problems arrive through this one branch, and the
      // operator's next move is different for each — so say which is likely.
      //
      // A name that resolves in SOME OTHER season is probably a token: either
      // the wrong auction was picked, or tokenMetadata is missing a row for
      // this one. A name that resolves in NO season is probably not a token at
      // all — Trent's file carries grunnel and other context lots inline, and
      // those belong in contextItems. Every context row recorded against an
      // auction with per-lot data resolves in zero seasons, so the split is
      // reliable on the sample that exists.
      //
      // It stays an abort either way. Categories and quantities like
      // "Random UR (9)" are judgement calls, and a withheld row should carry no
      // price at all — the item never sold, and the site computes what it shows
      // from live sales. What the report can do is hand over a filled-in
      // worksheet — see contextRows().
      var elsewhere = seasonsResolving(base, index, season);
      unresolved.push({ name: lot.name, base: base, row: lot.row, bid: lot.bid, quantity: q.quantity, elsewhere: elsewhere });
      aborts.push(where + (elsewhere.length
        ? ': not a token in season ' + season + ', but it is in ' + elsewhere.join(', ') +
          ' — check you picked the right auction, or add it to tokenMetadata for ' + season
        : ': "' + base + '" is not a token in any season — most likely a context item ' +
          '(grunnel/token/withheld) belonging in contextItems, not a price'));
      continue;
    }

    var unit = roundCents(lot.bid / q.quantity);
    raw.push({
      trentName: lot.name,
      trentPrice: lot.bid,
      Item: token.Item,
      Price: unit,
      Category: token.Category,
    });
    if (!perItem[token.Item]) { perItem[token.Item] = { token: token, prices: [] }; order.push(token.Item); }
    perItem[token.Item].prices.push(unit);
  }

  // Min and max per item — and a SINGLE row where an item had only ONE LOT.
  //
  // The old runbook said to "remove items occurring once, generally Wish Ring,
  // 8k Bonus and Patron Pin". That misreads the data: those three appear in
  // nearly every auction, each as one row. The rule is that a one-lot item gets
  // one row instead of a min/max pair — you are deleting a duplicate second
  // row, not the item. A script told to remove singletons would silently drop
  // three tokens per auction.
  //
  // Note the test is the LOT COUNT, not whether min equals max. An item with
  // several lots that all fetched the same price still gets both rows: that is
  // what the sheet does in 1,635 of 1,640 such cases, and a pair carries the
  // information that the price held across the lots rather than being observed
  // once.
  order.sort();
  var prices = [];
  var emit = function (item, price) {
    var t = perItem[item].token;
    prices.push({ Item: t.Item, Price: price, 'Display Name': t['Display Name'], Category: t.Category });
  };
  for (var a = 0; a < order.length; a++) emit(order[a], Math.max.apply(null, perItem[order[a]].prices));
  for (var b = 0; b < order.length; b++) {
    var e = perItem[order[b]];
    if (e.prices.length > 1) emit(order[b], Math.min.apply(null, e.prices));
  }

  return { aborts: aborts, raw: raw, prices: prices, onyx: onyx, unsold: unsold, unresolved: unresolved };
}

/**
 * Everything the operator needs to decide whether to write, in one object.
 * `ok` is false whenever any abort condition fired; the caller writes nothing
 * in that case, and never a partial auction.
 */
function planImport(values, targetSeason, tokenMetadataRows) {
  var staged = readStaging(values);
  if (staged.error) return { ok: false, aborts: [staged.error] };
  if (!staged.lots.length) return { ok: false, aborts: ['the staging tab has a header but no lots'] };

  var index = buildTokenIndex(tokenMetadataRows);
  var names = staged.lots.map(function (l) { return l.name; });
  var seasons = inferSeasons(names, index);
  var result = processAuction(staged.lots, targetSeason, index);
  var aborts = result.aborts.slice();

  // The season the file thinks it is, versus the auction the operator picked.
  // Only a POSITIVE mismatch aborts. An inconclusive answer — several seasons
  // tied, because the file happens to carry nothing season-specific — is not
  // evidence of a mistake, and treating it as one would block imports that are
  // perfectly fine. It is surfaced as a caution instead, so the operator knows
  // this particular safety net did not engage.
  var cautions = [];
  if (!seasons.length || seasons.length > 1) {
    cautions.push('nothing in this file is unique to one season, so it could not be checked against season ' +
      targetSeason + ' — confirm you picked the right auction');
  } else if (seasons[0] !== String(targetSeason)) {
    aborts.push('this file looks like season ' + seasons[0] + ', but the chosen auction is season ' +
      targetSeason + ' — check you picked the right auction');
  }

  return {
    ok: aborts.length === 0,
    aborts: aborts,
    cautions: cautions,
    seasons: seasons,
    lots: staged.lots.length,
    raw: result.raw,
    prices: result.prices,
    onyx: result.onyx,
    unsold: result.unsold,
    unresolved: result.unresolved,
  };
}

/** The contextItems column order, so the worksheet pastes straight in. */
var CONTEXT_COLUMNS = ['auctionId', 'auctionSeason', 'auctionNumber', 'category', 'Item', 'quantity', 'priceAugmented'];

/**
 * Build a contextItems worksheet from the lots that resolved to no token in any
 * season — the ones most likely to be grunnel or other context rows riding
 * along in Trent's file.
 *
 * Deliberately incomplete in one column: `category` is left BLANK. The
 * vocabulary is `token`, `grunnel`, `withheld`, `augment`, and choosing between
 * them is a judgement about what the item was doing in the auction, not
 * something a name can decide. Quantity is the parser's best reading of the lot
 * name and is often 1 where the real answer is a bundle — "Random UR" was 9.
 *
 * Two things to fix by hand after pasting:
 *   • `token` and `grunnel` keep their price and it is positive. A `withheld`
 *     row should NOT get one — the item did not sell, so there is no bid to
 *     transcribe, and the SITE recomputes the figure it shows anyway (a
 *     point-in-time estimate, in src/lib/context.ts valueWithheld). The CSV's
 *     priceAugmented is ignored for withheld rows except as a fallback when an
 *     item has no prior same-season sale.
 *   • `withheld` is negative, `token` and `grunnel` positive.
 */
function contextRows(plan, target) {
  var rows = [];
  for (var i = 0; i < plan.unresolved.length; i++) {
    var u = plan.unresolved[i];
    // A name that resolves in another season is a token problem, not a context
    // item, and putting it here would send the operator down the wrong path.
    if (u.elsewhere.length) continue;
    rows.push([target.auctionId, target.auctionSeason, target.auctionNumber, '', u.base, u.quantity, u.bid]);
  }
  return rows;
}

/** Tab-separated so it pastes across columns rather than into one cell. */
function contextWorksheetText(plan, target) {
  var rows = contextRows(plan, target);
  if (!rows.length) return '';
  var lines = [CONTEXT_COLUMNS.join('\t')];
  for (var i = 0; i < rows.length; i++) lines.push(rows[i].join('\t'));
  return lines.join('\n');
}

/** A short human summary of a plan, for the confirmation dialog. */
function describePlan(plan, auctionId) {
  var lines = [];
  if (!plan.ok) {
    lines.push('NOTHING WILL BE WRITTEN — ' + plan.aborts.length + ' problem(s):');
    for (var i = 0; i < plan.aborts.length; i++) lines.push('  • ' + plan.aborts[i]);
    return lines.join('\n');
  }
  for (var c = 0; c < plan.cautions.length; c++) lines.push('CAUTION: ' + plan.cautions[c]);
  if (plan.cautions.length) lines.push('');
  lines.push('Auction ' + auctionId + ' — ' + plan.lots + ' lots read:');
  lines.push('  ' + plan.raw.length + ' priced lots  ->  ' + TABS.raw);
  lines.push('  ' + plan.prices.length + ' min/max rows  ->  ' + TABS.prices);
  if (plan.onyx.length) lines.push('  ' + plan.onyx.length + ' Onyx rows  ->  ' + TABS.onyx);
  if (plan.unsold.length) {
    lines.push('  ' + plan.unsold.length + ' unsold (no bid), dropped:');
    for (var j = 0; j < plan.unsold.length; j++) lines.push('      ' + plan.unsold[j].name);
  }
  return lines.join('\n');
}

// ===========================================================================
// --- Apps Script entry points ---
// Everything below touches the workbook. Nothing above it does.
// ===========================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('TD auctions')
    .addItem('Import Trent close…', 'importTrentClose')
    .addItem('Dry run — show what would be imported', 'dryRunTrentClose')
    .addToUi();
}

/**
 * Everything importTrentClose does except the writing. Use it for the first run
 * against a real close file, and any time the staging paste looks unusual.
 */
function dryRunTrentClose() {
  var ui = SpreadsheetApp.getUi();
  var missing = checkTabs();
  if (missing.length) { ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • '), ui.ButtonSet.OK); return; }

  var staging = SpreadsheetApp.getActive().getSheetByName(TABS.staging);
  var meta = readTab(TABS.metadata);
  var choice = ui.prompt('Dry run', 'Target auctionId?', ui.ButtonSet.OK_CANCEL);
  if (choice.getSelectedButton() !== ui.Button.OK) return;

  var auctionId = choice.getResponseText().trim();
  var target = null;
  for (var i = 0; i < meta.length; i++) if (meta[i].auctionId === auctionId) target = meta[i];
  if (!target) { ui.alert('No auction "' + auctionId + '" in ' + TABS.metadata + '.'); return; }

  var plan = planImport(staging.getDataRange().getDisplayValues(), target.auctionSeason, readTab(TABS.tokens));
  ui.alert('Dry run — nothing written (script ' + SCRIPT_VERSION + ')', describePlan(plan, auctionId), ui.ButtonSet.OK);
  showContextWorksheet(plan, target);
}

/** Read a tab as objects keyed by its header row, using displayed text. */
function readTab(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('no tab named "' + name + '"');
  // getDisplayValues, never getValues: the CSVs must match what Google's own
  // download writes, which is displayed text ($8,000.00, not 8000).
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1).map(function (row) {
    var o = {};
    for (var i = 0; i < header.length; i++) o[header[i]] = String(row[i] == null ? '' : row[i]).trim();
    return o;
  });
}

/**
 * Confirm every tab this needs exists, and that none of them is a retired
 * copy, BEFORE anything is read or written. Getting a tab name wrong is not a
 * hypothetical: this script shipped with `auctionPrices` for the price tab,
 * which does not exist — but `auctionPricesOLD` does.
 */
function checkTabs() {
  var ss = SpreadsheetApp.getActive();
  var problems = [];
  for (var role in TABS) {
    if (!Object.prototype.hasOwnProperty.call(TABS, role)) continue;
    var name = TABS[role];
    if (OLD_TAB_RE.test(name)) { problems.push('TABS.' + role + ' points at "' + name + '", a retired tab'); continue; }
    if (!ss.getSheetByName(name)) problems.push('no tab named "' + name + '" (TABS.' + role + ')');
  }
  return problems;
}

function importTrentClose() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();

  var missing = checkTabs();
  if (missing.length) {
    ui.alert('Cannot run', 'Tab problems:\n  • ' + missing.join('\n  • ') +
      '\n\nFix the names in TABS at the top of the script, or create the tab.', ui.ButtonSet.OK);
    return;
  }

  var staging = ss.getSheetByName(TABS.staging);

  // Pick the target auction: the newest Trent row that has no prices yet.
  var meta = readTab(TABS.metadata);
  var candidates = meta.filter(function (m) {
    return m.auctionId && (m.auctioneer || '').toLowerCase() === 'trent';
  }).sort(function (a, b) { return Number(b.auctionId) - Number(a.auctionId); });
  if (!candidates.length) { ui.alert('No Trent auctions in ' + TABS.metadata + '.'); return; }

  var choice = ui.prompt(
    'Import Trent close',
    'Target auctionId?\n\nMost recent Trent auctions:\n' +
      candidates.slice(0, 8).map(function (m) { return '  ' + m.auctionId + '  ' + m.auctionName; }).join('\n'),
    ui.ButtonSet.OK_CANCEL);
  if (choice.getSelectedButton() !== ui.Button.OK) return;

  var auctionId = choice.getResponseText().trim();
  var target = null;
  for (var i = 0; i < meta.length; i++) if (meta[i].auctionId === auctionId) target = meta[i];
  if (!target) { ui.alert('No auction "' + auctionId + '" in ' + TABS.metadata + '.'); return; }

  var plan = planImport(staging.getDataRange().getDisplayValues(), target.auctionSeason, readTab(TABS.tokens));
  var summary = describePlan(plan, auctionId);
  if (!plan.ok) {
    ui.alert('Import aborted — nothing written (script ' + SCRIPT_VERSION + ')', summary, ui.ButtonSet.OK);
    showContextWorksheet(plan, target);
    return;
  }

  var destinations = [
    TABS.raw + ' from row ' + (ss.getSheetByName(TABS.raw).getLastRow() + 1),
    TABS.prices + ' from row ' + (ss.getSheetByName(TABS.prices).getLastRow() + 1),
  ];
  if (plan.onyx.length) destinations.push(TABS.onyx + ' from row ' + (ss.getSheetByName(TABS.onyx).getLastRow() + 1));

  var go = ui.alert('Import Trent close (script ' + SCRIPT_VERSION + ')',
    summary + '\n\nAppending to:\n  ' + destinations.join('\n  ') + '\n\nWrite these rows?',
    ui.ButtonSet.OK_CANCEL);
  if (go !== ui.Button.OK) return;

  var keyed = function (row, cols) {
    var out = [auctionId, target.auctionSeason, target.auctionNumber];
    for (var c = 0; c < cols.length; c++) out.push(row[cols[c]]);
    return out;
  };
  appendRows(TABS.raw, plan.raw.map(function (r) {
    return keyed(r, ['trentName', 'trentPrice', 'Item', 'Price', 'Category']);
  }));
  appendRows(TABS.prices, plan.prices.map(function (r) {
    return keyed(r, ['Item', 'Price', 'Display Name', 'Category']);
  }));
  if (plan.onyx.length) {
    appendRows(TABS.onyx, plan.onyx.map(function (r) {
      return keyed(r, ['Item', 'Price', 'Display Name', 'Category']);
    }));
  }
  ui.alert('Done', summary + '\n\nWritten. Export the changed tabs and run `npm run validate`.', ui.ButtonSet.OK);
}

/**
 * Append literal values, not formulas.
 *
 * `rawPricesData`'s Item / Price / Category columns and `prices`'s Display Name
 * / Category columns are VLOOKUPs today, resolving names through
 * `trentNormalization`. This writes plain values into those columns instead,
 * which is the point: the parser has already done that work, and it does it
 * without needing a normalization row per lot number. New rows will therefore
 * be literals sitting under formula rows.
 *
 * The consequence worth knowing: do NOT fill the old formulas down over the
 * imported rows. They would resolve through `trentNormalization`, which no
 * longer gets new entries, and quietly replace correct values with the
 * "No Match Found" sentinel.
 */
/**
 * Show the contextItems worksheet in a copyable box. A ui.alert cannot be
 * selected from usefully, and the whole value of the block is being able to
 * paste it, so this needs a real dialog.
 */
function showContextWorksheet(plan, target) {
  var text = contextWorksheetText(plan, target);
  if (!text) return;
  var escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  var html = HtmlService.createHtmlOutput(
    '<div style="font:13px/1.5 Arial,sans-serif">' +
    '<p>These lots are not tokens in any season, so they were <b>not</b> imported. ' +
    'They look like <b>contextItems</b> rows. Fill in <code>category</code> ' +
    '(<code>token</code>, <code>grunnel</code>, <code>withheld</code> or <code>augment</code>), ' +
    'check the quantities, then paste into <code>contextItems</code>.</p>' +
    '<p><b>Do not put a price on a <code>withheld</code> row</b> — a withheld item did not sell, ' +
    'and the site recomputes what it displays from live sales anyway. ' +
    '<code>withheld</code> is negative; <code>token</code> and <code>grunnel</code> are positive. ' +
    'Then delete these lots from <code>' + TABS.staging + '</code> and run the import again.</p>' +
    '<textarea readonly style="width:100%;height:11em;font:12px monospace" ' +
    'onclick="this.select()">' + escaped + '</textarea>' +
    '</div>')
    .setWidth(680).setHeight(340);
  SpreadsheetApp.getUi().showModalDialog(html, 'Context items — copy into contextItems');
}

function appendRows(tabName, rows) {
  if (!rows.length) return;
  var sheet = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sheet) throw new Error('no tab named "' + tabName + '"');
  if (OLD_TAB_RE.test(tabName)) throw new Error('refusing to write to the retired tab "' + tabName + '"');
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// Lets Node load the pure functions for testing; Apps Script has no `module`
// and skips this entirely.
if (typeof module !== 'undefined') {
  module.exports = {
    roundCents: roundCents,
    stripDecorations: stripDecorations,
    parseQuantity: parseQuantity,
    stripOnyxMarker: stripOnyxMarker,
    buildTokenIndex: buildTokenIndex,
    resolveToken: resolveToken,
    resolveBySeasonNames: resolveBySeasonNames,
    inferSeasons: inferSeasons,
    readStaging: readStaging,
    processAuction: processAuction,
    planImport: planImport,
    describePlan: describePlan,
    seasonsResolving: seasonsResolving,
    contextRows: contextRows,
    contextWorksheetText: contextWorksheetText,
    CONTEXT_COLUMNS: CONTEXT_COLUMNS,
    EXCEPTIONS: EXCEPTIONS,
  };
}
