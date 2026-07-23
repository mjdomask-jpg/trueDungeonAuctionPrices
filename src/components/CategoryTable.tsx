import { type ItemRow } from '../lib/data';
import { money } from '../lib/format';

// Which stat group the table shows. Seven columns don't fit a phone — the six
// numbers get ~38px each, of which 24px is padding, so prices collide. Narrow
// screens show one group at a time behind a toggle; 'both' is the desktop view.
export type StatGroup = 'both' | 'last5' | 'full';

export function CategoryTable(
  { category, rows, group = 'both' }: { category: string; rows: ItemRow[]; group?: StatGroup },
) {
  // General rule across the site: any table long enough to be worth scanning
  // (4+ rows) gets alternating row banding.
  const isBanded = rows.length >= 4;
  const showLast5 = group !== 'full';
  const showFull = group !== 'last5';
  // `one-group` marks the phone view (a single stat group, so four columns not
  // seven); the CSS uses it to widen the Token column, which Compare's eight-
  // column table — also in a .cat-section — must not get.
  const tableClass = [isBanded && 'banded', group !== 'both' && 'one-group']
    .filter(Boolean).join(' ') || undefined;

  return (
    <section className="cat-section" data-category={category}>
      <h2 className="cat-header">{category}</h2>
      <div className="tablewrap">
        <table className={tableClass}>
          <colgroup>
            <col className="col-token" />
            {showLast5 && <><col /><col /><col /></>}
            {showFull && <><col /><col /><col /></>}
          </colgroup>
          <thead>
            {/* The group header stays even when only one group shows: the
                toggle says which is selected, but the table should still say
                so once you've scrolled the controls off screen. */}
            <tr>
              <th rowSpan={2} className="left">Token</th>
              {showLast5 && <th colSpan={3} className="group last5">Last 5 Auctions</th>}
              {showFull && <th colSpan={3} className="group">Full Season</th>}
            </tr>
            <tr>
              {showLast5 && (
                <>
                  <th className="last5">Max</th><th className="last5">Avg</th><th className="last5">Min</th>
                </>
              )}
              {showFull && <><th>Max</th><th>Avg</th><th>Min</th></>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.item} r={r} showLast5={showLast5} showFull={showFull} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row(
  { r, showLast5, showFull }: { r: ItemRow; showLast5: boolean; showFull: boolean },
) {
  return (
    <tr>
      <td className="left token">{r.displayName}</td>
      {showLast5 && (
        <>
          <td className="last5">{money(r.last5?.max)}</td>
          <td className="last5 avg">{money(r.last5?.avg)}</td>
          <td className="last5">{money(r.last5?.min)}</td>
        </>
      )}
      {showFull && (
        <>
          <td>{money(r.full.max)}</td>
          <td className="avg">{money(r.full.avg)}</td>
          <td>{money(r.full.min)}</td>
        </>
      )}
    </tr>
  );
}
