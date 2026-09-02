import { Money } from './Money';
import { moneyCalc } from '../lib/format';
import { handMath } from '../lib/shoppingHand';
import type { ShoppingRow } from '../lib/shoppingList';

// The on-hand controls and the section header, lifted out of `ShoppingTable`
// when the pivot view arrived and needed the same two things in a different
// table shape.
//
// Lifted rather than copied, for the reason `RecipeDrawer` was: the All/None
// arithmetic below is subtle — it fills to what is still MISSING rather than to
// the full quantity, so that hitting All on a row D5's netting already covers
// does not type in a count the player does not own — and two copies of it would
// disagree within a season. The two views must never report a different
// on-hand state for one row, because they are two drawings of one plan.

export type HandProps = {
  onHand: (id: string) => number;
  setOnHand: (id: string, n: number) => void;
  /** One state update for a whole table, so All/None over fourteen goods is a
   *  single render rather than fourteen. */
  setOnHandMany: (entries: [string, number][]) => void;
};

/** The header both table shapes carry: what the section is, the master
 *  All/None, and the subtotal. */
export function ShoppingSectionHead({
  title, hint, rows, hand, setOnHandMany,
}: {
  title: string;
  hint?: string;
  rows: readonly ShoppingRow[];
  hand: ReturnType<typeof handMath>;
  setOnHandMany: HandProps['setOnHandMany'];
}) {
  const subtotal = rows.reduce((t, r) => t + (r.extAvg ?? 0), 0);
  return (
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
            <button type="button" data-label="All" className={hand.allOwned ? 'on' : undefined}
              aria-pressed={hand.allOwned} aria-label={`Own all ${title.toLowerCase()}`}
              onClick={() => setOnHandMany(hand.entries(true))}>All</button>
            <button type="button" data-label="None" className={hand.noneOwned ? 'on' : undefined}
              aria-pressed={hand.noneOwned} aria-label={`Own none of the ${title.toLowerCase()}`}
              onClick={() => setOnHandMany(hand.entries(false))}>None</button>
          </span>
        </span>
        <span className="sl-sub">
          <span className="sl-sub-l">Subtotal</span> <b><Money format={moneyCalc} value={subtotal} /></b>
        </span>
      </div>
    </div>
  );
}

/** One row's on-hand controls: the All/None pill, the stepper, and D5's badge. */
export function ShoppingHandCell({
  row, hand, onHand, setOnHand,
}: { row: ShoppingRow; hand: ReturnType<typeof handMath> } & Omit<HandProps, 'setOnHandMany'>) {
  const have = onHand(row.id);
  const crafting = hand.netted(row);
  const covered = hand.covered(row);
  // A row that D5's toggle covers on its own has nothing left for the player to
  // own, so its pill would be a control with no second state.
  const nothingToOwn = row.quantity - crafting <= 0;
  return (
    <>
      {/* The master control's per-row form, and the calculator's pill exactly —
          one button whose label flips, so it reports the row's state as well as
          setting it. Disabled where netting already covers the row: there is no
          second state to toggle to, and the badge beside it says why. */}
      <button type="button" className={`calc-all${covered ? ' on' : ''}`}
        aria-pressed={covered} disabled={nothingToOwn}
        aria-label={covered ? `Own none: ${row.displayName}` : `Own all ${row.quantity}: ${row.displayName}`}
        onClick={() => setOnHand(row.id, covered ? 0 : hand.fillTo(row))}>
        {covered ? 'None' : 'All'}
      </button>
      <span className="cl-stepper">
        <button type="button" className="cl-step" disabled={have <= 0}
          aria-label={`One fewer on hand: ${row.displayName}`}
          onClick={() => setOnHand(row.id, have - 1)}>−</button>
        {/* type=text, not number: number inputs cannot select(), and on iOS a
            tap drops the caret before the 0 so "2" becomes "20". inputMode
            keeps the numeric keypad. */}
        <input type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next"
          aria-label={`On hand: ${row.displayName}`} value={have}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setOnHand(row.id, e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)} />
        {/* NOT disabled at the required quantity — D2. Owning more than the
            plan needs is a fact worth recording. */}
        <button type="button" className="cl-step"
          aria-label={`One more on hand: ${row.displayName}`}
          onClick={() => setOnHand(row.id, have + 1)}>+</button>
      </span>
      {/* D5's contribution, shown where the arithmetic is. The box beside it
          holds what the player TYPED, so a netted row otherwise reads "on hand
          0, needed 3, buy 1" with the missing two explained nowhere. */}
      {crafting > 0 && <span className="sl-netted">+{crafting} crafting</span>}
    </>
  );
}
