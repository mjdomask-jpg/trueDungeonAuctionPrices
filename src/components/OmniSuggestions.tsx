import { useMemo, useState } from 'react';
import { money0, moneyCalc } from '../lib/format';
import { PriceInput } from './PriceInput';
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
//
// The craft cost is the DEFAULT, not the answer. A player reading this box is
// there because the ingredient can no longer be crafted — so they are buying,
// and what an Omni token costs to craft is the one number they are least likely
// to pay. Hence the price box: same manual-secondary-price pattern as "Buy it
// instead for", one entry per Omni token rather than per line, since the price
// of a Cube is a fact about Cubes and not about the row it would fill.

const monthYear = (iso: string | null): string => {
  if (!iso) return '';
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m - 1];
  return name ? `${name} ${y}` : String(y);
};

/** One offer re-priced against whatever the player says an Omni token costs
 *  them. A null entry means "use the craft cost", so clearing the box restores
 *  the default rather than leaving the comparison without a number. */
function priced(o: OmniOffer, entered: number | null) {
  const craftUnit = o.omniAvg / o.quantity;
  const unitAvg = entered ?? craftUnit;
  const unitMin = entered ?? o.omniMin / o.quantity;
  const omniAvg = unitAvg * o.quantity;
  const omniMin = unitMin * o.quantity;
  return {
    craftUnit,
    omniAvg,
    omniMin,
    savesAvg: o.lineAvg - omniAvg,
    cheaper: omniAvg < o.lineAvg,
    own: entered != null,
  };
}

function OfferRow({ o, entered }: { o: OmniOffer; entered: number | null }) {
  const p = priced(o, entered);
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
        {' '}{p.own ? 'At your price that is' : 'Crafting one costs about'} {money0(p.omniAvg)},
        {' '}against {money0(o.lineAvg)} for this line
        {p.cheaper ? ` — a saving of ${money0(p.savesAvg)}.` : `, so it costs ${money0(-p.savesAvg)} more.`}
      </p>
    </li>
  );
}

export function OmniSuggestions({ cost, engine }: { cost: BuildCost; engine: CostEngine }) {
  const [open, setOpen] = useState(false);
  // Keyed by Omni token, not by line or recipe: the same Cube fills any Relic
  // slot, so a player prices it once and it holds while they compare recipes.
  const [entered, setEntered] = useState<Record<string, number | null>>({});

  const offers = useMemo(
    () => omniOffersFor(cost, engine).filter((o) => !o.ingredientCraftable || o.cheaper),
    [cost, engine],
  );
  if (!offers.length) return null;

  const tokens = [...new Map(offers.map((o) => [o.substitute, o])).values()];
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
            {offers.map((o) => (
              <OfferRow key={o.lineIndex} o={o} entered={entered[o.substitute] ?? null} />
            ))}
          </ul>
          <div className="omni-prices">
            {tokens.map((o) => {
              const own = entered[o.substitute] ?? null;
              const craftUnit = o.omniAvg / o.quantity;
              return (
                <label className="omni-price" key={o.substitute}>
                  <span className="omni-price-lab">One {o.substitute} costs me</span>
                  <span className="cl-money-in">
                    <span className="cl-dollar">$</span>
                    <PriceInput
                      ariaLabel={`Your price for one ${o.substitute}`}
                      value={own ?? craftUnit}
                      onChange={(n) => setEntered((prev) => ({ ...prev, [o.substitute]: n }))}
                    />
                  </span>
                  {own == null ? (
                    <span className="omni-price-src">craft cost, {o.substituteYear} recipe</span>
                  ) : (
                    <button type="button" className="cl-reset"
                      onClick={() => setEntered((prev) => ({ ...prev, [o.substitute]: null }))}>
                      Reset to {moneyCalc(craftUnit)}
                    </button>
                  )}
                </label>
              );
            })}
          </div>
          <p className="omni-foot">
            Omni tokens are wildcards the game added so that older ingredients stay obtainable.
            Most players buy one rather than craft it, so type in what you can actually get one for.
            None of this is included in the totals above — it is an alternative to price up,
            not a cheaper way to read the same build.
          </p>
        </>
      )}
    </div>
  );
}
