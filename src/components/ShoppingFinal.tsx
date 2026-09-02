import { useState } from 'react';
import { Money } from './Money';
import { moneyCalc } from '../lib/format';
import { stalenessNote, stalenessParts, type ShoppingList } from '../lib/shoppingList';
import { toTSV, csvFile, exportFilename } from '../lib/shoppingExport';

// The takeaway list: every row in one table, in D6's order, plus the two ways
// of getting it out of the browser.
//
// It is a SEPARATE section from the two working tables rather than a third
// mode, because the two answer different questions. Up there you enter what you
// own and correct prices; down here is the thing you carry to the auction or
// paste into a spreadsheet. Collapsed by default so it does not double the
// page's length — the buttons, which are the actual job, sit outside it and are
// always reachable.
//
// It shows COVERED rows too, dimmed. Dropping them would make the on-screen
// list disagree with the file, and an export that quietly omits rows is a worse
// failure than one that includes a few zeroes.
//
// NO NOTES COLUMN. It was the widest thing here by a distance and the only
// reason the table scrolled sideways, and most of its width was the per-recipe
// breakdown — which the working tables above already carry, and which the
// exports carry in full. The two notes that change a PURCHASE rather than
// explaining one ride under the item name instead: `Out of print`, because in
// a plain table a 2012 Ultra Rare looks exactly like one you can still buy,
// and the staleness numbers, because the price beside them has moved away from
// the season average they were budgeted on.

// IN PIVOT MODE it grows the per-recipe columns and the file follows suit. It
// stays READ-ONLY: the on-hand count appears as a number so the table adds up
// on its own, but the controls stay in the working tables above. A second live
// control set for one piece of state on one page is how two surfaces start
// disagreeing about what a reader typed.
//
// It uses ONE shape for both tables' rows, unlike the working pair — a matrix
// column per recipe over everything. Here that is right: this is the file's
// table, the reader has already read the diagonal upstairs, and a `For` column
// that meant something different from the columns beside it would be worse
// than a sparse block.

export function ShoppingFinal({ list, pivot }: { list: ShoppingList; pivot: boolean }) {
  const [copied, setCopied] = useState(false);
  if (list.all.length === 0) return null;

  const toBuy = list.all.filter((r) => r.need > 0).length;
  // A pivot with no recipes to pivot on is just the standard table, and
  // `list.making` is empty exactly when every pick is paused.
  const cols = pivot ? list.making : [];
  const asPivot = cols.length > 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTSV(list, { pivot }));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (an insecure origin, a permission
      // prompt declined). Say nothing rather than throwing: the Download
      // button beside it does the same job and still works.
      setCopied(false);
    }
  };

  const download = () => {
    // csvFile, not toCSV: the file needs a BOM or Excel reads its UTF-8 as
    // Windows-1252 and every × and · arrives mangled. The `charset` below is
    // not stored anywhere in the file and cannot do that job.
    const blob = new Blob([csvFile(list, { pivot })], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename('csv');
    a.click();
    // Revoke on the next tick, not immediately — Safari has not started the
    // download by the time click() returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className="sl-final">
      <div className="sl-export">
        <div className="sl-export-l">
          <b>{toBuy}</b> of {list.all.length} row{list.all.length === 1 ? '' : 's'} still to buy
        </div>
        <div className="sl-export-b">
          <button type="button" onClick={copy} aria-live="polite">
            {copied ? '✓ Copied' : 'Copy as TSV'}
          </button>
          <button type="button" onClick={download}>Download CSV</button>
        </div>
      </div>

      <details className="sl-final-d">
        <summary>The whole list in one table</summary>

        {/* What the plan is FOR, above what it costs. A takeaway list of forty
            trade goods says nothing about why any of them is on it, and this
            is the one place the answer is not already on screen — the chips
            that carry it are a full page up. */}
        {list.making.length > 0 && (
          <div className="sl-making">
            <h4>You're making</h4>
            <ul>
              {list.making.map((m) => (
                <li key={`${m.year}|${m.transmute}`}>
                  {m.displayName} <b>×{m.qty}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        {asPivot ? (
          <div className="sl-pv-scroll">
            <table className="sl-pv sl-pv-ro"
              // 96px, not the working tables' 112px. This table has no controls
              // in its columns and its recipe headings wrap the same way, so a
              // narrower floor keeps a five-recipe plan from scrolling by six
              // pixels — which reads as a bug rather than as a wide table.
              style={{ minWidth: `calc(var(--pv-frozen-ro) + var(--pv-money) + ${cols.length} * 96px)` }}>
              <thead>
                <tr>
                  <th scope="col" className="pv-item">Item</th>
                  <th scope="col" className="pv-buy">To buy</th>
                  <th scope="col" className="pv-hand-ro">On hand</th>
                  <th scope="col" className="pv-total">Total</th>
                  {cols.map((m) => (
                    <th scope="col" className="pv-rx" key={m.key}>
                      <span className="pv-rx-nm">{m.displayName}</span>
                      <span className="pv-rx-n">×{m.qty}</span>
                    </th>
                  ))}
                  {/* The money at the far right, matching the working
                      tables: pinning it there cost 162px of a frozen block
                      that had already taken half the screen. */}
                  <th scope="col" className="pv-unit">$ ea</th>
                  <th scope="col" className="pv-cost">Cost</th>
                </tr>
              </thead>
              <tbody>
                {list.all.map((r) => (
                  <tr key={r.id} className={r.need === 0 ? 'done' : undefined}>
                    <th scope="row" className="pv-item">
                      <span className="pv-nm">{r.displayName}</span>
                      {/* The Season column folds under the name here rather
                          than costing a fifth frozen column — the same trade
                          the standard table makes at phone widths, made for
                          the same reason in the other direction. */}
                      <span className="pv-sub">
                        {r.category}
                        {r.nominalYear !== null && ` · ${r.nominalYear}`}
                        {r.outOfPrint && r.nominalYear !== null && (
                          <span className="sl-final-flag">Out of print</span>
                        )}
                      </span>
                      {r.staleness && stalenessParts(r.staleness, moneyCalc).map((line) => (
                        <span className="sl-stale" key={line}>{line}</span>
                      ))}
                    </th>
                    <td className="pv-buy num">{r.need > 0 ? <b>{r.need}</b> : '—'}</td>
                    <td className="pv-hand-ro num">{r.onHand}</td>
                    <td className="pv-total num">{r.quantity}</td>
                    {cols.map((m) => {
                      const n = r.byPick[m.key] ?? 0;
                      return (
                        <td className="pv-cell num" key={m.key}>
                          {n > 0 ? n : <span className="pv-nil" aria-hidden="true">·</span>}
                        </td>
                      );
                    })}
                    <td className="pv-unit num">{r.unitAvg === null ? '—' : moneyCalc(r.unitAvg)}</td>
                    <td className="pv-cost num">
                      {r.unitAvg === null ? '—' : <Money format={moneyCalc} value={r.extAvg} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
        <div className="sl-final-scroll">
          <table className="sl-final-t">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">Season</th>
                <th scope="col" className="num">Buy</th>
                <th scope="col" className="num">$ ea</th>
                <th scope="col" className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {list.all.map((r) => (
                <tr key={r.id} className={r.need === 0 ? 'done' : undefined}>
                  <th scope="row">
                    {r.displayName}
                    <span className="sl-final-cat">
                      {r.category}
                      {/* The Season column's phone form. Five columns at 390px
                          squeezed "Ring of the 1st Circle" onto four lines, so
                          there the season rides the category instead and the
                          column hides — the same trade the working tables make
                          with $/ea. Rendered always and hidden in CSS, because
                          it is a presentation swap, not a data one. */}
                      {r.nominalYear !== null && (
                        <span className="sl-final-yr"> · {r.nominalYear}</span>
                      )}
                      {r.outOfPrint && r.nominalYear !== null && (
                        <span className="sl-final-flag">Out of print</span>
                      )}
                    </span>
                    {r.staleness && (
                      <span className="sl-stale">{stalenessNote(r.staleness, moneyCalc)}</span>
                    )}
                  </th>
                  {/* Blank on a trade good rather than a dash: those merge on
                      name alone precisely because they have no vintage, so
                      there is no missing value to mark. */}
                  <td className="num">{r.nominalYear ?? ''}</td>
                  <td className="num">{r.need}</td>
                  <td className="num">{r.unitAvg === null ? '—' : moneyCalc(r.unitAvg)}</td>
                  <td className="num">
                    {r.unitAvg === null ? '—' : <Money format={moneyCalc} value={r.extAvg} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        <p className="sl-final-note">
          {asPivot ? (
            <>Both exports carry this table's columns, the recipe breakdown included. Prices
              export as plain numbers so a spreadsheet can add them up.</>
          ) : (
            <>Both exports carry more than this table shows — what you already have, and the full
              quantity as well as what is left to buy. Prices export as plain numbers so a
              spreadsheet can add them up.</>
          )}
        </p>
      </details>
    </section>
  );
}
