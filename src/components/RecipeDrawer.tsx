import { useMemo, useState } from 'react';
import { moneyCalc } from '../lib/format';
import { orderSeason, type BuildCost, type CostEngine } from '../lib/transmutes';

// The slide-in recipe picker, lifted out of BuildCalculator so the Shopping List
// can use the same one rather than a copy that drifts from it within a season.
//
// The drawer owns its own filter state — search, tier, show-expired, which years
// are expanded. Those are facts about the picker, not about whatever is being
// built with it, and hoisting them into two different parents is how the two
// copies would have diverged in the first place.
//
// What the PARENT owns is the selection, because that is the only part the two
// views disagree about: the calculator holds exactly one recipe and closes on
// pick; the Shopping List holds many with quantities and stays open. So the
// drawer takes a set of selected keys (it only needs to know which rows to light
// up) and hands back the recipe that was clicked. Whether that closes anything
// is the parent's business.

type PickItem =
  | { type: 'pair'; source: BuildCost; upgrade: BuildCost }
  | { type: 'single'; cost: BuildCost };

// Tier display order for the drawer's filter chips (game power ladder).
const TIER_ORDER = ['Relic', 'Legendary', 'Arcanum', 'Eldritch', 'Enhanced', 'Exalted', 'Mythic', 'Safehold', 'Ultra Rare', 'Paragon', 'Omni'];

export type RecipeDrawerProps = {
  engine: CostEngine;
  open: boolean;
  onClose: () => void;
  /** Keys of recipes already chosen — these rows light up. A single-selection
   *  caller passes a one-entry set. */
  selectedKeys: ReadonlySet<string>;
  onPick: (cost: BuildCost) => void;
  /** Which year is expanded before the reader touches anything. The calculator
   *  passes the current recipe's season, falling back to the latest priced one. */
  focusYear: number;
  /** Clear search and tier after a pick. True for a picker that closes on
   *  selection (the calculator); false where the reader is adding several in a
   *  row and would lose their query mid-list. */
  clearFiltersOnPick?: boolean;
};

export function RecipeDrawer({
  engine, open, onClose, selectedKeys, onPick, focusYear, clearFiltersOnPick = false,
}: RecipeDrawerProps) {
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('All');
  const [showExpired, setShowExpired] = useState(false);
  // null = default (only the focus year open); a Set once the user toggles one.
  const [openYears, setOpenYears] = useState<Set<number> | null>(null);

  const all = useMemo(() => engine.allCosts(), [engine]);
  const years = useMemo(() => engine.seasons(), [engine]);
  const tiers = useMemo(() => {
    const present = new Set(all.map((c) => c.level));
    return ['All', ...TIER_ORDER.filter((t) => present.has(t)), ...[...present].filter((t) => !TIER_ORDER.includes(t))];
  }, [all]);

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
        // Expired recipes stay PICKABLE — people audit old builds — they are
        // just out of the way until asked for.
        const costs = all.filter((c) => c.year === year && (showExpired || c.status !== 'expired'));
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
  }, [all, years, q, tier, filtering, showExpired]);

  const expiredCount = useMemo(() => all.filter((c) => c.status === 'expired').length, [all]);

  const pick = (c: BuildCost) => {
    onPick(c);
    if (clearFiltersOnPick) {
      setSearch('');
      setTier('All');
    }
  };

  // --- Drawer option row -------------------------------------------------
  const optRow = (c: BuildCost, opts: { indented?: boolean; from?: string | null } = {}) => (
    <button
      key={c.key}
      type="button"
      className={`calc-opt${opts.indented ? ' leg' : ''}${selectedKeys.has(c.key) ? ' sel' : ''}`}
      onClick={() => pick(c)}
    >
      <span className="tchip" data-tier={c.level}>{c.level}</span>
      <span className="calc-opt-nm">
        {c.displayName}
        {/* Expired recipes are pickable but never a surprise: the tag rides the
            name so it is there in the list and again on the row you land on. */}
        {c.status === 'expired' && <span className="calc-opt-exp">expired</span>}
        {opts.from && <span className="calc-opt-up">↳ upgrades from {opts.from}</span>}
      </span>
      <span className="calc-opt-c">{moneyCalc(c.fullAvg)}</span>
    </button>
  );

  return (
    <>
      <div className={`calc-scrim${open ? ' on' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`calc-drawer${open ? ' on' : ''}`} aria-label="Browse recipes" aria-hidden={!open}>
        <div className="calc-dhead">
          <b>Recipes</b>
          <button type="button" className="calc-dx" aria-label="Close" onClick={onClose}>✕</button>
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
          {expiredCount > 0 && (
            <div className="calc-dfilter">
              <span className="calc-dfilter-lab">
                {showExpired
                  ? `Showing all ${all.length} recipes`
                  : `Showing the ${all.length - expiredCount} active recipes`}
              </span>
              <button type="button" className="calc-dfilter-btn" aria-pressed={showExpired}
                onClick={() => setShowExpired((v) => !v)}>
                {showExpired ? 'Hide expired' : `Show all (+${expiredCount} expired)`}
              </button>
            </div>
          )}
          <div className="calc-dlist">
            {drawerYears.length === 0 ? (
              <p className="empty">No recipes match.</p>
            ) : (
              drawerYears.map(({ year, items }) => {
                const count = items.reduce((n, it) => n + (it.type === 'pair' ? 2 : 1), 0);
                const isOpen = isYearOpen(year);
                return (
                  <div key={year} className="calc-dyear">
                    <button type="button" className="calc-yhead" aria-expanded={isOpen} onClick={() => toggleYear(year)}>
                      <i className="calc-chev" aria-hidden="true">▸</i>
                      <span className="calc-yv">{year}</span>
                      <span className="calc-yc">{count} recipe{count === 1 ? '' : 's'}</span>
                    </button>
                    {isOpen && (
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
    </>
  );
}
