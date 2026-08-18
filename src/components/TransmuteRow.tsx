import { useState } from 'react';
import { money0 } from '../lib/format';
import { Money } from './Money';
import { HintPopover } from './HintPopover';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { sourceName, tierAbbrev, type BuildCost, type PricedLine } from '../lib/transmutes';
import type { RecipeStatus } from '../lib/recipeWindows';

// Friendly, non-camelCase label for where a line's price came from, plus the
// season-mapped / ceiling qualifiers. Leads with the ingredient's own season
// when it differs from the recipe's: several recipes pull the same-named token
// from multiple years (e.g. one Ultra Rare from each of 2023–2026), and without
// the year those rows would be indistinguishable. Dot-separated, matching the
// other flags.
// The recipe's own basis is stated ONCE, in the note under the bill of
// materials — repeating "over its build window" on all thirteen lines is
// noise, and it buries the lines that did something different. So a basis tag
// appears only where the line DEVIATES from what the recipe as a whole did.
// Same rule the est. badge already follows against the season note.
function priceTag(l: PricedLine, recipeYear: number, status: RecipeStatus): string {
  const parts: string[] = [];
  if (l.nominalYear !== recipeYear) parts.push(String(l.nominalYear));
  if (l.isSource) parts.push('source · built');
  else if (l.source === 'auction') parts.push('auction');
  else if (l.source === 'offAuction') parts.push('non-auction item');
  else if (l.source === 'derived') parts.push('derived');
  else if (l.source === 'build') parts.push('built');
  else parts.push('no price');
  if (l.seasonMapped) parts.push(`from ${l.pricedYear}`);
  // The accuracy release's two new bases. Both change what the number MEANS,
  // so neither can be silent: a floated line is today's real price for a
  // recipe you can still build, and a windowed one is the average over the
  // exact period the recipe was craftable.
  else if (l.floated && status !== 'active') parts.push("today's price");
  else if (l.basis === 'window' && status !== 'expired') parts.push('over its build window');
  // The deviations, which are the ones worth a tag: a line on an expired
  // recipe that fell back to a whole season because its window held no sales
  // (every recipe before 2018), and one on an active recipe that did not float.
  else if (status === 'expired' && l.basis === 'season' && !l.seasonMapped) parts.push('season priced');
  // A line naming a specific token that auctions only sell generically (every
  // named Ultra Rare) says so, so the number is never mistaken for a sale of
  // that token (§3.4a).
  if (l.pricedAs && l.pricedAs !== l.good) parts.push(`priced as ${l.pricedAs}`);
  // "Any Ultra Rare from {years}" (§3.4b), which is also what the two-season
  // pool means: the token is redeemable across both of them.
  if (l.basis === 'pool' && l.poolYears?.length) parts.push(`${l.poolYears.join('–')} pooled`);
  if (l.bound === 'ceiling') parts.push('ceiling');
  return parts.join(' · ');
}

// One transmute in the season list: a header line showing the build cost (and,
// for tokens with a source, the cheaper "upgrade from source" cost), expanding
// to the full bill of materials with avg + min per good.
//
// `paired` marks a Legendary shown directly beneath its source Relic — it gets
// an indent and an "upgrades from" tag. `seasonFallback` suppresses the per-row
// estimate badge when the WHOLE season is priced by fallback (the season note
// already says so); ceiling badges still show, since that's a different caveat.
export function TransmuteRow({
  cost,
  paired = false,
  seasonFallback = false,
}: {
  cost: BuildCost;
  paired?: boolean;
  seasonFallback?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const narrow = useMediaQuery(NARROW);
  const src = sourceName(cost);
  const estBadge = cost.estimate && !cost.ceiling && !seasonFallback;
  // Alternating row shading kicks in once the ingredient list is long enough to
  // benefit from it (4+ goods); short recipes stay plain.
  const banded = cost.lines.length >= 4;

  return (
    <div className={`tx-row${paired ? ' upgrade' : ''}`}>
      {/* The expand control is an overlay behind the row's content rather than a
          wrapper around it: the badges carry their own help popovers, and a
          button cannot contain another button. The face is inert to pointers so
          clicks fall through to the overlay; the badges opt back in. */}
      <div className="tx-rhead">
        <button
          type="button"
          className="tx-rtoggle"
          aria-expanded={open}
          aria-label={`${cost.displayName} — show ingredients`}
          onClick={() => setOpen((v) => !v)}
        />
        <span className="tx-rface">
          <i className={`tx-chev ${open ? 'open' : ''}`} aria-hidden="true">▸</i>
          {/* On phones the chip shrinks to a tier code (see tierAbbrev) — a
              spelled-out "Legendary" costs a quarter of the row. The full name
              stays in the accessibility tree so the tier is never carried by a
              letter and a colour alone. */}
          <span className="tchip" data-tier={cost.level}>
            <span aria-hidden="true">{narrow ? tierAbbrev(cost.level) : cost.level}</span>
            <span className="sr-only">{cost.level}</span>
          </span>
          <span className="tx-name">
            {cost.displayName}
            {paired && src && <span className="tx-upfrom">upgrades from {src}</span>}
          </span>
          <span className="tx-badges">
            {/* Only EXPIRED is badged. Active is the norm and marking it would
                put a chip on 91 of 174 rows to say "normal"; the preview badge
                earns its place because those costs are forward estimates. */}
            {cost.status === 'expired' && (
              <HintPopover
                label="What “expired” means"
                trigger={<span className="tx-badge expired">expired</span>}
              >
                This recipe stopped being craftable{cost.expires ? ` on ${cost.expires}` : ''}, so it is
                priced over the period it could actually be built — auctions from
                {' '}{cost.window ? `${cost.window.from} to ${cost.window.to}` : 'its own seasons'},
                stopping a week short of the deadline because a win any later could not
                ship in time to craft.
              </HintPopover>
            )}
            {/* Suppressed when the season note already says the whole season is
                a forward estimate — same rule the est. badge follows. */}
            {cost.status === 'future' && !seasonFallback && (
              <HintPopover
                label="What “preview” means"
                trigger={<span className="tx-badge preview">preview</span>}
              >
                This season has not been auctioned yet — the cost is a forward estimate
                from the most recent sales.
              </HintPopover>
            )}
            {cost.ceiling && (
              <HintPopover
                label="What “ceiling” means"
                trigger={<span className="tx-badge ceiling">ceiling</span>}
              >
                Contains a ceiling-priced ingredient — the total is an upper bound.
              </HintPopover>
            )}
            {estBadge && (
              <HintPopover
                label="What “est.” means"
                trigger={<span className="tx-badge est">est.</span>}
              >
                Some ingredients are priced from another season.
              </HintPopover>
            )}
            {cost.marketAvg != null && (
              <HintPopover
                label="About the buy price"
                trigger={<span className="tx-market">buy ~{money0(cost.marketAvg)}</span>}
              >
                This token also sells at auction.
              </HintPopover>
            )}
          </span>
          <span className="tx-cost">
            {cost.hasSource ? (
              <>
                <span className="tx-line"><span className="tx-lab">Build</span> <b><Money value={cost.fullAvg} /></b> <span className="tx-min">min <Money value={cost.fullMin} /></span></span>
                <span className="tx-line up"><span className="tx-lab">Upgrade</span> <b><Money value={cost.ownAvg} /></b> <span className="tx-min">min <Money value={cost.ownMin} /></span></span>
              </>
            ) : (
              <span className="tx-line"><b><Money value={cost.fullAvg} /></b> <span className="tx-min">min <Money value={cost.fullMin} /></span></span>
            )}
          </span>
        </span>
      </div>

      {open && (
        <div className="tx-bom">
          <div className="tx-bom-head">
            <span>Ingredient</span><span>avg</span><span>min</span>
          </div>
          {cost.lines.map((l, i) => (
            <div key={i} className={`tx-bom-row${l.isSource ? ' src' : ''}${banded && !l.isSource && i % 2 === 1 ? ' band' : ''}${l.substituted === 'replaced' ? ' swapped-out' : ''}`}>
              <span className="tx-ing">
                {/* On the GP path the Wish Ring line stays in place, struck out:
                    the row is what makes the swap legible, and removing it would
                    reflow the whole BOM on a toggle (plan §3.8). */}
                <span className="tx-good">
                  {l.substituted === 'replaced' ? <s>{l.displayName}</s> : `${l.quantity} × ${l.displayName}`}
                </span>
                <span className={`tx-src${l.source === 'offAuction' && !l.isSource ? ' nonauction' : ''}`}>
                  {l.substituted === 'replaced' ? 'paid as 15,000 GP instead' : priceTag(l, cost.year, cost.status)}
                  {l.subStatus === 'expired' && (
                    <HintPopover
                      label="What “no longer craftable” means"
                      trigger={<span className="tx-badge expired sm">no longer craftable</span>}
                    >
                      This ingredient's own recipe has expired, so it cannot be crafted any
                      more — only bought second-hand. The figure here is what it cost to
                      build while it lasted. In the Build Calculator, an Omni token can
                      stand in for it.
                    </HintPopover>
                  )}
                </span>
              </span>
              <span><Money value={l.extAvg} /></span>
              <span><Money value={l.extMin} /></span>
            </div>
          ))}
          {cost.hasSource ? (
            <>
              <div className="tx-bom-row foot">
                <span>Upgrade step <em>— if you own the {src}</em></span>
                <span><Money value={cost.ownAvg} /></span><span><Money value={cost.ownMin} /></span>
              </div>
              <div className="tx-bom-row foot total">
                <span>Full build <em>— from scratch</em></span>
                <span><Money value={cost.fullAvg} /></span><span><Money value={cost.fullMin} /></span>
              </div>
            </>
          ) : (
            <div className="tx-bom-row foot total">
              <span>Build total</span>
              <span><Money value={cost.fullAvg} /></span><span><Money value={cost.fullMin} /></span>
            </div>
          )}
          {cost.status === 'expired' && cost.window && (
            <p className="tx-bom-note">
              No longer craftable. Ingredients are priced over the window this recipe could
              actually be built in — {cost.window.from} to {cost.window.to} — rather than at
              today's prices, which nobody could have paid for it.
            </p>
          )}
          {cost.status === 'active' && cost.lines.some((l) => l.floated) && (
            <p className="tx-bom-note">
              Still craftable, so ingredients are priced at <b>today's</b> prices — what it
              would cost you to build now, not what it cost in {cost.year}.
            </p>
          )}
          {cost.lines.some((l) => l.category === 'Ultra Rare') && (
            <p className="tx-bom-note">
              Ultra Rares priced at the auction average for the transmute window. Secondary
              market prices for specific Ultra Rares may vary.
            </p>
          )}
          {cost.marketAvg != null && (
            <p className="tx-bom-note">
              Also sells at auction for about {money0(cost.marketAvg)} (min {money0(cost.marketMin)}) — building it
              {cost.fullAvg <= cost.marketAvg ? ' is cheaper on average.' : ' costs more than buying, on average.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
