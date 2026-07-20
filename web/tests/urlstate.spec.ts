import { test, expect } from '@playwright/test';

// Shareable deep-links (#1) on Town Analysis: the URL both restores a view on load and
// tracks it live as filters change. See web/src/lib/urlState.ts.

test('a deep link restores the filtered view and boots DuckDB', async ({ page }) => {
  const duckdb = page.waitForRequest(/\/duckdb\//, { timeout: 45_000 });
  await page.goto('/town-analysis/?town=BEDOK&flat=5+ROOM&thr=0.15');

  // Restored controls reflect the query string...
  await expect(page.locator('#sel-town')).toHaveValue('BEDOK');
  await expect(page.locator('#sel-flat')).toHaveValue('5 ROOM');
  await expect(page.locator('#sel-thr')).toHaveValue('0.15');
  // ...and the map re-renders for the restored town (only possible via a DuckDB query,
  // since the snapshot only covers the default Ang Mo Kio).
  await expect(page.locator('#map-sub')).toContainText('Bedok', { timeout: 45_000 });
  await duckdb; // deviating params must boot the engine
});

test('changing a filter writes it to the URL live', async ({ page }) => {
  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  await page.selectOption('#sel-town', 'BEDOK');
  await expect
    .poll(() => page.evaluate(() => location.search), { timeout: 45_000 })
    .toContain('town=BEDOK');
});

test('clicking a town on the landing choropleth deep-links into Town Analysis', async ({
  page,
}) => {
  await page.goto('/');
  // Wait for the choropleth to paint (title is set inside renderMap).
  await expect(page.locator('#map-title')).toContainText('by town', { timeout: 20_000 });

  // Click over a town polygon on the canvas. The exact town doesn't matter, only that a
  // click on a colored region deep-links into Town Analysis. We try a few points across
  // the landmass (some spots are water / the un-HDB'd central catchment) until one lands.
  // Scroll the map into view first, then use page.mouse (not locator.click, whose
  // post-click stability wait hangs when the click triggers a navigation).
  const map = page.locator('#chart-map');
  await map.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500); // let the canvas settle after the scroll before hit-testing
  const box = (await map.boundingBox())!;
  const candidates = [
    [0.5, 0.62],
    [0.35, 0.6],
    [0.68, 0.55],
    [0.5, 0.48],
    [0.22, 0.6],
  ];
  for (const [fx, fy] of candidates) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    try {
      await page.waitForURL(/town-analysis\/?\?town=/, { timeout: 4000 });
      break;
    } catch {
      /* that point wasn't over a town — try the next */
    }
  }
  await expect(page).toHaveURL(/town-analysis\/?\?town=/);
});
