import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { seasonsOf, aggregateSeason, type ItemRow } from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { CategoryTable } from '../components/CategoryTable';

// Onyx sub-list. Onyx orders swap part of an Ultra Rare allotment for a fixed
// set of chase versions; those tokens sell through the auctions with their own
// price history, tracked separately from the main list. Because the Onyx feed
// is raw sales in the same schema as prices.csv, we reuse the exact dashboard
// aggregation (full-season + last-5) and render with the same CategoryTable.
export default function OnyxPage() {
  const { onyxSales, loading, error } = useAuctionData();
  const [season, setSeason] = useState('');

  const seasons = useMemo(() => seasonsOf(onyxSales), [onyxSales]);
  const activeSeason = season || seasons[0] || '';

  const rows = useMemo(
    () => (activeSeason ? aggregateSeason(onyxSales, activeSeason) : []),
    [onyxSales, activeSeason],
  );

  // Group into per-category tables (alphabetical); most Onyx lists are a single
  // category, so this usually renders one table.
  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    return [...byCat.keys()].sort().map((cat) => ({
      category: cat,
      rows: byCat.get(cat)!.slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }));
  }, [rows]);

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <p className="sub">
        An <strong>Onyx</strong> order swaps part of an Ultra Rare allotment for a fixed set of{' '}
        <em>chase</em> versions — one of each Ultra Rare in the set. Onyx tokens sell through the
        auctions with their own price history, tracked separately from the main{' '}
        <Link to="/">Prices</Link> list.
      </p>

      {onyxSales.length === 0 ? (
        <p className="empty">
          No Onyx price data yet. Drop an export into <code>public/data/onyx.csv</code> using the
          same columns as <code>prices.csv</code> (auctionId, auctionSeason, auctionNumber, Item,
          Price, Display&nbsp;Name, Category), and this section fills in automatically.
        </p>
      ) : (
        <>
          <div className="controls">
            <label>
              Season
              <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
                {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>

          {groups.length === 0 && <p className="empty">No Onyx sales in {activeSeason}.</p>}
          {groups.map((g) => (
            <CategoryTable key={g.category} category={g.category} rows={g.rows} banded />
          ))}
        </>
      )}
    </>
  );
}
