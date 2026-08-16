import { useState } from 'react';
import { money0 } from '../lib/format';
import { Money } from './Money';
import { HintPopover } from './HintPopover';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { sourceName, tierAbbrev, type BuildCost, type PricedLine } from '../lib/transmutes';

// Friendly, non-camelCase label for where a line's price came from, plus the
// season-mapped / ceiling qualifiers. Leads with the ingredient's own season
// when it differs from the recipe's: several recipes pull the same-named token
// from multiple years (e.g. one Ultra Rare from each of 2023–2026), and without
// the year those rows would be indistinguishable. Dot-separated, matching the
// other flags.
function priceTag(l: PricedLine, recipeYear: number): string {
  const parts: string[] = [];
  if (l.nominalYear !== recipeYear) parts.push(String(l.nominalYear));
  if (l.isSource) parts.push('source · built');
  else if (l.source === 'auction') parts.push('auction');
  else if (l.source === 'offAuction') parts.push('non-auction item');
  else if (l.source === 'derived') parts.push('derived');
  else if (l.source === 'build') parts.push('built');
  else parts.push('no price');
  if (l.seasonMapped) parts.push(`from ${l.pricedYear}`);
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
                  {l.substituted === 'replaced' ? 'paid as 15,000 GP instead' : priceTag(l, cost.year)}
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
          {cost.lines.some((l) => l.category === 'Ultra Rare') && (
            <p className="tx-bom-note">
              Ultra Rare lines price at the auction average for the tier — auctions sell
              “an Ultra Rare”, not a specific one. A particular Ultra Rare bought on the
              secondary market can cost more.
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
