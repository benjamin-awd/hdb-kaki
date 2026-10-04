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

const dollars = (s: string | null) => Number((s ?? '').replace(/[^\d.-]/g, ''));

test('the estimate is a plausible price inside its likely range', async ({ page }) => {
  // 88 Dawson Rd 4 ROOM at 990 sqft: a 2010s Queenstown block, resale ~$0.9m-$1.3m. The band
  // is wide on purpose (data refreshes move it); it catches $0, NaN, sign and unit slips.
  await page.goto('/my-flat-insights/?postal=142088&flat=4+ROOM&area=990');
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });
  const est = dollars(await page.locator('#val-big').textContent());
  const low = dollars(await page.locator('#val-low').textContent());
  const high = dollars(await page.locator('#val-high').textContent());
  expect(est).toBeGreaterThan(500_000);
  expect(est).toBeLessThan(2_500_000);
  expect(low).toBeLessThanOrEqual(est);
  expect(high).toBeGreaterThanOrEqual(est);
  await expect(page.locator('#pctile-pill')).toHaveText(/^\d+(st|nd|rd|th) percentile$/);
});

test('a flat type with no recent sales in town shows an empty state, not $0', async ({ page }) => {
  // Bukit Merah executive flats last resold in 2021, so there are no comps in 24 months.
  await page.goto('/my-flat-insights/?postal=160141&flat=EXECUTIVE');
  await expect(page.locator('#val-note')).toContainText('Not enough recent executive sales', {
    timeout: 60_000,
  });
  await expect(page.locator('#val-big')).toHaveText('—');
  await expect(page.locator('#val-range')).toBeHidden();
  await expect(page.locator('#b1-pill')).toHaveText('—');
  await expect(page.locator('#copy-link')).toBeDisabled();
  await expect(page.locator('#b2-v')).toHaveText('—');
});

test('an out-of-range floor area is refused with an inline error', async ({ page }) => {
  // A negative area in a share link falls back to the block's typical area...
  await page.goto('/my-flat-insights/?postal=142088&flat=4+ROOM&area=-500');
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });
  await expect(page.locator('#f-area')).not.toHaveValue('-500');
  expect(dollars(await page.locator('#val-big').textContent())).toBeGreaterThan(0);

  // ...and typing one clears the valuation and says why, without syncing it to the URL.
  await page.fill('#f-area', '50');
  await page.locator('#f-area').dispatchEvent('change');
  await expect(page.locator('#f-area-sub')).toHaveText('Enter 200 to 3,000 sqft');
  await expect(page.locator('#val-big')).toHaveText('—');
  await expect(page.locator('#val-note')).toContainText('floor area between 200 and 3,000');
  expect(page.url()).not.toContain('area=50');
});

test('an unknown storey in a share link keeps the default storey', async ({ page }) => {
  await page.goto('/my-flat-insights/?postal=142088&flat=4+ROOM&storey=99+TO+99&area=990');
  await expect(page.locator('#val-big')).not.toHaveText('—', { timeout: 60_000 });
  await expect(page.locator('#f-storey')).not.toHaveValue('');
  await expect(page.locator('#vs-storey')).not.toHaveText('n/a, too few');
});
