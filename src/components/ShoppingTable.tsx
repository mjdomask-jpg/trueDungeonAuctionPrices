import { useState } from 'react';
import { Money } from './Money';
import { PriceInput } from './PriceInput';
import { ShoppingHandCell, ShoppingSectionHead, type HandProps } from './ShoppingHand';
import { handMath } from '../lib/shoppingHand';
import { moneyCalc } from '../lib/format';
import {
  noteLabel, stalenessNote, lotHintFor, lotHintLabel,
  type ShoppingNote, type ShoppingRow,
} from '../lib/shoppingList';

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
  setOverride, clearOverride, headRight,
}: {
  title: string;
  hint?: string;
  rows: readonly ShoppingRow[];
  showCategory?: boolean;
  editing: PriceEdit;
  setOverride: (id: string, n: number | null) => void;
  clearOverride: (id: string) => void;
  /** The Breakdown toggle, on whichever table renders first. */
  headRight?: React.ReactNode;
} & HandProps) {
  // Which rows have their per-recipe notes expanded. Per TABLE, not global:
  // the two tables are rendered from separate instances, and an expander is a
  // fact about the screen — it is deliberately not part of the saved plan.
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(() => new Set());
  if (rows.length === 0) return null;
  const hand = handMath(rows, onHand);

  const toggleNotes = (id: string) =>
    setOpenNotes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <section className="sl-table">
      <ShoppingSectionHead title={title} hint={hint} rows={rows} hand={hand}
        setOnHandMany={setOnHandMany} right={headRight} />

      <div className="calc-lhead">
        <span>Ingredient</span><span className="h-hand">on hand</span><span>buy</span>
        <span>$/ea <i className="cl-edit-i" aria-hidden="true">✎</i></span><span>cost</span>
      </div>

      {rows.map((r) => {
        const open = editing.rowId === r.id;
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
                {/* Rendered from the lib rather than assembled here, for the
                    same reason the notes are: the pivot shows the same two
                    numbers, and a second view that disagreed with this one
                    would be worse than no flag at all. ONE LINE here, stacked
                    there — this row has the width for it and a 208px item
                    column does not.
                    The two numbers ARE the flag: it only exists because they
                    diverged, and the amber is what marks them as a flag rather
                    than as two more numbers, exactly as `Out of print` is
                    marked by its own colour and nothing else. It must not
                    acquire a direction — trade-good prices follow no reliable
                    seasonal shape, so a forecast is not something this data
                    can support. */}
                {r.staleness && (
                  <span className="sl-stale">{stalenessNote(r.staleness, moneyCalc)}</span>
                )}
              </span>

              <span className="cl-hand">
                <ShoppingHandCell row={r} hand={hand} onHand={onHand} setOnHand={setOnHand} />
              </span>

              <span className="cl-buy">
                {r.need > 0 ? r.need : <span className="cl-check" aria-label="covered">✓</span>}
                {/* Trade 1 tokens are mostly auctioned as 10x bundles, so the
                    number above this one is not a number you can actually ask
                    for. A HINT only — it never moves a total, because auctions
                    still sell singles and rounding fourteen goods up to lots
                    would inflate a small plan by a third.
                    UNDER THE COUNT rather than in a sentence beneath the item
                    name: it fires on 8 of the 14 trade goods, which made
                    near-permanent prose out of a per-row number and restated
                    the general fact — that Trade 1 bundles at all — once per
                    row. The table hint says that part once now, and both views
                    render the arithmetic the same way. */}
                {(() => {
                  const lot = lotHintFor(r);
                  return lot ? <span className="cl-lot">{lotHintLabel(lot)}</span> : null;
                })()}
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
