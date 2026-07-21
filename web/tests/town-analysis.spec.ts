import { test, expect } from '@playwright/test';

// Guards the town-analysis perf win: the default view must paint from the precomputed
// town-analysis.json snapshot, with the data worker entirely off the load path. The worker is
// only queried when the visitor changes a Town/Flat filter.

test('default view renders from JSON even with the data file blocked', async ({ page }) => {
  // Hard-block resale.parquet. If the default view still renders fully, it provably does not
  // depend on the data worker — the whole point of the precompute.
  await page.route(/\/data\/resale\.parquet$/, (r) => r.abort());

  await page.goto('/town-analysis/');

  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });
  await expect(page.locator('#map-sub')).toContainText('sales');
  await expect(page.locator('#median-price')).not.toHaveText('—');
  await expect(page.locator('#tbody-town tr').first()).toBeVisible();

  // URL-state must not run its restore/sync path on a bare, default URL: no params in,
  // no params written out. (Restore is gated on url.deviates(); a default load never syncs.)
  expect(await page.evaluate(() => location.search)).toBe('');
});

test('changing the Town filter re-queries in the worker and re-renders', async ({ page }) => {
  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  // Changing the town re-queries in the worker. It is pre-warmed on idle and holds the decoded
  // columns in memory, so the query resolves without a network request — the re-render is the
  // signal. 'Bedok' only appears if the query ran, since the default snapshot covers Ang Mo
  // Kio. (That the data file is fetched at all is guarded by prefetch.spec.ts.)
  await page.selectOption('#sel-town', 'BEDOK');
  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });
});
