import { useEffect, useMemo, useState } from 'react';
import {
  parseSales, parseMeta, seasonsOf, aggregateSeason, lastFiveAuctionNumbers,
  type Sale, type AuctionMeta, type ItemRow,
} from './lib/data';
import './App.css';

const money = (n: number | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Format an ISO close date ("YYYY-MM-DD") as "Mon DD" (three-letter month,
// two-digit zero-padded day). Returns null when missing/unparseable.
const fmtCloseDate = (iso: string | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  const month = m && MONTHS[parseInt(m[2], 10) - 1];
  return m && month ? `${month} ${m[3]}` : null;
};

// Fixed display order for the per-category tables. Any category not listed
// here is appended afterward, alphabetically.
const CATEGORY_ORDER = [
  'Trade Good', 'Ultra Rare', 'Premium', 'Bonus', 'Preorder', 'Golden Ticket',
];

// Categories whose tables get alternating row banding.
const BANDED_CATEGORIES = new Set(['Trade Good', 'Premium']);

type Theme = 'light' | 'dark';

const prefersDark = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

// Reads the theme already stamped onto <html> by the inline script in
// index.html (seeded from localStorage, else the OS preference).
const readTheme = (): Theme =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Keep following the OS while the visitor hasn't made an explicit choice.
  useEffect(() => {
    if (localStorage.getItem('theme')) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(prefersDark());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', next); // an explicit choice; stop following the OS
      return next;
    });
  };

  return [theme, toggle];
}

export default function App() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [meta, setMeta] = useState<AuctionMeta[]>([]);
  const [season, setSeason] = useState<string>('');
  const [category, setCategory] = useState('All');
  const [error, setError] = useState('');
  const [theme, toggleTheme] = useTheme();

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

  const filtered = rows.filter((r) => category === 'All' || r.category === category);

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

  const closedAuctions = meta
    .filter((m) => m.season === season && m.status === 'Closed')
    .length;

  // Global intro stats (across all seasons).
  const totalClosedAuctions = meta.filter((m) => m.status === 'Closed').length;
  const firstYear = seasons[seasons.length - 1];
  const lastYear = seasons[0];

  // Close dates for the "Last 5" window, looked up from metadata by auction
  // number. Falls back to "#N" if a close date is missing.
  const closeDateByNumber = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of meta) if (m.season === season) map.set(m.auctionNumber, m.closeDate);
    return map;
  }, [meta, season]);
  const last5Label = (n: number | undefined) =>
    n == null ? '' : fmtCloseDate(closeDateByNumber.get(n)) ?? `#${n}`;

  if (error) return <div className="wrap"><p className="err">Failed to load data: {error}</p></div>;

  return (
    <div className="wrap">
      <header>
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <h1>True Dungeon Auction Prices</h1>
        <p className="sub">
          Welcome to the True Dungeon auction analysis! These statistics are calculated
          live from {totalClosedAuctions.toLocaleString()} auctions from {firstYear} to {lastYear}.
          This covers {sales.length.toLocaleString()} items sold!
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
      </div>

      <p className="meta-line">
        Season {season}: {closedAuctions} closed auctions ·
        {' '}"Last 5" = {last5Nums.map(last5Label).join(', ')}
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
    <section className="cat-section" data-category={category}>
      <h2 className="cat-header">{category}</h2>
      <div className="tablewrap">
        <table className={BANDED_CATEGORIES.has(category) ? 'banded' : undefined}>
          <colgroup>
            <col className="col-token" />
            <col /><col /><col />
            <col /><col /><col />
          </colgroup>
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
