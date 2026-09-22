# Auction Context Layer — Phase 2 Design

**Status:** Phase 2 (design only). No code yet. This is the proposal to approve
before any Phase 3 implementation. It builds on the settled Phase-1 findings and
decisions in [`data-audit.md`](./data-audit.md) (Q1–Q5 all resolved 2026-08-04).

**Guiding constraint:** follow the architecture already in `C:\claude\site` — the
load-once `AuctionDataProvider`, pure functions in `src/lib/`, per-page controls, the
themed CSS-variable system, and the [UI conventions](./ui-conventions.md) — rather than
introducing new patterns. Everything below is designed to slot into those.

---

## 1. The one idea that makes the rest simple: provenance ⊥ category

The core modeling decision (and the answer to Concept 5) is this:

> **An item has two independent attributes: its *category* (what token it is —
> Trade 1, Ultra Rare, Golden Ticket…) and its *provenance* (how it entered the
> auction). These are orthogonal axes. Today the data conflates them.**

The existing site already has `category`. The context layer adds **`provenance`** as a
second, independent tag. Once these are separate, every Concept lines up cleanly and the
"it costs a category" worry in Concept 5 disappears — because provenance is a *tag on a
row*, not a new bucket rows must be physically moved into.

### Provenance values (the full set)

| `provenance` | Meaning | Real sale or estimate? | Source in raw data |
| --- | --- | --- | --- |
| `normal` | Sold as part of the advertised $8k order | **Real sale** | `prices.csv` (all rows today) |
| `released-payment` | Formerly-retained auctioneer payment, now released to bidders: **Golden Tickets** and **Random Ultra Rares** | **Real sale** | GTs live in `prices.csv`; Random URs live in `augmentData` |
| `augment` | Auctioneer supplemented from their **personal collection** | **Real sale** | `augmentData` (`token`/`augment` rows that aren't Random URs) |
| `grunnel` | Company employee ("Grunnel") goodwill drop | **Real sale** | `augmentData` (`grunnel`) |
| `withheld` | Item pulled from the auction; **never sold** | **ESTIMATE** (recomputed — §4) | `augmentData` (`withheld`) |

`normal` is the implicit default for every current `prices.csv` row. The other four are
the context layer.

### `released` reads both feeds, and only the Golden Ticket comes off the spine

Which file records a released payment is a recording decision, not a fact about the
auction, so the ledger's **Included** figure (`AuctionContext.released`) is summed from
`contextItems.csv` *and* from Golden Ticket sales in the price spine. A Golden Ticket is
the auctioneer's fee; selling it releases it, and the Auction Data cards have badged
those sale rows `released` since this layer shipped — but until 2026-09-21 only a GT
that *also* reached `contextItems` counted, so twelve auctions that sold theirs read
`$0`. Where both feeds record one Golden Ticket the context row wins and it counts once.

**A Random Ultra Rare is never read off the price spine, and the reason is quantity.**
Its context row carries `quantity` and the lot-group **total** ($376.00 for nine); a
price row is per-token by construction ($41.78) and `prices.csv` has no quantity column
at all. Summing price rows would report $1,332 across the corpus where $10,514 was
released — an eighth of the money. So the context row is the released fact and the price
row (added for the Prices tab in item 4 of the 2026-09-21 batch) is the market
observation, and the two do not add up. The same asymmetry is why `AuctionCard` drops a
duplicate **Golden Ticket** context row but never a Random Ultra Rare one: the GT's two
records say the same thing, the Random UR's do not.

---

## 2. Concept 5 recommendation — Golden Tickets & Random Ultra Rares

**Recommendation: option (c) — a distinct `released-payment` provenance shared by both
Golden Tickets and Random Ultra Rares — implemented as a derived tag, not a data
migration.** This is the honest model (neither came from a personal collection, so
neither is a true "augment," and neither is an advertised "normal" order item), and by
making it a tag the usual cost of option (c) — "it costs a category / a migration" — is
avoided.

**Why not (a) both normal / (b) both augment:**
- (a) hides that these items were *not* part of the advertised order and were, until
  recently, invisible auctioneer compensation — exactly the story this layer exists to
  tell.
- (b) is factually wrong for the analytics: "did augments cover withholdings?" (Q1)
  compares *personal-collection generosity* against withholdings. Folding released
  payments into augments would credit the auctioneer for handing over what was already
  theirs-to-keep-but-now-guaranteed, inflating "coverage."

**How the tag is derived (rules, not hand-labeling):**
- `prices.csv` row with `Category == "Golden Ticket"` → `provenance = released-payment`.
- `augmentData` row named **`Random Ultra Rare`** (the 9–10 unchosen URs bundled
  with an $8k order — a small maintained name list in config) **or named
  `Golden Ticket`** → `released-payment`. (A Golden Ticket added through the augment
  sheet is the same released auctioneer payment as one in the normal sales.)
- **An "Ultra Rare Set" (e.g. `2024 Ultra Rare Set`) is NOT a random UR** — it is a
  curated set from the auctioneer's personal collection, so it stays `augment`.
- All other `augmentData` `token`/`augment` rows → `augment`.

> ⚠️ This rule is **name-based**, so a new Random-UR wording in a future season would
> fall through to `augment` until the name list is updated. The Phase-1 audit already
> found the naming is inconsistent (`Random Ultra Rare` vs `2024 Ultra Rare Set`), so
> the maintained list is the pragmatic choice; the validator (§7) will warn on
> unrecognized `augmentData` items that look Ultra-Rare-ish so drift is caught.

**Interaction with the Q3 merge:** `augment` (2026 label) is merged into `token` first
(Phase-1 Q3), then the released-payment rule splits Random URs back out by *name*. Net
effect: the meaningless `token`/`augment` label split is gone; the meaningful
`augment`/`released-payment` split replaces it on a real criterion.

---

## 3. Schema

### 3.1 Auction-level context — extend `AuctionMeta` (no new file)

`auctionMetadata.csv` **already carries** every column we need (Phase-1 §1.2); the site
just doesn't parse most of them yet. We extend `parseMeta` in `src/lib/data.ts`:

| New field on `AuctionMeta` | From column | Notes |
| --- | --- | --- |
| `source: 'Forum' \| 'Trent' \| 'Alesiev'` | *derived* | Read from the **Link** first — `alesievauctions.com` → Alesiev, `trenttokens.com` → Trent — with `auctioneer === 'Trent'` as Trent's only fallback; everything else is Forum. **Derived in code, no sheet change** — single source of truth (Q2). The link leads because alesievauctions.com hosts auctions run by six different auctioneers, so the auctioneer name cannot name the venue. Added season 2027 (was `'Forum' \| 'Trent'`), closing `backlog.md` SITE-11. |
| `orderVariant: 'Standard' \| 'Trade 2'` | *derived* | From the words in `auctionStyle` (`/\btrade 2\b/i`), matching both `Trade 2 Ultra Condensed` and `Onyx Trade 2 Ultra Condensed`. Season 2027 is the first to sell two different $8k orders; the sheet records which as a **value** in `auctionStyle` rather than a column (DATA-17), so this is derived exactly the way `source` is. Everything before 2027 is `Standard`. **Not read from the auction NAME** — several 2027 rows are titled "Option B" while their style is plain `Ultra Condensed`, and the style column is the one the validators police. |
| `targetFunding: number \| null` | `targetFunding` (O) | `null` for the 92 blanks → UI shows the **$7,500 default as an explicit assumption** (Q… /Concept 3), never as a stored fact. |
| `augmented: boolean \| null` | `augmentated` (P) | Typo tolerated on read; normalized name in code. |
| `augmentTokens / augmentGrunnel / augmentWithheld / augmentedTotal` | Q–T | Recomputed in code after the Q3 merge + §4 recompute rather than trusted from the sheet (the sheet's rollup is stale/miscategorized — Phase-1 §4.3). Sheet values kept only as a cross-check. |
| `fundingNoAugment / preorderTotal` | U, V | Read as-is for the funding analytics. |

### 3.2 Item-level context — new file `public/data/contextItems.csv`

Exported from the `augmentData` sheet, following the existing "sheet exports straight
into `public/data/`" pipeline ([data-pipeline](./data-and-transformations.md)). One row
per context item:

| Column | Notes |
| --- | --- |
| `auctionId` | Join key (clean — Phase-1 §2). |
| `category` | Raw label: `token`/`augment`/`grunnel`/`withheld` (→ normalized to provenance in code). |
| `Item` | **Holds a Display-Name-style value** (Phase-1 C8). Documented as the display/join name, *not* the stable `Item` key. |
| `quantity` | Lot size. `priceAugmented` is the **lot total**, already quantity-inclusive (Phase-1 §4.2). |
| `priceAugmented` | Real value for augment/grunnel/released; for `withheld` it is **ignored at runtime and recomputed** (§4), kept only as a reference/fallback. |

New parser + types live in a **new module `src/lib/context.ts`** (keeping `data.ts`
focused on core sales): `parseContextItems`, the `provenance` classifier, the withheld
recompute, and the auction-level join/rollup. `AuctionDataProvider` loads
`contextItems.csv` with the same optional-degradation pattern the other extra files use
(a missing file just leaves the context layer empty; the core dashboard is unaffected).

### 3.3 Era / config — new module `src/lib/eras.ts`

Config, not data (Concept: "encode eras, not hardcoded dates"). A tiny typed module:

```ts
export const ERAS = {
  trentStart:      { season: 2023 },            // source-per-auction; no calendar cutoff (Q2)
  trentRewardRate: 0.10,                          // constant 100pt/$1 (Q2). Shaped as a list-ready single entry.
  goldenTicketGuarantee: { firstSale: '202520', date: '2024-11-27' }, // derived from data (Phase-1 §5)
  defaultTargetFunding: 7500,                     // assumption, surfaced as such (Concept 3)
  orderCost: 8000,
  randomUltraRareNames: ['Random Ultra Rare', 'Ultra Rare', '2024 Ultra Rare Set', /* maintained */],
};
```

Reward rate is a single constant today but written so a dated table can replace it
without touching call sites.

---

## 4. Withheld recompute (locking in the Q1 decision)

Per Q1/Q1a, withheld values are **derived at load time**, not read from the sheet:

- **same-season, close-date-ordered, point-in-time trailing average over the most
  recent 5 prior auctions**, joined on **Display Name**,
  `value = −mean(recent prior same-season sales) × quantity` — the exact spec and full
  validation are in [`data-audit.md` §6.1](./data-audit.md) with the per-row preview in
  [`withheld-recompute-preview.csv`](./withheld-recompute-preview.csv). The 5-auction
  lookback (`ERAS.withheldLookbackAuctions`) keeps the estimate near the value at the
  time of withholding.
- Implemented as `recomputeWithheld(contextItems, sales, meta)` in `context.ts`. Because
  it reads only `prices.csv` (which contains no context rows), the **circularity risk
  from Phase-1 §6 cannot arise** — worth a one-line guard/comment so a future edit can't
  reintroduce it.
- Each recomputed value carries `{ estimate: true, n, basisSeason }` so the UI can show
  the sample size and the "estimate" treatment everywhere.

**Every withheld number in the system is flagged as an estimate**, is excluded from
real-sale statistics by default (§6), and never feeds another item's average.

---

## 5. UI: one shared filter set across every in-scope tab

### 5.1 Scope

**In scope (per prompt):** Prices, Onyx (Pricing); Timelines, Compare Years, Auction
Data, Analytics (Analytics). **Out:** Transmutes.

*Transmute connection worth surfacing (prompt invited this):* Phase-1 confirmed the most-
withheld items are **transmute-chain components** (Rings of the Nth Circle, Marks of the
Nth Tenet, Path to Enlightenment fragments). A small **"most-withheld components"**
callout on the Analytics page would flag which transmute ingredients auctioneers keep —
proposed as an optional Phase-3 stretch, not core.

### 5.2 A shared `FiltersProvider` + `FilterBar`

The prompt wants "a consistent set of filter controls … available on all Pricing tabs
and all Analytics tabs." To guarantee consistency (and match the load-once data
pattern), filter *state* lives in a **`FiltersProvider`** (React context), and a single
**`<FilterBar/>`** component renders the controls on each page. One implementation, one
state shape, identical everywhere:

| Control | Options | Default |
| --- | --- | --- |
| **Source** | All · *the venues the seasons in view actually used* | All — hidden when those seasons used only **one** venue |
| **Trent pricing** | Nominal · Reward-adjusted (−10%) | Nominal — hidden when the seasons hold no Trent auction, and when Trent is filtered out of view |
| **Auction type** | All · Augmented · Non-augmented · With Golden Ticket | All |
| **Item provenance** | Normal · Released payment · Augment · Grunnel · **Withheld (est.)** | All *real* on; **Withheld OFF** |

- Controls are `<select>`/segmented toggles rendered at ≥16px (mobile zoom rule), reusing
  the existing `.controls`/`.toggle` markup so they look native to each page.
- Pages opt in by dropping `<FilterBar/>` at the top and reading the shared filter from
  the hook — the same friction as adding a season `<select>` today.
- Not every page needs every control (e.g. Onyx has one source); `FilterBar` takes a
  prop listing which controls to show, defaulting to all.
- **Each control only appears where there is something for it to act on.** A page
  passes the seasons it is showing (`seasons` prop).
  - **Source** builds its options from `sourcesBySeason(meta)` and shows only where
    those seasons used **more than one** venue. That is the general form of what used
    to be written as "hide it before 2023": every season up to 2022 is Forum-only, so
    the dropdown could only ever filter to what was already on screen. Stating the
    rule as "more than one source" rather than "has Trent" is what lets 2027 offer
    three options without a second rule, and what will let a fourth venue arrive with
    no UI change at all.
  - **Trent pricing** keeps its own test, `seasonsWithTrent(meta)`, which requires both
    an actual Trent auction and `season >= ERAS.trentStartSeason` — Trent ran none
    before 2023, so 2018–2022 can never offer it.
- **Hiding is not enough on its own:** the filter state is shared and survives a season
  change, so a Source of `Trent` carried into 2019 would empty the page with no visible
  control to explain it. `FilterBar` resets both controls to their defaults whenever
  they stop being offered — and Source resets on the chosen venue being **absent from
  the season**, not merely on the control being hidden, because `Alesiev` carried from
  2027 back to 2026 would empty the page while the dropdown was still on screen.

### 5.3 Per-row provenance badges

Reuse the **`HintPopover` + small-badge** pattern already used for transmute `est.`/
`ceiling` badges (UI-conventions §"Putting a popover inside a clickable row"), so touch
users get an explanation, not a hover-only `title`:

| Badge | Colour source | Popover text |
| --- | --- | --- |
| `released` | new themed var | "Formerly kept by the auctioneer as payment; now sold to bidders." |
| `augment` | new themed var | "Added by the auctioneer from their personal collection." |
| `grunnel` | new themed var | "Dropped in by a company employee to offset expired preorder bonuses." |
| `est.` (withheld) | reuse existing `est.` styling | "Withheld — never sold. Value estimated from same-season sales before this auction (n = X)." |

New badge colours get **light + dark** entries in `App.css` and a ≥3:1 contrast check,
per the theming rule. `normal` rows carry no badge (avoids badging 7,349 rows).

### 5.4 Default include/exclude (Concept: headline stats)

**Agreed and recommended: withheld estimates are excluded from headline price stats by
default, behind a labeled toggle.** They are the only estimates in the system. The three
*real-sale* provenances (released/augment/grunnel) **are** real prices, so they are
available but, by default, do not silently reshape the core per-token dashboard — the
Prices tab keeps showing advertised-order sales, with a provenance filter to fold the
others in. This keeps the existing dashboard's meaning stable (migration safety) while
making the context one toggle away.

### 5.5 Confound flagging — in the UI, not just code

Where a comparison is structurally biased, a themed **`.confound-note`** banner sits with
the number:

- **Trent vs another venue:** "Trent auctions exist only from season 2023 on, and
  alesievauctions.com only from 2027, so only seasons both venues ran appear — comparing
  all-time would confound venue with time." The comparison logic itself restricts to
  overlapping seasons (never a headline figure spanning all time).
- **Augmented vs non-augmented / Grunnel vs preorder:** note that augmented auctions and
  Grunnel drops cluster in recent seasons, and compare within-season where possible.
- **Standard vs Trade 2:** the two orders ship different quantities of the premium trade
  goods, so the banner says to read it as a **price** question and not a supply one — a
  raw group mean over either order would mostly be a statement about its contents. The
  matched-token restriction is what leaves the price behind.

---

## 6. The analytics questions → concrete views

All on the Analytics page (a new view added to its existing toggle), designed toward the
prompt's four questions. A fifth was added in season 2027, when the data first became
able to answer it — see item 5.

1. **Did augments cover withholdings?** — a per-auction **"Auction Ledger"**: columns for
   withheld total (recomputed, negative), released-payment total, personal-augment total,
   grunnel total, and the **funding-target reduction** (`8000 − targetFunding`, since an
   auctioneer who lowered the goal "covered" differently). A **Covered?** verdict =
   `augments + released + target-reduction ≥ |withheld|`. Aggregable per auctioneer and
   overall. This is the headline use of the fixed rollups (§3.1) and the recompute (§4).
2. **How did Grunnel items contribute vs the preorder benchmark?** — per season, mean
   Grunnel item value vs mean **preorder** item value that season (the natural benchmark,
   since Grunnel offsets expired preorder bonuses). Phase-1 spot-check: preorder ≈ $2/yr
   vs Grunnel $6–305, so Grunnel items are worth **far more** than the average preorder
   item — a real finding to render as a small bar chart per season.
3. **Augmented vs non-augmented auction prices** — compare per-token price levels in
   augmented vs non-augmented auctions **within the same season**, to test whether added
   supply depresses prices or attracts bidders. Rendered as a season-controlled delta.
4. **Trent vs another venue** — nominal and reward-adjusted (−10%), **restricted to
   overlapping seasons**, with the §5.5 confound banner. Was "Trent vs Forum" until
   season 2027, when a third venue appeared and folding it into Forum would have been
   the exact error the Source split exists to prevent. The other side is now a
   parameter: `sourceOverlapSeasons` returns each season with the venues Trent actually
   overlaps there, and a **Compare against** picker appears only where a season offers
   more than one. 2027 is the case that forced it — it has no priced forum auction at
   all, so without this the analysis would simply have vanished from the newest season.
5. **Standard vs Trade 2 order prices** — same shape and same discipline as item 3: one
   season, matched per token, only tokens sold under **both** orders. Season 2027 is the
   first to sell two different $8k orders (auctioneers advertise them as Option A and
   Option B), so this is the first season with a comparison to draw. Nothing is pinned
   to 2027: `orderVariantSeasons(meta)` is whichever seasons hold both variants, so the
   view appears when a season runs two orders and stops when one does not. Tokens that
   sold under only one variant are **named** rather than silently dropped — "which
   tokens does the other order not have?" is half the answer a reader came for, and a
   matched table structurally cannot show it.

---

## 7. Validation (extend the existing guards)

Following the three-validator pattern in [data-and-transformations §Validation]:

- **Schema guard**: add `contextItems.csv` (required columns + retired-header map) and the
  new `auctionMetadata` columns to `validate-recipes.mjs`'s schema block.
- **New domain-rule checks** (from Phase-1 §5), reported as warnings/errors:
  `targetFunding > 8000` → **flagged exception, not fatal** (Q4); Trent-sourced row in a
  season < 2023; Golden-Ticket sale before the guarantee era; withheld row with a
  non-negative reference value; `augmentData` item that looks Ultra-Rare-ish but isn't in
  the maintained Random-UR name list (catches §2 drift); an auction marked `Closed` with
  zero sales (surfaces `202251` — Q5 data gap).
- **Reconciliation check**: recomputed `augmentedTotal` vs the sheet's, to catch the next
  time a new category slips past the rollup (the 2026 `augment` bug that started this).

---

## 8. Migration plan & breaking changes

**Low-risk by construction — the default view of every existing page is unchanged.**

| Step | Change | Breaking? |
| --- | --- | --- |
| 1. Data layer | New `contextItems.csv` export; `parseContextItems`, provenance classifier, withheld recompute, meta-extension in `context.ts`; `eras.ts`. `AuctionDataProvider` loads the new file (optional-degradation). | No — additive; missing file ⇒ empty layer. |
| 2. Shared filters | `FiltersProvider` + `<FilterBar/>`; provenance badges + themed colours. | No — pages opt in; unstyled pages behave as today. |
| 3. Per-tab integration | Drop `<FilterBar/>` into Prices, Onyx, Timelines, Compare, Auction Data; wire the shared filter into each page's existing query. | Behavior-additive; defaults reproduce current output (withheld off, source All). |
| 4. New analytics | The four §6 views on the Analytics page. | No — new views. |

**Only genuine breaking consideration:** if we later decide released-payment/augment
sales *should* appear in the core per-token dashboard by default, that changes headline
numbers — hence the §5.4 default (they don't, unless toggled). Documented so it's a
deliberate choice, not a drift.

**Docs to update in the same commits** (per the data-pipeline memory rule):
`data-and-transformations.md` (new file, new columns, new transforms), `updating-the-
data.md` (export step for `contextItems.csv`, new metadata columns), `ui-conventions.md`
(provenance badges + FilterBar), and a short domain note for `released-payment`.

---

## 9. Modeling choices — RESOLVED 2026-08-04

1. **`released-payment` label wording → "Released payment"** (badge text `released`; full
   term "Released auctioneer payment" in popovers). Internal id stays `released-payment`;
   the user-facing string is a single constant, trivially changed later.
2. **Core-dashboard default → confirmed:** real-sale context items (augment/grunnel/
   released) stay **out** of the Prices tab's per-token stats by default, surfaced only via
   the provenance filter. The Prices tab keeps meaning exactly what it means today unless
   the user opts in.
3. **Transmute "most-withheld components" callout → deferred.** Transmutes stay untouched
   in core Phase 3; the callout is an optional stretch to revisit only after the core
   layer ships cleanly. **The core layer has shipped and the callout has not** —
   tracked as `SITE-4` in [`backlog.md`](./backlog.md), confirmed unbuilt 2026-09-03.

None blocked Phase 3 step 1 (the data layer); these shape later UI steps.

---

*End of Phase 2 design. Awaiting your approval before Phase 3. Proposed first increment:
the §8 step-1 data layer (`contextItems.csv` + `context.ts` + `eras.ts` + provider load),
shippable and reviewable on its own before any UI changes.*
