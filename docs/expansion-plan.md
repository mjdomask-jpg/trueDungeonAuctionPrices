# Expansion Plan: From MVP to Full Spreadsheet Replacement

The MVP replaced one thing: the per-season price dashboard (min/max/avg, full season
and last-5). The source workbook (`True Dungeon $8k Auction Analysis`) does much more.
This document inventories everything the workbook does, classifies each feature by the
*architectural* work it implies, calls out the new data structures we discovered by
reading the actual sheets, and proposes a phased build order.

Read [domain-context.md](./domain-context.md) first for the *why*; this doc is the
*what next* and *how*.

> **Status (2026-07-22): Phases 0–4 SHIPPED to `main`; Phase 5 is under way.** The transmute
> build-vs-buy engine (the headline feature) is live, and the Detailed Auction Data explorer
> (`/explorer`) has landed. Remaining in Phase 5: the auction-analytics dashboards and Open
> Auctions. See the build-order table in §6 for per-phase status.

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
These are the MVP. The one-time gap, the **Onyx** sub-list, shipped in Phase 1.

### B. New reference data + derived computation — the Transmutes engine (headline) — ✅ SHIPPED (Phase 4)
`Transmute Cost Estimates`, `Safehold Cost Estimates`, `Transmute table`, `pricesFleece`.
The big one. New data model + a recursive cost engine. Detailed in §3–§4. **Built and merged
(PR #8) — `lib/transmutes.ts` + the `/transmutes` page.**

### C. New views over existing data (charts / comparisons / explorers) — partly shipped
- ✅ **DONE (Phase 2)** — `Price Timelines YYYY` + `Chart Pivot - YYYY` — per-token
  price-over-time line charts, ordered by auction close date (auction number as tiebreak).
- ✅ **DONE (Phase 3)** — `Compare Years` + `Year Comparison Table` — pick two seasons, show
  avg/max/min per token for each plus % difference. **Keys on `canonicalName` (Item), not display
  name**, so it compares the item that filled the same role across years even when the display name
  changed. `-` where an item is absent in a year.
- ⏳ **Phase 5** — `Current Year Auction Stats`, `Historical Stats` — dashboards of pivots/charts
  derived from **auction metadata** (counts by style, by auctioneer, close-date cadence, YoY, etc.).
- ✅ **DONE (Phase 5)** — `Detailed Auction Data` — a filterable sales explorer at `/explorer`,
  in **two views behind a toggle**: grouped by auction (a `<details>` card per auction, body
  mounted only while open) and a flat sortable table (columns Season / # / Closed / Auction /
  Auctioneer / Token / Category / Price, sortable on any of them, default season descending then
  auction number descending; the sort always runs over the whole result set and only the display
  is capped, at 1,000 rows, with a "Show all" button under the table that lifts the cap — so a
  sort is never computed over a truncated slice). Both views render the same query object, so
  they cannot disagree.
  - **Filtering is deliberately thin**: Season, Category and Auctioneer pickers, one full-width
    search box matching *either* a token name or the auction's name, and a two-state view toggle.
    The maintainer had the Auction picker (276 options), Auction style, Completion style and a
    second auction-only search box removed as more clutter than help.
  - **Only `Closed` auctions are listed.** The five `Failed` ones recorded no sales at all, so
    this removes empty rows rather than any price data (276 auctions → 271; prices and totals
    unchanged).
  - **Grain: one price per token per auction.** Repeat sales of a token within one auction
    (1,707 such pairs in `prices.csv`, 20 in `onyx.csv`) collapse to their average — maintainer's
    call, and deliberately *not* labelled as an average in the UI: it is simply that auction's
    price for that token. Totals are therefore sums of collapsed prices, not of raw sales.
  - **Both sale feeds.** This is the only view that unions `prices.csv` with `onyx.csv`. Safe to
    concatenate: all 38 Onyx auctions already exist in `auctionMetadata.csv`, all 38 also carry
    main sales, and no `(auction, Item)` pair collides between the two files — so Onyx rows land
    in their existing auction's card under their own `Onyx Ultra Rare` category. Unfiltered:
    276 auctions, 6,418 prices, 129 distinct tokens, $497,843.93.
  - `exploreAuctions` / `flattenAuctions` / `sortFlatRows` in `lib/data.ts`; `pages/ExplorerPage.tsx`
    + `components/{AuctionCard,SaleTable}.tsx`. First view to read `completionStyle` from
    `auctionMetadata.csv`.
- ⏳ **Phase 5** — `Open Auctions` — currently-running auctions (metadata filtered to `Open`) with
  links. Note: this is the one **time-sensitive** view; it's only meaningful when fed live-ish data.

### D. Raw data imports (source of truth)
`auctionMetadata`, `auctionPrices`, `pricesOnyx`. These are local copies of the data-layer
CSVs. `prices.csv`, `auctionMetadata.csv`, and `onyx.csv` back the site today. Phase 4 added four more
under `public/data/`: `transmuteRecipes.csv`, `tokenMetadata.csv`, `offAuctionPrices.csv` (from
`pricesFleece`), and `derivedPrices.csv`.

### E. Per-user state
**Empty.** Nothing here. (Worth stating explicitly — it's why we stay static.)

## 3. New data structures discovered (from reading the sheets)

These are the concrete shapes we'll need to model. Confirmed by dumping the real cells.

### 3.1 Token dimension table — `tokenMetadata`
Columns: `key (auctionSeason+Item)`, `auctionSeason`, `Item`, `Display Name`, `Category` —
deliberately the same names `prices.csv` uses, since both describe the same token identity and
`prices.csv` is the source of truth for it.
This is the proper dimension table the site should arguably be built on: it maps the stable
`Item` (historically called the `canonicalName`) ↔ the yearly `Display Name` ↔ `Category`,
per season. The MVP
currently carries display name + category inline in `prices.csv`; `tokenMetadata` is the
cleaner normalized source and is what `Compare Years` relies on.

### 3.2 Recipe table — `Transmute table` (long format)
Columns as found: `Key (transmute+good)`, `Year`, `Level`, `Transmute`, `Good`, `Quantity`.
Two columns are added by the amendments below: **`IsSource`** (§4.1) and **`GoodYear`** (§4.2).

> **Renamed since.** The ingredient columns now use the shared `Item` vocabulary:
> `Good` → `Item`, `GoodYear` → `ItemYear`, `GoodDisplayName` → `Display Name`. The same
> `Good` → `Item` rename applies to the off-auction table in §3.3. This section and those
> below record the original names; the live column reference is
> [`transmute-recipes-template.md`](transmute-recipes-template.md).
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
- **Some recipes draw ingredients from multiple specific seasons.** E.g. `Ring of the Sacred Circle`
  needs a `1k Bonus` from each of 2026–2022; `Deathward Greaves` needs an Ultra Rare from each of
  2026–2023. The recipe's own `Year` is therefore *not* enough to price its lines. Handled by the
  **`GoodYear`** column — see §4.2.
- **"Ultra Rare" is unambiguous: the tier and the token are 1:1.** `tokenMetadata` holds exactly 8
  UR rows, one per season 2019–2026, *all* with `canonicalName = PYP`; `prices.csv` agrees
  (`PYP,…,Ultra Rare,Ultra Rare` — canonical name, display name and category match all the way
  down, over 371 sale rows). So the category `Ultra Rare` and the token `PYP` denote the same
  thing. Recipe lines should still key on `canonicalName` (`PYP`) for consistency with every other
  good, but there is no collision to resolve. See §4.2.
- **The Onyx list is a separate tier, not the UR pool.** `onyx.csv` carries category
  `Onyx Ultra Rare` — ~21 distinct named tokens per season (20 in 2022; 21 in 2023–2026), 844 sale
  rows — and is **disjoint from PYP**, which never appears in it. Per the maintainer, recipes that
  call for "any UR tier token" price as **PYP**, not as the cheapest Onyx UR (§4.2).
- **Safehold is the only other laddered tier**, and it's an *upgrade* chain in descending Roman
  numerals: `Safehold V → IV → III → II → I` (V is the base, I the top). Each level's recipe
  carries an `IsSource` line pointing at the next-lower tier. This folds the standalone
  `Safehold Cost Estimates` sheet into the unified engine. Above legendary, tiers historically had
  no ladder in the sheet — the maintainer only ever hand-wired the relic→legendary add-on.

### 3.3 Off-auction priced inputs — `pricesFleece`
> **Corrected against the real export.** Actual columns: `Key`, `Year`, `Category`, `Good`,
> `Display Name`, `max Price`, `avg Price`, **`min Price`**. The earlier "no min price" note below
> was wrong — min is present and populated. Also note `Good` = **`Fleece`** (the canonicalName);
> `Golden Fleece` is only the display name.

Columns as originally read: `Key`, `Year`, `Category`, `Display Name`, `max Price`, `avg Price`. **Manually
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
- Leaf price lookup order: auction stats → derived-price rule (§4.3) → manual off-auction table
  (Fleece etc.) → **excluded** if the good has negligible/no price (the sheet drops ≤ ~$1 filler
  goods from the sum). All three sources carry max/avg/**min**, so no stat-substitution is needed.
- For the **current season**, compute both full-year and last-5 variants (prices move); older
  seasons use full-year only.
- Each line is priced in **its own resolved season**, which defaults to the transmute's season but
  can differ — see §4.2. (Superseded the earlier flat rule "prices are always taken from that
  transmute's own season", which multi-year recipes break.)
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

### 4.2 Multi-season ingredients (the `GoodYear` column)

Some recipes require the *same* good from several *specific* past seasons (§3.2). The season of an
ingredient is therefore a real per-line attribute, not a property of the recipe. Promote the
implicit rule "price in the transmute's own season" from hardcoded engine behavior to a **column
with that rule as its default**.

Add `GoodYear` to the recipe table, accepting three forms:

| Value | Meaning | Notes |
|---|---|---|
| *blank* | the transmute's own season | the default — **every existing row migrates untouched** |
| `-1`, `-2`, … | relative to the row's `Year` column | the primary form for multi-season recipes |
| `2023` | pinned absolute season | escape hatch for genuine one-offs |

Offsets are relative to the recipe's own `Year`, **not** the current calendar year — a `Year=2024`
row with `GoodYear=-1` means 2023 permanently, and does not shift meaning as seasons pass.

```
resolveYear(line, transmute) =
    line.GoodYear === ""        ? transmute.Year
  : /^[+-]/.test(line.GoodYear) ? transmute.Year + Number(line.GoodYear)
  :                               Number(line.GoodYear)
```

`Ring of the Sacred Circle` (2026) becomes five rows:

```csv
Year,Level,Transmute,Good,GoodYear,Quantity,IsSource
2026,Relic,Ring of the Sacred Circle,1k Bonus,,1,FALSE
2026,Relic,Ring of the Sacred Circle,1k Bonus,-1,1,FALSE
2026,Relic,Ring of the Sacred Circle,1k Bonus,-2,1,FALSE
2026,Relic,Ring of the Sacred Circle,1k Bonus,-3,1,FALSE
2026,Relic,Ring of the Sacred Circle,1k Bonus,-4,1,FALSE
```

`Deathward Greaves` is the same shape with `Good = PYP` and offsets `0..-3`.

**Why relative offsets are the primary form.** These are "one from each of the last N seasons"
designs, so next season's recipe is a copy-paste with `Year` bumped — the engine re-resolves
2027–2023 by itself. Absolute years would force a hand-rewrite of every row each season.

**Resolving the "Ultra Rare" overlap.** The apparent overlap is **entirely a season problem**, not
a referent problem. Three distinct-sounding phrasings all resolve to the token `PYP`:

| Recipe says | Resolves to |
|---|---|
| "an Ultra Rare" (this season's) | `Good = PYP`, `GoodYear` blank |
| "an Ultra Rare from 2026, 2025, 2024, 2023" | four `PYP` rows, `GoodYear` = `` / `-1` / `-2` / `-3` |
| "any token of UR tier" | `Good = PYP` (maintainer-confirmed pricing policy — see below) |

Because the tier ≡ the token (§3.2), the only thing that ever varies between these is the season.
`GoodYear` carries it; nothing else is needed. Render as "Ultra Rare (2024)" in the UI.

**Display names are season-dependent, so resolve them against `GoodYear`, not `Year`.** `1k Bonus`
renders as Ring of the 1st/2nd/3rd/4th/5th Circle in 2026/2025/2024/2023/2022 — so the five
Ring of the Sacred Circle rows are five *different-looking* tokens sharing one canonical name. Any
UI that labels a recipe line must look up `displayName` at the line's **resolved** season or every
row will wrongly read "Ring of the 1st Circle". The authoring sheet carries `ResolvedYear` and
`GoodDisplayName` as formula columns for the same reason — see
[`transmute-recipes-template.md`](transmute-recipes-template.md). **The importer ignores both**;
the site re-derives them, so a stale derived column in the sheet can never poison the data.

The one other axis people conflate into the word — *is this the token I'm upgrading, or fuel I'm
consuming?* — is already carried by `IsSource` (§4.1). Season and role are orthogonal, one column
each; referent needs no column at all.

**Knock-on consequences:**
- **The row key changes.** `Key (transmute+good)` is no longer unique once five rows share
  transmute+good. It becomes `transmute + good + goodYear + isSource`. Fix in the sheet **before**
  authoring more multi-season rows.
- **The last-5-auctions variant only applies to current-season lines.** Past-season lines have no
  "recent" window and use that season's full-year stats. A 2026 Ring of the Sacred Circle has one
  line of five that responds to the recent-prices toggle — surface that as a footnote on the cost
  card, or the toggle looks broken.
- **Import validation** should assert every resolved year exists in the price data, so a bad offset
  fails loudly instead of silently pricing at zero.
- **Thin early seasons.** PYP is priced in every season 2019–2026, so multi-season offsets always
  resolve — but sale counts are 6 (2019), 15 (2020), 20 (2021) versus 50–79 for 2022–2026. A
  min-based cost reaching back that far rests on very few sales; consider surfacing sale count on
  the line, or at least not treating those minima as equally trustworthy.

**Deliberately not built: a `GoodType: token | category` column.** Recipes asking for "any token of
UR tier" **do** exist (maintainer-confirmed). They still need no column, because the maintainer's
pricing policy resolves them to the same place as a named UR:

- **Pool = PYP only.** Players are assumed to acquire the generic; the ~21 named Onyx URs of the
  season do *not* compete as candidates.
- **"Cheapest" = per-stat**: the avg total takes PYP's season average, the min total takes PYP's
  season minimum — each consistent with how every other line in that same total is priced. Over a
  one-token pool this is *exactly* the standard leaf lookup, so there is no second pricing path to
  build or test.

So "any UR" and "an Ultra Rare" produce byte-identical rows.

> **Decision record — what would reopen this.** The cost of the simplification is that the data
> can no longer distinguish the two phrasings, so (a) the UI cannot render "any UR" differently,
> and (b) if the pool ever widens to include Onyx URs, the recipes must be re-authored to say
> which lines were "any UR". Both are recoverable by adding the column later and back-filling;
> neither is worth paying for now. Revisit if the Onyx set is ever declared substitutable.

### 4.3 Derived prices — the Golden Fleece ingredients

**Golden Fleece is itself a transmute**: 10 **Monster Trophy** → 1 Fleece. Monster Trophies are
earned by playing, never auctioned, so they have no market price. Some recipes consume them.
Neither `Monster Trophy` nor `Golden Fleece` exists in any currently-ported file.

**The sheet's existing workaround:** express the quantity as a *fraction of a Fleece* — needing 3
Trophies is written `Golden Fleece × 0.3` — because the Fleece has strictly more utility than its
parts, so `price(Fleece) ÷ 10` is a **ceiling** on each Trophy. This saved the maintainer from
hand-tracking a second price series.

**Ported as a derived-price rule instead (maintainer-confirmed).** The fraction conflates two
separate facts — *how many* ingredients, and *what they're worth*. Split them:

```
price(ingredient, season) = price(Golden Fleece, season) ÷ ratio      // ratio = 10
```

Recipes then name the real ingredient with an **integer** quantity, and the price still derives
from the single hand-maintained Fleece series — the labor saving is fully preserved. Requires a
small rule table (§3.3's "manual off-auction prices" file grows a sibling):

| Column | Meaning |
|---|---|
| `Token` | the derived token's `canonicalName` (`Monster Trophy`) |
| `DerivedFrom` | the parent's `canonicalName` (`Golden Fleece`) |
| `Ratio` | how many `Token` make one `DerivedFrom` (`10`) |
| `Year` | blank = applies to every season; a year = per-season override, which wins |
| `Bound` | `ceiling` — the derived value is an upper bound, not a measurement |

The blank-year convention deliberately mirrors `GoodYear` (§4.2): one row states the durable rule,
per-season rows override it only where reality differs.

Why this over keeping the fraction:
- **Integer-only quantities stay enforceable.** If `0.3` is legal anywhere, a validator can no
  longer distinguish it from a fat-fingered `3` — a free correctness check across hundreds of
  hand-typed rows, lost for one convention.
- **Recipe lines read truthfully.** "3 × Monster Trophy", not "0.3 × a token nobody can buy 0.3 of".
- **The ingredient becomes a real token**, so `GoodDisplayName`, `GoodYear` offsets and price
  lookups all work on it like anything else.
- **Reversible cheaply**: if the ingredient is ever auctioned directly, delete the rule row and the
  normal price path takes over untouched.

**Three engine requirements this creates:**

1. **Cycle guard (mandatory).** Fleece's own recipe is `10 × ingredient`, and the ingredient prices
   off Fleece — a cycle. Break it *by construction*: a derived-price lookup reads the parent's
   **market price** from the manual table and must **never** call `buildCost(parent)`. This is the
   one place the acyclicity argument in §4 does not hold on its own.
2. **Fleece's own build-vs-buy card is degenerate.** `buildCost(Fleece) = 10 × (fleeceMarket ÷ 10)
   = fleeceMarket`, always, exactly. That is an artifact of the definition, not a finding —
   suppress the card or label it, or it will read as a suspiciously perfect break-even.
3. **`ceiling` must surface in the UI.** Lines priced this way are biased high, so any total
   containing one is an upper bound. Mark the line and caveat the total; otherwise it silently
   contradicts the bargain-hunting assumption every other line uses.

**Missing min — MOOT (corrected against the real export).** §3.3's claim that `pricesFleece` has no
min was **wrong**: the actual export
(`auctionData - pricesFleece.csv`) carries `max Price`, `avg Price` **and** `min Price`, populated
on every row. No avg-as-min fallback is needed; off-auction leaves price exactly like auction ones.

The general question survives in weaker form: if a *future* off-auction token ever ships without a
min, decide then.

`Stalker Token` and `Herald Token` now live in the same off-auction file with full max/avg/min, so
the "manual off-auction prices" table is confirmed general rather than a Fleece special case — as
§3.3 predicted. They are priced directly and need **no** derived-price rule; only `Monster Trophy`
does.

### 4.4 Season fallback — recipes outside the priced range

Recipes exist for **2012–2018** (before auction data begins) and **2027** (a preview season that
hasn't happened). Neither has price data. Maintainer-confirmed handling:

- **2012–2018 → price from 2019**, full-year stats. The earliest data we have.
- **2027 → price from 2026, `last 5` variant.** A preview is a forward estimate, so the most recent
  auctions are the best predictor.

**Encode as a rule, not a table.** Both cases are the same idea — clamp into the priced range —
and stating it generally means zero maintenance as seasons roll:

```
pricingSeason(nominal) =
    nominal < earliestPriced  ->  { season: earliestPriced, variant: 'full'  }   // 2012-18 -> 2019
    nominal > latestPriced    ->  { season: latestPriced,   variant: 'last5' }   // 2027 -> 2026 last5
    otherwise                 ->  { season: nominal,        variant: 'full'  }
```

This reproduces both instructions exactly, and **self-heals**: when 2027 auctions start landing,
`latestPriced` becomes 2027 and those recipes silently switch to real data. A 2028 preview then
falls back to 2027 last-5 with no edit. A lookup table would need touching every season.

Consult it **only when a direct lookup misses**, per source, so real data always wins. A 2027
recipe can legitimately mix a real 2027 Fleece price (if `pricesFleece` gains a 2027 row) with
2026-last5 trade goods.

**Four consequences worth building for:**

1. **Resolution is two-stage.** `GoodYear` resolves the *nominal* season (§4.2); `pricingSeason`
   then maps nominal → *priced* season. Keep them separate — conflating them breaks the next point.
2. **One recipe can price two lines at "2026" differently.** In a 2027 recipe, a blank-`GoodYear`
   line is nominally 2027 → 2026 **last-5**, while a `GoodYear=-1` line is nominally 2026 → 2026
   **full-year**. Both are correct: the first is a stand-in for an unknown price, the second is a
   real historical purchase. Surprising enough that the UI should label which lines were mapped.
3. **Mapped lines are estimates and must be marked** — same treatment as the `ceiling` bound
   (§4.3). 2012–2018 especially: pricing a 2012 recipe off 2019 data spans seven years of drift, so
   those totals are indicative, not measurements.
4. **2027 totals are not reproducible over time.** "Last 5 of 2026" moves as 2026 auctions close,
   so a preview cost changes week to week. That is the intent — but date-stamp it, or it reads as
   instability.

**Deliberately not built: a per-season override table.** The clamp rule covers every known case. Add
one only if some season ever needs treatment the rule can't express.

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

| Phase | Scope | Bucket | Status |
| --- | --- | --- | --- |
| **0** ✅ | Foundational refactors (§5) | — | **DONE (PR #1).** Routing, component split, shared data layer. Unblocked everything. |
| **1** ✅ | Onyx sub-list in dashboards | A/D | **DONE (PR #2).** New `onyx.csv`, reuses the aggregation pipeline; own `/onyx` route. |
| **2** ✅ | Price Timelines (per-token charts) | C | **DONE (PR #5).** Hand-rolled SVG charts (zero deps), data-authored grouping via `tokenGroups.csv`. |
| **3** ✅ | Compare Years tool | C | **DONE (PR #6).** Cross-season, keyed on canonical Item; % diff on avg; category + biggest-movers views. |
| **4** ✅ | **Transmutes / build-vs-buy** | B | **DONE — SHIPPED (PR #8, merge `d6ece93`, 2026-07-22).** Cost engine (`lib/transmutes.ts`) + `/transmutes` page: Relic→Legendary paired layout, both build/upgrade costs, full BOM, game-canonical tier colors. All of §3–§4.4 landed. |
| **5** | Auction analytics + Detailed Auction Data explorer + Open Auctions | C | **IN PROGRESS.** Detailed Auction Data explorer **DONE** — `/explorer`, grouped + flat views, one price per token per auction, unions the Onyx feed. Still open: the metadata-driven analytics dashboards, and Open Auctions (needs a live-ish feed). |

Rationale: Phases 1–3 were pure computation over data we already parse, so they exercised the new
routing/data-layer plumbing on low-risk features before the transmute engine (Phase 4), which
carried the only genuinely new algorithm. Phase 5 is a distinct data domain (metadata analytics)
and is naturally last.

**Not phases, but also shipped along the way:** UI-polish PRs (#3 GitHub-style nav tabs, #4 favicon),
Onyx row banding (#7, later generalized to "any table with 4+ rows"), a site-wide dark-mode
muted-text brighten, and the curly→straight apostrophe normalization in recipe names.

## 7. Open questions to resolve with the maintainer

1. ~~**Transmute toggle semantics**~~ — RESOLVED (§4/§4.1): additive add-on, reproduced as
   memoized recursion, with source dependencies encoded as `IsSource` recipe rows. Confirmed: the
   only laddered tiers are relic→legendary (hand-wired historically) and Safehold (V→I upgrade
   chain); other tiers have no source. Remaining task is *data authoring* — add the `IsSource`
   column and real quantities in the source sheet — not a design question.
2. ~~**Multi-season ingredients / the "Ultra Rare" overlap**~~ — RESOLVED (§4.2): the overlap is
   purely a *season* problem, since the `Ultra Rare` tier and the token `PYP` are 1:1 (§3.2).
   Solved by one per-line column, `GoodYear` (blank = own season, `-N` = relative, `YYYY` =
   pinned). Maintainer-confirmed: "any UR tier token" prices as PYP only (not the Onyx set), by
   season avg / season min per total — identical to a named UR, so no `GoodType` column. Remaining
   task is *data authoring* — add the `GoodYear` column, expand multi-season recipes to one row per
   season, and re-key the sheet on `transmute + good + goodYear + isSource`.
3. ~~**Onyx as a third CSV**~~ — RESOLVED / SHIPPED (Phase 1, PR #2). The Onyx feed uses the same
   raw-sales schema as `prices.csv`, so it reuses `parseSales` + `aggregateSeason` unchanged; loaded
   optionally by the provider on its own `/onyx` route.
4. ~~**Off-auction prices** (`pricesFleece`) — min-based build cost when a leaf has no min~~ —
   MOOT (§4.3): the real export **does** carry `min Price` on every row. §3.3's "max+avg only" note
   was mistaken. No fallback needed. Stays a hand-edited file.
5. **Open Auctions freshness** — is live/near-live auction status in scope for the static site, or
   is that view better left in the spreadsheet?
6. ~~**`Safehold` / `Patron` levels**~~ — RESOLVED / SHIPPED (Phase 4). All run through the one
   engine. `Safehold` is a self-contained V→I upgrade ladder (source lines point one rung down;
   cross-season source resolution handles rungs whose recipe lives in an earlier season). `Patron`,
   `Paragon`, and `Omni` sit *outside* the power ladder and render in their own "Outside the tier
   ladder" group — no special engine path. See [domain-context.md](./domain-context.md) for the tier
   structure.
