import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCostEngine } from '../hooks/useCostEngine';
import { useRoutedView } from '../hooks/useRoutedView';
import { TransmuteSeason } from '../components/TransmuteSeason';
import { BuildCalculator } from '../components/BuildCalculator';
import { PageIntro } from '../components/PageIntro';
import { HintPopover } from '../components/HintPopover';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { DEFAULT_PATH, goldPathFor, onPath, type IngredientPath } from '../lib/substitutions';

// Transmutes / build-vs-buy. Two views behind a toggle:
//   Recipes (Phase 4) — every craftable token's estimated build cost, priced
//     from its debut-year auction sales, seasons collapsible.
//   Build Calculator (Phase 2 of the expansion plan) — pick one recipe, enter
//     what you already own, and see what completing the transmute still costs.
// Both read the same cost engine; the toggle is the URL (/transmutes/:view) so
// each view is a shareable link and the top-level nav stays at five entries.

type View = 'recipes' | 'calculator';

export default function TransmutesPage() {
  const narrow = useMediaQuery(NARROW);
  const [view, setView] = useRoutedView<View>({
    views: ['recipes', 'calculator'],
    fallback: 'recipes',
    pathFor: (v) => `/transmutes/${v}`,
  });
  const calculator = view === 'calculator';
  const [recentPrices, setRecentPrices] = useState(false);
  // Phase 7 (§3.6). null = Auto: every recipe on its natural basis, active at
  // today's prices and expired over its build window. A season pins all of
  // them to that season instead. Recipes view only (F3) — the calculator is a
  // "what do I still owe on this build" tool, so it always asks today.
  const [priceYear, setPriceYear] = useState<number | null>(null);
  // Phase 9. One control for the whole list rather than 43 of them: on this
  // view the reader is scanning recipes, not building one, and the question
  // "what do these cost if I pay in Gold Bars" is asked of all of them at once.
  // Defaults to the Wish Ring, which is what the recipes literally list.
  const [path, setPath] = useState<IngredientPath>(DEFAULT_PATH);
  const [activeOnly, setActiveOnly] = useState(false);

  const [search, setSearch] = useState('');
  // null = default view (newest season open); a Set once the user toggles one.
  const [openSeasons, setOpenSeasons] = useState<Set<number> | null>(null);

  const { engine, loading, error, ready } = useCostEngine({
    recentPrices,
    priceYear: calculator ? null : priceYear,
  });

  const seasons = useMemo(() => (engine ? engine.seasons() : []), [engine]);
  const q = search.trim().toLowerCase();

  // Costs per season, filtered by the search box. Memoized on the engine, so
  // toggling a season open doesn't recompute every season's aggregation.
  const bySeason = useMemo(() => {
    if (!engine) return [];
    return seasons.map((year) => {
      const all = engine.costsForSeason(year);
      const matched = q
        ? all.filter((c) => c.displayName.toLowerCase().includes(q) || c.transmute.toLowerCase().includes(q))
        : all;
      const visible = activeOnly ? matched.filter((c) => c.status !== 'expired') : matched;
      const costs = path === DEFAULT_PATH ? visible : visible.map((c) => onPath(c, path));
      return { year, costs };
    });
  }, [engine, seasons, q, path, activeOnly]);

  const noteFor = (year: number): string | undefined => {
    if (!engine) return undefined;
    // Both notes below describe where a season's prices came from when the
    // basis is Auto. With a year pinned they are simply false — the answer is
    // the pinned season, which the meta-line and every open row already say.
    if (priceYear !== null) return undefined;
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
  const expiredCount = useMemo(
    () => (engine ? engine.allCosts().filter((c) => c.status === 'expired').length : 0),
    [engine],
  );
  const anyGoldPath = useMemo(
    () => bySeason.some((s) => s.costs.some((c) => goldPathFor(c))),
    [bySeason],
  );
  const shown = searching ? bySeason.filter((s) => s.costs.length) : bySeason;

  // Seasons that actually hold prices (2018–2026 today) — the year list, and
  // the test for whether last-5 can still do anything.
  const pricedSeasons = engine ? engine.prices.pricedSeasons : [];
  const showRecentToggle = priceYear === null || priceYear >= (engine?.prices.latestPriced ?? 0);

  // The things you can change about how the list is priced and filtered.
  // Held as one node so the phone can fold them behind a disclosure without a
  // second copy of the markup drifting from this one.
  const optionControls = (
    <>
      {expiredCount > 0 && (
        <div className="toggle" role="group" aria-label="Which recipes to show">
          <span className="toggle-label">Show Recipes</span>
          <div className="toggle-buttons">
            <button type="button" data-label="All" className={!activeOnly ? 'on' : undefined}
              aria-pressed={!activeOnly} onClick={() => setActiveOnly(false)}>All</button>
            {/* One label at both widths. The two-span full/short swap needs its
                `data-label` ghost to carry the LONGER text, which reserved room
                for "Still craftable" while showing "Craftable" — the button then
                overflowed selected and lost its padding unselected. */}
            <button type="button" data-label="Active" className={activeOnly ? 'on' : undefined}
              aria-pressed={activeOnly} onClick={() => setActiveOnly(true)}>Active</button>
          </div>
        </div>
      )}

      {anyGoldPath && (
        <div className="toggle path-toggle" role="group" aria-label="How Legendary recipes are priced">
          <span className="toggle-label">
            Legendary Recipes
            <HintPopover label="About the Wish Ring or GP choice">
              Legendary recipes accept either 1 Wish Ring or 15,000 GP. Choose to show the
              Wish Ring as a separate line item or to price the transmute with an additional
              15,000 GP on top of the 25,000. Players often have GP on hand, not Wish Rings.
            </HintPopover>
          </span>
          <div className="toggle-buttons">
            <button type="button" className={path === 'ring' ? 'on' : undefined}
              aria-pressed={path === 'ring'} onClick={() => setPath('ring')}>Wish Ring</button>
            <button type="button" className={path === 'gp' ? 'on' : undefined}
              aria-pressed={path === 'gp'} onClick={() => setPath('gp')}>15,000 GP</button>
          </div>
        </div>
      )}

      {/* Phase 7. A select rather than a segmented pair: nine seasons plus Auto
          is far past what the .toggle-buttons shape can hold, and it is the
          same <label>-over-<select> the Auction Data filters use. */}
      {pricedSeasons.length > 0 && (
        <div className="toggle price-year">
          <span className="toggle-label">
            <label htmlFor="price-year">Price data from</label>
            <HintPopover label="About pricing everything from one season">
              By default each recipe is priced on its own basis — <b>today's</b> prices if you
              can still craft it, its <b>build window</b> if it has expired. Pick a season to
              price every recipe from that season's auctions instead, which is how you compare
              what a build cost then against what it costs now. Ingredients a recipe pins to a
              particular season (an Ultra Rare from the year before, a named older token) keep
              that season, and say so on the line.
            </HintPopover>
          </span>
          <select
            id="price-year"
            value={priceYear ?? 'auto'}
            onChange={(e) => setPriceYear(e.target.value === 'auto' ? null : Number(e.target.value))}
          >
            <option value="auto">Auto (each recipe)</option>
            {[...pricedSeasons].reverse().map((y) => (
              <option key={y} value={y}>{y} prices</option>
            ))}
          </select>
        </div>
      )}

      {/* Last-5 is a reading of the season still in progress, so it has nothing
          to say about a pinned past one — variantFor already ignores it there.
          Hidden rather than shown inert, so the row never carries a control
          that cannot move a number. */}
      {showRecentToggle && (
      <div className="toggle" role="group" aria-label="Which sales price today's recipes">
          <span className="toggle-label">
            Today's prices from
            <HintPopover label="About the price basis">
              Recipes you can still craft are priced at <b>today's</b> prices. This picks what
              “today” means: the whole current season, or just its <b>last five auctions</b>,
              which reacts faster when a trade good is moving. Expired recipes ignore it —
              they are priced over the window they could actually be built in.
            </HintPopover>
          </span>
          <div className="toggle-buttons">
            <button type="button" data-label="Full season" className={!recentPrices ? 'on' : undefined}
              aria-pressed={!recentPrices} onClick={() => setRecentPrices(false)}>Full season</button>
            <button type="button" data-label="Last 5 auctions" className={recentPrices ? 'on' : undefined}
              aria-pressed={recentPrices} onClick={() => setRecentPrices(true)}>
              <span className="lbl-full">Last 5 auctions</span>
              <span className="lbl-short">Last 5</span>
            </button>
          </div>
        </div>
      )}
    </>
  );

  // How many are off their default — the folded summary has to say so, or a
  // filtered list reads as the full one (same reason FilterBar counts).
  const activeOptions =
    (activeOnly ? 1 : 0) + (path !== DEFAULT_PATH ? 1 : 0) +
    (recentPrices && showRecentToggle ? 1 : 0) + (priceYear !== null ? 1 : 0);

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;
  if (!ready) return <p className="empty">No transmute recipe data loaded.</p>;

  return (
    <>
      {calculator ? (
        <PageIntro short="Pick a recipe, enter what you already own, and see what completing the transmute costs.">
          Open <strong>Browse recipes</strong> to pick one, then enter{' '}
          <strong>how many of each ingredient you already have</strong> — the calculator subtracts
          them and shows what <strong>completing the transmute</strong> still costs, as an{' '}
          <strong>avg</strong> and a <strong>min</strong>. Tap <strong>All</strong> on a row (or{' '}
          <strong>Set all on hand</strong>) to mark it fully owned; set a source token to{' '}
          <strong>All</strong> to price just the upgrade step. Tap any <strong>$/ea</strong> price
          to use your own number when the market differs from our estimate. Enter what the finished
          token <strong>sells for</strong> and it weighs completing the transmute against buying it
          outright, and shows how much more loot it takes before crafting wins. For the full recipe
          list, switch to{' '}
          <button type="button" className="linklike" onClick={() => setView('recipes')}>Recipes</button>.
        </PageIntro>
      ) : (
        <PageIntro
          short={priceYear === null
            ? "What each transmute costs to craft — at today's prices if you can still make it."
            : `What each transmute would have cost to craft at ${priceYear} prices.`}
        >
          What it costs to <strong>craft</strong> each token from its ingredients, so you can weigh
          building against buying from a reseller.{' '}
          {priceYear === null ? (
            <>
              A recipe you can <strong>still craft</strong> is priced at <strong>today's</strong>{' '}
              prices, because that is what building it now would cost you. One that has{' '}
              <strong>expired</strong> is priced over the window it could actually be built in, and
              says so.
            </>
          ) : (
            <>
              You have pinned every recipe to <strong>{priceYear}</strong> prices, so each one
              answers what it would have cost to build that season rather than what it costs now —
              whether or not it was craftable then. Ingredients a recipe pins to a particular
              season keep it, and say so on the line.
            </>
          )}{' '}
          Both are shown as an <strong>avg</strong> and a{' '}
          <strong>min</strong> total per recipe. Tokens with a source show both the full build and
          the cheaper cost if you already own that source. Expand any row for its full bill of
          materials. For single-token price history, see <Link to="/">Prices</Link>.
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

        {/* Phones fold the options away — four segmented toggles plus a search
            box stacked 303px tall, pushing the season list off the bottom of
            the screen before you had read a price. Desktop keeps them in the
            open: a disclosure there reads as a dropdown menu, and its count
            badge shifts the controls beside it every time an option changes.
            Three visible toggles are the plainer thing. */}
        {!calculator && (narrow ? (
          <details className="filterset options">
            <summary>
              Options
              {activeOptions > 0 && <span className="filterset-count">{activeOptions}</span>}
            </summary>
            <div className="filterset-body">{optionControls}</div>
          </details>
        ) : optionControls)}
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
            {priceYear !== null && ` · all priced from ${priceYear} auctions`}
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
              // The recent-prices control moved to the global bar in the accuracy
              // release: it used to move only the current season's numbers, but
              // every ACTIVE recipe now prices at today's prices, so a control
              // buried in one season's panel would silently reprice 91 of 174
              // rows across every other panel on the page.
            />
          ))}
        </>
      )}
    </>
  );
}
