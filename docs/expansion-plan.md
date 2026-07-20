# Expansion Plan: From MVP to Full Spreadsheet Replacement

The MVP replaced one thing: the per-season price dashboard (min/max/avg, full season
and last-5). The source workbook (`True Dungeon $8k Auction Analysis`) does much more.
This document inventories everything the workbook does, classifies each feature by the
*architectural* work it implies, calls out the new data structures we discovered by
reading the actual sheets, and proposes a phased build order.

Read [domain-context.md](./domain-context.md) first for the *why*; this doc is the
*what next* and *how*.

## 1. The load-bearing conclusion

**Nothing in the workbook requires per-user state, accounts, or a backend.** Every
feature is either a *view* of shared data or a *pure computation* over it — including
the transmute build-vs-buy engine and its "include relic cost?" toggle (that toggle is
transient UI state, not something we save per person). So the site can stay a **fully
static, client-computed app** the whole way through. That is the single most important
architectural fact, because it means every phase below is "just" data modeling + UI, with
no infrastructure fork.

## 2. Feature inventory, by architectural bucket

Every sheet in the cleaned workbook maps to one of five buckets. The bucket predicts the
cost far better than the sheet's apparent size does.

### A. Already solved (MVP) — price dashboards
`2022–2026 Dashboard`, and their hidden feeders `pricesYYYY`, `pricesLastFiveYYYY`.
These are the MVP. The only gap is the **Onyx** sub-list (below).

### B. New reference data + derived computation — the Transmutes engine (headline)
`Transmute Cost Estimates`, `Safehold Cost Estimates`, `Transmute table`, `pricesFleece`.
The big one. New data model + a recursive cost engine. Detailed in §3–§4.

### C. New views over existing data (charts / comparisons / explorers)
- `Price Timelines YYYY` + `Chart Pivot - YYYY` — per-token price-over-time line charts,
  ordered by auction close date (auction number as tiebreak). Needs a charting approach
  and a "pivot" of raw sales into per-token time series.
- `Compare Years` + `Year Comparison Table` — pick two seasons, show avg/max/min per token
  for each plus % difference. **Keys on `canonicalName` (Item), not display name**, so it
  compares the item that filled the same role across years even when the display name
  changed. `-` where an item is absent in a year.
- `Current Year Auction Stats`, `Historical Stats` — dashboards of pivots/charts derived
  from **auction metadata** (counts by style, by auctioneer, close-date cadence, YoY, etc.).
- `Detailed Auction Data` — a filterable raw-sales explorer with pickers for Season /
  Auction Name / Category.
- `Open Auctions` — currently-running auctions (metadata filtered to `Open`) with links.
  Note: this is the one **time-sensitive** view; it's only meaningful when fed live-ish data.

### D. Raw data imports (source of truth)
`auctionMetadata`, `auctionPrices`, `pricesOnyx`. These are local copies of the data-layer
CSVs. `prices.csv` and `metadata.csv` already back the site; **Onyx needs its own CSV**.

### E. Per-user state
**Empty.** Nothing here. (Worth stating explicitly — it's why we stay static.)

## 3. New data structures discovered (from reading the sheets)

These are the concrete shapes we'll need to model. Confirmed by dumping the real cells.

### 3.1 Token dimension table — `tokenMetadata`
Columns: `key (year+canonicalName)`, `year`, `canonicalName`, `displayName`, `tokenCategory`.
This is the proper dimension table the site should arguably be built on: it maps the stable
`canonicalName` (the "Item") ↔ the yearly `displayName` ↔ `category`, per season. The MVP
currently carries display name + category inline in `prices.csv`; `tokenMetadata` is the
cleaner normalized source and is what `Compare Years` relies on.

### 3.2 Recipe table — `Transmute table` (long format)
Columns: `Key (transmute+good)`, `Year`, `Level`, `Transmute`, `Good`, `Quantity`.
One row per (transmute, ingredient). This is a clean relational bill-of-materials — ideal to
port as-is. Key findings:
- **The tier ladder is deep.** Levels present: `Enhanced`, `Exalted`, `Relic`, `Legendary`,
  `Arcanum`, `Paragon`, `Mythic`, `Eldritch`, `Omni`, plus `Safehold` and `Patron`. Far more
  than the UR→Relic→Legendary example.
- **Recipes appear pre-flattened to auction-priced leaves.** A Legendary's recipe lists
  `Ultra Rare` (qty 2), trade goods, and `Wish Ring` (qty 1) directly — *not* a reference to a
  sub-Relic. So the base cost is a flat sum over leaf goods, and true graph-recursion may not
  be needed for the common case (see the open question in §4).
- **Source-slot rows currently use quantity 0** (e.g. a Relic recipe lists `Ultra Rare` and
  `Wish Ring` at qty 0) to mark a source slot without summing it. **Recommended change (agreed
  with maintainer):** replace this convention with an explicit **`IsSource`** column and give
  source rows real quantities. See §4.1.
- **Not all tokens of a tier have a source.** Some Legendaries require a source Relic, some don't
  — modeled cleanly as presence/absence of an `IsSource` line (§4.1).
- **Safehold is the only other laddered tier**, and it's an *upgrade* chain in descending Roman
  numerals: `Safehold V → IV → III → II → I` (V is the base, I the top). Each level's recipe
  carries an `IsSource` line pointing at the next-lower tier. This folds the standalone
  `Safehold Cost Estimates` sheet into the unified engine. Above legendary, tiers historically had
  no ladder in the sheet — the maintainer only ever hand-wired the relic→legendary add-on.

### 3.3 Off-auction priced inputs — `pricesFleece`
Columns: `Key`, `Year`, `Category`, `Display Name`, `max Price`, `avg Price`. **Manually
maintained**, one row per year, and note **no min price** (only max + avg). Fleece isn't sold
at auction but is required by recipes. This is a small hand-edited price table — there may be
other tokens like this over time, so model it as a general "manual off-auction prices" file,
not a Fleece special case.

### 3.4 Onyx prices — `onyx2026` etc. / `pricesOnyx`
Per-token `max / avg / min`, same shape as the normal dashboard but for the fixed Onyx
(chase-UR) list. Straight parallel of the existing pipeline over a separate item set →
**new CSV, reuse the existing aggregation.**

### 3.5 Data-quality items to normalize on import
Real typos in the source that the import layer should clean/normalize rather than propagate:
`Enhnanced` (vs `Enhanced`), `Trade Goode` (vs `Trade Good`), sheet name `2022 Dahsboard`.

## 4. The Transmute cost engine (design sketch)

Inputs: the recipe table (§3.2), auction avg/min per good per season (existing pipeline),
manual off-auction prices (§3.3), and the UR/Onyx price sets.

Core computation, per transmute per season:
```
cost_avg = Σ over goods ( quantity × priceAvg(good, season) )
cost_min = Σ over goods ( quantity × priceMin(good, season) )
```
- Leaf price lookup order: auction stats → manual off-auction table (Fleece etc.) → **excluded**
  if the good has negligible/no price (the sheet drops ≤ ~$1 filler goods from the sum).
- For the **current season**, compute both full-year and last-5 variants (prices move); older
  seasons use full-year only.
- Prices are always taken from *that transmute's own season*.
- UI: a per-transmute cost card (avg + min totals) above its recipe line-items, colored by tier
  (the existing category-color pattern extends to transmute levels).

**The "Include relic cost in legendary?" toggle — RESOLVED (maintainer confirmed).**
Each transmute's stored recipe lines are its **own step's** ingredients (the delta to go from
its source token to itself). The toggle simply **adds the source's precomputed cost on top** —
it is not recursion. In the sheet it flips one cell in/out of the SUM (16 cells when Yes, 15 when
No), because the source relic's cost already sits in the row group above. This was a manual
workaround for Google Sheets' limits, wired **only for relic→legendary**.

In code we reproduce this additive behavior with a small memoized recursion — no harder than a
flat sum once the data model exists, and it lifts the spreadsheet's one-rung limitation:
```
buildCost(transmute, { includeSource }) =
    Σ ( quantity × leafPrice(good) )                       // this transmute's own recipe lines
  + ( includeSource ? buildCost(sourceTransmute) : 0 )     // the toggle
```
Strict tier ordering ⇒ acyclic ⇒ always terminates. `includeSource = true` reproduces the sheet's
"Yes" exactly; `false` reproduces "No". **Engine shape is now fully settled.**

### 4.1 Source dependencies as data (the `IsSource` column)

Rather than special-case the toggle in code, encode source/predecessor tokens **as typed recipe
rows**. Add one column, `IsSource` (boolean), to the recipe table (§3.2). Then:

```
buildCost(t, { includeSource }) =
    Σ over lines where !IsSource  ( qty × leafPrice(good) )
  + Σ over lines where  IsSource  ( includeSource ? qty × priceOf(good) : 0 )
        where priceOf(good) = isTransmute(good) ? buildCost(good) : leafPrice(good)
```

This one mechanism covers everything:
- **Optional sources** — a Legendary that needs no Relic simply has no `IsSource` line; nothing to
  special-case.
- **The toggle** — becomes "count `IsSource` lines or not," i.e. *"assume I already own the source
  token"*, applied uniformly at every tier instead of only relic→legendary.
- **Recursion vs. leaf** — the engine resolves each source line by asking *is this good itself a
  producible transmute?* If yes → `buildCost(good)`; if no (e.g. the base Ultra Rare a Relic
  upgrades from) → leaf price.
- **Safehold** — the V→IV→III→II→I upgrade chain is just source lines pointing one tier down;
  handled by the same engine, retiring the separate Safehold sheet.

Data requirements when authoring the recipe sheet:
- Give every consumed token a **real quantity** (retire the `qty 0` marker convention).
- A source line's `Good` must **name the source exactly** — the source transmute's canonical name
  (for the recurse case) or the leaf token's name (for the base-token case). Consistent naming is
  what lets the engine resolve `isTransmute(good)` and the price lookup automatically.

## 5. Foundational refactors (do before Phase 2+)

> **Status: DONE** (branch `phase-0-foundation`, two commits; no behavior change to the
> dashboard, verified in-browser). What shipped:
> - **Routing** via `react-router-dom` **HashRouter** — chosen over BrowserRouter because
>   `vite.config.ts` sets `base: './'` for GitHub Pages subpath hosting; HashRouter needs no
>   server rewrites and resolves assets correctly from any subpath. `App.tsx` is now a layout
>   shell (`<div class="wrap">` + `SiteHeader` + `<Outlet/>`); routes live in `main.tsx`; nav
>   entries in `src/nav.ts` (the nav bar stays hidden until there's more than one).
> - **Component split**: `src/pages/DashboardPage.tsx`, `src/components/{SiteHeader,
>   ThemeToggle,CategoryTable}.tsx`, `src/hooks/useTheme.ts`, `src/lib/format.ts`. The old
>   monolithic `App.tsx` constants moved with their components (`CATEGORY_ORDER` →
>   DashboardPage, `BANDED_CATEGORIES` → CategoryTable, `money`/`fmtCloseDate` → lib/format).
> - **Shared load-once data layer**: `src/data/AuctionDataProvider.tsx` fetches + parses both
>   CSVs once; `src/data/auctionDataContext.ts` holds the context + `useAuctionData()` hook
>   (split into two files so the provider file stays component-only for Fast Refresh).
> - **`src/lib/data.ts` (pure aggregation) untouched** — the seam held.
>
> The build-time CSV→JSON step below is **deferred** (runtime fetch+parse via the provider is
> the current foundation); revisit when compute/joins grow.

Cheap now while the code is small, painful later. Independent of which features land:
- **Add routing.** The site goes from one page to many (dashboards, timelines, compare,
  transmutes, auction stats, explorer). Introduce it before the second view exists.
- **Decompose `App.tsx`.** Extract header/controls/table into components.
- **Keep `src/lib/data.ts` pure and central.** It's the "spreadsheet formulas" layer — every new
  metric (recipe cost, YoY delta, time series) is a pure function here, unit-testable in isolation.
  Protect this seam; it's the best property of the current design.
- **Introduce a normalized data layer.** Consider a small build-time step that reads the source
  CSVs (prices, metadata, onyx, recipes, token metadata, manual prices) and emits
  clean/typed JSON, doing the §3.5 normalization once. Source of truth stays CSV (spreadsheet-easy
  to edit); the app consumes derived JSON.

## 6. Proposed build order

| Phase | Scope | Bucket | Notes |
| --- | --- | --- | --- |
| **0** ✅ | Foundational refactors (§5) | — | **Done.** Routing, component split, shared data layer. Unblocked everything. |
| **1** | Onyx sub-list in dashboards | A/D | Small; completes true MVP parity. New CSV, reuse aggregation. |
| **2** | Price Timelines (per-token charts) | C | First new view; needs charting + time-series pivot. |
| **3** | Compare Years tool | C | Cross-season, keyed on canonicalName; % diff. |
| **4** | **Transmutes / build-vs-buy** | B | Headline feature. Resolve §4 toggle question first. |
| **5** | Auction analytics + Detailed Auction Data explorer + Open Auctions | C | Metadata-driven dashboards & filterable explorer. Open Auctions needs a live-ish feed. |

Rationale: Phases 1–3 are pure computation over data we already parse, so they exercise the new
routing/data-layer plumbing on low-risk features before the transmute engine (Phase 4), which
carries the only genuinely new algorithm. Phase 5 is a distinct data domain (metadata analytics)
and is naturally last.

## 7. Open questions to resolve with the maintainer

1. ~~**Transmute toggle semantics**~~ — RESOLVED (§4/§4.1): additive add-on, reproduced as
   memoized recursion, with source dependencies encoded as `IsSource` recipe rows. Confirmed: the
   only laddered tiers are relic→legendary (hand-wired historically) and Safehold (V→I upgrade
   chain); other tiers have no source. Remaining task is *data authoring* — add the `IsSource`
   column and real quantities in the source sheet — not a design question.
2. **Onyx as a third CSV** — confirm shape/columns and how it joins to a season (the maintainer
   already flagged wanting this).
3. **Off-auction prices** (`pricesFleece`) — keep as a hand-edited file with max+avg only (no min)?
   How should min-based build cost behave when a leaf has no min?
4. **Open Auctions freshness** — is live/near-live auction status in scope for the static site, or
   is that view better left in the spreadsheet?
5. **`Safehold` / `Patron` levels** — are these standard transmutes in the same engine, or special
   cases (they have their own sheet / row group)?
