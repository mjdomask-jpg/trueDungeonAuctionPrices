import { useMemo, useState } from 'react';
import { RecipeDrawer } from './RecipeDrawer';
import { ShoppingTable } from './ShoppingTable';
import { Money } from './Money';
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
// Steps 2 and 3: the selection surface, and the two tables that consume it.
// What remains is the combined final table with Copy/CSV (step 4) and
// localStorage (step 5).
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
  // Both keyed by ROW ID, not by recipe or by index. That is what lets a typed
  // number survive its recipe being removed and re-added, and what lets one
  // Darkwood Plank entry serve every recipe that wants Darkwood Planks (D2).
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<string | null>(null);
  // D5. Off by default and reversible: netting silently is how a plan stops
  // being checkable, so this is offered and never assumed.
  const [netCrafted, setNetCrafted] = useState(false);

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
    return buildShoppingList(items, engine, { path, onHand, overrides, netCraftedSources: netCrafted });
  }, [picks, byKey, engine, path, onHand, overrides, netCrafted]);

  const making = picks.filter((p) => p.qty > 0);
  const paused = picks.filter((p) => p.qty <= 0);
  const tokens = making.reduce((t, p) => t + p.qty, 0);

  // Newest season the reader is likely to be shopping for, matching the
  // calculator's default rather than the 2027 preview at the top of the list.
  const focusYear = engine.prices.latestPriced;

  const visible = chipsExpanded ? picks : picks.slice(0, CHIP_LIMIT);
  const hidden = picks.length - visible.length;

  const setHave = (id: string, n: number) =>
    setOnHand((p) => ({ ...p, [id]: Math.max(0, n) }));
  const setOv = (id: string, n: number | null) =>
    setOverrides((p) => (n === null ? p : { ...p, [id]: n }));
  const clearOv = (id: string) =>
    setOverrides((p) => { const { [id]: _drop, ...rest } = p; return rest; });

  const tableProps = {
    editing: { rowId: editing, set: setEditing },
    onHand: (id: string) => Math.max(0, onHand[id] ?? 0),
    setOnHand: setHave,
    setOverride: setOv,
    clearOverride: clearOv,
  };

  // D5's pairs, in the reader's words. `chains` only ever holds rows the list
  // itself contains both halves of, so this is never speculative.
  const chainUnits = shopping.chains.reduce((t, c) => t + Math.min(c.needed, c.crafted), 0);

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

          {/* D5. Adding a Relic AND the Legendary it upgrades into asks you to
              buy the Relic twice, and the drawer lists those pairs adjacently
              so people will hit it. Offered, never applied on its own. */}
          {shopping.chains.length > 0 && (
            <div className={`sl-chain${netCrafted ? ' on' : ''}`}>
              <span>
                {netCrafted ? (
                  <>Counting <b>{chainUnits}</b> item{chainUnits === 1 ? '' : 's'} you are already
                    crafting as on hand — {shopping.chains.map((c) => c.good).join(', ')}.</>
                ) : (
                  <>This list buys <b>{shopping.chains.map((c) => c.good).join(', ')}</b> and also
                    crafts {shopping.chains.length === 1 ? 'it' : 'them'}. Count the ones you are
                    crafting as on hand?</>
                )}
              </span>
              <button type="button" onClick={() => setNetCrafted((v) => !v)}>
                {netCrafted ? 'Undo' : `Count ${chainUnits} as on hand`}
              </button>
            </div>
          )}

          <ShoppingTable
            title="Trade goods"
            hint="one row per good, however many recipes want it"
            rows={shopping.trade}
            {...tableProps}
          />
          <ShoppingTable
            title="Additional items"
            hint="one row per token and season"
            rows={shopping.additional}
            showCategory
            {...tableProps}
          />

          <div className="sl-foot">
            <div className="sl-foot-row total">
              <span>Total still to buy</span>
              <span><b><Money format={moneyCalc} value={shopping.totals.grandAvg} /></b></span>
            </div>
            {/* D3: min is a footnote, not a column. Stating the basis in prose
                rather than doubling every row's width is the Phase 3 precedent
                the calculator's own footer already follows. */}
            <p className="sl-foot-note">
              <Money format={moneyCalc} value={shopping.totals.grandMin} /> at minimum prices —
              what it costs if every good goes for the cheapest it has recently sold at, which is
              a floor rather than a forecast.
              {shopping.totals.unpricedRows > 0 && (
                <> {shopping.totals.unpricedRows} row
                  {shopping.totals.unpricedRows === 1 ? ' has' : 's have'} no price and count as $0.</>
              )}
            </p>
          </div>
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
