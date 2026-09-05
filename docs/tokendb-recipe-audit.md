# Transmute recipe audit — `transmuteRecipes.csv` vs tokendb.com

Run 2026-09-05. Every recipe in `public/data/transmuteRecipes.csv` was compared
against its token page on tokendb.com, the game's own token database.

The corpus is checked in: 175 verbatim pages, gzipped, in `fixtures/tokendb/`,
with every name-to-slug mapping, the recipe-list indices for pages carrying more
than one recipe, and the measured deltas in its `manifest.json`.
`npm run test:tokendb` re-runs this reconciliation against those fixtures and
fails on any discrepancy the manifest does not already know about — so a recipe
edit that drifts from tokendb now shows up as a red check rather than as a
moved total nobody notices.

## Scope

| | |
|---|---|
| Distinct transmute names in the CSV | 174 |
| Recipe groups compared | 176 (Omni Cube and Omni Orb each carry two vintages) |
| Pages fetched and matched by `<h1>` | 174 of 174 |
| Groups with **no** item or quantity discrepancy | **155** |
| Groups with a discrepancy | **21** |

Eighteen names do not slug the way the rule in the brief predicts. They were
resolved through tokendb's own search and are listed under *Name mismatches*.

## How the comparison reads the CSV's conventions

These were inferred from the data, not assumed, and they hold across the corpus:

- `N,000 GP in Reserve Bars`, a bare `N,000 GP`, and `N× 1,000 GP Gold Bar` all
  mean `N x 1,000 GP Gold Bar`. Amounts under one bar (`500 GP`, `200 GP`) are
  not recorded at all.
- `plus ONLY ONE of the following: {Wish Ring | 15,000 GP in Reserve Bars}` is
  recorded as `1 x Wish Ring`.
- A "pick one of these monster trophies (or just pay)" group is recorded as
  `N x Monster Trophy`.
- `N× any Ultra Rare token from the … Standard Set` and `plus N points worth of
  tokens` are recorded as `N x Ultra Rare`.
- A finished Safehold's trade goods live on its `… (Under Construction)` page;
  the CSV merges both stages, so the audit does too.
- **Ingredients of Rare rarity and below are deliberately omitted.** Sampling
  every named ingredient the CSV leaves out and looking up its rarity on tokendb:
  247 of 301 are Rare, Uncommon, Common, Quest or Premium, while the named
  ingredients the CSV *does* record are almost all Ultra Rare or Transmuted-Relic.
  This is treated as intentional, not as 301 missing rows.

## 1. Errors — the CSV disagrees with tokendb

Twelve recipes. Each was re-verified against a fresh fetch of the live page, not
just the fixture. Paste blocks are in § 4.

| Transmute | Ingredient | tokendb | CSV | |
|---|---|---|---|---|
| **Ashenne's Arch-Mage Medallion** | Alchemist's Ink | 15 | 10 | ↑ |
| | Alchemist's Parchment | 15 | 10 | ↑ |
| | Darkwood Plank | 30 | 25 | ↑ |
| | Dwarven Steel | **5** | **20** | ↓ |
| | Minotaur Hide | 15 | 10 | ↑ |
| | Mystic Silk | 25 | 35 | ↓ |
| **Blessed Redoubt Mail** | 1,000 GP Gold Bar | 4 (`4,000 GP`) | 1 | ↑ |
| **Benrow's Elder Drake Necklace** | Mystic Silk | 30 | 35 | ↓ |
| **Boaz's Bead of Whispers** | Dwarven Steel | 15 | 10 | ↑ |
| **Greater Bead of Whispers** | Dwarven Steel | 10 | 15 | ↓ |
| **+3 Turkey Leg of Smiting** | Golden Fleece | 2 | 1 | ↑ |
| **Gem of Last Hope** | Philosopher's Stone | 10 | — | wrong ingredient |
| | Mystic Silk | — | 10 | |
| **Deathward Greaves** | 1,000 GP Gold Bar | — | 1 | delete |
| **Bead of Divine Choice** | Golden Fleece | — | 1 | delete |
| **Gloves of Spirit Handling** | 1,000 GP Gold Bar | 1 | — | add |
| **Ioun Stone Elfstone Shard** | Monster Trophy | 6 | — | add |
| **Charm of Unity** | Ultra Rare | 2 | 1 | ↑ |
| **Orion's Belt** | Monster Trophy | 6 | — | see below |
| | Golden Fleece | — | 5 | |

Notes on the three that are not a plain number swap:

**Gem of Last Hope** — the page lists `10× Darkwood Plank` and
`10× Philosopher's Stone`. The CSV has 10 Darkwood Plank and 10 **Mystic Silk**.
Mystic Silk appears nowhere in the recipe; Philosopher's Stone is missing. This
reads as one row whose ingredient name is wrong rather than two separate errors.

**Ioun Stone Elfstone Shard** — the recipe requires *every monster trophy from
2020*. tokendb's own year + classification facet lists six for 2020 (Automaton
Gear, Automaton Oil, Darkrift Ingot, Death Cloak Fabric, Ethereal Ooze,
Semi-Lich Dust). The CSV records no Monster Trophy row at all. For comparison
the audit verified **Earcuff of Greater Glory**'s `26 x Monster Trophy` the same
way and it is exactly right: 8 (2023) + 6 (2024 less Skull of Batterak) +
6 (2025) + 6 (2026, less the four Participation "Silver Ship" trophies the
page's footnote excludes) = 26.

**Charm of Unity** — the page reads
`ONE of the following: {Charm of Awareness | 2× any Ultra Rare token from the
2027 Standard Set}`. The CSV takes the Ultra Rare branch but records **1**, not
2. Either quantity is defensible only if the intent was the Charm of Awareness
branch, which the CSV does not name — so 2 looks right.

**Orion's Belt** — this one needs your call, not mine. The page requires six
Relic Recipe Fragments plus *every monster trophy from 2019*, with a footnote:
"Relic Recipe Fragments may not be substituted for Monster Trophies in this
recipe." tokendb classifies 12 tokens as 2019 monster trophies, six of which
*are* the Relic Recipe Fragments, so the trophy requirement is the other six
(Blight Bud, Fiend Talon, Lamia Scale, Slayer Tentacle, Stalker Blood, Swamp Hag
Venom). The CSV instead records `5 x Golden Fleece` and no Monster Trophy row.
Golden Fleece appears nowhere in this recipe on tokendb, and 5 Fleece is 50
trophies' worth, so it is not an obvious equivalence either. **No paste block —
tell me which shape you want.**

## 2. Could not match exactly — judgement calls, no change proposed

None of these is a number that disagrees. They are places where the CSV models
something the page states differently, and the modelling may well be correct.

### 2.1 Vintage mismatch — Omni Cube and Omni Orb

tokendb publishes only the **2026** recipe for both. The CSV holds 2024 and 2025
rows. The two cannot be reconciled, and the deltas are real changes between
vintages rather than errors:

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

Worth deciding whether a 2026 row should be added. The Ultra Rare row missing
from both 2024 recipes is the one thing here that might be a real gap rather
than a vintage difference — the 2024 recipe would then have no UR component at
all, which no other Omni vintage does.

### 2.2 A "pick any N" group reduced to one representative

The CSV picks a single ingredient to stand for the whole group. Defensible for
costing (the cheapest is the rational choice) but it is not what the page says.

| Transmute | tokendb | CSV |
|---|---|---|
| Tomb Treasure Chest (Recipe 1) | ANY FORTY of 8 trade goods | 40 x Mystic Silk |
| Tomb Treasure Chest (Recipe 2) | ANY TWENTY of Aragonite / Elven Bismuth / Oil of Enchantment | 20 x Aragonite |
| One Boot Billy Map — Trade 1 | TWENTY of 8 trade goods | 20 x Darkwood Plank |

### 2.3 GP that does not divide into whole bars

| Transmute | tokendb | CSV |
|---|---|---|
| Ring of Greater Focus | `2,500 GP` | 3 x 1,000 GP Gold Bar (rounded up) |
| Enchanter's Whetstone | `500 GP` | not recorded |
| Gem of Last Hope | `500 GP` | not recorded |
| Ring of Stamina | `200 GP` | not recorded |

Ring of Greater Focus is the only one that rounds rather than drops. Consistent
either way is fine; it is currently neither.

### 2.4 Named tokens folded into a generic stand-in

All verified as arithmetically correct — the counts match the page exactly.

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
| Kilt of Dungeonbane | Kilt of Barrelbane / Fatherbane / Tavernbane (3 URs) | 3 x Ultra Rare |
| Coin of Wealth | `100,000 GP Mythic Ore Bar` | 100 x 1,000 GP Gold Bar |
| Coin of Wealth | Bead of Bounty, Bead of Greed, Bead of Need (2027) | 3 x Ultra Rare |

### 2.5 Choice groups the CSV does not model at all

The page requires these; the CSV records nothing for them. Consistent with the
"Rare and below are omitted" convention in every case except Bead of Asgard and
Charm of Divine Gifts, whose options are Relic-tier beads and charms.

| Transmute | tokendb requires |
|---|---|
| Bead of Asgard | pick 4 of {Freyja, Frigg, Heimdall, Hermod, Odin, Thor} beads |
| Bead of Divine Choice | pick 7 of 8 named beads |
| Charm of Divine Gifts | pick 3 of {Aset, Bast, Hathor, Osiris, Ra, Thoth} charms |
| Bifrost Charm | pick 8 of 9 coloured Bifrost Charms |
| Orb of Annihilation | pick 1 of {Goggles of Anticipation, Grunnel's Hexed Fruitcake} |
| Gem of Last Hope | Potion Death's Door **or** Potion Revival Root |
| Divine Water | any Potion or Holy Water |

### 2.6 High-rarity ingredients omitted where the rest of the tier is recorded

Everything else the CSV leaves out is Rare or below. These four are not:

| Transmute | Ingredient | tokendb rarity |
|---|---|---|
| Aron's Sunhide Robe | Steelclad Cloak | Transmuted-Exalted (4 pt) |
| Starhide Robe | Bronzeclad Cloak | Transmuted-Enhanced (3 pt) |
| +3 Turkey Leg of Smiting | +1 Turkey Leg of Smiting | Ultra Rare |
| Coin of Wealth, Ettin Ring, Charm of Fate, Bead of Defiance, Ioun Stone of Judgment | Mythic Transmuter | Safehold |
| Follower / Hireling / Sidekick / Underling | the matching `… Steward` | Safehold |

The Mythic Transmuter is required by all five Mythic recipes and recorded by
none of them.

## 3. Name mismatches

The CSV name does not slug to the tokendb URL. All were resolved; none is a
recipe error, but two look like typos worth fixing.

| CSV `Transmute` | tokendb `<h1>` | |
|---|---|---|
| `Spirt Pet Asp` | Spirit Pet Asp | **typo** |
| `Ring of Siren Bane` | Ring of Sirenbane | **typo** |
| `One Boot Billy Map - Trade 1/2 Recipe` | One-Boot Billy's Map | disambiguator |
| `Bead of Defiance` | Mythic Bead of Defiance | `Mythic ` prefix dropped |
| `Charm of Fate` | Mythic Charm of Fate | ” |
| `Coin of Wealth` | Mythic Coin of Wealth | ” |
| `Ettin Ring` | Mythic Ettin Ring | ” |
| `Ioun Stone of Judgment` | Mythic Ioun Stone of Judgment | ” |
| `Follower` | Follower Brawling (etc.) | generic name for a class variant |
| `Hireling` | Hireling Archer (etc.) | ” |
| `Sidekick` | Sidekick Ella (etc.) | ” |
| `Underling` | Underling Fighter (etc.) | ” |
| `Charm of Avarice Recipe 3` | Charm of Avarice, Recipe #3 | disambiguator |
| `Kilgor's +4 Savage Sword (Recipe 1/2)` | Kilgor's +4 Savage Sword | disambiguator |
| `Omni Cube Ultra Rare Recipe` | Omni Cube, alternate recipe | disambiguator |
| `Smith's Charm of Unified Synergy (Set 1/2/3)` | Smith's Charm of Unified Synergy | disambiguator |
| `Tomb Treasure Chest (Recipe 1/2)` | Tomb Treasure Chest | disambiguator |

The five Mythic names are unambiguous in context (the `Level` column already
says Mythic) but they are not the official token names, which matters if
anything ever keys off `Transmute` to look a token up.

## 4. Paste blocks

`-` is the row as it stands today, `+` is the replacement. Lines are shown exactly
as they appear in the file, including the quoting the `1,000 GP` names force.
Nothing here has been written to the CSV.

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

## 5. Recipes with no item or quantity discrepancy (155)

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
- +3 Viper Strike Fang
- Amulet of Noble Might
- Arcanum Shirt
- Aron's Arcane Necklace of Baubles
- Aron's Sunhide Robe
- Asher's +5 Viper Strike Fang
- Ava's +5 Holy Avenger
- Averon's +5 Deathcleaver
- Bead of Asgard
- Bead of Defiance
- Bead of Greater Binding
- Bead of Horus
- Belt of Ogre Mage Power
- Bibwik's Bead Bracelets
- Bifrost Charm
- Blessed Redoubt Helm
- Blessed Redoubt Plate
- Blessed Redoubt Shield
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
- Charm of the Fire Newt
- Craven's Vampire Ring
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
- Giln's Redoubt Shield
- Girdle of Frost Giant Strength
- Gloves of Infamy
- Greater Arcane Necklace of Baubles
- Greater Bead Bracelets
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
- Ring of Siren Bane
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
- Spirit Pet Bliss Squirrel
- Spirt Pet Asp
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