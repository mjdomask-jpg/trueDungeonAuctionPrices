// Data loading + aggregation for True Dungeon auction prices.
// Ported from the validated validate.mjs. "Last 5" = the 5 most recent
// auctions in the season overall (confirmed definition).

import { compareCategories } from './categories';

export type Sale = {
  auctionId: string;
  season: string;
  auctionNumber: number;
  item: string;
  price: number;
  displayName: string;
  category: string;
};

export type AuctionMeta = {
  auctionId: string;
  season: string;
  auctionNumber: number;
  name: string;
  auctioneer: string;
  style: string;
  completionStyle: string;
  status: string;
  link: string;
  closeDate: string;
};

export type Stats = { n: number; min: number; max: number; avg: number };

export type ItemRow = {
  item: string;
  displayName: string;
  category: string;
  full: Stats;
  last5: Stats | null; // null when the item had no sales in the last 5 auctions
};

// --- Minimal RFC-4180 CSV parser (handles quoted fields with commas) ---
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toObjects(rows: string[][]): Record<string, string>[] {
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

export function parseSales(text: string): Sale[] {
  const objs = toObjects(parseCSV(text));
  const out: Sale[] = [];
  for (const o of objs) {
    // Normalize currency formatting on import: strip $ and thousands commas
    // (main prices.csv has neither; the Onyx export writes "$110.00 ").
    const price = parseFloat((o['Price'] || '').replace(/[$,]/g, ''));
    if (!o['auctionId'] || !isFinite(price)) continue; // drop blank/invalid rows
    out.push({
      auctionId: o['auctionId'],
      season: o['auctionSeason'],
      auctionNumber: parseInt(o['auctionNumber'], 10),
      item: o['Item'],
      price,
      displayName: o['Display Name'],
      category: o['Category'],
    });
  }
  return out;
}

export function parseMeta(text: string): AuctionMeta[] {
  const objs = toObjects(parseCSV(text));
  const out: AuctionMeta[] = [];
  for (const o of objs) {
    if (!o['auctionId']) continue;
    out.push({
      auctionId: o['auctionId'],
      season: o['auctionSeason'],
      auctionNumber: parseInt(o['auctionNumber'], 10),
      name: o['auctionName'],
      auctioneer: o['auctioneer'],
      style: o['auctionStyle'],
      completionStyle: o['completionStyle'],
      status: o['Status'],
      link: o['Link'],
      closeDate: o['closeDate'],
    });
  }
  return out;
}

function stats(prices: number[]): Stats {
  const sum = prices.reduce((a, b) => a + b, 0);
  return { n: prices.length, min: Math.min(...prices), max: Math.max(...prices), avg: sum / prices.length };
}

export function seasonsOf(sales: Sale[]): string[] {
  return [...new Set(sales.map((s) => s.season))].sort((a, b) => Number(b) - Number(a));
}

// Aggregate one season into per-item rows.
export function aggregateSeason(sales: Sale[], season: string): ItemRow[] {
  const seasonSales = sales.filter((s) => s.season === season);
  if (!seasonSales.length) return [];

  // "Last 5 overall": the 5 highest auction numbers that had any sales.
  const auctionNums = [...new Set(seasonSales.map((s) => s.auctionNumber))].sort((a, b) => a - b);
  const last5 = new Set(auctionNums.slice(-5));

  const byItem = new Map<string, Sale[]>();
  for (const s of seasonSales) {
    if (!byItem.has(s.item)) byItem.set(s.item, []);
    byItem.get(s.item)!.push(s);
  }

  const rows: ItemRow[] = [];
  for (const [item, group] of byItem) {
    const last5Sales = group.filter((s) => last5.has(s.auctionNumber));
    rows.push({
      item,
      displayName: group[group.length - 1].displayName, // most recent display name
      category: group[0].category,
      full: stats(group.map((s) => s.price)),
      last5: last5Sales.length ? stats(last5Sales.map((s) => s.price)) : null,
    });
  }
  return rows.sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item));
}

export function lastFiveAuctionNumbers(sales: Sale[], season: string): number[] {
  const nums = [...new Set(sales.filter((s) => s.season === season).map((s) => s.auctionNumber))].sort((a, b) => a - b);
  return nums.slice(-5);
}

// --- Price timelines (Phase 2) -------------------------------------------
// One plotted point per auction in which a token sold. A token can sell more
// than once in the same auction (multiple copies), so each point aggregates
// that auction's sales to their average; min/max/n are kept for the tooltip.

export type TimelinePoint = {
  auctionNumber: number;
  closeDate: string; // ISO 'YYYY-MM-DD', or '' when metadata has none
  avg: number;
  min: number;
  max: number;
  n: number; // sales aggregated into this point
};

// Sortable date key: real ISO dates compare lexically; anything else (missing/
// 'n/a') collapses to '' so a season with no close dates falls back cleanly to
// auction-number order.
function dateKey(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '';
}

// Per-auction average price for one item across one season, ordered by auction
// close date (auction number as tiebreak, and as the sole order when a season
// carries no close dates).
export function itemTimeline(
  sales: Sale[], meta: AuctionMeta[], item: string, season: string,
): TimelinePoint[] {
  const closeByAuction = new Map<string, string>();
  for (const m of meta) closeByAuction.set(m.auctionId, m.closeDate);

  const byAuction = new Map<number, { prices: number[]; auctionId: string }>();
  for (const s of sales) {
    if (s.season !== season || s.item !== item) continue;
    let bucket = byAuction.get(s.auctionNumber);
    if (!bucket) { bucket = { prices: [], auctionId: s.auctionId }; byAuction.set(s.auctionNumber, bucket); }
    bucket.prices.push(s.price);
  }

  const points: TimelinePoint[] = [];
  for (const [auctionNumber, { prices, auctionId }] of byAuction) {
    const sum = prices.reduce((a, b) => a + b, 0);
    points.push({
      auctionNumber,
      closeDate: closeByAuction.get(auctionId) ?? '',
      avg: sum / prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      n: prices.length,
    });
  }

  points.sort((a, b) => {
    const ka = dateKey(a.closeDate), kb = dateKey(b.closeDate);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.auctionNumber - b.auctionNumber;
  });
  return points;
}

// --- Timeline grouping (Phase 2) -----------------------------------------
// Tokens are grouped for display so similarly-priced tokens share one chart's
// linear axis (a $2,500 token and a $130 token on one axis would flatten the
// cheaper line). The grouping is authored in public/data/tokenGroups.csv and
// keyed on the canonical Item; a group is the chart unit and may span
// categories, so charts are ordered by a global Group Order, not by category.

export type GroupRow = {
  item: string;
  group: string;
  groupOrder: number;
  category: string; // drives the chart's heading colour (reuses the Prices-page category colours)
  lineColor?: string; // optional per-token line-colour override (see PriceTimeline)
};

// Parse tokenGroups.csv. Columns: Category, Item, Display Name, Group,
// Group Order, Line Color. Display Name is an authoring aid the app ignores
// (the per-season display name comes from prices.csv). A blank Group means
// "don't chart this token".
export function parseGroups(text: string): GroupRow[] {
  const out: GroupRow[] = [];
  for (const o of toObjects(parseCSV(text))) {
    const item = o['Item'], group = o['Group'];
    if (!item || !group) continue;
    const go = parseInt(o['Group Order'], 10);
    out.push({
      item, group,
      groupOrder: isFinite(go) ? go : Number.MAX_SAFE_INTEGER,
      category: o['Category'] ?? '',
      lineColor: o['Line Color'] || undefined,
    });
  }
  return out;
}

export type TimelineSeries = { item: string; displayName: string; points: TimelinePoint[]; lineColor?: string };
export type TimelineGroup = { group: string; groupOrder: number; category: string; series: TimelineSeries[] };

// A group's heading colour follows its dominant token category (a group may mix
// categories — e.g. Bonus + Preorder — so we take the most common, first-seen
// winning ties).
function modeCategory(rows: GroupRow[]): string {
  const count = new Map<string, number>();
  let best = '', bestN = 0;
  for (const r of rows) {
    const n = (count.get(r.category) ?? 0) + 1;
    count.set(r.category, n);
    if (n > bestN) { bestN = n; best = r.category; }
  }
  return best;
}
export type GroupedTimelines = {
  groups: TimelineGroup[];
  ungrouped: string[]; // sold this season but in no group — surfaced so nothing is silently dropped
  unmatched: string[]; // Item codes in the grouping file that never appear in any sale (likely typos)
};

// Build every group's per-token timelines for one season. Display names are
// resolved from that season's own sales, so legends always show the right
// year's name. Tokens that didn't sell this season are simply absent; empty
// groups are dropped. Groups are ordered by Group Order (name as tiebreak).
export function groupedTimelines(
  sales: Sale[], meta: AuctionMeta[], groupRows: GroupRow[], season: string,
): GroupedTimelines {
  const seasonSales = sales.filter((s) => s.season === season);
  const dispByItem = new Map<string, string>();
  const itemsInSeason = new Set<string>();
  for (const s of seasonSales) { dispByItem.set(s.item, s.displayName); itemsInSeason.add(s.item); }
  const everSold = new Set(sales.map((s) => s.item));

  const byGroup = new Map<string, { order: number; rows: GroupRow[] }>();
  const groupedItems = new Set<string>();
  for (const r of groupRows) {
    groupedItems.add(r.item);
    let g = byGroup.get(r.group);
    if (!g) { g = { order: r.groupOrder, rows: [] }; byGroup.set(r.group, g); }
    g.order = Math.min(g.order, r.groupOrder);
    g.rows.push(r);
  }

  const groups: TimelineGroup[] = [];
  for (const [group, { order, rows }] of byGroup) {
    const series: TimelineSeries[] = [];
    for (const r of rows) {
      if (!itemsInSeason.has(r.item)) continue;
      const points = itemTimeline(seasonSales, meta, r.item, season);
      if (points.length) {
        series.push({ item: r.item, displayName: dispByItem.get(r.item) ?? r.item, points, lineColor: r.lineColor });
      }
    }
    if (series.length) groups.push({ group, groupOrder: order, category: modeCategory(rows), series });
  }
  groups.sort((a, b) => a.groupOrder - b.groupOrder || a.group.localeCompare(b.group));

  const ungrouped = [...itemsInSeason]
    .filter((i) => !groupedItems.has(i))
    .map((i) => dispByItem.get(i) ?? i)
    .sort((a, b) => a.localeCompare(b));
  const unmatched = [...groupedItems].filter((i) => !everSold.has(i)).sort();

  return { groups, ungrouped, unmatched };
}

// --- Compare Years (Phase 3) ---------------------------------------------
// Join two seasons' per-item full-season stats so you can see how each token's
// price moved year over year. Keyed on the canonical Item (not the display
// name), so a token that filled the same role is compared across years even
// when its yearly display name changed. A token absent in one of the two years
// keeps its row with null stats (rendered as "—"); the % change is only defined
// when both years have an average and the earlier one is non-zero.

export type CompareRow = {
  item: string;
  category: string;      // stable per Item; taken from the newer season present, else the other
  nameA: string | null;  // display name in season A (null if it didn't sell that year)
  nameB: string | null;  // display name in season B
  a: Stats | null;       // full-season stats in season A
  b: Stats | null;       // full-season stats in season B
  avgPct: number | null; // % change of the average from A→B; null unless both years priced (A.avg ≠ 0)
};

// Compare two seasons. seasonA / seasonB are just the two picked seasons in the
// order the caller wants them shown; avgPct is always the change from A's avg to
// B's avg. Category/name preference leans on whichever season is numerically
// newer (handles a token being recategorised or renamed across years).
export function compareSeasons(sales: Sale[], seasonA: string, seasonB: string): CompareRow[] {
  const A = new Map(aggregateSeason(sales, seasonA).map((r) => [r.item, r]));
  const B = new Map(aggregateSeason(sales, seasonB).map((r) => [r.item, r]));
  const newerIsB = Number(seasonB) >= Number(seasonA);

  const rows: CompareRow[] = [];
  for (const item of new Set([...A.keys(), ...B.keys()])) {
    const ra = A.get(item), rb = B.get(item);
    const a = ra?.full ?? null, b = rb?.full ?? null;
    const avgPct = a && b && a.avg !== 0 ? ((b.avg - a.avg) / a.avg) * 100 : null;
    const newer = newerIsB ? rb : ra;
    const older = newerIsB ? ra : rb;
    rows.push({
      item,
      category: (newer ?? older)!.category,
      nameA: ra?.displayName ?? null,
      nameB: rb?.displayName ?? null,
      a, b, avgPct,
    });
  }
  return rows;
}

// --- Detailed Auction Data explorer (Phase 5) ----------------------------
// The raw sales, grouped under the auction they happened in, so you can answer
// "what actually went for what, and where" rather than "what does this token
// average". The join is metadata-driven — the auction is the unit, and its
// style / completion style / auctioneer / close date are filterable dimensions,
// not just labels.
//
// Grain: ONE PRICE PER TOKEN PER AUCTION. A token can sell more than once in
// the same auction (1,707 such pairs in prices.csv, 20 in onyx.csv); those
// duplicates collapse to their average, which is the single number the auction
// is treated as having produced for that token. Deliberately not labelled as an
// average in the UI — from the reader's side it is just that auction's price.

export type ExplorerFilters = {
  season: string; // '' = every season
  category: string; // '' = every category
  auctioneer: string; // '' = every auctioneer
  search: string; // free text over token names AND the auction's name
  auctionSearch: string; // free text over the auction's name only
};

export const EMPTY_FILTERS: ExplorerFilters = {
  season: '', category: '', auctioneer: '', search: '', auctionSearch: '',
};

// One token's result in one auction — the explorer's row. `price` is that
// auction's price for the token: the sale price when it sold once, the average
// of them when it sold several times.
export type SaleRow = {
  auctionId: string;
  item: string;
  displayName: string;
  category: string;
  price: number;
};

export type AuctionGroup = {
  meta: AuctionMeta;
  rows: SaleRow[]; // the tokens in this auction that matched the sale-level filters
  total: number; // sum of their prices
  min: number; // 0 when the auction matched with nothing
  max: number;
};

export type ExplorerResult = {
  auctions: AuctionGroup[];
  rowCount: number; // matching token-prices across every listed auction
  total: number; // their summed value
  tokenCount: number; // distinct canonical Items among them
};

// Collapse an auction's sales to one row per token, averaging repeat sales.
// Rows read in the site's category order, then by display name.
function collapseToRows(sales: Sale[]): SaleRow[] {
  const byItem = new Map<string, Sale[]>();
  for (const s of sales) {
    let bucket = byItem.get(s.item);
    if (!bucket) { bucket = []; byItem.set(s.item, bucket); }
    bucket.push(s);
  }

  const rows: SaleRow[] = [];
  for (const [item, group] of byItem) {
    const sum = group.reduce((a, s) => a + s.price, 0);
    rows.push({
      auctionId: group[0].auctionId,
      item,
      displayName: group[0].displayName,
      category: group[0].category,
      price: sum / group.length,
    });
  }
  return rows.sort((a, b) =>
    compareCategories(a.category, b.category) || a.displayName.localeCompare(b.displayName));
}

// Auctions read newest-first: season descending, then close date descending,
// with auction number as the tiebreak (and the sole order for the 42 rows
// whose close date is 'n/a').
function compareAuctionsDesc(a: AuctionMeta, b: AuctionMeta): number {
  if (a.season !== b.season) return Number(b.season) - Number(a.season);
  const ka = dateKey(a.closeDate), kb = dateKey(b.closeDate);
  if (ka !== kb) return ka < kb ? 1 : -1;
  return b.auctionNumber - a.auctionNumber;
}

// Case-insensitive substring match on either name a token goes by.
function tokenMatches(s: Sale, needle: string): boolean {
  const q = needle.toLowerCase();
  return s.displayName.toLowerCase().includes(q) || s.item.toLowerCase().includes(q);
}

function auctionNameMatches(m: AuctionMeta, needle: string): boolean {
  return m.name.toLowerCase().includes(needle.toLowerCase());
}

// Run the explorer query. Auction-level filters (season / auctioneer / auction
// name) select which auctions are listed; sale-level filtering (category, and
// the token half of the general search) selects which rows show inside them,
// and prunes auctions left matching nothing.
//
// Only Closed auctions are listed. The five Failed ones recorded no sales
// anyway, so this drops empty rows rather than any price data.
//
// The general search spans both levels: an auction whose NAME matches keeps all
// its rows, and any token whose name matches keeps its row. That is what makes
// one box able to answer both "Trent" and "Wish Ring".
export function exploreAuctions(
  sales: Sale[], meta: AuctionMeta[], f: ExplorerFilters,
): ExplorerResult {
  const salesByAuction = new Map<string, Sale[]>();
  for (const s of sales) {
    let bucket = salesByAuction.get(s.auctionId);
    if (!bucket) { bucket = []; salesByAuction.set(s.auctionId, bucket); }
    bucket.push(s);
  }

  const needle = f.search.trim();
  const auctionNeedle = f.auctionSearch.trim();
  const saleLevelFilter = Boolean(f.category || needle);

  const auctions: AuctionGroup[] = [];
  let rowCount = 0, total = 0;
  const items = new Set<string>();

  for (const m of meta) {
    if (m.status !== 'Closed') continue;
    if (f.season && m.season !== f.season) continue;
    if (f.auctioneer && m.auctioneer !== f.auctioneer) continue;
    if (auctionNeedle && !auctionNameMatches(m, auctionNeedle)) continue;

    // A general-search hit on the auction's own name qualifies every token in
    // it; otherwise each token has to match on its own.
    const nameHit = Boolean(needle) && auctionNameMatches(m, needle);
    const matched = (salesByAuction.get(m.auctionId) ?? []).filter(
      (s) => (!f.category || s.category === f.category) && (!needle || nameHit || tokenMatches(s, needle)),
    );
    if (!matched.length && saleLevelFilter) continue;

    const rows = collapseToRows(matched);

    let sum = 0;
    for (const r of rows) { sum += r.price; items.add(r.item); }
    rowCount += rows.length;
    total += sum;

    auctions.push({
      meta: m,
      rows,
      total: sum,
      min: rows.length ? Math.min(...rows.map((r) => r.price)) : 0,
      max: rows.length ? Math.max(...rows.map((r) => r.price)) : 0,
    });
  }

  auctions.sort((a, b) => compareAuctionsDesc(a.meta, b.meta));
  return { auctions, rowCount, total, tokenCount: items.size };
}

// --- Flat table view -----------------------------------------------------
// The same rows the grouped view shows, flattened to one list with their
// auction alongside, and sortable on any column. Same query, same numbers —
// only the shape differs, so the toggle between the two views never changes
// what is being reported.

export type FlatRow = { row: SaleRow; meta: AuctionMeta };
export type SortKey =
  | 'season' | 'number' | 'date' | 'auction' | 'auctioneer' | 'token' | 'category' | 'price';
export type SortDir = 'asc' | 'desc';

// The table's opening sort: newest season first, and within a season the
// highest auction number first.
export const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'season', dir: 'desc' };

export function flattenAuctions(auctions: AuctionGroup[]): FlatRow[] {
  return auctions.flatMap((a) => a.rows.map((row) => ({ row, meta: a.meta })));
}

// Each column's comparator, written ASCENDING; the direction is applied once by
// the caller so a column can't disagree with its own arrow.
const ASCENDING: Record<SortKey, (a: FlatRow, b: FlatRow) => number> = {
  season: (a, b) => Number(a.meta.season) - Number(b.meta.season),
  number: (a, b) => a.meta.auctionNumber - b.meta.auctionNumber,
  date: (a, b) => dateKey(a.meta.closeDate).localeCompare(dateKey(b.meta.closeDate)),
  auction: (a, b) => a.meta.name.localeCompare(b.meta.name),
  auctioneer: (a, b) => a.meta.auctioneer.localeCompare(b.meta.auctioneer),
  token: (a, b) => a.row.displayName.localeCompare(b.row.displayName),
  category: (a, b) => compareCategories(a.row.category, b.row.category),
  price: (a, b) => a.row.price - b.row.price,
};

// Ties resolve the way the default sort orders the table — newest season, then
// highest auction number, then token name — so every sort is total and the rows
// never shuffle between renders.
function tiebreak(a: FlatRow, b: FlatRow): number {
  return Number(b.meta.season) - Number(a.meta.season) ||
    b.meta.auctionNumber - a.meta.auctionNumber ||
    a.row.displayName.localeCompare(b.row.displayName);
}

export function sortFlatRows(rows: FlatRow[], key: SortKey, dir: SortDir): FlatRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const primary = ASCENDING[key];
  return [...rows].sort((a, b) => primary(a, b) * sign || tiebreak(a, b));
}

// The option lists for the explorer's two remaining pickers, derived from the
// data rather than hardcoded so a new auctioneer in the export shows up without
// a code change. Seasons come back newest-first, categories in site order.
// Auctioneers are taken from Closed auctions only, matching what the page
// lists, and blanks are dropped — they'd be unselectable noise in a dropdown.
export type ExplorerOptions = {
  seasons: string[];
  categories: string[];
  auctioneers: string[];
};

export function explorerOptions(sales: Sale[], meta: AuctionMeta[]): ExplorerOptions {
  return {
    seasons: seasonsOf(sales),
    categories: [...new Set(sales.map((s) => s.category))].sort(compareCategories),
    auctioneers: [...new Set(meta.filter((m) => m.status === 'Closed').map((m) => m.auctioneer))]
      .filter((v) => v && v !== 'n/a')
      .sort((a, b) => a.localeCompare(b)),
  };
}
