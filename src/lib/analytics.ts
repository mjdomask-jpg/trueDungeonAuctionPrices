// Auction-metadata analytics (Phase 5). Every other view on this site is about
// what tokens sold for; this one is about the auctions themselves — who ran
// them, when they opened, how long they took to close.
//
// Two axes, matching the two workbook tabs this replaces:
//   - Current Year: one season in detail, always the latest season with data
//     (never a hardcoded year), compared against the season before it.
//   - Historical: every season for which the underlying column exists.
//
// Coverage is uneven and that is load-bearing. daysToClose / Open Month /
// Close Month were only recorded from 2022 on, so anything built on them must
// exclude earlier seasons rather than plot them as zero. seasonsWithCadence()
// is the single place that decides which seasons qualify.
//
// Pure functions over AuctionMeta[] / Sale[]; no React, no fetching.

import type { AuctionMeta, Sale } from './data';

// --- Auctioneer identity -----------------------------------------------

// The auctioneer column is free text and has drifted: "Edwin"/"edwin" and
// "Ralykam"/"ralykam" are the same person typed twice, and one 2021 row is
// blank. We fold case (safe — a pure case difference is never two people) and
// label the blank, but deliberately do NOT merge similar-but-distinct names
// like "Wade"/"Wade S" or "Casey Wren"/"Casey": that is a judgement about who
// people are, and it belongs in the sheet, not in a display-time heuristic.
export const UNKNOWN_AUCTIONEER = 'Unknown';

export function auctioneerKey(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  return s ? s.toLowerCase() : UNKNOWN_AUCTIONEER.toLowerCase();
}

// Display form for a folded key: the spelling used most often in the data, so
// "Ralykam" (5 rows) wins over "ralykam" (4) rather than us picking one.
export function auctioneerLabels(meta: AuctionMeta[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const m of meta) {
    const key = auctioneerKey(m.auctioneer);
    const shown = (m.auctioneer ?? '').trim() || UNKNOWN_AUCTIONEER;
    const inner = counts.get(key) ?? new Map<string, number>();
    inner.set(shown, (inner.get(shown) ?? 0) + 1);
    counts.set(key, inner);
  }
  const out = new Map<string, string>();
  for (const [key, inner] of counts) {
    let best = '', bestN = -1;
    // Ties break alphabetically so the label is stable across reloads.
    for (const [name, n] of [...inner].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (n > bestN) { best = name; bestN = n; }
    }
    out.set(key, best);
  }
  return out;
}

// --- Season selection ---------------------------------------------------

export const closedOnly = (meta: AuctionMeta[]) => meta.filter((m) => m.status === 'Closed');

// Seasons present in the metadata, newest first.
export function metaSeasons(meta: AuctionMeta[]): string[] {
  return [...new Set(meta.map((m) => m.season))].filter(Boolean).sort((a, b) => Number(b) - Number(a));
}

// Seasons that actually carry cadence data (open/close month, days to close).
// Anything built on those columns iterates this, not metaSeasons, so 2019–21
// drop out instead of rendering as empty months.
export function seasonsWithCadence(meta: AuctionMeta[]): string[] {
  const ok = new Set<string>();
  for (const m of closedOnly(meta)) {
    if (m.openMonth != null || m.closeMonth != null || m.daysToClose != null) ok.add(m.season);
  }
  return [...ok].sort((a, b) => Number(b) - Number(a));
}

// The season the Current Year view opens on: the newest one with cadence data.
export function currentSeason(meta: AuctionMeta[]): string | null {
  return seasonsWithCadence(meta)[0] ?? null;
}

// The season to compare against — the next one down that also has cadence
// data, so a gap in the record skips rather than compares against nothing.
export function priorSeason(meta: AuctionMeta[], season: string): string | null {
  const list = seasonsWithCadence(meta);
  const i = list.indexOf(season);
  return i >= 0 && i + 1 < list.length ? list[i + 1] : null;
}

// --- Shared helpers -----------------------------------------------------

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// Sort key for an ISO date; blank/"n/a" sort last so undated rows sink to the
// bottom of an ascending list rather than leading it.
const dateKey = (iso: string | undefined) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso ?? '') ? (iso as string).slice(0, 10) : '9999-99-99';

const seasonRows = (meta: AuctionMeta[], season: string) =>
  closedOnly(meta).filter((m) => m.season === season);

// --- Current Year: auctions closed by month and auctioneer --------------

export type AuctioneerMonthRow = {
  auctioneer: string;
  closed: number;
  avgDaysToClose: number | null;
};

export type MonthGroup<T> = {
  month: number;          // season month (1 = the season's first month)
  firstOpen: string;      // ISO date of the earliest auction in the group
  lastOpen: string;       // ISO date of the latest — together they label the group
  rows: T[];
};

// Auctions closed, grouped by the month they OPENED, then by auctioneer.
// Groups are ordered by open month ascending (earliest first). Auctions with
// no open month recorded are dropped rather than bucketed into a fake month.
export function closedByMonthAndAuctioneer(
  meta: AuctionMeta[],
  season: string,
): MonthGroup<AuctioneerMonthRow>[] {
  const labels = auctioneerLabels(meta);
  const byMonth = new Map<number, AuctionMeta[]>();
  for (const m of seasonRows(meta, season)) {
    if (m.openMonth == null) continue;
    byMonth.set(m.openMonth, [...(byMonth.get(m.openMonth) ?? []), m]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, rows]) => {
      const byAuctioneer = new Map<string, AuctionMeta[]>();
      for (const m of rows) {
        const k = auctioneerKey(m.auctioneer);
        byAuctioneer.set(k, [...(byAuctioneer.get(k) ?? []), m]);
      }
      const opens = rows.map((m) => dateKey(m.openDate)).filter((d) => d !== '9999-99-99').sort();
      return {
        month,
        firstOpen: opens[0] ?? '',
        lastOpen: opens[opens.length - 1] ?? '',
        rows: [...byAuctioneer.entries()]
          .map(([key, ms]) => ({
            auctioneer: labels.get(key) ?? key,
            closed: ms.length,
            // Averaged over the rows that recorded it, not over all of them —
            // a blank daysToClose must not read as a fast close.
            avgDaysToClose: mean(ms.map((m) => m.daysToClose).filter((d): d is number => d != null)),
          }))
          // Busiest auctioneer first, then alphabetically.
          .sort((a, b) => b.closed - a.closed || (a.auctioneer < b.auctioneer ? -1 : 1)),
      };
    });
}

// --- Current Year: auctions by open date --------------------------------

export type OpenDateRow = {
  auctionId: string;
  openDate: string;
  name: string;
  auctioneer: string;
  daysToClose: number | null;
  link: string;
};

// Every closed auction of the season, grouped by open month and ordered by
// open date ascending within each group.
export function auctionsByOpenDate(meta: AuctionMeta[], season: string): MonthGroup<OpenDateRow>[] {
  const labels = auctioneerLabels(meta);
  const byMonth = new Map<number, AuctionMeta[]>();
  for (const m of seasonRows(meta, season)) {
    if (m.openMonth == null) continue;
    byMonth.set(m.openMonth, [...(byMonth.get(m.openMonth) ?? []), m]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, rows]) => {
      const sorted = rows.slice().sort(
        (a, b) => (dateKey(a.openDate) < dateKey(b.openDate) ? -1 : dateKey(a.openDate) > dateKey(b.openDate) ? 1 : a.auctionNumber - b.auctionNumber),
      );
      const opens = sorted.map((m) => dateKey(m.openDate)).filter((d) => d !== '9999-99-99');
      return {
        month,
        firstOpen: opens[0] ?? '',
        lastOpen: opens[opens.length - 1] ?? '',
        rows: sorted.map((m) => ({
          auctionId: m.auctionId,
          openDate: m.openDate,
          name: m.name,
          auctioneer: labels.get(auctioneerKey(m.auctioneer)) ?? m.auctioneer,
          daysToClose: m.daysToClose,
          link: m.link,
        })),
      };
    });
}

// --- Current Year: days to close by close date --------------------------

export type DaysToCloseBar = {
  auctionId: string;
  closeDate: string;
  days: number;
  name: string;
  auctioneer: string;
  highlight: boolean; // the split the chart colours on
};

// The auctioneer the days-to-close chart singles out. Trent runs 111 of the
// 276 auctions on record — far more than anyone else — so "Trent vs everyone
// else" is the comparison that actually reads on that chart.
export const HIGHLIGHT_AUCTIONEER = 'trent';

// One bar per closed auction that recorded a duration, ordered by close date.
export function daysToCloseByCloseDate(meta: AuctionMeta[], season: string): DaysToCloseBar[] {
  const labels = auctioneerLabels(meta);
  return seasonRows(meta, season)
    .filter((m) => m.daysToClose != null && dateKey(m.closeDate) !== '9999-99-99')
    .sort((a, b) => (dateKey(a.closeDate) < dateKey(b.closeDate) ? -1 : dateKey(a.closeDate) > dateKey(b.closeDate) ? 1 : a.auctionNumber - b.auctionNumber))
    .map((m) => ({
      auctionId: m.auctionId,
      closeDate: m.closeDate,
      days: m.daysToClose as number,
      name: m.name,
      auctioneer: labels.get(auctioneerKey(m.auctioneer)) ?? m.auctioneer,
      highlight: auctioneerKey(m.auctioneer) === HIGHLIGHT_AUCTIONEER,
    }));
}

// --- Current Year: prior-year comparison by close month -----------------

export type MonthCompareRow = {
  month: number;
  current: number | null;   // count, or avg days, depending on the builder
  prior: number | null;
};

// Compare two seasons month by month on the SEASON month (see AuctionMeta) —
// which is why this is a fair comparison at all: season month 3 is the third
// month of each season's run, whatever calendar month it happened to fall in.
// Months are unioned across both seasons so one that only ran in the prior
// year still appears, with a null on the current side.
function compareByCloseMonth(
  meta: AuctionMeta[],
  season: string,
  prior: string | null,
  reduce: (rows: AuctionMeta[]) => number | null,
): MonthCompareRow[] {
  const bucket = (s: string) => {
    const map = new Map<number, AuctionMeta[]>();
    for (const m of seasonRows(meta, s)) {
      if (m.closeMonth == null) continue;
      map.set(m.closeMonth, [...(map.get(m.closeMonth) ?? []), m]);
    }
    return map;
  };
  const cur = bucket(season);
  const pri = prior ? bucket(prior) : new Map<number, AuctionMeta[]>();
  const months = [...new Set([...cur.keys(), ...pri.keys()])].sort((a, b) => a - b);
  return months.map((month) => ({
    month,
    current: cur.has(month) ? reduce(cur.get(month)!) : null,
    prior: pri.has(month) ? reduce(pri.get(month)!) : null,
  }));
}

export function closedByCloseMonth(meta: AuctionMeta[], season: string, prior: string | null) {
  return compareByCloseMonth(meta, season, prior, (rows) => rows.length);
}

export function avgDaysByCloseMonth(meta: AuctionMeta[], season: string, prior: string | null) {
  return compareByCloseMonth(meta, season, prior, (rows) =>
    mean(rows.map((m) => m.daysToClose).filter((d): d is number => d != null)));
}

// --- Historical: auctions per season ------------------------------------

export type SeasonCount = { season: string; closed: number; auctioneers: number };

// Oldest first — this one reads as a trend, so it runs left to right in time.
export function auctionsPerSeason(meta: AuctionMeta[]): SeasonCount[] {
  const map = new Map<string, AuctionMeta[]>();
  for (const m of closedOnly(meta)) map.set(m.season, [...(map.get(m.season) ?? []), m]);
  return [...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([season, rows]) => ({
      season,
      closed: rows.length,
      auctioneers: new Set(rows.map((m) => auctioneerKey(m.auctioneer))).size,
    }));
}

// --- Historical: auctioneer share, per season and as a matrix -----------

export type AuctioneerShare = { auctioneer: string; count: number; share: number };
export type SeasonShares = { season: string; total: number; slices: AuctioneerShare[] };

// Per-season breakdown of who ran how many auctions, as a share of that
// season's total. Newest season first; within a season, biggest share first.
export function auctioneerSharesBySeason(meta: AuctionMeta[]): SeasonShares[] {
  const labels = auctioneerLabels(meta);
  const bySeason = new Map<string, AuctionMeta[]>();
  for (const m of closedOnly(meta)) bySeason.set(m.season, [...(bySeason.get(m.season) ?? []), m]);

  return [...bySeason.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([season, rows]) => {
      const counts = new Map<string, number>();
      for (const m of rows) {
        const k = auctioneerKey(m.auctioneer);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return {
        season,
        total: rows.length,
        slices: [...counts.entries()]
          .map(([key, count]) => ({
            auctioneer: labels.get(key) ?? key,
            count,
            share: count / rows.length,
          }))
          .sort((a, b) => b.count - a.count || (a.auctioneer < b.auctioneer ? -1 : 1)),
      };
    });
}

export type AuctioneerMatrix = {
  seasons: string[];                                  // column headers, oldest → newest
  rows: { auctioneer: string; counts: (number | null)[]; total: number }[];
};

// Auctioneers down the side, seasons across the top. null (not 0) where an
// auctioneer ran nothing that season, so the table can render "—" and keep a
// genuine zero distinguishable from an absence.
export function auctioneerSeasonMatrix(meta: AuctionMeta[]): AuctioneerMatrix {
  const labels = auctioneerLabels(meta);
  const rows = closedOnly(meta);
  const seasons = [...new Set(rows.map((m) => m.season))].sort((a, b) => Number(a) - Number(b));

  const counts = new Map<string, Map<string, number>>();
  for (const m of rows) {
    const k = auctioneerKey(m.auctioneer);
    const inner = counts.get(k) ?? new Map<string, number>();
    inner.set(m.season, (inner.get(m.season) ?? 0) + 1);
    counts.set(k, inner);
  }

  return {
    seasons,
    rows: [...counts.entries()]
      .map(([key, inner]) => {
        const total = [...inner.values()].reduce((a, b) => a + b, 0);
        return {
          auctioneer: labels.get(key) ?? key,
          counts: seasons.map((s) => inner.get(s) ?? null),
          total,
        };
      })
      .sort((a, b) => b.total - a.total || (a.auctioneer < b.auctioneer ? -1 : 1)),
  };
}

// --- Historical: one token's price across every season ------------------

export type ItemHistoryPoint = { season: string; avg: number; min: number; max: number; n: number };

// Canonical Item names, alphabetical — the picker for the price-history chart.
// Keys on Item (not Display Name) because the public name changes year to year
// while the item filling that role does not.
export function historyItems(sales: Sale[]): string[] {
  return [...new Set(sales.map((s) => s.item).filter(Boolean))].sort((a, b) => (a < b ? -1 : 1));
}

// One point per season for a single item: the average of every sale of it that
// season, with min/max/n carried for the tooltip. Compressing a season's many
// sales to one point is deliberate — across eight seasons the per-auction
// series is unreadable, and the question here is the year-over-year trend.
// Seasons the item didn't sell in are absent, not zero.
export function itemPriceHistory(sales: Sale[], item: string): ItemHistoryPoint[] {
  const bySeason = new Map<string, number[]>();
  for (const s of sales) {
    if (s.item !== item) continue;
    bySeason.set(s.season, [...(bySeason.get(s.season) ?? []), s.price]);
  }
  return [...bySeason.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([season, prices]) => ({
      season,
      avg: prices.reduce((a, b) => a + b, 0) / prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      n: prices.length,
    }));
}

// The display name an item carried in a given season, for labelling a chart
// whose x-axis spans renames. Falls back to the canonical name.
export function displayNameIn(sales: Sale[], item: string, season: string): string {
  return sales.find((s) => s.item === item && s.season === season)?.displayName || item;
}
