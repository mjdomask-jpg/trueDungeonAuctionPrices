// Build-calculator decision math (Phase 3 of the transmutes expansion).
//
// The cost engine in `transmutes.ts` answers "what does this recipe cost".
// This module answers the question that comes after it: given what you already
// hold and what the finished token sells for, which way of ending up with that
// token is cheapest. It is pure — numbers in, numbers out, no React — so the
// component only formats what it returns.
//
// Design: docs/transmutes-expansion-plan.md §2.2.

// Quick-sale haircuts. Selling a pile of materials fast means undercutting the
// market, so on-hand value is discounted off the reference price.
//
// The two rates model the same fast sale from the two prices we hold. They are
// config, not literals at the call site, so the maintainer can retune the model
// in one place (plan §7).
export const RESALE = {
  // Off the average price — the reference the whole calculator leads with.
  offAvg: 0.2,
  // Off the minimum price. Smaller, because the minimum is already the low end
  // of what the token traded for; haircutting it twice would double-count.
  offMin: 0.1,
} as const;

/** One recipe line, reduced to what the decision math needs. Unit prices are
 *  the EFFECTIVE ones — a per-line override has already been applied. */
export type CalcLine = {
  quantity: number; // how many the recipe requires
  onHand: number; // how many you hold, already capped at `quantity`
  unitAvg: number | null;
  unitMin: number | null;
};

export type QuickSale = {
  /** What a fast sale of your on-hand materials nets, off average prices.
   *  This is the figure the UI and the comparison both use. */
  value: number;
  /** The same sale valued off minimum prices. Shown only as supporting detail:
   *  because the two haircuts differ, this can land either side of `value`, so
   *  it reads as a second estimate rather than a bound. Never a "min" column —
   *  a larger number under a "min" label reads as a bug. */
  fromMin: number;
};

/** What a fast sale of the on-hand materials is worth. Unpriced lines
 *  contribute nothing — we have no basis to value them. */
export function quickSaleValue(lines: CalcLine[]): QuickSale {
  let value = 0;
  let fromMin = 0;
  for (const l of lines) {
    const held = Math.min(Math.max(0, l.onHand), l.quantity);
    if (held === 0) continue;
    if (l.unitAvg != null) value += held * l.unitAvg * (1 - RESALE.offAvg);
    if (l.unitMin != null) fromMin += held * l.unitMin * (1 - RESALE.offMin);
  }
  return { value, fromMin };
}

export type PathKey = 'build' | 'sellAndBuy' | 'buy';

export type Path = {
  key: PathKey;
  /** Cash out of pocket to end up holding the finished token. */
  cost: number;
  /** Whether this path competes for the verdict. `buy` does not — see below. */
  candidate: boolean;
};

export type Comparison = {
  paths: Path[]; // display order: build, sell-and-buy, buy
  best: PathKey; // cheapest among the candidates
  /** How much the winner beats the other candidate by. */
  delta: number;
  /** True when `delta` is too small to call. Every number feeding this is an
   *  estimate, so declaring a winner by pennies would read as false precision. */
  wash: boolean;
  /** The quick-sale value the sell path is priced from, echoed for display. */
  quickSale: number;
};

/** Below this the two paths are reported as level rather than one "winning". */
export const WASH_THRESHOLD = 1;

/** Compare the ways of ending up with the finished token, given a secondary
 *  price `market` for it and `costToFinish` for buying the rest of the BOM.
 *
 *  Three paths, but only two of them can win, and that is a real result rather
 *  than a simplification:
 *
 *    build       spend costToFinish        materials consumed
 *    sellAndBuy  spend market − quickSale  materials sold
 *    buy         spend market              materials KEPT
 *
 *  `buy` costs exactly `quickSale` more than `sellAndBuy`, always, because the
 *  only difference between them is whether you sell the pile. So it can never
 *  be strictly cheapest, and offering it as a third contender would be theatre.
 *  It is shown with its total — the verdict has to stay auditable (plan §7) —
 *  but marked non-candidate, and the UI explains that the gap buys you the
 *  choice to keep your materials.
 *
 *  When you hold nothing, quickSale is 0, there is nothing to sell, and `buy`
 *  becomes the candidate in the sell path's place. */
export function comparePaths(
  costToFinish: number,
  market: number,
  quickSale: number,
): Comparison {
  const holdsMaterials = quickSale > 0;
  const paths: Path[] = [
    { key: 'build', cost: costToFinish, candidate: true },
    { key: 'sellAndBuy', cost: market - quickSale, candidate: holdsMaterials },
    { key: 'buy', cost: market, candidate: !holdsMaterials },
  ];
  const [a, b] = paths.filter((p) => p.candidate);
  const best = a.cost <= b.cost ? a : b;
  const delta = Math.abs(a.cost - b.cost);
  return {
    paths,
    best: best.key,
    delta,
    wash: delta < WASH_THRESHOLD,
    quickSale,
  };
}
