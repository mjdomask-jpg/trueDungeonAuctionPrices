// The Shopping List — one quartermaster's question over many recipes.
//
// The Build Calculator answers "should I build THIS token or buy it?". This
// module answers a different one: across every transmute I plan to make, what
// do I still have to buy, and what will it cost? Players keep that in personal
// spreadsheets today, which is the shape the output is aimed at.
//
// Pure, like transmutes.ts: picks and the player's own numbers in, merged rows
// and totals out, no React and no fetching. Everything it knows about pricing
// it gets from the engine — there is no second pricing path here, by decision
// (D10), so the Build Calculator and this list can never quote a player two
// different numbers for the same ingredient.

import { isTradeCategory, type BuildCost, type CostEngine, type PricedLine } from './transmutes';
import { onPath, type IngredientPath } from './substitutions';

/** One transmute the player intends to make, and how many of it. */
export type ShoppingPick = { cost: BuildCost; qty: number };

/** Where a row belongs. Trade goods get their own table because they are the
 *  part that does NOT grow: 14 rows whether you pick one recipe or all 28 of
 *  2026's. Only `additional` grows, at roughly a row per recipe. */
export type ShoppingSection = 'trade' | 'additional';

/** A note on a row. The vocabulary is CLOSED and the render order is the order
 *  of this union — a free-text column mixing concepts cannot be filtered in a
 *  spreadsheet, which is where these rows are going to end up. */
export type ShoppingNote =
  | { kind: 'adjusted' }
  | { kind: 'sourceFor'; transmute: string; qty: number }
  | { kind: 'for'; transmute: string; qty: number }
  | { kind: 'pricedAs'; good: string }
  | { kind: 'spare'; qty: number }
  | { kind: 'outOfPrint'; years: number[] };

export type ShoppingRow = {
  /** Stable merge key. The player's on-hand counts and price overrides are
   *  keyed on it, so it must not depend on pick order or on how many recipes
   *  happen to want the row. */
  id: string;
  good: string;
  displayName: string;
  category: string;
  section: ShoppingSection;
  /** The vintage this row is for, or null on a trade good — which is exactly
   *  what makes trade goods merge on name alone (see `mergeKey`). */
  nominalYear: number | null;

  quantity: number; // total the picked recipes ask for
  onHand: number; // what the player typed, plus D5 netting when it is on
  need: number; // max(0, quantity - onHand) -- what to actually buy
  spare: number; // max(0, onHand - quantity) -- surplus, never clamped away

  unitAvg: number | null; // effective: the override when there is one
  unitMin: number | null;
  baseAvg: number | null; // what the engine said, before any override
  overridden: boolean;
  extAvg: number | null; // need x unitAvg
  extMin: number | null;

  isSource: boolean;
  outOfPrint: boolean;
  /** Set on trade goods whose season average has gone stale — see
   *  `stalenessOf`. Null when the good is not flagged or cannot be measured. */
  staleness: Staleness | null;
  notes: ShoppingNote[];
};

/** A recipe in the list whose SOURCE is another recipe in the list, so the
 *  player is being asked to buy something they are already crafting (D5).
 *  Reported, never applied on its own: netting is one explicit, reversible
 *  toggle, because silently subtracting things is how a plan stops being
 *  checkable. */
export type ChainLink = {
  rowId: string;
  good: string;
  needed: number; // how many the source lines ask for
  crafted: number; // how many the player is already making
};

export type ShoppingTotals = {
  tradeAvg: number;
  additionalAvg: number;
  grandAvg: number;
  /** D3: min is a footnote total ("$X at minimum prices"), not a column. */
  grandMin: number;
  rows: number;
  unpricedRows: number;
};

export type ShoppingList = {
  trade: ShoppingRow[];
  additional: ShoppingRow[];
  /** Both tables in the final list's own order (D6). */
  all: ShoppingRow[];
  chains: ChainLink[];
  totals: ShoppingTotals;
  /** Picks at quantity 0. They stay in the list as an explicit paused state
   *  rather than being dropped, so a player can park a recipe without losing
   *  where it sat. */
  paused: ShoppingPick[];
};

export type ShoppingOptions = {
  /** D7: one global Wish Ring / 15,000 GP choice, matching the Recipes view.
   *  Per-recipe would be a fourth axis on a page that already has three. */
  path?: IngredientPath;
  /** Row id -> count the player already owns. */
  onHand?: Readonly<Record<string, number>>;
  /** Row id -> the unit average the player says is right. */
  overrides?: Readonly<Record<string, number>>;
  /** D5: count the sources you are crafting as on hand. Off by default. */
  netCraftedSources?: boolean;
};

// --- Staleness (D1b) -----------------------------------------------------

export type Staleness = {
  seasonAvg: number;
  recentAvg: number;
  /** recentAvg / seasonAvg - 1. Signed: a good can go stale downwards. */
  divergence: number;
  saleCount: number;
};

/**
 * How far a trade good's recent sales have to diverge from its own season
 * average before the row says so.
 *
 * DERIVED, not chosen. Measured over every trade good in every priced season —
 * 117 good-seasons, 13 of the 14 goods (Golden Fleece has no auction rows at
 * all, so it can never be measured) — the divergences fall into two populations
 * with a wide empty band between them:
 *
 *   ordinary season noise      0% .. 27%
 *   sustained regime change   46% .. 100%
 *
 * Any cutoff in 20%..50% produces the IDENTICAL flag list for season 2026, so
 * the number is not load-bearing for what ships today; what it changes is how
 * often the flag fires historically (13.7% of good-seasons at 20%, 5.1% at
 * 50%). 35% sits on the flat middle of that range — 35, 40 and 45 all fire on
 * the same 8 good-seasons — and it is the smallest cutoff at which ONLY goods
 * with a sustained repricing fire: Enchanter's Munition 2020-2024, and Elven
 * Bismuth and Oil of Enchantment from 2025 on.
 *
 * The flag states a fact, never a forecast. Trade-good prices do NOT follow a
 * reliable seasonal sawtooth — measured by quarters the within-season change
 * runs -6%, -5%, +75%, +72%, +31%, +38%, +3%, +17% across 2019-2026 — so the
 * row may say "this one is moving" and must not say which way it will go.
 */
export const STALE_THRESHOLD = 0.35;

/**
 * Whether this good's current-season average is stale against its recent
 * sales, or null when the question cannot be asked.
 *
 * Null covers the cases that matter: a good with no auction rows in the season
 * at all (Golden Fleece, which prices off the hand-maintained table), and a
 * good whose last-5 window held no sale of it — `PriceIndex.pick` falls back to
 * the full-year stats there and reports `variant: 'full'`, so comparing the two
 * would compare a number with itself and report a confident 0%.
 */
export function stalenessOf(good: string, engine: CostEngine): Staleness | null {
  const season = engine.prices.latestPriced;
  const full = engine.prices.leafPrice(good, season, 'full');
  const recent = engine.prices.leafPrice(good, season, 'last5');
  if (!full || !recent) return null;
  if (full.source !== 'auction' || recent.variant !== 'last5') return null;
  if (full.seasonMapped || recent.seasonMapped) return null; // not this season's own data
  if (!full.stats.avg) return null;
  const divergence = recent.stats.avg / full.stats.avg - 1;
  if (Math.abs(divergence) < STALE_THRESHOLD) return null;
  return { seasonAvg: full.stats.avg, recentAvg: recent.stats.avg, divergence, saleCount: recent.stats.n };
}

// --- Merging -------------------------------------------------------------

/**
 * The merge key, and the one piece of this module that is a claim about the
 * data rather than a rendering choice.
 *
 * A trade good merges on its NAME ALONE, which is only sound because engine
 * rule S1 prices every trade good at the current season whatever recipe it
 * came from. Without that rule a 2019 recipe's Darkwood Plank and a 2026
 * recipe's would be two different prices under one name, and summing them
 * would be wrong rather than merely untidy.
 *
 * Everything else merges on name AND vintage, because for those the year is
 * part of the identity: in-print versus out-of-print is a function of it, and
 * a 2023 Ultra Rare genuinely is a different purchase from a 2025 one.
 */
export function mergeKey(l: PricedLine): string {
  return isTradeCategory(l.category) ? `T|${l.good}` : `A|${l.good}|${l.nominalYear}`;
}

type Draft = {
  row: ShoppingRow;
  wanted: Map<string, number>; // transmute -> quantity, for the "For X xN" notes
  sourceFor: Map<string, number>;
};

/**
 * Build the list.
 *
 * `engine` supplies the price index (for staleness) and nothing else — every
 * price on every row has already been computed by it, on the picks handed in.
 */
export function buildShoppingList(
  picks: readonly ShoppingPick[],
  engine: CostEngine,
  opts: ShoppingOptions = {},
): ShoppingList {
  const { path = 'ring', onHand = {}, overrides = {}, netCraftedSources = false } = opts;

  const active = picks.filter((p) => p.qty > 0);
  const paused = picks.filter((p) => p.qty <= 0);

  // What the player is already making, for D5. Keyed by transmute name: a
  // source line names the token, and which season's recipe built it is not
  // something the player is choosing between here.
  const crafting = new Map<string, number>();
  for (const p of active) crafting.set(p.cost.transmute, (crafting.get(p.cost.transmute) ?? 0) + p.qty);

  const drafts = new Map<string, Draft>();

  for (const pick of active) {
    // The Wish Ring choice is applied HERE rather than by the caller so that
    // the quantities being merged are the ones actually being bought. On the
    // GP path the ring line survives at quantity 0 (substitutions.ts keeps the
    // line count stable), and a zero-quantity line adds nothing to a merge.
    const cost = onPath(pick.cost, path);
    for (const l of cost.lines) {
      if (l.quantity <= 0) continue;
      const id = mergeKey(l);
      const qty = l.quantity * pick.qty;

      let d = drafts.get(id);
      if (!d) {
        d = {
          row: {
            id,
            good: l.good,
            displayName: l.displayName,
            // D4: a source is one Additional Item priced at its build cost,
            // and it does NOT recurse — its own bill of materials is the
            // Build Calculator's business, not the shopping list's.
            category: l.isSource || l.source === 'build' ? 'Transmute' : l.category,
            section: isTradeCategory(l.category) ? 'trade' : 'additional',
            nominalYear: isTradeCategory(l.category) ? null : l.nominalYear,
            quantity: 0,
            onHand: 0,
            need: 0,
            spare: 0,
            unitAvg: l.unitAvg,
            unitMin: l.unitMin,
            baseAvg: l.unitAvg,
            overridden: false,
            extAvg: null,
            extMin: null,
            isSource: l.isSource,
            outOfPrint: isOutOfPrint(l, engine),
            staleness: null,
            notes: [],
          },
          wanted: new Map(),
          sourceFor: new Map(),
        };
        drafts.set(id, d);
      }

      d.row.quantity += qty;
      // A row can be a source on one recipe and plain fuel on another (the
      // 2024 Safehold III case), so `isSource` is true if it is ever one.
      if (l.isSource) {
        d.row.isSource = true;
        d.sourceFor.set(cost.transmute, (d.sourceFor.get(cost.transmute) ?? 0) + qty);
      } else {
        d.wanted.set(cost.transmute, (d.wanted.get(cost.transmute) ?? 0) + qty);
      }
      if (l.pricedAs && l.pricedAs !== l.good && !d.row.notes.some((n) => n.kind === 'pricedAs')) {
        d.row.notes.push({ kind: 'pricedAs', good: l.pricedAs });
      }
    }
  }

  // Chain detection runs over the finished rows, not per pick: the question is
  // whether the LIST contains both halves of a pair, which no single pick knows.
  const chains: ChainLink[] = [];
  for (const d of drafts.values()) {
    if (!d.row.isSource) continue;
    const crafted = crafting.get(d.row.good) ?? 0;
    if (crafted > 0) chains.push({ rowId: d.row.id, good: d.row.good, needed: d.row.quantity, crafted });
  }
  const netted = new Map(chains.map((c) => [c.rowId, c.crafted]));

  const rows: ShoppingRow[] = [];
  for (const d of drafts.values()) {
    const r = d.row;
    const typed = Math.max(0, onHand[r.id] ?? 0);
    r.onHand = typed + (netCraftedSources ? (netted.get(r.id) ?? 0) : 0);

    const override = overrides[r.id];
    if (override !== undefined && isFinite(override)) {
      r.overridden = true;
      r.unitAvg = override;
      // An override says "this is what it really costs me", so it moves the
      // min as well -- otherwise the footnote total would quote a market
      // minimum for a line the player has already told us the price of.
      r.unitMin = override;
    }

    // D2: on hand does NOT clamp. Deliberately unlike the calculator: a stash
    // is a fact about the player, not about the plan, and clamping destroys a
    // typed number the moment a recipe is removed from the list.
    r.need = Math.max(0, r.quantity - r.onHand);
    r.spare = Math.max(0, r.onHand - r.quantity);
    r.extAvg = r.unitAvg === null ? null : r.unitAvg * r.need;
    r.extMin = r.unitMin === null ? null : r.unitMin * r.need;
    if (r.section === 'trade') r.staleness = stalenessOf(r.good, engine);

    r.notes = orderedNotes(r, d);
    rows.push(r);
  }

  const trade = rows.filter((r) => r.section === 'trade').sort(byItem);
  const additional = rows.filter((r) => r.section === 'additional').sort(byCategoryThenItem);

  // D6: the final list gets its OWN order -- every trade good first, purely
  // alphabetical with the Trade 1/2/3/4 rungs intermixed, then everything else
  // by category. `lib/categories.ts`'s CATEGORY_ORDER is deliberately NOT
  // extended to cover this: Prices, Compare and Explorer all read it, and it
  // omits Trade 3/4, which would split the trade goods across the table.
  const all = [...trade, ...additional];

  const sum = (xs: ShoppingRow[], f: (r: ShoppingRow) => number | null) =>
    xs.reduce((t, r) => t + (f(r) ?? 0), 0);

  return {
    trade,
    additional,
    all,
    chains,
    paused,
    totals: {
      tradeAvg: sum(trade, (r) => r.extAvg),
      additionalAvg: sum(additional, (r) => r.extAvg),
      grandAvg: sum(all, (r) => r.extAvg),
      grandMin: sum(all, (r) => r.extMin),
      rows: all.length,
      unpricedRows: all.filter((r) => r.unitAvg === null).length,
    },
  };
}

/** An Ultra Rare vintage that can no longer be bought from a current lot. The
 *  in-print boundary is the engine's own (rule S2): a season-Y token comes out
 *  of season Y or Y+1, so anything older than `latestPriced - 1` is off the
 *  secondary market now. Only Ultra Rares carry the tag — every other row is
 *  either fungible or a transmute the player builds. */
function isOutOfPrint(l: PricedLine, engine: CostEngine): boolean {
  if (l.category !== 'Ultra Rare' && l.good !== 'Ultra Rare') return false;
  return l.nominalYear < engine.prices.latestPriced - 1;
}

/** The closed vocabulary, always in this order. */
function orderedNotes(r: ShoppingRow, d: Draft): ShoppingNote[] {
  const out: ShoppingNote[] = [];
  if (r.overridden) out.push({ kind: 'adjusted' });
  for (const [transmute, qty] of [...d.sourceFor].sort()) out.push({ kind: 'sourceFor', transmute, qty });
  for (const [transmute, qty] of [...d.wanted].sort()) out.push({ kind: 'for', transmute, qty });
  const pricedAs = r.notes.find((n) => n.kind === 'pricedAs');
  if (pricedAs) out.push(pricedAs);
  if (r.spare > 0) out.push({ kind: 'spare', qty: r.spare });
  if (r.outOfPrint && r.nominalYear !== null) {
    out.push({ kind: 'outOfPrint', years: [r.nominalYear, r.nominalYear + 1] });
  }
  return out;
}

// --- Wording -------------------------------------------------------------

/**
 * One note as the reader sees it.
 *
 * Here rather than in a component because the SAME strings go into the Copy
 * and Download CSV paths, and a spreadsheet whose Notes column disagreed with
 * the page would be worse than one with no notes at all. The vocabulary being
 * closed is the point (a free-text column cannot be filtered), so its rendering
 * is closed too.
 */
export function noteLabel(n: ShoppingNote): string {
  switch (n.kind) {
    case 'adjusted': return 'Price adjusted';
    case 'sourceFor': return `Source for ${n.transmute} ×${n.qty}`;
    case 'for': return `For ${n.transmute} ×${n.qty}`;
    case 'pricedAs': return `Priced as ${n.good}`;
    case 'spare': return `${n.qty} spare`;
    case 'outOfPrint': return 'Out of print';
  }
}

/** The staleness row's sentence. States a FACT and stops: the measured season
 *  average, the measured recent one, and that the good is moving. It must not
 *  say which way it will go next — trade-good prices do not follow a reliable
 *  seasonal shape, and a page that guessed would be read as a forecast. */
export function stalenessNote(s: Staleness, money: (n: number) => string): string {
  return `season avg ${money(s.seasonAvg)} · recent sales ${money(s.recentAvg)} — this one is moving`;
}

const byItem = (a: ShoppingRow, b: ShoppingRow) => a.displayName.localeCompare(b.displayName);

const byCategoryThenItem = (a: ShoppingRow, b: ShoppingRow) =>
  a.category.localeCompare(b.category) || byItem(a, b);
