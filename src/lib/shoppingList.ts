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

import { TRADE_1 } from './data';
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
  | { kind: 'netted'; qty: number }
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

  /** Pick key (`${year}|${transmute}`) -> how many of this good that ONE pick
   *  accounts for, its own quantity already multiplied in. The pivot view's
   *  cells and nothing else; the sum over it is `quantity`.
   *
   *  Keyed by the pick rather than by the transmute NAME, unlike the `for` and
   *  `sourceFor` notes beside it. Two vintages of one transmute are two picks
   *  with two different bills and two columns, and a column headed by a name
   *  that stood for both would be summing things the reader chose separately.
   *  The notes keep their own merge because a sentence naming a token twice
   *  reads worse than one naming it once — a column cannot make that trade.
   *
   *  Source lines and ordinary fuel lines land in the SAME cell. The cell is a
   *  count of what that recipe consumes, and the row-level `isSource` already
   *  says the good is an upgrade source somewhere in the plan. */
  byPick: Readonly<Record<string, number>>;

  isSource: boolean;
  outOfPrint: boolean;
  /** Set on trade goods whose season average has gone stale — see
   *  `stalenessOf`. Null when the good is not flagged or cannot be measured. */
  staleness: Staleness | null;
  notes: ShoppingNote[];
};

/** A good the list asks the player to BUY that another pick in the list already
 *  CRAFTS, so they are being asked to buy something they are already making (D5).
 *  Usually an upgrade source; a craftable good burned as fuel counts too.
 *  Reported, never applied on its own: netting is one explicit, reversible
 *  toggle, because silently subtracting things is how a plan stops being
 *  checkable. */
export type ChainLink = {
  rowId: string;
  good: string;
  needed: number; // how many the list's lines ask for
  crafted: number; // how many the player is already making
  /** What turning the toggle on actually contributes to this row: the crafted
   *  ones, capped at what the row still lacks. Reported whether the toggle is
   *  on or off, so the offer and the applied state quote the same number.
   *
   *  The cap matters. Crafting two of something the list wants one of used to
   *  add BOTH to the row's on-hand, which then reported "1 spare" — a surplus
   *  the player does not own and cannot sell, invented by the toggle. Unlike
   *  D2's rule, nothing here is a number anyone typed. */
  netted: number;
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

/** One transmute the plan is working towards, for the takeaway list's heading
 *  and for the exports' preamble. The YEAR is carried because two vintages of
 *  one transmute are two different recipes with two different bills, and a
 *  summary that collapsed them would be summarising the wrong thing. */
export type ShoppingMaking = {
  /** The pick's own key, `${year}|${transmute}` — the one thing that matches a
   *  column to `ShoppingRow.byPick`. Carried rather than reassembled by the
   *  caller, so the two cannot drift apart on the separator. */
  key: string;
  transmute: string;
  displayName: string;
  year: number;
  qty: number;
};

export type ShoppingList = {
  trade: ShoppingRow[];
  additional: ShoppingRow[];
  /** Both tables in the final list's own order (D6). */
  all: ShoppingRow[];
  /** What the plan is FOR, in the order the reader added it — the same order
   *  the chips read in, because that is the order they built it in. Active
   *  picks only; a paused one is not being made. */
  making: ShoppingMaking[];
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
 *
 * So the test is not "is this a trade good" but "did S1 actually price it" --
 * and since the trade ladder was modelled properly those are different
 * questions. Every rung is a transmute, and the two that are never sold (Trade
 * 3's Fleece can be, Trade 5's Omni cannot) fall through to their BUILD cost,
 * which has none of the three properties this key assumes. A build has a
 * vintage: a 2024 Omni Orb costs $264.86 and a 2025 one $318.73, so merging
 * them on name alone would sum two different things. It moves with the basis,
 * unlike an S1 price. And it is not drawn from a closed vocabulary, so it grows
 * the table the trade section exists to keep bounded.
 */
export function mergesAsTradeGood(l: PricedLine): boolean {
  return isTradeCategory(l.category) && l.source !== 'build';
}

export function mergeKey(l: PricedLine): string {
  return mergesAsTradeGood(l) ? `T|${l.good}` : `A|${l.good}|${l.nominalYear}`;
}

type Draft = {
  row: ShoppingRow;
  wanted: Map<string, number>; // transmute -> quantity, for the "For X xN" notes
  sourceFor: Map<string, number>;
  /** pick key -> quantity, for the pivot view's cells. A THIRD accumulation
   *  rather than a regrouping of the two above: those split sources from fuel
   *  and merge the vintages together, and neither split is the one a column
   *  wants. Deriving the numbers from the notes would make a sentence's
   *  wording load-bearing for an arithmetic total. */
  byPick: Map<string, number>;
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
            section: mergesAsTradeGood(l) ? 'trade' : 'additional',
            nominalYear: mergesAsTradeGood(l) ? null : l.nominalYear,
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
            byPick: {},
            isSource: l.isSource,
            outOfPrint: isOutOfPrint(l, engine),
            staleness: null,
            notes: [],
          },
          wanted: new Map(),
          sourceFor: new Map(),
          byPick: new Map(),
        };
        drafts.set(id, d);
      }

      d.row.quantity += qty;
      d.byPick.set(pick.cost.key, (d.byPick.get(pick.cost.key) ?? 0) + qty);
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
    // The condition is "the list is crafting this good", nothing more. It used to
    // be gated on `isSource` as well, which worked only because every both-halves
    // pair happened to be an upgrade source -- a proxy, not the rule. A craftable
    // good consumed as FUEL is the same double-buy: 99 recipes burn a Golden
    // Fleece, none of them upgrades from one, and a reader picking the Fleece
    // recipe alongside a Legendary was still asked to buy the Fleece.
    const crafted = crafting.get(d.row.good) ?? 0;
    if (crafted === 0) continue;
    const typed = Math.max(0, onHand[d.row.id] ?? 0);
    chains.push({
      rowId: d.row.id,
      good: d.row.good,
      needed: d.row.quantity,
      crafted,
      netted: Math.min(crafted, Math.max(0, d.row.quantity - typed)),
    });
  }
  const netted = new Map(chains.map((c) => [c.rowId, c.netted]));

  const rows: ShoppingRow[] = [];
  for (const d of drafts.values()) {
    const r = d.row;
    const typed = Math.max(0, onHand[r.id] ?? 0);
    // What D5's toggle is adding to this row, if anything. Carried into the
    // notes rather than left implicit: the on-hand BOX shows what the player
    // typed, so without a note a netted row reads "on hand 0, needed 3, buy 1"
    // and the missing two are unaccounted for on screen.
    const nettedQty = netCraftedSources ? (netted.get(r.id) ?? 0) : 0;
    r.onHand = typed + nettedQty;

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

    r.notes = orderedNotes(r, d, nettedQty);
    r.byPick = Object.fromEntries(d.byPick);
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
    making: active.map((p) => ({
      key: p.cost.key,
      transmute: p.cost.transmute,
      displayName: p.cost.displayName,
      year: p.cost.year,
      qty: p.qty,
    })),
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
function orderedNotes(r: ShoppingRow, d: Draft, nettedQty: number): ShoppingNote[] {
  const out: ShoppingNote[] = [];
  if (r.overridden) out.push({ kind: 'adjusted' });
  for (const [transmute, qty] of [...d.sourceFor].sort()) out.push({ kind: 'sourceFor', transmute, qty });
  // Directly after the source notes, because it explains them: this row is a
  // source for something in the list, and the toggle has decided you are
  // making those rather than buying them.
  if (nettedQty > 0) out.push({ kind: 'netted', qty: nettedQty });
  for (const [transmute, qty] of [...d.wanted].sort()) out.push({ kind: 'for', transmute, qty });
  // `Priced as X` is dropped where the row's own category already says X.
  // TIER_PROXY holds exactly one entry today — Ultra Rare -> Ultra Rare — so
  // every note this vocabulary can currently produce sits beside a Category
  // cell reading the same words. The test is on the VALUE rather than a
  // deletion of the note, so a future proxy that named something else would
  // still be disclosed.
  const pricedAs = r.notes.find((n) => n.kind === 'pricedAs');
  if (pricedAs && pricedAs.good !== r.category) out.push(pricedAs);
  if (r.spare > 0) out.push({ kind: 'spare', qty: r.spare });
  if (r.outOfPrint && r.nominalYear !== null) {
    out.push({ kind: 'outOfPrint', years: [r.nominalYear, r.nominalYear + 1] });
  }
  return out;
}

// --- The 10x lot -----------------------------------------------------------

/**
 * Trade 1 tokens sell both singly and as **10x bundles** — ten of the token
 * mailed as one lot, to save postage — and `data.ts` records that most auctions
 * now list the bundle. Every price on this site is per single token, so the
 * list's arithmetic is right; what it does not say is that you cannot walk in
 * and buy twelve Alchemist's Inks. You buy two lots and end up with twenty.
 *
 * A HINT, deliberately, not a rounding rule: it never moves a total. Rounding
 * fourteen goods up to lots would inflate the plan by a third on a small list
 * and would be wrong for anyone buying singles, which auctions still sell.
 *
 * 8 of the 14 trade goods are Trade 1 — Alchemist's Ink, Alchemist's Parchment,
 * Darkwood Plank, Dwarven Steel, Enchanter's Munition, Minotaur Hide, Mystic
 * Silk, Philosopher's Stone. Trade 2-4 (Gold Bar, Aragonite, Elven Bismuth, Oil
 * of Enchantment, Golden Fleece, Wish Ring) do not bundle, so they get nothing.
 */
export const LOT_SIZE = 10;

export type LotHint = { lots: number; tokens: number; over: number };

/** Null when the row does not bundle or there is nothing left to buy. */
export function lotHintFor(row: ShoppingRow): LotHint | null {
  if (row.category !== TRADE_1 || row.need <= 0) return null;
  const lots = Math.ceil(row.need / LOT_SIZE);
  const tokens = lots * LOT_SIZE;
  return { lots, tokens, over: tokens - row.need };
}

// --- The pivot ------------------------------------------------------------

/**
 * The recipes one row actually belongs to, in the reader's own order.
 *
 * The pivot's columns are `list.making` — every active pick, whether or not a
 * given row touches it — so this is not what draws the matrix. It is what the
 * DEGENERATE case needs: measured over the real corpus the Additional Items
 * table is a diagonal (at 29 picked recipes, 31 of its 35 rows belong to
 * exactly one recipe and the matrix is 5% full), so that table names its one
 * owner in a single column instead of scrolling 29 mostly-empty ones. The
 * export's single-column form reads the same list.
 *
 * Trade goods are the opposite and are why the matrix exists at all: 12 to 14
 * of their 14 rows are wanted by more than one recipe at every plan size, and
 * the grid runs 42–64% full.
 */
export function recipesFor(
  row: ShoppingRow,
  making: readonly ShoppingMaking[],
): ShoppingMaking[] {
  return making.filter((m) => (row.byPick[m.key] ?? 0) > 0);
}

/** A pivot column's heading: the recipe and how many of it the plan is making.
 *  The ×N is the COPY COUNT, while the cells below it are totals with that
 *  count already multiplied in — one Ink line ×3 copies shows a column headed
 *  `×3` over a cell reading 15.
 *
 *  The EXPORTS' form. The screen sets the same two pieces on two lines, so the
 *  recipe name can wrap and the count sit under it — which no single string
 *  does. A test pins both forms to the same pair rather than to each other. */
export function pivotColumnLabel(m: ShoppingMaking): string {
  return `${m.displayName} ×${m.qty}`;
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
    case 'netted': return `${n.qty} counted as on hand — you're crafting ${n.qty === 1 ? 'it' : 'them'}`;
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
