// Provenance wording for one priced ingredient line.
//
// Extracted from BuildCalculator so the Shopping List can say the same thing
// about the same line. It is deliberately a pure string function with no React:
// two views rendering different markup must still agree on the WORDS, and the
// only way to guarantee that is to have one implementation of them.
//
// `WINDOW_TAG` is also read by TransmuteRow's richer `priceTag`, which adds the
// Recipes view's pinned-price-year handling on top of these same rules. The two
// are close enough to look like duplicates and are NOT safely interchangeable —
// see the note at the foot of this file before trying to merge them.

import type { PricedLine } from './transmutes';
import type { RecipeStatus } from './recipeWindows';

export const WINDOW_TAG = 'over its build window';

/** Compact provenance for one ingredient: its own season when it differs from
 *  the recipe's, then where the price came from. Mirrors TransmuteRow's
 *  priceTag, including its rule that the recipe's prevailing basis is stated
 *  once in the footer rather than on every line — and its one exception, the
 *  Ultra Rare tier lines, which always name their basis so a Relic's windowed
 *  UR and its Legendary's pooled one are not two different numbers under the
 *  same year. */
export function lineTag(l: PricedLine, recipeYear: number, status: RecipeStatus): string {
  const parts: string[] = [];
  if (l.nominalYear !== recipeYear) parts.push(String(l.nominalYear));
  if (l.isSource) parts.push('source · built');
  else if (l.source === 'auction') parts.push('auction');
  else if (l.source === 'offAuction') parts.push('non-auction item');
  else if (l.source === 'derived') parts.push('derived');
  else if (l.source === 'build') parts.push('built');
  else parts.push('no price');
  if (l.seasonMapped) parts.push(`from ${l.pricedYear}`);
  else if (l.floated && status !== 'active') parts.push("today's price");
  else if (l.basis === 'window' && status !== 'expired') parts.push(WINDOW_TAG);
  else if (status === 'expired' && l.basis === 'season' && !l.seasonMapped) parts.push('season priced');
  if (l.pricedAs && l.pricedAs !== l.good) parts.push(`priced as ${l.pricedAs}`);
  if (l.basis === 'window' && l.tierLine && !parts.includes(WINDOW_TAG)) parts.push(WINDOW_TAG);
  if (l.basis === 'pool' && l.poolYears?.length) parts.push(`${l.poolYears.join('–')} pooled`);
  if (l.bound === 'ceiling') parts.push('ceiling');
  return parts.join(' · ');
}

// Why `priceTag` in TransmuteRow was NOT folded into this:
//
// It takes a fourth argument, the Recipes view's pinned price year, and that
// argument changes two rules rather than adding one. Under a pin the "which
// season" part reads `pricedYear` instead of `nominalYear`; the `from YYYY`
// tag is suppressed when it would repeat that year; and the `season priced`
// tag is suppressed entirely, because with a year pinned EVERY line on an
// expired recipe is season-priced and the tag would land on all thirteen.
//
// Calling `priceTag(l, year, status, null)` looks equivalent to `lineTag` and
// very nearly is — but "very nearly" is not a thing to assert about wording
// shown on 174 recipes without a test that pins the output of both over the
// whole corpus. That test is worth writing; it is not worth writing blind in
// the middle of a refactor whose contract is "nothing changes".
