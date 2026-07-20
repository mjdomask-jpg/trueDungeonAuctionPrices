# Domain Context

This document explains the real-world problem the website exists to solve, for
anyone (contributor, future maintainer, or curious community member) who needs to
understand *why* the data looks the way it does before touching *how* it is
processed.

## What True Dungeon is

True Dungeon is an interactive, tabletop-style dungeon adventure played at
conventions. Players equip a Dungeons & Dragons-like character using physical
**tokens** — collectible coins/pieces that represent gear, weapons, potions,
trade goods, and other items. A character's build is assembled from these tokens,
so the tokens have real value to players and collectors.

Each year the company releases a **new set** of tokens. Because a new set comes
out annually, there is a recurring, time-boxed market for acquiring that year's
tokens.

## How people acquire a set: the group buy

The primary way the community buys a new set is through a **group buy**: many
people pool their money into a single large order (often an "8K" order, referring
to a funding target). Pooling unlocks bulk pricing and bonus/premium items that an
individual could not obtain alone.

The challenge with a group buy is fairness: once the single bulk order arrives, the
group must decide **who pays how much** and **who receives which tokens**. This is
resolved with an **auction**.

## The auction system

Within each group buy, the components of the order are **auctioned** among the
participants:

- People **bid** on the individual components (specific tokens, or bundles like
  premium/bonus items) they want.
- The high bidder **wins** those tokens and pays their bid.
- The collected bids fund the order.

Different auctions run in different **styles** (e.g. "Lightning", "Regular",
"Super Condensed", "Ultra Condensed", "Onyx", "Safehold" variants), and complete
in different ways. Many different community members act as **auctioneers** and run
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

## Category color conventions

Every component sold falls into a **category** — `Trade Good`, `Ultra Rare`,
`Premium`, `Bonus`, `Preorder`, or `Golden Ticket`. These aren't just internal
labels: within the community each category has a **customarily associated color**,
familiar from the tokens and from years of the maintainer's spreadsheets. Members
recognize a category partly by its color, so the site color-codes each category's
table heading to match those expectations rather than picking arbitrary colors.

The community-expected (light-mode) colors are:

| Category | Color |
| --- | --- |
| Trade Good | `#b45f06` (burnt orange) |
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
required to make it. Recipe ingredients are mostly `Trade Good`s and `Ultra Rare`s, and
occasionally `Premium` items.

Crucially, **transmuted tokens are not sold in the auctions.** The auctions distribute
tokens bought directly from the game's first-party creator; transmutes are made by players
and bought/sold through third-party resellers. So there is no auction price to look up for a
transmute. Instead, the community **estimates the cost to craft one**: for each ingredient in
the recipe, multiply its recent auction price (either the **average** or the **minimum**) by
the quantity required, then sum. That total is the **build** cost.

Players weigh that estimated build cost against the price of simply **buying** the finished
transmute from a reseller — the **build-vs-buy** decision the tracking data exists to inform.

Transmutes come in tiers that form an upgrade ladder, roughly:
`Enhanced`/`Exalted` → `Relic` → `Legendary` → `Arcanum` → `Paragon` → `Mythic` →
`Eldritch` → `Omni`. **Safehold** is a separate line with its own upgrade chain, numbered in
descending Roman numerals (`Safehold V` → `IV` → `III` → `II` → `I`, where V is the entry
level and I the top). A higher-tier recipe can require a lower-tier token as a **source**
ingredient — e.g. some (not all) Legendaries consume a Relic. When a recipe consumes a
source token that is itself craftable, its cost can in turn be estimated from *its* recipe.

Some ingredients are **not sold at auction** at all (most notably **Fleece**) yet are still
required by recipes and still fluctuate in price year to year. These are tracked **manually**
so build costs remain complete.

## Onyx orders

**Onyx** is a special order type. Instead of letting a buyer choose specific (non-chase)
Ultra Rares, an Onyx order replaces a portion of the Ultra Rares with **chase** versions — a
fixed list of one of each Ultra Rare in the set. Onyx tokens sell through the auctions like
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
| **Onyx** | A special order that swaps part of the Ultra Rares for a fixed set of chase versions. |
| **Fleece** | A recipe ingredient not sold at auction, whose price is tracked manually. |
| **Augment** | A prior-season transmute an auctioneer may bundle into an auction to help it fund. |
