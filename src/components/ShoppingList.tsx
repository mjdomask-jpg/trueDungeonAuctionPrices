import { useMemo, useState } from 'react';
import { RecipeDrawer } from './RecipeDrawer';
import { buildShoppingList, type ShoppingPick } from '../lib/shoppingList';
import { moneyCalc } from '../lib/format';
import type { IngredientPath } from '../lib/substitutions';
import type { BuildCost, CostEngine } from '../lib/transmutes';

// The Shopping List — a quartermaster's view over many recipes at once.
//
// The Build Calculator answers "should I build THIS one or buy it?". This
// answers "across everything I plan to make, what do I still have to buy and
// what will it cost?" — which players keep in personal spreadsheets today.
//
// Step 2 of the build: the selection surface. Picking, quantities, pausing and
// removing all work end to end and feed `lib/shoppingList.ts`; the two
// ingredient tables that consume its rows land in step 3, so the totals bar is
// currently the only thing reading them.
//
// PRICING IS NOT NEGOTIABLE HERE. The parent builds this view's engine with
// `basis: 'today'` and no pinned price year, because the whole premise is that
// you are buying these ingredients now. The Recipes view's basis selector is
// deliberately absent (D8/D11); the last-5 toggle comes along, because "what
// does it cost now" still has to choose which sales say so.

/** How many chips show before the strip collapses. Past eight the selection
 *  stops reading as a row of tokens and starts reading as a wall, and the list
 *  below it is the thing that should own the screen. */
const CHIP_LIMIT = 8;

type Pick = { key: string; qty: number };

export function ShoppingList({ engine, path }: { engine: CostEngine; path: IngredientPath }) {
  // An ARRAY, not a Map: the chips read in the order they were added, which is
  // the order the reader built the plan in. A Map would key-order them.
  const [picks, setPicks] = useState<Pick[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chipsExpanded, setChipsExpanded] = useState(false);

  const byKey = useMemo(() => {
    const m = new Map<string, BuildCost>();
    for (const c of engine.allCosts()) m.set(c.key, c);
    return m;
  }, [engine]);

  const selectedKeys = useMemo(() => new Set(picks.map((p) => p.key)), [picks]);
  const quantities = useMemo(() => new Map(picks.map((p) => [p.key, p.qty])), [picks]);

  // Re-picking an ADDS one rather than toggling off. The most likely accidental
  // input on a picker you are meant to tap repeatedly is a double-tap, and
  // remove-on-repeat makes that destructive — you lose a quantity you typed.
  // The ✕ is the only thing that removes.
  const add = (c: BuildCost) =>
    setPicks((prev) => prev.some((p) => p.key === c.key)
      ? prev.map((p) => (p.key === c.key ? { ...p, qty: p.qty + 1 } : p))
      : [...prev, { key: c.key, qty: 1 }]);

  // Floors at 0, and 0 is a real state: a paused recipe keeps its place in the
  // plan so you can park one without losing where it sat.
  const setQty = (key: string, qty: number) =>
    setPicks((prev) => prev.map((p) => (p.key === key ? { ...p, qty: Math.max(0, qty) } : p)));

  const remove = (key: string) => setPicks((prev) => prev.filter((p) => p.key !== key));

  const shopping = useMemo(() => {
    const items: ShoppingPick[] = [];
    for (const p of picks) {
      const cost = byKey.get(p.key);
      if (cost) items.push({ cost, qty: p.qty });
    }
    return buildShoppingList(items, engine, { path });
  }, [picks, byKey, engine, path]);

  const making = picks.filter((p) => p.qty > 0);
  const paused = picks.filter((p) => p.qty <= 0);
  const tokens = making.reduce((t, p) => t + p.qty, 0);

  // Newest season the reader is likely to be shopping for, matching the
  // calculator's default rather than the 2027 preview at the top of the list.
  const focusYear = engine.prices.latestPriced;

  const visible = chipsExpanded ? picks : picks.slice(0, CHIP_LIMIT);
  const hidden = picks.length - visible.length;

  const chip = (p: Pick) => {
    const cost = byKey.get(p.key);
    if (!cost) return null;
    const off = p.qty <= 0;
    return (
      <span key={p.key} className={`sl-chip${off ? ' off' : ''}`}>
        <span className="sl-chip-nm" title={cost.displayName}>{cost.displayName}</span>
        <span className="sl-step" role="group" aria-label={`Quantity of ${cost.displayName}`}>
          <button type="button" onClick={() => setQty(p.key, p.qty - 1)}
            aria-label={`One fewer ${cost.displayName}`} disabled={p.qty <= 0}>−</button>
          <b aria-live="off">{p.qty}</b>
          <button type="button" onClick={() => setQty(p.key, p.qty + 1)}
            aria-label={`One more ${cost.displayName}`}>+</button>
        </span>
        <button type="button" className="sl-chip-x" onClick={() => remove(p.key)}
          aria-label={`Remove ${cost.displayName}`}>✕</button>
      </span>
    );
  };

  return (
    <div className="shopping">
      {picks.length === 0 ? (
        <div className="calc-empty">
          <p>Pick the transmutes you plan to make and we'll work out what to buy.</p>
          <button type="button" className="calc-browse big" onClick={() => setDrawerOpen(true)}>
            Browse recipes
          </button>
        </div>
      ) : (
        <>
          <div className="sl-bar">
            <div className="sl-sum">
              <b>{tokens}</b> token{tokens === 1 ? '' : 's'} from <b>{making.length}</b>{' '}
              recipe{making.length === 1 ? '' : 's'}
              {/* Paused recipes are counted separately rather than folded into
                  the headline: they are still part of the plan, and a summary
                  that silently omitted them would not add up to what is on
                  screen. */}
              {paused.length > 0 && <span className="sl-paused"> · {paused.length} paused</span>}
            </div>
            <div className="sl-total">
              <span className="sl-total-l">Still to buy</span>
              <b>{moneyCalc(shopping.totals.grandAvg)}</b>
            </div>
          </div>

          <div className="sl-chips">
            {visible.map(chip)}
            {hidden > 0 && (
              <button type="button" className="sl-more" onClick={() => setChipsExpanded(true)}>
                +{hidden} more
              </button>
            )}
            {chipsExpanded && picks.length > CHIP_LIMIT && (
              <button type="button" className="sl-more" onClick={() => setChipsExpanded(false)}>
                Show fewer
              </button>
            )}
            <button type="button" className="calc-browse" onClick={() => setDrawerOpen(true)}>
              + Add recipe
            </button>
          </div>

          {/* Step 3 fills this in. Kept as an explicit placeholder rather than
              an empty div so the view is honest about being half-built. */}
          <p className="empty sl-todo">
            {shopping.totals.rows} ingredient row{shopping.totals.rows === 1 ? '' : 's'} to buy —
            {' '}{shopping.trade.length} trade good{shopping.trade.length === 1 ? '' : 's'} and{' '}
            {shopping.additional.length} other item{shopping.additional.length === 1 ? '' : 's'}.
            The tables land next.
          </p>
        </>
      )}

      <RecipeDrawer
        engine={engine}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        selectedKeys={selectedKeys}
        onPick={add}
        focusYear={focusYear}
        quantities={quantities}
        onQuantityChange={setQty}
      />
    </div>
  );
}
