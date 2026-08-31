# The Shopping List

A third view on the Transmutes page, at `/transmutes/shopping`. The Build
Calculator answers *"should I build this one token or buy it?"*. This answers a
quartermaster's question instead: **across every transmute I plan to make, what
do I still have to buy and what will it cost?** Players kept that in personal
spreadsheets before it existed, which is the shape the output is aimed at.

Built over five steps; `shopping-list-handoff.md` holds the working notes,
including every measurement and the reasoning behind each decision. This file
is the settled version.

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

**Copy as TSV** and **Download CSV**. Both carry more than the on-screen table:
`Item, Category, Season, Needed, On hand, To buy, $ each, Cost, Notes`. Prices
export as plain **numbers**, because a shopping list you cannot sum is not worth
exporting.

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

> ⚠ **Untested against real Excel.** The bytes are provably what was specified,
> but nobody has opened the `.csv` in Excel. Google Sheets and LibreOffice show
> `+3 Mithral Bracers` as text. If Excel shows `#NAME?`, apply `guardFormula`
> inside `csvCell` too — one line, and the tests isolate the behaviour so it
> cannot leak into the TSV path.

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

---

## Where the code is

| | |
|---|---|
| `lib/shoppingList.ts` | merging, totals, chains, notes, staleness, the lot hint |
| `lib/shoppingExport.ts` | TSV and CSV writers, the formula guard |
| `lib/shoppingStorage.ts` | load/save/clear, and the validation |
| `components/ShoppingList.tsx` | selection, chips, state, autosave |
| `components/ShoppingTable.tsx` | one ingredient table, rendered twice |
| `components/ShoppingFinal.tsx` | the takeaway list and the two buttons |
| `components/RecipeDrawer.tsx` | shared with the Build Calculator |
| `scripts/shopping-list.test.mjs` | 90 assertions, the ninth `npm test` suite |

The row markup reuses the Build Calculator's classes (`calc-line`, `cl-main`
and friends) rather than copying them, so the two cannot disagree about the
phone reflow. `RecipeDrawer`'s `quantities`/`onQuantityChange` props are
optional; passing neither leaves it the single-select picker the calculator
uses.
