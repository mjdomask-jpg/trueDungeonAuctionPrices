// Colour resolution for box plots, kept out of the component file so BoxPlot can
// stay component-only for React Fast Refresh. Mirrors PriceTimeline's scheme: a
// named override maps to a theme-aware CSS var, a lone box takes its group's
// category colour, and everything else draws from the validated categorical
// palette (--series-1..8).

const LINE_COLORS: Record<string, string> = {
  'light-purple': 'var(--line-light-purple)',
  'dark-purple': 'var(--line-dark-purple)',
};

export function lineColorOf(raw: string | undefined): string | null {
  if (!raw) return null;
  return LINE_COLORS[raw.trim().toLowerCase().replace(/\s+/g, '-')] ?? raw.trim();
}

const seriesVar = (i: number) => `var(--series-${(i % 8) + 1})`;

// The colour a box (and its matching table row / legend swatch) wears. Explicit
// override → a lone box takes the group's category colour (matching the heading)
// → otherwise the categorical palette so boxes stay distinct. Shared by BoxPlot
// and the quartile table so the two always agree.
export function boxColorAt(boxes: { lineColor?: string }[], i: number): string {
  return lineColorOf(boxes[i].lineColor)
    ?? (boxes.length === 1 ? 'var(--cat-color, var(--series-1))' : seriesVar(i));
}
