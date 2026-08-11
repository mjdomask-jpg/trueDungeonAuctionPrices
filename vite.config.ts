import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Resolve against this config's own directory, not process.cwd(): the dev
// server may be launched from elsewhere, and both the git call and the mtime
// fallback must point at the real repo/file regardless.
const ROOT = dirname(fileURLToPath(import.meta.url))
const PRICES = join(ROOT, 'public', 'data', 'prices.csv')

// When was prices.csv last updated? It has no timestamp column and the built
// site is static, so capture it here at build time: the committer date of the
// last commit that touched the file. Needs full git history on CI (the deploy
// workflow sets fetch-depth: 0); if git is unavailable we fall back to the
// file's mtime so the footer still shows something reasonable.
function pricesUpdatedISO(): string {
  try {
    const iso = execSync('git log -1 --format=%cI -- public/data/prices.csv', {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    if (iso) return iso;
  } catch {
    // fall through to mtime
  }
  try {
    return statSync(PRICES).mtime.toISOString();
  } catch {
    return '';
  }
}

// https://vite.dev/config/
// base: './' makes all asset + data paths relative, so the site works when
// GitHub Pages serves it from https://<user>.github.io/<repo>/ (a subpath).
export default defineConfig({
  base: './',
  // Honour a PORT from the environment when one is set (e.g. a preview harness
  // assigning a free port so two dev servers can run side by side); otherwise
  // fall through to Vite's default 5173.
  server: { port: Number(process.env.PORT) || undefined },
  plugins: [react()],
  define: {
    __PRICES_UPDATED__: JSON.stringify(pricesUpdatedISO()),
  },
})
