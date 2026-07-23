import { useState } from 'react';
import { money0 } from '../lib/format';
import { HintPopover } from './HintPopover';
import { sourceName, type BuildCost, type PricedLine } from '../lib/transmutes';

// Friendly, non-camelCase label for where a line's price came from, plus the
// season-mapped / ceiling qualifiers.
function priceTag(l: PricedLine): string {
  let base: string;
  if (l.isSource) base = 'source · built';
  else if (l.source === 'auction') base = 'auction';
  else if (l.source === 'offAuction') base = 'non-auction item';
  else if (l.source === 'derived') base = 'derived';
  else if (l.source === 'build') base = 'built';
  else base = 'no price';
  if (l.seasonMapped) base += ` · from ${l.pricedYear}`;
  if (l.bound === 'ceiling') base += ' · ceiling';
  return base;
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
          <span className="tchip" data-tier={cost.level}>{cost.level}</span>
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
                <span className="tx-line"><span className="tx-lab">Build</span> <b>{money0(cost.fullAvg)}</b> <span className="tx-min">min {money0(cost.fullMin)}</span></span>
                <span className="tx-line up"><span className="tx-lab">Upgrade</span> <b>{money0(cost.ownAvg)}</b> <span className="tx-min">min {money0(cost.ownMin)}</span></span>
              </>
            ) : (
              <span className="tx-line"><b>{money0(cost.fullAvg)}</b> <span className="tx-min">min {money0(cost.fullMin)}</span></span>
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
            <div key={i} className={`tx-bom-row${l.isSource ? ' src' : ''}${banded && !l.isSource && i % 2 === 1 ? ' band' : ''}`}>
              <span className="tx-ing">
                <span className="tx-good">{l.quantity} × {l.displayName}</span>
                <span className={`tx-src${l.source === 'offAuction' && !l.isSource ? ' nonauction' : ''}`}>{priceTag(l)}</span>
              </span>
              <span>{money0(l.extAvg)}</span>
              <span>{money0(l.extMin)}</span>
            </div>
          ))}
          {cost.hasSource ? (
            <>
              <div className="tx-bom-row foot">
                <span>Upgrade step <em>— if you own the {src}</em></span>
                <span>{money0(cost.ownAvg)}</span><span>{money0(cost.ownMin)}</span>
              </div>
              <div className="tx-bom-row foot total">
                <span>Full build <em>— from scratch</em></span>
                <span>{money0(cost.fullAvg)}</span><span>{money0(cost.fullMin)}</span>
              </div>
            </>
          ) : (
            <div className="tx-bom-row foot total">
              <span>Build total</span>
              <span>{money0(cost.fullAvg)}</span><span>{money0(cost.fullMin)}</span>
            </div>
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
