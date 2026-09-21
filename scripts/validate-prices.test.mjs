// Mutation test for validate-prices.mjs.
//
// A validator that has never seen a defect is a validator nobody has tested.
// This copies public/data, injects exactly one known defect into the copy, and
// asserts the matching check reports it — one case per defect class the six
// checks exist to catch. The repo's own data is never written to.
//
// Cases are pinned to specific rows, so a re-export can move a target out from
// under one. That is why each case verifies its edit actually landed: a stale
// target reports STALE (fix the case), which is a different problem from
// MISSED (fix the validator).
//
// Run: node scripts/validate-prices.test.mjs

import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'public', 'data');
const SCRIPT = join(here, 'validate-prices.mjs');
const WORK = mkdtempSync(join(tmpdir(), 'validate-prices-'));
const TMP = join(WORK, 'data');

const run = () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--data', TMP], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const fresh = () => { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); cpSync(SRC, TMP, { recursive: true }); };
const lines = (t) => t.split('\n');
let touched = false;
const edit = (file, fn) => {
  const p = join(TMP, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) touched = true;
  writeFileSync(p, after);
};

// --- shape helpers ----------------------------------------------------------
//
// Two cases below need to reach a column by NAME rather than by position, and
// on this file that is not the same as splitting on commas: `targetFunding` and
// the augment rollups are quoted money ("$8,000.00"), so a data row splits into
// more fields than the header has. Counting from the END is exact, because
// every quoted column sits before the two these helpers touch.
//
// Written this way because DATA-6 adds a column. A case that says "the last
// field is preorderTotal" is not testing the validator, it is testing the
// current column count — and it goes red on the PUBLISH PR the day the workbook
// gains an eleventh input, which is where a red check is worst.
// These files are CRLF and `lines()` splits on \n, so every line here still
// carries its \r. It is not decoration: appending a column after it would bury
// a carriage return in the middle of a row. So each helper peels the \r off,
// works, and puts it back — which is also why none of them uses a bare
// `line + ',value'`.
const splitLine = (line) => {
  const cr = line.endsWith('\r');
  return { cells: (cr ? line.slice(0, -1) : line).split(','), cr };
};
const joinLine = ({ cells, cr }) => cells.join(',') + (cr ? '\r' : '');

const fieldFromEnd = (headerLine, name) => {
  const { cells } = splitLine(headerLine);
  const at = cells.indexOf(name);
  if (at === -1) throw new Error(`no ${name} column`);
  return cells.length - at;
};
const setFromEnd = (row, back, value) => {
  const parts = splitLine(row);
  parts.cells[parts.cells.length - back] = value;
  return joinLine(parts);
};

// `outcome` may or may not be in the export yet — it is DATA-6's new column and
// the workbook gains it independently of this repo. Either way it is LAST, so
// these two work on both shapes and neither leaves a ragged row behind.
const hasOutcome = (headerLine) => splitLine(headerLine).cells.includes('outcome');
const appendField = (line, value) => {
  const parts = splitLine(line);
  parts.cells.push(value);
  return joinLine(parts);
};
const withOutcomeColumn = (L) => (hasOutcome(L[0])
  ? L
  : [appendField(L[0], 'outcome'), ...L.slice(1).map((l) => appendField(l, ''))]);
const setOutcome = (row, value) => setFromEnd(row, 1, value);

// A whole new auctionMetadata row, built field by field off the LIVE header
// rather than typed out, so it stays correct however many columns the export
// has. Every value passed is one a human types; the formula columns are left
// empty on purpose, which is also what they look like in an export of a row
// that was never filled in.
//
// Several cases need a row that sold nothing — failed, open, pending — and
// none of them can be made by mutating a real auction: turning a recorded
// auction into one of those states would mean deleting its price rows too,
// which strands its rawPricesData lots and fires a different check. A fresh
// auction number in a season that has one free is the only edit that touches
// nothing else.
const addMetaRow = (values) => edit('auctionMetadata.csv', (t) => {
  const L = withOutcomeColumn(lines(t).filter((l) => l.trim() !== ''));
  const fields = splitLine(L[0]).cells.map((h) => values[h] ?? '');
  return [...L, fields.join(',')].join('\n') + '\n';
});

// [name, mutate, expected message, level] — level defaults to 'error', meaning
// the run must also exit non-zero. 'warn' cases must be reported and must NOT
// fail the run.
const cases = [
  ['1  min/max broken', () => edit('prices.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202642,2026,42,Aragonite,15,'));
    L[i] = L[i].replace(',Aragonite,15,', ',Aragonite,19,'); return L.join('\n');
  }), /prices\.csv has \[12\.59, 19\] but its .* lot\(s\) give \[12\.59, 15\]/],

  // Season 2023 is held to the same exact equality as every other season. It
  // was not until the 2026-09-02 backfill: those fifteen Trent auctions carried
  // one row per item, so this section only warned that the recorded price fell
  // inside the lot range, and nothing here exercised that branch at all. This
  // case is the one that would have been a WARN before and is an ERROR now.
  //
  // A one-lot item is deliberate — it pins the singleton half of the rule too,
  // where "one row" is correct and only its VALUE can be wrong. The injected
  // price is a sentinel and the lot count is a structural 1, so nothing here
  // is pinned to a number the workbook can legitimately republish.
  ['1  a season-2023 row that disagrees with its lot', () => edit('prices.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202314,2023,14,Wish Ring,'));
    const f = L[i].split(','); f[4] = '999999'; L[i] = f.join(',');
    return L.join('\n');
  }), /202314 "Wish Ring": prices\.csv has \[999999\] but its 1 eligible lot\(s\) give \[/],

  ['1  item dropped from prices.csv', () => edit('prices.csv', (t) =>
    lines(t).filter((l) => !l.startsWith('202642,2026,42,Aragonite,')).join('\n')),
    /202642 "Aragonite": 12 lot\(s\) in rawPricesData but no row in prices\.csv/, 'warn'],

  // The two halves of isBidFloorArtifact, pinned in both directions. Together
  // they say: an at-the-floor lot may not set the published min WHEN IT DIVIDES,
  // and must still set it when it does not.
  //
  // 20253 "Darkwood Plank (3 Tokens)" went for $0.25 — the opening bid — beside
  // eleven 10x lots at $0.83-$1.03, and published $0.08/token. Restoring that
  // $0.08 must fail: it is the floor divided by the lot size, not a price.
  ['1  a floor artifact published as the min', () => edit('prices.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith("20253,2025,3,Darkwood Plank,0.83,"));
    L[i] = L[i].replace(',Darkwood Plank,0.83,', ',Darkwood Plank,0.08,'); return L.join('\n');
  }), /20253 "Darkwood Plank": prices\.csv has \[0\.08, 1\.03\] but its 11 eligible lot\(s\) give \[0\.83, 1\.03\]/],

  // The mirror. 20245's Adventurers' Guild Button also closed a lot at $0.25,
  // but that lot held ONE token, so $0.25 is exactly what somebody paid and it
  // is still the min. Raising it to the next value — what a predicate that had
  // lost its `quantity > 1` clause would produce — must fail.
  ['1  a single-token floor lot is still eligible', () => edit('prices.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith("20245,2024,5,Adventurers' Guild Button,0.25,"));
    L[i] = L[i].replace(",Adventurers' Guild Button,0.25,", ",Adventurers' Guild Button,0.5,"); return L.join('\n');
  }), /20245 "Adventurers' Guild Button": prices\.csv has \[0\.5, 0\.75\] but its 4 eligible lot\(s\) give \[0\.25, 0\.75\]/],

  ['2  price block copied onto another auction', () => edit('prices.csv', (t) => {
    const L = lines(t);
    const donor = L.filter((l) => l.startsWith('202641,'));
    const kept = L.filter((l) => !l.startsWith('202642,'));
    return [...kept, ...donor.map((l) => l.replace(/^202641,2026,41,/, '202642,2026,42,'))].join('\n');
  }), /have identical price blocks/],

  ['3  a lot not divided down to its per-token price', () => edit('rawPricesData.csv', (t) =>
    t.replace('20253,2025,3,10x Dwarven Steels #8,$43.00,Dwarven Steel,$4.30,Trade 1',
              '20253,2025,3,10x Dwarven Steels #8,$43.00,Dwarven Steel,$43.00,Trade 1')),
    /\$43 \/ 10 = \$4\.3 but Price is \$43/],

  ['3  lot size stated twice, disagreeing', () => edit('rawPricesData.csv', (t) =>
    t.replace('"1,000 GP Gold Bar x4 #9 (4 Tokens)"', '"1,000 GP Gold Bar x2 #9 (4 Tokens)"')),
    /lot size stated twice and they disagree/],

  ['4  auctionId not season+number', () => edit('auctionMetadata.csv', (t) =>
    t.replace('\n202642,2026,42,', '\n202641,2026,42,')),
    /auctionId is not season\+number/],

  ['4  auctionNumber collision', () => edit('auctionMetadata.csv', (t) =>
    t.replace('\n202642,2026,42,', '\n202642,2026,41,')),
    /auctionNumber 41 used by/],

  ['4  unpadded date', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',2026-02-22,', ',2026-2-22,')),
    /is not zero-padded YYYY-MM-DD/],

  ['4  daysToClose disagrees with the dates', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202642,'));
    const c = L[i].split(','); const d = c.indexOf('Closed'); c[d - 1] = String(Number(c[d - 1]) + 3);
    L[i] = c.join(','); return L.join('\n');
  }), /daysToClose is \d+ but .* day\(s\)/],

  // § 4b exists because this column was wrong for years and nothing said so:
  // the chips-per-order multiplier stayed at its pre-2026 value after `prices`
  // was refactored to a per-chip figure, so every pre-2026 preorderTotal was a
  // third of the truth. Two cases, because the check has two anchors and only
  // one of them is the cell that was wrong.
  //
  // The metadata side. A sentinel, not an arithmetic near-miss: what is being
  // pinned is that the column is recomputed at all.
  ['4b preorderTotal that does not match its rows', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202642,'));
    L[i] = setFromEnd(L[i], fieldFromEnd(L[0], 'preorderTotal'), '$1.00');
    return L.join('\n');
  }), /202642 .*preorderTotal is \$1 but its rows give \$/],

  // The prices side, and a season-2026 auction so the 50-chip multiplier is
  // the one exercised — 48 is already covered by every other row in the file.
  // 202618 has no per-lot data, so this cannot also trip § 1 and leave the
  // case passing on the wrong check's output.
  ['4b a Treasure Chip price the preorderTotal no longer follows', () => edit('prices.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202618,2026,18,Treasure Chip,'));
    const c = L[i].split(','); c[4] = '9'; L[i] = c.join(',');
    return L.join('\n');
  }), /202618 .*preorderTotal is \$240 but its rows give \$.*Treasure Chip \$9 x 50/],

  ['5  a "-" price', () => edit('prices.csv', (t) =>
    t.replace('202642,2026,42,Aragonite,15,', '202642,2026,42,Aragonite,-,')),
    /has Price = "-"/],

  // A PRICE IS NOT ALWAYS DOLLAR-FORMATTED, and this case used to assume it
  // was. `,\$[\d.]+,` matched nothing the day onyx.csv exported as plain
  // numbers, so the edit silently landed on nothing and the case reported
  // STALE — which is the harness working, but it blocked a publish whose data
  // was correct.
  //
  // Both formats are live and always have been: `prices.csv` is plain in all
  // 7,767 of its rows, and 2020's 105 onyx rows were plain while the rest of
  // that file was not. `money()` strips `$` and `,` precisely because the
  // export's number formatting is not something this repo controls.
  //
  // So the field is cleared by POSITION rather than by shape — the fifth
  // column, whatever it holds — with the Item before it allowed to be quoted.
  ['5  a blank price', () => edit('onyx.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('20222,'));
    L[i] = L[i].replace(/^((?:[^,]*,){3}(?:"[^"]*"|[^,]*),)[^,]*/, '$1'); return L.join('\n');
  }), /has Price = blank/],

  // 5c is the check § 6's row-count warning was shaped around rather than
  // catching: 202219 held 40 rows and the warning called that "two sets".
  // § 5b. THE CHECK HAD NO CASE AT ALL until DATA-6 loosened it, which is the
  // worst moment to discover that: a check nobody has fired is a check nobody
  // knows still works. These two pin the loosening from both sides — the bug it
  // was written for still fails, and the state it was loosened FOR still passes.
  //
  // The bug: 20195's twenty rows were once re-keyed onto 20193, leaving 20195
  // with none, and the full validator passed. Deleting every price row for one
  // CLOSED auction is that shape exactly.
  ['5b a Closed auction that has lost every price row', () => edit('prices.csv', (t) =>
    lines(t).filter((l) => !l.startsWith('20181,2018,1,')).join('\n')),
    /20181 .* is in auctionMetadata but has NO rows in prices\.csv/],

  // And the states it was loosened for. An auction that has not finished sold
  // nothing and carries no price rows — correct data, not loss. Three of the
  // four `Status` values are in that position and each is pinned here.
  //
  // FAILED did not fund.
  ['5b a Failed auction with no price rows is legitimate', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction that did not fund',
    auctionStyle: 'Super Condensed', completionStyle: 'Fixed Date', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2018-10-01', Status: 'Failed', outcome: 'Failed',
    // Matched on the STATUS NAME, with the count left as \d+ AND nothing
    // assumed about what follows it. The summary lists every exempt status in
    // one line — "5 Failed, 3 Pending auction(s) correctly carry none" — so a
    // pattern ending `Failed auction\(s\)` quietly requires Failed to be the
    // LAST status named, which is a fact about the workbook's contents and not
    // about this check.
    //
    // It was written that way, and it went red on the first publish that
    // carried Pending rows (PR #191) — a case pinned to shipped data failing
    // on a publish PR, which is the worst place for a red check and the exact
    // trap the three of these were meant to avoid. The other two were already
    // written loosely; this one was not, and passed only because no Pending
    // row existed yet. What is asserted is that the summary names this status
    // with a count, nothing more.
  }), /\b\d+ Failed\b.*correctly carry none/, 'warn'],

  // OPEN is still taking bids. This state was NEVER exempt and nothing noticed:
  // the one Open row this data has carried (202647) was published on 2026-08-08,
  // before § 5b existed, so the two never ran together. The next open auction
  // would have failed the publish that carried it.
  ['5b an Open auction with no price rows is legitimate', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction still taking bids',
    auctionStyle: 'Super Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2018-10-01', Status: 'Open',
  }), /\b\d+ Open\b.*correctly carry none/, 'warn'],

  // PENDING has not started. Announced weeks ahead of a season's opening day,
  // so these rows sit in the export empty for all of that time.
  ['5b a Pending auction with no price rows is legitimate', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction announced but not yet open',
    auctionStyle: 'Super Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2099-10-01', Status: 'Pending', outcome: 'Pending',
  }), /\b\d+ Pending\b.*correctly carry none/, 'warn'],

  // ENDED has finished and has not been imported. This is the state § 5b
  // itself forced into existence: with only the four above, an auction whose
  // close file had not arrived could be `Open` — which advertises it as live on
  // the site — or `Closed`, which fails RIGHT HERE and blocks the publish. Two
  // real Trent auctions sat in that gap on 2026-09-19.
  //
  // It carries a closeDate, and that is the difference from every other case
  // here: the auction really did end on a date, and the date is what makes
  // clearing the outcome cell later a one-cell edit rather than two.
  ['5b an Ended auction with no price rows is legitimate', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction that closed before its results arrived',
    auctionStyle: 'Super Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2018-10-01', closeDate: '2018-10-09', daysToClose: '8',
    Status: 'Ended', outcome: 'Ended',
  }), /\b\d+ Ended\b.*correctly carry none/, 'warn'],

  // And the reminder that goes with it. An Ended row is invisible to every
  // statistic on the site, which is indistinguishable from an auction that
  // simply lost its rows — so the one thing that must not happen is for it to
  // go quiet. Nothing clears this cell by itself, unlike `Pending`, which the
  // site stops believing on its openDate.
  ['4  an Ended auction keeps saying it is waiting', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction that closed before its results arrived',
    auctionStyle: 'Super Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2018-10-01', closeDate: '2018-10-09', daysToClose: '8',
    Status: 'Ended', outcome: 'Ended',
  }), /outcome is "Ended" — it closed.*its results are not imported yet/, 'warn'],

  // The way out of the state, caught from the other side. Rows appearing under
  // an Ended auction mean the import landed and only the cell is left — the
  // opposite of what rows under a Failed or Pending auction mean, which is why
  // it does not get the shared "has sold nothing" sentence.
  ['5b an Ended auction that HAS price rows says to clear the cell', () => edit('auctionMetadata.csv', (t) => {
    const L = withOutcomeColumn(lines(t).filter((l) => l.trim() !== ''));
    return L.map((l, i) => (i > 0 && l.startsWith('20181,2018,1,')
      ? setOutcome(l.replace(',3,Closed,', ',3,Ended,'), 'Ended') : l)).join('\n') + '\n';
  }), /20181 .* is Ended but HAS rows in prices\.csv — the results have landed/, 'warn'],

  // `Ended` is hand-typed into `outcome` like the other two, so the same paste
  // defence applies: a Status that says it with a blank outcome is a value
  // typed over the formula, which the next recalculation silently undoes.
  ['4  Status says Ended but outcome is blank', () => edit('auctionMetadata.csv', (t) =>
    lines(t).map((l) => (l.startsWith('20181,2018,1,') ? l.replace(',3,Closed,', ',3,Ended,') : l)).join('\n')),
    /Status is "Ended" but outcome is blank/],

  // § 6, the other check the same loosening had to reach. `auctionStyle`
  // predicts an auction's CONTENT, and a pending auction has none yet — so an
  // Onyx-styled pending row with no onyx.csv rows is exactly right, and before
  // the loosening it was a hard ERROR that would have blocked the publish
  // carrying it. Not hypothetical: the auctionOpen fixture's two pre-announced
  // auctions are `Onyx Ultra Condensed` and open in the future.
  //
  // Asserted on the SUCCESS line rather than on an absence: "no error appeared"
  // passes just as well when the whole section has stopped running.
  //
  // The auction COUNT is deliberately `\d+` and not the number of the day. It
  // was pinned to 55 and went red the moment a publish carried a 56th Onyx
  // auction — 20275, the first 2027 close — proving nothing about the Pending
  // rule this case exists to guard. The corpus grows every season; what must
  // hold is that § 6 reached its success line, not how much data it counted.
  ['6  a Pending Onyx auction is not an error', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 Onyx auction announced but not yet open',
    auctionStyle: 'Onyx Ultra Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2099-10-01', Status: 'Pending', outcome: 'Pending',
  }), /Onyx row\(s\) across \d+ auction\(s\) and \d+ context row\(s\) are internally consistent/, 'warn'],

  // The other direction of § 5b: rows under an auction that sold nothing. This
  // is the wrong-auction defect wearing a new hat, and it is a NOTE — which way
  // it resolves is a judgement call, and erroring would block a publish on one.
  ['5b a Failed auction that HAS price rows is a note', () => edit('auctionMetadata.csv', (t) => {
    const L = withOutcomeColumn(lines(t).filter((l) => l.trim() !== ''));
    return L.map((l, i) => (i > 0 && l.startsWith('20181,2018,1,')
      ? setOutcome(l.replace(',3,Closed,', ',3,Failed,'), 'Failed') : l)).join('\n') + '\n';
  }), /20181 .* is Failed but HAS rows in prices\.csv/, 'warn'],

  ['5c an Onyx item recorded twice for one auction', () => edit('onyx.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('20222,2022,2,+2 Chaos Cannon,'));
    L.splice(i + 1, 0, L[i].replace(/,\$[\d.]+,/, ',$999.00,')); return L.join('\n');
  }), /records 1 Onyx item\(s\) more than once/],

  // The doubled BLOCK — the shape the allowance used to bless — must be caught
  // as a whole, not just as one duplicated row.
  ['5c a second auction\'s rows pasted onto one', () => edit('onyx.csv', (t) => {
    const L = lines(t);
    const donor = L.filter((l) => l.startsWith('20224,2022,4,'));
    return [...L, ...donor.map((l) => l.replace(/^20224,2022,4,/, '20222,2022,2,'))].join('\n');
  }), /20222 .*records \d+ Onyx item\(s\) more than once/],

  ['6  Onyx marker left in Item', () => edit('onyx.csv', (t) =>
    t.replace('20222,2022,2,+2 Chaos Cannon,', '20222,2022,2,+2 Chaos Cannon (Onyx),')),
    /the Onyx marker was not stripped from Item/],

  ['6  Onyx rows with no Onyx auctionStyle', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('20222,'));
    L[i] = L[i].replace(/Onyx Super Condensed/, 'Super Condensed'); return L.join('\n');
  }), /onyx\.csv rows but auctionStyle .* does not say Onyx/],

  ['6  half an Onyx set', () => edit('onyx.csv', (t) => {
    let n = 0;
    return lines(t).filter((l) => !(l.startsWith('20222,') && n++ < 5)).join('\n');
  }), /Onyx rows — expected 20 or 21 for one set/, 'warn'],

  // A SHORT Onyx set in an auction that also withholds things. An Onyx order
  // is 21 TOKENS, not 21 rows in this file: 20275 sold 12 of its set and
  // withheld 9, and the note used to read as a defect on correct data. It now
  // says what else the auction carries and stops short of adding them up —
  // nothing can tell a withheld CHASE token from a withheld ordinary one, and
  // 20222 (used here) withholds fifteen that have nothing to do with its set.
  ['6  a short Onyx set names the withheld rows beside it', () => edit('onyx.csv', (t) => {
    let n = 0;
    return lines(t).filter((l) => !(l.startsWith('20222,') && n++ < 5)).join('\n');
  }), /20222: 16 Onyx rows .* also records \d+ withheld item\(s\)/, 'warn'],

  // ...and the clause is CONDITIONAL, or it is just noise appended to every
  // short set. 20182 carries no withheld rows at all.
  ['6  a short Onyx set with nothing withheld says only that', () => edit('onyx.csv', (t) => {
    let n = 0;
    return lines(t).filter((l) => !(l.startsWith('20182,') && n++ < 5)).join('\n');
  }), /20182: 16 Onyx rows — expected 20 or 21 for one set$/m, 'warn'],

  // A duplicate tokenMetadata key. `key` is season+Item and everything that
  // reads this file builds a lookup off it, so a duplicate silently decides a
  // token's Category by which reader you ask: buildTokenIndex is last-wins,
  // the workbook's own VLOOKUP is first-wins. Five are in the shipped file
  // today (backlog PIPE-8), which is why it reports rather than errors.
  ['7  a duplicate tokenMetadata key with two categories', () => edit('tokenMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('2026Aragonite,'));
    L.splice(i + 1, 0, '2026Aragonite,2026,Aragonite,Aragonite,Trade 1');
    return L.join('\n');
  }), /key "2026Aragonite" appears 2 times with DIFFERENT categories \(Trade 2 vs Trade 1\)/, 'warn'],

  ['6  withheld recorded as a credit', () => edit('contextItems.csv', (t) =>
    t.replace('20183,2018,3,withheld,Patron Pin,1,-$114.30', '20183,2018,3,withheld,Patron Pin,1,$114.30')),
    /withheld price \$114\.3 is positive/],

  ['6  unknown context category', () => edit('contextItems.csv', (t) =>
    t.replace('20183,2018,3,withheld,Patron Pin,', '20183,2018,3,retained,Patron Pin,')),
    /category "retained" is not one of/],

  // Season 2027's second $8K order, the third thing § 6 holds `auctionStyle`
  // to. Both directions, plus the degenerate case.
  //
  // Every expectation here is pinned to the SHAPE of the message, never to a
  // signature: `15/20/20` is a modal computed from the season's own rows, so a
  // publish that adds a 2027 auction which withholds one Aragonite moves it,
  // and a case pinned to it would go red over data that is entirely correct.
  // What must hold is that the check separated the two orders and named the
  // row — not what the counts came out at. Same reason the Pending-Onyx case
  // above says `\d+` where it used to say 55.
  ['6  a Trade 2 order with no Trade 2 in its auctionStyle', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202710,'));
    L[i] = L[i].replace(',Trade 2 Ultra Condensed,', ',Ultra Condensed,'); return L.join('\n');
  }), /202710 .* is season 2027's TRADE 2 order, but auctionStyle .* does not/, 'warn'],

  ['6  a standard order labelled Trade 2', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('20276,'));
    L[i] = L[i].replace(',Ultra Condensed,', ',Trade 2 Ultra Condensed,'); return L.join('\n');
  }), /20276 .* is season 2027's STANDARD order, but auctionStyle .* says Trade 2/, 'warn'],

  // The label applied in a season that never ran two orders. The signature
  // check cannot speak here — there is only one kind of order to match — so
  // the alternative is silence, which would let the label spread unchallenged
  // through a season where it means nothing.
  ['6  a Trade 2 label in a season with only one order', () => edit('auctionMetadata.csv', (t) => {
    const L = lines(t); const i = L.findIndex((l) => l.startsWith('202631,'));
    L[i] = L[i].replace(',Ultra Condensed,', ',Trade 2 Ultra Condensed,'); return L.join('\n');
  }), /season 2026: .* the label separates nothing/, 'warn'],

  // --- 7. closed vocabularies -----------------------------------------------
  // The defect Phase 0 actually found, reinjected: a style that differs from
  // the one beside it only in case. This is the case the dropdown is meant to
  // prevent and the validator has to catch anyway, because a paste bypasses
  // the dropdown.
  ['7  auctionStyle typo differing only in case', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',Super Condensed,Fixed Date,Wade S,', ',SUper Condensed,Fixed Date,Wade S,')),
    /auctionStyle "SUper Condensed" \(1 row\(s\)\) differs from "Super Condensed" .* only in case or spacing/],

  // An INTERNAL double space, not a trailing one. `load()` trims every value,
  // so leading and trailing whitespace provably cannot reach the repo — which
  // is a real division of labour rather than a gap: whitespace at the ends is
  // the SHEET's problem (Phase 7's dropdown and numeric validation), and what
  // gets past the export to here is case and internal spacing.
  ['7  completionStyle with an internal double space', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',Super Condensed,Fixed Date,Wade S,', ',Super Condensed,Fixed  Date,Wade S,')),
    /completionStyle "Fixed {2}Date" .* differs from "Fixed Date" .* only in case or spacing/],

  // A genuinely new auction style must NOT fail — the vocabulary grows, and a
  // validator that blocked a publish for a new format would be worse than none.
  //
  // The assertion is that the new value is NAMED as a one-off, not that the
  // column holds some particular number of values. It read `9 distinct
  // value(s)`, and adding season 2027's two Trade 2 styles to the shipped file
  // turned it red — a correct publish failing over a count nothing depends on,
  // which is this repo's most-repeated way of blocking itself. What the case
  // exists to prove is that the run stayed GREEN and said what it saw.
  ['7  a genuinely new auction style passes', () => edit('auctionMetadata.csv', (t) =>
    t.replace(',Super Condensed,Fixed Date,Wade S,', ',Quantum Condensed,Fixed Date,Wade S,')),
    /auctionStyle: \d+ distinct value\(s\); used once: "Quantum Condensed"/, 'warn'],

  // `Status` is a formula — `IF(outcome<>"", outcome, IF(closeDate="", "Open",
  // "Closed"))` — so the only values it can produce are `Open`, `Closed` and
  // whatever `outcome` is allowed to hold, which is `Failed`, `Pending` and
  // `Ended`. This case is one outside that set, and `Cancelled` is chosen on
  // purpose: it is the plausible next member of the vocabulary, and it must be
  // a DECISION to add rather than something that rides in on a publish.
  //
  // The expected message is matched on its PREFIX, not on the full list. The
  // list is `[...OUTCOME_STATUSES]` and grows whenever the vocabulary does —
  // pinning the whole sentence would make this case fail on the change it is
  // meant to be indifferent to, which is how a check turns into a publish
  // blocker. What must hold is that an unknown value is refused.
  ['7  Status outside its vocabulary', () => edit('auctionMetadata.csv', (t) =>
    t.replace('2018-09-27,2018-09-30,3,Closed,', '2018-09-27,2018-09-30,3,Cancelled,')),
    /Status "Cancelled" is not Open or Closed or/],

  // § 4. `Status` and `outcome` are one fact written twice. In the workbook they
  // cannot disagree — one computes from the other — so a disagreement in the
  // EXPORT means the formula was pasted over, which is how `augmentated` once
  // froze at "No" for the life of an auction.
  ['4  Status says Failed but outcome is blank', () => edit('auctionMetadata.csv', (t) =>
    t.replace('2018-09-27,2018-09-30,3,Closed,', '2018-09-27,2018-09-30,3,Failed,')),
    /Status is "Failed" but outcome is blank/],

  ['4  outcome is set but Status ignores it', () => edit('auctionMetadata.csv', (t) => {
    const L = withOutcomeColumn(lines(t).filter((l) => l.trim() !== ''));
    return L.map((l, i) => (i > 0 && l.startsWith('20181,2018,1,') ? setOutcome(l, 'Failed') : l)).join('\n') + '\n';
  }), /outcome is "Failed" but Status is "Closed"/],

  // The same formula guard for `Pending`, which arrives the same way `Failed`
  // does — through `outcome`, never by typing into `Status`.
  ['4  Status says Pending but outcome is blank', () => edit('auctionMetadata.csv', (t) =>
    t.replace('2018-09-27,2018-09-30,3,Closed,', '2018-09-27,2018-09-30,3,Pending,')),
    /Status is "Pending" but outcome is blank/],

  // A pending row whose date has arrived. A NOTE, not an error: the site reads
  // the DATE and already shows it as open, which is the whole point — nobody
  // has to republish on the morning of a season's opening day. The cell is just
  // stale, and a stale cell must never block a publish.
  ['4  a Pending auction whose openDate has passed is a note', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction that has since opened',
    auctionStyle: 'Super Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2018-10-01', Status: 'Pending', outcome: 'Pending',
  }), /outcome is "Pending" but openDate 2018-10-01 has arrived/, 'warn'],

  // Pending AND closed is not a stale cell, it is a contradiction: an auction
  // cannot have finished before it started. An ERROR, because unlike the stale
  // case there is no reading of the row that is true.
  ['4  a Pending auction that also has a closeDate', () => addMetaRow({
    auctionId: '20189', auctionSeason: '2018', auctionNumber: '9',
    auctionName: 'A 2018 auction both pending and closed',
    auctionStyle: 'Super Condensed', completionStyle: 'Lightning', auctioneer: 'Wade S',
    Link: 'https://truedungeon.com/forum?view=topic&catid=584&id=248428',
    openDate: '2099-10-01', closeDate: '2099-10-09', Status: 'Pending', outcome: 'Pending',
  }), /outcome is "Pending" but closeDate is 2099-10-09/],

  // A new `outcome` value must NOT ride along the way a new auctionStyle does.
  // The two columns look alike and are fenced oppositely on purpose: styles are
  // invented by auctioneers, outcomes are decided here.
  ['7  a new outcome value does not ride along', () => edit('auctionMetadata.csv', (t) => {
    const L = withOutcomeColumn(lines(t).filter((l) => l.trim() !== ''));
    return L.map((l, i) => (i > 0 && l.startsWith('20181,2018,1,') ? setOutcome(l, 'Cancelled') : l)).join('\n') + '\n';
  }), /outcome "Cancelled" is not Failed/],

  ['7  augmentated says TRUE instead of Yes', () => edit('auctionMetadata.csv', (t) =>
    t.replace(/,"\$8,000\.00",No,/, ',"$8,000.00",TRUE,')),
    /augmentated "TRUE" is not Yes or No/],

  // A Category no tokenMetadata row carries is unjoinable — the site reads a
  // token's category from there, so nothing can look this one up.
  ['7  price Category not in tokenMetadata', () => edit('prices.csv', (t) =>
    t.replace('20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",Trade 2',
      '20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",Trade 9')),
    /Category "Trade 9" is in no tokenMetadata row/],

  ['7  price Category differing only in case', () => edit('prices.csv', (t) =>
    t.replace('20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",Trade 2',
      '20181,2018,1,"1,000 GP Gold Bar",14,"1,000 GP Gold Bar",trade 2')),
    /Category "trade 2" differs from tokenMetadata's "Trade 2" only in case or spacing/],

  // § 8 splits by how certain the pair is. A PUNCTUATION or trailing-plural
  // difference stays a warning: those are real defects a human has to
  // arbitrate, and failing the gate on one would block a publish for a row
  // nobody has been shown yet. A CASE or WHITESPACE difference is an ERROR —
  // there is nothing to weigh up, and leaving it a warning cost a real defect
  // on 2026-09-18 (see the § 8 header in validate-prices.mjs).
  ['8  one context item spelled two ways', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,bead of the  lucky traveler,1,$145.00')),
    /differs from .* only in CASE or spacing/],

  // A curly apostrophe is an ERROR, not one of the arbitrable near-misses:
  // there is nothing to weigh up, a name is spelled with the straight one.
  ['8  a curly apostrophe in a name', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,Bead of the Lucky Traveler’s,1,$145.00')),
    /uses a curly apostrophe — names are spelled with the straight one/],

  ['8  a curly apostrophe in tokenMetadata', () => edit('tokenMetadata.csv', (t) =>
    t.replace('2019Wish Ring,2019,Wish Ring,Wish Ring',
      '2019Wish Ring,2019,Wish’ Ring,Wish’ Ring')),
    /tokenMetadata\.csv row \d+: Item "Wish’ Ring" uses a curly apostrophe/],

  ['8  a trailing plural is a note, not an error', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,Bead of the Lucky Travelers,1,$145.00')),
    /differ only in punctuation or a trailing plural/, 'warn'],

  // The cross-file half: a context item spelled unlike the canonical token.
  // Confined to contextItems, this pair is invisible.
  ['8  context item disagrees with tokenMetadata', () => edit('contextItems.csv', (t) =>
    t.replace('202019,2020,19,token,Bead of the Lucky Traveler,1,$145.00',
      '202019,2020,19,token,Wish  Ring,1,$145.00')),
    /\[tokenMetadata\.csv\]|\[prices\.csv\]|\[onyx\.csv\]/],

  // THE 2026-09-18 DEFECT, in one line. A `Unique` -> `unique` rename reached
  // tokenMetadata and the recipes but not `offAuctionPrices.Item`, which is a
  // JOIN KEY: the price stopped reaching four tokens and nothing failed. Both
  // halves were reported, as two unrelated WARNINGS in two different
  // validators, and `validate` exited 0.
  //
  // Keyed on the NAME either side of the edit, never on the row's prices — a
  // case pinned to a value is pinned to a Google Sheets formatting decision.
  ['8  an off-auction price key differs only in case', () => edit('offAuctionPrices.csv', (t) =>
    t.replace(',Golem Piece (40 unique),Golem Piece (40 unique),',
      ',Golem Piece (40 Unique),Golem Piece (40 unique),')),
    /differs from .* only in CASE or spacing/],
];

// The shipped data must be clean first: every case below asserts that ONE
// injected defect is reported, which says nothing if the baseline is already
// failing for other reasons.
fresh();
const base = run();
if (base.code !== 0) {
  console.error('Baseline public/data does not pass validate-prices.mjs — fix that first:\n');
  console.error(base.out);
  rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
}
console.log('baseline public/data is clean\n');

let pass = 0, missed = 0, stale = 0;
for (const [name, mutate, expect, level = 'error'] of cases) {
  fresh();
  touched = false;
  mutate();
  if (!touched) { console.error(`STALE   ${name} — the row this case edits is no longer in public/data`); stale++; continue; }
  const r = run();
  const reported = expect.test(r.out);
  const exitedRight = level === 'warn' ? r.code === 0 : r.code !== 0;
  if (reported && exitedRight) { console.log(`ok      ${name}`); pass++; continue; }
  missed++;
  console.error(`MISSED  ${name}`);
  if (!reported) console.error(`        expected a report matching ${expect}`);
  if (!exitedRight) console.error(`        expected exit ${level === 'warn' ? '0 (warning only)' : 'non-zero'}, got ${r.code}`);
}

rmSync(WORK, { recursive: true, force: true });
console.log(`\n${missed || stale ? '✗ FAIL' : '✓ OK'} — ${pass} caught, ${missed} missed, ${stale} stale`);
process.exit(missed || stale ? 1 : 0);
