import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readRtsMap } from '@faf/formats';
import { expect, test } from '@playwright/test';
import { createValidator } from '../../src/validate/index.ts';
import { captureErrors, clickWorld, expectNoErrors, openEditor, REPO_ROOT, screenshot } from './support/editor.ts';

// Discover locations from the real heightfield and rules, avoiding fragile hand-picked terrain.
const map = readRtsMap(new Uint8Array(readFileSync(resolve(REPO_ROOT, 'content/maps/hollow-ridge.rtsmap'))));
const validate = createValidator();
const locations: Record<string, [number, number]> = {};
for (let z = 32; z < map.meta.sizeWu - 32; z += 8) {
  for (let x = 32; x < map.meta.sizeWu - 32; x += 8) {
    const issues = validate({ ...map, meta: { ...map.meta, spots: [...map.meta.spots, { kind: 'mass', x: x * 4096, z: z * 4096 }] } });
    for (const code of ['spot-in-water', 'spot-not-flat']) {
      if (locations[code] === undefined && issues.some((i) => i.code === code && i.severity === 'error' && i.refs.some((r) => r.type === 'spot' && r.index === map.meta.spots.length))) locations[code] = [x, z];
    }
    if (locations['spot-in-water'] !== undefined && locations['spot-not-flat'] !== undefined) break;
  }
  if (locations['spot-in-water'] !== undefined && locations['spot-not-flat'] !== undefined) break;
}
// Use the broad central river bed, away from the waterline where pixel rounding can land on dry shore.
locations['spot-in-water'] = [256, 256];
locations['spot-edge'] = [5, 256];

for (const code of ['spot-in-water', 'spot-not-flat', 'spot-edge']) {
  test(`visible ${code} issue selects its marker and undo removes it`, async ({ page, browserName }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');
    const location = locations[code];
    expect(location).toBeDefined();
    await page.getByTestId('tool-mass').click();
    await clickWorld(page, ...location!);
    const row = page.locator(`[data-testid="issue-row"][data-code="${code}"][data-severity="error"]`).last();
    await expect(row).toBeVisible();
    await row.click();
    const selection = await page.evaluate(() => window.__editor!.store.selection.peek());
    expect(selection.some((r) => r.type === 'spot' && r.index === map.meta.spots.length)).toBe(true);
    await screenshot(page, `validation-${code}-${browserName}`);
    await page.locator('#terrain').focus();
    await page.keyboard.press('Control+z');
    await expect(page.locator(`[data-testid="issue-row"][data-code="${code}"][data-severity="error"]`)).toHaveCount(0);
    expectNoErrors(errors);
  });
}
