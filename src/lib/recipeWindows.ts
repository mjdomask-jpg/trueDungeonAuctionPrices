// Recipe status and pricing windows (accuracy release, docs/transmutes-expansion-plan.md §10).
//
// The maintainer's framing decides everything here: someone building a recipe
// that is active TODAY pays today's prices by definition, so the split is
// ACTIVE vs EXPIRED — not expiring vs non-expiring (D1). An expired recipe is
// instead priced over the window in which it could actually be built.
//
// Pure date/status math only; the price lookups live in PriceIndex.

import type { Recipe } from './transmutes';

export type RecipeStatus = 'active' | 'expired' | 'future';

/** Levels the game never retires. Code default, so the site is correct before
 *  a single `Expires` cell is authored; an authored value always wins. */
export const NEVER_EXPIRING_LEVELS = new Set(['Legendary', 'Mythic', 'Safehold']);

/** An auction won inside the last week of a recipe's life could not ship in
 *  time to craft it, so those sales are outside the window (§3.1). */
export const SHIPPING_CUTOFF_DAYS = 7;

/** Season lookup: the first auction CLOSE date of a season, or null when that
 *  season has no dated auctions. Supplied by PriceIndex. */
export type SeasonStart = (season: number) => string | null;

const ISO = /^\d{4}-\d{2}-\d{2}/;

export function isISO(s: string): boolean {
  return ISO.test(s);
}

/** Today as 'YYYY-MM-DD' in the viewer's own timezone — status is a calendar
 *  question, so local midnight is the right boundary, not UTC's. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** ISO date arithmetic via UTC, so a DST shift can never move a date by a day. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * When a recipe stops being craftable. `null` means never.
 *
 * - blank + Legendary/Mythic/Safehold → never (the code default)
 * - blank otherwise → the standard rule, Dec 1 of Year+1
 * - `never` → never
 * - `YYYY-MM-DD` → the authored exception (Ioun Stone Mystic Orb's March
 *   expiry, Mark of Enlightenment's one-year window)
 *
 * An unparseable value falls back to the default for the level rather than
 * throwing; the validator is what tells the maintainer about the typo.
 */
export function expiryOf(recipe: Pick<Recipe, 'year' | 'level' | 'expires'>): string | null {
  const raw = (recipe.expires ?? '').trim();
  if (raw) {
    if (raw.toLowerCase() === 'never') return null;
    if (isISO(raw)) return raw.slice(0, 10);
  }
  if (NEVER_EXPIRING_LEVELS.has(recipe.level)) return null;
  return `${recipe.year + 1}-12-01`;
}

/**
 * When a recipe's ingredients first became buyable: the debut auction SEASON's
 * first auction, not Jan 1 of the debut year (D2). 70%+ of a season's auctions
 * close in the previous calendar year, so a Jan-1 window start would discard
 * most of the debut season's own sales — exactly the pre-release auctions where
 * players stock up on the new set.
 *
 * Falls back to Jan 1 for a season with no dated auctions (the 2027 preview,
 * and any future season before its first auction closes).
 */
export function debutOf(recipe: Pick<Recipe, 'year'>, seasonStart: SeasonStart): string {
  return seasonStart(recipe.year) ?? `${recipe.year}-01-01`;
}

/** active / expired / future, as of `today` (D1). */
export function statusOf(
  recipe: Pick<Recipe, 'year' | 'level' | 'expires'>,
  seasonStart: SeasonStart,
  today: string = todayISO(),
): RecipeStatus {
  if (today < debutOf(recipe, seasonStart)) return 'future';
  const expiry = expiryOf(recipe);
  if (expiry !== null && today > expiry) return 'expired';
  return 'active';
}

/**
 * The date range an EXPIRED recipe is priced over: its debut season's first
 * auction through its expiry, minus the shipping cutoff. Active and future
 * recipes have no window — they price at today's prices (D3) — so this returns
 * null for them, and a null window is the signal to use the season basis.
 */
export type PricingWindow = { from: string; to: string };

export function windowOf(
  recipe: Pick<Recipe, 'year' | 'level' | 'expires'>,
  seasonStart: SeasonStart,
  today: string = todayISO(),
): PricingWindow | null {
  if (statusOf(recipe, seasonStart, today) !== 'expired') return null;
  const expiry = expiryOf(recipe);
  if (expiry === null) return null; // unreachable: never-expiring recipes are never expired
  return { from: debutOf(recipe, seasonStart), to: addDays(expiry, -SHIPPING_CUTOFF_DAYS) };
}
