import { test, expect } from '@playwright/test';

// Guards that the parquet extension is self-hosted: read_parquet must work with
// extensions.duckdb.org hard-blocked, loading the brotli-staged copy that
// src/worker.ts serves (via SET custom_extension_repository + compress-duckdb.mjs).
test('read_parquet uses the self-hosted extension, not extensions.duckdb.org', async ({ page }) => {
  let upstreamHit = false;
  await page.route(/extensions\.duckdb\.org/, (r) => {
    upstreamHit = true;
    return r.abort();
  });

  const extReq = page.waitForRequest(
    /\/duckdb\/.*\/ext\/.*parquet\.duckdb_extension\.wasm$/,
    { timeout: 45_000 },
  );

  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  // A filter change boots DuckDB and runs read_parquet → autoloads the extension.
  await page.selectOption('#sel-town', 'BEDOK');

  const req = await extReq;
  const res = await req.response();
  expect(res?.status(), 'extension served 200 from our origin').toBe(200);
  expect(new URL(req.url()).host, 'extension is same-origin').toBe(new URL(page.url()).host);

  // The query completed and re-rendered — proof the self-hosted extension loaded.
  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });
  expect(upstreamHit, 'must never touch extensions.duckdb.org').toBe(false);
});
