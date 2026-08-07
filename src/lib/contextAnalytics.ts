// The four context-layer analytics (docs/context-layer-design.md §6). Each is a
// pure function over the parsed data (AuctionMeta / Sale / ContextItem / the
// per-auction AuctionContext rollup); the ContextAnalytics component renders
// them. They answer the prompt's four questions:
//
//   1. Auction Ledger        — did augments cover what was withheld?
//   2. Grunnel vs preorder   — how did Grunnel drops compare to the preorder benchmark?
//   3. Augmented vs not      — does added supply move per-token prices, within a season?
//   4. Trent vs Forum        — source price levels, on overlapping seasons only.
//
// Views 3 and 4 control for token mix by comparing the SAME token across the two
// groups rather than raw group means, and view 4 restricts to seasons both
// sources ran (the §5.5 confound: source is confounded with time otherwise).

import type { AuctionMeta, Sale } from './data';
import type { ContextItem, AuctionContext } from './context';
import { auctioneerKey, auctioneerLabels } from './analytics';
import { ERAS } from './eras';

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// push into a Map<K, V[]> bucket, creating the array on first use.
function bucket<K>(map: Map<K, number[]>, key: K, value: number): void {
  const arr = map.get(key);
  if (arr) arr.push(value); else map.set(key, [value]);
}

// --- View 1: Auction Ledger ------------------------------------------------
// Per auction: what the auctioneer withheld (negative) against what they put
// back — released payment, personal augments — and the funding-target reduction
// (an auctioneer who lowered the $8k goal "covered" differently). Grunnel is
// shown but NOT counted toward "covered": it is a company drop, not the
// auctioneer offsetting their own withholding (design §6.1).

export type LedgerRow = {
  auctionId: string;
  season: string;
  auctionNumber: number;
  name: string;
  auctioneer: string;
  source: string;
  withheld: number;   // estimate, ≤ 0
  released: number;
  augment: number;
  grunnel: number;
  // The auction's funding target (auctionMetadata column O, targetFunding). Shown
  // as context — what the auctioneer asked bidders for — not a term in the balance.
  // null when the auction recorded no target.
  fundingGoal: number | null;
  // released + augment + withheld. ≥ 0 ⇒ what the auctioneer put back (bonus-
  // included items + personal augments) at least matched what they withheld.
  // Grunnel is excluded (a company drop, not the auctioneer's own offset), and the
  // funding goal is context, not part of this sum.
  balance: number;
  covered: boolean;
};

function balanceOf(released: number, augment: number, withheld: number): number {
  // withheld is ≤ 0, so adding it subtracts the withheld magnitude.
  return released + augment + withheld;
}

export function auctionLedger(
  meta: AuctionMeta[], ctx: Map<string, AuctionContext>,
): LedgerRow[] {
  const byId = new Map(meta.map((m) => [m.auctionId, m]));
  const labels = auctioneerLabels(meta);
  const rows: LedgerRow[] = [];
  for (const [id, c] of ctx) {
    const m = byId.get(id);
    if (!m) continue;
    const balance = balanceOf(c.released, c.augment, c.withheld);
    rows.push({
      auctionId: id,
      season: m.season,
      auctionNumber: m.auctionNumber,
      name: m.name,
      auctioneer: labels.get(auctioneerKey(m.auctioneer)) ?? m.auctioneer,
      source: m.source,
      withheld: c.withheld,
      released: c.released,
      augment: c.augment,
      grunnel: c.grunnel,
      fundingGoal: m.targetFunding,
      balance,
      // A rounding guard so a $0.00 net reads as covered rather than a penny short.
      covered: balance >= -0.005,
    });
  }
  return rows.sort((a, b) =>
    Number(b.season) - Number(a.season) || b.auctionNumber - a.auctionNumber);
}

export type LedgerAgg = {
  key: string;        // grouping key (auctioneer label, or 'Overall')
  n: number;          // auctions in the group
  withheld: number;
  released: number;
  augment: number;
  grunnel: number;
  balance: number;
  covered: boolean;
};

function aggregate(key: string, rows: LedgerRow[]): LedgerAgg {
  const sum = (f: (r: LedgerRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const withheld = sum((r) => r.withheld);
  const released = sum((r) => r.released);
  const augment = sum((r) => r.augment);
  const grunnel = sum((r) => r.grunnel);
  const balance = balanceOf(released, augment, withheld);
  return { key, n: rows.length, withheld, released, augment, grunnel, balance, covered: balance >= -0.005 };
}

// One aggregate per auctioneer, most-withheld first (largest |withheld|).
export function ledgerByAuctioneer(rows: LedgerRow[]): LedgerAgg[] {
  const byWho = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    const arr = byWho.get(r.auctioneer);
    if (arr) arr.push(r); else byWho.set(r.auctioneer, [r]);
  }
  return [...byWho.entries()]
    .map(([who, rs]) => aggregate(who, rs))
    .sort((a, b) => a.withheld - b.withheld || (a.key < b.key ? -1 : 1));
}

export const ledgerOverall = (rows: LedgerRow[]): LedgerAgg => aggregate('Overall', rows);

// --- View 2: Grunnel per auction vs the preorder benchmark -----------------
// Grunnel drops offset expired preorder bonuses, so the question is whether a
// drop was worth more than the preorder bonuses a standard order includes. What a
// drop is worth varies wildly auction to auction, so this is PER AUCTION, not a
// season average. The preorder side IS a season average (a standard order's fixed
// bundle: mean season price × quantity), which is stable because it's dominated by
// the Treasure Chip, whose price holds to ~10–15% within a season.

// The value of the preorder bonuses in a standard order, per season: for each
// preorder token, its mean sale price that season × the fixed quantity a standard
// order includes (ERAS.preorderQuantities). Keyed on the sale Item CODE.
export function preorderBenchmarkBySeason(sales: Sale[]): Map<string, number> {
  const pricesByItemSeason = new Map<string, number[]>();
  for (const s of sales) {
    if (s.category !== 'Preorder') continue;
    if (!(s.item in ERAS.preorderQuantities)) continue;
    bucket(pricesByItemSeason, `${s.season}|${s.item}`, s.price);
  }
  const bySeason = new Map<string, number>();
  for (const [key, prices] of pricesByItemSeason) {
    const [season, item] = key.split('|');
    const m = mean(prices);
    if (m == null) continue;
    bySeason.set(season, (bySeason.get(season) ?? 0) + m * ERAS.preorderQuantities[item]);
  }
  return bySeason;
}

export type GrunnelAuctionRow = {
  auctionId: string;
  season: string;
  auctionNumber: number;
  name: string;
  grunnelValue: number;      // total value of this auction's Grunnel items
  items: number;             // how many Grunnel items it dropped
  preorderBenchmark: number | null; // the season's standard-order preorder value
  delta: number | null;      // grunnelValue − benchmark (>0 ⇒ subsidised beyond preorder)
};

// One row per auction that received a Grunnel drop, most recent first. Each
// carries its own total Grunnel value against its season's preorder benchmark.
export function grunnelPerAuction(
  items: ContextItem[], sales: Sale[], meta: AuctionMeta[],
): GrunnelAuctionRow[] {
  const byId = new Map(meta.map((m) => [m.auctionId, m]));
  const benchmark = preorderBenchmarkBySeason(sales);
  const totals = new Map<string, { value: number; n: number }>();
  for (const it of items) {
    if (it.provenance !== 'grunnel') continue;
    const t = totals.get(it.auctionId) ?? { value: 0, n: 0 };
    t.value += it.value;
    t.n += 1;
    totals.set(it.auctionId, t);
  }
  const rows: GrunnelAuctionRow[] = [];
  for (const [id, t] of totals) {
    const m = byId.get(id);
    if (!m) continue;
    const preorderBenchmark = benchmark.get(m.season) ?? null;
    rows.push({
      auctionId: id,
      season: m.season,
      auctionNumber: m.auctionNumber,
      name: m.name,
      grunnelValue: t.value,
      items: t.n,
      preorderBenchmark,
      delta: preorderBenchmark == null ? null : t.value - preorderBenchmark,
    });
  }
  return rows.sort((a, b) =>
    Number(b.season) - Number(a.season) || b.auctionNumber - a.auctionNumber);
}

// --- View 3: Augmented vs non-augmented, within one season -----------------
// For a chosen season, compare each token's average price in AUGMENTED auctions
// against its average in NON-augmented ones. Only tokens sold in BOTH appear, so
// the comparison holds the token constant (a raw group mean would just reflect
// which tokens each group happened to contain). augmented === true is augmented;
// false OR null (pre-augment era) is non-augmented.

export type TokenSplit = {
  item: string;
  displayName: string;
  category: string;
  augAvg: number;
  nonAugAvg: number;
  delta: number;      // augAvg − nonAugAvg
  pct: number | null; // delta / nonAugAvg
};

export type AugSplitResult = {
  season: string;
  augAuctions: number;
  nonAugAuctions: number;
  rows: TokenSplit[];
};

export function augmentedVsNot(
  sales: Sale[], meta: AuctionMeta[], season: string,
): AugSplitResult {
  const augById = new Map(meta.map((m) => [m.auctionId, m.augmented]));
  const isAug = (id: string) => augById.get(id) === true;

  const aug = new Map<string, number[]>();
  const non = new Map<string, number[]>();
  const names = new Map<string, { displayName: string; category: string }>();
  const augAuctions = new Set<string>();
  const nonAuctions = new Set<string>();

  for (const s of sales) {
    if (s.season !== season) continue;
    (isAug(s.auctionId) ? augAuctions : nonAuctions).add(s.auctionId);
    bucket(isAug(s.auctionId) ? aug : non, s.item, s.price);
    if (!names.has(s.item)) names.set(s.item, { displayName: s.displayName, category: s.category });
  }

  const rows: TokenSplit[] = [];
  for (const [item, augPrices] of aug) {
    const nonPrices = non.get(item);
    if (!nonPrices || !nonPrices.length) continue; // needs both sides
    const augAvg = mean(augPrices)!;
    const nonAugAvg = mean(nonPrices)!;
    const delta = augAvg - nonAugAvg;
    rows.push({
      item,
      displayName: names.get(item)?.displayName ?? item,
      category: names.get(item)?.category ?? '',
      augAvg,
      nonAugAvg,
      delta,
      pct: nonAugAvg !== 0 ? delta / nonAugAvg : null,
    });
  }
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    season,
    augAuctions: augAuctions.size,
    nonAugAuctions: nonAuctions.size,
    rows,
  };
}

// --- View 4: Trent vs Forum, per season, per token -------------------------
// One season at a time, matched per token: for each token sold under BOTH
// sources that season we take each source's average price. Matching per token
// within a season holds both token mix and time constant, so the remaining
// difference is the source's own price level (§5.5). Trent is shown nominal or
// reward-adjusted (−10%, the ~100 pt/$1 reward that lowers a Trent buyer's
// effective cost) via a toggle in the view; the adjustment is applied there so
// this stays a plain average.

export type SourceTokenRow = {
  item: string;
  displayName: string;
  category: string;
  trentAvg: number;
  forumAvg: number;
};

// Seasons with at least one token sold under BOTH sources, newest first. These
// are the only seasons with a within-token comparison to draw (Trent runs from
// season 2023 on, so earlier seasons never overlap).
export function sourceOverlapSeasons(sales: Sale[], meta: AuctionMeta[]): string[] {
  const srcById = new Map(meta.map((m) => [m.auctionId, m.source]));
  // season -> item -> which sources it sold under
  const bySeason = new Map<string, Map<string, { f: boolean; t: boolean }>>();
  for (const s of sales) {
    const src = srcById.get(s.auctionId);
    if (src !== 'Forum' && src !== 'Trent') continue;
    let items = bySeason.get(s.season);
    if (!items) { items = new Map(); bySeason.set(s.season, items); }
    let e = items.get(s.item);
    if (!e) { e = { f: false, t: false }; items.set(s.item, e); }
    if (src === 'Forum') e.f = true; else e.t = true;
  }
  const out: string[] = [];
  for (const [season, items] of bySeason) {
    if ([...items.values()].some((e) => e.f && e.t)) out.push(season);
  }
  return out.sort((a, b) => Number(b) - Number(a));
}

// Per-token Trent vs Forum averages for one season — tokens sold under both
// sources only. Sorted by display name. Trent is left nominal (the view applies
// the reward adjustment) so the caller controls that toggle.
export function trentVsForumSeason(
  sales: Sale[], meta: AuctionMeta[], season: string,
): SourceTokenRow[] {
  const srcById = new Map(meta.map((m) => [m.auctionId, m.source]));
  const byItem = new Map<string, { f: number[]; t: number[]; displayName: string; category: string }>();
  for (const s of sales) {
    if (s.season !== season) continue;
    const src = srcById.get(s.auctionId);
    if (src !== 'Forum' && src !== 'Trent') continue;
    let e = byItem.get(s.item);
    if (!e) { e = { f: [], t: [], displayName: s.displayName, category: s.category }; byItem.set(s.item, e); }
    (src === 'Forum' ? e.f : e.t).push(s.price);
  }
  const rows: SourceTokenRow[] = [];
  for (const [item, e] of byItem) {
    if (!e.f.length || !e.t.length) continue; // needs both sources
    rows.push({
      item, displayName: e.displayName, category: e.category,
      trentAvg: mean(e.t)!, forumAvg: mean(e.f)!,
    });
  }
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}
