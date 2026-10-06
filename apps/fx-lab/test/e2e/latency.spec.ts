/**
 * MS5 "VFX ≤ 1 Frame": an effect triggered between two frames is part of the very next presented
 * frame. `triggerBigExplosion()` spawns the commander explosion; the lab's rAF callback for the next
 * frame was registered before ours, so after our rAF callback that frame has been rendered and its
 * sample must already count the new particles.
 */
import { expect, test } from '@playwright/test';
import { expectHealthy, openLab, waitFrames } from './support/lab.ts';

/** Minimum rise of alive particles in the next frame (the priority-0 core alone has 112 particles). */
export const MIN_RISE = 50;

test('big explosion visible in the next frame', async ({ page }) => {
  const log = await openLab(page, { scene: 'big' });
  await expectHealthy(page, log, 'big');
  await waitFrames(page, 5);
  const r = await page.evaluate(async () => {
    const h = window.__fxlab!;
    const alive = (): number => h.stats().fx.particles?.alive ?? 0;
    // Trigger right after a frame, so a whole frame interval lies between trigger and next frame.
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
    const before = alive();
    const frame0 = h.frame;
    const n0 = h.samples().length;
    h.triggerBigExplosion();
    await new Promise<void>((res) => requestAnimationFrame(() => res()));
    const s = h.samples();
    return { before, frame0, frame1: h.frame, n0, n1: s.length, nextAlive: s[s.length - 1]?.particlesAlive ?? -1, error: h.error };
  });
  test.info().annotations.push({ type: 'latency', description: JSON.stringify(r) });
  expect(r.error).toBeNull();
  expect(r.frame1 - r.frame0, 'exactly one frame rendered between trigger and check').toBe(1);
  expect(r.nextAlive - r.before, 'alive particles rose in the next presented frame').toBeGreaterThanOrEqual(MIN_RISE);
});
