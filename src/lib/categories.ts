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

// Section grouping. A couple of categories are real in the data but not worth a
// table of their own on a page that groups by category: Wish Ring carries
// `Trade 4` (the canonical game rung), yet it is bought as an 8K-order exclusive
// and prices like a Premium, so a lone one-row "Trade 4" table reads as an
// oddity rather than a distinction. The Prices page and the Trends
// year-over-year view group and filter on this; everywhere the raw category is
// the fact being shown — the explorer's chips, filters and sorting — keeps
// `category` itself.
//
// This fold is the SETTLED exception to `Category` being the tier axis, decided
// 2026-09-02 (docs/data-backlog.md items 3 and 4, both resolved there). It is
// sound only while Wish Ring is Trade 4's sole occupant, because the map keys on
// the CATEGORY, not on the token: a second Trade 4 token — backlog item 8 would
// author the `25,000 GP Eldritch Ore Bar` as one — would silently inherit the fold
// and sit in Premium too. Re-key on the item name at that point.
const CATEGORY_SECTION: Record<string, string> = {
  'Trade 4': 'Premium',
};

export function sectionCategory(category: string): string {
  return CATEGORY_SECTION[category] ?? category;
}
