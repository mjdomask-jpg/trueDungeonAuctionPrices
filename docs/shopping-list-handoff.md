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
| **0** | Extract `RecipeDrawer` + `lineTag` out of `BuildCalculator` | **done and verified** |
| 1 | Pricing branches in the engine + `lib/shoppingList.ts` | not started |
| 2 | Route, view toggle, chip strip, drawer wired to multi-select | not started |
| 3 | The two ingredient tables | not started |
| 4 | Final table, Copy, Download CSV | not started |
| 5 | `localStorage` autosave, 10x hint, docs | not started |

**Two standing rules the maintainer set for this build:**

1. **Every step ends in a full stop.** Build it, verify it, show it, and *wait* —
   including when the next step looks obvious. A wrong step is cheap to redo
   alone and expensive to unpick from under three more.
2. **Every step ends by updating this file.**

Branch: `shopping-list-step0-drawer`. `main` requires the `build-and-validate`
check, so everything goes through a PR.

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
  see the pricing model below.

---

## The pricing model (settled — this is the heart of step 1)

Domain rule from the maintainer: the Shopping List only holds recipes a player
can **actually make**, so everything is acquired **now**, at today's prices.
Out-of-print tokens are the exception — they come off the secondary market at
whatever their availability window said.

Four branches, in order:

1. **Trade goods → current season, always.** Whatever year the recipe came from,
   including expired and 2027-preview recipes. One price per good for the whole
   list, so the **merge key is the item name alone**. 14 rows, always.
2. **Ultra Rare, in print** (nominal year ≥ `latestPriced - 1`) **→ current
   season price.** 27 lines today.
3. **Ultra Rare, out of print** (older, but inside the auction data) **→ pooled
   over its own two-year window**, tagged `OOP`. 40 lines.
4. **Ultra Rare older than the auction data** (before 2018) **→ clamp to the
   earliest priced season**, tagged OOP plus "no data before 2018". 18 lines.
   *The engine already does this; the rule as originally stated had no answer
   here and would have unpriced those lines.*

**Additional Items merge on name + nominal year**, because in-print vs
out-of-print is a function of that year.

No `CostOptions` flag: the branches go into the engine unconditionally and
**both** the Shopping List and the Build Calculator read them. Blast radius on
the calculator is one active recipe — Deathward Greaves, $233.70 → $210.23.
Expired recipes keep the calculator's build-window basis, which answers a
different question ("what did this cost then") on purpose.

### The default price basis, and the volatility flag

**Default is Full season, with a flag on goods whose season average is stale.**

The reasoning matters because it was got wrong once. Trade-good prices do **not**
follow a reliable seasonal sawtooth — measured by quarters, the within-season
change runs −6%, −5%, +75%, +72%, +31%, +38%, +3%, +17% across 2019–2026. A
tendency, not a law. (An earlier pass claimed a clean sawtooth; it had compared
each season's first five auctions to its last five, and 2026's last five carry
just **eight sales over five months** with single-sale months. Don't rebuild that
argument on the season tail.)

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
| D5 | **Chain netting is in scope.** Adding a Relic *and* the Legendary it upgrades into currently asks you to buy the Relic twice — 6 such pairs in 2026, 51 across all seasons, and the drawer displays them adjacently so people will hit it. Detect and *offer* a one-tap "count the ones you're crafting as on hand". Explicit and reversible, never automatic. |
| D6 | Final table gets its **own sort order**: all trade goods first, alphabetical by item, categories intermixed; everything else after by category then item. Do **not** extend the shared `CATEGORY_ORDER` in `lib/categories.ts` — Prices, Compare and Explorer all read it, and it omits Trade 3/4/5, which would otherwise split the trade goods across the table. |
| D7 | Wish Ring / 15,000 GP is **one global toggle**, matching the Recipes view. |
| D8 | Lives at `/transmutes/shopping` via `useRoutedView`. Three-button view toggle (`Recipes · Build Calculator · Shopping List`, short labels under 640px). Last-5 toggle comes along; the price-year pin does not. |
| D9 | Expired recipes stay addable (branch 1 prices them correctly). **The leaf backfill sweep came back clean** — all 25 leaf ingredients on the 103 pickable recipes are priced (12 auction, 12 offAuction, 1 derived); zero unpriced lines across all 174 recipes. Keep no-price handling defensively, but it is unreachable today. |
| D10 | No `CostOptions` flag (above). |
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

## Step 0 — what was done

Commit `b800e65`. Three files:

- **`src/lib/lineTag.ts`** (new) — `lineTag` and `WINDOW_TAG`, moved verbatim.
- **`src/components/RecipeDrawer.tsx`** (new) — the slide-in picker.
- **`src/components/BuildCalculator.tsx`** — 192 lines lighter, behaviour intended
  to be unchanged.

### The drawer's contract

The drawer **owns its filter state** (search, tier, show-expired, expanded
years) because those describe the picker, not what is being built with it —
hoisting them into two parents is exactly how two copies would drift.

The **parent owns the selection**, which is the only part the two views disagree
about. Hence:

- `selectedKeys: ReadonlySet<string>` — the drawer only needs to know which rows
  to light up. Step 2 adds quantity display additively; it does not need this
  prop to change.
- `onPick(cost)` — whether that closes anything is the parent's business.
- `clearFiltersOnPick` — true for the calculator (which closes on pick), false
  for the Shopping List, where clearing the query mid-list would be hostile.
- `focusYear` — which year is expanded before the reader touches anything.

### Verification

- `tsc -b` 0 · `npm test` 0 (all eight suites) · `npm run lint` clean apart from
  the pre-existing `validate-recipes.mjs` warning · `npm run build` 0.
- **Mechanical equivalence proved by diff**, not by eye: `lineTag` is
  byte-identical to the original; the drawer markup and every moved logic block
  (`tiers`, `isYearOpen`/`toggleYear`, `drawerYears`, `expiredCount`, `optRow`)
  are identical once the intended rewires are applied
  (`drawerOpen`→`open`, `setDrawerOpen(false)`→`onClose`,
  `c.key === selectedKey`→`selectedKeys.has(c.key)`, and the local `open`
  renamed to `isOpen` to avoid shadowing the prop).
- Drawer CSS is flat and `position: fixed`, so returning a fragment instead of
  two siblings inside `.calc` changes no selector.

**Interactive pass — done, all green.** Driven against the dev server (no
screenshots: this box's Browser pane cannot capture localhost).

| Check | Result |
|---|---|
| Scrim and drawer are still direct children of `.calc` | ✓ — the fragment changed no DOM nesting |
| Drawer opens; 16 years listed, 103 active / 71 expired | ✓ — matches the engine measurement |
| Focus year expanded by default, others collapsed | ✓ 2026, 28 options |
| Search | ✓ "vampire" → 2 recipes, matching years auto-expand |
| Tier chips, composed with search | ✓ +Relic → 1 recipe, `aria-pressed` correct |
| **Pick → selects, closes, clears search AND tier** | ✓ all four |
| Reopen lights the selected row | ✓ exactly one `.calc-opt.sel` |
| Focus year follows the selection | ✓ |
| Relic→Legendary pairing survived | ✓ 2 pairs, indented rows, "↳ upgrades from" |
| **✕ and scrim close WITHOUT clearing filters** | ✓ search "omni" survived — only pick clears |
| Show-expired toggle | ✓ 174 recipes, expired tags render |
| Year accordion adds to the focus year | ✓ 2026 + 2014 both open |
| Provenance strings render | ✓ incl. "auction · priced as Ultra Rare · 2026–2027 pooled" |
| Panel still functional | ✓ All on a row → "covered", $628 → $615 |
| Mobile 375px | ✓ drawer 345px, fits, no sideways scroll, 44px search |
| Browser console / server logs | ✓ clean, no React warnings |

**The strongest check is not in that table.** `lineTag`'s call site is
character-for-character identical (`lineTag(r.line, cost.year, cost.status)`)
and the function is byte-identical, and its output depends on nothing else — so
provenance wording is provably unchanged for all 174 recipes, not just the one
that was clicked.

There is **no React test harness** in this repo (all eight suites are pure-node
validators), so none of the above could be covered by a unit test without adding
a dependency.

---

## Traps and gotchas

- **`lineTag` and `TransmuteRow`'s `priceTag` are near-duplicates and were
  deliberately NOT merged.** `priceTag` takes a fourth argument (the Recipes
  view's pinned price year) that *changes* two rules rather than adding one.
  `priceTag(l, y, s, null)` looks equivalent and very nearly is — but that is
  not a thing to assert about wording shown on 174 recipes without a test
  pinning both over the whole corpus. Worth writing; not worth writing blind
  inside a refactor whose contract is "nothing changes". `WINDOW_TAG` is now
  defined in both `lib/lineTag.ts` and `TransmuteRow.tsx`.
- **This machine's Browser pane cannot screenshot localhost** and never delivers
  `IntersectionObserver` callbacks — so the calculator's pinned summary strip
  cannot be verified there at all. Use headless Edge over CDP for real PNGs.
  See `~/.claude/CLAUDE.md`.
- **`transmutes.ts` gained a `tierLine` flag on 2026-08-30** (commit `c644052`)
  so Ultra Rare lines always name their basis. Display-only, no pricing changed.
- **Don't measure season behaviour on the last five auctions.** 2026's tail is
  eight sales over five months. Use quarters.
- **A `navigate` to a URL differing only in the hash is a no-op** on this
  HashRouter app, so React state survives what looks like a fresh page load and
  a test silently inherits the previous run's selection. Use `location.reload()`.
- **`preview_start` refuses whenever port 5173 is held by another session's dev
  server**, and adding a second launch config does not help — it checks 5173
  whichever config you name. The port has to be freed.
- Analysis harness for the engine lives in the scratchpad, not the repo: copy
  `src/lib/*.ts` out, rewrite the internal imports to carry `.ts`, and run with
  `node --experimental-strip-types`. ESM will not resolve extensionless
  internal imports.

---

## Next: step 1

1. Add the four pricing branches to the engine (unconditional — no flag).
2. Build `src/lib/shoppingList.ts`: `{recipe, qty}[]` + on-hand + overrides in,
   merged rows and totals out. Includes D5 chain detection.
3. New test suite pinning all four branches, the pre-2018 clamp, and the figures
   in the design doc. Wire it into `npm test` alongside the existing eight.
4. Derive the volatility threshold and bring the maintainer the hit-list.

**No UI in step 1.** The maintainer signs off on a table of numbers, which is
the cheapest place to catch a wrong rule.
