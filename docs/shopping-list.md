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
each at most, and hiding those would trade a wall for a puzzle.

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
$31.67 · recent sales $63.25 — this one is moving."* It must never say which way
it will go next; trade-good prices do not follow a reliable seasonal shape.

**The 10x lot hint**, on the 8 Trade 1 goods. Those tokens sell mostly as 10x
bundles — ten mailed as one lot to save postage — so the count in the *buy*
column is not a number you can ask for. The hint does the arithmetic (*"1 lot
gets you 10, 5 more than you need"*) and **never moves a total**: auctions still
sell singles, and rounding fourteen goods up to lots would inflate a small plan
by a third.

---

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

**Flags replaced Notes**, and is a narrow replacement rather than a shortened
one. The per-recipe breakdown is a wall in a spreadsheet as much as on screen,
and the working tables are where it belongs. Two values survive, because they
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

**XLSX is deferred**: it needs either a ~400KB dependency or a hand-rolled zip
writer.

---

## Saving

`localStorage` only, under `td-shopping-v1`. Three things persist — the picks,
the on-hand counts and the corrected prices — plus the netting toggle. What is
on screen (which chips are expanded, which price editor is open) does not.

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
| `components/ShoppingList.tsx` | selection, chips, state, autosave |
| `components/ShoppingTable.tsx` | one ingredient table, rendered twice |
| `components/ShoppingFinal.tsx` | the takeaway list and the two buttons |
| `components/RecipeDrawer.tsx` | shared with the Build Calculator |
| `scripts/shopping-list.test.mjs` | 115 assertions, the ninth `npm test` suite |

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

## Deferred

| | |
|---|---|
| **A Combined / Pivot view** | The per-recipe breakdown as columns, one per transmute, instead of notes. **Desktop only** — twenty recipes is twenty columns and there is no phone form of it. The `+N more` expander is the interim answer |
| **Notes as a pivot view** | The same idea for the takeaway table, which now shows no notes at all. Revisit together with the above |
| **Drawer row names ellipsize** | A picked row in the drawer truncates long names (`Val's +4 Ke…`) because the stepper takes ~180px. Abbreviating the tier chip on phones bought some of it back, not all; fixing the rest means reworking the row's flex layout |
| **XLSX export** | ~400KB dependency, or a hand-rolled zip writer |
