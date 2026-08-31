// Save and recall the Shopping List, in `localStorage` and nowhere else.
//
// Share links were dropped: a quartermaster's list with twenty recipes, their
// quantities, an on-hand count per row and a handful of corrected prices makes
// a punishing URL, and one that breaks the moment a row id changes.
//
// A server-side "code" system is IMPOSSIBLE here, not merely unbuilt. The site
// is static on GitHub Pages: there is no write path, and a repo token shipped
// in client JS would be public the day it shipped.
//
// Everything here is defensive by construction, because none of it is trusted:
//
//   The ACCESSOR can throw, not just return null. A private window, cleared
//   site data, or a browser set to block storage each raise on the property
//   access itself, so even `typeof localStorage` needs a guard.
//
//   The CONTENTS are data, not state. They are hand-editable, they survive
//   across deploys, and they may have been written by a version of this file
//   that no longer exists. Every field is re-validated on the way in; anything
//   that does not check out is dropped rather than repaired, because a
//   half-repaired plan is harder to notice than an empty one.

export type SavedShopping = {
  picks: { key: string; qty: number }[];
  onHand: Record<string, number>;
  overrides: Record<string, number>;
  netCrafted: boolean;
};

/** Versioned, so a future shape change starts clean instead of trying to read
 *  last season's object. Bump the number rather than migrating: this is a
 *  working document a player can rebuild in a minute, not a record. */
const KEY = 'td-shopping-v1';

/** A plan far larger than any real one. Not a UI limit — the list has no cap —
 *  but a bound on what a corrupted or hand-edited entry can make the page do
 *  before it is rejected. */
const MAX_PICKS = 500;
const MAX_ROWS = 5000;

function store(): Storage | null {
  try {
    // The access itself throws when storage is blocked, so this is inside the
    // try rather than guarding it.
    return window.localStorage;
  } catch {
    return null;
  }
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

/** Numbers keyed by row id, dropping anything that is not one. Keys are not
 *  validated against the current list on purpose: a row id that no longer
 *  matches is simply never read, and keeping it means an on-hand count
 *  survives a recipe being removed and added back (D2's whole point). */
function numberMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n++ >= MAX_ROWS) break;
    if (typeof k === 'string' && k && isFiniteNumber(val) && val >= 0) out[k] = val;
  }
  return out;
}

export function loadShopping(): SavedShopping | null {
  const s = store();
  if (!s) return null;
  let raw: string | null;
  try {
    raw = s.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const v = JSON.parse(raw) as Partial<SavedShopping>;
    if (!v || typeof v !== 'object') return null;
    const picks = Array.isArray(v.picks)
      ? v.picks
          .filter((p): p is { key: string; qty: number } =>
            !!p && typeof p === 'object' &&
            typeof (p as { key?: unknown }).key === 'string' && !!(p as { key: string }).key &&
            isFiniteNumber((p as { qty?: unknown }).qty) && (p as { qty: number }).qty >= 0)
          .slice(0, MAX_PICKS)
          // Floor the quantity: a fractional one would multiply through every
          // total and show up as $12.3456 rather than as an error.
          .map((p) => ({ key: p.key, qty: Math.floor(p.qty) }))
      : [];
    return {
      picks,
      onHand: numberMap(v.onHand),
      overrides: numberMap(v.overrides),
      netCrafted: v.netCrafted === true,
    };
  } catch {
    // Corrupt JSON. Leave the entry in place rather than deleting it — this
    // runs on every page load, and silently destroying something a person
    // might have hand-written is worse than ignoring it.
    return null;
  }
}

export function saveShopping(v: SavedShopping): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify(v));
  } catch {
    // Quota, or a browser that reports storage and then refuses to write to it.
    // There is nothing useful to say: the list still works, it just will not be
    // there next time, and an error toast for that would be noise.
  }
}

export function clearShopping(): void {
  const s = store();
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
