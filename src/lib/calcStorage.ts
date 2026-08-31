// The Build Calculator remembers ONE thing: which recipe you were looking at.
//
// Not the on-hand counts, and not the price overrides — deliberately, and the
// reason is a hazard rather than a preference. The calculator keys both of
// those by LINE INDEX (`String(i)` in BuildCalculator), which is only
// meaningful for the recipe on screen and only for as long as that recipe's
// line order holds. `transmuteRecipes.csv` is maintained: a line inserted or
// reordered between deploys turns a saved "3" for Mystic Silk into a saved "3"
// for whatever now sits at index 4, silently and in the reader's favour —
// their cost to finish would come out too low. Restoring that safely means
// storing the line names alongside and dropping the lot when they no longer
// match, which is a real mechanism guarding a small convenience.
//
// The recipe is the part that is actually tedious to get back: it lives behind
// a drawer, eleven tier filters and a year accordion. The on-hand column is
// one All tap away, and it is a what-if sandbox rather than a record of a
// stash — that is the Shopping List's job, and the two tools deliberately do
// not share a number (see docs/shopping-list.md).
//
// Storing only the key also means no first-run guard is needed: the effect
// that clears state whenever the recipe changes fires on mount as well, and
// what it clears is exactly what should start empty.
//
// Everything here is as defensive as lib/shoppingStorage.ts, for the same
// reasons — the accessor itself can throw, and the contents are hand-editable
// data that survive deploys. See that file's header.

/** Versioned like the Shopping List's, and separate from it: these are two
 *  tools answering two questions, and one clearing should never empty the
 *  other. */
const KEY = 'td-calc-v1';

/** Long enough for any real recipe key (`2026|Val's +4 Keen Fellbane
 *  Crossbow`), short enough that a corrupted entry cannot make the page do
 *  anything with it. The caller checks it against the engine regardless. */
const MAX_KEY = 200;

function store(): Storage | null {
  try {
    // The access itself throws when storage is blocked, so this is inside the
    // try rather than guarding it.
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The stored recipe key, or null.
 *
 * NOT validated against the engine here — this module has no business knowing
 * what a recipe is. The caller resolves it and discards what it cannot find,
 * which is what makes a key stranded by a renamed transmute behave as "nothing
 * was selected" rather than as a broken selection.
 */
export function loadCalcRecipe(): string | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    return typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_KEY ? raw : null;
  } catch {
    return null;
  }
}

/** Null removes the entry rather than storing an empty string, so "nothing
 *  selected" and "nothing saved" are the same state on disk. */
export function saveCalcRecipe(key: string | null): void {
  const s = store();
  if (!s) return;
  try {
    if (key === null || key === '') s.removeItem(KEY);
    else s.setItem(KEY, key);
  } catch {
    // Quota, or a browser that reports storage and then refuses to write to
    // it. Nothing useful to say: the calculator still works, it just will not
    // open on this recipe next time.
  }
}
