import { useState } from 'react';

// Hand-rolled SVG pie — zero dependencies, themes via CSS variables.
// Used as small multiples: one pie per season showing each auctioneer's share
// of that season's auctions.
//
// The categorical palette has 8 hues and some seasons had 17 different
// auctioneers, so anything past the first `maxSlices - 1` collapses into a
// single "Other" wedge. The collapse is by count, so the people who actually
// shaped a season stay named and the long tail of one-offs stops fragmenting
// the pie into unreadable slivers. The exact tail is never hidden — the legend
// says how many were folded in, and the tooltip gives any wedge's real count.

export type PieSlice = { label: string; count: number; share: number };

const SIZE = 200;
const R = 78;
const CX = SIZE / 2, CY = SIZE / 2;
const OTHER = 'Other';

const sliceVar = (i: number) => `var(--series-${(i % 8) + 1})`;

// Standard circle-to-path: start at 12 o'clock and sweep clockwise.
function arcPath(startFrac: number, endFrac: number): string {
  // A full circle can't be drawn as a single arc (start == end), so draw it as
  // two half-arcs instead of silently rendering nothing.
  if (endFrac - startFrac >= 1) {
    return `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX} ${CY + R} A ${R} ${R} 0 1 1 ${CX} ${CY - R} Z`;
  }
  const a0 = startFrac * 2 * Math.PI - Math.PI / 2;
  const a1 = endFrac * 2 * Math.PI - Math.PI / 2;
  const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
  const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  return `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
}

export function PieChart({
  slices, title, subtitle, maxSlices = 8,
}: {
  slices: PieSlice[];
  title: string;
  subtitle?: string;
  maxSlices?: number;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (!slices.length) return null;

  // Collapse the tail. `folded` is how many real auctioneers the Other wedge
  // stands for, so the legend can say so rather than just "Other".
  let shown: (PieSlice & { folded?: number })[] = slices;
  if (slices.length > maxSlices) {
    const head = slices.slice(0, maxSlices - 1);
    const tail = slices.slice(maxSlices - 1);
    shown = [...head, {
      label: OTHER,
      count: tail.reduce((a, s) => a + s.count, 0),
      share: tail.reduce((a, s) => a + s.share, 0),
      folded: tail.length,
    }];
  }

  // Accumulate fractions rather than summing shares per wedge, so float drift
  // can't leave a hairline gap at 12 o'clock.
  let acc = 0;
  const wedges = shown.map((s, i) => {
    const start = acc;
    acc += s.share;
    return { ...s, start, end: i === shown.length - 1 ? 1 : acc, color: sliceVar(i) };
  });

  const total = slices.reduce((a, s) => a + s.count, 0);

  return (
    <figure className="pie">
      <figcaption>
        <span className="pie-title">{title}</span>
        {subtitle && <span className="pie-sub">{subtitle}</span>}
      </figcaption>

      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
        aria-label={`${title}: ${shown.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(', ')}`}>
        {wedges.map((w, i) => (
          <path
            key={w.label} d={arcPath(w.start, w.end)} fill={w.color}
            stroke="var(--card)" strokeWidth={1.5}
            opacity={active == null || active === i ? 1 : 0.45}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
          />
        ))}
      </svg>

      <ul className="pie-legend">
        {wedges.map((w, i) => (
          <li key={w.label}
            className={active != null && active !== i ? 'dim' : undefined}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
            <span className="swatch" style={{ background: w.color }} />
            <span className="pie-name">
              {w.label}{w.folded ? ` (${w.folded})` : ''}
            </span>
            <span className="pie-val">{w.count} · {(w.share * 100).toFixed(w.share < 0.1 ? 1 : 0)}%</span>
          </li>
        ))}
      </ul>

      <p className="pie-total">{total} auction{total === 1 ? '' : 's'}</p>
    </figure>
  );
}
