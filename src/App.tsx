import { useEffect, useMemo, useState } from 'react';
import {
  parseSales, parseMeta, seasonsOf, aggregateSeason, lastFiveAuctionNumbers,
  type Sale, type AuctionMeta, type ItemRow,
} from './lib/data';
import './App.css';

const money = (n: number | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Fixed display order for the per-category tables. Any category not listed
// here is appended afterward, alphabetically.
const CATEGORY_ORDER = [
  'Trade Good', 'Ultra Rare', 'Premium', 'Bonus', 'Preorder', 'Golden Ticket',
];

export default function App() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [meta, setMeta] = useState<AuctionMeta[]>([]);
  const [season, setSeason] = useState<string>('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('data/prices.csv').then((r) => r.text()),
      fetch('data/metadata.csv').then((r) => r.text()),
    ])
      .then(([p, m]) => {
        const s = parseSales(p);
        setSales(s);
        setMeta(parseMeta(m));
        setSeason(seasonsOf(s)[0] ?? '');
      })
      .catch((e) => setError(String(e)));
  }, []);

  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  const rows = useMemo(() => (season ? aggregateSeason(sales, season) : []), [sales, season]);
  const last5Nums = useMemo(() => (season ? lastFiveAuctionNumbers(sales, season) : []), [sales, season]);
  const categories = useMemo(
    () => ['All', ...[...new Set(rows.map((r) => r.category))].sort()],
    [rows]
  );

  const filtered = rows.filter((r) => {
    if (category !== 'All' && r.category !== category) return false;
    if (query) {
      const q = query.toLowerCase();
      return r.item.toLowerCase().includes(q) || r.displayName.toLowerCase().includes(q);
    }
    return true;
  });

  // Group the filtered rows into per-category tables, ordered by CATEGORY_ORDER
  // (unlisted categories appended alphabetically). Rows within each table are
  // sorted alphabetically by token (display) name.
  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const r of filtered) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    const order = [...byCat.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return order.map((cat) => ({
      category: cat,
      rows: byCat.get(cat)!.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }));
  }, [filtered]);

  const seasonAuctions = meta
    .filter((m) => m.season === season && Number.isFinite(m.auctionNumber))
    .length;

  if (error) return <div className="wrap"><p className="err">Failed to load data: {error}</p></div>;

  return (
    <div className="wrap">
      <header>
        <h1>True Dungeon Auction Prices</h1>
        <p className="sub">
          Final sale prices from community group-buy auctions. Statistics are calculated
          live from {sales.length.toLocaleString()} recorded sales.
        </p>
      </header>

      <div className="controls">
        <label>
          Season
          <select value={season} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="search">
          Search
          <input
            type="text"
            placeholder="item or token name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <p className="meta-line">
        Season {season}: {seasonAuctions} auctions · {rows.length} distinct items ·
        {' '}"Last 5" = auctions #{last5Nums[0]}–#{last5Nums[last5Nums.length - 1]}
      </p>

      {groups.length === 0 && <p className="empty">No matching items.</p>}
      {groups.map((g) => (
        <CategoryTable key={g.category} category={g.category} rows={g.rows} />
      ))}
    </div>
  );
}

function CategoryTable({ category, rows }: { category: string; rows: ItemRow[] }) {
  return (
    <section className="cat-section">
      <h2 className="cat-header">{category}</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th rowSpan={2} className="left">Token</th>
              <th colSpan={3} className="group last5">Last 5 Auctions</th>
              <th colSpan={3} className="group">Full Season</th>
            </tr>
            <tr>
              <th className="last5">Max</th><th className="last5">Avg</th><th className="last5">Min</th>
              <th>Max</th><th>Avg</th><th>Min</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.item} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ r }: { r: ItemRow }) {
  return (
    <tr>
      <td className="left token">{r.displayName}</td>
      <td className="last5">{money(r.last5?.max)}</td>
      <td className="last5 avg">{money(r.last5?.avg)}</td>
      <td className="last5">{money(r.last5?.min)}</td>
      <td>{money(r.full.max)}</td>
      <td className="avg">{money(r.full.avg)}</td>
      <td>{money(r.full.min)}</td>
    </tr>
  );
}
