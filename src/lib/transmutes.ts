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

import { parseCSV, aggregateSeason, seasonsOf, type Sale, type ItemRow, type Stats } from './data';

// --- Types ---------------------------------------------------------------

export type RecipeLine = {
  good: string; // canonical name
  goodYear: string; // raw authored value: '' | '-1' | '2023'
  nominalYear: number; // goodYear resolved against the recipe's own year
  quantity: number;
  isSource: boolean; // the token being upgraded FROM, not consumed as fuel
};

export type Recipe = {
  key: string; // `${year}|${transmute}`
  year: number;
  level: string;
  transmute: string;
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
  year: number | null; // null = applies to every season; a year overrides it
  bound: string; // 'ceiling' — the value is an upper bound, not a measurement
};

// --- Parsers -------------------------------------------------------------
// The recipe sheet carries `ResolvedYear` and `GoodDisplayName` as authoring
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

// `GoodYear`: blank = the recipe's own season; a signed offset is relative to
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
    const good = o['Good'];
    const quantity = parseInt(o['Quantity'], 10);
    if (!transmute || !good || !isFinite(year) || !isFinite(quantity)) continue;

    const key = `${year}|${transmute}`;
    let recipe = byKey.get(key);
    if (!recipe) {
      recipe = { key, year, level: o['Level'], transmute, lines: [] };
      byKey.set(key, recipe);
    }
    const goodYear = o['GoodYear'] ?? '';
    recipe.lines.push({
      good,
      goodYear,
      nominalYear: resolveGoodYear(goodYear, year),
      quantity,
      isSource: (o['IsSource'] || '').toUpperCase() === 'TRUE',
    });
  }
  return [...byKey.values()];
}

export function parseTokenMetadata(text: string): TokenMeta[] {
  const objs = toObjects(parseCSV(text));
  const out: TokenMeta[] = [];
  for (const o of objs) {
    const year = parseInt(o['year'], 10);
    if (!o['canonicalName'] || !isFinite(year)) continue;
    out.push({
      year,
      canonicalName: o['canonicalName'],
      displayName: o['displayName'] || o['canonicalName'],
      tokenCategory: o['tokenCategory'],
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
    if (!o['Good'] || !isFinite(year) || !isFinite(avg)) continue;
    const max = money(o['max Price']);
    const min = money(o['min Price']);
    out.push({
      year,
      good: o['Good'],
      displayName: o['Display Name'] || o['Good'],
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
    const ratio = Number(o['Ratio']);
    if (!o['Token'] || !o['DerivedFrom'] || !isFinite(ratio) || ratio <= 0) continue;
    const year = parseInt(o['Year'], 10);
    out.push({
      token: o['Token'],
      derivedFrom: o['DerivedFrom'],
      ratio,
      year: isFinite(year) ? year : null,
      bound: (o['Bound'] || '').toLowerCase(),
    });
  }
  return out;
}

// --- Price index ---------------------------------------------------------

export type PriceSource = 'auction' | 'offAuction' | 'derived' | 'build';

export type LeafPrice = {
  stats: Stats;
  source: PriceSource;
  pricedYear: number;
  variant: 'full' | 'last5';
  seasonMapped: boolean; // priced from a different season than asked for
  bound: string; // 'ceiling' when the value is an upper bound (§4.3)
};

export type SeasonMapping = { season: number; variant: 'full' | 'last5'; mapped: boolean };

export class PriceIndex {
  private auction = new Map<string, ItemRow>(); // `${year}|${item}`
  private offAuction = new Map<string, OffAuctionPrice>();
  private derived = new Map<string, DerivedRule>(); // token, and `${token}|${year}`
  private meta = new Map<string, TokenMeta>();
  readonly pricedSeasons: number[];
  readonly earliestPriced: number;
  readonly latestPriced: number;

  constructor(
    sales: Sale[],
    offAuction: OffAuctionPrice[] = [],
    derived: DerivedRule[] = [],
    meta: TokenMeta[] = [],
  ) {
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
  private directLookup(good: string, year: number, variant: 'full' | 'last5'): LeafPrice | null {
    const a = this.auction.get(`${year}|${good}`);
    if (a) {
      const p = this.pick(a, variant);
      return { stats: p.stats, source: 'auction', pricedYear: year, variant: p.variant, seasonMapped: false, bound: '' };
    }
    const o = this.offAuction.get(`${year}|${good}`);
    if (o) {
      return { stats: o.stats, source: 'offAuction', pricedYear: year, variant: 'full', seasonMapped: false, bound: '' };
    }
    const rule = this.derived.get(`${good}|${year}`) ?? this.derived.get(good);
    if (rule) {
      // CYCLE GUARD (§4.3): a derived price reads the parent's MARKET price and
      // must never call buildCost(parent). Fleece's own recipe is 10 × Monster
      // Trophy while a Trophy prices off Fleece — recursion here would loop.
      const parent = this.leafPrice(rule.derivedFrom, year, variant);
      if (!parent) return null;
      const s = parent.stats;
      return {
        stats: { n: s.n, min: s.min / rule.ratio, max: s.max / rule.ratio, avg: s.avg / rule.ratio },
        source: 'derived',
        pricedYear: parent.pricedYear,
        variant: parent.variant,
        seasonMapped: parent.seasonMapped,
        bound: rule.bound || parent.bound,
      };
    }
    return null;
  }

  // Price a leaf token for a nominal season. The season clamp is consulted only
  // when the direct lookup misses (§4.4), so real data always wins — a 2027
  // recipe can mix a real 2027 Fleece price with 2026-last5 trade goods.
  leafPrice(good: string, nominalYear: number, variant: 'full' | 'last5' = 'full'): LeafPrice | null {
    const direct = this.directLookup(good, nominalYear, variant);
    if (direct) return direct;

    const mapped = this.pricingSeason(nominalYear);
    if (mapped.season === nominalYear) return null; // in range and genuinely absent
    const fallback = this.directLookup(good, mapped.season, mapped.variant);
    if (!fallback) return null;
    return { ...fallback, seasonMapped: true };
  }
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
};

export type CostOptions = {
  /** Use each season's last-5-auctions window where available. Only affects
   *  lines priced in the latest priced season; older seasons have no "recent". */
  recentPrices?: boolean;
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

  constructor(recipes: Recipe[], prices: PriceIndex, opts: CostOptions = {}) {
    this.prices = prices;
    this.recentPrices = opts.recentPrices ?? false;
    for (const r of recipes) {
      this.recipes.set(r.key, r);
      this.byName.set(r.transmute, [...(this.byName.get(r.transmute) ?? []), r.year]);
    }
    for (const years of this.byName.values()) years.sort((a, b) => b - a);
  }

  isTransmute(good: string): boolean {
    return this.byName.has(good);
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
      };
    }
    this.visiting.add(memoKey);

    const lines: PricedLine[] = [];
    let ownAvg = 0, ownMin = 0, sourceAvg = 0, sourceMin = 0;
    let unpriced = 0, anyEstimate = false, anyCeiling = false, anyCycle = false;

    for (const l of recipe.lines) {
      const variant = this.variantFor(l.nominalYear);
      const base: PricedLine = {
        good: l.good,
        displayName: this.prices.displayName(l.good, l.nominalYear),
        category: this.prices.category(l.good, l.nominalYear),
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
      };

      // Any line naming a producible transmute recurses; everything else is a
      // leaf price lookup (§4.1). Note this is NOT limited to source lines: a
      // transmute consumed as fuel still has to be obtained, so it costs what
      // it costs to build. (2024 Safehold III consumes a Safehold IV on a
      // non-source line — pricing that as a leaf finds no auction price at all.)
      // Where a good is both craftable and auctioned, buildCost wins by
      // decision; `marketAvg`/`marketMin` still carry the market price so the
      // UI can show both sides of the build-vs-buy call.
      const sub = this.isTransmute(l.good) ? this.cost(l.good, l.nominalYear) : null;
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
        if (sub.cycle) anyCycle = true;
        if (sub.ceiling) anyCeiling = true;
        if (sub.unpricedLines) unpriced += sub.unpricedLines;
        if (base.seasonMapped) base.note = `built from the ${sub.year} recipe`;
      } else {
        const p = this.prices.leafPrice(l.good, l.nominalYear, variant);
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

    const market = this.prices.leafPrice(recipe.transmute, recipe.year, this.variantFor(recipe.year));
    const out: BuildCost = {
      key: memoKey,
      transmute: recipe.transmute,
      displayName: this.prices.displayName(recipe.transmute, recipe.year),
      year: recipe.year,
      level: recipe.level,
      lines,
      ownAvg, ownMin,
      sourceAvg, sourceMin,
      fullAvg: ownAvg + sourceAvg,
      fullMin: ownMin + sourceMin,
      hasSource: lines.some((l) => l.isSource),
      unpricedLines: unpriced,
      estimate: anyEstimate,
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
// Tokens outside the normal upgrade ladder, in maintainer-specified order.
const LADDER_LEVEL_ORDER = ['Safehold', 'Patron', 'Paragon', 'Omni'];

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
