import { useMemo, useState } from 'react';
import type { AuctionMeta, Sale, GroupRow } from '../lib/data';
import type { ContextItem, AuctionContext } from '../lib/context';
import {
  auctionLedger, ledgerOverall,
  grunnelPerAuction, augmentedVsNot,
  sourceOverlapSeasons, trentVsForumSeason,
  type LedgerRow, type GrunnelAuctionRow, type SourceTokenRow,
} from '../lib/contextAnalytics';
import { ERAS } from '../lib/eras';
import { money, money0 } from '../lib/format';
import { BarChart } from './BarChart';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';

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
  meta, sales, contextItems, auctionContext, groupRows,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
  contextItems: ContextItem[];
  auctionContext: Map<string, AuctionContext>;
  groupRows: GroupRow[];
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
        <SourceView meta={meta} sales={sales} groupRows={groupRows} />
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

// One auction as a stacked card (mobile) — the wide ledger table can't fit a
// phone, so each auction's figures sit in a small card instead of a scrolling row.
function LedgerCard({ r }: { r: LedgerRow }) {
  const fig = (label: string, val: string, cls = '') => (
    <div className="led-fig">
      <span className="led-fig-label">{label}</span>
      <span className={`led-fig-val ${cls}`}>{val}</span>
    </div>
  );
  return (
    <div className="led-card">
      <div className="led-card-head">
        <span className="led-name">{r.name || `#${r.auctionNumber}`}</span>
        <span className="led-sub">{r.season} · #{r.auctionNumber} · {r.auctioneer}</span>
      </div>
      <div className="led-figs">
        {fig('Withheld', r.withheld ? money0(r.withheld) : '—', 'neg')}
        {fig('Included', r.released ? money0(r.released) : '—')}
        {fig('Augments', r.augment ? money0(r.augment) : '—')}
        {fig('Grunnel', r.grunnel ? money0(r.grunnel) : '—', 'muted')}
        {fig('Funding goal', r.fundingGoal == null ? 'n/a' : money0(r.fundingGoal))}
      </div>
      <div className="led-balance-row">
        <span className="led-fig-label">Balance</span>
        {/* up=red, down=green in this theme; a covered (≥0) balance reads green. */}
        <span className={`led-balance-val diff ${r.balance >= 0 ? 'down' : 'up'}`}>{money0(r.balance)}</span>
        {coveredBadge(r.covered)}
      </div>
    </div>
  );
}

function LedgerView({
  meta, auctionContext,
}: {
  meta: AuctionMeta[];
  auctionContext: Map<string, AuctionContext>;
}) {
  const narrow = useMediaQuery(NARROW);
  const rows = useMemo(() => auctionLedger(meta, auctionContext), [meta, auctionContext]);
  const overall = useMemo(() => ledgerOverall(rows), [rows]);

  return (
    <section className="an-panel">
      <h2>Auction ledger — did augments cover withholdings?</h2>
      <p className="an-lede">
        {narrow ? (
          <>Per auction: what the auctioneer <strong>withheld</strong> (estimated, negative) vs what
          they put back — bonuses <strong>included</strong> and personal <strong>augments</strong>. A{' '}
          <strong>Balance</strong> ≥ 0 means they covered it.</>
        ) : (
          <>For each auction with context, what the auctioneer <strong>withheld</strong> (an estimate,
          negative) against what they put back: bonus items <strong>included</strong> and personal{' '}
          <strong>augments</strong>. <strong>Balance</strong> = included + augments − withheld, and a
          row is covered (green) when it is ≥ 0. <strong>Grunnel</strong> (a company drop) and the{' '}
          <strong>funding goal</strong> are shown for context, not counted in the balance.</>
        )}
      </p>

      {narrow ? (
        <div className="led-cards">
          {rows.map((r) => <LedgerCard key={r.auctionId} r={r} />)}
        </div>
      ) : (
        <div className="an-scroll">
          <table className={`an-table led-table${rows.length >= 4 ? ' banded' : ''}`}>
            <thead>
              <tr>
                <th className="left">Auction</th>
                <th className="num">Withheld</th>
                <th className="num">Included</th>
                <th className="num">Augments</th>
                <th className="num">Grunnel</th>
                <th className="num">Funding goal</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.auctionId}>
                  <td className="left">
                    <span className="an-lname">{r.name || `#${r.auctionNumber}`}</span>
                    <span className="an-lsub">{r.season} · #{r.auctionNumber} · {r.auctioneer}</span>
                  </td>
                  <td className="num neg">{r.withheld ? money0(r.withheld) : '—'}</td>
                  <td className="num">{r.released ? money0(r.released) : '—'}</td>
                  <td className="num">{r.augment ? money0(r.augment) : '—'}</td>
                  <td className="num muted">{r.grunnel ? money0(r.grunnel) : '—'}</td>
                  <td className="num">{r.fundingGoal == null ? <span className="muted">n/a</span> : money0(r.fundingGoal)}</td>
                  <td className={`num diff ${r.balance >= 0 ? 'down' : 'up'}`}>{money0(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="left">Overall ({overall.n})</th>
                <th className="num">{money0(overall.withheld)}</th>
                <th className="num">{money0(overall.released)}</th>
                <th className="num">{money0(overall.augment)}</th>
                <th className="num">{money0(overall.grunnel)}</th>
                <th className="num" />
                <th className="num">{money0(overall.balance)}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

// --- View 2: Grunnel vs preorder -------------------------------------------

// One Grunnel auction as a stacked card (mobile) — mirrors the ledger card so the
// two per-auction views read alike and neither needs a sideways scroll.
function GrunnelCard({ r }: { r: GrunnelAuctionRow }) {
  return (
    <div className="led-card">
      <div className="led-card-head">
        <span className="led-name">{r.name || `#${r.auctionNumber}`}</span>
        <span className="led-sub">{r.season} · #{r.auctionNumber} · {r.items} item{r.items === 1 ? '' : 's'}</span>
      </div>
      <div className="led-figs">
        <div className="led-fig"><span className="led-fig-label">Grunnel</span><span className="led-fig-val">{money0(r.grunnelValue)}</span></div>
        <div className="led-fig"><span className="led-fig-label">Preorder</span><span className="led-fig-val muted">{r.preorderBenchmark == null ? '—' : money0(r.preorderBenchmark)}</span></div>
      </div>
      <div className="led-balance-row">
        <span className="led-fig-label">Beyond</span>
        <span className={`led-balance-val diff ${r.delta != null && r.delta >= 0 ? 'down' : 'up'}`}>
          {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : ''}${money0(r.delta)}`}
        </span>
      </div>
    </div>
  );
}

function GrunnelView({
  meta, sales, contextItems,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
  contextItems: ContextItem[];
}) {
  const narrow = useMediaQuery(NARROW);
  const rows = useMemo(
    () => grunnelPerAuction(contextItems, sales, meta),
    [contextItems, sales, meta],
  );
  // Oldest→newest for the chart, which reads left to right in time.
  const chartRows = useMemo(() => [...rows].reverse(), [rows]);

  if (!rows.length) {
    return (
      <section className="an-panel">
        <h2>Grunnel drops vs the preorder bonuses</h2>
        <p className="empty">No Grunnel drops recorded.</p>
      </section>
    );
  }

  return (
    <section className="an-panel">
      <h2>Grunnel drops vs the preorder bonuses</h2>
      <p className="an-lede">
        {narrow ? (
          <>Each auction's <strong>Grunnel</strong> drop against the <strong>preorder</strong> bonuses
          a standard order includes that season. <strong>Beyond</strong> &gt; 0 (green) means the drop
          was worth more than the expired preorder bonuses.</>
        ) : (
          <>Grunnel drops offset expired preorder bonuses. Per auction, the total{' '}
          <strong>Grunnel</strong> value sits against the <strong>preorder</strong> value a standard
          order includes that season (mean season price × fixed quantity — 32 Preorder Bonuses + 50
          Treasure Chips). <strong>Beyond</strong> = Grunnel − preorder; positive (green) means the
          drop subsidised the auction beyond what the preorder bonuses were worth.</>
        )}
      </p>

      {narrow ? (
        <div className="led-cards">
          {rows.map((r) => <GrunnelCard key={r.auctionId} r={r} />)}
        </div>
      ) : (
        <div className="an-scroll">
          <table className={`an-table gr-table${rows.length >= 4 ? ' banded' : ''}`}>
            <thead>
              <tr>
                <th className="left">Auction</th>
                <th className="num">Grunnel</th>
                <th className="num">Preorder</th>
                <th className="num">Beyond</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.auctionId}>
                  <td className="left">
                    <span className="an-lname">{r.name || `#${r.auctionNumber}`}</span>
                    <span className="an-lsub">{r.season} · #{r.auctionNumber} · {r.items} item{r.items === 1 ? '' : 's'}</span>
                  </td>
                  <td className="num">{money0(r.grunnelValue)}</td>
                  <td className="num muted">{r.preorderBenchmark == null ? '—' : money0(r.preorderBenchmark)}</td>
                  {/* up=red, down=green; a drop worth more than preorder (≥0) reads green. */}
                  <td className={`num diff ${r.delta != null && r.delta >= 0 ? 'down' : 'up'}`}>
                    {r.delta == null ? '—' : `${r.delta >= 0 ? '+' : ''}${money0(r.delta)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="gr-chart">
        <BarChart
          categories={chartRows.map((r) => `${r.season.slice(2)} #${r.auctionNumber}`)}
          series={[
            { label: 'Grunnel', color: GRUNNEL_COLOR, values: chartRows.map((r) => r.grunnelValue) },
            { label: 'Preorder bonuses', color: PREORDER_COLOR, values: chartRows.map((r) => r.preorderBenchmark) },
          ]}
          hints={chartRows.map((r) => r.name || `#${r.auctionNumber}`)}
          yLabel="Value" format={(n) => money0(n)}
          ariaLabel="Each auction's Grunnel value versus its season's preorder benchmark"
          maxLabels={22}
        />
      </div>
    </section>
  );
}

// --- View 3: Augmented vs non-augmented ------------------------------------

function AugmentedView({ meta, sales }: { meta: AuctionMeta[]; sales: Sale[] }) {
  const narrow = useMediaQuery(NARROW);
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

  return (
    <section className="an-panel">
      <h2>Augmented vs non-augmented prices</h2>
      <p className="an-lede">
        {narrow ? (
          <>Each token's average price in <strong>augmented</strong> auctions vs{' '}
          <strong>non-augmented</strong> ones, same season. Only tokens sold in both appear.</>
        ) : (
          <>Does adding supply to an auction depress its prices, or draw more bidders? For one
          season, each token's average price in <strong>augmented</strong> auctions sits beside its
          average in <strong>non-augmented</strong> ones. Only tokens sold in <em>both</em> appear, so
          the comparison holds the token constant rather than reflecting which tokens each group
          happened to contain.</>
        )}
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
            <div className="an-scroll">
              <table className={`an-table an-auto${result.rows.length >= 4 ? ' banded' : ''}`}>
                <thead>
                  <tr>
                    <th className="left">Token</th>
                    {!narrow && <th className="left">Category</th>}
                    <th className="num">Augmented</th>
                    <th className="num">Non-augmented</th>
                    <th className="num">Δ</th>
                    {!narrow && <th className="num">Δ %</th>}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.item}>
                      <td className="left">
                        {r.displayName}
                        {/* On mobile the Category column is dropped; show it as subtext instead. */}
                        {narrow && r.category && <span className="an-lsub">{r.category}</span>}
                      </td>
                      {!narrow && <td className="left muted">{r.category}</td>}
                      <td className="num">{money(r.augAvg)}</td>
                      <td className="num">{money(r.nonAugAvg)}</td>
                      <td className={`num diff ${r.delta >= 0 ? 'up' : 'down'}`}>{money(r.delta)}</td>
                      {!narrow && (
                        <td className={`num diff ${r.delta >= 0 ? 'up' : 'down'}`}>
                          {r.pct == null ? '—' : `${r.pct >= 0 ? '+' : ''}${(r.pct * 100).toFixed(0)}%`}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// --- View 4: Trent vs Forum ------------------------------------------------

const REWARD_PCT = Math.round(ERAS.trentRewardRate * 100);

// A token group for the per-group charts, built by folding the season's matched
// tokens onto the Timelines grouping (tokenGroups.csv). Tokens outside any group
// fall into "Other tokens", sorted last, so nothing is silently dropped.
type SourceChartGroup = { group: string; order: number; category: string; rows: SourceTokenRow[] };

function groupForCharts(rows: SourceTokenRow[], groupRows: GroupRow[]): SourceChartGroup[] {
  const meta = new Map<string, { group: string; order: number; category: string }>();
  for (const g of groupRows) if (!meta.has(g.item)) meta.set(g.item, { group: g.group, order: g.groupOrder, category: g.category });

  const OTHER = 'Other tokens';
  const byGroup = new Map<string, SourceChartGroup>();
  for (const r of rows) {
    const gm = meta.get(r.item);
    const group = gm?.group ?? OTHER;
    let cg = byGroup.get(group);
    if (!cg) {
      cg = { group, order: gm?.order ?? Number.MAX_SAFE_INTEGER, category: gm?.category ?? r.category, rows: [] };
      byGroup.set(group, cg);
    }
    if (gm) cg.order = Math.min(cg.order, gm.order);
    cg.rows.push(r);
  }
  return [...byGroup.values()].sort((a, b) => a.order - b.order || a.group.localeCompare(b.group));
}

type Pricing = 'adjusted' | 'nominal';

function SourceView({
  meta, sales, groupRows,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
  groupRows: GroupRow[];
}) {
  const narrow = useMediaQuery(NARROW);
  const seasons = useMemo(() => sourceOverlapSeasons(sales, meta), [sales, meta]);
  const [picked, setPicked] = useState('');
  const season = picked && seasons.includes(picked) ? picked : (seasons[0] ?? '');
  const [pricing, setPricing] = useState<Pricing>('adjusted');

  const rows = useMemo(
    () => (season ? trentVsForumSeason(sales, meta, season) : []),
    [sales, meta, season],
  );
  const chartGroups = useMemo(() => groupForCharts(rows, groupRows), [rows, groupRows]);

  // The Trent price the reader sees: reward-adjusted (−10%) or nominal.
  const adjusted = pricing === 'adjusted';
  const trentOf = (r: SourceTokenRow) => (adjusted ? r.trentAvg * (1 - ERAS.trentRewardRate) : r.trentAvg);
  const trentLabel = adjusted ? `Trent (−${REWARD_PCT}%)` : 'Trent';

  if (!seasons.length) {
    return (
      <section className="an-panel">
        <h2>Trent vs Forum prices</h2>
        <p className="empty">No token sold under both sources in any season.</p>
      </section>
    );
  }

  return (
    <section className="an-panel">
      <h2>Trent vs Forum prices</h2>
      <p className="an-lede">
        {narrow ? (
          <>Per token, its <strong>Forum</strong> vs <strong>Trent</strong> average price in one
          season — tokens sold under both only.</>
        ) : (
          <>For one season, each token that sold under <strong>both</strong> sources shows its Forum
          average beside its Trent average — matched per token, so neither token mix nor time skews
          the comparison. Trent can be shown nominal or <strong>reward-adjusted</strong> (−{REWARD_PCT}%,
          the ~100 pt/$1 reward that lowers a Trent buyer's effective cost).</>
        )}
      </p>
      <p className="confound-note">
        Trent auctions exist only from season {ERAS.trentStartSeason} on, so only seasons both sources
        ran appear{narrow ? '.' : ' — comparing all-time would confound source with time.'}
      </p>

      <div className="an-controls">
        <label className="an-picker">
          Season
          <select value={season} onChange={(e) => setPicked(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="an-picker">
          Trent pricing
          <select value={pricing} onChange={(e) => setPricing(e.target.value as Pricing)}>
            <option value="adjusted">Reward-adjusted (−{REWARD_PCT}%)</option>
            <option value="nominal">Nominal</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No token sold under both sources in {season}.</p>
      ) : (
        <>
          <div className="an-scroll">
            <table className={`an-table an-auto${rows.length >= 4 ? ' banded' : ''}`}>
              <thead>
                <tr>
                  <th className="left">Token</th>
                  {!narrow && <th className="left">Category</th>}
                  <th className="num">Forum</th>
                  <th className="num">{trentLabel}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item}>
                    <td className="left">
                      {r.displayName}
                      {narrow && r.category && <span className="an-lsub">{r.category}</span>}
                    </td>
                    {!narrow && <td className="left muted">{r.category}</td>}
                    <td className="num">{money(r.forumAvg)}</td>
                    <td className="num">{money(trentOf(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* One grouped-bar chart per Timelines token group, ordered by Group Order. */}
          <div className="src-charts">
            {chartGroups.map((cg) => (
              <div key={cg.group} className="src-chart">
                <h3 className="an-subhead" data-category={cg.category}>{cg.group}</h3>
                <BarChart
                  categories={cg.rows.map((r) => r.displayName)}
                  series={[
                    { label: 'Forum', color: FORUM_COLOR, values: cg.rows.map((r) => r.forumAvg) },
                    { label: trentLabel, color: TRENT_COLOR, values: cg.rows.map((r) => trentOf(r)) },
                  ]}
                  yLabel="Avg price" format={(n) => money0(n)}
                  ariaLabel={`Forum versus ${adjusted ? 'reward-adjusted ' : ''}Trent average price for ${cg.group} tokens in ${season}`}
                  maxLabels={12}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
