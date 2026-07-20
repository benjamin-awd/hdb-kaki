import { test, expect } from '@playwright/test';

// Guards against the double download of the ~4.7 MB engine. psf-trends warms DuckDB on
// load; that warm both downloads and instantiates the wasm. A stray <link rel="prefetch">
// for the same wasm used to fire a SECOND download (the prefetch cache isn't reused by
// the worker's instantiate fetch), so the engine came down twice. It must be exactly once.
test('the engine wasm is downloaded exactly once on a page that boots on load', async ({
  page,
}) => {
  const wasmReqs: string[] = [];
  page.on('request', (r) => {
    if (/\/duckdb\/.*\/duckdb-eh\.wasm$/.test(r.url())) wasmReqs.push(r.url());
  });

  await page.goto('/psf-trends/');
  // The data file is fetched only after a successful instantiate, so by now every
  // wasm request that will happen has happened.
  await page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });
  await page.waitForTimeout(300); // settle any late duplicate

  expect(wasmReqs.length, `wasm fetched ${wasmReqs.length}x: ${JSON.stringify(wasmReqs)}`).toBe(1);
});
