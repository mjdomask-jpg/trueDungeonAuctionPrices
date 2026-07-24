import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { navItems } from '../nav';

// Below 640px the seven-tab strip wraps to three rows and eats a quarter of the
// viewport before any data shows. On phones we swap it for a single-row menu: a
// button labelled with the current page that opens the full list. SiteHeader
// picks this or the desktop tab strip per breakpoint.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  // The current page's label for the closed button. Mirror the tab strip's
  // matching: exact for '/', longest-prefix for the rest (no path is a prefix
  // of another, so a plain startsWith is unambiguous).
  const current = navItems.find((i) =>
    i.path === '/' ? location.pathname === '/' : location.pathname.startsWith(i.path),
  );
  const label = current?.label ?? 'Menu';

  // Any navigation closes the menu (covers taps on the already-current item too).
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // While open, an outside tap or Escape dismisses it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="mobile-nav" ref={ref}>
      <button
        type="button"
        className="mobile-nav-toggle"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{label}</span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="mobile-nav-menu" role="menu">
          {navItems.map((item) => (
            <li key={item.path} role="none">
              <NavLink role="menuitem" to={item.path} end={item.path === '/'}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
