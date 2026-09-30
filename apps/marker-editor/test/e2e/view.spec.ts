/**
 * Terrain view of the marker editor (TRACK-EDITOR P1): every map loads, renders several frames,
 * the canvas shows a real picture (not a single colour), camera input works and no console errors
 * occur — in chromium, firefox and webkit.
 */
import { expect, test } from '@playwright/test';
import { captureErrors, expectNoErrors, MAP_NAMES, MEASURED_LOCALLY, openEditor, screenshot, writeReport } from './support/editor.ts';
import { decodePng, pixelStats } from './support/png.ts';

test.describe('marker editor terrain view', () => {
  test('serves the map index', async ({ request }) => {
    const res = await request.get('/maps/index.json');
    expect(res.ok()).toBe(true);
    const index = (await res.json()) as { name: string; file: string; bytes: number }[];
    const names = index.map((e) => e.name);
    for (const m of MAP_NAMES) expect(names).toContain(m);
    expect(names).toEqual([...names].sort());
    for (const e of index) {
      expect(e.file).toBe(`${e.name}.rtsmap`);
      const bin = await request.get(`/maps/${e.file}`);
      expect(bin.ok()).toBe(true);
      expect((await bin.body()).length).toBe(e.bytes);
    }
  });

  for (const map of MAP_NAMES) {
    test(`renders ${map}`, async ({ page, browserName }) => {
      const errors = captureErrors(page);
      await openEditor(page, map);
      await expect(page.getByTestId('map-label')).toContainText('WU');

      // Wheel zoom towards the cursor, then back: two more frames through the real input path.
      const box = (await page.locator('#terrain').boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
      await page.mouse.wheel(0, -240);
      await page.evaluate(() => window.__editorView!.frame());
      await page.mouse.wheel(0, 240);
      await page.evaluate(() => window.__editorView!.frame());
      await page.evaluate(() => window.__editorView!.frame());

      const stats = await page.evaluate(() => window.__editorView!.stats());
      expect(stats.frames).toBeGreaterThanOrEqual(3);
      expect(stats.triangles).toBeGreaterThan(500_000);
      expect(stats.drawCalls).toBeGreaterThanOrEqual(2);

      const img = decodePng(await screenshot(page, `view-${map}-${browserName}`));
      const px = pixelStats(img);
      expect(px.dominantShare, 'canvas must not be a single colour').toBeLessThan(0.6);
      expect(px.distinctColors).toBeGreaterThan(200);
      expect(px.lumaStdDev).toBeGreaterThan(8);

      const loadMs = await page.evaluate(() => window.__editorView!.loadMs);
      const bench = await page.evaluate(() => window.__editorView!.benchFrames(60));
      expect(bench.frames).toBe(60);
      expect(bench.avgMs).toBeGreaterThanOrEqual(0);
      writeReport(`view-${map}-${browserName}`, { map, browser: browserName, loadMs, bench, stats, pixels: px, note: MEASURED_LOCALLY });
      expectNoErrors(errors);
    });
  }

  test('switches maps, pans and rotates; a missing map fails cleanly', async ({ page }) => {
    const errors = captureErrors(page);
    await openEditor(page, 'hollow-ridge');
    const before = await page.evaluate(() => window.__editorView!.stats().frames);
    await page.evaluate(() => window.__editorView!.load('setons'));
    expect(await page.evaluate(() => window.__editorView!.mapName)).toBe('setons');
    expect(await page.evaluate(() => window.__editorView!.stats().frames)).toBeGreaterThan(before);

    // Right-drag pan and keyboard pan change the picture.
    const a = decodePng(await page.locator('#terrain').screenshot());
    const box = (await page.locator('#terrain').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 60, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await page.locator('#terrain').focus();
    await page.keyboard.down('KeyE');
    await page.waitForTimeout(250);
    await page.keyboard.up('KeyE');
    await page.evaluate(() => window.__editorView!.frame());
    const b = decodePng(await page.locator('#terrain').screenshot());
    let changed = 0;
    for (let i = 0; i < a.data.length; i += 4 * 97) if (Math.abs(a.data[i]! - b.data[i]!) > 12) changed++;
    expect(changed).toBeGreaterThan(50);

    // A missing map reports an error but keeps the page alive (the error is expected here).
    const failed = await page.evaluate(() =>
      window.__editorView!.load('does-not-exist').then(
        () => 'ok',
        (e: unknown) => String(e),
      ),
    );
    expect(failed).toContain('404');
    errors.splice(0, errors.length, ...errors.filter((e) => !e.includes('404')));
    expectNoErrors(errors);
  });
});
