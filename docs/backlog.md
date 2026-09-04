# Backlog

**This is the only backlog.** Every open item, every deferred decision and every
idea deliberately dropped lives here. If you are looking for work, or wondering
whether something has already been decided against, open this file and nothing
else.

Created **2026-09-03** by consolidating six scattered lists, because keeping them
apart meant reading six files to answer "what is left?" — and none of them ever
knew about the others:

| Was in | Now |
|---|---|
| `data-backlog.md` (items 1-8) | `DATA-1` … `DATA-8` below — **same numbers**; that file is now a pointer |
| `shopping-list.md` § *Deferred* / § *Dropped* | `SITE-3`, and § *Dropped* below |
| `transmutes-expansion-plan.md` Phase 8 + § 5 *Later / precision follow-ups* | `SITE-5`, `SITE-6`, `SITE-7` |
| `expansion-plan.md` § 5 foundations + § 6 Phase 5 deferral + § 7 Q5 | `SITE-1`, `SITE-8` |
| `context-layer-design.md` § 9.3 | `SITE-4` |
| `data-pipeline-plan.md` Phase 6 | `PIPE-1` |
| the mobile memory's one open item | `SITE-2` |

Those documents keep their design records, decisions and as-built notes — they
are still the place to understand *why* something is the way it is. What they no
longer carry is a list of pending work. Where a section moved, a one-line pointer
was left in its place.

## How this file works

- **IDs are permanent.** `DATA-n` is the schema and the data it holds, `SITE-n`
  the app, `PIPE-n` the Apps Script pipeline and the tooling around it. An ID is
  never reused and never renumbered — code comments, commits and other docs point
  at them. `DATA-5` is what `data-backlog.md` called "item 5" and always will be.
- **A resolved item keeps its ID and is marked RESOLVED rather than deleted**, so
  the reasoning that closed it survives and a reader who met it elsewhere can
  still find it.
- **Dropped is not deferred.** § *Dropped* holds ideas decided against, with the
  reason, so nobody re-derives them. Reopening one needs a new fact, not a new
  opinion.
- **Add an item here, not in the doc you happen to be editing.** That is the
  whole point of the file.

Last reconciled **2026-09-03**. Everything asserted below about the current
*data* was measured that day, not remembered.

> **A deferral in a plan doc is not evidence the thing is still deferred.** The
> first pass carried `SITE-1` (Open Auctions) forward as open on the strength of
> `expansion-plan.md` saying so — and it had shipped on 2026-08-08, nearly a month
> earlier, banner and all. The plan doc was never updated; the code was the only
> honest source. **Before writing "still open" against anything, grep the app for
> it.** The same pass measured the CSVs and got those right, so the gap was
> specifically between prose and code, which is the direction nothing checks.

---

## Open at a glance

| ID | Item | Blocked on |
|---|---|---|
| **DATA-1** | The 50 GP Idol chase set is only half modeled | nothing — data authoring |
| **DATA-6** | ~~A failed auction has no representation, so its row is deleted~~ | **RESOLVED 2026-09-03** — shipped, workbook updated, five rows restored |
| **DATA-8** | Large GP sums are spelled as N x the 1,000 GP bar, not as the token that is that sum | a decision, then careful authoring |
| **SITE-2** | Transmute row height at 375px | the maintainer's real-phone verdict; **do not act unsolicited** |
| **SITE-3** | Shopping List drawer row names ellipsize | a flex-layout rework |
| **SITE-4** | Transmutes "most-withheld components" callout | appetite — an optional stretch from the context layer |
| **SITE-5** | Third-party prices (trenttokens snapshot, auto-fill, buy link) | re-confirming appetite for the infra |
| **SITE-6** | Non-standard `Expires` dates | data authoring — the engine already reads the column |
| **SITE-7** | Calculator persistence of on-hand counts and overrides | a stable line identity; **not** scope |
| **SITE-8** | Build-time CSV → JSON normalization step | nothing hurts yet |
| **SITE-9** | No React test harness | appetite |
| **SITE-10** | Excel's handling of the exported CSV is unverified | access to Excel |
| **PIPE-1** | Ingest auctioneers' external tracking sheets | sign-in access to those sheets |
| **PIPE-2** | Close handling for alesievauctions.com | the maintainer's sample exports |
| **PIPE-3** | Bag-line grammars for four Condensed auctions | nothing — measured and specified |
| **PIPE-4** | Feasibility verdict: import trade-good quantities from truedungeontokens.com | **a written answer from me** — the maintainer asked and none exists |

---

# DATA — schema and the data it holds

None of these is a bug. The site computes correctly on the data it has; each is a
place where a real game concept has no home in the schema yet. Game-level
definitions live in the shared `td-domain` skill — this section tracks only what
*this repo's data* is missing.

## DATA-1. The 50 GP Idol chase set is only half modeled — OPEN

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

## DATA-2. Golden Fleece has no recipe of its own — RESOLVED (PR #159, 2026-09-01)

**Was:** 99 recipe lines consumed Golden Fleece and none produced it; the real
relationship existed only backwards, as `derivedPrices.csv`'s `Monster Trophy =
Golden Fleece / 10, bound=ceiling`.

**Now:** `transmuteRecipes.csv` carries `2017 | Trade 3 | Golden Fleece | 10 x
Monster Trophy`, `Expires=never` — the first authored value in that column, and
still the only one (see `SITE-6`). `offAuctionPrices.csv` carries Monster Trophy
for 2019-2026, which supersede the derived rule (leaf order is auction ->
off-auction -> derived, written that way for exactly this) and took the `ceiling`
flag off **36** recipes. The derived rule survives as an unreachable fallback.

**Three things worth keeping**, because none is obvious from the resulting data:

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

## DATA-3. The trade rungs live on the `Category` axis — RESOLVED (decision, 2026-09-02)

**Decided by the maintainer: `Category` IS the tier axis, and the Wish Ring's
display fold is the one accepted exception.** No second field is added.

The concern was that `Category` mixes a power ladder (Rare, Relic, Legendary…)
with a trade ladder (Trade 1-5), so a consumer reading it as "tier" gets both.
The maintainer's position is that this is what the column means and the site has
always read it that way; adding a parallel field would put two sources of truth
in the schema for one concept.

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
  `isTradeCategory` (`/^Trade \d+$/`) reading that column to pick a pricing branch
  is correct **by design**, not by luck.
- `sectionCategory`'s `Trade 4 -> Premium` map in `src/lib/categories.ts` is the
  sanctioned exception. It is **display only** — the Prices page and the Trends
  year-over-year view group on the section; the explorer's chips, filters and
  sorting keep the real `Trade 4`.
- No code or data change; the item closed on the decision itself.

**Measured the day it was decided**, because a decision to live with a special
case is only as good as the size of the set it covers: `Trade 3` has one occupant
(Golden Fleece, never sold), `Trade 4` one (Wish Ring), `Trade 5` two (Omni Orb,
Omni Cube, never sold). Wish Ring is the **only** token whose rung and sale
category disagree, in `tokenMetadata.csv` and `prices.csv` alike.

**The trip-wire, and it is a real one.** `CATEGORY_SECTION` keys on the
**category**, not on the token — so it folds *anything* carrying `Trade 4` into
Premium. `DATA-8` proposes authoring the `25,000 GP Eldritch Ore Bar` as a Trade 4
token; the moment that lands, the bar joins the Premium table too, which is wrong
for a token that is not an 8K-order exclusive, and nothing would report it.
Whoever picks up `DATA-8` either re-keys the fold on the item name or reopens this
decision.

---

## DATA-4. Wish Ring's dual nature is unreconciled — RESOLVED (decision, 2026-09-02)

**Decided with `DATA-3`: tier and acquisition are NOT separated into two fields.**
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
rung (`DATA-3`); the Prices page wants the section (`sectionCategory`); nothing
asks the combined question.

**What would reopen it** is `DATA-3`'s trip-wire — a second auctioned token on a
`Trade N` rung — or a UI that has to explain to a player *why* a trade good sits
in the Premium table. Neither exists today.

---

## DATA-5. `IngredientType` is authored inconsistently for the same token — RESOLVED (PR #163, 2026-09-02)

**The occurrence** was `Charm of Synergy`, authored `Ultra Rare` on row 414
(`2017 | Giln's Redoubt Shield`) and left **blank** on row 1910 (`2027 | Smith's
Charm of Unified Synergy (Set 2)`). It cost nothing — the token has a
hand-authored off-auction price of $140.00, so both lines priced identically and
neither ever reached the tier — but it would have started costing something the
day that off-auction row went away.

**The data half had already fixed itself**, which the entry did not know: PR #159
filled that cell while modelling the trade ladder, and the reconciliation that
rewrote the entry read the table from the entry rather than from the CSV. Same
lesson as the `verify-claims-against-project-data` memory, applied to a doc's own
prose.

**Closed the cheap way instead — a validator rule.**
`scripts/validate-recipes.mjs` now asserts that a given `Item` carries one
`IngredientType` everywhere it appears. `IngredientType` is a property of the
TOKEN, not of the recipe consuming it, so the two ways lines can disagree are not
the same kind of problem:

| Shape | Severity | Why |
|---|---|---|
| One Item, two different non-blank values | **ERROR** (fails the run) | The data states two things about one token. No amount of unfinished authoring produces this — only a typo or a real disagreement |
| One Item, authored on some lines and blank on others | **WARN** (never fails) | Authoring in progress. The engine already survives it: `isUltraRare` and `isTradeGood` read the resolved category (`prices.category(...) \|\| l.ingredientType`), so a blank cell falls back to `tokenMetadata` |

The WARN is the one that matters, because it is the shape the defect took. It is
**deliberately not an error**: authoring an optional column must never turn a
passing export into a failing one. An ERROR here would sit on the publish PR and
look exactly like the publish being broken — the failure mode the
`publish-check-blocks-publishing` memory has now recorded four times.

**One live occurrence was reported rather than carved out.** The Item literally
named `Ultra Rare` — the generic tier slot, since auctions sell "an Ultra Rare"
rather than a specific one — was authored on 10 lines and blank on 3 (lines 500,
1428, 1442), and provably inert there. It was still reported, because **a
carve-out with one occupant is as likely to be the bug as the rule**. Those three
cells were filled and published as PR #163, so the check now reports nothing on
the shipped data.

**Tested by shape rather than by row.** `scripts/validate-recipes.test.mjs`
(`npm run test:recipes`) copies `public/data`, injects each defect, and asserts
the severity as well as the message — plus a third case proving agreement stays
silent, without which a check that reported every token would pass the first two.
Each case finds its target by asking "whichever Item is authored on two or more
lines" instead of naming a row, so a re-export cannot turn it into a red publish
check; if no row matches the shape it reports STALE rather than FAIL.

---

## DATA-6. A failed auction has no representation, so its row is deleted — RESOLVED (PRs #177/#178, 2026-09-03)

**Shape decided (2026-09-03): an `outcome` column that feeds the `Status`
formula.** `Status` stays derived; it just reads one more input first:

```
=IF(outcome <> "", outcome, IF(closeDate = "", "Open", "Closed"))
```

`outcome` is blank on an ordinary auction and `Failed` on one that did not fund.
**Done end to end:** the repo side merged as #177, and #178 carried the workbook
change — the column, the formula, the dropdown, and the five deleted rows
restored with 202518's thirteen withheld context rows. 289 auctions became 294.
The operator's record is in `updating-the-data.md` § *Recording a failed
auction*.

### Why this shape, and where the old entry was wrong

This entry recommended a standalone `outcome` column with `Status` left alone,
and dismissed "widening `Status`" as giving up the formula. Those are not the
only two options, and the third is better than both: an **input** column that
`Status` computes from is not the same thing as typing `Status` by hand. It
keeps every guarantee the formula provides — `Status` and `closeDate` cannot
drift apart, and `auctionOpen.gs`'s promote step can still copy the column down
rather than write it (`OPEN_DERIVED_FIELDS`).

**And the entry's "one correction to the plan" was itself only true of the shape
it recommended.** It said the plan was wrong to claim retaining failed rows
"would cost nothing visually", because `openAuctions()` filters `status ===
'Open'` and a retained row with a blank `closeDate` computes `Open` — so it
would sit on the live-auction banner for ever. That is exactly right *if*
`Status` keeps only two values. Where `Status` itself says `Failed`, it does
not arise: every consumer of `status` in the app tests for exactly `Closed`
(`closedOnly`, `seasonRows`, `explorerOptions`, `buildContextItems`,
`exploreAuctions`) or exactly `Open` (`openAuctions`), so a third value is
skipped by both. **The site needed no change at all.** The plan was right; the
correction applied to one shape and was written as though it applied to the
question.

### What the failure actually costs, re-measured

The three consequences the old entry listed were sound, and one of them is now
partly recoverable:

1. **Auction numbers are permanently burned.** Still true as a rule, and still
   why `auctionOpen.gs` numbers from `max + 1` rather than `count + 1`. But the
   burned numbers are not all unrecoverable — see below.
2. **Failure-rate data is lost for good.** *Not for good.* The five deleted rows
   are in this repository's history, at `b4196af^`, complete with `openDate`,
   `closeDate`, `daysToClose`, `auctioneer`, `completionStyle` and
   `targetFunding` — which is everything the failure-rate questions need. So is
   `202518`'s set of thirteen withheld `contextItems` rows. A restore is written
   out in `updating-the-data.md`.
3. **The auction-open scanner cannot tell a failure from a mistake.** Improved,
   not solved, and deliberately so. A failure now keeps its row, so "promoted,
   then gone" *should* mean deleted test data — but every auction that failed
   before the column existed was deleted under the old habit, and the habit
   outlives the column. `openMergeReview` still clears the marker, still forces
   the tick off, and now says which reading is the likely one.

`20208` is not one of the five. Season 2020's missing 8 was an all-`n/a`
placeholder row (`Hayward 8`) removed by the 2019–20 backfill — no failure was
recorded there and there is nothing to restore.

### What shipped

| Where | What |
|---|---|
| `validate-prices.mjs` § 7 | `Status` accepts `Failed`; `outcome` joins the fenced columns at one value. `Cancelled` is deliberately not pre-allowed — a second outcome should be a decision, not a paste |
| `validate-prices.mjs` § 4 | New: `outcome` and `Status` must agree. In the workbook they cannot disagree, so a disagreement in the export means the formula was pasted over — the same failure that once froze `augmentated` at `No` |
| `validate-prices.mjs` § 5b | A `Failed` row is exempt from "every auction carries price rows" (it sold nothing). The reverse is a note: a `Failed` auction that HAS rows is a wrong outcome, or rows on the wrong auction |
| `validate-prices.mjs` § 6 | Both `auctionStyle` agreement loops skip `Failed`. Without this a failed **Onyx** auction is a hard error on a correct row, and it would block every publish |
| `validate-prices.test.mjs` | § 5b had **no case at all** before this — the check the file calls the largest silent data loss it can catch had never been fired. It now has one from each side, plus three for `outcome`. 41 cases, all passing |
| `hardenSheet.gs` | An `outcome` dropdown, `grows: false`, marked `pending` so a column that does not exist yet is a note rather than an alarm. Its test pins both halves: quiet while absent, fence the moment it appears |
| `auctionOpen.gs` | The stale-marker note now says which reading is likely |
| `auction-open.test.mjs` | `eq(placed, 276)` de-pinned. It was a tally over the shipped CSV, the restore moves it to 294, and a tally in a test is a red check on the **publish** PR |
| `data.ts`, `context.ts` | Comments only — they described five `Failed` rows that had not existed since they were deleted |

**Dry-run.** The full workbook change — new column, five restored rows, thirteen
context rows — was applied to `public/data` and the whole gate run against it:
`npm run validate` 0 errors and the same 7 standing warnings, `npm run build`
clean, all ten test suites passing. § 5b reports `5 Failed auction(s) correctly
carry none`.

### What the restore then broke, and the lesson in it

Nothing about the data. **Nine assertions in `auction-open.test.mjs` and one in
`harden-sheet.test.mjs`**, all of them on the publish PR, where a red check
reads as the publish being broken.

The nine were corpus tallies — `recorded topic ids` at 178, `distinct recorded
auctioneers` at 38, `a year in the recorded name is right 65 times`, the triage
counts. Five new rows moved every one. #177 had de-pinned exactly one of these
(`eq(placed, 276)`), found by grepping for the numbers *that* change described.
**Fixing the instance is not fixing the class**: the file held eight more, keyed
to numbers nobody thought to grep for. All are now pinned to the invariant with
the count kept in the message.

One was not a tally, and it is the more interesting failure. `count + 1 would
collide with a recorded auction` demonstrated why numbering uses `max + 1` —
using 2026, whose gaps at 3 and 38 were the deleted failures. **Restoring them
destroyed the demonstration**: 2026's numbering is dense now, so `count + 1` is
`max + 1` and the example stopped being one. The rule is unchanged and still
right; only the corpus stopped illustrating it. It is now pinned against a
constructed season that cannot stop illustrating it, with the corpus search kept
as documentation — which reports exactly one season, 2020, whose gap at 8 was
never a failure at all.

And the tenth was this repo's own check working: `harden-sheet.test.mjs`
asserted that a `pending` column which has quietly appeared means the flag has
outlived its purpose. The column appeared, so it failed, and dropping the flag
was the fix. It was hidden behind the auction-open failure because the suites
are chained — **read past the first failing suite**.

### What is left

Nothing.

---

## DATA-7. A player's shorthand for a lot is recorded as a token name — RESOLVED (PRs #164/#165, 2026-09-02)

**Both rows are fixed, and the canonical name itself was wrong.**

**The name.** The Trade 4 denomination is the **`25,000 GP Eldritch Ore Bar`**,
not the `25,000 GP Eldritch Bar` this entry and the `td-domain` skill both said.
Corrected by the maintainer, and corrected in the skill's trade ladder as well,
since a game fact belongs there and the skill is shared with the treasure-pull
project. Row 334 (202349, $250) now carries it.

**Row 431 needed a thread read, and got one.** 202415 (Fred K's 2024 Pre-Order
Auction) sold **six bar lots**, not one bundle: 25K bar x3 at $226 each
(Felurian), and 5K bar x3 at $42, $42, $43 (Lorren, Lorren, Haliax). Four of those
are the order's normal contents — one 25K bar and three 5K bars — so only the
**two extra 25K bars** are context. They are recorded as one row,
`25,000 GP Eldritch Ore Bar`, quantity 2, $452.00, replacing the
`1,000 GP Gold Bar (Bundle)` row entirely. The $405 the old row carried was never
a real lot price.

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
self-consistent: `contextTotal`, `netCost` and `fundingGap` all recomputed cleanly
on both auctions, so nothing looked wrong. PR #165 corrected it. **No validator
can see this**, and none reasonably could: a context row on the wrong auction is a
well-formed row. Reading the thread is the only check there is, and here it is
decisive — 202413's thread contains no bar lot at all.

---

## DATA-8. Large GP sums are spelled as N x the 1,000 GP bar, not as the token that is that sum — OPEN

**Now:** `transmuteRecipes.csv` contains **no** `5,000 GP Mithral Bar` and no
`25,000 GP Eldritch Ore Bar`. Every large sum is authored as a multiple of the
1,000 GP Gold Bar — 127 lines, at 1x, 3x, 4x, 5x, 10x, 15x, 50x and 100x. The
1,000 GP bar is the only one with an entry in `prices.csv`, so it is the only one
the engine can price. It is **not** the only one ever sold: the larger
denominations sell as auction EXTRAS and land in `contextItems.csv`. Three of the
six sales below are recorded there (row 334, and row 431 at quantity 2); the other
three are 202415's 5K bars, which were that order's normal contents and so appear
only in its forum thread.

**Why it matters:** the totals are right and the shopping list is wrong. Per the
`td-domain` trade ladder, the Mithral Bar (Trade 3) and the Eldritch Ore Bar
(Trade 4) are real tokens, and a 25,000 GP requirement can legitimately be met by
any mix of the two denominations adding up. Today the site tells a player to go
and acquire twenty-five separate 1,000 GP bars when one token is the whole amount.

It also leaves the trade ladder half-populated in the direction `DATA-3` cared
about: Trade 3 currently means Golden Fleece only, and Trade 4 means Wish Ring
only, because the bar half of each rung is not in the data.

**The evidence revises the claim.** `DATA-7`'s thread read turned one data point
into six sales across two seasons, and they do NOT trade at face value — they
trade at a small discount to the 1,000 GP bar's average:

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

**And the interchange is attested rather than inferred.** 202415's lot listing
says it outright: *"the 5K bars can either be single 5K bars or 5 1K bars - your
choice"*, with the 25K bars called single tokens in the same breath. That is the
auctioneer stating this item's whole premise, and it is recorded in the
`td-domain` skill's trade ladder too.

**Done looks like:** the denominations authored as tokens, with `derivedPrices.csv`
expressing them against the bar that IS priced (`5,000 GP Mithral Bar = 1,000 GP
Gold Bar x 5`). That file is currently idle — its only rule was superseded by the
Monster Trophy rows in PR #159 — so the mechanism is free.

**Three cautions before anyone starts.**

1. A recipe line naming a denomination is a line naming a TRANSMUTE, since every
   rung of the trade ladder is craftable, so it goes through the market-first rule
   in `src/lib/transmutes.ts`: with no auction price of its own a Mithral Bar
   would price at its BUILD cost, which is what you want, but it also means the
   Shopping List will section it by pricing route and give it a vintage.
2. Swapping `5x 1,000 GP Gold Bar` for `1x 5,000 GP Mithral Bar` is not
   cost-neutral if the two are ever priced independently — check what it does to
   the 43 Legendary recipes and their Wish-Ring-or-15,000-GP path before changing
   any of them.
3. `sectionCategory` folds every `Trade 4` row into the Premium table for display,
   keyed on the **category** and not on the token, because Wish Ring is Trade 4's
   only occupant today. An authored `25,000 GP Eldritch Ore Bar` would inherit
   that fold and land in Premium beside it — wrong for a bar that is not an
   8K-order exclusive, and silent. Re-key `CATEGORY_SECTION` on the item name at
   that point, or reopen `DATA-3`.

---

# SITE — the app

## SITE-1. Open Auctions — RESOLVED (`f5cb77a`, v1.4, 2026-08-08)

**It shipped, and it shipped nearly a month before this backlog was written.**
The consolidation carried forward `expansion-plan.md`'s 2026-07-22 deferral
without checking whether the code had moved on, and it had. Corrected 2026-09-03
on the maintainer's word, then verified against the source.

**What was deferred** (§ 6 Phase 5, § 7 Q5): the view had nothing to render,
because `auctionMetadata.csv` held no `Open` rows.

**What is built**, as two halves with a link between them:

- **The Prices (home) banner** — `components/OpenAuctionsBanner.tsx`, rendered at
  the top of `DashboardPage`. It shows **only when at least one auction is open**;
  a permanent "nothing open" bar on the busiest page would be nag. Count, the
  linked auction names inline up to three, then `see all open →`.
- **The Auction Data section** — an `Open auctions` strip at the top of
  `ExplorerPage`, **always rendered**, with the quiet "nothing open" line the
  banner deliberately does not carry. Collapsed by default so the historical data
  leads the page; each `OpenAuctionCard` expands to auctioneer, opened date +
  "N days ago", funding goal, augmented, style and completion.
- **The link between them** points at `/explorer/grouped#open` — the canonical
  view path, not the bare `/explorer`, because that route's redirect would strip
  the fragment. `ExplorerPage` snapshots the intent at mount and consumes it once
  the data arrives, then expands and scrolls the strip into view.

**Two decisions in there worth not re-deriving.** Both lists read the
**unfiltered** `meta`, so the page's season, category, search and the shared
source/type filters can never hide a live auction — it is a standalone "what is
live right now" list, not part of the closed-sales explorer under it. And the
banner's asymmetry with the section (hidden when empty vs always shown) is
deliberate, not an oversight.

**It was proved against a real auction, not a fixture.** `202647`, *Alesiev's
FINAL 2026 Token Auction - With Augments!*, opened **2026-08-07** — the banner
shipped the next day — and closed **2026-08-15**, 8 days later. So the feature
ran live, in front of users, for essentially that auction's whole run, and then
correctly disappeared when the row went to `Closed`. The metadata has read
289 of 289 `Closed` ever since, which is why the empty path is the one anybody
looking at the site today will see.

**The `DATA-6` interaction was the live risk, and the shape chosen removes it.**
The danger was real: with `Status` at two values, a failed auction retained with
a blank `closeDate` computes `Open` and sits on this banner **for ever**, with a
"days ago" counter that climbs. `DATA-6` resolved to an `outcome` column that
feeds the formula instead, so a failed row computes `Failed` — and
`openAuctions()` filters `status === 'Open'` exactly, so it is skipped with no
guard and no change to this component. Worth keeping in mind rather than
forgetting: the risk lived in the *shape*, and a different shape would have
brought it straight back.

---

## SITE-2. Transmute row height at 375px — OPEN, do not act unsolicited

**Awaiting the maintainer's real-phone verdict.** Letting `.tx-rface` wrap so
clipped token names show roughly doubled collapsed row height at 375px (Relic
40 -> 65px, paired Legendary 52 -> ~97px). That was flagged at the time as the
explicit trade for showing the name at all.

**Levers if it reads too long on a real phone:** Build + Upgrade side by side on
one line (offered and declined at mockup stage), drop "upgrades from" into the
expanded view, or tighten `row-gap` / padding.

The standing instruction for mobile work applies: audit and report, do not fix
without approval, and lead with a before/after mockup at true device width.

---

## SITE-3. Shopping List drawer row names ellipsize — OPEN

A picked row in the drawer truncates long names (`Val's +4 Ke…`) because the
stepper takes ~180px. Abbreviating the tier chip on phones bought some of it back,
not all; fixing the rest means reworking the row's flex layout.

---

## SITE-4. "Most-withheld components" callout — OPEN (optional stretch)

**A "withheld" item is one the auctioneer pulled from the auction and never
sold** — kept for themselves. It never has a real price, so the site estimates one
from the same-season sales in the five auctions before it, flags every such number
as an estimate, and keeps it out of headline stats by default.

The proposal, from `context-layer-design.md` § 5.1 and deferred at § 9.3:
Phase 1 noticed that **what auctioneers withhold is overwhelmingly transmute
ingredients**, so a small callout would name which ones. It is a *Transmutes*
observation but it was proposed to live **on the Analytics page** — Transmutes was
explicitly out of scope for the whole context layer and stayed untouched. Anyone
picking this up should decide the home deliberately rather than inherit either
reading.

**Confirmed not built (2026-09-03)** — no withheld-aware code exists under the
Transmutes pages, and `AuctionCard` and `ContextAnalytics` are the only consumers
of withheld data anywhere.

**The premise holds. Measured 2026-09-03: 84 withheld rows over 27 auctions, 32
distinct items.** But three things a design has to settle turned up in the
measuring, and none of them is in the original proposal.

**1. "Most-withheld" has two answers and they barely overlap.** Rank by *rows*
(how many auctions withheld it) and you get the chain components the design named:
Patron Pin 12, Ring of the 3rd Circle 11, then Marks of the Tenets, Path to
Enlightenment fragments, and the other Rings. Rank by *quantity* and trade goods
bury them — Philosopher's Stone 278, Mystic Silk 242, Darkwood Plank 229 — because
two auctions (2022 and 2025) withheld big trade-good lots. There is a third
ranking, by estimated value, which nobody has computed. Pick one and say which it
is on screen, or the callout means whatever the reader assumes.

**2. The obvious join does not work.** `contextItems.csv` records a withheld item
by its **specific name** (`Ring of the 3rd Circle`). The recipe line that consumes
it is authored as a **generic tier slot** — `Item = 1k Bonus`, `ItemYear = -2`,
`ResolvedYear = 2024` — with the specific name only in **`Display Name`**, a label
rather than a key. So of the 32 withheld items, **14 match the recipe `Item`
column and 26 match `Display Name`**. `Display Name` is populated on all 1,986
recipe lines, so joining on it is possible; it is just not a key, and nothing
guarantees it stays unique or stable. The honest alternative is resolving tier +
`ResolvedYear` to a token name, which is work the engine does not do today.

**3. The headline would be a non-ingredient.** Six withheld items appear nowhere
in `transmuteRecipes.csv` — **Patron Pin** (the single most-withheld item by rows,
12 auctions across 6 seasons), `4th Tooth of Cavadar`, `Adventurers' Guild
Button`, `Lenses of Hunting`, `Amulet of Magnifying`, `Treasure Chip (each)`. A
callout titled "components" that leads with a Patron Pin is either mis-titled or
has to filter it out and explain why.

**Blocked on appetite, not on anything technical** — but the sequencing note is
that `DATA-8` would change item 2's arithmetic, since authoring the GP
denominations as tokens moves names between the two columns.

---

## SITE-5. Third-party prices — OPEN (deferred, was "Phase 8")

`transmutes-expansion-plan.md` § 2.3 + § 1c: a trenttokens build-time snapshot,
auto-fill of the lowest third-party price, and a buy link. **Do this last, and
re-confirm appetite for the infra before starting** — it is the only item on the
list that adds a scraping dependency and an architectural risk to a site whose
whole design is "static, no backend".

The manual secondary-price box shipped instead, which was the 2026-08-10 decision
(§ 9 Q3): manual entry only for now.

> Related but distinct: `PIPE-4` is about reading a player's *own collection* off
> a third-party site, not prices. Both touch truedungeontokens.com; neither
> depends on the other.

---

## SITE-6. Non-standard `Expires` dates — OPEN (data authoring)

Two known tokens expire off the standard rule — **Ioun Stone Mystic Orb** (a March
expiry) and **Mark of Enlightenment** (a 1-year window). The engine has read the
`Expires` column since Phase 4, so authoring them is all that is needed; verify
each against the data as it goes in.

**Measured 2026-09-03: `transmuteRecipes.csv` has exactly one non-blank `Expires`
value in the whole file** — the `never` on the Golden Fleece line from `DATA-2`.
Both tokens above appear across 10 recipe lines with the column blank, so they are
still running on the standard rule.

---

## SITE-7. Calculator persistence of on-hand counts and overrides — OPEN, and now on a reason

The Build Calculator's selected **recipe** persists (`lib/calcStorage.ts`,
`td-calc-v1`, PR #146). The **on-hand quantities and price overrides do not**, and
since 2026-08-31 that is a correctness decision rather than a scope one:

> They are keyed by **line index**, so restoring them across a
> `transmuteRecipes.csv` change would put a saved count against a different
> ingredient — silently, and in the reader's favour.

**Done looks like** a stable per-line identity that survives an edit to the recipe
file (item name + resolved year is the obvious candidate), after which the
existing storage layer can carry the counts. The Shopping List already persists
its own on-hand counts because its rows are keyed by item, not by index — see
`shopping-list.md` § *Saving* for the contrast, which is the clearest statement of
why this is not a copy-paste job.

---

## SITE-8. Build-time CSV → JSON normalization step — OPEN (nothing hurts yet)

`expansion-plan.md` § 5 proposes a small build step that reads the source CSVs and
emits clean, typed JSON, doing the normalization once instead of on every load.
The source of truth stays CSV, because the workbook publishes CSVs and a
spreadsheet is what the maintainer edits.

Deferred deliberately: runtime fetch + parse through the provider is fine at the
current data size, and the seam it would protect — `src/lib/data.ts` staying pure
and central — is already protected by convention. **Revisit when compute or joins
grow**, which is a measurement, not a feeling: the trigger is a load or a
recompute somebody notices.

---

## SITE-9. No React test harness — OPEN

Everything pure is under test — ten suites, and the counts move, so run
`npm test` rather than quoting a number. **Component behaviour is verified in the
browser by hand**, every time, and nothing catches a regression in it.

This is a real gap and it has never yet bitten, which is why it stays here rather
than in § *Dropped*. Note the machine's constraint before planning it: the Browser
pane cannot screenshot localhost and never delivers `IntersectionObserver`
callbacks, so a harness would need to be DOM-assertion based (or run under
headless Edge) to be worth anything.

---

## SITE-10. Excel's handling of the exported CSV is unverified — OPEN

The Shopping List's formula guard was designed against a measured fact: **33 item
names start with `+`**, and none with `-`, `=` or `@`. The **Copy as TSV** path
carries an apostrophe prefix, which Excel consumes correctly on paste — that half
is confirmed working by the maintainer.

The **file** half is not. `csvFile` ships clean quoted values with a BOM; Google
Sheets and LibreOffice consume it silently, but **there is no Excel on this
machine**, so nobody has opened the downloaded `.csv` in the application the guard
exists for. It is one line to fix if it misbehaves. See `shopping-list.md`
§ *Getting it out*.

---

# PIPE — the pipeline

## PIPE-1. Ingest auctioneers' external tracking sheets — OPEN (was "Phase 6")

alesiev's 202647 posts **no prices in the thread at all** — just a link to a Google
Sheet. That is a growing pattern and far cleaner to parse than prose, so it is the
natural next step after the thread reader.

**Blocked on access:** the sheet required sign-in when tried anonymously. Apps
Script runs as the maintainer, so this may be free or may be impossible depending
on how those sheets are shared — establish that before designing anything.

> The other half of the original Phase 6 — backfilling the 2023 Trent auctions
> from single values to min/max pairs — is **DONE**, published as PR #169
> (2026-09-02). All 15 season-2023 Trent auctions, 334 rows out and 616 in.

---

## PIPE-2. Close handling for alesievauctions.com — OPEN

Phase 4 watches the site and proposes new auctions from its server-rendered cards.
**Reading a close from it is not built** — the maintainer is sending sample
exports first, and nothing should be designed against a guessed shape.

---

## PIPE-3. Bag-line grammars for four Condensed auctions — OPEN, measured and specified

`validate-prices.mjs` § 6 notes three Condensed auctions missing their bag rows.
Separately, **four of the eight Condensed auctions yield no bag rows from the
thread reader because their line grammars are not supported**:

- **20182** is the sharpest case — its two bag lines differ by one character.
  `Bag of 240 ... #1-8 - $77 each` parses; `Bag of 120 ... #1-8 $70 each` does not,
  because only the first has a dash before the price.
- **20184** uses a colon: `... #1 : $55 Thunderbird`.

Both are grammar additions to `forumThread.gs`. Read
`forum-thread-parser-traps.md` first — the standing rule there is **write a rule
looser than the one example you have**, and a bag never divides, because a bag's
name states its contents (`120x Random Rare` is one bag of 120).

---

## PIPE-4. Feasibility verdict: import trade-good quantities from truedungeontokens.com — OPEN, and the ball is mine

The maintainer wrote `feasibility-check-import-trade-goods.md` (2026-08-31) asking
whether a player's own collection could be read off truedungeontokens.com and
applied to the Build Calculator and Shopping List automatically, so they do not
maintain the list in two places. It sets out the site, the login, the filtered
request and a sample response, and asks explicitly:

> "Push back aggressively here. I need an honest assessment of the feasibility."
> … "Do not start to code a solution."

**No answer has been written.** That is the open item — a verdict, not a build.
The obvious things it has to weigh: cross-authentication from a static
GitHub-Pages site with no backend and no place to put a secret; CORS on a request
the browser makes to another origin; mapping that site's token names onto ours
(the response distinguishes 10x lots **by colour** — brown 1x, tan 10x — while GP
bar multiples are all brown and carry the multiplier in the name); and what
happens to a player's saved on-hand counts when the import disagrees with them.

---

# Dropped

Not pending. Decided against, with the reason, so nobody re-derives them.
Reopening one needs a new fact.

| | Why |
|---|---|
| **XLSX export** (2026-09-02) | The one thing it buys over the CSV is a live `Total − On hand` formula, which is seconds of typing for the reader. Costs a ~400KB dependency or a hand-rolled zip writer — a poor trade against a build the whole site keeps small on purpose. Reopen only if something turns up that a CSV genuinely cannot express: multiple sheets, or formatting the file has to carry |
| **Share links for a Shopping List** | A twenty-recipe plan with per-row counts makes a punishing URL |
| **Server-side save codes** | Impossible, not unbuilt: static hosting on GitHub Pages has no write path, and a repo token in client JS would be public |
| **A `GoodType: token \| category` recipe column** | "Any UR tier token" prices identically to a named UR over a one-token pool, so the two phrasings produce byte-identical rows. Reopen **only if the Onyx set is ever declared substitutable** — at which point the recipes must be re-authored to say which lines were "any UR" |
| **A per-season `Expires` override table** | The clamp rule covers every known case. Add one when a case appears that it does not |
| **Coarse two-season pooling for active windows** | Dropped 2026-08-11 for exact date-windowed pricing. The 2025-2026 data shows a sharp post-Dec-1 spike for Oil of Enchantment and Elven Bismuth that pooling would fold into the cost and overstate. Accuracy was the point of the phase |
| **`AltItem` / `AltQuantity` data columns for substitution** | D6, 2026-08-13: one substitution engine in code config, holding both the Omni rules and Wish Ring ⇄ 15,000 GP. There is no live Wish-Ring-only recipe, so the columns would mean authoring 43 rows to preserve today's behaviour. A per-line `NoSubstitute` stays a **documented seam**, to be added when a real exception appears |
| **Automatic normalization of apostrophes in item names** | `Thor’' Mug of Melee` held a curly one AND a straight one; folding it mechanically gives `Thor''`. `validate-prices.mjs` § 8 errors on a curly apostrophe instead, and near-miss pairs are notes that are never merged automatically — `+1 Turkey Leg` and `+1 Turkey Leg of Smiting` are different tokens |

---

# Where the reasoning still lives

This file is the list. These are still the places to understand a thing:

| For | Read |
|---|---|
| Why the data looks the way it does | `domain-context.md`, and the `td-domain` skill for game facts |
| Data shapes and derivations | `data-and-transformations.md` |
| The pipeline's eight phases and their as-built notes | `../../data-pipeline-plan.md` |
| The Build Calculator's decision record (D1-D11) | `transmutes-expansion-plan.md` |
| The Shopping List's build, step by step | `shopping-list.md`, `shopping-list-handoff.md` |
| Site-wide UI rules | `ui-conventions.md` |
| How the thread reader fails | the `forum-thread-parser-traps` memory |
