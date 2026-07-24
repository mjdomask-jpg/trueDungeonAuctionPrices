import { useMemo, useState } from 'react';
import type { AuctionMeta, Sale } from '../lib/data';
import {
  auctionsPerSeason, auctioneerSharesBySeason, auctioneerSeasonMatrix,
  historyItems, itemPriceHistory, displayNameIn,
} from '../lib/analytics';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { BarChart } from './BarChart';
import { PieChart } from './PieChart';
import { AreaChart } from './AreaChart';

// The Historical half of the analytics page: every season for which the
// underlying column exists. Unlike Current Year, these panels rest only on
// columns recorded since 2019 (season, auctioneer, status) plus the price
// feeds, so they cover the full record rather than 2022 onward.

const BAR_COLOR = 'var(--series-1)';

export function HistoricalStats({
  meta, sales,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
}) {
  const perSeason = useMemo(() => auctionsPerSeason(meta), [meta]);
  const shares = useMemo(() => auctioneerSharesBySeason(meta), [meta]);
  const matrix = useMemo(() => auctioneerSeasonMatrix(meta), [meta]);

  // Below 640px the wide auctioneer×season grid becomes a per-auctioneer list
  // (see the panel below), so we prep it here: each row keeps only the seasons
  // it actually ran, and the single-auction runners (career total of 1, the
  // same people the pie folds into "Single Auction Runners") split off to sit
  // behind a toggle rather than tail the list with a dozen one-cell rows.
  const narrow = useMediaQuery(NARROW);
  const [showRunners, setShowRunners] = useState(false);
  const listRows = useMemo(() => matrix.rows.map((r) => ({
    auctioneer: r.auctioneer,
    total: r.total,
    seasons: r.counts
      .map((c, i) => ({ season: matrix.seasons[i], count: c }))
      .filter((x): x is { season: string; count: number } => x.count != null),
  })), [matrix]);
  const mainRows = listRows.filter((r) => r.total !== 1);
  const singleRunners = listRows.filter((r) => r.total === 1);

  // The price-history picker lists only the auction tokens. Onyx chase tokens
  // are deliberately excluded: they carry exactly one season of data apiece, so
  // "price over time" has no trend to show for them.
  const mainItems = useMemo(() => historyItems(sales), [sales]);

  const [item, setItem] = useState<string>('');
  const chosen = item || mainItems[0] || '';
  const history = useMemo(
    () => (chosen ? itemPriceHistory(sales, chosen) : []),
    [sales, chosen],
  );

  const maxClosed = Math.max(...perSeason.map((s) => s.closed), 0);

  return (
    <>
      {/* --- Item price over time --- */}
      <section className="an-panel">
        <h2>Token price over time</h2>
        <p className="an-lede">
          Average sale price per season for one token, across every season it sold in. Tokens are
          listed by their <strong>canonical</strong> name, which stays put even when the public
          name changes year to year — the tooltip shows the name it carried that season. The shaded
          band behind the line is that season's full min–max range.
        </p>

        <label className="an-picker">
          Token
          <select value={chosen} onChange={(e) => setItem(e.target.value)}>
            {mainItems.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>

        {history.length === 1 && (
          <p className="an-note">
            {chosen} sold in only one season ({history[0].season}), so there is no trend to plot —
            the point below is that season's average.
          </p>
        )}
        <AreaChart
          points={history} label={chosen}
          nameFor={(season) => displayNameIn(sales, chosen, season)}
        />
      </section>

      {/* --- Auctions per season --- */}
      <section className="an-panel">
        <h2>Auctions per season</h2>
        <p className="an-lede">
          Closed auctions in each season, and how many different people ran them.
        </p>
        <div className="an-split">
          <table className={`an-table an-narrow${perSeason.length >= 4 ? ' banded' : ''}`}>
            <thead>
              <tr><th className="left">Season</th><th className="num">Auctions</th><th className="num">Auctioneers</th></tr>
            </thead>
            <tbody>
              {perSeason.map((s) => (
                <tr key={s.season}>
                  <td className="left">{s.season}</td>
                  <td className="num">{s.closed}</td>
                  <td className="num">{s.auctioneers}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="left">Total</th>
                <th className="num">{perSeason.reduce((a, s) => a + s.closed, 0)}</th>
                <th className="num" />
              </tr>
            </tfoot>
          </table>

          <div className="an-chartcol">
            <BarChart
              categories={perSeason.map((s) => s.season)}
              series={[{ label: 'Closed auctions', color: BAR_COLOR, values: perSeason.map((s) => s.closed) }]}
              hints={perSeason.map((s) => `${s.auctioneers} auctioneer${s.auctioneers === 1 ? '' : 's'}`)}
              yLabel="Auctions" format={(n) => String(Math.round(n))}
              ariaLabel={`Closed auctions per season, from ${perSeason[0]?.season} to ${perSeason[perSeason.length - 1]?.season}, peaking at ${maxClosed}`}
              maxLabels={12}
            />
          </div>
        </div>
      </section>

      {/* --- Auctioneer share, one pie per season --- */}
      <section className="an-panel">
        <h2>Share of auctions by auctioneer</h2>
        <p className="an-lede">
          One chart per season, newest first. Everyone who ran a single auction that season is
          grouped as <em>Single Auction Runners</em> — hover the wedge or its legend entry for the
          names.
        </p>
        <div className="an-pies">
          {shares.map((s) => (
            <PieChart
              key={s.season} title={s.season}
              slices={s.slices.map((x) => ({
                label: x.auctioneer, count: x.count, share: x.share, members: x.members,
              }))}
            />
          ))}
        </div>
      </section>

      {/* --- Auctioneer x season matrix --- */}
      <section className="an-panel">
        <h2>Auctions by auctioneer and season</h2>
        <p className="an-lede">
          Every auctioneer on record, ordered by career total{narrow
            ? ', with the seasons they ran.'
            : '. A dash means they ran nothing that season.'}
        </p>
        {narrow ? (
          // Below 640px the 8-season grid becomes one row per auctioneer: name,
          // career total, and only the seasons they ran — no sideways scroll and
          // no grid of dashes. The single-auction runners fold behind a toggle.
          <>
            <ul className="an-alist">
              {mainRows.map((r) => (
                <li key={r.auctioneer} className="an-arow">
                  <div className="an-atop">
                    <span className="an-aname">{r.auctioneer}</span>
                    <span className="an-atotal"><strong>{r.total}</strong> total</span>
                  </div>
                  <div className="an-ayears">
                    {r.seasons.map((s) => (
                      <span key={s.season} className="an-ychip">’{s.season.slice(-2)} ×{s.count}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {singleRunners.length > 0 && (
              <>
                <button type="button" className="an-fold" aria-expanded={showRunners}
                  onClick={() => setShowRunners((v) => !v)}>
                  {showRunners ? 'Hide' : 'Show'} single-auction runners ({singleRunners.length})
                </button>
                {showRunners && (
                  <ul className="an-alist an-runners">
                    {singleRunners.map((r) => (
                      <li key={r.auctioneer} className="an-arow">
                        <div className="an-atop">
                          <span className="an-aname">{r.auctioneer}</span>
                          <span className="an-atotal">{r.seasons.map((s) => `’${s.season.slice(-2)}`).join(', ')}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        ) : (
          <div className="an-scroll">
            <table className={`an-table an-matrix${matrix.rows.length >= 4 ? ' banded' : ''}`}>
              <thead>
                <tr>
                  <th className="left">Auctioneer</th>
                  {matrix.seasons.map((s) => <th key={s} className="num">{s}</th>)}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((r) => (
                  <tr key={r.auctioneer}>
                    <td className="left">{r.auctioneer}</td>
                    {r.counts.map((c, i) => (
                      <td key={matrix.seasons[i]} className={`num${c == null ? ' muted' : ''}`}>{c ?? '—'}</td>
                    ))}
                    <td className="num strong">{r.total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="left">Total</th>
                  {matrix.seasons.map((s, i) => (
                    <th key={s} className="num">
                      {matrix.rows.reduce((a, r) => a + (r.counts[i] ?? 0), 0)}
                    </th>
                  ))}
                  <th className="num">{matrix.rows.reduce((a, r) => a + r.total, 0)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
