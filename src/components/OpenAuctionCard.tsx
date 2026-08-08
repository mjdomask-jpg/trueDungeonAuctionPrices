import { fmtCloseDateFull, money0 } from '../lib/format';
import { daysSince, type AuctionMeta } from '../lib/data';

// One currently-open auction, as a <details> card. Reuses the .auction card
// styling from the Auction Data explorer: collapsed it shows only the number,
// name and a link straight to the auction (the primary need — get me there);
// the secondary detail (auctioneer, funding goal, style…) lives behind the
// disclosure. Unlike the explorer's AuctionCard the body is cheap (six fact
// rows, no sales table), so it's a plain uncontrolled <details> — no page-level
// open state, defaults collapsed.

// "opened today" / "1 day ago" / "N days ago".
function agoLabel(n: number): string {
  return n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
}

export function OpenAuctionCard({ meta }: { meta: AuctionMeta }) {
  const openedDate = fmtCloseDateFull(meta.openDate);
  const days = daysSince(meta.openDate);
  const opened = openedDate && (days == null ? openedDate : `${openedDate} · ${agoLabel(days)}`);

  // Key/value facts, all plain text for consistency (no chips). Each is dropped
  // when its source value is missing/'n/a' so the list never shows an empty row.
  const facts: [string, string][] = [];
  if (meta.auctioneer && meta.auctioneer !== 'n/a') facts.push(['Auctioneer', meta.auctioneer]);
  if (opened) facts.push(['Opened', opened]);
  if (meta.targetFunding != null) facts.push(['Funding goal', money0(meta.targetFunding)]);
  if (meta.augmented != null) facts.push(['Augmented', meta.augmented ? 'Yes' : 'No']);
  if (meta.style && meta.style !== 'n/a') facts.push(['Style', meta.style]);
  if (meta.completionStyle && meta.completionStyle !== 'n/a') facts.push(['Completion', meta.completionStyle]);

  return (
    <details className="auction open-auction">
      <summary className="auction-head">
        <span className="auction-title">
          <span className="auction-num">{meta.season} · #{meta.auctionNumber}</span>
          <span className="auction-name">{meta.name}</span>
        </span>
        {/* Shown on the collapsed card too — with only a handful open at a time
            this isn't the 271-link problem the explorer has, and one tap to the
            auction is the whole point. stopPropagation so following the link
            doesn't also toggle the card. */}
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

      {facts.length > 0 && (
        <div className="auction-body">
          <dl className="open-facts">
            {facts.map(([k, v]) => (
              <div key={k} className="open-fact">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </details>
  );
}
