# UI conventions

House rules for this site. They exist so independently-built pages still read as
one product. If you change one, change it here in the same commit.

## Help text is never a `title` attribute

**Rule: any explanatory help uses `<HintPopover>`, never `title`.**

A `title` tooltip only appears on hover. Touch devices have no hover, so on a
phone the help simply does not exist — and roughly half this site's traffic is
someone checking a price on their phone at a convention.

```tsx
import { HintPopover } from '../components/HintPopover';

<HintPopover label="About recent prices">
  Use data from this season's last 5 auctions
</HintPopover>
```

The component ([`src/components/HintPopover.tsx`](../src/components/HintPopover.tsx))
guarantees the required behaviour:

- **Opens on click/tap**, and stays open until dismissed. It is not a hover state.
- **Dismisses three ways**: the `×`, the `Escape` key, and a `pointerdown`
  anywhere outside it. The outside-click path matters most — it makes the whole
  screen the close target, so a phone user never has to hit the 18px `×`.
  `pointerdown` rather than `click` so the first touch closes it.
- **Clamped to whatever actually clips it** — capped at
  `min(260px, calc(100vw - 32px))`, then measured on open and slid back inside
  the narrowest bound among the viewport *and every scrolling/hidden ancestor*.
  The viewport alone is not enough: `.tx-season` sets `overflow: hidden`, so a
  bubble anchored near a season card's right edge is cut off by the card long
  before the window runs out.
- **Stops click propagation**, so it is safe inside a `<label>` or any other
  clickable container whose control it would otherwise trigger.

`trigger` replaces the default `?` circle when the help attaches to an existing
affordance rather than standing on its own — as the `ceiling`, `est.` and
`buy ~$X` badges in `TransmuteRow` do:

```tsx
<HintPopover label="What “est.” means" trigger={<span className="tx-badge est">est.</span>}>
  Some ingredients are priced from another season.
</HintPopover>
```

### Putting a popover inside a clickable row

A `<button>` cannot contain another `<button>`, so a row that is itself a click
target can't simply wrap badges that open popovers. `TransmuteRow` solves this
with an **overlay toggle** rather than a wrapper, and that is the pattern to
copy:

- the row header is a plain `<div>` with `position: relative`;
- the expand control (`.tx-rtoggle`) is an empty `<button>` at `inset: 0`,
  painted *behind* the content, carrying `aria-expanded` and an explicit
  `aria-label` (it has no text of its own);
- the visible face (`.tx-rface`) sets `pointer-events: none` so clicks fall
  through to that button, preserving the whole-row click target;
- only the interactive bits — `.tx-badges` — set `pointer-events: auto` to opt
  back in.

The result is one tab stop per row, valid HTML, and badges that open their help
without expanding the row. The trade-off is that text in the face can no longer
be selected with the mouse.

**The one exception**: `title` is still fine as a *name* for a self-evident icon
control, mirroring its `aria-label` — see `ThemeToggle`. That is labelling, not
help. The test is whether a user who cannot see the tooltip loses information.
For a sun/moon toggle, no. For "what does `est.` mean", yes.

## Tables

- **4+ rows get alternating row shading.** `CategoryTable` and `CompareTable`
  apply `.banded` themselves based on `rows.length >= 4`; do the same rather than
  maintaining a per-category allowlist.
- **Cells are right-aligned by default** (`tbody td { text-align: right }` in
  `App.css`). Text columns need `className="left"`. Change/delta columns need
  `className="diff"` for the up/down colours to apply.

## Colour and contrast

- **Never use `opacity` to mute text.** It compounds against whatever is behind
  it and destroys contrast in one theme or the other. Set a real colour — the
  muted token is `var(--text)`.
- **Everything is themed through the CSS variables in `index.css`**, which are
  defined for both light and dark. No hard-coded hex in components.
- **Transmute tier colours are game-canonical**, not a palette choice — see
  `domain-context.md`. Don't "fix" them to match the category palette.

## Charts

Hand-rolled zero-dependency SVG, themed with the same CSS variables. A null data
point renders as a **gap, never a zero-height bar** — the distinction between "no
data" and "zero" carries real meaning here, since cadence columns only start in
2022.
