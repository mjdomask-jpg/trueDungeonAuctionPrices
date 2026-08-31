# Shopping List — build handoff

Working notes for the Shopping List view (a third view on the Transmutes page).
**Written for a session that has none of the originating conversation.** Updated
in place at the end of every step, not appended to.

Design doc with wireframes and the full reasoning:
<https://claude.ai/code/artifact/601e1397-67c5-43c6-bf8a-1e9bb6bed41d>

---

## Where we are

| Step | What | State |
|---|---|---|
| **0** | Extract `RecipeDrawer` + `lineTag` out of `BuildCalculator` | **done, verified, merged** ([#136](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/136), squashed as `6203c40`) |
| **0a** | Delete the `tierLine` branch #137 emptied | **done, verified, merged** ([#139](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/139), squashed as `32d25fc`) |
| **1** | Pricing branches in the engine + `lib/shoppingList.ts` + the basis selector | **done, verified, merged** ([#140](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/140), squashed as `01b754e`) |
| **1a** | Backlog entry: `IngredientType` authored two ways | **done, merged** ([#141](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/141), `72f026b`) |
| **2** | Route, view toggle, chip strip, drawer wired to multi-select | **built, verified, PR open** |
| 3 | The two ingredient tables | **next** |
| 4 | Final table, Copy, Download CSV | not started |
| 5 | `localStorage` autosave, 10x hint, docs | not started |

**Two standing rules the maintainer set for this build:**

1. **Every step ends in a full stop.** Build it, verify it, show it, and *wait* —
   including when the next step looks obvious. A wrong step is cheap to redo
   alone and expensive to unpick from under three more.
2. **Every step ends by updating this file.**

`main` requires the `build-and-validate` check, so everything goes through a PR.
Recent convention is **squash merge** (commits on `main` carry a `(#NNN)` suffix).

---

## What the feature is

The Build Calculator answers *"should I build this one token or buy it?"*. The
Shopping List answers a quartermaster's question instead: **across every
transmute I plan to make, what do I still have to buy and what will it cost?**
Players do this in personal spreadsheets today.

Two measurements shaped the design:

- **There are exactly 14 distinct trade goods across all 174 recipes.** Pick all
  28 of the 2026 recipes and the Trade Goods table is still 14 rows. Only the
  *Additional Items* table grows with the number of recipes (~1 row each).
- **Merging by name is only safe because of a pricing rule, not by accident** —
  see below.

---

## The pricing model — REVISED after PR #137

> **Read this section carefully. Half of it is already built.**

Domain rule from the maintainer: the Shopping List only holds recipes a player
can **actually make**, so everything is acquired **now**, at today's prices.
Out-of-print tokens are the exception — they come off the secondary market at
whatever their availability window said.

The four branches, and their status **as of `93fcec9` on `main`**:

| | Branch | Lines | Status |
|---|---|---|---|
| 1 | **Trade goods → current season, always** — whatever year the recipe came from, including expired and 2027-preview ones | 1,125 | **BUILD THIS** |
| 2 | **Ultra Rare, in print** (nominal ≥ `latestPriced − 1`) **→ current season price** | 27 | **BUILD THIS** |
| 3 | **Ultra Rare, out of print → pooled over its own two-year window**, tagged `OOP` | 40 | **engine already does it** ([#137](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/137)) — **plus the 10 pinned lines, which it does NOT yet do; see the decision below** |
| 4 | **Ultra Rare older than the auction data → clamp to the earliest priced season** | 18 | **engine already does it** (D4's clamp) |

Merge keys: **trade goods on the item name alone** (branch 1 guarantees one
price per good, so 14 rows always); **Additional Items on name + nominal year**,
because in-print vs out-of-print is a function of that year.

**No `CostOptions` flag** — the branches go into the engine unconditionally and
both the Shopping List and the Build Calculator read them.

### What #137 changed, and why branches 3 and 4 are free now

PR #137 ("An Ultra Rare line reads its two seasons, not the craft window's
dates") reordered `leafForGood` so a **blank** Ultra Rare line reads the
two-season pool *before* the expired-recipe date window, and is no longer gated
on recipe status. The domain rule behind it:

> **A season-Y token is obtainable from season Y or season Y+1, and nowhere
> else.** (A UR won in season N redeems for a token from N or N−1; inverted.)

The defect it fixed: the craft window filters on **close date alone**, and
seasons run autumn to autumn, so the window for a 2022 Relic ran to 2023-11-24
and swept in 20 of season 2024's 41 auctions — 33 UR sales pricing a token those
auctions could never have produced. **Structural, not a 2022 accident: every
expired window from 2018 on admits a third season.**

Verified on current `main`: **`basis === 'window'` now fires on 0 Ultra Rare
lines** across all 174 recipes (80 pool, 45 season). The rule order is:

```
 1.  explicit ItemYear pin            never floats
 1b. explicit priceYear (Phase 7)     the reader named a season
 3.  blank Ultra Rare → two-season pool   ← moved up, ungated on status
 2.  expired recipe → date window      every remaining line
 4.  active recipe → today's prices (D3)
 5.  defensive fallback
```

The comment numbers read out of sequence **on purpose** — they match the plan's
rule IDs. Do not "tidy" them.

### DECIDED 2026-08-31 — pinned Ultra Rare lines pool too

**Maintainer's call: yes. A pinned UR line reads its two-season pool, exactly
as a blank one does.** The reasoning that carried it: the pin names *which
token* the recipe needs; the pool names *where that token could be bought*.
Those are different questions, and rule 1 was answering the second with the
first. §10.2's F1 does not bite, because pooling does not change vintage — it
reads both seasons of the *same* vintage, which is precisely what F1 protects.

**What step 1 must therefore build.** Rule 3 has to be reachable from a pinned
line, and its pool has to key off the LINE's year rather than the recipe's:

```ts
this.prices.poolPrice(good, [l.nominalYear, l.nominalYear + 1])
```

That expression is **identical to today's behaviour for blank lines** —
`resolveGoodYear('')` returns `recipeYear`, so `l.nominalYear === recipe.year`
there — so the change is purely additive. Two things to get right:

- `isPoolableUltraRare` currently returns `false` on any pin (`transmutes.ts`
  around line 689). That guard is what has to go, not the pin branch itself:
  rule 1 must still short-circuit for pinned NON-UR lines (Safehold V and the
  rest of the 34 pins).
- The **clamp** under the pool reads `recipe.year`. For a pinned line it must
  read `l.nominalYear` too, or a pinned 2027 line (Coin of Wealth) whose pool
  is empty falls back to the wrong season. Currently that line prices at
  $59.69 via the pin branch; whatever the new path does, it must still.

The historical argument, the ten affected lines and the −$47.13 / −$35.93
measurement that informed the call are preserved below.

**The case as it was put:**

Rule 1 (explicit `ItemYear`) short-circuits before rule 3, so a pinned UR still
reads **one** season. The reasoning that justified #137 — a UR has a vintage, so
you must read the two seasons in which that token was actually sold — does not
stop being true because the year was authored rather than inferred.

All ten pinned UR lines in the repo, with what pooling would do:

| Status | Recipe | UR yr | pin | one season | two-season pool | Δ |
|---|---|---|---|---|---|---|
| future | Smith's Charm of Unified Synergy (Set 2) | 2017 | `2017` | $140.00 | $111.50 | — (pre-data) |
| future | Coin of Wealth | 2023 | `2023` | $92.20 | $80.00 | −$12.20 |
| future | Coin of Wealth | 2025 | `2025` | $70.02 | $64.62 | −$5.39 |
| future | Coin of Wealth | 2027 | `2027` | $59.69 | — | — |
| active | Deathward Greaves | 2025 | `-1` | $70.02 | $64.62 | −$5.39 |
| active | Deathward Greaves | 2024 | `-2` | $71.48 | $70.73 | −$0.75 |
| active | Deathward Greaves | 2023 | `-3` | $92.20 | $80.00 | −$12.20 |
| expired | Arcanum Shirt | 2022 | `-1` | $93.74 | $92.96 | −$0.78 |
| expired | Arcanum Shirt | 2021 | `-2` | $114.23 | $100.39 | −$13.84 |
| expired | Arcanum Shirt | 2020 | `-3` | $107.81 | $111.23 | +$3.42 |

**−$47.13 across all recipes, −$35.93 across the pickable ones.** Small, but the
sample sizes are not: pooling 2023 takes n from 51 to 124, and 2025 from 77 to
158.

**The argument for pooling them:** the pin names *which token* the recipe needs;
the pool names *where that token could be bought*. Those are different
questions, and rule 1 currently answers the second with the first.

**The argument against:** §10.2's F1 says a pin "names WHICH token the recipe
needs, not merely which market to read, so repricing it would quietly answer a
different question." That was written about the Phase-7 `priceYear` override —
which *does* change vintage — and pooling does not; it reads both seasons of the
*same* vintage. So F1 may not actually bite here.

The answer was **yes**, so branch 3 covers pinned lines, the engine needs the
one change described above, and the Deathward Greaves drift recorded further
down **closes** rather than being intentional. This moves the Build Calculator
as well as the Shopping List, by design.

⚠ The ten prices in that table were measured **before #137 merged** on some
rows. Re-derive them against `main` as part of step 1's test suite rather than
pinning a test to them as written.

### The default price basis, and the volatility flag

**Default is Full season, with a flag on goods whose season average is stale.**

The reasoning matters because it was got wrong once. Trade-good prices do **not**
follow a reliable seasonal sawtooth — measured by quarters, the within-season
change runs −6%, −5%, +75%, +72%, +31%, +38%, +3%, +17% across 2019–2026. A
tendency, not a law. (An earlier pass claimed a clean sawtooth; it had compared
each season's first five auctions to its last five, and 2026's last five carry
just **eight sales over five months** with single-sale months. Don't rebuild that
argument on the season tail — use quarters.)

What is real is that **goods diverge**. Mystic Silk has sat within cents of $1
since 2020. Elven Bismuth has repriced ~7× since 2024 ($9.50 → $52.67) and its
2026 season average of $31.67 is badly stale against $45–86 for every sale since
January. Full-season vs last-5 across the 24 active 2026 recipes is a **37%
swing — $9,389 vs $12,827** — and almost all of it is two goods.

So the flag fires on the narrow question **"is this good's season average
stale?"** — recent sales diverging materially from the full-season average — and
the row states a fact, not a forecast: *"season avg $31.67 · recent sales
$52.67 — this one is moving."*

**Open sub-task for step 1:** derive the divergence threshold from the data
across all 14 goods and bring the maintainer a proposed cutoff **with the
hit-list it produces**. Do not invent a number.

---

## Settled decisions

| # | Decision |
|---|---|
| D1 | Pricing model above. Trade goods merge on name; Additional Items on name + nominal year. |
| D1a | "Current season" overrides a **future** (2027 preview) recipe's basis too, not just an expired one's. |
| D1b | Full season default + volatility flag (above). |
| D2 | **On Hand does NOT clamp.** `Need = max(0, Total − OnHand)`; surplus shows as "N spare". Deliberate divergence from the calculator — a stash is a fact about the player, not the plan, and clamping destroys a typed number when a recipe is removed. Document in `docs/ui-conventions.md`. |
| D3 | **Avg only**, no min column. Min becomes a footnote total ("$X at minimum prices"), following the Phase 3 precedent of stating the basis in prose. The price editor edits one number. |
| D4 | Sources do **not** recurse. A source is one Additional Item, category `Transmute`, priced at build cost, tagged "source · built". |
| D5 | **Chain netting is in scope.** Adding a Relic *and* the Legendary it upgrades into currently asks you to buy the Relic twice — 51 such source lines across all seasons, and the drawer displays the pairs adjacently so people will hit it. Detect and *offer* a one-tap "count the ones you're crafting as on hand". Explicit and reversible, never automatic. |
| D6 | Final table gets its **own sort order**: all trade goods first, alphabetical by item, categories intermixed; everything else after by category then item. Do **not** extend the shared `CATEGORY_ORDER` in `lib/categories.ts` — Prices, Compare and Explorer all read it, and it omits Trade 3/4/5, which would otherwise split the trade goods across the table. |
| D7 | Wish Ring / 15,000 GP is **one global toggle**, matching the Recipes view. |
| D8 | Lives at `/transmutes/shopping` via `useRoutedView`. Three-button view toggle (`Recipes · Build Calculator · Shopping List`, short labels under 640px). Last-5 toggle comes along; the price-year pin does not. |
| D9 | Expired recipes stay addable (branch 1 prices them correctly). **The leaf backfill sweep came back clean** — all 25 leaf ingredients on the 103 pickable recipes are priced (12 auction, 12 offAuction, 1 derived); zero unpriced lines across all 174 recipes. Keep no-price handling defensively, but it is unreachable today. |
| D10 | No `CostOptions` flag. Both views read the same pricing. |
| — | **Totals**: subtotal per table, grand total on the final list, headline figure in the top bar. |
| — | **Notes vocabulary is fixed**, always in this order: `Price adjusted` · `Source for X ×N` · `For X ×N` · `Priced as …` · `N spare` · `Out of print`. A free-text column mixing concepts cannot be filtered in a spreadsheet. |
| — | **Copy as TSV** and **Download CSV** are in. **XLSX deferred** (needs either a ~400KB dependency or a hand-rolled zip writer). |
| — | **Excel formula guard**: 33 item names start with `+`; zero with `-`, `=`, `@`. Apostrophe prefix on the **Copy** path only, where it is consumed correctly on paste. CSV ships clean quoted values. Revisit at step 4 with a real file if Excel misbehaves. |
| — | **Save/recall = `localStorage` only.** Share links dropped (a quartermaster's list makes a punishing URL). A server-side "code" system is **impossible on GitHub Pages** — static hosting has no write path, and a repo token in client JS would be public. |

### UX calls

- **Re-selecting an added recipe increments**, never removes. Remove-on-repeat-tap
  makes the most likely accidental input (a double-tap) destructive. The added
  drawer row grows a −/+ stepper in place.
- **Selection renders as wrapping chips**, not rows — selection is input, the
  list is output, and output should own the screen. Collapse above 8.
- **Quantity 0 does not remove**; it renders as an explicit **paused** state
  (dimmed, struck through, counted separately in the summary). The `×` is the
  only thing that removes.
- Mobile mirrors the calculator's proven reflow exactly.

---

## Numbers, measured against `93fcec9`

Re-derived after #137 merged. **These supersede any figure in the design
artifact** — that page was written against the pre-#137 engine.

- 174 recipes: **91 active, 12 future, 71 expired**. Pickable (active + future) =
  **103**. Active recipes span **2012–2026**, not just recent years.
- Pickable recipes hold **85 Ultra Rare lines** (78 blank, 7 pinned) and **1,125
  trade-good lines**.
- **#137 did not move any pickable-recipe UR price.** It moved expired ones,
  which the Shopping List can still hold (D9). Expired UR lines now read
  23 pool / 17 season.
- My branches 2–4 vs what the engine now does: **59 of 85 UR lines already
  agree**; 26 still differ, total swing **−$217.46**, all downward. Biggest
  movers: Omni Cube Ultra Rare Recipe −$56.38, Smith's Charm of Unified Synergy
  (Set 2) −$28.50, Giln's Redoubt Shield −$28.50, Deathward Greaves −$23.47.
- **Deathward Greaves** (the worked example for the calculator/Shopping-List
  divergence) — UR subtotal calculator **$293.20** → Shopping List **$269.73**,
  drift **−$23.47**. Unchanged by #137, because all three of its UR lines are
  pinned and pins never reached the window.

### Already measured — do not re-derive

Season boundaries, from `auctionMetadata.csv` close dates:

```
season  first close   last close    auctions
2018    2017-11-05    2018-09-30     6
2019    2019-01-08    2019-09-07     8
2020    2019-10-09    2020-09-23    21
2021    2020-10-18    2021-10-31    24
2022    2021-11-06    2022-09-21    50
2023    2022-10-04    2023-09-15    51
2024    2023-09-26    2024-08-21    41
2025    2024-09-18    2025-09-18    43
2026    2025-09-25    2026-08-15    45
```

- The **7-day shipping cutoff currently trims nothing** — 0 season-(Y+1)
  auctions close after Nov 24 of Y+1, because every season finishes selling by
  late September.
- **There are zero authored `Expires` values** in `transmuteRecipes.csv`. The
  `year + 1` default in `expiryOf` does 100% of the work. The exceptions §10.2
  cites (Ioun Stone Mystic Orb, Mark of Enlightenment) were never entered.

---

## Step 0 — what was done

Squashed to `6203c40`. Three files:

- **`src/lib/lineTag.ts`** (new) — `lineTag` and `WINDOW_TAG`, moved verbatim.
- **`src/components/RecipeDrawer.tsx`** (new) — the slide-in picker.
- **`src/components/BuildCalculator.tsx`** — 192 lines lighter, behaviour unchanged.

The drawer **owns its filter state** (search, tier, show-expired, expanded
years) because those describe the picker, not what is being built with it. The
**parent owns the selection** — `selectedKeys: ReadonlySet<string>`,
`onPick(cost)`, `clearFiltersOnPick`, `focusYear`. Step 2 adds quantity steppers
additively without changing `selectedKeys`.

Verified: `lineTag` byte-identical and its call site character-identical, so
provenance wording is provably unchanged for all 174 recipes; every moved logic
block identical by diff; and an interactive pass covering the drawer's filters,
the pick-clears-but-✕-does-not asymmetry, the selected-row highlight, mobile
375px and a clean console.

### One cleanup this UNBLOCKED

`lineTag` carries this branch, added by #135:

```ts
if (l.basis === 'window' && l.tierLine && !parts.includes(WINDOW_TAG)) parts.push(WINDOW_TAG);
```

**It now fires on 0 lines** — #137 removed the Relic/Legendary disagreement at
its source, so no UR line has `basis === 'window'` any more. It was deliberately
left in place so it would not conflict with step 0's new file. **Step 0 has now
merged, so the queued cleanup is unblocked**: delete `tierLine`, its assignment
in `transmutes.ts`, and the equivalent branch in both `lib/lineTag.ts` and
`TransmuteRow.tsx`. Keep `WINDOW_TAG` as a named constant — the other
`basis === 'window'` branch still uses it.

**DONE — [#139](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/139)**, landed on its own so step 1's diff stays pure. Removed the
field, its assignment, and the branch in both `lineTag` and `priceTag`; kept
`WINDOW_TAG`, because 470 non-UR lines still price over a window and the other
branch names it. Verified by running the engine over all 174 recipes before and
after: **1,985 lines identical** on unit price, basis, `pricedYear` and tag
wording, under both price toggles. The plan doc's note at
`transmutes-expansion-plan.md` §10.6 was updated to match.

---

## Traps and gotchas

- **`lineTag` and `TransmuteRow`'s `priceTag` are near-duplicates and were
  deliberately NOT merged.** `priceTag` takes a fourth argument (the Recipes
  view's pinned price year) that *changes* two rules rather than adding one.
  `priceTag(l, y, s, null)` looks equivalent and very nearly is — but that is not
  a thing to assert about wording shown on 174 recipes without a test pinning
  both over the whole corpus. Worth writing; not worth writing blind inside a
  refactor whose contract is "nothing changes".
- **This working directory is SHARED between sessions.** Another session made an
  edit believing it was on `main` and it landed in this tree on a feature
  branch. **Check `git branch --show-current` before you commit** — it is not
  always what your session last set it to. Uncommitted work here can and did
  vanish; if you find a foreign modification, leave it alone and ask.
- **`site/.claude/launch.json` is TRACKED**, so an edit to it shows up staged and
  rides along with an unrelated PR. I nearly shipped one that way. `CLAUDE.md`
  now documents this and the `preview_start` limits below — read it there rather
  than rediscovering them.
- **`preview_start` refuses whenever port 5173 is held by another session's dev
  server**, and adding a second launch config does not help — it resolves the
  config from the session's project dir, finds the same `td-site` entry, and
  refuses. It **cannot target a `git worktree`** either. The port has to be
  freed, or lean on CI.
- **A `navigate` to a URL differing only in the hash is a no-op** on this
  HashRouter app, so React state survives what looks like a fresh page load and
  a test silently inherits the previous run's selection. Use `location.reload()`.
- **This box's Browser pane cannot screenshot localhost** and never delivers
  `IntersectionObserver` callbacks — so the calculator's pinned summary strip
  cannot be verified there at all. Use headless Edge over CDP for real PNGs.
  See `~/.claude/CLAUDE.md`.
- **Don't measure season behaviour on the last five auctions.** 2026's tail is
  eight sales over five months. Use quarters.
- **There is no React test harness** — all eight `npm test` suites are pure-node
  validators. Component behaviour cannot be unit-tested without adding a
  dependency.
- Analysis harness for the engine lives in the scratchpad, not the repo: copy
  `src/lib/*.ts` out, rewrite the internal imports to carry `.ts`, and run with
  `node --experimental-strip-types`. ESM will not resolve extensionless internal
  imports. **Re-copy after any `main` change** — the engine moved twice under
  this project already.

---

## Step 1 — what was built

Four things, one PR. `tsc -b`, lint, `npm run validate` (0 errors), all **nine**
test suites and `npm run build` all pass.

### 1. The rule chain, restructured

`leafForGood` now reads, in order:

```
 1.  pin, for NON-Ultra-Rare lines only    never floats (24 lines)
 1b. priceYear (Phase 7), unpinned only    the reader named a season
 S2/3/4. the Ultra Rare rules, as ONE SET, pinned or blank:
         in print  -> current season       (27 lines)
         otherwise -> two-season pool      (40 lines)
         beneath   -> D4's clamp           (18 lines)
 S1. trade goods -> current season         (1,736 lines; 1,125 pickable)
 2.  expired recipe -> date window         every remaining line
 4.  active recipe -> today's prices (D3)
 5.  defensive fallback
```

**The Ultra Rare rules had to become one SET, not two branches.** Splitting
them by how the year was authored produced a real defect during the build: a
*pinned* 2025 line pooled while a *blank* 2025 line read the current season —
two prices for one vintage, decided by nothing but which cell an author filled
in. "Pinned Ultra Rares pool **exactly as a blank one does**" is the whole rule,
not just its pool half, so the pin now falls through to the set rather than
short-circuiting above it. A test pins this directly.

`recipe` is no longer a parameter of `leafFor`/`leafForGood`: **every rule now
keys on the LINE**. That fell out rather than being aimed at — old rule 3 read
`recipe.year` where it meant `l.nominalYear`, the same number on a blank line
and the wrong one on a pin.

`isTradeCategory` is **exported** from `transmutes.ts` and used by both the
engine's S1 and the Shopping List's merge key. They are the same question asked
twice — "trade goods merge on name alone" is only sound while S1 gives each one
a single price — so they must not be allowed to drift.

`isUltraRare` reads the **resolved category**, symmetric with `isTradeGood`,
not the authored `IngredientType` alone. See the data note below.

### 2. `src/lib/shoppingList.ts`

`{cost, qty}[]` + on-hand + overrides in; merged rows, chains and totals out.
Implements D2 (no clamp), D3 (min as a footnote total), D4 (sources are one row
at build cost, no recursion), D5 (chain detection, reported not applied), D6
(its own sort order), D7 (one global Wish Ring toggle via `onPath`), and the
closed note vocabulary in its fixed order. No React, no fetching.

### 3. `scripts/shopping-list.test.mjs` — the ninth suite

**48 assertions**, wired into `npm test`. It is the first suite that tests
`src/lib` rather than a `.gs`/`.mjs` file, so it copies the sources to a temp
dir with `.ts` appended to their internal imports and runs them through node's
own type stripping — the technique `CLAUDE.md` already prescribes. No new
dependency, nothing in the repo written to. `today` is **pinned to 2026-08-31**
or every status assertion decays as the calendar moves.

### 4. The staleness threshold — DERIVED, with its hit-list

**35%**, exported as `STALE_THRESHOLD`. Measured over **117 good-seasons** (13
of the 14 goods across 9 seasons; Golden Fleece has no auction rows at all and
can never be measured). The divergences fall into two populations with a wide
empty band between them:

```
ordinary season noise      0% .. 27%
sustained regime change   46% .. 100%
```

**Every cutoff from 20% to 50% produces the identical 2026 hit-list**, so the
number is not load-bearing for what ships; what it changes is how often the flag
fires historically (13.7% of good-seasons at 20%, 6.8% at 35–45%, 5.1% at 50%).
35% sits on the flat middle of that range and is the smallest cutoff at which
only *sustained* repricings fire. A test pins the derivation, not just the
number, so a future season that narrows the gap fails loudly.

**The 2026 hit-list is two goods, and the handoff only knew about one:**

| good | season avg | recent (last-5) | divergence |
|---|---|---|---|
| Elven Bismuth | $31.67 | $63.25 | **+100%** |
| **Oil of Enchantment** | $43.40 | $67.75 | **+56%** |

Both are **understated** by their season average, so the Full-season default
under-quotes them. Historically the flag would also have fired on Enchanter's
Munition 2020–2024 (now calm at 2%) and on both of the above from 2025.

⚠ The earlier note that Elven Bismuth's recent price was **$52.67** does not
reproduce; measured against `prices.csv` it is **$63.25** on last-5 and $61.93
over 180 days. Use the measured figures.

---

## RESOLVED — A and B, by making the basis a user choice

**Decided 2026-08-31.** Both consequences below were real, and both are now
answered by one control rather than by picking a winner between two questions.

### D11 — the pricing basis is selectable, and it is not the year pin

`CostOptions.basis: 'today' | 'era'`, carried on `BuildCost` so a view can state
it in prose instead of inferring it from `status` (which is what the notes used
to do, and why they went stale the moment the rules changed).

```
'today'  everything at the current season, EXCEPT tokens that can no longer be
         bought at all -- an out-of-print Ultra Rare keeps its own vintage's
         market. Engine DEFAULT: it is what the Shopping List and the Build
         Calculator both ask, and what D3 already does for the 91 active recipes.
'era'    each recipe on its own basis -- today's prices while craftable, its
         build window once expired, a forward estimate while it is a preview.
```

**Verified: `basis: 'era'` reproduces the pre-#140 engine exactly** — 1,977 of
1,985 lines identical under both price toggles, and the 8 that differ are
precisely the pinned Ultra Rares signed off separately. The historical view
loses nothing, and that is a provable claim rather than a hopeful one.

**It is NOT the same axis as `priceYear`, and that is why all three exist.**
Pinning 2026 quotes season 2026 for tokens that season never sold; `'today'`
moves only what is actually purchasable. Measured: they differ on **150 lines,
$4,781.56, 90 of them Ultra Rares** — e.g. a 2012 Ring of Evasion reads $111.50
under "today's prices" (its own 2012–13 market) and $59.50 under a 2026 pin,
which claims you can buy a 2012 Ultra Rare at this year's price. You cannot.
`recentPrices` is a third axis again: it chooses the SAMPLE inside a season.

**The control is not a new one.** `TransmutesPage`'s existing `Price data from`
select had `Auto (each recipe)` as its first option — precisely the ambiguous
mode. That entry became two:

```
Each recipe's own era     <- DEFAULT on the Recipes view
Today's prices
2026 prices … 2018 prices
```

State is a single `pricing: 'today' | 'era' | number`, with `priceYear` and
`basis` derived from it, so no invalid combination can be selected. The
calculator forces `'today'` exactly as it already forces `priceYear: null` (F3).

**Both S1 and S2 are gated on the basis; the pool beneath them is not.** S2 had
to be gated as well as S1 or the 2027 preview would not restore — 8 of the 12
future recipes' Ultra Rare lines are in-print 2027s. The two-season pool stays
ungated because "which two seasons could this vintage have come from" is a fact
about the token and is true under either basis (#137).

### ⚠ How far the basis actually reaches — an earlier claim was WRONG

It is tempting to say the control only touches the expired section. It does not,
and a test now pins the real numbers:

| | |
|---|---|
| an active recipe's own **trade goods** | identical under both bases, all **1,014** lines |
| active recipes whose **total** moves | **49 of 91** |
| ...via an expired **sub-recipe** | 42 lines |
| ...via an **in-print Ultra Rare** (S2) | 13 lines |

An active Legendary is routinely built from an expired Relic, so it inherits
that Relic's basis. Anyone reasoning about blast radius from "S1 is a no-op on
active recipes" — which is true of the leaf lines — will get this wrong.

### The prose the old behaviour had made false

#140 as first written shipped **two untrue sentences**, both now fixed and both
conditional on the basis:

- `TransmuteRow.tsx` told every reader of all 71 expired recipes that ingredients
  were priced over the build window "**rather than at today's prices, which
  nobody could have paid for it**" — while printing today's prices above it.
- `TransmutesPage`'s filter hint said the same thing.

A third was stale independently of #140: the Ultra Rare note had said "priced at
the auction average for **the transmute window**" since before #137 made them
pool. Also fixed. The recent-prices hint is now conditional too — under `'today'`
the toggle really does reach every recipe, and it used to claim expired ones
ignore it.

---

## The two consequences, as they were found

### A. Every expired recipe reprices in the Recipes view

Branch S1 sits above the expired window by design (D1a), so all **611** expired
trade-good lines now read 2026 prices instead of their build window's. All 71
expired recipes move; the total goes **$21,634.75 → $21,894.31 (+1.2%)**.

That is correct for the Shopping List — a Darkwood Plank has no vintage, and the
only one you can buy is the one on sale now. It is *wrong* for the Recipes view,
whose expired section answers "what did this cost when it was craftable". The
accuracy release built the date window for exactly that question.

**Resolved by D11:** the Recipes view defaults to `'era'` and keeps the window;
`'today'` is one option away for the reader who wants the other answer.

### B. The 2027 preview drops 7.8%, and its toggle starts working

| | before | after |
|---|---|---|
| Full season (default) | $11,492.18 | **$10,601.30** (−7.8%) |
| Recent prices ON | $11,492.18 | **$12,039.66** |

The 2027 preview used to clamp forward to **2026-last-5** through
`pricingSeason`, and — note the identical figures — **the recent-prices toggle
did nothing to it at all**. S1 replaces that clamp with the current season under
the ordinary toggle, so the default becomes the full-season average and the
toggle becomes live.

**Resolved by D11:** under `'era'` the forward last-5 estimate is restored, so
the Recipes view's preview is unchanged from before #140. Under `'today'` the
preview reads the current season and the recent-prices toggle governs it like
everything else — which is the honest answer for someone shopping now.

---

## A data inconsistency found on the way (not fixed here)

`Charm of Synergy` is authored **two different ways** in `transmuteRecipes.csv`:

- row 414, `2017|Giln's Redoubt Shield` — `IngredientType = Ultra Rare`
- row 1910, `2027|Smith's Charm of Unified Synergy (Set 2)` — **blank**

`tokenMetadata.csv` says the token is Ultra Rare, so reading the resolved
category (which `isUltraRare` now does) makes the two agree. **It costs nothing
today** — the token has its own hand-authored off-auction price of $140.00, so
both lines price identically and never reach the tier — but it would start
costing something the day that off-auction row went away. Worth an entry in
`docs/data-backlog.md`; not worth a data edit inside a pricing PR.

This also corrects the handoff's own pinned-UR table: it listed the two-season
pool for that line as **$111.50**, which is the *Ultra Rare tier's* 2017–2018
pool. The rule chain never reaches the tier, so the line stays at **$140.00**
and the row is a genuine no-op.

---

## Superseded: what step 1 was told to do

1. Add **branch 1** (trade goods → current season, always) and **branch 2**
   (in-print URs → current season) to the engine, and open rule 3 to pinned
   lines. Branches 3 and 4 otherwise already exist — do not reimplement them.
2. Build `src/lib/shoppingList.ts`: `{recipe, qty}[]` + on-hand + overrides in,
   merged rows and totals out. Includes D5 chain detection.
3. New test suite pinning both new branches, the pinned-UR pool, the pre-2018
   clamp, and the figures in the "Numbers" section above. Wire it into
   `npm test` alongside the existing eight.
4. Derive the volatility threshold and bring the maintainer the hit-list.

**No UI in step 1.** The maintainer signs off on a table of numbers, which is the
cheapest place to catch a wrong rule.

---

## Step 2 — what was built

The selection surface. Picking, quantities, pausing and removing all work end to
end and feed `lib/shoppingList.ts`; step 3's tables are the only thing missing,
and the view says so on screen rather than pretending to be finished.

**`src/components/ShoppingList.tsx`** (new) — chip strip, summary bar, drawer
wiring. Selection is `Pick[]`, an **array not a Map**, so the chips read in the
order the plan was built rather than in key order.

**`RecipeDrawer`** grew two optional props, `quantities` and `onQuantityChange`.
Given both, a picked row grows a −/+ stepper in place; given neither it is
exactly the single-select picker it was, and the calculator passes neither. One
real constraint fell out: **a stepper cannot live inside the row's own
`<button>`** — nested buttons are invalid and the inner one never receives its
click — so a stepping row becomes a `div` wrapping the same content in a
`.calc-opt-hit` button. Unpicked rows stay plain buttons, so the first tap is
still one tap.

**`TransmutesPage`** — `'shopping'` added to `useRoutedView` (the route was
already `transmutes/:view`, so nothing in `main.tsx` changed), a third toggle
button with the short label `Shopping` under 640px, and its own `PageIntro`.
The Wish Ring toggle was **lifted out of `optionControls`** into a `pathToggle`
node, because the Shopping List renders it too — it changes what is *on* the
list, so it is not a Recipes-view preference.

`recipesView` replaces `!calculator` as the gate on the basis selector, the
price-year pin, the search box and the options block. That was the bug waiting
to happen: `!calculator` would have handed the Shopping List the whole Recipes
options bar, including the basis control it must not have.

### Verified in the browser, all three views

| | |
|---|---|
| pick a recipe | chip + summary bar + 13 merged trade-good rows |
| re-pick the same one | **increments** to 2, $197 → $395 — never removes |
| add a second recipe | 3 tokens / 2 recipes / $590, and trade goods stay **13** while other items go 0 → 2 |
| ten recipes | **14** trade goods against **16** other items — the founding measurement, live |
| − to zero | chip dims to 0.55, name struck through, bar reads `· 1 paused`, total drops, row **stays** |
| + from zero | restores exactly |
| ✕ | removes |
| above 8 chips | collapses to 8 + `+2 more`; expands; `Show fewer` |
| 375px | no overflow, chip 301px, every tap target **40×40** |

Recipes and Build Calculator both re-checked after the `pathToggle` extraction:
basis select still on `era`, calculator still has no basis select and keeps its
recent-prices toggle. No console errors on any view.

### The tap targets are grown by SIZE, against the usual house rule

`docs/ui-conventions.md` says touch targets grow by an `::after` overlay at
negative inset, not by padding. These do not, deliberately, and the same
document says why: the three controls in a chip sit 2–8px apart, and
**overlapping hit areas hand a tap to whichever element is later in the DOM**,
which it calls worse than leaving the target small. A chip strip wraps, so
growing it costs the layout nothing. They reach 40×40 against the site's ~44px
convention. Worth a line in `ui-conventions.md` when step 5 does the docs pass.

### What step 2 deliberately did NOT do

The totals bar reads `shopping.totals.grandAvg` already, because it is the
cheapest possible proof the whole pipeline works end to end. Everything else
the decisions call for — the two tables, On Hand, price overrides, the D5
netting offer, notes, Copy/CSV — is step 3 and 4 and is untouched. The
placeholder line under the chips states the row counts so the numbers are
visible without the tables existing.

## Next: step 3

The two ingredient tables. Everything they need is already computed and
unrendered: `shopping.trade`, `shopping.additional`, per-row `need`/`spare`/
`extAvg`, the closed `notes` vocabulary in its fixed order, `staleness` on
trade-good rows, and `shopping.chains` for D5's netting offer.

Three things step 3 should know:

- **`onHand` and `overrides` are keyed by ROW ID**, not by recipe. The ids are
  stable across re-renders and independent of pick order, which is what lets a
  typed number survive a recipe being removed (D2).
- **D5's netting is computed but not offered.** `shopping.chains` lists every
  pair; `buildShoppingList` applies it only under `netCraftedSources`. The UI
  for that is step 3's, and the decision is that it stays explicit and
  reversible, never automatic.
- **The staleness flag has a hit-list of two today** — Elven Bismuth and Oil of
  Enchantment, both understated by their season average. The row states a fact,
  never a forecast: *"season avg $31.67 · recent sales $63.25 — this one is
  moving."*

### D10, as it now stands

D10 said "no `CostOptions` flag; both views read the same pricing". D11 adds a
flag, deliberately. The distinction the maintainer drew: D10 exists to stop two
views **silently** quoting different numbers for one ingredient, and `priceYear`
was already a `CostOptions` field doing this openly. A user-chosen, labelled,
stated-in-prose basis is not the failure D10 was written against. What survives
of D10 is the part that matters: the Shopping List and the Build Calculator both
read `'today'`, and neither offers the choice.
