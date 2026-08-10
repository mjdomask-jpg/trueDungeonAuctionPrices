import { useMemo, useState } from 'react';
import { useAuctionData } from '../data/auctionDataContext';
import { useRoutedView } from '../hooks/useRoutedView';
import {
  seasonsWithCadence, currentSeason, priorSeason, metaSeasons,
} from '../lib/analytics';
import { CurrentYearStats } from '../components/CurrentYearStats';
import { HistoricalStats } from '../components/HistoricalStats';
import { QuartileStats } from '../components/QuartileStats';
import { ContextAnalytics } from '../components/ContextAnalytics';
import { PageIntro } from '../components/PageIntro';

// Auction analytics (Phase 5). Two views behind a toggle, matching the two
// workbook tabs this replaces — Current Year Auction Stats and Historical
// Stats. One route rather than two keeps the top-level nav from growing a
// seventh and eighth entry for what is really one subject.
//
// Nothing here is pinned to a year: the season selector is driven by what the
// metadata actually contains, and it opens on the newest season carrying
// cadence data. When the sheet exports a 2027 season, this page follows.

type View = 'current' | 'historical' | 'quartiles' | 'context';

export default function AnalyticsPage() {
  const { meta, sales, contextItems, auctionContext, groupRows, loading, error } = useAuctionData();
  const [view, setView] = useRoutedView<View>({
    views: ['current', 'historical', 'quartiles', 'context'],
    fallback: 'current',
    pathFor: (v) => `/analytics/${v}`,
  });
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
      <PageIntro className="lede" short="Statistics about the auctions, and how token prices were distributed.">
        Statistics about the auctions themselves — who ran them, when they opened, and how long
        they took to close — plus, under Quartiles, how each token's sale prices were distributed
        within a year.
      </PageIntro>

      <div className="controls">
        <div className="toggle" role="group" aria-label="Analytics view">
          <span className="toggle-label">View</span>
          <div className="toggle-buttons">
            <button type="button" data-label="Current Year" className={view === 'current' ? 'on' : undefined}
              aria-pressed={view === 'current'} onClick={() => setView('current')}>
              Current Year
            </button>
            <button type="button" data-label="Historical" className={view === 'historical' ? 'on' : undefined}
              aria-pressed={view === 'historical'} onClick={() => setView('historical')}>
              Historical
            </button>
            <button type="button" data-label="Quartiles" className={view === 'quartiles' ? 'on' : undefined}
              aria-pressed={view === 'quartiles'} onClick={() => setView('quartiles')}>
              Quartiles
            </button>
            <button type="button" data-label="Funding & Context" className={view === 'context' ? 'on' : undefined}
              aria-pressed={view === 'context'} onClick={() => setView('context')}>
              Funding &amp; Context
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

      {view === 'current' && (
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
      )}
      {view === 'historical' && <HistoricalStats meta={meta} sales={sales} />}
      {view === 'quartiles' && <QuartileStats sales={sales} groupRows={groupRows} />}
      {view === 'context' && (
        <ContextAnalytics
          meta={meta} sales={sales}
          contextItems={contextItems} auctionContext={auctionContext}
          groupRows={groupRows}
        />
      )}
    </>
  );
}
