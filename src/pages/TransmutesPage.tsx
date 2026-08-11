import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCostEngine } from '../hooks/useCostEngine';
import { useRoutedView } from '../hooks/useRoutedView';
import { TransmuteSeason } from '../components/TransmuteSeason';
import { BuildCalculator } from '../components/BuildCalculator';
import { PageIntro } from '../components/PageIntro';

// Transmutes / build-vs-buy. Two views behind a toggle:
//   Recipes (Phase 4) — every craftable token's estimated build cost, priced
//     from its debut-year auction sales, seasons collapsible.
//   Build Calculator (Phase 2 of the expansion plan) — pick one recipe, enter
//     what you already own, and see what finishing the craft still costs.
// Both read the same cost engine; the toggle is the URL (/transmutes/:view) so
// each view is a shareable link and the top-level nav stays at five entries.

type View = 'recipes' | 'calculator';

export default function TransmutesPage() {
  const [view, setView] = useRoutedView<View>({
    views: ['recipes', 'calculator'],
    fallback: 'recipes',
    pathFor: (v) => `/transmutes/${v}`,
  });
  const [recentPrices, setRecentPrices] = useState(false);
  const [search, setSearch] = useState('');
  // null = default view (newest season open); a Set once the user toggles one.
  const [openSeasons, setOpenSeasons] = useState<Set<number> | null>(null);

  const { engine, loading, error, ready } = useCostEngine({ recentPrices });

  const seasons = useMemo(() => (engine ? engine.seasons() : []), [engine]);
  const q = search.trim().toLowerCase();

  // Costs per season, filtered by the search box. Memoized on the engine, so
  // toggling a season open doesn't recompute every season's aggregation.
  const bySeason = useMemo(() => {
    if (!engine) return [];
    return seasons.map((year) => {
      const all = engine.costsForSeason(year);
      const costs = q
        ? all.filter((c) => c.displayName.toLowerCase().includes(q) || c.transmute.toLowerCase().includes(q))
        : all;
      return { year, costs };
    });
  }, [engine, seasons, q]);

  const noteFor = (year: number): string | undefined => {
    if (!engine) return undefined;
    const { earliestPriced, latestPriced } = engine.prices;
    if (year < earliestPriced)
      return `Estimated — no auction data before ${earliestPriced}, so these costs are priced from ${earliestPriced} data`;
    if (year > latestPriced)
      return `Preview — priced from ${latestPriced} recent sales; costs will firm up as ${year} auctions close.`;
    return undefined;
  };

  // Open the latest priced season by default — not seasons[0], which is the
  // 2027 preview (a forward estimate few players are shopping for yet).
  const defaultOpen = engine ? engine.prices.latestPriced : seasons[0];
  const searching = q.length > 0;
  const isOpen = (year: number) =>
    searching ? true : openSeasons ? openSeasons.has(year) : year === defaultOpen;
  const toggle = (year: number) =>
    setOpenSeasons((prev) => {
      const base = prev ?? new Set<number>(defaultOpen != null ? [defaultOpen] : []);
      const next = new Set(base);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });

  const total = useMemo(() => bySeason.reduce((n, s) => n + s.costs.length, 0), [bySeason]);
  const shown = searching ? bySeason.filter((s) => s.costs.length) : bySeason;

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;
  if (!ready) return <p className="empty">No transmute recipe data loaded.</p>;

  const calculator = view === 'calculator';

  return (
    <>
      {calculator ? (
        <PageIntro short="Pick a recipe, enter what you already own, and see what finishing the craft costs.">
          Pick any recipe, then enter <strong>how many of each ingredient you already have</strong> —
          the calculator subtracts them and shows what <strong>finishing the craft</strong> still
          costs, as an <strong>avg</strong> and a <strong>min</strong>. Set a source token to
          &ldquo;Have all&rdquo; to price the upgrade step alone, or override any unit price with your
          own number when the market differs from our estimate. For the full recipe list, switch to{' '}
          <button type="button" className="linklike" onClick={() => setView('recipes')}>Recipes</button>.
        </PageIntro>
      ) : (
        <PageIntro short="Estimated transmute costs, priced from each transmute's debut-year auction sales.">
          What it costs to <strong>craft</strong> each token from its ingredients, so you can weigh
          building against buying from a reseller. Each transmute is priced from auction sales in the{' '}
          <strong>year it debuted</strong> — an <strong>avg</strong> and a <strong>min</strong> total
          per recipe. Tokens with a source show
          both the full build and the cheaper cost if you already own that source. Expand any row for
          its full bill of materials. For single-token price history, see <Link to="/">Prices</Link>.
        </PageIntro>
      )}

      <div className="controls">
        <div className="toggle view-toggle" role="group" aria-label="Transmutes view">
          <span className="toggle-label">View</span>
          <div className="toggle-buttons">
            <button type="button" data-label="Recipes" className={view === 'recipes' ? 'on' : undefined}
              aria-pressed={view === 'recipes'} onClick={() => setView('recipes')}>
              Recipes
            </button>
            <button type="button" data-label="Build Calculator" className={view === 'calculator' ? 'on' : undefined}
              aria-pressed={view === 'calculator'} onClick={() => setView('calculator')}>
              <span className="lbl-full">Build Calculator</span>
              <span className="lbl-short">Calculator</span>
            </button>
          </div>
        </div>

        {!calculator && (
          <label className="search">
            <span className="sr-only">Search transmutes</span>
            <input
              type="text"
              placeholder="Search transmutes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        )}
      </div>

      {calculator ? (
        <BuildCalculator engine={engine!} />
      ) : (
        <>
          {/* A bare count while idle, so it earns `.stats` and drops on phones to
              get the seasons above the fold. Searching changes its job — the match
              tally is the only confirmation the query hit anything — so the class
              comes off and the line stays. */}
          <p className={`meta-line${searching ? '' : ' stats'}`}>
            {total} transmute{total === 1 ? '' : 's'} across {seasons.length} seasons
            {searching && ` · ${shown.length} season${shown.length === 1 ? '' : 's'} with matches`}
          </p>

          {searching && shown.length === 0 && <p className="empty">No transmutes match “{search}”.</p>}

          {shown.map(({ year, costs }) => (
            <TransmuteSeason
              key={year}
              year={year}
              costs={costs}
              open={isOpen(year)}
              onToggle={() => toggle(year)}
              note={noteFor(year)}
              // "Recent prices" only moves the current season's numbers (past
              // seasons are closed; the preview already prices off recent sales),
              // so the toggle lives inside that one season, not floating globally.
              recentToggle={engine != null && year === engine.prices.latestPriced ? { on: recentPrices, onChange: setRecentPrices } : undefined}
            />
          ))}
        </>
      )}
    </>
  );
}
