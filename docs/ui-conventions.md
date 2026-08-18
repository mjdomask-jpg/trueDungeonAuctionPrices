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

### Touch targets grow by overlay, not by padding

Both popover triggers are small by design — the `?` circle is 16px, the badges
are 46×18px — and both are far under the ~44px a thumb needs. Below 640px each
grows an `::after` at negative `inset`, which enlarges the hit area without
changing the pill's size or disturbing the row's rhythm. Padding would do the
second thing as well as the first.

How far they can grow is set by what sits next to them, and getting this wrong
is worse than leaving the target small:

- **Badges** stop at 3px horizontally, because `.tx-badges` has a 6px gap and
  two overlapping targets would hand a tap between them to whichever sits later
  in the DOM. They reach ~52×44px.
- **The `?` circle** takes the whole gap beside it: 7px for a bare `.hint-q`,
  and 12px inside a `.tx-check`, whose gap is widened on mobile precisely to
  give it that clearance. Inside one it reaches 46×44px.

Where a trigger and its neighbouring control compete for a tap, **the trigger
should win**. Opening help is safe and reversible; the control beside it usually
is not — the one on `.tx-check` reprices every number on the page. That is why
the `?` spends its whole gap rather than splitting it.

**An overlay alone is not enough for a small target.** The `?` first got the
overlay treatment while staying 16px, and still tested as fiddly: people aim at
the circle they can see, not the invisible box around it. It is 22px on mobile
for that reason. Grow the visible control first, then let the overlay carry the
remainder.

### A popover inherits the label it sits inside

**Rule: the bubble resets its own typography. Never fix this at a call site.**

A `?` is usually placed *inside* the label of the control it explains, and the
bubble renders as a descendant of that label. Control labels on this site are
uppercase with letter-spacing — `.toggle-label`, `.filterset > summary` — so
every popover opened from a toggle rendered its prose in ALL CAPS, which reads
as shouting rather than as help.

`.hint-pop` therefore sets `text-transform: none`, `letter-spacing: normal` and
its own `font-family`. Resetting on the bubble rather than on each label means a
new label style cannot reintroduce it, and a popover moved to a new home cannot
pick up something else's casing. The same reasoning applies to anything else a
label might impose: if it would change how a *sentence* reads, the bubble should
neutralise it.

### A label carrying a `?` is taller than one without

**Rule: labels in a row of controls reserve the taller box, whether or not they
carry help.**

The `?` trigger is 16px; a 12px uppercase label's line box is not. So a label
with help measures 22px against a bare one's 18px, and in a row of controls the
two sit 4px out of step — visible as soon as two toggles stand side by side,
and the sort of thing that reads as sloppiness without being obvious why.

`.toggle-label` (and the calculator's `.calc-tool-lab`) are `inline-flex` with a
`min-height` covering the trigger, so every control in a row lines up regardless
of which ones have help attached. Use `min-height`, not `height` — a label may
wrap to two lines on a phone.

**The one exception**: `title` is still fine as a *name* for a self-evident icon
control, mirroring its `aria-label` — see `ThemeToggle`. That is labelling, not
help. The test is whether a user who cannot see the tooltip loses information.
For a sun/moon toggle, no. For "what does `est.` mean", yes.

### A `?` next to a `<select>` goes OUTSIDE the `<label>`

**Rule: when the control a popover explains is a `<select>`, the help trigger must
not be a descendant of that select's `<label>`.**

The site's usual shape puts the `?` inside the label — safe for a segmented toggle,
because `.toggle-label` is a plain `<span>` and clicking it does nothing. A `<label>`
wrapping a form control is different: a click anywhere inside it, the popover trigger
included, is forwarded to the control. Tapping "what does this mean" would drop the
dropdown open behind the bubble.

So the Transmutes price-season picker uses an explicit `<label htmlFor>` for the text
and puts `HintPopover` beside it, both inside the `.toggle-label` span that keeps the
pair aligned and reserves the 22px box the rule above describes:

```jsx
<div className="toggle price-year">
  <span className="toggle-label">
    <label htmlFor="price-year">Price data from</label>
    <HintPopover label="…">…</HintPopover>
  </span>
  <select id="price-year">…</select>
</div>
```

A `<select>` placed in a `.toggle` rather than in a `.controls label` also has to
restate the 12px uppercase control font itself — same reason `.toggle-buttons` does —
or it renders at the page's 15px sentence case beside its neighbours. Let the phone's
`.controls select` rule keep winning on `font-size`: 16px is what stops iOS zooming
the page on focus.

### Controls that share a row line up, top and bottom

**A `<select>` and a segmented `.toggle` on the same `.controls` row must have
the same top and bottom edge.** Both are a label stacked over a 32px (44px on a
phone) control, so what decides the alignment is the LABEL box: `.toggle-label`
reserves 22px (see "A label carrying a `?`" above) while a bare `.controls
label`'s text was one 18px line box, which floated its select 4px above the
toggle beside it. `.controls label` now fixes that line box at `line-height:
22px`, so the two match; the controls themselves restate `line-height: normal`
so they keep sizing off `--control-h`.

On a phone the toggle's frame counts toward the control height too
(`box-sizing: border-box`): the buttons take `calc(var(--control-h) - 2px)` so
the bordered control is exactly `--control-h`, not two pixels taller than every
select on the row.

### A toggle button always fits its own label

**No toggle button may clip or crush its text.** `.toggle-buttons` sets
`overflow: hidden` for its rounded corners, which zeroes its automatic minimum
size — as a flex item in a tight row it shrank happily, and "Full Season" lost
22px at 375px while "Reward-adj." lost 16px. Two rules keep it honest:

- `.toggle-buttons { min-width: min-content }` restores a floor of "as wide as
  the labels need"; a crowded row wraps instead of clipping.
- the `::after` ghost that reserves each button's **bold** (selected) width
  deliberately does *not* set `overflow: hidden` — a hidden-overflow box
  contributes 0 to min-content, which is the whole width it exists to reserve.

The ghost's text comes from `data-label`. A button that swaps to a shorter label
on phones (`.lbl-full`/`.lbl-short`) must also carry **`data-short`**, or the
ghost reserves room for the full label the phone is not showing.

When a label is genuinely too long for the space, shorten the label — do not
let it clip. "Show Recipes" became "Active" for exactly this reason.

### Mixed type sizes on one row align on the BASELINE

**Where a row puts different font sizes or families side by side — a tier chip,
a token name, a year, a help note — use `align-items: baseline`, not `center`.**
Centring lines up boxes, and each font divides its em between ascent and descent
differently, so centred boxes leave the text visibly out of step: measured 1.5px
between a Caslon token name and the sans chip beside it on the calculator's
recipe bar, and 5.9px in the recipe drawer. Baseline alignment also does the
right thing when one item runs to two lines (a name over its "upgrades from"
note): the chip lands on the NAME, not on the middle of the stack.

Items that are not text — a close button, a disclosure chevron — opt back out
with `align-self: center`, since they have no meaningful baseline to share.

### Uppercasing is for control LABELS, not control values

The 12px uppercase treatment belongs to the label above a control. The values
inside it stay sentence case, like every `<select>`'s options — a picker reading
"AUTO (EACH RECIPE)" reads as shouting.

## Form controls on mobile

**Any `<select>`, `<input>` or `<textarea>` must render at 16px or larger on
narrow screens.** Below 16px, iOS Safari zooms the whole page in when the
control takes focus and does not zoom back out, stranding the user at a zoomed
viewport. This is a browser threshold, not a taste call — the site's controls
inherit 12px from their uppercase labels, so the override lives in the
`max-width: 640px` block at the foot of `App.css`.

## Shared filter bar & provenance badges

**The context-layer filters are one component, dropped into every in-scope page.**
Filter *state* lives in `FiltersProvider` (app-level, in `main.tsx`), read through
`useFilters()`; a single `<FilterBar/>` renders the controls. A page shows only
the controls it uses via the `controls` prop — `source`, `trentPricing`,
`auctionType`, `provenance` — so the state shape and behaviour stay identical
everywhere. Prices, Onyx, Timelines, Compare and Auction Data carry the three
price-shaping controls `['source', 'trentPricing', 'auctionType']`; the
**Context** page owns `provenance` alone. Transmutes is deliberately out of
scope. See `docs/context-layer-design.md` §5.2.

**The provenance filter lives with the thing it filters.** It used to sit on
Prices alongside a separate "Auction context" list, but the chips were far from
that list (so toggling had no visible effect) and the list made a casual-reader
page long. Both moved to a dedicated **Context** page, where the "Show context"
chips sit directly above the grouped item list they toggle. Prices keeps its
price-shaping filters only, and its per-token tables are unchanged (§5.4).

**On mobile the price-shaping bar folds behind a "Filters" disclosure**
(`<FilterBar collapsibleOnMobile />`), so it costs one ~20px row instead of the
~140px the expanded controls take above the data — reusing ExplorerPage's
`.filterset` furniture, with a count badge when a filter is off-default. The
Context page's provenance bar stays open (its effect is immediately below it, so
hiding it would only add a tap).

**Every pricing page funnels its sale feed through `applyViewFilters`** (in
`lib/context.ts`) before aggregating, so Source / Trent-pricing / Auction-type
behave the same across pages and the *defaults* (All sources, Nominal, All types)
return the feed untouched — each page reads exactly as it did before the layer.
The Auction Data page is the one exception: because it lists auctions rather than
aggregating, it filters its **meta** list with `passesAuctionFilters` (so a
narrowed auction disappears entirely instead of showing an empty card) and only
rescales prices through the shared helper. The `auctionType` "With Golden Ticket"
option reads a set memoised once in the provider (`goldenTicketAuctions`);
"Non-augmented" is the complement of "Augmented", so the 92 pre-augment-era
auctions read as non-augmented rather than vanishing from both.

**Provenance badges reuse the popover-in-a-row pattern**, not a `title`: the
`released` / `augment` / `grunnel` / withheld-`est.` badges are `HintPopover`s
(see "Putting a popover inside a clickable row" above) so touch users get the
explanation. Their colours have light + dark entries in `App.css`; `normal` rows
carry no badge. The Context page renders the context items.

## Tables

**Wide stat tables show one group at a time on mobile.** Seven columns do not
fit a phone: six numeric columns get ~38px each, of which 24px is padding, so
the values spill out of their cells and overlap the column to their left. Where
a table's columns fall into groups, render one group at a time below 640px
behind the standard `.toggle` segmented control, and keep the group's header row
so the table still says which set you are looking at once the controls scroll
away. `CategoryTable` does this with a `group` prop (`'both' | 'last5' |
'full'`), defaulting to `'both'` so desktop is untouched.

Pick the breakpoint in React via `useMediaQuery`, not in CSS — hiding columns
with `display: none` fights `table-layout: fixed` and the colspan'd group
headers, which map by *rendered* column index.

**Table headers do not stick by default, and adding `position: sticky` to a `th`
will not change that.** `.tablewrap` sets `overflow-x: auto`, and CSS forces
`overflow-y` to compute to `auto` alongside it, which makes the wrap the nearest
scroll container for anything inside. The wrap has no height constraint, so it
never scrolls vertically and a sticky header simply travels up and out with the
page.

**To pin one, give the wrapper a height** — `.an-scroll.an-pin` (`max-height:
min(72vh, 820px); overflow: auto`) — so the thing scrolling under the header is
the wrapper itself. Two things this needs, both of which cost an hour to find:

- **No clipping ancestor between the header and the scroller.** `.an-table`
  rounds its corners with `overflow: hidden`, and any clipping ancestor becomes
  the sticky element's scroll container — the header stuck to a box that never
  scrolls, i.e. did nothing. `.an-pin` moves the border and radius onto the
  wrapper and sets `overflow: visible` on the table.
- **The header needs its own opaque background and a restated bottom border.**
  Out of flow it keeps `thead th`'s `--card` fill but loses the table's collapsed
  border, so `.an-pin thead th::after` draws it back.

Reserve this for tables long enough to earn a nested scrollbar. Today that is one
table: Analytics → Historical → *Auctions by auctioneer and season*, which runs
to every auctioneer on record and is unreadable once the season columns scroll
away.


- **4+ rows get alternating row shading.** `CategoryTable` and `CompareTable`
  apply `.banded` themselves based on `rows.length >= 4`; do the same rather than
  maintaining a per-category allowlist.
- **Cells are right-aligned by default** (`tbody td { text-align: right }` in
  `App.css`). Text columns need `className="left"`. Change/delta columns need
  `className="diff"` for the up/down colours to apply.

## Tier chips

**Below 640px the tier chip shows a short code, not the tier name.** A
spelled-out `Legendary` is 72px of a ~300px row, and the row's flex line gives
every pixel it can't afford to `.tx-name` — measured before this change, the
token name on a paired Legendary row was down to 11.9px at 375px and 0px at
320px. The codes live in `tierAbbrev` ([`src/lib/transmutes.ts`](../src/lib/transmutes.ts)):

| A | El | En | Ex | L | M | O | Par | Pat | R | S |
|---|---|---|---|---|---|---|---|---|---|---|
| Arcanum | Eldritch | Enhanced | Exalted | Legendary | Mythic | Omni | Paragon | Patron | Relic | Safehold |

Each is the shortest prefix that is unique across **all eleven** tiers — one
letter where that's unambiguous, two for the three E-tiers, three for
Paragon/Patron, which collide at both one and two letters.

Two rules for maintaining it:

- **It is a fixed table, never computed.** Seasons carry different tier sets, so
  deriving prefixes from whatever a season happens to contain would let the same
  letter mean different things on different seasons. A new tier means checking it
  against the whole table by hand; an unmapped tier falls back to its full name,
  because a wide chip beats a colliding one.
- **The full tier name stays in the accessibility tree.** The chip renders the
  code in an `aria-hidden` span beside an `.sr-only` span carrying the real name,
  so the tier is never conveyed by a letter and a colour alone.

## Colour and contrast

- **Never use `opacity` to mute text.** It compounds against whatever is behind
  it and destroys contrast in one theme or the other. Set a real colour — the
  muted token is `var(--text)`.
- **Everything is themed through the CSS variables in `index.css`**, which are
  defined for both light and dark. No hard-coded hex in components.
- **Transmute tier colours are game-canonical**, not a palette choice — see
  `domain-context.md`. Don't "fix" them to match the category palette.
- **The chip's *text* colour is not canonical** — only the fill is. Text is
  tuned per tier for contrast against that fill, and is the knob to reach for
  when a chip reads poorly. Legendary is the worked example: its orange is a
  bright, high-chroma `#f0730f`, on which white is 2.93:1 (a clear AA failure)
  and the original brown was 5.32:1 but still muddy at chip size. Black is
  7.16:1. Darkening the *fill* so white could work would have meant reaching
  `#c2560a`, which no longer reads as Legendary orange and crowds Omni.

## Charts

Hand-rolled zero-dependency SVG, themed with the same CSS variables. A null data
point renders as a **gap, never a zero-height bar** — the distinction between "no
data" and "zero" carries real meaning here, since cadence columns only start in
2022.
