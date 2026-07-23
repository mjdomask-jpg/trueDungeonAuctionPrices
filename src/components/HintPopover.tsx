import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

// The site-wide mechanism for explanatory help text. See docs/ui-conventions.md:
// help is NEVER a `title` attribute, because those only appear on hover and are
// invisible on touch. Opens on click/tap and stays up until dismissed — via the
// ×, Escape, or a pointerdown anywhere outside, so the whole screen is the close
// target rather than the small ×.
//
// `trigger` defaults to the standard "?" circle; pass a node to attach help to an
// existing affordance instead. Safe to drop inside a <label>: every click within
// is stopped from reaching it, which would otherwise toggle the label's control.
export function HintPopover({
  label = 'Help',
  trigger,
  children,
}: {
  label?: string;
  trigger?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    // pointerdown, not click, so the first touch dismisses it.
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
    <span className="hint-wrap" ref={wrap}>
      <button
        type="button"
        className={trigger ? 'hint-trigger' : 'hint-q'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger ?? '?'}
      </button>
      {open && (
        <span className="hint-pop" id={id} role="note" onClick={(e) => e.stopPropagation()}>
          <span className="hint-text">{children}</span>
          <button
            type="button"
            className="hint-x"
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
