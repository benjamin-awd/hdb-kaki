// Lighthouse CI config — the guard that actually enforces "pages stay fast".
//
// Runs against the REAL production serving path: `bun run build` (compresses the
// DuckDB engine + emits ./dist) then `wrangler dev`, so src/worker.ts serves the
// brotli'd /duckdb/*.wasm exactly as in prod — same rationale as playwright.config.ts.
//
// What we gate on, and why:
//   • HARD errors  → first-party RESOURCE SIZES (script/stylesheet/font/document).
//     These are deterministic (bytes are bytes) and are exactly what a dependency
//     bump or an accidental un-code-split import blows up. Baselines (mobile preset,
//     max across all four pages): script ~306KB, font 112KB, stylesheet 12KB,
//     document 5KB. Budgets sit ~50% above baseline so normal churn passes but a
//     real regression (e.g. shipping a charting lib twice) fails the build.
//   • WARN only    → field METRICS (LCP/TBT/CLS/perf score). On CI runners these are
//     runner- and network-dependent, and here they're dominated by things we don't
//     control: town-analysis LCP is ~40s (Leaflet map tiles from a third-party CDN),
//     psf-trends CLS ~0.16 (chart reflow). Gating on them would be flaky red; as
//     warnings they still surface regressions in the job log + report links.
//
// The `total`/`other` byte weight is mostly the DuckDB wasm (~8MB) + parquet shards
// (~4MB) that every page now pre-warms — that's the whole point of the engine, so we
// only warn on total-byte-weight (a coarse "did something huge get added" tripwire),
// never error.
module.exports = {
  ci: {
    collect: {
      // LHCI boots the server itself and waits for wrangler's ready line, then tears
      // it down after the run — no separate background step needed in the workflow.
      // --live-reload=false is load-bearing: wrangler injects a live-reload websocket
      // into every HTML response, and under Lighthouse that intermittently reset the
      // main-document navigation into a Chrome interstitial (CHROME_INTERSTITIAL_ERROR),
      // failing the run. Disabling it made 12/12 navigations pass vs. failing within a
      // handful with it on. --show-interactive-dev-session=false keeps CI output clean.
      startServerCommand:
        'bunx wrangler dev --port 8788 --ip 127.0.0.1 --live-reload=false --show-interactive-dev-session=false',
      startServerReadyPattern: 'Ready on http',
      startServerReadyTimeout: 120000,
      url: [
        'http://127.0.0.1:8788/',
        'http://127.0.0.1:8788/psf-trends',
        'http://127.0.0.1:8788/town-analysis',
        'http://127.0.0.1:8788/my-flat-insights',
      ],
      // One run per URL. The hard gates are deterministic resource sizes (identical
      // every run), and the metrics are warn-only, so extra runs buy no signal — they
      // only lengthen CI (town-analysis is ~40s/run, dominated by third-party map
      // tiles) and hammer wrangler's single-threaded dev server with back-to-back
      // heavy DuckDB loads, which intermittently reset the next navigation into a
      // Chrome interstitial. One run sidesteps that.
      numberOfRuns: 1,
    },
    assert: {
      assertions: {
        // --- Hard gates: first-party transfer sizes (bytes) ---
        'resource-summary:script:size': ['error', { maxNumericValue: 471040 }], // 460 KB
        'resource-summary:stylesheet:size': ['error', { maxNumericValue: 40960 }], // 40 KB
        'resource-summary:font:size': ['error', { maxNumericValue: 163840 }], // 160 KB
        'resource-summary:document:size': ['error', { maxNumericValue: 20480 }], // 20 KB

        // --- Visibility only: field metrics (never fail the build) ---
        'categories:performance': ['warn', { minScore: 0.6 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 4000 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 6000 }],
        'total-blocking-time': ['warn', { maxNumericValue: 600 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.2 }],
        'total-byte-weight': ['warn', { maxNumericValue: 16777216 }], // 16 MB
      },
    },
    upload: {
      // Posts each report to Google's temporary public storage and prints the URLs
      // in the job log — no server or token to run. Data here is public HDB data.
      target: 'temporary-public-storage',
    },
  },
};
