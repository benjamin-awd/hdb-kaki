import { test, expect } from '@playwright/test';

// Nearest-MRT distance + nearby amenities on My Flat Insights. Resolving a postal draws the
// flat, its nearest station, and a straight-line dash to it (computed on-device). This asserts
// the observable end state: a station marker, a line, and the strip's distance lead + "to
// <Station> MRT" line.

test('shows straight-line distance to the nearest MRT', async ({ page }) => {
  await page.goto('/my-flat-insights/');

  // 821308 is a high-volume Punggol block (same fixture as the valuation spec).
  await page.fill('#f-postal', '821308');
  await page.click('#get-insights');

  // Wait for the valuation so we know resolveBlock() + compute() have run.
  await expect(page.locator('#f-postal-sub')).toContainText('Punggol', { timeout: 45_000 });

  // The strip reveals once the nearest station resolves.
  const strip = page.locator('#ins-walk');
  await expect(strip).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#ins-walk-lead')).toContainText(/^\d+(\.\d+)?\s*(m|km)$/);
  await expect(page.locator('#ins-walk-main')).toContainText(/to .+ (MRT|LRT)/);
  await expect(page.locator('#ins-walk-sub')).toContainText(/straight-line/);

  // The station marker (divIcon) and the distance line are both on the map.
  await expect(page.locator('.mrt-pin')).toHaveCount(1);
  await expect(page.locator('.leaflet-overlay-pane svg path')).not.toHaveCount(0);

  // Toggling an amenity category draws its nearby pins on the map.
  await page.locator('.am-chip[data-cat="supermarket"]').click();
  await expect(page.locator('.am-pin').first()).toBeVisible();

  await page.locator('.ins-map-col').screenshot({ path: 'test-results/nearest-mrt.png' });
});
