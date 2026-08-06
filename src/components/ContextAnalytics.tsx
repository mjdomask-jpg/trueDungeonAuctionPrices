import { useMemo, useState } from 'react';
import type { AuctionMeta, Sale } from '../lib/data';
import type { ContextItem, AuctionContext } from '../lib/context';
import {
  auctionLedger, ledgerByAuctioneer, ledgerOverall,
  grunnelVsPreorder, augmentedVsNot, trentVsForum,
  type LedgerAgg,
} from '../lib/contextAnalytics';
import { ERAS } from '../lib/eras';
import { money, money0 } from '../lib/format';
import { BarChart } from './BarChart';

// The context-layer analytics (docs/context-layer-design.md §6), the fourth
// increment of the layer. Four questions behind one picker, so the top-level
// Analytics toggle gains a single "Funding & Context" view rather than four more
// buttons. Each analysis is a pure function in lib/contextAnalytics; this file is
// presentation only.
//
// These views deliberately do NOT read the shared FilterBar: they are intrinsic
// comparisons (augmented vs not, Trent vs Forum), so a Source/type filter would
// hide the very halves being compared. They compute their own splits.

type Analysis = 'ledger' | 'grunnel' | 'augmented' | 'source';

const ANALYSES: { key: Analysis; label: string }[] = [
  { key: 'ledger', label: 'Auction ledger — did augments cover withholdings?' },
  { key: 'grunnel', label: 'Grunnel drops vs the preorder benchmark' },
  { key: 'augmented', label: 'Augmented vs non-augmented prices' },
  { key: 'source', label: 'Trent vs Forum prices' },
];

const GRUNNEL_COLOR = 'var(--series-1)';
const PREORDER_COLOR = 'var(--series-2)';
const FORUM_COLOR = 'var(--series-1)';
const TRENT_COLOR = 'var(--series-2)';

export function ContextAnalytics({
  meta, sales, contextItems, auctionContext,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
  contextItems: ContextItem[];
  auctionContext: Map<string, AuctionContext>;
}) {
  const [analysis, setAnalysis] = useState<Analysis>('ledger');

  const hasContext = contextItems.length > 0;

  return (
    <>
      <label className="an-picker">
        Analysis
        <select value={analysis} onChange={(e) => setAnalysis(e.target.value as Analysis)}>
          {ANALYSES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
      </label>

      {!hasContext && (
        <p className="empty">
          No auction context loaded. Add <code>public/data/contextItems.csv</code> to populate
          these analyses.
        </p>
      )}

      {hasContext && analysis === 'ledger' && (
        <LedgerView meta={meta} auctionContext={auctionContext} />
      )}
      {hasContext && analysis === 'grunnel' && (
        <GrunnelView meta={meta} sales={sales} contextItems={contextItems} />
      )}
      {hasContext && analysis === 'augmented' && (
        <AugmentedView meta={meta} sales={sales} />
      )}
      {hasContext && analysis === 'source' && (
        <SourceView meta={meta} sales={sales} />
      )}
    </>
  );
}

// --- View 1: Auction Ledger ------------------------------------------------

function coveredBadge(covered: boolean) {
  return (
    <span className={`an-verdict ${covered ? 'yes' : 'no'}`}>
      {covered ? 'Covered' : 'Short'}
    </span>
  );
}

function LedgerView({
  meta, auctionContext,
}: {
  meta: AuctionMeta[];
  auctionContext: Map<string, AuctionContext>;
}) {
  const rows = useMemo(() => auctionLedger(meta, auctionContext), [meta, auctionContext]);
  const byWho = useMemo(() => ledgerByAuctioneer(rows), [rows]);
  const overall = useMemo(() => ledgerOverall(rows), [rows]);
  const anyAssumed = rows.some((r) => r.assumedTarget);

  const aggCells = (a: LedgerAgg) => (
    <>
      <td className="num">{a.n}</td>
      <td className="num neg">{money0(a.withheld)}</td>
      <td className="num">{money0(a.released)}</td>
      <td className="num">{money0(a.augment)}</td>
      <td className="num">{money0(a.targetReduction)}</td>
      <td className="num muted">{money0(a.grunnel)}</td>
      {/* up=red, down=green in this theme; covered (≥0) reads green. */}
      <td className={`num diff ${a.coverage >= 0 ? 'down' : 'up'}`}>{money0(a.coverage)}</td>
      <td className="num">{coveredBadge(a.covered)}</td>
    </>
  );

  return (
    <section className="an-panel">
      <h2>Auction ledger — did augments cover withholdings?</h2>
      <p className="an-lede">
        For each auction with context, what the auctioneer <strong>withheld</strong> (an estimate,
        negative) against what they put back: <strong>released</strong> payment, personal{' '}
        <strong>augments</strong>, and the <strong>funding-target reduction</strong> (how far below
        the ${ERAS.orderCost.toLocaleString()} order goal they set the target). <em>Coverage</em> is
        released + augments + target reduction − withheld; a row is <strong>Covered</strong> when
        that is ≥ 0. <strong>Grunnel</strong> drops are shown but not counted — they come from the
        company, not the auctioneer offsetting their own withholding.
      </p>
      {anyAssumed && (
        <p className="an-note">
          Auctions with no recorded funding target contribute $0 target reduction here (never the
          assumed ${ERAS.defaultTargetFunding.toLocaleString()} default), so coverage is not
          fabricated for them.
        </p>
      )}

      <h3 className="an-subhead">By auctioneer</h3>
      <div className="an-scroll">
        <table className={`an-table an-wide${byWho.length >= 4 ? ' banded' : ''}`}>
          <thead>
            <tr>
              <th className="left">Auctioneer</th>
              <th className="num">Auctions</th>
              <th className="num">Withheld</th>
              <th className="num">Released</th>
              <th className="num">Augments</th>
              <th className="num">Target ↓</th>
              <th className="num">Grunnel</th>
              <th className="num">Coverage</th>
              <th className="num">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {byWho.map((a) => (
              <tr key={a.key}>
                <td className="left">{a.key}</td>
                {aggCells(a)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="left">Overall</th>
              <th className="num">{overall.n}</th>
              <th className="num">{money0(overall.withheld)}</th>
              <th className="num">{money0(overall.released)}</th>
              <th className="num">{money0(overall.augment)}</th>
              <th className="num">{money0(overall.targetReduction)}</th>
              <th className="num">{money0(overall.grunnel)}</th>
              <th className="num">{money0(overall.coverage)}</th>
              <th className="num">{coveredBadge(overall.covered)}</th>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="an-subhead">Every auction, newest first</h3>
      <div className="an-scroll">
        <table className={`an-table an-wide${rows.length >= 4 ? ' banded' : ''}`}>
          <thead>
            <tr>
              <th className="left">Auction</th>
              <th className="left">Auctioneer</th>
              <th className="num">Withheld</th>
              <th className="num">Released</th>
              <th className="num">Augments</th>
              <th className="num">Target ↓</th>
              <th className="num">Grunnel</th>
              <th className="num">Coverage</th>
              <th className="num">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.auctionId}>
                <td className="left">
                  <span className="an-lname">{r.name || `#${r.auctionNumber}`}</span>
                  <span className="an-lsub">{r.season} · #{r.auctionNumber} · {r.source}</span>
                </td>
                <td className="left">{r.auctioneer}</td>
                <td className="num neg">{r.withheld ? money0(r.withheld) : '—'}</td>
                <td className="num">{r.released ? money0(r.released) : '—'}</td>
                <td className="num">{r.augment ? money0(r.augment) : '—'}</td>
                <td className="num">
                  {r.targetReduction == null ? <span className="muted">n/a</span> : money0(r.targetReduction)}
                </td>
                <td className="num muted">{r.grunnel ? money0(r.grunnel) : '—'}</td>
                <td className={`num diff ${r.coverage >= 0 ? 'down' : 'up'}`}>{money0(r.coverage)}</td>
                <td className="num">{coveredBadge(r.covered)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --- View 2: Grunnel vs preorder -------------------------------------------

function GrunnelView({
  meta, sales, contextItems,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
  contextItems: ContextItem[];
}) {
  const rows = useMemo(
    () => grunnelVsPreorder(sales, contextItems, meta),
    [sales, contextItems, meta],
  );
  const withGrunnel = rows.filter((r) => r.grunnelN > 0);

  return (
    <section className="an-panel">
      <h2>Grunnel drops vs the preorder benchmark</h2>
      <p className="an-lede">
        Grunnel items are dropped in to offset expired <strong>preorder</strong> bonuses, so the
        mean preorder-token sale price that season is the natural yardstick. Each season's mean
        Grunnel item value sits beside its mean preorder value — Grunnel drops run far richer than
        the roughly break-even preorder token.
      </p>

      {withGrunnel.length > 0 ? (
        <div className="an-split">
          <table className={`an-table an-narrow${withGrunnel.length >= 4 ? ' banded' : ''}`}>
            <thead>
              <tr>
                <th className="left">Season</th>
                <th className="num">Grunnel avg</th>
                <th className="num">n</th>
                <th className="num">Preorder avg</th>
                <th className="num">n</th>
              </tr>
            </thead>
            <tbody>
              {withGrunnel.map((r) => (
                <tr key={r.season}>
                  <td className="left">{r.season}</td>
                  <td className="num">{money(r.grunnelMean ?? undefined)}</td>
                  <td className="num muted">{r.grunnelN}</td>
                  <td className="num">{money(r.preorderMean ?? undefined)}</td>
                  <td className="num muted">{r.preorderN || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="an-chartcol">
            <BarChart
              categories={withGrunnel.map((r) => r.season)}
              series={[
                { label: 'Grunnel avg', color: GRUNNEL_COLOR, values: withGrunnel.map((r) => r.grunnelMean) },
                { label: 'Preorder avg', color: PREORDER_COLOR, values: withGrunnel.map((r) => r.preorderMean) },
              ]}
              hints={withGrunnel.map((r) => `${r.grunnelN} grunnel · ${r.preorderN} preorder`)}
              yLabel="Avg value" format={(n) => money0(n)}
              ariaLabel="Mean Grunnel item value versus mean preorder token value, per season"
              maxLabels={12}
            />
          </div>
        </div>
      ) : (
        <p className="empty">No Grunnel items recorded.</p>
      )}
    </section>
  );
}

// --- View 3: Augmented vs non-augmented ------------------------------------

function AugmentedView({ meta, sales }: { meta: AuctionMeta[]; sales: Sale[] }) {
  // Seasons that actually have augmented auctions — the only ones with a
  // comparison to draw. Newest first.
  const augSeasons = useMemo(() => {
    const s = new Set<string>();
    for (const m of meta) if (m.augmented === true) s.add(m.season);
    return [...s].sort((a, b) => Number(b) - Number(a));
  }, [meta]);

  const [picked, setPicked] = useState('');
  const season = picked && augSeasons.includes(picked) ? picked : (augSeasons[0] ?? '');
  const result = useMemo(
    () => (season ? augmentedVsNot(sales, meta, season) : null),
    [sales, meta, season],
  );

  if (!augSeasons.length) {
    return (
      <section className="an-panel">
        <h2>Augmented vs non-augmented prices</h2>
        <p className="empty">No season has any augmented auctions to compare.</p>
      </section>
    );
  }

  const summaryDelta = result && result.augMean != null && result.nonAugMean != null
    ? result.augMean - result.nonAugMean : null;

  return (
    <section className="an-panel">
      <h2>Augmented vs non-augmented prices</h2>
      <p className="an-lede">
        Does adding supply to an auction depress its prices, or draw more bidders? For one season,
        each token's average price in <strong>augmented</strong> auctions sits beside its average in{' '}
        <strong>non-augmented</strong> ones. Only tokens sold in <em>both</em> appear, so the
        comparison holds the token constant rather than reflecting which tokens each group happened
        to contain.
      </p>

      <label className="an-picker">
        Season
        <select value={season} onChange={(e) => setPicked(e.target.value)}>
          {augSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {result && (
        <>
          <p className="confound-note">
            {result.season}: {result.augAuctions} augmented vs {result.nonAugAuctions} non-augmented
            auction{result.nonAugAuctions === 1 ? '' : 's'}, {result.rows.length} token
            {result.rows.length === 1 ? '' : 's'} sold in both. Augmented auctions cluster in recent
            seasons, so read this within the season, not as an all-time effect.
          </p>

          {result.rows.length === 0 ? (
            <p className="empty">No token sold in both an augmented and a non-augmented auction this season.</p>
          ) : (
            <>
              {summaryDelta != null && (
                <p className="an-note">
                  Across the {result.rows.length} matched token{result.rows.length === 1 ? '' : 's'},
                  the mean price was <strong>{money(result.augMean ?? undefined)}</strong> in augmented
                  auctions vs <strong>{money(result.nonAugMean ?? undefined)}</strong> in
                  non-augmented — a {summaryDelta >= 0 ? 'premium' : 'discount'} of{' '}
                  {money(Math.abs(summaryDelta))}.
                </p>
              )}
              <div className="an-scroll">
                <table className={`an-table an-wide${result.rows.length >= 4 ? ' banded' : ''}`}>
                  <thead>
                    <tr>
                      <th className="left">Token</th>
                      <th className="left">Category</th>
                      <th className="num">Augmented</th>
                      <th className="num">Non-augmented</th>
                      <th className="num">Δ</th>
                      <th className="num">Δ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.item}>
                        <td className="left">{r.displayName}</td>
                        <td className="left muted">{r.category}</td>
                        <td className="num">{money(r.augAvg)}</td>
                        <td className="num">{money(r.nonAugAvg)}</td>
                        <td className={`num diff ${r.delta >= 0 ? 'up' : 'down'}`}>{money(r.delta)}</td>
                        <td className={`num diff ${r.delta >= 0 ? 'up' : 'down'}`}>
                          {r.pct == null ? '—' : `${r.pct >= 0 ? '+' : ''}${(r.pct * 100).toFixed(0)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

// --- View 4: Trent vs Forum ------------------------------------------------

function SourceView({ meta, sales }: { meta: AuctionMeta[]; sales: Sale[] }) {
  const rows = useMemo(() => trentVsForum(sales, meta), [sales, meta]);

  return (
    <section className="an-panel">
      <h2>Trent vs Forum prices</h2>
      <p className="an-lede">
        Where a token sold under <strong>both</strong> sources in a season, its Forum average sits
        beside its Trent average — matched per token so token mix doesn't skew the comparison. Trent
        is shown nominal and <strong>reward-adjusted</strong> (−{Math.round(ERAS.trentRewardRate * 100)}%,
        the ~100 pt/$1 reward that lowers a Trent buyer's effective cost).
      </p>
      <p className="confound-note">
        Trent auctions exist only from season {ERAS.trentStartSeason} on, so this is restricted to
        seasons both sources ran — comparing all-time would confound source with time.
      </p>

      {rows.length > 0 ? (
        <div className="an-split">
          <table className={`an-table an-narrow${rows.length >= 4 ? ' banded' : ''}`}>
            <thead>
              <tr>
                <th className="left">Season</th>
                <th className="num">Tokens</th>
                <th className="num">Forum</th>
                <th className="num">Trent</th>
                <th className="num">Trent −{Math.round(ERAS.trentRewardRate * 100)}%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.season}>
                  <td className="left">{r.season}</td>
                  <td className="num muted">{r.n}</td>
                  <td className="num">{money(r.forumMean)}</td>
                  <td className="num">{money(r.trentMean)}</td>
                  <td className="num">{money(r.trentAdjMean)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="an-chartcol">
            <BarChart
              categories={rows.map((r) => r.season)}
              series={[
                { label: 'Forum', color: FORUM_COLOR, values: rows.map((r) => r.forumMean) },
                { label: 'Trent (−10%)', color: TRENT_COLOR, values: rows.map((r) => r.trentAdjMean) },
              ]}
              hints={rows.map((r) => `${r.n} matched tokens`)}
              yLabel="Avg price" format={(n) => money0(n)}
              ariaLabel="Mean matched-token price, Forum versus reward-adjusted Trent, per overlapping season"
              maxLabels={12}
            />
          </div>
        </div>
      ) : (
        <p className="empty">No token sold under both sources in any season.</p>
      )}
    </section>
  );
}
