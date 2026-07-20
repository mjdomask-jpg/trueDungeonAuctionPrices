import { NavLink } from 'react-router-dom';
import type { Theme } from '../hooks/useTheme';
import { ThemeToggle } from './ThemeToggle';
import { navItems } from '../nav';

// Global site header: title, theme toggle, and (once there's more than one
// destination) the top-level nav. Page-specific intro text lives on each page.
export function SiteHeader({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <header>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <h1>True Dungeon Auction Prices</h1>
      {navItems.length > 1 && (
        <nav className="site-nav">
          {navItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
