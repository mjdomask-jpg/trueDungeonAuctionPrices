import { useMemo } from 'react';
import { useAuctionData } from '../data/auctionDataContext';
import { PriceIndex, CostEngine } from '../lib/transmutes';

// Builds the transmute cost engine from the shared context data.
//
// The PriceIndex aggregates every season up front (the same aggregateSeason the
// dashboard uses) and carries the auction close dates the accuracy release
// prices expired recipes over, so it is the expensive part — it is memoized on the raw data
// alone and survives a change to the "recent prices" toggle. Only the much
// cheaper CostEngine is rebuilt when that toggle flips; rebuilding it is also
// what clears its memo, which is required because the toggle changes which
// price variant every line resolves to.
export function useCostEngine({ recentPrices = false }: { recentPrices?: boolean } = {}) {
  const { sales, meta, recipes, tokenMeta, offAuctionPrices, derivedRules, loading, error } = useAuctionData();

  const prices = useMemo(
    () => (sales.length ? new PriceIndex(sales, offAuctionPrices, derivedRules, tokenMeta, meta) : null),
    [sales, offAuctionPrices, derivedRules, tokenMeta, meta],
  );

  const engine = useMemo(
    () => (prices && recipes.length ? new CostEngine(recipes, prices, { recentPrices }) : null),
    [prices, recipes, recentPrices],
  );

  return { engine, prices, loading, error, ready: !!engine };
}
