import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCostEngine } from '../hooks/useCostEngine';
import { useRoutedView } from '../hooks/useRoutedView';
import { TransmuteSeason } from '../components/TransmuteSeason';
import { TransmuteRow } from '../components/TransmuteRow';
import { BuildCalculator } from '../components/BuildCalculator';
import { ShoppingList } from '../components/ShoppingList';
import { PageIntro } from '../components/PageIntro';
import { HintPopover } from '../components/HintPopover';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { DEFAULT_PATH, goldPathFor, onPath, type IngredientPath } from '../lib/substitutions';
import type { BuildCost, PricingBasis } from '../lib/transmutes';

// Transmutes / build-vs-buy. Three views behind a toggle:
//   Recipes (Phase 4) — every craftable token's estimated build cost, priced
//     from its debut-year auction sales, seasons collapsible.
//   Build Calculator (Phase 2 of the expansion plan) — pick one recipe, enter
//     what you already own, and see what completing the transmute still costs.
//   Shopping List — pick MANY recipes and get one merged buy-list across all of
//     them, which is the question a player planning a season actually has.
// All three read the same cost engine; the toggle is the URL
// (/transmutes/:view) so each view is a shareable link and the top-level nav
// stays at five entries.

type View = 'recipes' | 'calculator' | 'shopping';

export default function TransmutesPage() {
  const narrow = useMediaQuery(NARROW);
  const [view, setView] = useRoutedView<View>({
    views: ['recipes', 'calculator', 'shopping'],
    fallback: 'recipes',
    pathFor: (v) => `/transmutes/${v}`,
  });
  const calculator = view === 'calculator';
  const shopping = view === 'shopping';
  // The Recipes view is the only one that gets to choose a basis or pin a
  // season. The other two ask "what would this cost me now", which is one
  // question with one answer (D8/D11) — offering the choice there would let a
  // reader put a shopping list on 2019 prices and go shopping with it.
  const recipesView = view === 'recipes';
  const [recentPrices, setRecentPrices] = useState(false);
  // One control, three answers, because they are three answers to ONE question
  // — which market is this priced against — and splitting them across two
  // widgets would let a reader set a combination that means nothing.
  //
  //   'era'    each recipe on its own basis: today's prices while it is still
  //            craftable, its build window once expired. The default, because
  //            41% of what this view lists is expired and that section exists
  //            to show what a build cost while it was possible.
  //   'today'  everything at the current market, except tokens that can no
  //            longer be bought at all. NOT the same as pinning the latest
  //            season: that would quote a 2012 Ultra Rare at the 2026 price.
  //   number   Phase 7 (§3.6) — every unpinned line from one named season.
  //
  // Recipes view only (F3). The calculator is a "what do I still owe on this
  // build" tool, so it always asks today.
  const [pricing, setPricing] = useState<PricingBasis | number>('era');
  const priceYear = typeof pricing === 'number' ? pricing : null;
  const basis: PricingBasis = pricing === 'today' ? 'today' : 'era';
  // Phase 9. One control for the whole list rather than 43 of them: on this
  // view the reader is scanning recipes, not building one, and the question
  // "what do these cost if I pay in Gold Bars" is asked of all of them at once.
  // Defaults to the Wish Ring, which is what the recipes literally list.
  const [path, setPath] = useState<IngredientPath>(DEFAULT_PATH);
  const [activeOnly, setActiveOnly] = useState(false);

  const [search, setSearch] = useState('');
  // The band collapses like a season. Closed by default: it is pinned for
  // FINDABILITY, which a header at the top of the page already gives it, and
  // leaving it open would spend four rows of a phone screen on it before the
  // reader has asked. Matches the seasons, where only one is open at rest.
  const [bandOpen, setBandOpen] = useState(false);
  // null = default view (newest season open); a Set once the user toggles one.
  const [openSeasons, setOpenSeasons] = useState<Set<number> | null>(null);

  const { engine, loading, error, ready } = useCostEngine({
    recentPrices,
    priceYear: recipesView ? priceYear : null,
    basis: recipesView ? basis : 'today',
  });

  const seasons = useMemo(() => (engine ? engine.seasons() : []), [engine]);
  const q = search.trim().toLowerCase();

  // One filter, applied identically to the band and to every season, so a row
  // cannot answer to the controls differently depending on where it is shown.
  const visible = useMemo(() => (all: BuildCost[]) => {
    const matched = q
      ? all.filter((c) => c.displayName.toLowerCase().includes(q) || c.transmute.toLowerCase().includes(q))
      : all;
    const live = activeOnly ? matched.filter((c) => c.status !== 'expired') : matched;
    // `engine` is in the deps because onPath now needs it to price the GP path's
    // substituted line. It is nullable here and the guard costs nothing: with no
    // engine there are no costs to map in the first place.
    return path === DEFAULT_PATH || !engine ? live : live.map((c) => onPath(c, path, engine));
  }, [q, activeOnly, path, engine]);

  // The trade rungs, pinned above the seasons. `bandKeys` is what stops them
  // being listed twice; the season counts drop to match (2026: 29 -> 28).
  const band = useMemo(() => (engine ? visible(engine.tradeRungCosts()) : []), [engine, visible]);
  const bandKeys = useMemo(() => (engine ? engine.bandKeys() : new Set<string>()), [engine]);

  // Costs per season, filtered by the search box. Memoized on the engine, so
  // toggling a season open doesn't recompute every season's aggregation.
  const bySeason = useMemo(() => {
    if (!engine) return [];
    return seasons.map((year) => ({
      year,
      costs: visible(engine.costsForSeason(year).filter((c) => !bandKeys.has(c.key))),
    }));
  }, [engine, seasons, visible, bandKeys]);

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
      return basis === 'today'
        ? `Preview — priced at ${latestPriced} prices, because that is the only market there is for it yet; costs will firm up as ${year} auctions close.`
        : `Preview — priced from ${latestPriced} recent sales; costs will firm up as ${year} auctions close.`;
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

  const total = useMemo(() => band.length + bySeason.reduce((n, s) => n + s.costs.length, 0), [band, bySeason]);
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
  // the test for whether last-5 can still do anything. On the Recipes view a
  // pinned past season leaves it inert (variantFor ignores it); the calculator
  // never carries a pin (F3), so there it is always live.
  const pricedSeasons = engine ? engine.prices.pricedSeasons : [];
  const showRecentToggle =
    !recipesView || priceYear === null || priceYear >= (engine?.prices.latestPriced ?? 0);
  // Under 'era' an expired recipe is priced over a date window, which is its
  // own aggregation and has no last-5 reading; the toggle still governs the
  // active and future recipes above it, so it stays — but the hint has to stop
  // promising it reaches everything.
  const recentReachesAll = !recipesView || basis === 'today';

  // The one option BOTH views answer to, so it is declared once and rendered in
  // each. It governs the calculator whether or not it is on screen there — the
  // engine is shared — so the choice is between showing it and letting an
  // invisible control move the build-vs-buy verdict. It shows.
  //
  // Hidden only where it cannot do anything: last-5 is a reading of the season
  // still in progress, so a pinned PAST season on the Recipes view leaves it
  // inert. A control that cannot move a number does not earn a slot.
  const recentToggle = showRecentToggle && (
    <div className="toggle" role="group" aria-label="Which sales price today's recipes">
      <span className="toggle-label">
        Today's prices from
        <HintPopover label="About the price basis">
          This picks what “today” means: the whole current season, or just its <b>last five
          auctions</b>, which reacts faster when a trade good is moving.
          {recentReachesAll ? (
            <> It reaches every recipe, because they are all priced against today's market.</>
          ) : (
            <> Recipes you can still craft are priced at <b>today's</b> prices, so it moves
              those. Expired recipes ignore it — they are priced over the window they could
              actually be built in.</>
          )}
        </HintPopover>
      </span>
      <div className="toggle-buttons">
        <button type="button" data-label="Full season" className={!recentPrices ? 'on' : undefined}
          aria-pressed={!recentPrices} onClick={() => setRecentPrices(false)}>Full season</button>
        <button type="button" data-label="Last 5 auctions" data-short="Last 5" className={recentPrices ? 'on' : undefined}
          aria-pressed={recentPrices} onClick={() => setRecentPrices(true)}>
          <span className="lbl-full">Last 5 auctions</span>
          <span className="lbl-short">Last 5</span>
        </button>
      </div>
    </div>
  );

  // Phase 9's Wish Ring choice, declared here rather than inline because the
  // Shopping List renders it too: it changes what is ON the list, so it is not
  // a Recipes-view preference.
  const pathToggle = anyGoldPath && (
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
        <button type="button" data-label="Wish Ring" className={path === 'ring' ? 'on' : undefined}
          aria-pressed={path === 'ring'} onClick={() => setPath('ring')}>Wish Ring</button>
        <button type="button" data-label="15,000 GP" className={path === 'gp' ? 'on' : undefined}
          aria-pressed={path === 'gp'} onClick={() => setPath('gp')}>15,000 GP</button>
      </div>
    </div>
  );

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

      {pathToggle}

      {/* Phase 7. A select rather than a segmented pair: nine seasons plus Auto
          is far past what the .toggle-buttons shape can hold, and it is the
          same <label>-over-<select> the Auction Data filters use. */}
      {pricedSeasons.length > 0 && (
        <div className="toggle price-year">
          <span className="toggle-label">
            <label htmlFor="price-year">Price data from</label>
            <HintPopover label="About which market recipes are priced against">
              <b>Each recipe's own era</b> prices every recipe on its own basis — today's
              prices if you can still craft it, the <b>build window</b> it could actually be
              built in if it has expired. That is what a build cost at the time.
              <br /><br />
              <b>Today's prices</b> asks the other question: what would it cost to buy these
              ingredients now. Trade goods have no vintage, so an expired recipe's Darkwood
              Planks are simply today's Darkwood Planks. Tokens you can no longer buy at all —
              an out-of-print Ultra Rare — keep their own market, because nobody can buy a
              2012 Ultra Rare at this year's price.
              <br /><br />
              Picking a <b>season</b> prices every recipe from that season's auctions instead,
              which is how you compare what a build cost then against now. Unlike the two
              above it will quote a season for tokens that season never sold.
              <br /><br />
              Ingredients a recipe pins to a particular season (an Ultra Rare from the year
              before, a named older token) keep that season under every setting, and say so on
              the line.
            </HintPopover>
          </span>
          <select
            id="price-year"
            value={pricing}
            onChange={(e) => {
              const v = e.target.value;
              setPricing(v === 'today' || v === 'era' ? v : Number(v));
            }}
          >
            <option value="era">Each recipe's own era</option>
            <option value="today">Today's prices</option>
            {[...pricedSeasons].reverse().map((y) => (
              <option key={y} value={y}>{y} prices</option>
            ))}
          </select>
        </div>
      )}

      {recentToggle}
    </>
  );

  // How many are off their default — the folded summary has to say so, or a
  // filtered list reads as the full one (same reason FilterBar counts).
  const activeOptions =
    (activeOnly ? 1 : 0) + (path !== DEFAULT_PATH ? 1 : 0) +
    (recentPrices && showRecentToggle ? 1 : 0) + (pricing !== 'era' ? 1 : 0);

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;
  if (!ready) return <p className="empty">No transmute recipe data loaded.</p>;

  return (
    <>
      {shopping ? (
        <PageIntro short="Pick everything you plan to make and get one merged list of what to buy.">
          Add every transmute you plan to make — with <strong>how many of each</strong> — and this
          merges their ingredients into <strong>one buy-list</strong>. Trade goods collapse onto a
          single row per good however many recipes want them; everything else is listed by the
          season its token comes from. Everything is priced at{' '}
          <strong>today's</strong> prices, because that is what you would pay to buy it now — so
          unlike <button type="button" className="linklike" onClick={() => setView('recipes')}>Recipes</button>,
          there is no season to pin. Tokens that are no longer sold keep their own market and say
          so. Use <strong>−</strong> and <strong>+</strong> to change a quantity; taking one to
          zero <strong>pauses</strong> it without losing your place, and <strong>✕</strong> removes
          it.
        </PageIntro>
      ) : calculator ? (
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
            <button type="button" data-label="Build Calculator" data-short="Calculator" className={view === 'calculator' ? 'on' : undefined}
              aria-pressed={view === 'calculator'} onClick={() => setView('calculator')}>
              <span className="lbl-full">Build Calculator</span>
              <span className="lbl-short">Calculator</span>
            </button>
            <button type="button" data-label="Shopping List" data-short="Shopping" className={view === 'shopping' ? 'on' : undefined}
              aria-pressed={view === 'shopping'} onClick={() => setView('shopping')}>
              <span className="lbl-full">Shopping List</span>
              <span className="lbl-short">Shopping</span>
            </button>
          </div>
        </div>

        {/* Phones fold the options away — four segmented toggles plus a search
            box stacked 303px tall, pushing the season list off the bottom of
            the screen before you had read a price. Desktop keeps them in the
            open: a disclosure there reads as a dropdown menu, and its count
            badge shifts the controls beside it every time an option changes.
            Three visible toggles are the plainer thing. */}
        {recipesView && (narrow ? (
          <details className="filterset options">
            <summary>
              Options
              {activeOptions > 0 && <span className="filterset-count">{activeOptions}</span>}
            </summary>
            <div className="filterset-body">{optionControls}</div>
          </details>
        ) : optionControls)}
        {/* The Shopping List keeps the Wish Ring choice — it changes what is on
            the list — and the last-5 toggle, because "what does it cost now"
            still has to say which sales answer that. It does NOT get the basis
            selector. */}
        {shopping && <>{pathToggle}{recentToggle}</>}
        {/* 1a: the calculator gets this one control in the global bar rather
            than a third pair on its tools strip — the strip only exists once a
            recipe is picked, and the browse drawer's prices answer to this
            too. */}
        {calculator && recentToggle}
        {recipesView && (
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
      ) : shopping ? (
        <ShoppingList engine={engine!} path={path} />
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

          {searching && shown.length === 0 && band.length === 0 && <p className="empty">No transmutes match “{search}”.</p>}

          {/* The trade rungs, above the seasons rather than inside one. Every rung
              of the trade ladder is a transmute, but unlike the power ladder they
              are not OF the season they debuted in — the Golden Fleece recipe never
              expires and is the same 10 Monster Trophies every year, so filing it
              under 2017 buried it eleven accordions down beneath a season note
              about 2018 price data that was false for it. Always open: it is four
              rows, and a collapsed pin would defeat the point of pinning it. */}
          {band.length > 0 && (
            <section className="tx-band">
              {/* The hint is a SIBLING of the toggle, not inside it: a button cannot
                  contain another button, which is the same constraint TransmuteRow
                  solves with an overlay. A flex row puts them on one line and leaves
                  the whole title clickable except the hint itself. */}
              <div className="tx-bhead-row">
                <button
                  type="button"
                  className="tx-bhead"
                  aria-expanded={bandOpen || searching}
                  onClick={() => setBandOpen((v) => !v)}
                >
                  <i className={`tx-chev ${bandOpen || searching ? 'open' : ''}`} aria-hidden="true">▸</i>
                  <span className="tx-btitle">Premium Trade Goods</span>
                  <span className="tx-scount">{band.length} transmute{band.length === 1 ? '' : 's'}</span>
                </button>
                <HintPopover label="About premium trade goods">
                  The upper rungs of the <b>trade good ladder</b> — Trade 3 and Trade 5 — which
                  are crafted rather than sold at auction. They sit here rather than under a
                  season because they are not tied to one: the Golden Fleece recipe never
                  expires. The Omni recipes DO expire and are reissued each year, so only the
                  <b> latest</b> of each is shown here; older ones stay in their own season.
                </HintPopover>
              </div>
              {/* Forced open while searching, exactly as the seasons are — a match
                  the reader cannot see is the same as no match. */}
              {(bandOpen || searching) && (
                <div className="tx-band-body">
                  {band.map((c) => <TransmuteRow key={c.key} cost={c} showYear />)}
                </div>
              )}
            </section>
          )}

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
