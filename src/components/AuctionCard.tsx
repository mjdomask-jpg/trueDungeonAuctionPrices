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
  const { meta, sales, total, min, max } = group;
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
        <span className="auction-when">
          {date ?? 'close date unknown'}
          {meta.status !== 'Closed' && <span className="auction-status"> {meta.status}</span>}
        </span>
      </summary>

      {/* Body is mounted only while open. With every auction listed that's the
          difference between ~7,300 rows in the DOM and only the ones you asked
          to see. */}
      {open && <div className="auction-body">
        <p className="auction-facts">
          {facts.map((f) => <span key={f} className="cat">{f}</span>)}
          <span className="auction-totals">
            {sales.length} sale{sales.length === 1 ? '' : 's'}
            {sales.length > 0 && <> · {money(total)} total · {money(min)}–{money(max)}</>}
          </span>
          {meta.link && (
            <a className="auction-link" href={meta.link} target="_blank" rel="noopener noreferrer">
              Forum thread ↗
            </a>
          )}
        </p>

        {sales.length === 0 ? (
          <p className="auction-none">No recorded sales for this auction.</p>
        ) : (
          <div className="tablewrap">
            <table className={sales.length >= 4 ? 'banded' : undefined}>
              <colgroup><col className="col-token" /><col /><col /></colgroup>
              <thead>
                <tr>
                  <th className="left">Token</th>
                  <th className="left">Category</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s, i) => (
                  <tr key={`${s.item}-${i}`}>
                    <td className="left token">
                      {s.displayName}
                      {/* The canonical Item, shown only when the yearly display
                          name differs — it's how the token lines up across
                          seasons on the Compare and Timelines pages. */}
                      {s.item !== s.displayName && <span className="alt"> · {s.item}</span>}
                    </td>
                    <td className="left">{s.category}</td>
                    <td>{money(s.price)}</td>
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
