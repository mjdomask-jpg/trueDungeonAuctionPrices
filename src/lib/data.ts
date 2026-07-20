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
