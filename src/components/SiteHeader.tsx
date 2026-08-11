import { Link, useLocation } from 'react-router-dom';
import type { Theme } from '../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';
import { navItems, navMatch } from '../nav';

// Global site header: title, theme toggle, and (once there's more than one
// destination) the top-level nav. The five-tab strip renders at every width:
// below 640px it compacts (smaller font/padding via App.css) and "Auction Data"
// swaps to its short "Data" label so all five hold one line down to 375px,
// wrapping to two rows only around 320px. Page-specific intro text lives on
// each page.
export function SiteHeader({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const { pathname } = useLocation();
  return (
    <header>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <h1>True Dungeon Auction Prices</h1>
      {navItems.length > 1 && (
        <nav className="site-nav">
          {navItems.map((item) => {
            // navMatch, not NavLink's own end/prefix logic: a tab stays active
            // across its view sub-routes, and Prices owns both / and /prices/*.
            const active = navMatch(item.path, pathname);
            return (
              <Link key={item.path} to={item.path}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}>
                {item.short ? (
                  <>
                    <span className="nav-full">{item.label}</span>
                    <span className="nav-short">{item.short}</span>
                  </>
                ) : item.label}
              </Link>
            );
          })}
        </nav>
      )}
    </header>
  );
}
