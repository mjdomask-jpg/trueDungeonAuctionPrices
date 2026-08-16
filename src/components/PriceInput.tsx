import { useEffect, useState } from 'react';

// The calculator's money entry box. Extracted from BuildCalculator when the
// Omni suggestion gained a price of its own (Phase 6), so both read and write
// prices the same way — two boxes parsing "$1,500.00" differently is the kind
// of drift that only shows up in a bug report.

// Money always shows both cents digits ($10.60, not $10.6); parsing rounds to
// cents so a stored override never carries a longer tail than it displays.
const fmt2 = (n: number | null | undefined) => (n == null ? '' : n.toFixed(2));

// `$` and thousands separators are stripped rather than rejected: prices get
// pasted in from listings and reseller pages as "$1,500.00", and Number() reads
// that as NaN. The box re-displays the bare number.
const parsePrice = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return isFinite(n) ? Math.round(n * 100) / 100 : null;
};

// A price entry box that displays two decimals ($4.80) but lets you type freely
// while focused (4.8) — a plain number input drops trailing zeros, so this holds
// its own text and reformats from the value on blur.
export function PriceInput({ value, onChange, ariaLabel }: {
  value: number | null;
  onChange: (n: number | null) => void;
  ariaLabel: string;
}) {
  const [text, setText] = useState(() => fmt2(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt2(value)); }, [value, focused]);
  return (
    <input
      type="text" inputMode="decimal" aria-label={ariaLabel} value={text}
      onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => { setText(e.target.value); onChange(parsePrice(e.target.value)); }}
    />
  );
}
