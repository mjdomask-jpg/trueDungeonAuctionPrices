import { useMemo, useState } from 'react';
import { money0 } from '../lib/format';
import { omniOffersFor, type OmniOffer } from '../lib/substitutions';
import type { BuildCost, CostEngine } from '../lib/transmutes';

// Phase 6's opt-in suggestion (§3.5, D8). Never folded into the headline total:
// an Omni token is a price COMPARISON against a possible secondary-market
// purchase, not a path the player is likely already standing on — that is what
// separates it from the Wish Ring / GP toggle.
//
// Triggered on AVAILABILITY, not price. Measured against the live data, a
// price-only trigger never fires at all: an Omni Cube costs $777 to craft
// against a dearest replaceable Relic line of $651. What the substitution is
// actually for (§10.0) is the case where the ingredient cannot be crafted any
// more at any price, which is true of 34 of the 81 eligible lines. A genuine
// saving still qualifies, so the box turns on by itself if prices ever cross.

const monthYear = (iso: string | null): string => {
  if (!iso) return '';
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m - 1];
  return name ? `${name} ${y}` : String(y);
};

function OfferRow({ o }: { o: OmniOffer }) {
  return (
    <li className="omni-offer">
      <p className="omni-line">
        <b>{o.good}</b>
        {o.ingredientCraftable ? (
          <span className="omni-why"> — an {o.substitute} is cheaper here</span>
        ) : (
          <span className="omni-why">
            {' '}— no longer craftable
            {o.ingredientExpires ? `, its recipe expired ${monthYear(o.ingredientExpires)}` : ''}
          </span>
        )}
      </p>
      <p className="omni-cmp">
        An <b>{o.substitute}</b> substitutes for any {o.tier} in a Legendary recipe.
        {' '}Crafting one costs about {money0(o.omniAvg)}, against {money0(o.lineAvg)} for this line
        {o.cheaper ? ` — a saving of ${money0(o.savesAvg)}.` : `, so it costs ${money0(-o.savesAvg)} more.`}
      </p>
    </li>
  );
}

export function OmniSuggestions({ cost, engine }: { cost: BuildCost; engine: CostEngine }) {
  const [open, setOpen] = useState(false);
  const offers = useMemo(
    () => omniOffersFor(cost, engine).filter((o) => !o.ingredientCraftable || o.cheaper),
    [cost, engine],
  );
  if (!offers.length) return null;

  const stuck = offers.filter((o) => !o.ingredientCraftable).length;
  const summary = stuck
    ? `${stuck} ingredient${stuck > 1 ? 's' : ''} can no longer be crafted`
    : `${offers.length} cheaper substitution${offers.length > 1 ? 's' : ''} available`;

  return (
    <div className="omni">
      <button type="button" className="omni-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="omni-i" aria-hidden="true">◈</span>
        <span className="omni-sum">Omni substitutions — {summary}</span>
        <span className="omni-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <ul className="omni-list">
            {offers.map((o) => <OfferRow key={o.lineIndex} o={o} />)}
          </ul>
          <p className="omni-foot">
            Omni tokens are wildcards the game added so that older ingredients stay obtainable.
            None of this is included in the totals above — it is an alternative to price up,
            not a cheaper way to read the same build.
          </p>
        </>
      )}
    </div>
  );
}
