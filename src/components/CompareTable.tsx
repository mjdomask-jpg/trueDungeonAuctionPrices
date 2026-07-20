import { type CompareRow } from '../lib/data';
import { money } from '../lib/format';

// One Compare-Years table: Token | season A (Max/Avg/Min) | season B
// (Max/Avg/Min) | Δ Avg. Used both for a single category section and for the
// flat "biggest movers" view, so it takes the rows already ordered by the page.
export function CompareTable({
  rows, seasonA, seasonB, newerIsB,
}: {
  rows: CompareRow[];
  seasonA: string;
  seasonB: string;
  newerIsB: boolean;
}) {
  return (
    <div className="tablewrap">
      <table>
        <colgroup>
          <col className="col-token" />
          <col /><col /><col />
          <col /><col /><col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className="left">Token</th>
            <th colSpan={3} className="group">{seasonA}</th>
            <th colSpan={3} className="group sep">{seasonB}</th>
            <th rowSpan={2} className="sep">Δ Avg</th>
          </tr>
          <tr>
            <th>Max</th><th>Avg</th><th>Min</th>
            <th className="sep">Max</th><th>Avg</th><th>Min</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <Row key={r.item} r={r} newerIsB={newerIsB} />)}
        </tbody>
      </table>
    </div>
  );
}

function TokenCell({ r, newerIsB }: { r: CompareRow; newerIsB: boolean }) {
  const newer = newerIsB ? r.nameB : r.nameA;
  const older = newerIsB ? r.nameA : r.nameB;
  // Primary label is the newer year's name; show the older name alongside only
  // when both years exist and the name actually changed.
  const primary = newer ?? older ?? r.item;
  const alt = newer && older && newer !== older ? older : null;
  return (
    <td className="left token">
      {primary}
      {alt && <span className="alt"> / {alt}</span>}
    </td>
  );
}

function PctCell({ pct }: { pct: number | null }) {
  if (pct == null) return <td className="diff sep">—</td>;
  const up = pct > 0, down = pct < 0;
  const cls = up ? 'diff sep up' : down ? 'diff sep down' : 'diff sep';
  const arrow = up ? '▲' : down ? '▼' : '';
  return (
    <td className={cls}>
      {arrow}{arrow && ' '}{pct > 0 ? '+' : ''}{pct.toFixed(1)}%
    </td>
  );
}

function Row({ r, newerIsB }: { r: CompareRow; newerIsB: boolean }) {
  return (
    <tr>
      <TokenCell r={r} newerIsB={newerIsB} />
      <td>{money(r.a?.max)}</td>
      <td className="avg">{money(r.a?.avg)}</td>
      <td>{money(r.a?.min)}</td>
      <td className="sep">{money(r.b?.max)}</td>
      <td className="avg">{money(r.b?.avg)}</td>
      <td>{money(r.b?.min)}</td>
      <PctCell pct={r.avgPct} />
    </tr>
  );
}
