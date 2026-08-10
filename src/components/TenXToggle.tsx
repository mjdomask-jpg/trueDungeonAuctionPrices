import { HintPopover } from './HintPopover';

// The Prices/Timelines control that switches Trade 1 tokens between single-token
// and "10x" bundle pricing (see useTenX / asTenXRows). Sits in the .controls row
// as a checkbox rather than a stacked select, so it opts out of the column
// label/input styling via its own class. `className` lets a caller add a layout
// modifier (Prices forces it onto its own line — see .tenx-own-line).
export function TenXToggle({ on, onChange, className }: {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`tenx-check${className ? ` ${className}` : ''}`}>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
      Show Trade 1 as 10x
      <HintPopover label="About the 10x view">
        Trade 1 goods are often auctioned as a 10x token, which
        saves space when mailing. This shows estimated prices for the 10x token — ten
        times the single-token price. Turn it off for
        single-token prices.
      </HintPopover>
    </label>
  );
}
