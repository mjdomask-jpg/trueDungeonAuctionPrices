import { useMemo } from 'react';
import { useAuctionData } from '../data/auctionDataContext';
import { PriceIndex, CostEngine } from '../lib/transmutes';

// Builds the transmute cost engine from the shared context data.
//
// The PriceIndex aggregates every season up front (the same aggregateSeason the
// dashboard uses), so it is the expensive part — it is memoized on the raw data
// alone and survives a change to the "recent prices" toggle. Only the much
// cheaper CostEngine is rebuilt when that toggle flips; rebuilding it is also
// what clears its memo, which is required because the toggle changes which
// price variant every line resolves to.
export function useCostEngine({ recentPrices = false }: { recentPrices?: boolean } = {}) {
  const { sales, recipes, tokenMeta, offAuctionPrices, derivedRules, loading, error } = useAuctionData();

  const prices = useMemo(
    () => (sales.length ? new PriceIndex(sales, offAuctionPrices, derivedRules, tokenMeta) : null),
    [sales, offAuctionPrices, derivedRules, tokenMeta],
  );

  const engine = useMemo(
    () => (prices && recipes.length ? new CostEngine(recipes, prices, { recentPrices }) : null),
    [prices, recipes, recentPrices],
  );

  return { engine, prices, loading, error, ready: !!engine };
}
