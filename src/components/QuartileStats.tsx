import { useEffect, useMemo, useState } from 'react';
import { lastFiveAuctionNumbers, type Sale, type GroupRow } from '../lib/data';
import {
  parseRawSales, rawSeasons, quartilesByGroup,
  type RawSale, type QuartileItem,
} from '../lib/quartiles';
import { BoxPlot, type Box } from './BoxPlot';
import { boxColorAt } from '../lib/boxColors';
import { TenXToggle } from './TenXToggle';
import { useTenX } from '../hooks/useTenX';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { moneyTight } from '../lib/format';

// Quartiles view (Analytics). A box-and-whisker plot + quartile table for every
// Timelines group, for one year, built from the per-lot Trent export. The raw
// file (~1.3 MB) is fetched here on first mount rather than in the shared data
// provider, so it only loads when someone actually opens this view. See
// docs/updating-the-data.md and lib/quartiles.ts.

const dataUrl = (name: string) => `${import.meta.env.BASE_URL}data/${name}`;

export function QuartileStats({ sales, groupRows }: { sales: Sale[]; groupRows: GroupRow[] }) {
  const [raw, setRaw] = useState<RawSale[] | null>(null);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState('');
  const [tenX, setTenX] = useTenX();
  // Full season, or only the season's last five auctions — the same recency
  // window the Prices page offers, and the reason to want it here is the same:
  // late in a season the whole-year spread is dragged by prices that have since
  // moved, and the last five describe what a token goes for now.
  const [span, setSpan] = useState<'full' | 'last5'>('full');
  const narrow = useMediaQuery(NARROW);

  useEffect(() => {
    let alive = true;
    fetch(dataUrl('rawPricesData.csv'))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (alive) setRaw(parseRawSales(t)); })
      .catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, []);

  const seasons = useMemo(() => (raw ? rawSeasons(raw) : []), [raw]);
  const season = picked && seasons.includes(picked) ? picked : seasons[0] ?? '';

  // The window is defined over prices.csv, not the per-lot feed, so "Last 5"
  // means the same five auctions it means on Prices (see quartilesByGroup).
  const last5 = useMemo(
    () => (season ? lastFiveAuctionNumbers(sales, season) : []),
    [sales, season],
  );
  const grouped = useMemo(
    () => (raw && season
      ? quartilesByGroup(raw, sales, groupRows, season, tenX, span === 'last5' ? last5 : null)
      : null),
    [raw, sales, groupRows, season, tenX, span, last5],
  );

  if (err) return <p className="err">Failed to load quartile data: {err}</p>;
  if (!raw) return <p className="empty">Loading quartile data…</p>;

  return (
    <>
      <h2 className="an-viewhead">Quartiles</h2>
      <p className="an-lede">
        Every sale price of a token in one year, summarised as a box-and-whisker plot and a
        quartile table. The box spans the middle half of sales (Q1–Q3), the line is the median,
        and the whiskers reach the furthest sale within 1.5×IQR; dots beyond them are outliers.
        Tokens are grouped exactly as on <strong>Timelines</strong>, so each chart holds
        similarly-priced tokens. This uses the richer per-lot Trent data (2023 on); unsold
        ($0.00) lots are excluded.
      </p>

      <div className="controls">
        {seasons.length > 1 && (
          <label>
            Season
            <select value={season} onChange={(e) => setPicked(e.target.value)}>
              {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        <div className="toggle" role="group" aria-label="Price window">
          <span className="toggle-label">Show</span>
          <div className="toggle-buttons">
            <button type="button" data-label="Full season" className={span === 'full' ? 'on' : undefined}
              aria-pressed={span === 'full'} onClick={() => setSpan('full')}>
              Full season
            </button>
            <button type="button" data-label="Last 5 auctions" data-short="Last 5"
              className={span === 'last5' ? 'on' : undefined}
              aria-pressed={span === 'last5'} onClick={() => setSpan('last5')}>
              <span className="lbl-full">Last 5 auctions</span>
              <span className="lbl-short">Last 5</span>
            </button>
          </div>
        </div>
        <TenXToggle on={tenX} onChange={setTenX} />
      </div>

      {/* Which auctions the window actually rests on. The per-lot feed is Trent's,
          so the site-wide last five routinely include Forum auctions it has no
          rows for — a quartile drawn from two auctions should say it is. */}
      {grouped?.window && (
        <p className="meta-line">
          Last 5 auctions of {season}: {grouped.window.auctions.join(', ')} ·{' '}
          {grouped.window.withData.length === 0
            ? 'none of them are in the per-lot feed'
            : <>per-lot data for {grouped.window.withData.length} of them
              {' '}({grouped.window.withData.join(', ')}), {grouped.window.lots.toLocaleString()} lots</>}
        </p>
      )}

      {grouped && grouped.unmatched.length > 0 && (
        <p className="err">
          Grouping references {grouped.unmatched.length} token{grouped.unmatched.length === 1 ? '' : 's'}{' '}
          not present in the raw data (check the Item names in tokenGroups.csv):{' '}
          {grouped.unmatched.join(', ')}
        </p>
      )}

      {groupRows.length === 0 && (
        <p className="empty">
          No token grouping loaded. Add <code>public/data/tokenGroups.csv</code> to lay out the charts.
        </p>
      )}

      {grouped && grouped.groups.length === 0 && groupRows.length > 0 && (
        <p className="empty">No grouped tokens sold in {season}.</p>
      )}

      {grouped?.groups.map((g) => {
        const boxes: Box[] = g.items.map((it) => ({ label: it.displayName, stats: it.stats, lineColor: it.lineColor }));
        return (
          <section key={g.group} className="cat-section" data-category={g.category}>
            <h2 className="cat-header">{g.label}</h2>
            <BoxPlot boxes={boxes} title={g.label} />
            <QuartileTable items={g.items} boxes={boxes} narrow={narrow} />
          </section>
        );
      })}

      {grouped && grouped.ungrouped.length > 0 && (
        <p className="meta-line">
          Not charted (no group assigned in {season}): {grouped.ungrouped.join(', ')}
        </p>
      )}
    </>
  );
}

// Per-group quartile breakdown. Desktop: an eight-column table. Phones: a card
// per token with the same numbers in a small grid — no sideways scroll and no
// crushed columns. Each row/card wears the box's colour so the table and the
// plot read as one.
function QuartileTable(
  { items, boxes, narrow }: { items: QuartileItem[]; boxes: Box[]; narrow: boolean },
) {
  if (narrow) {
    return (
      <ul className="qt-cards">
        {items.map((it, i) => (
          <li key={it.item} className="qt-card">
            <div className="qt-cardhead">
              <span className="swatch" style={{ background: boxColorAt(boxes, i) }} />
              {it.displayName}
            </div>
            <dl className="qt-grid">
              <div><dt>Min</dt><dd>{moneyTight(it.stats.min)}</dd></div>
              <div><dt>Q1</dt><dd>{moneyTight(it.stats.q1)}</dd></div>
              <div><dt>Median</dt><dd>{moneyTight(it.stats.median)}</dd></div>
              <div><dt>Q3</dt><dd>{moneyTight(it.stats.q3)}</dd></div>
              <div><dt>Max</dt><dd>{moneyTight(it.stats.max)}</dd></div>
              <div><dt>IQR</dt><dd>{moneyTight(it.stats.iqr)}</dd></div>
              <div><dt>Sales</dt><dd>{it.stats.n}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    );
  }

  const banded = items.length >= 4;
  return (
    <table className={`an-table qt-table${banded ? ' banded' : ''}`}>
      <thead>
        <tr>
          <th className="left">Token</th>
          <th className="num">Sales</th>
          <th className="num">Min</th>
          <th className="num">Q1</th>
          <th className="num">Median</th>
          <th className="num">Q3</th>
          <th className="num">Max</th>
          <th className="num">IQR</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.item}>
            <td className="left token">
              <span className="swatch" style={{ background: boxColorAt(boxes, i) }} />
              {it.displayName}
            </td>
            <td className="num">{it.stats.n}</td>
            <td className="num">{moneyTight(it.stats.min)}</td>
            <td className="num">{moneyTight(it.stats.q1)}</td>
            <td className="num strong">{moneyTight(it.stats.median)}</td>
            <td className="num">{moneyTight(it.stats.q3)}</td>
            <td className="num">{moneyTight(it.stats.max)}</td>
            <td className="num">{moneyTight(it.stats.iqr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
