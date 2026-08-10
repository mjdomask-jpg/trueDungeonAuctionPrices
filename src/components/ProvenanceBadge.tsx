import { HintPopover } from './HintPopover';
import { PROVENANCE_NAME } from '../data/filtersContext';
import type { Provenance } from '../lib/context';

// The short text that rides on a data-row badge (the full names live in
// PROVENANCE_NAME, shared with the FilterBar).
const BADGE_TEXT: Record<Provenance, string> = {
  'released-payment': 'included',
  augment: 'augment',
  grunnel: 'grunnel',
  withheld: 'est.',
};

const HELP: Record<Provenance, string> = {
  'released-payment': 'Formerly kept by the auctioneer as payment (a Golden Ticket or a Random Ultra Rare); now sold to bidders.',
  augment: "Added by the auctioneer from their personal collection to supplement the auction.",
  grunnel: 'Dropped into the auction by a company employee to offset expired preorder bonuses.',
  withheld: 'Withheld from the auction and never sold. Value is an ESTIMATE from this item’s sales in the most recent same-season auctions that closed before this one.',
};

// A small provenance tag with tap-to-open help, following the transmute-badge
// pattern (ui-conventions.md). Withheld reuses the neutral `est.` styling; the
// three real-sale provenances get their own themed colours. Pass `n` on a
// withheld badge to show the estimate's sample size.
export function ProvenanceBadge({ provenance, n }: { provenance: Provenance; n?: number }) {
  const body = provenance === 'withheld' && n != null
    ? `${HELP.withheld} (n = ${n})`
    : HELP[provenance];
  return (
    <HintPopover
      label={PROVENANCE_NAME[provenance]}
      trigger={<span className={`prov-badge ${provenance}`}>{BADGE_TEXT[provenance]}</span>}
    >
      {body}
    </HintPopover>
  );
}

// Rides on a real sale row (Golden Ticket / Random Ultra Rare) in the Auction
// Data cards to mark it as a released auctioneer payment. Reuses the
// released-payment tint and help text; reads "released" rather than the ledger's
// "included" because on a sale row the item plainly did sell.
export function ReleasedBadge() {
  return (
    <HintPopover
      label={PROVENANCE_NAME['released-payment']}
      trigger={<span className="prov-badge released-payment">released</span>}
    >
      {HELP['released-payment']}
    </HintPopover>
  );
}
