import { test, expect } from '@playwright/test';

// Guards the flat-insights form-card layout. Each field stacks label / value /
// sub-label; the postal code renders at 26px while the other values are 17px.
// Because the three cells in a grid row share a height (the divider lines), a
// naive layout pushes that size difference into an uneven gap (a ragged
// caption line or a ragged label-to-value gap). The fix gives every value the
// same fixed-height box so all cells share one structure.
//
// Rather than pixel-snapshot the card (brittle across font rendering), we assert
// the layout INVARIANTS directly from getBoundingClientRect: within each row the
// value baselines, the caption tops, and the label-to-value gaps must all match.
// This is deterministic and catches both failure modes described above.

const TOL = 2; // px; absorbs cross-browser sub-pixel rounding, well under a visible gap

type Box = { top: number; bottom: number };
type Field = { name: string; row: number; label: Box; value: Box; sub: Box };

async function readFields(page: import('@playwright/test').Page): Promise<Field[]> {
  return page.$$eval('.form-grid .field', (fields) => {
    const box = (el: Element | null): { top: number; bottom: number } => {
      const b = (el as HTMLElement).getBoundingClientRect();
      return { top: b.top, bottom: b.bottom };
    };
    return fields.map((f) => ({
      name: (f.querySelector('label')?.textContent || '').trim(),
      row: Math.round(f.getBoundingClientRect().top),
      label: box(f.querySelector('label')),
      value: box(f.querySelector('input, select, .val')),
      sub: box(f.querySelector('.sub')),
    }));
  });
}

const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

test('flat-insights form card: values and sub-labels align within each row', async ({ page }) => {
  await page.goto('/my-flat-insights/');
  await expect(page.locator('.form-grid .field').first()).toBeVisible();

  // Populate every field exactly the way the page's resolve()/onFlatChange() do
  // (select via <option>, subs via textContent, inputs via value). Injecting keeps
  // this a hermetic LAYOUT test that asserts the CSS contract without depending on
  // the dataset or which postal happens to be most common.
  await page.evaluate(() => {
    const $ = (id: string) => document.getElementById(id) as HTMLElement;
    ($('f-postal') as HTMLInputElement).value = '821308';
    $('f-postal-sub').textContent = '308A Punggol Walk · Punggol';
    $('f-flat').innerHTML = '<option>4 ROOM</option>';
    $('f-flat-sub').textContent = 'Premium Apartment';
    $('f-storey').innerHTML = '<option>10 TO 12</option>';
    ($('f-area') as HTMLInputElement).value = '990';
    $('f-area-sub').textContent = '≈ typical for this block';
    $('f-lease').textContent = '89 yr';
    $('f-lease-sub').textContent = 'Commenced 2016';
    $('f-model').textContent = 'Premium Apartment';
  });

  const fields = await readFields(page);
  expect(fields.length).toBeGreaterThanOrEqual(6);

  // group cells into their visual rows
  const rows = new Map<number, Field[]>();
  for (const f of fields) {
    const key = [...rows.keys()].find((k) => Math.abs(k - f.row) < 4) ?? f.row;
    rows.set(key, [...(rows.get(key) ?? []), f]);
  }

  for (const [, cells] of rows) {
    if (cells.length < 2) continue;
    const label = (m: string) =>
      `[row @${cells[0].row}px: ${cells.map((c) => c.name).join(', ')}] ${m}`;

    // 1. value baselines share a bottom edge
    expect(
      spread(cells.map((c) => c.value.bottom)),
      label('value.bottom spread'),
    ).toBeLessThanOrEqual(TOL);
    // 2. sub-labels line up
    expect(spread(cells.map((c) => c.sub.top)), label('sub.top spread')).toBeLessThanOrEqual(TOL);
    // 3. the gap between label and value is uniform (the reported "funny gap")
    expect(
      spread(cells.map((c) => c.value.top - c.label.bottom)),
      label('label→value gap spread'),
    ).toBeLessThanOrEqual(TOL);
    // 4. the gap between value and caption is uniform
    expect(
      spread(cells.map((c) => c.sub.top - c.value.bottom)),
      label('value→caption gap spread'),
    ).toBeLessThanOrEqual(TOL);
  }

  // A native <select> insets its text by a browser-specific amount that bounding
  // boxes can't see, pushing the value right of the label. The fix relies on
  // appearance:none + zero left padding, so guard those directly.
  const selects = await page.$$eval('.form-grid .field select', (els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, paddingLeft: s.paddingLeft };
    }),
  );
  expect(selects.length).toBeGreaterThan(0);
  for (const s of selects) {
    expect(s.appearance, 'select must drop native appearance (it insets text)').toBe('none');
    expect(parseFloat(s.paddingLeft), 'select must be flush-left with the label').toBe(0);
  }
});
