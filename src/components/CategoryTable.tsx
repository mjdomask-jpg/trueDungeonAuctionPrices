import { type ItemRow } from '../lib/data';
import { money } from '../lib/format';

// Categories whose tables get alternating row banding. Exported so other views
// (Compare Years) band the same categories the dashboard does.
export const BANDED_CATEGORIES = new Set(['Trade 1', 'Trade 2', 'Premium']);

export function CategoryTable(
  { category, rows, banded }: { category: string; rows: ItemRow[]; banded?: boolean },
) {
  // Band either when the caller opts in (banded) or when the category is one of
  // the always-banded dashboard categories.
  const isBanded = banded || BANDED_CATEGORIES.has(category);
  return (
    <section className="cat-section" data-category={category}>
      <h2 className="cat-header">{category}</h2>
      <div className="tablewrap">
        <table className={isBanded ? 'banded' : undefined}>
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
