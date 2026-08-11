import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { moneyCalc } from '../lib/format';
import { Money } from './Money';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { orderSeason, tierAbbrev, type BuildCost, type CostEngine, type PricedLine } from '../lib/transmutes';

// Build Calculator (Phase 2 of the transmutes expansion plan) — compact redesign.
//
// One screen, no page swaps. A slide-in drawer picks the recipe (years collapse,
// source Relics stay paired with the Legendary they upgrade into — same ordering
// as the Recipes view); the chosen recipe fills a dense table where you enter what
// you already own and read what finishing the craft still costs. Nothing ever
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

type Override = { avg: number | null; min: number | null };
type PickItem =
  | { type: 'pair'; source: BuildCost; upgrade: BuildCost }
  | { type: 'single'; cost: BuildCost };

// Tier display order for the drawer's filter chips (game power ladder).
const TIER_ORDER = ['Relic', 'Legendary', 'Arcanum', 'Eldritch', 'Enhanced', 'Exalted', 'Mythic', 'Safehold', 'Ultra Rare', 'Paragon', 'Omni'];

// Money always shows both cents digits ($10.60, not $10.6); parsing rounds to
// cents so a stored override never carries a longer tail than it displays.
const fmt2 = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));
const parsePrice = (s: string): number | null => {
  const t = s.trim();
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

  // A fresh recipe starts clean — no on-hand carried over, no stale overrides.
  useEffect(() => {
    setOnHand({});
    setOverrides({});
    setEditing(null);
  }, [selectedKey]);

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
  const src = cost?.lines.find((l) => l.isSource);

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
      <div className="calc-bar">
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
            <span className="calc-spend">
              <span className="calc-spend-lab">Cost to finish</span>
              <span className="calc-spend-val">
                <b><Money format={moneyCalc} value={finAvg} /></b> <span className="calc-min">min <Money format={moneyCalc} value={finMin} /></span>
              </span>
            </span>
          </>
        )}
      </div>

      {cost ? (
        <div className="calc-panel">
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

          <div className="calc-foot">
            <div className="calc-foot-row total">
              <span>Cost to finish</span>
              <span><b><Money format={moneyCalc} value={finAvg} /></b> <span className="calc-min">min <Money format={moneyCalc} value={finMin} /></span></span>
            </div>
            <div className="calc-foot-row">
              <span>You're providing</span>
              <span>{moneyCalc(provideAvg)} of materials</span>
            </div>
            <p className="calc-foot-note">
              Full build from scratch {moneyCalc(fullAvg)} (min {moneyCalc(fullMin)}).
              {src && <> Own the {src.displayName}? Hit <b>All</b> on its row for the upgrade-only price.</>}
            </p>
            {unpricedNeeded > 0 && (
              <p className="calc-warn">
                {unpricedNeeded} ingredient{unpricedNeeded === 1 ? '' : 's'} you still need
                {unpricedNeeded === 1 ? ' has' : ' have'} no price and {unpricedNeeded === 1 ? "isn't" : "aren't"} in the total.
              </p>
            )}
            {cost.marketAvg != null && (
              <p className="calc-buy-note">
                This token also sells at auction for about {moneyCalc(cost.marketAvg)}
                {finAvg <= cost.marketAvg
                  ? ` — finishing the craft (${moneyCalc(finAvg)}) is cheaper.`
                  : ` — cheaper than the ${moneyCalc(finAvg)} left to build.`}
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
