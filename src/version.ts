// The site's version, shown in the footer. Tied to features, in X.N form:
// bump the MINOR (1.1, 1.2, … 1.10, 1.11) whenever a page gains a feature — a
// new chart, a new filter, and so on; bump the MAJOR only on explicit
// instruction. This is independent of the data-freshness line in the footer,
// which is derived (build-time git date for prices, runtime for the auction).
export const APP_VERSION = '2.0';
