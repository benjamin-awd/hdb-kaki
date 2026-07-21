import { test, expect } from '@playwright/test';

// Guards the My Flat Insights load behaviour. The page auto-loads no valuation, so nothing
// queries data on load; the ONLY trigger to warm the hyparquet Web Worker is the idle-time
// warmWhenIdle() in the page script. These pin what must stay true: the worker still warms on
// load, unprompted (manifest + parquet fetched, no /duckdb/*), and the cursor lands in the
// postal field so the first action is obvious.
test('warms the data worker on load, with no interaction', async ({ page }) => {
  const manifestReq = page.waitForRequest(/\/data\/manifest\.json$/, { timeout: 45_000 });
  const parquetReq = page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });
  let duckdbHit = false;
  page.on('request', (r) => {
    if (r.url().includes('/duckdb/')) duckdbHit = true;
  });

  await page.goto('/my-flat-insights/');
  // Deliberately NO clicks or typing — the idle warm must run on its own.

  await manifestReq;
  const req = await parquetReq;
  const res = await req.response();
  expect(res, 'parquet should get a response').not.toBeNull();
  expect(res!.status()).toBe(200);
  expect(duckdbHit, 'no DuckDB engine requests — the engine is retired').toBe(false);
});

test('autofocuses the postal field so the first action is obvious', async ({ page }) => {
  await page.goto('/my-flat-insights/');
  await expect(page.locator('#f-postal')).toBeFocused();
});
