// The withheld point-in-time recompute, shared by validate-context.mjs (which
// checks it) and gen-withheld-preview.mjs (which writes the golden file it is
// checked against).
//
// WHY THIS FILE EXISTS. Both scripts used to carry their own copy, each
// commented "mirror of src/lib/context.ts". When context.ts gained the Onyx
// feed and the forward fallback (PR #252), neither copy followed — so the
// generator would have written a golden file the site disagrees with, and the
// checker would have passed it. That is the same failure `scripts/lib/tokendb.mjs`
// was extracted to prevent: "a fetcher that files a page its own parser likes
// while the check reads it differently is the worst kind of green."
//
// One copy cannot drift from itself. It is still a mirror of src/lib/context.ts
// — the browser code is TypeScript and these run as plain .mjs in CI — so
// CHANGING THE RULE MEANS CHANGING BOTH, and the rule is small enough to read
// side by side. Keep valueWithheld() below line-for-line comparable with
// context.ts's.

// Mirror of ERAS.withheldLookbackAuctions.
export const WITHHELD_LOOKBACK_AUCTIONS = 5;

const dateKey = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '');

// Mirror of context.ts auctionInstant.
function instant(m) {
  const k = dateKey(m.closeDate);
  if (k) return Date.parse(k);
  return -1e15 + Number(m.auctionSeason) * 1000 + Number(m.auctionNumber);
}

/**
 * Build the index the recompute reads.
 *
 * `sales` must carry BOTH price feeds — prices.csv and onyx.csv. An auctioneer
 * can withhold part of an Onyx order, and an Onyx chase token appears in no
 * other file, so a prices-only index can never value one. The two files share
 * no display name at all, so combining them cannot disturb anything else.
 */
export function buildWithheldIndex(sales, meta) {
  const instantById = new Map(meta.map((m) => [m.auctionId, instant(m)]));
  const seasonById = new Map(meta.map((m) => [m.auctionId, m.auctionSeason]));
  const salesByName = new Map();
  for (const s of sales) {
    const inst = instantById.get(s.auctionId);
    if (inst == null) continue;
    (salesByName.get(s.displayName) ?? salesByName.set(s.displayName, []).get(s.displayName))
      .push({ season: s.season, inst, auctionId: s.auctionId, price: s.price });
  }
  return { instantById, seasonById, salesByName };
}

// Mean of an item's sales over the N auctions nearest in time, in one
// direction. Ranked by close instant, id as the tiebreak for a same-day close
// (lexicographic — backlog SITE-12). Mirror of context.ts nearestMean.
function nearestMean(sales, dir) {
  const instByAuction = new Map();
  for (const s of sales) instByAuction.set(s.auctionId, s.inst);
  const ranked = [...instByAuction.entries()].sort((a, b) => (dir === 'back'
    ? b[1] - a[1] || (a[0] < b[0] ? 1 : -1)
    : a[1] - b[1] || (a[0] < b[0] ? -1 : 1)));
  const keep = new Set(ranked.slice(0, WITHHELD_LOOKBACK_AUCTIONS).map(([id]) => id));
  const window = sales.filter((s) => keep.has(s.auctionId));
  return {
    mean: window.reduce((a, s) => a + s.price, 0) / window.length,
    n: window.length,
    window: [...keep].sort().join(';'),
  };
}

/**
 * The point-in-time estimate for one withheld row. Mirror of context.ts
 * valueWithheld.
 *
 * Same-season sales from the ≤5 most recent auctions that closed STRICTLY
 * BEFORE this one, negated, × quantity. When nothing sold before — and only
 * then — it falls FORWARD to the nearest later auctions of the same season,
 * because a season's first Onyx auction withholding part of its own set has no
 * prior by definition. Same season only: a chase token is year-specific.
 *
 * Returns `direction` so the golden file can record which way the window ran.
 */
export function valueWithheld(name, auctionId, qty, refValue, idx) {
  const season = idx.seasonById.get(auctionId);
  const wInst = idx.instantById.get(auctionId);
  const sameSeason = (idx.salesByName.get(name) ?? [])
    .filter((s) => s.season === season && wInst != null);

  const prior = sameSeason.filter((s) => s.inst < wInst);
  if (prior.length) {
    const { mean, n, window } = nearestMean(prior, 'back');
    return { value: -mean * qty, n, window, direction: 'back' };
  }
  const later = sameSeason.filter((s) => s.inst > wInst);
  if (later.length) {
    const { mean, n, window } = nearestMean(later, 'forward');
    return { value: -mean * qty, n, window, direction: 'forward' };
  }
  return { value: refValue ?? 0, n: 0, window: '', direction: 'none' };
}
