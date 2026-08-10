import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

// Makes a page's view the same thing as its URL, so every view is a shareable
// link and Back/Forward move between them. The page reads its view from the
// `:view` route param instead of local state; a toggle button calls the
// returned setter, which navigates.
//
// `views` are the valid slugs (the internal view values ARE the URL slugs — see
// each page's View type). `pathFor` maps a view to its canonical path. Anything
// that isn't a known slug — a typo, a legacy alias, or the paramless index
// route (Prices' All lives at `/`) — resolves to `fallback` and the URL is
// rewritten to its canonical path (replace, so a bad link doesn't wedge Back).
// When the URL is already canonical no navigation happens, so `/` stays `/`.
export function useRoutedView<V extends string>(opts: {
  views: readonly V[];
  fallback: V;
  pathFor: (view: V) => string;
}): [V, (view: V) => void] {
  const { views, fallback, pathFor } = opts;
  const { view: raw } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const view = views.includes(raw as V) ? (raw as V) : fallback;
  const canonical = pathFor(view);

  useEffect(() => {
    if (pathname !== canonical) navigate(canonical, { replace: true });
  }, [pathname, canonical, navigate]);

  return [view, (next: V) => navigate(pathFor(next))];
}
