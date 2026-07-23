import { useState, type MouseEvent } from 'react';

// Hand-rolled SVG bar chart — zero dependencies, themes via CSS variables,
// same approach as PriceTimeline (see the note there on why we don't take a
// charting library). Covers both shapes the analytics pages need:
//
//   - one series, per-bar colour: days-to-close, coloured by auctioneer.
//   - two series side by side: this season vs the one before it.
//
// A null value means "no data for that category" and renders as a gap, never
// as a zero-height bar sitting on the axis — the difference between "nobody
// closed an auction that month" and "we never recorded it" is the whole point
// of the pre-2022 exclusions upstream.

export type BarSeries = {
  label: string;
  color: string;              // any CSS colour, usually a var(--series-N)
  values: (number | null)[];  // one per category, same order
};

export type BarChartProps = {
  categories: string[];       // x-axis labels, one per slot
  series: BarSeries[];
  /** Per-bar colour override for single-series charts, indexed like values. */
  barColors?: (string | undefined)[];
  /** Tooltip line under the category label, one per slot. */
  hints?: (string | undefined)[];
  yLabel?: string;
  format?: (n: number) => string;
  ariaLabel: string;
  /** Show every nth category label; defaults to a fit-to-width stride. */
  maxLabels?: number;
};

const W = 820, H = 320;
const M = { top: 16, right: 18, bottom: 46, left: 56 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

// Bars sit on zero (counts and durations are non-negative and a bar's length
// only means anything measured from zero), so unlike the line chart we do not
// frame tightly — we pick a nice round top.
function niceTop(max: number, targetTicks = 5) {
  if (max <= 0) return { hi: 1, ticks: [0, 1] };
  const step = niceNum(max / targetTicks, true);
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { hi, ticks };
}
function niceNum(x: number, round: boolean): number {
  const exp = Math.floor(Math.log10(x));
  const f = x / 10 ** exp;
  const nf = round
    ? (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10)
    : (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10);
  return nf * 10 ** exp;
}

export function BarChart({
  categories, series, barColors, hints, yLabel, format, ariaLabel, maxLabels = 12,
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const fmt = format ?? ((n: number) => String(Math.round(n * 10) / 10));
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!categories.length || !all.length) return <p className="empty">No data to chart.</p>;

  const { hi, ticks } = niceTop(Math.max(...all));
  const y = (v: number) => M.top + (1 - v / hi) * PLOT_H;

  // Each category gets an equal slot; the bars of the series share it with a
  // small gutter, so a two-series chart reads as pairs rather than a run.
  const slotW = PLOT_W / categories.length;
  const pad = Math.min(slotW * 0.18, 10);
  const groupW = slotW - pad * 2;
  const barW = groupW / series.length;

  const showLegend = series.length > 1;
  const stride = Math.max(1, Math.ceil(categories.length / maxLabels));

  // Hover is by category slot, so a thin bar (43 of them on the days-to-close
  // chart) doesn't require pixel-accurate pointing.
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.floor((svgX - M.left) / slotW);
    setHover(i >= 0 && i < categories.length ? i : null);
  };

  const tip = hover == null ? null : {
    label: categories[hover],
    hint: hints?.[hover],
    leftPct: ((M.left + slotW * (hover + 0.5)) / W) * 100,
    rows: series
      .map((s) => ({ label: s.label, color: barColors?.[hover] ?? s.color, value: s.values[hover] }))
      .filter((r) => r.value != null),
  };

  return (
    <div className="chartwrap">
      <div className="chart-plot">
        <svg
          className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        >
          {/* gridlines + y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--text)">{fmt(t)}</text>
            </g>
          ))}

          {yLabel && (
            <text x={-(M.top + PLOT_H / 2)} y={14} transform="rotate(-90)" textAnchor="middle"
              fontSize={12} fill="var(--text)">{yLabel}</text>
          )}

          {/* hovered slot highlight, drawn under the bars */}
          {hover != null && (
            <rect x={M.left + slotW * hover} y={M.top} width={slotW} height={PLOT_H}
              fill="var(--row-hover)" pointerEvents="none" />
          )}

          {/* bars */}
          {categories.map((cat, i) => (
            <g key={cat + i}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v == null) return null;
                const h = Math.max(v > 0 ? 1 : 0, PLOT_H - (y(v) - M.top));
                return (
                  <rect
                    key={s.label}
                    x={M.left + slotW * i + pad + barW * si}
                    y={y(v)} width={Math.max(1, barW - 1)} height={h}
                    fill={barColors?.[i] ?? s.color}
                    opacity={hover == null || hover === i ? 1 : 0.55}
                  />
                );
              })}
            </g>
          ))}

          {/* baseline */}
          <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth={1.5} />

          {/* x labels, strided so they never collide */}
          {categories.map((cat, i) => (i % stride === 0 || i === categories.length - 1) && (
            <text key={cat + i} x={M.left + slotW * (i + 0.5)} y={H - M.bottom + 18}
              textAnchor="middle" fontSize={12} fill="var(--text)">{cat}</text>
          ))}
        </svg>

        {tip && tip.rows.length > 0 && (
          // Same proportional-shift trick as PriceTimeline: the tooltip slides
          // so an edge tracks the cursor near the plot edges, keeping the whole
          // box inside the plot instead of overflowing it.
          <div className="chart-tooltip" style={{ left: `${tip.leftPct}%`, transform: `translateX(-${tip.leftPct}%)` }}>
            <div className="tt-date">{tip.label}</div>
            {tip.hint && <div className="tt-hint">{tip.hint}</div>}
            <ul>
              {tip.rows.map((r) => (
                <li key={r.label}>
                  <span className="dot" style={{ background: r.color }} />
                  {r.label}
                  <span className="tt-val">{fmt(r.value as number)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showLegend && (
        <ul className="chart-legend">
          {series.map((s) => (
            <li key={s.label}>
              <span className="swatch" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
