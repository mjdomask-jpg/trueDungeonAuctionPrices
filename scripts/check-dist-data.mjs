// Postbuild guard: every file in public/data must reach dist/data intact.
// Usage: node scripts/check-dist-data.mjs   (wired to npm `postbuild`)
//
// Vite copies public/ verbatim, so in the normal case this proves a no-op.
// It earns its keep on the abnormal ones: a data file hand-edited inside dist/
// (which the next build silently discards), a stale file left in dist/ after
// being renamed or removed from public/, or a build that ran before the CSVs
// were synced from the root exports. All three ship a site whose data disagrees
// with the source of truth, and none of them fail the build on their own.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'public', 'data');
const OUT = join(ROOT, 'dist', 'data');

const list = (dir) => {
  try {
    return readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};

const src = list(SRC);
const out = list(OUT);
const problems = [];

if (src === null) problems.push(`public/data does not exist — expected the site's data source there`);
if (out === null) problems.push(`dist/data does not exist — did the build run?`);

if (src && out) {
  const outSet = new Set(out);
  const srcSet = new Set(src);
  for (const f of src) if (!outSet.has(f)) problems.push(`${f}: missing from dist/data`);
  // A file in dist with no counterpart in public survived a rename or delete;
  // the site would still serve it.
  for (const f of out) if (!srcSet.has(f)) problems.push(`${f}: stale in dist/data (no longer in public/data)`);
  for (const f of src) {
    if (!outSet.has(f)) continue;
    const a = readFileSync(join(SRC, f));
    const b = readFileSync(join(OUT, f));
    if (!a.equals(b)) {
      const detail = a.length === b.length
        ? 'same size, differing bytes'
        : `${a.length} vs ${b.length} bytes`;
      problems.push(`${f}: content differs (${detail})`);
    }
  }
}

if (problems.length) {
  console.error(`\ndist/data check FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\ndist/ is build output: fix the file in public/data and rebuild.\n`);
  process.exit(1);
}

console.log(`dist/data check: ${src.length} file(s) match public/data`);
