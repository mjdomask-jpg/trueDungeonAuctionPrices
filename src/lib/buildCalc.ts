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
};

export type Comparison = {
  paths: Path[]; // the two that compete, in display order: build, buy
  best: PathKey;
  /** How much the winner beats the other by. */
  delta: number;
  /** True when `delta` is too small to call. Every number feeding this is an
   *  estimate, so declaring a winner by pennies would read as false precision. */
  wash: boolean;
  /** The quick-sale value the sell aside is priced from, echoed for display. */
  quickSale: number;
  /** What selling the pile first and then buying nets. Null when there is
   *  nothing on hand to sell. Reported for the aside, never as a contender —
   *  see below. */
  sellAndBuyNet: number | null;
};

/** Below this the two paths are reported as level rather than one "winning". */
export const WASH_THRESHOLD = 1;

/** Compare the two ways a player actually chooses between, given a secondary
 *  price `market` for the finished token and `costToFinish` for the rest of
 *  the bill of materials:
 *
 *    build   spend costToFinish   your trade goods are consumed
 *    buy     spend market         your trade goods stay yours
 *
 *  A third path exists — sell the goods, then buy — and it is always the
 *  cheapest on paper, since it nets `market − quickSale`. It is deliberately
 *  NOT a contender, because the money model cannot see what it really costs.
 *  In this game trade goods arrive free as loot and keep their use for the next
 *  recipe, while selling a pile means hours of listing, haggling and posting,
 *  with no guarantee the lot moves. So its edge is not a saving — it is the
 *  wage for those hours, and only the player can price their own time. The UI
 *  reports the number as an aside and says as much.
 *
 *  That leaves build vs buy, which are genuinely comparable: both take ten
 *  minutes, and the goods are free either way — sunk if you craft, retained if
 *  you buy. */
export function comparePaths(
  costToFinish: number,
  market: number,
  quickSale: number,
): Comparison {
  const paths: Path[] = [
    { key: 'build', cost: costToFinish },
    { key: 'buy', cost: market },
  ];
  const delta = Math.abs(costToFinish - market);
  return {
    paths,
    best: costToFinish <= market ? 'build' : 'buy',
    delta,
    wash: delta < WASH_THRESHOLD,
    quickSale,
    sellAndBuyNet: quickSale > 0 ? market - quickSale : null,
  };
}

/** How much of a recipe you need to be holding, at market value, before
 *  finishing the craft costs less than buying the finished token.
 *
 *  Cost to finish is just `fullCost − what you hold`, so finishing takes the
 *  lead the moment your holdings pass `fullCost − market`. That turns the
 *  build-vs-buy gap into an inventory target — how much more loot you need —
 *  which is the question a player with a growing stash is actually asking.
 *  Zero means you are already past it with an empty drawer. */
export function breakEvenHoldings(fullCost: number, market: number): number {
  return Math.max(0, fullCost - market);
}
