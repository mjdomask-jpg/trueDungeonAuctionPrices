import { Link } from 'react-router-dom';
import { fmtDateWithDay } from '../lib/format';
import type { AuctionMeta } from '../lib/data';

// The at-a-glance "is anything live?" callout for the top of the Prices page.
// Renders nothing when nothing is open OR pending — a persistent "no auctions
// open" bar on the busiest page would just be nag. The reassuring empty state
// lives in the Auction Data section instead, where the whole feature has room.
//
// ONE box, not two. Open and pending are the same question asked a moment apart
// ("is there anything I should be watching?"), and stacking two callouts at the
// top of the busiest page costs a phone screen's worth of height in the one week
// of the season when both lists are non-empty. What separates them is the
// accent: the red "live" dot and border when something is actually open, a
// calmer amber and a hollow ring when everything is still ahead. A pending
// auction is not happening now and must not borrow the colour that says so.
//
// PENDING IS GROUPED BY DATE, one line per date, because the date is the whole
// point of the line — "3 auctions opening soon" is the answer to a question
// nobody asked. A season's auctions are announced together and mostly share one
// opening date, so the common shape is a single extra line; the grouping earns
// itself on the week when two auctioneers pick different days and a single
// summary line could only have named one of them (or, worse, neither).

// Above this many names in one group, listing them inline gets long, so the
// group collapses to its count and the date it opens. In practice 0-3 share a
// date, so names show. Applied per group: a busy opening day must not cost a
// quieter one its names.
const MAX_INLINE = 3;

// And above this many DATES the lines themselves get long. Never yet seen: two
// is the most any announced week has held.
const MAX_GROUPS = 3;

// The names, linked where the auction has a link.
function names(list: AuctionMeta[]) {
  return list.map((m: AuctionMeta, i: number) => (
    <span key={m.auctionId}>
      {i > 0 && ', '}
      {m.link
        ? <a href={m.link} target="_blank" rel="noopener noreferrer">{m.name} ↗</a>
        : m.name}
    </span>
  ));
}

// Pending auctions bucketed by their open date, in the order liveAuctions
// already sorted them (soonest first, undated last). An undated group keys on
// '' and is rendered without a date rather than with a wrong one.
function byDate(pending: AuctionMeta[]): { date: string; list: AuctionMeta[] }[] {
  const groups: { date: string; list: AuctionMeta[] }[] = [];
  for (const m of pending) {
    const last = groups[groups.length - 1];
    if (last && last.date === m.openDate) last.list.push(m);
    else groups.push({ date: m.openDate, list: [m] });
  }
  return groups;
}

export function OpenAuctionsBanner({ open, pending }: { open: AuctionMeta[]; pending: AuctionMeta[] }) {
  if (open.length === 0 && pending.length === 0) return null;
  const live = open.length > 0;
  const groups = byDate(pending);
  const shown = groups.slice(0, MAX_GROUPS);
  const hidden = pending.length - shown.reduce((n, g) => n + g.list.length, 0);

  // Rides the LAST line of the banner, whichever that is — trailing it after a
  // block-level pending line would orphan the separator onto a line of its own.
  // Links straight to the canonical grouped view (not the bare /explorer, whose
  // router-level redirect would drop the #open fragment) so Auction Data opens
  // with the list expanded — see ExplorerPage's wantOpen.
  const seeAll = <>{' · '}<Link to="/explorer/grouped#open">see all →</Link></>;
  const lastLine = shown.length === 0 ? -1 : shown.length - 1;

  return (
    <div className={`open-banner${live ? '' : ' pending-only'}`} role="status">
      <span className={live ? 'open-dot' : 'pending-dot'} aria-hidden="true" />
      <span className="open-banner-text">
        {live && <>
          <strong>{open.length} auction{open.length === 1 ? '' : 's'} open now</strong>
          {open.length <= MAX_INLINE && <>{' — '}{names(open)}</>}
        </>}
        {/* Each date on its own line: two counts run together in one sentence
            read as one number split in half. */}
        {shown.map((g, i) => {
          const n = g.list.length;
          const when = fmtDateWithDay(g.date);
          const noun = live ? `${n} more` : `${n} auction${n === 1 ? '' : 's'}`;
          return (
            <span className="open-banner-next" key={g.date || 'undated'}>
              <strong>
                {noun}{' '}
                {/* "open ON Sat, Sep 19", never "open Sat, Sep 19" — without
                    the preposition the line reads as a claim that they are
                    open on Saturdays. */}
                {when
                  ? <>open{n === 1 && !live ? 's' : ''} on <span className="pending-when">{when}</span></>
                  : <>await{n === 1 ? 's' : ''} a date</>}
              </strong>
              {n <= MAX_INLINE && <>{' — '}{names(g.list)}</>}
              {i === lastLine && hidden === 0 && seeAll}
            </span>
          );
        })}
        {hidden > 0 && <span className="open-banner-next">{hidden} more upcoming{seeAll}</span>}
        {pending.length === 0 && seeAll}
      </span>
    </div>
  );
}
