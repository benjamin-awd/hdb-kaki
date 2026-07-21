import { test, expect } from '@playwright/test';

// Export a result (#3) on My Flat Insights: deep-link restore, copy-link, comps CSV, and
// the printable one-page summary. Postal 142088 = 88 Dawson Rd, Queenstown (has 4 ROOM).
const DEEP_LINK = '/my-flat-insights/?postal=142088&flat=4+ROOM&area=990&lease=60';

test('a deep link restores the form and computes a valuation', async ({ page }) => {
  await page.goto(DEEP_LINK);

  // A valuation is computed (val-big leaves its "—" placeholder)...
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });
  // ...and the URL-supplied area/lease survive resolveBlock()/onFlatChange()'s auto-fill,
  // which is the ordering bug this restore path guards against.
  await expect(page.locator('#f-area')).toHaveValue('990');
  await expect(page.locator('#f-lease')).toHaveValue('60');
  await expect(page.locator('#f-flat')).toHaveValue('4 ROOM');
});

test('copy-link shows the confirmation toast', async ({ page }) => {
  await page.goto(DEEP_LINK);
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });

  // The toast is the visible confirmation regardless of whether the clipboard API or the
  // execCommand fallback did the copy, so we don't depend on clipboard permissions here.
  await expect(page.locator('#copy-toast')).toBeHidden();
  await page.click('#copy-link');
  await expect(page.locator('#copy-toast')).toBeVisible();
});

test('downloading the comps CSV emits my-flat-comps.csv', async ({ page }) => {
  await page.goto(DEEP_LINK);
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });

  const download = page.waitForEvent('download', { timeout: 20_000 });
  await page.click('#dl-comps');
  expect((await download).suggestedFilename()).toBe('my-flat-comps.csv');
});

test('print media reveals the one-page summary and hides the app shell', async ({ page }) => {
  await page.goto(DEEP_LINK);
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-summary')).toBeVisible();
  await expect(page.locator('#ps-est')).not.toHaveText('—');
  // The on-screen hero (postal form) is hidden for print.
  await expect(page.locator('.hero')).toBeHidden();
});
