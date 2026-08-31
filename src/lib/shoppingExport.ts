// Getting the Shopping List out of the browser — Copy as TSV, Download CSV.
//
// Pure and separate from the component so the escaping is testable, because
// the escaping is the whole risk here. Three measured facts about this data
// shape both writers:
//
//   33 display names start with `+` (`+3 Mithral Bracers`), and zero start with
//   `-`, `=` or `@`. A cell beginning with any of those is a FORMULA to Excel.
//
//   Exactly one name contains a comma — `1,000 GP Gold Bar` — which is the same
//   token CLAUDE.md warns about for reading CSVs. One is enough: an unquoted
//   writer silently shifts every column after it on that row.
//
//   Zero names contain a quote, tab or newline today. The writers handle them
//   anyway; a token printed next season is not obliged to keep that true.
//
// Numbers are written as NUMBERS, not as "$44.08". A currency-formatted string
// arrives in a spreadsheet as text, and a shopping list you cannot sum is not
// worth exporting.
//
// TEXT and BYTES are different problems and are solved in different places.
// The formula guard is a clipboard concern (a spreadsheet is about to
// interpret the value); the ENCODING is a file concern, and `csvFile` is the
// only thing that should ever be written to disk — see the note on it.

import type { ShoppingList, ShoppingRow } from './shoppingList';

export type ExportFormat = 'tsv' | 'csv';

/** The columns, in order. One list so a future column cannot be added to one
 *  writer and forgotten in the other. */
export const EXPORT_COLUMNS = [
  'Item', 'Category', 'Season', 'Needed', 'On hand', 'To buy', '$ each', 'Cost', 'Flags',
] as const;

const plain = (n: number | null): string => (n === null ? '' : n.toFixed(2));

/**
 * The Flags cell.
 *
 * A NARROW replacement for the Notes column, not a shortened version of it.
 * Notes carried the per-recipe breakdown, which is a wall in a spreadsheet as
 * much as on screen, and the working tables are where that belongs. These two
 * are here because they change what you should BUY rather than explaining why
 * a row exists: in a bare grid a 2012 Ultra Rare looks exactly like one still
 * on sale, and a season average that recent sales have left behind is a price
 * you would otherwise budget on.
 *
 * The staleness NUMBERS stay on the page. The cell beside this one holds the
 * price the flag is about, and the row is one line in a file rather than a
 * sentence a reader is looking at.
 *
 * The two cannot currently co-occur — staleness is only measured on trade
 * goods and out-of-print only tagged on Ultra Rares, which are never in the
 * trade section — so the separator below has never yet been used. It stays
 * anyway: this cell should not start joining things badly the first time that
 * stops being true, and a test pins the exclusivity so the change is visible.
 */
function flagsFor(r: ShoppingRow): string {
  const flags: string[] = [];
  if (r.outOfPrint && r.nominalYear !== null) flags.push('Out of print');
  if (r.staleness) flags.push('Price moving');
  return flags.join(' · ');
}

/** One row's cells, before any escaping. */
function cellsFor(r: ShoppingRow): string[] {
  return [
    r.displayName,
    r.category,
    r.nominalYear === null ? '' : String(r.nominalYear),
    String(r.quantity),
    // The NETTED count, which is what the arithmetic beside it used: a source
    // you are already crafting is on hand as far as this list is concerned.
    String(r.onHand),
    String(r.need),
    plain(r.unitAvg),
    plain(r.extAvg),
    flagsFor(r),
  ];
}

/**
 * Neutralise a leading formula character.
 *
 * A leading apostrophe is Excel's and Google Sheets' own "this cell is text"
 * marker, and both CONSUME it on paste — so it belongs on the clipboard path,
 * where the destination is a spreadsheet that is about to interpret the value.
 * It does not belong in a file: a CSV is read by many things that would show
 * the apostrophe literally, and quoting is the format's own answer.
 *
 * Applied to any cell, not just the Item column. Nothing else starts with `+`
 * today, but a note or a category one day might.
 */
export function guardFormula(cell: string): string {
  return /^[+\-=@]/.test(cell) ? `'${cell}` : cell;
}

/** RFC 4180: quote when the value holds a delimiter, a quote or a newline, and
 *  double any quote inside. `1,000 GP Gold Bar` is the live case. */
function csvCell(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** A tab-separated cell. Tabs and newlines would end the cell or the row, so
 *  they collapse to a space — TSV has no quoting mechanism to escape them
 *  with, and a spreadsheet that gained a phantom row would be worse than one
 *  that lost a line break. */
function tsvCell(cell: string): string {
  return guardFormula(cell).replace(/[\t\r\n]+/g, ' ');
}

/** The TABLE — the header and one row per ingredient, nothing else. */
export function toRows(list: ShoppingList): string[][] {
  return [[...EXPORT_COLUMNS], ...list.all.map(cellsFor)];
}

/**
 * The whole sheet: what the plan is FOR, a blank line, then the table.
 *
 * Above the header rather than below it, because that is where a person
 * opening the file looks first and a shopping list of forty trade goods says
 * nothing about what any of them is for. It costs something real — a
 * spreadsheet's header auto-detection sees row 1, so filters have to be set up
 * by hand — and that is the trade being made deliberately.
 *
 * The preamble rows are SHORTER than the table's nine columns. That is legal
 * CSV and every spreadsheet reads it; padding them out to nine would put eight
 * empty cells beside every line of it.
 */
export function toSheet(list: ShoppingList): string[][] {
  if (list.making.length === 0) return toRows(list);
  return [
    ['Making'],
    ...list.making.map((m) => [m.displayName, String(m.qty)]),
    [],
    ...toRows(list),
  ];
}

export function toTSV(list: ShoppingList): string {
  return toSheet(list).map((r) => r.map(tsvCell).join('\t')).join('\n');
}

export function toCSV(list: ShoppingList): string {
  // A trailing newline: POSIX tools treat a file without one as truncated, and
  // spreadsheets do not mind it.
  return toSheet(list).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The bytes that go in the .csv, which are NOT the bytes of `toCSV`.
 *
 * A Blob's `type: 'text/csv;charset=utf-8'` is not stored in the file — it
 * tells the browser what it is handing over, and nothing downstream ever sees
 * it. Excel opens a .csv in the system ANSI codepage instead, so on Windows
 * every non-ASCII character in the file came out as its UTF-8 bytes read as
 * Windows-1252: `×` as `Ã—`, `·` as `Â·`, `—` as `â€"`. A BOM is what makes
 * Excel switch to UTF-8; Google Sheets and LibreOffice consume it silently.
 *
 * Only the FILE gets it. The clipboard carries text rather than bytes, which
 * is why Copy as TSV never had the problem, and a BOM pasted into a cell would
 * be a stray character rather than an encoding hint.
 */
export function csvFile(list: ShoppingList): string {
  // Written as an escape, not as the character: a literal BOM in source is
  // invisible, and the next person to touch this line would delete it without
  // knowing they had.
  return `\uFEFF${toCSV(list)}`;
}

/** `td-shopping-list-2026-08-31.csv` — dated, because a player will export this
 *  more than once in a season and two files called `shopping-list.csv` in a
 *  downloads folder is a small cruelty. */
export function exportFilename(format: ExportFormat, today = new Date()): string {
  const iso = today.toISOString().slice(0, 10);
  return `td-shopping-list-${iso}.${format}`;
}
