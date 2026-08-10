import {
  useFilters, CONTEXT_PROVENANCES, PROVENANCE_NAME,
  type SourceFilter, type AuctionTypeFilter,
} from '../data/filtersContext';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';

// The shared context-layer controls. One implementation, dropped into each page;
// a page passes `controls` to show only the ones it uses, so the state shape and
// behaviour stay identical everywhere (docs/context-layer-design.md §5.2).
export type FilterControl = 'source' | 'trentPricing' | 'auctionType' | 'provenance';
const DEFAULT_CONTROLS: FilterControl[] = ['source', 'trentPricing', 'auctionType', 'provenance'];

// Off-default check for the collapsed-menu badge: every provenance is on by
// default, so any chip switched off counts as an active filter.
const provenanceChanged = (set: Set<string>) =>
  CONTEXT_PROVENANCES.some((p) => !set.has(p));

export function FilterBar({
  controls = DEFAULT_CONTROLS,
  collapsibleOnMobile = false,
  mobileSummary = 'Filters',
}: {
  controls?: FilterControl[];
  // When true, the bar folds behind a disclosure below 640px so it doesn't push
  // the data down a phone screen. Pages whose filter has an immediate local
  // effect (e.g. the Context page) leave it open instead.
  collapsibleOnMobile?: boolean;
  // Summary label for the collapsed disclosure. Override where a page already
  // has its own "Filters" fold (Auction Data), so the two don't read alike.
  mobileSummary?: string;
}) {
  const { filters, setSource, setTrentPricing, setAuctionType, toggleProvenance } = useFilters();
  const narrow = useMediaQuery(NARROW);
  const show = (c: FilterControl) => controls.includes(c);
  // The Trent reward-adjust only makes sense when Trent sales are in view.
  const trentInView = filters.source !== 'Forum';

  const inner = (
    <>
      {show('source') && (
        <label>
          Source
          <select value={filters.source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
            <option value="all">All sources</option>
            <option value="Forum">Forum</option>
            <option value="Trent">Trent</option>
          </select>
        </label>
      )}

      {show('trentPricing') && trentInView && (
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

  if (narrow && collapsibleOnMobile) {
    // Count the controls whose value is off-default, so the folded button still
    // says a filter is active (reuses the ExplorerPage .filterset furniture).
    const activeCount =
      (show('source') && filters.source !== 'all' ? 1 : 0)
      + (show('trentPricing') && trentInView && filters.trentPricing !== 'nominal' ? 1 : 0)
      + (show('auctionType') && filters.auctionType !== 'all' ? 1 : 0)
      + (show('provenance') && provenanceChanged(filters.provenance) ? 1 : 0);
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
