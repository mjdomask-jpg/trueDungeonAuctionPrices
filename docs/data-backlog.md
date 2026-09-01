# Data backlog

Known gaps between the domain and what the data represents. None is a bug — the
site computes correctly on the data it has. Each is a place where a real game
concept has no home in the schema yet.

Recorded 2026-08-20, while reconciling the docs with the shared `td-domain`
skill. Game-level definitions live there; this file tracks only what *this
repo's data* is missing.

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

## 2. Golden Fleece has no recipe of its own

**Now:** 99 recipe lines *consume* Golden Fleece. **Zero produce it** — no row in
`transmuteRecipes.csv` has a `Transmute` containing "Fleece".

The real relationship — 10 Monster Trophies transmute into 1 Golden Fleece —
exists in the data only **backwards**, as the `derivedPrices.csv` rule
`Monster Trophy = Golden Fleece / 10, bound=ceiling`.

**Why it matters:** Golden Fleece is itself a transmute, so build-vs-buy applies
to it and cannot currently be computed. The ceiling rule is also justified by
scarcity that is nowhere written down: players commonly hold one Monster Trophy,
but assembling ten is hard, so Fleece/10 is an upper bound on a trophy's worth
rather than a market price.

**Done looks like:** a recipe producing Golden Fleece from 10 Monster Trophies,
with the derived-price rule kept as the fallback and its cycle guard intact.

---

## 3. Trade good rungs 3-5 have no representation

**Now:** `Trade 1`, `Trade 2` and (since 2026-08-29) `Trade 4` are real
categories in `prices.csv` and `tokenGroups.csv` with a group order. `Trade 3`
and `Trade 5` appear in **no CSV at all**.

The rungs exist and are held by real tokens:

| Rung | Token | Category it actually carries |
|---|---|---|
| Trade 3 | Golden Fleece | `Golden Fleece` |
| Trade 4 | Wish Ring | `Trade 4` (group `8k exclusive`) |

**Why it matters:** the trade good ladder runs Trade 1 -> Trade 5. Treasure pulls
can contain higher-tier goods, so a sibling project consuming this catalog needs
the rungs to exist. Today the ladder is inferable only from prose.

**Done looks like:** a tier field that can express all five rungs without
disturbing the existing `Category` axis, which describes how a lot was *sold*.

---

## 4. Wish Ring's dual nature is unreconciled

**Now:** `Trade 4` category, group `8k exclusive`, **288 rows in `prices.csv`**
(so it is auctioned), and **43 recipe lines consume it** (so it behaves as a
trade good). The category moved from `Premium` to `Trade 4` on 2026-08-29 to
match the canonical rung; because a single Trade 4 token is not worth a table of
its own, `sectionCategory` in `src/lib/categories.ts` folds it back into the
Premium section on the Prices page and the Trends year-over-year view. That is a
DISPLAY grouping only — the explorer's chips, filters and sorting still show the
real `Trade 4`.

**Why it matters:** acquisition and function disagree. Wish Ring is a Trade 4
trade good by what it *does*, but obtainable only as a Bonus item in an 8K order.
No field expresses both, and picking one loses the other.

**Done looks like:** a decision on whether tier and acquisition are separate
fields. Related to item 3 — likely resolved together.

---

## 5. `IngredientType` is authored inconsistently for the same token

**Now:** `Charm of Synergy` appears on two recipes in `transmuteRecipes.csv` and
is authored two different ways:

| Row | Recipe | `IngredientType` |
|---|---|---|
| 414 | `2017\|Giln's Redoubt Shield` | `Ultra Rare` |
| 1910 | `2027\|Smith's Charm of Unified Synergy (Set 2)` | *(blank)* |

`tokenMetadata.csv` row 165 says the token's category is `Ultra Rare`, so the
metadata is unambiguous and only the recipe cells disagree.

**Why it matters:** `IngredientType` is not decoration — it selects a pricing
branch. The engine's `isUltraRare` originally read the authored cell alone, so
the same ingredient on two recipes took two different routes through
`leafForGood`: one reached the Ultra Rare rules (in-print check, two-season
pool, D4 clamp) and the other did not.

**It costs nothing today**, which is exactly what makes it worth recording.
`Charm of Synergy` carries its own hand-authored `offAuctionPrices.csv` row at
$140.00, so the direct lookup succeeds on both recipes, `TIER_PROXY` is never
consulted, and the two agree by accident rather than by rule. The day that
off-auction row is removed — or the day a token authored this way has no price
of its own — the two recipes would quietly price the same ingredient
differently.

`isUltraRare` now reads the **resolved** category (`prices.category(...) ||
l.ingredientType`), symmetric with `isTradeGood`, so the engine is correct
whichever way a cell is filled in. That is a guard, not a fix: the data still
says two things about one token.

**Done looks like:** `IngredientType` populated on every line naming a specific
member of an auctioned tier, or a validator rule asserting that a given `Item`
carries one `IngredientType` everywhere it appears. The second is cheap and
would have caught this — `validate-recipes.mjs` already walks every line.

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
