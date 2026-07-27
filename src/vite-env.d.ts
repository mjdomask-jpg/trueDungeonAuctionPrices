/// <reference types="vite/client" />

// Injected by vite.config.ts at build time: the ISO-8601 commit date (with
// offset) of the last commit that touched public/data/prices.csv — i.e. when
// the prices were last updated. Empty string when git history is unavailable.
declare const __PRICES_UPDATED__: string;
