# Data backlog

Known gaps between the domain and what the data represents. None is a bug — the
site computes correctly on the data it has. Each is a place where a real game
concept has no home in the schema yet.

Recorded 2026-08-20, while reconciling the docs with the shared `td-domain`
skill. Game-level definitions live there; this file tracks only what *this
repo's data* is missing.

Last reconciled **2026-09-02**. Four items closed that day: the maintainer
decided 3 and 4 (keep `Category` as the tier axis), 5 gained the validator rule
it asked for plus the three cells that clear its warning (PR #163), and 7 was
fixed by a thread read (PRs #164/#165) — which also corrected the Trade 4
token's NAME to `25,000 GP Eldritch Ore Bar` here and in the `td-domain` skill,
and re-based item 8's evidence from one sale to six. Item 2 closed the day
before with PR #159.
**A resolved item keeps its number and is marked RESOLVED rather than deleted**,
so a reader who met it elsewhere can still find it, and so the reasoning that
closed it is not lost. Renumbering would also break every reference to "item 4"
in the docs and in the commit log.

---

## 1. The 50 GP Idol chase set is only half modeled

**Now:** the Idol appears only in `contextItems.csv`, as six named variants —
Goose, Lion, Locust, Meerkat, Ram, Tortoise — across 7 rows, all season 2025,
carried as auction augments at $20 each.

It is absent from `tokenMetadata.csv`, `offAuctionPrices.csv`, and
`transmuteRecipes.csv`.

**Why it matters:** it *is* a chase token — treasure-only, set-forming, named
variants — and every other chase set is modeled. Stalker Token, Herald Token and
Golem Piece all carry a `Treasure Chest` metadata row and an off-auction price.
The Idol is the odd one out, so anything reasoning about chase sets will silently
miss it.

**Done looks like:** a `Treasure Chest` row per season in `tokenMetadata.csv`, an
`offAuctionPrices.csv` entry, and its transmute in `transmuteRecipes.csv` if one
exists.

---

## 2. Golden Fleece has no recipe of its own — RESOLVED (PR #159, 2026-09-01)

**Was:** 99 recipe lines consumed Golden Fleece and none produced it; the real
relationship existed only backwards, as `derivedPrices.csv`'s `Monster Trophy =
Golden Fleece / 10, bound=ceiling`.

**Now:** `transmuteRecipes.csv` carries `2017 | Trade 3 | Golden Fleece | 10 x
Monster Trophy`, `Expires=never` — the first authored value in that column.
`offAuctionPrices.csv` carries Monster Trophy for 2019-2026, which supersede the
derived rule (leaf order is auction -> off-auction -> derived, written that way
for exactly this) and took the `ceiling` flag off **36** recipes. The derived rule
survives as an unreachable fallback.

**Three things worth keeping from how it was closed**, because none is obvious
from the resulting data:

1. **A Monster Trophy has a VINTAGE, and a recipe wants the previous year's.** A
   2027 recipe needs a 2026 trophy; the rule is recipe year - 1 throughout, now
   `ItemYear=-1` on all 36 lines. The 2027 trophy row was deleted as a projection
   rather than a sale — nobody holds one yet.
2. **A non-blank `ItemYear` makes the line a PIN**, which outranks rule 4's
   float-to-today. That is what the year-1 fix actually did to the engine, and it
   is not visible in the CSV.
3. **The trophy prices were authored as exactly Fleece / 10**, so no number moved.
   What changed is that 36 recipes stopped saying "upper bound" — a judgement the
   maintainer made, not a measurement. The original rule's rationale (assembling
   ten trophies is hard, so Fleece/10 is a ceiling on one trophy's worth) still
   stands and is now unstated anywhere in the data.

---

## 3. The trade rungs live on the `Category` axis, which is not a tier field — RESOLVED (decision, 2026-09-02)

**Decided by the maintainer: `Category` IS the tier axis, and the Wish Ring's
display fold is the one accepted exception.** No second field is added.

The reasoning, in the maintainer's terms: the Bonus items in the largest order
have been stable for a long time, so the collision has exactly one occupant and
no realistic prospect of a second. A separate tier field would be the extensible
solution to a set of size one — and its cost is not the column, it is that four
call sites (`isTradeCategory`, the Shopping List's `mergesAsTradeGood`,
`validate-prices.mjs` § 7's vocabulary and `publishToSite.gs`'s allow-list) would
each have to name which axis they read, with a silent failure mode if any of them
picked wrong. The kludge is the cheaper resolution.

**What is now settled, and can be relied on:**

- `tokenMetadata.Category` and a recipe's `Level` hold the token's **rung**.
  `isTradeCategory` (`/^Trade \d+$/`) reading that column to pick a pricing
  branch is correct **by design**, not by luck.
- `sectionCategory`'s `Trade 4 -> Premium` map in `src/lib/categories.ts` is the
  sanctioned exception. It is **display only** — the Prices page and the Trends
  year-over-year view group on the section; the explorer's chips, filters and
  sorting keep the real `Trade 4`.
- No code or data change. Everything already matches the decision, so this item
  closes on the decision itself.

**Measured the day it was decided**, because a decision to live with a special
case is only as good as the size of the set it covers: `Trade 3` has one occupant
(Golden Fleece, never sold), `Trade 4` one (Wish Ring), `Trade 5` two (Omni Orb,
Omni Cube, never sold). Wish Ring is the **only** token whose rung and sale
category disagree, in `tokenMetadata.csv` and `prices.csv` alike.

**The trip-wire, and it is a real one.** `CATEGORY_SECTION` keys on the
**category**, not on the token — so it folds *anything* carrying `Trade 4` into
Premium. Item 8 proposes authoring the `25,000 GP Eldritch Ore Bar` as a Trade 4
token; the moment that lands, the bar joins the Premium table too, which is wrong
for a token that is not an 8K-order exclusive, and nothing would report it.
Whoever picks up item 8 either re-keys the fold on the item name or reopens this
decision. Noted in item 8's cautions as well.

---

## 4. Wish Ring's dual nature is unreconciled — RESOLVED (decision, 2026-09-02)

**Decided with item 3: tier and acquisition are NOT separated into two fields.**
Wish Ring stays a `Trade 4` token that displays under Premium.

**The dual nature is not, in fact, unrecorded — which is this entry's own
correction.** Both halves sit on one row of `tokenGroups.csv`, in different
columns: `Category = Trade 4` (what the token *does*) and `Group = 8k exclusive`
(how it is *got*), the latter shared with two Premium tokens. `Group` is the
Timelines chart grouping rather than a declared acquisition field, so that is a
representation and not a schema commitment — but a reader asking how a Wish Ring
is obtained does have somewhere to look, which the original entry assumed there
was not.

What genuinely has no home is a single field meaning "trade good **and**
premium-priced", and the decision is that none is needed. The engine wants the
rung (item 3); the Prices page wants the section (`sectionCategory`); nothing
asks the combined question.

**What would reopen it** is item 3's trip-wire — a second auctioned token on a
`Trade N` rung — or a UI that has to explain to a player *why* a trade good sits
in the Premium table. Neither exists today.

---

## 5. `IngredientType` is authored inconsistently for the same token — RESOLVED (2026-09-02)

**Closed the second of the two ways this entry offered**, and the cheap one:
`scripts/validate-recipes.mjs` now asserts that a given `Item` carries one
`IngredientType` everywhere it appears.

**The data half had already fixed itself, which this entry did not know.** PR
#159 filled the blank cell on `Charm of Synergy` / Smith's Charm of Unified
Synergy (Set 2) while modelling the trade ladder. The reconciliation that
rewrote this entry on 2026-09-02 read the table from the entry rather than from
the CSV, so it reported a defect that had been gone for a day — which is the
same lesson as the `verify-claims-against-project-data` memory, applied to this
file's own prose.

**The rule, and why it has two severities.** `IngredientType` is a property of
the TOKEN, not of the recipe consuming it, so the two ways lines can disagree
are not the same kind of problem:

| Shape | Severity | Why |
|---|---|---|
| One Item, two different non-blank values | **ERROR** (fails the run) | The data states two things about one token. No amount of unfinished authoring produces this — only a typo or a real disagreement. |
| One Item, authored on some lines and blank on others | **WARN** (never fails) | Authoring in progress. The engine already survives it: `isUltraRare` and `isTradeGood` read the resolved category (`prices.category(...) \|\| l.ingredientType`), so a blank cell falls back to `tokenMetadata`. |

The WARN is the one that matters, because it is the shape the defect actually
took. It is also **deliberately not an error**, for the reason
`validate-recipes.mjs` states at its own exit: authoring an optional column must
never turn a passing export into a failing one. An ERROR here would sit on the
publish PR and look exactly like the publish being broken — the failure mode the
`publish-check-blocks-publishing` memory has now recorded four times.

**One live occurrence, reported rather than carved out.** The Item literally
named `Ultra Rare` — the generic tier slot, since auctions sell "an Ultra Rare"
rather than a specific one — is authored on 10 lines and blank on 3 (lines 500,
1428, 1442). It is provably inert there: `isUltraRare` short-circuits on the
name before ever reading the cell, and `TIER_PROXY` skips a proxy equal to the
good. It is still reported, because a carve-out with one occupant is as likely to
be the bug as the rule, and "inert today" is exactly what this item is about.
**Those three cells were filled in the sheet and published as PR #163**, so the
warning is clear and the check now reports nothing on the shipped data. Nothing
is left open here.

**Tested, by shape rather than by row.** `scripts/validate-recipes.test.mjs`
(new, wired in as `npm run test:recipes`) copies `public/data`, injects each
defect into the copy, and asserts the severity as well as the message — plus a
third case proving agreement stays silent, without which a check that reported
every token would pass the first two. Removing the check fails 2 of its 4 cases;
that was verified, not assumed. Each case finds its target by asking "whichever
Item is authored on two or more lines" instead of naming a row, so a re-export
cannot turn it into a red publish check; if no row matches the shape it reports
STALE rather than FAIL. `validate-recipes.mjs` gained a `--data` flag for it,
mirroring the other two validators.

---

## 6. A failed auction has no representation, so its row is deleted

**Now:** `Status` is a formula — `IF(closeDate = "", "Open", "Closed")` — so the
column has exactly two reachable values and **`Failed` is not one of them**. All
289 rows read `Closed`, and none has a blank `closeDate`.

An auction that fails to fund is therefore handled by **deleting its
`auctionMetadata` row**. That is current practice and it works, in the sense
that nothing downstream is wrong.

**Why it matters:** three things follow from it, and the third is new.

1. **Auction numbers are permanently burned.** Six are missing across the
   recorded era — 2020 has no 8, 2025 no 18, 25 or 31, 2026 no 3 or 38 — and the
   sequence is legitimately sparse rather than corrupt. This is why
   `auctionOpen.gs` numbers from `max + 1` and never `count + 1`; counting
   would propose 2026's 46, which exists. The gap is the *only* surviving trace
   that an auction happened at all.
2. **Failure-rate data is lost for good.** Which auctioneers' auctions fail, and
   whether `Lightning` fails more often than `Fixed Date`, are questions the
   data cannot answer and never will for auctions already deleted. Nothing on
   the site asks them today, which is exactly why the loss is invisible.
3. **The auction-open scanner cannot tell a failure from a mistake.** Since
   `2026-08-31.3`, `openMergeReview` clears a `promoted <id>` marker whose
   `auctionId` is no longer in `auctionMetadata`, so the review row can be
   approved again. But "promoted, then the row is gone" is *equally* a failed
   auction and deleted test data, and nothing in the script can separate them.
   So it reopens the row, forces the tick off, and asks the operator in a note —
   every time, for ever. A `Failed` state would make that question answerable
   instead of asked.

**One correction to the plan.** `data-pipeline-plan.md`'s Phase 4 follow-on
question says retaining failed rows "would cost nothing visually" because
`Failed` has no dedicated UI and is only ever "not `Closed`". That is not right
as written. `openAuctions()` in `src/lib/data.ts` filters `status === 'Open'`,
and it feeds the live-auction banner on both the Dashboard and the Explorer with
an "opened N days ago" line. A retained failed row keeps a blank `closeDate`, so
`Status` computes `Open`, and the auction would sit on that banner **for ever**
with a counter that climbs. Retaining rows is only free once a third state
exists — which is the point of this item, not an argument against it.

**Done looks like:** a state a failed auction can actually be in, without the
banner adopting it. The two shapes worth weighing:

- **A separate column** — `outcome`, say, holding `Funded` / `Failed` /
  `Cancelled`, left blank for the ordinary case. `Status` keeps its formula and
  its meaning, `openAuctions()` gains an `outcome !== 'Failed'` guard, and the
  row survives with its `openDate`, `auctioneer` and `completionStyle` intact —
  which is all the failure-rate analysis needs.
- **Widening `Status` itself**, which means giving up the formula and typing the
  column by hand. Cheaper in columns and worse in every other way: it removes
  the guarantee that `Status` and `closeDate` agree, and `auctionOpen.gs`'s
  promote step relies on that formula being copied down rather than written
  (see `OPEN_DERIVED_FIELDS`).

Either way it is a **data-model change with a UI consequence**, so it wants
deciding rather than drifting: `validate-prices.mjs` would need the new
vocabulary in its § 7 checks, `publishToSite.gs`'s allow-list would need the
column, and the eight sheet-backed CSVs would gain one field. Deleting the row
stays perfectly serviceable until someone wants to ask a question about
failures — the cost is that by then the answers for past seasons are already
gone.

---

## 7. A player's shorthand for a lot is recorded as a token name — RESOLVED (PRs #164/#165, 2026-09-02)

**Both rows are fixed, and the canonical name itself was wrong in this file.**

**The name.** The Trade 4 denomination is the **`25,000 GP Eldritch Ore Bar`**,
not the `25,000 GP Eldritch Bar` this entry and the `td-domain` skill both said.
Corrected by the maintainer, and corrected in the skill's trade ladder as well,
since a game fact belongs there and the skill is shared with the treasure-pull
project. Row 334 (202349, $250) now carries it.

**Row 431 needed a thread read, and got one.** 202415 (Fred K's 2024 Pre-Order
Auction) sold **six bar lots**, not one bundle:

| Lot | Price | Buyer |
|---|---|---|
| 25K bar x3 | $226 each | Felurian |
| 5K bar x3 | $42, $42, $43 | Lorren, Lorren, Haliax |

Four of those are the order's normal contents — one 25K bar and three 5K bars —
so only the **two extra 25K bars** are context. They are recorded as one row,
`25,000 GP Eldritch Ore Bar`, quantity 2, $452.00, replacing the
`1,000 GP Gold Bar (Bundle)` row entirely. The $405 the old row carried was
never a real lot price.

**The value semantics were checked, not assumed**, because the row is the first
context row above quantity 1 in a while: a **non-withheld** row's value is the
sheet's `Price` as-is (`buildContextItems` returns `refValue`, no multiply), so
qty 2 at $452 counts $452 and matches the metadata's `contextTotal` moving by
exactly +$452. Only **withheld** rows multiply by quantity (`-mean x quantity`).
Authoring $226 there would have HALVED the auction's context, silently.

**One process note, because it is the defect this data set produces most often.**
PR #164 first landed both rows on auction **202413** rather than 202415 — a
pull-down from the cell above in the sheet — which moved $452 onto Flik's
Augmented Standard Auction and took $405 off Fred's. Everything downstream stayed
self-consistent: `contextTotal`, `netCost` and `fundingGap` all recomputed
cleanly on both auctions, so nothing looked wrong. PR #165 corrected it. **No
validator can see this**, and none reasonably could: a context row on the wrong
auction is a well-formed row. Reading the thread is the only check there is, and
here it is decisive — 202413's thread contains no bar lot at all.

---

## 8. Large GP sums are spelled as N x the 1,000 GP bar, not as the token that is that sum

**Updated 2026-09-02** after item 7 closed: the name below is corrected
(`Eldritch Ore Bar`), and the evidence section is no longer a single data point.

**Now:** `transmuteRecipes.csv` contains **no** `5,000 GP Mithral Bar` and no
`25,000 GP Eldritch Ore Bar`. Every large sum is authored as a multiple of the
1,000 GP Gold Bar — 127 lines, at 1x, 3x, 4x, 5x, 10x, 15x, 50x and 100x. The
1,000 GP bar is the only one with an entry in `prices.csv`, so it is the only one
the engine can price. It is **not** the only one ever sold: the larger
denominations sell as auction EXTRAS and land in `contextItems.csv`. Three of the
six sales below are recorded there (row 334, and row 431 at quantity 2); the
other three are 202415's 5K bars, which were that order's normal contents and so
appear only in its forum thread.

**Why it matters:** the totals are right and the shopping list is wrong. Per the
`td-domain` trade ladder, the Mithral Bar (Trade 3) and the Eldritch Ore Bar (Trade 4)
are real tokens, and a 25,000 GP requirement can legitimately be met by any mix of
the two denominations adding up. Today the site tells a player to go and acquire
twenty-five separate 1,000 GP bars when one token is the whole amount.

It also leaves the trade ladder half-populated in the direction that matters for
item 3: Trade 3 currently means Golden Fleece only, and Trade 4 means Wish Ring
only, because the bar half of each rung is not in the data.

**The evidence is no longer thin, and it revises the claim.** Item 7's thread read
turned one data point into six sales across two seasons, and they do NOT trade at
face value — they trade at a small discount to the 1,000 GP bar's average:

| Sale | Season | Per 1,000 GP | That season's 1,000 GP bar |
|---|---|---|---|
| 25K @ $250 (202349) | 2023 | $10.00 | min $10.00, avg $12.59 (n=51) |
| 25K @ $226, x3 (202415) | 2024 | $9.04 | min $5.25, avg $9.87 (n=72) |
| 5K @ $42, $42, $43 (202415) | 2024 | $8.40-$8.60 | same |

Every one lands at or below that season's average and above its minimum. The
original reading — "$250 is exactly 25 x the 2023 minimum, so face value" — was a
coincidence of a season whose minimum happened to be a round $10.00; the 2024
sales, where min and average are far apart, separate the two readings and the
average is the one the prices track. **So a derived rule at exactly 5 x the gold
bar would price a Mithral Bar slightly high**, which matters because the derived
price is what a Shopping List would quote.

**And the interchange is now attested rather than inferred.** 202415's lot
listing says it outright: *"the 5K bars can either be single 5K bars or 5 1K bars
- your choice"*, with the 25K bars called single tokens in the same breath. That
is the auctioneer stating this item's whole premise, and it is recorded in the
`td-domain` skill's trade ladder too.

**Done looks like:** the denominations authored as tokens, with `derivedPrices.csv`
expressing them against the bar that IS priced (`5,000 GP Mithral Bar = 1,000 GP
Gold Bar x 5`). That file is currently idle — its only rule was superseded by the
Monster Trophy rows in PR #159 — so the mechanism is free.

**Three cautions before anyone starts.** A recipe line naming a denomination is a
line naming a TRANSMUTE, since every rung of the trade ladder is craftable, so it
goes through the market-first rule in `src/lib/transmutes.ts`: with no auction
price of its own a Mithral Bar would price at its BUILD cost, which is what you
want, but it also means the Shopping List will section it by pricing route and
give it a vintage. And swapping `5x 1,000 GP Gold Bar` for `1x 5,000 GP Mithral
Bar` is not cost-neutral if the two are ever priced independently — check what it
does to the 43 Legendary recipes and their Wish-Ring-or-15,000-GP path before
changing any of them.

And the third, added 2026-09-02 when item 3 was decided: `sectionCategory` folds
every `Trade 4` row into the Premium table for display, keyed on the **category**
and not on the token, because Wish Ring is Trade 4's only occupant today. An
authored `25,000 GP Eldritch Ore Bar` would inherit that fold and land in Premium
beside it — wrong for a bar that is not an 8K-order exclusive, and silent. Re-key
`CATEGORY_SECTION` on the item name at that point, or reopen item 3.
