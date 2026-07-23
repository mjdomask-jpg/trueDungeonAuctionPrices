import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';

// Keep the bubble visible. It is centred on its trigger, which overflows once
// the trigger sits near an edge, so measure once on open and slide it back.
const EDGE = 8;

// The bubble is clipped by any scrolling/hidden ancestor, not just the viewport
// — `.tx-season` sets `overflow: hidden`, so a badge near a season card's right
// edge gets cut off well before the window runs out. Clamp to the narrowest
// bound that actually applies.
function visibleBounds(el: HTMLElement): { lo: number; hi: number } {
  let lo = 0;
  let hi = document.documentElement.clientWidth;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
    const r = p.getBoundingClientRect();
    lo = Math.max(lo, r.left);
    hi = Math.min(hi, r.right);
  }
  return { lo, hi };
}

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
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Measured before paint, from the un-shifted position, so the bubble never
  // appears off-screen and then jumps.
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const el = pop.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const { lo, hi } = visibleBounds(el);
    // Left wins if the bubble is wider than the space, so it never slides out
    // the opposite side chasing the other edge.
    if (r.left < lo + EDGE) setShift(lo + EDGE - r.left);
    else if (r.right > hi - EDGE) setShift(hi - EDGE - r.right);
  }, [open]);

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
        <span
          className="hint-pop"
          id={id}
          role="note"
          ref={pop}
          style={{ '--hint-shift': `${shift}px` } as CSSProperties}
          onClick={(e) => e.stopPropagation()}
        >
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
