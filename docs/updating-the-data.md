# Updating the data — the full runbook

Everything on the live site is computed from eight CSV files in `public/data/`.
Six of them are exported from the Google Sheet; two are edited by hand. Nothing
is precomputed and nothing is stored in a database — change a CSV, and every
number, chart and table recomputes itself.

This document assumes no prior knowledge. Work top to bottom the first time.

> **Keeping this document accurate:** it describes column names, filenames and
> commands that live in the repo. If any of those change, this file must change
> in the same commit. See [Maintaining this document](#maintaining-this-document)
> at the end.

---

## The big picture

```
  1. Edit             2. Export            3. Place              4. Check
  Google Sheet   →    tab as CSV      →    public/data/     →    npm run validate
                                                                      ↓
  7. Verify           6. Deploy            5. Commit               (fix & repeat
  the live site  ←    GitHub Actions  ←    and push         ←       if it fails)
```

Steps 1–3 are manual. Steps 4–7 are the same regardless of which file you
changed. Only step 2's details differ per file — that's what the per-file
sections below cover.

**Live site:** <https://mjdomask-jpg.github.io/trueDungeonAuctionPrices/>

---

## One-time setup

You need these once. Skip if you've done them before.

1. **Node.js** — check with `node --version`. Any recent version works; CI uses
   Node 20+. If the command isn't found, Node may be installed but not on your
   `PATH` (see [Troubleshooting](#troubleshooting)).
2. **The repository**, cloned somewhere local. The working copy referenced
   throughout is `C:\claude\site`.
3. **Dependencies** — run once inside the repo:

   ```bash
   npm install
   ```

4. **Write access** to the GitHub repository, so `git push` works.

---

## The standard loop

This is identical for every file. The per-file sections only tell you what to
edit and what the rules are.

### Step 1 — Edit the Google Sheet

Make your change in the sheet, not in the CSV. The sheet is the source of truth;
a CSV edited directly will be silently overwritten by the next export.

Which tab, and what the rules are, is covered per file below.

### Step 2 — Export that tab to CSV

In Google Sheets: **File → Download → Comma Separated Values (.csv)**.

This exports **only the tab you are currently viewing**. Select the right tab
first.

Google names the download `<SpreadsheetName> - <TabName>.csv` — for example
`auctionData - tokenMetadata.csv`. **The repo needs a different, exact
filename.** Rename on save, or rename afterwards. The per-file sections give the
required name.

### Step 3 — Put the file in `public/data/`

Move the renamed file into `public/data/`, replacing what's there.

Do not put it anywhere else. There is no staging folder and no sync step — the
file the sheet exports is the file the site serves and the file the validators
check.

### Step 4 — Validate

From the repo root:

```bash
npm run validate
```

You want:

```
--- 0 errors, 0 warnings ---
```

`INFO` lines are normal and can be ignored — they explain routine things like a
season with no auction data falling back to an earlier season's prices.

If you see `ERROR` or `WARN`, **stop and fix it before committing.** See
[Troubleshooting](#troubleshooting) for what each message means. Fix it in the
Google Sheet and re-export — not in the CSV, or your fix disappears next time.

### Step 5 — Check it in a browser (optional but recommended)

```bash
npm run dev
```

Open <http://localhost:5173> and look at the pages your change should have
affected. Stop the server with `Ctrl+C` when done.

> **Windows note:** stop the dev server before any `git` branch operation. While
> running, it locks the CSVs and git fails with `unable to unlink … Invalid
> argument`.

### Step 6 — Commit and push

```bash
git add public/data
git commit -m "Add 2026 auction 47 results"
git push
```

If you are working on `main`, that's it — the push triggers the deploy.

For a larger or riskier change, use a branch so you can review it first:

```bash
git checkout -b update-2026-auction-47
git add public/data
git commit -m "Add 2026 auction 47 results"
git push -u origin update-2026-auction-47
```

Then open a pull request on GitHub and merge it. Deployment happens on merge to
`main`, not on the branch push.

### Step 7 — Watch the deploy, then verify

Pushing to `main` triggers the **Deploy to GitHub Pages** workflow
(`.github/workflows/deploy.yml`): `npm ci` → `npm run build` → publish `dist/`.
It takes roughly a minute.

Watch it under the repository's **Actions** tab, or:

```bash
gh run watch
```

A green run means the build succeeded and `dist/data` matched `public/data`. Then
open the live site and confirm your change is visible.

> **The deploy does not run `npm run validate`.** A build can go green while the
> data has a problem the validator would have caught. Step 4 is not optional.

> **Browser caching:** if the live site looks unchanged, hard-reload
> (`Ctrl+Shift+R`). The CSVs are fetched at runtime and your browser may hold an
> old copy.

---

## Which file do I need?

| I want to… | File |
|---|---|
| Add a new auction, or mark one closed | [`auctionMetadata.csv`](#auctionmetadatacsv) |
| Add the token sale results from an auction | [`prices.csv`](#pricescsv) |
| Add Onyx chase-token sale results | [`onyx.csv`](#onyxcsv) |
| Add a new season's tokens, or fix a token's name/class | [`tokenMetadata.csv`](#tokenmetadatacsv) |
| Add or change a transmute recipe | [`transmuteRecipes.csv`](#transmuterecipescsv) |
| Price something never sold at auction (Golden Fleece, etc.) | [`offAuctionPrices.csv`](#offauctionpricescsv) |
| Change chart groupings or line colours | [`tokenGroups.csv`](#hand-authored-files) |
| Change how a reward-only token is priced | [`derivedPrices.csv`](#hand-authored-files) |

A new auction with results typically means **two** files:
`auctionMetadata.csv` (the auction itself) and `prices.csv` (what sold in it).
Export and place both, then validate once.

---

## Shared rules

These apply to every exported file.

**Column names are load-bearing.** Every file uses the same vocabulary:

| concept | column |
|---|---|
| the token, by its stable internal name | `Item` |
| the season | `auctionSeason` (`Year` in the recipe and off-auction tables) |
| the token's public name that season | `Display Name` |
| the token's class | `Category` |

Rename a column header in the sheet and the site stops reading it. `npm run
validate` catches this and names the exact column, but only if you run it.

**`Item` vs `Display Name`.** `Item` is the stable internal handle that never
changes across seasons — `1k Bonus`, `PYP`, `Dwarven Steel`. `Display Name` is
the public token name for that particular season — `Ring of the 1st Circle`.
Everything joins on `Item`. Always write `Item` values exactly as they already
appear; a typo creates a new, unrecognised token rather than an error.

**`Category` must be one of:** `Trade 1`, `Trade 2`, `Ultra Rare`, `Premium`,
`Bonus`, `Preorder`, `Golden Ticket`, `Condensed`, `Safehold` — plus
`Onyx Ultra Rare` (only in `onyx.csv`) and `Fleece` / `Treasure Chest` (only in
`tokenMetadata.csv`, for tokens never sold at auction). `Trade Good` and `Patron`
are retired — do not reintroduce them.

**Blank rows are fine.** Rows without an `auctionId` (or without the required
key for that file) are dropped on load.

**Currency formatting is fine.** `$110.00` and `1,160.00` both parse; `$` and
thousands separators are stripped.

---

# The files

Each section follows the same shape: what it drives, when to touch it, its
columns, and the rules that will bite you.

---

## `auctionMetadata.csv`

**Export from:** the `auctionMetadata` tab → save as `auctionMetadata.csv`

**Drives:** the auction count on the Prices page, the season list, the
"Last 5" date labels, and the whole **Auction Data** explorer — which shows each
auction's name, close date, style, completion style, auctioneer and forum link.
It does **not** contain any prices.

**Update when:** a new auction opens, an auction closes, or an auction's details
change.

### Columns

| Column | Required | Notes |
|---|---|---|
| `auctionId` | **Yes** | Season + auction number, concatenated: season `2026`, auction `47` → `202647`. Must be unique. Rows without it are dropped. |
| `auctionSeason` | **Yes** | Four-digit year, e.g. `2026`. |
| `auctionNumber` | **Yes** | Sequence within the season, e.g. `47`. |
| `auctionName` | **Yes** | Free text, shown to users. May contain commas — the sheet quotes them correctly on export. |
| `Status` | **Yes** | One of `Closed`, `Failed`, `Open`. |
| `closeDate` | **Yes** | ISO `YYYY-MM-DD`, **zero-padded**. Blank for still-open auctions; older seasons use `n/a`. See the padding warning below. |
| `auctioneer` | Optional | Who ran it. Shown on the explorer and offered as a filter there. |
| `auctionStyle` | Optional | e.g. `Ultra Condensed`, `Super Condensed`, `Onyx Super Condensed`. Shown on the explorer. |
| `completionStyle` | Optional | How the auction closed: `Lightning`, `Semi-Lightning`, `Fixed Date`. Shown on the explorer. |
| `Link` | Optional | URL to the original forum thread; the explorer's "Auction link". |
| `openDate`, `daysToClose`, `Open Month`, `Close Month` | No | Not read by the site. |
| `targetFunding`, `augment*`, `fundingNoAugment`, `preorderTotal` | No | Back-office financials, not surfaced. |

### Rules that matter

- **Only `Status = Closed` auctions are counted.** `Failed` and `Open` auctions
  are loaded but excluded from every count and statistic. Currently 271 of 276
  rows are `Closed`.
- **`closeDate` drives the "Last 5" labels.** The Prices page shows the five most
  recent auctions in a season by date. A missing or wrong `closeDate` puts the
  window in the wrong place.
- **`closeDate` must be zero-padded, and fails silently if it isn't.** The site
  only recognises `YYYY-MM-DD`; a value like `2024-8-13` is treated as *no date
  at all*, so the auction sorts as undated and renders "unknown" rather than
  showing an obviously wrong date. Five rows were in this state until the
  2026-07-22 export. If an auction claims to have no close date, check the
  padding before assuming the cell is empty.
- **`auctionId` is the join key** to `prices.csv` and `onyx.csv`. A sale whose
  `auctionId` has no row here still loads, but the auction has no name or date.

### Gotcha

Marking an auction closed is **two** edits: set `Status` to `Closed` *and* fill
in `closeDate`. Setting only one leaves the auction uncounted or unlabelled.

---

## `prices.csv`

**Export from:** the `auctionPrices` tab → save as **`prices.csv`** (note the
name change)

**Drives:** the Prices page, Timelines, Compare Years, and every build cost on
the Transmutes page. This is the single most important file.

**Update when:** an auction closes and you have its results. 7,349 rows today.

### Columns

| Column | Required | Notes |
|---|---|---|
| `auctionId` | **Yes** | Must match a row in `auctionMetadata.csv`. Rows without it are dropped. |
| `auctionSeason` | **Yes** | Four-digit year. |
| `auctionNumber` | **Yes** | Sequence within the season. |
| `Item` | **Yes** | The stable internal name. Must match existing spelling exactly. |
| `Price` | **Yes** | The sale price. Must parse as a number — `$` and commas are stripped. Rows with a non-numeric price are dropped. |
| `Display Name` | **Yes** | The token's public name that season. |
| `Category` | **Yes** | See the shared list above. |

### Rules that matter

- **One row per sale, not per token.** A token selling three times in one
  auction is three rows. Timelines average them into a single point per auction.
- **`Price` must be numeric.** A `-` is used for a no-sale; those rows are
  dropped rather than counted as $0. Six such rows exist today.
- **This file is the source of truth for `Display Name` and `Category`.** If it
  disagrees with `tokenMetadata.csv`, `prices.csv` wins and `tokenMetadata`
  should be corrected to match.

### Gotcha

Adding sales for a brand-new token means updating `tokenMetadata.csv` too, or
the Transmutes page can't resolve it. The validator will tell you.

---

## `onyx.csv`

**Export from:** the `pricesOnyx` tab → save as **`onyx.csv`** (note the name
change)

**Drives:** the Onyx page only. It is loaded independently — if this file is
missing or empty, the Onyx page is blank and nothing else is affected.

**Update when:** an Onyx chase token sells. About 844 rows today, seasons
2022–2026.

### Columns

Identical to `prices.csv` — same seven columns, same rules, parsed by the same
code.

| Column | Required | Notes |
|---|---|---|
| `auctionId`, `auctionSeason`, `auctionNumber` | **Yes** | As in `prices.csv`. |
| `Item` | **Yes** | The chase token, e.g. `+2 Chaos Cannon`. |
| `Price` | **Yes** | This export writes prices as `$110.00 ` with a dollar sign and trailing space. That's fine — both are stripped. |
| `Display Name` | **Yes** | Usually the same as `Item` here. |
| `Category` | **Yes** | Always `Onyx Ultra Rare`. |

### Gotcha

Onyx sales go **only** here, never in `prices.csv`. Putting them in both
double-counts them.

---

## `tokenMetadata.csv`

**Export from:** the `tokenMetadata` tab → save as `tokenMetadata.csv`

**Drives:** the Transmutes page — it's how a recipe ingredient resolves to a real
token with a name, a class and a price. It also covers seasons that have no
auction data at all (2012–2018, 2027), which is why it has rows `prices.csv`
doesn't.

**Update when:** a new season's tokens are announced, a token's display name or
class changes, or the validator reports an unresolvable ingredient. 427 rows
today.

### Columns

| Column | Required | Notes |
|---|---|---|
| `key` | For authoring | `auctionSeason` and `Item` concatenated with nothing between: `2026` + `PYP` → `2026PYP`. The site ignores it; the recipe sheet's lookup formula depends on it. |
| `auctionSeason` | **Yes** | Four-digit year. Rows with a non-numeric value are dropped. |
| `Item` | **Yes** | The stable internal name. Rows without it are dropped. |
| `Display Name` | **Yes** | That season's public name. Falls back to `Item` if blank. |
| `Category` | **Yes** | See the shared list. May also be `Fleece` or `Treasure Chest` here. |

### Rules that matter

- **One row per (season, token).** The same token gets a separate row for every
  season it exists in, because its display name changes.
- **It must agree with `prices.csv`** on `Display Name` and `Category` for every
  season that has auction data. `prices.csv` wins any disagreement. The validator
  does not currently check this automatically — it was reconciled by hand.
- **A token's `Category` shouldn't vary by season** unless it genuinely was
  reclassified. `Trade 1` / `Trade 2` in particular is a property of the token,
  so it should be the same in every row for that `Item`.
- **`key` must stay consistent** with `auctionSeason` + `Item`. The validator
  checks this.

### Gotcha

This file legitimately contains tokens that were never auctioned — Monster
Trophy, Golden Fleece, Rare Bag. They're recipe ingredients priced through
`offAuctionPrices.csv` or `derivedPrices.csv`. Don't delete them for having no
sales.

---

## `transmuteRecipes.csv`

**Export from:** the `transmuteRecipes` tab → save as `transmuteRecipes.csv`

**Drives:** the entire Transmutes page — every bill of materials and build cost.
1,607 rows covering 146 recipes across 16 seasons.

**Update when:** a new transmute is announced, or a recipe changes.

> This is the most intricate file. A dedicated authoring guide with the sheet
> formulas lives in
> [`transmute-recipes-template.md`](transmute-recipes-template.md) — read it
> before adding recipes. The summary below is for orientation.

### Columns

| Col | Column | Kind | Notes |
|---|---|---|---|
| A | `Key` | formula | `Year|Transmute|Item|ItemYear|IsSource`, pipe-separated. Must be unique. The site ignores it; the validator checks it. |
| B | `Year` | **you type** | The season the *transmute* belongs to. Not the ingredient's season. |
| C | `Level` | **you type** | Tier: `Enhanced`, `Exalted`, `Relic`, `Legendary`, `Arcanum`, `Paragon`, `Mythic`, `Eldritch`, `Omni`, `Safehold`, `Patron`. |
| D | `Transmute` | **you type** | The token being produced. |
| E | `Item` | **you type** | One ingredient, by its `Item` name. |
| F | `ItemYear` | **you type** | The ingredient's season. Blank = same as `Year`. |
| G | `ResolvedYear` | formula | What `ItemYear` resolves to. A read-only sanity check; the site re-derives it. |
| H | `Display Name` | formula | The ingredient's name that season. For your eyes — the site re-derives it. |
| I | `Quantity` | **you type** | How many. Always a whole number, never 0. |
| J | `IsSource` | **you type** | `TRUE` = the token being upgraded *from*; `FALSE` = a consumed ingredient. |

### Rules that matter

- **One row per ingredient.** A recipe with 15 ingredients is 15 rows sharing the
  same `Year` and `Transmute`.
- **`ItemYear` is usually a relative offset.** `-1` means one season before this
  recipe's `Year`, permanently — it does not shift as time passes. Blank is the
  common case. A bare year like `2019` pins it absolutely. Prefer relative, so
  next season's recipes are a copy-and-bump.
- **`Quantity` is always a whole number.** Any decimal is a typo by definition,
  and validation will catch it.
- **The site ignores `Key`, `ResolvedYear` and `Display Name`** and recomputes
  all three, deliberately — a stale formula in the sheet can never corrupt the
  site. But they are what tell *you* whether a row is right, so keep the formulas
  filled down.
- **`Display Name` showing `⚠ check name`** means the `Item` doesn't resolve.
  Fix it before exporting.

### Gotcha

An ingredient can be another transmute (an upgrade ladder). Write its exact name
in the `Transmute` column vocabulary and the engine recurses into that recipe.
The `IsSource` flag is what makes the "I already own this" toggle work.

---

## `offAuctionPrices.csv`

**Export from:** the `pricesFleece` tab → save as **`offAuctionPrices.csv`**
(note the name change)

**Drives:** prices for tokens that exist as recipe ingredients but are never sold
at auction — Golden Fleece, Stalker Token, Herald Token. Only 10 rows.

**Update when:** the going rate for one of these changes, or a new never-auctioned
ingredient appears.

### Columns

| Column | Required | Notes |
|---|---|---|
| `Key` | For authoring | `Year` + `Item` concatenated: `2019Fleece`. |
| `Year` | **Yes** | Four-digit season. |
| `Category` | **Yes** | Note this table uses `Transmute` as a value for Fleece — it's a different vocabulary from the other files and is left alone deliberately. |
| `Item` | **Yes** | The token. Rows without it are dropped. |
| `Display Name` | **Yes** | e.g. `Golden Fleece` for `Item` = `Fleece`. |
| `max Price` | Optional | Falls back to `avg Price` if blank. |
| `avg Price` | **Yes** | Must be numeric — rows without it are dropped. |
| `min Price` | Optional | Falls back to `avg Price` if blank. |

### Rules that matter

- **One row per (season, token).** Add a row per season, as with
  `tokenMetadata.csv`.
- **These are hand-maintained estimates**, not observed sales. The site marks
  them "non-auction item" in a bill of materials and reports a sale count of
  zero.
- **This table overrides derived pricing.** If a token is priced both here and by
  a rule in `derivedPrices.csv`, this file wins.

### Gotcha

The `Item` here is `Fleece`, not `Golden Fleece` — that's the `Display Name`.
Recipes must reference `Fleece`.

---

## Hand-authored files

These two have **no Google Sheet behind them**. Edit them directly in
`public/data/` and commit. They're listed for completeness.

### `tokenGroups.csv`

Controls how tokens are grouped into charts on the Timelines page, and their line
colours. Columns: `Category`, `Item`, `Display Name`, `Group`, `Group Order`,
`Line Color`. Keyed on `Item`; `Display Name` here is an authoring aid the site
ignores. A group may span categories, so ordering uses the global `Group Order`.
Currently 28 rows.

### `derivedPrices.csv`

Rules for pricing a token off another token. Columns: `Token`, `DerivedFrom`,
`Ratio`, `Year`, `Bound`, `Note`. One rule today: Monster Trophy is priced as
Fleece ÷ 10, as a ceiling, because ten Trophies make one Fleece and Trophies are
never sold.

---

## Troubleshooting

### `npm run validate` reports a schema error

```
[ERROR] schema: tokenMetadata.csv: stale column "canonicalName" — rename it to "Item" in the source sheet
```

A column header in the sheet is wrong. The message names the exact fix. **Fix it
in the Google Sheet**, re-export, and re-validate — editing the CSV works until
the next export silently undoes it.

```
[ERROR] schema: transmuteRecipes.csv: column "DisplayName" should be "Display Name" — spelling differs only in spacing/case
```

Same thing, but the header differs only in spacing or capitalisation.

Schema errors stop the run before anything else is checked. That's deliberate —
a wrong header would otherwise produce thousands of meaningless follow-on errors.

### `[ERROR] unknown-good: "X" @ 2026 not in tokenMetadata / transmutes / fleece`

A recipe references an ingredient nothing can resolve. Either the `Item` is
misspelled in `transmuteRecipes`, or the token is missing from `tokenMetadata`
for that season. Add the row or fix the spelling.

### `[ERROR] key-formula` or `[ERROR] dup-key`

A sheet formula didn't fill down, or two rows produced the same key. Check the
`Key` column formula covers every row.

### `[WARN] display-name: … != tokenMetadata …`

The recipe sheet's `Display Name` disagrees with `tokenMetadata`. Usually the
recipe sheet's lookup formula is stale — refill it.

### The build fails with `dist/data check FAILED`

You edited a file inside `dist/`. `dist/` is generated output and is overwritten
every build. Make the change in `public/data/` and rebuild.

### `node` or `npm` is not recognised

Node is installed but not on your `PATH`. Either add `C:\Program Files\nodejs` to
your `PATH`, or prefix the command for that terminal session:

```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

### git fails with `unable to unlink … Invalid argument`

The dev server is running and holding the CSVs open. Stop it (`Ctrl+C`) and retry.

### The live site doesn't show my change

In order of likelihood: the deploy hasn't finished (check the Actions tab); your
browser cached the old CSV (hard-reload with `Ctrl+Shift+R`); or you committed to
a branch and never merged it to `main`.

---

## Maintaining this document

This runbook hardcodes things that live in the repo, so it goes stale silently.
**Update it in the same commit** as any of these:

| If you change… | Update |
|---|---|
| a column name in any data file | that file's column table, and the shared vocabulary |
| a filename in `public/data/` | the per-file heading, the export/rename step, the routing table |
| an npm script name | the standard loop and troubleshooting |
| the deploy workflow | step 7 |
| a validator message | the troubleshooting section |
| the `Category` list | the shared rules section |
| which columns a parser reads | the Required column of that file's table |

The per-file sections are deliberately uniform — *what it drives, when to touch
it, columns, rules, gotcha*. Keep that shape when adding a file so the document
stays scannable.

**Verify before publishing changes to this file.** Every column table here was
checked against the actual CSV headers and against the parsers in
`src/lib/data.ts` and `src/lib/transmutes.ts`, not written from memory. Do the
same — a runbook that is confidently wrong is worse than none.

### Known inaccuracy risk

The **tab names** in each "Export from" line are inferred from the filenames
Google Sheets produced on previous exports (`auctionData - tokenMetadata.csv`
implies a spreadsheet named `auctionData` with a tab named `tokenMetadata`). If
you rename a tab, the download name changes but the required filename in
`public/data/` does not — correct the "Export from" line here when that happens.

Three files are already named differently from their tab, so the rename in step 2
is not optional:

| Tab | Download | Must be saved as |
|---|---|---|
| `auctionPrices` | `auctionData - auctionPrices.csv` | `prices.csv` |
| `pricesOnyx` | `auctionData - pricesOnyx.csv` | `onyx.csv` |
| `pricesFleece` | `auctionData - pricesFleece.csv` | `offAuctionPrices.csv` |
