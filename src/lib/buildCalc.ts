// Build-calculator decision math (Phase 3 of the transmutes expansion).
//
// The cost engine in `transmutes.ts` answers "what does this recipe cost".
// This module answers the question that comes after it: given what you already
// hold and what the finished token sells for, which way of ending up with that
// token is cheapest. It is pure — numbers in, numbers out, no React — so the
// component only formats what it returns.
//
// Design: docs/transmutes-expansion-plan.md §2.2.

// The quick-sale haircut. Selling a pile of goods means undercutting the
// market, so on-hand value is discounted off the reference price.
//
// ONE rate, applied to both the season minimum and the season average, which is
// what makes the result a range rather than two unrelated estimates:
//
//   low  = 20% under the lowest price the market ever paid — a fire sale
//   high = 20% under the going rate — a patient sale
//
// An earlier cut used 20% off avg but only 10% off min, on the reasoning that
// the minimum is already low. Measured against the real data that inverted the
// pair in 15 of 208 priced (season, item) groups — the "min" figure came out
// LARGER — because min sits a median 0.613 of avg, not just below it. A single
// rate cannot invert, since min <= avg always. Config, not literals at the call
// site, so the model retunes in one place (plan §7).
export const RESALE = {
  off: 0.2,
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
  /** Fire sale — the haircut off the season's lowest price. */
  low: number;
  /** Patient sale — the haircut off the going rate. */
  high: number;
};

/** What selling the on-hand goods is worth, as a range from a fire sale to a
 *  patient one. Unpriced lines contribute nothing — we have no basis to value
 *  them. `low <= high` always holds: one rate off two prices, and the minimum
 *  never exceeds the average. */
export function quickSaleValue(lines: CalcLine[]): QuickSale {
  let low = 0;
  let high = 0;
  for (const l of lines) {
    const held = Math.min(Math.max(0, l.onHand), l.quantity);
    if (held === 0) continue;
    // A line always carries both prices or neither, but fall back rather than
    // silently undercount the low end if that ever stops being true.
    const min = l.unitMin ?? l.unitAvg;
    if (min != null) low += held * min * (1 - RESALE.off);
    if (l.unitAvg != null) high += held * l.unitAvg * (1 - RESALE.off);
  }
  return { low, high };
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
  /** The quick-sale range the sell aside is priced from, echoed for display. */
  quickSale: QuickSale;
  /** What is left to pay after selling the pile first, as a range. NEGATIVE
   *  means the goods more than cover the token and you come out ahead. `low` is
   *  the best outcome for the buyer (the goods sold well), `high` the worst.
   *  Null when there is nothing on hand to sell. Reported for the aside, never
   *  as a contender — see below. */
  sellAndBuyNet: { low: number; high: number } | null;
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
  quickSale: QuickSale,
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
    // Selling well leaves the least to pay, so the high end of the proceeds
    // maps to the low end of what is still owed.
    sellAndBuyNet:
      quickSale.high > 0
        ? { low: market - quickSale.high, high: market - quickSale.low }
        : null,
  };
}

/** How much of a recipe you need to be holding, at market value, before
 *  completing the transmute costs less than buying the finished token.
 *
 *  Cost to finish is just `fullCost − what you hold`, so finishing takes the
 *  lead the moment your holdings pass `fullCost − market`. That turns the
 *  build-vs-buy gap into an inventory target — how much more loot you need —
 *  which is the question a player with a growing stash is actually asking.
 *  Zero means you are already past it with an empty drawer. */
export function breakEvenHoldings(fullCost: number, market: number): number {
  return Math.max(0, fullCost - market);
}
