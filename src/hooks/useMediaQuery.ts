import { useEffect, useState } from 'react';

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
