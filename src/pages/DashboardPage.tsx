import { useMemo, useState } from 'react';
import {
  seasonsOf, aggregateSeason, lastFiveAuctionNumbers, type ItemRow,
} from '../lib/data';
import { fmtCloseDate } from '../lib/format';
import { useAuctionData } from '../data/auctionDataContext';
import { CategoryTable } from '../components/CategoryTable';

// Fixed display order for the per-category tables. Any category not listed
// here is appended afterward, alphabetically.
const CATEGORY_ORDER = [
  'Trade Good 1', 'Trade Good 2', 'Ultra Rare', 'Premium', 'Bonus', 'Preorder', 'Golden Ticket',
];

export default function DashboardPage() {
  const { sales, meta, loading, error } = useAuctionData();
  const [season, setSeason] = useState<string>('');
  const [category, setCategory] = useState('All');

  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  // Default to the newest season once data has loaded.
  const activeSeason = season || seasons[0] || '';

  const rows = useMemo(
    () => (activeSeason ? aggregateSeason(sales, activeSeason) : []),
    [sales, activeSeason],
  );
  const last5Nums = useMemo(
    () => (activeSeason ? lastFiveAuctionNumbers(sales, activeSeason) : []),
    [sales, activeSeason],
  );
  const categories = useMemo(
    () => ['All', ...[...new Set(rows.map((r) => r.category))].sort()],
    [rows],
  );

  const filtered = rows.filter((r) => category === 'All' || r.category === category);

  // Group the filtered rows into per-category tables, ordered by CATEGORY_ORDER
  // (unlisted categories appended alphabetically). Rows within each table are
  // sorted alphabetically by token (display) name.
  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const r of filtered) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    const order = [...byCat.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return order.map((cat) => ({
      category: cat,
      rows: byCat.get(cat)!.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }));
  }, [filtered]);

  const closedAuctions = meta
    .filter((m) => m.season === activeSeason && m.status === 'Closed')
    .length;

  // Global intro stats (across all seasons).
  const totalClosedAuctions = meta.filter((m) => m.status === 'Closed').length;
  const firstYear = seasons[seasons.length - 1];
  const lastYear = seasons[0];

  // Close dates for the "Last 5" window, looked up from metadata by auction
  // number. Falls back to "#N" if a close date is missing.
  const closeDateByNumber = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of meta) if (m.season === activeSeason) map.set(m.auctionNumber, m.closeDate);
    return map;
  }, [meta, activeSeason]);
  const last5Label = (n: number | undefined) =>
    n == null ? '' : fmtCloseDate(closeDateByNumber.get(n)) ?? `#${n}`;

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <p className="sub">
        Welcome to the True Dungeon auction analysis! These statistics are calculated
        live from {totalClosedAuctions.toLocaleString()} auctions from {firstYear} to {lastYear}.
        This covers {sales.length.toLocaleString()} items sold!
      </p>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <p className="meta-line">
        Season {activeSeason}: {closedAuctions} closed auctions ·
        {' '}"Last 5" = {last5Nums.map(last5Label).join(', ')}
      </p>

      {groups.length === 0 && <p className="empty">No matching items.</p>}
      {groups.map((g) => (
        <CategoryTable key={g.category} category={g.category} rows={g.rows} />
      ))}
    </>
  );
}
