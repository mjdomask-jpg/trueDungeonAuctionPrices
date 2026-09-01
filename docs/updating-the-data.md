# Updating the data — the full runbook

Everything on the live site is computed from the CSV files in `public/data/`.
Most are exported from the Google Sheet, a few are edited by hand, and one —
`rawPricesData.csv` — is the per-lot sales export (Trent auctions only) that
drives the Analytics → **Quartiles** view. Nothing is precomputed and nothing is
stored in a database — change a CSV, and every number, chart and table
recomputes itself.

This document assumes no prior knowledge. Work top to bottom the first time.

> **Keeping this document accurate:** it describes column names, filenames and
> commands that live in the repo. If any of those change, this file must change
> in the same commit. See [Maintaining this document](#maintaining-this-document)
> at the end.

---

## The big picture

```
  1. Edit             2. Export            3. Place              4. Check
  Google Sheet   →    tab as CSV      →    public/data/     →    npm run validate
                                                                      ↓
  7. Merge &          6. PR check          5. Commit on a          (fix & repeat
  watch deploy   ←    (the gate)      ←    branch, open a PR  ←     if it fails)
```

Steps 1–3 are manual. Steps 4–7 are the same regardless of which file you
changed. Only step 2's details differ per file — that's what the per-file
sections below cover.

**Or skip 2–7 entirely:** the workbook can publish itself — see
[Publishing from the sheet](#publishing-from-the-sheet). It does the same thing
this loop does, including opening the PR, so the gate is identical.

> **There is now a one-click version of steps 2–7.** The workbook can serialise
> its own tabs and open a pull request itself: **TD auctions → Publish to
> site…**. See [Publishing from the sheet](#publishing-from-the-sheet). The
> manual loop below still works and is still what you fall back to, so read it
> first — the publisher does exactly these steps, and understanding them is how
> you read its dialogs.

**Live site:** <https://mjdomask-jpg.github.io/trueDungeonAuctionPrices/>

---

## One-time setup

You need these once. Skip if you've done them before.

1. **Node.js** — check with `node --version`. Any recent version works; CI uses
   Node 20+. If the command isn't found, Node may be installed but not on your
   `PATH` (see [Troubleshooting](#troubleshooting)).
2. **The repository**, cloned somewhere local. The working copy referenced
   throughout is `C:\claude\site`.
3. **Dependencies** — run once inside the repo:

   ```bash
   npm install
   ```

4. **Write access** to the GitHub repository, so `git push` works.

---

## The standard loop

This is identical for every file. The per-file sections only tell you what to
edit and what the rules are.

### Step 1 — Edit the Google Sheet

Make your change in the sheet, not in the CSV. The sheet is the source of truth;
a CSV edited directly will be silently overwritten by the next export.

Which tab, and what the rules are, is covered per file below.

### Step 2 — Export that tab to CSV

In Google Sheets: **File → Download → Comma Separated Values (.csv)**.

This exports **only the tab you are currently viewing**. Select the right tab
first.

Google names the download `<SpreadsheetName> - <TabName>.csv` — for example
`auctionData - tokenMetadata.csv`. **The repo needs a different, exact
filename.** Rename on save, or rename afterwards. The per-file sections give the
required name.

### Step 3 — Put the file in `public/data/`

Move the renamed file into `public/data/`, replacing what's there.

Do not put it anywhere else. There is no staging folder and no sync step — the
file the sheet exports is the file the site serves and the file the validators
check.

### Step 4 — Validate

From the repo root:

```bash
npm run validate
```

That runs three validators in sequence: the recipe/schema one, the context one,
and `validate-prices.mjs`, which reconciles every recorded price against the
source it came from. **The run must end `0 error(s)`.** An error stops the
commit; see [Troubleshooting](#troubleshooting) for what each message means. Fix
it in the Google Sheet and re-export — not in the CSV, or your fix disappears
next time.

`INFO` lines (`·`) are normal and can be ignored — a season with no auction data
falling back to earlier prices, an auction-number gap left by a deleted `Failed`
row, the skipped link check.

**Warnings (`!`) are not automatically fine.** Two of them are standing — known
and decided — so the useful question is not "are there warnings" but *"is this
warning new?"* The standing set, as of 2026-08-21:

| Warning | Why it's there |
|---|---|
| `20251 FERRET HORDE AUCTION targetFunding > $8,000` | a genuine $10,250 auction |
| `202647 "Golden Ticket": priced … with no lots` | it sold, but its lot was routed to `contextItems` as funding rather than into `rawPricesData` |

**Anything else means your export introduced it. Stop and look.** The six
warnings that stood here when the validator shipped were all real defects, and
all six were corrected in the sheet on 2026-08-21 — that is what this table is
for.

### Step 5 — Check it in a browser (optional but recommended)

```bash
npm run dev
```

Open <http://localhost:5173> and look at the pages your change should have
affected. Stop the server with `Ctrl+C` when done.

> **Windows note:** stop the dev server before any `git` branch operation. While
> running, it locks the CSVs and git fails with `unable to unlink … Invalid
> argument`.

### Step 6 — Commit on a branch and open a PR

**Everything goes through a pull request.** `main` requires the
`build-and-validate` check, so a direct push to it is rejected.

```bash
git checkout -b update-2026-auction-47
git add public/data
git commit -m "Add 2026 auction 47 results"
git push -u origin update-2026-auction-47
```

Then:

```bash
gh pr create --fill
```

**This is the gate, not a formality.** `deploy.yml` runs on a push to `main` and
does **not** run `npm run validate`; only `pr-checks.yml` does, and only on pull
requests. A change that reaches `main` without passing through a PR has been
seen by no validator at all — which is how the original defects got onto the
live site. Step 4 catches them locally; this catches them when you forget step 4.

The same rule is why [the publisher](#publishing-from-the-sheet) opens a PR
rather than committing to `main`, and why it will never fall back to `main` if
auto-merge fails.

### Step 7 — Merge, then watch the deploy

Wait for the check, then merge:

```bash
gh pr checks --watch
```

```bash
gh pr merge --squash --delete-branch
```

Merging to `main` triggers the **Deploy to GitHub Pages** workflow
(`.github/workflows/deploy.yml`): `npm ci` → `npm run build` → publish `dist/`.
It takes roughly a minute.

```bash
gh run watch
```

A green run means the build succeeded and `dist/data` matched `public/data`. Then
open the live site and confirm your change is visible.

> **Browser caching:** if the live site looks unchanged, hard-reload
> (`Ctrl+Shift+R`). The CSVs are fetched at runtime and your browser may hold an
> old copy.

---

## Watching for new auctions

`apps-script/auctionOpen.gs` watches the three places an 8K auction opens —
Trent's shop page, the forum's two auction categories, and
**[alesievauctions.com](https://alesievauctions.com/auctions)** — and proposes
the `auctionMetadata` row each new one needs. It replaces checking the forum by
hand, and it removes the two mistakes that come with typing a row from scratch:
a reused `auctionNumber`, and an `openDate` remembered rather than read.

**It never writes to `auctionMetadata` on its own.** Proposals land in a review
tab. You tick the ones that are real, fill in what only you know, and a second
menu item appends them. That is not caution for its own sake: category 584
carries charity auctions, eBay listings, cancelled auctions and pure discussion
threads alongside the real ones, and no test on a thread title separates them.
Measured against both live category feeds, the "looks like an 8K auction" test
catches 28 of the 35 recorded auctions still listed there and *also* fires on 21
threads that are not auctions at all. So it sorts; it does not filter, and it
does not create.

**The two categories are watched differently, and it is worth knowing why.** 584
is the auction category, so a thread there is proposed whether or not its title
mentions 8K. **602 is the general discussion forum** — it holds one recorded
auction and a great many threads about rules and Gen Con — so a topic there is
only looked at if its title says 8K, condensed or Onyx. Without that a scan
returns fourteen threads of noise every time. Each scan reports how many it
skipped for that reason.

### The auction site is a different kind of source

**alesievauctions.com is not read the way the other two are, and the difference
shows up in your work.** It is a purpose-built auction site: it renders one card
per auction out of its own database, and the things you otherwise have to type —
the style, whether it is Lightning, whether it is augmented, the target — are
*chips on the card* rather than words in a title. So for this source the scan
**fills those four columns in** instead of leaving them blank.

That is not a change of policy. The forum's four stay blank because guessing
them from a thread title is measurably bad, and a badge the site ticks is not a
guess. Where the evidence goes back to being as weak as the forum's, so does the
behaviour: a badge that is missing, ambiguous or contradicts its own label
leaves the cell **blank with a note**, exactly as a thread title does.

Three more things worth knowing:

- **Every card is a candidate.** There is no equivalent of category 584's
  charity auctions and eBay listings, so nothing is triaged. The title is still
  checked for the phrases that matter (charity, cancelled, pre-order, Golden
  Ticket) and they appear in `notes`.
- **One fetch, no per-auction pages.** Everything a row needs is on the listing.
- **The `Ends:` line is deliberately ignored.** It is the *scheduled* end;
  `closeDate` is when the auction actually closed, and they differ whenever an
  auction is extended, ends early on funding, or fails. It goes in `notes`. A
  blank `closeDate` is also what makes `Status` compute `Open`.

> **If a scan reports "NO auction cards were found", do not read that as "no new
> auctions".** The page is server-rendered today, which is the only reason this
> works at all — Apps Script runs no JavaScript, so a site that switched to
> rendering its cards in the browser would come back as an empty shell that
> parses to nothing and looks exactly like a quiet week. That is why the scan
> says the page was fetched, how big it was, and that it found nothing, rather
> than staying silent.

### Installing it (once)

The script goes into the **same** Apps Script project as `trentClose.gs`, as a
third file. Do the Trent install first if you have not
([Importing a Trent close](#importing-a-trent-close)).

1. **Extensions → Apps Script** from the workbook.
2. **File → New → Script**, name it `auctionOpen`, and replace its contents with
   the whole of `site/apps-script/auctionOpen.gs`.
3. Save, then reload the spreadsheet. Two new items appear under **TD
   auctions**: *Scan for new auctions…* and *Promote approved auctions…*.
4. The first run asks for authorisation again — this script fetches web pages,
   which the Trent importer never did, so Google asks separately.

You do **not** create the review tab. The scan makes `auctionOpenReview` the
first time it runs, and that tab is the only thing this script creates without
being asked.

### Using it

**Extensions → TD auctions → Scan for new auctions…**

It fetches Trent's page, both category feeds and the auction site's listing,
then a page for each forum topic it has not seen, and rewrites
`auctionOpenReview`. The summary says what
it proposed and what it skipped. Nothing else has changed.

Then, in `auctionOpenReview`:

1. **Read the `verdict` and `notes` columns first.** `candidate` means the title
   mentions 8K, condensed or Onyx; `no 8K signal` means it does not — which is
   *not* the same as "not an auction". Seven of the recorded auctions would read
   `no 8K signal` today, because their titles were edited after they closed.
   Rows from **alesievauctions.com** are always `candidate`; the `source`
   column says which source a row came from.
2. **Fill in `auctionStyle`, `completionStyle`, `augmentated` and
   `targetFunding`.** The scan leaves these blank for forum auctions on purpose.
   Guessing them from the thread title was measured and it is not good enough:
   `augmentated` comes out right on 127 of 178 recorded auctions, and
   `auctionStyle` is wrong on 11 of the 66 it would guess at — it reads "Non
   Onyx" and "No Onyx SC" as Onyx, and three auctions titled "Super Condensed"
   are recorded as `Ultra Condensed`. A wrong value you skim past is worse than
   a blank one you have to fill. The phrases it found are in `notes` as
   evidence.

   **For alesievauctions.com rows these arrive filled in from the card's
   badges** — `Onyx` gives `Onyx Ultra Condensed` and anything else gives the
   `Ultra Condensed` baseline, a `Lightning` badge gives `Lightning` and its
   absence `Fixed Date`, the `Augmented` badge gives `augmentated`, and the
   `Target` line gives `targetFunding`. Read `notes` anyway: any of them can
   still come through blank, and when one does the note says which shape on the
   page it could not read. Trent's four are prefilled too, from his 111 recorded
   rows rather than from the page.

   > **A rescan does not overwrite these four once they hold anything.** That
   > protects what you typed — but it also means a prefilled value from an
   > earlier scan is kept even if the site has since changed. When the two
   > differ the row's `notes` say so, beginning **KEPT WHAT THIS TAB ALREADY
   > HELD**; the tab still wins, so if the page is the one that is right, clear
   > the cell and rescan.
3. **Check the `season`.** `notes` says where it came from. `from the title` and
   `from the season running on <date>` are both solid — the second one asks which
   recorded season was open on that date, and seasons never overlap.
   **`season ASSUMED …` means nobody can tell from the date**, and there are only
   two ways to get it: the auction opened after everything recorded (the season
   rollover — wrong for every auction of a new season until you record one by
   hand, and seasons have started as little as **nine days** after the previous
   one's last auction), or it opened in the gap between two seasons. Either way
   the note says which, and you decide.
4. **Check `openDate` against the `first post` time.** For an
   alesievauctions.com row this is the card's `Starts:` date and time; for a
   forum row it is the thread's
   first post, read from the forum's own timestamp. Of seven auctions replayed
   in the test, five match what you recorded exactly; the two that don't are a
   thread opened at 22:51 (you dated it the next day) and one of a batch you
   dated to the day that season's auctions were allowed to start. Both are your
   call, not the script's — that is why the clock is on screen.
5. **Tick `Approve?`** on the rows you want.

Then **TD auctions → Promote approved auctions…**. It shows exactly what it will
append and asks. Numbers are worked out at this point, not at scan time, so a
row you added by hand in between is taken into account.

Rescanning is safe: your ticks and anything you typed are carried across, and
rows already promoted stay as a record.

### What it does that you don't have to

| | |
|---|---|
| `auctionNumber` | `max` of that season plus one, never `count` plus one. Failed auctions are deleted, so the numbers are sparse — 2026 is missing 3 and 38, 2025 is missing 18, 25 and 31. Counting would propose 46, which already exists. |
| `auctionId` | The season and the number run together, the way all 289 recorded rows are built. |
| `openDate` | The forum's exact first-post timestamp, not "5 days ago". For Trent, the start date his page states. For the auction site, the card's `Starts:` date — its `Ends:` line is read and then deliberately not used. |
| `auctioneer` | The forum display name — or the auction site's `Sponsor:` line — mapped to the name you already use: `Wade Schwendemann (Dr. Uid)` to `Wade S`, `alesiev - Alex` to `alesiev`, `Alesiev (Alex)` to `alesiev`, `Nick` to `Nick Braun`. A name it cannot map is flagged as new rather than guessed. |
| `auctionStyle`, `completionStyle`, `augmentated`, `targetFunding` | For the auction site only, read from the card's badges and `Target` line. Blank with a note wherever a badge is missing or contradicts itself. Blank for forum auctions always. |
| Duplicates | A forum auction is identified by its topic id, so a renamed thread is still recognised. An auction-site auction is identified by the id in its URL, which is the strongest of the three. Trent's are identified by season and name, because all 111 of his rows share one URL and his numbering restarts each season. |
| The formula columns | Left alone. See below. |

### The columns it writes, and the ones it must not

It computes eleven columns: `auctionId`, `auctionSeason`, `auctionNumber`,
`auctionName`, `auctionStyle`, `completionStyle`, `auctioneer`, `Link`,
`openDate`, `targetFunding`, `augmentated`.

`daysToClose`, `Status`, `Open Month`, `Close Month`, `augmentedTotal`,
`fundingNoAugment` and `preorderTotal` are **formulas**, and a literal written
into any of them would freeze it at whatever the previous auction happened to
hold. So the script appends by **copying the last row down** — formulas and
formatting intact, references shifted one row — and then goes cell by cell:

- a column whose source cell holds a **formula** is **left as copied**;
- one of the eleven above, where the source cell is *not* already a formula, is
  **written**;
- any other column whose source cell holds a **literal** is **cleared**.

> **Two of those eleven are formulas, and the script wrote over both until
> 2026-08-24.** `auctionId` is `=B2&C2` and `augmentated` is
> `=IF(Q2&R2<>"","Yes","No")`. The formula wins now.
>
> It went unnoticed because both formulas produce exactly what the promotion
> would have typed — an `auctionId` of season+number, and `No` at open time
> when there are no augment values yet — so nothing ever disagreed. `auctionId`
> was cosmetic. **`augmentated` was not:** its formula flips to `Yes` when
> augment values are entered beside it, and frozen as a literal it stayed `No`
> for the life of the auction. That column is what the site reads to decide
> whether an auction was augmented at all.
>
> If you promoted an auction before that date and later added augments to it,
> **check its `augmentated` cell** — it may be a literal `No` that should be a
> formula. Copy the formula down from a neighbouring row.
>
> Where the review tab supplies a value that a formula is about to win over,
> the promote dialog names it under *COMPUTED BY THE SHEET*, rather than
> dropping it in silence.

That last rule is the important one, and it is why the script reads the source
row's formulas rather than working from a list. A copied row arrives holding the
previous auction's everything — including its `closeDate`. Left in place, a
brand-new auction would compute `Status = Closed` and never appear as open
anywhere on the site. Cleared, `Status` reads `Open`, which is what you want
until you fill `closeDate` in at the close.

The same rule covers `augmentTokens`, `augmentGrunnel` and `augmentWithheld`
whichever they turn out to be: if they are QUERY formulas they are kept, and if
they are numbers you type they are cleared rather than inherited.

**One formula the copy gets wrong, and it is the one to watch.** `Open Month` is
`DATEDIF(<that season's start date>, openDate, "M")+1`, and the baseline is
hard-coded per block of rows. Copying the previous row down copies the previous
row's *season baseline*, so the first auction of a new season inherits the old
one and reads a month or so too high. The promote dialog says so in a CAUTION
line whenever the season changes. Fix that one cell by hand.

### When it refuses

| It says | What happened |
|---|---|
| `topic … is already recorded as 2026xx` | Between the scan and the promote, that auction was added. Nothing is written; untick the row. |
| `"Trent Auction 33" is already recorded as … for season 2026` | Same, for Trent. Note the season — the same name in a *different* season is a different auction and is allowed. |
| `no season` / `no openDate` / `no auctionName` | The review row is missing something the sheet needs. Fill it in and promote again. |
| `no "<column>" column in auctionMetadata` | A column was renamed. Fix the name in the sheet, or `OPEN_METADATA_FIELDS` in the script. |
| `Trent: could not read an auction number and start date from the page` | Usually he is between auctions and the page has no live one. Not an error. |

### What it does not do

- **It does not close anything.** Prices, `closeDate` and the augment columns are
  all still the close-side job — Trent's through the importer, everyone else's
  by hand until Phase 5.
- **It does not watch anything but those three pages.** An auction announced
  only in a Discord or a newsletter will not appear.
- **It does not run on a timer.** It is a menu item, like everything else here.

### Changing the script

`apps-script/auctionOpen.gs` **in the repo is the source of truth**. Edit it
here, **bump `OPEN_VERSION`**, run `npm run test:open`, then paste the whole file
over the editor's contents. Every dialog shows the version in its title.

The test replays saved copies of the real pages — in `fixtures/auction-open/`,
gzipped because Kunena serves ~90 KB of markup for a page whose useful part is
one `<span>` — against the rows `auctionMetadata.csv` already holds. If the
forum or the shop changes its markup, that suite is what tells you, and
re-fetching the fixtures from the URLs in its `manifest.json` is how you update
it.

---

## Importing a forum close from a file

Some forum auctioneers send a spreadsheet of their results rather than only
posting them in the thread. Where that file exists it is the record and the
thread is the fallback, so it is worth using: the numbers are already numbers.

`apps-script/forumClose.gs` imports one. It is deliberately thin — the quantity
rule, the name resolution, the per-token division, the min/max and the Onyx
routing are all [the Trent importer's](#importing-a-trent-close), unchanged. All
the .gs files share one scope in Apps Script, so it simply calls them. **The
Trent script must be installed for this one to work.**

### The format to ask for

**One row per lot, three columns: `Item | Number | Amount`.** That is the shape
worked out with the auctioneer over the 2026 season, and it is what this
importer is built around. Sent as-is it needs no hand editing at all: 211 lots
reproduce `prices.csv` on **19 of 20 items**, and the rows that are not prices
are recognised and handed to you as a `contextItems` block.

Two earlier drafts of that conversation are also handled, because they exist:

| The file's headers | What it is | How it is treated |
|---|---|---|
| `Item \| Number \| Amount` | one row per lot | **Ask for this.** |
| `Auction Item \| Low Bid \| High Bid` | already aggregated | Imported **with a caution**. Agreed on 6 of 13 items and differed on 7, in both directions. Check the numbers. |
| `… \| Minimum Bid \| Maximum Bid \| Average Bid` | a rejected draft | **Refused**, on the `Average` column. It reconciles with none of that auctioneer's five auctions on a single item. Nothing in the numbers says so — the header is the only warning there is. |

### The rows that are not prices

A results file carries things that do not belong in the price spine, and the
importer knows the recurring ones by name rather than stopping on them:

| In the file | Becomes |
|---|---|
| `Random UR` × 9 | **one** `token` row, quantity 9, summed — which is how the sheet records it |
| `Grunnel Augment` × 6 | **six** `grunnel` rows, one per lot, each keeping its own price |
| `Player Augment` × 2 | two `token` rows |

For 202647 those nine rows carry exactly the prices `contextItems` records —
47, 51, 72, 103, 112, 137, 161, 455 and 497.

> **Eight of them come through without a name, and that is not a bug.** The file
> calls all six grunnel augments `Grunnel Augment`; only the auction thread says
> that they were the Tornado Bucket, the Green Key, the Censer and so on. **The
> file gives the prices and the thread gives the identities**, so the importer
> fills in everything except the one fact it does not have. The dialog says how
> many rows need naming.

Any name that is *not* on that short list still stops the run and is reported —
an unrecognised name is usually a token spelled a way the resolver does not
know, and guessing at it would put a wrong price in the spine.

### Installing it (once)

Add it as a fourth file in the same Apps Script project (**File → New →
Script**, name it `forumClose`), paste in `site/apps-script/forumClose.gs`, and
add a tab called exactly **`forumStaging`**. Reload the spreadsheet; two items
appear under **TD auctions**.

### Using it

1. Paste the auctioneer's file — **including the header row** — into
   `forumStaging`.
2. **TD auctions → Dry run — show what the file would import.** Give it the
   target `auctionId`.
3. Read the summary. It says which shape it detected, how many lots it read,
   what goes to each tab, and anything it could not resolve.
4. **Import forum close from a file…** when the dry run looks right.
5. Paste the `contextItems` block it shows you, and fill in the names of any
   rows that came through blank — see above.

If it *does* stop, the summary names every row it could not place. Deal with
those and run it again; the script hands you a worksheet for the ones that look
like context items, exactly as the Trent importer does.

### What it does that the Trent importer does not

| | |
|---|---|
| Trailing quantities | `AI 10x` means what `10x AI` means. It is rewritten before parsing, so the shared quantity rule — verified against 18,466 Trent lots — is left alone. |
| Withheld markers | A price cell reading `Withheld` is reported and skipped, not read as a price or as an unsold lot. `Golden Ticket \| Withheld` is the sample. |
| `Totals` rows | A pivot's trailing total is not a lot. |
| Already-aggregated files | Contribute **no `rawPricesData` rows**. Their two values per row are a min and a max, not two sales, and writing them as sales would invent lots that never existed. |

### Changing the script

`apps-script/forumClose.gs` in the repo is the source of truth. Edit it here,
**bump `FORUM_VERSION`**, run `npm run test:forum`, then paste it over the
editor's contents. The test replays all three real files in `fixtures/forum/`
against `prices.csv`.

---

## Reading a forum close from the thread

Most auctioneers send nothing. The results are in the thread, usually edited
into post #1 after the auction closes, in whatever shape that auctioneer likes.

`apps-script/forumThread.gs` reads that. **It is an assistant, not an importer.**
It fetches every page of the thread recorded in `auctionMetadata.Link`, proposes
a price for each item beside the distribution it came from, and writes the lot
into a review tab. **It writes nothing to `prices`, `onyx`, `rawPricesData` or
`contextItems`** — you copy the rows you accept.

That is not caution for its own sake. Measured over 24 real threads spanning 20
auctioneers, the proposals reproduce `prices.csv` on **331 of 358 items**. The
other 27 are yours to judge, and the review tab shows you what to judge them on.

### Installing it (once)

Paste `apps-script/forumThread.gs` into the same Apps Script project as the
other three files, as a new file named `forumThread`. **`trentClose.gs`,
`forumClose.gs` and `auctionOpen.gs` must all be installed** — this one calls
the resolver from the first, the auction picker from the second and the fetcher
from the third. Reload the sheet; the menu gains **Read a forum close from the
thread…**.

### Using it

1. Make sure the auction has a row in `auctionMetadata` with its forum `Link`.
   If it does not, run **Scan for new auctions…** first.
2. **TD auctions → Read a forum close from the thread…**, and give it the
   `auctionId`.
3. Read the dialog. Then work through the `forumThreadReview` tab.

### What the review tab holds

| `kind` | What it is | Where it goes |
|---|---|---|
| `price` | A proposed price with its distribution | `prices` |
| `onyx` | A chase Ultra Rare | `onyx` |
| `context?` | A lot that resolved to no token — usually an augment or a prop — **or any lot under a `NON-8K STUFF` heading** | `contextItems`, once you have given it a category |

A `NON-8K STUFF` heading used to route its lots to a `dropped` kind that went
nowhere, on the reasoning that 20222 recorded none of them. That read intent
from a season nobody had backfilled yet: they are `contextItems`, and the same
names are already recorded as context for other auctions. Unlike an
`Augmented Tokens:` heading — which is advisory, because Mike Steele's heads his
entire 159-lot table — **a non-8K heading scopes**: every lot beneath it becomes
a context candidate whatever its name resolves to, so a personal sale of a
current-season token can never be proposed as a price.

The `flag` column is where the judgement is. `TIE` means the quantity-weighted
mode had no single winner.

### The four things to check every time

**1. Ties.** The `distribution` column is not decoration — it is the whole
reason you can override in one cell rather than guess. A row flagged `TIE` went
to two prices in equal quantity, and there is no rule for that: across the
recorded corpus ties resolve **8 low, 5 high, and once on the midpoint** ($16
and $17 recorded as $16.50). The low value is proposed so the cell is never
blank. Change it freely.

**2. The unread lines.** Every line carrying a price that no grammar could read
is listed. It is short — 128 lines across all 32 threads — and it is the only
thing standing between a pattern-matching parser and a silent omission. Skim it.
It grew when `threadLooksLikeHeader` stopped accepting priced lines: those lines
were always unreadable, they were just being swallowed as section headers
instead of reported.

**3. Withheld candidates.** Sentences that read like something was held back,
quoted verbatim with their post number, **deduped**. They are quoted rather than
parsed because the quantities are sometimes ranges ("the 9-10 random URs"), and
a wrong quantity here becomes a wrong negative number in `contextItems`. **Take
the item and the quantity only** — the sheet computes the price as
`-(season average) × quantity`, and a `withheld` row must never carry a price
read off a post.

**4. The close date is EVIDENCE, not a proposal.** The dialog lists every post
that says the auction is over, with its date and the sentence. The bracket it
builds contained the recorded `closeDate` in only **8 of the 19 threads that
yield one at all**, and where it missed it was usually late — the announcement
trails the close. Two things it will not tell you: a closing phrase in post #1
dates nothing (post #1 is edited in place and keeps the thread's *open*
timestamp, which is why post #1 is skipped), and 13 of the 32 threads say nothing
at all.

### When it comes back with nothing

Two of the 24 sampled threads have no posted results anywhere — the numbers
lived in a linked Google Sheet, or were never posted. The dialog says so rather
than pretending. Ask the auctioneer for the file instead; see
[Importing a forum close from a file](#importing-a-forum-close-from-a-file).

### Things it gets right that are easy to get wrong

| | |
|---|---|
| A repeated table | Some auctioneers repost the whole results table as a bid update — one thread has 80 near-complete copies, and the *biggest* is a mid-auction snapshot with lower prices. Post #1 wins whenever it carries results, because it is edited in place after the close. The dialog says when other copies exist. |
| `Buy It Out` columns | A money-formatted column is not necessarily the price. One auctioneer's table is `item name \| Buy It Out \| Bid \| Bidder/Buyer Name`, and the winning bid is the *bare* column. Tables are read by their header; a table whose only bid column is a buy-it-out, a minimum or an average is **refused**. |
| `10x $25` vs `9x $11` | Both are `Nx`, and they mean opposite things. Under a plain heading the price is for the lot; under an `(N - individual)` heading it is per token. Getting it wrong is a factor of ten. |
| `ONYX or PYP` | Genuinely ambiguous, and listed separately. They are proposed as Onyx because that is what the one recorded precedent did — and that auction *also* recorded their price as its Ultra Rare. Decide. |
| Onyx section headings | `ONYX ITEMS` routes what follows to `onyx.csv` until the next heading. `Standard Onyx 8k Items` does **not** — there the word describes the order, not the tokens. |
| Condensed bags | A **Condensed** order (a style saying Condensed without Super or Ultra) sells a bag of 120 random Rares and a bag of 240 random Uncommons. Nine spellings are recognised, and **a bag never divides** — `120x Random Rare` is one bag containing 120 tokens, not a lot of 120, and reading it the other way turns a $65 bag into a $0.54 trade good. |
| A name under an item heading | Where a heading names a token, the lines beneath it are that token's lots and whatever looks like a name on them is a **bidder** — `PYP URs (34)` over `Saruman (4) - $115`. Reading the bidder as the item is how one thread proposed eighty context rows named after Tolkien characters and none of its 22 real items. The test is resolution both ways: the heading resolves, the name does not. |
| A heading with an aside | `Random URs (9) - First in, first out. Luck of the draw.` is a heading; the sentence after the dash is not part of the name. Unread, its lots inherit the heading *above* — nine Random Ultra Rares landing in an auction's `Ultra Rare` row, and a $205 Golden Ticket bid landing in its gold. **A line carrying a price is still never a heading**, aside or no aside. |
| `(1) … (8)` down a block | A parenthesised number can be the **lot number** rather than the quantity. A run of consecutive lines under one name numbered exactly 1…N is a numbered list, not eight lots of sizes one to eight; read the other way, one auction's eight Teeth came to 36 and its 44 gold bars to 4 while the parse still rated 20 of 20 names matched. |
| `Buyout:` | One auctioneer marks both a sale and an offer nobody took with the same word. **A named buyer is what separates them** — `Orb of Dragonkind: Hershey Buyout: $410` sold, `Elven Bismuth Buyout: $12` is the standing price against four lots that went at $8. The offers are left unread on purpose. |
| `.75` and `$.50` | A price may drop its leading zero, its dollar sign, or both. Four whole rows of one auction sat in `unparsed` for the want of the zero. |

### Changing the script

`apps-script/forumThread.gs` in the repo is the source of truth. Edit it here,
**bump `THREAD_VERSION`**, run `npm run test:thread`, then paste it over the
editor's contents. The test replays all 55 threads in `fixtures/forum-threads/`
against `prices.csv` and `onyx.csv` and asserts the corpus totals, so a rule
that improves one auctioneer at another's expense shows up as a number.

**Adding an auctioneer's grammar** means adding an entry to `THREAD_RULES`,
ordered by specificity — the narrower shape must be tried first, or
`Golden Ticket - $875 Dragon` and `#1-3 : Lich - $100` read as each other. Add a
fixture for the thread you added it for, and put the auction's measured counts
in `fixtures/forum-threads/manifest.json`.

**Write the rule looser than the one example you have.** Auctioneers are not
consistent with their own formatting, and a rule pinned to a single sample fails
silently on the same person's next line. Two measured cases:

- `qty-buyer-rule` required the `=` run to touch the `@` (`=+@`). Lord Brian
  types a space about a third of the time, so `(1) Perrin=== @ $ 15.00 each` was
  unreadable — seven of 202211's 23 items.
- `item-price-buyer` expects a space before the buyer, so Flik's
  `Cloak of Blending - $55 - Quail`, with a dash, matched nothing. That was the
  whole `Augmented items:` section of 202236 — six tokens, $485. The section
  *header* was recognised all along; only the line shape was missing.

**One auctioneer is not one grammar.** Casey Wren writes a different shape in
each of his four recorded auctions — `- Anton (1) $780`, `Zani (1) $376` with no
dash, the same line TAB-separated, and `Anton $370.00` with the quantity moved
after the buyer. Finding his thread in the fixtures is not evidence that his next
one will read. The count has gone four → eleven → twenty-three → twenty-nine as
threads were added; assume the next auctioneer needs a new rule.

**Two of the rules do not live in `THREAD_RULES`, because a pattern cannot read
those lines at all.** Fred K writes `Ring of the 3rd Circle Haliax $101` — no
separator between the item and the buyer, so nothing in the line's shape says
where one stops. `threadBareLot` asks the token index instead and takes the
longest leading run of words that resolves for the auction's season;
`threadBuyerLot` handles the same shape for a name no season knows — an augment,
by definition — by splitting on the post's own set of buyers, which is why the
post is scanned twice. Both REFUSE rather than guess: a line they cannot place
stays in the unread list. `threadBareLot` runs *before* the rule table, because
the loosest rule there was taking `Wish Ring Manet $146` for a bare buyer and
proposing an `Ultra Rare` at $146 against a recorded $80.

**A heading may declare things, and all three declarations are load-bearing.**
`Alchemist Ink (AI)` says what `AI` means for the lines beneath it — read from
the post, so there is no table of abbreviations to get wrong.
`Trade Goods (bidding on 10x lots or the specific amount)` says that `Nx` marks
a lot price below that line, where above it the same auctioneer means a count:
in 202413 `4x $130` is four Rings at $130 each and `10x $35` is ten Minotaur
Hides for $35, and reading one convention across the post put four of the
auction's prices out by their own lot size. `(12 - individual)` says the
opposite for its own item only.

**The heading can carry the lot size.** `Alchemist Parchment 10x Chip` means five
lots at $30 is fifty tokens at $3.00. `parseQuantity` only reads a lot size off
the *front* of a name, so `threadTidyName` moves a trailing `Nx Chip` there.
Left alone the heading resolves to nothing and every line under it is proposed as
an augment — which is the failure to watch for, because it is silent and looks
like a finding.

**A missing grammar does not fail loudly — it renames things.** Until this was
fixed, a priced line that no rule read fell through to `threadLooksLikeHeader`
and became the section header, silently renaming every line beneath it. 202211
lost seven items that way and grew thirteen phantom context candidates named
after bid lines. `threadLooksLikeHeader` now rejects any line carrying a price,
so such a line lands in the unread-lines list where § *The unread lines* says it
belongs. **When a thread's numbers matter, read its results post** — the
`itemsMatched` count compares NAMES only, so a post whose prices are all read
from the wrong column still scores full marks.

---

## Importing a Trent close

### Installing it (once)

1. Open **`Auction Data for Website - EDIT HERE FIRST`** in Google Sheets.
2. **Extensions → Apps Script.** A new tab opens on a file called `Code.gs`
   containing an empty `myFunction()`.
3. Select everything in that editor and replace it with the whole of
   `site/apps-script/trentClose.gs`. Rename the file to `trentClose` if you
   like; the name doesn't matter, the contents do.
4. **Save** (the disk icon, or Ctrl+S).
5. Add a tab to the workbook called exactly **`trentStaging`**. Leave it empty.
6. Reload the spreadsheet tab. A **TD auctions** menu appears next to Help.
   It is added by `onOpen()`, so it only shows up after a reload.
7. The first time you run a menu item, Google asks for authorisation: *Review
   permissions* → pick your account → *Advanced* → *Go to (project name)* →
   *Allow*. The warning screen is what Google shows for any unpublished script;
   it is asking to let the script edit this spreadsheet, which is the whole job.
8. Run **TD auctions → Dry run** once against a close you already have, and
   check the numbers before you ever let it write.

The menu has two items. **Dry run** parses and reports and writes nothing.
**Import Trent close…** does the same and then asks before appending.

> **Before the first real import, make a copy of the workbook** (File → Make a
> copy) and run it there. Nothing below has ever executed against the live
> sheet: every parsing rule is verified against 18,466 real lots, but the half
> that talks to the spreadsheet — the menu, the prompts, the append — has only
> been reasoned about.

**Two things it will do to the sheet that are worth knowing before you say yes.**

It appends **literal values** to `rawPricesData` and `prices`, into columns that
hold VLOOKUP formulas today. That is deliberate — the parser has already
resolved the names, and it does so without needing a `trentNormalization` row
per lot number. But it means new rows are literals sitting under formula rows,
so **do not fill the old formulas down over the imported rows**: they resolve
through `trentNormalization`, which no longer gets new entries, and would
replace correct values with the `"No Match Found"` sentinel.

It writes to **`prices`** — not `auctionPricesOLD`, the retired copy that still
recalculates. The script refuses to write to any tab whose name ends in `OLD`,
and checks every tab it needs exists before it reads anything.

### Using it

For a **Trent** auction, do not type any of this by hand. The workbook has an
importer that does the whole front half of the loop — the parsing, the
per-token division, the min/max, the Onyx split — and writes the rows itself.

**Extensions → TD auctions → Import Trent close…**

1. Open Trent's close file. Copy the whole sheet — **including the header
   row** — and paste it into the **`trentStaging`** tab. Don't tidy it first:
   the extra date columns, the varying header spellings and the unsold rows are
   all expected, and removing them by hand is the step this replaces.
2. Run the menu item and give it the target `auctionId`. It lists the most
   recent Trent auctions to choose from.
3. Read the summary. It says how many lots it read, how many rows go to each
   tab, and **names every unsold lot it is dropping**. Confirm, or cancel.
4. Then rejoin [the standard loop](#the-standard-loop) at step 2: export the
   changed tabs, place them, `npm run validate`.

### What it does that you don't have to

| | |
|---|---|
| Lot names | Resolved to the canonical `Item` against that season's `tokenMetadata`, with a short exception list for the irregular ones. **The old `trentNormalization` tab is not used and does not need a new row per lot.** |
| Quantity | `10x Dwarven Steels #7` is ten tokens, `1,000 GP Gold Bar x4 #1 (4 Tokens)` is four — the `x4` and the `(4 Tokens)` are one fact written twice, not sixteen tokens. |
| Per-token price | The lot price divided by that quantity, rounded half away from zero to match every existing row. |
| `auctionPrices` | Min and max per item — **one** row where an item had a single lot. |
| Onyx lots | `+2 Sacred Sling - 2023 (Onyx)` is routed to `onyx` with the marker and the year stripped. They arrive inline in Trent's file. |
| Unsold lots | A blank bid is the real no-sale signal. **No row is written**, and the count is reported. |
| The auction key | Derived from the auction you picked, applied to every row. You never choose a paste target, which is what makes "pasted into the wrong auction" impossible rather than merely detectable. |

### When it refuses

It writes **all of an auction or none of it**. Three things stop it, and each
one is a question only you can answer:

- **A lot name it cannot resolve.** The message says which of the two causes it
  looks like, because the fix is completely different for each — see
  [Context items](#context-items-in-trents-file) below.
- **A season mismatch.** The file's own token names say one season, the auction
  you picked is another. Check the auction before anything else — the year in
  Trent's *filename* is a calendar year, not a season, and they differ for every
  autumn auction.
- **A contradictory quantity**, where `(4 Tokens)` and a mid-name `x2` disagree.
  Check the lot name against Trent's file; the script will not pick one.

A **CAUTION** line is different from a refusal. It appears when nothing in the
file is unique to one season, so the season check could not run — the import is
still offered, but confirm you picked the right auction.

### Context items in Trent's file

Trent's close file carries more than tokens. Grunnel items, bundles and other
context lots come through inline, and they belong in
[`contextItems.csv`](#contextitemscsv), not in the price spine. **The importer
never writes them** — it stops and hands them to you.

Only one Trent auction has ever needed this — `202348`'s single `Grunnel
Scroll`. (Auction `202647` has ten such rows, but it is alesiev's **forum**
auction, not Trent's, so this importer will never see it.)

The importer sorts unresolved names into two kinds, because the fix differs:

| The message says | What it means | What to do |
|---|---|---|
| `…not a token in season 2026, but it is in 2025` | It *is* a token. Either you picked the wrong auction, or `tokenMetadata` is missing a row for this season. | Fix the auction, or add the token, then re-run. |
| `…is not a token in any season — most likely a context item` | Not a token at all. | Use the worksheet, below. |

When anything falls in the second group, a **Context items** box opens with a
ready-to-paste block in `contextItems` column order:

```
auctionId  auctionSeason  auctionNumber  category  Item          quantity  priceAugmented
202647     2026           47                       Green Key     1         455
```

Three things you must do to it, none of which the script will guess:

1. **Fill in `category`** — `token`, `grunnel`, `withheld` or `augment`. That is
   a judgement about what the item was doing in the auction; a name can't decide
   it.
2. **Check `quantity`.** It is read from the lot name, so `4x Baby Potatoes`
   gives 4 but `Random UR` gives 1 where the real answer was 9.
3. **Don't put a price on a `withheld` row.** A withheld item didn't sell, so
   there is no bid to transcribe — and the **site recomputes** the figure it
   displays from live sales regardless (see
   [`priceAugmented`](#contextitemscsv)). Signs matter on the rows that do carry
   a price: `withheld` negative, `token` and `grunnel` positive.

Then **delete those lots from `trentStaging`** and run the import again. It
writes all of an auction or none of it, so nothing landed on the first attempt.

> **One name will not stop it: `Golden Ticket`.** It is a real token in
> `tokenMetadata`, so it is priced like any other lot — which is right, it did
> sell. If the auction also needs a Golden Ticket *funding* row in
> `contextItems`, add that yourself; the two records are different facts.

### Changing the script

`apps-script/trentClose.gs` **in the repo is the source of truth**, not the copy
in the workbook's script editor. Edit it here, **bump `SCRIPT_VERSION`**, run
`npm run test:trent`, then paste the whole file over the editor's contents.

**Is the workbook's copy current?** Every dialog shows the version in its title
— `Import Trent close (script 2026-08-22.1)`. Compare it with `SCRIPT_VERSION`
at the top of the repo file; if they differ, re-paste. Re-pasting is always
safe: the script keeps no state between runs, so there is nothing to migrate.

That test replays every Trent auction already in the repo — ~18,000 lots across
~110 auctions — back through the importer and asserts it reproduces the shipped
CSVs exactly, plus fixtures in `fixtures/trent/` for the Onyx, unsold and
odd-header shapes that `rawPricesData` doesn't carry. An edit made only in the
editor is an edit nothing tests.

---

## Publishing from the sheet

`apps-script/publishToSite.gs` collapses steps 2–7 of the standard loop into one
menu click. It reads the eight sheet-backed tabs, writes them as CSV, compares
each against what the repository already holds, commits only what changed as a
**single commit on a new branch**, and opens a **pull request with auto-merge**.
The PR check then runs `npm run build`, `npm run validate` and `npm test`, and
merging triggers the deploy.

**It never commits to `main` directly, and that is not a stylistic choice.**
`deploy.yml` runs on push to `main` and does **not** run `npm run validate`;
only `pr-checks.yml` does, and only on pull requests. A direct commit would skip
every validator this project has. The PR route costs about ninety seconds.

### Installing it (once)

The script goes into the **same** Apps Script project as `trentClose.gs`, as a
second file. Do the Trent install first if you have not
([Importing a Trent close](#importing-a-trent-close)).

1. **Extensions → Apps Script**, then **+ → Script** to add a file. Name it
   `publishToSite`.
2. Paste the whole of `site/apps-script/publishToSite.gs` into it and save.
3. **Re-paste `trentClose.gs` too**, if the workbook's copy predates version
   `2026-08-21.6`. Its `onOpen` is what adds the publish menu items — every
   `.gs` file in a project shares one global scope, so a second `onOpen` here
   would replace the first and one of the two menus would silently vanish.
4. Reload the spreadsheet. **TD auctions** now has *Publish to site…* and
   *Dry run — what would be published* below a separator.
5. **Create the token** (below), then run the **dry run** before anything else.

### The token — you create and store this, nobody else touches it

The script authenticates as you. It reads the token from script properties and
it is **never in the script body**, which is visible to anyone with edit access
to the spreadsheet and is kept in version history forever.

1. On GitHub: **Settings → Developer settings → Personal access tokens → 
   Fine-grained tokens → Generate new token**.
2. **Repository access: Only select repositories →
   `mjdomask-jpg/trueDungeonAuctionPrices`.** Not "all repositories".
3. **Permissions → Repository permissions:**
   - **Contents: Read and write** — to create the blobs, tree, commit and branch.
   - **Pull requests: Read and write** — to open the PR and enable auto-merge.

   Nothing else. Leave every other permission at *No access*.
4. Set an expiry you will actually notice — 90 days is a reasonable default —
   and put a reminder in the calendar. When it expires the script fails loudly
   with a 401; nothing is published half-way.
5. Copy the token **once** (GitHub will not show it again).
6. In the Apps Script editor: **Project Settings → Script Properties → Add
   script property**, name **`GITHUB_TOKEN`**, value the token. Save.

**Do not paste the token into a file, a commit, a chat, or the script body.** If
the spreadsheet is ever shared more widely, revoke it on GitHub and issue a new
one — that takes a minute and is the whole reason for the single-repository
scope.

### Two repository settings auto-merge needs

Auto-merge is a repository feature, not something the script can switch on:

- **Settings → General → Pull Requests → Allow auto-merge** must be ticked.
- There must be a **branch protection rule on `main` requiring the PR check**.
  With nothing to wait for, GitHub considers the PR already mergeable and
  refuses to queue an auto-merge.

If either is missing the publish still succeeds and the dialog says so — it
reports the PR link and asks you to merge it yourself. It will **never** fall
back to committing to `main`.

### Using it

**TD auctions → Dry run — what would be published** first, every time you are
unsure. It reads the tabs, diffs them, runs every preflight and writes nothing.
(It still needs the token — the diff is against the live repository — but it
makes no write of any kind.)

Then **TD auctions → Publish to site…**. The confirmation dialog lists each
changed file with its row count and how it moved, each unchanged file, any
cautions, and the branch name. Confirm, and it reports the pull request URL.

> **The dry run is also the fidelity test, and it is worth understanding.**
> The CSVs in the repo came from Google's own *Download → CSV*, and the script
> writes CSV from `getDisplayValues()` — the same rendered text. So **a tab you
> have not edited must report as unchanged.** If one you did not touch reports
> as CHANGED, the script's output differs from Google's own export somewhere,
> and that is a bug to chase before publishing, not a diff to accept. Run the
> dry run once on a day you have changed nothing: all eight should say
> unchanged.

### What it refuses to do

**It publishes eight files and only eight.** `derivedPrices.csv` and
`tokenGroups.csv` are [hand-authored](#hand-authored-files) with no tab behind
them; publishing all ten would overwrite both with whatever a same-named tab
happened to hold. The allow-list is in `PUBLISH_FILES`, the two names are
refused by `PUBLISH_NEVER`, and the guard runs twice — once when a tab is read,
once again immediately before the file becomes a git blob.

It also refuses any tab whose name ends in `OLD`, for the same reason the Trent
importer does: `auctionPricesOLD` and `transmutesOLD` still recalculate.

### When it aborts

**All eight files publish or none do.** Any of these stops the run in the sheet,
before anything reaches GitHub:

| The message says | What it means |
|---|---|
| `row N (column): #REF!` — or `#N/A`, `#VALUE!`, `#DIV/0!`, `No Match Found`, `⚠` | A formula is broken, or a VLOOKUP missed and the sheet's `IFERROR` wrote its sentinel. The sentinels look like data, which is exactly why they are refused. Fix the formula — and look at what the lookup was pointing *at*: the `⚠ check name` that got through before this check existed was caused by a trailing space typed into a `tokenMetadata` display name, so the broken cell and the broken cause were on different tabs. |
| `row N: Price is blank` / `is "-"` | A keyed price row with nothing to price, in `prices`, `onyx` or `rawPricesData`. **Blank does not mean unsold** — the site silently drops such a row, so it moves no statistic and looks healthy. Fill it in or delete the row. |
| `row N: no auctionId` | A keyed row that joins to nothing. Wholly blank rows are fine and are skipped. |
| `7753 rows -> 4000 (-3753)` | The tab lost more rows than a correction plausibly would (more than 2%, or 3 rows on a small file). Check for a filter left on, a sort that clipped the range, or a half-deleted tab. |
| `7753 rows -> 15506 (+7753)` | The tab gained more than 25% (or 200 rows on a small file). Confirm it is a backfill and not a duplicated block. |
| `the tab has no data rows at all` | Always refused, whatever the percentages say. |

A **CAUTION** is not a refusal. `the header row changed` appears when a column
was renamed, added or removed — adding one is legitimate and has happened twice,
so it asks you to look rather than standing in the way. `Nothing changed` means
every tab already matches the repository.

### The withheld preview, and why it no longer blocks you

`docs/withheld-recompute-preview.csv` is an **audited golden file in the repo**,
with no tab behind it. `validate-context.mjs` checks the live withheld recompute
against it — and only a checkout can regenerate it, so for a while any publish
that changed withheld rows blocked its own PR until someone sat down at the
repo. About one auction in ten carries withheld items, so that was a real tax on
the whole point of publishing from the sheet.

**It doesn't any more.** The audit compares on the **intersection**: a value it
already covers must still match to the cent, but a withheld row it has never
seen is new data, not drift. A new auction can't move an old estimate — the
recompute only reads sales closing *strictly before* the withheld auction, so
that window is shut by the time a later auction exists.

| What changed | What the check does |
|---|---|
| A new auction brings new withheld rows | **Passes.** Reported as new data. |
| A value the audit covers has moved | **Fails**, naming the rows and the old and new figures. |
| A withheld row disappeared | **Warns.** Visible; the publisher's row-delta guard is what stops a mass deletion. |

So the only thing that still stops a publish is the one case that genuinely
wants a person: a historical estimate that moved. A correction to an old price,
or a change to the recompute itself, does that. A new auction does not.

The publish still tells you when it touches `contextItems`, `prices` or
`auctionMetadata`, so you know the preview has fallen behind. Bringing it
forward is housekeeping you can batch. On the branch the publish opened:

```bash
node scripts/gen-withheld-preview.mjs
```

```bash
npm run validate
```

Commit the regenerated preview to that branch and push — or do it later on its
own branch; nothing is waiting on it.

> **Read the diff before you commit it.** A withheld value moving by a cent is
> the price cascade and is expected; dollars are not, and a row count that moved
> by more than you changed means something else happened. Regenerating the
> preview when you *cannot* explain the drift destroys the check — you would be
> comparing the recompute against a baseline built from the same data.

**Regenerating is deliberately not automated**, for that reason. If the publisher
rebuilt the golden file from the data it had just published, the check would be
comparing the data against itself and would never fail again.

### Two things it does not do

**Nothing for correctness.** It publishes whatever the sheet says, faster. That
is exactly why `validate-prices.mjs` had to land first: auto-publish without the
reconciliation validator means a bad value reaches the live site in ninety
seconds instead of whenever you next sat down.

**Nothing on a timer.** It is menu-driven, on purpose. A time-driven trigger is
the thing that actually removes deferral, but it needs a "ready to publish"
latch first, or a trigger firing mid-entry ships a half-typed auction — and the
preflights will not catch a genuinely incomplete row.

### Changing the script

`apps-script/publishToSite.gs` **in the repo is the source of truth**, not the
copy in the workbook's editor. Edit it here, **bump `PUBLISH_SCRIPT_VERSION`**,
run `npm run test:publish`, then paste the whole file over the editor's
contents. Every dialog shows the version in its title, so comparing it against
the constant at the top of the repo file answers "is the workbook's copy
current?".

That suite parses every shipped CSV back into a grid, re-serialises it, and
requires the result to match **byte for byte** — quoting, embedded commas and
quotes, CRLF, and the absent trailing newline. `rawPricesData.csv` is the real
exercise at 18,466 rows and 1,452 lines carrying quoted fields with commas
inside. It also proves the allow-list refuses both hand-authored files, that
each preflight fires on an injected fault, and that a byte-identical file is
skipped.

> **Line endings are two different shapes and the script knows it.** Google
> exports CRLF; the repository stores **LF**, because `core.autocrlf` strips the
> CR on commit from a Windows checkout. The GitHub API writes raw bytes with no
> normalisation, so the script serialises to Google's shape and commits git's.
> Getting this wrong does not corrupt anything, but it would rewrite all eight
> files on the first publish and leave the diff permanently broken — a CRLF blob
> can never hash to the LF sha the repository carries, so nothing would ever be
> skipped again.

---

## Hardening the sheet

The workbook has no types. A `Price` cell will happily hold `-`, a formula
column will happily accept a typed-over number that then stops recalculating for
that one row, and `SUper Condensed` looks exactly like `Super Condensed` until
someone counts them. Every one of those has happened.

`apps-script/hardenSheet.gs` puts four guards in place, and **it is designed to
be re-run**: every season adds ~1,500 price rows and Phase 4 adds auctions, so a
one-time pass done by hand has a hole in it a few months later and nothing says
so. Running it again is safe and is how new columns get covered.

### Installing it (once)

Paste it into the same Apps Script project as the others, as a new file named
`hardenSheet`. Reload the sheet; the menu gains **Harden the sheet — dry run**
and **Harden the sheet — apply…**.

### Using it

1. **Dry run first, always.** It reports what it would change, what is already
   done, and what it will not touch. Nothing is written.
2. **Apply.** Validation and protection go on in one confirmation.
3. **Deleting the three dead named ranges is confirmed separately**, because it
   is the one step re-running the script cannot undo.

### What it does

| | |
|---|---|
| **Numeric-only validation on every price column** | `prices!Price`, `onyx!Price`, `rawPricesData!trentPrice` and the three in `offAuctionPrices`. This is the one that matters most: it makes the `-` class impossible. Six such rows existed before Phase 0, every one a real sale recorded as if it had not happened. |
| **Whole-number validation on counts** | `contextItems!quantity`, `auctionMetadata!auctionNumber`. |
| **Protection on every formula column** | 12 of them, including `auctionMetadata`'s seven. Set to **warn, not block** — you can still override deliberately, you just cannot do it by accident. |
| **Dropdowns on the vocabulary columns** | `auctionStyle` and `completionStyle` warn only, because those vocabularies genuinely grow; `augmentated` and `contextItems!category` reject, because those sets cannot. |
| **Deletes three dead named ranges** | `trentAuctionData` and `NamedRange1` are silently truncated by thousands of rows; `categories` points at `#REF!`. Unused is not the hazard — **unused *and wrong* is**. Reach for `trentAuctionData` and you get an answer over 71% of the data with no error. `auctionList`, `tokenDisplayNames` and `onyxPriceTable` are also unused, are whole-column and correct, and are left alone. |

### What it does NOT do

**A paste bypasses data validation entirely, and every routine update to this
workbook is a paste.** That is not a flaw in the script, it is what Sheets
validation is. So there are two layers and neither is sufficient alone:

- **This script catches typing** — the wrong thing entered by hand, at the
  moment it is entered.
- **`npm run validate` § 7 catches pasting** — the same vocabularies re-checked
  at the PR, which is the gate nothing gets past. It errors on a value differing
  from an existing one only by case or spacing (`SUper Condensed`) and on a
  `Category` no `tokenMetadata` row carries, while letting a genuinely new
  auction style through with a note.
- **`npm run validate` § 8 catches one item spelled two ways.**
  `contextItems.Item` is free text — it has to be, since an augment can be any
  token ever printed — but two spellings are two series, each with half the
  history. It folds case, spacing and the curly apostrophe, then folds again to
  alphanumerics with a trailing plural stripped, and it looks at
  `tokenMetadata`, `onyx` and `prices` as well as `contextItems`, because the
  split usually straddles files: `Figurine of Power Phoenix` is a context row
  while `Figurine of Power: Phoenix` is an Onyx one.

  **Everything here is a NOTE, never an error**, and deliberately so — merging
  is a judgement a human has to make. `+1 Turkey Leg` and
  `+1 Turkey Leg of Smiting` are genuinely different tokens whose names contain
  one another, and collapsing that pair would merge 87 lots of 2022 into one
  price series. It is also why a pre-existing split does not block a publish:
  the four it currently reports are real defects in shipped data that want
  fixing **in the workbook**, not in the repo.

Cells also remain untyped underneath, and the four "plausible wrong number"
defect classes — a price that is real but wrong — are untouched by any of this.
Hardening is not a type system.

### Things it deliberately leaves to you

- **A column that is half formula and half typed.** `contextItems!priceAugmented`
  is the known one: withheld rows are a `QUERY`, token and grunnel rows are
  hand-entered. It is reported and not touched, because protecting it would lock
  cells you have to edit and leaving it open lets someone overwrite a formula.
- **Repointing a fixed-bound named range.** It reports one and tells you why,
  but widening a range that feeds a `QUERY` is not something a script should do
  unasked — `auctionFullData` was repointed by hand in August 2026 for exactly
  that reason, and verified inert by comparing 12 withheld groups against their
  pre-change values.

### Changing the script

`apps-script/hardenSheet.gs` in the repo is the source of truth. Edit it here,
**bump `HARDEN_VERSION`**, run `npm run test:harden`, then paste it over. The
test stands a workbook up from the shipped CSVs and asserts, among other things,
that **every value the data actually holds is offered by its dropdown** — a list
that has drifted from the CSVs is a dropdown that rejects a real value, and
nothing else in the repo compares the two.

---

## Which file do I need?

| I want to… | File |
|---|---|
| Add a new auction, or mark one closed | [`auctionMetadata.csv`](#auctionmetadatacsv) |
| Add the token sale results from an auction | [`prices.csv`](#pricescsv) |
| Add Onyx chase-token sale results | [`onyx.csv`](#onyxcsv) |
| Add a new season's tokens, or fix a token's name/class | [`tokenMetadata.csv`](#tokenmetadatacsv) |
| Add or change a transmute recipe | [`transmuteRecipes.csv`](#transmuterecipescsv) |
| Price something never sold at auction (Golden Fleece, etc.) | [`offAuctionPrices.csv`](#offauctionpricescsv) |
| Change chart groupings or line colours | [`tokenGroups.csv`](#hand-authored-files) |
| Rename the 8k bonus set for a new run of seasons | [`src/lib/eras.ts`](#tokengroupscsv) (not a data file) |
| Change how a reward-only token is priced | [`derivedPrices.csv`](#hand-authored-files) |
| Record a withheld / augment / grunnel item for an auction | [`contextItems.csv`](#contextitemscsv) |
| Refresh the per-lot sale data behind the Quartiles view | [`rawPricesData.csv`](#rawpricesdatacsv) |

A new auction with results typically means **two** files:
`auctionMetadata.csv` (the auction itself) and `prices.csv` (what sold in it).
Export and place both, then validate once.

---

## Shared rules

These apply to every exported file.

**Column names are load-bearing.** Every file uses the same vocabulary:

| concept | column |
|---|---|
| the token, by its stable internal name | `Item` |
| the season | `auctionSeason` (`Year` in the recipe and off-auction tables) |
| the token's public name that season | `Display Name` |
| the token's class | `Category` |

Rename a column header in the sheet and the site stops reading it. `npm run
validate` catches this and names the exact column, but only if you run it.

**`Item` vs `Display Name`.** `Item` is the stable internal handle that never
changes across seasons — `1k Bonus`, `PYP`, `Dwarven Steel`. `Display Name` is
the public token name for that particular season — `Ring of the 1st Circle`.
Everything joins on `Item`. Always write `Item` values exactly as they already
appear; a typo creates a new, unrecognised token rather than an error.

**`Category` must be one of:** `Trade 1`, `Trade 2`, `Ultra Rare`, `Premium`,
`Bonus`, `Preorder`, `Golden Ticket`, `Condensed`, `Safehold` — plus
`Onyx Ultra Rare` (only in `onyx.csv`) and `Golden Fleece`, `Treasure Chest`,
`Participation`, `Silver Ship Games`, `Legendary`, `Relic` (only in
`tokenMetadata.csv`, for tokens never sold at auction). `Trade Good` and `Patron`
are retired — do not reintroduce them.

**Blank rows are fine.** Rows without an `auctionId` (or without the required
key for that file) are dropped on load.

**Currency formatting is fine.** `$110.00` and `1,160.00` both parse; `$` and
thousands separators are stripped.

---

# The files

Each section follows the same shape: what it drives, when to touch it, its
columns, and the rules that will bite you.

---

## `auctionMetadata.csv`

**Export from:** the `auctionMetadata` tab → save as `auctionMetadata.csv`

**Drives:** the auction count on the Prices page, the season list, the
"Last 5" date labels, the whole **Auction Data** explorer — which shows each
auction's name, close date, style, completion style, auctioneer and forum link —
and the whole **Analytics** page, which is built on this file alone (plus the
price feeds for the one token-price panel). It does **not** contain any prices.

**Update when:** a new auction opens, an auction closes, or an auction's details
change.

> **You do not have to type the "opens" half.**
> [Watching for new auctions](#watching-for-new-auctions) proposes the row —
> number, id, open date, auctioneer and link — from Trent's page and the forum,
> and appends the ones you approve without disturbing the formula columns.

### Columns

| Column | Required | Notes |
|---|---|---|
| `auctionId` | **Yes** | Season + auction number, concatenated: season `2026`, auction `47` → `202647`. Must be unique. Rows without it are dropped. |
| `auctionSeason` | **Yes** | Four-digit year, e.g. `2026`. |
| `auctionNumber` | **Yes** | Sequence within the season, e.g. `47`. |
| `auctionName` | **Yes** | Free text, shown to users. May contain commas — the sheet quotes them correctly on export. |
| `Status` | **Yes** | **Derived, not typed.** The sheet computes it as `IF(closeDate = "", "Open", "Closed")`, so it is `Open` exactly while `closeDate` is empty and `Closed` once you fill it in. **`Failed` cannot be produced by that formula** — see the rules below. All 289 rows read `Closed` today. |
| `closeDate` | **Yes** | ISO `YYYY-MM-DD`, **zero-padded**. Populated on **all 289 rows** — none blank, none `n/a`. Because `Status` keys off this column, clearing it is what makes an auction show as live. See the padding warning below. |
| `auctioneer` | Optional | Who ran it. Shown on the explorer and offered as a filter there. |
| `auctionStyle` | Optional | e.g. `Ultra Condensed`, `Super Condensed`, `Onyx Super Condensed`. Shown on the explorer. |
| `completionStyle` | Optional | How the auction closed: `Lightning`, `Semi-Lightning`, `Fixed Date`. Shown on the explorer. |
| `Link` | Optional | URL to the original forum thread; the "Auction link" on the explorer's expanded cards and, always visible, on the open-auctions banner/section. Fill it in especially for any `Open` auction — it's the whole point of surfacing a live auction. |
| `openDate` | Optional | ISO `YYYY-MM-DD`, **zero-padded** like `closeDate`. Drives the **Analytics** page's Current Year panels — auctions are grouped and ordered by it — and the **open-auctions** cards' "opened N days ago" line. **Populated on all 289 rows** since the backfill. |
| `daysToClose` | Optional | Whole days the auction ran, computed as `MAX(closeDate - openDate, 1)` — the floor of `1` is why same-day auctions read `1`, not `0`. Drives the Analytics days-to-close chart and every "avg days to close" figure; a row that isn't a number is **left out of those averages**, not counted as zero. **Populated on all 289 rows** — none blank, none `n/a`, so the averages cover every auction. Four rows read `n/a` until 2026-08-20, when their formulas were repaired: each had lost its `closeDate` reference and evaluated to `#REF!`, which the surrounding `IFERROR` quietly turned into `n/a`. Worth knowing as a failure shape — a broken reference here degrades to a plausible-looking string rather than an error. |
| `Open Month`, `Close Month` | Optional | **Season** months, `1`–`13` — month 1 is the season's first month (≈ September of the previous calendar year), *not* a calendar month. The Analytics month accordions and the prior-year comparisons key on these, which is what lets two seasons line up by how far into the season they are. **Populated on every season back to 2018.** They are derived from `openDate`/`closeDate`, so a wrong date shows up here as an out-of-range month — see the gotcha below. |
| `targetFunding`, `augment*`, `fundingNoAugment`, `preorderTotal` | No | Back-office financials, not surfaced directly (they feed Analytics → Funding & Context). Present for 2018–2021 and 2023–2026; **the whole 2022 season is still blank — backfill queued for the next round of updates.** |

### Rules that matter

- **Only `Status = Closed` auctions are counted.** Anything else is loaded but
  excluded from every count and statistic. **Today that is every row: all 289
  are `Closed`, and there are no `Open` or `Failed` rows at all.**
- **`Failed` is not a value you can set.** `Status` is the formula
  `IF(closeDate = "", "Open", "Closed")`, which can only ever produce those two
  strings. A failed auction is therefore **deleted** rather than marked, which
  is why `auctionNumber` sequences have permanent gaps — `202518`, `202525`,
  `202531`, `20263` and `202638` are the known ones. A gap is expected; a
  *duplicate* number is not.
  > The site treats `Failed` identically to any non-`Closed` row, so nothing
  > renders differently either way. Recording failures instead of deleting them
  > would need a separate flag column feeding
  > `IF(failed, "Failed", IF(closeDate = "", "Open", "Closed"))`.
- **`Open` auctions are surfaced separately** by the live "open auctions" banner
  (top of Prices) and the "Open auctions" section (top of Auction Data). Both
  read `Status = Open` directly and are independent of every page filter. Since
  `Status` is derived, **an auction is live exactly while `closeDate` is empty**
  — fill that column in and it stops showing as open.
- **`closeDate` drives the "Last 5" labels.** The Prices page shows the five most
  recent auctions in a season by date. A missing or wrong `closeDate` puts the
  window in the wrong place.
- **`closeDate` must be zero-padded, and fails silently if it isn't.** The site
  only recognises `YYYY-MM-DD`; a value like `2024-8-13` is treated as *no date
  at all*, so the auction sorts as undated and renders "unknown" rather than
  showing an obviously wrong date. Five rows were in this state until the
  2026-07-22 export. If an auction claims to have no close date, check the
  padding before assuming the cell is empty.
- **`auctionId` is the join key** to `prices.csv` and `onyx.csv`. A sale whose
  `auctionId` has no row here still loads, but the auction has no name or date.
- **Every season now carries dates.** Before 2026-08-14 the timing columns only
  existed from 2022 on, and the Analytics Current Year view excluded the earlier
  seasons for that reason. All nine seasons (2018–2026) are now dated, so
  `seasonsWithCadence()` admits every one of them.

### `Expires` — when a recipe stops being craftable

This is what decides whether a recipe is priced at **today's** prices or over
the window it could actually be built in, so it is worth understanding even
though you rarely have to type it.

| Value | Means |
|---|---|
| *blank* | The standard rule: **Dec 1 of `Year` + 1**. For a `Legendary`, `Mythic` or `Safehold` the code defaults to `never` instead, because the game does not retire those. |
| `never` | Never expires. Only needed to override the standard rule on a level that is not already defaulted. |
| `2027-03-01` | An explicit exception. Ioun Stone Mystic Orb (expired the following March) and Mark of Enlightenment (a one-year window) are the two known cases. |

**Why it matters:** a recipe you can still craft is priced at today's prices,
because that is what building it now would cost. An expired one is priced over
the range from its debut season's first auction to its expiry, minus a 7-day
shipping cutoff — a win inside that last week could not ship in time to craft.
Get `Expires` wrong and the recipe is quoted on the wrong basis entirely, which
is why the validator checks it:

- `expires-conflict` (ERROR) — rows of one recipe disagree. It is one value per
  recipe; filling the column down with different values is the failure mode.
- `expires-format` (ERROR) — not blank, `never`, or `YYYY-MM-DD`.
- `expires-range` (ERROR) — the date precedes the recipe's own season.
- `expires` (INFO) — reports every authored exception, so a typo you *can*
  parse still shows up in the output.

### `IngredientType` — naming a specific Ultra Rare

Auctions sell "an Ultra Rare" (`PYP`) rather than a named one, so a recipe
line has always had to say `Ultra Rare` even when the recipe wants a specific
token. With this column the line can name the real thing:

```
Item = "Ymir's Bane"      IngredientType = "Ultra Rare"
```

The site shows the name you typed and prices it as the tier, because the
specific token has no sales of its own. Nothing about the cost changes — this
tells a player *what to go buy*, which the generic line could not.

Use a value from the existing `Category` vocabulary (`Ultra Rare`, `Trade 1`,
`Premium`, …); the validator's `ingredient-type` WARN lists the valid set if you
miss. A named token that is not in `tokenMetadata.csv` is fine here — it reports
as a `tier-priced` INFO rather than the usual `unknown-good` ERROR, precisely so
that authoring this column can never break a sheet that was passing.

### Gotcha

Marking an auction closed is **two** edits: set `Status` to `Closed` *and* fill
in `closeDate`. Setting only one leaves the auction uncounted or unlabelled.

**A wrong year in `openDate` hides as a huge `Open Month`.** Season months are
computed from the date, so a 2021 auction dated `2025-05-26` becomes
`Open Month 56` and renders as its own bogus accordion group in Analytics.
Auction 202112 was in exactly this state until 2026-08-14. **Anything outside
`1`–`13` is a typo in the date, not a real month** — scan that column after any
date edit, since nothing validates this file.

Listing a **live** auction is the mirror: **leave `closeDate` empty** and fill in
`Link` and `openDate`. Do not try to type `Open` into `Status` — that column is a
formula and will overwrite you; an empty `closeDate` is what makes the auction
live. The open-auctions banner/section shows the name as a link and an "opened N
days ago" line, so `Link` and `openDate` are what make the listing useful. When
it ends, fill in `closeDate` and `Status` flips to `Closed` on its own.

---

## `prices.csv`

**Export from:** the `prices` tab → save as `prices.csv`

> Not `auctionPricesOLD` — that is a retired copy that still recalculates. Check
> the tab name before you download.

**Drives:** the Prices page, Timelines, Compare Years, and every build cost on
the Transmutes page. This is the single most important file.

**Update when:** an auction closes and you have its results. 7,752 rows today,
seasons 2018–2026 (2018 arrived with the 2026-08-14 backfill and is now the
earliest priced season — every pre-2018 recipe falls back to it).

> For a **Trent** auction these rows are written by the importer — see
> [Importing a Trent close](#importing-a-trent-close). Forum auctions are still
> entered by hand.

### Columns

| Column | Required | Notes |
|---|---|---|
| `auctionId` | **Yes** | Must match a row in `auctionMetadata.csv`. Rows without it are dropped. |
| `auctionSeason` | **Yes** | Four-digit year. |
| `auctionNumber` | **Yes** | Sequence within the season. |
| `Item` | **Yes** | The stable internal name. Must match existing spelling exactly. |
| `Price` | **Yes** | The sale price. Must parse as a number — `$` and commas are stripped. Rows with a non-numeric price are dropped. |
| `Display Name` | **Yes** | The token's public name that season. |
| `Category` | **Yes** | See the shared list above. |

### Rules that matter

- **One row per sale, not per token.** A token selling three times in one
  auction is three rows. Timelines average them into a single point per auction.
- **`Price` must be numeric — always.** There is **no** no-sale marker. Six rows
  once carried a `-`, which looked like one; every one turned out to be a
  copy/paste artifact from the pivot table, and all six had real sales behind
  them. They were corrected on 2026-08-20 and **no non-numeric price remains**.
  If you see a `-`, treat it as a transcription bug and go back to the source,
  not as "this didn't sell". The loader silently drops such rows, so a stray one
  costs you a sale with no warning.
- **This file is the source of truth for `Display Name` and `Category`.** If it
  disagrees with `tokenMetadata.csv`, `prices.csv` wins and `tokenMetadata`
  should be corrected to match.

### Gotcha

Adding sales for a brand-new token means updating `tokenMetadata.csv` too, or
the Transmutes page can't resolve it. The validator will tell you.

---

## `rawPricesData.csv`

**Export from:** the `rawPricesData` tab → save as **`rawPricesData.csv`**.
The rows are written by the importer — see
[Importing a Trent close](#importing-a-trent-close); the pivot table that used
to produce them is retired.

**Drives:** the Analytics → **Quartiles** view *only*. Nothing else reads it, so
a stale or missing file affects that one view and no other page.

**Update when:** you have refreshed per-lot results. ~18,000 rows today. Unlike
`prices.csv` (which keeps only each auction's high/low points), this is **every
individual lot**, which is what makes the box plots and quartile tables
possible. Seasons 2023 on.

> **It is no longer Trent-only.** 110 of the 111 auctions here are Trent's; the
> 111th, `202647`, is alesiev's **forum** auction — the first non-Trent
> auctioneer to supply per-lot data. Expect more of these, and don't assume a
> row in this file means the Trent runbook applies to it.

### Columns

| Column | Required | Notes |
|---|---|---|
| `auctionSeason` | **Yes** | Four-digit year. Drives the Quartiles year selector. |
| `Item` | **Yes** | The stable internal name — must match the `Item` spelling used in `prices.csv` / `tokenGroups.csv`, or the token won't join a chart group. |
| `Price` | **Yes** | The **per-unit** sale price (a 10× lot's `trentPrice` ÷ 10). `$` and commas are stripped; `$0.00` and non-numeric rows are dropped as unsold/placeholder. |
| `Category` | **Yes** | See the shared list above. |
| `auctionId`, `auctionNumber`, `trentName`, `trentPrice` | No | Present for the sheet's own max/min pivots; the site ignores them. |

### Rules that matter

- **One row per lot.** A token sold 40 times in an auction is 40 rows — that
  volume is the point. The Quartiles view summarises each year's lots per token.
- **`Item` must match `tokenGroups.csv`.** Tokens are grouped exactly as on
  Timelines. A token present here but absent from the grouping file falls under
  the view's "not charted" note; a typo'd grouping entry whose category *is* in
  this file shows a red "unmatched" warning.
- **`$0.00` lots are excluded** from the quartile math (unsold/placeholder lots);
  keeping them would pin every whisker to $0.

### Gotcha

The `Category` values `Golden Ticket`, `Condensed`, and `Safehold` never appear
in this file (Trent doesn't auction those per-lot), so grouped tokens in those
categories are silently skipped here — that is expected, not an error.

---

## `onyx.csv`

**Export from:** the `onyx` tab → save as `onyx.csv`

**Drives:** the **Onyx** and **All** views of the Prices page (toggle at the top).
It is loaded independently — if this file is missing or empty, those views are
blank and nothing else is affected.

**Update when:** an Onyx chase token sells. 1,011 rows today, seasons 2018–2026,
across 48 auctions and 141 chase tokens. For a **Trent** auction the rows are
written by the importer — Trent's close file carries the Onyx lots inline. See
[Importing a Trent close](#importing-a-trent-close).

> **Every row must carry a price.** A blank one is not "unsold" — the parser
> drops it silently, so it moves no statistic and the site looks healthy. 42
> such rows sat here for months. A genuine no-sale is recorded by writing **no
> row at all**, and `npm run validate` now errors on a blank.

### Columns

Identical to `prices.csv` — same seven columns, same rules, parsed by the same
code.

| Column | Required | Notes |
|---|---|---|
| `auctionId`, `auctionSeason`, `auctionNumber` | **Yes** | As in `prices.csv`. |
| `Item` | **Yes** | The chase token, e.g. `+2 Chaos Cannon`. |
| `Price` | **Yes** | This export writes prices as `$110.00 ` with a dollar sign and trailing space. That's fine — both are stripped. |
| `Display Name` | **Yes** | Usually the same as `Item` here. |
| `Category` | **Yes** | Always `Onyx Ultra Rare`. |

### Gotcha

Onyx sales go **only** here, never in `prices.csv`. Putting them in both
double-counts them.

---

## `tokenMetadata.csv`

**Export from:** the `tokenMetadata` tab → save as `tokenMetadata.csv`

**Drives:** the Transmutes page — it's how a recipe ingredient resolves to a real
token with a name, a class and a price. It also covers seasons that have no
auction data at all (2012–2017, 2027), which is why it has rows `prices.csv`
doesn't.

**Update when:** a new season's tokens are announced, a token's display name or
class changes, or the validator reports an unresolvable ingredient. 443 rows
today, seasons 2012–2027 — one row per (season, token), no duplicates (25
duplicated 2027 keys were removed on 2026-08-14).

### Columns

| Column | Required | Notes |
|---|---|---|
| `key` | For authoring | `auctionSeason` and `Item` concatenated with nothing between: `2026` + `PYP` → `2026PYP`. The site ignores it; the recipe sheet's lookup formula depends on it. |
| `auctionSeason` | **Yes** | Four-digit year. Rows with a non-numeric value are dropped. |
| `Item` | **Yes** | The stable internal name. Rows without it are dropped. |
| `Display Name` | **Yes** | That season's public name. Falls back to `Item` if blank. |
| `Category` | **Yes** | See the shared list. This file also carries classes that never appear in `prices.csv`, for never-auctioned or reward-only tokens: `Golden Fleece`, `Treasure Chest`, `Participation`, `Silver Ship Games`, `Legendary`, `Relic`. |

### Rules that matter

- **One row per (season, token).** The same token gets a separate row for every
  season it exists in, because its display name changes.
- **It must agree with `prices.csv`** on `Display Name` and `Category` for every
  season that has auction data. `prices.csv` wins any disagreement. The validator
  does not currently check this automatically — it was reconciled by hand.
- **A token's `Category` shouldn't vary by season** unless it genuinely was
  reclassified. `Trade 1` / `Trade 2` in particular is a property of the token,
  so it should be the same in every row for that `Item`.
- **`key` must stay consistent** with `auctionSeason` + `Item`. The validator
  checks this.

### Gotcha

This file legitimately contains tokens that were never auctioned — Monster
Trophy, Golden Fleece, Rare Bag. They're recipe ingredients priced through
`offAuctionPrices.csv` or `derivedPrices.csv`. Don't delete them for having no
sales.

---

## `transmuteRecipes.csv`

**Export from:** the `transmuteRecipes` tab → save as `transmuteRecipes.csv`

**Drives:** the entire Transmutes page — every bill of materials and build cost.
1,954 rows covering 174 recipes across 16 seasons (2012–2027), 53 of them
`IsSource` lines. As of 2026-08-15 that splits 91 still craftable / 71 expired /
12 preview, which is what decides how each one is priced.

**Update when:** a new transmute is announced, or a recipe changes.

> This is the most intricate file. A dedicated authoring guide with the sheet
> formulas lives in
> [`transmute-recipes-template.md`](transmute-recipes-template.md) — read it
> before adding recipes. The summary below is for orientation.

### Columns

| Col | Column | Kind | Notes |
|---|---|---|---|
| A | `Key` | formula | `Year|Transmute|Item|ItemYear|IsSource`, pipe-separated. Must be unique. The site ignores it; the validator checks it. |
| B | `Year` | **you type** | The season the *transmute* belongs to. Not the ingredient's season. |
| C | `Level` | **you type** | Tier: `Enhanced`, `Exalted`, `Relic`, `Legendary`, `Arcanum`, `Paragon`, `Mythic`, `Eldritch`, `Omni`, `Safehold`, `Patron`. |
| D | `Transmute` | **you type** | The token being produced. |
| E | `Item` | **you type** | One ingredient, by its `Item` name. |
| F | `ItemYear` | **you type** | The ingredient's season. Blank = same as `Year`. |
| G | `ResolvedYear` | formula | What `ItemYear` resolves to. A read-only sanity check; the site re-derives it. |
| H | `Display Name` | formula | The ingredient's name that season. For your eyes — the site re-derives it. |
| I | `Quantity` | **you type** | How many. Always a whole number, never 0. |
| J | `IsSource` | **you type** | `TRUE` = the token being upgraded *from*; `FALSE` = a consumed ingredient. |
| K | `Expires` | **optional** | When the recipe stops being craftable. Blank = the standard rule. One value per recipe. |
| L | `IngredientType` | **optional** | The ingredient's tier, from the `Category` vocabulary. Lets a line name a *specific* Ultra Rare. |

> **Both new columns are optional and the file is valid without them.** The
> engine defaults every one, so the site is correct before you touch the sheet;
> authoring them only adds precision. Add them at the end of the row — column
> order does not matter, the header does.

### Rules that matter

- **One row per ingredient.** A recipe with 15 ingredients is 15 rows sharing the
  same `Year` and `Transmute`.
- **`ItemYear` is usually a relative offset.** `-1` means one season before this
  recipe's `Year`, permanently — it does not shift as time passes. Blank is the
  common case. A bare year like `2019` pins it absolutely. Prefer relative, so
  next season's recipes are a copy-and-bump.
- **`Quantity` is always a whole number.** Any decimal is a typo by definition,
  and validation will catch it.
- **The site ignores `Key`, `ResolvedYear` and `Display Name`** and recomputes
  all three, deliberately — a stale formula in the sheet can never corrupt the
  site. But they are what tell *you* whether a row is right, so keep the formulas
  filled down.
- **`Display Name` showing `⚠ check name`** means the `Item` doesn't resolve.
  Fix it before exporting.
- **Every Legendary needs exactly one source line.** A Legendary is forged by
  upgrading a relic, so it must carry one `IsSource=TRUE` row naming that relic
  (its build cost is dominated by it). The validator errors (`legendary-source`)
  if a Legendary has none. The rare Legendary genuinely built from raw materials
  — an alternate `Recipe N` variant, or the Golem-piece totem — is exempted by an
  explicit allowlist (`RAW_BUILT_LEGENDARIES`) in `scripts/validate-recipes.mjs`;
  add to it when you author another raw-built Legendary.
- **At most one `IsSource=TRUE` per recipe.** Filling the column down a whole
  recipe marks every ingredient as the upgrade-from token, which wrecks the
  Build-vs-Upgrade split on that row. The validator's `multi-source` WARN catches
  it — this is exactly what caught `2014 Ring of Greater Focus` (8 source lines)
  and `2016 Blessed Redoubt Plate` (13), both fixed 2026-08-14.

### Gotcha

An ingredient can be another transmute (an upgrade ladder). Write its exact name
in the `Transmute` column vocabulary and the engine recurses into that recipe.
The `IsSource` flag is what makes the "I already own this" toggle work.

---

## `offAuctionPrices.csv`

**Export from:** the `offAuctionPrices` tab → save as `offAuctionPrices.csv`
(note the name change)

**Drives:** prices for tokens that exist as recipe ingredients but are never sold
at auction — Golden Fleece, Stalker Token, Herald Token. Only 10 rows.

**Update when:** the going rate for one of these changes, or a new never-auctioned
ingredient appears.

### Columns

| Column | Required | Notes |
|---|---|---|
| `Key` | For authoring | `Year` + `Item` concatenated: `2019Golden Fleece`. |
| `Year` | **Yes** | Four-digit season. |
| `Category` | **Yes** | The token's class; must match `tokenMetadata` for the same `Item` (e.g. `Golden Fleece`). |
| `Item` | **Yes** | The token. Rows without it are dropped. |
| `Display Name` | **Yes** | The public name; falls back to `Item` if blank. |
| `max Price` | Optional | Falls back to `avg Price` if blank. |
| `avg Price` | **Yes** | Must be numeric — rows without it are dropped. |
| `min Price` | Optional | Falls back to `avg Price` if blank. |

### Rules that matter

- **One row per (season, token).** Add a row per season, as with
  `tokenMetadata.csv`.
- **These are hand-maintained estimates**, not observed sales. The site marks
  them "non-auction item" in a bill of materials and reports a sale count of
  zero.
- **This table overrides derived pricing.** If a token is priced both here and by
  a rule in `derivedPrices.csv`, this file wins.

### Gotcha

The `Item` (canonical name) is `Golden Fleece`, matching the `Display Name`.
Recipes must reference `Golden Fleece`.

---

## `contextItems.csv`

**Export from:** the `contextItems` tab → save as `contextItems.csv` (note the
name change). Only columns A–G are used.

**Drives:** the auction context layer (item provenance + the withheld estimate).
Loaded independently — if this file is missing or empty, the context layer is
empty and nothing else is affected. See
[`context-layer-design.md`](./context-layer-design.md).

**Update when:** an auctioneer withholds, augments, or has Grunnel items in an
auction. 641 rows today across 61 auctions. Coverage is **not** contiguous:
seasons 2023–2026 are the fully-recorded ones, plus a backfilled tail —
2018 (2 `withheld`), 2020 (33 `token`), 2021 (50 `token`). 2019 and 2022 have no
rows at all. `augment`-category rows exist only in 2026.

### Columns

| Column | Required | Notes |
|---|---|---|
| `auctionId` | **Yes** | Must match a `Closed` auction in `auctionMetadata.csv`. Rows for non-Closed auctions are ignored (a failed auction withheld nothing). |
| `category` | **Yes** | One of `token`, `augment`, `grunnel`, `withheld`. `token`/`augment` are treated the same (personal-collection augment), except items named as a Random Ultra Rare become `released-payment`. |
| `Item` | **Yes** | A **Display Name**, not the stable `Item` key — this is what the withheld estimate joins to `prices."Display Name"` on. Write it exactly as the token's public name appears in `prices.csv`. |
| `quantity` | **Yes** | Lot size. `priceAugmented` is the lot total, already ×quantity. |
| `priceAugmented` | **Yes** (except withheld) | Real value for `token`/`augment`/`grunnel`. For `withheld` it is **ignored** — the value is recomputed from live sales — so a stale or error value there is harmless. The one exception: if an item has *no* prior same-season sale, the recompute falls back to this number rather than silently showing $0. That does not occur in the current data. |

### Rules that matter

- **Random Ultra Rares must be named from the maintained list** in
  `src/lib/eras.ts` (`Random Ultra Rare`, `Ultra Rare`, `2025 Ultra Rare Set`, …).
  A new wording classifies as a personal augment until the list is updated; the
  context validator warns on Ultra-Rare-looking names that aren't listed.
- **`targetFunding` above $8,000** (in `auctionMetadata.csv`) is allowed but
  flagged by the validator as an exception, not an error.
- **A Golden Ticket recorded in both sheets is expected.** A released Golden
  Ticket (or Random Ultra Rare) sometimes appears both as a real sale in
  `prices.csv` and as a `released-payment` row here — it was the auctioneer's to
  keep, then sold. The Auction Data cards show it **once**: the real sale row
  wins (it carries the realised price and gets a "released" badge), and the
  duplicate context row is dropped from that card's Withheld & augmented list.
  This dedup is presentation-only — the Analytics *Funding & Context* ledger
  still counts the full context feed — so nothing here needs de-duplicating by
  hand.

### Gotcha

The tab labels a column `Item` but fills it with **display names**. Don't "fix"
that to canonical `Item` values — the join to sales is on the display name.

### After any re-export: regenerate the withheld preview

The withheld estimate is recomputed from live sales, so re-exporting
`prices.csv`, `auctionMetadata.csv`, or `contextItems.csv` legitimately moves
those figures. `docs/withheld-recompute-preview.csv` is the audited golden file
`validate-context.mjs` checks the recompute against, so a stale preview makes
`npm run validate` fail with a "row count differs" / "groups do not match"
error. When the numbers really changed (not a code bug), rebuild it:

```
node scripts/gen-withheld-preview.mjs
```

Eyeball the diff (the `delta` column shows how each estimate moved), then
`npm run validate` to confirm the recompute and the preview agree.

---

## Hand-authored files

These two have **no Google Sheet behind them**. Edit them directly in
`public/data/` and commit. They're listed for completeness.

> **The sheet publisher is forbidden from touching either.** They are named in
> `PUBLISH_NEVER` in `apps-script/publishToSite.gs` and absent from its
> allow-list, and `npm run test:publish` tries to sneak both past the guard on
> every run. Overwriting one is the only way this pipeline could destroy data
> that exists nowhere else — these files have no upstream to re-export from.

### `tokenGroups.csv`

Controls how tokens are grouped into charts on the Timelines page, and their line
colours. Columns: `Category`, `Item`, `Display Name`, `Group`, `Group Order`,
`Line Color`. Keyed on `Item`; `Display Name` here is an authoring aid the site
ignores. A group may span categories, so ordering uses the global `Group Order`.
Currently 28 rows.

**`Group` is a stable key, not the heading.** It joins tokens to a chart and
orders the charts; the heading a reader actually sees is resolved per season. Most
groups are named the same every year, so their key *is* their heading — but the 8k
bonus group (`8k Bonus Set`) is renamed every few years, because its tokens form a
set that later transmutes into a reward for the biggest spenders. Those names live
in `GROUP_SEASON_LABELS` in [`src/lib/eras.ts`](../src/lib/eras.ts):

| Seasons | Heading |
|---|---|
| 2015–2022 | Orb of Dragonkind |
| 2023–2026 | Path to Enlightenment |
| 2027–2029 | Codex of the Familiar |

Every page built on the grouping (Trends → Over a season, Analytics → Quartiles,
Analytics → Trent vs Forum) reads the resolved heading, so adding the next range
there updates them all at once. Rename the `Group` key in this CSV and the
per-season headings stop applying — the raw key shows instead, which is the signal
that the two need re-linking. A season past the last range falls back to the key
the same way, on purpose: it prompts someone to add the new name rather than
quietly showing a stale one.

### `derivedPrices.csv`

Rules for pricing a token off another token. Columns: `Token`, `DerivedFrom`,
`Ratio`, `Year`, `Bound`, `Note`. One rule today: Monster Trophy is priced as
Golden Fleece ÷ 10, as a ceiling, because ten Trophies make one Golden Fleece and
Trophies are never sold.

---

## Troubleshooting

### `npm run validate` reports a schema error

```
[ERROR] schema: tokenMetadata.csv: stale column "canonicalName" — rename it to "Item" in the source sheet
```

A column header in the sheet is wrong. The message names the exact fix. **Fix it
in the Google Sheet**, re-export, and re-validate — editing the CSV works until
the next export silently undoes it.

```
[ERROR] schema: transmuteRecipes.csv: column "DisplayName" should be "Display Name" — spelling differs only in spacing/case
```

Same thing, but the header differs only in spacing or capitalisation.

Schema errors stop the run before anything else is checked. That's deliberate —
a wrong header would otherwise produce thousands of meaningless follow-on errors.

### `[ERROR] unknown-good: "X" @ 2026 not in tokenMetadata / transmutes / fleece`

A recipe references an ingredient nothing can resolve. Either the `Item` is
misspelled in `transmuteRecipes`, or the token is missing from `tokenMetadata`
for that season. Add the row or fix the spelling.

### `[ERROR] key-formula` or `[ERROR] dup-key`

A sheet formula didn't fill down, or two rows produced the same key. Check the
`Key` column formula covers every row.

### `[ERROR] legendary-source: Legendary 2018|Pern's Redoubt Helm has no IsSource line`

A Legendary recipe is missing the `IsSource=TRUE` row that names the relic it
upgrades from — usually a re-export dropped the line, or its `IsSource` flag got
flipped to `FALSE` (which also shows as a `source-flag` warning). Add the source
line back, or set its flag to `TRUE`. If the Legendary is genuinely built from
raw materials with no upgrade-from token, add its `Year|Transmute` key to
`RAW_BUILT_LEGENDARIES` in `scripts/validate-recipes.mjs`.

### `[WARN] display-name: … != tokenMetadata …`

The recipe sheet's `Display Name` disagrees with `tokenMetadata`. Usually the
recipe sheet's lookup formula is stale — refill it.

### `prices.csv has [x, y] but its N lot(s) give [a, b]`

From check 1 of `validate-prices.mjs`. For season 2024 onwards, an item's rows in
`prices.csv` are the **min and max** of its per-lot rows in `rawPricesData.csv`
(a single row where every lot fetched the same price). The two files disagree, so
one of them was pasted from the wrong place — and `rawPricesData` is the one with
the receipts. Re-derive the summary from the lots.

Season 2023 is exempt: those fifteen auctions record a single averaged price
instead, so all the validator can say there is whether the number sits inside the
lot range, and it says it as a warning.

### `auctions X, Y have identical price blocks`

Check 2. Two auctions whose every item and every price agree to the cent — which
does not happen by chance across twenty items. One block was copied onto the
other; this is exactly what went wrong with `202510` and `20258`. Find the
auction whose own results were overwritten and re-export it.

### `$X / N = $Y but Price is $Z`

Check 3. In `rawPricesData.csv`, `Price` is the **per-token** price:
`trentPrice` divided by the quantity in the lot name. `10x Dwarven Steels #8` is
ten tokens; `1,000 GP Gold Bar x4 #1 (4 Tokens)` is four, *not* sixteen — the
`x4` and the `(4 Tokens)` are the same fact written twice. If the message instead
says **`lot size stated twice and they disagree`**, the lot name itself is
contradictory: check it against Trent's file rather than picking one.

### `has Price = blank` or `has Price = "-"`

Check 5. A keyed row in a price file with nothing to price. Both causes are
defects: `-` is a copy/paste artifact from the pivot table, and a blank is a
placeholder row created when the auction opened and never filled in.

**A blank does not mean "unsold."** The site's parser silently drops any row it
cannot price, so an unfilled block moves no statistic and looks perfectly healthy
— 42 empty rows sat in `onyx.csv` for months that way. A genuine no-sale is
recorded by emitting **no row at all**. Either fill the price in or delete
the row.

### `auctionStyle … says Onyx but onyx.csv has no rows` (or the reverse)

Check 6. The two must agree in both directions. Either the Onyx results were
never transcribed, or the style is wrong. Both directions were violated by 16
auctions before the 2026-08-21 backfill and by none after it, so a fresh
violation is a fresh mistake.

### `auctionStyle … is a Condensed order … but prices.csv has neither`

Check 6, and a **note** rather than an error, so it never blocks a publish.

A Condensed order — a style saying Condensed without *Super* or *Ultra* —
includes a `Rare Bag` (120 random Rares) and an `Uncommon Bag` (240 random
Uncommons). Five of the eight recorded Condensed auctions carry both rows;
**`20192`, `202111` and `20225` carry neither**, which is what this note is
telling you about.

It is a note because the disagreement can resolve either way. `20225` and
`202111` do sell bags in their threads, so those are missing rows. `20192`
sells none at all despite its style, so there the *style* may be what is wrong.
The check says which auctions to look at; it does not presume which side is
right.

### The build fails with `dist/data check FAILED`

You edited a file inside `dist/`. `dist/` is generated output and is overwritten
every build. Make the change in `public/data/` and rebuild.

### `node` or `npm` is not recognised

Node is installed but not on your `PATH`. Either add `C:\Program Files\nodejs` to
your `PATH`, or prefix the command for that terminal session:

```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

### git fails with `unable to unlink … Invalid argument`

The dev server is running and holding the CSVs open. Stop it (`Ctrl+C`) and retry.

### The live site doesn't show my change

In order of likelihood: the deploy hasn't finished (check the Actions tab); your
browser cached the old CSV (hard-reload with `Ctrl+Shift+R`); or you committed to
a branch and never merged it to `main`.

---

## Maintaining this document

This runbook hardcodes things that live in the repo, so it goes stale silently.
**Update it in the same commit** as any of these:

| If you change… | Update |
|---|---|
| a column name in any data file | that file's column table, and the shared vocabulary |
| a filename in `public/data/` | the per-file heading, the export/rename step, the routing table |
| an npm script name | the standard loop and troubleshooting |
| the deploy workflow | step 7 |
| a validator message | the troubleshooting section |
| a check in `validate-prices.mjs` | its case in `scripts/validate-prices.test.mjs` — that file injects one known defect per check and asserts the check reports it, so a check with no case is a check nobody proves still works. Run it with `npm run test:validators` |
| the set of standing warnings | the table in step 4 |
| `apps-script/trentClose.gs` | run `npm run test:trent`, update [Importing a Trent close](#importing-a-trent-close), and paste the file over the workbook's script editor — the repo copy is the source of truth, and the editor copy is downstream of it |
| `apps-script/publishToSite.gs` | run `npm run test:publish`, update [Publishing from the sheet](#publishing-from-the-sheet), bump `PUBLISH_SCRIPT_VERSION`, and paste the file over the workbook's editor |
| `apps-script/auctionOpen.gs` | run `npm run test:open`, update [Watching for new auctions](#watching-for-new-auctions), bump `OPEN_VERSION`, and paste the file over the workbook's editor |
| `apps-script/forumClose.gs` | run `npm run test:forum`, update [Importing a forum close from a file](#importing-a-forum-close-from-a-file), bump `FORUM_VERSION`, and paste the file over the workbook's editor |
| `apps-script/forumThread.gs` | run `npm run test:thread`, update [Reading a forum close from the thread](#reading-a-forum-close-from-the-thread), bump `THREAD_VERSION`, and paste the file over the workbook's editor |
| `apps-script/hardenSheet.gs` | run `npm run test:harden`, update [Hardening the sheet](#hardening-the-sheet), bump `HARDEN_VERSION`, and paste the file over the workbook's editor |
| **a formula column in `auctionMetadata`** | `OPEN_DERIVED_FIELDS` in `apps-script/auctionOpen.gs` if Phase 4 also computes a value for it, `OPEN_METADATA_FIELDS` if it does not. A column that becomes a formula and stays on the plain write list gets frozen on every new auction — which is what happened to `augmentated`. **Do not verify this arithmetically**: a formula whose output equals what a human would type agrees with a literal on every row, and that is exactly how `auctionId` and `augmentated` were missed for four months. Run `hardenSheet.gs`'s dry run instead — it classifies columns by reading formulas, not values |
| **which files are sheet-backed** | `PUBLISH_FILES` and `PUBLISH_NEVER` in `apps-script/publishToSite.gs`, plus [Hand-authored files](#hand-authored-files). The publish suite asserts the allow-list equals the CSVs on disk minus the hand-authored two, so adding a data file without updating the list fails `npm test` |
| the `Category` list | the shared rules section |
| which columns a parser reads | the Required column of that file's table |

The per-file sections are deliberately uniform — *what it drives, when to touch
it, columns, rules, gotcha*. Keep that shape when adding a file so the document
stays scannable.

**Verify before publishing changes to this file.** Every column table here was
checked against the actual CSV headers and against the parsers in
`src/lib/data.ts` and `src/lib/transmutes.ts`, not written from memory. Do the
same — a runbook that is confidently wrong is worse than none.

### Tab names

Verified against the workbook export of **2026-08-20**. Earlier versions of this
section inferred tab names from download filenames and got three of them wrong;
these are read from the workbook itself.

The full tab list is:

`auctionMetadata`, `prices`, `onyx`, `contextItems`, `tokenMetadata`,
`transmuteRecipes`, `offAuctionPrices`, `rawPricesData`, `trentNormalization`,
`startDates`, `canonical names`, `trentStaging` — plus `forumStaging` (added for
[the forum file importer](#importing-a-forum-close-from-a-file)) and two retired tabs,
**`auctionPricesOLD`** and **`transmutesOLD`**, which still recalculate and must
never be exported. **`auctionOpenReview`** joins them the first time
[the auction scan](#watching-for-new-auctions) runs; it is a working tab and is
never exported either.

`startDates` is the one to be careful with: `auctionMetadata`'s `Open Month` and
`Close Month` read a per-season start date from it, hard-coded per block of
rows. Nothing generates those references, so a new season needs its baseline
added there and the first row of the season pointed at it.

**Every tab now shares its name with the file it becomes**, so the only change
step 2 needs is stripping Google's `auctionData - ` prefix. That used to be
untrue of one tab: `pricesOnyx` had to be saved as `onyx.csv`, and the tab was
renamed to `onyx` on 2026-08-21 to remove the special case.

**Eight of those tabs are sheet-backed data files**; `trentNormalization`,
`startDates`, `canonical names` and `trentStaging` are working tabs the site
never reads, and `derivedPrices.csv` / `tokenGroups.csv` are the mirror case —
files with no tab. That eight-to-ten split is the mapping `PUBLISH_FILES`
encodes; see [Publishing from the sheet](#publishing-from-the-sheet).

If you rename a tab, the download name changes but the required filename in
`public/data/` does not — correct the "Export from" line here when that happens.
