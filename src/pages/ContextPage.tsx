import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters } from '../data/filtersContext';
import { money } from '../lib/format';
import { FilterBar } from '../components/FilterBar';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { PageIntro } from '../components/PageIntro';

// Auction context (docs/context-layer-design.md §5). Items that entered an
// auction outside the advertised order — withheld by the auctioneer, augmented
// from their collection or as released payment, or dropped in by Grunnel. This
// lived on the Prices page, but it made that page long and its filter had no
// nearby effect; on its own page the "Show context" chips toggle the list right
// below them. The core price tables (Prices) stay unchanged (§5.4).
export default function ContextPage() {
  const { contextItems, meta, loading, error } = useAuctionData();
  const { filters } = useFilters();
  const [season, setSeason] = useState('');

  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);

  // Seasons that actually carry context items, newest first — so the dropdown
  // never offers an empty season.
  const seasons = useMemo(() => {
    const s = new Set<string>();
    for (const it of contextItems) {
      const season = metaById.get(it.auctionId)?.season;
      if (season) s.add(season);
    }
    return [...s].sort((a, b) => Number(b) - Number(a));
  }, [contextItems, metaById]);
  const activeSeason = season && seasons.includes(season) ? season : (seasons[0] ?? '');

  // This season's context items, narrowed to the provenances switched on, ordered
  // by auction then item name, then grouped under their auction so the auction
  // name is a heading rather than a column crammed into every row.
  const groups = useMemo(() => {
    const rows = contextItems
      .filter((it) => metaById.get(it.auctionId)?.season === activeSeason && filters.provenance.has(it.provenance))
      .sort((a, b) =>
        (metaById.get(a.auctionId)!.auctionNumber - metaById.get(b.auctionId)!.auctionNumber)
        || a.name.localeCompare(b.name));
    const byAuction = new Map<string, typeof rows>();
    for (const it of rows) {
      const arr = byAuction.get(it.auctionId);
      if (arr) arr.push(it); else byAuction.set(it.auctionId, [it]);
    }
    return [...byAuction.entries()].map(([id, items]) => ({ meta: metaById.get(id)!, items }));
  }, [contextItems, metaById, activeSeason, filters.provenance]);

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  if (!contextItems.length) {
    return (
      <>
        <PageIntro short="Items withheld, augmented, or added outside the advertised order.">
          Items an auctioneer <strong>withheld</strong>, <strong>augmented</strong> from their
          collection, or that Grunnel dropped in — everything that entered an auction outside the
          advertised order.
        </PageIntro>
        <p className="empty">
          No auction context loaded. Add <code>public/data/contextItems.csv</code> and this page
          fills in automatically.
        </p>
      </>
    );
  }

  return (
    <>
      <PageIntro short="Items withheld, augmented, or added outside the advertised order.">
        Items an auctioneer <strong>withheld</strong>, <strong>augmented</strong> from their
        collection or released as payment, or that <strong>Grunnel</strong> dropped in — everything
        that entered an auction outside the advertised order. These are separate from the per-token{' '}
        <Link to="/">Prices</Link>; <strong>withheld</strong> values are estimates (never sold), so
        they are off by default — switch them on with the chip below.
      </PageIntro>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <FilterBar controls={['provenance']} />

      {groups.length === 0 ? (
        <p className="empty">No context items to show for {activeSeason} — try switching a chip on.</p>
      ) : (
        groups.map((g) => (
          <section className="ctx-auc" key={g.meta.auctionId}>
            <h2 className="ctx-auc-head">
              {g.meta.name || `Auction #${g.meta.auctionNumber}`}
              <span className="ctx-auc-sub">#{g.meta.auctionNumber} · {g.meta.source}</span>
            </h2>
            <ul className="ctx-list">
              {g.items.map((it, i) => (
                <li className="ctx-row" key={`${it.auctionId}-${it.name}-${i}`}>
                  <ProvenanceBadge provenance={it.provenance} n={it.estimate ? it.n : undefined} />
                  <span className="ctx-name">
                    {it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}
                  </span>
                  <span className={`ctx-value${it.value < 0 ? ' neg' : ''}`}>{money(it.value)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
