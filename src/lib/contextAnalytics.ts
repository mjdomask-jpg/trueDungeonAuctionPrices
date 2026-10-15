// The context-layer analytics (docs/context-layer-design.md §6). Each is a
// pure function over the parsed data (AuctionMeta / Sale / ContextItem / the
// per-auction AuctionContext rollup); the ContextAnalytics component renders
// them. They answer the prompt's four questions, plus one the data only became
// able to answer in season 2027:
//
//   1. Auction Ledger        — did augments cover what was withheld?
//   2. Grunnel vs preorder   — how did Grunnel drops compare to the preorder benchmark?
//   3. Augmented vs not      — does added supply move per-token prices, within a season?
//   4. Venue comparison      — venue price levels, on overlapping seasons only.
//   5. Standard vs Trade 2   — does the order a lot came from move its price?
//
// Views 3, 4 and 5 control for token mix by comparing the SAME token across the
// two groups rather than raw group means, and each restricts itself to the
// seasons where both sides exist (the §5.5 confound: a split is confounded with
// time otherwise).

import { AUCTION_SOURCES, type AuctionMeta, type AuctionSource, type OrderVariant, type Sale } from './data';
import { isGoldenTicket, isRandomUltraRare, type ContextItem, type AuctionContext } from './context';
import { auctioneerKey, auctioneerLabels } from './analytics';
import { ERAS, inGoldenTicketEra, trentRewardRate } from './eras';

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// push into a Map<K, V[]> bucket, creating the array on first use.
function bucket<K>(map: Map<K, number[]>, key: K, value: number): void {
  const arr = map.get(key);
  if (arr) arr.push(value); else map.set(key, [value]);
}

// --- View 1: Auction Ledger ------------------------------------------------
// Per auction: what the auctioneer withheld (negative) against what they put
// back — released payment, personal augments — and how far their funding goal
// sat from the customary one. Grunnel is shown but NOT counted toward "covered":
// it is a company drop, not the auctioneer offsetting their own withholding
// (design §6.1).
//
// THE GOAL AND THE FEE ARE TWO HALVES OF ONE TRADE, which is why the goal is a
// term here and not context. The custom is: the auctioneer keeps the fee (the
// Random Ultra Rares and the Golden Ticket) and sets the goal at $7,500, paying
// the last $500 of the order themselves. An auctioneer who releases the fee
// raises the goal to $8,000 instead — every one of the 16 auctions that sold
// their Golden Ticket did — so the bidders' extra $500 is what pays for it.
// Crediting the released fee without debiting that $500 credited those
// auctioneers twice, and ignoring a goal set BELOW the custom hid a cash
// contribution entirely (20275, $6,750). Measured 2026-09-24, design §6.1.
//
// The baseline is the customary $7,500, not the $8,000 the order costs. $8,000
// would credit every ordinary auction $500 for the discount that bought the fee
// it kept — coherent only if the kept fee is debited at the same time. That is
// the second lens, fullOrderLedger below (backlog SITE-13).

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
  // The auction's funding target (auctionMetadata column O, targetFunding).
  // null when the auction recorded no target.
  fundingGoal: number | null;
  // The customary goal minus this auction's: +$350 for a $7,150 goal (the
  // auctioneer paid $350 more of the order than custom asks), −$500 for $8,000.
  // null when there is nothing to measure — no recorded goal, or a goal above
  // the order cost, which only a pooled multi-order auction has (20251) and
  // which says nothing about one order's custom. null counts as $0.
  goalOffset: number | null;
  // released + augment + withheld + goalOffset. ≥ 0 ⇒ the auctioneer put back
  // at least as much as custom asks of them. Grunnel is excluded (a company
  // drop, not the auctioneer's own offset).
  //
  // The view can add Grunnel back on request — see ledgerBalanceOf, which is
  // where a row's DISPLAYED balance comes from. These two fields are the
  // Grunnel-excluded answer and stay that way, so nothing downstream has to know
  // about the toggle.
  balance: number;
  covered: boolean;
};

export function goalOffsetOf(targetFunding: number | null): number | null {
  if (targetFunding == null) return null;
  if (targetFunding > ERAS.orderCost) return null;
  return ERAS.defaultTargetFunding - targetFunding;
}

function balanceOf(
  released: number, augment: number, withheld: number, goalOffset: number | null,
): number {
  // withheld is ≤ 0, so adding it subtracts the withheld magnitude.
  return released + augment + withheld + (goalOffset ?? 0);
}

// A rounding guard so a $0.00 net reads as covered rather than a penny short.
export const isCovered = (balance: number): boolean => balance >= -0.005;

// The balance a reader sees, given the "Include Grunnel" choice.
//
// THE DEFAULT — Grunnel excluded — IS THE ONE THAT ANSWERS THE QUESTION PEOPLE
// ASK, which is "would this auction have worked without help from the company?".
// Grunnel is a company employee's drop, not the auctioneer offsetting their own
// withholding, so counting it would credit the auctioneer with someone else's
// money (design §6.1). That has always been the rule here; the toggle exists
// because the rule was invisible, not because it was wrong.
//
// Checking the box adds the drop back, which answers the other question — what
// the auction's books looked like in total, whoever paid.
export function ledgerBalanceOf(
  r: { released: number; augment: number; grunnel: number; withheld: number; goalOffset: number | null },
  includeGrunnel: boolean,
): number {
  return balanceOf(r.released, r.augment, r.withheld, r.goalOffset) + (includeGrunnel ? r.grunnel : 0);
}

// One row per auction with context, PLUS every closed auction whose goal alone
// moves its balance. An auction with no context rows and a $7,150 goal is a
// contribution the ledger could not see while it listed only the auctions with
// context. Closed only: an open auction's augments are recorded at close, so a
// live one would read Short on its goal before anything else is counted.
export function auctionLedger(
  meta: AuctionMeta[], ctx: Map<string, AuctionContext>,
): LedgerRow[] {
  const labels = auctioneerLabels(meta);
  const rows: LedgerRow[] = [];
  for (const m of meta) {
    const c = ctx.get(m.auctionId);
    if (!c && !(m.status === 'Closed' && goalOffsetOf(m.targetFunding))) continue;
    rows.push(ledgerRowOf(m, c, labels));
  }
  return rows.sort(newestFirst);
}

const NO_CONTEXT = { released: 0, augment: 0, grunnel: 0, withheld: 0 };

const newestFirst = (a: LedgerRow, b: LedgerRow) =>
  Number(b.season) - Number(a.season) || b.auctionNumber - a.auctionNumber;

function ledgerRowOf(
  m: AuctionMeta, c: AuctionContext | undefined, labels: Map<string, string>,
): LedgerRow {
  const goalOffset = goalOffsetOf(m.targetFunding);
  const { released, augment, grunnel, withheld } = c ?? NO_CONTEXT;
  const balance = balanceOf(released, augment, withheld, goalOffset);
  return {
    auctionId: m.auctionId,
    season: m.season,
    auctionNumber: m.auctionNumber,
    name: m.name,
    auctioneer: labels.get(auctioneerKey(m.auctioneer)) ?? m.auctioneer,
    source: m.source,
    withheld,
    released,
    augment,
    grunnel,
    fundingGoal: m.targetFunding,
    goalOffset,
    balance,
    covered: isCovered(balance),
  };
}

export type LedgerAgg = {
  key: string;        // grouping key (auctioneer label, or 'Overall')
  n: number;          // auctions in the group
  withheld: number;
  released: number;
  augment: number;
  grunnel: number;
  goalOffset: number;
  balance: number;
  covered: boolean;
};

function aggregate(key: string, rows: LedgerRow[]): LedgerAgg {
  const sum = (f: (r: LedgerRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const withheld = sum((r) => r.withheld);
  const released = sum((r) => r.released);
  const augment = sum((r) => r.augment);
  const grunnel = sum((r) => r.grunnel);
  const goalOffset = sum((r) => r.goalOffset ?? 0);
  const balance = balanceOf(released, augment, withheld, goalOffset);
  return { key, n: rows.length, withheld, released, augment, grunnel, goalOffset, balance, covered: isCovered(balance) };
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

// --- View 1, second lens: the full order (backlog SITE-13) -----------------
// The custom lens above asks "did this auctioneer depart from custom?", so an
// auction that kept its fee at a $7,500 goal reads $0 whatever the fee was
// worth. This lens asks the other question community feedback raised — "who came
// out ahead in dollars?" — and so measures against the order's real cost,
// $8,000, AND debits the fee the auctioneer kept. Releasing the fee is then just
// the absence of a debit. The two lenses differ by `$500 − fee value`, which is
// why this is a second lens and never a bare "$7,500 / $8,000" baseline switch:
// $8,000 without the debit credits every ordinary auction $500 for the discount
// that bought the fee it kept.
//
// THE KEPT FEE IS ESTIMATED, NEVER RECORDED. Writing it as withheld rows would
// put one on nearly every auction and break the rule that withheld means an
// exception (the maintainer's objection, 2026-09-24). It is derived here, per
// render, and the view labels it an estimate.
//
// The estimate, as settled by the maintainer 2026-10-15:
//   - the fee is NINE Random Ultra Rares — the guarantee — plus, in the Golden
//     Ticket era, one Golden Ticket;
//   - each is priced at its SEASON's rate, from the sales of that season;
//   - a season with no sales yet (the start of one) borrows the most recent
//     EARLIER season that has them — never a later one, so a season before any
//     Random Ultra Rare sold (2018–2020) is NOT COMPUTABLE rather than priced
//     at a later rate;
//   - a thin season (one Golden Ticket sale) is used as it stands: the trend is
//     toward more auctions including the fee, so it fills in.
//
// What the auction released, or recorded as withheld, is not kept fee: the first
// is already credited as Included and the second already debited as Withheld, so
// counting either again would count it twice.

// One fee component's price for a season, and where it came from. `season` is
// the season whose sales set the rate, which differs from the season it prices
// when the rate was borrowed; `n` is how many sales (Random UR: lots) it averages.
export type FeeRate = { rate: number; n: number; season: string };
export type SeasonFeeRates = { rur: FeeRate | null; gt: FeeRate | null };

export function feeRatesBySeason(
  meta: AuctionMeta[], items: ContextItem[], sales: Sale[],
): Map<string, SeasonFeeRates> {
  const seasonOf = new Map(meta.map((m) => [m.auctionId, m.season]));
  // Random UR: quantity-weighted, off the released context rows, because those
  // carry the lot TOTAL and the count — a price row is a per-token rate with no
  // quantity (see rollupByAuction).
  const rur = new Map<string, { value: number; qty: number; n: number }>();
  // Golden Ticket: one per auction, context row first, as rollupByAuction does.
  const gtByAuction = new Map<string, number>();
  for (const it of items) {
    if (it.provenance !== 'released-payment') continue;
    const season = seasonOf.get(it.auctionId);
    if (!season) continue;
    if (isRandomUltraRare(it.name) && it.quantity > 0) {
      const e = rur.get(season) ?? { value: 0, qty: 0, n: 0 };
      e.value += it.value; e.qty += it.quantity; e.n++;
      rur.set(season, e);
    } else if (isGoldenTicket(it.name)) gtByAuction.set(it.auctionId, it.value);
  }
  for (const s of sales) {
    if (!isGoldenTicket(s.displayName) && !isGoldenTicket(s.item)) continue;
    if (!gtByAuction.has(s.auctionId)) gtByAuction.set(s.auctionId, s.price);
  }
  const gt = new Map<string, number[]>();
  for (const [auctionId, price] of gtByAuction) {
    const season = seasonOf.get(auctionId);
    if (season) bucket(gt, season, price);
  }

  const own = new Map<string, SeasonFeeRates>();
  for (const [season, e] of rur) {
    own.set(season, { rur: { rate: e.value / e.qty, n: e.n, season }, gt: null });
  }
  for (const [season, prices] of gt) {
    const r = own.get(season) ?? { rur: null, gt: null };
    r.gt = { rate: mean(prices)!, n: prices.length, season };
    own.set(season, r);
  }

  // Every season the metadata knows, oldest first, each falling back to the
  // nearest earlier season with sales of that component.
  const seasons = [...new Set(meta.map((m) => m.season))].sort((a, b) => Number(a) - Number(b));
  const out = new Map<string, SeasonFeeRates>();
  let lastRur: FeeRate | null = null, lastGt: FeeRate | null = null;
  for (const season of seasons) {
    const o = own.get(season);
    if (o?.rur) lastRur = o.rur;
    if (o?.gt) lastGt = o.gt;
    out.set(season, { rur: lastRur, gt: lastGt });
  }
  return out;
}

// What one auction kept of its fee, estimated. `value` is ≤ 0, like withheld.
export type FeeKept = {
  value: number;
  rurKept: number;      // Random Ultra Rares neither released nor recorded withheld
  gtKept: boolean;      // a Golden Ticket was owed and neither released nor withheld
  rur: FeeRate | null;  // the rates used — null when that part was not needed
  gt: FeeRate | null;
};

// The Trent reward points counted as a subsidy, on request. The custom lens
// never counts them, and the reason still holds: they are a PRICE term (bidders
// price the points into their bids — the same tokens sell 6–15% higher at Trent),
// not a FUNDING term. But "who came out ahead in dollars" is the question some
// readers will insist the points belong in, so this lens offers them as an
// opt-in augment, off by default. Points are earned on what bidders spend, and
// what they spend is the goal — the ≥$750 an auction the declined proposal was
// sized at (backlog § Dropped).
export function trentSubsidyOf(m: AuctionMeta): number {
  if (m.source !== 'Trent' || m.targetFunding == null) return 0;
  return trentRewardRate(m.auctionId) * m.targetFunding;
}

export type FullOrderRow = LedgerRow & {
  // The order cost minus this auction's goal: $0 for $8,000, +$500 for $7,500.
  // null for a goal above the order cost — a pooled auction for several orders
  // has more than one fee, and this lens prices one.
  orderOffset: number | null;
  // null when NOT COMPUTABLE: a fee component was kept and no sale of it exists
  // in this season or any earlier one, or the goal is not a single order's.
  feeKept: FeeKept | null;
  // Trent's reward points at this auction (0 elsewhere). Counted only when the
  // view asks — see fullOrderBalanceOf.
  trentSubsidy: number;
  // released + augment + withheld + orderOffset + feeKept.value, Grunnel and the
  // subsidy excluded. null when the fee is not computable.
  fullBalance: number | null;
};

export function feeKeptOf(
  m: AuctionMeta,
  counts: { rurReleased: number; rurWithheld: number; gtReleased: boolean; gtWithheld: boolean },
  rates: SeasonFeeRates | undefined,
): FeeKept | null {
  const rurKept = Math.max(0, ERAS.feeRandomUltraRares - counts.rurReleased - counts.rurWithheld);
  const gtKept = inGoldenTicketEra(m.closeDate) && !counts.gtReleased && !counts.gtWithheld;
  const rur = rurKept > 0 ? rates?.rur ?? null : null;
  const gt = gtKept ? rates?.gt ?? null : null;
  if ((rurKept > 0 && !rur) || (gtKept && !gt)) return null;
  const value = -((rur ? rurKept * rur.rate : 0) + (gt ? gt.rate : 0));
  return { value: value || 0, rurKept, gtKept, rur, gt };
}

// Every CLOSED auction, not just those with context: under this lens an auction
// that recorded nothing still kept a fee, so leaving it out would show only the
// auctions that did something unusual and flatter every auctioneer's total.
export function fullOrderLedger(
  meta: AuctionMeta[], ctx: Map<string, AuctionContext>, items: ContextItem[], sales: Sale[],
): FullOrderRow[] {
  const labels = auctioneerLabels(meta);
  const rates = feeRatesBySeason(meta, items, sales);
  const counts = new Map<string, { rurReleased: number; rurWithheld: number; gtReleased: boolean; gtWithheld: boolean }>();
  const countsOf = (id: string) => {
    const found = counts.get(id);
    if (found) return found;
    const made = { rurReleased: 0, rurWithheld: 0, gtReleased: false, gtWithheld: false };
    counts.set(id, made);
    return made;
  };
  for (const it of items) {
    const released = it.provenance === 'released-payment';
    const withheld = it.provenance === 'withheld';
    if (!released && !withheld) continue;
    const c = countsOf(it.auctionId);
    if (isRandomUltraRare(it.name)) {
      if (released) c.rurReleased += it.quantity; else c.rurWithheld += it.quantity;
    } else if (isGoldenTicket(it.name)) {
      if (released) c.gtReleased = true; else c.gtWithheld = true;
    }
  }
  for (const s of sales) {
    if (isGoldenTicket(s.displayName) || isGoldenTicket(s.item)) countsOf(s.auctionId).gtReleased = true;
  }
  const none = { rurReleased: 0, rurWithheld: 0, gtReleased: false, gtWithheld: false };

  const rows: FullOrderRow[] = [];
  for (const m of meta) {
    if (m.status !== 'Closed') continue;
    const base = ledgerRowOf(m, ctx.get(m.auctionId), labels);
    const single = m.targetFunding != null && m.targetFunding <= ERAS.orderCost;
    const orderOffset = single ? ERAS.orderCost - m.targetFunding! : null;
    const feeKept = single ? feeKeptOf(m, counts.get(m.auctionId) ?? none, rates.get(m.season)) : null;
    const fullBalance = orderOffset != null && feeKept
      ? base.released + base.augment + base.withheld + orderOffset + feeKept.value
      : null;
    rows.push({ ...base, orderOffset, feeKept, trentSubsidy: trentSubsidyOf(m), fullBalance });
  }
  return rows.sort(newestFirst);
}

// The balance a reader sees under this lens, given the two opt-ins.
export function fullOrderBalanceOf(
  r: FullOrderRow, includeGrunnel: boolean, includeTrentSubsidy: boolean,
): number | null {
  if (r.fullBalance == null) return null;
  return r.fullBalance + (includeGrunnel ? r.grunnel : 0) + (includeTrentSubsidy ? r.trentSubsidy : 0);
}

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

// --- View 4: Venue comparison, per season, per token -----------------------
// One season at a time, matched per token: for each token sold under two or more
// venues that season we take each venue's average price. Matching per token
// within a season holds both token mix and time constant, so the remaining
// difference is the venue's own price level (§5.5). Trent can be shown nominal
// or reward-adjusted (−10%, the ~100 pt/$1 reward that lowers a Trent buyer's
// effective cost); the adjustment is applied in the view, so this stays a plain
// average.
//
// THIS USED TO BE ANCHORED ON TRENT — "Trent vs one other venue", with the other
// side a parameter. That was already the second shape: it started as "Trent vs
// Forum", because the forum was the only other place an auction could run, and
// grew a parameter when alesievauctions.com appeared in 2027.
//
// Anchoring it a third time would have been the mistake. The anchor was never
// part of the question — the question is "do venues price differently?" — and a
// season of Forum vs Alesiev with no Trent auction would have had no analysis at
// all. So the venue list is now read from the data, the table grows a column per
// venue, and nothing here names a venue. Today that renders exactly the two
// columns it always did.

export type VenueTokenRow = {
  item: string;
  displayName: string;
  category: string;
  // venue -> that venue's mean price for this token this season, and how many
  // sales it averaged. A venue that did not sell the token is ABSENT, not zero.
  byVenue: Map<AuctionSource, { avg: number; n: number }>;
};

// Seasons with a within-token comparison to draw, each with the venues that
// season priced (in AUCTION_SOURCES order). Newest first. A season qualifies
// when at least one token sold under two or more venues — which is the whole
// rule, with no venue singled out.
export type VenueOverlap = { season: string; venues: AuctionSource[] };

export function venueOverlapSeasons(sales: Sale[], meta: AuctionMeta[]): VenueOverlap[] {
  const srcById = new Map(meta.map((m) => [m.auctionId, m.source]));
  // season -> item -> the venues it sold under
  const bySeason = new Map<string, Map<string, Set<AuctionSource>>>();
  for (const s of sales) {
    const src = srcById.get(s.auctionId);
    if (!src) continue;
    let items = bySeason.get(s.season);
    if (!items) { items = new Map(); bySeason.set(s.season, items); }
    let e = items.get(s.item);
    if (!e) { e = new Set(); items.set(s.item, e); }
    e.add(src);
  }
  const out: VenueOverlap[] = [];
  for (const [season, items] of bySeason) {
    // Only count a venue that shares at least one token with another one: a
    // venue whose whole catalogue is unique to it has nothing to compare, and a
    // column of blanks is worse than no column.
    const shared = new Set<AuctionSource>();
    for (const venues of items.values()) {
      if (venues.size < 2) continue;
      for (const v of venues) shared.add(v);
    }
    if (shared.size > 1) out.push({ season, venues: AUCTION_SOURCES.filter((v) => shared.has(v)) });
  }
  return out.sort((a, b) => Number(b.season) - Number(a.season));
}

// Per-token per-venue averages for one season, over the given venues. A token is
// included when it sold under at least TWO of them — not all of them, which
// would make a third venue's arrival silently delete rows from a comparison the
// first two could still support. A venue that did not sell an included token is
// simply missing from its `byVenue` map, and the view renders that as a dash.
export function venueComparisonSeason(
  sales: Sale[], meta: AuctionMeta[], season: string, venues: AuctionSource[],
): VenueTokenRow[] {
  const srcById = new Map(meta.map((m) => [m.auctionId, m.source]));
  const wanted = new Set(venues);
  const byItem = new Map<string, {
    prices: Map<AuctionSource, number[]>; displayName: string; category: string;
  }>();
  for (const s of sales) {
    if (s.season !== season) continue;
    const src = srcById.get(s.auctionId);
    if (!src || !wanted.has(src)) continue;
    let e = byItem.get(s.item);
    if (!e) { e = { prices: new Map(), displayName: s.displayName, category: s.category }; byItem.set(s.item, e); }
    const arr = e.prices.get(src);
    if (arr) arr.push(s.price); else e.prices.set(src, [s.price]);
  }
  const rows: VenueTokenRow[] = [];
  for (const [item, e] of byItem) {
    if (e.prices.size < 2) continue; // needs at least two venues to compare
    const byVenue = new Map<AuctionSource, { avg: number; n: number }>();
    for (const v of venues) {
      const prices = e.prices.get(v);
      if (prices?.length) byVenue.set(v, { avg: mean(prices)!, n: prices.length });
    }
    rows.push({ item, displayName: e.displayName, category: e.category, byVenue });
  }
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// --- View 5: Standard vs Trade 2, within one season ------------------------
// Season 2027 is the first to sell two different $8k orders side by side — the
// standard one and a "Trade 2" one (Option A and Option B to the auctioneers) —
// so for the first time a reader can ask whether the order a lot came out of
// moved its price.
//
// Same shape and same discipline as augmentedVsNot above: one season, matched
// per token, only tokens sold under BOTH variants. That matters more here than
// anywhere else on this page, because the two orders do not contain the same
// things in the same numbers — a Trade 2 order ships 11/13/13 Aragonite / Elven
// Bismuth / Oil of Enchantment against the standard 15/20/20. A raw group mean
// would therefore be mostly a statement about the order's CONTENTS. Holding the
// token constant is what leaves the price behind.
//
// Nothing here is pinned to 2027. The split is read from auctionStyle per auction
// (deriveOrderVariant), and the season list below is whichever seasons hold both
// variants — so this appears when a season runs two orders and stops appearing
// when one does not, with no year to maintain.

export type VariantSplit = {
  item: string;
  displayName: string;
  category: string;
  tradeTwoAvg: number;
  standardAvg: number;
  delta: number;      // tradeTwoAvg − standardAvg
  pct: number | null; // delta / standardAvg
};

export type VariantSplitResult = {
  season: string;
  tradeTwoAuctions: number;
  standardAuctions: number;
  rows: VariantSplit[];
  // Tokens that sold under only ONE variant, named rather than silently dropped:
  // "which tokens does the other order not have?" is half the answer a reader
  // came for, and the matched table structurally cannot show it.
  tradeTwoOnly: string[];
  standardOnly: string[];
};

// Seasons holding auctions of BOTH order variants, newest first — the only
// seasons with a comparison to draw.
export function orderVariantSeasons(meta: AuctionMeta[]): string[] {
  const seen = new Map<string, Set<OrderVariant>>();
  for (const m of meta) {
    let s = seen.get(m.season);
    if (!s) { s = new Set(); seen.set(m.season, s); }
    s.add(m.orderVariant);
  }
  return [...seen.entries()]
    .filter(([, v]) => v.size > 1)
    .map(([season]) => season)
    .sort((a, b) => Number(b) - Number(a));
}

export function standardVsTradeTwo(
  sales: Sale[], meta: AuctionMeta[], season: string,
): VariantSplitResult {
  const variantById = new Map(meta.map((m) => [m.auctionId, m.orderVariant]));
  const two = new Map<string, number[]>();
  const std = new Map<string, number[]>();
  const names = new Map<string, { displayName: string; category: string }>();
  const twoAuctions = new Set<string>();
  const stdAuctions = new Set<string>();

  for (const s of sales) {
    if (s.season !== season) continue;
    // A sale whose auction has no metadata row cannot be attributed to either
    // order, so it is skipped rather than defaulted into 'Standard' — the
    // default would be invisible and would bias the side it landed on.
    const v = variantById.get(s.auctionId);
    if (!v) continue;
    const isTwo = v === 'Trade 2';
    (isTwo ? twoAuctions : stdAuctions).add(s.auctionId);
    bucket(isTwo ? two : std, s.item, s.price);
    if (!names.has(s.item)) names.set(s.item, { displayName: s.displayName, category: s.category });
  }

  const nameOf = (item: string) => names.get(item)?.displayName ?? item;
  const rows: VariantSplit[] = [];
  for (const [item, twoPrices] of two) {
    const stdPrices = std.get(item);
    if (!stdPrices || !stdPrices.length) continue; // needs both sides
    const tradeTwoAvg = mean(twoPrices)!;
    const standardAvg = mean(stdPrices)!;
    const delta = tradeTwoAvg - standardAvg;
    rows.push({
      item,
      displayName: nameOf(item),
      category: names.get(item)?.category ?? '',
      tradeTwoAvg,
      standardAvg,
      delta,
      pct: standardAvg !== 0 ? delta / standardAvg : null,
    });
  }
  rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const sortedNames = (items: Iterable<string>) => [...items].map(nameOf).sort((a, b) => a.localeCompare(b));

  return {
    season,
    tradeTwoAuctions: twoAuctions.size,
    standardAuctions: stdAuctions.size,
    rows,
    tradeTwoOnly: sortedNames([...two.keys()].filter((i) => !std.has(i))),
    standardOnly: sortedNames([...std.keys()].filter((i) => !two.has(i))),
  };
}
