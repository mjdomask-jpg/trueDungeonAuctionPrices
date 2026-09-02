import { useEffect, useState } from 'react';

// The site's LAYOUT breakpoint, and the only one that reflows anything. Kept in
// step with the `max-width: 640px` block at the foot of App.css — anything that
// changes at one must change at the other.
export const NARROW = '(max-width: 640px)';

// A CAPABILITY line, not a second layout breakpoint: below it the Shopping
// List's pivot view is not offered at all, and nothing else on the site changes
// shape here. It sits well above NARROW because the pivot is a different kind
// of question — the frozen Item / To buy / On hand / Total / $ ea / Cost group
// costs ~660px before a single recipe column is drawn, so at 640px there is
// room for none of them and at 900px for two. 1024px is where three fit and the
// table starts saying something a phone-shaped list does not.
//
// The toggle is HIDDEN below it rather than disabled, and the saved preference
// is left alone: a reader who chose pivot on a laptop and opened the page on a
// tablet gets the standard tables and gets their choice back on the laptop.
export const WIDE = '(min-width: 1024px)';

// Lets a component render a different tree per breakpoint, rather than hiding
// things in CSS. Needed where CSS can't do the job: hiding table columns fights
// `table-layout: fixed` and the colspan'd group headers, which map by rendered
// column index.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // the query may have changed between render and effect
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
