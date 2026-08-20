import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { type BoxStats } from '../lib/quartiles';
import { boxColorAt } from '../lib/boxColors';
import { money, money0 } from '../lib/format';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { tokenAbbreviation } from '../lib/tokenAbbreviations';

// Hand-rolled multi-box box-and-whisker chart — the distribution counterpart to
// PriceTimeline, sharing its conventions: zero dependencies, themed via CSS
// variables, a validated categorical palette (--series-1..8) with per-token
// overrides, a legend so identity never rests on colour alone, and a tap/hover
// tooltip. Each box is one token in a Timelines group; all boxes share one
// linear price axis auto-framed to the group's range (outliers included). Tukey
// convention: box = Q1–Q3, line = median, whiskers reach the furthest point
// within 1.5×IQR, dots beyond that are outliers.

export type Box = { label: string; stats: BoxStats; lineColor?: string };

// Frame tightly to the data with a ~6% pad and nice round ticks inside the band
// — same behaviour as PriceTimeline's niceScale, kept local so each chart owns
// its axis. Prices are non-negative, so the floor never goes below 0.
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

export function BoxPlot({ boxes, title }: { boxes: Box[]; title: string }) {
  const [active, setActive] = useState<number | null>(null); // legend emphasis
  const [hoverN, setHoverN] = useState<number | null>(null); // read-out box
  const narrow = useMediaQuery(NARROW);
  const svgRef = useRef<SVGSVGElement>(null);

  // On touch there's no pointer-leave, so a tap outside the chart clears the
  // read-out (a tap on another box just moves it). Mouse hover self-clears.
  useEffect(() => {
    if (hoverN == null) return;
    const onDocDown = (e: globalThis.PointerEvent) => {
      if (svgRef.current && !svgRef.current.contains(e.target as Node)) setHoverN(null);
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, [hoverN]);

  // Phones get a narrower viewBox so axis text renders at a legible size in a
  // ~335px card without sideways scroll (see PriceTimeline for the reasoning).
  const W = narrow ? 420 : 820;
  const H = narrow ? 300 : 360;
  const M = narrow
    ? { top: 14, right: 14, bottom: 34, left: 60 }
    : { top: 16, right: 18, bottom: 34, left: 60 };
  const PLOT_W = W - M.left - M.right;
  const PLOT_H = H - M.top - M.bottom;
  const axisFont = narrow ? 15 : 12;

  if (!boxes.length) return <p className="empty">No sales to chart.</p>;

  // Shared y: the union of every box's full extent (min/max already include
  // outliers), so no dot ever falls outside the frame.
  const allLo = Math.min(...boxes.map((b) => b.stats.min));
  const allHi = Math.max(...boxes.map((b) => b.stats.max));
  const { lo, hi, ticks } = niceScale(allLo, allHi);
  const tickLabel = ticks.every(Number.isInteger) ? money0 : money;

  const y = (v: number) => M.top + (1 - (v - lo) / (hi - lo)) * PLOT_H;
  // Evenly-spaced bands; a box centres in its band. Cap the width so two boxes
  // don't merge into a slab, and the whole band stays tappable regardless.
  const band = PLOT_W / boxes.length;
  const cx = (i: number) => M.left + band * (i + 0.5);
  const bw = Math.min(band * 0.5, narrow ? 40 : 64);

  const showLegend = boxes.length > 1;

  const strokeFor = (i: number) => boxColorAt(boxes, i);

  // Legend ordered alphabetically by full token name (reads the same on any
  // screen); phones swap in community abbreviations to keep labels on one line.
  const legendOrder = boxes
    .map((_, i) => i)
    .sort((a, b) => boxes[a].label.localeCompare(boxes[b].label));
  const legendLabel = (b: Box) => (narrow ? tokenAbbreviation(b.label) : b.label);

  // Map the cursor's x to the nearest band (works through the SVG's scaling via
  // the rendered rect). A finger fires pointerdown on tap; a mouse fires move.
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const raw = Math.floor((svgX - M.left) / band);
    setHoverN(Math.max(0, Math.min(boxes.length - 1, raw)));
  };

  const tip = hoverN == null ? null : (() => {
    const b = boxes[hoverN];
    return { box: b, color: strokeFor(hoverN), leftPct: (cx(hoverN) / W) * 100 };
  })();

  const capW = bw * 0.5; // whisker cap half-lines

  return (
    <div className="chartwrap">
      <div className="chart-plot">
        <svg
          ref={svgRef}
          className="timeline-chart" viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Price distribution box plots for ${title}: ${boxes.map((b) => b.label).join(', ')}`}
          onPointerMove={onMove} onPointerDown={onMove}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHoverN(null); }}
        >
          {/* gridlines + y ($) labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={axisFont} fill="var(--text)">{tickLabel(t)}</text>
            </g>
          ))}

          {/* one box per token */}
          {boxes.map((b, i) => {
            const s = b.stats;
            const color = strokeFor(i);
            const x = cx(i);
            const dim = active !== null && active !== i;
            const hot = hoverN === i;
            return (
              <g key={b.label} style={{ opacity: dim ? 0.18 : 1, transition: 'opacity 0.12s ease' }}>
                {/* whisker spine + caps */}
                <line x1={x} x2={x} y1={y(s.whiskerHi)} y2={y(s.whiskerLo)} stroke={color} strokeWidth={hot ? 2 : 1.5} />
                <line x1={x - capW / 2} x2={x + capW / 2} y1={y(s.whiskerHi)} y2={y(s.whiskerHi)} stroke={color} strokeWidth={hot ? 2 : 1.5} />
                <line x1={x - capW / 2} x2={x + capW / 2} y1={y(s.whiskerLo)} y2={y(s.whiskerLo)} stroke={color} strokeWidth={hot ? 2 : 1.5} />
                {/* IQR box */}
                <rect x={x - bw / 2} y={y(s.q3)} width={bw} height={Math.max(1, y(s.q1) - y(s.q3))}
                  fill={color} fillOpacity={0.18} stroke={color} strokeWidth={hot ? 2 : 1.5} rx={2} />
                {/* median */}
                <line x1={x - bw / 2} x2={x + bw / 2} y1={y(s.median)} y2={y(s.median)} stroke="var(--text-h)" strokeWidth={2} />
                {/* outliers */}
                {s.outliers.map((v, k) => (
                  <circle key={k} cx={x} cy={y(v)} r={2.4} fill="none" stroke={color} strokeWidth={1.2} />
                ))}
              </g>
            );
          })}

          {/* single-box groups caption the token under its box (there's room for
              one name); multi-box groups rely on the legend + tooltip instead. */}
          {!showLegend && (
            <text x={cx(0)} y={H - M.bottom + 20} textAnchor="middle" fontSize={axisFont} fill="var(--text)">
              {legendLabel(boxes[0])}
            </text>
          )}
        </svg>

        {tip && (
          <div className="chart-tooltip" style={{ left: `${tip.leftPct}%`, transform: `translateX(-${tip.leftPct}%)` }}>
            <div className="tt-date">
              <span className="dot" style={{ background: tip.color }} /> {tip.box.label}
            </div>
            <ul className="tt-stats">
              <li>Max<span className="tt-val">{money(tip.box.stats.max)}</span></li>
              <li>Q3<span className="tt-val">{money(tip.box.stats.q3)}</span></li>
              <li>Median<span className="tt-val">{money(tip.box.stats.median)}</span></li>
              <li>Q1<span className="tt-val">{money(tip.box.stats.q1)}</span></li>
              <li>Min<span className="tt-val">{money(tip.box.stats.min)}</span></li>
              <li className="tt-sep">IQR<span className="tt-val">{money(tip.box.stats.iqr)}</span></li>
              <li>n<span className="tt-val">{tip.box.stats.n}</span></li>
            </ul>
          </div>
        )}
      </div>

      {showLegend && (
        <ul className="chart-legend">
          {legendOrder.map((i) => {
            const b = boxes[i];
            return (
              <li key={b.label}
                className={active !== null && active !== i ? 'dim' : undefined}
                onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
                onClick={() => setActive((a) => (a === i ? null : i))}>
                <span className="swatch" style={{ background: strokeFor(i) }} />
                {legendLabel(b)}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
