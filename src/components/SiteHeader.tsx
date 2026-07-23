import { NavLink } from 'react-router-dom';
import type { Theme } from '../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';
import { MobileNav } from './MobileNav';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { navItems } from '../nav';

// Global site header: title, theme toggle, and (once there's more than one
// destination) the top-level nav. The desktop tab strip wraps to three rows on
// a phone, so below 640px it's swapped for a single-row dropdown (MobileNav).
// Page-specific intro text lives on each page.
export function SiteHeader({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const narrow = useMediaQuery(NARROW);
  return (
    <header>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <h1>True Dungeon Auction Prices</h1>
      {navItems.length > 1 && (narrow ? (
        <MobileNav />
      ) : (
        <nav className="site-nav">
          {navItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      ))}
    </header>
  );
}
