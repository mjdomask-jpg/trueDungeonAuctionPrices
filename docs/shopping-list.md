# The Shopping List

A third view on the Transmutes page, at `/transmutes/shopping`. The Build
Calculator answers *"should I build this one token or buy it?"*. This answers a
quartermaster's question instead: **across every transmute I plan to make, what
do I still have to buy and what will it cost?** Players kept that in personal
spreadsheets before it existed, which is the shape the output is aimed at.

Built over five steps; `shopping-list-handoff.md` holds the working notes,
including every measurement and the reasoning behind each decision. This file
is the settled version, refined 2026-08-31 — the All/None controls, the capped
notes, the takeaway table's columns and the exports' shape all date from that
pass and are described in place below.

---

## The one measurement the design rests on

**There are exactly 14 distinct trade goods across all 174 recipes.** Pick one
recipe or all 28 of 2026's and the Trade Goods table is still at most 14 rows.
Only *Additional Items* grows, at roughly a row per recipe.

That is why there are two tables rather than one, and it is checked by a test
rather than trusted.

---

## Pricing

The list is locked to **`basis: 'today'`** and carries no price-year pin. That
is the founding domain rule: the list only holds recipes you can act on, so
everything is acquired now, at today's prices. The Recipes view's basis
selector is deliberately absent here — see `transmutes-expansion-plan.md` §10.2
for the rule chain and D11 for the basis itself.

The one exception is a token that **can no longer be bought at all**. An
out-of-print Ultra Rare keeps its own vintage's market, because quoting a 2012
Ultra Rare at this year's price would claim you can buy one. Those rows carry an
`Out of print` note.

**Merge keys.** Trade goods merge on the item **name alone**; everything else on
**name + vintage**. Merging on name is only sound because engine rule S1 gives
every trade good a single price whatever recipe it came from — without that,
summing two prices under one heading would be wrong rather than untidy. A test
asserts the guarantee directly rather than resting it on rule ordering.

---

## The rules a reader will notice

**On hand does not clamp.** `Need = max(0, Total − OnHand)`, and surplus shows
as `N spare`. This diverges from the Build Calculator on purpose: there, on hand
is part of one build; here a stash is a fact about the player, and clamping
would destroy a typed number the moment a recipe left the list.

**Quantity 0 pauses, it does not remove.** A paused recipe is dimmed, struck
through and counted separately in the summary. Only `✕` removes. Re-picking an
already-added recipe **increments** — the likeliest accidental input on a picker
meant to be tapped repeatedly is a double-tap, and remove-on-repeat makes that
destructive.

**Chain netting is offered, never applied.** Adding a Relic *and* the Legendary
it upgrades into asks you to buy the Relic twice, and the drawer lists such
pairs adjacently so people hit it. The list detects them and offers a one-tap
*"count the ones you're crafting as on hand"*, with `Undo`.

What it contributes is **capped at what the row still lacks**, and the row says
so — a `+N crafting` badge beside the on-hand box and a note in the meta line.
Both are necessary: the box holds what you *typed*, so without them a netted
row reads *"on hand 0, needed 3, buy 1"* with the missing two explained
nowhere. The cap is why crafting two of something the list wants one of no
longer reports *"1 spare"*, which was surplus nobody owned. `ChainLink.netted`
is the single number the offer, the badge and the note all quote. D2's
no-clamping rule is untouched: nothing here is a number anyone typed.

**All | None, at two scales.** A master control in each table header and the
calculator's pill on every row — the same control, and the master is simply the
pill applied to every line. *All* fills to `max(typed, quantity − netted)`: it
never cuts a stash bigger than the plan needs, and never types in a count you
do not own. Both are two-state, so neither side lights while you are part-way
through entering what you hold. Below 360px the per-row pill hides and the
master is the fallback.

**The per-recipe notes cap at two**, with a `+N more` expander per row. Six
recipes already made that line wrap twice on a phone. Only the `For X ×N` and
`Source for X ×N` notes count against the cap — the rest are status, one of
each at most, and hiding those would trade a wall for a puzzle. On a desktop
there is a second answer to the same problem — see *The breakdown* below.

**Sources do not recurse.** A source is one Additional Item, category
`Transmute`, priced at its build cost. Its own bill of materials is the Build
Calculator's business.

**Min is a footnote, not a column**, and the price editor edits one number.

---

## The two flags

**Staleness**, on a trade good whose season average has drifted from its recent
sales by **35%** (`STALE_THRESHOLD`). The number is derived, not chosen:
measured over 117 good-seasons the divergences form two populations — ordinary
noise 0–27%, sustained repricing 46–100% — and any cutoff from 20% to 50%
produces the same list today. The row states a fact and stops: *"season avg
$31.67 · recent sales $63.25"* — joined on one line in Notes, stacked on two in
the pivot, from one function (`stalenessParts`) so the two views cannot quote
different numbers for one good.

The two numbers **are** the flag: it only exists because they diverged, and the
**amber** is what marks them as a flag rather than as two more numbers — the way
`Out of print` is marked by its own colour and nothing else. It must never say
which way the price will go next; trade-good prices do not follow a reliable
seasonal shape. A test pins that no rendered flag contains a direction word,
rather than pinning the sentence, so a wording change cannot quietly reintroduce
a forecast.

**The 10x lot hint**, on the 8 Trade 1 goods. Those tokens sell mostly as 10x
bundles — ten mailed as one lot to save postage — so the count in the *buy*
column is not a number you can ask for. It **never moves a total**: auctions
still sell singles, and rounding fourteen goods up to lots would inflate a small
plan by a third.

It sits **under the buy count** in both views, as `2 lots = 20`. It was a
sentence beneath the item name — *"usually sold in 10x lots — 3 lots get you 30,
4 more than you need"* — and firing on 8 of 14 rows made it near-permanent prose
that set the item column's width and cost every flagged row a second line. What
survives is the part that is about *this* row: the number to ask for, and what
you will end up holding. The overage is left as a subtraction, because the two
numbers are already side by side. The general fact — that Trade 1 bundles at
all — is in the Trade goods table's own hint, said once.

---

## The breakdown: Notes or By recipe

A **Breakdown** toggle — `Notes` (the default) or `By recipe` — chooses whether
the per-recipe demand is a sentence under the item name or a **column per
recipe**. It governs both working tables, the takeaway table and both exports.

It lives in the **header of whichever table renders first**, beside the master
On hand control. No one table owns it, which argued for the summary bar — and
that is where it went first, where it was two sections above anything it changed
and could not be found. It sits where the reader is already looking when the
breakdown is the thing bothering them. *"Whichever renders first"* rather than
*"Trade goods"* because an empty table returns `null`: a plan of recipes wanting
no trade goods would take the toggle down with it.

**Desktop only, above 1024px.** That is arithmetic rather than policy. The
frozen group — Item, To buy, On hand, Total — costs 514px before a single recipe
column is drawn, so at 640px there is room for none of them. `WIDE` in
`hooks/useMediaQuery.ts` is a **capability line, not a second layout
breakpoint**: nothing else on the site changes shape there, and `NARROW` is
still the only breakpoint that reflows anything.

Below it the toggle is **hidden rather than disabled and the saved preference is
left alone**, so a plan read in pivot on a laptop is still in pivot when the
laptop comes back.

### The two tables pivot differently, because the data has two shapes

Measured over the real corpus — the numbers the test prints on every run:

| picked | Trade rows | shared | grid full | Additional rows | shared | grid full |
|---|---|---|---|---|---|---|
| 3 | 13 | 12 | 64% | 10 | **0** | 33% |
| 5 | 13 | 12 | 42% | 11 | **1** | 22% |
| 20 | 14 | 14 | 55% | 19 | **3** | 8% |
| all 29 | 14 | 14 | 60% | 35 | **4** | **5%** |

**Trade goods get the true matrix.** Twelve to fourteen of their fourteen rows
are wanted by more than one recipe at every plan size and the grid runs 42–64%
full. This is the table the pivot exists for, and it is where the `+N more`
expander was hiding the most.

**Additional Items get a single `For` column.** They are a *diagonal*: at 29
picked recipes, 31 of 35 rows belong to exactly one recipe. Twenty-nine columns
to carry four rows' worth of shared information is not a pivot, it is a
scrollbar — so the column names the one owning recipe and keeps a `+N more` for
the handful that really are shared. That is what a pivot degenerates to when
its matrix is diagonal.

**The takeaway table uses one shape for everything**, a matrix column per
recipe over both sections. Here that is right: it is the file's table, the
reader has already read the diagonal upstairs, and a `For` column meaning
something different from the columns beside it would be worse than a sparse
block. It stays **read-only** — the on-hand count shows as a number so the
table adds up on its own, but the controls stay in the working tables. Two live
control sets for one piece of state on one page is how two surfaces start
disagreeing about what a reader typed.

### What the columns replace, and what they do not

Only the `For X ×N` and `Source for X ×N` notes leave the item cell — they *are*
the columns, and leaving them under a column saying the same thing would make
the pivot strictly worse than the table it is offered instead of. Everything
else stays: `Price adjusted`, `N spare`, `Out of print`, the netting note,
`Priced as X` and the staleness numbers are all facts about the row itself, and
no column expresses any of them. The 10x lot hint stays too, in its new home
under the buy count.

**A cell the recipe does not touch is blank** (a faint `·` on screen, an empty
cell in the file) **and never `0`**. A zero is a measured quantity: it sums, it
averages, it charts, and a reader filtering *"which recipes want this"* would
get every row back.

**A column's `×N` is the COPY count; the cells under it are totals with that
count already multiplied in.** One Ink line under a `×3` heading reads 15.

### How the frozen columns work

**Four columns are frozen, not six.** Item, To buy, On hand and Total sit at the
left in that order, because they are what the reader came for — the breakdown
informs and does not get to push the answer off the screen.

`$ ea` and `Cost` were pinned there too and the block ran to **682px, half a
1440px screen spent before one recipe column was drawn**. They ride at the far
**right of the scrolling half** now, after the recipe columns, and the frozen
block is 514px. The trade is real and deliberate: correcting a price on a
ten-recipe plan costs a scroll. The plan's *money* does not move — the section
subtotal, the takeaway table and the footer total all stay put — and pinning
them again is one `position` declaration if it turns out wrong.

The four are `position: sticky` with **cumulative pixel `left` offsets**, which
only works because the site-wide `table-layout: fixed` means a column's width
comes from the first row and nothing else. So the frozen columns carry explicit
widths, `$ ea`/`Cost` carry their own (counted into every `min-width` as
`--pv-money` so the recipe columns cannot squeeze them), and **the recipe
columns deliberately carry none**: they share whatever is left, wider than 112px
when three recipes have the page to themselves and exactly 112px once the inline
`min-width` forces the scroll. Nothing after the frozen group can move a frozen
offset either way.

The width figures in `--pv-frozen` and the four `left` declarations are **one
fact written twice**. Change one without the other and the columns overlap.

## Getting it out

**Copy as TSV** and **Download CSV**. Both open with **what the plan is for** —
the transmutes and their quantities, then a blank row — and then the table:
`Item, Category, Season, Needed, On hand, To buy, $ each, Cost, Flags`. Prices
export as plain **numbers**, because a shopping list you cannot sum is not worth
exporting. `toRows` is the table alone; `toSheet` is the whole thing.

The preamble sits **above** the header on purpose. It is where a person opening
the file looks, and forty trade goods say nothing about what any of them is
for. The cost is real and accepted: a spreadsheet's header auto-detection sees
row 1, so filters need setting up by hand.

**In `By recipe` mode both files gain the recipe columns**, appended after the
nine above and headed `Name ×N`. Appended rather than reordered into the
screen's To buy / On hand / Total order: a spreadsheet has no width problem and
no frozen-column problem, so the reason the screen puts those three first does
not apply, and a file whose column order moved under a toggle would break every
saved filter pointing at it. The preamble, the quoting, the formula guard and
the BOM are untouched. With every recipe paused there is nothing to pivot on
and the writers fall back to the standard file rather than emitting a header
row with nothing under it.

**Flags replaced Notes**, and is a narrow replacement rather than a shortened
one. The per-recipe breakdown is a wall in a spreadsheet as much as on screen,
and the working tables are where it belongs — and where the pivot now puts it
in columns. Two values survive, because they
change what you should *buy* rather than explaining why a row exists: `Out of
print` — in a bare grid a 2012 Ultra Rare looks exactly like one still on sale
— and `Price moving`. The staleness *numbers* stay on the page; the price they
are about is in the cell beside the flag.

Those two cannot currently co-occur: staleness is measured only on trade goods,
out-of-print tagged only on Ultra Rares, which are never trade goods. So the
separator in that cell has never been used and the file is pure ASCII apart
from its BOM. Both facts are pinned by tests, so the separator's first real use
is a visible change rather than a surprise.

Three measured facts about the data shape the writers:

| | |
|---|---|
| names starting `+` | **33** — a formula to Excel |
| names starting `-`, `=`, `@` | 0 |
| names containing a comma | **1** — `1,000 GP Gold Bar` |
| names containing a quote, tab or newline | 0 |

The comma is the whole case for quoting: one is enough, because an unquoted
writer silently shifts every column after it on that row.

The formula guard is an **apostrophe prefix on the Copy path only**, where
Excel and Google Sheets consume it on paste. The CSV ships clean quoted values,
because a file is read by many things that would show the apostrophe literally.

The guard covers the **preamble** too, for free: `guardFormula` runs per cell,
so `+3 Fellbane Crossbow` is protected there as well as in the table.

**Confirmed in Excel**: a name starting `+` reads as text on both paths. That
was the open question, and it is closed.

### The file's ENCODING is a separate problem from its text

Excel showed `For +3 Fellbane Crossbow Ã—3 Â· … â€"` — its UTF-8 bytes read as
Windows-1252. The `type: 'text/csv;charset=utf-8'` on the Blob is **not stored
in the file**; it tells the browser what it is being handed, and nothing
downstream ever sees it. Excel opens a `.csv` in the system ANSI codepage.

`csvFile` prepends a **BOM** and is the only thing that should ever be written
to disk. Google Sheets and LibreOffice consume it silently. Only the file gets
it — the clipboard carries text rather than bytes, which is why Copy as TSV
never had the problem and why a BOM pasted into a cell would be a stray
character rather than an encoding hint.

**XLSX is DROPPED, not deferred** (2026-09-02). It was a *Could have* in the
original brief, wanted for one thing the CSV cannot carry: a live formula in the
*To buy* column, `Total − On hand`. That is a few seconds of typing for anyone
who wants it, and the cost of shipping it is a ~400KB dependency or a hand-rolled
zip writer — a poor trade against a build the whole site keeps small on purpose.

Recorded as a decision rather than deleted, so the next pass does not re-derive
it. Reopen it only if something turns up that a CSV genuinely cannot express —
multiple sheets, or formatting the file has to carry.

---

## Saving

`localStorage` only, under `td-shopping-v1`. Five things persist — the picks,
the on-hand counts, the corrected prices, the netting toggle and the
**Breakdown** choice. What is on screen (which chips are expanded, which price
editor is open, which `+N more` is uncapped) does not.

The Breakdown choice is a *preference* rather than a fact about the screen,
which is why it sits on the saved side of that line. It rides in the plan's own
entry and **Clear list resets it with everything else** — that is what keeps an
emptied plan leaving no entry at all rather than a lone `{"view":"pivot"}`. No
version bump and no migration: an entry written before the field existed is
complete without it, and anything that is not the one non-default value reads as
the default.

Share links were dropped: a twenty-recipe plan with per-row counts makes a
punishing URL. A server-side "code" is **impossible**, not merely unbuilt — the
site is static on GitHub Pages, which has no write path, and a repo token in
client JS would be public.

`lib/shoppingStorage.ts` treats the stored value as **data, not state**: the
accessor itself can throw (a private window, blocked storage), and the contents
are hand-editable and survive deploys. Every field is re-validated on the way
in, and anything that fails is dropped rather than repaired. An emptied plan
removes the entry instead of storing an empty one.

A pick whose key no longer names a recipe — a transmute renamed in the CSV —
is **kept in storage but dropped from the display**, counts included. It
renders no chip and prices nothing, so counting it made the headline read
"9 recipes" over seven chips and offered `+2 more` that revealed nothing.
Keeping it means a pick stranded by a temporary data change comes back rather
than being quietly destroyed.

### The Build Calculator saves too, and saves less

`lib/calcStorage.ts`, `td-calc-v1`, **the selected recipe and nothing else**.
Its own slot, because two tools answering two questions must not clear each
other — pinned by a test, since the older stand-in Storage ignores the key and
could not have caught a collision.

The on-hand counts and overrides deliberately do not persist, and that is a
hazard rather than a preference: the calculator keys both by **line index**, so
a line inserted or reordered in `transmuteRecipes.csv` between deploys would
restore a count against the wrong ingredient — silently, and in the reader's
favour, making their cost to finish too low. Doing it safely means storing the
line names alongside and dropping the lot when they stop matching: a real
mechanism guarding a convenience that is one `All` tap away. The recipe is the
part that is actually tedious to get back, behind a drawer, eleven tier filters
and a year accordion.

Saving only the key also means **no first-run guard**: the effect that clears
state when the recipe changes fires on mount too, and what it clears is exactly
what should start empty. Resolving the key is the *caller's* job — a stale one
reads as "nothing was selected", and the save effect then writes the resolved
null, so the entry removes itself.

The two tools do **not** share an on-hand number. The Shopping List records a
stash and allows overcounts; the calculator is a what-if sandbox that clamps to
what one recipe needs. One number serving both would have to give up one of
those.

---

## Where the code is

| | |
|---|---|
| `lib/shoppingList.ts` | merging, totals, chains, notes, staleness, the lot hint |
| `lib/shoppingExport.ts` | TSV and CSV writers, the formula guard, the BOM |
| `lib/shoppingStorage.ts` | load/save/clear, and the validation |
| `lib/calcStorage.ts` | the Build Calculator's one saved value |
| `lib/shoppingHand.ts` | the All/None arithmetic both table shapes share |
| `components/ShoppingList.tsx` | selection, chips, state, the Breakdown toggle, autosave |
| `components/ShoppingTable.tsx` | one ingredient table in `Notes` shape, rendered twice |
| `components/ShoppingPivot.tsx` | the same table in `By recipe` shape, matrix or single |
| `components/ShoppingHand.tsx` | the section header and the on-hand cell, shared by both |
| `components/ShoppingFinal.tsx` | the takeaway list and the two buttons |
| `components/RecipeDrawer.tsx` | shared with the Build Calculator |
| `scripts/shopping-list.test.mjs` | the tenth `npm test` suite; § 14 is the pivot |

The row markup reuses the Build Calculator's classes (`calc-line`, `cl-main`
and friends) rather than copying them, so the two cannot disagree about the
phone reflow. `RecipeDrawer`'s `quantities`/`onQuantityChange` props are
optional; passing neither leaves it the single-select picker the calculator
uses; `onRemove` is optional in the same way.

**Table widths are percentages on `<thead>` cells, not min-widths.** The global
`table` rule in `App.css` sets `table-layout: fixed` site-wide, so a min-width
on a cell does nothing at all — the takeaway table gave all five columns an
equal share until this was noticed, which is why the staleness sentence wrapped
while `Buy` held 225px for a two-digit number.

---

## Deferred and dropped — see [`backlog.md`](./backlog.md)

Moved 2026-09-03. This view's one deferred item is **`SITE-3`** (drawer row names
ellipsize); **XLSX export**, **share links** and **server-side save codes** are in
that file's § *Dropped*, with the reasons, so nobody re-derives them.

§ *Getting it out* above still holds the XLSX reasoning in full, and § *Saving*
still explains why the Build Calculator stores only the recipe — `backlog.md`
carries the list, not the reasoning.
