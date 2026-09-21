import { useMemo, useState, type ReactNode } from 'react';
import { SOURCE_LABEL, type AuctionMeta, type AuctionSource, type Sale, type GroupRow } from '../lib/data';
import type { ContextItem, AuctionContext } from '../lib/context';
import {
  auctionLedger, ledgerBalanceOf, isCovered,
  grunnelPerAuction, augmentedVsNot,
  sourceOverlapSeasons, trentVsSourceSeason,
  orderVariantSeasons, standardVsTradeTwo,
  type LedgerRow, type GrunnelAuctionRow, type SourceTokenRow,
} from '../lib/contextAnalytics';
import { HintPopover } from './HintPopover';
import { ERAS, groupLabel } from '../lib/eras';
import { money, money0, moneyTight } from '../lib/format';
import { BarChart } from './BarChart';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';

// The context-layer analytics (docs/context-layer-design.md §6), the fourth
// increment of the layer. Several questions behind one picker, so the top-level
// Analytics toggle gains a single "Funding & Context" view rather than one button
// per analysis. Each is a pure function in lib/contextAnalytics; this file is
// presentation only.
//
// These views deliberately do NOT read the shared FilterBar: they are intrinsic
// comparisons (augmented vs not, one venue vs another, standard order vs Trade 2),
// so a Source/type filter would hide the very halves being compared. They compute
// their own splits, and each offers only the seasons where its split exists.

type Analysis = 'ledger' | 'grunnel' | 'augmented' | 'source' | 'variant';

const ANALYSES: { key: Analysis; label: string }[] = [
  { key: 'ledger', label: 'Auction ledger — did augments cover withholdings?' },
  { key: 'grunnel', label: 'Grunnel drops vs the preorder benchmark' },
  { key: 'augmented', label: 'Augmented vs non-augmented prices' },
  { key: 'source', label: 'Trent vs other venues — prices by source' },
  { key: 'variant', label: 'Standard vs Trade 2 order prices' },
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
      {hasContext && analysis === 'variant' && (
        <VariantView meta={meta} sales={sales} groupRows={groupRows} />
      )}
    </>
  );
}

// --- View 1: Auction Ledger ------------------------------------------------

// What "Included" actually names. Readers have asked, and the column heading
// cannot say it in the space it has. Kept beside the Balance help below so the
// two explanations of one table live together; the wording matches
// ProvenanceBadge's `released-payment` help, which is the same fact told to
// someone looking at a single row.
function IncludedHelp() {
  return (
    <HintPopover label="What Included means">
      Items the auctioneer would normally keep as payment for running the auction — the{' '}
      <strong>Golden Ticket</strong> chance and the <strong>Random Ultra Rares</strong> — sold to
      bidders instead.
    </HintPopover>
  );
}

// Why Grunnel is not in the balance by default. This was the real defect behind
// the "exclude Grunnel" request: the maths already excluded it, and nothing on
// the page said so.
function BalanceHelp() {
  return (
    <HintPopover label="How Balance is calculated">
      Included + augments − withheld. <strong>Grunnel is left out</strong>: it is a drop from a
      company employee, not the auctioneer offsetting their own withholding, so counting it would
      credit the auctioneer with someone else's money. That makes the default the answer to
      "would this auction have worked without help from the company?" — tick{' '}
      <em>Include Grunnel</em> to add it back. The funding goal is context and is never part of
      this sum.
    </HintPopover>
  );
}

function coveredBadge(covered: boolean) {
  return (
    <span className={`an-verdict ${covered ? 'yes' : 'no'}`}>
      {covered ? 'Covered' : 'Short'}
    </span>
  );
}

// One auction as a stacked card (mobile) — the wide ledger table can't fit a
// phone, so each auction's figures sit in a small card instead of a scrolling row.
function LedgerCard({ r, includeGrunnel }: { r: LedgerRow; includeGrunnel: boolean }) {
  const fig = (label: ReactNode, val: string, cls = '') => (
    <div className="led-fig">
      <span className="led-fig-label">{label}</span>
      <span className={`led-fig-val ${cls}`}>{val}</span>
    </div>
  );
  const balance = ledgerBalanceOf(r, includeGrunnel);
  const covered = isCovered(balance);
  return (
    <div className="led-card">
      <div className="led-card-head">
        <span className="led-name">{r.name || `#${r.auctionNumber}`}</span>
        <span className="led-sub">#{r.auctionNumber} · {r.auctioneer}</span>
      </div>
      <div className="led-figs">
        {fig('Funding goal', r.fundingGoal == null ? 'n/a' : money0(r.fundingGoal))}
        {fig('Withheld', r.withheld ? money0(r.withheld) : '—', 'neg')}
        {fig(<>Included <IncludedHelp /></>, r.released ? money0(r.released) : '—')}
        {fig('Augments', r.augment ? money0(r.augment) : '—')}
        {/* Not muted while it is IN the balance — a figure doing arithmetic
            should not look like a footnote. */}
        {fig('Grunnel', r.grunnel ? money0(r.grunnel) : '—', includeGrunnel ? '' : 'muted')}
      </div>
      <div className="led-balance-row">
        <span className="led-fig-label">Balance <BalanceHelp /></span>
        {/* up=red, down=green in this theme; a covered (≥0) balance reads green. */}
        <span className={`led-balance-val diff ${balance >= 0 ? 'down' : 'up'}`}>{money0(balance)}</span>
        {coveredBadge(covered)}
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
  // Off by default: the Grunnel-excluded balance is the one that answers "would
  // this have worked without the company's help", which is the question this
  // table gets asked. See ledgerBalanceOf.
  const [includeGrunnel, setIncludeGrunnel] = useState(false);
  const rows = useMemo(() => auctionLedger(meta, auctionContext), [meta, auctionContext]);
  // Grouped by season (newest first — rows are sorted season-desc). A season
  // selector shows one year at a time: the ledger is per-auction bookkeeping with
  // no cross-year story, so stacking every season just made a 40+ row page.
  const bySeason = useMemo(() => {
    const m = new Map<string, LedgerRow[]>();
    for (const r of rows) (m.get(r.season) ?? m.set(r.season, []).get(r.season))!.push(r);
    return [...m.entries()];
  }, [rows]);
  const seasons = useMemo(() => bySeason.map(([s]) => s), [bySeason]);

  const [picked, setPicked] = useState('');
  const season = picked && seasons.includes(picked) ? picked : (seasons[0] ?? '');
  const seasonRows = useMemo(
    () => bySeason.find(([s]) => s === season)?.[1] ?? [],
    [bySeason, season],
  );

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
          row is covered (green) when it is ≥ 0. <strong>Grunnel</strong> (a company drop) is shown
          for context and left out of the balance — so the default answers "would this auction have
          worked without help from the company?" — and the <strong>funding goal</strong> is never
          part of it.</>
        )}
      </p>

      <div className="an-controls">
        {seasons.length > 0 && (
          <label className="an-picker">
            Season
            <select value={season} onChange={(e) => setPicked(e.target.value)}>
              {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {/* Reuses the Prices page's checkbox furniture (.tenx-check) rather than
            inventing a second checkbox style for one control. */}
        <label className="tenx-check">
          <input
            type="checkbox"
            checked={includeGrunnel}
            onChange={(e) => setIncludeGrunnel(e.target.checked)}
          />
          Include Grunnel
          <HintPopover label="About including Grunnel">
            Adds the company's Grunnel drop into the <strong>Balance</strong>. Off by default,
            because a drop from a company employee is not the auctioneer offsetting their own
            withholding — leaving it out is what makes the balance say whether the auction stood
            up on its own.
          </HintPopover>
        </label>
      </div>

      {narrow ? (
        <div className="led-cards">
          {seasonRows.map((r) => (
            <LedgerCard key={r.auctionId} r={r} includeGrunnel={includeGrunnel} />
          ))}
        </div>
      ) : (
        <div className="an-scroll">
          <table className={`an-table led-table${seasonRows.length >= 4 ? ' banded' : ''}`}>
            <thead>
              <tr>
                <th className="left">Auction</th>
                <th className="num">Funding goal</th>
                <th className="num">Withheld</th>
                <th className="num">Included <IncludedHelp /></th>
                <th className="num">Augments</th>
                <th className="num">Grunnel</th>
                <th className="num">Balance <BalanceHelp /></th>
              </tr>
            </thead>
            <tbody>
              {seasonRows.map((r) => {
                const balance = ledgerBalanceOf(r, includeGrunnel);
                return (
                <tr key={r.auctionId}>
                  <td className="left">
                    <span className="an-lname">{r.name || `#${r.auctionNumber}`}</span>
                    <span className="an-lsub">#{r.auctionNumber} · {r.auctioneer}</span>
                  </td>
                  <td className="num">{r.fundingGoal == null ? <span className="muted">n/a</span> : money0(r.fundingGoal)}</td>
                  <td className="num neg">{r.withheld ? money0(r.withheld) : '—'}</td>
                  <td className="num">{r.released ? money0(r.released) : '—'}</td>
                  <td className="num">{r.augment ? money0(r.augment) : '—'}</td>
                  {/* Not muted while it is IN the balance — a figure doing
                      arithmetic should not look like a footnote. */}
                  <td className={`num${includeGrunnel ? '' : ' muted'}`}>{r.grunnel ? money0(r.grunnel) : '—'}</td>
                  <td className={`num diff ${balance >= 0 ? 'down' : 'up'}`}>{money0(balance)}</td>
                </tr>
                );
              })}
            </tbody>
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
        <span className="led-sub">#{r.auctionNumber} · {r.items} item{r.items === 1 ? '' : 's'}</span>
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
  // One table per season — mixing years in a single table made the per-season
  // preorder benchmark read as if it varied auction to auction. rows are already
  // sorted season-desc then auction-desc, so Map insertion order is season-desc.
  const bySeason = useMemo(() => {
    const m = new Map<string, GrunnelAuctionRow[]>();
    for (const r of rows) (m.get(r.season) ?? m.set(r.season, []).get(r.season))!.push(r);
    return [...m.entries()];
  }, [rows]);
  const seasons = useMemo(() => bySeason.map(([s]) => s), [bySeason]);

  // Grunnel's finding is a cross-year trend (drops grew in 2025–26), so it keeps
  // an "All years" default that stacks every season; the selector then focuses one
  // year when the stacked page is more than you want.
  const [picked, setPicked] = useState<'all' | string>('all');
  const sel = picked === 'all' || seasons.includes(picked) ? picked : 'all';
  const shown = sel === 'all' ? bySeason : bySeason.filter(([s]) => s === sel);

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

      {seasons.length > 0 && (
        <label className="an-picker">
          Season
          <select value={sel} onChange={(e) => setPicked(e.target.value)}>
            <option value="all">All years</option>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}

      {shown.map(([season, seasonRows]) => {
        // Oldest→newest within the season so the chart reads left to right in time.
        const chartRows = [...seasonRows].reverse();
        return (
        <div key={season} className="gr-season">
          {/* The season heading is only needed when several are stacked; a single
              selected year is already named by the picker. */}
          {sel === 'all' && <h3 className="an-subhead">{season}</h3>}
          {narrow ? (
            <div className="led-cards">
              {seasonRows.map((r) => <GrunnelCard key={r.auctionId} r={r} />)}
            </div>
          ) : (
            <div className="an-scroll">
              <table className={`an-table gr-table${seasonRows.length >= 4 ? ' banded' : ''}`}>
                <thead>
                  <tr>
                    <th className="left">Auction</th>
                    <th className="num">Grunnel</th>
                    <th className="num">Preorder</th>
                    <th className="num">Beyond</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonRows.map((r) => (
                    <tr key={r.auctionId}>
                      <td className="left">
                        <span className="an-lname">{r.name || `#${r.auctionNumber}`}</span>
                        <span className="an-lsub">#{r.auctionNumber} · {r.items} item{r.items === 1 ? '' : 's'}</span>
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
              categories={chartRows.map((r) => `#${r.auctionNumber}`)}
              series={[
                { label: 'Grunnel', color: GRUNNEL_COLOR, values: chartRows.map((r) => r.grunnelValue) },
                { label: 'Preorder bonuses', color: PREORDER_COLOR, values: chartRows.map((r) => r.preorderBenchmark) },
              ]}
              hints={chartRows.map((r) => r.name || `#${r.auctionNumber}`)}
              yLabel="Value" format={(n) => money0(n)}
              ariaLabel={`Each ${season} auction's Grunnel value versus the season's preorder benchmark`}
              maxLabels={22}
            />
          </div>
        </div>
        );
      })}
    </section>
  );
}

// --- View 3: Augmented vs non-augmented ------------------------------------

function AugmentedView({ meta, sales }: { meta: AuctionMeta[]; sales: Sale[] }) {
  const narrow = useMediaQuery(NARROW);
  // Full cents on desktop; the condensed standard (cents dropped at ≥$1,000) on
  // a phone, where the four columns must share ~335px.
  const price = (n: number) => (narrow ? moneyTight(n) : money(n));
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
                    {/* "Augmented" is a single unwrappable word; abbreviate both
                        on a phone so all four columns fit without a sideways
                        scroll (the analysis title above spells them out). */}
                    <th className="num">{narrow ? 'Aug.' : 'Augmented'}</th>
                    <th className="num">{narrow ? 'Non-aug.' : 'Non-augmented'}</th>
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
                      {/* Mobile drops cents at ≥$1,000 (moneyTight — the site's
                          condensed standard) to keep all four columns on screen. */}
                      <td className="num">{price(r.augAvg)}</td>
                      <td className="num">{price(r.nonAugAvg)}</td>
                      <td className={`num diff ${r.delta >= 0 ? 'up' : 'down'}`}>{price(r.delta)}</td>
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

// Prices in this analysis span cents (Trade goods) to hundreds (Premiums). A
// whole-dollar axis collapses the sub-$10 tokens to "$1"/"$0" — indistinguishable
// — so show cents whenever a value is under $10. Drives both the chart's y-axis
// tick labels and its tooltips (BarChart runs both through this one formatter).
const sourcePrice = (n: number) => (Math.abs(n) < 10 ? money(n) : money0(n));

// A token group for the per-group charts, built by folding the season's matched
// tokens onto the Timelines grouping (tokenGroups.csv). Tokens outside any group
// fall into "Other tokens", sorted last, so nothing is silently dropped.
// `group` is the stable CSV key (ordering, React key); `label` is its heading for
// this season, since a few groups are renamed year to year (see eras.groupLabel).
// Generic over the row type so the Standard-vs-Trade-2 view below can group its
// own rows the same way — the folding only ever reads `item` and `category`.
type TokenChartGroup<T> = { group: string; label: string; order: number; category: string; rows: T[] };

function groupForCharts<T extends { item: string; category: string }>(
  rows: T[], groupRows: GroupRow[], season: string,
): TokenChartGroup<T>[] {
  const meta = new Map<string, { group: string; order: number; category: string }>();
  for (const g of groupRows) if (!meta.has(g.item)) meta.set(g.item, { group: g.group, order: g.groupOrder, category: g.category });

  const OTHER = 'Other tokens';
  const byGroup = new Map<string, TokenChartGroup<T>>();
  for (const r of rows) {
    const gm = meta.get(r.item);
    const group = gm?.group ?? OTHER;
    let cg = byGroup.get(group);
    if (!cg) {
      cg = {
        group, label: groupLabel(group, season),
        order: gm?.order ?? Number.MAX_SAFE_INTEGER, category: gm?.category ?? r.category, rows: [],
      };
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
  const overlaps = useMemo(() => sourceOverlapSeasons(sales, meta), [sales, meta]);
  const seasons = useMemo(() => overlaps.map((o) => o.season), [overlaps]);
  const [picked, setPicked] = useState('');
  const season = picked && seasons.includes(picked) ? picked : (seasons[0] ?? '');
  const [pricing, setPricing] = useState<Pricing>('nominal');

  // Which venues this season can be compared against. Usually one (the forum);
  // in a season where Trent overlaps both the forum and alesievauctions.com the
  // reader picks. `pickedOther` is not reset on a season change — it is validated
  // against the season's own list instead, which falls back on its own.
  const others = useMemo(
    () => overlaps.find((o) => o.season === season)?.others ?? [],
    [overlaps, season],
  );
  const [pickedOther, setPickedOther] = useState<AuctionSource | ''>('');
  const other: AuctionSource | null =
    (pickedOther && others.includes(pickedOther) ? pickedOther : others[0]) ?? null;
  const otherLabel = other ? SOURCE_LABEL[other] : '';

  const rows = useMemo(
    () => (season && other ? trentVsSourceSeason(sales, meta, season, other) : []),
    [sales, meta, season, other],
  );
  const chartGroups = useMemo(() => groupForCharts(rows, groupRows, season), [rows, groupRows, season]);

  // The Trent price the reader sees: reward-adjusted (−10%) or nominal.
  const adjusted = pricing === 'adjusted';
  const trentOf = (r: SourceTokenRow) => (adjusted ? r.trentAvg * (1 - ERAS.trentRewardRate) : r.trentAvg);
  const trentLabel = adjusted ? `Trent (−${REWARD_PCT}%)` : 'Trent';
  const heading = other ? `Trent vs ${otherLabel} prices` : 'Trent vs other venues';

  if (!seasons.length) {
    return (
      <section className="an-panel">
        <h2>Trent vs other venues</h2>
        <p className="empty">No token sold under Trent and another venue in the same season.</p>
      </section>
    );
  }

  return (
    <section className="an-panel">
      <h2>{heading}</h2>
      <p className="an-lede">
        {narrow ? (
          <>Per token, its <strong>{otherLabel}</strong> vs <strong>Trent</strong> average price in
          one season — tokens sold under both only.</>
        ) : (
          <>For one season, each token that sold under <strong>both</strong> venues shows its
          {' '}{otherLabel} average beside its Trent average — matched per token, so neither token
          mix nor time skews the comparison. Trent can be shown nominal or
          {' '}<strong>reward-adjusted</strong> (−{REWARD_PCT}%, the ~100 pt/$1 reward that lowers a
          Trent buyer's effective cost).</>
        )}
      </p>
      <p className="confound-note">
        Trent auctions exist only from season {ERAS.trentStartSeason} on, and alesievauctions.com
        only from 2027, so only seasons both venues ran appear
        {narrow ? '.' : ' — comparing all-time would confound venue with time.'}
      </p>

      <div className="an-controls">
        <label className="an-picker">
          Season
          <select value={season} onChange={(e) => setPicked(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {/* Offered only where the season really has two venues to compare Trent
            against; with one there is nothing to choose and the heading says it. */}
        {others.length > 1 && (
          <label className="an-picker">
            Compare against
            <select value={other ?? ''} onChange={(e) => setPickedOther(e.target.value as AuctionSource)}>
              {others.map((o) => <option key={o} value={o}>{SOURCE_LABEL[o]}</option>)}
            </select>
          </label>
        )}
        <label className="an-picker">
          Trent pricing
          <select value={pricing} onChange={(e) => setPricing(e.target.value as Pricing)}>
            <option value="nominal">Nominal</option>
            <option value="adjusted">Reward-adjusted (−{REWARD_PCT}%)</option>
          </select>
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="empty">No token sold under both venues in {season}.</p>
      ) : (
        <>
          <div className="an-scroll">
            <table className={`an-table an-auto${rows.length >= 4 ? ' banded' : ''}`}>
              <thead>
                <tr>
                  <th className="left">Token</th>
                  {!narrow && <th className="left">Category</th>}
                  <th className="num">{otherLabel}</th>
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
                    <td className="num">{money(r.otherAvg)}</td>
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
                <h3 className="an-subhead" data-category={cg.category}>{cg.label}</h3>
                <BarChart
                  categories={cg.rows.map((r) => r.displayName)}
                  series={[
                    { label: otherLabel, color: FORUM_COLOR, values: cg.rows.map((r) => r.otherAvg) },
                    { label: trentLabel, color: TRENT_COLOR, values: cg.rows.map((r) => trentOf(r)) },
                  ]}
                  yLabel="Avg price" format={sourcePrice}
                  ariaLabel={`${otherLabel} versus ${adjusted ? 'reward-adjusted ' : ''}Trent average price for ${cg.label} tokens in ${season}`}
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

// --- View 5: Standard vs Trade 2 -------------------------------------------

// Blue against orange: the pair that stays distinguishable for the common forms
// of colour blindness, which matters more here than on the venue charts because
// the two series are the whole content of the view.
const STANDARD_COLOR = 'var(--series-1)';
const TRADE2_COLOR = 'var(--series-8)';

function VariantView({
  meta, sales, groupRows,
}: {
  meta: AuctionMeta[];
  sales: Sale[];
  groupRows: GroupRow[];
}) {
  const narrow = useMediaQuery(NARROW);
  const price = (n: number) => (narrow ? moneyTight(n) : money(n));
  // Seasons running both orders. Read from the data (deriveOrderVariant over
  // auctionStyle), so this view appears the season a second order is offered and
  // stops appearing when one is not — there is no year written down anywhere.
  const seasons = useMemo(() => orderVariantSeasons(meta), [meta]);
  const [picked, setPicked] = useState('');
  const season = picked && seasons.includes(picked) ? picked : (seasons[0] ?? '');
  const result = useMemo(
    () => (season ? standardVsTradeTwo(sales, meta, season) : null),
    [sales, meta, season],
  );
  const chartGroups = useMemo(
    () => groupForCharts(result?.rows ?? [], groupRows, season),
    [result, groupRows, season],
  );

  if (!seasons.length) {
    return (
      <section className="an-panel">
        <h2>Standard vs Trade 2 order prices</h2>
        <p className="empty">
          No season has run both a standard and a Trade 2 order. The second order first appeared in
          season 2027; this view fills in on its own when a season carries both.
        </p>
      </section>
    );
  }

  return (
    <section className="an-panel">
      <h2>Standard vs Trade 2 order prices</h2>
      <p className="an-lede">
        {narrow ? (
          <>Each token's average price in <strong>Trade 2</strong> auctions vs{' '}
          <strong>standard</strong> ones, same season. Only tokens sold in both appear.</>
        ) : (
          <>Since season 2027 the company offers two different $8k orders — the standard one and a{' '}
          <strong>Trade 2</strong> one, which auctioneers advertise as Option A and Option B. For one
          season, each token's average price in Trade 2 auctions sits beside its average in standard
          ones. Only tokens sold in <em>both</em> appear, which is what makes this a comparison of{' '}
          <em>prices</em> rather than of what the two orders happen to contain.</>
        )}
      </p>
      <p className="confound-note">
        Read as a price question, not a supply one. The two orders ship different quantities of the
        premium trade goods, so a token's average here says what bidders paid per token — not how
        many of it were on offer. The split is read from each auction's recorded style, which is
        where the sheet stores which order was sold.
      </p>

      <label className="an-picker">
        Season
        <select value={season} onChange={(e) => setPicked(e.target.value)}>
          {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {result && (
        <>
          <p className="confound-note">
            {result.season}: {result.tradeTwoAuctions} Trade 2 vs {result.standardAuctions} standard
            auction{result.standardAuctions === 1 ? '' : 's'} with prices, {result.rows.length} token
            {result.rows.length === 1 ? '' : 's'} sold in both.
            {result.tradeTwoOnly.length > 0
              && ` Only in Trade 2: ${result.tradeTwoOnly.join(', ')}.`}
            {result.standardOnly.length > 0
              && ` Only in standard: ${result.standardOnly.join(', ')}.`}
          </p>

          {result.rows.length === 0 ? (
            <p className="empty">No token sold in both a Trade 2 and a standard auction this season.</p>
          ) : (
            <>
              <div className="an-scroll">
                <table className={`an-table an-auto${result.rows.length >= 4 ? ' banded' : ''}`}>
                  <thead>
                    <tr>
                      <th className="left">Token</th>
                      {!narrow && <th className="left">Category</th>}
                      <th className="num">Trade 2</th>
                      <th className="num">{narrow ? 'Std.' : 'Standard'}</th>
                      <th className="num">Δ</th>
                      {!narrow && <th className="num">Δ %</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.item}>
                        <td className="left">
                          {r.displayName}
                          {/* Mobile drops the Category column; show it as subtext instead. */}
                          {narrow && r.category && <span className="an-lsub">{r.category}</span>}
                        </td>
                        {!narrow && <td className="left muted">{r.category}</td>}
                        <td className="num">{price(r.tradeTwoAvg)}</td>
                        <td className="num">{price(r.standardAvg)}</td>
                        <td className={`num diff ${r.delta >= 0 ? 'up' : 'down'}`}>{price(r.delta)}</td>
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

              {/* Same per-group charts as the venue view: prices here span cents
                  (trade goods) to four figures (8k Bonus), so one chart over every
                  token would flatten most of them onto the axis. */}
              <div className="src-charts">
                {chartGroups.map((cg) => (
                  <div key={cg.group} className="src-chart">
                    <h3 className="an-subhead" data-category={cg.category}>{cg.label}</h3>
                    <BarChart
                      categories={cg.rows.map((r) => r.displayName)}
                      series={[
                        { label: 'Standard', color: STANDARD_COLOR, values: cg.rows.map((r) => r.standardAvg) },
                        { label: 'Trade 2', color: TRADE2_COLOR, values: cg.rows.map((r) => r.tradeTwoAvg) },
                      ]}
                      yLabel="Avg price" format={sourcePrice}
                      ariaLabel={`Standard versus Trade 2 average price for ${cg.label} tokens in ${season}`}
                      maxLabels={12}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
