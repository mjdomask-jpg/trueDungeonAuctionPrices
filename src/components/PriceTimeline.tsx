import { type TimelinePoint } from '../lib/data';
import { money, fmtCloseDate } from '../lib/format';

// Hand-rolled SVG line chart — zero dependencies, themes via CSS variables
// (stroke/fill reference --accent/--text/--border so light & dark work for
// free). Points are evenly spaced in the order given (close-date order, set by
// itemTimeline); the y-axis frames to the data range with a "nice" tick scale
// rather than forcing a $0 baseline, so real price movement stays visible.

// Fixed viewBox space; the <svg> scales to its container width via CSS.
const W = 820, H = 360;
const M = { top: 16, right: 18, bottom: 40, left: 60 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

// "Nice" axis bounds + step (Heckbert): rounds [lo,hi] out to human numbers so
// tick labels read as $120, $140… and the line gets a little natural headroom.
function niceScale(lo: number, hi: number, maxTicks = 5) {
  if (hi <= lo) { const p = Math.max(1, Math.abs(hi) * 0.1); lo -= p; hi += p; }
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / (maxTicks - 1), true);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceLo; v <= niceHi + step / 2; v += step) ticks.push(v);
  return { lo: niceLo, hi: niceHi, ticks };
}
function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

export function PriceTimeline({ points, label }: { points: TimelinePoint[]; label: string }) {
  if (points.length === 0) return <p className="empty">No sales to chart.</p>;

  const values = points.map((p) => p.avg);
  const { lo, hi, ticks } = niceScale(Math.min(...values), Math.max(...values));

  // Scales. A single point is centred; otherwise spread evenly across the plot.
  const x = (i: number) => points.length === 1
    ? M.left + PLOT_W / 2
    : M.left + (i / (points.length - 1)) * PLOT_W;
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.avg)}`).join(' ');

  // Thin x labels so they never collide: aim for ~8 max.
  const xStride = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="chartwrap">
      <svg
        className="timeline-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Average auction price of ${label} over time`}
      >
        {/* Horizontal gridlines + y-axis ($) labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)}
              stroke="var(--border)" strokeWidth={1}
            />
            <text
              x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end"
              fontSize={12} fill="var(--text)"
            >
              {money(t)}
            </text>
          </g>
        ))}

        {/* x-axis close-date labels */}
        {points.map((p, i) => (i % xStride === 0 || i === points.length - 1) && (
          <text
            key={p.auctionNumber} x={x(i)} y={H - M.bottom + 20} textAnchor="middle"
            fontSize={12} fill="var(--text)"
          >
            {fmtCloseDate(p.closeDate) ?? `#${p.auctionNumber}`}
          </text>
        ))}

        {/* The price line */}
        {points.length > 1 && (
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* Points, each with a native hover tooltip */}
        {points.map((p, i) => (
          <circle
            key={p.auctionNumber} className="pt" cx={x(i)} cy={y(p.avg)} r={3.5}
            fill="var(--card)" stroke="var(--accent)" strokeWidth={2}
          >
            <title>
              {`Auction #${p.auctionNumber}`}
              {fmtCloseDate(p.closeDate) ? ` · ${fmtCloseDate(p.closeDate)}` : ''}
              {`\nAvg ${money(p.avg)}`}
              {p.n > 1 ? ` (${p.n} sales · ${money(p.min)}–${money(p.max)})` : ''}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
