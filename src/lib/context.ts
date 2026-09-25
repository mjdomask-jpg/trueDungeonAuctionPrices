// Auction context layer: item provenance + the withheld estimate recompute.
//
// This module turns the raw contextItems.csv rows (auctioneer-withheld items,
// personal-collection augments, Grunnel drops) into classified, valued
// ContextItems, and rolls them up per auction. It reads only REAL SALES — the
// price spine (prices.csv) plus the Onyx chase sales (onyx.csv) — to estimate
// withheld values, so the estimate can never feed on itself
// (docs/data-audit.md §6, "no circularity").
//
// Onyx was added to that feed because an auctioneer can withhold part of an Onyx
// order, and those names appear in no other file. The two files share NOT ONE
// display name (measured: zero collisions on name, and zero on season+name), so
// folding them together cannot change an estimate that was already being made.
//
// Full design: docs/context-layer-design.md. Withheld method: data-audit.md §6.1.

import {
  parseCSV, dateKey, cleanName, AUCTION_SOURCES, ORDER_VARIANTS,
  type Sale, type AuctionMeta, type AuctionSource, type OrderVariant,
} from './data';
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
  n?: number; // withheld: number of same-season sales the estimate averaged
  // withheld: true when the estimate had to read FORWARD — no comparable sale
  // existed before this auction closed, so it averaged later ones instead. See
  // valueWithheld. Surfaced in the UI, because an estimate that reads the future
  // should say so.
  forward?: boolean;
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
// to keep), so both classify as released-payment (design §2). Exported so the
// Auction Data cards can badge these rows and drop the context-sheet duplicate.
export function isReleasedPayment(name: string): boolean {
  return isRandomUltraRare(name) || isGoldenTicket(name);
}

// The ticket itself, never a CHANCE at one. `Golden Ticket Chance` (three
// recorded context rows, one spelled `Chance at Golden Ticket` until
// 2026-09-24) is a different thing
// — a raffle entry the auctioneer sold, not the auctioneer's own fee released —
// so they classify as augments, which is where they have always landed.
export function isGoldenTicket(name: string): boolean {
  return (name ?? '').trim().toLowerCase() === 'golden ticket';
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

// Average an item's sales from at most the ERAS.withheldLookbackAuctions
// auctions NEAREST IN TIME, in the given direction. Auctions are ranked by close
// instant, with the id as a stable tiebreak for same-day closes (that tiebreak
// is lexicographic and is an open question — backlog SITE-12); all of an item's
// lots within a kept auction count.
function nearestMean(
  sales: SaleRef[], dir: 'back' | 'forward',
): { mean: number; n: number } {
  const instByAuction = new Map<string, number>();
  for (const s of sales) instByAuction.set(s.auctionId, s.inst);
  const ranked = [...instByAuction.entries()].sort((a, b) => (dir === 'back'
    ? b[1] - a[1] || (a[0] < b[0] ? 1 : -1)
    : a[1] - b[1] || (a[0] < b[0] ? -1 : 1)));
  const keep = new Set(ranked.slice(0, ERAS.withheldLookbackAuctions).map(([id]) => id));
  const window = sales.filter((s) => keep.has(s.auctionId));
  return { mean: window.reduce((a, s) => a + s.price, 0) / window.length, n: window.length };
}

// The point-in-time estimate for one withheld item: mean of that display name's
// same-season sales from at most the ERAS.withheldLookbackAuctions most RECENT
// auctions (by close date) that CLOSED strictly before this one, negated,
// × quantity. Capping the lookback keeps the estimate near the item's value at the
// time it was withheld rather than averaging in stale early-season sales.
//
// WHEN NOTHING SOLD BEFORE, IT READS FORWARD — and only then. `20275` withheld
// eight Onyx chase tokens and was the season's FIRST Onyx auction to close, so
// by definition no comparable sale existed yet; the only 2027 auction carrying
// those names closed the following day. The old rule fell back to the sheet's
// reference, which is blank on those rows, so the whole withheld block valued at
// $0 and the ledger read as if nothing had been withheld. Silently.
//
// Restricting the fallback to `n === 0` is what makes this safe to ship: every
// estimate that had a prior sale is byte-identical to before. It is same-season
// only, because a chase token is year-specific — a prior season's price for it
// is not a worse estimate, it is a different token.
//
// n === 0 in BOTH directions still falls back to the sheet's reference so
// nothing silently zeroes out; validate-prices §6 now names those rows, since
// that is the case no one can see from the site.
export function valueWithheld(
  item: RawContextItem, idx: PriceIndex,
): { value: number; n: number; forward: boolean } {
  const season = idx.seasonById.get(item.auctionId);
  const wInst = idx.instantById.get(item.auctionId);
  const sameSeason = (idx.salesByName.get(item.name) ?? []).filter(
    (s) => s.season === season && wInst != null,
  );
  const prior = sameSeason.filter((s) => s.inst < wInst!);
  if (prior.length) {
    const { mean, n } = nearestMean(prior, 'back');
    return { value: -mean * item.quantity, n, forward: false };
  }
  const later = sameSeason.filter((s) => s.inst > wInst!);
  if (later.length) {
    const { mean, n } = nearestMean(later, 'forward');
    return { value: -mean * item.quantity, n, forward: true };
  }
  return { value: item.refValue ?? 0, n: 0, forward: false };
}

// --- Build (the module's public entry point) -------------------------------

// Classify and value every context item. Withheld rows are recomputed from live
// sales; all others take their real sheet value. Pure over its inputs.
//
// CLOSED AUCTIONS ONLY. Items from Failed auctions are dropped: a failed auction
// never completed, so nothing was actually withheld or augmented, and the funding
// analytics are per completed auction. This matches the explorer, which already
// lists only Closed auctions (data.ts exploreAuctions). It also sidesteps a data
// artifact — 202518, the one Failed auction carrying context rows, has no close
// date, so it couldn't be ordered for the point-in-time estimate anyway.
//
// 202518's rows are worth keeping in mind rather than in the data: they are a
// withheld list for an auction that then failed to fund, which is a real thing
// to have and a meaningless thing to average. Dropping them here is what lets
// them be restored to the CSVs safely (backlog DATA-6).
export function buildContextItems(
  raw: RawContextItem[], sales: Sale[], meta: AuctionMeta[],
): ContextItem[] {
  const idx = buildPriceIndex(sales, meta);
  const closed = new Set(meta.filter((m) => m.status === 'Closed').map((m) => m.auctionId));
  return raw.filter((r) => closed.has(r.auctionId)).map((r) => {
    const provenance = classifyProvenance(r.category, r.name);
    if (provenance === 'withheld') {
      const { value, n, forward } = valueWithheld(r, idx);
      return { ...r, provenance, value, estimate: true, n, forward };
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
//
// `released` reads BOTH FEEDS, because which file recorded a released payment is
// a recording decision and not a fact about the auction. A Golden Ticket is the
// auctioneer's fee; selling it releases it to bidders, and the Auction Data
// cards have badged those sale rows as released since this layer shipped — but
// until now only a GT that reached contextItems counted toward the ledger's
// "Included", so twelve auctions that sold theirs read $0.
//
// ONLY THE GOLDEN TICKET IS READ OFF THE PRICE SPINE, and the reason is
// quantity. A context row carries `quantity` and the lot-group TOTAL ($376.00
// for nine Random Ultra Rares); a price row is per-token by construction
// ($41.78) and prices.csv has no quantity column at all. Summing price rows for
// a Random Ultra Rare would report an eighth of the money — $1,332 across the
// corpus against the $10,514 actually released — so a Random Ultra Rare's
// released value comes from its context row and from nowhere else, whether or
// not the price spine also carries it for the Prices tab to show. A Golden
// Ticket is one token in one row, so its price IS the whole amount and either
// feed says the same thing; where both do, the context row wins and it counts
// once.
export function rollupByAuction(
  items: ContextItem[], sales: Sale[] = [],
): Map<string, AuctionContext> {
  const byAuction = new Map<string, AuctionContext>();
  const open = (auctionId: string): AuctionContext => {
    const found = byAuction.get(auctionId);
    if (found) return found;
    const made = emptyRollup(auctionId);
    byAuction.set(auctionId, made);
    return made;
  };
  // Auctions whose context rows already account for the Golden Ticket.
  const claimed = new Set<string>();
  for (const it of items) {
    const a = open(it.auctionId);
    if (it.provenance === 'released-payment') {
      a.released += it.value;
      if (isGoldenTicket(it.name)) claimed.add(it.auctionId);
    } else if (it.provenance === 'augment') a.augment += it.value;
    else if (it.provenance === 'grunnel') a.grunnel += it.value;
    else if (it.provenance === 'withheld') a.withheld += it.value;
    a.augmentedTotal = a.released + a.augment + a.grunnel + a.withheld;
  }
  for (const s of sales) {
    if (!isGoldenTicket(s.displayName) && !isGoldenTicket(s.item)) continue;
    if (claimed.has(s.auctionId)) continue;
    // An auction whose only context is a released sale still belongs in the
    // ledger: "released their Golden Ticket, withheld nothing" is an answer.
    const a = open(s.auctionId);
    a.released += s.price;
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

export type SourceFilter = 'all' | AuctionSource;
export type TrentPricing = 'nominal' | 'reward-adjusted';
export type AuctionTypeFilter = 'all' | 'augmented' | 'non-augmented' | 'golden-ticket';
// Which of the two $8k orders an auction sold. Named `Order` rather than
// "auction style" (the sheet's column) or "order type": `Auction type` is
// already a control two rows up in the same bar, and it is the ORDER that
// differs here, not the auction.
export type OrderFilter = 'all' | OrderVariant;

// The subset of filter state that selects/rescales sales. The FilterBar's
// provenance chips act on the context-item list, not the core sales, so they are
// deliberately not part of this shape.
export type ViewFilter = {
  source: SourceFilter;
  trentPricing: TrentPricing;
  auctionType: AuctionTypeFilter;
  order: OrderFilter;
};

// Which venues ran auctions in each season, so the Source control can offer
// exactly the sources a page can actually show. Derived per auction (see
// deriveSource), never from a calendar cutoff — the same rule as seasonsWithTrent
// below, and for the same reason: a venue's first auction can close in the
// calendar year before its season.
//
// The Source control appears only where a season holds MORE THAN ONE of these.
// That is what has always been meant by "hide it before 2023" — every season up
// to 2022 is Forum-only, so the dropdown could only ever filter to what was
// already on screen. Stating it as "more than one source" rather than "has Trent"
// is what lets 2027 offer three without a second rule.
export function sourcesBySeason(meta: AuctionMeta[]): Map<string, Set<AuctionSource>> {
  const out = new Map<string, Set<AuctionSource>>();
  for (const m of meta) {
    let s = out.get(m.season);
    if (!s) { s = new Set(); out.set(m.season, s); }
    s.add(m.source);
  }
  return out;
}

// The sources on offer across a set of seasons, in AUCTION_SOURCES order.
// `seasons` undefined means "not season-scoped" — ask the whole dataset.
export function sourcesInSeasons(
  bySeason: Map<string, Set<AuctionSource>>, seasons?: string[],
): AuctionSource[] {
  const present = new Set<AuctionSource>();
  const scope = seasons ? seasons.map((s) => bySeason.get(s)) : [...bySeason.values()];
  for (const set of scope) if (set) for (const src of set) present.add(src);
  return AUCTION_SOURCES.filter((s) => present.has(s));
}

// Which $8k orders each season sold, so the Order control can offer exactly the
// ones a page can show. Same shape and same rule as sourcesBySeason above, and
// for the same reason: the control appears only where a season holds MORE THAN
// ONE, which is what "only show it where Trade 2 auctions exist" means once it
// is stated as a property of the data rather than as a year.
//
// Stating it that way is what makes it self-retiring. Season 2027 is the first
// to offer a choice and the company has said the second order is 2027-only, so
// when it stops being offered the control disappears on its own — no date
// cutoff to remember to remove, and no risk of a 2028 that quietly keeps it.
export function orderVariantsBySeason(meta: AuctionMeta[]): Map<string, Set<OrderVariant>> {
  const out = new Map<string, Set<OrderVariant>>();
  for (const m of meta) {
    let s = out.get(m.season);
    if (!s) { s = new Set(); out.set(m.season, s); }
    s.add(m.orderVariant);
  }
  return out;
}

// The order variants on offer across a set of seasons, in ORDER_VARIANTS order.
// `seasons` undefined means "not season-scoped" — ask the whole dataset.
export function orderVariantsInSeasons(
  bySeason: Map<string, Set<OrderVariant>>, seasons?: string[],
): OrderVariant[] {
  const present = new Set<OrderVariant>();
  const scope = seasons ? seasons.map((s) => bySeason.get(s)) : [...bySeason.values()];
  for (const set of scope) if (set) for (const v of set) present.add(v);
  return ORDER_VARIANTS.filter((v) => present.has(v));
}

// Seasons that actually contain a Trent auction — what the Trent-pricing control
// needs to exist before it means anything. Two gates, both deliberate:
//  - the ERAS.trentStartSeason floor is the HARD RULE. Trent ran no auctions
//    before 2023, so those seasons can never offer the controls, whatever a
//    stray row in the export might say.
//  - the per-season membership is the honest one. A season inside the Trent era
//    could still turn out Forum-only, and the controls should follow the data
//    rather than the calendar.
// Read per auction via the derived `source` (deriveSource), never from a date.
export function seasonsWithTrent(meta: AuctionMeta[]): Set<string> {
  const out = new Set<string>();
  for (const m of meta) {
    if (m.source !== 'Trent') continue;
    if (Number(m.season) < ERAS.trentStartSeason) continue;
    out.add(m.season);
  }
  return out;
}

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

// Whether an auction passes the source + order + auction-type controls together
// — the auction-level half of the shared filter, shared by the sale-feed helper
// below and the explorer (which filters its meta list directly). Every control
// that selects AUCTIONS belongs here and nowhere else: that is what keeps the
// Prices/Timelines/Compare feeds and the Explorer's auction list agreeing about
// which auctions are in view.
export function passesAuctionFilters(
  m: AuctionMeta, f: ViewFilter, goldenTicketIds: Set<string>,
): boolean {
  if (f.source !== 'all' && m.source !== f.source) return false;
  if (f.order !== 'all' && m.orderVariant !== f.order) return false;
  return auctionTypeMatches(m, f.auctionType, goldenTicketIds);
}

// Apply the shared view filter to a raw sale feed: drop sales whose auction fails
// the source / order / auction-type controls, and rescale Trent prices by the
// reward rate when "Reward-adjusted" is chosen. This is the single funnel every
// pricing page runs its sales through, so Source/Order/Trent-pricing/Auction-type
// behave identically on Prices, Onyx, Timelines and Compare. Defaults (All
// sources, All orders, Nominal, All types) return the feed untouched, so each
// page reads exactly as it did before.
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
