import { test, expect } from '@playwright/test';

// Flat Insights end-to-end: the postal field autofocuses so the first action is obvious,
// and entering a real postal drives the worker (resolveBlock → valuation) to value the flat.
//
// Note: the on-load worker *warm* (warmWhenIdle) can't be asserted here — it runs in a
// SharedWorker whose network traffic Playwright's page API doesn't observe. So this asserts
// the observable end state instead: a query resolves and the valuation renders.

test('autofocuses the postal field so the first action is obvious', async ({ page }) => {
  await page.goto('/my-flat-insights/');
  await expect(page.locator('#f-postal')).toBeFocused();
});

test('resolves a postal and values the flat via the worker', async ({ page }) => {
  await page.goto('/my-flat-insights/');

  // 821308 is a high-volume Punggol block. Entering it + Get insights runs resolveBlock()
  // and compute() against the worker; the block sub-label and a non-placeholder valuation
  // prove the worker loaded the data and answered.
  await page.fill('#f-postal', '821308');
  await page.click('#get-insights');

  await expect(page.locator('#f-postal-sub')).toContainText('Punggol', { timeout: 45_000 });
  await expect(page.locator('#val-big')).not.toHaveText('—');
});

test('values a young block in a mixed-age town against similar-lease sales', async ({ page }) => {
  await page.goto('/my-flat-insights/');

  // 270026 (26 Ghim Moh Link, 2013 lease) sits in Queenstown among 1970s blocks. The estimate
  // matches on lease, and the older blocks nearby get their own comparables section.
  await page.fill('#f-postal', '270026');
  await page.click('#get-insights');
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 45_000 });
  await expect(page.locator('#f-lease')).toHaveText(/^\d+ yr$/);
  await expect(page.locator('#val-hint')).toContainText('similar lease');

  for (let i = 0; i < 60 && !(await page.locator('#comp-next').isDisabled()); i++)
    await page.click('#comp-next');
  await expect(page.locator('#comp-body .cs-lab').last()).toHaveText('Older flats nearby');
  await expect(page.locator('#comp-body .cs-n').last()).toContainText('psf');
});
