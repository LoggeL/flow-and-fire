/**
 * Roundtrip of the checked-in maps through the real UI (TRACK-EDITOR P7): every map is opened via
 * the map selection (select-map), saved unchanged with "Speichern" and the download must be
 * byte-identical with content/maps/<name>.rtsmap — in chromium, firefox and webkit.
 * The markers.json export (mapc format) carries the same marker counts.
 * The overview screenshot of each map lands in test-results/marker-editor/.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { bytesEqual, downloadVia, hashOf, mapFile, saveDownload, waitForMap } from './support/actions.ts';
import { captureErrors, expectNoErrors, MAP_NAMES, openEditor, screenshot } from './support/editor.ts';
import { decodePng, pixelStats } from './support/png.ts';

/** mapSimHash goldens of the checked-in maps (unchanged by the track). */
const MAP_SIM_HASH: Readonly<Record<(typeof MAP_NAMES)[number], number>> = {
  'hollow-ridge': 0x90ec94f0,
  tessera: 0x22cb60a8,
  braidwater: 0xeeaec694,
  setons: 0x52eccf92,
};

test.describe('marker editor roundtrip of the checked-in maps', () => {
  test('open every map via the map selection and save it unchanged', async ({ page, browserName }) => {
    const errors = captureErrors(page);
    // Start on setons so that every map of the loop (setons last) is a real switch of the selection.
    await openEditor(page, 'setons');
    const select = page.getByTestId('select-map');
    await expect(select).toBeEnabled();
    // More bundled maps than the four are fine; the four must be offered.
    const values = await select.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    for (const m of MAP_NAMES) expect(values).toContain(m);

    for (const name of MAP_NAMES) {
      await select.selectOption(name);
      await waitForMap(page, name);
      await expect(select).toHaveValue(name);
      await expect(page.getByTestId('status-dirty')).toHaveAttribute('data-dirty', 'false');

      const original = mapFile(name);
      expect(await page.evaluate(() => window.__editor!.exportHash())).toBe(hashOf(original));
      expect(await page.evaluate(() => window.__editor!.mapSimHash())).toBe(MAP_SIM_HASH[name]);
      expect(await page.evaluate(() => window.__editor!.undoDepth())).toBe(0);

      const saved = await saveDownload(page);
      expect(saved.fileName).toBe(`${name}.rtsmap`);
      expect(saved.bytes.length).toBe(original.length);
      expect(bytesEqual(saved.bytes, original), `${name}: download must equal content/maps/${name}.rtsmap`).toBe(true);

      // markers.json export (mapc format): one download with the map's markers in WU.
      const mj = await downloadVia(page, 'btn-export-markers');
      expect(mj.suggestedFilename()).toMatch(/markers\.json$/);
      const markers = JSON.parse(readFileSync(await mj.path(), 'utf8')) as { starts: unknown[]; mass: unknown[]; hydro: unknown[] };
      const c = await page.evaluate(() => window.__editor!.counts());
      expect([markers.starts.length, markers.mass.length, markers.hydro.length]).toEqual([c.starts, c.mass, c.hydro]);

      // editor.json export (marker overlay of the map source directory, applied by pnpm maps).
      const ov = await downloadVia(page, 'btn-export-overlay');
      expect(ov.suggestedFilename()).toBe('editor.json');
      const overlay = JSON.parse(readFileSync(await ov.path(), 'utf8')) as { editorOverlay: number; starts: unknown[]; spots: unknown[] };
      expect([overlay.editorOverlay, overlay.starts.length, overlay.spots.length]).toEqual([1, c.starts, c.mass + c.hydro]);

      // Existing maps carry no errors (warnings/info are allowed; see validation.spec).
      const errorCount = await page.evaluate(() => window.__editor!.issues().filter((i) => i.severity === 'error').length);
      expect(errorCount).toBe(0);

      await page.evaluate(() => window.__editor!.waitForRender());
      const img = decodePng(await screenshot(page, `map-${name}-${browserName}`));
      const px = pixelStats(img);
      expect(px.dominantShare, 'screenshot must not be a single colour').toBeLessThan(0.6);
      expect(px.distinctColors).toBeGreaterThan(200);
    }
    expectNoErrors(errors);
  });
});
