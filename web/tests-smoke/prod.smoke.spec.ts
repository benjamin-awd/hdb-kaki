import { test, expect, type Page } from '@playwright/test';

// Production smoke tests — run against the LIVE deployed site (see playwright.smoke.config.ts),
// on a schedule and after each production deploy. They answer one question: "is the app up and
// actually serving data right now?" That covers the failure modes the pre-merge E2E suite can't
// — a bad fresh-data edge case in the daily rebuild, or a Cloudflare/edge outage.
//
// Every assertion is a data-drift-proof INVARIANT, never a pinned value, so the daily dataset
// refresh never reds these: a page returns 200, renders without an uncaught JS error, and its
// core data-driven element resolves to a real (non-placeholder "—") value. The DuckDB-WASM data
// worker is exercised through the observable UI it powers, not asserted directly.

// Fail loudly on any uncaught page exception during the check — a booting engine or render that
// throws is exactly the kind of prod breakage this suite exists to catch.
function failOnPageError(page: Page): void {
  page.on('pageerror', (err) => {
    throw new Error(`Uncaught page error: ${err.message}`);
  });
}

// Assert navigation returned a 2xx so a 500/404 from the edge fails clearly (rather than only
// surfacing later as a missing element).
async function gotoOk(page: Page, path: string): Promise<void> {
  const res = await page.goto(path);
  expect(res, `no response for ${path}`).not.toBeNull();
  expect(res!.ok(), `${path} returned HTTP ${res!.status()}`).toBe(true);
}

test('landing page serves recent transactions and the data worker pages', async ({ page }) => {
  failOnPageError(page);
  await gotoOk(page, '/');

  // First page paints from static overview.json.
  await expect(page.locator('#recent-foot')).toContainText('Showing 1–20 of');
  await expect(page.locator('#tbody-recent tr')).toHaveCount(20);

  // Paging past page 1 queries the DuckDB-WASM worker — advancing the window proves the engine
  // booted and answered end-to-end (register shards → create view → query), the deepest signal
  // that the deployed data path is healthy.
  await page.click('#rec-next');
  await expect(page.locator('#recent-foot')).toContainText('Showing 21–40 of');
});

test('town analysis resolves the default town valuation', async ({ page }) => {
  failOnPageError(page);
  await gotoOk(page, '/town-analysis/');

  // Default town (Ang Mo Kio) label + a non-placeholder median prove the choropleth data and the
  // per-town query both resolved.
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio');
  await expect(page.locator('#median-price')).not.toHaveText('—');
});

test('psf trends renders the default scatter and stats', async ({ page }) => {
  failOnPageError(page);
  await gotoOk(page, '/psf-trends/');

  await expect(page.locator('#chart-title')).toContainText('Ang Mo Kio');
  await expect(page.locator('#stat-psf')).not.toHaveText('—');
});

test('my flat insights values a real block via the worker', async ({ page }) => {
  failOnPageError(page);
  await gotoOk(page, '/my-flat-insights/');

  // 821308 is a high-volume Punggol block. resolveBlock() + compute() against the worker is
  // data-driven (independent of the OneMap walk-route widget, which can 403), so the block
  // sub-label and a non-placeholder valuation are a stable signal the worker loaded and answered.
  await page.fill('#f-postal', '821308');
  await page.click('#get-insights');

  await expect(page.locator('#f-postal-sub')).toContainText('Punggol');
  await expect(page.locator('#val-big')).not.toHaveText('—');
});
