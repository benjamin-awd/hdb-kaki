import { test, expect } from '@playwright/test';

// Guards against a double download of resale.parquet. psf-trends warms the worker on load
// (fetch + decode); the worker holds the decoded columns in memory, so a filter change
// re-queries from memory rather than re-fetching. The file must come down exactly once.
test('resale.parquet is fetched exactly once on a page that warms on load', async ({ page }) => {
  const reqs: string[] = [];
  page.on('request', (r) => {
    if (/\/data\/resale\.parquet$/.test(r.url())) reqs.push(r.url());
  });

  await page.goto('/psf-trends/');
  await page.waitForRequest(/\/data\/resale\.parquet$/, { timeout: 45_000 });

  // A filter change re-queries from the in-memory columns — it must NOT refetch the file.
  await page.selectOption('#sel-town', 'BEDOK');
  await expect(page.locator('#chart-title')).toContainText('Bedok', { timeout: 45_000 });
  await page.waitForTimeout(500); // settle any late duplicate

  expect(reqs.length, `parquet fetched ${reqs.length}x: ${JSON.stringify(reqs)}`).toBe(1);
});
