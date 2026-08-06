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
