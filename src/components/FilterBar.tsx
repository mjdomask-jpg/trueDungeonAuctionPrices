import { useEffect, useMemo } from 'react';
import {
  useFilters, activeFilterCount, CONTEXT_PROVENANCES, PROVENANCE_NAME,
  type FilterControl, type SourceFilter, type AuctionTypeFilter, type OrderFilter,
} from '../data/filtersContext';
import { useAuctionData } from '../data/auctionDataContext';
import { sourcesInSeasons, orderVariantsInSeasons } from '../lib/context';
import { SOURCE_LABEL } from '../lib/data';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { HintPopover } from './HintPopover';

// The shared context-layer controls. One implementation, dropped into each page;
// a page passes `controls` to show only the ones it uses, so the state shape and
// behaviour stay identical everywhere (docs/context-layer-design.md §5.2). The
// FilterControl type and activeFilterCount helper live in filtersContext, so
// this stays a components-only file for Fast Refresh.
const DEFAULT_CONTROLS: FilterControl[] = ['source', 'trentPricing', 'auctionType', 'order', 'provenance'];

export function FilterBar({
  controls = DEFAULT_CONTROLS,
  seasons,
  collapsibleOnMobile = false,
  mobileSummary = 'Filters',
  bare = false,
}: {
  controls?: FilterControl[];
  // The seasons the host page currently shows. Source and Trent pricing are only
  // offered when at least one of them contains a Trent auction — every season up
  // to 2022 predates Trent entirely, so the two controls sat there doing nothing.
  // Omit for a page that isn't season-scoped: the whole dataset is then checked.
  seasons?: string[];
  // When true, the bar folds behind a disclosure below 640px so it doesn't push
  // the data down a phone screen. Pages whose filter has an immediate local
  // effect (e.g. the Context page) leave it open instead.
  collapsibleOnMobile?: boolean;
  // Summary label for the collapsed disclosure. Override where a page already
  // has its own "Filters" fold (Auction Data), so the two don't read alike.
  mobileSummary?: string;
  // Render just the controls, with no .controls wrapper and no disclosure of its
  // own, so a host page can drop them inside its own filter panel (Auction Data
  // folds these into one unified Filters disclosure). The host owns the badge via
  // activeFilterCount. Ignores collapsibleOnMobile/mobileSummary.
  bare?: boolean;
}) {
  const { filters, setSource, setTrentPricing, setAuctionType, setOrder, toggleProvenance } = useFilters();
  const { trentSeasons, seasonSources, seasonOrders } = useAuctionData();
  const narrow = useMediaQuery(NARROW);
  const show = (c: FilterControl) => controls.includes(c);
  // The Trent reward-adjust only makes sense when Trent sales are in view — i.e.
  // unless the Source filter has narrowed to some other venue.
  const trentInView = filters.source === 'all' || filters.source === 'Trent';
  // Is there anything for the Trent-pricing control to act on? Undefined seasons
  // means "not season-scoped" — ask the dataset instead of a season list.
  const trentInData = seasons ? seasons.some((s) => trentSeasons.has(s)) : trentSeasons.size > 0;
  // The venues these seasons actually used. Offered only when there is more than
  // one: with a single source the dropdown could only filter to what is already
  // on screen. Every season up to 2022 is Forum-only; 2023-2026 add Trent; 2027
  // adds alesievauctions.com.
  //
  // Keyed on a JOINED STRING, not on `seasons` itself: every caller passes the
  // prop as an inline array (`seasons={[activeSeason]}`), so its identity changes
  // on every render. Depending on it directly would rebuild the list each render
  // and — worse — re-run the reset effect below each render, since that effect
  // depends on the result.
  const seasonKey = seasons ? seasons.join('|') : '*';
  const sourceOptions = useMemo(
    () => sourcesInSeasons(seasonSources, seasonKey === '*' ? undefined : seasonKey.split('|')),
    [seasonSources, seasonKey],
  );
  const sourceChoice = sourceOptions.length > 1;

  // The $8k orders these seasons sold, offered on exactly the same terms as
  // Source and keyed on the same joined string for the same reason. Season 2027
  // is the first to sell two; every earlier season has one, so the control does
  // not appear — which is what "only where Trade 2 auctions exist" means, stated
  // as a property of the data rather than as a year. When the second order stops
  // being offered the control retires itself.
  const orderOptions = useMemo(
    () => orderVariantsInSeasons(seasonOrders, seasonKey === '*' ? undefined : seasonKey.split('|')),
    [seasonOrders, seasonKey],
  );
  const orderChoice = orderOptions.length > 1;

  // Filter state is shared across pages and survives a season change, so hiding
  // the controls is not enough: a Source of 'Trent' carried into 2019 would
  // silently empty the page with no visible control to explain it. Put them back
  // to their defaults whenever they stop being offered, so what the page filters
  // on is always something the page can show you. Note this resets on the source
  // being ABSENT, not just on the control being hidden — 'Alesiev' carried from
  // 2027 back to 2026 would empty the page while the dropdown still showed.
  useEffect(() => {
    const sourceOffered = sourceChoice
      && (filters.source === 'all' || sourceOptions.includes(filters.source));
    if (!sourceOffered && filters.source !== 'all') setSource('all');
    if (!trentInData && filters.trentPricing !== 'nominal') setTrentPricing('nominal');
    // Same rule for Order, and it matters more here than anywhere: 'Trade 2'
    // carried from 2027 back to 2026 would empty the page completely, since no
    // earlier season has a single Trade 2 auction.
    const orderOffered = orderChoice
      && (filters.order === 'all' || orderOptions.includes(filters.order));
    if (!orderOffered && filters.order !== 'all') setOrder('all');
  }, [sourceChoice, sourceOptions, trentInData, orderChoice, orderOptions,
    filters.source, filters.trentPricing, filters.order,
    setSource, setTrentPricing, setOrder]);

  const inner = (
    <>
      {show('source') && sourceChoice && (
        <label>
          Source
          <select value={filters.source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
            <option value="all">All sources</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
            ))}
          </select>
        </label>
      )}

      {show('trentPricing') && trentInData && trentInView && (
        <div className="toggle" role="group" aria-label="Trent pricing">
          <span className="toggle-label">Trent pricing</span>
          <div className="toggle-buttons">
            <button type="button" data-label="Nominal" className={filters.trentPricing === 'nominal' ? 'on' : undefined}
              aria-pressed={filters.trentPricing === 'nominal'} onClick={() => setTrentPricing('nominal')}>
              Nominal
            </button>
            <button type="button" data-label="Reward-adj." className={filters.trentPricing === 'reward-adjusted' ? 'on' : undefined}
              aria-pressed={filters.trentPricing === 'reward-adjusted'} onClick={() => setTrentPricing('reward-adjusted')}>
              Reward-adj.
            </button>
          </div>
        </div>
      )}

      {show('auctionType') && (
        <label>
          Auction type
          <select value={filters.auctionType}
            onChange={(e) => setAuctionType(e.target.value as AuctionTypeFilter)}>
            <option value="all">All auction types</option>
            <option value="augmented">Augmented</option>
            <option value="non-augmented">Non-augmented</option>
            <option value="golden-ticket">With Golden Ticket</option>
          </select>
        </label>
      )}

      {show('order') && orderChoice && (
        <label>
          {/* The text and its help MUST be one flex item. `.controls label` is a
              column flex, so a bare popover beside the text becomes a THIRD row
              and pushes the select down out of line with every other filter.
              .ctl-label is the wrapper that keeps the column at two items. */}
          <span className="ctl-label">
            Order
            {/* "Trade 2" is the auctioneers' shorthand, and a reader who has not
                followed the forum has no way to know what the two options are.
                Per ui-conventions.md this is a tap-to-open popover, never a
                `title`. */}
            <HintPopover label="About the order filter">
              Season 2027 is the first to sell two different $8K orders side by side: the{' '}
              <strong>standard</strong> one, and a <strong>Trade 2</strong> order carrying more
              of the tier-2 trade goods. Auctioneers advertise them as Option A and Option B.
              Filtering here shows prices from only that kind of auction.
            </HintPopover>
          </span>
          <select value={filters.order} onChange={(e) => setOrder(e.target.value as OrderFilter)}>
            <option value="all">All orders</option>
            {orderOptions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
      )}

      {show('provenance') && (
        <div className="prov-filter" role="group" aria-label="Item provenance">
          <span className="toggle-label">Show context</span>
          <div className="prov-chips">
            {CONTEXT_PROVENANCES.map((p) => {
              const on = filters.provenance.has(p);
              return (
                <button key={p} type="button"
                  className={`prov-chip ${p} ${on ? 'on' : 'off'}`}
                  aria-pressed={on} onClick={() => toggleProvenance(p)}>
                  {PROVENANCE_NAME[p]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  // Bare: hand the host page just the controls to place inside its own panel.
  if (bare) return inner;

  if (narrow && collapsibleOnMobile) {
    // Count the controls whose value is off-default, so the folded button still
    // says a filter is active (reuses the ExplorerPage .filterset furniture).
    const activeCount = activeFilterCount(filters, controls);
    return (
      // Wrapped in .controls so the disclosure and its selects inherit the site's
      // control sizing (44px tall, 16px selects on mobile) — a bare .filterset
      // sits outside that cascade and renders unstyled, browser-default dropdowns.
      <div className="controls filterbar-collapse">
        <details className="filterset">
          <summary>
            {mobileSummary}
            {activeCount > 0 && <span className="filterset-count">{activeCount}</span>}
          </summary>
          <div className="filterset-body">{inner}</div>
        </details>
      </div>
    );
  }

  return <div className="controls filterbar">{inner}</div>;
}
