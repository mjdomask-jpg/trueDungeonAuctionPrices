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

import { noteLabel, stalenessNote, type ShoppingList, type ShoppingRow } from './shoppingList';

export type ExportFormat = 'tsv' | 'csv';

/** The columns, in order. `key` is only here so a future column cannot be
 *  added to one writer and forgotten in the other. */
export const EXPORT_COLUMNS = [
  'Item', 'Category', 'Season', 'Needed', 'On hand', 'To buy', '$ each', 'Cost', 'Notes',
] as const;

const plain = (n: number | null): string => (n === null ? '' : n.toFixed(2));

/** One row's cells, before any escaping. */
function cellsFor(r: ShoppingRow): string[] {
  const notes = r.notes.map(noteLabel);
  // The staleness sentence rides in the Notes cell rather than getting a column
  // of its own: it applies to two rows out of fourteen, and a column that is
  // empty 86% of the time is a column a reader learns to ignore.
  if (r.staleness) notes.push(stalenessNote(r.staleness, (n) => `$${n.toFixed(2)}`));
  return [
    r.displayName,
    r.category,
    r.nominalYear === null ? '' : String(r.nominalYear),
    String(r.quantity),
    String(r.onHand),
    String(r.need),
    plain(r.unitAvg),
    plain(r.extAvg),
    notes.join(' · '),
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

export function toRows(list: ShoppingList): string[][] {
  return [[...EXPORT_COLUMNS], ...list.all.map(cellsFor)];
}

export function toTSV(list: ShoppingList): string {
  return toRows(list).map((r) => r.map(tsvCell).join('\t')).join('\n');
}

export function toCSV(list: ShoppingList): string {
  // A trailing newline: POSIX tools treat a file without one as truncated, and
  // spreadsheets do not mind it.
  return toRows(list).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** `td-shopping-list-2026-08-31.csv` — dated, because a player will export this
 *  more than once in a season and two files called `shopping-list.csv` in a
 *  downloads folder is a small cruelty. */
export function exportFilename(format: ExportFormat, today = new Date()): string {
  const iso = today.toISOString().slice(0, 10);
  return `td-shopping-list-${iso}.${format}`;
}
