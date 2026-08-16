import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { money0, moneyCalc } from '../lib/format';
import { Money } from './Money';
import { HintPopover } from './HintPopover';
import { OmniSuggestions } from './OmniSuggestions';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { orderSeason, tierAbbrev, type BuildCost, type CostEngine, type PricedLine } from '../lib/transmutes';
import {
  RESALE, WASH_THRESHOLD, breakEvenHoldings, comparePaths, quickSaleValue, type PathKey,
} from '../lib/buildCalc';

// Build Calculator (Phase 2 of the transmutes expansion plan) — compact redesign.
//
// One screen, no page swaps. A slide-in drawer picks the recipe (years collapse,
// source Relics stay paired with the Legendary they upgrade into — same ordering
// as the Recipes view); the chosen recipe fills a dense table where you enter what
// you already own and read what completing the transmute still costs. Nothing ever
// navigates away, so context and the Back button are never lost.
//
// Two design choices worth stating:
//  • Every line is treated uniformly, source included. "If you already own the
//    source" isn't a mode — it's setting that line to All, which drops it from the
//    cost-to-finish. So the Recipes view's build/upgrade split falls out of the
//    on-hand math instead of being special-cased.
//  • Prices come from the same cost engine the Recipes view reads, so the two
//    can't drift. Any line's unit price can be overridden when the market differs
//    from our estimate (plan §3.2/§3.4) via an inline editor on the $/ea cell.
//
// State is ephemeral (plan Q4): on-hand counts and overrides live in React state
// keyed by line index, reset when the recipe changes.
//
// Phase 3 adds the decision layer on top: what the finished token sells for
// (pre-filled from its own auction price where it has one, editable otherwise),
// what your on-hand pile would fetch in a quick sale, and which of the three
// ways to end up holding the token is cheapest. That math is pure and lives in
// lib/buildCalc.ts; this file only formats it.

type Override = { avg: number | null; min: number | null };

// The secondary price is tri-state: 'auto' follows the token's own auction
// price (when it has one), a number is the user's, and null means they cleared
// the box — which has to be distinguishable from 'auto', or clearing the field
// would snap it straight back to the auction price.
type MarketInput = 'auto' | number | null;
type PickItem =
  | { type: 'pair'; source: BuildCost; upgrade: BuildCost }
  | { type: 'single'; cost: BuildCost };

// Tier display order for the drawer's filter chips (game power ladder).
const TIER_ORDER = ['Relic', 'Legendary', 'Arcanum', 'Eldritch', 'Enhanced', 'Exalted', 'Mythic', 'Safehold', 'Ultra Rare', 'Paragon', 'Omni'];

// The two paths that compete. "Buy it" names what you keep when you hold
// something, since that retained pile is the whole reason it beats selling up.
const pathName = (key: PathKey, holdsGoods: boolean) =>
  key === 'build' ? 'Complete the transmute' : holdsGoods ? 'Buy it, keep your goods' : 'Just buy it';

// How far the totals must be into the viewport before the pinned strip stands
// down. One constant so the observer's rootMargin and the "is pinning worth it"
// measurement can't drift apart — they describe the same handoff.
const FOOT_REVEAL = 80;

// A configured rate as prose ("20%"). The rate lives in RESALE, so the help
// text can't drift from the math the way a hardcoded "20%" would.
const pct = (rate: number) => `${Math.round(rate * 100)}%`;

// A money range in whole dollars, collapsing to one figure when both ends round
// the same — "$71–$106", but "$45" rather than "$45–$45". Compares the rendered
// strings, not the numbers, so $70.60 and $71.40 don't print as "$71–$71".
const range = (lo: number, hi: number) => {
  const a = money0(lo);
  const b = money0(hi);
  return a === b ? a : `${a}–${b}`;
};

// Money always shows both cents digits ($10.60, not $10.6); parsing rounds to
// cents so a stored override never carries a longer tail than it displays.
const fmt2 = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));
// `$` and thousands separators are stripped rather than rejected: prices get
// pasted in from listings and reseller pages as "$1,500.00", and Number() reads
// that as NaN. The box re-displays the bare number.
const parsePrice = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// A price entry box that displays two decimals ($4.80) but lets you type freely
// while focused (4.8) — a plain number input drops trailing zeros, so this holds
// its own text and reformats from the value on blur.
function PriceInput({ value, onChange, ariaLabel }: {
  value: number | null;
  onChange: (n: number | null) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => fmt2(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt2(value)); }, [value, focused]);
  return (
    <input
      type="text" inputMode="decimal" aria-label={ariaLabel} value={text}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => { setText(e.target.value); onChange(parsePrice(e.target.value)); }}
    />
  );
}

// Compact provenance for one ingredient: its own season when it differs from the
// recipe's, then where the price came from. Mirrors TransmuteRow's priceTag.
function lineTag(l: PricedLine, recipeYear: number): string {
  const parts: string[] = [];
  if (l.nominalYear !== recipeYear) parts.push(String(l.nominalYear));
  if (l.isSource) parts.push('source · built');
  else if (l.source === 'auction') parts.push('auction');
  else if (l.source === 'offAuction') parts.push('non-auction item');
  else if (l.source === 'derived') parts.push('derived');
  else if (l.source === 'build') parts.push('built');
  else parts.push('no price');
  if (l.seasonMapped) parts.push(`from ${l.pricedYear}`);
  if (l.bound === 'ceiling') parts.push('ceiling');
  return parts.join(' · ');
}

export function BuildCalculator({ engine }: { engine: CostEngine }) {
  const narrow = useMediaQuery(NARROW);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('All');
  // null = default (only the focus year open); a Set once the user toggles one.
  const [openYears, setOpenYears] = useState<Set<number> | null>(null);
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [marketInput, setMarketInput] = useState<MarketInput>('auto');
  // The pinned summary strip: on while the ingredient table fills the screen and
  // nothing else is telling you where you stand.
  const barRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const buyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pastBar, setPastBar] = useState(false);
  const [footInView, setFootInView] = useState(false);
  const [roomToPin, setRoomToPin] = useState(false);

  const all = useMemo(() => engine.allCosts(), [engine]);
  const cost = useMemo(
    () => (selectedKey ? all.find((c) => c.key === selectedKey) ?? null : null),
    [all, selectedKey],
  );
  const years = useMemo(() => engine.seasons(), [engine]);
  const tiers = useMemo(() => {
    const present = new Set(all.map((c) => c.level));
    return ['All', ...TIER_ORDER.filter((t) => present.has(t)), ...[...present].filter((t) => !TIER_ORDER.includes(t))];
  }, [all]);

  // A fresh recipe starts clean — no on-hand carried over, no stale overrides,
  // and the buy price back to whatever the new token's own auction sales say.
  useEffect(() => {
    setOnHand({});
    setOverrides({});
    setEditing(null);
    setMarketInput('auto');
  }, [selectedKey]);

  // Two observers rather than a scroll listener: one says the top bar has left
  // the screen, the other says the totals have arrived. The strip lives in the
  // gap between them, so its copy of "cost to finish" is never on screen at the
  // same time as the real one. Re-runs when a recipe is picked, since the panel
  // (and so the footer) only exists then.
  useEffect(() => {
    const bar = barRef.current;
    const foot = footRef.current;
    const panel = panelRef.current;
    if (!bar || !foot || !panel) {
      setPastBar(false);
      setFootInView(false);
      setRoomToPin(false);
      return;
    }

    // Is there enough table for a pinned copy to earn its keep? The strip is on
    // between "the bar has left" and "the totals have arrived", and that window
    // measures 1,210px at 375px but only 231px at 1000px — about two wheel
    // notches, where it reads as a flicker rather than a fixture. Require a full
    // screen of it. Measured rather than gated on a breakpoint: the real
    // variable is how much table there is, so this also covers short recipes,
    // short browser windows and zoom, which a media query would only guess at.
    const measure = () => {
      const onAt = bar.getBoundingClientRect().bottom + window.scrollY;
      const offAt = foot.getBoundingClientRect().top + window.scrollY - window.innerHeight + FOOT_REVEAL;
      setRoomToPin(offAt - onAt >= window.innerHeight);
    };
    measure();
    // The panel changes height when an inline price editor opens, which moves
    // the footer and so the window — cheaper and more reliable to observe it
    // than to enumerate everything that resizes it.
    const resized = new ResizeObserver(measure);
    resized.observe(panel);
    window.addEventListener('resize', measure);

    const gone = new IntersectionObserver(([e]) => setPastBar(!e.isIntersecting));
    // Shrink the root's bottom edge so the footer has to be properly on screen,
    // not merely touching it, before the strip stands down — otherwise the real
    // "cost to finish" takes over while it is still a sliver at the very bottom.
    const arrived = new IntersectionObserver(([e]) => setFootInView(e.isIntersecting), {
      rootMargin: `0px 0px -${FOOT_REVEAL}px 0px`,
    });
    gone.observe(bar);
    arrived.observe(foot);
    return () => {
      resized.disconnect();
      window.removeEventListener('resize', measure);
      gone.disconnect();
      arrived.disconnect();
    };
  }, [cost]);

  const stripOn = cost != null && roomToPin && pastBar && !footInView;

  // Send the reader to the price field the strip is reporting on. The strip
  // never holds an input of its own — two boxes for one value is a bug waiting
  // to happen, and it would push the at-rest bar past its already-tall 158px.
  const jumpToPrice = () => {
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    buyRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    buyRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  // The drawer opens on the current recipe's year (or the latest priced season
  // before anything is picked), like the Recipes view; other years collapse.
  const focusYear = cost ? cost.year : engine.prices.latestPriced;
  const q = search.trim().toLowerCase();
  const filtering = q.length > 0 || tier !== 'All';
  const isYearOpen = (y: number) => (filtering ? true : openYears ? openYears.has(y) : y === focusYear);
  const toggleYear = (y: number) =>
    setOpenYears((prev) => {
      const base = prev ?? new Set<number>(focusYear != null ? [focusYear] : []);
      const next = new Set(base);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });

  // Drawer contents: each year's recipes, honoring search + tier filter. With no
  // filter we keep the Recipes-view ordering (Relic→Legendary pairs first).
  const drawerYears = useMemo(() => {
    const matches = (c: BuildCost) =>
      (tier === 'All' || c.level === tier) &&
      (!q || c.displayName.toLowerCase().includes(q) || c.transmute.toLowerCase().includes(q));
    return years
      .map((year) => {
        const costs = all.filter((c) => c.year === year);
        let items: PickItem[];
        if (filtering) {
          items = costs.filter(matches).map((c) => ({ type: 'single', cost: c }));
        } else {
          items = [];
          for (const g of orderSeason(costs)) {
            if (g.kind === 'pairs') g.pairs.forEach((p) => items.push({ type: 'pair', source: p.source, upgrade: p.upgrade }));
            else g.rows.forEach((c) => items.push({ type: 'single', cost: c }));
          }
        }
        return { year, items };
      })
      .filter((y) => y.items.length);
  }, [all, years, q, tier, filtering]);

  const pick = (c: BuildCost) => {
    setSelectedKey(c.key);
    setDrawerOpen(false);
    setSearch('');
    setTier('All');
  };

  // --- Per-line + total math ---------------------------------------------
  const rows = (cost ? cost.lines : []).map((line, i) => {
    const key = String(i);
    const req = line.quantity;
    const ov = overrides[key];
    const unitAvg = ov ? ov.avg : line.unitAvg;
    const unitMin = ov ? ov.min : line.unitMin;
    const overridden = !!ov && (ov.avg !== line.unitAvg || ov.min !== line.unitMin);
    const have = Math.min(Math.max(0, onHand[key] ?? 0), req);
    const need = Math.max(0, req - have);
    const priced = unitAvg != null;
    return {
      key, line, req, have, need, overridden, unitAvg, unitMin, priced,
      finAvg: unitAvg == null ? null : need * unitAvg,
      finMin: unitMin == null ? null : need * unitMin,
      haveAvg: unitAvg == null ? null : Math.min(have, req) * unitAvg,
    };
  });
  const sum = (pickN: (r: (typeof rows)[number]) => number | null) => rows.reduce((n, r) => n + (pickN(r) ?? 0), 0);
  const finAvg = sum((r) => r.finAvg);
  const finMin = sum((r) => r.finMin);
  const provideAvg = sum((r) => r.haveAvg);
  const fullAvg = sum((r) => (r.unitAvg == null ? null : r.req * r.unitAvg));
  const fullMin = sum((r) => (r.unitMin == null ? null : r.req * r.unitMin));
  const unpricedNeeded = rows.filter((r) => r.need > 0 && !r.priced).length;
  // Individual goods still to buy, summed across lines — 15 Mystic Silk + 6
  // Dwarven Steel + 3 Elven Bismuth reads as 24, not 3. It is the pile you have
  // to go and find, which is what the player is sizing up.
  const needUnits = rows.reduce((n, r) => n + r.need, 0);
  const src = cost?.lines.find((l) => l.isSource);

  // --- Phase 3: quick sale + the build-vs-buy call ------------------------
  // Both read the EFFECTIVE unit prices, so a per-line override moves what your
  // pile is worth as well as what the rest costs — an override means "the real
  // market is this", and that cuts both ways.
  const quick = quickSaleValue(rows.map((r) => ({
    quantity: r.req, onHand: r.have, unitAvg: r.unitAvg, unitMin: r.unitMin,
  })));
  const autoMarket = cost?.marketAvg ?? null;
  const market = marketInput === 'auto' ? autoMarket : marketInput;
  const marketIsAuto = marketInput === 'auto' && autoMarket != null;
  // The comparison is only meaningful once we know what the finished token
  // costs to buy, so it appears with that number and not before (plan §2.2).
  const plans = market == null ? null : comparePaths(finAvg, market, quick);
  const planCost = (k: PathKey) => plans?.paths.find((p) => p.key === k)?.cost ?? 0;
  const holdsGoods = provideAvg > 0;
  // How much of the recipe you need in the drawer before finishing overtakes
  // buying, and how far short of that you are. Same magnitude as the build-vs-
  // buy gap — cost to finish is fullAvg minus what you hold — but a different
  // question: not "which is cheaper today" but "how much more loot until
  // crafting wins", which is the one a player with a growing stash is asking.
  const breakEven = market == null ? 0 : breakEvenHoldings(fullAvg, market);
  const toGo = Math.max(0, breakEven - provideAvg);
  const gapWorthShowing = toGo > 0.005 && breakEven > 0;
  // The comparison runs on average prices, but the min column right above it can
  // be far cheaper — and a buyer who actually shops the low end may face a
  // different answer entirely. Say so, and say it louder when building at min
  // prices would beat the path we just crowned.
  const minWorthSaying = finAvg > 0 && finMin < finAvg - 0.005;
  const minBeatsVerdict =
    plans != null && plans.best !== 'build' && finMin < planCost(plans.best) - WASH_THRESHOLD;

  // The bar's one-line answer, sat under the cost-to-finish figure. Phones take
  // a shorter wording on purpose: the right-hand column is sized by whichever of
  // its three lines is widest, so a long verdict would squeeze the recipe name
  // beside it and could push it onto another line the moment a price is typed.
  // Clamping the copy keeps that column near 130px whatever the verdict says.
  const verdictLine =
    plans == null || market == null
      ? narrow ? 'Set buy price' : 'Set buy price to compare'
      : plans.wash
        ? 'About even'
        : `${plans.best === 'build' ? (narrow ? 'Complete' : 'Complete it') : (narrow ? 'Buy' : 'Buy it')}`
          + ` · ${money0(plans.delta)} ${narrow ? 'less' : 'cheaper'}`;

  const setHave = (key: string, req: number, v: number) =>
    setOnHand((p) => ({ ...p, [key]: Math.min(Math.max(0, v), req) }));
  const toggleAll = (key: string, req: number, have: number) => setHave(key, req, have >= req ? 0 : req);
  const setOv = (key: string, line: PricedLine, field: keyof Override, num: number | null) =>
    setOverrides((p) => {
      const cur = p[key] ?? { avg: line.unitAvg, min: line.unitMin };
      return { ...p, [key]: { ...cur, [field]: num } };
    });
  const clearOv = (key: string) =>
    setOverrides((p) => {
      const { [key]: _drop, ...rest } = p;
      return rest;
    });

  // Field-to-field navigation. iOS draws its own prev/next arrows over standard
  // inputs; this wires Enter — and Android's "next" key, hinted by enterKeyHint
  // — to jump to the following on-hand box so a whole build can be filled from
  // the keyboard without reaching for each field.
  const focusNextHand = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = Array.from(
      e.currentTarget.closest('.calc-panel')?.querySelectorAll<HTMLInputElement>('.cl-hand input') ?? [],
    );
    const next = inputs[inputs.indexOf(e.currentTarget) + 1];
    if (next) { next.focus(); next.select(); }
  };

  // Master on-hand control: set every priced line to fully-owned in one tap
  // (fast when you have most of the materials and only lack a few), or clear all.
  const pricedRows = rows.filter((r) => r.priced);
  const allOwned = pricedRows.length > 0 && pricedRows.every((r) => r.have >= r.req);
  const setAllHand = (full: boolean) =>
    setOnHand(() => {
      const next: Record<string, number> = {};
      rows.forEach((r) => { if (r.priced) next[r.key] = full ? r.req : 0; });
      return next;
    });

  // --- Drawer option row -------------------------------------------------
  const optRow = (c: BuildCost, opts: { indented?: boolean; from?: string | null } = {}) => (
    <button
      key={c.key}
      type="button"
      className={`calc-opt${opts.indented ? ' leg' : ''}${c.key === selectedKey ? ' sel' : ''}`}
      onClick={() => pick(c)}
    >
      <span className="tchip" data-tier={c.level}>{c.level}</span>
      <span className="calc-opt-nm">
        {c.displayName}
        {opts.from && <span className="calc-opt-up">↳ upgrades from {opts.from}</span>}
      </span>
      <span className="calc-opt-c">{moneyCalc(c.fullAvg)}</span>
    </button>
  );

  return (
    <div className="calc">
      {/* Pinned only across the table, released the moment the totals show. It
          reports; it never takes input (see jumpToPrice). */}
      {stripOn && cost && (
        <div className="calc-strip">
          <span className="cs-name">{cost.displayName}</span>
          <span className="cs-fin">
            to finish <b>{moneyCalc(finAvg)}</b>
          </span>
          <span className="cs-line">
            {plans && market != null ? (
              <>
                <button type="button" className="cs-jump" aria-label="Go to the buy price"
                  onClick={jumpToPrice}>
                  buy {moneyCalc(market)}
                </button>
                <span className={`cs-verdict${plans.wash ? '' : ' on'}`}>
                  {plans.wash
                    ? 'about even'
                    : `${plans.best === 'build' ? 'Complete it' : 'Buy it'} · ${money0(plans.delta)} cheaper`}
                </span>
              </>
            ) : (
              <button type="button" className="cs-jump prompt" onClick={jumpToPrice}>
                Set a buy price to compare
              </button>
            )}
          </span>
        </div>
      )}

      <div className="calc-bar" ref={barRef}>
        <button type="button" className="calc-browse" onClick={() => setDrawerOpen(true)}>
          <i className="calc-browse-i" aria-hidden="true">≡</i> Browse recipes
        </button>
        {cost && (
          <>
            <span className="calc-cur">
              <span className="tchip" data-tier={cost.level}>
                <span aria-hidden="true">{narrow ? tierAbbrev(cost.level) : cost.level}</span>
                <span className="sr-only">{cost.level}</span>
              </span>
              <span className="calc-cur-name">{cost.displayName}</span>
              <span className="calc-cur-year">{cost.year}</span>
            </span>
            {/* Cost to finish and the buy-it answer are one block, so no future
                layout change can put the comparison somewhere other than beside
                the number it compares against. */}
            <span className="calc-spend">
              <span className="calc-spend-lab">Cost to finish</span>
              <span className="calc-spend-val">
                <b><Money format={moneyCalc} value={finAvg} /></b> <span className="calc-min">min <Money format={moneyCalc} value={finMin} /></span>
              </span>
              <button
                type="button"
                className={`calc-spend-buy${plans && market != null && !plans.wash ? ' on' : ''}`}
                aria-label={plans && market != null ? 'Change the buy price' : 'Set a buy price to compare'}
                onClick={jumpToPrice}
              >
                {verdictLine}
              </button>
            </span>
          </>
        )}
      </div>

      {cost ? (
        <div className="calc-panel" ref={panelRef}>
          <div className="calc-tools">
            <span className="calc-tools-lab">Set all on hand</span>
            <button type="button" className={`calc-all${allOwned ? ' on' : ''}`} aria-pressed={allOwned}
              onClick={() => setAllHand(true)}>All</button>
            <button type="button" className="calc-all" onClick={() => setAllHand(false)}>None</button>
          </div>
          <div className="calc-lhead">
            <span>Ingredient</span><span className="h-hand">on hand</span><span>buy</span>
            <span>$/ea <i className="cl-edit-i" aria-hidden="true">✎</i></span><span>to finish</span>
          </div>
          {rows.map((r) => (
            <div key={r.key} className={`calc-line${r.line.isSource ? ' src' : ''}${r.need === 0 && r.priced ? ' done' : ''}`}>
              <div className="cl-main">
                <span className="cl-name">
                  <span className="cl-good">{r.req} × {r.line.displayName}</span>
                  <span className="cl-meta">
                    {lineTag(r.line, cost.year)}
                    <button type="button" className="cl-price-m" aria-expanded={editing === r.key}
                      aria-label={`Edit unit price: ${r.line.displayName}`}
                      onClick={() => setEditing((e) => (e === r.key ? null : r.key))}>
                      {' · '}{r.priced ? moneyCalc(r.unitAvg) : 'no price'} ea{r.overridden ? ' · your price' : ''}
                      <i className="cl-edit-i" aria-hidden="true">✎</i>
                    </button>
                  </span>
                </span>
                <span className="cl-hand">
                  {r.priced ? (
                    <>
                      <button type="button" className={`calc-all${r.have >= r.req ? ' on' : ''}`}
                        aria-pressed={r.have >= r.req} onClick={() => toggleAll(r.key, r.req, r.have)}>
                        {r.have >= r.req ? 'None' : 'All'}
                      </button>
                      {/* −/+ stepper (all widths) — the type=text field has no
                          native spinner; these replace it. */}
                      <span className="cl-stepper">
                        <button type="button" className="cl-step" aria-label={`One fewer on hand: ${r.line.displayName}`}
                          disabled={r.have <= 0} onClick={() => setHave(r.key, r.req, r.have - 1)}>−</button>
                        {/* type=text (not number): number inputs don't support
                            select() — worst on iOS, where a tap drops the cursor
                            before the 0 and "2" becomes "20". inputMode keeps the
                            numeric keypad; select-on-focus makes the first digit
                            replace the value. */}
                        <input type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next"
                          aria-label={`On hand: ${r.line.displayName}`} value={r.have}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={focusNextHand}
                          onChange={(e) => setHave(r.key, r.req, e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)} />
                        <button type="button" className="cl-step" aria-label={`One more on hand: ${r.line.displayName}`}
                          disabled={r.have >= r.req} onClick={() => setHave(r.key, r.req, r.have + 1)}>+</button>
                      </span>
                    </>
                  ) : (
                    <span className="cl-dash">—</span>
                  )}
                </span>
                <span className="cl-buy">{r.priced ? (r.need > 0 ? r.need : <span className="cl-check" aria-label="covered">✓</span>) : ''}</span>
                <span className="cl-unit">
                  <button type="button" className="cl-price-d" aria-expanded={editing === r.key}
                    aria-label={`Unit price ${r.priced ? moneyCalc(r.unitAvg) : 'unpriced'} — edit`}
                    onClick={() => setEditing((e) => (e === r.key ? null : r.key))}>
                    {r.priced ? moneyCalc(r.unitAvg) : '—'}{r.overridden && <i className="cl-ovdot" aria-hidden="true" />}
                    <i className="cl-edit-i" aria-hidden="true">✎</i>
                  </button>
                </span>
                <span className="cl-fin">
                  {r.priced ? (
                    r.need > 0 ? (
                      <><b><Money format={moneyCalc} value={r.finAvg} /></b><span className="calc-min">min <Money format={moneyCalc} value={r.finMin} /></span></>
                    ) : (
                      <span className="cl-covered">covered</span>
                    )
                  ) : (
                    <span className="cl-noprice">no price</span>
                  )}
                </span>
              </div>
              {editing === r.key && (
                <div className="cl-editor">
                  <span className="cl-editor-hint">Your price:</span>
                  <label>avg
                    <span className="cl-money-in"><span className="cl-dollar">$</span>
                      <PriceInput ariaLabel={`Your avg price: ${r.line.displayName}`} value={r.unitAvg}
                        onChange={(n) => setOv(r.key, r.line, 'avg', n)} /></span>
                  </label>
                  <label>min
                    <span className="cl-money-in"><span className="cl-dollar">$</span>
                      <PriceInput ariaLabel={`Your min price: ${r.line.displayName}`} value={r.unitMin}
                        onChange={(n) => setOv(r.key, r.line, 'min', n)} /></span>
                  </label>
                  {r.overridden && (
                    <button type="button" className="cl-reset" onClick={() => clearOv(r.key)}>
                      Reset to {moneyCalc(r.line.unitAvg)}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="calc-foot" ref={footRef}>
            <div className="calc-foot-row total">
              <span>Cost to finish</span>
              <span><b><Money format={moneyCalc} value={finAvg} /></b> <span className="calc-min">min <Money format={moneyCalc} value={finMin} /></span></span>
            </div>
            <div className="calc-foot-row">
              <span>You're providing</span>
              <span>{moneyCalc(provideAvg)} of materials</span>
            </div>
            {quick.high > 0 && (
              <div className="calc-foot-row">
                <span>
                  Quick-sale value
                  <HintPopover label="How quick-sale value is worked out">
                    What your on-hand goods would fetch if you sold them, knocking{' '}
                    {pct(RESALE.off)} off to move them. The low end takes that off the season's
                    <b> lowest</b> price — a fire sale, everything gone fast. The high end takes it
                    off the <b>going rate</b> — a patient sale, worked for what it's worth. Both
                    are estimates, not offers.
                  </HintPopover>
                </span>
                <span>~{range(quick.low, quick.high)} if you sold them</span>
              </div>
            )}
            <p className="calc-foot-note">
              Full build from scratch {moneyCalc(fullAvg)} (min {moneyCalc(fullMin)}).
              {src && <> Own the {src.displayName}? Hit <b>All</b> on the top row for the upgrade-only price.</>}
            </p>
            {unpricedNeeded > 0 && (
              <p className="calc-warn">
                {unpricedNeeded} ingredient{unpricedNeeded === 1 ? '' : 's'} you still need
                {unpricedNeeded === 1 ? ' has' : ' have'} no price and {unpricedNeeded === 1 ? "isn't" : "aren't"} in the total.
              </p>
            )}
          </div>

          {/* Phase 6: opt-in only, and deliberately AFTER the totals it does not
              affect. An Omni token is a comparison, not a path most players are
              already on — see substitutions.ts for why this and the Wish Ring
              toggle get different treatment. */}
          <OmniSuggestions cost={cost} engine={engine} />

          {/* Phase 3: buy-instead price, and the three ways to end up holding
              the token. Every total is shown, not just the verdict, so the
              call can be audited rather than taken on trust (plan §7). */}
          <div className="cbuy" ref={buyRef}>
            <div className="cbuy-head">
              <label className="cbuy-price">
                <span className="cbuy-lab">
                  Buy it instead for
                  <HintPopover label="About the buy-it price">
                    What the finished token would cost you to buy outright — from a reseller,
                    the secondary market, or another player. Where the token has its own auction
                    sales we start from those; type over it with any price you've actually seen.
                  </HintPopover>
                </span>
                <span className="cl-money-in">
                  <span className="cl-dollar">$</span>
                  <PriceInput
                    ariaLabel="Price to buy the finished token"
                    value={market}
                    onChange={(n) => setMarketInput(n)}
                  />
                </span>
              </label>
              {marketIsAuto ? (
                <span className="cbuy-src">from {cost.year} auction sales</span>
              ) : (
                autoMarket != null && (
                  <button type="button" className="cl-reset" onClick={() => setMarketInput('auto')}>
                    Reset to {moneyCalc(autoMarket)}
                  </button>
                )
              )}
            </div>

            {plans && market != null ? (
              <div className="cbuy-plans">
                <p className="cbuy-verdict">
                  {plans.wash ? (
                    <>
                      <b>It's a wash.</b> Completing the transmute and buying land within{' '}
                      {moneyCalc(WASH_THRESHOLD)} of each other
                      {holdsGoods ? ' — buying gets you the token today and keeps your goods.' : '.'}
                    </>
                  ) : plans.best === 'build' ? (
                    <>
                      <b>Complete the transmute.</b> The {moneyCalc(finAvg)} left to buy is about{' '}
                      {money0(plans.delta)} under the {moneyCalc(market)} asking price.
                    </>
                  ) : (
                    <>
                      <b>Buy it.</b> At {moneyCalc(market)} it's about {money0(plans.delta)} under the{' '}
                      {moneyCalc(finAvg)} left to complete
                      {holdsGoods ? ', and your trade goods stay in the drawer for the next craft.' : '.'}
                    </>
                  )}
                </p>

                <ul className="cbuy-opts">
                  {plans.paths.map((p) => (
                    <li key={p.key} className={p.key === plans.best && !plans.wash ? 'win' : ''}>
                      <span className="cbo-name">{pathName(p.key, holdsGoods)}</span>
                      <span className="cbo-cost">{moneyCalc(p.cost)}</span>
                      <span className="cbo-how">
                        {p.key === 'build'
                          ? needUnits > 0
                            ? `buy the ${needUnits} ingredient${needUnits === 1 ? '' : 's'} you're still short`
                            : 'you already hold everything it takes'
                          : holdsGoods
                            ? 'and your trade goods stay yours'
                            : 'straight off the secondary market'}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* How much more loot until crafting overtakes buying. The
                    "to go" figure is the same magnitude as the gap above, but
                    it answers a different question — keep playing, or buy the
                    rest now — and the bar makes "am I close?" readable at a
                    glance. Whole dollars throughout: these are estimates of a
                    target, and "about $10.11" argues with itself. */}
                {gapWorthShowing && (
                  <div className="cbuy-gap">
                    <p className="cbuy-gap-lead">
                      About {money0(toGo)} of trade goods to go
                    </p>
                    {/* An empty bar says nothing a "you're at $0" doesn't; it
                        appears once there is progress to draw. */}
                    {holdsGoods && (
                      <div
                        className="cbuy-bar"
                        role="img"
                        aria-label={`Holding ${money0(provideAvg)} of the ${money0(breakEven)} needed before completing the transmute beats buying`}
                      >
                        <span style={{ width: `${Math.round(Math.min(1, provideAvg / breakEven) * 100)}%` }} />
                      </div>
                    )}
                    <p className="cbuy-gap-note">
                      Completing the transmute gets cheaper than buying once you're holding about{' '}
                      {money0(breakEven)} of this recipe — you're at {money0(provideAvg)}.
                      Loot can close that gap for free.
                    </p>
                  </div>
                )}

                {plans.sellAndBuyNet != null && (
                  <p className="cbuy-note">
                    {/* Whole dollars throughout the sentence: mixing moneyCalc's
                        cents-under-$100 rule with its no-cents-above leaves
                        figures that don't reconcile on screen. */}
                    <b>Selling instead?</b> Your goods would fetch about{' '}
                    {range(quick.low, quick.high)},{' '}
                    {plans.sellAndBuyNet.high <= 0 ? (
                      // Worth more than the token even at fire-sale prices:
                      // selling covers the purchase outright and leaves change.
                      // A negative "cost" reads as an error, so it becomes a
                      // profit in the green the comparison tables use.
                      <>
                        netting a{' '}
                        <span className="cbuy-profit">
                          {range(-plans.sellAndBuyNet.high, -plans.sellAndBuyNet.low)} profit
                        </span>
                      </>
                    ) : plans.sellAndBuyNet.low >= 0 ? (
                      <>bringing the buy down to {range(plans.sellAndBuyNet.low, plans.sellAndBuyNet.high)}</>
                    ) : (
                      // The range straddles the asking price — a good sale clears
                      // it with change, a poor one leaves a bill.
                      <>
                        leaving {money0(plans.sellAndBuyNet.high)} to pay if they go cheap, or a{' '}
                        <span className="cbuy-profit">
                          {money0(-plans.sellAndBuyNet.low)} profit
                        </span>{' '}
                        if they sell well
                      </>
                    )}{' '}
                    — but they could take a lot of time and effort to sell, with no promise they all
                    move. Plus, then you don't have them for a different recipe.
                  </p>
                )}

                {!holdsGoods && (
                  <p className="cbuy-note">
                    From scratch, buying almost always beats crafting — crafted tokens rarely sell
                    for more than their materials cost. This gets interesting once you're holding
                    trade goods: mark what you've pulled and watch the gap close.
                  </p>
                )}

                <p className={`cbuy-note${minBeatsVerdict ? ' flag' : ''}`}>
                  {minWorthSaying ? (
                    minBeatsVerdict ? (
                      <>
                        Compared at average prices — but at <b>minimum</b> prices completing the
                        transmute costs {moneyCalc(finMin)}, which beats every option here.
                      </>
                    ) : (
                      <>
                        Compared at average prices. At <b>minimum</b> prices completing the
                        transmute costs {moneyCalc(finMin)}.
                      </>
                    )
                  ) : (
                    <>Compared at average prices.</>
                  )}
                </p>
                {unpricedNeeded > 0 && (
                  <p className="calc-warn">
                    {unpricedNeeded} needed ingredient{unpricedNeeded === 1 ? '' : 's'}{' '}
                    {unpricedNeeded === 1 ? 'has' : 'have'} no price, so cost to finish is
                    understated and this comparison leans toward building.
                  </p>
                )}
              </div>
            ) : (
              <p className="cbuy-hint">
                Enter what the finished token sells for and we'll weigh completing the transmute
                against just buying it — and show how much more loot it takes before crafting wins.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="calc-empty">
          <p>Pick a recipe to start building.</p>
          <button type="button" className="calc-browse big" onClick={() => setDrawerOpen(true)}>Browse recipes</button>
        </div>
      )}

      {/* Slide-in recipe picker. */}
      <div className={`calc-scrim${drawerOpen ? ' on' : ''}`} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <aside className={`calc-drawer${drawerOpen ? ' on' : ''}`} aria-label="Browse recipes" aria-hidden={!drawerOpen}>
        <div className="calc-dhead">
          <b>Recipes</b>
          <button type="button" className="calc-dx" aria-label="Close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div className="calc-dbody">
          <label className="search">
            <span className="sr-only">Search recipes</span>
            <input type="text" placeholder="Search recipes" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="calc-tiers" role="group" aria-label="Filter by tier">
            {tiers.map((t) => (
              <button key={t} type="button" className={`calc-tchip${t === tier ? ' on' : ''}`}
                aria-pressed={t === tier} onClick={() => setTier(t)}>{t}</button>
            ))}
          </div>
          <div className="calc-dlist">
            {drawerYears.length === 0 ? (
              <p className="empty">No recipes match.</p>
            ) : (
              drawerYears.map(({ year, items }) => {
                const count = items.reduce((n, it) => n + (it.type === 'pair' ? 2 : 1), 0);
                const open = isYearOpen(year);
                return (
                  <div key={year} className="calc-dyear">
                    <button type="button" className="calc-yhead" aria-expanded={open} onClick={() => toggleYear(year)}>
                      <i className="calc-chev" aria-hidden="true">▸</i>
                      <span className="calc-yv">{year}</span>
                      <span className="calc-yc">{count} recipe{count === 1 ? '' : 's'}</span>
                    </button>
                    {open && (
                      <div className="calc-ysec">
                        {items.map((it, idx) =>
                          it.type === 'pair' ? (
                            <div key={it.upgrade.key} className="calc-pair">
                              {optRow(it.source)}
                              {optRow(it.upgrade, { indented: true, from: it.source.displayName })}
                            </div>
                          ) : (
                            <div key={it.cost.key + idx}>{optRow(it.cost)}</div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
