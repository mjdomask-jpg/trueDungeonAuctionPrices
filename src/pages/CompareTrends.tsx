import { useMemo, useState } from 'react';
import { seasonsOf, compareSeasons, pctChange, type CompareRow, type StatKind } from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters } from '../data/filtersContext';
import { applyViewFilters } from '../lib/context';
import { CompareTable } from '../components/CompareTable';
import { FilterBar } from '../components/FilterBar';
import { compareCategories } from '../lib/categories';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';

type SortMode = 'category' | 'movers';

const STAT_OPTIONS: { key: StatKind; label: string }[] = [
  { key: 'avg', label: 'Avg' },
  { key: 'max', label: 'Max' },
  { key: 'min', label: 'Min' },
];

// The "Year over year" lens of the Trends page (Phase 3). Pick two seasons; see
// each token's full-season Max/Avg/Min side by side plus the % change in
// average, keyed on the canonical Item so a renamed token still lines up across
// years. Two sub-views: grouped by category (default) or a single table sorted
// by biggest average move. Rendered by TrendsPage, which owns the intro and the
// view toggle.
export function CompareTrends() {
  const { sales, meta, goldenTicketAuctions, loading, error } = useAuctionData();
  const { filters } = useFilters();
  const seasons = useMemo(() => seasonsOf(sales), [sales]); // newest first, unfiltered

  const narrow = useMediaQuery(NARROW);

  // Apply the shared Source / Trent-pricing / Auction-type filters before the
  // year-over-year comparison, so both columns reflect the same lens. Defaults
  // leave the feed untouched.
  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);
  const viewSales = useMemo(
    () => applyViewFilters(sales, metaById, goldenTicketAuctions, filters),
    [sales, metaById, goldenTicketAuctions, filters],
  );

  // Default to the two most recent seasons: older on the left, newer on the right.
  const [seasonA, setSeasonA] = useState('');
  const [seasonB, setSeasonB] = useState('');
  const [sort, setSort] = useState<SortMode>('category');
  // Which stat the compact phone view shows. Ignored on desktop (all three show
  // there); defaults to Avg to match the desktop delta column.
  const [stat, setStat] = useState<StatKind>('avg');

  const a = seasonA || seasons[1] || seasons[0] || '';
  const b = seasonB || seasons[0] || '';
  const newerIsB = Number(b) >= Number(a);

  const rows = useMemo(
    () => (a && b ? compareSeasons(viewSales, a, b) : []),
    [viewSales, a, b],
  );

  // The label used for sorting a row: the newer year's name, falling back to
  // the older name, then the Item code.
  const sortLabel = (r: CompareRow) =>
    (newerIsB ? r.nameB ?? r.nameA : r.nameA ?? r.nameB) ?? r.item;

  // Category sections, ordered by CATEGORY_ORDER; rows within a section by name.
  const groups = useMemo(() => {
    const byCat = new Map<string, CompareRow[]>();
    for (const r of rows) {
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    }
    const order = [...byCat.keys()].sort(compareCategories);
    return order.map((cat) => ({
      category: cat,
      rows: byCat.get(cat)!.sort((x, y) => sortLabel(x).localeCompare(sortLabel(y))),
    }));
    // sortLabel depends on newerIsB; rows/newerIsB cover it.
  }, [rows, newerIsB]); // eslint-disable-line react-hooks/exhaustive-deps

  // The change a row is judged on: the shown stat's % change in the compact
  // phone view (so "biggest change" ranks by the delta actually on screen), and
  // the average change on desktop, where the delta column is always Δ Avg.
  const rowPct = (r: CompareRow) =>
    narrow ? pctChange(r.a?.[stat], r.b?.[stat]) : r.avgPct;

  // Flat "biggest movers" order: largest absolute % change first; rows without a
  // defined % change (token absent in one year) fall to the bottom, by name.
  const movers = useMemo(() => {
    return [...rows].sort((x, y) => {
      const px = rowPct(x), py = rowPct(y);
      const mx = px == null ? -Infinity : Math.abs(px);
      const my = py == null ? -Infinity : Math.abs(py);
      if (mx !== my) return my - mx;
      return sortLabel(x).localeCompare(sortLabel(y));
    });
  }, [rows, newerIsB, narrow, stat]); // eslint-disable-line react-hooks/exhaustive-deps

  // Summary line: how many tokens rose / fell / are new / dropped out.
  const summary = useMemo(() => {
    let rose = 0, fell = 0, added = 0, gone = 0;
    for (const r of rows) {
      if (r.avgPct != null) { if (r.avgPct > 0) rose++; else if (r.avgPct < 0) fell++; }
      else if (r.a == null || r.b == null) {
        // Present in only one year. Classify by the newer/older axis (not the
        // A/B column order, which the user can flip) so it matches the labels.
        const newerStat = newerIsB ? r.b : r.a;
        if (newerStat == null) gone++; else added++;
      }
    }
    return { rose, fell, added, gone };
  }, [rows, newerIsB]);

  const newer = newerIsB ? b : a;
  const older = newerIsB ? a : b;

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;
  if (seasons.length < 2) return <p className="empty">Need at least two seasons of data to compare.</p>;

  return (
    <>
      <div className="controls">
        <label>
          Season A
          <select value={a} onChange={(e) => setSeasonA(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Season B
          <select value={b} onChange={(e) => setSeasonB(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="category">By category</option>
            <option value="movers">By biggest change</option>
          </select>
        </label>
        {narrow && (
          <div className="toggle" role="group" aria-label="Stat">
            <span className="toggle-label">Show</span>
            <div className="toggle-buttons">
              {STAT_OPTIONS.map((o) => (
                <button key={o.key} type="button" data-label={o.label}
                  className={stat === o.key ? 'on' : undefined}
                  aria-pressed={stat === o.key} onClick={() => setStat(o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <FilterBar controls={['source', 'trentPricing', 'auctionType']} collapsibleOnMobile />

      <p className="meta-line stats compare-summary">
        {rows.length} token{rows.length === 1 ? '' : 's'} · {summary.rose} rose ·{' '}
        {summary.fell} fell · {summary.added} new in {newer} · {summary.gone} gone since {older}
        {a === b && ' · pick two different seasons to see changes'}
      </p>

      {rows.length === 0 && <p className="empty">No tokens sold in these seasons.</p>}

      {rows.length > 0 && sort === 'category' && groups.map((g) => (
        <section key={g.category} className="cat-section" data-category={g.category}>
          <h2 className="cat-header">{g.category}</h2>
          <CompareTable rows={g.rows} seasonA={a} seasonB={b} newerIsB={newerIsB} stat={stat} />
        </section>
      ))}

      {rows.length > 0 && sort === 'movers' && (
        <section className="cat-section">
          <CompareTable rows={movers} seasonA={a} seasonB={b} newerIsB={newerIsB} stat={stat} />
        </section>
      )}
    </>
  );
}
