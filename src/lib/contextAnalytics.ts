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
  augMean: number | null;    // mean of matched tokens' augAvg
  nonAugMean: number | null; // mean of matched tokens' nonAugAvg
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
    augMean: mean(rows.map((r) => r.augAvg)),
    nonAugMean: mean(rows.map((r) => r.nonAugAvg)),
  };
}

// --- View 4: Trent vs Forum, overlapping seasons only ----------------------
// Restricted to seasons BOTH sources ran, and matched per token within a season,
// so neither time nor token mix confounds the source comparison (§5.5). For each
// matched (season, token) we take each source's average, then average those
// per-token means up to the season. Trent is shown nominal and reward-adjusted
// (−10%, the ~100pt/$1 reward), since a Trent buyer's effective cost is lower.

export type SourceCompareRow = {
  season: string;
  n: number;          // matched tokens
  forumMean: number;
  trentMean: number;
  trentAdjMean: number;
};

export function trentVsForum(sales: Sale[], meta: AuctionMeta[]): SourceCompareRow[] {
  const srcById = new Map(meta.map((m) => [m.auctionId, m.source]));
  // season -> item -> { forum prices, trent prices }
  const bySeason = new Map<string, Map<string, { f: number[]; t: number[] }>>();
  for (const s of sales) {
    const src = srcById.get(s.auctionId);
    if (src !== 'Forum' && src !== 'Trent') continue;
    let items = bySeason.get(s.season);
    if (!items) { items = new Map(); bySeason.set(s.season, items); }
    let e = items.get(s.item);
    if (!e) { e = { f: [], t: [] }; items.set(s.item, e); }
    (src === 'Forum' ? e.f : e.t).push(s.price);
  }

  const adj = 1 - ERAS.trentRewardRate;
  const rows: SourceCompareRow[] = [];
  for (const [season, items] of bySeason) {
    const forumAvgs: number[] = [];
    const trentAvgs: number[] = [];
    for (const { f, t } of items.values()) {
      if (!f.length || !t.length) continue; // token must have sold under both
      forumAvgs.push(mean(f)!);
      trentAvgs.push(mean(t)!);
    }
    if (!forumAvgs.length) continue; // no overlap this season → drop it
    const trentMean = mean(trentAvgs)!;
    rows.push({
      season,
      n: forumAvgs.length,
      forumMean: mean(forumAvgs)!,
      trentMean,
      trentAdjMean: trentMean * adj,
    });
  }
  return rows.sort((a, b) => Number(a.season) - Number(b.season));
}
