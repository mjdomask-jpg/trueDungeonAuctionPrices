import { fmtDateLong, money } from '../lib/format';
import { TENX_PREFIX } from '../lib/data';
import type { AuctionGroup } from '../lib/data';
import { isReleasedPayment, type ContextItem } from '../lib/context';
import { ProvenanceBadge, ReleasedBadge } from './ProvenanceBadge';

// One auction in the explorer: a header carrying the auction's metadata, and
// the individual sales that happened in it. Rendered as a native <details> so
// the disclosure is keyboard-accessible for free, but the open state is
// controlled by the page so "expand all" can drive every card at once.
// Shares its header layout with OpenAuctionCard; the auction link is the one
// difference — only open auctions carry it (a closed thread is archival).

export function AuctionCard({
  group, context = [], open, onToggle,
}: {
  group: AuctionGroup;
  // The auction's withheld / augmented / grunnel / released-payment context
  // items (already season- and provenance-filtered by the page). Absorbed here
  // so one card is the whole picture of an auction; empty for most auctions.
  context?: ContextItem[];
  open: boolean;
  onToggle: (auctionId: string, open: boolean) => void;
}) {
  const { meta, rows } = group;
  const date = fmtDateLong(meta.closeDate);

  // Metadata worth showing as chips. 'n/a' and blanks are dropped rather than
  // rendered as empty chips — 42 auctions carry no style or auctioneer at all.
  // Source (Forum/Trent) rides along so the card says where the auction ran,
  // matching what the former Augments & Withheld cards showed.
  const facts = [meta.style, meta.completionStyle, meta.auctioneer, meta.source]
    .filter((v) => v && v !== 'n/a');

  // A released Golden Ticket / Random Ultra Rare is inconsistently recorded as
  // BOTH a real sale and an "included" context row (see lib/context
  // isReleasedPayment). The sale row is canonical — it carries the realised
  // price and gets a "released" badge below — so drop the context duplicate to
  // keep the item from appearing twice in one card. Purely presentational: the
  // shared context feed (and the Analytics ledger built on it) is untouched.
  const saleNames = new Set<string>();
  for (const r of rows) { saleNames.add(r.displayName.toLowerCase()); saleNames.add(r.item.toLowerCase()); }
  const ctxItems = context.filter(
    (it) => !(it.provenance === 'released-payment' && saleNames.has(it.name.toLowerCase())),
  );

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
        {/* Shown only once the card is open — on a list of 271 collapsed cards
            it would be 271 outbound links competing with the disclosure. (Open
            auctions differ: there are only a handful, so their card shows the
            link collapsed too.) stopPropagation because a click inside a
            <summary> would otherwise toggle the card shut on the way out. */}
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
                          name genuinely differs — it's how the token lines up
                          across seasons on the Compare and Timelines pages. The
                          synthetic "10x " bundle prefix isn't a real difference,
                          so it's excluded or the name would just repeat. */}
                      {r.item !== r.displayName && r.displayName !== `${TENX_PREFIX}${r.item}`
                        && <span className="alt"> · {r.item}</span>}
                      {/* The released-payment mark rides the Token name, not the
                          Category cell — that column is too narrow for a second
                          chip, and this one wraps with the name instead. */}
                      {(isReleasedPayment(r.displayName) || isReleasedPayment(r.item)) && <ReleasedBadge />}
                    </td>
                    <td className="left">
                      {r.category && <span className="cat-chip" data-category={r.category}>{r.category}</span>}
                    </td>
                    <td>{money(r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Withheld / augmented / released context for this auction — the former
            standalone Augments & Withheld page, folded in so a single card is
            the whole auction. Withheld values are negative estimates (never
            sold); the est. badge explains. Only rendered when this auction has
            context left after the released-payment dedup above. */}
        {ctxItems.length > 0 && (
          <div className="ctx-section">
            <h4 className="ctx-subhead">Withheld &amp; augmented</h4>
            <div className="tablewrap">
              <table className={`ctx-items${ctxItems.length >= 4 ? ' banded' : ''}`}>
                <colgroup><col className="col-token" /><col /><col /></colgroup>
                <thead>
                  <tr>
                    <th className="left">Item</th>
                    <th className="left">Type</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {ctxItems.map((it, i) => (
                    <tr key={`${it.name}-${i}`}>
                      <td className="left token">
                        {it.name}{it.quantity > 1 ? ` ×${it.quantity}` : ''}
                      </td>
                      <td className="left">
                        <ProvenanceBadge provenance={it.provenance} n={it.estimate ? it.n : undefined} />
                      </td>
                      <td className={`ctx-val${it.value < 0 ? ' neg' : ''}`}>{money(it.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>}
    </details>
  );
}
