import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { seasonsOf, groupedTimelines, tenXTimelinePoints, TRADE_1, TENX_PREFIX } from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters } from '../data/filtersContext';
import { applyViewFilters } from '../lib/context';
import { PriceTimeline } from '../components/PriceTimeline';
import { FilterBar } from '../components/FilterBar';
import { TenXToggle } from '../components/TenXToggle';
import { useTenX } from '../hooks/useTenX';
import { PageIntro } from '../components/PageIntro';

// Price Timelines (Phase 2). Every token's per-auction average price over a
// season, shown at once as a stack of charts. Tokens are grouped (via
// public/data/tokenGroups.csv) so each chart holds similarly-priced tokens on a
// readable linear axis; charts are ordered by the file's Group Order. A group
// may span categories, so the page is a flat ordered list, not category
// sections. See docs/expansion-plan.md §6 / the grouping CSV for authoring.
export default function TimelinesPage() {
  const { sales, meta, groupRows, goldenTicketAuctions, loading, error } = useAuctionData();
  const { filters } = useFilters();
  const [season, setSeason] = useState('');
  // Show Trade 1 tokens as their "10x" bundle, matching the Prices page — see
  // useTenX. Rescales the Trade 1 charts' axes ×10; other charts are untouched.
  const [tenX, setTenX] = useTenX();

  // Season list from the UNFILTERED feed, so filtering never empties the dropdown.
  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  const activeSeason = season || seasons[0] || '';

  // Apply the shared Source / Trent-pricing / Auction-type filters to the sales
  // before charting, so a timeline reflects the chosen source (and reward-adjusted
  // prices). Defaults leave the feed untouched.
  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);
  const viewSales = useMemo(
    () => applyViewFilters(sales, metaById, goldenTicketAuctions, filters),
    [sales, metaById, goldenTicketAuctions, filters],
  );

  const { groups: rawGroups, ungrouped, unmatched } = useMemo(
    () => (activeSeason
      ? groupedTimelines(viewSales, meta, groupRows, activeSeason)
      : { groups: [], ungrouped: [], unmatched: [] }),
    [viewSales, meta, groupRows, activeSeason],
  );

  // Rewrite Trade 1 series to their 10x bundle when the toggle is on. Every
  // series in a Trade 1 group scales together, so the shared axis stays readable.
  const groups = useMemo(() => (tenX
    ? rawGroups.map((g) => ({
      ...g,
      series: g.series.map((s) => (s.category === TRADE_1
        ? { ...s, displayName: `${TENX_PREFIX}${s.displayName}`, points: tenXTimelinePoints(s.points) }
        : s)),
    }))
    : rawGroups), [rawGroups, tenX]);

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <PageIntro short="Track how each token's auction price moved across a season.">
        How each token's auction price moved across a season. Every point is one auction's{' '}
        <strong>average</strong> sale price, ordered by close date; tokens are grouped so
        similarly-priced ones share a chart. For per-season min/max/avg tables, see{' '}
        <Link to="/">Prices</Link>.
      </PageIntro>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <TenXToggle on={tenX} onChange={setTenX} />
      </div>

      <FilterBar controls={['source', 'trentPricing', 'auctionType']} collapsibleOnMobile />

      {unmatched.length > 0 && (
        <p className="err">
          Grouping references {unmatched.length} unknown token{unmatched.length === 1 ? '' : 's'}{' '}
          (check the Item names in tokenGroups.csv): {unmatched.join(', ')}
        </p>
      )}

      {groupRows.length === 0 && (
        <p className="empty">
          No token grouping loaded. Add <code>public/data/tokenGroups.csv</code>{' '}
          (Category, Item, Display&nbsp;Name, Group, Group&nbsp;Order) to lay out the charts.
        </p>
      )}

      {groupRows.length > 0 && groups.length === 0 && (
        <p className="empty">No grouped tokens sold in {activeSeason}.</p>
      )}

      {groups.map((g) => (
        <section key={g.group} className="cat-section" data-category={g.category}>
          <h2 className="cat-header">{g.group}</h2>
          <PriceTimeline
            series={g.series.map((s) => ({ label: s.displayName, points: s.points, lineColor: s.lineColor }))}
            title={g.group}
          />
        </section>
      ))}

      {ungrouped.length > 0 && (
        <p className="meta-line">
          Not charted (no group assigned in {activeSeason}): {ungrouped.join(', ')}
        </p>
      )}
    </>
  );
}
