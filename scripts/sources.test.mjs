// Tests for the auction SOURCE — the venue an auction ran at (src/lib/data.ts
// deriveSource, AUCTION_SOURCES, SOURCE_LABEL; src/lib/eras.ts's per-venue
// ladders; src/lib/context.ts and contextAnalytics.ts's per-venue splits).
//
// Added with the fourth venue, Utaku's site (backlog SITE-14). Nothing tested
// deriveSource before, which is how a venue could be added to the type and the
// filter and still be missed by a helper that lists venues by hand.
//
// Loads src/lib the way ledger.test.mjs does — copied to a temp directory with
// `.ts` appended to sibling imports and run through node's own type stripping.
// Nothing in the repo is written to.
//
// The shipped CSVs are read RELATIONALLY only: "every row whose Link is X
// derives Y" stays true however many auctions a publish adds, and no count, id
// list or tally is pinned (see the root CLAUDE.md).
//
// Run: node scripts/sources.test.mjs

import { readFileSync, mkdtempSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok    ${name}`); pass++; return; }
  console.error(`  FAIL  ${name}`);
  if (detail !== undefined) console.error('        ' + String(detail));
  fail++;
};
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const work = mkdtempSync(join(tmpdir(), 'sources-test-'));
let data, eras, ctx, an;
try {
  const src = join(repo, 'src', 'lib');
  mkdirSync(join(work, 'lib'), { recursive: true });
  for (const f of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(src, f), 'utf8')
      .replace(/(\bfrom\s+'\.\/[A-Za-z0-9_]+)'/g, "$1.ts'");
    writeFileSync(join(work, 'lib', f), text);
  }
  const url = (f) => pathToFileURL(join(work, 'lib', f)).href;
  data = await import(url('data.ts'));
  eras = await import(url('eras.ts'));
  ctx = await import(url('context.ts'));
  an = await import(url('contextAnalytics.ts'));
} catch (e) {
  console.error('could not load src/lib:', e.message);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
const { deriveSource, AUCTION_SOURCES, SOURCE_LABEL, parseMeta } = data;

// ---------------------------------------------------------------------------
console.log('\nderiveSource\n');
// ---------------------------------------------------------------------------
{
  const UTAKU = 'https://auction.utakustradecaravan.com/';
  eq("Utaku's site root, as every one of his rows carries it", deriveSource('Matt Soto', UTAKU), 'Utaku');
  eq('  ... without the trailing slash', deriveSource('Matt Soto', 'https://auction.utakustradecaravan.com'), 'Utaku');
  eq('  ... over http, any case', deriveSource('Matt Soto', 'HTTP://Auction.UtakusTradeCaravan.com/'), 'Utaku');
  eq('  ... the bare domain', deriveSource('Matt Soto', 'https://utakustradecaravan.com/'), 'Utaku');
  eq('  ... with a path', deriveSource('Matt Soto', 'https://auction.utakustradecaravan.com/#/history'), 'Utaku');
  eq('  ... with surrounding spaces from a pasted cell', deriveSource('Matt Soto', '  https://auction.utakustradecaravan.com/ '), 'Utaku');
  eq('  ... whoever the auctioneer cell says — the Link decides', deriveSource('Utaku', UTAKU), 'Utaku');
  eq('a forum thread MENTIONING the site is still Forum (anchored on the host)',
    deriveSource('Matt Soto', 'https://truedungeon.com/forum?q=auction.utakustradecaravan.com'), 'Forum');
  eq('a look-alike host is not his', deriveSource('x', 'https://utakustradecaravan.com.example.net/'), 'Forum');
  eq("Utaku's FORUM auctions stay Forum — the venue, not the person",
    deriveSource('Matt Soto', 'https://truedungeon.com/forum?view=topic&catid=584&id=253054'), 'Forum');

  eq('alesievauctions.com is Alesiev', deriveSource('Kusig', 'https://alesievauctions.com/auctions/39'), 'Alesiev');
  eq("Trent's shop is Trent", deriveSource('Trent', 'https://trenttokens.com/products/x'), 'Trent');
  eq('Trent by name with no shop link (the fallback)', deriveSource('Trent', ''), 'Trent');
  eq('anything else is Forum', deriveSource('Someone', 'https://truedungeon.com/forum?id=1'), 'Forum');
  eq('a blank Link is Forum', deriveSource('Someone', ''), 'Forum');
}

// ---------------------------------------------------------------------------
console.log('\nThe venue list\n');
// ---------------------------------------------------------------------------
{
  eq('four venues, oldest first', AUCTION_SOURCES, ['Forum', 'Trent', 'Alesiev', 'Utaku']);
  eq('every venue has a label, and nothing else does', Object.keys(SOURCE_LABEL).sort(), [...AUCTION_SOURCES].sort());
  eq("Utaku's label is his site's name", SOURCE_LABEL.Utaku, "Utaku's Trade Caravan");
  check('no two venues share a label', new Set(Object.values(SOURCE_LABEL)).size === AUCTION_SOURCES.length);

  // The Source filter's options come from the data, in this order.
  const meta = [
    { auctionId: 'a', season: '2027', source: 'Utaku' },
    { auctionId: 'b', season: '2027', source: 'Trent' },
    { auctionId: 'c', season: '2027', source: 'Alesiev' },
    { auctionId: 'd', season: '2026', source: 'Forum' },
  ];
  const by = ctx.sourcesBySeason(meta);
  eq('2027 offers Trent, Alesiev and Utaku, in display order', ctx.sourcesInSeasons(by, ['2027']), ['Trent', 'Alesiev', 'Utaku']);
  eq('2026 offers only what it has', ctx.sourcesInSeasons(by, ['2026']), ['Forum']);
}

// ---------------------------------------------------------------------------
console.log('\nBid ladders\n');
// ---------------------------------------------------------------------------
{
  // His site's own words: "25¢ under $10, $1 from $10–$100, $5 over $100".
  eq("Utaku's ladder: 25¢ under $10", eras.bidIncrement('Utaku', 9.99), 0.25);
  eq('  ... $1 from $10', eras.bidIncrement('Utaku', 10), 1);
  eq('  ... $1 at $100 itself — "$10–$100" includes it', eras.bidIncrement('Utaku', 100), 1);
  eq('  ... $5 over $100', eras.bidIncrement('Utaku', 100.01), 5);
  eq('  ... $5 at the Codex\'s $1,255', eras.bidIncrement('Utaku', 1255), 5);
  eq('2027\'s three venues have a common step: the coarsest, Alesiev\'s 50¢ under $10', eras.comparisonIncrement(['Trent', 'Alesiev', 'Utaku'], 5), 0.5);
  eq('  ... and his $5 over $100, where the others are coarser or equal', eras.comparisonIncrement(['Trent', 'Alesiev', 'Utaku'], 120), 5);
  eq('  ... and at $60, Trent\'s $5 from $50 outranks his $1', eras.comparisonIncrement(['Trent', 'Utaku'], 60), 5);
  eq('the forum still has none, so a comparison with it has no step', eras.comparisonIncrement(['Forum', 'Utaku'], 5), null);
  eq('the venues to blame are named, in the order given', eras.venuesWithoutLadder(['Forum', 'Trent', 'Alesiev', 'Utaku']), ['Forum']);
  eq('  ... and none when every venue has one', eras.venuesWithoutLadder(['Trent', 'Alesiev', 'Utaku']), []);
}

// ---------------------------------------------------------------------------
console.log('\nThe venue comparison\n');
// ---------------------------------------------------------------------------
{
  const meta = [
    { auctionId: 't', season: '2027', source: 'Trent' },
    { auctionId: 'u', season: '2027', source: 'Utaku' },
    { auctionId: 'u2', season: '2027', source: 'Utaku' },
  ];
  const sale = (auctionId, item, price) => ({ auctionId, season: '2027', item, price, displayName: item, category: 'Trade 2' });
  const sales = [sale('t', 'Aragonite', 7), sale('u', 'Aragonite', 8), sale('u2', 'Aragonite', 9), sale('u', 'Wish Ring', 96)];
  const overlap = an.venueOverlapSeasons(sales, meta);
  eq('a token Trent and Utaku both sold puts Utaku in the comparison', overlap.map((o) => [o.season, o.venues]), [['2027', ['Trent', 'Utaku']]]);
  const rows = an.venueComparisonSeason(sales, meta, '2027', ['Trent', 'Utaku']);
  const arag = rows.find((r) => r.item === 'Aragonite');
  check('  ... with his own average, over his own sales', arag && arag.byVenue.get('Utaku').avg === 8.5 && arag.byVenue.get('Utaku').n === 2,
    JSON.stringify(arag && [...arag.byVenue]));
  check('a token only he sold is not a row', !rows.some((r) => r.item === 'Wish Ring'));
}

// ---------------------------------------------------------------------------
console.log('\nThe shipped metadata, relationally\n');
// ---------------------------------------------------------------------------
{
  const meta = parseMeta(readFileSync(join(repo, 'public', 'data', 'auctionMetadata.csv'), 'utf8'));
  const onSite = meta.filter((m) => /^https?:\/\/(?:[a-z0-9-]+\.)*utakustradecaravan\.com(?:[/:?#]|$)/i.test(m.link.trim()));
  check("every row whose Link is Utaku's site reads as Utaku", onSite.every((m) => m.source === 'Utaku'),
    onSite.filter((m) => m.source !== 'Utaku').map((m) => m.auctionId).join(', '));
  check('and nothing else does', meta.filter((m) => m.source === 'Utaku').every((m) => onSite.includes(m)));
  check(`no Utaku row before season ${eras.ERAS.utakuStartSeason}`,
    meta.filter((m) => m.source === 'Utaku').every((m) => Number(m.season) >= eras.ERAS.utakuStartSeason),
    meta.filter((m) => m.source === 'Utaku' && Number(m.season) < eras.ERAS.utakuStartSeason).map((m) => m.auctionId).join(', '));
  check('every row reads as a venue the list knows', meta.every((m) => AUCTION_SOURCES.includes(m.source)));
}

rmSync(work, { recursive: true, force: true });
console.log(`\n${fail ? '✗ FAIL' : '✓ OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
