import { fmtDateLong, money0 } from '../lib/format';
import { daysSince, daysUntil, type AuctionMeta, type AuctionPhase } from '../lib/data';

// One auction that has not closed, styled to match the explorer's AuctionCard so
// the two read as one family: collapsed shows season · number · name with the
// date right-aligned and a link straight to the auction (open and pending
// auctions get the link; closed ones don't); expanded shows the auction's facts
// as chips. The body is cheap (a chip row, no sales table), so it's a plain
// uncontrolled <details> — no page-level open state, defaults collapsed.
//
// Two phases, one card. A pending auction shows the same facts — they are known
// in advance, which is the point of announcing it — and differs in exactly two
// places: a PENDING badge beside the name, and a date that reads forwards
// ("Opens: …, in 8 days") rather than backwards. Giving pending its own
// component would have duplicated the chip logic to change a preposition.

// "opened today" / "1 day ago" / "N days ago".
function agoLabel(n: number): string {
  return n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
}

// "in 8 days" / "tomorrow" / "today". Clamped at 0: a pending auction whose
// date has passed is shown as open (see auctionPhase), so a negative can only
// reach here from a pending row with no date at all, which renders no span.
function untilLabel(n: number): string {
  return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

export function OpenAuctionCard({ meta, phase = 'open' }: { meta: AuctionMeta; phase?: AuctionPhase }) {
  const pending = phase === 'pending';
  const date = fmtDateLong(meta.openDate);
  const away = pending ? daysUntil(meta.openDate) : daysSince(meta.openDate);
  const when = date && (away == null ? date : `${date} · ${pending ? untilLabel(away) : agoLabel(away)}`);

  // Fact chips, same style as AuctionCard's. Style / completion / auctioneer
  // match the closed cards; funding goal and augmented are the open-only extras.
  // 'n/a'/blank values are dropped, and Augmented shows only when the auction
  // actually is augmented (never a "No" chip).
  const chips: string[] = [];
  if (meta.style && meta.style !== 'n/a') chips.push(meta.style);
  if (meta.completionStyle && meta.completionStyle !== 'n/a') chips.push(meta.completionStyle);
  if (meta.auctioneer && meta.auctioneer !== 'n/a') chips.push(meta.auctioneer);
  if (meta.targetFunding != null) chips.push(`Goal: ${money0(meta.targetFunding)}`);
  if (meta.augmented) chips.push('Augmented');

  return (
    <details className={`auction open-auction${pending ? ' pending-auction' : ''}`}>
      <summary className="auction-head">
        <span className="auction-title">
          {/* Said in words, not in colour alone: the card's amber border means
              nothing to a reader who can't see it, and "Opens:" below is a
              single preposition's difference from "Opened:".

              LEADS the title rather than trailing it, because .auction-title is
              a two-line clamp box: on a phone these names fill both lines and a
              trailing badge is clipped away with the rest of the overflow —
              which is exactly where the label is most needed and least
              replaceable by a colour. Clamping cuts the end, so the front is
              the one position that always survives. */}
          {pending && <span className="pending-badge">Pending</span>}
          <span className="auction-num">{meta.season} · #{meta.auctionNumber}</span>
          <span className="auction-name">{meta.name}</span>
        </span>
        {/* A pending auction with no date at all says so rather than going
            silent — "announced, date not set" is the fact, and an empty slot
            where every other card has a date reads as missing data. */}
        {when
          ? <span className="auction-when">{pending ? 'Opens' : 'Opened'}: {when}</span>
          : pending && <span className="auction-when">Opens: date not yet announced</span>}
        {/* Shown on the collapsed card too — only a handful are ever open at
            once, and one tap to the auction is the whole point. stopPropagation
            so following the link doesn't also toggle the card. */}
        {meta.link && (
          <a
            className="auction-link"
            href={meta.link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            Auction link ↗
          </a>
        )}
      </summary>

      {chips.length > 0 && (
        <div className="auction-body">
          <p className="auction-facts">
            {chips.map((c) => <span key={c} className="cat">{c}</span>)}
          </p>
        </div>
      )}
    </details>
  );
}
