import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  FiltersContext, makeDefaultFilters,
  type FilterState, type SourceFilter, type TrentPricing, type AuctionTypeFilter,
} from './filtersContext';
import type { Provenance } from '../lib/context';

// Holds the shared filter state. Pure UI state (no fetching), so it can wrap the
// app wherever — it sits just inside AuctionDataProvider in main.tsx. Actions are
// stable (useCallback) so a page can depend on one without re-subscribing to
// every filter change.
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(makeDefaultFilters);

  const setSource = useCallback((source: SourceFilter) => setFilters((f) => ({ ...f, source })), []);
  const setTrentPricing = useCallback((trentPricing: TrentPricing) => setFilters((f) => ({ ...f, trentPricing })), []);
  const setAuctionType = useCallback((auctionType: AuctionTypeFilter) => setFilters((f) => ({ ...f, auctionType })), []);
  const toggleProvenance = useCallback((p: Provenance) => setFilters((f) => {
    const provenance = new Set(f.provenance);
    if (provenance.has(p)) provenance.delete(p); else provenance.add(p);
    return { ...f, provenance };
  }), []);
  const reset = useCallback(() => setFilters(makeDefaultFilters()), []);

  const api = useMemo(
    () => ({ filters, setSource, setTrentPricing, setAuctionType, toggleProvenance, reset }),
    [filters, setSource, setTrentPricing, setAuctionType, toggleProvenance, reset],
  );
  return <FiltersContext.Provider value={api}>{children}</FiltersContext.Provider>;
}
