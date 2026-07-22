import { useState } from 'react';
import { money0 } from '../lib/format';
import { sourceName, type BuildCost } from '../lib/transmutes';

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

  return (
    <div className={`tx-row${paired ? ' upgrade' : ''}`}>
      <button
        type="button"
        className="tx-rhead"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className={`tx-chev ${open ? 'open' : ''}`} aria-hidden="true">▸</i>
        <span className="tchip" data-tier={cost.level}>{cost.level}</span>
        <span className="tx-name">
          {cost.displayName}
          {paired && src && <span className="tx-upfrom">upgrades from {src}</span>}
        </span>
        <span className="tx-badges">
          {cost.ceiling && <span className="tx-badge ceiling" title="Contains a ceiling-priced ingredient — the total is an upper bound">ceiling</span>}
          {estBadge && <span className="tx-badge est" title="Some ingredients are priced from another season">est.</span>}
          {cost.marketAvg != null && <span className="tx-market" title="This token also sells at auction">buy ~{money0(cost.marketAvg)}</span>}
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
      </button>

      {open && (
        <div className="tx-bom">
          <div className="tx-bom-head">
            <span>Ingredient</span><span>avg</span><span>min</span>
          </div>
          {cost.lines.map((l, i) => (
            <div key={i} className={`tx-bom-row${l.isSource ? ' src' : ''}`}>
              <span className="tx-ing">
                {l.quantity} × {l.displayName}
                <span className="tx-src">
                  {l.isSource ? 'source · built' : l.source ?? 'no price'}
                  {l.seasonMapped && ` · from ${l.pricedYear}`}
                  {l.bound === 'ceiling' && ' · ceiling'}
                </span>
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
