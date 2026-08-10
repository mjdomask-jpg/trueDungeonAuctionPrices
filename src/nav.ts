// Top-level navigation entries. As pages land (timelines, compare, transmutes,
// auction stats, explorer — see docs/expansion-plan.md §6), add them here and
// the header nav renders them automatically. The nav bar stays hidden while
// there's only one destination.
export type NavItem = { path: string; label: string };

export const navItems: NavItem[] = [
  { path: '/', label: 'Prices' },
  { path: '/trends', label: 'Trends' },
  { path: '/transmutes', label: 'Transmutes' },
  { path: '/explorer', label: 'Auction Data' },
  { path: '/analytics', label: 'Analytics' },
];

// Whether a nav item is the active one for the current path. Views live in a
// sub-segment now (/trends/season, /explorer/full …), so a tab is active for its
// whole subtree, not just its bare path. Prices is the exception: its All view
// is the home page at `/`, and its other views live under /prices/*, so the
// Prices tab owns both.
export function navMatch(path: string, pathname: string): boolean {
  if (path === '/') return pathname === '/' || pathname.startsWith('/prices');
  return pathname === path || pathname.startsWith(path + '/');
}
