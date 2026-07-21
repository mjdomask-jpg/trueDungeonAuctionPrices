import { createContext, useContext } from 'react';
import { type Sale, type AuctionMeta, type GroupRow } from '../lib/data';
import { type Recipe, type TokenMeta, type OffAuctionPrice, type DerivedRule } from '../lib/transmutes';

// Context + hook only (no component) so the provider file can stay
// component-only for React Fast Refresh. See AuctionDataProvider.tsx.

export type AuctionData = {
  sales: Sale[];
  meta: AuctionMeta[];
  onyxSales: Sale[]; // chase-UR "Onyx" sub-list; same shape as sales, tracked separately
  groupRows: GroupRow[]; // token→chart-group mapping for Price Timelines (optional)
  // Transmutes (Phase 4). All four are optional: a missing file leaves the
  // Transmutes page empty without affecting any other view.
  recipes: Recipe[]; // bills of materials, one per (season, transmute)
  tokenMeta: TokenMeta[]; // canonicalName ↔ per-season displayName ↔ category
  offAuctionPrices: OffAuctionPrice[]; // hand-maintained prices for never-auctioned tokens
  derivedRules: DerivedRule[]; // e.g. Monster Trophy = Fleece ÷ 10
  loading: boolean;
  error: string;
};

export const AuctionDataContext = createContext<AuctionData | null>(null);

export function useAuctionData(): AuctionData {
  const value = useContext(AuctionDataContext);
  if (!value) throw new Error('useAuctionData must be used within an AuctionDataProvider');
  return value;
}
