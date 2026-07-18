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

## Seasons, not calendar years

A set's buying window does **not** line up with the calendar year. Auctions for a
given set begin in the fall and continue into the following year. To handle this,
the data uses the concept of a **season** rather than a calendar year. A season
groups together all the auctions that belong to one annual set release.

Within a season, each auction is numbered sequentially (auction 1, 2, 3, …). The
combination of season + auction number uniquely identifies a single auction.

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
