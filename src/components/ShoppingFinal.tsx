import { useState } from 'react';
import { Money } from './Money';
import { moneyCalc } from '../lib/format';
import { noteLabel, stalenessNote, type ShoppingList } from '../lib/shoppingList';
import { toTSV, toCSV, exportFilename } from '../lib/shoppingExport';

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

export function ShoppingFinal({ list }: { list: ShoppingList }) {
  const [copied, setCopied] = useState(false);
  if (list.all.length === 0) return null;

  const toBuy = list.all.filter((r) => r.need > 0).length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toTSV(list));
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
    const blob = new Blob([toCSV(list)], { type: 'text/csv;charset=utf-8' });
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
        <div className="sl-final-scroll">
          <table className="sl-final-t">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="num">Buy</th>
                <th scope="col" className="num">$ ea</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {list.all.map((r) => (
                <tr key={r.id} className={r.need === 0 ? 'done' : undefined}>
                  <th scope="row">
                    {r.displayName}
                    <span className="sl-final-cat">{r.category}</span>
                  </th>
                  <td className="num">{r.need}</td>
                  <td className="num">{r.unitAvg === null ? '—' : moneyCalc(r.unitAvg)}</td>
                  <td className="num">
                    {r.unitAvg === null ? '—' : <Money format={moneyCalc} value={r.extAvg} />}
                  </td>
                  <td className="sl-final-n">
                    {r.notes.map(noteLabel).join(' · ')}
                    {r.staleness && (
                      <span className="sl-stale">
                        {r.notes.length ? ' · ' : ''}{stalenessNote(r.staleness, moneyCalc)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sl-final-note">
          Both exports carry more than this table shows — the season a token comes from, what you
          already have, and the full quantity as well as what is left to buy. Prices export as
          plain numbers so a spreadsheet can add them up.
        </p>
      </details>
    </section>
  );
}
