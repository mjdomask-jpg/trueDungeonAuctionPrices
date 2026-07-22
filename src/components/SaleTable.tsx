import { fmtCloseDate, money } from '../lib/format';
import type { FlatRow, SortKey, SortDir } from '../lib/data';

// The explorer's flat view: every matching token-price in one sortable table,
// with its auction alongside. Same rows as the grouped view — only the shape
// differs.

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'auction', label: 'Auction' },
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
      <table className={rows.length >= 4 ? 'banded' : undefined}>
        <colgroup><col /><col className="col-token" /><col /><col /></colgroup>
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
              <td className="left">
                <span className="flat-auction">{meta.name}</span>
                <span className="alt">
                  {' '}· {meta.season} #{meta.auctionNumber}
                  {fmtCloseDate(meta.closeDate) && ` · ${fmtCloseDate(meta.closeDate)}`}
                </span>
              </td>
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
