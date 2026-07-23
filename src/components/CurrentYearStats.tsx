import { useEffect, useMemo, useState } from 'react';
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

const jumpTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// Expand all / Collapse all over a set of month accordions, matching the pair
// above the grouped view on the Auction Data page.
function AccordionActions({ onExpand, onCollapse }: { onExpand: () => void; onCollapse: () => void }) {
  return (
    <p className="an-actions">
      <button type="button" onClick={onExpand}>Expand all</button>
      <button type="button" onClick={onCollapse}>Collapse all</button>
    </p>
  );
}

export function CurrentYearStats({
  meta, season, prior,
}: {
  meta: AuctionMeta[];
  season: string;
  prior: string | null;
}) {
  const byAuctioneer = useMemo(() => closedByMonthAndAuctioneer(meta, season), [meta, season]);
  const byOpenDate = useMemo(() => auctionsByOpenDate(meta, season), [meta, season]);
  const bars = useMemo(() => daysToCloseByCloseDate(meta, season), [meta, season]);
  const closeCounts = useMemo(() => closedByCloseMonth(meta, season, prior), [meta, season, prior]);
  const closeDays = useMemo(() => avgDaysByCloseMonth(meta, season, prior), [meta, season, prior]);

  // Accordions hold the months that are OPEN and start empty — every month
  // expanded made the page enormously long, and both tables are meant to be
  // scanned by month rather than read end to end. Switching season resets
  // them, since the months themselves are different.
  const [openA, setOpenA] = useState<Set<number>>(new Set());
  const [openB, setOpenB] = useState<Set<number>>(new Set());
  useEffect(() => { setOpenA(new Set()); setOpenB(new Set()); }, [season]);

  const toggle = (set: (fn: (s: Set<number>) => Set<number>) => void, m: number) =>
    set((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; });

  // The highlighted auctioneer's display name, taken from the data rather than
  // hardcoded, so the legend matches whatever spelling the sheet uses.
  const highlightName = auctioneerLabels(meta).get(HIGHLIGHT_AUCTIONEER) ?? 'Highlighted';

  const totalClosed = byOpenDate.reduce((a, g) => a + g.rows.length, 0);
  const missingDuration = totalClosed - bars.length;

  // Section ids double as the jump-link targets and the panel anchors, so the
  // two can't drift apart.
  const sections = [
    { id: 'by-auctioneer', label: 'By month & auctioneer' },
    { id: 'by-open-date', label: 'By open date' },
    { id: 'days-to-close', label: 'Days to close' },
    { id: 'closed-vs-prior', label: `Closed by month vs ${prior ?? 'prior'}` },
    { id: 'avg-close-vs-prior', label: `Avg time to close vs ${prior ?? 'prior'}` },
  ];

  return (
    <>
      {/* Buttons, not <a href="#id">. The app runs on a HashRouter, so the URL
          hash IS the route — a fragment link would be read as a navigation to
          "/by-auctioneer" and blank the page. */}
      <nav className="an-jump" aria-label="Jump to section">
        <span className="an-jump-label">Jump to</span>
        {sections.map((s) => (
          <button key={s.id} type="button" onClick={() => jumpTo(s.id)}>{s.label}</button>
        ))}
      </nav>

      {/* --- Auctions closed by month and auctioneer --- */}
      <section className="an-panel" id="by-auctioneer">
        <h2>Auctions closed by month and auctioneer</h2>
        <p className="an-lede">
          Closed auctions grouped by the month they <strong>opened</strong>, then by who ran them,
          earliest month first. Average days to close covers only the auctions that recorded a
          duration.
        </p>
        {byAuctioneer.length === 0 ? (
          <p className="empty">No auctions with an open month recorded for {season}.</p>
        ) : <>
          <AccordionActions
            onExpand={() => setOpenA(new Set(byAuctioneer.map((g) => g.month)))}
            onCollapse={() => setOpenA(new Set())}
          />
          {byAuctioneer.map((g) => (
          <MonthAccordion
            key={g.month} month={g.month} firstOpen={g.firstOpen} lastOpen={g.lastOpen}
            count={g.rows.reduce((a, r) => a + r.closed, 0)} countLabel="auction"
            open={openA.has(g.month)} onToggle={() => toggle(setOpenA, g.month)}
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
        </>}
      </section>

      {/* --- Auctions by open date --- */}
      <section className="an-panel" id="by-open-date">
        <h2>Auctions by open date</h2>
        <p className="an-lede">
          Every closed auction of the season in the order it opened.
        </p>
        {byOpenDate.length === 0 ? (
          <p className="empty">No auctions with an open date recorded for {season}.</p>
        ) : <>
          <AccordionActions
            onExpand={() => setOpenB(new Set(byOpenDate.map((g) => g.month)))}
            onCollapse={() => setOpenB(new Set())}
          />
          {byOpenDate.map((g) => (
          <MonthAccordion
            key={g.month} month={g.month} firstOpen={g.firstOpen} lastOpen={g.lastOpen}
            count={g.rows.length} countLabel="auction"
            open={openB.has(g.month)} onToggle={() => toggle(setOpenB, g.month)}
          >
            {/* Fixed layout + explicit widths: auction names run to 60-odd
                characters and would otherwise shove the later columns off the
                card. The name cell wraps; the rest stay on one line. */}
            <table className={`an-table an-opens${g.rows.length >= 4 ? ' banded' : ''}`}>
              <colgroup>
                <col className="col-opened" /><col className="col-auction" />
                <col className="col-auctioneer" /><col className="col-days" />
              </colgroup>
              <thead>
                <tr>
                  <th className="left">Opened</th><th className="left">Auction</th><th className="left">Auctioneer</th><th className="num">Days to close</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.auctionId}>
                    <td className="left an-date">{fmtCloseDate(r.openDate) ?? r.openDate}</td>
                    <td className="left wrap-text">
                      {r.link
                        ? <a href={r.link} target="_blank" rel="noreferrer noopener">{r.name}</a>
                        : r.name}
                    </td>
                    <td className="left wrap-text">{r.auctioneer}</td>
                    <td className="num">{r.daysToClose ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </MonthAccordion>
          ))}
        </>}
      </section>

      {/* --- Days to close by close date --- */}
      <section className="an-panel" id="days-to-close">
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
      <section className="an-panel" id="closed-vs-prior">
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

            <table className={`an-table an-after-chart${closeCounts.length >= 4 ? ' banded' : ''}`}>
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
          </>
        )}
      </section>

      {/* --- Prior-year comparison: average time to close --- */}
      <section className="an-panel" id="avg-close-vs-prior">
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
