import { useEffect, useMemo, useRef, useState } from 'react';
import { RecipeDrawer } from './RecipeDrawer';
import { ShoppingTable } from './ShoppingTable';
import { ShoppingPivot } from './ShoppingPivot';
import { ShoppingFinal } from './ShoppingFinal';
import { Money } from './Money';
import { buildShoppingList, type ShoppingPick } from '../lib/shoppingList';
import { loadShopping, saveShopping, clearShopping, type ShoppingView } from '../lib/shoppingStorage';
import { WIDE, useMediaQuery } from '../hooks/useMediaQuery';
import { moneyCalc } from '../lib/format';
import type { IngredientPath } from '../lib/substitutions';
import type { BuildCost, CostEngine } from '../lib/transmutes';

// The Shopping List — a quartermaster's view over many recipes at once.
//
// The Build Calculator answers "should I build THIS one or buy it?". This
// answers "across everything I plan to make, what do I still have to buy and
// what will it cost?" — which players keep in personal spreadsheets today.
//
// Steps 2-5: the selection surface, the two working tables, the takeaway list
// with its exports, and the autosave underneath all of it.
//
// The plan SURVIVES A RELOAD, in localStorage and nowhere else — see
// lib/shoppingStorage.ts for why there is no share link and why a server-side
// code is impossible on static hosting rather than merely unbuilt. What is
// saved is the picks, the on-hand counts, the corrected prices, the netting
// toggle and which BREAKDOWN the tables are drawn in. Everything else here
// describes the screen rather than the plan.
//
// THE BREAKDOWN comes in two shapes and the second is desktop-only. `Notes`
// puts the per-recipe demand under the item name, capped at two with a `+N
// more`; `By recipe` puts it in columns — see ShoppingPivot for why the two
// tables pivot differently and hooks/useMediaQuery.ts for why 1024px.
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
  // Read ONCE, in the initialiser, rather than in an effect: an effect would
  // render the empty list first and then replace it, which reads as the plan
  // having been lost for a frame.
  const saved = useRef(loadShopping()).current;
  const [picks, setPicks] = useState<Pick[]>(saved?.picks ?? []);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  // Both keyed by ROW ID, not by recipe or by index. That is what lets a typed
  // number survive its recipe being removed and re-added, and what lets one
  // Darkwood Plank entry serve every recipe that wants Darkwood Planks (D2).
  const [onHand, setOnHand] = useState<Record<string, number>>(saved?.onHand ?? {});
  const [overrides, setOverrides] = useState<Record<string, number>>(saved?.overrides ?? {});
  const [editing, setEditing] = useState<string | null>(null);
  // D5. Off by default and reversible: netting silently is how a plan stops
  // being checkable, so this is offered and never assumed.
  const [netCrafted, setNetCrafted] = useState(saved?.netCrafted ?? false);
  // The reader's CHOICE, which is not the same as what is on screen. Below
  // WIDE the pivot is not offered and the standard tables render whatever this
  // says — the preference is kept rather than corrected, so a plan read in
  // pivot on a laptop is still in pivot when the laptop comes back.
  const [view, setView] = useState<ShoppingView>(saved?.view ?? 'standard');
  const wide = useMediaQuery(WIDE);
  const pivot = view === 'pivot' && wide;

  // Autosave. Every dependency here is part of the PLAN; which chips are
  // expanded and which price editor is open are facts about the screen and are
  // deliberately absent, so opening a price editor does not write to disk.
  //
  // An EMPTY plan removes the entry rather than storing an empty one. That is
  // not tidiness: this effect runs immediately after Clear, so without the
  // branch it would write `{"picks":[],...}` straight back over the removal and
  // leave a trace of a list the reader had just thrown away.
  useEffect(() => {
    const empty = picks.length === 0 &&
      Object.keys(onHand).length === 0 && Object.keys(overrides).length === 0 && !netCrafted;
    // `view` is deliberately absent from the emptiness test and present in what
    // is written. It rides in the plan's entry, so an emptied plan still leaves
    // NO entry — Clear list resets it alongside everything else, which is what
    // keeps that true.
    if (empty) clearShopping();
    else saveShopping({ picks, onHand, overrides, netCrafted, view });
  }, [picks, onHand, overrides, netCrafted, view]);

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

  // Autosave makes this necessary rather than merely convenient: without it a
  // finished plan follows the reader into next season with no way out but
  // removing twenty chips one at a time. The on-hand counts and corrected
  // prices go with it — they describe THIS plan, and keeping them would seed
  // the next one with numbers nobody typed for it.
  const clearAll = () => {
    setPicks([]);
    setOnHand({});
    setOverrides({});
    setNetCrafted(false);
    setView('standard');
    setEditing(null);
    // The stored entry is removed by the autosave effect above, which sees the
    // emptied state. Calling clearShopping() here as well would be undone by
    // that same effect a moment later.
  };

  const shopping = useMemo(() => {
    const items: ShoppingPick[] = [];
    for (const p of picks) {
      const cost = byKey.get(p.key);
      if (cost) items.push({ cost, qty: p.qty });
    }
    return buildShoppingList(items, engine, { path, onHand, overrides, netCraftedSources: netCrafted });
  }, [picks, byKey, engine, path, onHand, overrides, netCrafted]);

  // A pick whose key no longer resolves to a recipe. The stored plan survives
  // deploys and is hand-editable, so a transmute renamed in the CSV leaves one
  // behind — and an unresolvable pick renders no chip, prices nothing and
  // contributes nothing to the list. It must not be COUNTED either, or the
  // headline reads "9 recipes" over seven chips and "+2 more" reveals nothing.
  // Dropped from the display only: storage keeps it, so a pick stranded by a
  // temporary data change comes back rather than being quietly destroyed.
  const known = picks.filter((p) => byKey.has(p.key));
  const making = known.filter((p) => p.qty > 0);
  const paused = known.filter((p) => p.qty <= 0);
  const tokens = making.reduce((t, p) => t + p.qty, 0);

  // Newest season the reader is likely to be shopping for, matching the
  // calculator's default rather than the 2027 preview at the top of the list.
  const focusYear = engine.prices.latestPriced;

  const visible = chipsExpanded ? known : known.slice(0, CHIP_LIMIT);
  const hidden = known.length - visible.length;

  const setHave = (id: string, n: number) =>
    setOnHand((p) => ({ ...p, [id]: Math.max(0, n) }));
  // One update for a whole table's All/None. Merged into the existing record
  // rather than replacing it: the two tables share this state, so writing a
  // fresh object from one table's rows would wipe the other's counts.
  const setHaveMany = (entries: [string, number][]) =>
    setOnHand((p) => {
      const next = { ...p };
      for (const [id, n] of entries) next[id] = Math.max(0, n);
      return next;
    });
  const setOv = (id: string, n: number | null) =>
    setOverrides((p) => (n === null ? p : { ...p, [id]: n }));
  const clearOv = (id: string) =>
    setOverrides((p) => { const { [id]: _drop, ...rest } = p; return rest; });

  const tableProps = {
    editing: { rowId: editing, set: setEditing },
    onHand: (id: string) => Math.max(0, onHand[id] ?? 0),
    setOnHand: setHave,
    setOnHandMany: setHaveMany,
    setOverride: setOv,
    clearOverride: clearOv,
  };

  // D5's pairs, in the reader's words. `chains` only ever holds rows the list
  // itself contains both halves of, so this is never speculative.
  // `netted` is what the toggle actually contributes — capped at what each row
  // still lacks — so the offer, the applied banner and the per-row badges all
  // quote one number. It can be 0 when the reader has already typed in enough
  // of the source by hand, and the copy drops the count rather than offering
  // to count nothing.
  const chainUnits = shopping.chains.reduce((t, c) => t + c.netted, 0);

  // The Breakdown toggle. It governs both working tables, the takeaway table
  // and both exports, so no ONE table owns it — but it lived in the summary
  // bar first and was two sections away from anything it changed, which made
  // it hard to find. It rides in the header of whichever table renders FIRST
  // instead: beside the master On hand control, in the place the reader is
  // already looking when the breakdown is the thing bothering them.
  //
  // "Whichever renders first" rather than "Trade goods", because an empty
  // table returns null — a plan of recipes that wanted no trade goods would
  // take the toggle down with it.
  const viewToggle = wide ? (
    <span className="sl-view">
      <span className="sl-view-l">Breakdown</span>
      {/* `data-label` on every toggle button — the site rule: it feeds the
          invisible bold ghost that reserves each button's active width, so the
          control does not resize as the selection moves. */}
      <span className="toggle-buttons" role="group" aria-label="Ingredient table layout">
        <button type="button" data-label="Notes"
          className={view === 'standard' ? 'on' : undefined}
          aria-pressed={view === 'standard'} onClick={() => setView('standard')}>
          Notes
        </button>
        <button type="button" data-label="By recipe"
          className={view === 'pivot' ? 'on' : undefined}
          aria-pressed={view === 'pivot'} onClick={() => setView('pivot')}>
          By recipe
        </button>
      </span>
    </span>
  ) : null;
  const toggleOn = shopping.trade.length > 0 ? 'trade' : 'additional';

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
      {known.length === 0 ? (
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
            {chipsExpanded && known.length > CHIP_LIMIT && (
              <button type="button" className="sl-more" onClick={() => setChipsExpanded(false)}>
                Show fewer
              </button>
            )}
            <button type="button" className="calc-browse" onClick={() => setDrawerOpen(true)}>
              + Add recipe
            </button>
            <button type="button" className="sl-clear" onClick={clearAll}>
              Clear list
            </button>
          </div>

          {/* D5. Adding a Relic AND the Legendary it upgrades into asks you to
              buy the Relic twice, and the drawer lists those pairs adjacently
              so people will hit it. Offered, never applied on its own. */}
          {shopping.chains.length > 0 && (
            <div className={`sl-chain${netCrafted ? ' on' : ''}`}>
              <span>
                {netCrafted ? (
                  chainUnits === 0 ? (
                    <>Counting the ones you are already crafting as on hand — but you have
                      already entered enough {shopping.chains.map((c) => c.good).join(', ')} by
                      hand, so this is adding nothing.</>
                  ) : (
                    <>Counting <b>{chainUnits}</b> item{chainUnits === 1 ? '' : 's'} you are already
                      crafting as on hand — {shopping.chains.map((c) => c.good).join(', ')}.</>
                  )
                ) : (
                  <>This list buys <b>{shopping.chains.map((c) => c.good).join(', ')}</b> and also
                    crafts {shopping.chains.length === 1 ? 'it' : 'them'}. Count the ones you are
                    crafting as on hand?</>
                )}
              </span>
              <button type="button" onClick={() => setNetCrafted((v) => !v)}>
                {netCrafted ? 'Undo' : chainUnits === 0 ? 'Count these as on hand' : `Count ${chainUnits} as on hand`}
              </button>
            </div>
          )}

          {pivot ? (
            <>
              {/* MATRIX for the trade goods, because they are dense: 12 to 14
                  of the 14 rows are wanted by more than one recipe at every
                  plan size, and the grid runs 42–64% full. This is the table
                  the pivot exists for. */}
              <ShoppingPivot
                title="Trade goods"
                hint="one row per good, one column per recipe · Trade 1 goods usually sell as 10x lots"
                rows={shopping.trade}
                making={shopping.making}
                breakdown="matrix"
                headRight={toggleOn === 'trade' ? viewToggle : undefined}
                {...tableProps}
              />
              {/* SINGLE column, because these are a diagonal: at 29 picked
                  recipes 31 of 35 rows belong to exactly one, and the matrix
                  is 5% full. See ShoppingPivot's header for the measurement. */}
              <ShoppingPivot
                title="Additional items"
                hint="one row per token and season, with the recipe that wants it"
                rows={shopping.additional}
                making={shopping.making}
                breakdown="single"
                showCategory
                headRight={toggleOn === 'additional' ? viewToggle : undefined}
                {...tableProps}
              />
            </>
          ) : (
            <>
              <ShoppingTable
                title="Trade goods"
                hint="one row per good, however many recipes want it · Trade 1 goods usually sell as 10x lots"
                rows={shopping.trade}
                headRight={toggleOn === 'trade' ? viewToggle : undefined}
                {...tableProps}
              />
              <ShoppingTable
                title="Additional items"
                hint="one row per token and season"
                rows={shopping.additional}
                showCategory
                headRight={toggleOn === 'additional' ? viewToggle : undefined}
                {...tableProps}
              />
            </>
          )}

          <ShoppingFinal list={shopping} pivot={pivot} />

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
        onRemove={remove}
      />
    </div>
  );
}
