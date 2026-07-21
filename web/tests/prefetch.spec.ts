import { test, expect } from '@playwright/test';

// Regression guard for the landing-page data-worker pre-warm.
//
// The landing (/) never queries data itself — it renders from overview.json. Its ONLY
// trigger to warm the hyparquet Web Worker (fetch + decode resale.parquet) is the idle-time
// warmWhenIdle() in index.astro. If that regressed, the first click into a filter/pager would
// pay the full cold fetch + decode instead of resolving from the worker's memory.
//
// The worker's warm fetches manifest.json (always) and resale.parquet (on a cold cache), so a
// network request for the parquet on load — with no interaction — proves the warm ran. There
// is no /duckdb/* request anymore: the DuckDB engine is retired.
test('landing warms the data worker on load, with no interaction', async ({ page }) => {
  const manifestReq = page.waitForRequest(/\/data\/manifest\.json$/, { timeout: 45_000 });
  const parquetReq = page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });
  let duckdbHit = false;
  page.on('request', (r) => {
    if (r.url().includes('/duckdb/')) duckdbHit = true;
  });

  await page.goto('/');
  // Deliberately NO clicks or typing — the idle warm must run on its own.

  await manifestReq;
  const req = await parquetReq;
  const res = await req.response();
  expect(res, 'parquet should get a response').not.toBeNull();
  // 200 (whole-file fetch) served same-origin by the assets host.
  expect(res!.status()).toBe(200);
  expect(new URL(req.url()).host, 'data is same-origin').toBe(new URL(page.url()).host);
  expect(duckdbHit, 'no DuckDB engine requests — the engine is retired').toBe(false);
});
