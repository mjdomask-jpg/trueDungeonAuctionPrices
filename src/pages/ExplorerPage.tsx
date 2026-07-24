import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  exploreAuctions, explorerOptions, flattenAuctions, sortFlatRows,
  EMPTY_FILTERS, DEFAULT_SORT, COMPACT_SORT_KEYS,
  type ExplorerFilters, type SortKey, type SortDir,
} from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { AuctionCard } from '../components/AuctionCard';
import { SaleTable } from '../components/SaleTable';
import { PageIntro } from '../components/PageIntro';

// Detailed Auction Data (Phase 5). Every other view on this site aggregates;
// this one shows the sales themselves, in two shapes behind a toggle: grouped
// under the auction they happened in, or one flat sortable table. Filtering is
// deliberately thin — season, category, auctioneer and two searches — see
// exploreAuctions in lib/data.ts for what each one narrows.

// Below this many results, every auction opens by default: a narrow query is
// almost always one you want to read, not scan.
const AUTO_EXPAND_LIMIT = 5;

// The flat view renders one <tr> per matching price, and unfiltered that is
// ~6,400 rows — enough to make sorting feel sluggish. It opens capped at this
// many, with a button to render the lot. The sort always runs over the whole
// result set and only the display is capped, so "highest price" answers with
// the genuine top of the data even before the cap is lifted.
const FLAT_ROW_LIMIT = 1000;

type View = 'grouped' | 'flat';

export default function ExplorerPage() {
  const { sales, onyxSales, meta, loading, error } = useAuctionData();
  const [filters, setFilters] = useState<ExplorerFilters>(EMPTY_FILTERS);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>('grouped');
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT.dir);
  const [showAll, setShowAll] = useState(false);

  // The explorer is the one view that reads both sale feeds. The Onyx auctions
  // are all present in auctionMetadata and none of their (auction, token) pairs
  // collide with prices.csv, so the two feeds simply concatenate — Onyx rows
  // land in their existing auction's card under their own category.
  const allSales = useMemo(() => [...sales, ...onyxSales], [sales, onyxSales]);

  // Re-filtering re-caps the table: a new query deserves its own first page,
  // and "show all" on 6,400 rows shouldn't silently persist into the next one.
  const set = <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setShowAll(false);
  };

  const options = useMemo(() => explorerOptions(allSales, meta), [allSales, meta]);
  const result = useMemo(() => exploreAuctions(allSales, meta, filters), [allSales, meta, filters]);

  // Phones get a three-column table (see SaleTable), so only those three keys
  // have a header to sort from. A sort picked on a wide screen — auctioneer,
  // say — would otherwise order the table by a column that isn't there and
  // show no caret anywhere, so it falls back to the default instead. The
  // stored sortKey is left alone: going back to a wide screen restores it.
  const narrow = useMediaQuery(NARROW);
  const sortHidden = narrow && !COMPACT_SORT_KEYS.includes(sortKey);
  const activeKey = sortHidden ? DEFAULT_SORT.key : sortKey;
  const activeDir = sortHidden ? DEFAULT_SORT.dir : sortDir;

  // The flat view is the same result set, flattened and re-sorted — never a
  // second query, so the two views can't disagree.
  const flatRows = useMemo(
    () => (view === 'flat' ? sortFlatRows(flattenAuctions(result.auctions), activeKey, activeDir) : []),
    [view, result, activeKey, activeDir],
  );

  // Clicking the active column flips its direction; a new column starts in its
  // most useful direction — newest/highest first, but A→Z for the text columns.
  // Compared against the *active* key, not the stored one: when a hidden sort
  // has fallen back (see above), the header the user can see is the active one,
  // so tapping it should flip that — committing the fallback on the way — not
  // silently re-apply a direction from a column that isn't rendered.
  const onSort = (key: SortKey) => {
    if (key === activeKey) {
      setSortKey(activeKey);
      setSortDir(activeDir === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    const alphabetical = key === 'auction' || key === 'auctioneer' || key === 'token' || key === 'category';
    setSortDir(alphabetical ? 'asc' : 'desc');
  };

  // Re-apply the auto-expand rule whenever the result set changes, so narrowing
  // to a couple of auctions shows their sales without a second click.
  const ids = result.auctions.map((a) => a.meta.auctionId).join(',');
  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    setOpenIds(new Set(list.length <= AUTO_EXPAND_LIMIT ? list : []));
  }, [ids]);

  const toggle = (auctionId: string, open: boolean) =>
    setOpenIds((prev) => {
      if (prev.has(auctionId) === open) return prev; // already in sync
      const next = new Set(prev);
      if (open) next.add(auctionId); else next.delete(auctionId);
      return next;
    });

  const expandAll = () => setOpenIds(new Set(result.auctions.map((a) => a.meta.auctionId)));
  const collapseAll = () => setOpenIds(new Set());

  const anyFilter = Object.values(filters).some(Boolean);

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <PageIntro short="What every token went for in every closed auction.">
        What every token went for in every closed auction — the rows behind the
        averages on <Link to="/">Prices</Link>, including the{' '}
        <Link to="/onyx">Onyx</Link> chase set. Search for a token or an auction,
        or narrow by season, category and auctioneer.
      </PageIntro>

      <div className="controls">
        <label>
          Season
          <select value={filters.season} onChange={(e) => set('season', e.target.value)}>
            <option value="">All seasons</option>
            {options.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Category
          <select value={filters.category} onChange={(e) => set('category', e.target.value)}>
            <option value="">All categories</option>
            {options.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Auctioneer
          <select value={filters.auctioneer} onChange={(e) => set('auctioneer', e.target.value)}>
            <option value="">All auctioneers</option>
            {options.auctioneers.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {/* A two-state toggle rather than a dropdown: with only two choices the
            select hid one of them behind a click. */}
        <div className="toggle" role="group" aria-label="View">
          <span className="toggle-label">View</span>
          <div className="toggle-buttons">
            <button
              type="button"
              className={view === 'grouped' ? 'on' : undefined}
              aria-pressed={view === 'grouped'}
              onClick={() => setView('grouped')}
            >
              Group by auction
            </button>
            <button
              type="button"
              className={view === 'flat' ? 'on' : undefined}
              aria-pressed={view === 'flat'}
              onClick={() => setView('flat')}
            >
              See full list
            </button>
          </div>
        </div>

        <label className="search">
          Search
          <input
            type="search"
            placeholder="Search by token or auction name…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </label>
      </div>

      <p className="meta-line">
        {result.auctions.length.toLocaleString()} auction{result.auctions.length === 1 ? '' : 's'} ·{' '}
        {result.rowCount.toLocaleString()} price{result.rowCount === 1 ? '' : 's'} ·{' '}
        {result.tokenCount.toLocaleString()} distinct token{result.tokenCount === 1 ? '' : 's'}
        <span className="explorer-actions">
          {view === 'grouped' && <>
            <button type="button" onClick={expandAll}>Expand all</button>
            <button type="button" onClick={collapseAll}>Collapse all</button>
          </>}
          {anyFilter && (
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
          )}
        </span>
      </p>

      {result.auctions.length === 0 && <p className="empty">No auctions match these filters.</p>}

      {view === 'grouped' && result.auctions.map((g) => (
        <AuctionCard
          key={g.meta.auctionId}
          group={g}
          open={openIds.has(g.meta.auctionId)}
          onToggle={toggle}
        />
      ))}

      {view === 'flat' && result.auctions.length > 0 && (() => {
        const capped = !showAll && flatRows.length > FLAT_ROW_LIMIT;
        return (
          <>
            {capped && (
              <p className="meta-line">
                Showing the first {FLAT_ROW_LIMIT.toLocaleString()} of{' '}
                {flatRows.length.toLocaleString()} rows in this sort order.
              </p>
            )}
            <SaleTable
              rows={capped ? flatRows.slice(0, FLAT_ROW_LIMIT) : flatRows}
              sortKey={activeKey}
              sortDir={activeDir}
              onSort={onSort}
              compact={narrow}
            />
            {capped && (
              <p className="show-all">
                <button type="button" onClick={() => setShowAll(true)}>
                  Show all {flatRows.length.toLocaleString()} rows
                </button>
              </p>
            )}
          </>
        );
      })()}
    </>
  );
}
