import { createContext, useContext } from 'react';
import type {
  Provenance, SourceFilter, TrentPricing, AuctionTypeFilter,
} from '../lib/context';

// Shared view-filter state for the context layer, read by every in-scope page
// through one hook so the controls behave identically everywhere
// (docs/context-layer-design.md §5.2). Context + hook only (no component), so the
// provider file stays component-only for React Fast Refresh — same split as
// auctionDataContext.

// The filter vocabulary lives in lib/context (with the pure filtering logic);
// re-exported here so the UI layer keeps importing it from one place.
export type { SourceFilter, TrentPricing, AuctionTypeFilter } from '../lib/context';

// The toggleable item provenances (everything except the implicit 'normal', which
// is always the core prices.csv sales). Order is display order in the FilterBar.
export const CONTEXT_PROVENANCES: Provenance[] = ['released-payment', 'augment', 'grunnel', 'withheld'];

// Human-facing provenance names, shared by the FilterBar chips and the badge
// popover titles. Lives here (a non-component module) so both can import it
// without tripping React Fast Refresh's "components only" rule.
export const PROVENANCE_NAME: Record<Provenance, string> = {
  'released-payment': 'Bonus included',
  augment: 'Augment',
  grunnel: 'Grunnel',
  withheld: 'Withheld (est.)',
};

export type FilterState = {
  source: SourceFilter;
  trentPricing: TrentPricing;
  auctionType: AuctionTypeFilter;
  // Which context provenances are shown. Withheld (the only ESTIMATES) start off,
  // so headline/context views never include estimates unless asked (§5.4).
  provenance: Set<Provenance>;
};

// Freshly clone the Set each time so no two providers share a mutable default.
// All provenances start on, withheld estimates included: the provenance filter
// selects which context items show under each Auction Data card, and by default
// the cards show them all.
export const makeDefaultFilters = (): FilterState => ({
  source: 'all',
  trentPricing: 'nominal',
  auctionType: 'all',
  provenance: new Set<Provenance>(['released-payment', 'augment', 'grunnel', 'withheld']),
});

export type FiltersApi = {
  filters: FilterState;
  setSource: (s: SourceFilter) => void;
  setTrentPricing: (t: TrentPricing) => void;
  setAuctionType: (a: AuctionTypeFilter) => void;
  toggleProvenance: (p: Provenance) => void;
  reset: () => void;
};

export const FiltersContext = createContext<FiltersApi | null>(null);

export function useFilters(): FiltersApi {
  const v = useContext(FiltersContext);
  if (!v) throw new Error('useFilters must be used within a FiltersProvider');
  return v;
}

// Which context-layer controls a page shows in its FilterBar. Lives here with
// the filter state so the count helper below can too — both stay in this
// component-free module, out of FilterBar's Fast-Refresh "components only" file.
export type FilterControl = 'source' | 'trentPricing' | 'auctionType' | 'provenance';

// How many of the given controls are set away from their default — for a folded
// panel's "N active" badge (the FilterBar's own collapsed button, and Auction
// Data's unified Filters disclosure, which counts these alongside its pickers).
// Provenance defaults to all-on, so any chip switched off counts; Trent pricing
// only counts when Trent sales are actually in view.
export function activeFilterCount(filters: FilterState, controls: FilterControl[]): number {
  const show = (c: FilterControl) => controls.includes(c);
  const trentInView = filters.source !== 'Forum';
  const provenanceChanged = CONTEXT_PROVENANCES.some((p) => !filters.provenance.has(p));
  return (show('source') && filters.source !== 'all' ? 1 : 0)
    + (show('trentPricing') && trentInView && filters.trentPricing !== 'nominal' ? 1 : 0)
    + (show('auctionType') && filters.auctionType !== 'all' ? 1 : 0)
    + (show('provenance') && provenanceChanged ? 1 : 0);
}
