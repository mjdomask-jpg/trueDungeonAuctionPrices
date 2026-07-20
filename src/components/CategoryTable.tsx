import { type ItemRow } from '../lib/data';
import { money } from '../lib/format';

// Categories whose tables get alternating row banding.
const BANDED_CATEGORIES = new Set(['Trade Good', 'Premium']);

export function CategoryTable({ category, rows }: { category: string; rows: ItemRow[] }) {
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
