import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { seasonsOf, aggregateSeason, itemTimeline } from '../lib/data';
import { money } from '../lib/format';
import { useAuctionData } from '../data/auctionDataContext';
import { PriceTimeline } from '../components/PriceTimeline';

// Price Timelines (Phase 2). Pick a season and a token; see its per-auction
// average price over that season, ordered by auction close date. Reuses the
// existing pieces: aggregateSeason populates the token picker (and gives us the
// display name/category), and itemTimeline builds the per-auction average
// series that the hand-rolled SVG chart plots.
export default function TimelinesPage() {
  const { sales, meta, loading, error } = useAuctionData();
  const [season, setSeason] = useState('');
  const [item, setItem] = useState('');

  const seasons = useMemo(() => seasonsOf(sales), [sales]);
  const activeSeason = season || seasons[0] || '';

  // Tokens that sold in the active season, alphabetical by display name.
  const tokens = useMemo(
    () => (activeSeason ? aggregateSeason(sales, activeSeason) : [])
      .slice().sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [sales, activeSeason],
  );

  // Keep the selected token only if it still sold in the chosen season;
  // otherwise fall back to the first available token.
  const activeItem = tokens.some((t) => t.item === item) ? item : (tokens[0]?.item ?? '');
  const activeToken = tokens.find((t) => t.item === activeItem);

  const points = useMemo(
    () => (activeItem ? itemTimeline(sales, meta, activeItem, activeSeason) : []),
    [sales, meta, activeItem, activeSeason],
  );

  const range = points.length
    ? { min: Math.min(...points.map((p) => p.avg)), max: Math.max(...points.map((p) => p.avg)) }
    : null;

  if (error) return <p className="err">Failed to load data: {error}</p>;
  if (loading) return <p className="empty">Loading auction data…</p>;

  return (
    <>
      <p className="sub">
        How a single token's auction price moved across a season. Each point is one
        auction's <strong>average</strong> sale price (a token can sell more than once per
        auction), ordered by close date. For per-season min/max/avg tables, see{' '}
        <Link to="/">Prices</Link>.
      </p>

      <div className="controls">
        <label>
          Season
          <select value={activeSeason} onChange={(e) => setSeason(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>
          Token
          <select value={activeItem} onChange={(e) => setItem(e.target.value)}>
            {tokens.map((t) => <option key={t.item} value={t.item}>{t.displayName}</option>)}
          </select>
        </label>
      </div>

      {activeToken && (
        <section className="cat-section" data-category={activeToken.category}>
          <h2 className="cat-header">{activeToken.displayName}</h2>
          <p className="meta-line">
            {activeToken.category} · {points.length} auction{points.length === 1 ? '' : 's'} in {activeSeason}
            {range && ` · avg range ${money(range.min)}–${money(range.max)}`}
          </p>
          <PriceTimeline points={points} label={activeToken.displayName} />
        </section>
      )}
      {!activeToken && <p className="empty">No tokens sold in {activeSeason}.</p>}
    </>
  );
}
