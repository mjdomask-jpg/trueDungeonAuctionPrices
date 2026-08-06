import { useFilters, CONTEXT_PROVENANCES, PROVENANCE_NAME, type SourceFilter } from '../data/filtersContext';

// The shared context-layer controls. One implementation, dropped into each page;
// a page passes `controls` to show only the ones it uses, so the state shape and
// behaviour stay identical everywhere (docs/context-layer-design.md §5.2).
export type FilterControl = 'source' | 'trentPricing' | 'provenance';
const DEFAULT_CONTROLS: FilterControl[] = ['source', 'trentPricing', 'provenance'];

export function FilterBar({ controls = DEFAULT_CONTROLS }: { controls?: FilterControl[] }) {
  const { filters, setSource, setTrentPricing, toggleProvenance } = useFilters();
  const show = (c: FilterControl) => controls.includes(c);
  // The Trent reward-adjust only makes sense when Trent sales are in view.
  const trentInView = filters.source !== 'Forum';

  return (
    <div className="controls filterbar">
      {show('source') && (
        <label>
          Source
          <select value={filters.source} onChange={(e) => setSource(e.target.value as SourceFilter)}>
            <option value="all">All sources</option>
            <option value="Forum">Forum</option>
            <option value="Trent">Trent</option>
          </select>
        </label>
      )}

      {show('trentPricing') && trentInView && (
        <div className="toggle" role="group" aria-label="Trent pricing">
          <span className="toggle-label">Trent pricing</span>
          <div className="toggle-buttons">
            <button type="button" className={filters.trentPricing === 'nominal' ? 'on' : undefined}
              aria-pressed={filters.trentPricing === 'nominal'} onClick={() => setTrentPricing('nominal')}>
              Nominal
            </button>
            <button type="button" className={filters.trentPricing === 'reward-adjusted' ? 'on' : undefined}
              aria-pressed={filters.trentPricing === 'reward-adjusted'} onClick={() => setTrentPricing('reward-adjusted')}>
              Reward-adj.
            </button>
          </div>
        </div>
      )}

      {show('provenance') && (
        <div className="prov-filter" role="group" aria-label="Item provenance">
          <span className="toggle-label">Show context</span>
          <div className="prov-chips">
            {CONTEXT_PROVENANCES.map((p) => {
              const on = filters.provenance.has(p);
              return (
                <button key={p} type="button"
                  className={`prov-chip ${p} ${on ? 'on' : 'off'}`}
                  aria-pressed={on} onClick={() => toggleProvenance(p)}>
                  {PROVENANCE_NAME[p]}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
