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
| **1** | Pricing branches in the engine + `lib/shoppingList.ts` | **next — start here** |
| 2 | Route, view toggle, chip strip, drawer wired to multi-select | not started |
| 3 | The two ingredient tables | not started |
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
| 3 | **Ultra Rare, out of print → pooled over its own two-year window**, tagged `OOP` | 40 | **engine already does it** ([#137](https://github.com/mjdomask-jpg/trueDungeonAuctionPrices/pull/137)) |
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

### ⚠ OPEN QUESTION — the first thing to ask the maintainer

**#137's argument applies just as well to PINNED Ultra Rare lines, and nobody
has decided whether it should.**

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

**Do not decide this alone.** It changes the Build Calculator as well as the
Shopping List. If the answer is yes, branch 3 covers pinned lines too and the
engine needs one more change; if no, branch 3 must explicitly *exclude* pinned
lines and the Deathward Greaves drift below is intentional.

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

Ask before doing it; it is not part of step 1 and touches the Recipes view.

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

## Next: step 1

**Ask the maintainer the pinned-Ultra-Rare question first** (⚠ above). It decides
whether branch 3 has one more case in it.

Then:

1. Add **branch 1** (trade goods → current season, always) and **branch 2**
   (in-print URs → current season) to the engine. Branches 3 and 4 already exist
   — do not reimplement them.
2. Build `src/lib/shoppingList.ts`: `{recipe, qty}[]` + on-hand + overrides in,
   merged rows and totals out. Includes D5 chain detection.
3. New test suite pinning both new branches, the pre-2018 clamp, and the figures
   in the "Numbers" section above. Wire it into `npm test` alongside the existing
   eight.
4. Derive the volatility threshold and bring the maintainer the hit-list.

**No UI in step 1.** The maintainer signs off on a table of numbers, which is the
cheapest place to catch a wrong rule.
