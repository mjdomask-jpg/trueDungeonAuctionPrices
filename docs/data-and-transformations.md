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
| `Category` | Groups related items. The values the site renders as separate tables, in fixed display order, are: `Trade Good`, `Ultra Rare`, `Premium`, `Bonus`, `Preorder`, `Golden Ticket`. Any other/unknown category is still shown, appended alphabetically after these. |

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
| `closeDate` | Yes | Date the auction closed, ISO `YYYY-MM-DD`. Used to label the "Last 5" window in the season stats line. Blank for still-open auctions; older seasons store `n/a`. |
| `openDate`, `daysToClose` | Optional | Other timing fields. Older seasons store `n/a`. |
| `Status` | Yes (filter) | Auction outcome: `Closed` (completed), `Failed` (did not fund/complete), `Open` (in progress). The site's auction counts include **only `Closed`**. |
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

Average is a simple arithmetic mean of the sale prices in the window. The **count**
(`n`) is still computed but is **not currently displayed** in the table (the former
"Sales" column was removed); it remains available in `ItemRow` for future use.

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

- **Season** selector — chooses which season is aggregated and displayed.
- **Category** filter (or "All") — when a single category is chosen, only that
  category's table is shown.

> A free-text **Search** box existed in the first iteration and was **removed**.
> The filter logic still matches on both `Item` and `Display Name` internally, so
> reinstating search would not require re-plumbing the data layer.

### 8. Rendering: per-category tables

The rows are rendered as **one table per category** (not a single combined table):

- **Table order** follows the fixed `CATEGORY_ORDER` in `src/App.tsx`: Trade Good,
  Ultra Rare, Premium, Bonus, Preorder, Golden Ticket (unknown categories appended
  alphabetically). Each table has the category name as an `<h2>` header above it.
- **Rows within a table** are sorted **alphabetically by `Display Name`** (token
  name), independent of the `Item` grouping key.
- **Columns** (left to right): `Token` (the `Display Name`), then **Last 5
  Auctions** — Max / Avg / Min — then **Full Season** — Max / Avg / Min. The two
  `Avg` cells are emphasized (bold). There is no longer an Item column, a Sales
  (count) column, or an in-row Category column (the category is the table header).
- **Token column width** is fixed at `320px` and shared across all tables (via
  `table-layout: fixed` + a `<colgroup>`), so the column lines up table-to-table;
  long token names wrap within it.
- **Row banding**: only the **Trade Good** and **Premium** tables get alternating
  row striping (`BANDED_CATEGORIES` in `src/App.tsx`, `.banded` CSS). The stripe is
  applied at the `<tr>` level so the Last-5 column tint and hover highlight paint
  correctly over it.

### 9. Header text and the season stats line

Two blocks of live-computed text sit above the tables:

- **Intro sentence** (global, across *all* seasons): total `Closed` auctions, the
  first and most recent seasons present in the data, and the total number of
  recorded sales. Counts are comma-formatted.
- **Season stats line** (for the selected season): the number of `Closed` auctions
  in that season, and the **close dates of the five auctions in the "Last 5"
  window**, formatted as `Mon DD` (three-letter month, zero-padded two-digit day —
  e.g. `Apr 09`) via `fmtCloseDate` in `src/App.tsx`. If a close date is missing it
  falls back to `#<auctionNumber>`. This replaced an earlier line that showed the
  window as an auction-number range and a distinct-item count.

### 10. Typography

Set in `src/index.css`. Body/heading text uses a **Georgia** serif stack; the page
title and category headers (`h1`, `h2`) additionally use the bundled **Caslon
Antique** display font (`src/assets/fonts/casbantn-webfont.ttf`, declared via
`@font-face`). Price **numbers** deliberately use a clean sans stack with
`lining-nums tabular-nums` so digits align in columns.

## Updating the data

1. Append new sales to the source sales file and, if a new auction was added, add a
   row to the metadata file.
2. Export both sheets to CSV and replace `public/data/prices.csv` and
   `public/data/metadata.csv`.
3. Redeploy (or just reload in development). All statistics recompute automatically
   from the new raw rows — there are no precomputed values to update by hand.

## Validation

`validate.mjs` (kept in `C:\claude\`, outside the site repo) runs the same
parse/filter/join/aggregate pipeline outside the browser for a single season and
prints the resulting table, including both candidate "last 5" definitions side by
side. It exists to confirm the site's numbers against the historical spreadsheet
whenever the logic or data changes.

## Deployment

The site is hosted on **GitHub Pages** and deployed by a single GitHub Actions
workflow, `.github/workflows/deploy.yml`, which runs on every push to `main`:
`npm ci` → `npm run build` → publish the built `dist/`. Live URL:
<https://mjdomask-jpg.github.io/trueDungeonAuctionPrices/>.

Because the site is served from a repo subpath, `vite.config.ts` sets
`base: './'` so all asset/data URLs are relative. Keep that in place, and reference
bundled assets (fonts, etc.) through `src/` imports/relative URLs so Vite
fingerprints them for the subpath — do **not** hardcode absolute `/…` paths.

> Only `deploy.yml` should deploy. A second auto-generated `static.yml` workflow
> (which published the *unbuilt* repository and would break the site) was removed;
> don't reintroduce a raw-upload Pages workflow alongside the Vite build.
