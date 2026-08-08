import { useMemo, useState } from 'react';
import {
  seasonsOf, aggregateSeason, lastFiveAuctionNumbers, asTenXRows, openAuctions, type ItemRow,
} from '../lib/data';
import { fmtCloseDate } from '../lib/format';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters } from '../data/filtersContext';
import { applyViewFilters, passesAuctionFilters } from '../lib/context';
import { CategoryTable } from '../components/CategoryTable';
import { FilterBar } from '../components/FilterBar';
import { TenXToggle } from '../components/TenXToggle';
import { OpenAuctionsBanner } from '../components/OpenAuctionsBanner';
import { useTenX } from '../hooks/useTenX';
import { compareCategories } from '../lib/categories';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { PageIntro } from '../components/PageIntro';

export default function DashboardPage() {
  const { sales, meta, goldenTicketAuctions, loading, error } = useAuctionData();
  const { filters } = useFilters();
  const [season, setSeason] = useState<string>('');
  const [category, setCategory] = useState('All');
  // Seven columns collide on a phone, so narrow screens show one stat group at
  // a time. Last 5 leads: it's the topical number, and only ~10% of tokens have
  // no sale in that window.
  const narrow = useMediaQuery(NARROW);
  const [statGroup, setStatGroup] = useState<'last5' | 'full'>('last5');
  // Show Trade 1 tokens as their "10x" bundle (×10 price, "10x " name). On by
  // default and shared with the Timelines page — see useTenX.
  const [tenX, setTenX] = useTenX();
  // The category picker is dropped on phones — the list is short enough to
  // scroll. Force the filter open so a category chosen on a wide screen can't
  // strand a narrow one with a filter it has no control to clear.
  const effectiveCategory = narrow ? 'All' : category;

  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  // Default to the newest season once data has loaded.
  const activeSeason = season || seasons[0] || '';

  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);

  // Apply the shared Source / Trent-pricing / Auction-type filters to the sales
  // BEFORE the per-token aggregation, so every stat on the page reflects the
  // chosen source, (for Trent) the ~10% reward-adjusted effective price, and the
  // auction-type narrowing. Defaults ("All sources", "Nominal", "All types")
  // leave the sales untouched, so the dashboard reads exactly as it did before
  // the context layer. Shared with every other pricing page (lib/context).
  const viewSales = useMemo(
    () => applyViewFilters(sales, metaById, goldenTicketAuctions, filters),
    [sales, metaById, goldenTicketAuctions, filters],
  );

  const rows = useMemo(
    () => (activeSeason ? aggregateSeason(viewSales, activeSeason) : []),
    [viewSales, activeSeason],
  );
  const last5Nums = useMemo(
    () => (activeSeason ? lastFiveAuctionNumbers(viewSales, activeSeason) : []),
    [viewSales, activeSeason],
  );

  // Trade 1 rows become their 10x bundle here when the toggle is on; every other
  // category (and thus the category list) is unchanged.
  const displayRows = useMemo(() => asTenXRows(rows, tenX), [rows, tenX]);
  const categories = useMemo(
    () => ['All', ...[...new Set(displayRows.map((r) => r.category))].sort()],
    [displayRows],
  );

  const filtered = displayRows.filter(
    (r) => effectiveCategory === 'All' || r.category === effectiveCategory,
  );

  // Group the filtered rows into per-category tables, ordered by CATEGORY_ORDER
  // (unlisted categories appended alphabetically). Rows within each table are
  // sorted alphabetically by token (display) name.
  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const r of filtered) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    const order = [...byCat.keys()].sort(compareCategories);
    return order.map((cat) => ({
      category: cat,
      rows: byCat.get(cat)!.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }));
  }, [filtered]);

  const closedAuctions = meta
    .filter((m) => m.season === activeSeason && m.status === 'Closed'
      && passesAuctionFilters(m, filters, goldenTicketAuctions))
    .length;

  // Auctions live right now, across all seasons — the banner is season-agnostic
  // (an open auction is worth surfacing whatever season you're viewing).
  const openList = useMemo(() => openAuctions(meta), [meta]);

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
      <OpenAuctionsBanner open={openList} />
      <PageIntro short="Welcome to the True Dungeon Auction Analysis">
        Welcome to the True Dungeon auction analysis! These statistics are calculated
        live from {totalClosedAuctions.toLocaleString()} auctions from {firstYear} to {lastYear}.
        This covers {sales.length.toLocaleString()} items sold!
      </PageIntro>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {!narrow && (
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <TenXToggle on={tenX} onChange={setTenX} />
        {narrow && (
          <div className="toggle" role="group" aria-label="Stat group">
            <span className="toggle-label">Show</span>
            <div className="toggle-buttons">
              <button type="button" className={statGroup === 'last5' ? 'on' : undefined}
                aria-pressed={statGroup === 'last5'} onClick={() => setStatGroup('last5')}>
                Last 5
              </button>
              <button type="button" className={statGroup === 'full' ? 'on' : undefined}
                aria-pressed={statGroup === 'full'} onClick={() => setStatGroup('full')}>
                Full Season
              </button>
            </div>
          </div>
        )}
      </div>

      <FilterBar controls={['source', 'trentPricing', 'auctionType']} collapsibleOnMobile />

      <p className="meta-line stats">
        Season {activeSeason}: {closedAuctions} closed auctions ·
        {' '}"Last 5" = {last5Nums.map(last5Label).join(', ')}
      </p>

      {groups.length === 0 && <p className="empty">No matching items.</p>}
      {groups.map((g) => (
        <CategoryTable
          key={g.category}
          category={g.category}
          rows={g.rows}
          group={narrow ? statGroup : 'both'}
        />
      ))}
    </>
  );
}
