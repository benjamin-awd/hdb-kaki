import { test, expect } from '@playwright/test';

// The town-analysis street filter: the dropdown is populated from the snapshot on load
// (no data worker), defaults to "All streets", and selecting a street queries the worker to
// re-render the map for that street only.

test('street dropdown is populated from the snapshot on load', async ({ page }) => {
  await page.route(/\/data\/resale\.parquet$/, (r) => r.abort());

  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

  const street = page.locator('#sel-street');
  await expect(street.locator('option')).not.toHaveCount(1); // more than just "All streets"
  await expect(street.locator('option').first()).toHaveText('All streets');
});

test('selecting a street re-queries in the worker and narrows the map', async ({ page }) => {
  await page.goto('/town-analysis/');
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });
  const allStreetsSub = await page.locator('#map-sub').textContent();

  // Pick the first real street (index 1 skips the "All streets" default).
  const firstStreet = await page.locator('#sel-street option').nth(1).getAttribute('value');
  // The worker is pre-warmed on idle and holds the decoded columns in memory, so selecting a
  // street re-queries without a network request — the narrowed re-render is the signal.
  await page.selectOption('#sel-street', firstStreet!);

  // Still the same town, but a single street is a strict subset of the town's sales.
  await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 45_000 });
  await expect(page.locator('#map-sub')).not.toHaveText(allStreetsSub!);
});
