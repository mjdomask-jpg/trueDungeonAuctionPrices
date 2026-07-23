import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { seasonsOf, compareSeasons, type CompareRow } from '../lib/data';
import { useAuctionData } from '../data/auctionDataContext';
import { CompareTable } from '../components/CompareTable';
import { compareCategories } from '../lib/categories';
import { PageIntro } from '../components/PageIntro';

type SortMode = 'category' | 'movers';

// Compare Years (Phase 3). Pick two seasons; see each token's full-season
// Max/Avg/Min side by side plus the % change in average, keyed on the canonical
// Item so a renamed token still lines up across years. Two views: grouped by
// category (default) or a single table sorted by biggest average move.
export default function ComparePage() {
  const { sales, loading, error } = useAuctionData();
  const seasons = useMemo(() => seasonsOf(sales), [sales]); // newest first

  // Default to the two most recent seasons: older on the left, newer on the right.
  const [seasonA, setSeasonA] = useState('');
  const [seasonB, setSeasonB] = useState('');
  const [sort, setSort] = useState<SortMode>('category');

  const a = seasonA || seasons[1] || seasons[0] || '';
  const b = seasonB || seasons[0] || '';
  const newerIsB = Number(b) >= Number(a);

  const rows = useMemo(
    () => (a && b ? compareSeasons(sales, a, b) : []),
    [sales, a, b],
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

  // Flat "biggest movers" order: largest absolute % change first; rows without a
  // defined % change (token absent in one year) fall to the bottom, by name.
  const movers = useMemo(() => {
    return [...rows].sort((x, y) => {
      const mx = x.avgPct == null ? -Infinity : Math.abs(x.avgPct);
      const my = y.avgPct == null ? -Infinity : Math.abs(y.avgPct);
      if (mx !== my) return my - mx;
      return sortLabel(x).localeCompare(sortLabel(y));
    });
  }, [rows, newerIsB]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <PageIntro short="How each token's full-season price changed between two years.">
        How each token's full-season price changed between two years. Values are
        Max / Avg / Min for the whole season; <strong>Δ Avg</strong> is the change
        in average from the left year to the right. Tokens are matched across years
        by their role, so a renamed token still lines up — <em>{newer} name / {older} name</em>{' '}
        when it changed. For a single season's detail, see <Link to="/">Prices</Link>.
      </PageIntro>

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
      </div>

      <p className="meta-line stats compare-summary">
        {rows.length} token{rows.length === 1 ? '' : 's'} · {summary.rose} rose ·{' '}
        {summary.fell} fell · {summary.added} new in {newer} · {summary.gone} gone since {older}
        {a === b && ' · pick two different seasons to see changes'}
      </p>

      {rows.length === 0 && <p className="empty">No tokens sold in these seasons.</p>}

      {rows.length > 0 && sort === 'category' && groups.map((g) => (
        <section key={g.category} className="cat-section" data-category={g.category}>
          <h2 className="cat-header">{g.category}</h2>
          <CompareTable rows={g.rows} seasonA={a} seasonB={b} newerIsB={newerIsB} />
        </section>
      ))}

      {rows.length > 0 && sort === 'movers' && (
        <section className="cat-section">
          <CompareTable rows={movers} seasonA={a} seasonB={b} newerIsB={newerIsB} />
        </section>
      )}
    </>
  );
}
