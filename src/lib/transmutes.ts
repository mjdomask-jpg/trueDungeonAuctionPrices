// Transmute cost engine (Phase 4) — the build-vs-buy computation.
//
// Players craft ("transmute") higher-tier tokens from cheaper ones. Transmutes
// are never sold at auction, so every recipe bottoms out in tokens that ARE
// priced: auction sales, the hand-maintained off-auction table, or a derived
// rule. Strict tier ordering makes the graph acyclic, so a memoized recursion
// terminates. Design: docs/expansion-plan.md §3.2–§4.4.
//
// This module is pure: it takes parsed rows in and returns numbers out, with no
// React and no fetching, matching the data.ts seam.

import { parseCSV, aggregateSeason, seasonsOf, dateKey, type Sale, type ItemRow, type Stats, type AuctionMeta } from './data';
import { statusOf, windowOf, expiryOf, todayISO, type PricingWindow, type RecipeStatus } from './recipeWindows';

// --- Types ---------------------------------------------------------------

export type RecipeLine = {
  good: string; // canonical name
  goodYear: string; // raw authored value: '' | '-1' | '2023'
  nominalYear: number; // goodYear resolved against the recipe's own year
  quantity: number;
  isSource: boolean; // the token being upgraded FROM, not consumed as fuel
  // Optional `IngredientType`, from the existing Category vocabulary. It lets
  // a line name the ACTUAL token it needs (Item = "Ymir's Bane",
  // IngredientType = "Ultra Rare") while still pricing as the generic tier
  // when that specific token has never been auctioned — which is the case for
  // every named Ultra Rare, since auctions sell the tier itself (§3.4).
  ingredientType: string;
};

export type Recipe = {
  key: string; // `${year}|${transmute}`
  year: number;
  level: string;
  transmute: string;
  // Raw authored `Expires` value, one per recipe: '' | 'never' | 'YYYY-MM-DD'.
  // Optional column — blank means the standard rule for the level, so the
  // engine is correct before the sheet is touched (see recipeWindows.ts).
  expires: string;
  lines: RecipeLine[];
};

export type TokenMeta = {
  year: number;
  canonicalName: string;
  displayName: string;
  tokenCategory: string;
};

export type OffAuctionPrice = {
  year: number;
  good: string;
  displayName: string;
  category: string;
  stats: Stats;
};

export type DerivedRule = {
  token: string; // canonical name of the derived token
  derivedFrom: string; // canonical name of the parent
  ratio: number; // how many `token` make one `derivedFrom`
  /** The inverse relationship, for a token WORTH MORE than its parent: how many
   *  `derivedFrom` make one `token`. Authored as the `Multiple` column and null
   *  when the row uses `Ratio` instead.
   *
   *  It is a second field rather than a fractional `Ratio` because the two are
   *  not the same arithmetic. A 25,000 GP Eldritch Ore Bar is twenty-five Gold
   *  Bars, which as a ratio is 0.04 — and `x / 0.04` is not `x * 25`: they
   *  disagree in the last bits for about a quarter of money values, and for a
   *  half of them at `0.2` versus `× 5`. Sub-cent either way, but a price this
   *  file exists to make EXACT (the goods are fungible, so the bar's price is
   *  the multiple, not an estimate of it) should not arrive with float noise
   *  on it. Writing `Multiple 25` also reads as what it is; `Ratio 0.04` does
   *  not.
   *
   *  `Ratio` keeps dividing, untouched, so the Monster Trophy row's numbers do
   *  not shift by a last bit either. */
  multiple: number | null;
  year: number | null; // null = applies to every season; a year overrides it
  bound: string; // 'ceiling' — the value is an upper bound, not a measurement
};

// --- Parsers -------------------------------------------------------------
// The recipe sheet carries `ResolvedYear` and `Display Name` as authoring
// aids. Both are DELIBERATELY IGNORED here and re-derived, so a stale formula
// column in the sheet can never poison the site (§4.2).

function toObjects(rows: string[][]): Record<string, string>[] {
  const header = rows[0].map((h) => h.trim().replace(/^﻿/, ''));
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

// `ItemYear`: blank = the recipe's own season; a signed offset is relative to
// the recipe's Year (so it never shifts meaning as seasons pass); a bare year
// is pinned. The <1900 test distinguishes an offset from an absolute year.
export function resolveGoodYear(goodYear: string, recipeYear: number): number {
  const g = goodYear.trim();
  if (g === '') return recipeYear;
  const n = Number(g);
  if (!isFinite(n)) return recipeYear;
  return Math.abs(n) < 1900 ? recipeYear + n : n;
}

export function parseRecipes(text: string): Recipe[] {
  const objs = toObjects(parseCSV(text));
  const byKey = new Map<string, Recipe>();
  for (const o of objs) {
    const year = parseInt(o['Year'], 10);
    const transmute = o['Transmute'];
    const good = o['Item'];
    const quantity = parseInt(o['Quantity'], 10);
    if (!transmute || !good || !isFinite(year) || !isFinite(quantity)) continue;

    const key = `${year}|${transmute}`;
    let recipe = byKey.get(key);
    if (!recipe) {
      recipe = { key, year, level: o['Level'], transmute, expires: '', lines: [] };
      byKey.set(key, recipe);
    }
    // `Expires` is a per-recipe value living on recipe rows. Taking the first
    // non-blank one tolerates the sheet's usual habits (authored on the first
    // line, or filled down the block); the validator flags disagreement.
    if (!recipe.expires) recipe.expires = (o['Expires'] ?? '').trim();
    const goodYear = o['ItemYear'] ?? '';
    recipe.lines.push({
      good,
      goodYear,
      nominalYear: resolveGoodYear(goodYear, year),
      quantity,
      isSource: (o['IsSource'] || '').toUpperCase() === 'TRUE',
      ingredientType: (o['IngredientType'] ?? '').trim(),
    });
  }
  return [...byKey.values()];
}

export function parseTokenMetadata(text: string): TokenMeta[] {
  const objs = toObjects(parseCSV(text));
  const out: TokenMeta[] = [];
  for (const o of objs) {
    // Columns match prices.csv (the source of truth for token identity):
    // auctionSeason, Item, Display Name, Category — plus the authoring key.
    const year = parseInt(o['auctionSeason'], 10);
    if (!o['Item'] || !isFinite(year)) continue;
    out.push({
      year,
      canonicalName: o['Item'],
      displayName: o['Display Name'] || o['Item'],
      tokenCategory: o['Category'],
    });
  }
  return out;
}

const money = (s: string) => parseFloat((s || '').replace(/[$,]/g, ''));

// The off-auction table is general, not a Fleece special case (§3.3): Fleece,
// Stalker and Herald tokens all live here with full max/avg/min.
export function parseOffAuctionPrices(text: string): OffAuctionPrice[] {
  const objs = toObjects(parseCSV(text));
  const out: OffAuctionPrice[] = [];
  for (const o of objs) {
    const year = parseInt(o['Year'], 10);
    const avg = money(o['avg Price']);
    if (!o['Item'] || !isFinite(year) || !isFinite(avg)) continue;
    const max = money(o['max Price']);
    const min = money(o['min Price']);
    out.push({
      year,
      good: o['Item'],
      displayName: o['Display Name'] || o['Item'],
      category: o['Category'],
      // n = 0 marks these as hand-maintained rather than observed sales.
      stats: { n: 0, min: isFinite(min) ? min : avg, max: isFinite(max) ? max : avg, avg },
    });
  }
  return out;
}

export function parseDerivedRules(text: string): DerivedRule[] {
  const objs = toObjects(parseCSV(text));
  const out: DerivedRule[] = [];
  for (const o of objs) {
    // Exactly one of the two columns, and a row carrying both is skipped rather
    // than resolved by precedence: they express opposite relationships, so a
    // row with both is an authoring mistake and guessing which was meant is how
    // a price ends up 625x out.
    const ratio = Number(o['Ratio']);
    const multiple = Number(o['Multiple']);
    const hasRatio = !!(o['Ratio'] ?? '').trim() && isFinite(ratio) && ratio > 0;
    const hasMultiple = !!(o['Multiple'] ?? '').trim() && isFinite(multiple) && multiple > 0;
    if (!o['Token'] || !o['DerivedFrom'] || hasRatio === hasMultiple) continue;
    const year = parseInt(o['Year'], 10);
    out.push({
      token: o['Token'],
      derivedFrom: o['DerivedFrom'],
      ratio: hasRatio ? ratio : 1 / multiple,
      multiple: hasMultiple ? multiple : null,
      year: isFinite(year) ? year : null,
      bound: (o['Bound'] || '').toLowerCase(),
    });
  }
  return out;
}

// --- Price index ---------------------------------------------------------

export type PriceSource = 'auction' | 'offAuction' | 'derived' | 'build';

/** How the stats behind a price were aggregated (§10.2):
 *  - `season` — one season's sales, the original behaviour and what every
 *    ACTIVE recipe uses, since it prices at today's prices (D3);
 *  - `window` — the exact date range an EXPIRED recipe could be built in;
 *  - `pool` — two seasons unioned, for a blank Ultra Rare line (D4). */
export type PriceBasis = 'season' | 'window' | 'pool';

export type LeafPrice = {
  stats: Stats;
  source: PriceSource;
  pricedYear: number;
  variant: 'full' | 'last5';
  seasonMapped: boolean; // priced from a different season than asked for
  bound: string; // 'ceiling' when the value is an upper bound (§4.3)
  basis: PriceBasis;
  window?: PricingWindow; // set when basis is 'window'
  poolYears?: number[]; // set when basis is 'pool'
  pricedAs?: string; // the token actually priced, when it is not the one asked for
  datelessSales: number; // sales admitted by the D5 season fallback, not a date
};

export type SeasonMapping = { season: number; variant: 'full' | 'last5'; mapped: boolean };

/** One item's aggregate inside a date window. `dateless` counts the sales that
 *  got in through D5's season fallback rather than a real close date. */
type WindowRow = { stats: Stats; dateless: number };

/** Straight union of sales — E1's decision for the D4 pool, and the same
 *  aggregation a window uses. Measured before choosing: a union and a mean of
 *  season aggregates differ by at most 3.4% and typically under 1%, and the
 *  union is one code path rather than two. */
function statsOf(prices: number[]): Stats {
  const sum = prices.reduce((a, b) => a + b, 0);
  return { n: prices.length, min: Math.min(...prices), max: Math.max(...prices), avg: sum / prices.length };
}

export class PriceIndex {
  private auction = new Map<string, ItemRow>(); // `${year}|${item}`
  private offAuction = new Map<string, OffAuctionPrice>();
  private derived = new Map<string, DerivedRule>(); // token, and `${token}|${year}`
  private meta = new Map<string, TokenMeta>();
  private goodYears = new Map<string, number[]>(); // good -> seasons that price it
  private closeByAuction = new Map<string, string>(); // auctionId -> ISO close date
  private seasonStarts = new Map<number, string>(); // season -> its first close date
  private sales: Sale[]; // kept for the date-windowed aggregation below
  private windowCache = new Map<string, Map<string, WindowRow>>(); // `from|to` -> item -> row
  readonly pricedSeasons: number[];
  readonly earliestPriced: number;
  readonly latestPriced: number;

  constructor(
    sales: Sale[],
    offAuction: OffAuctionPrice[] = [],
    derived: DerivedRule[] = [],
    meta: TokenMeta[] = [],
    // Auction close dates, for the date-windowed pricing expired recipes use
    // (§10.2). Optional: without it every recipe simply prices by season, which
    // is what the page did before the accuracy release.
    auctions: AuctionMeta[] = [],
  ) {
    this.sales = sales;
    const seasons = seasonsOf(sales).map(Number).sort((a, b) => a - b);
    this.pricedSeasons = seasons;
    this.earliestPriced = seasons[0];
    this.latestPriced = seasons[seasons.length - 1];
    for (const season of seasons) {
      for (const row of aggregateSeason(sales, String(season))) {
        this.auction.set(`${season}|${row.item}`, row);
      }
    }
    for (const p of offAuction) this.offAuction.set(`${p.year}|${p.good}`, p);
    for (const d of derived) this.derived.set(d.year === null ? d.token : `${d.token}|${d.year}`, d);
    for (const m of meta) this.meta.set(`${m.year}|${m.canonicalName}`, m);

    // A season's window starts at its FIRST AUCTION, not Jan 1 (D2): season
    // 2026 opened 2025-09-25 and 73% of its sales closed in 2025. Keyed off
    // close dates because that is what a sale is dated by.
    for (const a of auctions) {
      const close = dateKey(a.closeDate);
      if (!close) continue;
      this.closeByAuction.set(a.auctionId, close);
      const season = Number(a.season);
      const known = this.seasonStarts.get(season);
      if (!known || close < known) this.seasonStarts.set(season, close);
    }
  }

  /** First auction close date of a season, or null when it has no dated
   *  auctions. Bound as a SeasonStart for recipeWindows.ts. */
  seasonStart = (season: number): string | null => this.seasonStarts.get(season) ?? null;

  /** Close date of the auction a sale belongs to, '' when undated (D5). */
  saleDate(sale: Sale): string {
    return this.closeByAuction.get(sale.auctionId) ?? '';
  }

  // Season fallback (§4.4). Clamps a nominal season into the range that has
  // data: below → earliest full-year; above → latest last-5, because a preview
  // season is a forward estimate and recent auctions predict it best. Stated as
  // a rule so it self-heals as seasons roll.
  pricingSeason(nominal: number): SeasonMapping {
    if (nominal < this.earliestPriced) return { season: this.earliestPriced, variant: 'full', mapped: true };
    if (nominal > this.latestPriced) return { season: this.latestPriced, variant: 'last5', mapped: true };
    return { season: nominal, variant: 'full', mapped: false };
  }

  displayName(good: string, year: number): string {
    // Display names are season-dependent, so resolve against the line's own
    // resolved season or every multi-season row reads as this year's name.
    const m = this.meta.get(`${year}|${good}`);
    if (m) return m.displayName;
    const a = this.auction.get(`${year}|${good}`);
    if (a?.displayName) return a.displayName;
    const o = this.offAuction.get(`${year}|${good}`);
    return o?.displayName || good;
  }

  category(good: string, year: number): string {
    return this.meta.get(`${year}|${good}`)?.tokenCategory
      ?? this.auction.get(`${year}|${good}`)?.category
      ?? '';
  }

  /** Every sale of every item inside a date window, aggregated once and
   *  memoized BY WINDOW — not by recipe. The 71 expired recipes share only 13
   *  distinct windows (recipes of the same year and expiry rule produce the
   *  same range), so this runs a handful of times rather than once per recipe. */
  private rowsInWindow(w: PricingWindow): Map<string, WindowRow> {
    const key = `${w.from}|${w.to}`;
    const hit = this.windowCache.get(key);
    if (hit) return hit;

    const byItem = new Map<string, { prices: number[]; dateless: number }>();
    for (const sale of this.sales) {
      const date = this.saleDate(sale);
      let dateless = false;
      if (date) {
        if (date < w.from || date > w.to) continue;
      } else {
        // D5: an auction with no close date contributes through its SEASON,
        // decided per auction row rather than per season or by a hardcoded
        // year gate. The 2026-08-14 date backfill left this with no live case
        // (0 of 7,721 sales), but a future season can still arrive undated,
        // and keeping the fallback means windowed pricing self-heals.
        if (!this.seasonInWindow(Number(sale.season), w)) continue;
        dateless = true;
      }
      let bucket = byItem.get(sale.item);
      if (!bucket) { bucket = { prices: [], dateless: 0 }; byItem.set(sale.item, bucket); }
      bucket.prices.push(sale.price);
      if (dateless) bucket.dateless++;
    }

    const rows = new Map<string, WindowRow>();
    for (const [item, b] of byItem) rows.set(item, { stats: statsOf(b.prices), dateless: b.dateless });
    this.windowCache.set(key, rows);
    return rows;
  }

  /** Two (or more) whole seasons unioned. Ultra Rares are only available in a
   *  two-year window and are priced by the secondary market afterwards, with
   *  the auction price as the baseline the site can report -- so a blank UR
   *  line holds its era's baseline while the trade goods around it float to
   *  today (D4). A straight union of sales, per E1. */
  private rowsInSeasons(seasons: number[]): Map<string, WindowRow> {
    const key = `S${seasons.join(',')}`;
    const hit = this.windowCache.get(key);
    if (hit) return hit;
    const wanted = new Set(seasons.map(String));
    const byItem = new Map<string, number[]>();
    for (const sale of this.sales) {
      if (!wanted.has(sale.season)) continue;
      const bucket = byItem.get(sale.item);
      if (bucket) bucket.push(sale.price);
      else byItem.set(sale.item, [sale.price]);
    }
    const rows = new Map<string, WindowRow>();
    for (const [item, prices] of byItem) rows.set(item, { stats: statsOf(prices), dateless: 0 });
    this.windowCache.set(key, rows);
    return rows;
  }

  /** Price a good over a pool of whole seasons. Null when none of them sold
   *  it, which is the signal to fall back to the ordinary season path. */
  poolPrice(good: string, seasons: number[]): LeafPrice | null {
    const row = this.rowsInSeasons(seasons).get(good);
    if (!row) return null;
    return {
      stats: row.stats, source: 'auction', pricedYear: seasons[0], variant: 'full',
      seasonMapped: false, bound: '', basis: 'pool', poolYears: seasons, datelessSales: 0,
    };
  }

  /** Whether an UNDATED auction's season counts as inside a window. Uses the
   *  season's own first close date when its dated siblings supply one, and
   *  falls back to comparing calendar years when the whole season is undated. */
  private seasonInWindow(season: number, w: PricingWindow): boolean {
    if (!isFinite(season)) return false;
    const start = this.seasonStarts.get(season);
    if (start) return start >= w.from && start <= w.to;
    return season >= Number(w.from.slice(0, 4)) && season <= Number(w.to.slice(0, 4));
  }

  private pick(row: ItemRow, variant: 'full' | 'last5'): { stats: Stats; variant: 'full' | 'last5' } {
    // last5 is null when the item had no sales in the season's final five
    // auctions — fall back to full-year rather than reporting no price.
    if (variant === 'last5' && row.last5) return { stats: row.last5, variant: 'last5' };
    return { stats: row.full, variant: 'full' };
  }

  // Direct lookup in one specific season, no fallback. Order: auction sales →
  // hand-maintained off-auction table → derived rule. NOTE this puts
  // off-auction AHEAD of derived, so that adding real Monster Trophy rows to
  // the off-auction table automatically supersedes the Fleece÷10 ceiling.
  private directLookup(good: string, year: number, variant: 'full' | 'last5', window?: PricingWindow): LeafPrice | null {
    // A window, when one applies, is consulted before the season tables: it is
    // a strictly more precise aggregation of the same auction sales.
    if (window) {
      const row = this.rowsInWindow(window).get(good);
      if (row) {
        return {
          stats: row.stats, source: 'auction', pricedYear: year, variant: 'full',
          seasonMapped: false, bound: '', basis: 'window', window, datelessSales: row.dateless,
        };
      }
    }
    const a = this.auction.get(`${year}|${good}`);
    if (a) {
      const p = this.pick(a, variant);
      return { stats: p.stats, source: 'auction', pricedYear: year, variant: p.variant, seasonMapped: false, bound: '', basis: 'season', datelessSales: 0 };
    }
    const o = this.offAuction.get(`${year}|${good}`);
    if (o) {
      return { stats: o.stats, source: 'offAuction', pricedYear: year, variant: 'full', seasonMapped: false, bound: '', basis: 'season', datelessSales: 0 };
    }
    const rule = this.derived.get(`${good}|${year}`) ?? this.derived.get(good);
    if (rule) {
      // CYCLE GUARD (§4.3): a derived price reads the parent's MARKET price and
      // must never call buildCost(parent). Fleece's own recipe is 10 × Monster
      // Trophy while a Trophy prices off Fleece — recursion here would loop.
      const parent = this.leafPrice(rule.derivedFrom, year, variant, window);
      if (!parent) return null;
      const s = parent.stats;
      // Multiply where the row said `Multiple`, divide where it said `Ratio` —
      // see DerivedRule.multiple. All three of min/max/avg scale, so a bar's
      // whole distribution is its parent's, which is what fungibility means.
      const scale = rule.multiple === null
        ? (v: number) => v / rule.ratio
        : (v: number) => v * rule.multiple!;
      return {
        stats: { n: s.n, min: scale(s.min), max: scale(s.max), avg: scale(s.avg) },
        source: 'derived',
        pricedYear: parent.pricedYear,
        variant: parent.variant,
        seasonMapped: parent.seasonMapped,
        bound: rule.bound || parent.bound,
        basis: parent.basis,
        window: parent.window,
        datelessSales: parent.datelessSales,
      };
    }
    return null;
  }

  // Price a leaf token for a nominal season. The season clamp is consulted only
  // when the direct lookup misses (§4.4), so real data always wins — a 2027
  // recipe can mix a real 2027 Fleece price with 2026-last5 trade goods.
  // Every season this good is priced in, from any table, ascending. Built
  // lazily because only the last-resort fallback below needs it.
  private yearsPricing(good: string): number[] {
    const cached = this.goodYears.get(good);
    if (cached) return cached;
    const years = new Set<number>();
    for (const map of [this.auction, this.offAuction] as Map<string, unknown>[]) {
      for (const key of map.keys()) {
        const bar = key.indexOf('|');
        if (key.slice(bar + 1) === good) years.add(Number(key.slice(0, bar)));
      }
    }
    const sorted = [...years].sort((a, b) => a - b);
    this.goodYears.set(good, sorted);
    return sorted;
  }

  // Nearest season that actually prices THIS good. Ties go to the later
  // season, matching pricingSeason's view that recent auctions predict best.
  private nearestPricedYear(good: string, target: number): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const y of this.yearsPricing(good)) {
      const d = Math.abs(y - target);
      if (d < bestDist || (d === bestDist && best !== null && y > best)) { best = y; bestDist = d; }
    }
    return best;
  }
  leafPrice(
    good: string,
    nominalYear: number,
    variant: 'full' | 'last5' = 'full',
    window?: PricingWindow,
  ): LeafPrice | null {
    const direct = this.directLookup(good, nominalYear, variant, window);
    if (direct) return direct;

    // Past here a window, if there was one, found nothing and the line falls
    // back to the season basis. That is the defensive fallback §10.1 asked
    // for, and it has a real case: the 12 pre-2018 expired recipes have
    // windows (2012-01-01 .. 2013-11-24 and friends) holding no auctions at
    // all, because auction data starts in 2018.

    const mapped = this.pricingSeason(nominalYear);
    if (mapped.season !== nominalYear) {
      const fallback = this.directLookup(good, mapped.season, mapped.variant);
      if (fallback) return { ...fallback, seasonMapped: true };
    }

    // Last resort: PER-GOOD year coverage, which is narrower than the season
    // coverage the clamp above reasons about. The hand-maintained off-auction
    // table starts at its own year per token, so a season can carry plenty of
    // auction data and still price nothing for this good. That is how adding
    // the 2018 auction season silently unpriced Golden Fleece on the 18
    // pre-2019 Legendaries: it moved earliestPriced 2019 -> 2018, and the
    // off-auction table's first Fleece row is 2019. Walking to the nearest
    // season that prices the good keeps those lines estimated-but-priced
    // instead of dropping them out of the total entirely.
    const nearest = this.nearestPricedYear(good, nominalYear);
    if (nearest === null || nearest === nominalYear) return null;
    const near = this.directLookup(good, nearest, 'full');
    return near ? { ...near, seasonMapped: true } : null;
  }
}

/**
 * Tiers that are themselves auctioned, so a named member of the tier can be
 * priced by the tier when the token itself has no sales of its own.
 *
 * Only Ultra Rare qualifies today, and not by coincidence: the tier and the
 * token share one canonical name — literally `Ultra Rare` — because auctions
 * sell "an Ultra Rare" rather than a specific one (§4.1). Written as a map
 * anyway, because the moment a second tier is sold generically the rule is
 * already here.
 */
export const TIER_PROXY: Readonly<Record<string, string>> = { 'Ultra Rare': 'Ultra Rare' };

/**
 * Whether a category names a trade good — the fungible crafting materials
 * (`Trade 1` .. `Trade 4` today; there are exactly 14 of them across all 174
 * recipes, and 8 of those are Trade 1).
 *
 * A pattern rather than a list because the rungs are a game ladder that grows:
 * a Trade 5 good would otherwise price on the wrong rule until someone
 * remembered to edit a constant. Exported because the engine's pricing rule
 * S1 and the Shopping List's merge key are the SAME question asked twice --
 * "trade goods merge on name alone" is only sound because branch S1 gives
 * every one of them a single price, so the two must never drift apart.
 */
export function isTradeCategory(category: string): boolean {
  return /^Trade \d+$/.test(category);
}

// --- The cost engine -----------------------------------------------------

export type PricedLine = {
  good: string;
  displayName: string;
  category: string;
  quantity: number;
  isSource: boolean;
  nominalYear: number;
  pricedYear: number;
  variant: 'full' | 'last5';
  seasonMapped: boolean;
  bound: string;
  source: PriceSource | null; // null when the line could not be priced
  unitAvg: number | null;
  unitMin: number | null;
  extAvg: number | null; // quantity × unit
  extMin: number | null;
  saleCount: number | null; // n behind the stat; 0 = hand-maintained
  estimate: boolean; // season-mapped, ceiling-bounded, or built from either
  basis: PriceBasis; // how the stats behind this line were aggregated
  // Priced at today's prices rather than at the line's own season, because
  // the recipe is still craftable (D3). Not an estimate — a real current
  // price answering "what would this cost me to build now".
  floated: boolean;
  window?: PricingWindow; // the date range, when basis is 'window'
  poolYears?: number[]; // the seasons unioned, when basis is 'pool'
  datelessSales: number; // sales admitted by D5's season fallback
  // Set when the line names a specific token that has no price of its own and
  // was priced as its tier instead — the site is reporting the tier's auction
  // average, and a specific token on the secondary market may cost more.
  pricedAs?: string;
  // Set when an ingredient path other than the authored one is selected:
  // 'replaced' is a line the path zeroes out (the Wish Ring), 'boosted' one
  // whose quantity it raises (the Gold Bars). The row stays in place either
  // way — see applyGoldPath in substitutions.ts for why.
  substituted?: 'replaced' | 'boosted';
  // Status of the recipe this line was BUILT from, when it is a transmute.
  // An expired one can no longer be crafted at any price — only bought
  // second-hand — which is a different caveat from an estimated price and the
  // reason Omni substitution exists (§3.2).
  subStatus?: RecipeStatus;
  note?: string;
};

export type BuildCost = {
  key: string;
  transmute: string;
  displayName: string;
  year: number;
  level: string;
  lines: PricedLine[];
  // Own recipe lines only — "I already own the source token".
  ownAvg: number;
  ownMin: number;
  // The source lines, fully recursed down the ladder.
  sourceAvg: number;
  sourceMin: number;
  // ownX + sourceX — build the whole chain from scratch.
  fullAvg: number;
  fullMin: number;
  hasSource: boolean;
  unpricedLines: number; // lines with no price from any source
  estimate: boolean; // any line is an estimate
  ceiling: boolean; // any line is a ceiling bound, so the total is an upper bound
  cycle: boolean; // a source cycle was cut here (data bug; guards infinite recursion)
  marketAvg: number | null; // this token's own auction price, when it has one
  marketMin: number | null;
  // Accuracy release (§10). `status` decides the pricing basis: active and
  // future recipes price at today's prices, expired ones over `window`.
  status: RecipeStatus;
  /** The basis this cost was computed on, so a view can say so in prose
   *  rather than inferring it from `status` -- which is what the notes used to
   *  do, and what made them go stale the moment the rules changed. */
  basis: PricingBasis;
  window: PricingWindow | null;
  expires: string | null; // resolved expiry date; null = never expires
  // Phase 7. The season every unpinned line was priced from, when the reader
  // pinned one; null = the natural basis. The row states it once under the
  // bill of materials rather than tagging every line (§10.6.6).
  priceYear: number | null;
};

/**
 * Which market a recipe is priced against — the axis the Recipes view's
 * "Price data from" control selects, and the one thing that decides whether an
 * expired recipe answers "what did this cost when it was craftable" or "what
 * would it cost me to buy now".
 *
 *   'today'  everything at the current season, EXCEPT tokens that can no
 *            longer be bought at all: an out-of-print Ultra Rare keeps its own
 *            vintage's market, because quoting it at today's price would claim
 *            you can buy a 2012 Ultra Rare for $59.50 and you cannot.
 *   'era'    each recipe on its own basis -- today's prices while it is still
 *            craftable, its build window once it has expired, a forward
 *            estimate while it is still a preview.
 *
 * Note this is NOT the same axis as `priceYear`. Pinning 2026 prices every
 * unpinned line from season 2026 including the ones that season never sold;
 * 'today' moves only what is actually purchasable now. Measured, they differ
 * on 150 lines worth $4,781.56, 90 of them Ultra Rares.
 *
 * Orthogonal again to `recentPrices`, which chooses the SAMPLE inside a season
 * rather than the season.
 */
export type PricingBasis = 'today' | 'era';

export type CostOptions = {
  /** Use each season's last-5-auctions window where available. Applies to any
   *  line priced at the latest priced season — which, since active recipes now
   *  price at today's prices, means every active recipe rather than only the
   *  current season's (§3.1 downstream). */
  recentPrices?: boolean;
  /** 'YYYY-MM-DD'. Injectable so tests and the harness can pin a date; the
   *  app leaves it to the viewer's own clock. */
  today?: string;
  /** Which market to price against. Defaults to 'today', because that is the
   *  question the Build Calculator and the Shopping List both ask and it is
   *  already what D3 does for the 91 active recipes. The Recipes view passes
   *  'era' explicitly: 41% of what it lists is expired, and that section
   *  exists to show what a build cost while it was possible. */
  basis?: PricingBasis;
  /** Phase 7 (§3.6). A season to price every UNPINNED line from, replacing the
   *  basis the recipe's own status would have chosen. null = Auto, the natural
   *  basis. Prices only (F2): status, windows, badges and the recipe list all
   *  still answer to `today`, so the page keeps saying what is craftable now. */
  priceYear?: number | null;
};

// Totals exclude the source lines by default; `includeSource` adds them.
export const totalAvg = (c: BuildCost, includeSource: boolean) => (includeSource ? c.fullAvg : c.ownAvg);
export const totalMin = (c: BuildCost, includeSource: boolean) => (includeSource ? c.fullMin : c.ownMin);

export class CostEngine {
  private recipes = new Map<string, Recipe>(); // `${year}|${transmute}`
  private byName = new Map<string, number[]>(); // transmute name → years, desc
  private memo = new Map<string, BuildCost>();
  private visiting = new Set<string>();
  readonly prices: PriceIndex;
  private recentPrices: boolean;
  private today: string;
  private priceYear: number | null;
  private basis: PricingBasis;

  constructor(recipes: Recipe[], prices: PriceIndex, opts: CostOptions = {}) {
    this.prices = prices;
    this.recentPrices = opts.recentPrices ?? false;
    this.today = opts.today ?? todayISO();
    this.priceYear = opts.priceYear ?? null;
    this.basis = opts.basis ?? 'today';
    for (const r of recipes) {
      this.recipes.set(r.key, r);
      this.byName.set(r.transmute, [...(this.byName.get(r.transmute) ?? []), r.year]);
    }
    for (const years of this.byName.values()) years.sort((a, b) => b - a);
  }

  isTransmute(good: string): boolean {
    return this.byName.has(good);
  }

  /** Most recent season with a recipe for this transmute, or null. Omni
   *  substitution needs it: a 2014 Legendary's Omni Cube suggestion has to
   *  price TODAY's Omni recipe, since Omni tokens were introduced in 2024 to
   *  make exactly those older Relics obtainable again. */
  latestYear(transmute: string): number | null {
    return this.byName.get(transmute)?.[0] ?? null; // years are sorted descending
  }

  /** Resolve a transmute to a recipe at or before `year`. A source line can
   *  name a season that has no recipe of its own (2024 Safehold IV upgrades
   *  from Safehold V, whose only recipe is 2023), so walk back to the most
   *  recent authored recipe — the same clamp idea as pricingSeason. */
  resolveRecipe(transmute: string, year: number): Recipe | null {
    const exact = this.recipes.get(`${year}|${transmute}`);
    if (exact) return exact;
    const years = this.byName.get(transmute);
    if (!years) return null;
    const prior = years.find((y) => y <= year); // years are sorted descending
    return prior === undefined ? null : this.recipes.get(`${prior}|${transmute}`) ?? null;
  }

  private variantFor(nominalYear: number): 'full' | 'last5' {
    // "Recent prices" is only meaningful for the season still in progress;
    // past seasons are closed and always use full-year stats (§4.2).
    return this.recentPrices && nominalYear >= this.prices.latestPriced ? 'last5' : 'full';
  }

  /** An `Ultra Rare` line, pinned or blank. The tier and the token share one
   *  canonical name (§4.1), so a blank line names the tier itself.
   *
   *  A pin USED to disqualify a line here, on the reading that rule 1 answers
   *  the whole question. It does not: the pin names WHICH token the recipe
   *  needs, and the pool names WHERE that token could be bought, which are
   *  different questions. Pooling does not change the vintage — it reads both
   *  seasons of the SAME vintage — so §10.2's F1, which protects a pin's
   *  vintage from being repriced, is not engaged. */
  private isUltraRare(l: RecipeLine): boolean {
    if (l.good === 'Ultra Rare') return true;
    // The RESOLVED category, symmetric with isTradeGood, rather than the
    // authored `IngredientType` alone. The same token is authored both ways in
    // the sheet -- `Charm of Synergy` carries IngredientType=Ultra Rare on
    // Giln's Redoubt Shield and a blank cell on Smith's Charm of Unified
    // Synergy (Set 2) -- and reading only the cell made one recipe's copy of an
    // ingredient take a different pricing branch from the other's. It costs
    // nothing today, because that token has its own off-auction price and
    // never reaches the tier, but it is the kind of divergence that is
    // invisible until the day the off-auction row goes away.
    return (this.prices.category(l.good, l.nominalYear) || l.ingredientType) === 'Ultra Rare';
  }

  /** The 14 trade goods, by the category the data itself carries rather than a
   *  hardcoded list. A pattern, so a Trade 5 rung prices correctly the season
   *  it appears rather than the season someone remembers to edit this line. */
  private isTradeGood(l: RecipeLine): boolean {
    return isTradeCategory(this.prices.category(l.good, l.nominalYear) || l.ingredientType);
  }

  /** Rules 3 and 4 for one Ultra Rare line: the two seasons in which its
   *  vintage could actually have been bought, falling back to the clamp when
   *  neither of them sold one.
   *
   *  Keyed on the LINE's year, not the recipe's. They are the same number on a
   *  blank line — `resolveGoodYear('')` returns the recipe's year — so this is
   *  unchanged for the 78 blank lines and is what makes the pinned ones work. */
  private poolOrClamp(good: string, year: number): LeafPrice | null {
    const pooled = this.prices.poolPrice(good, [year, year + 1]);
    if (pooled) return pooled;
    // Neither season sold one: every recipe before 2018, since auction data
    // starts there. Clamp to the line's own year -- which lands on the
    // earliest priced season -- rather than dropping through to the float.
    // Floating here is precisely the failure D4 exists to prevent: it would
    // put a 2014 Legendary's Ultra Rare at the 2026 price ($60) when the
    // closest thing to that era's baseline the data holds is 2018's ($112).
    return this.prices.leafPrice(good, year, 'full');
  }

  /** Today's market: what a player who is buying NOW actually pays. */
  private atCurrentSeason(good: string, l: RecipeLine): { price: LeafPrice | null; floated: boolean } {
    const season = this.prices.latestPriced;
    return {
      price: this.prices.leafPrice(good, season, this.variantFor(season)),
      floated: season !== l.nominalYear,
    };
  }

  /**
   * Price one leaf line under its recipe's basis (§10.2's per-line rules).
   * The order below IS the rule set, and it is deliberately a chain of
   * fallbacks rather than a lookup table: whichever branch fires, a line that
   * could be priced before must still be priced after.
   *
   * The recipe itself is no longer a parameter: every rule here keys on the
   * LINE (its own year, its category, its pin), and the only thing the recipe
   * still contributes is the `status` and `window` computed from it once in
   * `cost`. That fell out of the Shopping List work rather than being aimed
   * at -- rule 3 used to read `recipe.year` where it meant `l.nominalYear`,
   * which is the same number on a blank line and the wrong one on a pin.
   */
  private leafFor(
    l: RecipeLine,
    status: RecipeStatus,
    window: PricingWindow | null,
  ): { price: LeafPrice | null; floated: boolean } {
    const direct = this.leafForGood(l.good, l, status, window);
    if (direct.price) return direct;

    // A line naming a specific member of an auctioned tier falls back to the
    // tier's own price (§3.4a). This is what makes `IngredientType` authoring
    // safe: naming the real token the recipe needs improves what the page SAYS
    // without changing what it CHARGES, and it cannot unprice a line.
    const proxy = TIER_PROXY[l.ingredientType];
    if (proxy && proxy !== l.good) {
      const viaTier = this.leafForGood(proxy, l, status, window);
      if (viaTier.price) return { ...viaTier, price: { ...viaTier.price, pricedAs: proxy } };
    }
    return direct;
  }

  /** The §10.2 rule chain itself, for one candidate token. */
  private leafForGood(
    good: string,
    l: RecipeLine,
    status: RecipeStatus,
    window: PricingWindow | null,
  ): { price: LeafPrice | null; floated: boolean } {
    // 1. An explicit ItemYear is a pin and never floats (34 lines). A pin
    //    names a season on purpose, so neither the float nor the window may
    //    override it -- that would make authoring the cell meaningless.
    //    An Ultra Rare pin is the exception, and falls through to the Ultra
    //    Rare rules below: the pin says WHICH token the recipe needs, and
    //    those rules say WHERE that token can be bought, which is a different
    //    question and the only one a price can answer. Neither of them changes
    //    the vintage, so F1 -- which exists to stop a pin being repriced into
    //    a different token -- is not engaged. A pinned Ultra Rare therefore
    //    prices exactly as a blank one of the same vintage does; the pin still
    //    wins outright for the 24 pinned lines that are not Ultra Rare.
    if (l.goodYear.trim() !== '' && !this.isUltraRare(l))
      return { price: this.prices.leafPrice(good, l.nominalYear, this.variantFor(l.nominalYear)), floated: false };

    // 1b. Phase 7: an explicit price year replaces the RECIPE's basis -- both
    //    the today's-prices float below and the expired window under it --
    //    because the reader has asked one question of the whole page: what did
    //    this cost in season X. It sits BELOW the pin above it on purpose
    //    (F1): a pin names WHICH token the recipe needs (an Ultra Rare one
    //    season older, the 2023 Safehold V), not merely which market to read,
    //    so repricing it would quietly answer a different question. It stays
    //    ABOVE the Ultra Rare pool, which now follows immediately: the pool is
    //    what a UR resolves to when the basis is the recipe's own era, and here
    //    the reader has named a season instead, so the pool collapses into it.
    //    Gated on the line being unpinned, which the branch above used to do
    //    by short-circuiting. A pinned Ultra Rare now reaches this point, and
    //    F1 still says its vintage is not the reader's to move.
    if (this.priceYear !== null && l.goodYear.trim() === '') {
      const p = this.prices.leafPrice(good, this.priceYear, this.variantFor(this.priceYear));
      // No `floated`: floating is the D3 story about an active recipe drifting
      // to today, and per-line tags are deviation-only (§10.6.6). Under a
      // pinned year the basis is stated once for the whole page instead.
      if (p) return { price: p, floated: false };
      // Falls through when the season prices nothing at all under this name --
      // the same rule as everywhere else here: whichever branch fires, a line
      // that could be priced before must still be priced after.
    }

    // S2/3/4. THE ULTRA RARE RULES, in vintage order. Applied as one set to
    //    every Ultra Rare line, pinned or blank, because they answer a single
    //    question -- where can a token of this vintage actually be bought --
    //    and splitting them by how the year was authored made a pinned 2025
    //    line pool while a blank 2025 line read the current season.
    //
    //    S2: a vintage that is STILL IN PRINT prices at the current season
    //    (27 lines). "In print" is `nominalYear >= latestPriced - 1`, from the
    //    same domain rule the pool rests on: a season-Y token is obtainable
    //    from season Y or Y+1. Read forwards, a 2025 token is still coming out
    //    of season 2026's lots, so it is on sale right now and today's price
    //    IS its price. Pooling it would average today's market with a closed
    //    season's for something you can buy this afternoon.
    if (this.isUltraRare(l)) {
      //    S2 is gated on the basis, and the pool beneath it is NOT. That is
      //    the difference between the two questions: "is this token on sale
      //    now" is only asked when the reader is buying now, while "which two
      //    seasons could this vintage ever have come from" is a fact about the
      //    token and is true under either basis (#137).
      if (this.basis === 'today' && l.nominalYear >= this.prices.latestPriced - 1) {
        const { price, floated } = this.atCurrentSeason(good, l);
        if (price) return { price, floated };
      }
      //    S3: an out-of-print vintage pools its own year and the next (D4),
      //    holding the era's baseline while the trade goods around it float.
      //    S4, beneath it in poolOrClamp, is the pre-2018 clamp.
      //
      //    The pool sits ABOVE the expired window, and applies whatever the
      //    recipe's status, because the two answer different questions and
      //    only the pool can answer this one. The window asks WHEN you could
      //    buy an ingredient, and for a 2022 Relic that is 2021-11-06 to
      //    2023-11-24 -- correct, and correct for trade goods, which have no
      //    vintage. A UR is not fungible that way. Seasons run autumn to
      //    autumn, so by Nov 2023 season 2024 is two months into selling, and
      //    its URs redeem for a 2024 or 2023 token -- never the 2022 one this
      //    recipe names (§3.4c). A date filter cannot see that; only the
      //    season can.
      //
      //    §10.2 used to claim the window "already spans Y -> Y+1, so the
      //    two-year UR rule is satisfied by the window itself". It spans them,
      //    but it does not STOP there -- measured, every expired window from
      //    2018 on admits a third season, 20 of season 2024's 41 auctions in
      //    the 2022 case. Sufficiency was mistaken for exactness. The pool is
      //    a strict subset of the window in every year (0 pooled sales fall
      //    outside), so reading it first only ever drops sales that could not
      //    have produced the token; no line priced before is unpriced now.
      const p = this.poolOrClamp(good, l.nominalYear);
      if (p) return { price: p, floated: false };
    }

    // S1. A TRADE GOOD prices at the current season, whatever the recipe's
    //    own era (1,736 lines; 1,125 of them on a recipe you can still make).
    //    This is the Shopping List's founding rule and it is not a view
    //    preference: a trade good has no vintage at all -- an Alchemist's Ink
    //    is an Alchemist's Ink -- so there is no sense in which the 2019 one
    //    is the one a 2019 recipe needs. Whoever is reading, the only Ink they
    //    can obtain is the one on sale now, at the price it is on sale for.
    //
    //    It sits ABOVE the expired window and the future clamp, which is the
    //    whole point (D1a): both of those answer "what did this cost then",
    //    and for a fungible good "then" is not a property of the ingredient.
    //    It sits BELOW the pin, because a pinned trade good would be a
    //    deliberate authoring act -- there are zero today, and the new test
    //    suite asserts the 14-goods-one-price guarantee directly rather than
    //    resting it on this ordering.
    //    Gated on the basis: under 'era' a trade good falls through to the
    //    expired window or the forward clamp below, which is what the Recipes
    //    view's historical section is for. Under 'today' it is the rule that
    //    makes an expired recipe's bill of materials something you could
    //    actually go and buy.
    if (this.basis === 'today' && this.isTradeGood(l)) {
      const { price, floated } = this.atCurrentSeason(good, l);
      if (price) return { price, floated };
    }

    // 2. On an expired recipe the date window governs every remaining line --
    //    every line the pool above did not claim, which is every line without a
    //    vintage. The window's dates are unchanged: the debut season's first
    //    auction through the 1 Dec expiry minus the shipping cutoff.
    if (status === 'expired' && window) {
      const p = this.prices.leafPrice(good, l.nominalYear, 'full', window);
      if (p) return { price: p, floated: false };
    }

    // 4. Otherwise an ACTIVE recipe prices at today's prices (D3): someone
    //    building something still craftable pays today's prices by definition.
    //    FUTURE recipes keep their existing behaviour -- the 2027 preview
    //    already clamps forward to the latest season's last-5.
    const effectiveYear = status === 'active' ? this.prices.latestPriced : l.nominalYear;
    const floated = effectiveYear !== l.nominalYear;
    const p = this.prices.leafPrice(good, effectiveYear, this.variantFor(effectiveYear));
    if (p) return { price: p, floated };

    // 5. Defensive: floating must never cost a line the price it used to have.
    //    Measured at 0 lines today, but the data changes every season.
    return { price: this.prices.leafPrice(good, l.nominalYear, this.variantFor(l.nominalYear)), floated: false };
  }

  cost(transmute: string, year: number): BuildCost | null {
    const recipe = this.resolveRecipe(transmute, year);
    if (!recipe) return null;
    const memoKey = recipe.key;
    const hit = this.memo.get(memoKey);
    if (hit) return hit;

    // Cycle guard. Tier ordering makes this unreachable with valid data, but a
    // typo in the sheet must not hang the browser.
    if (this.visiting.has(memoKey)) {
      return {
        key: memoKey, transmute: recipe.transmute, displayName: recipe.transmute, year: recipe.year,
        level: recipe.level, lines: [], ownAvg: 0, ownMin: 0, sourceAvg: 0, sourceMin: 0,
        fullAvg: 0, fullMin: 0, hasSource: false, unpricedLines: 0, estimate: true,
        ceiling: false, cycle: true, marketAvg: null, marketMin: null,
        status: 'active', window: null, expires: null, priceYear: this.priceYear, basis: this.basis,
      };
    }
    this.visiting.add(memoKey);

    // The recipe's status decides the basis for every line below (§10.2).
    const status = statusOf(recipe, this.prices.seasonStart, this.today);
    const window = windowOf(recipe, this.prices.seasonStart, this.today);

    const lines: PricedLine[] = [];
    let ownAvg = 0, ownMin = 0, sourceAvg = 0, sourceMin = 0;
    let unpriced = 0, anyEstimate = false, anyCeiling = false, anyCycle = false;

    for (const l of recipe.lines) {
      const variant = this.variantFor(l.nominalYear);
      const base: PricedLine = {
        good: l.good,
        displayName: this.prices.displayName(l.good, l.nominalYear),
        // A named token the metadata has never seen still knows its tier from
        // the authored IngredientType, so the category chip stays populated.
        category: this.prices.category(l.good, l.nominalYear) || l.ingredientType,
        quantity: l.quantity,
        isSource: l.isSource,
        nominalYear: l.nominalYear,
        pricedYear: l.nominalYear,
        variant,
        seasonMapped: false,
        bound: '',
        source: null,
        unitAvg: null, unitMin: null, extAvg: null, extMin: null,
        saleCount: null,
        estimate: false,
        basis: 'season',
        floated: false,
        datelessSales: 0,
      };

      // Any line naming a producible transmute recurses; everything else is a
      // leaf price lookup (§4.1). Note this is NOT limited to source lines: a
      // transmute consumed as fuel still has to be obtained, so it costs what
      // it costs to build. (2024 Safehold III consumes a Safehold IV on a
      // non-source line — pricing that as a leaf finds no auction price at all.)
      // Where a good is both craftable and auctioned, buildCost wins by
      // decision; `marketAvg`/`marketMin` still carry the market price so the
      // UI can show both sides of the build-vs-buy call.
      //
      // A TRADE GOOD asks the question differently, and the answer is MARKET
      // FIRST, BUILD ONLY AS A FALLBACK.
      //
      // Every rung of the trade ladder is a transmute -- Trade 1/2 from the blind
      // packs, Trade 3 from a Trade 2 good or from Monster Trophies, Trade 5 (the
      // Omni tokens) from the rungs below. So 'is it craftable' does not separate
      // them from anything; what separates them is whether you can BUY one.
      //
      // Where a price exists, S1's reasoning governs: buying is anticipatory, so a
      // player stocking up on Fleece before the January window pays what a Fleece
      // costs NOW, and a recipe line asking for one is asking that question. What
      // it would cost this reader to assemble one instead is the Fleece recipe's
      // own row, where marketAvg puts both sides together. Letting the recursion
      // pre-empt that pinned every Fleece line to the 2017 recipe's vintage --
      // measured, $60 against the $85 a Fleece actually costs today.
      //
      // Where no price exists the recipe is all there is, and it must still be
      // reached: Omni Orb is never sold, and four 2026 Mythics upgrade from one.
      // A blanket trade-good exemption cost them $637 each and an unpriced line.
      const tradeLeaf = this.isTransmute(l.good) && this.isTradeGood(l) ? this.leafFor(l, status, window) : null;
      const sub = this.isTransmute(l.good) && !tradeLeaf?.price ? this.cost(l.good, l.nominalYear) : null;
      if (sub) {
        // Full chain: owning the source outright is the top-level toggle, so a
        // nested source is always built.
        base.source = 'build';
        base.pricedYear = sub.year;
        base.seasonMapped = sub.year !== l.nominalYear;
        base.unitAvg = sub.fullAvg;
        base.unitMin = sub.fullMin;
        base.estimate = sub.estimate || base.seasonMapped;
        base.bound = sub.ceiling ? 'ceiling' : '';
        base.displayName = sub.displayName;
        base.subStatus = sub.status;
        if (sub.cycle) anyCycle = true;
        if (sub.ceiling) anyCeiling = true;
        if (sub.unpricedLines) unpriced += sub.unpricedLines;
        if (base.seasonMapped) base.note = `built from the ${sub.year} recipe`;
      } else {
        const { price: p, floated } = tradeLeaf ?? this.leafFor(l, status, window);
        if (p) {
          base.source = p.source;
          base.pricedYear = p.pricedYear;
          base.variant = p.variant;
          base.seasonMapped = p.seasonMapped;
          base.bound = p.bound;
          base.unitAvg = p.stats.avg;
          base.unitMin = p.stats.min;
          base.saleCount = p.stats.n;
          base.estimate = p.seasonMapped || p.bound === 'ceiling';
          base.basis = p.basis;
          base.floated = floated;
          base.window = p.window;
          base.poolYears = p.poolYears;
          base.datelessSales = p.datelessSales;
          base.pricedAs = p.pricedAs;
          if (p.bound === 'ceiling') anyCeiling = true;
        } else {
          unpriced++;
          base.note = 'no price found in any season';
        }
      }

      base.extAvg = base.unitAvg === null ? null : base.unitAvg * l.quantity;
      base.extMin = base.unitMin === null ? null : base.unitMin * l.quantity;
      if (base.estimate) anyEstimate = true;

      if (l.isSource) {
        sourceAvg += base.extAvg ?? 0;
        sourceMin += base.extMin ?? 0;
      } else {
        ownAvg += base.extAvg ?? 0;
        ownMin += base.extMin ?? 0;
      }
      lines.push(base);
    }

    // Source lines lead. The sheet authors them last, but the source is the token
    // being upgraded rather than fuel poured in alongside the rest: it is what a
    // reader looks for first, and in the calculator it is usually the first thing
    // marked on hand. Sorted here rather than in a view so the Recipes bill of
    // materials and the calculator can't disagree about the order. sort() is
    // stable, so everything else keeps its authored sequence.
    const ordered = [...lines].sort((a, b) => Number(b.isSource) - Number(a.isSource));

    // The build-vs-buy comparison has to be quoted in the same season as the
    // build, or a pinned 2019 build cost would be weighed against a 2026 asking
    // price. Unlike a line, this is not an authored pin, so it always moves.
    //
    // Which season the build IS in follows its status, not `recipe.year`: rule 4
    // floats every line of an ACTIVE recipe to today, so quoting the market at
    // recipe.year weighs a build made of today's prices against an asking price
    // from the recipe's debut. The gap is invisible while every active recipe is
    // recent, and the never-expiring ones are where it bites: the 2017 Golden
    // Fleece recipe read "build $85, buy ~$60" -- 2026's trophies against 2019's
    // Fleece, clamped back to 2017 -- a verdict that was pure authoring artifact.
    // An expired recipe keeps recipe.year, which is what its window is built from,
    // and a future one keeps it too and clamps forward exactly as its lines do.
    const marketYear = this.priceYear ?? (status === 'active' ? this.prices.latestPriced : recipe.year);
    const market = this.prices.leafPrice(recipe.transmute, marketYear, this.variantFor(marketYear));
    const out: BuildCost = {
      key: memoKey,
      transmute: recipe.transmute,
      displayName: this.prices.displayName(recipe.transmute, recipe.year),
      year: recipe.year,
      level: recipe.level,
      lines: ordered,
      ownAvg, ownMin,
      sourceAvg, sourceMin,
      fullAvg: ownAvg + sourceAvg,
      fullMin: ownMin + sourceMin,
      hasSource: lines.some((l) => l.isSource),
      unpricedLines: unpriced,
      estimate: anyEstimate,
      status,
      window,
      expires: expiryOf(recipe),
      priceYear: this.priceYear,
      basis: this.basis,
      ceiling: anyCeiling,
      cycle: anyCycle,
      marketAvg: market ? market.stats.avg : null,
      marketMin: market ? market.stats.min : null,
    };

    this.visiting.delete(memoKey);
    this.memo.set(memoKey, out);
    return out;
  }

  /** Every recipe, newest season first. */
  allCosts(): BuildCost[] {
    const out: BuildCost[] = [];
    for (const r of this.recipes.values()) {
      const c = this.cost(r.transmute, r.year);
      if (c) out.push(c);
    }
    return out.sort((a, b) => b.year - a.year || a.level.localeCompare(b.level) || a.transmute.localeCompare(b.transmute));
  }

  seasons(): number[] {
    return [...new Set([...this.recipes.values()].map((r) => r.year))].sort((a, b) => b - a);
  }

  costsForSeason(year: number): BuildCost[] {
    return this.allCosts().filter((c) => c.year === year);
  }

  /**
   * The trade-rung recipes shown in their own band above the seasons: the
   * LATEST vintage of each, newest first.
   *
   * They earn a band because a season heading answers the wrong question about
   * them. Every rung of the trade ladder is a transmute, and unlike the power
   * ladder the rungs do not belong to the season they were introduced in: the
   * Golden Fleece recipe never expires and is the same 10 Monster Trophies in
   * every season, so filing it under 2017 buries a thing you can make today
   * eleven accordions down, under a season note about 2018 price data that is
   * false for it.
   *
   * Latest vintage only, by decision. The Omni recipes DO expire and are
   * reissued per season, so the band would otherwise carry an expired 2024 pair
   * next to the 2025 one and have to explain the difference. Older vintages stay
   * in their own season, which is where a reader comparing seasons will look;
   * `bandKeys` is how the page keeps them from appearing twice.
   */
  tradeRungCosts(): BuildCost[] {
    const latest = new Map<string, BuildCost>();
    for (const c of this.allCosts()) {
      if (!isTradeCategory(c.level)) continue;
      const held = latest.get(c.transmute);
      if (!held || c.year > held.year) latest.set(c.transmute, c);
    }
    return [...latest.values()].sort((a, b) => b.year - a.year || a.transmute.localeCompare(b.transmute));
  }

  /** Keys the band has claimed, so the season list can drop them. */
  bandKeys(): Set<string> {
    return new Set(this.tradeRungCosts().map((c) => c.key));
  }
}

// --- Season ordering (Phase 4 page layout) -------------------------------
// Players care most about Relics and the Legendaries they upgrade into, and
// want each source Relic shown immediately above its Legendary. Everything
// else follows in power-tier order. This is maintainer-specified layout, not a
// property of the data, so it lives here as a pure transform over BuildCosts.

// Same-power sets that never co-occur in a season (Arcanum/Eldritch are
// successive "sets" at one tier), then the rest of the ladder. Mythic is last
// despite its power because only the largest spenders build them.
const FLAT_LEVEL_ORDER = ['Arcanum', 'Eldritch', 'Enhanced', 'Exalted', 'Mythic'];
// Tokens outside the normal POWER ladder, in maintainer-specified order. The
// trade rungs sit here because they are a separate ladder, not because they are
// unranked: Trade 3 is the Golden Fleece and Trade 5 the Omni tokens, which
// carried the level `Omni` until the trade ladder was modelled properly.
const LADDER_LEVEL_ORDER = ['Safehold', 'Ultra Rare', 'Paragon', 'Trade 3', 'Trade 5'];

export type UpgradePair = { source: BuildCost; upgrade: BuildCost };

export type SeasonGroup =
  | { kind: 'pairs'; label: string; pairs: UpgradePair[] }
  | { kind: 'flat'; label: string; rows: BuildCost[] }
  | { kind: 'ladder'; label: string; rows: BuildCost[] };

const byName = (a: BuildCost, b: BuildCost) => a.transmute.localeCompare(b.transmute);

/** The display name of the source token a transmute upgrades from, or null. */
export function sourceName(c: BuildCost): string | null {
  const s = c.lines.find((l) => l.isSource);
  return s ? s.displayName : null;
}

/* Short tier codes for the phone layout, where a spelled-out "Legendary" chip
   costs 72px of a ~300px row. Each is the shortest prefix that stays unique
   across ALL eleven tiers: one letter where that's unambiguous, two for the
   three E-tiers, three for Paragon/Patron (which collide at both one and two).
   Deliberately a fixed table, not computed: tiers vary by season, so deriving
   prefixes from whatever a season happens to contain would let the same letter
   mean different things on different seasons. Adding a tier means checking it
   against this whole table by hand. */
const TIER_ABBREV: Record<string, string> = {
  Arcanum: 'A',
  Eldritch: 'El',
  Enhanced: 'En',
  Exalted: 'Ex',
  Legendary: 'L',
  Mythic: 'M',
  'Trade 3': 'T3',
  'Trade 5': 'T5',
  Paragon: 'Par',
  "Ultra Rare": 'UR',
  Relic: 'R',
  Safehold: 'S',
};

/** The phone-sized code for a tier. Unrecognized tiers keep their full name —
 *  a wide chip is better than an abbreviation that might collide. */
export function tierAbbrev(level: string): string {
  return TIER_ABBREV[level] ?? level;
}

/** Group one season's costs into the maintainer's display order. Every input
 *  cost appears exactly once across the returned groups. */
export function orderSeason(costs: BuildCost[]): SeasonGroup[] {
  const index = new Map(costs.map((c) => [c.transmute, c]));
  const used = new Set<string>();
  const groups: SeasonGroup[] = [];

  const take = (level: string): BuildCost[] => {
    const rows = costs.filter((c) => c.level === level && !used.has(c.transmute)).sort(byName);
    rows.forEach((r) => used.add(r.transmute));
    return rows;
  };

  // 1. Relic → Legendary upgrade pairs (all 23 Legendary sources are same-season
  //    Relics, verified). Ordered by the source Relic's name.
  const pairs: UpgradePair[] = [];
  for (const c of costs) {
    if (c.level !== 'Legendary') continue;
    const src = sourceLineTransmute(c, index);
    if (src && src.level === 'Relic') {
      pairs.push({ source: src, upgrade: c });
      used.add(src.transmute);
      used.add(c.transmute);
    }
  }
  pairs.sort((a, b) => byName(a.source, b.source));
  if (pairs.length) groups.push({ kind: 'pairs', label: 'Relic → Legendary upgrades', pairs });

  // 2. standalone Relics, 3. source-less Legendaries
  const relics = take('Relic');
  if (relics.length) groups.push({ kind: 'flat', label: 'Relics', rows: relics });
  const legendaries = take('Legendary');
  if (legendaries.length) groups.push({ kind: 'flat', label: 'Legendaries', rows: legendaries });

  // 4–7. the rest of the power ladder
  for (const level of FLAT_LEVEL_ORDER) {
    const rows = take(level);
    if (rows.length) groups.push({ kind: 'flat', label: level, rows });
  }

  // Outside the ladder, kept together under one divider.
  const ladder: BuildCost[] = [];
  for (const level of LADDER_LEVEL_ORDER) ladder.push(...take(level));
  if (ladder.length) groups.push({ kind: 'ladder', label: 'Outside the tier ladder', rows: ladder });

  // Anything with an unrecognized level still shows, rather than vanishing.
  const leftover = costs.filter((c) => !used.has(c.transmute)).sort(byName);
  if (leftover.length) groups.push({ kind: 'flat', label: 'Other', rows: leftover });

  return groups;
}

// The same-season transmute a source line points at, if it is one.
function sourceLineTransmute(c: BuildCost, index: Map<string, BuildCost>): BuildCost | null {
  const s = c.lines.find((l) => l.isSource);
  if (!s) return null;
  const src = index.get(s.good);
  return src && src.year === s.pricedYear ? src : null;
}
