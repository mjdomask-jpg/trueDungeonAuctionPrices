import { useMemo, useState } from 'react';
import { useAuctionData } from '../data/auctionDataContext';
import {
  seasonsWithCadence, currentSeason, priorSeason, metaSeasons,
} from '../lib/analytics';
import { CurrentYearStats } from '../components/CurrentYearStats';
import { HistoricalStats } from '../components/HistoricalStats';
import { PageIntro } from '../components/PageIntro';

// Auction analytics (Phase 5). Two views behind a toggle, matching the two
// workbook tabs this replaces — Current Year Auction Stats and Historical
// Stats. One route rather than two keeps the top-level nav from growing a
// seventh and eighth entry for what is really one subject.
//
// Nothing here is pinned to a year: the season selector is driven by what the
// metadata actually contains, and it opens on the newest season carrying
// cadence data. When the sheet exports a 2027 season, this page follows.

type View = 'current' | 'historical';

export default function AnalyticsPage() {
  const { meta, sales, onyxSales, loading, error } = useAuctionData();
  const [view, setView] = useState<View>('current');
  const [picked, setPicked] = useState<string>('');

  // Only seasons with open/close month and duration data can drive the Current
  // Year panels; 2019–21 predate those columns and are excluded rather than
  // rendered as a page of empty months.
  const cadence = useMemo(() => seasonsWithCadence(meta), [meta]);
  const latest = useMemo(() => currentSeason(meta), [meta]);
  const season = picked && cadence.includes(picked) ? picked : latest;
  const prior = useMemo(() => (season ? priorSeason(meta, season) : null), [meta, season]);

  const allSeasons = useMemo(() => metaSeasons(meta), [meta]);
  const excluded = allSeasons.filter((s) => !cadence.includes(s));

  if (loading) return <p className="empty">Loading…</p>;
  if (error) return <p className="empty">{error}</p>;
  if (!meta.length) return <p className="empty">No auction metadata loaded.</p>;

  return (
    <>
      <PageIntro className="lede" short="Statistics about the auctions themselves.">
        Statistics about the auctions themselves — who ran them, when they opened, and how long
        they took to close — rather than what the tokens sold for.
      </PageIntro>

      <div className="controls">
        <div className="toggle" role="group" aria-label="Analytics view">
          <span className="toggle-label">View</span>
          <div className="toggle-buttons">
            <button type="button" className={view === 'current' ? 'on' : undefined}
              aria-pressed={view === 'current'} onClick={() => setView('current')}>
              Current Year
            </button>
            <button type="button" className={view === 'historical' ? 'on' : undefined}
              aria-pressed={view === 'historical'} onClick={() => setView('historical')}>
              Historical
            </button>
          </div>
        </div>

        {view === 'current' && cadence.length > 1 && (
          <label>
            Season
            <select value={season ?? ''} onChange={(e) => setPicked(e.target.value)}>
              {cadence.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>

      {view === 'current' ? (
        !season ? (
          <p className="empty">
            No season has the open/close month and duration data these panels need.
          </p>
        ) : (
          <>
            {excluded.length > 0 && (
              <p className="an-note">
                {excluded.join(', ')} {excluded.length === 1 ? 'is' : 'are'} not offered here — those
                seasons predate the open date, close date and duration columns. They still appear
                under Historical, which only needs the season and auctioneer.
              </p>
            )}
            <CurrentYearStats meta={meta} season={season} prior={prior} />
          </>
        )
      ) : (
        <HistoricalStats meta={meta} sales={sales} onyxSales={onyxSales} />
      )}
    </>
  );
}
