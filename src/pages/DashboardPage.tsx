import { useMemo, useState } from 'react';
import {
  seasonsOf, aggregateSeason, lastFiveAuctionNumbers, asTenXRows, type ItemRow, type Sale,
} from '../lib/data';
import { fmtCloseDate, money } from '../lib/format';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters } from '../data/filtersContext';
import { ERAS } from '../lib/eras';
import { CategoryTable } from '../components/CategoryTable';
import { FilterBar } from '../components/FilterBar';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { TenXToggle } from '../components/TenXToggle';
import { useTenX } from '../hooks/useTenX';
import { compareCategories } from '../lib/categories';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { PageIntro } from '../components/PageIntro';

export default function DashboardPage() {
  const { sales, meta, contextItems, loading, error } = useAuctionData();
  const { filters } = useFilters();
  const [season, setSeason] = useState<string>('');
  const [category, setCategory] = useState('All');
  // Seven columns collide on a phone, so narrow screens show one stat group at
  // a time. Last 5 leads: it's the topical number, and only ~10% of tokens have
  // no sale in that window.
  const narrow = useMediaQuery(NARROW);
  const [statGroup, setStatGroup] = useState<'last5' | 'full'>('last5');
  // Show Trade 1 tokens as their "10x" bundle (×10 price, "10x " name). On by
  // default and shared with the Timelines page — see useTenX.
  const [tenX, setTenX] = useTenX();
  // The category picker is dropped on phones — the list is short enough to
  // scroll. Force the filter open so a category chosen on a wide screen can't
  // strand a narrow one with a filter it has no control to clear.
  const effectiveCategory = narrow ? 'All' : category;

  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  // Default to the newest season once data has loaded.
  const activeSeason = season || seasons[0] || '';

  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);

  // Apply the shared Source / Trent-pricing filters to the sales BEFORE the
  // per-token aggregation, so every stat on the page reflects the chosen source
  // and (for Trent) the ~10% reward-adjusted effective price. Defaults ("All
  // sources", "Nominal") leave the sales untouched, so the dashboard reads
  // exactly as it did before the context layer.
  const viewSales = useMemo(() => {
    const rewardMultiplier = 1 - ERAS.trentRewardRate;
    const out: Sale[] = [];
    for (const s of sales) {
      const src = metaById.get(s.auctionId)?.source;
      if (filters.source !== 'all' && src !== filters.source) continue;
      out.push(filters.trentPricing === 'reward-adjusted' && src === 'Trent'
        ? { ...s, price: s.price * rewardMultiplier }
        : s);
    }
    return out;
  }, [sales, metaById, filters.source, filters.trentPricing]);

  const rows = useMemo(
    () => (activeSeason ? aggregateSeason(viewSales, activeSeason) : []),
    [viewSales, activeSeason],
  );
  const last5Nums = useMemo(
    () => (activeSeason ? lastFiveAuctionNumbers(viewSales, activeSeason) : []),
    [viewSales, activeSeason],
  );

  // This season's context items (withheld / augment / grunnel / released),
  // narrowed to the provenances the FilterBar has switched on. Ordered by auction,
  // then item. Shown in a section separate from the per-token tables so the
  // headline price stats stay unchanged (design §5.4).
  const seasonContext = useMemo(() => {
    return contextItems
      .filter((it) => metaById.get(it.auctionId)?.season === activeSeason && filters.provenance.has(it.provenance))
      .sort((a, b) =>
        (metaById.get(a.auctionId)!.auctionNumber - metaById.get(b.auctionId)!.auctionNumber)
        || a.name.localeCompare(b.name));
  }, [contextItems, metaById, activeSeason, filters.provenance]);
  // Trade 1 rows become their 10x bundle here when the toggle is on; every other
  // category (and thus the category list) is unchanged.
  const displayRows = useMemo(() => asTenXRows(rows, tenX), [rows, tenX]);
  const categories = useMemo(
    () => ['All', ...[...new Set(displayRows.map((r) => r.category))].sort()],
    [displayRows],
  );

  const filtered = displayRows.filter(
    (r) => effectiveCategory === 'All' || r.category === effectiveCategory,
  );

  // Group the filtered rows into per-category tables, ordered by CATEGORY_ORDER
  // (unlisted categories appended alphabetically). Rows within each table are
  // sorted alphabetically by token (display) name.
  const groups = useMemo(() => {
    const byCat = new Map<string, ItemRow[]>();
    for (const r of filtered) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    const order = [...byCat.keys()].sort(compareCategories);
    return order.map((cat) => ({
      category: cat,
      rows: byCat.get(cat)!.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }));
  }, [filtered]);

  const closedAuctions = meta
    .filter((m) => m.season === activeSeason && m.status === 'Closed'
      && (filters.source === 'all' || m.source === filters.source))
    .length;

  // Global intro stats (across all seasons).
  const totalClosedAuctions = meta.filter((m) => m.status === 'Closed').length;
  const firstYear = seasons[seasons.length - 1];
  const lastYear = seasons[0];

  // Close dates for the "Last 5" window, looked up from metadata by auction
  // number. Falls back to "#N" if a close date is missing.
  const closeDateByNumber = useMemo(() => {
    const map = new Map<number, string>();
    for (const m of meta) if (m.season === activeSeason) map.set(m.auctionNumber, m.closeDate);
    return map;
  }, [meta, activeSeason]);
  const last5Label = (n: number | undefined) =>
    n == null ? '' : fmtCloseDate(closeDateByNumber.get(n)) ?? `#${n}`;

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <PageIntro short="Welcome to the True Dungeon Auction Analysis">
        Welcome to the True Dungeon auction analysis! These statistics are calculated
        live from {totalClosedAuctions.toLocaleString()} auctions from {firstYear} to {lastYear}.
        This covers {sales.length.toLocaleString()} items sold!
      </PageIntro>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {!narrow && (
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
        <TenXToggle on={tenX} onChange={setTenX} />
        {narrow && (
          <div className="toggle" role="group" aria-label="Stat group">
            <span className="toggle-label">Show</span>
            <div className="toggle-buttons">
              <button type="button" className={statGroup === 'last5' ? 'on' : undefined}
                aria-pressed={statGroup === 'last5'} onClick={() => setStatGroup('last5')}>
                Last 5
              </button>
              <button type="button" className={statGroup === 'full' ? 'on' : undefined}
                aria-pressed={statGroup === 'full'} onClick={() => setStatGroup('full')}>
                Full Season
              </button>
            </div>
          </div>
        )}
      </div>

      <FilterBar controls={['source', 'trentPricing', 'provenance']} />

      <p className="meta-line stats">
        Season {activeSeason}: {closedAuctions} closed auctions ·
        {' '}"Last 5" = {last5Nums.map(last5Label).join(', ')}
      </p>

      {groups.length === 0 && <p className="empty">No matching items.</p>}
      {groups.map((g) => (
        <CategoryTable
          key={g.category}
          category={g.category}
          rows={g.rows}
          group={narrow ? statGroup : 'both'}
        />
      ))}

      {seasonContext.length > 0 && (
        <section className="ctx-section">
          <h2>Auction context — {activeSeason}</h2>
          <p className="meta-line">
            Items withheld, augmented, or added outside the advertised order this season.
            These are separate from the per-token prices above; withheld values are estimates.
          </p>
          <ul className="ctx-list">
            {seasonContext.map((it, i) => (
              <li className="ctx-row" key={`${it.auctionId}-${it.name}-${i}`}>
                <ProvenanceBadge provenance={it.provenance} n={it.estimate ? it.n : undefined} />
                <span className="ctx-name">
                  {it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}
                </span>
                <span className="ctx-auction">#{metaById.get(it.auctionId)?.auctionNumber}</span>
                <span className={`ctx-value${it.value < 0 ? ' neg' : ''}`}>{money(it.value)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
