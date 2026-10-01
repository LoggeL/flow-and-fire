import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { captureErrors, expectNoErrors, MAP_NAMES, openEditor, REPO_ROOT, screenshot } from './support/editor.ts';

for (const name of MAP_NAMES) {
  test(`unchanged ${name}: UI selection and download preserve every byte`, async ({ page, browserName }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');
    await page.getByTestId('select-map').selectOption(name);
    await page.waitForFunction((n) => window.__editor?.ready && window.__editor.mapName === n, name);
    const original = readFileSync(resolve(REPO_ROOT, `content/maps/${name}.rtsmap`));
    const sha = createHash('sha256').update(original).digest('hex');
    expect(await page.evaluate(() => window.__editor!.exportSha256())).toBe(sha);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('btn-save').click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(readFileSync(path!)).toEqual(original);
    expect(await page.evaluate(() => window.__editor!.issues().filter((i) => i.severity === 'error'))).toEqual([]);
    await screenshot(page, `roundtrip-${name}-${browserName}`);
    expectNoErrors(errors);
  });
}

test('file picker and drag/drop load a map through the visible IO path', async ({ page }) => {
  const errors = captureErrors(page);
  await openEditor(page, 'hollow-ridge');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('btn-open').click();
  await (await chooser).setFiles(resolve(REPO_ROOT, 'content/maps/tessera.rtsmap'));
  await page.waitForFunction(() => window.__editor?.ready && window.__editor.mapName === 'tessera');
  const bytes = Array.from(readFileSync(resolve(REPO_ROOT, 'content/maps/braidwater.rtsmap')));
  const transfer = await page.evaluateHandle((data) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(data)], 'braidwater.rtsmap', { type: 'application/octet-stream' }));
    return dt;
  }, bytes);
  await page.locator('#app').dispatchEvent('drop', { dataTransfer: transfer });
  await page.waitForFunction(() => window.__editor?.ready && window.__editor.mapName === 'braidwater');
  expectNoErrors(errors);
});
