import { test, expect } from '@playwright/test';

// The data layer is fully self-hosted with no DuckDB engine: the page (and its bundles) must
// never request /duckdb/* or an external CDN, and interactive queries are answered by the
// worker from same-origin data. We assert the page-observable requests (bundle/chunk loads);
// the SharedWorker's own /data fetches aren't visible to Playwright, but a page bundle
// re-introducing DuckDB or a CDN would show up here.
test('no DuckDB or external-CDN requests; the worker answers queries', async ({ page }) => {
  const bad: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/duckdb/') || /extensions\.duckdb\.org|cdn\.jsdelivr\.net/.test(u)) bad.push(u);
  });

  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  // A filter change is answered by the worker and re-renders — proof the data loaded.
  await page.selectOption('#sel-town', 'BEDOK');
  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });

  expect(bad, `unexpected engine/CDN requests: ${JSON.stringify(bad)}`).toEqual([]);
});
