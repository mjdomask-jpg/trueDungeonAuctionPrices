// Line-level ingredient substitution — Phases 6 and 9 of the accuracy release
// (docs/transmutes-expansion-plan.md §3.5, §3.8, §10.3 D6/D8).
//
// ONE engine, TWO presentations. Both rule sets below are fixed game rules
// rather than editable content, so they live here as code config and add no
// data columns (D6). What separates them is not the mechanism but HOW LIKELY A
// PLAYER IS TO BE HOLDING THE THING (D8):
//
//   Omni Orb / Cube   nobody has a spare Cube in a drawer, so it is a price
//                     COMPARISON against a possible secondary-market purchase
//                     — an opt-in suggestion, never folded into the headline.
//   Wish Ring / GP    players hold Gold Bars routinely and Wish Rings trade in
//                     the community, so these are PEER PATHS — a real toggle,
//                     because on-hand quantities can flip the choice even when
//                     price does not.
//
// A per-line `NoSubstitute` column is a documented seam, deliberately NOT
// built: it would exist only for a hypothetical future Wish-Ring-only recipe,
// and adding it now would invert the blank-cell default across 43 rows.

import type { BuildCost, CostEngine, PricedLine } from './transmutes';

// --- Phase 6: Omni Orb / Omni Cube ---------------------------------------

export const OMNI_CUBE = 'Omni Cube';
export const OMNI_ORB = 'Omni Orb';

/** Omni substitution applies only inside Legendary recipes. */
export const OMNI_HOST_LEVEL = 'Legendary';

/** The one recipe the game excludes. It is also one of the only three
 *  Legendaries with no Wish Ring line, so both exception sets already agree —
 *  a point in favour of one engine rather than two. */
export const OMNI_EXCLUDED = new Set(['Charm of Avarice']);

/** Tier a Cube can stand in for, and the tiers an Orb can. */
export const OMNI_CUBE_TIERS = new Set(['Relic']);
export const OMNI_ORB_TIERS = new Set(['Ultra Rare', 'Exalted', 'Rare', 'Enhanced', 'Uncommon']);

// --- Phase 9: Wish Ring ⇄ 15,000 GP --------------------------------------

export const WISH_RING = 'Wish Ring';
export const GOLD_BAR = '1,000 GP Gold Bar';

/**
 * The GP denominations, in gold pieces.
 *
 * These are three weights of ONE currency, not three goods: five 1,000 GP Gold
 * Bars are a 5,000 GP Mithral Bar, and the company will issue a player either
 * on request, so a recipe asking for 25,000 GP is satisfied by any combination
 * that adds up. `derivedPrices.csv` prices the larger two as exact multiples of
 * the bar for the same reason.
 *
 * This table exists because the recipes changed underneath this file (DATA-8).
 * A Legendary used to ask for `1,000 GP Gold Bar x25`; it now asks for
 * `25,000 GP Eldritch Ore Bar x1`, which is the token the game's own recipe
 * card names. Matching the line by the literal string `GOLD_BAR` — which is
 * what `goldPathFor` did — stopped finding it, and the failure was SILENT:
 * `goldPathFor` returned null, so the Wish Ring toggle simply stopped
 * rendering on all 43 recipes with no error anywhere. Measured before the fix:
 * 43 of 47 Legendary recipes offered the path, then 0 of 47.
 *
 * So the rule is stated in GP and not in bar counts, and a fourth denomination
 * would only have to be added here.
 */
export const GP_DENOMINATIONS: Readonly<Record<string, number>> = {
  '1,000 GP Gold Bar': 1000,
  '5,000 GP Mithral Bar': 5000,
  '25,000 GP Eldritch Ore Bar': 25000,
};

/** The recipes read "1 Wish Ring OR 15,000 GP". 15,000 GP is not a token — no
 *  denomination is worth that — so the GP path states the line's whole value in
 *  GP, adds the ring's 15,000, and re-denominates the total into Gold Bars: a
 *  Legendary's `25,000 GP Eldritch Ore Bar x1` becomes `1,000 GP Gold Bar x40`.
 *  That is the same row, the same total and the same wording the GP path showed
 *  when the recipe was authored as 25 bars, so nothing visible moved. */
export const GP_PER_WISH_RING = 15000;
export const GP_PER_BAR = GP_DENOMINATIONS[GOLD_BAR];
export const BARS_PER_WISH_RING = GP_PER_WISH_RING / GP_PER_BAR; // 15

/** Which of the two legal paths a recipe is being priced on. */
export type IngredientPath = 'ring' | 'gp';

export const DEFAULT_PATH: IngredientPath = 'ring';

export type GoldPath = {
  ringIndex: number; // BOM index of the Wish Ring line
  barIndex: number; // BOM index of the GP line the ring's GP merges into
  ringQuantity: number; // rings the recipe asks for (1 everywhere in this data)
  barGood: string; // the denomination that line is authored in
  barQuantity: number; // that denomination's count, as authored (1 on a Legendary)
  barGp: number; // what the line is worth in GP (25,000 on a Legendary)
  gpTotal: number; // GP on the GP path (40,000 on a Legendary)
  gpBarQuantity: number; // gpTotal expressed in 1,000 GP Gold Bars (40)
};

/**
 * Locate the Wish-Ring-or-GP choice in a bill of materials.
 *
 * Returns null when the recipe does not offer it — the four Legendaries with no
 * Wish Ring line (`Charm of Avarice Recipe 3`, `Kilgor's +4 Savage Sword
 * (Recipe 2)`, `Totem of Wonder`, `Gear Golem Totem`; measured 2026-09-04, and
 * it was three until `Totem of Wonder` was authored), and every non-Legendary.
 * Also null when a Wish Ring line exists with no GP line to merge into: that
 * combination does not occur in the data (all 43 have both), and inventing a
 * new row for it would be a guess about a recipe nobody has authored.
 *
 * The GP line is found by DENOMINATION rather than by name, so it keeps working
 * whichever weight the sheet authors the requirement in. No recipe carries two
 * GP lines — checked across all 176 — so `findIndex` is not choosing between
 * candidates.
 */
export function goldPathFor(cost: BuildCost): GoldPath | null {
  const ringIndex = cost.lines.findIndex((l) => l.good === WISH_RING);
  if (ringIndex < 0) return null;
  const barIndex = cost.lines.findIndex((l) => l.good in GP_DENOMINATIONS);
  if (barIndex < 0) return null;
  const bar = cost.lines[barIndex];
  const ringQuantity = cost.lines[ringIndex].quantity;
  const barGp = bar.quantity * GP_DENOMINATIONS[bar.good];
  const gpTotal = barGp + ringQuantity * GP_PER_WISH_RING;
  return {
    ringIndex,
    barIndex,
    ringQuantity,
    barGood: bar.good,
    barQuantity: bar.quantity,
    barGp,
    gpTotal,
    gpBarQuantity: gpTotal / GP_PER_BAR,
  };
}

/**
 * The same BuildCost priced on the GP path.
 *
 * Line count and order are PRESERVED — the Wish Ring line stays in place at
 * quantity 0, marked `substituted`, rather than being spliced out. The
 * calculator keys its per-line state (on-hand quantities, price overrides) by
 * index, so removing a row would silently re-map a player's entries onto the
 * wrong ingredients when they flip the toggle.
 */
export function applyGoldPath(cost: BuildCost, engine: CostEngine): BuildCost {
  const path = goldPathFor(cost);
  if (!path) return cost;

  const lines = cost.lines.map((l, i) => {
    if (i === path.ringIndex) return withQuantity(l, 0, 'replaced');
    if (i === path.barIndex) return asGoldBars(l, path, engine);
    return l;
  });

  return { ...cost, lines, ...totalsOf(lines, cost) };
}

/**
 * Re-denominate the GP line into 1,000 GP Gold Bars at the path's total.
 *
 * A no-op beyond the quantity when the line is already Gold Bars, which is what
 * every non-Legendary GP line still is — that branch is the original behaviour,
 * unchanged and still exercised.
 *
 * THE PRICE IS LOOKED UP, NEVER DIVIDED DOWN. The obvious shortcut is
 * `l.unitAvg / 25`, since the Ore Bar's price is by construction 25x the bar's.
 * It does not round-trip: measured over two million money values, `(g * 25) / 25
 * !== g` about 15% of the time and `(g * 5) / 5 !== g` about 13%, so the GP
 * path's total would stop matching a Relic's Gold Bar line computed the
 * ordinary way — two numbers that must agree, drifting in the last bits for no
 * reason. Asking the price index costs one lookup and is exact.
 *
 * It is asked at the line's `pricedYear`, NOT its `nominalYear`. Trade goods
 * price at the current season under rule S1, so a 2012 Legendary's GP line is
 * priced from 2026; looking up at 2012 clamps to 2018 instead and quietly
 * reprices it. That was measured too — 41 of the 43 recipes came out $247 high
 * before the year was corrected.
 */
function asGoldBars(l: PricedLine, path: GoldPath, engine: CostEngine): PricedLine {
  if (l.good === GOLD_BAR) return withQuantity(l, path.gpBarQuantity, 'boosted');
  // An unpriced GP line stays unpriced rather than acquiring a price from a
  // different token: `withQuantity` already carries nulls through correctly.
  const p = l.unitAvg === null ? null : engine.prices.leafPrice(GOLD_BAR, l.pricedYear, l.variant, l.window);
  if (!p) return { ...withQuantity(l, path.gpBarQuantity, 'boosted'), good: GOLD_BAR, displayName: GOLD_BAR };
  const q = path.gpBarQuantity;
  return {
    ...l,
    good: GOLD_BAR,
    displayName: GOLD_BAR,
    category: 'Trade 2',
    quantity: q,
    substituted: 'boosted',
    source: p.source,
    bound: p.bound,
    unitAvg: p.stats.avg,
    unitMin: p.stats.min,
    extAvg: p.stats.avg * q,
    extMin: p.stats.min * q,
  };
}

function withQuantity(l: PricedLine, quantity: number, substituted: 'replaced' | 'boosted'): PricedLine {
  return {
    ...l,
    quantity,
    substituted,
    extAvg: l.unitAvg === null ? null : l.unitAvg * quantity,
    extMin: l.unitMin === null ? null : l.unitMin * quantity,
  };
}

/** Re-add the own/source/full totals from a rewritten line list. */
function totalsOf(lines: PricedLine[], cost: BuildCost) {
  let ownAvg = 0, ownMin = 0, sourceAvg = 0, sourceMin = 0;
  for (const l of lines) {
    if (l.isSource) { sourceAvg += l.extAvg ?? 0; sourceMin += l.extMin ?? 0; }
    else { ownAvg += l.extAvg ?? 0; ownMin += l.extMin ?? 0; }
  }
  void cost;
  return { ownAvg, ownMin, sourceAvg, sourceMin, fullAvg: ownAvg + sourceAvg, fullMin: ownMin + sourceMin };
}

export type PathComparison = {
  ringAvg: number; ringMin: number;
  gpAvg: number; gpMin: number;
  /** Which path is cheaper on each basis. They disagree in about a third of
   *  seasons, which is why both are shown rather than one being picked. */
  cheaperAvg: IngredientPath;
  cheaperMin: IngredientPath;
  deltaAvg: number; // gp − ring, so negative means the GP path is cheaper
  deltaMin: number;
};

/** Price both legal paths for a recipe that offers the choice. */
export function compareIngredientPaths(cost: BuildCost, engine: CostEngine): PathComparison | null {
  const path = goldPathFor(cost);
  if (!path) return null;
  const gp = applyGoldPath(cost, engine);
  return {
    ringAvg: cost.fullAvg, ringMin: cost.fullMin,
    gpAvg: gp.fullAvg, gpMin: gp.fullMin,
    cheaperAvg: gp.fullAvg < cost.fullAvg ? 'gp' : 'ring',
    cheaperMin: gp.fullMin < cost.fullMin ? 'gp' : 'ring',
    deltaAvg: gp.fullAvg - cost.fullAvg,
    deltaMin: gp.fullMin - cost.fullMin,
  };
}

/** Apply the selected path. `'ring'` is the identity, and the default, because
 *  it is what the recipe literally lists.
 *
 *  `engine` is REQUIRED rather than optional even though the ring path never
 *  touches it. Optional, it would type-check at a call site that forgot to pass
 *  one and then silently drop the substituted line's price — a $352 row landing
 *  at $0 with nothing to see. Required, the compiler names every call site. */
export function onPath(cost: BuildCost, path: IngredientPath, engine: CostEngine): BuildCost {
  return path === 'gp' ? applyGoldPath(cost, engine) : cost;
}

// --- Omni offers ----------------------------------------------------------

export type OmniOffer = {
  lineIndex: number;
  good: string; // the ingredient the Omni token would replace
  tier: string;
  substitute: string; // 'Omni Cube' | 'Omni Orb'
  substituteYear: number;
  quantity: number; // how many the line needs — the Omni figures are already x this
  lineAvg: number; // the line as authored, quantity included
  lineMin: number;
  omniAvg: number; // building that many Omni tokens instead
  omniMin: number;
  savesAvg: number; // line − omni, positive when the swap is cheaper
  savesMin: number;
  cheaper: boolean; // savesAvg > 0 — the PRICE argument for the swap
  /** False when the ingredient is itself a transmute whose own recipe has
   *  expired — it cannot be crafted at all any more, only bought second-hand.
   *  This is the AVAILABILITY argument, and it is the reason Omni tokens exist:
   *  they were introduced so that these older Relics could still be obtained.
   *  A swap can be worth surfacing on this ground while costing more. */
  ingredientCraftable: boolean;
  /** When the ingredient's own recipe expired, for the copy that explains why
   *  the swap is being offered at all. Null when it never expires or is not a
   *  transmute. */
  ingredientExpires: string | null;
};

/** A line's tier: its own recipe level when the ingredient is itself a
 *  transmute, otherwise the token category. Relics and Exalteds are
 *  transmutes; Ultra Rares are an auction category. */
function tierOf(l: PricedLine, engine: CostEngine): string {
  if (engine.isTransmute(l.good)) {
    const r = engine.resolveRecipe(l.good, l.nominalYear) ?? engine.resolveRecipe(l.good, engine.latestYear(l.good) ?? l.nominalYear);
    if (r) return r.level;
  }
  return l.category;
}

/**
 * Every line of a Legendary recipe an Omni token could stand in for, priced.
 *
 * Returns ALL eligible lines, not only the ones where the Omni token is
 * cheaper, and lets the caller choose which argument to make. Measured against
 * the live data, filtering on price alone would return nothing at all: crafting
 * an Omni Cube costs $777 while the dearest Relic line it could replace is
 * $651, and an Omni Orb is $421 against Ultra Rare lines of $60–112. §3.5's
 * `min(line, omni)` framing assumed the player would CRAFT the Omni token,
 * but the reason the game added them (§10.0) is availability: the Relic a
 * 2014 Legendary wants is no longer craftable at any price, and a Cube is the
 * way to fill that slot. `cheaper` and `ingredientCraftable` carry the two
 * arguments separately.
 *
 * The headline total is never touched — §3.5's "do not silently substitute" —
 * which is what keeps a quoted build cost explainable.
 *
 * The Omni recipe used is the most recent one, not one contemporary with the
 * host recipe: Omni tokens were introduced in 2024 precisely so that older,
 * no-longer-craftable Relics could still be obtained, so a 2014 Legendary's
 * suggestion has to price today's Omni Cube.
 */
export function omniOffersFor(cost: BuildCost, engine: CostEngine): OmniOffer[] {
  if (cost.level !== OMNI_HOST_LEVEL) return [];
  if (OMNI_EXCLUDED.has(cost.transmute)) return [];

  const offers: OmniOffer[] = [];
  for (const [lineIndex, l] of cost.lines.entries()) {
    if (l.quantity <= 0 || l.extAvg === null || l.extMin === null) continue;
    const tier = tierOf(l, engine);
    const substitute = OMNI_CUBE_TIERS.has(tier) ? OMNI_CUBE : OMNI_ORB_TIERS.has(tier) ? OMNI_ORB : null;
    if (!substitute || l.good === substitute) continue;

    const year = engine.latestYear(substitute);
    if (year === null) continue; // no Omni recipe authored yet
    const omni = engine.cost(substitute, year);
    if (!omni) continue;

    const omniAvg = omni.fullAvg * l.quantity;
    const omniMin = omni.fullMin * l.quantity;
    const ingredient = engine.isTransmute(l.good) ? engine.cost(l.good, l.nominalYear) : null;

    offers.push({
      lineIndex,
      good: l.good,
      tier,
      substitute,
      substituteYear: omni.year,
      quantity: l.quantity,
      lineAvg: l.extAvg,
      lineMin: l.extMin,
      omniAvg,
      omniMin,
      savesAvg: l.extAvg - omniAvg,
      savesMin: l.extMin - omniMin,
      cheaper: omniAvg < l.extAvg,
      ingredientCraftable: ingredient ? ingredient.status !== 'expired' : true,
      ingredientExpires: ingredient?.status === 'expired' ? ingredient.expires : null,
    });
  }
  // Cheaper offers first, then the ones that are only about availability.
  return offers.sort((a, b) => Number(b.cheaper) - Number(a.cheaper) || b.savesAvg - a.savesAvg);
}
