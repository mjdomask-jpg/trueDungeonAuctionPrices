// Runs every test:code suite and reports on all of them, rather than the
// old `&&` chain, which stopped at the first failure. On 2026-09-22 a publish
// PR failed test:validators; fixing it and pushing again revealed a SECOND,
// unrelated failure in test:forum that had been sitting there the whole time
// -- two round trips for something one run could have shown at once.
//
// Suites still run in the same order and stream their own output live, so a
// normal clean run looks identical to before. Only a failure changes the
// shape: every suite still gets a turn, and the summary at the end names all
// of them, not just the first.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Same suites, same order, as the old test:code chain in package.json.
const suites = [
  ['test:validators', 'validate-prices.test.mjs'],
  ['test:context', 'validate-context.test.mjs'],
  ['test:recipes', 'validate-recipes.test.mjs'],
  ['test:trent', 'trent-close.test.mjs'],
  ['test:publish', 'publish-to-site.test.mjs'],
  ['test:open', 'auction-open.test.mjs'],
  ['test:forum', 'forum-close.test.mjs'],
  ['test:alesiev', 'alesiev-close.test.mjs'],
  ['test:thread', 'forum-thread.test.mjs'],
  ['test:harden', 'harden-sheet.test.mjs'],
  ['test:shopping', 'shopping-list.test.mjs'],
];

const results = [];
for (const [name, file] of suites) {
  console.log(`\n> site@0.0.0 ${name}\n> node scripts/${file}\n`);
  const r = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  results.push({ name, code: r.status ?? 1 });
}

const failed = results.filter((r) => r.code !== 0);
console.log('\n--- test:code summary ---');
for (const r of results) console.log(`${r.code === 0 ? 'ok  ' : 'FAIL'}    ${r.name}`);
console.log(failed.length
  ? `\n✗ FAIL — ${results.length - failed.length}/${results.length} suites passed`
  : `\n✓ OK — ${results.length}/${results.length} suites passed`);

process.exit(failed.length ? 1 : 0);
