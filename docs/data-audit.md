# Auction Context Layer — Phase 1 Data Audit

**Status:** Phase 1 (audit only). No raw data was modified. This report is the
checkpoint deliverable; implementation waits for sign-off.

**Source workbook:** `C:\claude\Auction Data for Website - EDIT HERE FIRST.xlsx`
(read with values *and* formulas). Row counts and every claim below were computed
directly from the sheet, not assumed.

> **Read the two ⚠️ boxes first.** Two of your stated premises are contradicted by
> what the sheet actually does (the withheld-estimate method, and Trent's start
> date). Everything else is mechanical.

---

## 0. TL;DR — the things that actually matter

1. **The join key is clean.** `auctionId` (season + auction number, stored as text)
   joins `prices`, `augmentData`, and `auctionMetadata` with **zero orphans**. This is
   the single most important audit answer, and it's good news — no fuzzy matching
   needed. (§2)
2. **You don't need a new "source" column.** Forum vs. Trent is already recoverable
   per-auction from `auctioneer` / `Link`. (§3, Concept 1)
3. **Most of the funding/augment math already exists** in `auctionMetadata`
   (`targetFunding`, `augmentTokens/Grunnel/Withheld`, `augmentedTotal`,
   `fundingNoAugment`). The context layer is largely *surfacing* existing columns, not
   computing new ones — with three exceptions called out below. (§4)
4. ⚠️ **The withheld estimate is NOT point-in-time.** It is a whole-dataset (or
   whole-season) average — i.e. it *does* use future data — and it's inconsistent
   about which. This contradicts Concept 4. (§6, **Q1**)
5. ⚠️ **Trent's first auction closed Nov 1 2022, not "mid-2023."** The season-level
   claim ("no Trent before season 2023") holds; the calendar claim does not. This
   changes how the mid-2023 confound guard should be written. (§3, **Q2**)
6. **An undocumented 4th category, `augment` (25 rows, 2026 only), is silently
   dropped from the funding rollups.** ~$3,300 of 2026 augment value is invisible to
   `augmentedTotal`. (§4.3, §5, **Q3**)
7. **One hard domain-rule violation:** auction `20251` ("FERRET HORDE") has
   `targetFunding = 10250` (> $8,000). (§5)

---

## 1. Sheet inventory

The workbook has 10 sheets. Four feed this task; the rest are context.

| Sheet | Rows (data) | Role for this task |
| --- | --- | --- |
| `prices` | 7,349 sales | **Core sales** — the site's existing price data. Untouched by this layer. |
| `auctionMetadata` | 276 auctions | **Auction-level context** — source, auctioneer, funding target, augment rollups. The spine of the new layer. |
| `augmentData` | 575 items | **Item-level context** — withheld / augment / grunnel items, one row per item. |
| `startDates` | 5 seasons | Season → earliest open/close date. Useful for era config. |
| `auctionPricesOLD` | 7,313 sales | **Stale copy of `prices`** (36 rows behind). *The withheld estimates are computed against this, not `prices`* — see §6. |
| `transmutesOLD`, `pricesOnyx`, `tokenMetadata`, `transmuteRecipes`, `offAuctionPrices` | — | Existing site data; out of scope for this layer. |

### 1.1 `prices` — schema (unchanged, for reference)
`auctionId · auctionSeason · auctionNumber · Item · Price · Display Name · Category`
Categories present: Trade 1 (2941), Premium (1563), Trade 2 (1457), Bonus (606),
Preorder (395), Ultra Rare (371), **Golden Ticket (13)**, Condensed (2), Safehold (1).
Seasons 2019–2026.

### 1.2 `auctionMetadata` — schema (columns A–V are meaningful; W–AC empty)
| Col | Name | Notes |
| --- | --- | --- |
| A | `auctionId` | **Join key.** |
| B,C | `auctionSeason`, `auctionNumber` | |
| D | `auctionName` | Free text. Trent auctions are literally named "…Trent…" (111 rows). |
| E | `auctionStyle` | Ultra/Super Condensed, Onyx variants, n/a (41). |
| F | `completionStyle` | Lightning (241) / Fixed Date (27) / Semi-Lightning (8). |
| G | `auctioneer` | 36 distinct. **`= "Trent"` marks every Trent auction.** |
| H | `Link` | Domain distinguishes source: `trenttokens.com` (111) vs `truedungeon.com` (73) vs blank (92). |
| I,J,K | `openDate`, `closeDate`, `daysToClose` | Real dates from season 2023 on; `n/a` (41) for 2019–22. One blank close. |
| L | `Status` | Closed (271) / Failed (5). No `Open` rows currently. |
| M,N | `Open Month`, `Close Month` | Derived month labels. |
| **O** | **`targetFunding`** | Concept 3. See §5. |
| P | `augmentated` *(sic)* | Yes (41) / No (143) / blank (92). Misspelled — see §4.4. |
| Q | `augmentTokens` | Σ of `augmentData` **token** rows for the auction. |
| R | `augmentGrunnel` | Σ of **grunnel** rows. |
| S | `augmentWithheld` | Σ of **withheld** rows (negative). |
| T | `augmentedTotal` | `= Q + R + S`. **Excludes the `augment` category** — see §4.3. |
| U | `fundingNoAugment` | Funding with augments removed. |
| V | `preorderTotal` | |

### 1.3 `augmentData` — schema (columns A–G used; H–Q empty)
`auctionId · auctionSeason · auctionNumber · category · Item · quantity · priceAugmented`

- **`category`** (col D) is the classifier: `token` (399), `withheld` (86),
  `grunnel` (65), **`augment` (25)**.
- **`priceAugmented`** is the **lot total**, already quantity-inclusive — e.g.
  "Random Ultra Rare" qty 18 → 900 (not per-unit). Don't multiply by `quantity` again.
- **`Item`** (col E) is misleadingly named: it holds **Display-Name-style values**
  (e.g. "Patron Pin", "Ring of the 3rd Circle"), and the withheld formula joins on
  Display Name, *not* the stable `Item` key used in `prices`. See §6/§7.

---

## 2. Join keys and referential integrity

**`auctionId` is a reliable join key across all three sheets.** Verified:

- `prices.auctionId` → `auctionMetadata`: **0 orphans**.
- `augmentData.auctionId` → `auctionMetadata`: **0 orphans**.
- 6 `auctionMetadata` rows have **no sales in `prices`**:
  - 5 are `Status = Failed` (`202518, 202525, 202531, 20263, 202638`) — expected,
    they didn't complete. One of them (`202518`) nonetheless has an `augmentData`
    row, which is mildly odd (a failed auction with a recorded augment).
  - 1 is `202251` "Beertram's Appreciation 8K Auction" — **`Status = Closed` but
    zero sales rows.** Genuine gap or an auction whose lots weren't logged. Flagged.

**Item-level join is the weak spot, not auction-level.** `augmentData` items join to
sales only by *name*, and the name used is a Display Name against a stale sheet
(§6). That's the fragile edge of this dataset; the `auctionId` spine is solid.

---

## 3. Concept 1 — Source (forum vs. Trent)

**You do not need to build a source column; it is already derivable per-auction**,
three consistent ways that agree with each other:

| Signal | Trent | Forum |
| --- | --- | --- |
| `auctioneer == "Trent"` | 111 | — |
| `Link` domain | `trenttokens.com` (111) | `truedungeon.com` (73) or blank (92) |
| `auctionName` contains "Trent" | 111 | — |

Blank-link auctions are all pre-2023 forum auctions (the era before links were
recorded). Recommended rule: **source = Trent if `auctioneer == "Trent"`, else
Forum.** I'd still add a normalized `source` field in the model (§Phase 2) so the UI
never re-derives it, but the raw data already answers the question.

### ⚠️ The "mid-2023" premise is off by ~8 months (calendar) — **Q2**
- **First Trent auction: `202314`, opened 2022-10-30, closed 2022-11-01.**
- **Trent auctions before season 2023: 0** (confirmed).
- Within season 2023 (51 auctions total): auctions **#1–#13 are all forum**
  (closing early–late Oct 2022); **#14 is the first Trent** (Nov 1 2022); the season
  is mixed thereafter.

So "no Trent before **season** 2023" is **true**, but "Trent started **mid-2023**
(calendar)" is **false** — the first Trent auction closed in **November 2022**. This
matters because the confound guard you asked for must key off **season/auctionId or
the recorded source**, *not* a "before mid-2023" calendar date — a calendar cutoff
would misclassify the Oct–Dec 2022 Trent auctions. Since source is recorded per
auction, the cleanest guard compares within overlapping **seasons** (2023 onward)
and never infers source from date at all.

---

## 4. Concept 3/4/5 — the funding & augment columns already in `auctionMetadata`

Good news: the auction-level financials are largely pre-computed and they
**reconcile** with `augmentData`.

### 4.1 Reconciliation holds (for token/grunnel/withheld)
For every pre-2026 augmented auction, the metadata rollups equal the sums of the
matching `augmentData` rows. Examples (verified):
- `202334`: token 1401 + grunnel 155 + withheld −350.57 = **1205.43** = `augmentedTotal`. ✓
- `202312`: token 1047 + withheld −336.33 = **710.67** = `augmentedTotal`. ✓

### 4.2 `priceAugmented` sign & quantity conventions
- `token`, `grunnel`, `augment`: **positive**, lot-total.
- `withheld`: **stored already-negative** (all 82 numeric values ≤ 0; range
  −1330.9 … −0.51). There is **no separate multiplier column** — the negation and any
  quantity factor are baked into the formula (§6).

### 4.3 ⚠️ The `augment` category is dropped from the rollups — **Q3**
`augment` (25 rows, **season 2026 only**) is **not** folded into `augmentTokens` or
`augmentedTotal`. Concretely:

| Auction | `augmentData` sums | `auctionMetadata` says |
| --- | --- | --- |
| `20262` | augment **1660** | `augmentated=No`, `augmentedTotal=0` |
| `20264` | augment **1219**, withheld −800.6 | total = **−800.6** (augment ignored) |
| `202632` | augment **465.5**, grunnel 398, withheld −383.4 | total = **14.56** (augment ignored) |

That's **~$3,344 of real 2026 augment value invisible to the funding analysis.**
Because `augment` appears only in 2026 and its contents look exactly like `token`
(personal-collection items + Random Ultra Rares), my strong read is that **`augment`
is a 2026 relabel of `token` that the rollup formula (`augmentTokens`, which still
sums only `category="token"`) was never updated to include.** Needs your call (Q3).

### 4.4 Minor: `augmentated` is misspelled
Column P is `augmentated`. Harmless but worth fixing at the source before the model
hard-codes the typo (the existing site docs already carry it forward).

---

## 5. Domain-rule violations found

| Rule (from prompt) | Result |
| --- | --- |
| No successful auction funds **> $8,000** | **1 violation: `20251` "FERRET HORDE AUCTION"** (Amanda, Closed, closed 2024-11-15) has `targetFunding = 10250`. All other targets ≤ 8000. **Flagged for you — Q4.** |
| No **Trent** rows before mid-2023 | 0 violations at the *season* level (none before season 2023). But see the calendar caveat in §3 — the premise itself needs restating. |
| No **Golden Ticket** in normal data before the guarantee era | 0 violations. GT appears only seasons 2025–26 (first `202520`, closed 2024-11-27); the era boundary is *derived from the data*, not assumed. All 13 GT auctions have `targetFunding = 8000` — consistent with Concept 3. |
| No **withheld** rows with the wrong sign | 0 sign violations (all negative). But 4 withheld cells are cached as **`#N/A` / `#VALUE!`** formula errors — broken estimates, not sign errors. |

**`targetFunding` distribution** (184 non-blank / **92 blank**):
`7500 ×148` (the default, confirmed as the mode) · `8000 ×31` · `7200/7320/7400/7777 ×1
each` · **`10250 ×1` (the violation)**. The 92 blanks are pre-augment-era auctions and
will need the $7,500 default assumption (flagged as assumption, per Concept 3).

---

## 6. ⚠️ Concept 4 — the withheld estimate is hindsight, not point-in-time — **Q1**

I read the actual cell formulas. The withheld `priceAugmented` is:

```
= IFERROR( QUERY(auctionFullData, "select avg(E)*-1 where F = '<item>' ..."), <cached literal> )
```
(and for multi-quantity rows: `= quantity * QUERY(... avg(E)*-1 ...)`)

Decoded:

- **`auctionFullData` resolves to the `auctionPricesOLD` sheet**, *not* live `prices`.
  That sheet is **36 sales rows behind** `prices` (7,313 vs 7,349) and has 599
  category-blank rows. So estimates are anchored to a **stale copy** that drifts from
  what the site actually shows.
- **The join is on column F = Display Name**, the field your own data doc warns
  "changes from season to season." (This is why `augmentData.Item` holds
  Display-Name-style strings, and why transmute components like "Ring of the 3rd
  Circle" resolve even though they aren't `prices.Item` values.)
- **`avg(E)*-1`** = the **average sale price of that item, negated**. The multiplier
  magnitude is therefore **exactly 1.0** — there is no fractional discount; "negative
  multiplier" means simply "sign-flipped average," optionally × quantity.
- **It is not a trailing / point-in-time average.** Of the 86 withheld rows:
  - **71** filter by whole season (`where B = 2023`) — i.e. they average over the
    *entire* season including auctions that closed *after* the withheld one.
  - **12** apply **no date filter at all** — a whole-dataset average across every
    season, past and future.
  - (45 are additionally quantity-multiplied.)

  In **no** case is it restricted to "sales up to that date." **This directly
  contradicts Concept 4's "a trailing/point-in-time average, not a global average —
  preserve this; do not recompute using future data."** The sheet already recomputes
  using future data, and does so inconsistently. This is exactly the kind of baked-in
  assumption you asked me to surface.

- **No circularity found (verified).** `auctionPricesOLD` contains only real-sale
  categories (Trade 1/2, Premium, Preorder, Ultra Rare, Bonus, GT, Condensed,
  Safehold) — **no `withheld`, `augment`, `grunnel`, or `token` rows.** So withheld
  estimates are not averaged back into themselves. The risk you flagged isn't
  present today, but it would appear the moment anyone points the estimate at a sheet
  that includes augment rows — worth a guard rail in the model.

### 6.1 Recompute (RESOLVED — option (b), point-in-time, **same-season, close-date ordered**)

Per your 2026-08-04 decisions, withheld values are recomputed as a **point-in-time
trailing average restricted to the current season, with "prior" determined by close
date** (not auction number — auction numbering does not track close order). I ran it
against live `prices`; full per-row results are in
**`docs/withheld-recompute-preview.csv`** (preview only — the raw sheet is untouched
pending Phase 3).

**Method spec (exact):**
- **Join key: `Display Name`.** Verified this is the only key that resolves — all 27
  distinct withheld item names exist as `prices."Display Name"`, but many (the
  transmute components: rings, marks, Path fragments) do **not** exist as `prices.Item`.
  This matches the old formula's `where F = …` join.
- **Trailing window:** `prices` sales of that Display Name **in the same
  `auctionSeason`** whose auction **closed strictly before** the withheld auction's
  `closeDate`, **restricted to the most recent 5 such auctions** (by close date;
  `ERAS.withheldLookbackAuctions`) — all of the item's lots within a kept auction
  count. Capping the lookback keeps the estimate near the item's value *at the time it
  was withheld* rather than dragging in stale early-season prices; it mirrors the
  dashboard's "Last 5" recency window. Each sale's close instant comes from its
  auction's `closeDate`; **auctions with no close date (`n/a`) fall back to
  `(auctionSeason, auctionNumber)` ordering** — 42 pre-2023 auctions only, none
  withheld, so the fallback is never exercised. (Same-day ties are treated as *not*
  prior — day-granularity dates make same-day auctions effectively concurrent.)

  *Impact of the cap:* 65 of 73 withheld rows shift (the other 8 had ≤5 prior
  auctions); the **aggregate is essentially unchanged** (Σ ≈ −21.0k either way) while
  **per-row estimates move ~$22 on average** (up to ~$100) toward the more recent
  price — the intended sharpening.
- **Value = −1 × mean(prior same-season prices) × quantity.** (Same sign/quantity
  convention; `priceAugmented` stays the lot total.)

**Why close date, not auction number.** Auction `20251` (FERRET HORDE) is numbered #1
but *opened* on the season's first day (2024-09-18) and ran ~2 months, *closing*
2024-11-15. **19 other season-2025 auctions — mostly quick Trent lightning auctions that
opened later — closed before it.** Ordering by auction number wrongly treated `20251` as
having zero same-season priors; ordering by close date correctly gives it 19–36 prior
sales per item. This is the fix that eliminated the entire fallback problem.

**Results (86 withheld rows):**
- **All 86 recompute cleanly — 0 rows without a prior.** The season-opener gap from the
  auction-number version is gone; **Q1a no longer needs a fallback policy.**
- **All 4 previously broken `#N/A`/`#VALUE!` cells now resolve** (e.g. Wish Ring →
  −130.39 / −260.77) — C4 fixed for free.
- **Aggregate:** Σ old −21,727 → Σ new −21,686 across the 82 numerically-comparable rows
  (≈ +0.2%); **per-row mean |Δ| = $28.9**. Estimates shift materially per row and net
  out.
- **Window depth is healthy:** **57 rows rest on >20 same-season sales**, 21 on 6–20, 8
  on 3–5, and **none below 3**. Close-date ordering not only fixed `20251` but deepened
  the thin `20242` windows the number-based version left at n=2.

---

## 7. Consistency problems (catalogued)

| # | Issue | Rows | Mechanical or judgment? |
| --- | --- | --- | --- |
| C1 | Undocumented `augment` category, excluded from rollups (§4.3) | 25 | **Judgment (Q3)** |
| C2 | `Random Ultra Rare` classified under **both** `token` (34) and `augment` (2) + "2024 Ultra Rare Set" (1) | 37 | **Judgment (Q3/Concept 5)** |
| C3 | Withheld estimate = hindsight avg over stale sheet, join on Display Name, inconsistent season filter (§6) | 86 | **Judgment (Q1)** |
| C4 | 4 withheld cells cached as `#N/A` / `#VALUE!` | 4 | Judgment (recompute or drop) |
| C5 | `targetFunding = 10250 > 8000` (`20251`) | 1 | **Judgment (Q4)** |
| C6 | 92 auctions with blank `targetFunding` → need $7,500 default assumption | 92 | Mechanical (label as assumption) |
| C7 | Item-name dirt: `` `+3 Savage Sword `` (leading backtick), `HAMSTER with his own pet\t` (trailing tab), `"Dot" the homeless tater` (quotes) | 3 | Mechanical |
| C8 | `augmentData.Item` column holds Display-Name values, not the stable `Item` key | 575 | Judgment (rename/document) |
| C9 | `augmentated` misspelling (col P) | — | Mechanical |
| C10 | `202251` Closed but has zero sales | 1 | Judgment (data gap?) |
| C11 | 125 groups of identical `(auctionId, Item, Price)` in `prices` — **likely legitimate** multi-lot sales of commodity trade tokens; there is no lot ID to distinguish a true duplicate from two equal-priced lots | 125 grps | Judgment (probably leave; can't disambiguate) |
| C12 | Date format drift: 41 `openDate`/`closeDate` = `n/a` (all pre-2023); 1 blank close | 41 | Mechanical (pre-2023 has no calendar dates → era logic must fall back to season) |

---

## 8. Proposed normalizations, ranked by impact

1. **Add a derived `source` field** (Forum/Trent) from `auctioneer`/`Link`. *Zero
   ambiguity, 276 rows, mechanical.* Unblocks Concept 1 + Q4 analytics.
2. **Merge `augment` → `token` and fix the rollup** (Q3 resolved) so 2026's ~$3.3k of
   augment value stops vanishing from `augmentTokens`/`augmentedTotal`. *25 rows + one
   formula; high analytical impact.*
3. **Recompute withheld as same-season, close-date-ordered point-in-time averages from
   live `prices`** (Q1/Q1a resolved — see §6.1), repointing off the stale
   `auctionPricesOLD`. *86 rows.* The model must tag these as **estimates**, never mix
   them into real-sale stats, and the UI must say so.
3.5 The 4 `#N/A`/`#VALUE!` withheld cells are **fixed automatically** by the recompute.
4. **Encode era boundaries as config, not dates in code** (Q2 resolved): Trent =
   source-per-auction (season ≥ 2023); Trent reward rate = constant 100 pt/$1;
   Golden-Ticket-guarantee era = first GT sale `202520` / 2024-11-27. *Mechanical.*
5. **Default `targetFunding` = $7,500** for the 92 blanks, surfaced as an explicit
   *assumption* flag, not a stored fact. *Mechanical.*
6. **Clean the 3 dirty item names + the `augmentated` typo** at the source sheet.
   *Trivial, mechanical.*
7. **Rename/document `augmentData.Item`** as the Display-Name-join field it actually
   is. *Doc + schema; prevents a future mis-join.*

None of these touch raw data yet — they're the Phase 2 proposal inputs.

---

## 9. Batched questions for you (please answer before Phase 2)

**Q1 — Withheld estimate method. → RESOLVED 2026-08-04: option (b), point-in-time
trailing average, same-season, ordered by close date.** Method spec and a full preview
of all 86 recomputed values are in **§6.1** above.

**Q1a — Fallback for no-prior withheld rows. → RESOLVED 2026-08-04: no fallback needed.**
Switching the "prior" determiner from auction number to **close date** gave the
season-opener auction `20251` its 19–36 genuine same-season priors, so **all 86 rows now
compute a real point-in-time average** and the fallback question is moot. (A
`(season, number)` fallback remains defined for undated pre-2023 auctions, but no
withheld auction is undated, so it never fires.)

**Q2 — Trent start / era rule. → RESOLVED 2026-08-04.** Era boundary = **"season ≥ 2023
AND source = Trent," source read per-auction from `auctioneer`/`Link`** — never a
calendar cutoff. **Reward rate: always 100 pt/$1 (~10%), constant.** Store as a single
rate keyed to the Trent-era start; leave the config shaped so a dated rate table could
be added later, but no breakpoints today. Source-vs-Forum comparisons still restrict to
overlapping seasons (2023+) and must surface the confound in the UI.

**Q3 — `augment` vs `token` (Concept 5). → RESOLVED 2026-08-04: `augment` is a relabel
of `token`; MERGE.** Fold `augment` into `token` and **fix the rollup** (`augmentTokens`
/ `augmentedTotal`) so 2026's ~$3.3k of augment value stops vanishing. *(Separate, still
open for Phase 2: the Random-UR / Golden-Ticket classification — my recommendation will
be a distinct "released auctioneer payment" class shared by both, argued in the design
doc. That's a Phase-2 modeling proposal, not a blocker.)*

**Q4 — The $10,250 auction. → RESOLVED 2026-08-04: genuine exception, not an error.**
`20251` (FERRET HORDE) is a large **pooled/multi-order** auction — it sold only 7 lots
($387) but withheld 19 items in quantities up to 230, consistent with many $8k orders
combined. **Relax the rule to ">$8,000 is allowed but flagged as an exception"** rather
than a hard validation error; keep `20251`'s target as-is.

**Q5 — `202251`. → RESOLVED 2026-08-04: treat as a data gap.** Closed forum auction
(Beertram's Appreciation 8K, Sept 2022) with zero sales rows = **sales that were never
logged.** Flag as an incomplete-data warning; leave room for the sheet to be backfilled.
Do not silently drop it.

---

*End of Phase 1 — all questions resolved (2026-08-04). **Cleared to begin Phase 2**
(data model + UX design → `docs/context-layer-design.md`), still design-only; no
implementation until Phase 2 is approved.*
