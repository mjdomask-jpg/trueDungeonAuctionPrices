import { useEffect, useState } from 'react';

const KEY = 'trade1-10x';

// Whether Trade 1 tokens are shown as their "10x" bundle (a ×10 price and a
// "10x " name prefix) rather than as single tokens. Defaults to ON: most auctions
// now list the bundle, so that's the number a bidder actually wants. Persisted in
// localStorage, which also keeps the choice consistent across the pages that read
// it (Prices, Timelines) — each mounts one at a time via the router, so reading
// the stored value on mount is enough to stay in sync; no shared context needed.
export function useTenX(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => localStorage.getItem(KEY) !== 'off');

  useEffect(() => {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  }, [on]);

  return [on, setOn];
}
