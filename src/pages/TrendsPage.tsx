import { Link } from 'react-router-dom';
import { PageIntro } from '../components/PageIntro';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { useRoutedView } from '../hooks/useRoutedView';
import { TimelineTrends } from './TimelineTrends';
import { CompareTrends } from './CompareTrends';

// Trends merges the former Timelines and Compare Years pages into two lenses on
// price-over-time behind one view toggle (the pattern Analytics and Auction Data
// use): "Over a season" is the per-auction chart stack; "Year over year" is the
// two-season comparison table. Each lens keeps its own controls; this shell owns
// the intro and the toggle. The view is the URL: /trends/season (default) and
// /trends/yoy; /timelines and /compare redirect to those.
export type TrendView = 'season' | 'yoy';

export default function TrendsPage() {
  const [view, setView] = useRoutedView<TrendView>({
    views: ['season', 'yoy'],
    fallback: 'season',
    pathFor: (v) => `/trends/${v}`,
  });
  const narrow = useMediaQuery(NARROW);

  return (
    <>
      <PageIntro short="How token prices move over time — within a season, or year over year.">
        {view === 'season' ? (
          <>How each token's auction price moved across a season. Every point is one auction's{' '}
          <strong>average</strong> sale price, ordered by close date; tokens are grouped so
          similarly-priced ones share a chart. For per-season min/max/avg tables, see{' '}
          <Link to="/">Prices</Link>.</>
        ) : narrow ? (
          <>How each token's full-season price changed between two years. Pick{' '}
          <strong>Avg</strong>, <strong>Max</strong>, or <strong>Min</strong> to see that
          full-season value for each year; <strong>Δ</strong> is its change from the left year to
          the right. Tokens are matched across years by role, so a renamed token still lines up.</>
        ) : (
          <>How each token's full-season price changed between two years. Values are Max / Avg /
          Min for the whole season; <strong>Δ Avg</strong> is the change in average from the left
          year to the right. Tokens are matched across years by role, so a renamed token still
          lines up.</>
        )}
      </PageIntro>

      <div className="controls">
        <div className="toggle" role="group" aria-label="Trend view">
          <span className="toggle-label">View</span>
          <div className="toggle-buttons">
            <button type="button" data-label="Over a season" className={view === 'season' ? 'on' : undefined}
              aria-pressed={view === 'season'} onClick={() => setView('season')}>
              Over a season
            </button>
            <button type="button" data-label="Year over year" className={view === 'yoy' ? 'on' : undefined}
              aria-pressed={view === 'yoy'} onClick={() => setView('yoy')}>
              Year over year
            </button>
          </div>
        </div>
      </div>

      {view === 'season' ? <TimelineTrends /> : <CompareTrends />}
    </>
  );
}
