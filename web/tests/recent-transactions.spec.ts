import { test, expect } from '@playwright/test';

// The landing recent-transactions table: default page paints from overview.json (no data
// worker), and block letters in addresses are uppercased (311c -> 311C). Filtering or paging
// past page 1 queries the worker and re-renders.

test('default page renders from JSON with block letters uppercased, data file blocked', async ({
  page,
}) => {
  await page.route(/\/data\/resale\.parquet$/, (r) => r.abort());

  await page.goto('/');

  // 20 rows on the first page (matches RECENT_PAGE_SIZE / PAGE_SIZE).
  await expect(page.locator('#tbody-recent tr')).toHaveCount(20, { timeout: 20_000 });
  await expect(page.locator('#recent-foot')).toContainText('Showing 1–20 of');

  // Block + lane letter suffixes stay uppercase; the rest is title-cased.
  const firstAddr = page.locator('#tbody-recent tr').first().locator('td').nth(2);
  await expect(firstAddr).toHaveText('138A Lor 1A Toa Payoh');

  // Prev disabled on page 1; Next enabled.
  await expect(page.locator('#rec-prev')).toBeDisabled();
  await expect(page.locator('#rec-next')).toBeEnabled();
});

test('paging Next queries the worker and advances the window', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#recent-foot')).toContainText('Showing 1–20 of', { timeout: 20_000 });

  // The worker is warmed on idle and holds the decoded columns in memory, so paging resolves
  // from memory — the advanced window is the signal, not a resale.parquet fetch.
  await page.click('#rec-next');
  await expect(page.locator('#recent-foot')).toContainText('Showing 21–40 of', { timeout: 45_000 });
  await expect(page.locator('#rec-prev')).toBeEnabled();
});

test('changing the flat-type filter resets to page 1 and narrows the set', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#recent-foot')).toContainText('Showing 1–20 of', { timeout: 20_000 });
  const allTypesFoot = await page.locator('#recent-foot').textContent();

  await page.selectOption('#rec-flat', '3 ROOM');

  await expect(page.locator('#recent-foot')).toContainText('Showing 1–', { timeout: 45_000 });
  // A single flat type must be a strict subset of all transactions.
  await expect(page.locator('#recent-foot')).not.toHaveText(allTypesFoot!);
  await expect(page.locator('#tbody-recent tr').first().locator('td').nth(3)).toHaveText('3 ROOM');
});
