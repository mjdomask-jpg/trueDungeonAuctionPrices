# Data backlog

Known gaps between the domain and what the data represents. None is a bug — the
site computes correctly on the data it has. Each is a place where a real game
concept has no home in the schema yet.

Recorded 2026-08-20, while reconciling the docs with the shared `td-domain`
skill. Game-level definitions live there; this file tracks only what *this
repo's data* is missing.

Last reconciled **2026-09-02**, after PR #159 modelled the trade good ladder.
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

## 3. The trade rungs live on the `Category` axis, which is not a tier field

**Reframed 2026-09-02.** The original entry said Trade 3 and Trade 5 "appear in no
CSV at all" and asked for a tier field. Half of that is now done and the other
half was decided the opposite way, so the item is worth restating rather than
closing.

**Now:** all five rungs exist in the data.

| Rung | Tokens | Where it is recorded |
|---|---|---|
| Trade 1 | the eight | `prices.csv`, `tokenGroups.csv`, `tokenMetadata.csv` |
| Trade 2 | the four | same |
| Trade 3 | Golden Fleece | `tokenMetadata.csv`, `offAuctionPrices.csv`, recipe `Level` |
| Trade 4 | Wish Ring | `prices.csv`, `tokenGroups.csv`, `tokenMetadata.csv` |
| Trade 5 | Omni Orb, Omni Cube | `tokenMetadata.csv`, recipe `Level` |

**But they were put ON the `Category` axis, not beside it.** The rung is the value
of `tokenMetadata.Category` and of the recipe's `Level`. So the two axes the
original entry wanted kept apart — the rung a token occupies, and how a lot was
*sold* — are now the same column.

**Why that is mostly fine, and where it is not.** It collides only for a token
that is BOTH on the trade ladder and auctioned. There are exactly two such cases:
Trade 1/2, where the two axes happen to agree, and the **Wish Ring**, where they
do not — which is item 4, and which already needs `sectionCategory` to fold it
back into Premium for display. Trade 3 and Trade 5 are never sold, so nothing
about them is a sale category and no collision is possible.

**It is also load-bearing now, in a way it was not when this was written.**
`isTradeCategory` (`/^Trade \d+$/`) reads that same column to decide a PRICING
branch — see the market-first rule in `src/lib/transmutes.ts`. A separate tier
field would mean deciding which of the two the engine reads, and getting it wrong
is silent: an Omni line that stopped being seen as a trade good would still price
correctly, because it has no market price either way.

**Done looks like:** a decision, not necessarily a change. Either the `Category`
column is accepted as the tier axis and the Wish Ring's display fold is accepted
as the one exception, or a separate field is added — in which case
`isTradeCategory`, the Shopping List's `mergesAsTradeGood`, `validate-prices.mjs`
S 7's vocabulary and `publishToSite.gs`'s allow-list all have to name which axis
they mean. Related to item 4; still likely resolved together.

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

**Updated 2026-09-02.** The GAME fact is no longer open: the `td-domain` skill's
trade ladder now states that Trade 4 is *either* an upgraded bar (25,000 GP
Eldritch Bar) *or* the Wish Ring, and that the Wish Ring is the one rung of the
ladder genuinely sold at auction. So its rung is settled and only the SCHEMA
question survives — this item is now narrower than when it was written.

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

---

## 7. A player's shorthand for a lot is recorded as a token name

**Now:** `contextItems.csv` carries two `Item` values that are not tokens. They
are how an auctioneer described a lot in a forum post, carried straight through
the import.

| Row | `Item` | Auction | Qty | Price |
|---|---|---|---|---|
| 334 | `25,000 GP Reserve Bar` | 202349 | 1 | $250.00 |
| 431 | `1,000 GP Gold Bar (Bundle)` | 202415 | 1 | $405.00 |

The canonical Trade 4 token is the **`25,000 GP Eldritch Bar`** (see the
`td-domain` skill's trade ladder). *Reserve Bar* is a player's shorthand for it.
`(Bundle)` is not part of any token's name either — it says the lot held several
bars, which is a property of the LOT, not of the token.

Both prices are consistent with that reading. $250 is exactly 25 x the 2023 gold
bar minimum of $10.00, and $405 sits between 41 and 77 bars at 2024's $9.87
average — a bundle, priced by its contents.

**Why it matters:** no check can see this, and that is the point of recording it.

- `validate-prices.mjs` § 8 catches names differing by punctuation or a trailing
  plural. `25,000 GP Reserve Bar` differs from every real token by whole words,
  so it passes cleanly.
- § 8 cannot fall back to "is this a known token" either: `contextItems.Item` is
  deliberately free text, because an augment can be any token ever printed. An
  unmatched name is the NORMAL case there, so unmatched cannot be an error.
- So a lot description entering the item vocabulary is invisible, and each one
  splits a token's history: any future `25,000 GP Eldritch Bar` row starts a
  second series rather than continuing this one.

This is the same class as the near-miss pairs § 8 already reports, one step
further out — and unlike those, it is **not** ambiguous. `+1 Turkey Leg` and
`+1 Turkey Leg of Smiting` are two tokens and must never be merged; these two
rows are one token under a nickname and a lot count under another.

**Done looks like:** row 334 renamed to `25,000 GP Eldritch Bar`. Row 431 needs
a decision first, because renaming it alone loses information — the price is for
a bundle whose size the name no longer states. Either recover the count from the
202415 thread and set `quantity` accordingly, or leave the row and record why.

Pairs with **item 8**, which is the same subject one level up.

---

## 8. Large GP sums are spelled as N x the 1,000 GP bar, not as the token that is that sum

**Now:** `transmuteRecipes.csv` contains **no** `5,000 GP Mithral Bar` and no
`25,000 GP Eldritch Bar`. Every large sum is authored as a multiple of the
1,000 GP Gold Bar — 127 lines, at 1x, 3x, 4x, 5x, 10x, 15x, 50x and 100x. The
1,000 GP bar is also the only bar ever sold at auction, so it is the only one with
a price.

**Why it matters:** the totals are right and the shopping list is wrong. Per the
`td-domain` trade ladder, the Mithral Bar (Trade 3) and the Eldritch Bar (Trade 4)
are real tokens, and a 25,000 GP requirement can legitimately be met by any mix of
the two denominations adding up. Today the site tells a player to go and acquire
twenty-five separate 1,000 GP bars when one token is the whole amount.

It also leaves the trade ladder half-populated in the direction that matters for
item 3: Trade 3 currently means Golden Fleece only, and Trade 4 means Wish Ring
only, because the bar half of each rung is not in the data.

**The evidence that they trade at face value** is thin but consistent: the one
observed sale, `contextItems.csv` row 334 (auction 202349), went for **$250**,
exactly 25 x the 2023 gold bar minimum of $10.00. That is a single data point from
a row whose name is itself wrong (item 7), so it is a hint, not a basis.

**Done looks like:** the denominations authored as tokens, with `derivedPrices.csv`
expressing them against the bar that IS priced (`5,000 GP Mithral Bar = 1,000 GP
Gold Bar x 5`). That file is currently idle — its only rule was superseded by the
Monster Trophy rows in PR #159 — so the mechanism is free.

**Two cautions before anyone starts.** A recipe line naming a denomination is a
line naming a TRANSMUTE, since every rung of the trade ladder is craftable, so it
goes through the market-first rule in `src/lib/transmutes.ts`: with no auction
price of its own a Mithral Bar would price at its BUILD cost, which is what you
want, but it also means the Shopping List will section it by pricing route and
give it a vintage. And swapping `5x 1,000 GP Gold Bar` for `1x 5,000 GP Mithral
Bar` is not cost-neutral if the two are ever priced independently — check what it
does to the 43 Legendary recipes and their Wish-Ring-or-15,000-GP path before
changing any of them.
