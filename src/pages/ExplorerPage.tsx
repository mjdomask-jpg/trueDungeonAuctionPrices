import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  exploreAuctions, explorerOptions, auctionChoices, EMPTY_FILTERS,
  type ExplorerFilters,
} from '../lib/data';
import { money } from '../lib/format';
import { useAuctionData } from '../data/auctionDataContext';
import { AuctionCard } from '../components/AuctionCard';

// Detailed Auction Data (Phase 5). Every other view on this site aggregates;
// this one shows the raw sales, grouped under the auction they happened in.
// Auction-level filters (season / auction / style / completion / auctioneer)
// choose which auctions are listed, sale-level filters (category / search)
// choose which sales show inside them — see exploreAuctions in lib/data.ts.

// Below this many results, every auction opens by default: a narrow query is
// almost always one you want to read, not scan.
const AUTO_EXPAND_LIMIT = 5;

export default function ExplorerPage() {
  const { sales, meta, loading, error } = useAuctionData();
  const [filters, setFilters] = useState<ExplorerFilters>(EMPTY_FILTERS);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const set = <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) =>
    setFilters((f) => ({
      ...f,
      [key]: value,
      // Changing an auction-level filter can strip the selected auction out of
      // the picker's own list, which would leave an invisible filter pinned on.
      ...(key === 'auctionId' ? null : { auctionId: '' }),
    }));

  const options = useMemo(() => explorerOptions(sales, meta), [sales, meta]);
  const choices = useMemo(() => auctionChoices(meta, filters), [meta, filters]);
  const result = useMemo(() => exploreAuctions(sales, meta, filters), [sales, meta, filters]);

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
        Every individual sale, grouped under the auction it happened in — the raw
        rows behind the averages on <Link to="/">Prices</Link>. Narrow by season,
        auction, token, or category; the auction's style, completion style and
        auctioneer are filters too, so you can ask things like "what did Trade 1
        tokens fetch in Lightning auctions this year".
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
        {result.saleCount.toLocaleString()} sale{result.saleCount === 1 ? '' : 's'} ·{' '}
        {result.tokenCount.toLocaleString()} distinct token{result.tokenCount === 1 ? '' : 's'} ·{' '}
        {money(result.total)} total
        <span className="explorer-actions">
          <button type="button" onClick={expandAll}>Expand all</button>
          <button type="button" onClick={collapseAll}>Collapse all</button>
          {anyFilter && (
            <button type="button" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
          )}
        </span>
      </p>

      {result.auctions.length === 0 && <p className="empty">No auctions match these filters.</p>}

      {result.auctions.map((g) => (
        <AuctionCard
          key={g.meta.auctionId}
          group={g}
          open={openIds.has(g.meta.auctionId)}
          onToggle={toggle}
        />
      ))}
    </>
  );
}
