/**
 * Context loss (TRACK-RENDERFX acceptance): battle → loseContext → restoreContext → all FX resources
 * (particle ring, LUT, scorch textures, shield mesh, post targets, CSM cache) work again: restoreCount 1,
 * frames keep running, particles alive and visible, no errors, image not black. With `freeze` the scene
 * state is identical before and after, so the image must be (almost) the same – particles lost on the
 * GPU side would show as a difference.
 */
import { expect, test } from '@playwright/test';
import { meanAbsDiff } from '../../scripts/bench/png.ts';
import { MIN_LUMA_SPREAD, canvasShot, expectHealthy, hookState, labStats, openLab, waitFrames } from './support/lab.ts';

/** Mean absolute channel difference (0..255) tolerated between the frozen frame before and after the restore. */
export const RESTORE_MAX_DIFF = 3;

test('battle survives a WebGL context loss', async ({ page }, info) => {
  const log = await openLab(page, { scene: 'battle', freeze: 8 });
  await expectHealthy(page, log, 'battle');
  const before = await canvasShot(page, 'context-before', info);
  const aliveBefore = (await labStats(page)).fx.particles?.alive ?? 0;
  expect(aliveBefore).toBeGreaterThan(0);

  log.expectLoss = true;
  const lost = await page.evaluate(() => window.__fxlab!.loseContext());
  test.skip(!lost, 'WEBGL_lose_context is not available in this browser');
  // The loss is delivered asynchronously; restoreContext() returns false until it was observed.
  await page.waitForFunction(() => window.__fxlab!.restoreContext() || window.__fxlab!.restoreCount > 0, undefined, { timeout: 15_000, polling: 100 });
  await page.waitForFunction(() => window.__fxlab!.restoreCount > 0, undefined, { timeout: 15_000 });
  await waitFrames(page, 10);
  log.expectLoss = false;

  const h = await expectHealthy(page, log, 'battle');
  expect(h.restoreCount).toBe(1);
  const st = await labStats(page);
  expect(st.fx.particles?.alive ?? 0, 'particles alive after the restore').toBeGreaterThan(0);
  const after = await canvasShot(page, 'context-restored', info);
  expect(after.stats.lumaSpread, 'image after restore not uniform').toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
  expect(after.stats.meanLuma, 'image after restore not black').toBeGreaterThan(20);
  const diff = meanAbsDiff(before.img, after.img);
  info.annotations.push({ type: 'restore-diff', description: `mean |Δ| ${diff.toFixed(2)} / 255` });
  expect(diff, 'frozen frame identical before and after the restore').toBeLessThan(RESTORE_MAX_DIFF);
  // Frames keep running after the checks as well.
  const f = (await hookState(page)).frame;
  await waitFrames(page, 5);
  expect((await hookState(page)).frame).toBeGreaterThanOrEqual(f + 5);
});
