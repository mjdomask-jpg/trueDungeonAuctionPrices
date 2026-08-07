import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuctionData } from '../data/auctionDataContext';
import { useFilters } from '../data/filtersContext';
import { dateKey } from '../lib/data';
import { fmtCloseDate, money } from '../lib/format';
import { FilterBar } from '../components/FilterBar';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { PageIntro } from '../components/PageIntro';

// Augments & Withheld (docs/context-layer-design.md §5). Items that entered an
// auction outside the advertised order — withheld by the auctioneer, augmented
// from their collection or as released payment, or dropped in by Grunnel. Laid
// out as the same accordion the Auction Data page uses: one card per auction
// (its close date and forum link in the header), the items inside a table whose
// middle column is the provenance badge in place of a token category. The "Show
// context" chips toggle which provenances appear, right above the list.

// Below this many auctions, every card opens by default — a season you can take
// in at a glance is one you want to read, not scan. Mirrors the explorer.
const AUTO_EXPAND_LIMIT = 5;

// Close date long-form ("Nov 25, 2025"): this list spans seasons, so the year
// matters, same as the explorer's cards.
function longDate(iso: string): string | null {
  const short = fmtCloseDate(iso);
  const year = /^(\d{4})-/.exec(iso)?.[1];
  return short && year ? `${short}, ${year}` : short;
}

export default function ContextPage() {
  const { contextItems, meta, loading, error } = useAuctionData();
  const { filters } = useFilters();
  const [season, setSeason] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const metaById = useMemo(() => new Map(meta.map((m) => [m.auctionId, m])), [meta]);

  // Seasons that actually carry context items, newest first.
  const seasons = useMemo(() => {
    const s = new Set<string>();
    for (const it of contextItems) {
      const sn = metaById.get(it.auctionId)?.season;
      if (sn) s.add(sn);
    }
    return [...s].sort((a, b) => Number(b) - Number(a));
  }, [contextItems, metaById]);
  const activeSeason = season && seasons.includes(season) ? season : (seasons[0] ?? '');

  // This season's context items, narrowed to the switched-on provenances, ordered
  // by auction then item name, grouped under their auction.
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
    // Most recent auction first, to match the Auction Data page (close date desc,
    // auction number as the tiebreak for same-day closes).
    return [...byAuction.entries()]
      .map(([id, items]) => ({ meta: metaById.get(id)!, items }))
      .sort((a, b) => {
        const ka = dateKey(a.meta.closeDate), kb = dateKey(b.meta.closeDate);
        if (ka !== kb) return ka < kb ? 1 : -1;
        return b.meta.auctionNumber - a.meta.auctionNumber;
      });
  }, [contextItems, metaById, activeSeason, filters.provenance]);

  // Re-apply the auto-expand rule whenever the visible set changes (new season,
  // or a provenance filter that empties/refills a card), so a short list opens
  // itself. Keyed on the id list, like the explorer.
  const ids = groups.map((g) => g.meta.auctionId).join(',');
  useEffect(() => {
    const list = ids ? ids.split(',') : [];
    setOpenIds(new Set(list.length <= AUTO_EXPAND_LIMIT ? list : []));
  }, [ids]);

  const toggle = (auctionId: string, open: boolean) =>
    setOpenIds((prev) => {
      if (prev.has(auctionId) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(auctionId); else next.delete(auctionId);
      return next;
    });
  const expandAll = () => setOpenIds(new Set(groups.map((g) => g.meta.auctionId)));
  const collapseAll = () => setOpenIds(new Set());

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  const intro = (
    <PageIntro short="Items withheld, augmented, or added outside the standard $8,000 order.">
      Items an auctioneer <strong>withheld</strong>, <strong>augmented</strong> from their
      collection or included as a bonus, or that <strong>Grunnel</strong> dropped in — everything
      that entered an auction outside the standard $8,000 order, grouped by auction. These are
      separate from the per-token <Link to="/">Prices</Link>; <strong>withheld</strong> values are
      estimates (the item never sold), shown negative.
    </PageIntro>
  );

  if (!contextItems.length) {
    return (
      <>
        {intro}
        <p className="empty">
          No auction context loaded. Add <code>public/data/contextItems.csv</code> and this page
          fills in automatically.
        </p>
      </>
    );
  }

  return (
    <>
      {intro}

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
        <>
          <p className="meta-line">
            {groups.length} auction{groups.length === 1 ? '' : 's'} with context in {activeSeason}
            <span className="explorer-actions">
              <button type="button" onClick={expandAll}>Expand all</button>
              <button type="button" onClick={collapseAll}>Collapse all</button>
            </span>
          </p>

          {groups.map((g) => {
            const open = openIds.has(g.meta.auctionId);
            const facts = [g.meta.style, g.meta.completionStyle, g.meta.auctioneer, g.meta.source]
              .filter((v) => v && v !== 'n/a');
            return (
              <details
                key={g.meta.auctionId}
                className="auction"
                open={open}
                onToggle={(e) => toggle(g.meta.auctionId, (e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="auction-head">
                  <span className="auction-title">
                    <span className="auction-num">{g.meta.season} · #{g.meta.auctionNumber}</span>
                    <span className="auction-name">{g.meta.name || `Auction #${g.meta.auctionNumber}`}</span>
                  </span>
                  <span className="auction-when">Closed: {longDate(g.meta.closeDate) ?? 'unknown'}</span>
                  {open && g.meta.link && (
                    <a className="auction-link" href={g.meta.link} target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}>
                      Auction link ↗
                    </a>
                  )}
                </summary>

                {open && (
                  <div className="auction-body">
                    {facts.length > 0 && (
                      <p className="auction-facts">
                        {facts.map((f) => <span key={f} className="cat">{f}</span>)}
                      </p>
                    )}
                    <div className="tablewrap">
                      <table className={`ctx-items${g.items.length >= 4 ? ' banded' : ''}`}>
                        <colgroup><col className="col-token" /><col /><col /></colgroup>
                        <thead>
                          <tr>
                            <th className="left">Item</th>
                            <th className="left">Type</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.items.map((it, i) => (
                            <tr key={`${it.name}-${i}`}>
                              <td className="left token">
                                {it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}
                              </td>
                              <td className="left">
                                <ProvenanceBadge provenance={it.provenance} n={it.estimate ? it.n : undefined} />
                              </td>
                              <td className={`ctx-val${it.value < 0 ? ' neg' : ''}`}>{money(it.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </details>
            );
          })}
        </>
      )}
    </>
  );
}
