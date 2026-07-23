import type { ReactNode } from 'react';
import { fmtCloseDate } from '../lib/format';

// A collapsible season-month group, shared by the two Current Year tables.
//
// The heading has to work hard here, because "Open Month" in the data is a
// SEASON month (month 1 ≈ September of the previous calendar year) and the
// calendar month it lands on shifts year to year. Showing "Month 3" alone
// would be meaningless to a reader, so every heading carries the actual span
// of open dates inside it — the ordinal for comparing seasons, the real dates
// for reading one.

const yearOf = (iso: string) => (/^(\d{4})-/.exec(iso ?? '')?.[1]) ?? '';

// "Sep 25 – Oct 20, 2025", collapsing to one date when the group is a single
// day and carrying both years when the group straddles New Year.
function fmtSpan(first: string, last: string): string {
  const a = fmtCloseDate(first), b = fmtCloseDate(last);
  const ya = yearOf(first), yb = yearOf(last);
  if (!a) return '';
  if (!b || (a === b && ya === yb)) return ya ? `${a}, ${ya}` : a;
  return ya === yb ? `${a} – ${b}, ${yb}` : `${a}, ${ya} – ${b}, ${yb}`;
}

export function MonthAccordion({
  month, firstOpen, lastOpen, count, countLabel, open, onToggle, children,
}: {
  month: number;
  firstOpen: string;
  lastOpen: string;
  count: number;
  countLabel: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const span = fmtSpan(firstOpen, lastOpen);
  return (
    <section className="an-month">
      <button type="button" className="an-mhead" aria-expanded={open} onClick={onToggle}>
        <i className={`tx-chev ${open ? 'open' : ''}`} aria-hidden="true">▸</i>
        <span className="an-mnum">Month {month}</span>
        {span && <span className="an-mspan">{span}</span>}
        <span className="an-mcount">{count} {countLabel}{count === 1 ? '' : 's'}</span>
      </button>
      {open && <div className="an-mbody">{children}</div>}
    </section>
  );
}
