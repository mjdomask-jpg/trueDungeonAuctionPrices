import { useState } from 'react';
import { Money } from './Money';
import { PriceInput } from './PriceInput';
import { ShoppingHandCell, ShoppingSectionHead, type HandProps } from './ShoppingHand';
import { handMath } from '../lib/shoppingHand';
import { moneyCalc } from '../lib/format';
import {
  lotHintFor, lotHintLabel, noteLabel, recipesFor, stalenessParts,
  type ShoppingMaking, type ShoppingNote, type ShoppingRow,
} from '../lib/shoppingList';
import type { PriceEdit } from './ShoppingTable';

// The pivot view of an ingredient table: the per-recipe breakdown as COLUMNS
// instead of as a sentence under the item name.
//
// The notes it replaces were the reason the `+N more` expander exists. A row
// wanted by six recipes produced a five-clause line that wrapped twice, and the
// interim answer — show two, hide the rest behind a count — buys legibility by
// hiding the thing the reader opened the row for. A column per recipe shows all
// of it and shows it aligned, which is what makes two recipes' demands
// comparable at a glance rather than by reading.
//
// DESKTOP ONLY, and that is a property of the shape rather than a policy. See
// `WIDE` in hooks/useMediaQuery.ts for the arithmetic: the frozen group costs
// ~670px before a single recipe column is drawn.
//
// TWO SHAPES, because the data has two shapes and only one of them is a matrix.
// Measured over the real corpus:
//
//   TRADE GOODS are dense — 12 to 14 of their 14 rows are wanted by more than
//   one recipe at every plan size, and the grid runs 42–64% full. `matrix`.
//
//   ADDITIONAL ITEMS are a diagonal — at 29 picked recipes, 31 of 35 rows
//   belong to exactly ONE recipe and the grid is 5% full. Twenty-nine columns
//   to carry four rows' worth of shared information is not a pivot, it is a
//   scrollbar. `single` names the one owning recipe in one column, which is
//   what a pivot degenerates to when its matrix is diagonal, and keeps the
//   `+N` expander for the handful of rows that really are shared.
//
// The on-hand controls and the section header are `ShoppingHand`'s, shared with
// `ShoppingTable` rather than reimplemented: the two views are two drawings of
// one plan and must never report a different state for one row.

/** How many recipes the `single` column names before the rest collapse behind a
 *  count — the `+N more` rule from the notes line, applied to the one column
 *  that can still need it. One rather than two: this column is ~150px wide and
 *  the row above it already reads as a list of one. */
const SINGLE_LIMIT = 1;

/** Notes the COLUMNS now carry. Dropping them from the meta line is the whole
 *  point of the view — `For X ×3 · For Y ×15` is the wall the pivot replaces,
 *  and leaving it in place beneath the columns saying the same thing would make
 *  the pivot strictly worse than the table it is offered instead of.
 *
 *  Everything else stays. `Price adjusted`, `N spare`, `Out of print`, the
 *  netting note and `Priced as X` are STATUS — facts about the row itself, one
 *  of each at most, and no column expresses any of them. */
const isRecipeNote = (n: ShoppingNote) => n.kind === 'for' || n.kind === 'sourceFor';

export function ShoppingPivot({
  title, hint, rows, making, breakdown, showCategory = false,
  editing, onHand, setOnHand, setOnHandMany, setOverride, clearOverride, headRight,
}: {
  title: string;
  hint?: string;
  rows: readonly ShoppingRow[];
  /** The columns: every ACTIVE pick, in the order the reader added it. A
   *  recipe no row in this table touches still gets a column, so the two
   *  tables' columns line up and a plan reads the same way in both. */
  making: readonly ShoppingMaking[];
  breakdown: 'matrix' | 'single';
  showCategory?: boolean;
  editing: PriceEdit;
  setOverride: (id: string, n: number | null) => void;
  clearOverride: (id: string) => void;
  /** The Breakdown toggle, on whichever table renders first. */
  headRight?: React.ReactNode;
} & HandProps) {
  const [openFor, setOpenFor] = useState<ReadonlySet<string>>(() => new Set());
  if (rows.length === 0) return null;
  const hand = handMath(rows, onHand);
  const cols = breakdown === 'matrix' ? making : [];
  // Four frozen columns, then one per recipe (or the single `For` column),
  // then $ ea and Cost at the right.
  const span = 4 + (breakdown === 'matrix' ? cols.length : 1) + 2;

  // The floor the table refuses to shrink below, and the reason the frozen
  // columns can be pinned at all: `left` offsets are cumulative pixel values,
  // so the columns they belong to have to have known widths. The FROZEN ones
  // do, in CSS; the recipe columns deliberately do not, so they share whatever
  // is left over — wider than 112px when three recipes have a 1200px page to
  // themselves, exactly 112px once the min-width forces the scroll. Nothing
  // downstream of the frozen group affects a frozen offset either way.
  const minWidth = `calc(var(--pv-frozen) + var(--pv-money) + ${Math.max(1, cols.length || 1)} * 112px)`;

  const toggleFor = (id: string) =>
    setOpenFor((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <section className="sl-table sl-pv-wrap">
      <ShoppingSectionHead title={title} hint={hint} rows={rows} hand={hand}
        setOnHandMany={setOnHandMany} right={headRight} />

      <div className="sl-pv-scroll">
        <table className="sl-pv" style={{ minWidth }}>
          <thead>
            <tr>
              <th scope="col" className="pv-item">Ingredient</th>
              {/* To buy / On hand / Total, in that order and PINNED, because
                  they are what the reader came for. The breakdown informs; it
                  does not get to push the answer off the screen.
                  Four columns, not six: the money used to be pinned here too
                  and the frozen block ran to 682px — half a 1440px screen
                  spent before one recipe column was drawn. $ ea and Cost now
                  ride at the far RIGHT of the scrolling half instead. */}
              <th scope="col" className="pv-buy">To buy</th>
              <th scope="col" className="pv-hand">On hand</th>
              <th scope="col" className="pv-total">Total</th>
              {breakdown === 'single' ? (
                <th scope="col" className="pv-for">For</th>
              ) : (
                cols.map((m) => (
                  // The name wraps; the ×N sits under it on its own line. The
                  // ×N is the COPY count — how many of the transmute the plan
                  // makes — while the cells below are totals with that count
                  // already multiplied in, which is why one Ink line under a
                  // `×3` heading reads 15.
                  <th scope="col" className="pv-rx" key={m.key}>
                    <span className="pv-rx-nm">{m.displayName}</span>
                    <span className="pv-rx-n">×{m.qty}</span>
                  </th>
                ))
              )}
              <th scope="col" className="pv-unit">$ ea <i className="cl-edit-i" aria-hidden="true">✎</i></th>
              <th scope="col" className="pv-cost">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = editing.rowId === r.id;
              const lot = lotHintFor(r);
              const status = r.notes.filter((n) => !isRecipeNote(n));
              const owners = breakdown === 'single' ? recipesFor(r, making) : [];
              const forOpen = openFor.has(r.id);
              const overLimit = owners.length > SINGLE_LIMIT;
              const shownOwners = overLimit && !forOpen ? owners.slice(0, SINGLE_LIMIT) : owners;
              return [
                <tr key={r.id} className={r.need === 0 && r.unitAvg !== null ? 'done' : undefined}>
                  <th scope="row" className="pv-item">
                    <span className="pv-nm">{r.displayName}</span>
                    {(showCategory || r.nominalYear !== null) && (
                      <span className="pv-sub">
                        {showCategory && r.category}
                        {showCategory && r.nominalYear !== null && ' · '}
                        {r.nominalYear !== null && r.nominalYear}
                      </span>
                    )}
                    {status.length > 0 && (
                      <span className="pv-sub">{status.map(noteLabel).join(' · ')}</span>
                    )}
                    {/* STACKED here, joined on one line in the Notes view: the
                        item column is 208px where that row has 400. It is not a
                        per-recipe fact, so no column carries it. */}
                    {r.staleness && stalenessParts(r.staleness, moneyCalc).map((line) => (
                      <span className="sl-stale" key={line}>{line}</span>
                    ))}
                  </th>

                  <td className="pv-buy num">
                    {r.need > 0 ? <b>{r.need}</b> : <span className="cl-check" aria-label="covered">✓</span>}
                    {/* The 10x lot arithmetic, under the number it corrects.
                        It used to be a sentence under the item name and fired
                        on 8 of the 14 trade goods, which made near-permanent
                        prose out of a per-row number. The general fact — that
                        Trade 1 tokens bundle — is in the table's own hint now,
                        stated once. */}
                    {lot && <span className="pv-lot">{lotHintLabel(lot)}</span>}
                  </td>
                  <td className="pv-hand">
                    <ShoppingHandCell row={r} hand={hand} onHand={onHand} setOnHand={setOnHand} />
                  </td>
                  <td className="pv-total num">{r.quantity}</td>

                  {breakdown === 'single' ? (
                    <td className="pv-for">
                      {shownOwners.map((m) => (
                        <span className="pv-for-1" key={m.key}>
                          {m.displayName} <b>×{r.byPick[m.key]}</b>
                        </span>
                      ))}
                      {overLimit && (
                        <button type="button" className="sl-note-more" aria-expanded={forOpen}
                          aria-label={`${forOpen ? 'Hide' : 'Show'} all ${owners.length} recipes using ${r.displayName}`}
                          onClick={() => toggleFor(r.id)}>
                          {forOpen ? 'fewer' : `+${owners.length - SINGLE_LIMIT} more`}
                        </button>
                      )}
                    </td>
                  ) : (
                    cols.map((m) => {
                      const n = r.byPick[m.key] ?? 0;
                      // EMPTY, not `0`. A zero is a measured quantity, and a
                      // 14×20 grid of them is exactly the visual noise the
                      // reader is trying to see through.
                      return (
                        <td className="pv-cell num" key={m.key}>
                          {n > 0 ? n : <span className="pv-nil" aria-hidden="true">·</span>}
                        </td>
                      );
                    })
                  )}

                  {/* The money, at the far right of the scrolling half. It
                      SCROLLS: pinning it cost 162px of a frozen block that had
                      already taken half the screen, and the reader in this view
                      is comparing counts across recipes — the plan's money is
                      in the section subtotal, the takeaway table and the
                      footer, all of which stay put. Making it sticky again is
                      one `position` declaration if that turns out wrong. */}
                  <td className="pv-unit num">
                    <button type="button" className="cl-price-d" aria-expanded={open}
                      aria-label={`Unit price ${r.unitAvg === null ? 'unpriced' : moneyCalc(r.unitAvg)} — edit`}
                      onClick={() => editing.set(open ? null : r.id)}>
                      {r.unitAvg === null ? '—' : moneyCalc(r.unitAvg)}
                      {r.overridden && <i className="cl-ovdot" aria-hidden="true" />}
                      <i className="cl-edit-i" aria-hidden="true">✎</i>
                    </button>
                  </td>
                  <td className="pv-cost num">
                    {r.unitAvg === null ? (
                      <span className="cl-noprice">no price</span>
                    ) : r.need > 0 ? (
                      <b><Money format={moneyCalc} value={r.extAvg} /></b>
                    ) : (
                      <span className="cl-covered">covered</span>
                    )}
                  </td>
                </tr>,
                open ? (
                  <tr key={`${r.id}|ed`} className="pv-edrow">
                    <td colSpan={span}>
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
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
