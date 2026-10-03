import { test, expect } from '@playwright/test';

// Nearest-MRT distance + nearby amenities on My Flat Insights. Resolving a postal draws the
// flat, its nearest station, and a straight-line dash to it (computed on-device). This asserts
// the observable end state: a station marker, a line, and the station card's headline (name,
// distance, walk time) plus its nearby-stations list.

test('shows straight-line distance to the nearest MRT', async ({ page }) => {
  await page.goto('/my-flat-insights/');

  // 821308 is a high-volume Punggol block (same fixture as the valuation spec).
  await page.fill('#f-postal', '821308');
  await page.click('#get-insights');

  // Wait for the valuation so we know resolveBlock() + compute() have run.
  await expect(page.locator('#f-postal-sub')).toContainText('Punggol', { timeout: 45_000 });

  // The station card reveals once the nearest station resolves.
  const card = page.locator('#ins-walk');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#sc-name')).not.toBeEmpty();
  await expect(page.locator('#sc-dist')).toContainText(/^\d+(\.\d+)?$/);
  await expect(page.locator('#sc-unit')).toContainText(/^(m|km)$/);
  await expect(page.locator('#sc-walk')).toContainText(/min walk/);
  // The nearby list carries the nearest station (a line badge + a "~N min" walk time).
  await expect(page.locator('#sc-nearby .sc-row').first()).toBeVisible();
  await expect(page.locator('#sc-nearby .sc-row-min').first()).toContainText(/~\d+ min/);

  // The nearest station marker (divIcon) and the distance line are both on the map, and the
  // next-nearest stations show as smaller secondary pins.
  await expect(page.locator('.mrt-pin')).toHaveCount(1);
  await expect(page.locator('.mrt-pin-sec').first()).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane svg path')).not.toHaveCount(0);

  // Amenity chips start engaged, so the map already shows nearby places: single pins, or a
  // cloverleaf cluster where several sit close together (which one depends on density and zoom).
  const amenityMarkers = page.locator('.am-pin, .am-clover');
  await expect(amenityMarkers.first()).toBeVisible();

  // Turning every category off clears the layer; turning one back on redraws it.
  for (const cat of ['hawker', 'supermarket', 'mall']) {
    await page.locator(`.am-chip[data-cat="${cat}"]`).click();
  }
  await expect(amenityMarkers).toHaveCount(0);
  const supermarkets = page.locator('.am-chip[data-cat="supermarket"]');
  await supermarkets.click();
  await expect(supermarkets).toHaveAttribute('aria-pressed', 'true');
  await expect(amenityMarkers.first()).toBeVisible();

  await page.locator('.ins-map-col').screenshot({ path: 'test-results/nearest-mrt.png' });
});
