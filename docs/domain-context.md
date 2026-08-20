# Domain Context

This document explains the real-world problem the website exists to solve, for
anyone (contributor, future maintainer, or curious community member) who needs to
understand *why* the data looks the way it does before touching *how* it is
processed.

> **Game-level domain facts** — tokens, the canonical rarity and tier ladders,
> trade goods, transmuting, chase tokens — are shared with other True Dungeon
> projects and maintained in the **`td-domain` skill**
> (`~/.claude/skills/td-domain/`). Where a *game* fact here disagrees with that
> skill, the skill wins. Everything about *this site* — its data shapes,
> statistics, and sale categories — is authoritative here.

## What True Dungeon is

True Dungeon is an interactive, tabletop-style dungeon adventure played at
conventions. Players equip a Dungeons & Dragons-like character using physical
**tokens** — collectible coins/pieces that represent gear, weapons, potions,
trade goods, and other items. A character's build is assembled from these tokens,
so the tokens have real value to players and collectors.

Each year the company releases a **new set** of tokens. Because a new set comes
out annually, there is a recurring, time-boxed market for acquiring that year's
tokens.

## How tokens enter circulation

Tokens reach players two independent ways. Neither is a sub-case of the other,
and this site is concerned with only the first.

### Buying a set: the group buy

The primary way the community buys a new set is through a **group buy**: many
people pool their money into a single large order (often an "8K" order, referring
to a funding target). Pooling unlocks bulk pricing and bonus/premium items that an
individual could not obtain alone.

The challenge with a group buy is fairness: once the single bulk order arrives, the
group must decide **who pays how much** and **who receives which tokens**. This is
resolved with an **auction**.

### Playing the game: treasure pulls

Players also receive tokens as loot from playing. The mix of a given year's
treasure is **not published**, so the community deduces it by pooling recorded
pulls. Some tokens appear *only* this way and never in auctions — Monster
Trophies, and chase tokens such as the 50 GP Idol.

This site does not track treasure; a sibling project does. It matters here only
because the two share a token catalog and a rarity vocabulary.

## The auction system

Within each group buy, the components of the order are **auctioned** among the
participants:

- People **bid** on the individual components (specific tokens, or bundles like
  premium/bonus items) they want.
- The high bidder **wins** those tokens and pays their bid.
- The collected bids fund the order.

**Why the "condensed" styles exist.** Rare and Uncommon tokens transmute into
Trade 1 and Trade 2 trade goods, but that conversion is tedious and multi-step,
so most buyers would rather receive the goods already converted. The condensed
styles encode how much of that conversion was done before delivery. In very early
seasons the unconverted **Rare Bag** and **Uncommon Bag** were themselves
auctioned, which is why they turn up in the oldest data.

Different auctions run in different **styles** ("Super Condensed", "Ultra
Condensed", "Limited", and the "Onyx"/"Safehold" variants) and complete in
different ways — the `completionStyle` column records that second axis, and as
of the 2026-07-22 metadata export its values are "Lightning", "Semi-Lightning"
and "Fixed Date" (which replaced the older "Regular" and the `n/a` placeholder). Many different community members act as **auctioneers** and run
their own auctions. As a result, over a single buying season there are **dozens of
separate auctions**, each producing its own set of final sale prices for the same
underlying catalog of tokens.

The **final sale price** of each component in each auction is the key piece of
public information: it tells the community what a given token actually sold for.

Not every auction completes. Each auction has an **outcome**: most **close**
successfully (and have a **close date**), but some **fail** (e.g. do not reach
funding) and others may still be **open**. When the site reports "how many
auctions" happened, it counts only the ones that actually **closed** — failed and
open auctions are excluded from those counts.

## Seasons, not calendar years

A set's buying window does **not** line up with the calendar year. Auctions for a
given set begin in the fall and continue into the following year. To handle this,
the data uses the concept of a **season** rather than a calendar year. A season
groups together all the auctions that belong to one annual set release.

Within a season, each auction is numbered sequentially (auction 1, 2, 3, …). The
combination of season + auction number uniquely identifies a single auction.

### The other time axis: events

Seasons govern *buying*. They do not govern *play*. Treasure pulls follow the
**calendar year** and are tracked **per event** — named conventions, virtual
runs, and specials, running January through December. The sibling treasure
project uses that axis; this site does not.

One collision worth knowing: in treasure data `V26` is the **26th virtual
event**, not the 2026 season. Never read a V-number as a year.

## Category color conventions

> **This is the *sale* axis, not rarity.** These categories describe how a lot was
> sold in a group buy. They are neither the canonical rarity ladder (Uncommon,
> Rare, Ultra Rare, …) nor the treasure project's analysis buckets ("Ultra Rare
> or Better", "Under Ultra Rare"). Three different things are called "category"
> across TD tooling, and `Ultra Rare` appears in two of them meaning different
> things. Do not reuse this list outside the auction domain.

Every component sold falls into a **category** — `Trade 1`, `Trade 2`, `Ultra Rare`,
`Premium`, `Bonus`, `Preorder`, or `Golden Ticket`. (`Trade 1` and `Trade 2` are not a
site invention: trade goods run a real ladder, `Trade 1` through `Trade 5`, and
these are its first two rungs. Only they appear in auction data — higher levels
turn up in treasure. They share one color by community convention.) These aren't just internal
labels: within the community each category has a **customarily associated color**,
familiar from the tokens and from years of the maintainer's spreadsheets. Members
recognize a category partly by its color, so the site color-codes each category's
table heading to match those expectations rather than picking arbitrary colors.

The community-expected (light-mode) colors are:

| Category | Color |
| --- | --- |
| Trade 1 | `#b45f06` (burnt orange) |
| Trade 2 | `#b45f06` (burnt orange) |
| Ultra Rare | `#9900ff` (violet) |
| Premium | `#ff0000` (red) |
| Bonus | `#34a853` (green) |
| Preorder | `#00c7ff` (cyan) |
| Golden Ticket | `#bf9000` (gold) |

These are the colors people *expect*; a few of them are too light to read on a
white or dark background as-is, so the site keeps the recognizable hue but
adjusts lightness per theme for legibility. The exact rendered values and the
readability reasoning live in the implementation doc — see
[Theming](./data-and-transformations.md#11-theming-lightdark-and-category-colors).

## Why track and publish this data

For several years the project maintainer has recorded the final sale prices from
each auction and shared them with the community as a public reference. Knowing the
recent selling prices helps people:

- **Bid intelligently** — understand what a token typically goes for before
  committing money in an auction.
- **Judge a deal** — see whether a current auction is running high or low relative
  to history.
- **Track trends** — watch how a token's value moves over a season as supply and
  demand shift.

Two views matter most to the community:

1. **Full-season statistics** — the minimum, maximum, and average sale price of
   each component across *all* auctions in the season. This is the long-run
   picture.
2. **Recent statistics** — the same min/max/average, but restricted to the **five
   most recent auctions** in the season. This captures the *current* market, which
   can differ substantially from the season-long average as prices drift over time.

## Transmutes: crafting and the build-vs-buy decision

Beyond simply buying tokens, players can **craft** — or "transmute" — a more powerful
token from a set of cheaper ones, much like a crafting system in a computer RPG. Each
transmute has a **recipe**: a bill of materials listing quantities of other tokens
required to make it. Recipe ingredients are mostly trade goods and `Ultra Rare`s,
and occasionally `Premium` items. A meaningful minority come from **treasure**
rather than auctions — the `Treasure Chest` category, covering Monster Trophies
and chase sets — and those are never auctioned at all (see below).

Crucially, **transmuted tokens are not sold in the auctions.** The auctions distribute
tokens bought directly from the game's first-party creator; transmutes are made by players
and bought/sold through third-party resellers. So there is no auction price to look up for a
transmute. Instead, the community **estimates the cost to craft one**: for each ingredient in
the recipe, multiply its recent auction price (either the **average** or the **minimum**) by
the quantity required, then sum. That total is the **build** cost.

Players weigh that estimated build cost against the price of simply **buying** the finished
transmute from a reseller — the **build-vs-buy** decision the tracking data exists to inform.

Transmutes are ranked by **in-game power level**, but the company gives one power level
different **names** depending on how the ingredients are gathered — so the level names are not a
simple linear list. The power tiers, low to high (maintainer-confirmed):

1. `Enhanced`
2. `Exalted`
3. `Relic`
4. `Arcanum` / `Eldritch` — **the same power tier**. Both use multi-year ingredients; the two
   names are just successive "sets" (like MMO gear sets — when one set is completed the company
   opens a new one in its place), so a given season shows one or the other, never both.
5. `Legendary`
6. `Mythic`

Four token types sit **outside** this ladder:
- **Safehold** — a separate, self-contained upgrade chain numbered in descending Roman numerals
  (`Safehold V` → `IV` → `III` → `II` → `I`, where V is the entry level and I the top).
- **Ultra Rare** and **Paragon** — concerned exclusively with the 8k-bonus tokens, intended as
  rewards for the largest purchasers. The 8k-bonus tokens of consecutive seasons form a **named
  set** that eventually transmutes into that reward, and the company **renames the set every few
  years** when one is completed and a new one opens. So unlike every other grouping the site
  charts, this one's heading is a function of the season:

  | Seasons | Set name |
  |---|---|
  | 2015–2022 | Orb of Dragonkind |
  | 2023–2026 | Path to Enlightenment |
  | 2027–2029 | Codex of the Familiar |

  The site keeps the *grouping* stable (`8k Bonus Set` in `tokenGroups.csv`) and resolves the
  *heading* per season from `GROUP_SEASON_LABELS` in `src/lib/eras.ts`, so a 2019 chart reads
  "Orb of Dragonkind" while a 2026 chart reads "Path to Enlightenment". Add the next range there
  when the following set is announced — see `docs/updating-the-data.md`.
- **Omni** — a "wildcard" transmute meant to soak up excess trade goods in the market; it has no
  in-game function of its own.

A higher-tier recipe can require a lower-tier token as a **source** ingredient — most notably,
23 of the game's Legendaries upgrade from a same-season Relic (some Legendaries have no source).
When a recipe consumes a source that is itself craftable, its cost is estimated from *its* recipe
in turn. The Transmutes page orders each season by these tiers, but leads with the Relic→Legendary
pairs (source Relic immediately above the Legendary it feeds), since those are what players build
most; `Mythic` is placed last despite its power because only the largest spenders craft them.
The tier order lives as `TIER_ORDER` / `orderSeason` in `src/lib/transmutes.ts`.

Some ingredients are **not sold at auction** at all (most notably **Golden Fleece**) yet are still
required by recipes and still fluctuate in price year to year. These are tracked **manually**
so build costs remain complete.

## Onyx orders

**Onyx** is a special order type. Instead of letting a buyer choose specific Ultra Rares,
an Onyx order replaces a portion of them with versions in an **alternate color**
(black/onyx) — a fixed list of one of each Ultra Rare in the set.

Onyx is **not** related to *chase*. Chase tokens are treasure-only tokens forming a
numbered set (1 of 20, 1 of 40) whose complete set feeds a special transmute; they never
appear in an auction. The two are both scarce and otherwise unconnected. Onyx tokens sell through the auctions like
other components and have their own price history, tracked separately from the main
Ultra Rare list.

## From spreadsheet to website

Historically this information lived in Google Sheets: one workbook held the raw
data, and a second "presentation" workbook used queries to compute and display the
min/max/average figures. That approach became hard to maintain and was not a great
experience to share.

This website replaces the presentation layer. It takes the **raw sale records** as
input and computes all statistics on demand, so the maintainer only ever has to
append new sales — the site derives every view from that single source. The domain
concepts above (tokens, auctions, seasons, the two statistical views) are what the
website is ultimately built to present.

## Glossary

| Term | Meaning |
| --- | --- |
| **Token** | A physical collectible piece representing a character's gear/item. |
| **Set** | The annual release of new tokens. |
| **Group buy** | A pooled bulk order that many participants fund together. |
| **Auction** | The bidding process that decides who pays what and receives which tokens within a group buy. |
| **Auctioneer** | A community member who organizes and runs a particular auction. |
| **Season** | All auctions belonging to one annual set; does not align to the calendar year. |
| **Auction number** | The sequential index of an auction within its season. |
| **Component / Item** | A thing sold in an auction (a token or a bundle such as a premium/bonus item). |
| **Full-season stats** | Min/max/average sale price of an item across every auction in the season. |
| **Last-5 stats** | Min/max/average across the five most recent auctions in the season. |
| **Status / outcome** | Whether an auction `Closed`, `Failed`, or is `Open`. Auction counts on the site include only `Closed`. |
| **Close date** | The date an auction closed; used to label the recent ("Last 5") window. |
| **Transmute** | A more powerful token *crafted* from other tokens rather than bought at auction. |
| **Recipe** | The bill of materials for a transmute: the tokens and quantities needed to craft it. |
| **Build cost** | Estimated cost to craft a transmute: Σ (ingredient quantity × its auction avg or min price). |
| **Build-vs-buy** | The decision to craft a transmute yourself vs. buy the finished one from a reseller. |
| **Source token** | A lower-tier token consumed as an ingredient when crafting a higher-tier one (e.g. a Relic inside a Legendary). |
| **Tier / level** | A transmute's rank on the upgrade ladder (Relic, Legendary, Arcanum, …; Safehold V–I). |
| **Onyx** | A special order that swaps part of a buyer's Ultra Rares for versions with an alternate color (black/onyx). Unrelated to *chase*. |
| **Chase** | Treasure-only tokens forming a numbered set (1 of 20, 1 of 40); a complete set feeds a special transmute. Never auctioned. |
| **Treasure Chest** | The category for treasure-sourced recipe ingredients — Monster Trophy, chase sets. Priced off-auction. |
| **Golden Fleece** | A recipe ingredient not sold at auction, whose price is tracked manually. |
| **Augment** | A prior-season transmute an auctioneer may bundle into an auction to help it fund. |
| **Trade good** | A `Trade 1` or `Trade 2` token; the raw material of transmuting. |
| **Condensed** | Sold pre-transmuted into trade goods rather than as Rare/Uncommon. Styles: Super Condensed, Ultra Condensed. |
| **Chase** | A scarce variant — the fixed list of one of each Ultra Rare in the set. Also used of treasure-only rarities. |
| **Treasure pull** | A token received from *playing* rather than bought. Tracked by a sibling project, not this site. |
| **Event** | One occasion of play — a convention, virtual run, or special. The treasure axis, not the auction axis. |
