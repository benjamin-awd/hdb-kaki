import { test, expect } from '@playwright/test';

// My Flat Insights end-to-end: the postal field autofocuses so the first action is obvious,
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

test('lease dropdown re-filters the comps without moving the estimate', async ({ page }) => {
  await page.goto('/my-flat-insights/');

  // 270026 (26 Ghim Moh Link, 2013 lease) sits in Queenstown among 1970s blocks, so the town
  // has both similar-lease and much older comps to switch between.
  await page.fill('#f-postal', '270026');
  await page.click('#get-insights');
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 45_000 });

  const lease = page.locator('#f-comp-lease');
  await expect(lease).toHaveValue('similar');
  await expect(page.locator('#comp-note')).toBeHidden();
  const estimate = await page.locator('#val-big').textContent();

  const oldest = await lease
    .locator('option[value]:not([value="similar"]):not([value="any"])')
    .first()
    .getAttribute('value');
  await lease.selectOption(oldest!);
  await expect(page.locator('#comp-foot')).toContainText(
    `${oldest}–${Number(oldest) + 9} yrs left`,
  );
  await expect(page.locator('#comp-note')).toBeVisible();
  await expect(page.locator('#val-big')).toHaveText(estimate!);
});
