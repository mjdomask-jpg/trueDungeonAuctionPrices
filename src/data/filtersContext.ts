import { createContext, useContext } from 'react';
import type { Provenance } from '../lib/context';

// Shared view-filter state for the context layer, read by every in-scope page
// through one hook so the controls behave identically everywhere
// (docs/context-layer-design.md §5.2). Context + hook only (no component), so the
// provider file stays component-only for React Fast Refresh — same split as
// auctionDataContext.

export type SourceFilter = 'all' | 'Forum' | 'Trent';
export type TrentPricing = 'nominal' | 'reward-adjusted';
export type AuctionTypeFilter = 'all' | 'augmented' | 'non-augmented' | 'golden-ticket';

// The toggleable item provenances (everything except the implicit 'normal', which
// is always the core prices.csv sales). Order is display order in the FilterBar.
export const CONTEXT_PROVENANCES: Provenance[] = ['released-payment', 'augment', 'grunnel', 'withheld'];

// Human-facing provenance names, shared by the FilterBar chips and the badge
// popover titles. Lives here (a non-component module) so both can import it
// without tripping React Fast Refresh's "components only" rule.
export const PROVENANCE_NAME: Record<Provenance, string> = {
  'released-payment': 'Released payment',
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
export const makeDefaultFilters = (): FilterState => ({
  source: 'all',
  trentPricing: 'nominal',
  auctionType: 'all',
  provenance: new Set<Provenance>(['released-payment', 'augment', 'grunnel']),
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
