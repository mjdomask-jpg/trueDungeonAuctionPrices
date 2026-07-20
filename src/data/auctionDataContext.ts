import { createContext, useContext } from 'react';
import { type Sale, type AuctionMeta } from '../lib/data';

// Context + hook only (no component) so the provider file can stay
// component-only for React Fast Refresh. See AuctionDataProvider.tsx.

export type AuctionData = {
  sales: Sale[];
  meta: AuctionMeta[];
  loading: boolean;
  error: string;
};

export const AuctionDataContext = createContext<AuctionData | null>(null);

export function useAuctionData(): AuctionData {
  const value = useContext(AuctionDataContext);
  if (!value) throw new Error('useAuctionData must be used within an AuctionDataProvider');
  return value;
}
