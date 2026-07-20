// Data loading + aggregation for True Dungeon auction prices.
// Ported from the validated validate.mjs. "Last 5" = the 5 most recent
// auctions in the season overall (confirmed definition).

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
