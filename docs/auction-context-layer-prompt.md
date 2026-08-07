# Prompt for Claude Code — Auction Context Data Layer

## Role and objective

You previously built this site with me: a price tracker for auction results from group buys of a collectible token game. The core pricing data — what individual items sold for — is already working.

That core data was deliberately simplified. Real auctions have context that materially changes how a sale price should be read: who ran the auction, what the auctioneer kept, what they added, and what the auction was actually trying to raise. I now want to add that context as a **new data layer on top of the existing auction price data**, not as a replacement for it.

**Do not start writing implementation code yet.** This is a staged task; see "Working method" below.

---

## Domain background (read carefully — this is new information to you)

The company sells bundles of collectible tokens. The largest bundle costs **$8,000** and is the best per-item value. Almost nobody buys one alone, and almost nobody wants every item in it, so players run **group buys**: multiple people pledge money toward one $8,000 order, and an **auction** decides who gets which item. The winning bid on an item is the price my site tracks.

Each group buy is run by an **auctioneer**, who fronts/coordinates the order. Auctioneers are compensated not in cash but by keeping certain items (details in Concept 2). Many auctioneers also lead player guilds, which creates further incentives to keep or add items (Concepts 4 and 5).

---

## The six concepts to model

### Concept 1 — Auction source

Every auction comes from one of two sources:

**Forum auctions** — run by individuals on the company's official forums. The auctioneer makes a post; bidders DM their bids; the auctioneer manually updates the post. Low volume per auctioneer (most run only a few, ever). Long-running: these are the only source for the earliest data.

**Trent auctions** — Trent is a third-party reseller who runs an eBay-style auction system on his own ecommerce site. Largely automated with real ecommerce features, so his volume is **much** higher than any forum auctioneer. **Trent only began hosting auctions mid-way through 2023** — there is no Trent data before that.

Trent's site awards **reward points at 100 points per $1 spent**, redeemable against other purchases on his site. Users widely treat this as a **10% bonus / effective discount**. Model this explicitly: a $100 winning bid on Trent's site has an effective net cost of roughly $90 to the buyer, which plausibly inflates nominal Trent bids relative to forum bids. I want the site to be able to show both **nominal** and **reward-adjusted** Trent prices, and I want the adjustment rate stored as configuration, not hardcoded, in case it changed over time (**ask me** whether the 100pt/$1 rate has always been constant).

> ⚠️ **Analytical trap to design around:** because Trent started mid-2023, any naive "Trent vs. Forum" price comparison is confounded by time period. Every source comparison in the UI must either restrict to overlapping date ranges, or compare within the same item and time window, or otherwise control for date. Do not ship a headline Trent-vs-Forum number that ignores this. Surface the caveat in the UI, not just in code comments.

### Concept 2 — Random items kept by the auctioneer as payment

An $8,000 bundle contains:

1. A **known, enumerable list of tokens**, including **Ultra Rare** tokens where the purchaser *chooses* which specific Ultra Rares they want. Because these are known in advance, the group buy lists them explicitly and they go into the auction. **These are what my existing price data covers.**
2. **9–10 random Ultra Rare tokens** — quantity not guaranteed, contents not chosen.
3. **A chance at a Golden Ticket token** — historically not guaranteed.

Because (2) and (3) could not be promised to bidders, auctioneers traditionally **kept them as their payment** for running the group buy. They therefore appear in **no** auction data for those years — this is a structural absence, not missing data, and the site should say so rather than showing a gap.

**This changed recently:** the company now guarantees a Golden Ticket in every $8,000 order *while supplies last*. Auctioneers consequently began including Golden Tickets in auctions, and those sales **are** in my normal auction sales data. Determine from the data when this transition happened and represent it as a date/era boundary rather than a hardcoded assumption.

### Concept 3 — Funding targets

Because the auctioneer retained value (the random Ultra Rares and the Golden Ticket chance), they usually set the group buy's **funding goal below the $8,000 order cost** — the auctioneer effectively covers the difference, and the auction funds more easily.

- **Baseline / default target: $7,500.** Treat this as the assumed value when a specific auction's target is unknown, and flag it as an assumption rather than a fact.
- Auctioneers who withheld extra items or added augments often set different targets. Including a Golden Ticket in the auction commonly pushes the target to the full **$8,000**.
- **No successful auction had a funding goal above $8,000** — i.e., no auctioneer profited in cash. Treat >$8,000 as a **data validation error** and flag it during the audit.

Funding target is the denominator for a lot of the interesting analysis: percent-funded, whether augments covered withholdings, and how much value the auctioneer effectively donated or extracted.

### Concept 4 — Additional withheld items

Many auctioneers lead guilds. The $8,000 orders contain items required for multi-year redemption chains called **transmutes**, so auctioneers frequently **withhold** specific items from the auction for themselves or their guild members.

When they do, they compensate in one of two ways: **lower the funding goal**, or **supplement the auction with items from their personal collection** (see Concept 5).

I track these in a **separate "withheld" pricing sheet**. Withheld items never sold, so they have no real price — I **estimated** each one's value from the average sale price of that same item across all auctions *up to that date* (a trailing/point-in-time average, not a global average — preserve this; do not recompute using future data). I then applied a **negative multiplier** to the value.

> ❓ **I am not certain what convention my sheet actually uses for that negative multiplier.** Inspect the withheld sheet, infer the convention from the actual numbers (are values stored already-negative? is there a separate multiplier column? is the magnitude 1.0 or something else?), state clearly what you found, and **ask me to confirm before building on it.** Do not guess silently.

Withheld items must be visibly distinguishable from real sales everywhere they appear. They are **estimates**, and they must never be mixed into "average sale price" statistics that feed the estimation itself — watch for that circularity and tell me if you find it in the existing pipeline.

### Concept 5 — Augments

Auctioneers who withheld items often **supplement** the auction with items from their personal collections. The social expectation is that these **augments** compensate the bidder pool for what was withheld.

I track these in a **separate "augment" pricing sheet**. Unlike withheld items, augments **actually sold**, so I have real sale prices for them.

Two wrinkles:

- Some auctioneers have recently begun including the **random Ultra Rares** in the auction. I currently track those as **augments**.
- **Golden Ticket** inclusions, however, are tracked in the **normal auction data** (per Concept 2).

This is inconsistent: two items that entered the auction by the same mechanism (previously-retained auctioneer payment, now released to bidders) are classified differently. **Propose an approach and give me a recommendation with reasoning.** Options I see, but suggest better ones if you have them:

  a. Treat both Golden Tickets and random Ultra Rares as **normal items**.
  b. Treat **both as augments**.
  c. Keep them **separate** as their own category (e.g. "released auctioneer payment") distinct from both normal items and personal-collection augments.

Note that (c) may be the honest modeling answer since neither came from a personal collection, but it costs a category. Weigh migration cost and analytical clarity, and tell me which you'd pick.

Also note: auctioneers who include augments often set a **higher funding target ($8,000)**, which interacts with Concept 3.

### Concept 6 — Grunnel items

An employee of the company (nicknamed "Grunnel") occasionally drops extra items into auctions — props, paraphernalia, and other game-associated physical items. The stated intent is to **make up for value lost when preorder bonuses expire**.

I track these in a **separate "grunnel" pricing sheet**. These are genuine sales with real prices. They are not auctioneer-sourced and should not be conflated with augments; the causal story is completely different (company-side goodwill vs. auctioneer compensation).

---

## Data sources

Raw sheets, for you to read and audit:
- Full workbook with multiple sheet: C:\claude\Auction Data for Website - EDIT HERE FIRST.xlsx
- Core auction sales data: prices sheet
- Withheld items: augmentData sheet, labeld as **withheld** in column D
- Augment items: augmentData sheet, labeld as **token** in column D
- Grunnel items: augmentData sheet, labeld as **grunnel** in column D
- Auction/funding-target metadata, if separate: auctionMetadata sheet, column O

If auction-level metadata (source, auctioneer, funding target, date, order size) does not exist as its own sheet, tell me what columns you need and I will build it. Do not invent it.

---

## Working method — staged, with checkpoints

Work in phases and **stop for my sign-off between each**. Do not run ahead.

### Phase 1 — Audit and normalize the raw data
Read every sheet. Produce a written report covering:

- Actual schema of each sheet, and how each joins to the core auction data. Identify the join key; if there isn't a reliable one, say so plainly — that's the most important thing you could tell me at this stage.
- **Consistency problems:** inconsistent item naming, duplicate rows, date format drift, currency/formatting issues, unclassified rows, orphan records, sign conventions.
- **Domain-rule violations:** funding goals above $8,000; Trent-sourced rows dated before mid-2023; Golden Ticket rows in normal data before the guarantee era; withheld rows with positive values (or whatever the convention turns out to be).
- The withheld negative-multiplier convention, as actually found in the data (see Concept 4) — with a direct question to me for confirmation.
- Whether withheld-item estimates were computed point-in-time or with hindsight, if determinable.
- **Proposed normalizations**, ranked by impact, each with: what changes, how many rows, and whether it's mechanical or needs my judgment.

Do not modify any raw data in this phase. Write the report to `docs/data-audit.md` in the repo.

### Phase 2 — Data model and UX design
Propose, in writing, before coding:

- The **schema** for the context layer: how auction-level context (source, auctioneer, funding target, era) relates to item-level context (normal / withheld / augment / grunnel / released-auctioneer-payment).
- Your **recommendation on the Golden Ticket vs. random Ultra Rare classification** (Concept 5) with reasoning.
- How context is **surfaced in the UI**: filters, toggles, badges, columns. My baseline expectation is a consistent set of filter controls (source, auction type, item classification) available on **all Pricing tabs and all Analytics tabs**, plus per-row provenance badges.
- Whether default views should **include or exclude** non-normal items — I lean toward excluding withheld estimates from headline price stats by default, with a clearly-labeled toggle. Argue if you disagree.
- Migration plan and any breaking changes to existing views.

Write this to `docs/context-layer-design.md`.

### Phase 3 — Implementation
Only after I approve Phase 2. Follow the existing architecture, conventions, and component patterns in `C:\claude\site` rather than introducing new ones. Ship in reviewable increments: data layer → filters → per-tab integration → new analytics.

---

## Scope for the UI

**In scope:** all **Pricing** tabs and all **Analytics** tabs.

**Not required:** the **Transmutes** tabs — this context doesn't usually influence them directly. That said, Concept 4 notes that transmute-chain items are exactly what auctioneers withhold, so if you see a genuinely valuable connection (e.g. flagging which transmute components are most frequently withheld), propose it in Phase 2 and I'll decide.

---

## Questions the site must be able to answer

These drive the analytics work. Design toward them explicitly:

1. **Did augmented items cover the cost of items withheld?** Per auction, per auctioneer, and in aggregate. Include the funding-target adjustment (Concept 3) — an auctioneer who lowered their goal instead of augmenting also "covered" it, just differently.
2. **How did Grunnel items contribute to total funding?** Specifically: were they worth more, less, or roughly the same as the average **preorder** item from that same year? Grunnel items exist to offset expired preorder bonuses, so that's the natural benchmark.
3. **How do prices in augmented auctions compare to non-augmented auctions?** Does adding supply depress prices, or does the perception of a richer auction attract more bidders?
4. **How do prices in Trent auctions compare to forum auctions?** Nominal and reward-adjusted. **Respect the mid-2023 confound** — see the warning in Concept 1.

---

## Standing instructions

- **Ask me when you're unsure** rather than assuming — especially about the withheld multiplier convention, the reward-point rate over time, and anything the data contradicts. But **batch your questions** and keep moving; don't stall in a long back-and-forth loop. A good pattern: make your best assumption, state it explicitly as an assumption, and ask me to confirm at the next checkpoint.
- **Distinguish estimates from observations** everywhere — in the schema, in the API, and in the UI. Withheld values are the only estimated prices in the system and should never be silently averaged in with real sales.
- **Encode eras, not hardcoded dates.** Trent's start, the Golden Ticket guarantee, and preorder-bonus expirations are all time boundaries that should live in configuration.
- **Flag confounds in the UI, not just in code.** Where a comparison is structurally biased (source vs. time, augmentation vs. year), the interface should say so where the user sees the number.
- Where you disagree with my framing above, say so. I've been close to this data for a long time and may have baked in assumptions I can't see.
