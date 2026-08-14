import { test, expect } from '@playwright/test';

// Regression guards for the price choropleth (Market Overview) and the town-analysis subtown
// drill-down added alongside it. These cover the bugs that actually bit during development:
//   - the overview map's zoom-driven town→subzone level-of-detail switch,
//   - the `zone` deep-link param applying to the subtown select (a rename once left it stale),
//   - the point-in-polygon subtown filter reducing the visible sales,
//   - a plain town deep-link actually painting that town (not staying on the default snapshot).

const salesCount = (mapSub: string) => Number(mapSub.match(/([\d,]+) sales/)![1].replace(/,/g, ''));

test.describe('overview price choropleth', () => {
  test('zooming in auto-switches town → subzone level, reset returns to town', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chart-map canvas', { timeout: 20_000 });
    await expect(page.locator('#map-title')).toContainText('by town', { timeout: 20_000 });

    // Each + step multiplies the view zoom by 1.5 from the ~1.82 base; a few crosses the LOD
    // threshold and the choropleth reloads at subzone granularity.
    for (let i = 0; i < 4; i++) {
      await page.locator('#map-zoom-in').click();
      await page.waitForTimeout(300);
    }
    await expect(page.locator('#map-title')).toContainText('by subzone', { timeout: 20_000 });

    // Reset snaps back to the town overview and re-enables the auto switch.
    await page.locator('#map-zoom-reset').click();
    await expect(page.locator('#map-title')).toContainText('by town', { timeout: 20_000 });
  });
});

test.describe('town-analysis subtown drill-down', () => {
  test('a plain town deep-link paints that town, not the default snapshot', async ({ page }) => {
    // Default snapshot is Ang Mo Kio; a deep link must override it (regression: the map once
    // stayed stuck on the default while only the sidebar updated).
    await page.goto('/town-analysis/?town=BEDOK');
    await expect(page.locator('#sel-town')).toHaveValue('BEDOK', { timeout: 45_000 });
    await expect(page.locator('#map-sub')).toContainText('Bedok');
    await expect(page.locator('#map-sub')).not.toContainText('Ang Mo Kio');
  });

  test('a subtown deep-link selects the subtown and filters the sales to it', async ({ page }) => {
    // Whole-town count first, to prove the subtown filter strictly reduces it.
    await page.goto('/town-analysis/?town=TOA%20PAYOH');
    await expect(page.locator('#map-sub')).toContainText('Toa Payoh', { timeout: 45_000 });
    const townCount = salesCount(await page.locator('#map-sub').innerText());

    await page.goto('/town-analysis/?town=TOA%20PAYOH&zone=TOA%20PAYOH%20WEST');
    // The `zone` param must reach the subtown select (guards the stale-applyKey regression).
    await expect(page.locator('#sel-town')).toHaveValue('TOA PAYOH', { timeout: 45_000 });
    await expect(page.locator('#sel-sub')).toHaveValue('TOA PAYOH WEST');
    await expect(page.locator('#map-sub')).toContainText('Toa Payoh West');

    // Point-in-polygon keeps only the subzone's sales — some, but fewer than the whole town.
    const subCount = salesCount(await page.locator('#map-sub').innerText());
    expect(subCount).toBeGreaterThan(0);
    expect(subCount).toBeLessThan(townCount);
  });

  test('selecting a subtown writes ?zone=, clearing it restores the town view', async ({ page }) => {
    await page.goto('/town-analysis/');
    await expect(page.locator('#map-sub')).toContainText('Ang Mo Kio', { timeout: 20_000 });

    // Option 0 is "All subtowns"; option 1 is the first real subzone.
    const sub = await page.locator('#sel-sub option').nth(1).getAttribute('value');
    await page.selectOption('#sel-sub', sub!);
    await expect(page).toHaveURL(new RegExp('[?&]zone='), { timeout: 45_000 });
    await expect(page.locator('#sel-sub')).toHaveValue(sub!);

    await page.selectOption('#sel-sub', '__all');
    await expect(page).not.toHaveURL(/[?&]zone=/);
  });
});
