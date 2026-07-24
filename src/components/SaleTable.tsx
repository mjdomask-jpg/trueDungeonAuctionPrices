import { fmtCloseDate, money } from '../lib/format';
import { COMPACT_SORT_KEYS } from '../lib/data';
import type { FlatRow, SortKey, SortDir } from '../lib/data';

// The explorer's flat view: every matching token-price in one sortable table,
// with its auction broken out into its own columns. Same rows as the grouped
// view — only the shape differs.

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'season', label: 'Season', numeric: true },
  { key: 'number', label: '#', numeric: true },
  { key: 'date', label: 'Closed' },
  { key: 'auction', label: 'Auction' },
  { key: 'auctioneer', label: 'Auctioneer' },
  { key: 'token', label: 'Token' },
  { key: 'category', label: 'Category' },
  { key: 'price', label: 'Price', numeric: true },
];

// The phone layout. Eight columns under `table-layout: fixed` don't shrink,
// they overlap: 82% of cells collided at 375px, and the fixed layout caps the
// table near container width so scrolling sideways recovered only 38px of the
// ~400px needed. Three columns fit.
//
// Auction is rendered as the compact "2026 · #46" the auction cards already
// use, rather than its name — names run to 59 characters, wrap to four lines
// at this width, and repeat on every row of the same auction (39 rows, for the
// one above). Built from COMPACT_SORT_KEYS so the columns and the set of keys
// a phone can sort by can't drift apart.
const COMPACT_LABELS: Partial<Record<SortKey, string>> = {
  token: 'Token', season: 'Auction', price: 'Price',
};
const COMPACT_COLUMNS = COMPACT_SORT_KEYS.map((key) => ({
  key,
  label: COMPACT_LABELS[key] ?? key,
  numeric: key === 'price',
}));

export function SaleTable({
  rows, sortKey, sortDir, onSort, compact = false,
}: {
  rows: FlatRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  // Set on phones. Category and Auctioneer drop out rather than being
  // truncated — both are still reachable as filters in the controls above.
  compact?: boolean;
}) {
  const columns = compact ? COMPACT_COLUMNS : COLUMNS;

  return (
    <div className="tablewrap">
      <table className={`flat${compact ? ' compact' : ''}${rows.length >= 4 ? ' banded' : ''}`}>
        {compact ? (
          <colgroup>
            <col className="col-token" /><col className="col-auction" /><col className="col-price" />
          </colgroup>
        ) : (
          <colgroup>
            <col className="col-season" /><col className="col-num" /><col className="col-date" />
            <col className="col-auction" /><col className="col-auctioneer" />
            <col className="col-token" /><col className="col-cat" /><col className="col-price" />
          </colgroup>
        )}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = c.key === sortKey;
              return (
                <th
                  key={c.key}
                  className={c.numeric ? 'sortable' : 'left sortable'}
                  aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" onClick={() => onSort(c.key)}>
                    {c.label}
                    {/* The caret shows on the active column only; the arrow
                        points the way the values run down the page. */}
                    <span className="sort-caret" aria-hidden="true">
                      {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, meta }) => {
            const token = (
              <td className="left token">
                {row.displayName}
                {row.item !== row.displayName && <span className="alt"> · {row.item}</span>}
              </td>
            );
            return compact ? (
              <tr key={`${row.auctionId}-${row.item}`}>
                {token}
                <td className="left auction-ref">{meta.season} · #{meta.auctionNumber}</td>
                <td>{money(row.price)}</td>
              </tr>
            ) : (
              <tr key={`${row.auctionId}-${row.item}`}>
                <td>{meta.season}</td>
                <td>{meta.auctionNumber}</td>
                <td className="left">{fmtCloseDate(meta.closeDate) ?? '—'}</td>
                <td className="left wrap-text">{meta.name}</td>
                <td className="left wrap-text">{meta.auctioneer || '—'}</td>
                {token}
                <td className="left">{row.category}</td>
                <td>{money(row.price)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
