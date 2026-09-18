# Transmute recipe audit — `transmuteRecipes.csv` vs tokendb.com

Audited **2026-09-05** against tokendb.com, the game's own token database.
**Corrections applied and published 2026-09-08** (PR #186). Re-verified the same
day: every correction landed, nothing else moved.

The corpus is checked in: 175 verbatim pages, gzipped, in `fixtures/tokendb/`,
with every name-to-slug mapping, the recipe-list indices for pages carrying more
than one recipe, and the remaining deltas in its `manifest.json`.
`npm run test:tokendb` re-runs this reconciliation against those fixtures and
fails on any discrepancy the manifest does not already know about — so a recipe
edit that drifts from tokendb now shows up as a red check rather than as a moved
total nobody notices. Re-measure the known list with
`TOKENDB_EMIT_KNOWN=1` rather than editing it by hand.

> **What this check is not allowed to do (2026-09-18).** It must never block a
> publish because THIS REPO is missing a fixture. tokendb is not where a recipe
> first appears — proposed recipes arrive as a forum PDF months earlier, and a
> backfilled recipe needs its page fetched, which CI cannot do. So a recipe the
> check cannot read is **unverified, never incorrect**: it leaves the
> denominator with its reason, the way `onyxcheck.mjs` treats an unreconcilable
> row. Only a recipe that DOES resolve to a page and DISAGREES with it fails.
> Recipes marked `Source=forum-pdf` are not asked at all; an unmapped one is a
> note naming `npm run tokendb:refresh`, which fetches the page and writes the
> manifest entry itself. See `backlog.md` PIPE-6 and `updating-the-data.md`
> § *The `Source` column*.

## Scope

| | |
|---|---|
| Distinct transmute names in the CSV | 174 |
| Recipe groups compared | 176 (Omni Cube and Omni Orb each carry two vintages) |
| Pages fetched and matched by `<h1>` | 174 of 174 |
| Reconciling exactly, **before** corrections | 155 |
| Reconciling exactly, **after** corrections | **168** |
| Still open | **8**, none of them a data error |

## How the comparison reads the CSV's conventions

These were inferred from the data and then confirmed by the maintainer:

- `N,000 GP in Reserve Bars`, a bare `N,000 GP`, and `N× 1,000 GP Gold Bar` all
  mean `N x 1,000 GP Gold Bar`. Amounts under one bar are not recorded at all —
  see § 2.3, which now has a fix.
- `plus ONLY ONE of the following: {Wish Ring | 15,000 GP in Reserve Bars}` is
  recorded as `1 x Wish Ring`.
- A "pick one of these monster trophies (or just pay)" group is recorded as
  `N x Monster Trophy`.
- `N× any Ultra Rare token from the … Standard Set` and `plus N points worth of
  tokens` are recorded as `N x Ultra Rare`.
- A named token that stands for a set is recorded as the aggregate the set
  forms — `8k Bonus`, `2k Bonus`, `Stalker Token`, `Golem Piece (40 Unique)` —
  with the real token in `Display Name`. `+3 Turkey Leg of Smiting` is the
  pattern in miniature: `Item = 2k Bonus`, `Display Name = +1 Turkey Leg of
  Smiting`.
- A finished Safehold's trade goods live on its `… (Under Construction)` page;
  the CSV merges both stages, so the audit does too.
- **Ingredients of Rare rarity and below are deliberately omitted.** Of the 301
  named ingredients the CSV leaves out, 247 are Rare, Uncommon, Common, Quest or
  Premium, while the named ingredients it *does* record are almost all Ultra Rare
  or Transmuted-Relic. The maintainer's reason: those tokens cost $5 at most and
  most players have them on hand. This is treated as intentional, not as 301
  missing rows.

## 1. Errors — RESOLVED (published 2026-09-08, PR #186)

All twelve are corrected. Verified by diffing `transmuteRecipes.csv` at
`53c6ba3` (the commit the audit was written against) against the published
tree, so the check is that each change landed *and* that nothing else moved.

| Transmute | Ingredient | was → now | |
|---|---|---|---|
| Ashenne's Arch-Mage Medallion | Alchemist's Ink | 10 → 15 | ✔ |
| | Alchemist's Parchment | 10 → 15 | ✔ |
| | Darkwood Plank | 25 → 30 | ✔ |
| | Dwarven Steel | 20 → 5 | ✔ |
| | Minotaur Hide | 10 → 15 | ✔ |
| | Mystic Silk | 35 → 25 | ✔ |
| Blessed Redoubt Mail | 1,000 GP Gold Bar | 1 → 4 | ✔ |
| Benrow's Elder Drake Necklace | Mystic Silk | 35 → 30 | ✔ |
| Boaz's Bead of Whispers | Dwarven Steel | 10 → 15 | ✔ |
| Greater Bead of Whispers | Dwarven Steel | 15 → 10 | ✔ |
| +3 Turkey Leg of Smiting | Golden Fleece | 1 → 2 | ✔ |
| Gem of Last Hope | Philosopher's Stone | absent → 10 | ✔ |
| | Mystic Silk | 10 → removed | ✔ |
| Deathward Greaves | 1,000 GP Gold Bar | 1 → removed | ✔ |
| Bead of Divine Choice | Golden Fleece | 1 → removed | ✔ |
| Gloves of Spirit Handling | 1,000 GP Gold Bar | absent → 1 | ✔ |
| Ioun Stone Elfstone Shard | Monster Trophy | absent → 6 | ✔ |
| Charm of Unity | Ultra Rare | 1 → 2 | ✔ |

Two more landed in the same publish, beyond the twelve:

**Orion's Belt** — the one the audit refused to guess at. Now recorded as tokendb
states it: `6 x Relic Recipe Fragment (6 unique)` plus `6 x Monster Trophy`, with
the unexplained `5 x Golden Fleece` gone. The new aggregate was given rows in
`offAuctionPrices.csv` and `tokenMetadata.csv` in the same publish, so it prices
rather than going silently unpriced.

**+1 Turkey Leg of Smiting** — added as that year's `2k Bonus`, closing the one
§ 2.6 item that was a real gap rather than a convention.

Nothing else in the CSV changed. The only other movement was the two § 3 typos,
which move a recipe's rows to the corrected name with every quantity intact.

### One loose end from the publish

`Relic Recipe Fragment (6 unique)` is keyed to **2024** in `offAuctionPrices.csv`
but **2019** in `tokenMetadata.csv`. Its two precedents agree in both files
(`50 GP Idol (40 Unique)` is 2024/2024, `Golem Piece (40 Unique)` 2026/2026), and
the token is a 2019 Treasure Chest item used by a 2019 recipe, so **2019 is the
right year and the `offAuctionPrices` row is the one to move.**

It is not breaking anything: the season clamp finds the 2024 row and prices the
line. But it prices it *through the fallback*, and the card says so — Orion's
Belt currently renders `6 × Relic Recipe Fragment (6 unique) — non-auction item ·
from 2024` on a 2019 recipe, where the line beside it reads `6 × Monster Trophy —
non-auction item · season priced`. One cell in the workbook's `offAuctionPrices`
tab.

## 2. Modelling questions — the eight that remain

None is a number that disagrees with tokendb. Two now have a recommended fix.

### 2.1 Vintage mismatch — Omni Cube and Omni Orb

tokendb publishes only the **2026** recipe for both. The CSV holds 2024 and 2025
rows. Not reconcilable from the page:

| | tokendb 2026 | CSV 2025 | CSV 2024 |
|---|---|---|---|
| Omni Cube — Aragonite | 5 | 3 | 3 |
| Omni Cube — Elven Bismuth | 2 | 3 | 4 |
| Omni Cube — Oil of Enchantment | 2 | 3 | 3 |
| Omni Cube — Enchanter's Munition | 4 | 4 | 5 |
| Omni Cube — Ultra Rare | 2 | 2 | *absent* |
| Omni Orb — Aragonite | 4 | 2 | 2 |
| Omni Orb — Elven Bismuth | 1 | 2 | 2 |
| Omni Orb — Oil of Enchantment | 1 | 2 | 2 |
| Omni Orb — Mystic Silk | 5 | 5 | 10 |
| Omni Orb — Ultra Rare | 1 | 1 | *absent* |

Worth deciding whether a 2026 row should be added. **The Ultra Rare row missing
from both 2024 recipes is the one thing here that may be a real gap** rather than
a vintage difference — the 2024 recipe would otherwise have no UR component at
all, which no other Omni vintage lacks.

### 2.2 "Pick any N of these" — RECOMMENDATION

Three recipes, all expired, so this is historical accuracy rather than live
guidance:

| Transmute | tokendb | CSV records |
|---|---|---|
| Tomb Treasure Chest (Recipe 1) | ANY FORTY of the 8 Trade 1 goods | 40 x Mystic Silk |
| Tomb Treasure Chest (Recipe 2) | ANY TWENTY of the 3 Trade 2 goods | 20 x Aragonite |
| One Boot Billy Map — Trade 1 | TWENTY of the 8 Trade 1 goods | 20 x Darkwood Plank |

The player heuristic was *buy the cheapest*, and the old sheet had a query
tracking which that was. Freezing one member as the recipe loses that, and the
recipe card then asserts something false — the chest never required Mystic Silk.

**Measured against `prices.csv`, how wrong the frozen pick is depends entirely on
the tier:**

| Pool | Season | Cheapest member | What the CSV picked | Gap on the line |
|---|---|---|---|---|
| Trade 1 (40) | 2024 | Mystic Silk $1.52 | Mystic Silk $1.52 | $0 |
| Trade 1 (40) | 2025 | Darkwood Plank $1.38 | Mystic Silk $1.39 | $0 |
| Trade 1 (20) | 2023 | Mystic Silk $1.62 | Darkwood Plank $1.64 | $0 |
| **Trade 2 (20)** | **2024** | **Elven Bismuth $6.47** | **Aragonite $10.76** | **$86** |
| Trade 2 (20) | 2025 | Aragonite $9.82 | Aragonite $9.82 | $0 |

The eight Trade 1 goods price within a couple of cents of each other, so any
representative is fine there. **Trade 2 is not** — Aragonite ran 66% above Elven
Bismuth in 2024, and since Recipe 2 is *only* that line, the card shows $203
where the cheapest route was about $129. It does not flip which recipe is
cheaper (Recipe 1 shows $55) but it overstates the alternative by a third.

**Note that `npm run test:tokendb` cannot catch this.** A "pick any N" group
reconciles by construction — the resolver accepts whichever member the CSV names
— so a badly chosen representative looks identical to a well chosen one. That is
an argument for modelling the pool rather than leaving it to a periodic re-audit.

#### Recommended: a pool rule in `derivedPrices.csv`

`derivedPrices.csv` is already the home for "this good's price is a function of
another good's", it is **hand-authored with no workbook tab behind it**, and it
already carries a `Bound` column for exactly this kind of qualifier. Extend it
with a member list:

```csv
Token,DerivedFrom,Ratio,Multiple,Year,Bound,Note
Any Trade 1 Good,"Alchemist's Ink|Alchemist's Parchment|Darkwood Plank|Dwarven Steel|Enchanter's Munition|Minotaur Hide|Mystic Silk|Philosopher's Stone",,,,cheapest,"A ""pick any N"" recipe line. Players bought whichever Trade 1 good was cheapest that season, so the pool prices at its cheapest member's whole distribution rather than at one frozen pick."
Any Trade 2 Good,"Aragonite|Elven Bismuth|Oil of Enchantment",,,,cheapest,"As above. Matters more than Trade 1: Aragonite ran 66% above Elven Bismuth in 2024."
```

Then the recipe rows become `40 x Any Trade 1 Good`, `20 x Any Trade 2 Good`,
`20 x Any Trade 1 Good`.

The engine change is about twenty lines in `PriceIndex.leafPrice`: where
`DerivedFrom` holds a `|`-separated list and neither `Ratio` nor `Multiple` is
set, price every member for that season, drop the ones with no price, and return
the **whole distribution of the member with the lowest avg** — not an elementwise
min across members, which would produce a min and an avg that never belonged to
the same good. That mirrors what the Fleece rule already does in keeping its
parent's distribution intact, and the existing cycle guard still applies: pool
members are leaf goods, so it must never reach `buildCost`.

Three things fall out for free. The line renders as `derived`, which is what it
is. It re-resolves per season, so an expired recipe priced over its own build
window gets the answer that was true *then*, which a frozen pick structurally
cannot. And the pools are the Trade 1 and Trade 2 tiers the domain already names,
so there is nothing new to define.

#### If that is more than three expired recipes deserve

The zero-code half-measure still beats today: **rename the Item to the pool name
and leave the price alone.** `40 x Any Trade 1 Good` priced as Mystic Silk is a
recipe card that no longer claims the chest needed silk, and the audit note
explains the approximation. Do this even if the pool rule never gets built — the
misstatement is the part that misleads a reader, and it costs one cell each.

What is *not* recommended is reviving the old sheet's cheapest-good query into
`offAuctionPrices.csv`. It works, but it freezes the answer at publish time and
mislabels the line "non-auction item" when every member is an auctioned good.

### 2.3 GP that does not divide into whole bars — RECOMMENDATION

Only three amounts in the whole corpus fail to divide, across four recipes:

| Transmute | tokendb | CSV records |
|---|---|---|
| Ring of Stamina | `200 GP` | nothing |
| Enchanter's Whetstone | `500 GP` | nothing |
| Gem of Last Hope | `500 GP` | nothing |
| Ring of Greater Focus | `2,500 GP` | 3 x 1,000 GP Gold Bar (rounded up) |

Two more `500 GP` mentions sit inside "ONLY ONE of" groups where the CSV records
the trophy branch instead, so they need nothing.

The maintainer's framing settles it: players convert common/uncommon/rare tokens
into 1,000 GP Bars, and loose GP items sell at prices consistent with fractions
of the bar. **That is a ratio of the Gold Bar, which is exactly what
`derivedPrices.csv` already expresses** — the same shape as the
`5,000 GP Mithral Bar` row, with `Ratio` where that one uses `Multiple`:

```csv
Token,DerivedFrom,Ratio,Multiple,Year,Bound,Note
200 GP,"1,000 GP Gold Bar",5,,,,"A GP amount, not a token: recipes name it and the player settles it with whatever small denominations they hold. Players convert common/uncommon/rare tokens into Gold Bars, and loose GP items sell at prices consistent with fractions of the bar, so a fifth of a bar is the honest price."
500 GP,"1,000 GP Gold Bar",2,,,,"As 200 GP. Half a bar."
"2,500 GP","1,000 GP Gold Bar",,2.5,,,"Two and a half bars. Recorded as one line so the recipe reads as the page does, rather than as 2 bars plus a 500 GP that the page never names separately."
```

Then each recipe records `1 x 200 GP`, `1 x 500 GP`, `1 x 2,500 GP` and the card
mirrors the page text exactly.

**No engine change is needed** — `Ratio` already divides
(`(v) => v / rule.ratio`) and `Multiple` already accepts a non-integer. **No
workbook change either**, because `derivedPrices.csv` has no tab behind it.

Two judgement calls worth stating rather than burying:

- **Leave `Bound` empty.** `ceiling` would be defensible — smaller denominations
  are less liquid and may trade at a slight discount — but nothing measured says
  so, and the Monster Trophy row uses `ceiling` because Fleece÷10 is provably an
  upper bound. Asserting a bound here would be a guess wearing a flag's clothes.
- **This changes four recipe totals, three of them upward**, since those recipes
  currently record no GP at all. Ring of Greater Focus moves the other way, from
  3 bars to 2.5. All four are expired.

### 2.4 Named tokens folded into a generic stand-in

All verified arithmetically correct — the counts match the page exactly.

| Transmute | tokendb | CSV |
|---|---|---|
| Eldest Orb of Dragonkind | 8 Orb of Dragonkind stages | 8 x 8k Bonus |
| Mark of Enlightenment | 4 Path to Enlightenment fragments | 4 x 8k Bonus |
| Mark of the Tenets | Marks of the 1st/2nd/3rd Tenet | 3 x 2k Bonus |
| Ring of the Sacred Circle | Rings of the 1st–5th Circle | 5 x 1k Bonus |
| Stalker Bead of Focus / of Skill | 20 named Stalker tokens | 20 x Stalker Token |
| Herald's Ring of Focus / of Wrath | 20 named Herald tokens | 20 x Herald Token (20 Unique) |
| Gear Golem Totem | 40 named Golem pieces | 40 x Golem Piece (40 Unique) |
| Totem of Wonder | 40 named 50 GP Idols | 40 x 50 GP Idol (40 Unique) |
| Orion's Belt | 6 Relic Recipe Fragments | 6 x Relic Recipe Fragment (6 unique) |
| +3 Turkey Leg of Smiting | +1 Turkey Leg of Smiting | 1 x 2k Bonus |
| Kilt of Dungeonbane | Kilt of Barrelbane / Fatherbane / Tavernbane (3 URs) | 3 x Ultra Rare |
| Coin of Wealth | `100,000 GP Mythic Ore Bar` | 100 x 1,000 GP Gold Bar |
| Coin of Wealth | Bead of Bounty, Bead of Greed, Bead of Need (2027) | 3 x Ultra Rare |

One naming nit: the older aggregates capitalise the qualifier —
`(40 Unique)`, `(20 Unique)` — and the new one is `(6 unique)`.
`validate-prices.mjs` § 8 will not flag it, because it compares names that differ
only by case *for the same item*, and these are different items. Cosmetic, but
it is the kind of drift that section exists to prevent.

### 2.5 Choice groups the CSV does not model at all — **the audit was wrong here**

The 2026-09-05 report said these were "consistent with the Rare-and-below
convention in every case except Bead of Asgard and Charm of Divine Gifts, whose
options are Relic-tier beads and charms". **That was wrong.** It inferred the
options' tier from the tier of the recipe they feed rather than looking them up.
Every option in every one of these groups was then checked on tokendb:

| Transmute | tokendb requires | Every option's rarity / source |
|---|---|---|
| Bead of Asgard | pick 4 of 6 named beads | Rare · Participation (2025) |
| Charm of Divine Gifts | pick 3 of 6 named charms | Rare · Participation (2024) |
| Bead of Divine Choice | pick 7 of 8 named beads | Rare · Participation (2026), one Appreciation |
| Bifrost Charm | pick 8 of 9 coloured charms | Rare · Participation |
| Orb of Annihilation | pick 1 of 2 named tokens | Rare · Participation |
| Gem of Last Hope | Potion Death's Door **or** Potion Revival Root | Rare · Standard Pack |
| Divine Water | any Potion or Holy Water | Common · Standard Pack |

**There is no exception.** All 22 options are Rare or below, so § 2.5 collapses
entirely into the omission convention — and the reason is sharper than rarity:
most are **Participation tokens, guaranteed rewards for attending a specific
event**, so a player who was there already has them and they barely trade. That
is a better statement of the rule than "Rare and below", and it is why these
groups can be left unmodelled without understating a build.

### 2.6 High-rarity ingredients omitted — CLOSED

| Transmute | Ingredient | Verdict |
|---|---|---|
| +3 Turkey Leg of Smiting | +1 Turkey Leg of Smiting (UR) | **added** as that year's 2k Bonus |
| Aron's Sunhide Robe | Steelclad Cloak (Exalted) | negligible cost — deliberately omitted |
| Starhide Robe | Bronzeclad Cloak (Enhanced) | negligible cost — deliberately omitted |
| the five Mythic recipes | Mythic Transmuter (Safehold) | supplied gratis with the transmute |
| Follower / Hireling / Sidekick / Underling | the matching `… Steward` | supplied gratis with the transmute |

The Steward and Mythic Transmuter cases are worth remembering as a *category*:
an ingredient the transmute itself hands you is not a cost, and recording it
would double-count.

## 3. Name mismatches — RESOLVED

Both typos are corrected and published; the recipes moved to the corrected names
with every quantity intact, and `fixtures/tokendb/manifest.json` moved with them.

| CSV `Transmute` | tokendb `<h1>` | |
|---|---|---|
| ~~`Spirt Pet Asp`~~ → `Spirit Pet Asp` | Spirit Pet Asp | **fixed** |
| ~~`Ring of Siren Bane`~~ → `Ring of Sirenbane` | Ring of Sirenbane | **fixed** |

The rest are deliberate and stay as they are:

| CSV `Transmute` | tokendb `<h1>` | Why |
|---|---|---|
| `Bead of Defiance`, `Charm of Fate`, `Coin of Wealth`, `Ettin Ring`, `Ioun Stone of Judgment` | `Mythic …` | the `Mythic ` prefix is dropped to save space; the tier chip beside the name already says it, and players read it that way |
| `Follower`, `Hireling`, `Sidekick`, `Underling` | `Follower Brawling`, `Hireling Archer`, … | a generic name for a potentially unbounded list of variants that all share one recipe; listing every one would be pure redundancy |
| `One Boot Billy Map - Trade 1/2 Recipe`, `… (Recipe 1/2)`, `… (Set 1/2/3)`, `Omni Cube Ultra Rare Recipe` | the plain token name | disambiguators for pages carrying more than one recipe |

Because the CSV name is the join key, a rename is not free — it moves every row
of that recipe and every reference keyed to it, including this corpus's manifest.
Worth knowing before renaming anything else.

## 4. Paste blocks — APPLIED, kept as the record of what changed

These were the rows handed over on 2026-09-05 and applied in the sheet for
PR #186. `-` is the row as it stood, `+` the replacement. **Do not re-apply
them**; they are here so a later reader can see exactly which cells moved and
reconstruct the before state without digging through the publish diff. The
sheet, not this file, is the source — these lines were generated from the CSV
and are shown as they appeared in it, including the quoting the `1,000 GP` names
force.

```text
=========== quantity / row fixes ===========

# Ashenne's Arch-Mage Medallion -- Alchemist's Ink  10 -> 15
-  2021|Ashenne's Arch-Mage Medallion|Alchemist's Ink||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Alchemist's Ink,,2021,Alchemist's Ink,10,FALSE,,
+  2021|Ashenne's Arch-Mage Medallion|Alchemist's Ink||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Alchemist's Ink,,2021,Alchemist's Ink,15,FALSE,,

# Ashenne's Arch-Mage Medallion -- Alchemist's Parchment  10 -> 15
-  2021|Ashenne's Arch-Mage Medallion|Alchemist's Parchment||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Alchemist's Parchment,,2021,Alchemist's Parchment,10,FALSE,,
+  2021|Ashenne's Arch-Mage Medallion|Alchemist's Parchment||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Alchemist's Parchment,,2021,Alchemist's Parchment,15,FALSE,,

# Ashenne's Arch-Mage Medallion -- Darkwood Plank  25 -> 30
-  2021|Ashenne's Arch-Mage Medallion|Darkwood Plank||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Darkwood Plank,,2021,Darkwood Plank,25,FALSE,,
+  2021|Ashenne's Arch-Mage Medallion|Darkwood Plank||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Darkwood Plank,,2021,Darkwood Plank,30,FALSE,,

# Ashenne's Arch-Mage Medallion -- Dwarven Steel  20 -> 5
-  2021|Ashenne's Arch-Mage Medallion|Dwarven Steel||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Dwarven Steel,,2021,Dwarven Steel,20,FALSE,,
+  2021|Ashenne's Arch-Mage Medallion|Dwarven Steel||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Dwarven Steel,,2021,Dwarven Steel,5,FALSE,,

# Ashenne's Arch-Mage Medallion -- Minotaur Hide  10 -> 15
-  2021|Ashenne's Arch-Mage Medallion|Minotaur Hide||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Minotaur Hide,,2021,Minotaur Hide,10,FALSE,,
+  2021|Ashenne's Arch-Mage Medallion|Minotaur Hide||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Minotaur Hide,,2021,Minotaur Hide,15,FALSE,,

# Ashenne's Arch-Mage Medallion -- Mystic Silk  35 -> 25
-  2021|Ashenne's Arch-Mage Medallion|Mystic Silk||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Mystic Silk,,2021,Mystic Silk,35,FALSE,,
+  2021|Ashenne's Arch-Mage Medallion|Mystic Silk||FALSE,2021,Legendary,Ashenne's Arch-Mage Medallion,Mystic Silk,,2021,Mystic Silk,25,FALSE,,

# Blessed Redoubt Mail -- 1,000 GP Gold Bar  1 -> 4
-  "2016|Blessed Redoubt Mail|1,000 GP Gold Bar||FALSE",2016,Relic,Blessed Redoubt Mail,"1,000 GP Gold Bar",,2016,"1,000 GP Gold Bar",1,FALSE,,
+  "2016|Blessed Redoubt Mail|1,000 GP Gold Bar||FALSE",2016,Relic,Blessed Redoubt Mail,"1,000 GP Gold Bar",,2016,"1,000 GP Gold Bar",4,FALSE,,

# Benrow's Elder Drake Necklace -- Mystic Silk  35 -> 30
-  2020|Benrow's Elder Drake Necklace|Mystic Silk||FALSE,2020,Legendary,Benrow's Elder Drake Necklace,Mystic Silk,,2020,Mystic Silk,35,FALSE,,
+  2020|Benrow's Elder Drake Necklace|Mystic Silk||FALSE,2020,Legendary,Benrow's Elder Drake Necklace,Mystic Silk,,2020,Mystic Silk,30,FALSE,,

# Boaz's Bead of Whispers -- Dwarven Steel  10 -> 15
-  2023|Boaz's Bead of Whispers|Dwarven Steel||FALSE,2023,Legendary,Boaz's Bead of Whispers,Dwarven Steel,,2023,Dwarven Steel,10,FALSE,,
+  2023|Boaz's Bead of Whispers|Dwarven Steel||FALSE,2023,Legendary,Boaz's Bead of Whispers,Dwarven Steel,,2023,Dwarven Steel,15,FALSE,,

# Greater Bead of Whispers -- Dwarven Steel  15 -> 10
-  2023|Greater Bead of Whispers|Dwarven Steel||FALSE,2023,Relic,Greater Bead of Whispers,Dwarven Steel,,2023,Dwarven Steel,15,FALSE,,
+  2023|Greater Bead of Whispers|Dwarven Steel||FALSE,2023,Relic,Greater Bead of Whispers,Dwarven Steel,,2023,Dwarven Steel,10,FALSE,,

# +3 Turkey Leg of Smiting -- Golden Fleece  1 -> 2
-  2022|+3 Turkey Leg of Smiting|Golden Fleece||FALSE,2022,Relic,+3 Turkey Leg of Smiting,Golden Fleece,,2022,Golden Fleece,1,FALSE,,
+  2022|+3 Turkey Leg of Smiting|Golden Fleece||FALSE,2022,Relic,+3 Turkey Leg of Smiting,Golden Fleece,,2022,Golden Fleece,2,FALSE,,

# Deathward Greaves -- 1,000 GP Gold Bar  DELETE THIS ROW
-  "2026|Deathward Greaves|1,000 GP Gold Bar||FALSE",2026,Arcanum,Deathward Greaves,"1,000 GP Gold Bar",,2026,"1,000 GP Gold Bar",1,FALSE,,

# Bead of Divine Choice -- Golden Fleece  DELETE THIS ROW
-  2026|Bead of Divine Choice|Golden Fleece||FALSE,2026,Relic,Bead of Divine Choice,Golden Fleece,,2026,Golden Fleece,1,FALSE,,

=========== Gem of Last Hope: wrong ingredient ===========

-  2020|Gem of Last Hope|Mystic Silk||FALSE,2020,Exalted,Gem of Last Hope,Mystic Silk,,2020,Mystic Silk,10,FALSE,,
+  2020|Gem of Last Hope|Philosopher's Stone||FALSE,2020,Exalted,Gem of Last Hope,Philosopher's Stone,,2020,Philosopher's Stone,10,FALSE,,

=========== Gloves of Spirit Handling: missing gold bar ===========

# insert (sibling row shown for reference)
   ref  2027|Gloves of Spirit Handling|Mystic Silk||FALSE,2027,Exalted,Gloves of Spirit Handling,Mystic Silk,,2027,Mystic Silk,5,FALSE,,
+  "2027|Gloves of Spirit Handling|1,000 GP Gold Bar||FALSE",2027,Exalted,Gloves of Spirit Handling,"1,000 GP Gold Bar",,2027,"1,000 GP Gold Bar",1,FALSE,,

=========== Ioun Stone Elfstone Shard: missing 2020 monster trophies ===========

   ref  2021|Ioun Stone Elfstone Shard|Mystic Silk||FALSE,2021,Relic,Ioun Stone Elfstone Shard,Mystic Silk,,2021,Mystic Silk,2,FALSE,,
   (a Monster Trophy row elsewhere, for column shape)
   ref  2019|Belt of Ogre Mage Power|Monster Trophy|-1|FALSE,2019,Exalted,Belt of Ogre Mage Power,Monster Trophy,-1,2018,Monster Trophy,1,FALSE,,
+  2021|Ioun Stone Elfstone Shard|Monster Trophy|-1|FALSE,2021,Relic,Ioun Stone Elfstone Shard,Monster Trophy,-1,2020,Monster Trophy,6,FALSE,,

=========== Charm of Unity: Ultra Rare count (judgement) ===========

-  2027|Charm of Unity|Ultra Rare||FALSE,2027,Relic,Charm of Unity,Ultra Rare,,2027,Ultra Rare,1,FALSE,,Ultra Rare
+  2027|Charm of Unity|Ultra Rare||FALSE,2027,Relic,Charm of Unity,Ultra Rare,,2027,Ultra Rare,2,FALSE,,Ultra Rare
```

## 5. Recipes reconciling exactly (168 of 176)

Every group below matches tokendb on both the items it names and their
quantities, under the conventions in § *How the comparison reads the CSV*.
The eight not listed are § 2's open modelling questions.

- +1 Archer's Buckler
- +2 Keen Slayer Bow
- +3 Baton of Focus
- +3 Deathcleaver
- +3 Fellbane Crossbow
- +3 Holy Avenger
- +3 Mithral Bracers
- +3 Savage Sword
- +3 Slayer Sword
- +3 Staff of Focus
- +3 Throwing Hammer of Smiting
- +3 Turkey Leg of Smiting
- +3 Viper Strike Fang
- Amulet of Noble Might
- Arcanum Shirt
- Aron's Arcane Necklace of Baubles
- Aron's Sunhide Robe
- Ashenne's Arch-Mage Medallion
- Asher's +5 Viper Strike Fang
- Ava's +5 Holy Avenger
- Averon's +5 Deathcleaver
- Bead of Asgard
- Bead of Defiance
- Bead of Divine Choice
- Bead of Greater Binding
- Bead of Horus
- Belt of Ogre Mage Power
- Benrow's Elder Drake Necklace
- Bibwik's Bead Bracelets
- Bifrost Charm
- Blessed Redoubt Helm
- Blessed Redoubt Mail
- Blessed Redoubt Plate
- Blessed Redoubt Shield
- Boaz's Bead of Whispers
- Bog's Medallion of Berserking
- Boots of Grounding
- Boots of Protection
- Bracers of Carnage
- Bracers of the Inferno
- Byr's Anointed Redoubt Plate
- Censer of Divine Aid
- Chalice of Chugging
- Charm of Avarice Recipe 3
- Charm of Deathward
- Charm of Divine Gifts
- Charm of Fate
- Charm of Timely Aid
- Charm of Treasure Boosting
- Charm of Unity
- Charm of the Fire Newt
- Craven's Vampire Ring
- Deathward Greaves
- Divine Water
- Drake's +5 Staff of Focus
- Drue's +5 Baton of Focus
- Druegar's Sacred Necklace
- Earcuff of Greater Glory
- Earcuff of Thor's Bliss
- Eldest Orb of Dragonkind
- Eldritch Runestone
- Enchanter's Whetstone
- Ettin Ring
- Follower
- Gear Golem Totem
- Gem of Last Hope
- Giln's Redoubt Shield
- Girdle of Frost Giant Strength
- Gloves of Infamy
- Gloves of Spirit Handling
- Greater Arcane Necklace of Baubles
- Greater Bead Bracelets
- Greater Bead of Whispers
- Greater Charm Bracelets
- Greater Cloak of Destiny
- Greater Eye Patch of the Aesir
- Greater Gloves of the Gladiator
- Greater Ring of Havoc
- Greater Ring of Reflexes
- Gregor's Gladiator Gloves
- Hat of the Lucky Pirate
- Herald's Ring of Focus
- Herald's Ring of Wrath
- Hireling
- Iktomi's Shaper Necklace
- Incense of Focus
- Incense of Might
- Incense of Power
- Incense of the Magi
- Io's +4 Ultra Keen Slayer Bow
- Ioun Stone Aquamarine Prism
- Ioun Stone Elfstone Shard
- Ioun Stone Mystic Orb
- Ioun Stone Obsidian Shard
- Ioun Stone Sapphire Trilliant
- Ioun Stone Sunstone Trilliant
- Ioun Stone of Judgment
- Ioun Stone of Mystic Heroism
- Khing's Ring of Supreme Evasion
- Kilgor's +4 Savage Sword (Recipe 1)
- Kilgor's +4 Savage Sword (Recipe 2)
- Lenses of Sage Sight
- Luna's Greater Charm Bracelets
- Lute of Free Fury
- Mage Medallion
- Mark of Enlightenment
- Mark of the Tenets
- Mask of Careless Magic
- Mask of Foggy Skill
- Master Ale Drinker's Bead
- Master Drinker's Gloves
- Medallion of Furious Attack
- Muk's Greater Ring of Havoc
- Necklace of the Sneak
- Necklace of the Spirit Drake
- Odin's Eye Patch
- Omni Cube Ultra Rare Recipe
- One Boot Billy Map - Trade 1 Recipe
- One Boot Billy Map - Trade 2 Recipe
- Orb of Annihilation
- Orion's Belt
- Pendant of the Yew
- Pern's Redoubt Helm
- Pharacus' Greater Cloak of Destiny
- Ralson's Pendant of the Elder Yew
- Raphiel's Sneaky Necklace
- Relsa's Ring of Supreme Focus
- Ring of Improved Evasion
- Ring of Last Call
- Ring of Protection +4
- Ring of Psychic Mastery
- Ring of Sirenbane
- Ring of Stamina
- Ring of the Dire Ram
- Ring of the Ioun
- Ring of the Sacred Circle
- Ring of the Vampire Lord
- Rolland's Ring of Protection +6
- Sacred Necklace
- Safehold I
- Safehold II
- Safehold III
- Safehold IV
- Safehold V
- Shaman's Greater Necklace
- Shirt of Modest Luck
- Sidekick
- Sill's Anointed Redoubt Mail
- Smith's Charm of Unified Synergy (Set 1)
- Smith's Charm of Unified Synergy (Set 2)
- Smith's Charm of Unified Synergy (Set 3)
- Spirit Pet Asp
- Spirit Pet Bliss Squirrel
- Stalker Bead of Focus
- Stalker Bead of Skill
- Starhide Robe
- Surtr's Girdle of Fire Giant Strength
- TaMor's +4 Mithral Bracers
- Thor's +5 Returning Hammer of Smiting
- Tomb Treasure Chest (Recipe 1)
- Tomb Treasure Chest (Recipe 2)
- Totem of Wonder
- Underling
- Val's +4 Keen Fellbane Crossbow
- Vim's Boots of Protection
- Viv's Amulet of Noble Might
- Welfor's +5 Slayer Sword
- Widseth's Legendary Lute
