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

  // A filter change is the first thing that should ever hit the data file.
  const parquet = page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });
  await page.selectOption('#sel-town', 'BEDOK');
  await parquet;

  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });
});
