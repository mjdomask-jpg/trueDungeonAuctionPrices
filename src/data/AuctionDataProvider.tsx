import { useEffect, useState, type ReactNode } from 'react';
import { parseSales, parseMeta, parseGroups, type Sale, type AuctionMeta, type GroupRow } from '../lib/data';
import { AuctionDataContext } from './auctionDataContext';

// Shared, load-once auction data. Lifting the fetch/parse out of a single page
// means every future view (timelines, compare, transmutes) reads the same
// parsed rows instead of re-fetching. When we later add a build-time CSV→JSON
// step (see docs/expansion-plan.md §5), only this module changes.

// Resolve data files against Vite's base URL so paths work whether the site is
// served from a domain root or a GitHub Pages subpath (base: './').
const dataUrl = (name: string) => `${import.meta.env.BASE_URL}data/${name}`;

export function AuctionDataProvider({ children }: { children: ReactNode }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [meta, setMeta] = useState<AuctionMeta[]>([]);
  const [onyxSales, setOnyxSales] = useState<Sale[]>([]);
  const [groupRows, setGroupRows] = useState<GroupRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(dataUrl('prices.csv')).then((r) => r.text()),
      fetch(dataUrl('metadata.csv')).then((r) => r.text()),
    ])
      .then(([p, m]) => {
        setSales(parseSales(p));
        setMeta(parseMeta(m));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));

    // Onyx is optional and independent: a missing or header-only file leaves
    // the Onyx section empty without failing the main dashboard. It uses the
    // same raw-sales schema as prices.csv, so parseSales handles it directly.
    fetch(dataUrl('onyx.csv'))
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => setOnyxSales(t ? parseSales(t) : []))
      .catch(() => setOnyxSales([]));

    // Timeline groupings are optional too: a missing file just means the
    // Timelines page falls back to listing every token as ungrouped.
    fetch(dataUrl('tokenGroups.csv'))
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => setGroupRows(t ? parseGroups(t) : []))
      .catch(() => setGroupRows([]));
  }, []);

  return (
    <AuctionDataContext.Provider value={{ sales, meta, onyxSales, groupRows, loading, error }}>
      {children}
    </AuctionDataContext.Provider>
  );
}
