// Top-level navigation entries. As pages land (timelines, compare, transmutes,
// auction stats, explorer — see docs/expansion-plan.md §6), add them here and
// the header nav renders them automatically. The nav bar stays hidden while
// there's only one destination.
export type NavItem = { path: string; label: string };

export const navItems: NavItem[] = [
  { path: '/', label: 'Prices' },
  { path: '/timelines', label: 'Timelines' },
  { path: '/compare', label: 'Compare Years' },
  { path: '/onyx', label: 'Onyx' },
];
