# Transmute recipe sheet — authoring guide

Companion to [`transmute-recipes-template.csv`](transmute-recipes-template.csv). Design rationale
lives in [`expansion-plan.md`](expansion-plan.md) §3.2 and §4.1–§4.2; this file is the how-to.

## Columns

| Col | Column | Kind | Meaning |
|---|---|---|---|
| A | `Key` | formula | Uniqueness key. Never hand-typed. |
| B | `Year` | **you type** | The season **the transmute belongs to**. Not the ingredient's season. |
| C | `Level` | **you type** | Tier: `Enhanced`, `Exalted`, `Relic`, `Legendary`, `Arcanum`, `Paragon`, `Mythic`, `Eldritch`, `Omni`, `Safehold`, `Patron`. |
| D | `Transmute` | **you type** | The token being produced. |
| E | `Good` | **you type** | One ingredient, as a **`canonicalName`**. |
| F | `GoodYear` | **you type** | Ingredient's season. Blank = same as `Year`. See below. |
| G | `ResolvedYear` | formula | The season `GoodYear` actually resolves to. Read-only sanity check. |
| H | `GoodDisplayName` | formula | The ingredient's display name that season — **for your eyes only**. |
| I | `Quantity` | **you type** | How many. **Never 0** — the old qty-0 marker convention is retired. |
| J | `IsSource` | **you type** | `TRUE` = the token being upgraded *from*; `FALSE` = consumed ingredient. |

One row per (transmute, ingredient, season, role). Six columns to type; four to leave alone.

**The importer reads only B–F, I, J.** `Key`, `ResolvedYear` and `GoodDisplayName` are authoring
aids and are ignored — the site derives all three itself. That is deliberate: derived columns can
drift from their source, so nothing downstream is allowed to trust them.

## `GoodYear` — offsets are relative to the `Year` column

**This is the part worth being precise about: `-1` means one season before the value in the row's
`Year` column — the transmute's own season. It has nothing to do with the current calendar year,
and the numbers do not change meaning as time passes.**

```
ResolvedYear =
    GoodYear is blank      ->  Year                 (the common case)
    GoodYear is negative   ->  Year + GoodYear      (e.g. Year 2026, GoodYear -2  ->  2024)
    GoodYear is a year     ->  GoodYear             (e.g. 2019 -> 2019, pinned)
```

So a `Year = 2024` recipe with `GoodYear = -1` means **2023**, permanently — reading it in 2026
does not make it mean 2025. Every row's answer is visible in the `ResolvedYear` column; if that
column ever shows something surprising, trust it over your mental arithmetic.

| Form | Example | Meaning |
|---|---|---|
| blank | | the transmute's own season — **the common case** |
| relative | `-1`, `-2` | N seasons before the row's `Year` |
| absolute | `2019` | pinned to that exact season, ignoring `Year` |

**Prefer relative.** Multi-season recipes are "one from each of the last N seasons" designs, so a
relative recipe rolls forward to next season by copying the block and bumping `Year` — the offsets
re-resolve themselves. Absolute years would force a hand-rewrite every season. Use absolute only
for a genuine one-off pinned to a specific historical token.

## `GoodDisplayName` — why you want it

Display names change every season, so a canonical name alone is nearly unreadable while authoring.
`1k Bonus` is the sharpest case:

| `Good` | `ResolvedYear` | `GoodDisplayName` |
|---|---|---|
| `1k Bonus` | 2026 | Ring of the 1st Circle |
| `1k Bonus` | 2025 | Ring of the 2nd Circle |
| `1k Bonus` | 2024 | Ring of the 3rd Circle |
| `1k Bonus` | 2023 | Ring of the 4th Circle |
| `1k Bonus` | 2022 | Ring of the 5th Circle |

Five identical-looking rows, five different real tokens. The column makes that legible — and note
it keys on `ResolvedYear`, not `Year`, or every row would wrongly read "Ring of the 1st Circle".

It doubles as a spell-checker. Three possible outputs:

- **a display name** — the `Good` resolved cleanly against `tokenMetadata`. ✅
- **`… (transmute)`** — no token matched, but the name matches something in the `Transmute`
  column, so it's a ladder reference. Expected on `IsSource` rows (`Safehold V`). ✅
- **`⚠ check name`** — matched nothing. The `Good` is misspelled, or the token doesn't exist that
  season. **Fix before importing** — the site's validator will reject it too, just later.

## Formulas

Paste into row 2 and fill down. The CSV ships with **literal values** in A, G and H so the file
stays valid and readable on its own — replace them with these formulas once it's in Sheets, or
they will drift as you edit.

```
A2  =$B2&"|"&$D2&"|"&$E2&"|"&$F2&"|"&$J2

G2  =IF($F2="",$B2,IF($F2<1900,$B2+$F2,$F2))

H2  =IFERROR(VLOOKUP($G2&$E2,tokenMetadata!$A:$D,4,FALSE),
      IF(COUNTIF($D:$D,$E2)>0,$E2&" (transmute)","⚠ check name"))
```

`H2` relies on `tokenMetadata`'s key column being `year & canonicalName` concatenated bare
(`2026PYP`, `20241k Bonus`) — which is how that sheet already builds it.

### About `Key`

Two deviations from the old `transmute+good` key, both deliberate:
- **`Year` is included** so the same transmute in two seasons doesn't collide.
- **Parts are `|`-separated** rather than concatenated bare. With `GoodYear` in the key, bare
  concatenation is ambiguous (`PYP` + `-1` + `FALSE` vs `PYP-1` + blank + `FALSE`).

## `Good` — always the canonical name

Use the `canonicalName` from `tokenMetadata`, never the display name:

- ✅ `PYP` — ❌ `Ultra Rare`
- ✅ `1k Bonus` — ❌ `Ring of the 3rd Circle`
- ✅ `Dwarven Steel`

This is what lets the engine resolve `isTransmute(good)` and look up prices automatically. Watch
`GoodDisplayName` as you type — it tells you immediately whether you got it right.

**"Any token of UR tier" is written `PYP`.** The tier and the token are 1:1, and the agreed pricing
policy resolves "any UR" to PYP anyway — so it is written identically to a named Ultra Rare.

## `IsSource` — the upgrade-from slot

`TRUE` marks the token you are upgrading, as opposed to fuel you are consuming. Give it a real
quantity like any other line. The site's "I already own the source" toggle switches these lines in
and out of the total, so the distinction has to be in the data.

- A transmute with no upgrade-from requirement simply has **no `IsSource` row**.
- If the `Good` on an `IsSource` row is itself a transmute (`Safehold V`), the engine recurses into
  that recipe. If it's a plain token (`PYP`), it uses the auction price.

## Golden Fleece ingredients — write the real token, integer quantity

Golden Fleece is a transmute (10 **Monster Trophy** → 1 Fleece), and Monster Trophies are reward-only
— never auctioned. **The old sheet wrote these as fractions of a Fleece** — 3 Trophies as
`Golden Fleece × 0.3` — because `price(Fleece) ÷ 10` is a ceiling on each Trophy.

**Don't do that here.** Write the ingredient itself, with a normal integer quantity:

- ✅ `Monster Trophy` × `3`
- ❌ `Golden Fleece` × `0.3`

The Fleece-÷-10 pricing still happens — it just lives in
[`derived-prices-template.csv`](derived-prices-template.csv) as a rule, instead of being baked into
every quantity. **You still maintain only the Golden Fleece price**; nothing new to track.

Two consequences for you as an author:

- **Quantities are always whole numbers.** A decimal anywhere is now unambiguously a typo, which is
  the point — it lets validation catch `3` fat-fingered as `0.3`.
- **`Monster Trophy` is not yet in `tokenMetadata`** — it appears nowhere in the current data. Add
  one row per season it exists in, or `GoodDisplayName` will show `⚠ check name` on every Trophy
  line. You'll need to pick its `tokenCategory`; none of the existing ones (`Trade Good`,
  `Premium`, `Bonus`, `Preorder`, `Condensed`, `Ultra Rare`, `Patron`, `Golden Ticket`,
  `Safehold`) obviously covers a reward-only token, so a new category may be warranted.

Rationale and the engine-side requirements are in [`expansion-plan.md`](expansion-plan.md) §4.3.

## Before importing

- [ ] Every row has a non-zero, **whole-number** `Quantity` — no decimals, no fractions of a Fleece.
- [ ] No `⚠ check name` anywhere in `GoodDisplayName`.
- [ ] `Monster Trophy` added to `tokenMetadata` (one row per season) with a chosen category.
- [ ] `Golden Fleece` present in the manual off-auction price table for every season it's used in.
- [ ] `ResolvedYear` looks right on every multi-season row.
- [ ] No duplicate `Key` values.
- [ ] Multi-season recipes are expanded to one row per season (not one row with a list).
- [ ] Delete the example rows.

## About the example rows

Rows named `EXAMPLE …` are illustrative scaffolding — delete them.

The `Ring of the Sacred Circle`, `Deathward Greaves`, and `Safehold IV/V` rows encode requirements
you described, using real canonical names and real display names from `tokenMetadata`. But their
**`Level` values, `Quantity` values, and any non-UR/non-bonus ingredients are placeholders I
invented** — I only know the multi-season requirements, not the full recipes. `Relic` for Ring of
the Sacred Circle is a guess, as is `Dwarven Steel` ×10 on Deathward Greaves. Correct them against
the real sheet before treating any of it as data.
