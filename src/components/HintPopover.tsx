import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// A "?" affordance whose help text opens on click/tap and stays up until it is
// dismissed — via the ×, Escape, or a click anywhere outside. Deliberately not a
// `title` tooltip: those only appear on hover, so touch devices never see them.
//
// Safe to drop inside a <label>: every click within the popover is stopped from
// reaching the label, which would otherwise toggle the label's control.
export function HintPopover({ label = 'Help', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // pointerdown (not click) so a tap anywhere dismisses it — the whole screen
    // is the close target, not just the small ×.
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="tx-hint-wrap" ref={wrap}>
      <button
        type="button"
        className="tx-hint"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <span className="tx-pop" id={id} role="note" onClick={(e) => e.stopPropagation()}>
          <span className="tx-pop-text">{children}</span>
          <button
            type="button"
            className="tx-pop-x"
            aria-label="Close"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
          >
            ×
          </button>
        </span>
      )}
    </span>
  );
}
