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

> **Grounding refreshed 2026-08-14** (the figures above are as-of 2026-08-10 and
> are kept because the plan's reasoning rests on them). Current: **174 recipes,
> 1,954 rows**, by level Relic 56, Legendary 46, Exalted 33, Enhanced 12,
> Safehold 9, Omni 5, Mythic 5, Eldritch 2, Paragon 2, Ultra Rare 2, Arcanum 2.
> **93** generic `"Ultra Rare"` lines. **53** recipes now carry a source line, and
> the pre-2019 gap is **closed** — all 18 pre-2019 Legendaries have their source
> relic (§3.3 / Phase 1b, shipped in `51b4aea`); the 18 pre-2019 recipes with no
> source line are Relics, which correctly have none. Auction prices now start at
> **2018**, not 2019, so pre-2018 recipes fall back to 2018.
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

### 3.3 Back-populate 2012–2018 Legendary source relics — ✅ SHIPPED

> Done in `51b4aea` (Phase 1b): all 18 pre-2019 Legendaries carry exactly one
> `IsSource=TRUE` line, and `validate-recipes.mjs` gained both the
> `legendary-source` ERROR and the `multi-source` WARN. The season fallback those
> relics ride now lands on **2018**, not 2019.

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

**Superseded in part by the accuracy release.** §3.6 was written when a recipe had
exactly one basis (its debut season), so "choosing a year" had only one thing to
override. There are now three bases in play — active → today, expired → its build
window, and 34 authored `ItemYear` pins — and the selector has to say which of them
it displaces. Settled as **F1–F3 in §11**, which is the live spec for this feature.

### 3.7 Make the Recent-Prices checkbox effect obvious

Pure UI, high delight, isolated — the easiest win in the whole list. On toggle,
**flash/highlight the accordion panel** for a few seconds (a CSS animation on the
panel), and, better, **pulse the specific price cells that changed** (diff the before
/ after `extAvg` per line and add a transient `.changed` class). Respect
`prefers-reduced-motion`. Phase 1.

### 3.8 Alternative ingredients — Wish Ring ⇄ 15,000 GP (added 2026-08-13)

The company's Legendary recipes accept **1 Wish Ring OR 15,000 GP** for that line —
15,000 GP being **15 additional 1,000 GP Gold Bars**. The site currently models only
the Wish Ring, so every Legendary's build cost is quoted on one of two legal paths
without saying so, and without letting the player price the other.

**Why players care (maintainer, 2026-08-13):** Wish Rings come **1 per $8,000 order**
or very rarely as loot; Gold Bars are ordinary trade goods. So a player is far more
likely to be *holding* 15 bars than a ring, and does this arithmetic in their head
every time — buy the ring, spend GP already on hand, or buy GP when 15 bars come in
under a ring.

**Grounding (checked against the live CSVs, 2026-08-13):**

- **43 of 46 Legendary recipes carry exactly one `Wish Ring` line, quantity 1**, in
  every debut year 2012–2027. The three without are `Charm of Avarice Recipe 3`
  (2023), `Kilgor's +4 Savage Sword (Recipe 2)` (2024), and `Gear Golem Totem` (2026).
  No non-Legendary recipe uses a Wish Ring anywhere.
- **Every one of those 43 already carries a `1,000 GP Gold Bar` line** (25× in 43 of
  the 44 Legendary bar lines; one at 10×). So the GP path does **not** add a line —
  it **merges into an existing one**, 25 → 40 bars. Any UI has to decide whether that
  reads as one line changing quantity or as two competing lines.
- Both goods are richly priced (Wish Ring: 268 sales; Gold Bar: more), so neither side
  of the comparison leans on the estimate/fallback machinery.

**The two paths are close, and the winner flips** — which is the whole argument for
surfacing the choice rather than hard-coding one side (15 × bar vs 1 ring, per season):

| Season | 15 bars (avg) | Wish Ring (avg) | Cheaper (avg) | 15 bars (min) | Ring (min) | Cheaper (min) |
|---|---|---|---|---|---|---|
| 2019 | $232.50 | $226.67 | ring −$5.83 | $210.00 | $205.00 | ring −$5.00 |
| 2020 | $217.20 | $204.49 | ring −$12.71 | $195.00 | $185.00 | ring −$10.00 |
| 2021 | $202.65 | $192.80 | ring −$9.85 | $180.00 | $175.00 | ring −$5.00 |
| 2022 | $187.05 | $185.68 | ring −$1.37 | $150.00 | $151.00 | **GP −$1.00** |
| 2023 | $188.85 | $191.61 | **GP −$2.76** | $150.00 | $160.00 | **GP −$10.00** |
| 2024 | $148.50 | $156.88 | **GP −$8.38** | $78.75 | $115.00 | **GP −$36.25** |
| 2025 | $143.10 | $130.86 | ring −$12.24 | $115.50 | $95.00 | ring −$20.50 |
| 2026 | $132.90 | $113.97 | ring −$18.93 | $93.75 | $86.00 | ring −$7.75 |

GP wins **2 of 8 seasons on avg and 3 of 8 on min**, the two bases disagree in 2022,
and several seasons land inside the existing `WASH_THRESHOLD` neighbourhood. A static
"always price the ring" (today's behavior) is wrong in a quarter of seasons and by up
to $36.

**And price is only half of it.** Because the calculator's subject is *what you
already hold*, the substitution can flip on inventory even when it loses on price:
a player sitting on 40 bars finishes for $0 on the GP path while the ring path leaves
a ~$114 buy. Whatever shape this takes has to compose with on-hand quantities, not
just with unit prices.

**Design questions to settle at implementation time (NOT decided here):**

*(a) Toggle between the two, or show both?* A toggle keeps one honest headline number
and one BOM, at the cost of hiding the alternative behind an interaction; showing both
makes the comparison visible and auditable (the house style for the Phase 3 verdict
panel) but doubles a line in a table already 1,955px tall on a phone, and raises the
question of what the headline total means while both are on screen. A third shape
worth weighing: **auto-pick the cheaper path and annotate it** ("using 15,000 GP —
$19 less than a Wish Ring, tap to switch"), which mirrors how §3.5 proposes to surface
Omni substitution as an opt-in suggestion rather than a silent swap.

> **RESOLVED 2026-08-13 → a real toggle** (§10.3 D8). The Omni-style opt-in suggestion
> was rejected for this substitution: Omni Cubes are not things players hold, so a Cube
> is a comparison against a possible secondary-market purchase, whereas Gold Bars and
> Wish Rings are both held — GP more commonly, rings via community trade — making the
> two genuine peer paths. Same engine (D6), deliberately different presentation.

*(b) Future-proofing a Wish-Ring-exclusive recipe.* No such recipe exists in the data
today, but the plan should not assume none ever will. The maintainer's suggested
shape — **default = substitution allowed, explicit override to opt out** — has direct
precedent in this schema: `ItemYear` is blank by default and falls back to the
recipe's year via `ResolvedYear`, with an explicit value overriding. Candidate
encodings, all deferred:
- a per-line **`NoSubstitute`** (or `Exclusive`) boolean, blank = substitution allowed;
- a per-line **`AltItem` / `AltQuantity`** pair, so the alternative is data rather than
  a code rule (blank = no alternative, which *inverts* the default — Wish Ring lines
  would each need authoring, 43 rows, but arbitrary future substitutions cost nothing);
- a **code config** in the §3.5 Omni style (`WishRing → 15 × 1,000 GP Gold Bar`, with
  an allowlist/denylist), on the grounds that this is a fixed game rule, not editable
  content — matching how the Omni rules are proposed to live.

The choice between them is really the choice of where substitution rules live in
general, so **§3.5 (Omni) and §3.8 should be decided together** — they are the same
shape of problem (a line with a legal alternative path) and should not end up with two
unrelated mechanisms. Whichever lands first sets the pattern.

**Also to resolve at implementation:** whether a Wish Ring already on hand and the
15-bar path can be mixed (they cannot — it is one line, one path); how the substitution
interacts with the per-line price override (§3.2) and with `breakEvenHoldings`; and
whether the Recipes view shows the alternative at all or it stays calculator-only.

---

## 4. Summary of proposed data changes

| Change | File | Effort | Enables |
|---|---|---|---|
| Add `Expires` column | `transmuteRecipes.csv` | small (author) | §3.1 active windows |
| Back-populate 18 pre-2019 source relics | `transmuteRecipes.csv` | moderate (author) | §3.3 |
| Add `IngredientType` column + name specific URs | `transmuteRecipes.csv` | moderate (author) | §3.4 |
| Omni substitution rules | new code config (`eras`-style) | small (code) | §3.5 |
| Wish Ring ⇄ 15,000 GP substitution — encoding TBD (`NoSubstitute` flag / `AltItem`+`AltQuantity` columns / code config) | `transmuteRecipes.csv` **or** new code config | small–moderate (depends which; the `AltItem` shape needs 43 rows authored) | §3.8 |
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

### Phase 1 — Quick wins (low cost) — ✅ SHIPPED (`51b4aea`)
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
- **Quick-sale value is a RANGE off ONE rate: `RESALE.off` = 20%, taken off both the
  season minimum and the season average.** Low end = a fire sale (20% under the
  lowest price the market ever paid), high end = a patient sale (20% under the going
  rate). On Val's, holding 2× Ultra Rare and 5× Alchemist's Ink: **$71–$106**.

  The first cut used **20% off avg but 10% off min**, reasoning that the minimum is
  already low, and showed only the avg figure because the pair "would commonly
  invert". Measured against the data (2026-08-12), that reasoning was wrong twice
  over:
  - Inversion (`0.9 × min > 0.8 × avg`) hits **15 of 208** priced (season, item)
    groups — **7.2%**, not "commonly". Only **3** groups have min == avg at all.
  - Min sits a **median 0.613** of avg, so `0.9 × min` is not a near-twin of the avg
    figure; it is a genuinely lower number that was being hidden in a popover.

  A single rate **cannot** invert, since `min ≤ avg` always: 0 of 208, by
  construction. It also costs nothing in expressiveness — the two ends stop being
  "two data bases" and start being *fast sale* vs *patient sale*, which is the
  effort trade-off the maintainer's domain context says players actually weigh.
  One constant to explain and one to retune. Ranges collapse to a single figure when
  both ends round the same (3 single-sale items), so nothing ever renders "$45–$45".
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
- **The contenders are "finish the craft" vs "buy it and keep your goods"; selling
  is an aside.** The first cut made *sell-and-buy* a contender, since it always wins
  on paper (`market − quickSale` is unbeatable by construction). The maintainer's
  domain context, 2026-08-12, showed why that is the wrong answer in this game:
  - **Buying beats crafting almost always.** Crafted tokens rarely sell above their
    material cost, so a from-scratch verdict is near-universally "buy" and carries
    little information.
  - **Trade goods arrive free as loot**, and keep their use for the next recipe. A
    market valuation of the pile is not a cost the player ever paid.
  - **Selling is the expensive path in the currency that matters** — hours of
    listing, haggling, packing and posting, with no promise the lot moves. The
    players skew mid/late-career with families; time has a real price.
  - **The token pays off the moment you hold it** (in-game benefit), so delay costs
    something too.

  So sell-and-buy's edge is not a saving, it is the **wage for those hours**, and only
  the player can price their own time. It is reported in prose with its number and
  that framing, never crowned. `comparePaths` now returns just the two comparable
  paths — both take ten minutes, and the goods are free either way, sunk if you craft
  and retained if you buy.
- **`breakEvenHoldings(fullCost, market)` = the inventory target.** Cost to finish is
  `fullCost − what you hold`, so finishing overtakes buying once holdings pass
  `fullCost − market`. On Val's that is `$1,642 − $1,500 = $142` against $132 held —
  rendered as "about $10 of trade goods to go" with a progress bar. Same magnitude as
  the build-vs-buy gap, but a different question: not which is cheaper today, but how
  much more loot until crafting wins — which is what a player with a growing stash is
  actually asking, and it distinguishes "wait for drops" from "buy the rest now".
  Hidden once the gap closes, since the verdict then says it outright.
- **With an empty stash the panel says so**, rather than repeating an uninformative
  "buy it": crafted tokens rarely beat their material cost from scratch, and the tool
  earns its keep once goods are marked on hand.
- **A pinned summary strip carries the verdict across the table** (`.calc-strip`).
  The decision panel was measured at **y = 2,498 on a 375px screen — 3.1 screens
  down**, because the ingredient table is 1,955px tall; a player could miss the
  feature entirely. Moving the block *above* the table was considered and rejected:
  it is computed from on-hand quantities entered in the table, so it would render its
  least informative state (empty stash always says "buy it") in prime position, and
  the break-even bar would be off-screen while you do the thing that moves it.
  Instead the existing `.calc-bar` — already **158px at 375px**, wrapping to three
  rows, far too tall to pin — stays in flow, and a **60px condensed copy** (41px on
  desktop) fixes to the top once the bar scrolls away. It **releases as soon as
  `.calc-foot` is properly on screen** (an 80px bottom `rootMargin`, so the handoff
  waits until the real total is readable rather than a sliver at the edge), which is
  why the same "cost to finish" figure is never visible twice. Two
  `IntersectionObserver`s, no scroll listener. The strip **reports only** — tapping
  the price scrolls to the real field rather than duplicating the input, which would
  be a second source of truth and would push the at-rest bar past 158px.

  It is **gated on a measurement, not a breakpoint**: the on-window is
  `(footTop − viewportHeight + 80) − barBottom`, and the strip appears only when that
  is at least one full screen. Measured on Val's: **1,210px (1.49 screens) at 375px**
  versus **231px (0.28 screens) at 1000px** — about two wheel notches on desktop,
  where it read as a flicker rather than a fixture. A `max-width: 640px` gate would
  have fixed desktop while still guessing at short recipes, short browser windows and
  zoom; the measurement covers all of them, and a `ResizeObserver` on `.calc-panel`
  keeps it honest when an inline price editor opens and moves the footer.
- **`.calc-bar` carries the verdict, and became a two-column grid on phones.** With
  the strip gone from desktop, the bar needed the discoverability itself, so
  `.calc-spend` gained a third line under the figure — `Set buy price` before one is
  entered, `Buy · $21 less` after — always a button that scrolls to the real field.
  Cost and verdict are one element by construction, so no later layout change can
  separate the comparison from what it compares against.

  Placing it exposed a **pre-existing reflow bug**. The bar was a wrapping flex row,
  so the *recipe name's length* decided the layout: measured at 440px,
  `Odin's Eye Patch` put the name beside Browse with the cost alone below, while
  `Greater Eye Patch of the Aesir` pushed the name down onto the cost's row leaving
  23px. Those two are a Legendary and its source Relic — the pair you flip between
  most — so the name jumped between lines as you switched. Below 640px the bar is now
  `grid-template-columns: minmax(0, 1fr) auto`: Browse and the name down the left, the
  cost/verdict block spanning both rows on the right. `.calc-cur` switches to plain
  inline flow so chip, name and year wrap as one run of text. A long name now adds a
  line and the bar *grows* instead of reshuffling — verified identical grid placement
  for both recipes at 440, 375 and 320px. Heights: **95px (440), 95–121px (375),
  121px (320)** against 123px before; desktop 72 → 92px for the extra line.

  Phones take a **shorter verdict** (`Buy · $21 less`, not `Buy it · $21 cheaper`)
  because the right column is sized by its widest line — a long verdict would narrow
  the name column and could add a line the moment a price is typed.
- **Source lines sort to the top of every bill of materials.** The sheet authors them
  last, but the source is the token being *upgraded*, not fuel poured in beside the
  rest — it is what a reader looks for first, and in the calculator it is usually the
  first thing marked on hand (setting it to `All` is what yields the upgrade-only
  price). Sorted once in `CostEngine.cost()` rather than in either view, so the
  Recipes BOM and the calculator cannot disagree about the order; `sort()` is stable,
  so every other line keeps its authored sequence. Totals are untouched — they are
  accumulated before the sort.
- Ties under **$1** (`WASH_THRESHOLD`) report as a wash rather than crowning a winner
  by pennies — every input here is an estimate.
- A caveat fires when a needed ingredient has no price: cost-to-finish is understated,
  so the comparison leans toward building.
- Drive-by fixes: the money field's styling moved from `.cl-editor input` to
  `.cl-money-in input` so the per-line override editor and the new buy box are one
  control; and `.cl-hand input` / `.cl-money-in input` now hit 16px below 640px —
  both sat under the iOS zoom threshold that `docs/ui-conventions.md` mandates.

### Phase 4 — Active recipe windows (accuracy) — ✅ SHIPPED
§3.1: `Expires` column + parser, **date-windowed pricing** (aggregate each recipe over
its exact debut→`Expires` range minus the 7-day shipping cutoff, via the
`prices.csv` → `auctionMetadata` join), "is active" computation, recent-prices for all
active years, active-only default filter on both the Recipes view and the calculator
picker, and expired/uncraftable-relic marking (§3.2). The coarse two-season pooling an
earlier draft floated is **dropped** — the post-Dec-1 price spikes in the 2025–2026
data (Oil of Enchantment, Elven Bismuth) prove it would be too inaccurate. Needs a
before/after cost diff to validate the numbers moved as intended. *(If Q1 says
accuracy-first, this becomes Phase 2 and the calculator shifts back.)*

> **REVISED 2026-08-13 — read §10 before implementing.** Date-windowed pricing now
> applies to **expired** recipes only; **active** recipes price at today's prices,
> because a player crafting something still craftable pays today's prices by
> definition. Phase 4 also no longer ships alone: it is bundled with Phases 5, 6 and 9
> as one accuracy release. §10 is authoritative where it and this section differ.

### Phase 5 — Ingredient specificity & Ultra Rare modeling — ✅ SHIPPED
§3.4: `IngredientType` column, show specific URs with generic-tier fallback,
"any UR from year/set" notes, secondary-market caveat notes. UR two-year pricing
folds in free if Phase 4 shipped.

### Phase 6 — Omni Orb / Cube substitution — ✅ SHIPPED (availability-triggered, §10.6)
§3.5: substitution rule config, per-line `min(line, omni)` optimization, calculator
suggestion box, optional Recipes-view badge.

### Phase 7 — Prices as of a specific year — ✅ BUILT (see §11)
§3.6: global price-season selector, default Auto. The three forks §3.6 could not
have anticipated — it predates the accuracy release — are settled as F1–F3 in §11.

### Phase 8 — Could-haves: third-party prices (deferred)
§2.3 + §1c: trenttokens build-time snapshot, auto-fill lowest price, buy link. Do
last; re-confirm appetite for the infra first.

### Phase 9 — Alternative ingredients: Wish Ring ⇄ 15,000 GP — ✅ SHIPPED
§3.8: model the Wish-Ring-or-15,000-GP choice on the 43 Legendary recipes that have
it, so both legal paths are priced and the player can pick the one matching what they
hold. Includes the exclusivity encoding for a hypothetical future Wish-Ring-only
recipe. **Sequencing is open** (§9 Q7): it is calculator-adjacent, cheap next to
Phases 4–8, and corrects a number that is wrong in ~25% of seasons, which argues for
pulling it ahead of Phase 4 — but it should probably be decided *with* Phase 6, since
both are line-level substitution and shouldn't grow two mechanisms.

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
| 9 Wish Ring ⇄ 15,000 GP | Med–High (accuracy + a call players make by hand) | S–M | 43 Legendaries; shares a mechanism with 6 |

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
9  ─ independent of 4/5/7; couple to 6 (both are line-level substitution).
     Touches 2/3's math (on-hand, cost-to-finish, break-even) but needs no new engine
```

**Superseded 2026-08-13 for 4/5/6/9 — see §10.** Those four are no longer independently
shippable: 4 without 5 misprices Ultra Rares, 4 without 6 leaves era-mixed upgrade
pairs with no substitution path, and 9 shares 6's engine. They ship as one release.
None of them blocks on sheet authoring — every new column is optional with a default:

```
4+5+6+9 ─ one branch, one release
          data authoring (Expires exceptions, IngredientType, specific UR names)
          lands whenever; the engine is correct without it
          2019-21 date backfill LANDED 2026-08-14 — phase 4 gets full date
          precision on every season from the start (§10.5)
```

---

## 9. Decisions

### Resolved (maintainer, 2026-08-10; Q2 revised 2026-08-11)

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

### Resolved 2026-08-13 (Q6, Q7 — see §10 for the full decision record)

6. **Exclusivity / substitution encoding → CODE CONFIG ONLY.** (§3.8b) One
   substitution engine in the §3.5 Omni style, holding both the Omni rules and the
   Wish Ring ⇄ 15,000 GP rule; **no new data columns**. There is no live
   Wish-Ring-only recipe, so `AltItem`/`AltQuantity` would mean authoring 43 rows just
   to preserve today's behavior. A per-line `NoSubstitute` stays a documented seam, to
   be added only when a real exception appears. See §10.3 D6.
7. **Phase 9 sequencing → bundled, not sequenced.** Phases 4, 5, 6 and 9 ship as one
   accuracy release on one branch. See §10.

5. **Wish Ring ⇄ 15,000 GP presentation → A REAL TOGGLE.** (§3.8a) Not the §3.5
   opt-in-suggestion pattern used for Omni. The separating rule is **on-hand
   likelihood**: nobody holds a spare Omni Cube, so a Cube is a price comparison
   against a potential secondary-market purchase; Gold Bars and (via community trade)
   Wish Rings are both things players actually hold, so the two are peer paths. See
   §10.3 D8.

*(§9 has no open questions left; the one remaining implementation detail is in §10.4.)*

---

## 10. The accuracy release — Phases 4 + 5 + 6 + 9 bundled (decided 2026-08-13)

**Status: SHIPPED 2026-08-15** on branch `accuracy-release` (v2.1 → v2.2). This
section is authoritative wherever it differs from §3.1, §3.4, §3.5 or §5, all of
which predate it. §10.6 records what changed during the build.

### 10.0 Why these four ship together

The maintainer's framing, which is what reorganised the phase:

> Someone trying to build a recipe that is active **today** will need to use today's
> prices by definition. Right now we're providing a distorted view of what it would
> cost to make a Legendary token, which is a primary question people want to answer.

That single sentence collapses the three questions Phase 4 was stuck on (§10.1) into
one rule — but it only holds up with the other three phases attached:

- **Ultra Rares are the exception to "float to today."** A recipe's URs are only
  available in their two-year window; after that their price comes from the secondary
  market, with the auction price as a *baseline*. So URs must hold their era while
  trade goods float. Phase 5 is what makes that precise (naming the specific UR), and
  the two-year pool (D4) is what makes it correct in the meantime.
- **Era-mixed Relic → Legendary pairs are tolerable only because of Phase 6.** A
  2014 Legendary priced at today's prices sits above a source Relic priced in its own
  expired window. That is acceptable because (a) source Relics are among the tokens
  players most often already hold or can buy on an active secondary market — and the
  Phase 3 per-line price override covers the rest — and (b) **Omni substitution was
  introduced in-game for exactly these older relics**, so Phase 6 is the real answer,
  not a nice-to-have.
- **Phase 9 shares Phase 6's mechanism.** One substitution engine, two configs (D6).

Consequence: **one branch, one release, no piecemeal deploys.** Individual phases
would each ship a number that only makes sense once the next one lands.

**Nothing here blocks on sheet authoring.** Every new column is optional with a
sensible default, so the engine is correct before the maintainer authors anything, and
authoring improves precision whenever it lands.

### 10.1 Grounding (measured against the live CSVs, 2026-08-13)

Every number below came from reading `public/data/*.csv` directly, per
`verify-claims-against-project-data`. Three of them changed the design.

> **⚠ SUPERSEDED 2026-08-14 by the maintainer's date backfill.** The table below
> described the gap that forced D5. It is kept as the record of why that
> decision was made, but every figure in it is now wrong. Measured 2026-08-15:
> **294 auctions, all carrying `openDate` and a `Link`; `closeDate` missing on
> exactly 2 rows** (`202518` Failed, `202647` Open), **both with zero sales**;
> **0 of 7,721 priced sales lack a joinable close date.** A 2018 season also
> arrived (6 auctions), so auction pricing starts at 2018 and the pre-history
> clamp is 2018, not 2019. D5's fallback ships as a seam with no live case.

**Close-date coverage as it stood on 2026-08-13 — the join Phase 4 depends on**
**did not then exist before 2022:**

| Season | Auctions | With a parseable `closeDate` | Date range |
|---|---|---|---|
| 2019 | 6 | **0** | — |
| 2020 | 15 | **0** | — |
| 2021 | 20 | **0** | — |
| 2022 | 51 | 51 | 2021-11-06 → 2022-09-21 |
| 2023 | 51 | 51 | 2022-10-04 → 2023-09-15 |
| 2024 | 41 | 41 | 2023-09-26 → 2024-08-21 |
| 2025 | 46 | 45 | 2024-09-18 → 2025-09-18 |
| 2026 | 47 | 45 | 2025-09-25 → 2026-07-17 |

41 dateless auctions carrying 842 sales. This forced D5.

**A season's auctions mostly close in the PREVIOUS calendar year.** Season 2026 ran
from 2025-09-12; **1,075 of its 1,480 sales (73%) closed in 2025**. Season 2023: 794
of 1,136 (70%) closed in 2022. Season 2025: 64% closed in 2024. §3.1's literal "active
from Jan 1 of the debut year" would therefore have **discarded ~70% of each debut
season's own sales** — the pre-release auctions where players actually stock up on the
new set — and replaced them with the following season's auctions. This forced D2.

**Recipe status today (2026-08-13), under D1:** 174 recipes → **91 active**
(42 Legendary, 13 Relic, 11 Exalted, 9 Safehold, 5 Enhanced, 4 Mythic, 3 Omni,
2 Arcanum, 1 Paragon, 1 Ultra Rare), **71 expired** (41 Relic, 20 Exalted, 4 Enhanced,
2 Eldritch, 2 Omni, 1 Paragon, 1 Ultra Rare), **12 future** (the 2027 preview).

**`ItemYear` is blank almost everywhere:** 1,920 of 1,954 lines. Only 34 carry a pin
or offset. So "blank floats, explicit pins hold" decides the behavior of 98% of the
table, which is why D4 matters as much as it does.

**Ultra Rare lines:** 93 lines across 85 recipes, all named exactly `Ultra Rare`;
**84 of the 93 have a blank `ItemYear`**. Under a naive float every one of them —
including a 2014 Legendary's — would re-price at 2026 PYP. This forced D4.

**Float safety — the feared failure mode does not exist.** Repricing every leaf line
on all 91 active recipes at 2026 costs **0 lines their price**: every ingredient name
still prices in the current season (or via the existing season clamp). Floating cannot
turn a priced line into an unpriced one in today's data. *(A defensive fallback to the
line's nominal year is still worth building, since the data changes yearly.)*

**Magnitude of the correction** (leaf lines only; source/transmute lines excluded):

| Recipe | Now | At today's prices | Δ |
|---|---|---|---|
| 2024 Safehold *Follower* | $503 | $900 | **+79%** |
| 2025 Safehold *Sidekick* | $627 | $911 | **+45%** |
| 2014 Legendary *Relsa's Ring of Supreme Focus* | $947 | $637 | −33% |
| 2014 Legendary *Rolland's Ring of Protection +6* | $993 | $689 | −31% |
| 2017 Legendary *Aron's Sunhide Robe* | $1,116 | $822 | −26% |
| 2018 Legendary *Thor's +5 Returning Hammer* | $1,364 | $1,084 | −21% |

Across the 18 pre-2019 recipes the average move is **−23.7%** (today's trade goods are
cheaper than 2019's), and it runs the other way for the never-expiring Safehold
recipes. This is a large, visible, defensible correction — not a rounding change — and
it is the before/after diff §5 asked Phase 4 to produce.

### 10.2 The pricing rule

**Recipe status** is computed against today from an `Expires` value:

- `Expires` blank → standard rule, **Dec 1 of Year+1**;
- `Expires` = `never` → non-expiring;
- `Expires` = `YYYY-MM-DD` → explicit override (Ioun Stone Mystic Orb, Mark of
  Enlightenment).

**Code defaults Legendary / Mythic / Safehold to `never`** so the site is correct
before the column is authored at all; an authored value always overrides the default.

Status is then `future` (today < debut) / `active` / `expired`, and drives the basis:

| Status | Basis |
|---|---|
| **Active** | **Today's prices** — the latest priced season; the existing recent-prices toggle applies |
| **Expired** | Its **historical window**: first auction of the debut season → `Expires` − 7 days |
| **Future** | Today's prices (unchanged from the current 2027-preview behavior) |

The 7-day subtraction is the shipping cutoff from §3.1: an auction won inside the last
week could not ship in time to craft. Note the arithmetic — a standard window ends
**Nov 24 of Y+1**, which lands ~2 months *into season Y+2*, so a standard window spans
all of season Y, all of Y+1, and the head of Y+2.

**Per-line rules layered on the recipe's basis:**

1. **An explicit `ItemYear`** (34 lines) is a pin and never floats. Unchanged behavior.
2. **A blank `Ultra Rare` line pools its recipe year ∪ year+1** (D4).
3. **On an expired recipe the date window governs every line.** Because the window
   already spans Y → Y+1, the UR two-year availability rule is satisfied by the window
   itself — §3.4(c) predicted exactly this ("UR two-year pricing folds in free if
   Phase 4 shipped"). The pool in rule 2 is what a UR resolves to when the basis is
   "today", not a second mechanism competing with the window.
4. **Transmute lines recurse** into their own recipe, which carries its own status and
   basis. This is what produces era-mixed upgrade pairs (§10.0).
5. **Dateless auctions contribute via their season**, decided per auction row (D5).

### 10.3 Decisions

**D1 — Status is `active` / `expired` / `future`, not expiring / non-expiring.**
The maintainer's reframing. "Never-expiring" is not a pricing category; it just means
a recipe is permanently `active`. This is what collapsed three open questions into one
rule, and it is why the Phase 4 §5 blurb is now marked revised.

**D2 — The pricing window starts at the beginning of the debut auction SEASON**, not
Jan 1 of the debut year. §3.1's Jan-1 rule describes *craftability*; the pricing
window has to describe *when you could buy the ingredients*, and 70%+ of a season's
auctions close before Jan 1 (§10.1). The 7-day shipping cutoff still trims the end.
*(Rejected: literal Jan 1, which discards ~70% of the debut season's sales; and
debut-season-only with no forward spill, which would drop the two-year UR overlap that
§3.4(c) depends on.)*

**D3 — Active recipes price at today's prices.** By definition of the question being
asked. Old Legendaries stop being quoted at their debut-year cost and start answering
"what would this cost me to build now."

**D4 — A blank `Ultra Rare` line pools its recipe year ∪ year+1.** URs are only
available in that two-year window; afterwards the secondary market prices them, with
the auction price as the *baseline* the site is entitled to report. Pooling holds that
baseline while trade goods float (D3). Costs zero authoring — it is the default
behavior of a blank cell — so Phase 5's authoring becomes precision work rather than a
prerequisite. *(Rejected: floating URs like trade goods, which would have re-priced 84
of 93 UR lines at 2026 PYP and made Phase 5 a hard blocker; and pinning URs to the
recipe year alone, which ignores the second year of availability.)*
**Open sub-question for implementation:** whether the pool is a straight union of both
seasons' sales or an average of the two seasons' aggregates. Decide it by measuring;
prefer whichever is stable when one of the two seasons has very few sales.

**D5 — Dateless auctions fall back to season aggregation, decided PER AUCTION ROW,
and the line is marked.** Not per season, and not a hardcoded "2022+ only" gate. Keyed
on "does this auction row have a parseable `closeDate`", the fallback **self-heals**:
as the maintainer backfills dates, windowed pricing switches on incrementally with no
code change, and a partially-backfilled season uses windows for the auctions that have
dates and pooling for the rest. The line carries the existing estimate marking with a
note saying why. *(Rejected: a silent fallback, which would leave the page mixing two
pricing methods with nothing on screen saying so; and gating windowed pricing to
2022+, which hardcodes a boundary that goes wrong the moment one 2021 date lands.)*

**D6 — Substitution is CODE CONFIG ONLY; no new data columns.** One engine in the
§3.5 Omni style holds both rule sets: Omni Cube → any Relic and Omni Orb → any
UR/Exalted/Rare/Enhanced/Uncommon in any Legendary recipe except Charm of Avarice; and
Wish Ring ⇄ 15,000 GP (= 15 additional 1,000 GP Gold Bars, merging into the existing
25× bar line rather than adding a line). Both are fixed game rules, not editable
content. A per-line `NoSubstitute` remains a **documented seam**, added only if a real
Wish-Ring-only recipe ever appears. Resolves §9 Q6. *(Rejected: `AltItem` /
`AltQuantity` columns, which would require authoring 43 Wish Ring rows purely to
preserve today's behavior, and invert the blank-cell default.)*
*Corroborating detail:* **Charm of Avarice is both the Omni exception and one of the
only 3 Legendaries with no Wish Ring line** — the two exception sets already agree,
which is a point in favor of one engine.

**D7 — Phases 4 + 5 + 6 + 9 ship as one release on one branch.** Resolves §9 Q7. The
reasoning is §10.0; the practical consequence is that no intermediate state gets
deployed to Pages, and the branch carries per-phase commits for reviewability.

**D8 — Wish Ring ⇄ 15,000 GP is a REAL TOGGLE, not a suggestion box.** Resolves §9 Q5
and §3.8(a). One engine (D6), but deliberately **two different presentations**, and the
rule that separates them is *how likely the player is to be holding the thing*:

| Substitution | Held by players? | Presentation |
|---|---|---|
| Omni Orb / Cube (Phase 6) | **Unlikely.** Nobody has a spare Cube sitting in a drawer. | **Opt-in suggestion** (§3.5) — a reference point for a potential secondary-market purchase, never folded into the headline |
| Wish Ring ⇄ 15,000 GP (Phase 9) | **Yes, both.** GP more commonly; Wish Rings are actively traded in the community | **Real toggle** — two peer paths, either of which the player may already hold |

So the earlier "one interaction pattern for consistency" argument is **rejected**: the
two substitutions are not the same kind of thing to a player. An Omni Cube is a price
*comparison*; 15,000 GP is a path you might already be standing on. Presenting the GP
path as an optimization tip would bury a choice that ~43 Legendary recipes force, that
the player already does in their head, and that **on-hand quantities can flip even when
price does not** — a player sitting on 40 Gold Bars finishes for $0 on the GP path
while the ring path still leaves a ~$114 buy.

Implementation constraints carried over from §3.8: the GP path **merges into the
recipe's existing 25× Gold Bar line (25 → 40)** rather than adding a line, so the
toggle changes a quantity rather than swapping rows; the headline total must follow the
selected path; and the phone BOM is already ~1,955px tall, so the toggle has to be a
control, not a second rendered line. The toggle composes with on-hand quantities and
per-line price overrides, since both paths' components are ordinary BOM lines.

### 10.4 Still open

**Every phase-level fork was settled (D1–D8), and the one implementation-time**
**detail is now closed too.**

- **D4's pool shape — RESOLVED 2026-08-15: a straight union of sales.** Measured
  before choosing, across every adjacent Ultra Rare season pair: a union and a
  mean of the two season aggregates differ by **at most 3.4%** (2021∪2022, the
  most lopsided pair at n=24/50) and **under 1% in six of the eight pairs**. The
  thin-sample case the question was really about has also gone away — the
  backfill means the smallest season now carries n=6 rather than nothing. The
  union wins on being the same code path as the date window rather than a second
  averaging mechanism. Maintainer-approved (E1).

### 10.6 What the build changed (2026-08-15)

Seven things the design did not anticipate, all found by measuring rather than
by review. Recorded here because each one is a standing fact about the data,
not a one-off bug.

**1. A live regression the backfill had already caused.** Adding the 2018 season
moved `PriceIndex.earliestPriced` from 2019 to 2018, but `offAuctionPrices.csv`'s
first Golden Fleece row is 2019 — so 19 lines across 18 pre-2019 Legendaries
silently dropped out of their totals, understating them 3.7–7.5%. The validator
missed it because its coverage check keyed years by FILE rather than by ITEM, so
2018 counted as covered on the strength of an unrelated row. Fixed in `48ca498`:
a per-good nearest-season fallback in `leafPrice`, and per-item coverage rules
that mirror the engine's fallback order.

**2. The D4 pool needed a floor, not a fall-through.** An empty two-season pool
(every recipe before 2018) dropped through to the float and put a 2014
Legendary's Ultra Rare at 2026 PYP — exactly the failure §10.1 says forced D4
into existence. It now clamps to the earliest priced season instead: $111.50
from 2018, marked as an estimate, rather than $59.66.

**3. Phase 6's `min(line, omni)` has no live cases.** An Omni Cube costs **$777**
to craft against a dearest replaceable Relic line of **$651**; an Omni Orb
**$421** against Ultra Rare lines of $60–112. A price-triggered suggestion box
would never render. But **34 of the 81 eligible lines** name an ingredient whose
own recipe has expired and cannot be crafted at any price — which is what the
game added Omni tokens for (§10.0). The box triggers on availability instead,
and still turns on by itself if prices ever cross.

**4. The Omni box needed a price of its own.** It quoted the cost to CRAFT an
Omni token, which is the one number its reader is least likely to pay: they are
there because the ingredient can no longer be crafted, so they are buying. The
craft cost is now a default, overridable per Omni token.

**5. D3 has gutted the PRICE argument for the Phase 9 toggle.** §3.8's stat — GP
cheaper in about a third of seasons — was measured on each season's own prices.
Legendaries never expire, so all 43 are active and price at TODAY's prices,
where the ring ($114) beats 15 bars ($133): GP is cheaper on **0 of 43** today.
D8 still holds, because it was decided on on-hand likelihood rather than price —
a player sitting on 40 Gold Bars finishes for $0 — but the UI copy leads with
"you may already hold these", not "this might be cheaper".

**6. Per-line basis tags had to become deviation-only.** Tagging every line of an
expired recipe "over its build window" repeated one fact thirteen times and
buried the line that did something else. The recipe's basis is stated once under
the bill of materials; a line is tagged only where it deviates — which is how
2022 Greater Charm Bracelets ends up flagging only its Golden Fleece, an
off-auction item that cannot be windowed.

**7. `min` moves much harder than `avg`.** Windowing unions ~2 years of sales, so
an expired recipe's min is the cheapest sale in that whole range: Σ min falls
12.3% on active recipes and 9.9% on expired ones, against 2.1% and 1.1% for avg.
Inherent to D2/D3 rather than a defect, and **maintainer-confirmed** to keep min
windowed even though it is optimistic.

### 10.5 Backfilling the 2019–2021 auction dates

> **DONE — 2026-08-14.** The maintainer completed the manual backfill and went
> further than this section scoped: **every season now has `openDate`,
> `closeDate`, `daysToClose`, `Open Month` and `Close Month`**, a 2018 season was
> added (6 auctions, 118 sales), and all 294 auctions now carry a `Link`. Phase 4
> gets the date precision it wanted for free. Two leftovers, both recorded in
> `data-and-transformations.md` → Known gaps: auction 202112's `openDate` is
> typed as 2025 in a 2021 season (→ `Open Month 56`), and 2022 has no funding
> data. The rest of this section is kept as the record of the decision.

**Decided: the maintainer researches the threads manually.** ~40 auctions is small
enough that assisted lookup beats building a crawler, and D5 means this is **not a
blocker** — the site improves automatically as dates land.

What the data said at the time, if it were ever automated:

- **There are no links to follow.** 0 of the 42 pre-2022 metadata rows carry a `Link`
  (vs 185 of 236 from 2022 on), so it would be forum search by auctioneer name and
  thread title, not fetching a known URL. Matching "Hayward 3" to a specific 2020
  thread is exactly the ambiguous judgment a script does badly.
- **14 of the 41 need no crawling at all.** Every 2021 auction from #7 on encodes the
  date in its own name — `Miathin March 14`, `Wade Apr 25`, `Matt Oct 21` — so those
  are recoverable from `auctionMetadata.csv` as it stands. Caveats: the name gives one
  date (presumably close, not open), and the year comes from the ordering rather than
  the string.
- The real crawl target is therefore **27 auctions** (2019 ×6, 2020 ×15, 2021 ×6),
  the oldest and thinnest-documented, where thread start ≈ open and last post ≈ close.
- Conditions if automated: emit a **reviewable CSV patch with the source thread URL
  per row** rather than writing directly; land it in the **sheet**, not `public/data`,
  per `td-data-pipeline`; and confirm up front that fetching truedungeon.com's forum
  at that volume is acceptable.

---

## 11. Phase 7 — the price-season selector (decided + built 2026-08-17)

One global **"Price data from"** control at the top of the Recipes view: `Auto (each
recipe)` by default, or one of the nine priced seasons (2018–2026). Picking a season
re-prices every recipe on the page from that season's auctions.

§3.6 recommended the control and was right about its shape. What it could not
anticipate is that the accuracy release gave a recipe **three** possible bases —
active → today's prices (D3), expired → its build window (D2), and 34 authored
`ItemYear` pins — so "price everything from year X" now has to say which of them it
displaces. Three forks, all maintainer calls:

### F1 — The year overrides the RECIPE's basis. Authored pins keep their vintage.

A pinned season names **which token the recipe needs**, not merely which market to
read it in. The 34 pins split two ways and both readings agree: **22 relative
offsets** (`-1` … `-7` — a 2026 recipe calling for an Ultra Rare from the season
before, a 2022 one reaching back seven for an 8k Bonus) and **12 absolute pins**
(2023 Safehold V, 4 × 2025 Omni Orb, the three 2027 Charms). Repricing those would
quietly answer a different question than the recipe asks. So the selector displaces
today's-prices and the build window, and stops at the pin.

*Consequence, measured:* the **D4 Ultra Rare pool collapses**. A blank UR line pools
its recipe year ∪ year+1 to hold the era's baseline while trade goods float to today
— but that is what a UR resolves to when the basis is *"today"*, and under F1 the
basis is a named season instead. This is why **pinning 2026 is not the same as Auto**
even though 2026 *is* today: 49 of the 91 active recipes still move, 30 of them
because a pooled UR line collapsed into 2026 alone, 14 because a source line recurses
into an *expired* sub-recipe that was on its window, and 8 more from lines the
pre-2018 clamp had parked at 2018. All correct under F1; worth knowing before reading
a diff.

*(Rejected: overriding pins too, which is simpler to explain and makes every total
one clean season, but turns "an Ultra Rare from the season before" into "the 2021
Ultra Rare tier average" with nothing on screen saying the recipe asked for something
else. Also rejected: re-anchoring the 22 offsets to the selected year — most faithful
to recipe intent, but a third rule to teach, and it reaches below 2018 where there is
no data.)*

### F2 — Prices only. The clock does not move.

Status, the expired / preview badges, the Show Recipes filter and the recipe list all
still answer to **today**. Only the money changes. A recipe that is expired today is
still badged expired under a 2019 pin — it is simply priced from 2019 rather than
over its window, and both the badge's popover and the note under its bill of
materials say exactly that.

*(Rejected: the full time machine — setting the engine's `today` to the end of the
chosen season so statuses recompute and unreleased recipes drop off the page. It is
arguably the more honest answer to "what did this cost in 2021", but it is a much
larger build: every "still craftable" / "no longer craftable" string in both views
becomes past tense, and the reader loses the ability to ask "what would this recipe I
can still build have cost back then", which is the actual question.)*

### F3 — Recipes view only.

The calculator is a "what do I still owe on this build" tool and always asks today.
The engine is built with `priceYear: calculator ? null : priceYear`, so the pin is
simply not applied there; the selection is preserved rather than cleared, so
switching back to Recipes restores it. Pin 2021 on Recipes and hop to the
calculator and it prices at today's, not 2021 — deliberately, and visibly, since
the calculator now carries its own basis control (§11.3).

### 11.3 The full-season / last-5 control follows it onto the calculator (1a)

Reviewing F3 turned up a live inconsistency: `priceYear` is isolated from the
calculator, but `recentPrices` **was not** — and never had been. Verified in-browser
before deciding anything: select Last 5 on Recipes, switch to the calculator, and
`+3 Fellbane Crossbow` reads $850 rather than $644, with no control anywhere on
screen. The hidden toggle moved the build-vs-buy verdict.

**The record says this was never decided.** The control began as a page-level
checkbox; `888111e` (2026-07-21) moved it *inside the latest season's accordion*
because "the toggle only affects the latest priced season". The Build Calculator
landed **after** that move (`9d646f5`), inheriting "no control" structurally rather
than by choice. The accuracy release (`dde2ce5`) moved it back to the global bar with
a documented rationale (D3 made it move 91 of 174 rows) and introduced the
`!calculator &&` gate — a gate that carries no comment, in a file where the
mobile-disclosure decision beside it carries six lines.

**Resolved by showing it on both views, in the global bar.** Rejected: isolating the
calculator to full-season, one line and consistent with F3, but last-5 is exactly the
reading a buyer wants when a trade good is moving, and the calculator is where that
matters most. Also rejected: a third pair on the calculator's **tools strip** —
prototyped and measured, and it fails on two counts. The strip only renders once a
recipe is picked, while the **browse drawer's prices answer to this control** ($644 →
$850 in the drawer, measured), so the control would be absent at the moment you are
comparing recipes; and on a phone a third control wraps the strip from 76px to 148px,
above a bill of materials the Phase 9 constraints already call ~1,955px tall.

The global bar has neither problem: the control sits above the picker, governs the
drawer, and costs one 72px row on a phone. It is declared once as `recentToggle` and
rendered in both views, so the two copies cannot drift. It stays hidden only where it
cannot act — a pinned PAST season on the Recipes view — which the calculator never
has.

### 11.1 How it is built

One option on `CostOptions`, one rung in the `leafForGood` rule chain, one memo dep,
one control. The rung sits **below** the pin (F1) and **above** both the expired
window and the UR pool, and falls through when the pinned season prices nothing at
all under that name — the same invariant the rest of the chain keeps: whichever
branch fires, a line that could be priced before must still be priced after. A line
the pinned season cannot price falls to the existing clamp and is tagged `from YYYY`,
which is also what marks the row `est.`.

`BuildCost.priceYear` carries the basis to the view so it is **stated once** under
the bill of materials rather than tagged on all thirteen lines (§10.6.6). Under a
pin, `priceTag` reads its deviations against the pinned season instead of the
recipe's year, so the only lines wearing a year are the pins and the fallbacks. The
`Today's prices from` (full season / last 5) toggle is **hidden** while a past season
is pinned — last-5 is a reading of the season still in progress and `variantFor`
already ignores it there, so leaving it on screen would be a control that cannot move
a number. It returns for Auto and for a 2026 pin. The build-vs-buy market price moves
with the pin too, or a 2019 build cost would be weighed against a 2026 asking price.

### 11.2 What it measures

Σ full build cost across all 174 recipes, against Auto (today = 2026-08-17):

| Basis | Σ avg | vs Auto | Σ min | vs Auto | recipes moved |
|---|---|---|---|---|---|
| Auto | $138,824 | — | $92,164 | — | — |
| 2018 | $151,721 | +9.3% | $125,604 | +36.3% | 160/174 |
| 2019 | $154,072 | +11.0% | $129,167 | +40.1% | 173/174 |
| 2020 | $142,062 | +2.3% | $113,445 | +23.1% | 173/174 |
| 2021 | $139,649 | +0.6% | $97,312 | +5.6% | 173/174 |
| 2022 | $133,559 | −3.8% | $90,470 | −1.8% | 173/174 |
| 2023 | $123,250 | −11.2% | $90,941 | −1.3% | 173/174 |
| 2024 | $121,202 | −12.7% | $67,293 | −27.0% | 173/174 |
| 2025 | $122,812 | −11.5% | $82,484 | −10.5% | 173/174 |
| 2026 | $133,215 | −4.0% | $82,747 | −10.2% | 132/174 |

No line goes unpriced at any basis. The shape is the same one §10.6.7 found: `min`
moves several times harder than `avg`, because a single season's minimum is one sale
rather than a window's union of two years of them.

**Two invariants checked by measurement, not by review:**

1. **Auto is byte-identical to what `main` produced** — 174 recipes compared
   recipe-by-recipe and line-by-line (totals, status, estimate, unpriced count,
   market price; per line the priced year, basis, season-mapped and floated flags and
   the extended price): **0 diffs**. The feature is inert until a season is picked.
2. **Pins never move** — 306 pinned-line observations (34 pins × 9 seasons): **0**
   changed their priced year.
