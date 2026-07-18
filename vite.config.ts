import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base: './' makes all asset + data paths relative, so the site works when
// GitHub Pages serves it from https://<user>.github.io/<repo>/ (a subpath).
export default defineConfig({
  base: './',
  plugins: [react()],
})
