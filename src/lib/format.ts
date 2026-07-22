// Presentation helpers shared across pages. Pure, no React.

export const money = (n: number | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Whole-dollar currency, for the build-cost cards where cents are noise.
export const money0 = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

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
