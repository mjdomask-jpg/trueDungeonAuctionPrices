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
public/data/auctionMetadata.csv ─┘
```

The aggregation logic lives in [`src/lib/data.ts`](../src/lib/data.ts) and is
exercised/verified by the standalone script [`scripts/validate.mjs`](../scripts/validate.mjs).

## Application structure

The app is a small React + Vite single-page app with client-side routing
(`react-router-dom`, **HashRouter**). As of the Phase 0 refactor (see
[expansion-plan.md §5](./expansion-plan.md)), responsibilities are split as:

| Module | Responsibility |
| --- | --- |
| `src/main.tsx` | Mounts `HashRouter`, wraps the tree in `AuctionDataProvider`, declares routes. |
| `src/App.tsx` | Layout shell: the `.wrap` container, `SiteHeader`, and an `<Outlet/>` for the routed page. |
| `src/pages/DashboardPage.tsx` | The price dashboard — season/category controls, stats text, per-category tables. Owns `CATEGORY_ORDER`. |
| `src/components/` | `SiteHeader`, `ThemeToggle`, and `CategoryTable` (owns `BANDED_CATEGORIES` and the row rendering). |
| `src/hooks/useTheme.ts` | Light/dark theme state (see §11). |
| `src/lib/data.ts` | Pure parse/filter/join/aggregate logic (below). |
| `src/lib/format.ts` | Presentation helpers `money` and `fmtCloseDate`. |
| `src/data/AuctionDataProvider.tsx` + `auctionDataContext.ts` | Load-once shared data, exposed via `useAuctionData()`. |
| `src/nav.ts` | Top-level nav entries; the nav bar stays hidden until there is more than one. |

**Routing uses HashRouter deliberately.** `vite.config.ts` sets `base: './'` for GitHub
Pages subpath hosting; hash-based routing then works from any subpath with no server
rewrites and no asset-path breakage on deep links. (Switching to clean URLs later would
require a host with an SPA fallback and an absolute `base`.)

**Data loading is centralized.** The fetch/parse no longer lives in a page:
`AuctionDataProvider` fetches and parses both CSVs **once** and exposes
`{ sales, meta, loading, error }` through the `useAuctionData()` hook, so every current and
future page reads the same parsed rows. When the deferred build-time CSV→JSON step lands,
only this provider changes.

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
| `Category` | Groups related items. The values the site renders as separate tables, in fixed display order, are: `Trade 1`, `Trade 2`, `Ultra Rare`, `Premium`, `Bonus`, `Preorder`, `Golden Ticket`. Any other/unknown category is still shown, appended alphabetically after these. |

### `auctionMetadata.csv` — the auction log (one row per auction)

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

- **Table order** follows the fixed `CATEGORY_ORDER` in `src/pages/DashboardPage.tsx`: Trade 1,
  Trade 2, Ultra Rare, Premium, Bonus, Preorder, Golden Ticket (unknown categories appended
  alphabetically). Each table has the category name as an `<h2>` header above it.
- **Rows within a table** are sorted **alphabetically by `Display Name`** (token
  name), independent of the `Item` grouping key.
- **Columns** (left to right): `Token` (the `Display Name`), then **Last 5
  Auctions** — Max / Avg / Min — then **Full Season** — Max / Avg / Min. The two
  `Avg` cells are emphasized (bold). There is no longer an Item column, a Sales
  (count) column, or an in-row Category column (the category is the table header).
- **Token column width** is set as a **percentage** (`32%`) shared across all
  tables (via `table-layout: fixed` + a `<colgroup>`). Because every table has
  the same overall width, the percentage yields an identical Token-column width
  table-to-table (so columns still line up), while also **shrinking with the
  viewport** instead of staying pinned — this was previously a fixed `320px`,
  which crushed the number columns on narrow/mobile screens. Long token names
  wrap on whole words within the column (`white-space: normal` with the default
  `overflow-wrap`, so words never break mid-word); on very narrow screens the
  number columns can no longer all fit and the table scrolls horizontally inside
  its card (`.tablewrap { overflow-x: auto }`) rather than squishing.
- **Row banding**: only the **Trade 1**, **Trade 2**, and **Premium** tables get alternating
  row striping (`BANDED_CATEGORIES` in `src/components/CategoryTable.tsx`, `.banded` CSS). The stripe is
  applied at the `<tr>` level so the Last-5 column tint and hover highlight paint
  correctly over it.
- **Category heading colors**: each `<section>` carries a `data-category`
  attribute, and its `<h2>` header (text + underline) is tinted with the
  category's brand color via a `--cat-color` CSS variable. Colors differ per
  theme — see [Theming](#11-theming-lightdark-and-category-colors) below.

### 9. Header text and the season stats line

Two blocks of live-computed text sit above the tables:

- **Intro sentence** (global, across *all* seasons): total `Closed` auctions, the
  first and most recent seasons present in the data, and the total number of
  recorded sales. Counts are comma-formatted.
- **Season stats line** (for the selected season): the number of `Closed` auctions
  in that season, and the **close dates of the five auctions in the "Last 5"
  window**, formatted as `Mon DD` (three-letter month, zero-padded two-digit day —
  e.g. `Apr 09`) via `fmtCloseDate` in `src/lib/format.ts`. If a close date is missing it
  falls back to `#<auctionNumber>`. This replaced an earlier line that showed the
  window as an auction-number range and a distinct-item count.

### 10. Typography

Set in `src/index.css`. Body/heading text uses a **Georgia** serif stack; the page
title and category headers (`h1`, `h2`) additionally use the bundled **Caslon
Antique** display font (`src/assets/fonts/casbantn-webfont.ttf`, declared via
`@font-face`). Price **numbers** deliberately use a clean sans stack with
`lining-nums tabular-nums` so digits align in columns.

### 11. Theming: light/dark and category colors

The site supports **light and dark modes**. All colors are CSS custom
properties defined in `src/index.css`; the dark palette is applied whenever
`<html>` carries `data-theme="dark"` (not via `prefers-color-scheme`, so a
manual override can win).

- **Default + auto-follow.** An inline script in `index.html` runs before first
  paint and stamps `data-theme` onto `<html>` — using the visitor's saved choice
  from `localStorage` (`theme` = `light`|`dark`) if present, otherwise the OS
  `prefers-color-scheme`. Running before paint avoids a flash of the wrong theme.
- **Manual toggle.** A ☾/☀ button in the header (`.theme-toggle`, the `ThemeToggle`
  component, wired by the `useTheme` hook in `src/hooks/useTheme.ts`) flips the theme, writes the choice to
  `localStorage`, and stops auto-following the OS. Until the visitor clicks, the
  site keeps following live OS changes via a `matchMedia` listener.

**Category heading colors.** Each category's heading color is defined per theme
in `src/App.css` (`.cat-section[data-category='…']` for light, and
`:root[data-theme='dark'] .cat-section[data-category='…']` for dark). Light mode
uses the brand colors the community expects (see
[domain-context.md](./domain-context.md#category-color-conventions)); the dark
variants are **hue-matched but lightened** so headings stay readable (~4.5:1+
contrast) on the dark background. The color is applied to the heading text and
its underline only — never to the price numbers, to protect their legibility.

| Category | Light | Dark | Note |
| --- | --- | --- | --- |
| Trade 1 | `#b45f06` | `#e08b3e` | |
| Trade 2 | `#b45f06` | `#e08b3e` | |
| Ultra Rare | `#9900ff` | `#c084fc` | |
| Premium | `#ff0000` | `#f87171` | |
| Bonus | `#34a853` | `#4ade80` | brand green sits near the light-mode contrast floor (~2.9:1); kept as-is |
| Preorder | `#0e7490` | `#00c7ff` | brand cyan `#00c7ff` is unreadable on white (~1.9:1), so light mode uses a darkened cyan; dark mode uses the bright brand value |
| Golden Ticket | `#8a6900` | `#facc15` | darkened from brand `#bf9000` in light mode for readability, brightened in dark |

> When adding a new category, give it a `--cat-color` entry in **both** the light
> and dark blocks of `src/App.css`, and contrast-check each value against the
> respective background (`#f7f8fa` light, `#0f1117` dark) — aim for ≥3:1 for
> these large bold headings, ideally 4.5:1+.

## Updating the data

1. Append new sales to the source sales file and, if a new auction was added, add a
   row to the metadata file.
2. Export both sheets to CSV and replace `public/data/prices.csv` and
   `public/data/auctionMetadata.csv`.
3. Redeploy (or just reload in development). All statistics recompute automatically
   from the new raw rows — there are no precomputed values to update by hand.

**Export straight into `public/data/`.** There is no staging copy elsewhere and no
sync step: the file the spreadsheet writes is the file the site serves and the file
the validators check. The exports are `prices.csv`, `auctionMetadata.csv`,
`tokenMetadata.csv`, `transmuteRecipes.csv`, `offAuctionPrices.csv` and `onyx.csv`;
`derivedPrices.csv` and `tokenGroups.csv` are hand-authored here and have no sheet
behind them.

After any export, run `npm run validate` — it fails loudly, naming the exact
column, if the sheet's headers drift from the shared `Item` / `auctionSeason` /
`Display Name` / `Category` vocabulary.

## Validation

`scripts/validate.mjs` (`node scripts/validate.mjs [season]`) runs the same
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
