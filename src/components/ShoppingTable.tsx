import { useState } from 'react';
import { Money } from './Money';
import { PriceInput } from './PriceInput';
import { moneyCalc } from '../lib/format';
import { noteLabel, stalenessNote, lotHintFor, type ShoppingNote, type ShoppingRow } from '../lib/shoppingList';

// One of the Shopping List's two ingredient tables.
//
// The row SHAPE is the Build Calculator's, class for class (`calc-line`,
// `cl-main` and friends). That is deliberate and it is the decision, not
// laziness: the calculator's five-column grid and its phone reflow are already
// proven on this data, and a second table that merely resembled it would drift
// from it within a season — the same reasoning that lifted `RecipeDrawer` out
// of the calculator rather than copying it.
//
// Two things differ, and both are decisions rather than omissions:
//
//   NO MIN COLUMN (D3). The calculator carries avg and min side by side; here
//   min is a footnote total under the whole list, and the price editor edits
//   ONE number. Two editable prices per row over fourteen goods is a lot of
//   input for a figure that only ever appears in a footnote.
//
//   ON HAND DOES NOT CLAMP (D2). The calculator caps what you own at what the
//   recipe needs, because there "on hand" is part of one build. Here a stash is
//   a fact about the player: typing 40 Gold Bars and then removing a recipe
//   must not silently destroy the 40. Surplus shows as "N spare" instead.

export type PriceEdit = { rowId: string | null; set: (id: string | null) => void };

/** How many "For X ×N" notes a row shows before the rest collapse behind a
 *  count. Six recipes already produce a five-clause line that wraps twice on a
 *  phone; twenty would be a paragraph. Two is enough to show what KIND of thing
 *  wants the good, which is what the line is scanned for — the full breakdown
 *  is one tap away and both exports carry it whatever this is set to.
 *
 *  Only the per-recipe notes count against it. `Price adjusted`, `N spare`,
 *  `Out of print` and the netting note are status — they say something about
 *  the row itself and there is at most one of each, so hiding them behind a
 *  count would trade a wall for a puzzle. */
const RECIPE_NOTE_LIMIT = 2;

const isRecipeNote = (n: ShoppingNote) => n.kind === 'for' || n.kind === 'sourceFor';

export function ShoppingTable({
  title, hint, rows, showCategory = false, editing, onHand, setOnHand, setOnHandMany,
  setOverride, clearOverride,
}: {
  title: string;
  hint?: string;
  rows: readonly ShoppingRow[];
  showCategory?: boolean;
  editing: PriceEdit;
  onHand: (id: string) => number;
  setOnHand: (id: string, n: number) => void;
  /** One state update for the whole table, so All/None over fourteen goods is
   *  a single render rather than fourteen. */
  setOnHandMany: (entries: [string, number][]) => void;
  setOverride: (id: string, n: number | null) => void;
  clearOverride: (id: string) => void;
}) {
  // Which rows have their per-recipe notes expanded. Per TABLE, not global:
  // the two tables are rendered from separate instances, and an expander is a
  // fact about the screen — it is deliberately not part of the saved plan.
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(() => new Set());
  if (rows.length === 0) return null;
  const subtotal = rows.reduce((t, r) => t + (r.extAvg ?? 0), 0);

  // A row is COVERED on its total on-hand, which includes whatever D5's
  // netting is contributing; but All only ever writes the TYPED number, so it
  // fills to what is still missing rather than to the full quantity. Without
  // that, hitting All on a netted row would type in a count the player does
  // not own and show the difference back to them as "N spare".
  const netted = (r: ShoppingRow) => Math.max(0, r.onHand - onHand(r.id));
  const covered = (r: ShoppingRow) => r.onHand >= r.quantity;
  const fillTo = (r: ShoppingRow) => Math.max(onHand(r.id), r.quantity - netted(r));

  // Two-state, like the calculator's: neither side lights while you are
  // part-way through entering what you hold, which says more than a pair of
  // momentary buttons where All lights and None never does.
  const allOwned = rows.every(covered);
  const noneOwned = rows.every((r) => onHand(r.id) === 0);
  const setAll = (full: boolean) =>
    setOnHandMany(rows.map((r) => [r.id, full ? fillTo(r) : 0]));

  const toggleNotes = (id: string) =>
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <section className="sl-table">
      <div className="sl-thead">
        <h3>
          {title} <span className="sl-count">{rows.length}</span>
          {hint && <span className="sl-thint">{hint}</span>}
        </h3>
        <div className="sl-thead-r">
          {/* The calculator's control, shape for shape — and the master form of
              the pill on every row below, which is the relationship it should
              read as. */}
          <span className="calc-tool">
            <span className="calc-tool-lab">On hand</span>
            <span className="calc-seg">
              <button type="button" data-label="All" className={allOwned ? 'on' : undefined}
                aria-pressed={allOwned} aria-label={`Own all ${title.toLowerCase()}`}
                onClick={() => setAll(true)}>All</button>
              <button type="button" data-label="None" className={noneOwned ? 'on' : undefined}
                aria-pressed={noneOwned} aria-label={`Own none of the ${title.toLowerCase()}`}
                onClick={() => setAll(false)}>None</button>
            </span>
          </span>
          <span className="sl-sub">
            <span className="sl-sub-l">Subtotal</span> <b><Money format={moneyCalc} value={subtotal} /></b>
          </span>
        </div>
      </div>

      <div className="calc-lhead">
        <span>Ingredient</span><span className="h-hand">on hand</span><span>buy</span>
        <span>$/ea <i className="cl-edit-i" aria-hidden="true">✎</i></span><span>cost</span>
      </div>

      {rows.map((r) => {
        const have = onHand(r.id);
        const open = editing.rowId === r.id;
        const crafting = netted(r);
        // A row that D5's toggle covers on its own has nothing left for the
        // player to own, so its pill would be a control with no second state.
        const nothingToOwn = r.quantity - crafting <= 0;
        const recipeNotes = r.notes.filter(isRecipeNote);
        const notesOpen = openNotes.has(r.id);
        const overLimit = recipeNotes.length > RECIPE_NOTE_LIMIT;
        const capped = overLimit && !notesOpen;
        // Identity comparison against the row's own array, so the cap falls on
        // the LAST recipe notes and the status notes around them keep their
        // places in the closed vocabulary's order.
        const shownNotes = capped
          ? r.notes.filter((n) => !isRecipeNote(n) || recipeNotes.indexOf(n) < RECIPE_NOTE_LIMIT)
          : r.notes;
        // The expander goes at the end of the RECIPE run, not at the end of
        // the line: after "41 spare" it reads as if the two hidden entries
        // were more spares. Status notes that sort after the recipes follow it.
        const lastRecipe = shownNotes.reduce((at, n, i) => (isRecipeNote(n) ? i : at), -1);
        const noteText = shownNotes.slice(0, lastRecipe + 1).map(noteLabel).join(' · ');
        const tailText = shownNotes.slice(lastRecipe + 1).map(noteLabel).join(' · ');
        return (
          <div key={r.id} className={`calc-line sl-line${r.need === 0 && r.unitAvg !== null ? ' done' : ''}`}>
            <div className="cl-main">
              <span className="cl-name">
                <span className="cl-good">
                  {r.quantity} × {r.displayName}
                  {showCategory && <span className="sl-cat">{r.category}</span>}
                </span>
                <span className="cl-meta">
                  {noteText}
                  {/* The per-recipe breakdown past the second entry. Six
                      recipes already make this line wrap twice on a phone. */}
                  {/* The separator sits OUTSIDE the button. Inside, it renders
                      underlined and clickable as though the dot were part of
                      the control, and its leading space collapses — the line
                      reads "×15· +2 more". */}
                  {overLimit && (
                    <>
                      {noteText ? ' · ' : ''}
                      <button type="button" className="sl-note-more" aria-expanded={notesOpen}
                        aria-label={`${notesOpen ? 'Hide' : 'Show'} all ${recipeNotes.length} recipes using ${r.displayName}`}
                        onClick={() => toggleNotes(r.id)}>
                        {capped ? `+${recipeNotes.length - RECIPE_NOTE_LIMIT} more` : 'fewer'}
                      </button>
                    </>
                  )}
                  {tailText && `${noteText || overLimit ? ' · ' : ''}${tailText}`}
                  {/* Phones hide the $/ea column and read the price here
                      instead, exactly as the calculator's row does. */}
                  <button type="button" className="cl-price-m" aria-expanded={open}
                    aria-label={`Edit unit price: ${r.displayName}`}
                    onClick={() => editing.set(open ? null : r.id)}>
                    {noteText || overLimit || tailText ? ' · ' : ''}
                    {r.unitAvg === null ? 'no price' : `${moneyCalc(r.unitAvg)} ea`}
                    <i className="cl-edit-i" aria-hidden="true">✎</i>
                  </button>
                </span>
                {/* Rendered from `stalenessNote` rather than assembled here, for
                    the same reason the notes are: step 4's Copy and CSV carry
                    this sentence too, and a spreadsheet that disagreed with the
                    page would be worse than one with no flag at all. It already
                    ends "this one is moving", so it needs no label in front of
                    it — that would say the same thing twice. */}
                {r.staleness && (
                  <span className="sl-stale">{stalenessNote(r.staleness, moneyCalc)}</span>
                )}
                {/* Trade 1 tokens are mostly auctioned as 10x bundles, so the
                    number in the "buy" column is not a number you can actually
                    ask for. A HINT only — it never moves a total, because
                    auctions still sell singles and rounding fourteen goods up
                    to lots would inflate a small plan by a third. */}
                {(() => {
                  const lot = lotHintFor(r);
                  if (!lot) return null;
                  return (
                    <span className="sl-lot">
                      usually sold in 10x lots — <b>{lot.lots}</b> lot{lot.lots === 1 ? '' : 's'}
                      {lot.over > 0 && <> gets you {lot.tokens}, {lot.over} more than you need</>}
                    </span>
                  );
                })()}
              </span>

              <span className="cl-hand">
                {/* The master control's per-row form, and the calculator's
                    pill exactly — one button whose label flips, so it reports
                    the row's state as well as setting it. Disabled where
                    netting already covers the row: there is no second state to
                    toggle to, and the badge beside it says why. */}
                <button type="button" className={`calc-all${covered(r) ? ' on' : ''}`}
                  aria-pressed={covered(r)} disabled={nothingToOwn}
                  aria-label={covered(r) ? `Own none: ${r.displayName}` : `Own all ${r.quantity}: ${r.displayName}`}
                  onClick={() => setOnHand(r.id, covered(r) ? 0 : fillTo(r))}>
                  {covered(r) ? 'None' : 'All'}
                </button>
                <span className="cl-stepper">
                  <button type="button" className="cl-step" disabled={have <= 0}
                    aria-label={`One fewer on hand: ${r.displayName}`}
                    onClick={() => setOnHand(r.id, have - 1)}>−</button>
                  {/* type=text, not number: number inputs cannot select(), and
                      on iOS a tap drops the caret before the 0 so "2" becomes
                      "20". inputMode keeps the numeric keypad. */}
                  <input type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next"
                    aria-label={`On hand: ${r.displayName}`} value={have}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setOnHand(r.id, e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)} />
                  {/* NOT disabled at the required quantity — D2. Owning more
                      than the plan needs is a fact worth recording. */}
                  <button type="button" className="cl-step"
                    aria-label={`One more on hand: ${r.displayName}`}
                    onClick={() => setOnHand(r.id, have + 1)}>+</button>
                </span>
                {/* D5's contribution, shown where the arithmetic is. The box
                    beside it holds what the player TYPED, so a netted row
                    otherwise reads "on hand 0, needed 3, buy 1" with the
                    missing two explained nowhere on the row. */}
                {crafting > 0 && (
                  <span className="sl-netted">+{crafting} crafting</span>
                )}
              </span>

              <span className="cl-buy">
                {r.need > 0 ? r.need : <span className="cl-check" aria-label="covered">✓</span>}
              </span>

              <span className="cl-unit">
                <button type="button" className="cl-price-d" aria-expanded={open}
                  aria-label={`Unit price ${r.unitAvg === null ? 'unpriced' : moneyCalc(r.unitAvg)} — edit`}
                  onClick={() => editing.set(open ? null : r.id)}>
                  {r.unitAvg === null ? '—' : moneyCalc(r.unitAvg)}
                  {r.overridden && <i className="cl-ovdot" aria-hidden="true" />}
                  <i className="cl-edit-i" aria-hidden="true">✎</i>
                </button>
              </span>

              <span className="cl-fin">
                {r.unitAvg === null ? (
                  <span className="cl-noprice">no price</span>
                ) : r.need > 0 ? (
                  <b><Money format={moneyCalc} value={r.extAvg} /></b>
                ) : (
                  <span className="cl-covered">covered</span>
                )}
              </span>
            </div>

            {open && (
              <div className="cl-editor">
                <span className="cl-editor-hint">Your price:</span>
                <label>
                  each
                  <span className="cl-money-in"><span className="cl-dollar">$</span>
                    <PriceInput ariaLabel={`Your price: ${r.displayName}`} value={r.unitAvg}
                      onChange={(n) => setOverride(r.id, n)} /></span>
                </label>
                {r.overridden && (
                  <button type="button" className="cl-reset" onClick={() => clearOverride(r.id)}>
                    Reset to {r.baseAvg === null ? '—' : moneyCalc(r.baseAvg)}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
