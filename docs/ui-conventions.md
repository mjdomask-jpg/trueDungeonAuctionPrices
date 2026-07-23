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
- **Clamped to the viewport** (`max-width: min(260px, calc(100vw - 32px))`) so it
  can never introduce a horizontal page scroll.
- **Stops click propagation**, so it is safe inside a `<label>` or any other
  clickable container whose control it would otherwise trigger.

`trigger` replaces the default `?` circle when the help attaches to an existing
affordance (a badge, say) rather than standing on its own.

**The one exception**: `title` is still fine as a *name* for a self-evident icon
control, mirroring its `aria-label` — see `ThemeToggle`. That is labelling, not
help. The test is whether a user who cannot see the tooltip loses information.
For a sun/moon toggle, no. For "what does `est.` mean", yes.

### Known gap

The three badges in `TransmuteRow` (`ceiling`, `est.`, and the `buy ~$X` market
tag) still use `title`. They sit inside the row's expand `<button>`, so a
popover trigger button cannot nest there without invalid HTML — converting them
needs the row header restructured first.

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
