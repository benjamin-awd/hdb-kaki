import { test, expect } from '@playwright/test';

// Guards the psf-trends perf win: the default view must paint from the precomputed
// psf-trends.json snapshot, with the data worker entirely off the load path. The worker is
// only queried when the visitor changes a filter or zooms.

test('default view renders from JSON even with the data file blocked', async ({ page }) => {
  await page.route(/\/data\/resale\.parquet$/, (r) => r.abort());

  await page.goto('/psf-trends/');

  await expect(page.locator('#chart-title')).toContainText('Ang Mo Kio', { timeout: 20_000 });
  await expect(page.locator('#scatter-note')).toContainText('transactions');
  await expect(page.locator('#stat-psf')).not.toHaveText('—');
});

test('changing the Town filter re-queries in the worker and re-renders', async ({ page }) => {
  await page.goto('/psf-trends/');
  await expect(page.locator('#chart-title')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  // The worker is pre-warmed on idle and holds the decoded columns in memory, so the town
  // change re-queries without a network request — the chart re-render is the signal. (That the
  // data file is fetched at all is guarded by prefetch.spec.ts.)
  await page.selectOption('#sel-town', 'BEDOK');
  await expect(page.locator('#chart-title')).toContainText('Bedok', { timeout: 45_000 });
});
