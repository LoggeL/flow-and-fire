import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test } from './support/silent-test.ts';
import { SERVERS, attachJson, captureErrors, expectNoErrors } from './support/game.ts';

/** Reads actual browser screenshot pixels, including post-processing, at the same fixed camera. */
async function sceneLuminance(page: import('@playwright/test').Page, path: string): Promise<number> {
  const bytes = await page.screenshot({ path });
  return page.evaluate(async png => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(png)], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0); image.close();
    const pixels = ctx.getImageData(Math.floor(canvas.width / 2) - 64, Math.floor(canvas.height / 2) - 64, 128, 128).data;
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += .2126 * pixels[i]! + .7152 * pixels[i + 1]! + .0722 * pixels[i + 2]!;
    return sum / (128 * 128);
  }, Array.from(bytes));
}

for (const server of SERVERS) test(`pre-revealed terrain/water with authoritative local vision, ${server.name}`, async ({ page }, info) => {
  const errors = captureErrors(page);
  await page.goto(`${server.url}?mode=skirmish&map=hollow-ridge&autostart=0&transport=${server.transport}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1' && window.__faf?.ready);
  expect(await page.evaluate(() => window.__faf!.paused)).toBe(true);
  expect(await page.evaluate(() => window.__faf!.transport)).toBe(server.transport);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().visibilityFog.active)).toBe(true);
  const own = await page.evaluate(() => ({ grid: window.__faf!.visibility()!, fog: window.__faf!.renderStats().visibilityFog }));
  expect(own.grid.viewer).toBe(0); expect(own.grid.dim).toBe(64);
  expect(own.fog.unknown).toBe(0); expect(own.fog.explored).toBeGreaterThan(0); expect(own.fog.visible).toBeGreaterThan(0);
  expect(own.grid.cells.every(cell => cell === 1 || cell === 2)).toBe(true);
  expect(own.fog.draws).toBe(2);
  await expect(page.locator('[data-testid="minimap"], [data-testid="minimap-surface"], [data-component="Minimap"]')).toHaveCount(0);

  // This dim, pre-revealed terrain is far from both Commanders. Wait for the camera to reach the
  // rendered framebuffer before comparing pixels; changing its CPU state is insufficient.
  const cameraRenderedAt = await page.evaluate(() => {
    const h = window.__faf!; h.setCamera(400, 100, 60); return h.renderStats().frames + 2;
  });
  await page.waitForFunction(frame => window.__faf!.renderStats().frames >= frame, cameraRenderedAt);
  expect(own.grid.cells[12 * 64 + 50]).toBe(1);
  const before = await sceneLuminance(page, info.outputPath('dim-terrain-scene.png'));
  await page.evaluate(() => window.__faf!.ctl({ t: 'viewer', army: -1 }));
  await expect.poll(() => page.evaluate(() => window.__faf!.visibility()?.viewer)).toBe(-1);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().visibilityFog.enabled)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().drawsByPass.fog)).toBe(0);
  await expect(page.locator('[data-testid="minimap"], [data-testid="minimap-surface"], [data-component="Minimap"]')).toHaveCount(0);
  const revealed = await sceneLuminance(page, info.outputPath('observer-scene.png'));
  expect(revealed, 'actual screenshot pixels brighten when authoritative observer Fog is all-visible').toBeGreaterThan(before * 2);

  await page.evaluate(() => window.__faf!.ctl({ t: 'viewer', army: 1 }));
  await expect.poll(() => page.evaluate(() => window.__faf!.visibility()?.viewer)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().visibilityFog.active)).toBe(true);
  const enemy = await page.evaluate(() => window.__faf!.visibility()!);
  expect(enemy.cells).not.toEqual(own.grid.cells);
  expect(enemy.epoch).toBeGreaterThan(own.grid.epoch);
  await page.evaluate(() => window.__faf!.ctl({ t: 'viewer', army: 0 }));
  await expect.poll(() => page.evaluate(() => window.__faf!.visibility()?.cells)).toEqual(own.grid.cells);
  await expect(page.locator('[data-testid="minimap"], [data-testid="minimap-surface"], [data-component="Minimap"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelector<HTMLCanvasElement>('#game-canvas')!.getContext('webgl2')!.getError())).toBe(0);
  await assertSilentOutput(page); expectNoErrors(errors);
  await attachJson(info, 'visibility', { own: own.fog, enemyViewer: enemy.viewer, gridDim: own.grid.dim, minimapAbsent: true, pixelLuminance: { dimTerrain: before, observer: revealed } });
});
