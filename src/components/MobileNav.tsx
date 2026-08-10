import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { navItems, navMatch } from '../nav';

// Below 640px the seven-tab strip wraps to three rows and eats a quarter of the
// viewport before any data shows. On phones we swap it for a single-row menu: a
// button labelled with the current page that opens the full list. SiteHeader
// picks this or the desktop tab strip per breakpoint.
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  // The current page's label for the closed button. Same matching as the tab
  // strip (navMatch): a tab owns its whole view subtree, and Prices owns / and
  // /prices/*.
  const current = navItems.find((i) => navMatch(i.path, location.pathname));
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
          {navItems.map((item) => {
            const active = navMatch(item.path, location.pathname);
            return (
              <li key={item.path} role="none">
                <Link role="menuitem" to={item.path}
                  className={active ? 'active' : undefined}
                  aria-current={active ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
