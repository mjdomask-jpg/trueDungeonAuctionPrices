import { useEffect, useRef, useState } from 'react';

// Hand-rolled SVG pie — zero dependencies, themes via CSS variables.
// Used as small multiples: one pie per season showing each auctioneer's share
// of that season's auctions.
//
// Slices arrive already aggregated (see auctioneerSharesBySeason, which folds
// everyone who ran a single auction that season into one slice). A slice may
// therefore stand for several people; `members` carries their names, and both
// the wedge and its legend entry reveal the full list on hover.
//
// The categorical palette has 8 hues, so anything past `maxSlices - 1` still
// collapses into a trailing "Other" wedge as a backstop. With the current data
// that never fires — the largest season is 8 slices after aggregation — but a
// future season with many multi-auction runners would otherwise reuse colours.

export type PieSlice = {
  label: string;
  count: number;
  share: number;
  /** Names behind an aggregated slice; absent when the slice is one person. */
  members?: string[];
};

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

const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

export function PieChart({
  slices, title, subtitle, maxSlices = 8,
}: {
  slices: PieSlice[];
  title: string;
  subtitle?: string;
  maxSlices?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const figureRef = useRef<HTMLElement>(null);

  // Desktop reveals a wedge's detail on hover; touch has none, so a tap on a
  // wedge or its legend row opens it (and taps it again to close), while a tap
  // anywhere outside the figure dismisses it. Mouse still uses enter/leave.
  useEffect(() => {
    if (active == null) return;
    const onDocDown = (e: globalThis.PointerEvent) => {
      if (figureRef.current && !figureRef.current.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', onDocDown);
    return () => document.removeEventListener('pointerdown', onDocDown);
  }, [active]);
  const tapToggle = (i: number) => (e: { pointerType?: string }) => {
    if (e.pointerType !== 'mouse') setActive((a) => (a === i ? null : i));
  };

  if (!slices.length) return null;

  let shown: (PieSlice & { folded?: number })[] = slices;
  if (slices.length > maxSlices) {
    const head = slices.slice(0, maxSlices - 1);
    const tail = slices.slice(maxSlices - 1);
    shown = [...head, {
      label: OTHER,
      count: tail.reduce((a, s) => a + s.count, 0),
      share: tail.reduce((a, s) => a + s.share, 0),
      folded: tail.length,
      // Roll up the tail's own names so the Other wedge stays inspectable too.
      members: tail.flatMap((s) => s.members ?? [s.label]).sort((a, b) => (a < b ? -1 : 1)),
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
  const hovered = active == null ? null : wedges[active];

  return (
    <figure className="pie" ref={figureRef}>
      <figcaption>
        <span className="pie-title">{title}</span>
        {subtitle && <span className="pie-sub">{subtitle}</span>}
      </figcaption>

      {/* The tooltip is positioned over the pie rather than following the
          cursor: these are small multiples, and a cursor-tracked tooltip in a
          200px figure spends most of its time outside its own chart. */}
      <div className="pie-plot">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
          aria-label={`${title}: ${shown.map((s) => `${s.label} ${pct(s.share)}`).join(', ')}`}>
          {wedges.map((w, i) => (
            <path
              key={w.label} d={arcPath(w.start, w.end)} fill={w.color}
              stroke="var(--card)" strokeWidth={1.5}
              opacity={active == null || active === i ? 1 : 0.4}
              onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
              onPointerDown={tapToggle(i)}
            />
          ))}
        </svg>

        {hovered && (
          <div className="pie-tooltip" role="status">
            <div className="tt-date">
              <span className="dot" style={{ background: hovered.color }} />
              {hovered.label}
            </div>
            <div className="tt-hint">
              {hovered.count} auction{hovered.count === 1 ? '' : 's'} · {pct(hovered.share)}
            </div>
            {hovered.members && (
              <ul className="pie-members">
                {hovered.members.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      <ul className="pie-legend">
        {wedges.map((w, i) => (
          <li key={w.label}
            className={active != null && active !== i ? 'dim' : undefined}
            onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
            onPointerDown={tapToggle(i)}>
            <span className="swatch" style={{ background: w.color }} />
            <span className="pie-name">
              {w.label}{w.folded ? ` (${w.folded})` : ''}
            </span>
            <span className="pie-val">{w.count} · {pct(w.share)}</span>
          </li>
        ))}
      </ul>

      <p className="pie-total">{total} auction{total === 1 ? '' : 's'}</p>
    </figure>
  );
}
