import { useMemo, useState } from 'react';
import type { AuctionMeta } from '../lib/data';
import {
  closedByMonthAndAuctioneer, auctionsByOpenDate, daysToCloseByCloseDate,
  closedByCloseMonth, avgDaysByCloseMonth, HIGHLIGHT_AUCTIONEER, auctioneerLabels,
} from '../lib/analytics';
import { fmtCloseDate } from '../lib/format';
import { MonthAccordion } from './MonthAccordion';
import { BarChart } from './BarChart';

// The Current Year half of the analytics page: one season in detail, plus a
// month-by-month comparison against the season before it.
//
// Every panel here is keyed on the SEASON month (see AuctionMeta.openMonth),
// which is what makes the prior-year comparison honest: season month 3 is the
// third month of each season's run, whatever calendar month it fell in.

// Trent runs the clear majority of auctions, so the days-to-close chart splits
// on him rather than colouring 40 auctioneers indistinguishably.
const HIGHLIGHT_COLOR = 'var(--series-1)';
const OTHER_COLOR = 'var(--series-3)';

const CURRENT_COLOR = 'var(--series-1)';
const PRIOR_COLOR = 'var(--series-3)';

const days = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 10) / 10}`);

export function CurrentYearStats({
  meta, season, prior,
}: {
  meta: AuctionMeta[];
  season: string;
  prior: string | null;
}) {
  // Both accordion panels start with every month open: the current season is
  // ~7 months and the whole point is to read it end to end.
  const byAuctioneer = useMemo(() => closedByMonthAndAuctioneer(meta, season), [meta, season]);
  const byOpenDate = useMemo(() => auctionsByOpenDate(meta, season), [meta, season]);
  const bars = useMemo(() => daysToCloseByCloseDate(meta, season), [meta, season]);
  const closeCounts = useMemo(() => closedByCloseMonth(meta, season, prior), [meta, season, prior]);
  const closeDays = useMemo(() => avgDaysByCloseMonth(meta, season, prior), [meta, season, prior]);

  const [shutA, setShutA] = useState<Set<number>>(new Set());
  const [shutB, setShutB] = useState<Set<number>>(new Set());
  const toggle = (set: (fn: (s: Set<number>) => Set<number>) => void, m: number) =>
    set((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  // The highlighted auctioneer's display name, taken from the data rather than
  // hardcoded, so the legend matches whatever spelling the sheet uses.
  const highlightName = auctioneerLabels(meta).get(HIGHLIGHT_AUCTIONEER) ?? 'Highlighted';

  const totalClosed = byOpenDate.reduce((a, g) => a + g.rows.length, 0);
  const missingDuration = totalClosed - bars.length;

  return (
    <>
      {/* --- Auctions closed by month and auctioneer --- */}
      <section className="an-panel">
        <h2>Auctions closed by month and auctioneer</h2>
        <p className="an-lede">
          Closed auctions grouped by the month they <strong>opened</strong>, then by who ran them,
          earliest month first. Average days to close covers only the auctions that recorded a
          duration.
        </p>
        {byAuctioneer.length === 0 ? (
          <p className="empty">No auctions with an open month recorded for {season}.</p>
        ) : byAuctioneer.map((g) => (
          <MonthAccordion
            key={g.month} month={g.month} firstOpen={g.firstOpen} lastOpen={g.lastOpen}
            count={g.rows.reduce((a, r) => a + r.closed, 0)} countLabel="auction"
            open={!shutA.has(g.month)} onToggle={() => toggle(setShutA, g.month)}
          >
            <table className={`an-table${g.rows.length >= 4 ? ' banded' : ''}`}>
              <thead>
                <tr><th className="left">Auctioneer</th><th className="num">Closed</th><th className="num">Avg days to close</th></tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.auctioneer}>
                    <td className="left">{r.auctioneer}</td>
                    <td className="num">{r.closed}</td>
                    <td className="num">{days(r.avgDaysToClose)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </MonthAccordion>
        ))}
      </section>

      {/* --- Auctions by open date --- */}
      <section className="an-panel">
        <h2>Auctions by open date</h2>
        <p className="an-lede">
          Every closed auction of the season in the order it opened.
        </p>
        {byOpenDate.length === 0 ? (
          <p className="empty">No auctions with an open date recorded for {season}.</p>
        ) : byOpenDate.map((g) => (
          <MonthAccordion
            key={g.month} month={g.month} firstOpen={g.firstOpen} lastOpen={g.lastOpen}
            count={g.rows.length} countLabel="auction"
            open={!shutB.has(g.month)} onToggle={() => toggle(setShutB, g.month)}
          >
            <table className={`an-table${g.rows.length >= 4 ? ' banded' : ''}`}>
              <thead>
                <tr>
                  <th className="left">Opened</th><th className="left">Auction</th><th className="left">Auctioneer</th><th className="num">Days to close</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.auctionId}>
                    <td className="left an-date">{fmtCloseDate(r.openDate) ?? r.openDate}</td>
                    <td className="left">
                      {r.link
                        ? <a href={r.link} target="_blank" rel="noreferrer noopener">{r.name}</a>
                        : r.name}
                    </td>
                    <td className="left">{r.auctioneer}</td>
                    <td className="num">{r.daysToClose ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </MonthAccordion>
        ))}
      </section>

      {/* --- Days to close by close date --- */}
      <section className="an-panel">
        <h2>Days to close, by close date</h2>
        <p className="an-lede">
          One bar per auction, in close-date order.{' '}
          <span style={{ color: HIGHLIGHT_COLOR }}>■</span> {highlightName}
          {' · '}
          <span style={{ color: OTHER_COLOR }}>■</span> everyone else.
          {missingDuration > 0 && ` ${missingDuration} auction${missingDuration === 1 ? '' : 's'} left out — no duration recorded.`}
        </p>
        <BarChart
          categories={bars.map((b) => fmtCloseDate(b.closeDate) ?? b.closeDate)}
          series={[{ label: 'Days to close', color: OTHER_COLOR, values: bars.map((b) => b.days) }]}
          barColors={bars.map((b) => (b.highlight ? HIGHLIGHT_COLOR : OTHER_COLOR))}
          hints={bars.map((b) => `${b.auctioneer} — ${b.name}`)}
          yLabel="Days" format={(n) => String(Math.round(n))}
          ariaLabel={`Days to close for each ${season} auction, in close-date order`}
        />
      </section>

      {/* --- Prior-year comparison: auctions closed by month --- */}
      <section className="an-panel">
        <h2>Auctions closed by month vs {prior ?? 'prior season'}</h2>
        {!prior ? (
          <p className="empty">No earlier season with month data to compare against.</p>
        ) : (
          <>
            <p className="an-lede">
              Counted on the <strong>close</strong> month. Months are season months — month 1 is
              each season's first month — so the two years line up by how far into the season they
              are, not by calendar date.
            </p>
            <table className={`an-table${closeCounts.length >= 4 ? ' banded' : ''}`}>
              <thead>
                <tr>
                  <th className="left">Close month</th>
                  <th className="num">{season}</th>
                  <th className="num">{prior}</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {closeCounts.map((r) => {
                  const diff = r.current != null && r.prior != null ? r.current - r.prior : null;
                  return (
                    <tr key={r.month}>
                      <td className="left">Month {r.month}</td>
                      <td className="num">{r.current ?? '—'}</td>
                      <td className="num">{r.prior ?? '—'}</td>
                      <td className={`num diff${diff ? (diff > 0 ? ' up' : ' down') : ''}`}>
                        {diff == null ? '—' : diff > 0 ? `+${diff}` : diff}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th className="left">Total</th>
                  <th className="num">{closeCounts.reduce((a, r) => a + (r.current ?? 0), 0)}</th>
                  <th className="num">{closeCounts.reduce((a, r) => a + (r.prior ?? 0), 0)}</th>
                  <th className="num" />
                </tr>
              </tfoot>
            </table>

            <BarChart
              categories={closeCounts.map((r) => `M${r.month}`)}
              series={[
                { label: season, color: CURRENT_COLOR, values: closeCounts.map((r) => r.current) },
                { label: prior, color: PRIOR_COLOR, values: closeCounts.map((r) => r.prior) },
              ]}
              yLabel="Auctions closed" format={(n) => String(Math.round(n))}
              ariaLabel={`Auctions closed per season month, ${season} against ${prior}`}
              maxLabels={16}
            />
          </>
        )}
      </section>

      {/* --- Prior-year comparison: average time to close --- */}
      <section className="an-panel">
        <h2>Average time to close by month vs {prior ?? 'prior season'}</h2>
        {!prior ? (
          <p className="empty">No earlier season with month data to compare against.</p>
        ) : (
          <>
            <p className="an-lede">
              Average days to close for the auctions that closed in each season month. A missing
              bar means no auction closed in that month that year.
            </p>
            <BarChart
              categories={closeDays.map((r) => `M${r.month}`)}
              series={[
                { label: season, color: CURRENT_COLOR, values: closeDays.map((r) => r.current) },
                { label: prior, color: PRIOR_COLOR, values: closeDays.map((r) => r.prior) },
              ]}
              yLabel="Avg days" format={(n) => String(Math.round(n * 10) / 10)}
              ariaLabel={`Average days to close per season month, ${season} against ${prior}`}
              maxLabels={16}
            />
          </>
        )}
      </section>
    </>
  );
}
