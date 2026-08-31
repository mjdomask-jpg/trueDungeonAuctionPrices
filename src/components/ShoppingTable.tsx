import { Money } from './Money';
import { PriceInput } from './PriceInput';
import { moneyCalc } from '../lib/format';
import { noteLabel, stalenessNote, lotHintFor, type ShoppingRow } from '../lib/shoppingList';

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

export function ShoppingTable({
  title, hint, rows, showCategory = false, editing, onHand, setOnHand, setOverride, clearOverride,
}: {
  title: string;
  hint?: string;
  rows: readonly ShoppingRow[];
  showCategory?: boolean;
  editing: PriceEdit;
  onHand: (id: string) => number;
  setOnHand: (id: string, n: number) => void;
  setOverride: (id: string, n: number | null) => void;
  clearOverride: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  const subtotal = rows.reduce((t, r) => t + (r.extAvg ?? 0), 0);

  return (
    <section className="sl-table">
      <div className="sl-thead">
        <h3>
          {title} <span className="sl-count">{rows.length}</span>
          {hint && <span className="sl-thint">{hint}</span>}
        </h3>
        <span className="sl-sub">
          <span className="sl-sub-l">Subtotal</span> <b><Money format={moneyCalc} value={subtotal} /></b>
        </span>
      </div>

      <div className="calc-lhead">
        <span>Ingredient</span><span className="h-hand">on hand</span><span>buy</span>
        <span>$/ea <i className="cl-edit-i" aria-hidden="true">✎</i></span><span>cost</span>
      </div>

      {rows.map((r) => {
        const have = onHand(r.id);
        const open = editing.rowId === r.id;
        return (
          <div key={r.id} className={`calc-line sl-line${r.need === 0 && r.unitAvg !== null ? ' done' : ''}`}>
            <div className="cl-main">
              <span className="cl-name">
                <span className="cl-good">
                  {r.quantity} × {r.displayName}
                  {showCategory && <span className="sl-cat">{r.category}</span>}
                </span>
                <span className="cl-meta">
                  {r.notes.map(noteLabel).join(' · ')}
                  {/* Phones hide the $/ea column and read the price here
                      instead, exactly as the calculator's row does. */}
                  <button type="button" className="cl-price-m" aria-expanded={open}
                    aria-label={`Edit unit price: ${r.displayName}`}
                    onClick={() => editing.set(open ? null : r.id)}>
                    {r.notes.length ? ' · ' : ''}
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
