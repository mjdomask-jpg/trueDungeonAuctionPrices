// The on-hand arithmetic the Shopping List's two table shapes share.
//
// In lib/ rather than beside the controls it serves, because a component file
// that also exports a plain function breaks fast refresh — and because this is
// arithmetic over rows, which is what lib/ is for.

import type { ShoppingRow } from './shoppingList';

/**
 * The three questions every on-hand control asks of a row, in one place.
 *
 * A row is COVERED on its TOTAL on-hand, which includes whatever D5's netting
 * contributes; but `fillTo` only ever returns the TYPED number, because that is
 * the only one All is allowed to write. Without that split, All on a netted row
 * types in a count the player does not own and the row reports the difference
 * back as "N spare".
 */
export function handMath(rows: readonly ShoppingRow[], onHand: (id: string) => number) {
  const netted = (r: ShoppingRow) => Math.max(0, r.onHand - onHand(r.id));
  const covered = (r: ShoppingRow) => r.onHand >= r.quantity;
  const fillTo = (r: ShoppingRow) => Math.max(onHand(r.id), r.quantity - netted(r));
  return {
    netted,
    covered,
    fillTo,
    // Two-state, like the calculator's: neither side lights while you are
    // part-way through entering what you hold, which says more than a pair of
    // momentary buttons where All lights and None never does.
    allOwned: rows.every(covered),
    noneOwned: rows.every((r) => onHand(r.id) === 0),
    entries: (full: boolean): [string, number][] =>
      rows.map((r) => [r.id, full ? fillTo(r) : 0]),
  };
}
