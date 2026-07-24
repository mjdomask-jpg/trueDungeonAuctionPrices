import { fmtCloseDate, money } from '../lib/format';
import type { AuctionGroup } from '../lib/data';

// One auction in the explorer: a header carrying the auction's metadata, and
// the individual sales that happened in it. Rendered as a native <details> so
// the disclosure is keyboard-accessible for free, but the open state is
// controlled by the page so "expand all" can drive every card at once.

// The close date rendered long-form. The dashboard's fmtCloseDate gives "Oct
// 16"; here the auctions span eight seasons in one list, so the year matters.
function longDate(iso: string): string | null {
  const short = fmtCloseDate(iso);
  const year = /^(\d{4})-/.exec(iso)?.[1];
  return short && year ? `${short}, ${year}` : short;
}

export function AuctionCard({
  group, open, onToggle,
}: {
  group: AuctionGroup;
  open: boolean;
  onToggle: (auctionId: string, open: boolean) => void;
}) {
  const { meta, rows } = group;
  const date = longDate(meta.closeDate);

  // Metadata worth showing as chips. 'n/a' and blanks are dropped rather than
  // rendered as empty chips — 42 auctions carry no style or auctioneer at all.
  const facts = [meta.style, meta.completionStyle, meta.auctioneer]
    .filter((v) => v && v !== 'n/a');

  return (
    <details
      className="auction"
      open={open}
      onToggle={(e) => onToggle(meta.auctionId, (e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="auction-head">
        <span className="auction-title">
          <span className="auction-num">{meta.season} · #{meta.auctionNumber}</span>
          <span className="auction-name">{meta.name}</span>
        </span>
        {/* Only Closed auctions are listed, so the date is always a close
            date — labelling it says which date it is without a status chip. */}
        <span className="auction-when">Closed: {date ?? 'unknown'}</span>
        {/* Shares the date's line rather than sitting alone above the table,
            and only once the card is open — on a list of 271 collapsed cards
            it would be 271 outbound links competing with the disclosure.
            stopPropagation because a click inside a <summary> would otherwise
            toggle the card shut on the way out. */}
        {open && meta.link && (
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

      {/* Body is mounted only while open. With every auction listed that's the
          difference between ~7,300 rows in the DOM and only the ones you asked
          to see. */}
      {open && <div className="auction-body">
        {/* The link moved up to the summary, so this row can be nothing but
            chips — and 42 auctions carry no style or auctioneer at all, which
            would leave an empty paragraph holding its margin open. */}
        {facts.length > 0 && (
          <p className="auction-facts">
            {facts.map((f) => <span key={f} className="cat">{f}</span>)}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="auction-none">No recorded sales for this auction.</p>
        ) : (
          <div className="tablewrap">
            <table className={rows.length >= 4 ? 'banded' : undefined}>
              <colgroup><col className="col-token" /><col /><col /></colgroup>
              <thead>
                <tr>
                  <th className="left">Token</th>
                  <th className="left">Category</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item}>
                    <td className="left token">
                      {r.displayName}
                      {/* The canonical Item, shown only when the yearly display
                          name differs — it's how the token lines up across
                          seasons on the Compare and Timelines pages. */}
                      {r.item !== r.displayName && <span className="alt"> · {r.item}</span>}
                    </td>
                    <td className="left">{r.category}</td>
                    <td>{money(r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>}
    </details>
  );
}
