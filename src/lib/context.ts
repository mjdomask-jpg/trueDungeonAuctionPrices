// Auction context layer: item provenance + the withheld estimate recompute.
//
// This module turns the raw contextItems.csv rows (auctioneer-withheld items,
// personal-collection augments, Grunnel drops) into classified, valued
// ContextItems, and rolls them up per auction. It reads only core sales
// (prices.csv) to estimate withheld values, so the estimate can never feed on
// itself (docs/data-audit.md §6, "no circularity").
//
// Full design: docs/context-layer-design.md. Withheld method: data-audit.md §6.1.

import { parseCSV, dateKey, cleanName, type Sale, type AuctionMeta } from './data';
import { ERAS } from './eras';

// How an item entered the auction — an axis ORTHOGONAL to its token category.
// 'normal' is the implicit provenance of every prices.csv sale and never appears
// in contextItems; the other four are the context layer.
export type Provenance = 'released-payment' | 'augment' | 'grunnel' | 'withheld';

// A raw contextItems.csv row. `name` is a Display-Name-style value (the field is
// labelled "Item" in the sheet but holds display names — audit §C8); it is the
// key we join to prices on. `refValue` is the sheet's priceAugmented: a real
// value for augment/grunnel/released, but for withheld it is only a reference —
// the runtime value is recomputed (see valueWithheld).
export type RawContextItem = {
  auctionId: string;
  category: string; // token | augment | grunnel | withheld
  name: string;
  quantity: number;
  refValue: number | null;
};

export type ContextItem = RawContextItem & {
  provenance: Provenance;
  // Real sale value (augment/grunnel/released) or the recomputed, negative
  // withheld estimate. Lot total, i.e. already × quantity.
  value: number;
  estimate: boolean; // true only for withheld
  n?: number; // withheld: number of prior same-season sales the estimate averaged
};

// --- Parsing --------------------------------------------------------------

function toObjects(text: string): Record<string, string>[] {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

export function parseContextItems(text: string): RawContextItem[] {
  const out: RawContextItem[] = [];
  for (const o of toObjects(text)) {
    if (!o['auctionId']) continue;
    const qty = parseFloat((o['quantity'] || '').replace(/,/g, ''));
    const ref = parseFloat((o['priceAugmented'] || '').replace(/[$,]/g, ''));
    out.push({
      auctionId: o['auctionId'],
      category: o['category'],
      name: cleanName(o['Item']),
      quantity: Number.isFinite(qty) ? qty : 1,
      refValue: Number.isFinite(ref) ? ref : null,
    });
  }
  return out;
}

// --- Classification (design §2) -------------------------------------------

const randomUrSet = new Set(ERAS.randomUltraRareNames.map((s) => s.toLowerCase()));

// A Random Ultra Rare (released auctioneer payment) rather than a personal-
// collection augment. Name-based — the only signal the data offers (§2).
export function isRandomUltraRare(name: string): boolean {
  return randomUrSet.has((name ?? '').trim().toLowerCase());
}

// Formerly-retained auctioneer payment now released to bidders: Random Ultra
// Rares and Golden Tickets. A Golden Ticket added via the augment sheet is the
// same thing as a Golden Ticket in the normal sales (both were the auctioneer's
// to keep), so both classify as released-payment (design §2).
function isReleasedPayment(name: string): boolean {
  return isRandomUltraRare(name) || (name ?? '').trim().toLowerCase() === 'golden ticket';
}

// Map a raw category (+ item name) to a provenance. The 2026 `augment` label is
// merged into `token` (Phase-1 Q3); Random Ultra Rares and Golden Tickets in
// either are split back out as `released-payment` by name. Unknown categories
// fall back to `augment` (safest: a real-sale supplement) — the validator flags them.
export function classifyProvenance(category: string, name: string): Provenance {
  const c = (category ?? '').trim().toLowerCase();
  if (c === 'withheld') return 'withheld';
  if (c === 'grunnel') return 'grunnel';
  // 'token', 'augment', or anything else real-sale:
  return isReleasedPayment(name) ? 'released-payment' : 'augment';
}

// --- Withheld recompute (design §4, method in data-audit.md §6.1) ----------

// A sortable close instant for an auction: its close date in ms, or a synthetic
// value well before any real date (ordered by season then number) when the date
// is missing. Undated auctions are all pre-2023 and never withheld auctions, so
// the fallback exists for correctness but is never exercised here.
function auctionInstant(m: AuctionMeta): number {
  const k = dateKey(m.closeDate);
  if (k) return Date.parse(k);
  return -1e15 + Number(m.season) * 1000 + m.auctionNumber;
}

// Prebuilt indices shared across every withheld row, so the recompute is O(sales)
// once rather than per-item.
type SaleRef = { season: string; inst: number; auctionId: string; price: number };
type PriceIndex = {
  instantById: Map<string, number>;
  seasonById: Map<string, string>;
  // displayName -> sales of it, each carrying its auction's season, close instant
  // and id (the id lets the estimate group sales into distinct prior auctions).
  salesByName: Map<string, SaleRef[]>;
};

function buildPriceIndex(sales: Sale[], meta: AuctionMeta[]): PriceIndex {
  const instantById = new Map<string, number>();
  const seasonById = new Map<string, string>();
  for (const m of meta) {
    instantById.set(m.auctionId, auctionInstant(m));
    seasonById.set(m.auctionId, m.season);
  }
  const salesByName = new Map<string, SaleRef[]>();
  for (const s of sales) {
    const inst = instantById.get(s.auctionId);
    if (inst == null) continue; // sale with no metadata (none today) — skip cleanly
    let bucket = salesByName.get(s.displayName);
    if (!bucket) { bucket = []; salesByName.set(s.displayName, bucket); }
    bucket.push({ season: s.season, inst, auctionId: s.auctionId, price: s.price });
  }
  return { instantById, seasonById, salesByName };
}

// The point-in-time estimate for one withheld item: mean of that display name's
// same-season sales from at most the ERAS.withheldLookbackAuctions most RECENT
// auctions (by close date) that CLOSED strictly before this one, negated,
// × quantity. Capping the lookback keeps the estimate near the item's value at the
// time it was withheld rather than averaging in stale early-season sales.
// Returns the value and the sample size n (sales in the window). n === 0 (no prior
// sale) cannot occur for the current data (audit §6.1) but is handled: value falls
// back to the sheet's reference so nothing silently zeroes out.
export function valueWithheld(item: RawContextItem, idx: PriceIndex): { value: number; n: number } {
  const season = idx.seasonById.get(item.auctionId);
  const wInst = idx.instantById.get(item.auctionId);
  const prior = (idx.salesByName.get(item.name) ?? []).filter(
    (s) => s.season === season && wInst != null && s.inst < wInst,
  );
  if (!prior.length) {
    return { value: item.refValue ?? 0, n: 0 };
  }
  // Keep only sales from the N most-recent prior auctions. Auctions are ranked by
  // close instant (id as a stable tiebreak for same-day closes); all of an item's
  // lots within a kept auction count.
  const instByAuction = new Map<string, number>();
  for (const s of prior) instByAuction.set(s.auctionId, s.inst);
  const recent = new Set(
    [...instByAuction.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))
      .slice(0, ERAS.withheldLookbackAuctions)
      .map(([id]) => id),
  );
  const window = prior.filter((s) => recent.has(s.auctionId));
  const mean = window.reduce((a, s) => a + s.price, 0) / window.length;
  return { value: -mean * item.quantity, n: window.length };
}

// --- Build (the module's public entry point) -------------------------------

// Classify and value every context item. Withheld rows are recomputed from live
// sales; all others take their real sheet value. Pure over its inputs.
//
// CLOSED AUCTIONS ONLY. Items from Failed auctions are dropped: a failed auction
// never completed, so nothing was actually withheld or augmented, and the funding
// analytics are per completed auction. This matches the explorer, which already
// lists only Closed auctions (data.ts exploreAuctions). It also sidesteps a data
// artifact — the one Failed auction carrying context rows (202518) has no close
// date, so it couldn't be ordered for the point-in-time estimate anyway.
export function buildContextItems(
  raw: RawContextItem[], sales: Sale[], meta: AuctionMeta[],
): ContextItem[] {
  const idx = buildPriceIndex(sales, meta);
  const closed = new Set(meta.filter((m) => m.status === 'Closed').map((m) => m.auctionId));
  return raw.filter((r) => closed.has(r.auctionId)).map((r) => {
    const provenance = classifyProvenance(r.category, r.name);
    if (provenance === 'withheld') {
      const { value, n } = valueWithheld(r, idx);
      return { ...r, provenance, value, estimate: true, n };
    }
    return { ...r, provenance, value: r.refValue ?? 0, estimate: false };
  });
}

// --- Auction-level rollup (authoritative; supersedes the sheet's) ----------

export type AuctionContext = {
  auctionId: string;
  released: number; // real
  augment: number; // real (personal collection)
  grunnel: number; // real
  withheld: number; // estimate, ≤ 0
  // released + augment + grunnel + withheld — the value the auctioneer added or
  // withheld on net. Recomputed here rather than trusting the sheet's stale/
  // miscategorised augmentedTotal (audit §4.3).
  augmentedTotal: number;
};

const emptyRollup = (auctionId: string): AuctionContext => ({
  auctionId, released: 0, augment: 0, grunnel: 0, withheld: 0, augmentedTotal: 0,
});

// Sum the classified items per auction into AuctionContext rows.
export function rollupByAuction(items: ContextItem[]): Map<string, AuctionContext> {
  const byAuction = new Map<string, AuctionContext>();
  for (const it of items) {
    let a = byAuction.get(it.auctionId);
    if (!a) { a = emptyRollup(it.auctionId); byAuction.set(it.auctionId, a); }
    if (it.provenance === 'released-payment') a.released += it.value;
    else if (it.provenance === 'augment') a.augment += it.value;
    else if (it.provenance === 'grunnel') a.grunnel += it.value;
    else if (it.provenance === 'withheld') a.withheld += it.value;
    a.augmentedTotal = a.released + a.augment + a.grunnel + a.withheld;
  }
  return byAuction;
}

// --- Shared view filters (design §5.2) -------------------------------------
// The vocabulary and logic behind the FilterBar controls. Defined here (the
// context-layer lib) rather than in the React data/ layer so the pure filtering
// can be unit-tested and reused, and so filtersContext can import the types
// without the types depending on React. See applyViewFilters for the one place
// pages funnel their sale feed through.

export type SourceFilter = 'all' | 'Forum' | 'Trent';
export type TrentPricing = 'nominal' | 'reward-adjusted';
export type AuctionTypeFilter = 'all' | 'augmented' | 'non-augmented' | 'golden-ticket';

// The subset of filter state that selects/rescales sales. The FilterBar's
// provenance chips act on the context-item list, not the core sales, so they are
// deliberately not part of this shape.
export type ViewFilter = {
  source: SourceFilter;
  trentPricing: TrentPricing;
  auctionType: AuctionTypeFilter;
};

// Auctions that included a Golden Ticket, from EITHER feed: a GT sale in
// prices.csv (13 auctions) or a GT released-payment context row (audit §5). Union
// so the "With Golden Ticket" filter is complete regardless of which sheet
// recorded it. Names match the classifier's (isReleasedPayment) exact 'golden
// ticket'.
export function findGoldenTicketAuctions(
  sales: Sale[], context: RawContextItem[],
): Set<string> {
  const ids = new Set<string>();
  const isGT = (name: string) => (name ?? '').trim().toLowerCase() === 'golden ticket';
  for (const s of sales) if (isGT(s.displayName) || isGT(s.item)) ids.add(s.auctionId);
  for (const c of context) if (isGT(c.name)) ids.add(c.auctionId);
  return ids;
}

// Whether an auction matches the auction-type control. 'non-augmented' is the
// complement of 'augmented' (augmented !== true), so the two partition every
// auction — the 92 pre-augment-era auctions (augmented === null) read as
// non-augmented, since the mechanic didn't exist and nothing was augmented.
export function auctionTypeMatches(
  m: AuctionMeta, type: AuctionTypeFilter, goldenTicketIds: Set<string>,
): boolean {
  switch (type) {
    case 'augmented': return m.augmented === true;
    case 'non-augmented': return m.augmented !== true;
    case 'golden-ticket': return goldenTicketIds.has(m.auctionId);
    default: return true; // 'all'
  }
}

// Whether an auction passes the source + auction-type controls together — the
// auction-level half of the shared filter, shared by the sale-feed helper below
// and the explorer (which filters its meta list directly).
export function passesAuctionFilters(
  m: AuctionMeta, f: ViewFilter, goldenTicketIds: Set<string>,
): boolean {
  if (f.source !== 'all' && m.source !== f.source) return false;
  return auctionTypeMatches(m, f.auctionType, goldenTicketIds);
}

// Apply the shared view filter to a raw sale feed: drop sales whose auction fails
// the source / auction-type controls, and rescale Trent prices by the reward rate
// when "Reward-adjusted" is chosen. This is the single funnel every pricing page
// runs its sales through, so Source/Trent-pricing/Auction-type behave identically
// on Prices, Onyx, Timelines and Compare. Defaults (All sources, Nominal, All
// types) return the feed untouched, so each page reads exactly as it did before.
export function applyViewFilters(
  sales: Sale[], metaById: Map<string, AuctionMeta>,
  goldenTicketIds: Set<string>, f: ViewFilter,
): Sale[] {
  const rewardMultiplier = 1 - ERAS.trentRewardRate;
  const out: Sale[] = [];
  for (const s of sales) {
    const m = metaById.get(s.auctionId);
    if (!m || !passesAuctionFilters(m, f, goldenTicketIds)) continue;
    out.push(f.trentPricing === 'reward-adjusted' && m.source === 'Trent'
      ? { ...s, price: s.price * rewardMultiplier }
      : s);
  }
  return out;
}
