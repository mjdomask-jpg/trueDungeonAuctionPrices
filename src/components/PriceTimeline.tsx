import { useState, type PointerEvent } from 'react';
import { type TimelinePoint } from '../lib/data';
import { money, fmtCloseDate } from '../lib/format';

// Hand-rolled multi-series SVG line chart — zero dependencies, themes via CSS
// variables. Each series is one token in a group; they share this chart's x
// (auction close-date order) and a single linear y auto-framed tightly to the
// group's range. Line colors come from a validated categorical palette
// (--series-1..8) or per-token overrides; a legend maps color→token so identity
// never rests on color alone (the palette's light/dark relief needs it). Moving
// over the plot drops a crosshair and a tooltip of every series' value at the
// nearest auction.

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

// Frame tightly to the data: pad the range ~6% and place nice round ticks
// *inside* that band (rather than flooring the bottom to $0, which flattens a
// high, narrow-range series). Only when the data genuinely sits near zero does
// the axis include $0 — prices are non-negative, so we never invent a negative.
function niceScale(min: number, max: number, targetTicks = 5) {
  if (max <= min) { const p = Math.max(1, Math.abs(max) * 0.1); min -= p; max += p; }
  const pad = (max - min) * 0.06;
  let lo = min - pad;
  const hi = max + pad;
  if (lo < 0 && min >= 0) lo = 0;
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

const seriesVar = (i: number) => `var(--series-${(i % 8) + 1})`;

export function PriceTimeline({ series, title }: { series: Series[]; title: string }) {
  const [active, setActive] = useState<number | null>(null); // legend emphasis
  const [hoverN, setHoverN] = useState<number | null>(null); // crosshair auction
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

  // x-axis labels: every xStride slots, plus always the last one — but drop any
  // strided label that would sit within a stride of the forced last (otherwise
  // the final two dates overlap, e.g. Jun 28 / Jul 17).
  const xStride = Math.max(1, Math.ceil(slots.length / 8));
  const last = slots.length - 1;
  const labelIdx = new Set<number>();
  for (let i = 0; i < slots.length; i += xStride) labelIdx.add(i);
  for (const i of [...labelIdx]) if (i !== last && last - i < xStride) labelIdx.delete(i);
  labelIdx.add(last);

  const showLegend = series.length > 1;

  // Line colour: explicit override → a lone series takes its category colour
  // (matching the heading) → otherwise the categorical palette for distinctness.
  const strokeFor = (si: number) =>
    lineColorOf(series[si].lineColor)
    ?? (series.length === 1 ? 'var(--cat-color, var(--series-1))' : seriesVar(si));

  // Map the cursor to the nearest auction slot (works through the SVG's scaling
  // via the rendered rect). setState with the same slot is a no-op re-render.
  // Pointer (not mouse) events so touch works too: a mouse hover fires
  // pointermove; a finger fires pointerdown on tap and pointermove while it
  // drags. touch-action is left alone, so a deliberate horizontal drag still
  // scrolls the (min-width 480px) chart — a tap is enough to read a point.
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!slots.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const raw = slots.length === 1 ? 0 : Math.round(((svgX - M.left) / PLOT_W) * (slots.length - 1));
    setHoverN(slots[Math.max(0, Math.min(slots.length - 1, raw))][0]);
  };

  // Tooltip: every series that has a point at the hovered auction.
  const tip = hoverN == null ? null : (() => {
    const rows = series
      .map((s, si) => {
        const p = s.points.find((pt) => pt.auctionNumber === hoverN);
        return p ? { label: s.label, color: strokeFor(si), p } : null;
      })
      .filter((r): r is { label: string; color: string; p: TimelinePoint } => r !== null);
    if (!rows.length) return null;
    return { date: fmtCloseDate(slotDate.get(hoverN)!) ?? `#${hoverN}`, rows, leftPct: (x(hoverN) / W) * 100 };
  })();

  return (
    <div className="chartwrap">
      <div className="chart-plot">
        <svg
          className="timeline-chart" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Average auction price over time for ${title}: ${series.map((s) => s.label).join(', ')}`}
          onPointerMove={onMove} onPointerDown={onMove}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHoverN(null); }}
        >
          {/* gridlines + y ($) labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--text)">{money(t)}</text>
            </g>
          ))}

          {/* x-axis close-date labels */}
          {slots.map(([n, d], i) => labelIdx.has(i) && (
            <text key={n} x={x(n)} y={H - M.bottom + 20} textAnchor="middle" fontSize={12} fill="var(--text)">
              {fmtCloseDate(d) ?? `#${n}`}
            </text>
          ))}

          {/* crosshair at the hovered auction */}
          {hoverN != null && tip && (
            <line x1={x(hoverN)} x2={x(hoverN)} y1={M.top} y2={H - M.bottom}
              stroke="var(--text)" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
          )}

          {/* one line + points per series; a legend hover dims the others */}
          {series.map((s, si) => {
            const pts = s.points.slice().sort((a, b) => slotIndex.get(a.auctionNumber)! - slotIndex.get(b.auctionNumber)!);
            const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.auctionNumber)},${y(p.avg)}`).join(' ');
            const dim = active !== null && active !== si;
            return (
              <g key={s.label} style={{ opacity: dim ? 0.18 : 1, transition: 'opacity 0.12s ease' }}>
                {pts.length > 1 && (
                  <path d={d} fill="none" stroke={strokeFor(si)} strokeWidth={active === si ? 3 : 2}
                    strokeLinejoin="round" strokeLinecap="round" />
                )}
                {pts.map((p) => (
                  <circle key={p.auctionNumber} cx={x(p.auctionNumber)} cy={y(p.avg)}
                    r={hoverN === p.auctionNumber ? 5 : 3.5}
                    fill="var(--card)" stroke={strokeFor(si)} strokeWidth={2} />
                ))}
              </g>
            );
          })}
        </svg>

        {tip && (
          // Position by percent of the plot width and shift the tooltip by that
          // same percent of its OWN width: centered mid-plot, but sliding so an
          // edge (not the middle) tracks the crosshair near the ends — which
          // keeps the whole tooltip inside the plot (no overflow/scrollbar).
          <div className="chart-tooltip" style={{ left: `${tip.leftPct}%`, transform: `translateX(-${tip.leftPct}%)` }}>
            <div className="tt-date">{tip.date}</div>
            <ul>
              {tip.rows.map((r) => (
                <li key={r.label}>
                  <span className="dot" style={{ background: r.color }} />
                  {r.label}
                  <span className="tt-val">
                    {money(r.p.avg)}{r.p.n > 1 ? ` · ${r.p.n}×` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

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
