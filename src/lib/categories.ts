// The site-wide display order for token categories, and the comparator built
// on it. This lived duplicated in DashboardPage and ComparePage; the auction
// explorer needed a third copy, so it moved here instead.

// Fixed display order. Any category not listed is appended afterward,
// alphabetically (see compareCategories).
export const CATEGORY_ORDER = [
  'Trade 1', 'Trade 2', 'Ultra Rare', 'Premium', 'Bonus', 'Preorder', 'Golden Ticket',
];

// Sort comparator: listed categories in CATEGORY_ORDER, then everything else
// alphabetically. Categories such as Condensed and Safehold appear in
// prices.csv but not in the list, so they land in that alphabetical tail.
export function compareCategories(a: string, b: string): number {
  const ia = CATEGORY_ORDER.indexOf(a);
  const ib = CATEGORY_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}
