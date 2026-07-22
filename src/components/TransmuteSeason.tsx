import { orderSeason, type BuildCost } from '../lib/transmutes';
import { TransmuteRow } from './TransmuteRow';

// One collapsible season section: its transmutes grouped and ordered by
// orderSeason (Relic→Legendary pairs first, then the rest of the ladder). The
// `note` prop carries the season-fallback caveat when the season is outside the
// priced range, so individual rows don't each repeat it.
export function TransmuteSeason({
  year,
  costs,
  open,
  onToggle,
  note,
}: {
  year: number;
  costs: BuildCost[];
  open: boolean;
  onToggle: () => void;
  note?: string;
}) {
  const groups = orderSeason(costs);

  return (
    <section className="tx-season">
      <button type="button" className="tx-shead" aria-expanded={open} onClick={onToggle}>
        <i className={`tx-chev ${open ? 'open' : ''}`} aria-hidden="true">▸</i>
        <span className="tx-syear">{year}</span>
        <span className="tx-scount">{costs.length} buildable</span>
        {note && <span className="tx-snote">{note}</span>}
      </button>

      {open && (
        <div className="tx-sbody">
          {groups.map((g) => (
            <div key={g.label} className={`tx-group${g.kind === 'ladder' ? ' ladder' : ''}`}>
              <div className="tx-group-label">{g.label}</div>
              {g.kind === 'pairs'
                ? g.pairs.map((p) => (
                    <div key={p.source.key} className="tx-pair">
                      <TransmuteRow cost={p.source} seasonFallback={!!note} />
                      <TransmuteRow cost={p.upgrade} paired seasonFallback={!!note} />
                    </div>
                  ))
                : g.rows.map((c) => <TransmuteRow key={c.key} cost={c} seasonFallback={!!note} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
