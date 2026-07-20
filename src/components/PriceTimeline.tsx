import { useState } from 'react';
import { type TimelinePoint } from '../lib/data';
import { money, fmtCloseDate } from '../lib/format';

// Hand-rolled multi-series SVG line chart — zero dependencies, themes via CSS
// variables. Each series is one token in a group; they share this chart's x
// (auction close-date order) and a single linear y auto-framed to the group's
// range. Line colors come from a validated categorical palette (--series-1..8,
// defined in index.css); a legend maps color→token so identity never rests on
// color alone (the light-mode relief rule + dark-mode CVD floor both need it).

export type Series = { label: string; points: TimelinePoint[]; lineColor?: string };

// Named line-colour overrides map to theme-aware CSS vars (defined in
// index.css); anything else is passed through as a raw CSS colour.
const LINE_COLORS: Record<string, string> = {
  'light-purple': 'var(--line-light-purple)',
  'dark-purple': 'var(--line-dark-purple)',
};
function lineColorOf(raw: string | undefined): string | null {
  if (!raw) return null;
  return LINE_COLORS[raw.trim().toLowerCase().replace(/\s+/g, '-')] ?? raw.trim();
}

const W = 820, H = 360;
const M = { top: 16, right: 18, bottom: 40, left: 60 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

const dateKey = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '');

// "Nice" axis bounds + step (Heckbert) so tick labels read as $120, $140…
function niceScale(lo: number, hi: number, maxTicks = 5) {
  if (hi <= lo) { const p = Math.max(1, Math.abs(hi) * 0.1); lo -= p; hi += p; }
  const step = niceNum(niceNum(hi - lo, false) / (maxTicks - 1), true);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceLo; v <= niceHi + step / 2; v += step) ticks.push(v);
  return { lo: niceLo, hi: niceHi, ticks };
}
function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

const seriesVar = (i: number) => `var(--series-${(i % 8) + 1})`;

export function PriceTimeline({ series, title }: { series: Series[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (series.every((s) => s.points.length === 0)) return <p className="empty">No sales to chart.</p>;

  // Shared x: the union of auctions any series sold in, ordered by close date.
  const slotDate = new Map<number, string>();
  for (const s of series) for (const p of s.points) if (!slotDate.has(p.auctionNumber)) slotDate.set(p.auctionNumber, p.closeDate);
  const slots = [...slotDate.entries()].sort((a, b) => {
    const ka = dateKey(a[1]), kb = dateKey(b[1]);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a[0] - b[0];
  });
  const slotIndex = new Map(slots.map(([n], i) => [n, i]));

  const allValues = series.flatMap((s) => s.points.map((p) => p.avg));
  const { lo, hi, ticks } = niceScale(Math.min(...allValues), Math.max(...allValues));

  const x = (n: number) => slots.length === 1
    ? M.left + PLOT_W / 2
    : M.left + (slotIndex.get(n)! / (slots.length - 1)) * PLOT_W;
  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const xStride = Math.max(1, Math.ceil(slots.length / 8));
  const showLegend = series.length > 1;

  // Line colour: explicit override → a lone series takes its category colour
  // (matching the heading) → otherwise the categorical palette for distinctness.
  const strokeFor = (si: number) =>
    lineColorOf(series[si].lineColor)
    ?? (series.length === 1 ? 'var(--cat-color, var(--series-1))' : seriesVar(si));

  return (
    <div className="chartwrap">
      <svg
        className="timeline-chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Average auction price over time for ${title}: ${series.map((s) => s.label).join(', ')}`}
      >
        {/* gridlines + y ($) labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--text)">{money(t)}</text>
          </g>
        ))}

        {/* x-axis close-date labels */}
        {slots.map(([n, d], i) => (i % xStride === 0 || i === slots.length - 1) && (
          <text key={n} x={x(n)} y={H - M.bottom + 20} textAnchor="middle" fontSize={12} fill="var(--text)">
            {fmtCloseDate(d) ?? `#${n}`}
          </text>
        ))}

        {/* one line + points per series; hovering dims the others */}
        {series.map((s, si) => {
          const pts = s.points.slice().sort((a, b) => slotIndex.get(a.auctionNumber)! - slotIndex.get(b.auctionNumber)!);
          const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.auctionNumber)},${y(p.avg)}`).join(' ');
          const dim = active !== null && active !== si;
          return (
            <g key={s.label} style={{ opacity: dim ? 0.18 : 1, transition: 'opacity 0.12s ease' }}
              onMouseEnter={() => setActive(si)} onMouseLeave={() => setActive(null)}>
              {pts.length > 1 && (
                <path d={d} fill="none" stroke={strokeFor(si)} strokeWidth={active === si ? 3 : 2}
                  strokeLinejoin="round" strokeLinecap="round" />
              )}
              {pts.map((p) => (
                <circle key={p.auctionNumber} className="pt" cx={x(p.auctionNumber)} cy={y(p.avg)} r={3.5}
                  fill="var(--card)" stroke={strokeFor(si)} strokeWidth={2}>
                  <title>
                    {`${s.label} — Auction #${p.auctionNumber}`}
                    {fmtCloseDate(p.closeDate) ? ` · ${fmtCloseDate(p.closeDate)}` : ''}
                    {`\nAvg ${money(p.avg)}`}
                    {p.n > 1 ? ` (${p.n} sales · ${money(p.min)}–${money(p.max)})` : ''}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {showLegend && (
        <ul className="chart-legend">
          {series.map((s, si) => (
            <li key={s.label}
              className={active !== null && active !== si ? 'dim' : undefined}
              onMouseEnter={() => setActive(si)} onMouseLeave={() => setActive(null)}>
              <span className="swatch" style={{ background: strokeFor(si) }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
