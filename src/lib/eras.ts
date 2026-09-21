// Era boundaries and domain constants for the auction context layer.
//
// These are CONFIG, not data: time boundaries and rates that the analytics key
// off, kept here rather than hardcoded at call sites (see
// docs/context-layer-design.md §3.3). All were settled in the Phase-1 audit
// (docs/data-audit.md) — change them here and every consumer follows.

export const ERAS = {
  // Trent (third-party reseller) auctions exist only from season 2023 on. Source
  // is read PER AUCTION from auctioneer/Link (see deriveSource in data.ts), never
  // from a calendar cutoff — the first Trent auction closed Nov 2022 despite being
  // a season-2023 auction, so a date cutoff would misclassify it (audit §3).
  trentStartSeason: 2023,

  // alesievauctions.com, the community-built auction site, debuted in season
  // 2027. Same rule as above: `source` is read PER AUCTION from the Link, never
  // from this number — it exists so the COPY that tells a reader which seasons a
  // venue covers has one place to read it from, rather than a 2027 typed into
  // each sentence. The quartile lede and the venue comparison both use it.
  alesievStartSeason: 2027,

  // Trent awards 100 points per $1 (~10% effective discount). Constant to date.
  // Written as a single rate but call sites go through trentRewardRate() so a
  // dated table could replace this later without touching them.
  trentRewardRate: 0.1,

  // The company began guaranteeing a Golden Ticket per $8k order around here; GTs
  // then started appearing in normal auction sales. Derived from the data: the
  // first GT sale is auction 202520, closed 2024-11-27 (audit §5).
  goldenTicketGuarantee: { firstSaleAuctionId: '202520', date: '2024-11-27' },

  // The advertised order cost, and the assumed funding target when an auction's
  // own target is unknown (92 auctions). The default is an ASSUMPTION and must be
  // surfaced as one in the UI, never presented as a recorded fact (Concept 3).
  orderCost: 8000,
  defaultTargetFunding: 7500,

  // Withheld estimates average an item's sales from at most this many of the most
  // recent prior same-season auctions (by close date) in which it sold — so the
  // estimate reflects the item's value near when it was withheld, not stale early-
  // season prices. Mirrors the dashboard's "Last 5" recency window. (data-audit §6.1)
  withheldLookbackAuctions: 5,

  // How many of each preorder token a standard order includes, for the Grunnel
  // analysis's preorder benchmark (mean season price × quantity). Fixed year to
  // year; keyed on the prices.csv Item CODE (not display name). Backfill here if a
  // new preorder token appears. (Grunnel analysis: docs/context-layer-design.md §6.2)
  preorderQuantities: {
    'Preorder Bonus': 32,
    'Treasure Chip': 50,
  } as Record<string, number>,

  // The minimum bid step each venue enforces, as bands: a lot priced BELOW `under`
  // moves in `step` dollars. Bands are tried in order and the last one is the
  // ceiling (`under: Infinity`). A venue absent from this map has no published
  // ladder — see bidIncrement, which returns null rather than guessing.
  //
  // Supplied by the maintainer. Checked against every 2027 lot before being
  // written down: ~94% of sub-$10 Alesiev lots sit on the $0.50 grid and ~86% of
  // sub-$10 Trent lots on the $0.25 grid. The rest are bidders adding odd cents
  // to break a tie ($51.01, $24.70, $9.58), which is why anything built on this
  // ADVISES rather than decides.
  //
  // The FORUM is deliberately absent. It has no single auctioneer and so no one
  // ladder, and inventing one would put a confident marker on the comparison we
  // know least about.
  bidIncrements: {
    Trent: [
      { under: 10, step: 0.25 },
      { under: 50, step: 1 },
      { under: Infinity, step: 5 },
    ],
    Alesiev: [
      { under: 10, step: 0.5 },
      { under: Infinity, step: 1 },
    ],
  } as Record<string, { under: number; step: number }[]>,

  // Item names that denote RANDOM ULTRA RARES (released auctioneer payment) — the
  // 9–10 unchosen URs that ship with an $8k order. This is DISTINCT from an
  // "Ultra Rare Set" (e.g. "2024 Ultra Rare Set"), which is a curated set from the
  // auctioneer's personal collection and stays a genuine `augment`. Name-based
  // because the raw data offers no cleaner signal (audit §2/C2); the context
  // validator warns on *random-UR-looking* names not listed here so real drift
  // (a new wording for the random URs) is caught. Case-insensitive, exact match.
  randomUltraRareNames: [
    'Random Ultra Rare',
  ],
} as const;

// --- Season-varying chart-group headings -----------------------------------
// A chart group's name in tokenGroups.csv is a STABLE KEY (it joins tokens to a
// chart and orders the charts); the heading a reader sees is resolved here, per
// season. Most groups are named the same every year and need no entry — their
// key is their heading. The 8k bonus group is the exception: its tokens form a
// set that later transmutes into a reward for the biggest spenders, and the
// company renames the set every few years, so a 2019 chart must read "Orb of
// Dragonkind" while a 2026 chart reads "Path to Enlightenment".
//
// Ranges are inclusive and keyed on the group's CSV name. A season outside every
// range falls back to the key itself — deliberately visible, so a year past the
// last range prompts someone to add the next name rather than silently showing a
// stale one. Add future names here as they're announced.
export const GROUP_SEASON_LABELS: Record<string, { from: number; to: number; label: string }[]> = {
  '8k Bonus Set': [
    { from: 2015, to: 2022, label: 'Orb of Dragonkind' },
    { from: 2023, to: 2026, label: 'Path to Enlightenment' },
    { from: 2027, to: 2029, label: 'Codex of the Familiar' },
  ],
};

// The heading to show for a chart group in a given season. Falls back to the
// group key for groups with no season-varying names (the common case) and for
// seasons no range covers.
export function groupLabel(group: string, season: string | number): string {
  const ranges = GROUP_SEASON_LABELS[group];
  if (!ranges) return group;
  const year = typeof season === 'number' ? season : parseInt(season, 10);
  if (!Number.isFinite(year)) return group;
  return ranges.find((r) => year >= r.from && year <= r.to)?.label ?? group;
}

// The minimum bid step at a given price on a given venue, or null when that
// venue publishes no ladder (the forum — see ERAS.bidIncrements).
export function bidIncrement(venue: string, price: number): number | null {
  const bands = ERAS.bidIncrements[venue];
  if (!bands) return null;
  const p = Math.abs(price);
  return bands.find((b) => p < b.under)?.step ?? null;
}

// The coarsest step among the venues being compared at a given price — the size
// a difference between them has to clear before it can be more than bidding
// granularity. null when ANY venue involved has no published ladder: a step that
// ignores one side of the comparison would understate it.
//
// This is ADVISORY. An average taken over many lots can legitimately resolve
// finer than one increment, so a difference below this is muted, never dropped.
export function comparisonIncrement(venues: string[], price: number): number | null {
  let worst = 0;
  for (const v of venues) {
    const step = bidIncrement(v, price);
    if (step == null) return null;
    worst = Math.max(worst, step);
  }
  return worst || null;
}

// The reward rate in effect for a given auction. A function (not a bare constant)
// so a future dated-rate table slots in here alone.
export function trentRewardRate(_auctionId?: string): number {
  return ERAS.trentRewardRate;
}

// True once the Golden-Ticket guarantee era has begun, by auction close date.
// Dates compare lexically as ISO 'YYYY-MM-DD'; a missing/'n/a' date is treated as
// pre-era (all undated auctions are pre-2023, well before the guarantee).
export function inGoldenTicketEra(closeDate: string): boolean {
  const iso = /^\d{4}-\d{2}-\d{2}/.test(closeDate) ? closeDate.slice(0, 10) : '';
  return iso !== '' && iso >= ERAS.goldenTicketGuarantee.date;
}
