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
import { useRoutedView } from '../hooks/useRoutedView';
import { compareCategories } from '../lib/categories';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { PageIntro } from '../components/PageIntro';

// Which sale feed the Prices page shows, chosen by the view toggle. 'all' is the
// default — the main list plus the Onyx chase set; 'standard' is the main list
// alone; 'onyx' is that set alone. The view is the URL: 'all' is the site home
// at `/` (special-cased), the others are /prices/standard and /prices/onyx.
export type PriceView = 'standard' | 'all' | 'onyx';

export default function DashboardPage() {
  const { sales, onyxSales, meta, goldenTicketAuctions, loading, error } = useAuctionData();
  const { filters } = useFilters();
  // View is read from and written to the URL. All is the home page, so it maps
  // to `/` rather than /prices/all; anything unknown canonicalises there too.
  const [view, setView] = useRoutedView<PriceView>({
    views: ['all', 'standard', 'onyx'],
    fallback: 'all',
    pathFor: (v) => (v === 'all' ? '/' : `/prices/${v}`),
  });
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
  const onyxView = view === 'onyx';
  // The category picker is dropped on phones — the list is short enough to
  // scroll. Force the filter open so a category chosen on a wide screen can't
  // strand a narrow one with a filter it has no control to clear. Onyx is a
  // single category, so its view forces 'All' too.
  const effectiveCategory = narrow || onyxView ? 'All' : category;

  // The sale feed the whole page reads. Onyx sales share prices.csv's schema and
  // don't collide with it (see the explorer), so 'all' is a plain concatenation.
  const feed = useMemo(
    () => (view === 'onyx' ? onyxSales : view === 'all' ? [...sales, ...onyxSales] : sales),
    [view, sales, onyxSales],
  );

  const seasons = useMemo(() => seasonsOf(feed), [feed]);
  // Default to the newest season; if a season picked in one view isn't in the
  // other's feed, fall back rather than leave the dropdown on a missing option.
  const activeSeason = season && seasons.includes(season) ? season : seasons[0] || '';

  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);

  // Apply the shared Source / Trent-pricing / Auction-type filters to the sales
  // BEFORE the per-token aggregation, so every stat on the page reflects the
  // chosen source, (for Trent) the ~10% reward-adjusted effective price, and the
  // auction-type narrowing. Defaults ("All sources", "Nominal", "All types")
  // leave the sales untouched, so the dashboard reads exactly as it did before
  // the context layer. Shared with every other pricing page (lib/context).
  const viewSales = useMemo(
    () => applyViewFilters(feed, metaById, goldenTicketAuctions, filters),
    [feed, metaById, goldenTicketAuctions, filters],
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

  // Global intro stats (across all seasons) — always the full main list, so the
  // welcome line reads the same whichever view is active.
  const allSeasons = useMemo(() => seasonsOf(sales), [sales]);
  const totalClosedAuctions = meta.filter((m) => m.status === 'Closed').length;
  const firstYear = allSeasons[allSeasons.length - 1];
  const lastYear = allSeasons[0];

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
        This covers {sales.length.toLocaleString()} items sold! Use <strong>View</strong> to add
        or isolate the <strong>Onyx</strong> chase set — a fixed set of chase Ultra Rares (plus a
        C/UC/R set) sold with their own price history.
      </PageIntro>

      <div className="controls">
        {/* View gets its own line (flex-basis:100% via .view-toggle), then the
            Season/Category/10x controls wrap onto the row below it. */}
        <div className="toggle view-toggle" role="group" aria-label="Price view">
          <span className="toggle-label">View</span>
          <div className="toggle-buttons">
            <button type="button" data-label="All" className={view === 'all' ? 'on' : undefined}
              aria-pressed={view === 'all'} onClick={() => setView('all')}>
              All
            </button>
            <button type="button" data-label="Standard" className={view === 'standard' ? 'on' : undefined}
              aria-pressed={view === 'standard'} onClick={() => setView('standard')}>
              Standard
            </button>
            <button type="button" data-label="Onyx" className={onyxView ? 'on' : undefined}
              aria-pressed={onyxView} onClick={() => setView('onyx')}>
              Onyx
            </button>
          </div>
        </div>
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {/* Category picker and the 10x bundle are meaningless for the single-
            category Onyx set, so the Onyx view drops both. */}
        {!narrow && !onyxView && (
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        {!onyxView && <TenXToggle on={tenX} onChange={setTenX} label="Show 10x" />}
        {narrow && (
          <div className="toggle" role="group" aria-label="Stat group">
            <span className="toggle-label">Show</span>
            <div className="toggle-buttons">
              <button type="button" data-label="Last 5" className={statGroup === 'last5' ? 'on' : undefined}
                aria-pressed={statGroup === 'last5'} onClick={() => setStatGroup('last5')}>
                Last 5
              </button>
              <button type="button" data-label="Full Season" className={statGroup === 'full' ? 'on' : undefined}
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

      {groups.length === 0 && (
        <p className="empty">
          {onyxView ? `No Onyx sales in ${activeSeason}.` : 'No matching items.'}
        </p>
      )}
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
