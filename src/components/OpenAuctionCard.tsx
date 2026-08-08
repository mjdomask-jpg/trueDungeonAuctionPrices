import { fmtDateLong, money0 } from '../lib/format';
import { daysSince, type AuctionMeta } from '../lib/data';

// One currently-open auction, styled to match the explorer's AuctionCard so the
// two read as one family: collapsed shows season · number · name with the open
// date right-aligned and a link straight to the auction (open auctions get the
// link; closed ones don't); expanded shows the auction's facts as chips. The
// body is cheap (a chip row, no sales table), so it's a plain uncontrolled
// <details> — no page-level open state, defaults collapsed.

// "opened today" / "1 day ago" / "N days ago".
function agoLabel(n: number): string {
  return n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
}

export function OpenAuctionCard({ meta }: { meta: AuctionMeta }) {
  const date = fmtDateLong(meta.openDate);
  const days = daysSince(meta.openDate);
  const opened = date && (days == null ? date : `${date} · ${agoLabel(days)}`);

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
    <details className="auction open-auction">
      <summary className="auction-head">
        <span className="auction-title">
          <span className="auction-num">{meta.season} · #{meta.auctionNumber}</span>
          <span className="auction-name">{meta.name}</span>
        </span>
        {opened && <span className="auction-when">Opened: {opened}</span>}
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
