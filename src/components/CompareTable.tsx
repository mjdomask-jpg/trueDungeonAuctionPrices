import { type CompareRow, type StatKind, pctChange } from '../lib/data';
import { money, moneyTight } from '../lib/format';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';

const STAT_LABEL: Record<StatKind, string> = { max: 'Max', avg: 'Avg', min: 'Min' };

// One Compare-Years table: Token | season A (Max/Avg/Min) | season B
// (Max/Avg/Min) | Δ Avg. Used both for a single category section and for the
// flat "biggest movers" view, so it takes the rows already ordered by the page.
// `stat` only bites in the compact phone view (see below); desktop always shows
// all three stats and the Avg delta.
export function CompareTable({
  rows, seasonA, seasonB, newerIsB, stat,
}: {
  rows: CompareRow[];
  seasonA: string;
  seasonB: string;
  newerIsB: boolean;
  stat: StatKind;
}) {
  const narrow = useMediaQuery(NARROW);
  // General rule across the site: any table with 4+ rows gets row banding.
  const isBanded = rows.length >= 4;

  // Phones can't fit all eight columns without crushing the numbers, so show a
  // single stat — the one picked in the page's toggle — for each year plus its
  // change; the other two stats stay on desktop and on the Prices tab. The delta
  // tracks the shown stat, not a hidden average, so the change always describes
  // the numbers on screen. `compare-compact` sets this four-column view's widths
  // — a wide Token column and an extra-wide Δ so three-digit swings like
  // "+165.1%" fit.
  if (narrow) {
    const cls = [isBanded && 'banded', 'compare-compact'].filter(Boolean).join(' ');
    const label = STAT_LABEL[stat];
    return (
      <div className="tablewrap">
        <table className={cls}>
          <colgroup>
            <col className="col-token" />
            <col /><col />
            <col className="col-delta" />
          </colgroup>
          <thead>
            <tr>
              <th className="left">Token</th>
              <th className="stacked">{label}<br />{seasonA}</th>
              <th className="sep stacked">{label}<br />{seasonB}</th>
              <th className="sep">Δ {label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item}>
                <TokenCell r={r} newerIsB={newerIsB} />
                <td className="avg">{moneyTight(r.a?.[stat])}</td>
                <td className="avg sep">{moneyTight(r.b?.[stat])}</td>
                <PctCell pct={pctChange(r.a?.[stat], r.b?.[stat])} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="tablewrap">
      <table className={isBanded ? 'banded' : undefined}>
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
