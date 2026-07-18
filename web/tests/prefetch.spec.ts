import { test, expect } from '@playwright/test';

// Regression guard for the landing-page DuckDB engine pre-warm.
//
// The landing (/) never queries DuckDB itself — it renders from overview.json. Its
// ONLY trigger for downloading + booting the WASM engine is the idle-time
// `prefetch()` call in index.astro. When `prefetch` was missing from src/lib/db.ts,
// that call threw a TypeError that `.catch(() => {})` swallowed, so the engine never
// warmed and the first click into an interactive page paid the full cold start.
//
// Crucially, unlike the interactive pages, the landing has NO `<link rel="prefetch">`
// for the wasm — so a network request for duckdb-eh.wasm proves the JS prefetch()
// path ran, not merely a declarative byte fetch. With the bug, no DuckDB request
// fires on the landing at all.
test('landing pre-warms the DuckDB engine on load, with no interaction', async ({ page }) => {
  const wasmReq = page.waitForRequest(/\/duckdb\/.*\/duckdb-eh\.wasm$/, { timeout: 45_000 });
  const manifestReq = page.waitForRequest(/\/data\/manifest\.json$/, { timeout: 45_000 });
  const parquetReq = page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });

  await page.goto('/');
  // Deliberately NO clicks or typing — the warm must happen on its own.

  // 1. The engine wasm is requested (prefetch -> getConn -> boot -> instantiate).
  const req = await wasmReq;
  const res = await req.response();
  expect(res, 'engine wasm should get a response').not.toBeNull();
  // 200 (not a 3xx) confirms it was served by src/worker.ts from the brotli asset,
  // not redirected to the jsDelivr fallback (which would mean the compressed asset
  // was missing). Content-Type is what WebAssembly.instantiateStreaming requires.
  expect(res!.status()).toBe(200);
  expect(res!.url()).toContain('/duckdb/');
  expect(res!.headers()['content-type']).toBe('application/wasm');

  // 2. manifest.json is fetched only from inside boot() (after a successful
  //    instantiate), so this proves prefetch drove a real boot — not just a byte
  //    fetch — and that the brotli-served wasm actually compiled.
  await manifestReq;

  // 3. read_parquet(...) in the CREATE VIEW pulls the data file: full end-to-end boot.
  await parquetReq;
});
