# Data & Transformations

This document describes the data the website consumes and every transformation it
applies to turn raw auction sales into the statistics shown on screen. For the
real-world meaning behind these fields, see [domain-context.md](./domain-context.md).

## Overview

The site is **static and read-only**. There is no server or database. Two CSV files
are the single source of truth; the browser fetches them at load time, parses them,
joins them, filters them, and computes all statistics live. To update the site, the
maintainer replaces a CSV — nothing else changes.

```
public/data/prices.csv  ─┐
                          ├─►  parse ─► filter ─► join ─► aggregate ─► render
public/data/metadata.csv ─┘
```

The aggregation logic lives in [`src/lib/data.ts`](../src/lib/data.ts) and is
exercised/verified by the standalone script `validate.mjs` at the repository root.

## Source data

### `prices.csv` — the sales log (one row per sale)

Each row is a single component sold in a single auction. This is the raw,
append-only data the maintainer maintains.

| Column | Description |
| --- | --- |
| `auctionId` | Unique auction key: season concatenated with auction number (e.g. `20263`). Used to join to metadata. |
| `auctionSeason` | The season the auction belongs to (e.g. `2026`). |
| `auctionNumber` | Sequential auction index within the season. Used to order auctions by recency. |
| `Item` | The internal, **stable** label for the thing sold (e.g. `8k Bonus`, `PYP`, `1k Bonus`). Stable across seasons, so it is used as the grouping key. |
| `Price` | The final sale price, as a number (may carry stray whitespace from export). |
| `Display Name` | The public, human-facing token name (e.g. `Orb of Dragonkind`). **Changes from season to season** even when the `Item` label stays the same. |
| `Category` | Groups related items: `Trade Good`, `Premium`, `Bonus`, `Preorder`, `Ultra Rare`, `Patron`, `Golden Ticket`, and others. |

### `metadata.csv` — the auction log (one row per auction)

Each row describes one auction. Only a subset is used for public display; the rest
is back-office information retained for reference.

| Column | Used by site? | Description |
| --- | --- | --- |
| `auctionId` | Yes (join key) | Matches `auctionId` in the sales log. |
| `auctionSeason`, `auctionNumber` | Yes | Season and sequence index. |
| `auctionName` | Yes | Human-readable auction name. |
| `auctioneer` | Optional | Who ran the auction. |
| `auctionStyle`, `completionStyle` | Optional | How the auction was run/closed. |
| `Link` | Optional | URL to view the original auction. |
| `openDate`, `closeDate`, `daysToClose` | Optional | Timing. Older seasons store `n/a`. |
| `Status` | Yes (filter) | e.g. `Closed`, `Failed`. |
| `targetFunding`, `augment*`, `fundingNoAugment`, `preorderTotal`, month fields | No | Financial/back-office fields not surfaced publicly. |

### The relationship between the two files

The files are linked by **`auctionId`** (season + auction number). This key is an
internal join mechanism and is **not** presented as public information. Keeping the
two files separate keeps the sales log narrow (five meaningful columns) and avoids
duplicating auction-level attributes on every sale row.

> Note: an earlier version of the exported sales file *also* embedded the
> auction-level columns on every row (the result of a spreadsheet query join).
> Those redundant columns were removed; the site re-creates the join in code.

## Transformations

The following steps are applied, in order, entirely in the browser.

### 1. CSV parsing

A small RFC-4180-compliant parser (`parseCSV` in `src/lib/data.ts`) is used rather
than naive comma splitting, because some values legitimately contain commas inside
quotes — e.g. the item literally named `"1,000 GP Gold Bar"`. Naive splitting would
corrupt those rows. Header names are trimmed of surrounding whitespace (the export
produces headers like `" Price "`).

### 2. Cleaning / row filtering

- **Blank rows are dropped.** The export appends a block of completely empty rows
  (just commas). Any row without an `auctionId` is discarded.
- **Non-numeric prices are dropped.** `Price` is parsed with commas stripped; if it
  is not a finite number, the row is skipped. This also removes stray/empty prices.
- Values are trimmed of surrounding whitespace.

### 3. Join

Metadata is loaded into a lookup keyed by `auctionId`. Sales are matched to their
auction via this key when auction-level attributes (name, count of auctions in a
season, etc.) are needed for display.

### 4. Grouping (per season)

For a selected **season**, all of that season's sales are grouped by **`Item`** (the
stable internal label — *not* `Display Name`, which can vary within/between seasons).
Each group represents one component's sales history for the season. For display, the
most recent `Display Name` and the `Category` are attached to the group.

### 5. Statistics

For each item group, the site computes **min**, **max**, **average**, and **count**
of `Price` over two windows:

- **Full season** — every sale of that item in the season.
- **Last 5 auctions** — see the precise definition below.

Average is a simple arithmetic mean of the sale prices in the window.

### 6. The "Last 5 auctions" definition

**"Last 5" means the five most recent auctions in the season overall — not the five
most recent auctions in which a particular item happened to appear.**

Concretely:

1. Within the season, take the set of auction numbers that had any sales.
2. Sort them ascending; the highest five are the "last 5" window.
3. For each item, its last-5 statistics are computed only from its sales that fall
   inside those five auctions.

A consequence: **if an item did not sell in any of those five auctions, its last-5
statistics are empty** (shown as `—`). For example, preorder-only items that stop
appearing later in a season will have full-season numbers but blank last-5 numbers.

> This "overall" definition was chosen to match the behavior of the original
> presentation spreadsheet, confirmed by comparing computed values against it.

### 7. Presentation-time filtering

After aggregation, the UI applies non-destructive view filters that do not change
the underlying statistics:

- **Category** filter (or "All").
- **Search** across `Item` and `Display Name`.

## Updating the data

1. Append new sales to the source sales file and, if a new auction was added, add a
   row to the metadata file.
2. Export both sheets to CSV and replace `public/data/prices.csv` and
   `public/data/metadata.csv`.
3. Redeploy (or just reload in development). All statistics recompute automatically
   from the new raw rows — there are no precomputed values to update by hand.

## Validation

`validate.mjs` (repository root) runs the same parse/filter/join/aggregate pipeline
outside the browser for a single season and prints the resulting table, including
both candidate "last 5" definitions side by side. It exists to confirm the site's
numbers against the historical spreadsheet whenever the logic or data changes.
