import {
  useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Breathing room between the bubble and the viewport edge, and between the
// bubble and its trigger.
const EDGE = 8;
const GAP = 8;

// Where the bubble sits, in viewport coordinates (it is `position: fixed`).
type Placement = { top: number; left: number; above: boolean };

// The site-wide mechanism for explanatory help text. See docs/ui-conventions.md:
// help is NEVER a `title` attribute, because those only appear on hover and are
// invisible on touch. Opens on click/tap and stays up until dismissed — via the
// ×, Escape, or a pointerdown anywhere outside, so the whole screen is the close
// target rather than the small ×.
//
// `trigger` defaults to the standard "?" circle; pass a node to attach help to an
// existing affordance instead. Safe to drop inside a <label>: every click within
// is stopped from reaching it, which would otherwise toggle the label's control.
//
// THE BUBBLE IS PORTALLED TO document.body, and that is the whole point of this
// component's complexity. Rendered in place it was both clipped and mis-stacked,
// by two separate rules that no amount of z-index could reconcile:
//
//  - `.tablewrap` sets `overflow-x: auto`, which forces `overflow-y` to compute
//    to `auto` as well. A bubble opened near the bottom of a table was clipped
//    and gave the wrapper a vertical scrollbar to reach it. Removing the
//    overflow is not an option — it is the horizontal scroll wide tables need.
//  - `td.token` is `position: sticky; z-index: 1` (the pinned row-label column),
//    so EVERY Token cell is its own stacking context. A bubble inside one could
//    only compete with that cell's siblings, and lost to the next row's Token
//    cell — later in paint order at the same level. Its own `z-index: 20` was
//    scoped inside the cell and could never escape it.
//
// On document.body the bubble has no clipping ancestor and no inherited stacking
// context, so both go away, along with every future instance of them. The cost
// is that placement is now computed rather than declared: the measure/clamp/flip
// below is what `position: absolute; left: 50%` used to do for free.
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
  const [place, setPlace] = useState<Placement | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Centre the bubble on its trigger, then clamp it into the viewport. Left wins
  // if the bubble is wider than the space, so it never slides out the opposite
  // side chasing the other edge. Flips above the trigger when there isn't room
  // below — `position: fixed` cannot grow the page to make room the way the old
  // absolute bubble did, so without the flip a trigger near the bottom of the
  // screen would open a bubble that runs off it.
  const position = useCallback(() => {
    const el = pop.current;
    const anchor = wrap.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    let left = a.left + a.width / 2 - b.width / 2;
    if (left + b.width > vw - EDGE) left = vw - EDGE - b.width;
    if (left < EDGE) left = EDGE;

    const below = a.bottom + GAP;
    const above = below + b.height > vh - EDGE && a.top - GAP - b.height >= EDGE;
    setPlace({ top: above ? a.top - GAP - b.height : below, left, above });
  }, []);

  // Measured before paint, from the un-positioned bubble, so it never appears in
  // the wrong place and then jumps.
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    position();
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    // pointerdown, not click, so the first touch dismisses it. The bubble is no
    // longer a descendant of `wrap`, so both nodes have to be consulted or a tap
    // inside the bubble would close it.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // A fixed bubble does not travel with its trigger, so follow it. Capture
    // phase, because the scroll may be happening in an inner container (a
    // `.tablewrap`, the calculator drawer) and those events do not bubble.
    const onMove = () => position();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, position]);

  const bubble = (
    <span
      className={`hint-pop${place?.above ? ' above' : ''}`}
      id={id}
      role="note"
      ref={pop}
      // Hidden until measured: one frame at the default position would show the
      // bubble at the top-left corner before it snapped to its trigger.
      style={{
        top: place ? `${place.top}px` : 0,
        left: place ? `${place.left}px` : 0,
        visibility: place ? 'visible' : 'hidden',
      } as CSSProperties}
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
  );

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
      {open && createPortal(bubble, document.body)}
    </span>
  );
}
