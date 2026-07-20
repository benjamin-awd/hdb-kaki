import { test, expect } from '@playwright/test';

// Guards the town-analysis perf win: the default view must paint from the precomputed
// town-analysis.json snapshot, with DuckDB entirely off the load path. DuckDB is only
// booted when the visitor changes a Town/Flat filter.

test('default view renders from JSON even with DuckDB + parquet blocked', async ({ page }) => {
  // Hard-block the engine and the data file. If the default view still renders fully,
  // it provably does not depend on DuckDB — the whole point of the precompute.
  await page.route(/\/duckdb\//, (r) => r.abort());
  await page.route(/\/data\/resale\.parquet$/, (r) => r.abort());

  await page.goto('/town-analysis/');

  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });
  await expect(page.locator('#map-sub')).toContainText('sales');
  await expect(page.locator('#median-price')).not.toHaveText('—');
  await expect(page.locator('#tbody-town tr').first()).toBeVisible();
});

test('changing the Town filter boots DuckDB and re-renders', async ({ page }) => {
  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  // Changing the town re-queries via DuckDB. The engine is pre-warmed on idle and the
  // whole parquet is buffered into memory, so the query resolves without a network
  // request — the re-render is the signal. 'Bedok' only appears if the query ran, since
  // the default snapshot covers Ang Mo Kio. (That the data file is fetched at all is
  // guarded by prefetch.spec.ts / wasm-single-fetch.spec.ts.)
  await page.selectOption('#sel-town', 'BEDOK');
  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });
});
