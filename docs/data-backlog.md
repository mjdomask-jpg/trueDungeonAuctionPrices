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
