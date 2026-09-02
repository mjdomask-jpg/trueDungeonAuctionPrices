// Mutation test for validate-recipes.mjs's IngredientType agreement check
// (docs/data-backlog.md item 5).
//
// A validator that has never seen a defect is a validator nobody has tested.
// This copies public/data, injects one known defect into the COPY, and asserts
// the check reports it at the right severity. The repo's own data is never
// written to.
//
// Every case picks its target BY SHAPE rather than by naming a row: "whichever
// Item is authored with a non-blank IngredientType on two or more lines". A
// re-export moves rows around constantly, and a case pinned to a value turns
// into a red check on the publish PR -- which looks exactly like the publish
// itself being broken. If no row matches the shape any more the case reports
// STALE (fix the case) rather than FAIL (fix the validator), because those are
// different problems with different fixes.
//
// Run: node scripts/validate-recipes.test.mjs

import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'public', 'data');
const SCRIPT = join(here, 'validate-recipes.mjs');
const WORK = mkdtempSync(join(tmpdir(), 'validate-recipes-'));
const TMP = join(WORK, 'data');
const RECIPES = join(TMP, 'transmuteRecipes.csv');

const run = () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--data', TMP], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const fresh = () => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  cpSync(SRC, TMP, { recursive: true });
};

// Read the copy the way the validator does, so "which column is IngredientType"
// is answered by the HEADER rather than by a hardcoded index -- the column is
// optional and happens to be last today, and neither is guaranteed.
const readRecipes = () => {
  const rows = readFileSync(RECIPES, 'utf8').replace(/^﻿/, '').split('\n');
  const head = rows[0].replace(/\r$/, '').split(',').map((h) => h.trim());
  return { rows, itemCol: head.indexOf('Item'), typeCol: head.indexOf('IngredientType') };
};

// The shape every case needs: an Item authored with a non-blank IngredientType
// on at least two lines. Rows carrying a quoted comma are skipped rather than
// parsed -- this only needs one usable pair, not a correct parse of the file.
const findAuthoredPair = () => {
  const { rows, itemCol, typeCol } = readRecipes();
  if (itemCol === -1 || typeCol === -1) return null;
  const byItem = new Map();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].includes('"')) continue;
    const cells = rows[i].replace(/\r$/, '').split(',');
    if (cells.length <= typeCol) continue;
    const item = cells[itemCol];
    const type = (cells[typeCol] ?? '').trim();
    if (!item || !type) continue;
    if (!byItem.has(item)) byItem.set(item, []);
    byItem.get(item).push(i);
  }
  for (const [item, idx] of byItem) if (idx.length >= 2) return { item, idx };
  return null;
};

const setType = (rowIndex, value) => {
  const { rows, typeCol } = readRecipes();
  const cells = rows[rowIndex].replace(/\r$/, '').split(',');
  cells[typeCol] = value;
  rows[rowIndex] = cells.join(',');
  writeFileSync(RECIPES, rows.join('\n'));
};

let pass = 0, fail = 0, stale = 0;
const ok = (name) => { pass++; console.log('  ok    ' + name); };
const bad = (name, why) => { fail++; console.log('  FAIL  ' + name + '\n        ' + why); };
const skip = (name, why) => { stale++; console.log('  STALE ' + name + '\n        ' + why); };
const NO_PAIR = 'no Item is authored with the same IngredientType on two or more lines any more';

console.log('=== validate-recipes: IngredientType agreement ===');

// 0. The shipped data must pass. If this fails, nothing below means anything.
fresh();
{
  const { code, out } = run();
  if (code !== 0) bad('the shipped data validates clean', 'exit ' + code + '\n' + out);
  else if (out.includes('ingredient-type-conflict')) bad('the shipped data validates clean', 'a conflict is already reported');
  else ok('the shipped data validates clean');
}

// 1. THE HISTORICAL DEFECT. `Charm of Synergy` carried `Ultra Rare` on Giln's
//    Redoubt Shield and a blank cell on Smith's Charm of Unified Synergy (Set 2)
//    for as long as the column has existed (filled in PR #159). Blank one line
//    of an authored pair and the check must name the item -- as a WARN, never an
//    error: IngredientType is an optional column, and authoring an optional
//    column must never turn a passing export into a failing one.
fresh();
{
  const target = findAuthoredPair();
  if (!target) skip('a blank cell beside an authored one is reported', NO_PAIR);
  else {
    setType(target.idx[0], '');
    const { code, out } = run();
    if (!out.includes('ingredient-type-blank: "' + target.item + '"'))
      bad('a blank cell beside an authored one is reported', 'no ingredient-type-blank for "' + target.item + '"\n' + out);
    else if (code !== 0)
      bad('a blank cell beside an authored one is reported', 'it failed the run (exit ' + code + ') -- an optional column must not');
    else ok('a blank cell beside an authored one is reported, and does NOT fail the run');
  }
}

// 2. A CONTRADICTION. Two non-blank values for one token cannot come out of
//    unfinished authoring, only out of a typo or a real disagreement, so this
//    one fails the run.
fresh();
{
  const target = findAuthoredPair();
  if (!target) skip('two authored values for one token is an error', NO_PAIR);
  else {
    setType(target.idx[0], 'Premium');
    const { code, out } = run();
    if (!out.includes('ingredient-type-conflict'))
      bad('two authored values for one token is an error', 'not reported\n' + out);
    else if (code === 0)
      bad('two authored values for one token is an error', 'reported, but the run still passed');
    else ok('two authored values for one token is an error, and fails the run');
  }
}

// 3. Agreement is silent. Without this the check could "pass" cases 1 and 2 by
//    reporting every token it sees.
fresh();
{
  const target = findAuthoredPair();
  if (!target) skip('agreement is silent', NO_PAIR);
  else {
    for (const i of target.idx) setType(i, 'Ultra Rare');
    const { code, out } = run();
    if (out.includes('ingredient-type-blank: "' + target.item + '"') ||
        out.includes('ingredient-type-conflict: "' + target.item + '"'))
      bad('agreement is silent', 'reported anyway\n' + out);
    else if (code !== 0) bad('agreement is silent', 'exit ' + code + '\n' + out);
    else ok('an Item authored the same way on every line is silent');
  }
}

rmSync(WORK, { recursive: true, force: true });
console.log('\n' + (fail ? '✗ FAILED' : '✓ OK') + ' — validateRecipes: ' + pass + ' passed, ' + fail + ' failed' + (stale ? ', ' + stale + ' stale' : ''));
process.exit(fail ? 1 : 0);
