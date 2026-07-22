import { fmtCloseDate, money } from '../lib/format';
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

export function SaleTable({
  rows, sortKey, sortDir, onSort,
}: {
  rows: FlatRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <div className="tablewrap">
      <table className={`flat${rows.length >= 4 ? ' banded' : ''}`}>
        <colgroup>
          <col className="col-season" /><col className="col-num" /><col className="col-date" />
          <col className="col-auction" /><col className="col-auctioneer" />
          <col className="col-token" /><col className="col-cat" /><col className="col-price" />
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((c) => {
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
          {rows.map(({ row, meta }) => (
            <tr key={`${row.auctionId}-${row.item}`}>
              <td>{meta.season}</td>
              <td>{meta.auctionNumber}</td>
              <td className="left">{fmtCloseDate(meta.closeDate) ?? '—'}</td>
              <td className="left wrap-text">{meta.name}</td>
              <td className="left wrap-text">{meta.auctioneer || '—'}</td>
              <td className="left token">
                {row.displayName}
                {row.item !== row.displayName && <span className="alt"> · {row.item}</span>}
              </td>
              <td className="left">{row.category}</td>
              <td>{money(row.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
