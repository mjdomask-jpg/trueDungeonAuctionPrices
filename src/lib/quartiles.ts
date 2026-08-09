// Quartile analysis (Analytics → Quartiles). Built on the richer per-lot Trent
// export in public/data/rawPricesData.csv — one row per individual lot sold,
// which is enough data points per token to describe a distribution rather than
// just a min/max/avg. See docs/updating-the-data.md for the file's role.
//
// The breakdown mirrors Price Timelines exactly: tokens are grouped via
// tokenGroups.csv (Group Order, per-token line colours) so each group holds
// similarly-priced tokens on one readable axis. That grouping is also what tames
// the Premium category's huge internal spread — the $1,000+ Path to Enlightenment
// fragment sits in its own group, away from the sub-$150 Patron Pin / Wish Ring.

import { parseCSV, cleanName, TRADE_1, TENX_PREFIX, type Sale, type GroupRow } from './data';

// A raw per-lot sale, normalised from rawPricesData.csv. Only the four fields the
// quartile math needs are kept; trentName/trentPrice (the lot total, used for the
// sheet's max/min pivots) are dropped here.
export type RawSale = { season: string; category: string; item: string; price: number };

const TENX = 10;

// Parse rawPricesData.csv. Columns: auctionId, auctionSeason, auctionNumber,
// trentName, trentPrice, Item, Price, Category. The per-unit `Price` (not the
// `trentPrice` lot total) is the distribution we chart. $0.00 lots are dropped:
// they read as unsold/placeholder rows and would otherwise pin every whisker to
// zero (confirmed with the data owner). Anything unparseable is dropped too.
export function parseRawSales(text: string): RawSale[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iSeason = col('auctionSeason');
  const iItem = col('Item');
  const iPrice = col('Price');
  const iCat = col('Category');
  const out: RawSale[] = [];
  for (const r of rows.slice(1)) {
    const price = parseFloat((r[iPrice] ?? '').replace(/[$,]/g, ''));
    if (!Number.isFinite(price) || price <= 0) continue; // drops $0.00 + blanks
    out.push({
      season: (r[iSeason] ?? '').trim(),
      category: (r[iCat] ?? '').trim(),
      item: cleanName(r[iItem] ?? ''),
      price,
    });
  }
  return out;
}

// Seasons present in the raw feed, newest first — drives the year selector.
export function rawSeasons(raw: RawSale[]): string[] {
  return [...new Set(raw.map((r) => r.season))].filter(Boolean).sort((a, b) => Number(b) - Number(a));
}

// The five-number summary plus the pieces a Tukey box plot draws.
export type BoxStats = {
  n: number;
  min: number;
  max: number;
  mean: number;
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  // Tukey whisker ends: the furthest data point still within 1.5×IQR of the
  // quartiles (never beyond the actual data).
  whiskerLo: number;
  whiskerHi: number;
  // Points beyond the whiskers, drawn as individual dots.
  outliers: number[];
};

// Linear-interpolated quantile (the "type 7" method NumPy/Excel PERCENTILE use),
// so the numbers match a spreadsheet check. Input must be pre-sorted ascending.
function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = (n - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Five-number summary + Tukey fences for one token's price list.
export function boxStats(prices: number[]): BoxStats {
  const sorted = prices.slice().sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const fenceLo = q1 - 1.5 * iqr;
  const fenceHi = q3 + 1.5 * iqr;
  // Whiskers reach the last in-fence point; outliers are everything past a fence.
  let whiskerLo = sorted[0];
  let whiskerHi = sorted[n - 1];
  const outliers: number[] = [];
  for (const v of sorted) {
    if (v < fenceLo || v > fenceHi) outliers.push(v);
  }
  for (const v of sorted) { if (v >= fenceLo) { whiskerLo = v; break; } }
  for (let i = n - 1; i >= 0; i--) { if (sorted[i] <= fenceHi) { whiskerHi = sorted[i]; break; } }
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return { n, min: sorted[0], max: sorted[n - 1], mean, q1, median, q3, iqr, whiskerLo, whiskerHi, outliers };
}

export type QuartileItem = {
  item: string;
  displayName: string;
  category: string;
  lineColor?: string;
  stats: BoxStats;
};
export type QuartileGroup = {
  group: string;
  groupOrder: number;
  category: string; // heading colour (dominant token category in the group)
  items: QuartileItem[];
};
export type GroupedQuartiles = {
  groups: QuartileGroup[];
  ungrouped: string[]; // sold this year but assigned to no group
  unmatched: string[]; // grouping references a token that never appears in the raw feed
};

// Most common category in a group's rows (first-seen wins ties), for the heading
// colour — same rule Price Timelines uses (groups may mix categories).
function modeCategory(rows: GroupRow[]): string {
  const count = new Map<string, number>();
  let best = '';
  let bestN = 0;
  for (const r of rows) {
    const n = (count.get(r.category) ?? 0) + 1;
    count.set(r.category, n);
    if (n > bestN) { bestN = n; best = r.category; }
  }
  return best;
}

// Build every group's per-token box stats for one year. `sales` (prices.csv) is
// used only to resolve that season's public display name for each token, so the
// labels read the same as Timelines; tokens absent from prices.csv fall back to
// their canonical name. When `tenX` is on, Trade 1 prices are shown as their 10x
// bundle (×10, "10x " name prefix) — the same pure display transform as the
// Prices/Timelines pages. Groups are ordered by Group Order (name as tiebreak);
// empty groups drop out.
export function quartilesByGroup(
  raw: RawSale[], sales: Sale[], groupRows: GroupRow[], year: string, tenX: boolean,
): GroupedQuartiles {
  // Per-token price lists for the chosen year, 10x-scaled for Trade 1 when asked.
  const pricesByItem = new Map<string, number[]>();
  const itemsInYear = new Set<string>();
  for (const r of raw) {
    if (r.season !== year) continue;
    itemsInYear.add(r.item);
    const price = tenX && r.category === TRADE_1 ? r.price * TENX : r.price;
    let list = pricesByItem.get(r.item);
    if (!list) { list = []; pricesByItem.set(r.item, list); }
    list.push(price);
  }

  // Display names from that season's prices.csv, matching Timelines' labels.
  const dispByItem = new Map<string, string>();
  for (const s of sales) if (s.season === year) dispByItem.set(s.item, s.displayName);
  const everInRaw = new Set(raw.map((r) => r.item));
  // Categories the raw per-lot feed actually carries. The Trent export is a
  // subset (no Golden Ticket, Condensed, or Safehold), so a grouped token from
  // one of those categories is expected-absent, not a typo — only categories
  // present here can produce a meaningful "unmatched" (likely-typo) warning.
  const rawCategories = new Set(raw.map((r) => r.category));

  const byGroup = new Map<string, { order: number; rows: GroupRow[] }>();
  const groupedItems = new Set<string>();
  for (const gr of groupRows) {
    groupedItems.add(gr.item);
    let g = byGroup.get(gr.group);
    if (!g) { g = { order: gr.groupOrder, rows: [] }; byGroup.set(gr.group, g); }
    g.order = Math.min(g.order, gr.groupOrder);
    g.rows.push(gr);
  }

  const groups: QuartileGroup[] = [];
  for (const [group, { order, rows }] of byGroup) {
    const items: QuartileItem[] = [];
    for (const gr of rows) {
      const prices = pricesByItem.get(gr.item);
      if (!prices || !prices.length) continue;
      const base = dispByItem.get(gr.item) ?? gr.item;
      const displayName = tenX && gr.category === TRADE_1 ? `${TENX_PREFIX}${base}` : base;
      items.push({ item: gr.item, displayName, category: gr.category, lineColor: gr.lineColor, stats: boxStats(prices) });
    }
    if (items.length) {
      // Boxes read left→right cheapest median first, so a group's axis rises with
      // the boxes — easier to scan than the grouping file's authoring order.
      items.sort((a, b) => a.stats.median - b.stats.median || a.displayName.localeCompare(b.displayName));
      groups.push({ group, groupOrder: order, category: modeCategory(rows), items });
    }
  }
  groups.sort((a, b) => a.groupOrder - b.groupOrder || a.group.localeCompare(b.group));

  const ungrouped = [...itemsInYear]
    .filter((i) => !groupedItems.has(i))
    .map((i) => dispByItem.get(i) ?? i)
    .sort((a, b) => a.localeCompare(b));
  // A grouped token missing from the raw feed is only worth flagging when its
  // category is one the feed carries (so it's a plausible typo, not a token the
  // Trent export never includes).
  const unmatched = groupRows
    .filter((gr) => !everInRaw.has(gr.item) && rawCategories.has(gr.category))
    .map((gr) => gr.item)
    .sort();

  return { groups, ungrouped, unmatched };
}
