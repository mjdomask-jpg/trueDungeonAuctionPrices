import { Link } from 'react-router-dom';
import type { AuctionMeta } from '../lib/data';

// The at-a-glance "is anything live?" callout for the top of the Prices page.
// Renders nothing when nothing is open — a persistent "no auctions open" bar on
// the busiest page would just be nag. The reassuring empty state lives in the
// Auction Data section instead, where the whole feature has room.

// Above this many open, listing every name inline gets long, so the banner
// collapses to a count + "see all". In practice 0-3 run at once, so names show.
const MAX_INLINE = 3;

export function OpenAuctionsBanner({ open }: { open: AuctionMeta[] }) {
  if (open.length === 0) return null;
  const n = open.length;

  return (
    <div className="open-banner" role="status">
      <span className="open-dot" aria-hidden="true" />
      <span className="open-banner-text">
        <strong>{n} auction{n === 1 ? '' : 's'} open now</strong>
        {n <= MAX_INLINE && <>
          {' — '}
          {open.map((m, i) => (
            <span key={m.auctionId}>
              {i > 0 && ', '}
              {m.link
                ? <a href={m.link} target="_blank" rel="noopener noreferrer">{m.name} ↗</a>
                : m.name}
            </span>
          ))}
        </>}
        {' · '}
        <Link to="/explorer">see all open →</Link>
      </span>
    </div>
  );
}
