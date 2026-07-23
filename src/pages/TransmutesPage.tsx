import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCostEngine } from '../hooks/useCostEngine';
import { TransmuteSeason } from '../components/TransmuteSeason';
import { PageIntro } from '../components/PageIntro';

// Transmutes / build-vs-buy (Phase 4). Every craftable token's estimated build
// cost, computed from current auction prices via the cost engine. Seasons are
// collapsible; the current one opens by default. Within a season, Relics are
// paired with the Legendaries they upgrade into (see lib/transmutes.orderSeason).
export default function TransmutesPage() {
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

  return (
    <>
      <PageIntro short="Estimated transmute costs if you bought ingredients from auctions.">
        What it costs to <strong>craft</strong> each token from its ingredients, so you can weigh
        building against buying from a reseller. Costs come from current auction prices — an{' '}
        <strong>avg</strong> and a <strong>min</strong> total per recipe. Tokens with a source show
        both the full build and the cheaper cost if you already own that source. Expand any row for
        its full bill of materials. For single-token price history, see <Link to="/">Prices</Link>.
      </PageIntro>

      <div className="controls">
        <label className="search">
          <span className="sr-only">Search transmutes</span>
          <input
            type="text"
            placeholder="Search transmutes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <p className="meta-line">
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
          // "Recent prices" only moves the current season's numbers (past seasons
          // are closed; the preview already prices off recent sales), so the
          // toggle lives inside that one season rather than floating globally.
          recentToggle={engine != null && year === engine.prices.latestPriced ? { on: recentPrices, onChange: setRecentPrices } : undefined}
        />
      ))}
    </>
  );
}
