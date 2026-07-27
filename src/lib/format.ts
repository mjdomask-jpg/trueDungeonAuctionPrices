// Presentation helpers shared across pages. Pure, no React.

export const money = (n: number | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Whole-dollar currency, for the build-cost cards where cents are noise.
export const money0 = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Currency that drops the cents once a value reaches $1,000, where they're just
// noise and cost horizontal room — used in the condensed mobile Compare view.
// Below $1,000 it keeps cents so cheap tokens stay precise.
export const moneyTight = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1000 ? money0(n) : money(n);

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Format an ISO close date ("YYYY-MM-DD") as "Mon DD" (three-letter month,
// two-digit zero-padded day). Returns null when missing/unparseable.
export const fmtCloseDate = (iso: string | undefined): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  const month = m && MONTHS[parseInt(m[2], 10) - 1];
  return m && month ? `${month} ${m[3]}` : null;
};

// Like fmtCloseDate but with the year: "Jul 17 2026". Used in the footer, where
// the "Mon DD YYYY" shape reads distinctly from the ISO price-update date.
export const fmtCloseDateFull = (iso: string | undefined): string | null => {
  const base = fmtCloseDate(iso);
  const m = /^(\d{4})-/.exec(iso ?? '');
  return base && m ? `${base} ${m[1]}` : base;
};

// Render an absolute instant (an ISO-8601 string with offset, e.g. git's %cI)
// in US Central time — DST-correct via the IANA zone, so it shows CDT in summer
// and CST in winter regardless of where the commit was made. Output pairs an
// ISO date with a 24-hour time and the zone abbreviation: "2026-07-23 23:42 CDT".
// Returns '' for a missing/unparseable input.
export const fmtCentral = (iso: string | undefined): string => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  const zone = 'America/Chicago';
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }).format(d);
  return `${date} ${time}`;
};
