# Transmutes Expansion — Implementation Plan

Status: **planning only, no code written.** This is the phased plan requested in
`C:\claude\plan transmutes expansion.md`. It covers (a) the user-requested **build
calculator**, and (b) a set of recipe-accuracy improvements that were deliberately
left out of the Phase 4 MVP. Each section makes a design recommendation; the forks
that need a maintainer decision are collected in §9.

Grounding checks run against the live data before writing this (so the data-change
suggestions are real, not guessed):

- `transmuteRecipes.csv` — **153 recipes, 2012–2027.** By level: Legendary 44,
  Relic 38, Exalted 33, Enhanced 12, Safehold 9, Omni 5, Mythic 4, Eldritch 2,
  Arcanum 2, Paragon 2, Ultra Rare 2.
- **Ultra Rares are all the generic string `"Ultra Rare"`** (73 recipe lines). No
  specific UR token is named anywhere yet.
- **All 18 pre-2019 recipes are Legendary and all 18 lack a source-relic line** —
  exactly the gap the prompt describes. Only 31 of 153 recipes carry any source
  line today.
- Engine facts (`src/lib/transmutes.ts`): pricing is **per-season aggregation**;
  each recipe prices from its **debut year** with a season-fallback clamp; the
  `recentPrices` toggle only affects the latest priced season; costs already split
  `own` vs `source` vs `full`, and every `BuildCost` already carries `marketAvg` /
  `marketMin`. There is **no per-user state anywhere in the app yet.**

---

## 1. Two architectural realities that shape everything below

**1a. The build calculator is the app's first per-user state.** Every view to date
is static + derived (pure functions over CSVs). "How many do I have on hand" is
genuinely per-user. Good news: it needs **no backend** — it's ephemeral React state,
optionally persisted to `localStorage` per recipe. The cost engine already exposes
everything the calculator consumes (`BuildCost.lines[]` with `unitAvg`, `unitMin`,
`quantity`, `isSource`). So the calculator is a new *view*, not a new *engine*.

**1b. "Active windows" change the numbers on the existing Recipes view, not just the
calculator.** Today a recipe is priced from one season (its debut). Pricing across a
recipe's true active window re-aggregates from an *explicit date range* — from the
recipe's debut through its exact expiration, minus the 7-day shipping cutoff. That is
a real engine change with broad blast radius — it moves every currently-active
recipe's displayed cost. It deserves its own phase and careful before/after
validation, and it's the main sequencing question (§9, Q1).

We deliberately do **not** approximate this with coarse two-season pooling. The
maintainer's 2025–2026 data shows a **sharp price spike immediately after the Dec 1
cutoff** for several goods (Oil of Enchantment, Elven Bismuth), so lumping the debut
season together with the whole following season would drag a recipe's cost toward
post-deactivation prices that a real buyer racing the cutoff never actually paid.
Date-windowed pricing is the only way to keep the number honest. (This is Q2.)

**1c. Scraping trenttokens.com is constrained by the static-hosting model.** The site
is a client-side SPA on GitHub Pages with no server. A browser `fetch` to
trenttokens.com will be blocked by CORS, and there's nowhere to run a crawler at
request time. Feasible paths, cheapest first: (a) **build-time snapshot** — a script
in `scripts/` fetches prices during `npm run build` (or on a schedule) and commits a
small JSON the SPA reads; stale between builds but zero new infra; (b) a serverless
proxy (Cloudflare Worker / Netlify function) for live prices — adds infra and a
maintenance surface; (c) **manual entry only** (the Should-have secondary-price box
already covers this). Recommendation: ship manual entry, treat scraping as deferred,
and if pursued, do the build-time snapshot. See Phase 8.

---

## 2. The build calculator (the headline user request)

Delivered as a **new view on the Transmutes page** behind the existing `.toggle`
segmented control — i.e. **Recipes | Build Calculator** — with its own deep-link
route (reuse the `initialView` + distinct-router-`key` pattern from the Prices
All/Standard/Onyx and Analytics toggles). No new top-level tab; the 5-tab nav from
the page-consolidation work stays intact.

### 2.1 Must-haves → recommended layout

1. **Recipe picker.** Grouped by year (accordion or a year `<select>`), with **level
   chips** (Relic / Legendary / …) reusing the game-canonical `.tchip[data-tier]`
   colors already built. A search box (reuse the Recipes-view search). Default the
   list to **currently-active recipes** with a "Show all" toggle (depends on Phase 4;
   until then, show all — see Q1).
2. **Bill of materials.** One row per line, exactly the expanded-row BOM the Recipes
   view already renders — reuse `TransmuteRow`'s BOM sub-component so the two views
   can't drift.
3. **Per-line est. cost (avg / min)** and **recipe total (avg / min)** — already on
   `PricedLine.extAvg/extMin` and `BuildCost.own/full`. Respect the existing
   source/own split (show "if you already own the source" total).
4. **On-hand quantity entry**, three input affordances on each line:
   - manual number entry,
   - **± steppers** for incremental changes,
   - an **"Have all" toggle** that sets on-hand = required quantity in one tap (the
     prompt's key ease-of-use ask — avoids 26 clicks for a ×26 line).
5. **Difference calculation**, per-line and total:
   - `needed = max(0, required − onHand)`
   - `remaining cost = needed × unitPrice` (avg and min)
   - `you already have (at build price) = fullCost − remainingCost`
   - Headline number = **"Cost to finish: $X avg / $Y min"** with a secondary
     "You're providing $Z of materials."

State model: a `Map<lineKey, number | 'all'>` in component state, keyed by
`good + nominalYear` so it survives recipe re-render; optional `localStorage`
persistence per recipe key. Ephemeral is fine for v1 (Q4).

### 2.2 Should-haves → recommended behavior

6. **Optional secondary-market price box** for the finished transmute (manual entry).
7. **Resale value of on-hand materials.** Per the prompt: **20% discount off avg,
   10% off min** to model a fast sale. `resaleAvg = Σ onHand × unitAvg × 0.80`,
   `resaleMin = Σ onHand × unitMin × 0.90`.
   *Requirement-improvement note:* discounting the **min** (already the low estimate)
   by a further 10% is defensible but easy to misread; recommend labeling both
   clearly ("quick-sale value") and making the two discount rates a single config
   constant (like `ERAS.*`) so they're tunable without a code hunt.
8. **Conditional recommendation** (shows only once a secondary price `M` is entered).
   Compare three real options and name the cheapest with the dollar delta:
   - **Finish crafting:** cost `= remaining build cost` (keep your on-hand, buy the
     rest).
   - **Sell your materials, buy the finished token:** net `= M − resale value`.
   - **Buy the finished token, keep your materials:** cost `= M`.

   Suggested wording (improving on the prompt's examples):
   - *"Build it — finishing the craft costs $X, about $D less than buying."*
   - *"Buy it — the finished token is $M, cheaper than the $X of materials you'd
     still need."*
   - *"Sell and buy — selling your materials (~$S) and buying the finished token
     nets $N, your cheapest path."*

   Show the three numbers side by side so the verdict is auditable, not a black box.

### 2.3 Could-haves (Phase 8) — third-party prices

9. Crawl trenttokens.com for the selected transmute; 10. auto-fill the secondary
price with the lowest found; 11. a "buy" link. All gated by §1c. Recommend
build-time snapshot if pursued; otherwise the manual box (6) is the shipped answer.

---

## 3. Recipe-accuracy topics (the "additional context" the MVP omitted)

### 3.1 Active windows (recipes active a specific period)

**Rule:** active from **Jan 1 of debut year** to **Dec 1 of the following year**,
minus a **1-week shipping buffer** (exclude auctions closing within 7 days of
deactivation). Exceptions: **Legendary, Mythic, Safehold never expire**; **Omni**
gets annual updates (already modeled as same-recipe-different-years); **non-standard
expirations** exist (Mark of Enlightenment = 1 year only; Ioun Stone Mystic Orb
expired the following **March**).

**Data change (recommended):** add an explicit **`Expires` column** to
`transmuteRecipes.csv` (one value per recipe; the parser reads it once per
`Year|Transmute`). Semantics:
- blank → standard rule (`Dec 1 of Year+1`, minus 7 days),
- `never` → non-expiring (Legendary / Mythic / Safehold),
- an explicit `YYYY-MM-DD` → non-standard expirations (Ioun Stone, Mark of
  Enlightenment).

Storing the date **explicitly rather than deriving it** keeps the exceptions in the
data (where the maintainer can see and edit them) instead of as special-cases in
code, and it's future-proof. A validator rule can fill/verify the standard case.

**Engine change — date-windowed aggregation (the accurate computation):**
Price each recipe over the **exact date range it was craftable**: from its debut
through its `Expires` date, minus the **7-day shipping cutoff** (exclude auctions
closing within 7 days of deactivation, since a win that late couldn't ship in time to
craft). This needs a per-sale date, which is available by joining `prices.csv` →
`auctionMetadata` on `auctionId` (the Analytics and context layers already read close
dates). It replaces the per-season aggregation for active-window recipes with a
range-filtered aggregation.

**We are not shipping the coarse two-season pooling** that an earlier draft proposed
as a cheap first cut (debut season ∪ following season). The maintainer's 2025–2026
data shows a **clear price spike right after the Dec 1 cutoff** for Oil of Enchantment
and Elven Bismuth — proof that pooling the following season wholesale would fold in
post-deactivation prices and systematically overstate what a buyer racing the cutoff
paid. The extra cost of the date join is worth it; accuracy is the whole point of this
phase. (This was Q2; resolved to date-windowed — see §9.)

**Downstream, once active windows exist (all cheap):**
- **Recent-prices checkbox for every active year**, not just the latest priced
  season (the prompt's explicit ask). The `variantFor()` gate widens from
  "`>= latestPriced`" to "recipe is currently active."
- **Calculator picker defaults to active recipes** + "Show all" toggle.
- **Recipes view** can carry an "Active only / All" filter (default active).

### 3.2 Old Legendaries depend on now-uncraftable Relics

Because a Legendary's source Relic's own window has expired, that Relic is no longer
a valid crafting target, and its secondary-market value often sits **below** the
historical crafting cost (many players got the relics as free in-game rewards).

**Recipe view:** when a source (or any ingredient) is a transmute whose active window
has closed, mark it **"no longer craftable — cost is a historical estimate"** (a
badge + HintPopover, reusing the existing `est.`/`ceiling` marking machinery). This
falls out of Phase 4 automatically once "is active" is computed.

**Calculator:** let the user **override any line's unit price** with their own number
(covers "the market is cheaper/dearer than our estimate"). This is the single most
robust answer to every "our estimate may be off" concern in the prompt and also
serves 3.3 and 3.4. Recommend building a generic **per-line price override** in the
calculator rather than topic-specific hacks.

### 3.3 Back-populate 2012–2018 Legendary source relics

Pure **data-entry task** (no engine change): add the missing source-relic line
(`IsSource=TRUE`) to each of the **18** pre-2019 Legendary recipes (list verified;
they're in `Khing's Ring…` through `Thor's +5 Returning Hammer…`). Those relics may
have no pre-2019 price of their own — they'll ride the existing season-fallback
(→ 2019, flagged as estimate), which is already the documented behavior. Add a
validator check that every Legendary recipe has exactly one source line. Low code
cost; moderate authoring effort for the maintainer.

### 3.4 Ultra Rare specificity + two-year availability

Three sub-problems:

**(a) Show the specific UR a recipe needs.** Add an **`IngredientType` column**
(reusing the existing `Category` vocabulary) so a line can name the *actual* token
(e.g. `Item = "Ymir's Bane", IngredientType = "Ultra Rare"`) while still pricing as
the generic tier when the specific token has no price. Leaf pricing gains a fallback:
**specific-token price → generic tier (PYP) price**. This directly answers "users
want to see the explicit UR so they know what to buy/trade."

**(b) "Any UR from a year/set" (e.g. Omni Cube 2025).** Keep the generic
`"Ultra Rare"` line (blank/`any` `IngredientType`) with a note "any Ultra Rare from
{years}." No specific token; prices as PYP across the relevant seasons.

**(c) Two-year UR availability.** A UR won in season N can be redeemed for a UR from
N or N−1; equivalently a recipe-N UR requirement can be met by a UR bought in N or
N+1. This is **already subsumed by the date-windowed pricing in 3.1** — a recipe's UR
line is priced over the recipe's full active date range (debut through `Expires` minus
the 7-day cutoff), which naturally spans into the following season's auctions where
the UR is still redeemable. So no separate mechanism is needed *if* 3.1 lands first; if
it doesn't, add a small "UR lines price over `nominalYear`'s debut through
`nominalYear+1`'s cutoff" rule.

**(d) Secondary-market caveat.** For non-expiring Legendaries a scarce specific UR
can cost **more** than auction PYP. Handle via the per-line override (3.2) + a note
that "UR cost is the auction PYP average; a specific UR on the secondary market may
differ." No new data needed beyond (a).

### 3.5 Omni Orb / Omni Cube substitution

Game rule (encode as **code config**, like `eras.ts`, not per-row data — it's a fixed
rule, not editable content):
- **Omni Cube** substitutes for **any Relic** in **any Legendary recipe** *except*
  Charm of Avarice.
- **Omni Orb** substitutes for **any Ultra Rare / Exalted / Rare / Enhanced /
  Uncommon** in any Legendary recipe *except* Charm of Avarice.

Omni Orb and Omni Cube are themselves transmutes with recipes (Omni level, 5
recipes), so `buildCost(Omni Cube)` / `buildCost(Omni Orb)` are already computable.

**Engine:** for each substitutable line in a Legendary recipe, the effective cost is
`min(lineCost, omniSubstituteCost)`. Surface it as a **suggestion box** on the
calculator (and optionally a badge on the Recipes view): *"You could craft an Omni
Cube ($X) instead of buying this Relic ($Y) — saves $Z."* Do **not** silently
substitute in the headline total; show it as an opt-in optimization so the number
stays explainable. Medium-high complexity; high interest. Own phase (Phase 6).

### 3.6 Prices as of a specific year

The prompt is unsure of scope (global vs per-recipe vs per-year-group) and asks for a
recommendation. **Recommend a single global "Price data from: [year]" selector** at
the top of the Transmutes page, defaulting to each recipe's natural window
("Auto"). Choosing a year re-prices **all** recipes' leaf tokens from that season's
auctions (with the existing fallback for tokens absent that year). Rationale: it
mirrors the existing global `recentPrices` pattern, is predictable, is one control to
learn, and composes cleanly with the calculator. Per-recipe pinning is a lot of UI
for a niche ask; per-year-group is an odd middle ground. Medium cost; Phase 7.

### 3.7 Make the Recent-Prices checkbox effect obvious

Pure UI, high delight, isolated — the easiest win in the whole list. On toggle,
**flash/highlight the accordion panel** for a few seconds (a CSS animation on the
panel), and, better, **pulse the specific price cells that changed** (diff the before
/ after `extAvg` per line and add a transient `.changed` class). Respect
`prefers-reduced-motion`. Phase 1.

---

## 4. Summary of proposed data changes

| Change | File | Effort | Enables |
|---|---|---|---|
| Add `Expires` column | `transmuteRecipes.csv` | small (author) | §3.1 active windows |
| Back-populate 18 pre-2019 source relics | `transmuteRecipes.csv` | moderate (author) | §3.3 |
| Add `IngredientType` column + name specific URs | `transmuteRecipes.csv` | moderate (author) | §3.4 |
| Omni substitution rules | new code config (`eras`-style) | small (code) | §3.5 |
| (Optional) trenttokens snapshot | new `scripts/` + JSON in `public/data/` | medium (code) | Phase 8 |

Every data change must land with matching **validator** updates
(`scripts/validate-recipes.mjs`) and a **`docs/updating-the-data.md`** edit in the
same commit — this project's data layer goes stale silently otherwise
(see the data-pipeline notes).

---

## 5. Phased implementation plan

Ordered by the maintainer's stated priorities: **easiest / lowest-cost first, but
pulling the high-value build calculator forward.** Phases are independently
shippable; each is one branch → PR, verified in-browser + validators, per project
convention.

### Phase 1 — Quick wins (low cost)
- **1a. Recent-Prices flash/highlight** (§3.7). Pure UI. High delight, zero data.
- **1b. Back-populate 18 pre-2019 Legendary source relics** (§3.3). Data + validator
  rule. No engine change.

*Ship first: both are cheap, isolated, and 1b improves the numbers the calculator
will later show.*

### Phase 2 — Build calculator MVP (Must-haves) — **highest value** — ✅ SHIPPED
Everything in §2.1. New Recipes | Build Calculator toggle + route, recipe picker
(all recipes for now), BOM, per-line + total avg/min, on-hand entry (manual / ± /
Have-all), difference calc. Per-line **price override** built here too (§3.2/3.4) —
it's cheap and unlocks several later concerns.

**Shipped as:** `src/components/BuildCalculator.tsx`, a new view behind the
`/transmutes/:view` toggle (Recipes | Build Calculator). The first cut was rejected
(a full-page recipe list + tall one-card-per-ingredient detail that lost context and
broke Back); **redesigned to a compact, single-screen tool** after iterating on
mockups with the maintainer. Notes on the shipped design:
- **Slide-in drawer picker** (never a page swap, so Back/context are never lost):
  search + tier-filter chips + collapsible year sections; the current recipe's year
  is expanded by default (others collapsed), matching the Recipes view; source Relics
  stay paired with the Legendary they upgrade into (reuses `orderSeason`).
- **Dense table** — one row per ingredient (req / on-hand / buy / $/ea / to-finish),
  the whole recipe visible at once. Two-line rows on phones (≤640px), no side-scroll.
- **On-hand entry** = an `All`/`None` pill (fixed width) before a fixed-width number
  box; covered lines dim in place so the row order never jumps.
- Every line is treated uniformly, **source included** — "if you already own the
  source" is just setting that line to All, so the Recipes view's build/upgrade split
  falls out of the on-hand math rather than being a separate mode.
- State is ephemeral (Q4): on-hand counts + overrides live in React state keyed by
  line index, reset when the recipe changes. No `localStorage` yet.
- Per-line price override is an inline avg/min editor on the $/ea cell with a Reset;
  overridden lines carry a "your price" tag. This is the general tool §3.2/§3.4 want.
- Headline is **"Cost to finish"** (avg + min) with a **"You're providing $Z of
  materials"** secondary and a "full build from scratch" reference; unpriced-but-
  needed lines are excluded from the total and called out.
- Still deferred to **Phase 3**: secondary-price box, resale value, three-way
  recommendation (§2.2).

### Phase 3 — Calculator Should-haves — ✅ SHIPPED
§2.2: secondary-price box, resale value (20%/10%), the three-way recommendation with
clear wording.

**Shipped as:** a new `src/lib/buildCalc.ts` (pure decision math — `RESALE` rates,
`quickSaleValue`, `comparePaths`) plus a "buy it instead" block at the foot of
`BuildCalculator`. Notes on what the implementation settled:

- **The buy-it price pre-fills from the token's own auction sales** where it has any,
  with a Reset back to it once you type over. In practice this fires for exactly one
  recipe — **Safehold III (2024) is the only transmute of 170 that is itself sold at
  auction** — so manual entry is the real path, as §9 Q3 assumed. The box is
  tri-state (`'auto' | number | null`) so clearing it stays cleared instead of
  snapping back to the auction price.
- **Quick-sale value is a single number, not an avg/min pair.** The 20%-off-avg and
  10%-off-min figures are *not* a range: when a token's min and avg are close (common
  — hand-maintained and single-sale prices have min == avg), the 10% haircut yields a
  **larger** number than the 20% one, so a "min $X" label under a smaller "avg" figure
  would read as a bug. The UI leads with the avg-basis figure and puts the min-basis
  one in the HintPopover. Both rates stay in `RESALE` (plan §7).
- **The comparison is in avg terms only.** Adding a min column would have meant
  showing a "min" cost for the sell path that can land either side of the avg one
  (the resale term inverts the direction of "min"), which makes the verdict harder to
  read rather than easier. Cost-to-finish keeps its avg/min pair directly above.
  Because the min build can be far cheaper — Val's +4 Keen Fellbane Crossbow is
  $1,510 avg against $925 min — the panel **states its basis** rather than leaving it
  implicit: "Compared at average prices. At minimum prices finishing the craft costs
  $925." When that min build would beat the path we just crowned, the line says so
  outright ("…which beats every option here") and lifts to `--text-h`, since it
  contradicts the verdict directly above it. A basis *toggle* (recompute the whole
  comparison at min prices) was considered and deferred — revisit if min-price
  shopping proves to be what players actually do. (Maintainer decision, 2026-08-12.)
- **"Just buy it" can never win, and that is a result, not a simplification.** It
  costs exactly the quick-sale value more than "sell and buy", always, because the
  only difference between them is whether you sell the pile. So the verdict is drawn
  from **build vs sell-and-buy**, and "just buy it" renders with its total but marked
  non-candidate, with a line explaining that the gap is what holding your materials
  costs. When you hold nothing there is nothing to sell, the sell row is dropped, and
  "just buy it" becomes the second candidate.
- Ties under **$1** (`WASH_THRESHOLD`) report as a wash rather than crowning a winner
  by pennies — every input here is an estimate.
- A caveat fires when a needed ingredient has no price: cost-to-finish is understated,
  so the comparison leans toward building.
- Drive-by fixes: the money field's styling moved from `.cl-editor input` to
  `.cl-money-in input` so the per-line override editor and the new buy box are one
  control; and `.cl-hand input` / `.cl-money-in input` now hit 16px below 640px —
  both sat under the iOS zoom threshold that `docs/ui-conventions.md` mandates.

### Phase 4 — Active recipe windows (accuracy) — broad blast radius
§3.1: `Expires` column + parser, **date-windowed pricing** (aggregate each recipe over
its exact debut→`Expires` range minus the 7-day shipping cutoff, via the
`prices.csv` → `auctionMetadata` join), "is active" computation, recent-prices for all
active years, active-only default filter on both the Recipes view and the calculator
picker, and expired/uncraftable-relic marking (§3.2). The coarse two-season pooling an
earlier draft floated is **dropped** — the post-Dec-1 price spikes in the 2025–2026
data (Oil of Enchantment, Elven Bismuth) prove it would be too inaccurate. Needs a
before/after cost diff to validate the numbers moved as intended. *(If Q1 says
accuracy-first, this becomes Phase 2 and the calculator shifts back.)*

### Phase 5 — Ingredient specificity & Ultra Rare modeling
§3.4: `IngredientType` column, show specific URs with generic-tier fallback,
"any UR from year/set" notes, secondary-market caveat notes. UR two-year pricing
folds in free if Phase 4 shipped.

### Phase 6 — Omni Orb / Cube substitution
§3.5: substitution rule config, per-line `min(line, omni)` optimization, calculator
suggestion box, optional Recipes-view badge.

### Phase 7 — Prices as of a specific year
§3.6: global price-season selector, default Auto.

### Phase 8 — Could-haves: third-party prices (deferred)
§2.3 + §1c: trenttokens build-time snapshot, auto-fill lowest price, buy link. Do
last; re-confirm appetite for the infra first.

### Later / precision follow-ups
- Non-standard `Expires` dates beyond the standard rule (Ioun Stone Mystic Orb's March
  expiry, Mark of Enlightenment's 1-year window) — author these into the `Expires`
  column as Phase 4's date-windowed engine already reads them; verify each against the
  data as it's entered.
- Optional `localStorage` persistence of calculator inputs.

---

## 6. Value × cost snapshot

| Phase | Value | Cost | Notes |
|---|---|---|---|
| 1a flash | Med (delight) | **XS** | do immediately |
| 1b back-populate relics | Med | S | data entry |
| 2 calculator MVP | **High (user #1 ask)** | M–L | first per-user state — ✅ shipped |
| 3 calculator should-haves | High | M | needs #2 — ✅ shipped |
| 4 active windows | High (accuracy) | L | date-windowed pricing; moves existing numbers |
| 5 UR specificity | Med | M | needs data authoring |
| 6 Omni substitution | Med–High (interesting) | L | most complex engine bit |
| 7 price-as-of-year | Low–Med (1 user) | M | global selector |
| 8 scraping | Low–Med | L + infra | architectural risk |

---

## 7. Requirement-improvement suggestions (surfaced for the maintainer)

- **Resale discount** (§2.2/7): discounting the already-low `min` by a further 10% is
  conservative; label it "quick-sale value" and keep both rates in one config
  constant so they're tunable.
- **Recommendation** should show all three option totals, not just the verdict, so
  users can audit it.
- **`Expires` as an explicit date**, not derived, so exceptions live in the data.
- **Per-line price override** is a better general tool than several topic-specific
  fixes (covers uncraftable relics, scarce URs, and secondary-market divergence).
- **Omni substitution stays opt-in**, never silently folded into the headline total,
  to keep costs explainable.
- **Prices-as-of-year: one global selector**, not per-recipe.

---

## 8. Dependencies at a glance

```
1a ─ (independent)
1b ─ (independent, improves 2/4 numbers)
2  ─ needs engine (exists); price-override built here
3  ─ needs 2
4  ─ needs Expires data; feeds active filter into 2's picker + Recipes view
5  ─ needs IngredientType data; UR two-year rule free if 4 shipped
6  ─ needs Omni recipes (exist); independent of 4/5
7  ─ independent (global selector)
8  ─ needs infra decision (§1c)
```

---

## 9. Decisions — RESOLVED (maintainer, 2026-08-10; Q2 revised 2026-08-11)

All four resolved in favor of the recommendation; the phase order in §5 stands.

1. **Sequencing → calculator first.** Build calculator (Phase 2) ships on today's
   debut-year pricing; active windows (Phase 4) land under it later. The pricing
   basis is a swappable input the calculator reads.
2. **Active-window precision → date-windowed pricing (revised 2026-08-11).** Phase 4
   prices each recipe over its exact debut→`Expires` range minus the 7-day shipping
   cutoff, via the `prices.csv` → `auctionMetadata` join. The originally-planned coarse
   two-season pooling (debut ∪ following season) is **dropped**: the 2025–2026 data
   shows a sharp post-Dec-1 price spike for Oil of Enchantment and Elven Bismuth, which
   pooling would fold into the cost and overstate it. Accuracy is the point of the
   phase, so we pay the date-join cost up front rather than shipping a coarse pass we'd
   have to redo.
3. **Scraping → manual entry only for now.** Ship the manual secondary-price box;
   Phase 8 (trenttokens snapshot / proxy) is deferred until appetite is reconfirmed.
4. **Calculator input persistence → ephemeral for v1.** On-hand quantities live in
   React state only; `localStorage` persistence is a fast follow if wanted.
