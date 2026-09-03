// Tests for apps-script/auctionOpen.gs — Phase 4 of data-pipeline-plan.md.
//
// The script runs inside Google Apps Script, where nothing can test it. Its
// pure core is therefore written with no SpreadsheetApp and no UrlFetchApp, so
// it can be loaded here and replayed against saved copies of the real pages.
//
// Three kinds of test:
//
//   1. REPLAY. fixtures/auction-open/ holds verbatim pages from all three sources.
//      Every one from Trent and the forum is an auction auctionMetadata.csv
//      already records, so the parse is checked against the shipped row rather
//      than against a hand-written expectation. That is the same idea as
//      Phase 2's replay, scaled to what a page can prove.
//
//      alesievauctions.com is the exception and section 11 says why: its two
//      auctions have not opened yet, so there is no recorded row to replay
//      against. What stands in for one is that the two cards differ in a
//      single badge, and that the values the badges produce are asserted to be
//      strings auctionMetadata already uses.
//
//   2. RULES. Numbering, duplicate detection, auctioneer matching, season
//      inference and the review-tab merge, checked against the whole of
//      auctionMetadata.csv where it can be — the numbering gaps that make
//      `max + 1` mandatory are real gaps in that file, not invented ones.
//
//   3. TRIAGE HONESTY. The 8K test is measured against both live feeds and the
//      recorded auctions in them, and the test asserts the measured numbers.
//      It is deliberately not a pass/fail on accuracy: the point is that the
//      accuracy is known, written down, and low enough that nothing may be
//      filled in blind.
//
// Run: node scripts/auction-open.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'public', 'data');
const fixtureDir = join(here, '..', 'fixtures', 'auction-open');

// --- load the Apps Script's pure core ---------------------------------------
// A .gs file is plain JavaScript with no import/export, so it evaluates
// directly. Its module.exports guard hands back the pure functions; everything
// that touches SpreadsheetApp or UrlFetchApp is only ever defined here, never
// called.
const sandbox = { module: { exports: {} }, console };
runInNewContext(readFileSync(join(here, '..', 'apps-script', 'auctionOpen.gs'), 'utf8'), sandbox);
const O = sandbox.module.exports;

// --- tiny RFC-4180 CSV parser -----------------------------------------------
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function objs(text) {
  const r = parseCSV(text); if (!r.length) return [];
  const h = r[0].map((x) => x.trim());
  return r.slice(1).map((c) => Object.fromEntries(h.map((k, i) => [k, (c[i] ?? '').trim()])));
}

const metaText = readFileSync(join(dataDir, 'auctionMetadata.csv'), 'utf8');
const META = objs(metaText);
const HEADERS = parseCSV(metaText)[0].map((x) => x.trim());
const manifest = JSON.parse(readFileSync(join(fixtureDir, 'manifest.json'), 'utf8'));
const fixture = (name) => gunzipSync(readFileSync(join(fixtureDir, name))).toString('utf8');
const byId = new Map(META.map((r) => [r.auctionId, r]));

let pass = 0, fail = 0;
const ok = (name) => { console.log(`ok      ${name}`); pass++; };
const bad = (name, detail) => { console.error(`FAIL    ${name}`); if (detail) console.error(detail.split('\n').map((l) => '        ' + l).join('\n')); fail++; };
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));
const eq = (name, got, want) => check(name, got === want, `got  ${JSON.stringify(got)}\nwant ${JSON.stringify(want)}`);

// ===========================================================================
// 1. Trent's page
// ===========================================================================
console.log("Trent's collection page\n");
{
  const html = fixture(manifest.trent.file);
  const page = O.openParseTrentPage(html);
  const want = manifest.trent.expect;
  eq('auction number read off the page', page.number, want.number);
  eq('start date to ISO', page.startDate, want.startDate);
  eq('current status', page.status, want.status);
  eq('season', page.season, want.season);
  eq('reserve total', page.reserve, want.reserve);
  check('withheld sentence captured', /except/i.test(page.withheld || ''), JSON.stringify(page.withheld));

  // The Shopify page carries ~60 KB of inline configuration full of the words
  // this parser looks for. If scripts were not stripped first, the description
  // would be found somewhere in that instead — and the parsed text would be
  // enormous rather than the dozen lines a human reads.
  check('inline script and style stripped before parsing',
    !/wk_labels|auction_ending_soonest|extra_field/.test(page.text) && page.text.length < 6000,
    `parsed text is ${page.text.length} chars of ${html.length}`);

  const recorded = byId.get(manifest.trent.reconciles);
  eq('reconciles against the recorded auction name', 'Trent Auction ' + page.number, recorded.auctionName);
  eq('reconciles against the recorded openDate', page.startDate, recorded.openDate);
  eq('reconciles against the recorded targetFunding', '$' + page.reserve + '.00', recorded.targetFunding);

  // The page calls the ORDER "Super Condensed"; the sheet records the AUCTION
  // as Ultra Condensed. Reading style off the page would be wrong here and for
  // all 110 other Trent auctions.
  check('the page style is NOT the recorded style',
    /super condensed/i.test(page.orderStyle || '') && recorded.auctionStyle === 'Ultra Condensed',
    `page "${page.orderStyle}" vs sheet "${recorded.auctionStyle}"`);
  eq('Trent default style matches the sheet', O.OPEN_TRENT_DEFAULTS.auctionStyle, recorded.auctionStyle);

  const proposal = O.openTrentProposal(page, META);
  check('an already-recorded Trent auction is not proposed again',
    proposal && proposal.alreadyRecorded === manifest.trent.reconciles,
    JSON.stringify(proposal));

  // The same page against a sheet that has not seen auction 33 yet.
  const without = META.filter((r) => r.auctionName !== 'Trent Auction 33');
  const fresh = O.openTrentProposal(page, without);
  eq('a new Trent auction proposes its name', fresh.auctionName, 'Trent Auction 33');
  eq('  ... its season', fresh.season, '2026');
  eq('  ... its open date', fresh.openDate, '2026-03-28');
  eq('  ... its auctioneer', fresh.auctioneer, 'Trent');
  eq('  ... its link, the one all 111 rows share', fresh.link, O.OPEN_TRENT_URL);
  eq('  ... and the number after the season max', String(fresh.number), '48');
  check('  ... with the page-vs-sheet style disagreement in the notes',
    fresh.notes.some((n) => /page calls the ORDER/.test(n)), fresh.notes.join(' | '));
}

// ===========================================================================
// 2. Topic pages — replayed against the recorded rows
// ===========================================================================
console.log('\nForum topic pages\n');
for (const t of manifest.topics) {
  const html = fixture(t.file);
  const topic = O.openParseTopic(html);
  const recorded = byId.get(t.reconciles);
  eq(`${t.id}: first-post date`, topic.openDate, t.expect.openDate);
  eq(`${t.id}: first-post time`, topic.openTime, t.expect.openTime);
  eq(`${t.id}: topic starter`, topic.starter, t.expect.starter);
  const match = O.openMatchAuctioneer(topic.starter, O.openKnownAuctioneers(META));
  eq(`${t.id}: "${t.expect.starter}" resolves to the recorded auctioneer`, match.auctioneer, recorded.auctioneer);
  eq(`${t.id}: ... which is what ${t.reconciles} records`, match.auctioneer, t.expect.auctioneer);
  check(`${t.id}: the Link in the sheet points at this topic`, O.openTopicId(recorded.Link) === t.id,
    `${recorded.Link} -> ${O.openTopicId(recorded.Link)}`);
}
{
  // Of the seven, five reproduce the recorded openDate exactly. Two do not, and
  // neither is a parser error: 258020's thread opened at 22:51 and is recorded
  // against the next day, and 255503 is one of a batch the operator dated to
  // the day that season's auctions were allowed to start. This is the whole
  // reason the phase proposes rather than writes.
  let exact = 0;
  for (const t of manifest.topics) {
    const topic = O.openParseTopic(fixture(t.file));
    if (topic.openDate === byId.get(t.reconciles).openDate) exact++;
  }
  eq('5 of the 7 first-post dates are the recorded openDate exactly', exact, 5);
  const late = O.openParseTopic(fixture('topic-258020.html.gz'));
  const proposal = O.openForumProposal(
    { id: '258020', catid: '584', title: late.title, isoDate: late.openDate }, late,
    META.filter((r) => r.auctionId !== '20251'), O.openKnownAuctioneers(META));
  check('a 22:51 open is flagged as near-midnight',
    proposal.notes.some((n) => /near midnight/.test(n)), proposal.notes.join(' | '));
}

// ===========================================================================
// 3. Feeds
// ===========================================================================
console.log('\nCategory feeds\n');
const FEED = [];
for (const f of manifest.feeds) {
  const items = O.openParseFeed(fixture(f.file), f.catid);
  FEED.push(...items);
  check(`${f.catid}: items parsed`, items.length > 50, `${items.length} items`);
  check(`${f.catid}: every item has a topic id`, items.every((i) => /^\d+$/.test(i.id)), '');
  check(`${f.catid}: every item has an ISO date`, items.every((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.isoDate || '')), '');
  check(`${f.catid}: ids are unique`, new Set(items.map((i) => i.id)).size === items.length, '');
}
{
  // pubDate is the LAST post, not the topic's creation. 259798 opened
  // 2026-08-07 and its feed item is dated later. Anything that treated the feed
  // date as an open date would be wrong by however long the thread ran.
  const item = FEED.find((i) => i.id === '259798');
  check('feed pubDate is the last post, not the open', item.isoDate > '2026-08-07', `${item.isoDate}`);
  eq('  ... while the topic page has the real one', O.openParseTopic(fixture('topic-259798.html.gz')).openDate, '2026-08-07');

  // Titles drift all auction long, so the recorded name and the current title
  // differ. Matching a topic by title would not work; matching by id does.
  const recorded = byId.get('202647');
  check('the feed title has drifted from the recorded auctionName',
    item.title !== recorded.auctionName && /Alesiev/i.test(item.title),
    `feed "${item.title}"\nsheet "${recorded.auctionName}"`);

  const in602 = new Set(FEED.filter((i) => i.catid === '602').map((i) => i.id));
  const in584 = new Set(FEED.filter((i) => i.catid === '584').map((i) => i.id));
  check('602 carries topics 584 never lists', in602.has('259475') && !in584.has('259475'),
    'watching only 584 would miss auction 202644 entirely');
}

// ===========================================================================
// 4. Numbering
// ===========================================================================
console.log('\nNumbering\n');
{
  eq('2026 continues from its max, not its count', O.openNextNumber(META, '2026'), 48);
  const count2026 = META.filter((r) => r.auctionSeason === '2026').length;
  check('  ... and count + 1 would collide with a recorded auction',
    META.some((r) => r.auctionSeason === '2026' && +r.auctionNumber === count2026 + 1),
    `count + 1 = ${count2026 + 1}, which exists`);
  eq('2025 continues from its max', O.openNextNumber(META, '2025'), 47);
  eq('an unseen season starts at 1', O.openNextNumber(META, '2027'), 1);

  eq('auctionId is season and number run together', O.openAuctionId('2026', 48), '202648');
  let idOk = 0;
  for (const r of META) if (r.auctionId === O.openAuctionId(r.auctionSeason, r.auctionNumber)) idOk++;
  eq('  ... on every recorded row', idOk, META.length);

  // Two proposals in one scan must not both take the same number.
  const proposals = [
    { season: '2026', openDate: '2026-09-02', number: 0, auctionId: '' },
    { season: '2026', openDate: '2026-09-01', number: 0, auctionId: '' },
    { season: '2027', openDate: '2026-09-03', number: 0, auctionId: '' },
  ];
  O.openRenumber(proposals, META);
  eq('a batch numbers in open-date order', proposals[1].auctionId, '202648');
  eq('  ... then the next', proposals[0].auctionId, '202649');
  eq('  ... and a different season keeps its own run', proposals[2].auctionId, '20271');
}

// ===========================================================================
// 5. Duplicates
// ===========================================================================
console.log('\nDuplicate detection\n');
{
  const recorded = O.openRecordedTopics(META);
  eq('recorded topic ids', Object.keys(recorded).length, 178);
  eq('  ... keyed to the auction that owns them', recorded['259798'], '202647');
  check('every forum row yields an id, anchors and www and all',
    META.filter((r) => /truedungeon/i.test(r.Link)).every((r) => O.openTopicId(r.Link)), '');
  eq('an anchor does not change the id', O.openTopicId('https://www.truedungeon.com/forum?view=topic&catid=584&id=259259#471512'), '259259');

  const selection = O.openSelectFeedItems(FEED, META, {});
  check('a scan skips every topic already recorded', selection.skipped.recorded > 0, '');
  check('  ... and none of the selected is recorded',
    selection.selected.every((i) => !recorded[i.id]), '');
  check('the cutoff keeps the first run small', selection.selected.length <= 25,
    `${selection.selected.length} selected of ${FEED.length} feed items`);
  eq('the cutoff sits behind the newest recorded open', O.openScanCutoff(META), '2026-07-17');

  // 602 is the general discussion category, so a topic there must look like an
  // auction before its page is fetched. Without the rule a scan returns a dozen
  // threads about damage reduction and fantasy football every time.
  eq('602 is filtered by signal, 584 is not', O.OPEN_SIGNAL_ONLY_CATEGORIES['602'], true);
  check('  ... which is what keeps a scan small', selection.skipped.offTopic >= 10,
    `${selection.skipped.offTopic} general-category threads skipped`);
  check('  ... and every 602 topic that survives says so in its title',
    selection.selected.filter((i) => i.catid === '602').every((i) => O.openLooksLikeEightK(i.title)), '');
  // The rule is only safe because the auction that really does live in 602
  // would pass it — and still passes after a season of title edits.
  const in602only = FEED.find((i) => i.id === '259475');
  check('  ... as would 259475, the one recorded auction that really lives in 602',
    in602only.catid === '602' && O.openLooksLikeEightK(in602only.title), in602only.title);

  // 202646's Link says catid=602, but its topic is listed in 584 and not in 602
  // at all. Kunena serves a topic under whatever catid the URL carries, so the
  // catid in a saved Link is not evidence of anything. That is exactly why the
  // duplicate key is the topic id alone.
  const linked602 = META.filter((r) => /catid=602/.test(r.Link)).map((r) => r.auctionId);
  eq('two recorded Links carry catid=602', linked602.length, 2);
  check("  ... but one of those topics is listed in 584, not 602",
    FEED.find((i) => i.id === '259691').catid === '584',
    '202646 links to catid=602 and the topic is in 584 — a mismatched catid still resolves');
  check('  ... which the id-only duplicate key is immune to',
    O.openRecordedTopics(META)['259691'] === '202646', '');

  // Trent's rows all share one Link, so his duplicate check is by name — and
  // his numbering restarts every season, so the season has to be part of the
  // key. 111 rows carry only 33 distinct names.
  const names = O.openRecordedTrentNames(META);
  eq('Trent auctions are keyed by season and name', names[O.openTrentKey('2026', 'Trent Auction 33')], '202643');
  eq('  ... all 111 of them', Object.keys(names).length, 111);
  eq('  ... though only 33 names', new Set(META.filter((r) => r.auctioneer === 'Trent').map((r) => r.auctionName)).size, 33);
  check('  ... so the same name recurs across seasons',
    ['2023', '2024', '2025', '2026'].every((s) => names[O.openTrentKey(s, 'Trent Auction 5')]),
    'a name-only key would call every new season\'s auction 5 a duplicate');
}

// ===========================================================================
// 6. Auctioneer matching
// ===========================================================================
console.log('\nAuctioneer matching\n');
{
  const known = O.openKnownAuctioneers(META);
  // 40 spellings, 38 names: the sheet holds both `Edwin`/`edwin` and
  // `Ralykam`/`ralykam`, and the most recent spelling of each wins.
  eq('distinct recorded auctioneers, case-folded', known.length, 38);
  eq('  ... from 40 spellings', new Set(META.map((r) => r.auctioneer)).size, 40);
  const cases = [
    ['alesiev - Alex', 'alesiev', 'exact'],
    ['ralykam', 'Ralykam', 'exact'],
    ['Amanda (Magellan the Ferret Druid)', 'Amanda', 'exact'],
    ['Wade Schwendemann (Dr. Uid)', 'Wade S', 'prefix'],
    ['Nick', 'Nick Braun', 'prefix'],
    ['Tyler Jakes', 'Tyler', 'prefix'],
    ['Utaku Soto', 'Matt Soto', 'alias'],
    ['Matthew Hayward', 'Matthew Hayward', 'exact'],
  ];
  for (const [display, want, how] of cases) {
    const got = O.openMatchAuctioneer(display, known);
    eq(`"${display}" -> ${want}`, got.auctioneer, want);
    eq(`  ... by ${how}`, got.how, how);
  }
  const unknown = O.openMatchAuctioneer('Someone Entirely New', known);
  eq('an unrecognised name is kept as typed', unknown.auctioneer, 'Someone Entirely New');
  eq('  ... and flagged as new', unknown.how, 'new');
}

// ===========================================================================
// 7. Season inference
// ===========================================================================
console.log('\nSeason inference\n');
{
  eq('a year in the title wins', O.openInferSeason('Flik\'s 2027 Onyx Auction', '2026-09-30', META).season, '2027');
  const noYear = O.openInferSeason('Super Condensed Lightning Auction', '2026-09-30', META);
  eq('without one, the last recorded season', noYear.season, '2026');
  check('  ... announced as an assumption when nothing is recorded that late',
    /ASSUMED/.test(noYear.how), noYear.how);
  const midSeason = O.openInferSeason('Super Condensed Lightning Auction', '2026-03-01', META);
  eq('  ... but a date inside a recorded season names it outright', midSeason.season, '2026');
  check('  ... with no assumption to flag', !/ASSUMED/.test(midSeason.how), midSeason.how);

  // The first real scan proposed a thread that opened 2023-12-18 — an old
  // topic someone had merely replied to recently — as season 2026 auction 48,
  // and said nothing, because December is nowhere near the autumn rollover the
  // only check looked for. "Recently active" says nothing about when a thread
  // opened, and old threads get bumped into the window constantly.
  const old = O.openInferSeason("Fred's Mary's Hands Auction  Oct 21st - Nov 1st", '2023-12-18', META);
  eq('a 2023-12-18 open lands in the season that was running then', old.season, '2024');
  check('  ... rather than in the newest one', !/ASSUMED/.test(old.how), old.how);
  eq('  ... and is numbered into that season', O.openNextNumber(META, old.season), 42);

  // A date in the gap between two seasons names neither, and says so.
  const spans = O.openSeasonSpans(META);
  const s2025 = spans.find((s) => s.season === '2025');
  const s2026 = spans.find((s) => s.season === '2026');
  const between = O.openShiftIsoDays(s2025.last, 3);
  check('the gap between 2025 and 2026 is real', between > s2025.last && between < s2026.first,
    `${s2025.last} .. ${between} .. ${s2026.first}`);
  const gap = O.openInferSeason('Super Condensed Auction', between, META);
  check('a date in that gap is flagged as naming no season',
    /ASSUMED/.test(gap.how) && /BETWEEN/.test(gap.how), gap.how);

  // Leave-one-out: hide a row, then ask which season its own open date names.
  // Only a season's first or last auction can fail, because hiding one shrinks
  // the range past it — and fewer than the 18 that implies, since seasons open
  // several auctions on the same day and a twin keeps the range where it was.
  let placed = 0; const missed = [];
  for (const r of META) {
    const others = META.filter((x) => x !== r);
    const got = O.openInferSeason('no year here', r.openDate, others);
    if (got.season === r.auctionSeason && !/ASSUMED/.test(got.how)) placed++;
    else missed.push(r);
  }
  eq('276 of the 289 recorded rows are placed by their open date alone', placed, 276);
  check('  ... and all 13 that are not are a season\'s own first or last auction',
    missed.every((r) => {
      const span = O.openSeasonSpans(META).find((s) => s.season === r.auctionSeason);
      return r.openDate === span.first || r.openDate === span.last;
    }), missed.map((r) => `${r.auctionId} ${r.openDate}`).join(', '));
  check('  ... which are flagged rather than silently misplaced',
    missed.every((r) => /ASSUMED/.test(O.openInferSeason('no year here', r.openDate, META.filter((x) => x !== r)).how)), '');

  // The rollover is not hypothetical, and it can be quick. Seasons never
  // overlap — a date does sit in exactly one season — but the boundary is only
  // visible in hindsight, and the gap between one season's last auction and the
  // next season's first has been as short as NINE DAYS. So "the season of the
  // last recorded auction" can go stale inside a fortnight, and it is wrong for
  // every auction of the new season until one is recorded by hand. Season
  // 2026's last opened 2026-08-07.
  const seasons = {};
  for (const r of META) {
    seasons[r.auctionSeason] = seasons[r.auctionSeason] || { first: r.openDate, last: r.openDate };
    if (r.openDate < seasons[r.auctionSeason].first) seasons[r.auctionSeason].first = r.openDate;
    if (r.openDate > seasons[r.auctionSeason].last) seasons[r.auctionSeason].last = r.openDate;
  }
  const years = Object.keys(seasons).sort();
  const gaps = years.slice(1).map((y, i) => (Date.parse(seasons[y].first) - Date.parse(seasons[years[i]].last)) / 86400000);
  check('seasons never overlap', gaps.every((g) => g > 0), `gaps in days: ${gaps.join(', ')}`);
  check('  ... but one has started 9 days after the last one ended',
    Math.min(...gaps) <= 14, `gaps in days: ${gaps.join(', ')}`);
  eq('and 2026, the season the fallback would name today, stopped opening auctions on', seasons['2026'].last, '2026-08-07');

  let right = 0, wrong = 0, none = 0;
  for (const r of META.filter((x) => /truedungeon/i.test(x.Link))) {
    const m = r.auctionName.match(/\b(20\d{2})\b/);
    if (!m) none++; else if (m[1] === r.auctionSeason) right++; else wrong++;
  }
  eq('a year in the recorded name is right 65 times', right, 65);
  eq('  ... wrong once', wrong, 1);
  eq('  ... and absent 112 times', none, 112);
}

// ===========================================================================
// 8. Triage honesty — the measured accuracy of the 8K test
// ===========================================================================
console.log('\nTriage\n');
{
  const recorded = O.openRecordedTopics(META);
  const known = FEED.filter((i) => recorded[i.id]);
  const hit = known.filter((i) => O.openLooksLikeEightK(i.title)).length;
  eq('recorded auctions still in the feeds', known.length, 35);
  eq('  ... of which the 8K test catches', hit, 28);
  check('  ... so it misses real auctions and must never be a filter', hit < known.length,
    `${known.length - hit} recorded auctions carry no 8K signal in their CURRENT title`);

  const unrecorded = FEED.filter((i) => !recorded[i.id]);
  const falsePositives = unrecorded.filter((i) => O.openLooksLikeEightK(i.title)).length;
  eq('  ... and fires on unrecorded topics too', falsePositives, 21);
  check('  ... which is why a candidate is only a sort order',
    falsePositives > 0, 'charity auctions, cancelled auctions and discussion threads all match');

  // Nothing is filled in from a title. These four columns stay empty for a
  // forum proposal, because a wrong value a human skims past is worse than a
  // blank one they must fill.
  const topic = O.openParseTopic(fixture('topic-259798.html.gz'));
  const p = O.openForumProposal(
    { id: '259798', catid: '584', title: topic.title, isoDate: '2026-08-18' }, topic,
    META.filter((r) => r.auctionId !== '202647'), O.openKnownAuctioneers(META));
  eq('a forum proposal leaves auctionStyle blank', p.auctionStyle, '');
  eq('  ... completionStyle blank', p.completionStyle, '');
  eq('  ... augmentated blank', p.augmentated, '');
  eq('  ... and targetFunding blank', p.targetFunding, '');
  check('  ... but reports what the title says', O.openPhraseNotes('Augmented Onyx Super Condensed Lightning').length >= 4, '');
  check('"Non Onyx" is called out rather than read as Onyx',
    O.openPhraseNotes('2022 Non Onyx Super Condensed Lightning Auction').includes('says NON-onyx'), '');
  eq('the proposal keeps the title verbatim as the name', p.auctionName, topic.title);
  eq('  ... and a canonical anchor-free Link', p.link, 'https://truedungeon.com/forum?view=topic&catid=584&id=259798');
}

// ===========================================================================
// 9. The review tab
// ===========================================================================
console.log('\nReview tab\n');
{
  const topic = O.openParseTopic(fixture('topic-259798.html.gz'));
  const without = META.filter((r) => r.auctionId !== '202647');
  const plan = O.openPlanScan({
    metaRows: without,
    trentPage: O.openParseTrentPage(fixture(manifest.trent.file)),
    topics: [{ item: { id: '259798', catid: '584', title: topic.title, isoDate: '2026-08-18' }, topic }],
  });
  eq('one proposal per new topic', plan.proposals.length, 1);
  check('an already-recorded Trent auction becomes a note, not a row',
    plan.notes.some((n) => /already recorded as 202643/.test(n)), plan.notes.join(' | '));

  const row = O.openReviewRow(plan.proposals[0]);
  eq('the review row is as wide as its header', row.length, O.OPEN_REVIEW_COLUMNS.length);
  eq('  ... and starts unticked', row[0], false);
  eq('a review row round-trips to its key', O.openReviewKey(row), 'topic:259798');

  // A rescan must not throw away typed cells or ticks.
  const edited = row.slice();
  edited[0] = true;
  edited[12] = 'Super Condensed';
  edited[15] = '$8,000.00';
  const merged = O.openMergeReview([edited], plan.proposals);
  eq('a rescan keeps the tick', merged[0][0], true);
  eq('  ... and the typed style', merged[0][12], 'Super Condensed');
  eq('  ... and the typed target', merged[0][15], '$8,000.00');

  const promoted = row.slice();
  promoted[1] = 'promoted 202647';
  const gone = O.openMergeReview([promoted], []);
  eq('a promoted row survives a rescan that no longer proposes it', gone.length, 1);
  eq('  ... and is not approved again', O.openIsApproved(gone[0]), false);

  check('a ticked row is approved', O.openIsApproved(edited), '');
  check('"yes" counts as a tick too', O.openIsApproved(['yes', '', ...row.slice(2)]), '');
  check('an empty cell does not', !O.openIsApproved(row), '');
}

// ===========================================================================
// 10. Promotion
// ===========================================================================
console.log('\nPromotion\n');
{
  const topic = O.openParseTopic(fixture('topic-259798.html.gz'));
  const without = META.filter((r) => r.auctionId !== '202647');
  const proposal = O.openForumProposal(
    { id: '259798', catid: '584', title: topic.title, isoDate: '2026-08-18' }, topic,
    without, O.openKnownAuctioneers(META));
  O.openRenumber([proposal], without);
  const row = O.openReviewRow(proposal);
  row[0] = true;
  row[12] = 'Ultra Condensed';
  row[13] = 'Lightning';
  row[14] = 'Yes';
  row[15] = '$8,000.00';

  const plan = O.openPlanPromotion([row], without, HEADERS);
  eq('one row to append', plan.rows.length, 1);
  const f = plan.rows[0].fields;
  eq('  ... numbered from the sheet', f.auctionId, '202647');
  eq('  ... with the recorded openDate', f.openDate, '2026-08-07');
  eq('  ... the recorded auctioneer', f.auctioneer, 'alesiev');
  eq('  ... and the operator\'s typed style', f.auctionStyle, 'Ultra Condensed');
  eq('no warnings when every column is filled', plan.warnings.length, 0);

  // The cells line up with the tab's own header row.
  const cells = plan.rows[0].cells;
  eq('one cell per metadata column', cells.length, HEADERS.length);
  for (const other of ['daysToClose', 'Status', 'Open Month', 'Close Month', 'augmentedTotal', 'fundingNoAugment', 'preorderTotal', 'closeDate']) {
    eq(`${other} carries no value from this phase`, cells[HEADERS.indexOf(other)], null);
  }
  for (const literal of O.OPEN_METADATA_FIELDS) {
    check(`${literal} is written`, cells[HEADERS.indexOf(literal)] !== null, '');
  }

  // A row copied down from the one above arrives holding the PREVIOUS
  // auction's everything, so "no value from this phase" is not the same as
  // "leave it". A formula is kept; a literal is cleared. The formulas are read
  // from the source row rather than assumed.
  // The formulas the LIVE workbook carries, read from a real export on
  // 2026-08-24. `auctionId` and `augmentated` are in here because they are
  // formulas — which this test did not model until that export was checked, so
  // the assertion below that they are written passed vacuously for as long as
  // the script was getting them wrong.
  const asFormulas = HEADERS.map((h) => ({
    auctionId: '=B290&C290',
    daysToClose: '=IFERROR(IF(J290<>"",MAX(J290-I290,1),""),"n/a")',
    Status: '=IF(J290="","Open","Closed")',
    'Open Month': '=DATEDIF(startDate2026,I290,"M")+1',
    'Close Month': '=DATEDIF(startDate2026,J290,"M")+1',
    augmentated: '=IF(Q290&R290<>"","Yes","No")',
    augmentedTotal: '=SUM(Q290:S290)',
    fundingNoAugment: '=O290-T290',
    preorderTotal: '=IFERROR(QUERY(auctionFullData,"select max(E)*50 where A = \'"&$A290&"\' and D contains \'Treasure Chip\' label max(E)*50 \'\' ",1))+IFERROR(QUERY(auctionFullData,"select max(E)*32 where A = \'"&$A290&"\' and D = \'Preorder Bonus\' label max(E)*32 \'\' ",1))',
  }[h] || ''));
  const actions = O.openRowActions(HEADERS, asFormulas, cells);
  eq('closeDate is CLEARED, not inherited', actions[HEADERS.indexOf('closeDate')].action, 'clear');
  check('  ... which is what makes Status compute "Open"',
    actions[HEADERS.indexOf('Status')].action === 'keep', 'the Status formula is kept and reads the now-blank closeDate');
  for (const derived of ['daysToClose', 'Status', 'Open Month', 'Close Month', 'augmentedTotal', 'fundingNoAugment', 'preorderTotal']) {
    eq(`${derived}'s formula is kept`, actions[HEADERS.indexOf(derived)].action, 'keep');
  }

  // The two this phase COMPUTES A VALUE FOR and must still not write, because
  // the sheet computes them too. `augmentated` is the one that mattered: frozen
  // as a literal "No" at open time it never flips to "Yes" when augment values
  // are entered, and that column is what the site reads to decide whether an
  // auction was augmented at all.
  for (const derived of O.OPEN_DERIVED_FIELDS) {
    eq(`${derived} keeps the sheet's formula rather than the value this phase computed`,
      actions[HEADERS.indexOf(derived)].action, 'keep');
  }
  for (const literal of O.OPEN_METADATA_FIELDS) {
    if (O.OPEN_DERIVED_FIELDS.includes(literal)) continue;
    eq(`${literal} is written`, actions[HEADERS.indexOf(literal)].action, 'write');
  }

  // ... and where the column is NOT a formula, the computed value is still
  // written. A workbook whose auctionId column is genuinely typed gets a
  // correct id, not a blank — the same read-never-assume rule the augment
  // columns already follow.
  const noDerivedFormulas = asFormulas.map((f, i) => (O.OPEN_DERIVED_FIELDS.includes(HEADERS[i]) ? '' : f));
  const writtenBack = O.openRowActions(HEADERS, noDerivedFormulas, cells);
  for (const derived of O.OPEN_DERIVED_FIELDS) {
    eq(`${derived} is written when the sheet holds no formula for it`,
      writtenBack[HEADERS.indexOf(derived)].action, 'write');
  }
  eq('  ... and the id it writes is the computed one',
    writtenBack[HEADERS.indexOf('auctionId')].value, '202647');

  // A value the operator typed that the sheet is about to compute over is
  // REPORTED, not dropped in silence.
  const overrides = O.openDerivedOverrides(HEADERS, asFormulas, plan.rows);
  check('the ignored augmentated value is named in the dialog',
    overrides.some((o) => /augmentated: "Yes" — the column computes itself/.test(o)), overrides.join(' | '));
  check('  ... and so is the auctionId it did not need',
    overrides.some((o) => /auctionId: "202647"/.test(o)), overrides.join(' | '));
  eq('nothing is reported when the columns are not formulas',
    O.openDerivedOverrides(HEADERS, noDerivedFormulas, plan.rows).length, 0);
  for (const stale of ['augmentTokens', 'augmentGrunnel', 'augmentWithheld']) {
    eq(`${stale} is cleared when the sheet holds a literal`, actions[HEADERS.indexOf(stale)].action, 'clear');
  }
  // ... and kept when it does not. The workbook is not in this repo, so which
  // of the two the augment columns are is read, never assumed.
  const asFormulasToo = asFormulas.map((f, i) => (/^augment(Tokens|Grunnel|Withheld)$/.test(HEADERS[i]) ? '=QUERY(augmentData,"…")' : f));
  const kept = O.openRowActions(HEADERS, asFormulasToo, cells);
  for (const stale of ['augmentTokens', 'augmentGrunnel', 'augmentWithheld']) {
    eq(`${stale} is kept when the sheet holds a formula`, kept[HEADERS.indexOf(stale)].action, 'keep');
  }
  eq('closeDate is cleared either way', kept[HEADERS.indexOf('closeDate')].action, 'clear');
  eq('every field this phase writes has a column', O.openHeaderProblems(HEADERS).length, 0);
  check('a renamed column is caught', O.openHeaderProblems(['auctionId', 'nope']).length > 0, '');

  // The three derived columns whose formulas are checkable from the CSV alone.
  const money = (s) => { const n = parseFloat(String(s).replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
  let sumOk = 0, fundOk = 0, daysOk = 0;
  for (const r of META) {
    if (Math.abs(money(r.augmentTokens) + money(r.augmentGrunnel) + money(r.augmentWithheld) - money(r.augmentedTotal)) < 0.005) sumOk++;
    if (Math.abs(money(r.targetFunding) - money(r.augmentedTotal) - money(r.fundingNoAugment)) < 0.005) fundOk++;
    if (String(Math.max((Date.parse(r.closeDate) - Date.parse(r.openDate)) / 86400000, 1)) === r.daysToClose) daysOk++;
  }
  eq('augmentedTotal is computed on every recorded row', sumOk, META.length);
  eq('fundingNoAugment is computed on every recorded row', fundOk, META.length);
  eq('daysToClose is computed on every recorded row', daysOk, META.length);

  // Promotion re-derives, so a row that was recorded by hand since the scan is
  // refused rather than duplicated.
  const dup = O.openPlanPromotion([row], META, HEADERS);
  eq('a topic recorded since the scan is refused', dup.rows.length, 0);
  check('  ... by name', dup.problems.some((p) => /already recorded as 202647/.test(p)), dup.problems.join(' | '));

  // Blank style, and a season that follows the last one.
  const sparse = row.slice();
  sparse[12] = '';
  sparse[13] = '';
  sparse[8] = '2027';
  const warned = O.openPlanPromotion([sparse], without, HEADERS);
  eq('a new season still promotes', warned.rows.length, 1);
  eq('  ... numbered from 1', warned.rows[0].fields.auctionId, '20271');
  check('  ... with the Open Month baseline called out',
    warned.warnings.some((w) => /Open Month/.test(w)), warned.warnings.join(' | '));
  check('  ... and the blank style called out',
    warned.warnings.some((w) => /auctionStyle is blank/.test(w)), warned.warnings.join(' | '));

  const untickedOnly = O.openPlanPromotion([O.openReviewRow(proposal)], without, HEADERS);
  eq('nothing is promoted without a tick', untickedOnly.rows.length, 0);
}

// ===========================================================================
// 11. alesievauctions.com — the auction site
// ===========================================================================
//
// The first source whose fixture cannot be replayed against a recorded row:
// both auctions on it are still upcoming, so auctionMetadata has nothing to
// compare to. Three things stand in for that:
//
//   - the two cards differ in exactly one badge (Onyx vs Non-Onyx) and are
//     otherwise identical, which is the discrimination the parser exists for;
//   - the values it proposes are asserted to be strings auctionMetadata
//     ALREADY uses, because a plausible invention like `Onyx Ultra-Condensed`
//     would pass here and fail § 7 of validate-prices at the PR gate instead;
//   - the shapes nobody has observed — a conflicting badge, a card with no
//     badges — are constructed here, since the whole risk of reading a page
//     someone else owns is the day it changes shape.
console.log('\nalesievauctions.com\n');
{
  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const want = manifest.alesiev.expect;
  eq('every card on the listing is read', cards.length, want.length);

  for (let i = 0; i < want.length; i++) {
    const card = cards[i], w = want[i];
    eq(`card ${w.id}: id from the link`, card.id, w.id);
    eq('  ... title', card.title, w.title);
    eq('  ... sponsor', card.sponsor, w.sponsor);
    eq('  ... start date to ISO', card.startDate, w.startDate);
    eq('  ... start time to 24h', card.startTime, w.startTime);
    eq('  ... scheduled end, which is read and then NOT used', card.endDate, w.endDate);
    eq('  ... target', card.target, w.target);
    eq('  ... status chip', card.status, w.status);
    eq('  ... item count', card.itemCount, w.itemCount);

    const f = O.openAlesievFields(card);
    eq('  ... auctionStyle from the badges', f.auctionStyle, w.auctionStyle);
    eq('  ... completionStyle from the badges', f.completionStyle, w.completionStyle);
    eq('  ... augmentated from the badges', f.augmentated, w.augmentated);
    eq("  ... targetFunding in the sheet's format", f.targetFunding, w.targetFunding);
  }

  // The two cards are the same auction twice apart from one badge. If the
  // parser ever reads them the same way it has stopped reading the badge.
  check('the two cards differ in style and nothing else',
    O.openAlesievFields(cards[0]).auctionStyle !== O.openAlesievFields(cards[1]).auctionStyle &&
    cards[0].sponsor === cards[1].sponsor && cards[0].target === cards[1].target,
    'the Onyx and non-Onyx cards must not resolve to the same style');

  // `Non-Onyx` read as Onyx is the exact mistake the forum path measured on
  // titles — it is wrong on 11 of the 66 styles it would guess at, largely on
  // this. A badge is anchored, so it cannot make it.
  const nonOnyx = cards.find((c) => c.id === '28');
  check('the Non-Onyx badge is present and inactive',
    nonOnyx.tags.some((t) => /^non-onyx$/i.test(t.label) && !t.active),
    JSON.stringify(nonOnyx.tags));
  eq('  ... and reads as NOT Onyx', O.openAlesievTag(nonOnyx, 'onyx').state, false);
  eq('  ... not as Onyx by a loose match', O.openAlesievFields(nonOnyx).auctionStyle, O.OPEN_ALESIEV_BASELINE_STYLE);

  // A value invented here fails at the PUBLISH gate, not here, so the
  // vocabulary is checked against the file that defines it.
  const styles = new Set(META.map((r) => r.auctionStyle));
  const completions = new Set(META.map((r) => r.completionStyle));
  check('both proposed styles are already in auctionMetadata',
    styles.has(O.OPEN_ALESIEV_BASELINE_STYLE) && styles.has(O.OPEN_ALESIEV_ONYX_STYLE),
    `${O.OPEN_ALESIEV_BASELINE_STYLE} / ${O.OPEN_ALESIEV_ONYX_STYLE} against ${[...styles].join(', ')}`);
  check('both proposed completion styles are too',
    completions.has('Lightning') && completions.has('Fixed Date'),
    [...completions].join(', '));
  check('every style the badges can produce is one of those two',
    cards.every((c) => !O.openAlesievFields(c).auctionStyle || styles.has(O.openAlesievFields(c).auctionStyle)), '');

  // The site's own titles carry a typo and a straight apostrophe. Both are
  // preserved: auctionName records what the auction was called, and § 8 of
  // validate-prices makes a curly apostrophe an error with nothing to
  // arbitrate, so an entity that decoded to one would fail the publish.
  check('titles decode to a STRAIGHT apostrophe',
    cards.every((c) => c.title.includes("'") && !/[‘’]/.test(c.title)),
    cards.map((c) => c.title).join(' | '));

  eq('12:00:00 AM is midnight, not noon', O.openTimeTo24h('9/19/2026, 12:00:00 AM'), '00:00');
  eq('12:00:00 PM is noon', O.openTimeTo24h('9/19/2026, 12:00:00 PM'), '12:00');
  eq('11:59:00 PM is 23:59', O.openTimeTo24h('9/26/2026, 11:59:00 PM'), '23:59');
  eq('a time that does not parse is empty, never wrong', O.openTimeTo24h('soon'), '');
  eq('M/D/YYYY to ISO, zero-padded', O.openAlesievDate('9/1/2026, 1:00:00 AM'), '2026-09-01');
}

// --- the id, which is this source's entire duplicate defence ---------------
{
  eq('an absolute link yields the id', O.openAlesievId('https://alesievauctions.com/auctions/29'), '29');
  eq('  ... with www', O.openAlesievId('https://www.alesievauctions.com/auctions/29'), '29');
  eq('  ... over http', O.openAlesievId('http://alesievauctions.com/auctions/29'), '29');
  eq('  ... with a trailing path', O.openAlesievId('https://alesievauctions.com/auctions/29/items'), '29');
  eq('a root-relative href yields it too, which is what the page writes', O.openAlesievId('/auctions/29'), '29');
  eq('another host does NOT, however much the path looks right',
    O.openAlesievId('https://example.com/auctions/29'), null);

  // The two id spaces are unrelated and must not leak into one another: site
  // auction 29 and forum topic 29 are different auctions.
  const forumLink = 'https://truedungeon.com/forum?view=topic&catid=584&id=259798';
  eq('a forum link has no site id', O.openAlesievId(forumLink), null);
  eq('a site link has no topic id', O.openTopicId('https://alesievauctions.com/auctions/29'), null);
  eq("Trent's link has neither", O.openAlesievId(O.OPEN_TRENT_URL), null);
  check('no recorded row is read as a site auction today',
    Object.keys(O.openRecordedAlesiev(META)).length === 0,
    'auctionMetadata records no alesievauctions.com link yet');
}

// --- a scan, and what a rescan does with it --------------------------------
{
  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const plan = O.openPlanScan({ metaRows: META, alesievCards: cards });
  eq('one proposal per card', plan.proposals.length, 2);
  check('every card on a dedicated auction site is a candidate',
    plan.proposals.every((p) => p.verdict === 'candidate'), '');
  check('  ... and says where it came from',
    plan.proposals.every((p) => p.source === O.OPEN_ALESIEV_SOURCE), '');

  // Both auctions open on 2026-09-19, one at 00:00 and one at 11:00. The
  // listing shows the later one first, so ordering on the date alone would
  // hand it the lower number.
  const byId = new Map(plan.proposals.map((p) => [O.openAlesievId(p.link), p]));
  eq('two auctions on one day get two numbers', new Set(plan.proposals.map((p) => p.auctionId)).size, 2);
  eq('  ... the 00:00 one first', byId.get('28').auctionId, '202648');
  eq('  ... then the 11:00 one', byId.get('29').auctionId, '202649');
  check('  ... continuing from what the sheet holds, not from a count',
    O.openNextNumber(META, '2026') === 48, '');

  const onyx = byId.get('29');
  eq('the link recorded is the absolute one', onyx.link, 'https://alesievauctions.com/auctions/29');
  eq('the sponsor resolves to the recorded auctioneer', onyx.auctioneer, 'alesiev');
  eq('the style comes from the badge', onyx.auctionStyle, 'Onyx Ultra Condensed');
  check('the scheduled end is a note, never a value',
    onyx.notes.some((n) => /closeDate stays blank/.test(n)) && !('closeDate' in onyx),
    onyx.notes.join(' | '));
  check('a midnight start is flagged for the day it belongs to',
    byId.get('28').notes.some((n) => /starts at 00:00/.test(n)), byId.get('28').notes.join(' | '));
  check('the withheld sentence is carried over',
    onyx.notes.some((n) => /^withheld:/.test(n)), onyx.notes.join(' | '));
  check('a pre-order is called out', onyx.notes.some((n) => /pre-order/i.test(n)), onyx.notes.join(' | '));
  check('but the title hints the badges already answer are NOT repeated',
    !onyx.notes.some((n) => /^says (onyx|augmented|lightning)/.test(n)),
    onyx.notes.join(' | '));

  // Once recorded, the same listing must propose nothing.
  const recorded = META.concat(plan.proposals.map((p) => ({
    auctionId: p.auctionId, auctionSeason: p.season, auctionNumber: String(p.number),
    auctionName: p.auctionName, auctioneer: p.auctioneer, Link: p.link, openDate: p.openDate,
  })));
  const again = O.openPlanScan({ metaRows: recorded, alesievCards: cards });
  eq('a rescan after recording proposes nothing', again.proposals.length, 0);
  check('  ... and says so rather than going quiet',
    again.notes.some((n) => /2 listed auction\(s\) are already recorded/.test(n)), again.notes.join(' | '));

  // The review key: without it an alesiev row keys as `trent:<its name>` and a
  // rescan silently discards the operator's tick.
  const row = O.openReviewRow(onyx);
  eq('a review row round-trips to a site key', O.openReviewKey(row), 'alesiev:29');
  const ticked = row.slice();
  ticked[0] = true;
  const merged = O.openMergeReview([ticked], [onyx]);
  eq('a rescan keeps the tick on a site row', merged[0][0], true);

  // A prefilled column that has since changed on the page is called out. The
  // tab still wins — it may be a correction — but not silently.
  const stale = row.slice();
  stale[12] = 'Ultra Condensed';
  const drifted = O.openMergeReview([stale], [onyx]);
  eq('what the tab holds still wins', drifted[0][12], 'Ultra Condensed');
  check('  ... and the difference is said out loud',
    /KEPT WHAT THIS TAB ALREADY HELD/.test(String(drifted[0][16])), String(drifted[0][16]));
  const untouched = O.openMergeReview([row.slice()], [onyx]);
  check('  ... with no note when nothing differs',
    !/KEPT WHAT THIS TAB/.test(String(untouched[0][16])), String(untouched[0][16]));
}

// --- promotion --------------------------------------------------------------
{
  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const plan = O.openPlanScan({ metaRows: META, alesievCards: cards });
  const onyx = plan.proposals.find((p) => /\/29$/.test(p.link));
  const row = O.openReviewRow(onyx);
  row[0] = true;

  const promotion = O.openPlanPromotion([row], META, HEADERS);
  eq('a ticked site row promotes', promotion.rows.length, 1);
  const f = promotion.rows[0].fields;
  eq('  ... with the badge-derived style', f.auctionStyle, 'Onyx Ultra Condensed');
  eq('  ... the badge-derived completion style', f.completionStyle, 'Lightning');
  eq('  ... the target from the card', f.targetFunding, '$8,000.00');
  eq('  ... the sponsor as auctioneer', f.auctioneer, 'alesiev');
  eq('  ... the card link', f.Link, 'https://alesievauctions.com/auctions/29');
  eq('  ... the start date as openDate', f.openDate, '2026-09-19');
  eq('  ... season 2026 until a 2027 auction opens', f.auctionSeason, '2026');
  check('  ... and NO closeDate, which is what makes Status compute Open',
    !('closeDate' in f), Object.keys(f).join(', '));
  check('  ... with none of the four blank-style warnings',
    !promotion.warnings.some((w) => /is blank/.test(w)), promotion.warnings.join(' | '));

  // closeDate is not merely absent from the field map — the cell it lands in
  // must be cleared, or the row copied down from above inherits the previous
  // auction's close date and the new auction is born Closed.
  const closeAt = HEADERS.indexOf('closeDate');
  check('closeDate is a real column', closeAt >= 0, HEADERS.join(', '));
  eq('  ... which this phase supplies no value for', promotion.rows[0].cells[closeAt], null);
  const actions = O.openRowActions(HEADERS, HEADERS.map(() => ''), promotion.rows[0].cells);
  eq('  ... so a literal there is CLEARED, not copied', actions[closeAt].action, 'clear');

  // The duplicate check. Before the site id was taught to openPlanPromotion,
  // a row from this source fell through to the Trent name check, matched
  // nothing, and was promoted with no duplicate defence at all.
  const already = META.concat([{
    auctionId: '202649', auctionSeason: '2026', auctionNumber: '49',
    auctionName: onyx.auctionName, auctioneer: 'alesiev', openDate: onyx.openDate,
    Link: 'https://alesievauctions.com/auctions/29',
  }]);
  const refused = O.openPlanPromotion([row], already, HEADERS);
  eq('the same site auction cannot be promoted twice', refused.rows.length, 0);
  check('  ... and is refused by its site id, naming the row that owns it',
    refused.problems.some((p) => /auction 29 is already recorded as 202649/.test(p)),
    refused.problems.join(' | '));
}

// --- the shapes nobody has seen yet ----------------------------------------
{
  const tagged = (tags) => O.openParseAlesievCard(
    '<a class="card auction-card" href="/auctions/99">',
    '<div class="badge badge-upcoming">Upcoming</div><div class="tag-badge-group">' +
    tags.map((t) => `<span class="badge tag-badge${t.active ? ' tag-badge-active' : ''}">${t.label}</span>`).join('') +
    '</div><h2>A</h2><ul class="meta"><li>Sponsor: Alesiev (Alex)</li>' +
    '<li>Starts: 9/19/2026, 11:00:00 AM</li><li>Target: $8,000</li></ul>'
  );

  // A card with no badges at all means the markup moved. The baseline would be
  // a plausible, wrong answer, so all three cells stay blank instead.
  const bare = O.openParseAlesievCard(
    '<a class="card auction-card" href="/auctions/99">',
    '<h2>A</h2><ul class="meta"><li>Starts: 9/19/2026, 11:00:00 AM</li><li>Target: $8,000</li></ul>'
  );
  const bareFields = O.openAlesievFields(bare);
  eq('no badges at all: no style is invented', bareFields.auctionStyle, '');
  eq('  ... nor a completion style', bareFields.completionStyle, '');
  eq('  ... nor an augment flag', bareFields.augmentated, '');
  eq('  ... but the target still comes through', bareFields.targetFunding, '$8,000.00');
  check('  ... and the markup change is reported',
    bareFields.notes.some((n) => /listing markup has changed/.test(n)), bareFields.notes.join(' | '));

  // A negative label on an ACTIVE badge means the two signals disagree. Only
  // one of them can be right and nothing here knows which.
  const conflicted = tagged([{ label: 'Non-Onyx', active: true }, { label: 'Lightning', active: true }]);
  const cf = O.openAlesievFields(conflicted);
  eq('a badge whose label and class disagree fills nothing', cf.auctionStyle, '');
  check('  ... and says exactly what it saw',
    cf.notes.some((n) => /never seen/.test(n)), cf.notes.join(' | '));
  eq('  ... while the other axes are unaffected', cf.completionStyle, 'Lightning');

  // No lightning badge is how a fixed-date auction is expected to render, and
  // an inactive one has to mean the same thing.
  const noLightning = tagged([{ label: 'Onyx', active: true }]);
  eq('no Lightning badge means Fixed Date', O.openAlesievFields(noLightning).completionStyle, 'Fixed Date');
  const offLightning = tagged([{ label: 'Lightning', active: false }, { label: 'Onyx', active: true }]);
  eq('an inactive Lightning badge means the same', O.openAlesievFields(offLightning).completionStyle, 'Fixed Date');
  eq('  ... and a "Fixed Date" label does too',
    O.openAlesievFields(tagged([{ label: 'Fixed Date', active: false }])).completionStyle, 'Fixed Date');
  eq('no Augmented badge means No', O.openAlesievFields(noLightning).augmentated, 'No');
  eq('an Onyx badge with no Onyx sibling still reads Onyx',
    O.openAlesievFields(noLightning).auctionStyle, 'Onyx Ultra Condensed');

  // No onyx badge either way: the baseline is proposed, and the fact that no
  // card has ever rendered that way is said.
  const noOnyx = tagged([{ label: 'Lightning', active: true }]);
  eq('no Onyx badge falls back to the baseline', O.openAlesievFields(noOnyx).auctionStyle, 'Ultra Condensed');
  check('  ... and flags that as unobserved',
    O.openAlesievFields(noOnyx).notes.some((n) => /every card seen so far carries one/.test(n)),
    O.openAlesievFields(noOnyx).notes.join(' | '));

  // A card with no Target line: the template makes it conditional, so the
  // positions of the lines after it shift and a positional parser would read
  // the wrong one.
  const noTarget = O.openParseAlesievCard(
    '<a class="card auction-card" href="/auctions/99">',
    '<h2>A</h2><ul class="meta"><li>Starts: 9/19/2026, 11:00:00 AM</li>' +
    '<li>Ends: 9/26/2026, 11:59:00 PM</li><li>40 item(s)</li></ul>'
  );
  eq('a card with no Sponsor line does not read Starts as the sponsor', noTarget.sponsor, '');
  eq('  ... and still finds the start', noTarget.startDate, '2026-09-19');
  eq('  ... and does not read Ends as the target', noTarget.target, null);
  eq('  ... nor the item count as one', noTarget.itemCount, '40');
  check('  ... leaving targetFunding blank with a reason',
    O.openAlesievFields(noTarget).targetFunding === '' &&
    O.openAlesievFields(noTarget).notes.some((n) => /no Target line/.test(n)), '');

  // A client-rendered page would come back as a shell that parses to zero
  // cards and is indistinguishable from a site with no auctions. The scan
  // reports that rather than reading it as "nothing new".
  eq('a page with no cards yields none', O.openParseAlesievListing('<html><body><h1>Auctions</h1></body></html>').length, 0);
  eq('  ... and neither does an empty fetch', O.openParseAlesievListing('').length, 0);

  // Card-shaped markup inside a script tag is not a card.
  const withScript = O.openParseAlesievListing(
    '<script>var tpl = \'<a class="card auction-card" href="/auctions/1"><h2>X</h2></a>\';</script>' +
    '<a class="card auction-card" href="/auctions/7"><h2>Real</h2></a>'
  );
  eq('a card template inside a script is not counted', withScript.length, 1);
  eq('  ... the real one is', withScript[0].id, '7');

  // A status suggesting the auction is over is a note, because a promoted row
  // is created open.
  const ended = O.openParseAlesievCard(
    '<a class="card auction-card" href="/auctions/99">',
    '<div class="badge badge-ended">Ended</div><h2>A</h2><ul class="meta"><li>Starts: 9/19/2026, 11:00:00 AM</li></ul>'
  );
  eq('a status chip is read whatever it says', ended.status, 'Ended');
  const endedProposal = O.openAlesievProposal(ended, META, O.openKnownAuctioneers(META));
  check('  ... and an ended-looking one is called out',
    endedProposal.notes.some((n) => /reads as FINISHED/.test(n)), endedProposal.notes.join(' | '));

  // The title and the badges can disagree; the badge wins, out loud.
  const mislabelled = O.openAlesievTitleConflicts('An Onyx Auction', { auctionStyle: 'Ultra Condensed', augmentated: 'Yes' });
  check('a title saying Onyx over a non-Onyx badge is surfaced',
    mislabelled.some((n) => /TITLE says Onyx/.test(n)), mislabelled.join(' | '));
  eq('a title that agrees with its badges says nothing',
    O.openAlesievTitleConflicts('An Onyx Auction', { auctionStyle: 'Onyx Ultra Condensed', augmentated: 'Yes' }).length, 0);
}

// ===========================================================================
// 12. The round trip through the review tab — what Sheets does to a value
// ===========================================================================
//
// A REGRESSION SECTION. This is a bug that reached auctionMetadata.
//
// openWriteReview writes openDate as the string '2026-09-19'. Sheets does not
// keep it as one — it recognises the shape, makes the cell a real date, and
// getValues() hands back a JavaScript Date at midnight in the SPREADSHEET's
// timezone. `String(row[4])` on that produced
//
//   Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)
//
// and that went into the sheet, where daysToClose and Open Month compute from
// it and the exported CSV feeds it to the site's date parsing. The same
// coercion turns targetFunding's `$8,000.00` into the number 8000, which hides
// because the destination cell's currency format displays it correctly anyway.
//
// The tests below are constructed rather than replayed, because what has to be
// pinned is a Google Sheets behaviour that nothing in this repo can execute.
// Every value here is exactly what getValues() returns for a cell the scan
// wrote itself.
console.log('\nSheet coercion on the round trip\n');
{
  // A date cell, as getValues() returns it. Built from local components so the
  // assertion holds in whatever timezone this test runs in.
  const asDate = new Date(2026, 8, 19, 1, 0, 0);
  eq('a Date cell reads back as its ISO date', O.openIsoFromCell(asDate), '2026-09-19');
  eq('  ... at 23:00 too, not the next day', O.openIsoFromCell(new Date(2026, 8, 19, 23, 0, 0)), '2026-09-19');
  eq('  ... and at 00:00', O.openIsoFromCell(new Date(2026, 8, 19, 0, 0, 0)), '2026-09-19');

  // The exact string that reached auctionMetadata. A tab still holding it comes
  // good rather than staying broken.
  eq('the stringified Date that caused this is repaired',
    O.openIsoFromCell('Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)'), '2026-09-19');
  eq('  ... in any month', O.openIsoFromCell('Mon Dec 01 2025 00:00:00 GMT-0600 (Central Standard Time)'), '2025-12-01');

  eq('an ISO string passes through', O.openIsoFromCell('2026-09-19'), '2026-09-19');
  eq('  ... zero-padded if it is not', O.openIsoFromCell('2026-9-1'), '2026-09-01');
  eq('a US display date is read as M/D/YYYY', O.openIsoFromCell('9/19/2026'), '2026-09-19');
  eq('  ... but a first field over 12 is refused, not guessed at',
    O.openIsoFromCell('19/9/2026'), '19/9/2026');
  eq('an empty cell is empty', O.openIsoFromCell(''), '');
  eq('  ... and so is a blank one', O.openIsoFromCell(null), '');
  eq('anything else is handed back untouched, for the caller to refuse',
    O.openIsoFromCell('next Tuesday'), 'next Tuesday');

  eq('a currency cell reads back as the money string', O.openMoneyFromCell(8000), '$8,000.00');
  eq('  ... with cents', O.openMoneyFromCell(7500.5), '$7,500.50');
  eq('  ... under a thousand', O.openMoneyFromCell(750), '$750.00');
  eq('  ... and a money string passes through', O.openMoneyFromCell('$8,000.00'), '$8,000.00');
}

{
  // End to end: a review row exactly as getValues() returns it after Sheets has
  // had its way with the two columns.
  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const proposal = O.openPlanScan({ metaRows: META, alesievCards: cards })
    .proposals.find((p) => /\/29$/.test(p.link));
  const coerced = O.openReviewRow(proposal);
  coerced[0] = true;
  coerced[4] = new Date(2026, 8, 19, 1, 0, 0); // Sheets made a date of it
  coerced[15] = 8000;                          // and a number of the target

  const promotion = O.openPlanPromotion([coerced], META, HEADERS);
  eq('a coerced row still promotes', promotion.rows.length, 1);
  eq('  ... with an ISO openDate', promotion.rows[0].fields.openDate, '2026-09-19');
  check('  ... and NOT the Date.toString() that reached the sheet',
    !/GMT|Daylight|Standard/.test(promotion.rows[0].fields.openDate),
    promotion.rows[0].fields.openDate);
  eq('  ... and the target as money, not as 8000', promotion.rows[0].fields.targetFunding, '$8,000.00');

  // Belt and braces: converting is best effort, refusing is not.
  const unreadable = coerced.slice();
  unreadable[4] = 'sometime in September';
  const refused = O.openPlanPromotion([unreadable], META, HEADERS);
  eq('an openDate that cannot be read is refused, not written', refused.rows.length, 0);
  check('  ... naming the tab to fix it in',
    refused.problems.some((p) => /not a YYYY-MM-DD date/.test(p) && /auctionOpenReview/.test(p)),
    refused.problems.join(' | '));

  // Every openDate that survives promotion is ISO, whatever the cell held.
  const shapes = ['2026-09-19', new Date(2026, 8, 19, 1, 0, 0), '9/19/2026',
    'Sat Sep 19 2026 01:00:00 GMT-0500 (Central Daylight Time)'];
  for (const shape of shapes) {
    const row = coerced.slice();
    row[4] = shape;
    const p = O.openPlanPromotion([row], META, HEADERS);
    eq(`openDate from ${JSON.stringify(String(shape)).slice(0, 34)}…`,
      p.rows[0]?.fields.openDate, '2026-09-19');
  }

  // Two coerced rows still sort by date rather than by their string form.
  const earlier = coerced.slice();
  earlier[4] = new Date(2026, 8, 3, 1, 0, 0);
  earlier[11] = 'https://alesievauctions.com/auctions/27';
  const both = O.openPlanPromotion([coerced, earlier], META, HEADERS);
  eq('two coerced rows both promote', both.rows.length, 2);
  eq('  ... the earlier one first', both.rows[0].fields.openDate, '2026-09-03');
  eq('  ... taking the lower number', both.rows[0].fields.auctionNumber, '48');
}

{
  // The columns that must never be coerced in the first place. This is the
  // belt; openIsoFromCell and openMoneyFromCell are the braces.
  const cols = O.OPEN_REVIEW_TEXT_COLUMNS;
  const at = (name) => O.OPEN_REVIEW_COLUMNS.indexOf(name) + 1;
  check('openDate is written as text', cols.includes(at('openDate')), cols.join(','));
  check('  ... so is the open time', cols.includes(at('first post')), cols.join(','));
  check('  ... and targetFunding', cols.includes(at('targetFunding')), cols.join(','));
  check('  ... and auctionName, which can begin with a + or an =',
    cols.includes(at('auctionName')), cols.join(','));
  check('every text column is a real column, 1-based for getRange',
    cols.every((c) => c >= 1 && c <= O.OPEN_REVIEW_COLUMNS.length), cols.join(','));

  // The drift note must not fire just because Sheets stored the same money as
  // a number. It did before openMoneyFromCell, on every rescan.
  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const proposal = O.openPlanScan({ metaRows: META, alesievCards: cards })
    .proposals.find((p) => /\/29$/.test(p.link));
  const held = O.openReviewRow(proposal);
  held[15] = 8000;
  const merged = O.openMergeReview([held], [proposal]);
  check('a currency cell stored as a number is not read as drift',
    !/KEPT WHAT THIS TAB/.test(String(merged[0][16])), String(merged[0][16]));
  eq('  ... and is carried across as money', merged[0][15], '$8,000.00');
}

// ===========================================================================
// 13. A `promoted` marker that outlived the row it names
// ===========================================================================
//
// `openIsApproved` refuses any row whose status starts with `promoted`, so the
// marker is not decoration — it is a lock. When the auctionMetadata row it
// names is deleted, the lock stays on and ticking the row does nothing at all,
// silently. That is what a real cleanup of promoted test data left behind.
//
// The awkward part, and the reason the note matters more than the clearing:
// current practice DELETES a failed auction's row rather than marking it —
// `Status` is `IF(closeDate="","Open","Closed")` and cannot express `Failed` —
// so "promoted, then gone" is equally what a failed auction looks like.
// Nothing here can tell deleted test data from a failed auction, so the row is
// reopened, the tick is forced off, and the note says both readings.
console.log('\nStale promoted markers\n');
{
  eq('a marker yields the id it claims', O.openPromotedId('promoted 202648'), '202648');
  eq('  ... case-insensitively', O.openPromotedId('Promoted 202648'), '202648');
  eq('a status that is not a marker yields nothing', O.openPromotedId(''), null);
  eq('  ... nor does a bare word with no id', O.openPromotedId('promoted'), null);
  // The rewritten form must NOT match, or every later rescan re-clears it.
  eq('the `was promoted` form is a record, not a claim',
    O.openPromotedId('was promoted 202648 — no longer in auctionMetadata'), null);

  const ids = O.openRecordedAuctionIds(META);
  eq('every recorded auctionId is in the lookup', Object.keys(ids).length, new Set(META.map((r) => r.auctionId)).size);
  check('  ... including the newest', ids['202647'] === true, '');
  check('  ... and not one that was never recorded', ids['202648'] === undefined, '');

  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const proposals = O.openPlanScan({ metaRows: META, alesievCards: cards }).proposals;
  const proposal = proposals.find((p) => /\/29$/.test(p.link));

  // The case that prompted this: promoted, then the row deleted from the sheet.
  const locked = O.openReviewRow(proposal);
  locked[1] = 'promoted 202649';
  locked[0] = true;

  const before = O.openMergeReview([locked], [proposal]);
  eq('with no id list nothing is questioned — the old behaviour', before[0][1], 'promoted 202649');
  check('  ... and the row stays locked', !O.openIsApproved(before[0]), '');

  const after = O.openMergeReview([locked], [proposal], ids);
  eq('a marker naming an unrecorded id is cleared', after[0][1], '');
  eq('  ... but the tick is forced OFF, so re-approving is a decision', after[0][0], false);
  check('  ... and is NOT approved until the operator ticks it', !O.openIsApproved(after[0]), '');
  const reticked = after[0].slice();
  reticked[0] = true;
  check('  ... after which it is', O.openIsApproved(reticked), '');

  check('the note says the marker was cleared and why',
    /WAS PROMOTED as 202649/.test(String(after[0][16])) &&
    /no row with that auctionId is in auctionMetadata/.test(String(after[0][16])),
    String(after[0][16]));
  check('  ... and warns that a FAILED auction looks identical',
    /FAILED and its row was deleted on purpose, leave it unticked/.test(String(after[0][16])),
    String(after[0][16]));

  // A marker that is still true is left completely alone.
  const live = O.openReviewRow(proposal);
  live[1] = 'promoted 202647';
  const untouched = O.openMergeReview([live], [proposal], ids);
  eq('a marker whose row IS recorded is untouched', untouched[0][1], 'promoted 202647');
  check('  ... and stays locked', !O.openIsApproved(untouched[0]), '');
  check('  ... with no note about it', !/WAS PROMOTED/.test(String(untouched[0][16])), String(untouched[0][16]));

  // Both auctions at once, which is the shape of the real cleanup.
  const bothLocked = proposals.map((p) => {
    const row = O.openReviewRow(p);
    row[1] = 'promoted ' + p.auctionId;
    return row;
  });
  const reopened = O.openMergeReview(bothLocked, proposals, ids);
  eq('both rows come back', reopened.length, 2);
  check('  ... both unlocked', reopened.every((r) => r[1] === ''), reopened.map((r) => r[1]).join(' | '));
  check('  ... both unticked', reopened.every((r) => r[0] === false), '');
}

{
  // A promoted row nothing proposes any more — the card has come off the
  // listing. It is history and is kept, but it must stop claiming to be
  // something it is not.
  const cards = O.openParseAlesievListing(fixture(manifest.alesiev.file));
  const proposal = O.openPlanScan({ metaRows: META, alesievCards: cards })
    .proposals.find((p) => /\/29$/.test(p.link));
  const ids = O.openRecordedAuctionIds(META);

  const orphan = O.openReviewRow(proposal);
  orphan[1] = 'promoted 202649';
  const kept = O.openMergeReview([orphan], [], ids);
  eq('an unproposed promoted row is still kept as history', kept.length, 1);
  eq('  ... with the status rewritten rather than cleared',
    kept[0][1], 'was promoted 202649 — no longer in auctionMetadata');
  eq('  ... and unticked', kept[0][0], false);

  // And it must survive the NEXT rescan, or the history disappears one scan
  // later. `was promoted` still matches the retention test.
  const again = O.openMergeReview(kept, [], ids);
  eq('it survives the next rescan too', again.length, 1);
  eq('  ... unchanged, because it no longer makes a claim to check',
    again[0][1], 'was promoted 202649 — no longer in auctionMetadata');

  // A still-recorded promoted row that is no longer proposed is untouched.
  const stillGood = O.openReviewRow(proposal);
  stillGood[1] = 'promoted 202647';
  const goodKept = O.openMergeReview([stillGood], [], ids);
  eq('a recorded one is kept verbatim', goodKept[0][1], 'promoted 202647');

  // A row that was never promoted and is no longer proposed still drops out —
  // the tab is not an archive of everything ever seen.
  const nonPromoted = O.openReviewRow(proposal);
  eq('an unpromoted row nothing proposes drops out', O.openMergeReview([nonPromoted], [], ids).length, 0);
}

// ===========================================================================
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
