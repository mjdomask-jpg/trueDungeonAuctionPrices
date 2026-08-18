import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  exploreAuctions, explorerOptions, flattenAuctions, sortFlatRows, asTenXSales, openAuctions,
  EMPTY_FILTERS, DEFAULT_SORT, COMPACT_SORT_KEYS,
  type ExplorerFilters, type SortKey, type SortDir,
} from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters, activeFilterCount, type FilterControl } from '../data/filtersContext';
import { applyViewFilters, passesAuctionFilters, type ContextItem } from '../lib/context';
import { useTenX } from '../hooks/useTenX';
import { useRoutedView } from '../hooks/useRoutedView';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { AuctionCard } from '../components/AuctionCard';
import { OpenAuctionCard } from '../components/OpenAuctionCard';
import { SaleTable } from '../components/SaleTable';
import { FilterBar } from '../components/FilterBar';
import { TenXToggle } from '../components/TenXToggle';
import { PageIntro } from '../components/PageIntro';
import { HintPopover } from '../components/HintPopover';

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

type View = 'grouped' | 'full';

export default function ExplorerPage() {
  const { sales, onyxSales, meta, contextItems, goldenTicketAuctions, loading, error } = useAuctionData();
  const { filters: viewFilter } = useFilters();
  const [filters, setFilters] = useState<ExplorerFilters>(EMPTY_FILTERS);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  // View is the URL: /explorer/grouped (default) | /explorer/full.
  const [view, setView] = useRoutedView<View>({
    views: ['grouped', 'full'],
    fallback: 'grouped',
    pathFor: (v) => `/explorer/${v}`,
  });
  const [sortKey, setSortKey] = useState<SortKey>(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_SORT.dir);
  const [showAll, setShowAll] = useState(false);
  // Show Trade 1 sales as their 10x bundle (a ×10 price projection, "10x " name),
  // matching the Prices/Timelines pages — see useTenX. Applied to the sale feed
  // up front so every derived number reflects it (see asTenXSales).
  const [tenX, setTenX] = useTenX();

  // The explorer is the one view that reads both sale feeds. The Onyx auctions
  // are all present in auctionMetadata and none of their (auction, token) pairs
  // collide with prices.csv, so the two feeds simply concatenate — Onyx rows
  // land in their existing auction's card under their own category.
  const allSales = useMemo(
    () => asTenXSales([...sales, ...onyxSales], tenX),
    [sales, onyxSales, tenX],
  );

  // Apply the shared Source / Trent-pricing / Auction-type filters on top of the
  // page's own season/category/auctioneer/search. Source and auction-type select
  // whole auctions, so they narrow the META list (exploreAuctions only lists
  // auctions present in the meta it's given); Trent-pricing rescales the sales.
  // The two stay consistent because applyViewFilters drops the same auctions the
  // meta filter removes. Defaults leave both untouched.
  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);
  const viewMeta = useMemo(
    () => meta.filter((m) => passesAuctionFilters(m, viewFilter, goldenTicketAuctions)),
    [meta, viewFilter, goldenTicketAuctions],
  );
  const viewSales = useMemo(
    () => applyViewFilters(allSales, metaById, goldenTicketAuctions, viewFilter),
    [allSales, metaById, goldenTicketAuctions, viewFilter],
  );

  // Re-filtering re-caps the table: a new query deserves its own first page,
  // and "show all" on 6,400 rows shouldn't silently persist into the next one.
  const set = <K extends keyof ExplorerFilters>(key: K, value: ExplorerFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setShowAll(false);
  };

  const options = useMemo(() => explorerOptions(viewSales, viewMeta), [viewSales, viewMeta]);
  const result = useMemo(() => exploreAuctions(viewSales, viewMeta, filters), [viewSales, viewMeta, filters]);

  // Currently-open auctions, shown in their own section at the top. Read from the
  // UNFILTERED meta on purpose: it's a standalone "what's live right now" list,
  // not part of the closed-sales explorer below, so the page's season/category/
  // search and the shared Source/type filters must not hide a live auction.
  const openList = useMemo(() => openAuctions(meta), [meta]);

  // The open list is a collapsed one-line strip by default so the historical
  // data leads the page (Option B). The Prices banner links to
  // /explorer/grouped#open (the canonical view path, so the router-level
  // /explorer redirect can't strip the fragment), which expands the strip and
  // scrolls it into view.
  const location = useLocation();
  const [openExpanded, setOpenExpanded] = useState(false);
  const openRef = useRef<HTMLDetailsElement | null>(null);
  // Snapshot the "expand the open list" intent from the hash at mount, then
  // consume it once the data (and so the strip itself) is present: on a cold load
  // the sales arrive a beat after mount, so this can't simply run on mount.
  const wantOpen = useRef(location.hash === '#open');
  useEffect(() => {
    if (wantOpen.current && openList.length > 0) {
      wantOpen.current = false;
      setOpenExpanded(true);
      requestAnimationFrame(() =>
        openRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  }, [openList.length]);

  // Context items (withheld / augmented / grunnel / released) grouped by auction,
  // so each card can show its own below the sales. The provenance chips select
  // which kinds show — they act on this list, not the core sales (design §5.2).
  // Season/search narrowing is implicit: only auctions the query lists get a card.
  const contextByAuction = useMemo(() => {
    const by = new Map<string, ContextItem[]>();
    for (const it of contextItems) {
      if (!viewFilter.provenance.has(it.provenance)) continue;
      let bucket = by.get(it.auctionId);
      if (!bucket) { bucket = []; by.set(it.auctionId, bucket); }
      bucket.push(it);
    }
    return by;
  }, [contextItems, viewFilter.provenance]);

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
    () => (view === 'full' ? sortFlatRows(flattenAuctions(result.auctions), activeKey, activeDir) : []),
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

  // The three dropdown filters, shared between the inline desktop layout and
  // the phone's disclosure. `pickerCount` labels that disclosure, so a filter
  // set earlier is still visible once it's collapsed out of sight — search is
  // excluded because its own box stays on screen and says so itself.
  const pickerCount = [filters.season, filters.category, filters.auctioneer].filter(Boolean).length;

  // The shared context-layer controls now live inside this page's own Filters
  // disclosure (rendered `bare`), so the disclosure carries one combined badge:
  // the page's pickers plus the off-default shared filters. The 10x projection is
  // a display mode, not a narrowing filter, so it's deliberately not counted.
  const sharedControls: FilterControl[] = ['source', 'trentPricing', 'auctionType', 'provenance'];
  const filterCount = pickerCount + activeFilterCount(viewFilter, sharedControls);
  const pickers = (
    <>
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
    </>
  );

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      {/* Live-ish "what's open right now" — sits above the closed-auction
          explorer and always renders, carrying the quiet reassurance line when
          nothing is open so the feature never looks broken/absent. Folded to a
          one-line strip by default (Option B) so the historical data leads the
          page; the Prices banner links here via /explorer#open to expand it. */}
      <section className="open-section" aria-label="Open auctions">
        {openList.length === 0 ? (
          <p className="empty open-empty" id="open">No auctions currently open — check back soon.</p>
        ) : (
          <details
            className="open-disclosure"
            id="open"
            ref={openRef}
            open={openExpanded}
            onToggle={(e) => setOpenExpanded(e.currentTarget.open)}
          >
            <summary>
              <span className="open-dot" aria-hidden="true" />
              <strong>{openList.length} auction{openList.length === 1 ? '' : 's'} open now</strong>
            </summary>
            <div className="open-disclosure-body">
              {openList.map((m) => <OpenAuctionCard key={m.auctionId} meta={m} />)}
            </div>
          </details>
        )}
      </section>

      {/* The "what's in this data" context — the Prices/Onyx links and the
          withheld/augmented note — hangs off the heading as a tappable help
          bubble, so the intro below stays one clean line with nothing trailing it
          to orphan onto a second line on a phone. */}
      <h2 className="section-heading">
        Historical auctions{' '}
        <HintPopover label="About this data">
          These are the rows behind the averages on <Link to="/">Prices</Link>,
          including the <Link to="/prices/onyx">Onyx</Link> chase set. Each auction
          also lists anything that entered outside the standard $8,000 order —
          items <strong>withheld</strong>, <strong>augmented</strong>, or dropped
          in — with withheld values shown as negative estimates.
        </HintPopover>
      </h2>
      <PageIntro>
        What every token went for in every closed auction.
      </PageIntro>

      <div className="controls">
        {/* View leads the top line; the live result count + row actions ride on
            its right (see .controls-top), so they no longer cost a separate block
            below the filters. Search and the Filters fold sit on the rows beneath.
            A two-state toggle rather than a dropdown: with only two choices the
            select hid one of them behind a click. */}
        <div className="controls-top">
          <div className="toggle view-toggle" role="group" aria-label="View">
            <span className="toggle-label">View</span>
            <div className="toggle-buttons">
              <button
                type="button"
                data-label="Group by auction"
                className={view === 'grouped' ? 'on' : undefined}
                aria-pressed={view === 'grouped'}
                onClick={() => setView('grouped')}
              >
                Group by auction
              </button>
              <button
                type="button"
                data-label="See full list"
                className={view === 'full' ? 'on' : undefined}
                aria-pressed={view === 'full'}
                onClick={() => setView('full')}
              >
                See full list
              </button>
            </div>
          </div>

          {/* Result count + actions, folded onto the View line instead of a
              standalone paragraph below the controls. */}
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
        </div>

        <label className="search">
          Search
          {/* Names both things it matches, in the fewest words: the box spans
              token names AND auction names (see exploreAuctions), which is what
              lets it answer "Trent" as well as "Wish Ring". The longer phrasing
              this replaces overflowed the input at 320px. */}
          <input
            type="search"
            placeholder="Search tokens or auctions…"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </label>

        {/* One unified disclosure, same on desktop and mobile: it holds every
            narrowing/display control except the always-visible View and Search —
            the page's own 10x + season/category/auctioneer pickers plus the
            shared context-layer FilterBar (rendered `bare` so it drops straight
            into this panel instead of opening its own). Folding the two former
            filter clusters into one keeps the top of the page shallow; the badge
            counts every off-default filter across both. */}
        <details className="filterset">
          <summary>
            Filters
            {filterCount > 0 && <span className="filterset-count">{filterCount}</span>}
          </summary>
          <div className="filterset-body">
            <TenXToggle on={tenX} onChange={setTenX} />
            {pickers}
            {/* Season '' means every season, which always includes Trent ones —
                pass a list only when the page is pinned to one. */}
            <FilterBar bare controls={sharedControls}
              seasons={filters.season ? [filters.season] : undefined} />
          </div>
        </details>
      </div>

      {/* These are individual sale prices, so — unlike the Prices averages — the
          ×10 is an estimate: the export records single-token prices and doesn't
          say whether a given lot was a 10x chip. Only shown when Trade 1 rows can
          actually appear. */}
      {tenX && (filters.category === '' || filters.category === 'Trade 1') && (
        <p className="meta-line tenx-note">
          Trade 1 prices show the estimated 10x token cost (10× the single-token sale price).
        </p>
      )}

      {result.auctions.length === 0 && <p className="empty">No auctions match these filters.</p>}

      {view === 'grouped' && result.auctions.map((g) => (
        <AuctionCard
          key={g.meta.auctionId}
          group={g}
          context={contextByAuction.get(g.meta.auctionId)}
          open={openIds.has(g.meta.auctionId)}
          onToggle={toggle}
        />
      ))}

      {view === 'full' && result.auctions.length > 0 && (() => {
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
