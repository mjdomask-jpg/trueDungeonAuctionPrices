import { useState, type MouseEvent } from 'react';
import { money } from '../lib/format';
import type { ItemHistoryPoint } from '../lib/analytics';

// Filled area chart of one token's average price across every season it sold
// in. Hand-rolled SVG, zero dependencies, themes via CSS variables.
//
// One point per season, not per auction: eight seasons of per-auction data is
// several hundred points for a single token and reads as noise. The average is
// the line; the season's min–max range is drawn as a faint band behind it, so
// the compression stays visible rather than pretending each season was a
// single price. Seasons the token didn't sell in are simply absent — the line
// bridges them, and the tooltip's sale count shows where the data is thin.

const W = 820, H = 320;
const M = { top: 16, right: 22, bottom: 40, left: 64 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

function niceScale(min: number, max: number, targetTicks = 5) {
  if (max <= min) { const p = Math.max(1, Math.abs(max) * 0.1); min -= p; max += p; }
  const pad = (max - min) * 0.08;
  let lo = min - pad;
  const hi = max + pad;
  if (lo < 0) lo = 0; // prices are non-negative; never invent a negative axis
  const step = niceNum((hi - lo) / targetTicks, true);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(v);
  return { lo, hi, ticks };
}
function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

export function AreaChart({
  points, label, nameFor,
}: {
  points: ItemHistoryPoint[];
  label: string;
  /** Season → the display name the token carried that year, for the tooltip. */
  nameFor?: (season: string) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (!points.length) return <p className="empty">No sales recorded for this token.</p>;

  // Frame on the min–max band, not just the averages, so the band never spills
  // outside the plot.
  const { lo, hi, ticks } = niceScale(
    Math.min(...points.map((p) => p.min)),
    Math.max(...points.map((p) => p.max)),
  );

  const x = (i: number) => points.length === 1
    ? M.left + PLOT_W / 2
    : M.left + (i / (points.length - 1)) * PLOT_W;
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.avg)}`).join(' ');
  // Fill from the average line down to the axis floor — the "filled chart".
  const fill = `${line} L${x(points.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z`;
  // The min–max band: across the tops, back along the bottoms.
  const band = points.length > 1
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.max)}`).join(' ')
      + ' ' + points.slice().reverse().map((p, j) => `L${x(points.length - 1 - j)},${y(p.min)}`).join(' ') + ' Z'
    : null;

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const raw = points.length === 1 ? 0 : Math.round(((svgX - M.left) / PLOT_W) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, raw)));
  };

  const hp = hover == null ? null : points[hover];

  return (
    <div className="chartwrap">
      <div className="chart-plot">
        <svg className="area-chart" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Average auction price of ${label} by season`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.38" />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0.04" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--text)">{money(t)}</text>
            </g>
          ))}

          {band && <path d={band} fill="var(--series-1)" fillOpacity={0.1} stroke="none" />}
          <path d={fill} fill="url(#areaFill)" stroke="none" />
          {points.length > 1 && (
            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round" />
          )}

          {hover != null && (
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={H - M.bottom}
              stroke="var(--text)" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
          )}

          {points.map((p, i) => (
            <circle key={p.season} cx={x(i)} cy={y(p.avg)} r={hover === i ? 5 : 3.5}
              fill="var(--card)" stroke="var(--series-1)" strokeWidth={2} />
          ))}

          {points.map((p, i) => (
            <text key={p.season} x={x(i)} y={H - M.bottom + 20} textAnchor="middle"
              fontSize={12} fill="var(--text)">{p.season}</text>
          ))}
        </svg>

        {hp && (
          <div className="chart-tooltip"
            style={{ left: `${(x(hover as number) / W) * 100}%`, transform: `translateX(-${(x(hover as number) / W) * 100}%)` }}>
            <div className="tt-date">{hp.season}</div>
            {nameFor && <div className="tt-hint">{nameFor(hp.season)}</div>}
            <ul>
              <li><span className="dot" style={{ background: 'var(--series-1)' }} />Average<span className="tt-val">{money(hp.avg)}</span></li>
              <li><span className="dot" style={{ background: 'var(--border)' }} />Range<span className="tt-val">{money(hp.min)} – {money(hp.max)}</span></li>
              <li><span className="dot" style={{ background: 'var(--border)' }} />Sales<span className="tt-val">{hp.n}</span></li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
