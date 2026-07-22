import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  exploreAuctions, explorerOptions, auctionChoices, flattenAuctions, sortFlatRows,
  EMPTY_FILTERS, type ExplorerFilters, type SortKey, type SortDir,
} from '../lib/data';
import { money } from '../lib/format';
import { useAuctionData } from '../data/auctionDataContext';
import { AuctionCard } from '../components/AuctionCard';
import { SaleTable } from '../components/SaleTable';

// Detailed Auction Data (Phase 5). Every other view on this site aggregates;
// this one shows the raw sales, grouped under the auction they happened in.
// Auction-level filters (season / auction / style / completion / auctioneer)
// choose which auctions are listed, sale-level filters (category / search)
// choose which sales show inside them — see exploreAuctions in lib/data.ts.

// Below this many results, every auction opens by default: a narrow query is
// almost always one you want to read, not scan.
const AUTO_EXPAND_LIMIT = 5;

// The flat view renders one <tr> per matching price, and unfiltered that is
// ~6,400 rows — enough to make sorting feel sluggish. The sort runs over the
// whole result set and only the display is capped, so "highest price" still
// answers with the genuine top of the data, not the top of a truncated slice.
const FLAT_ROW_LIMIT = 1000;

type View = 'grouped' | 'flat';

export default function ExplorerPage() {
  const { sales, onyxSales, meta, loading, error } = useAuctionData();
  const [filters, setFilters] = useState<ExplorerFilters>(EMPTY_FILTERS);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>('grouped');
  const [sortKey, setSortKey] = useState<SortKey>('auction');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // The explorer is the one view that reads both sale feeds. The Onyx auctions
  // are all present in auctionMetadata and none of their (auction, token) pairs
  // collide with prices.csv, so the two feeds simply concatenate — Onyx rows
  // land in their existing auction's card under their own category.
  const allSales = useMemo(() => [...sales, ...onyxSales], [sales, onyxSales]);

  const set = <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      // Changing an auction-level filter can strip the selected auction out of
      // the picker's own list, which would leave an invisible filter pinned on.
      ...(key === 'auctionId' ? null : { auctionId: '' }),
    }));

  const options = useMemo(() => explorerOptions(allSales, meta), [allSales, meta]);
  const choices = useMemo(() => auctionChoices(meta, filters), [meta, filters]);
  const result = useMemo(() => exploreAuctions(allSales, meta, filters), [allSales, meta, filters]);

  // The flat view is the same result set, flattened and re-sorted — never a
  // second query, so the two views can't disagree.
  const flatRows = useMemo(
    () => (view === 'flat' ? sortFlatRows(flattenAuctions(result.auctions), sortKey, sortDir) : []),
    [view, result, sortKey, sortDir],
  );

  // Clicking the active column flips its direction; a new column starts in its
  // most useful direction — newest/highest first, but A→Z for the text columns.
  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'token' || key === 'category' ? 'asc' : 'desc'); }
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
      <p className="sub">
        What every token went for in every auction — the raw rows behind the
        averages on <Link to="/">Prices</Link>, including the{' '}
        <Link to="/onyx">Onyx</Link> chase set. Narrow by season, auction, token
        or category; the auction's style, completion style and auctioneer are
        filters too, so you can ask things like "what did Trade 1 tokens fetch in
        Lightning auctions this year".
      </p>

      <div className="controls">
        <label>
          Season
          <select value={filters.season} onChange={(e) => set('season', e.target.value)}>
            <option value="">All seasons</option>
            {options.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Auction
          <select value={filters.auctionId} onChange={(e) => set('auctionId', e.target.value)}>
            <option value="">All auctions ({choices.length})</option>
            {choices.map((m) => (
              <option key={m.auctionId} value={m.auctionId}>
                {m.season} #{m.auctionNumber} — {m.name}
              </option>
            ))}
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
          Auction style
          <select value={filters.style} onChange={(e) => set('style', e.target.value)}>
            <option value="">All styles</option>
            {options.styles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Completion
          <select value={filters.completionStyle} onChange={(e) => set('completionStyle', e.target.value)}>
            <option value="">All</option>
            {options.completionStyles.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Auctioneer
          <select value={filters.auctioneer} onChange={(e) => set('auctioneer', e.target.value)}>
            <option value="">All auctioneers</option>
            {options.auctioneers.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          View
          <select value={view} onChange={(e) => setView(e.target.value as View)}>
            <option value="grouped">Grouped by auction</option>
            <option value="flat">Flat table</option>
          </select>
        </label>
        <label className="search">
          Token
          <input
            type="search"
            placeholder="Search token name…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </label>
      </div>

      <p className="meta-line">
        {result.auctions.length.toLocaleString()} auction{result.auctions.length === 1 ? '' : 's'} ·{' '}
        {result.rowCount.toLocaleString()} price{result.rowCount === 1 ? '' : 's'} ·{' '}
        {result.tokenCount.toLocaleString()} distinct token{result.tokenCount === 1 ? '' : 's'} ·{' '}
        {money(result.total)} total
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

      {view === 'flat' && result.auctions.length > 0 && (
        <>
          {flatRows.length > FLAT_ROW_LIMIT && (
            <p className="meta-line">
              Showing the first {FLAT_ROW_LIMIT.toLocaleString()} of{' '}
              {flatRows.length.toLocaleString()} rows in this sort order — narrow
              the filters to see the rest.
            </p>
          )}
          <SaleTable
            rows={flatRows.slice(0, FLAT_ROW_LIMIT)}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSort}
          />
        </>
      )}
    </>
  );
}
