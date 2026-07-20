import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { seasonsOf, groupedTimelines } from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { PriceTimeline } from '../components/PriceTimeline';

// Price Timelines (Phase 2). Every token's per-auction average price over a
// season, shown at once as a stack of charts. Tokens are grouped (via
// public/data/tokenGroups.csv) so each chart holds similarly-priced tokens on a
// readable linear axis; charts are ordered by the file's Group Order. A group
// may span categories, so the page is a flat ordered list, not category
// sections. See docs/expansion-plan.md §6 / the grouping CSV for authoring.
export default function TimelinesPage() {
  const { sales, meta, groupRows, loading, error } = useAuctionData();
  const [season, setSeason] = useState('');

  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  const activeSeason = season || seasons[0] || '';

  const { groups, ungrouped, unmatched } = useMemo(
    () => (activeSeason
      ? groupedTimelines(sales, meta, groupRows, activeSeason)
      : { groups: [], ungrouped: [], unmatched: [] }),
    [sales, meta, groupRows, activeSeason],
  );

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <p className="sub">
        How each token's auction price moved across a season. Every point is one auction's{' '}
        <strong>average</strong> sale price, ordered by close date; tokens are grouped so
        similarly-priced ones share a chart. For per-season min/max/avg tables, see{' '}
        <Link to="/">Prices</Link>.
      </p>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

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
        <section key={g.group} className="cat-section">
          <h2 className="cat-header">{g.group}</h2>
          <PriceTimeline series={g.series.map((s) => ({ label: s.displayName, points: s.points }))} title={g.group} />
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
