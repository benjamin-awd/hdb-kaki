import { test, expect } from '@playwright/test';

// The data is fully self-hosted: interactive queries read resale.parquet same-origin in a
// Web Worker, with no cross-origin CDN dependency. This guards that we never regress to
// pulling data or an engine from an external host. (Replaces the old DuckDB parquet-extension
// test, which checked a self-hosted DuckDB extension that no longer exists.)
test('interactive queries use same-origin data, never an external CDN', async ({ page }) => {
  let externalHit = false;
  await page.route(/extensions\.duckdb\.org|cdn\.jsdelivr\.net/, (r) => {
    externalHit = true;
    return r.abort();
  });

  const parquetReq = page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });

  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  // The idle warm pulls the data file, same-origin.
  const req = await parquetReq;
  const res = await req.response();
  expect(res?.status(), 'parquet served 200 from our origin').toBe(200);
  expect(new URL(req.url()).host, 'data is same-origin').toBe(new URL(page.url()).host);

  // A filter change re-queries in the worker and re-renders — proof the data loaded and no
  // external host was needed.
  await page.selectOption('#sel-town', 'BEDOK');
  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });
  expect(externalHit, 'must never hit an external CDN').toBe(false);
});
