/**
 * Particle cap per preset (TRACK-RENDERFX acceptance, PLAN §3.7 priorities): the battle with preset
 * low (cap 8.192) overloads the ring budget → priority-2 particles are dropped first, priority 0 never;
 * alive stays ≤ cap plus the documented priority-0 overshoot.
 */
import { expect, test } from '@playwright/test';
import { expectHealthy, labStats, openLab } from './support/lab.ts';

/** Preset cap of `low` (RENDER_PRESETS.low.caps.particles). */
export const LOW_PARTICLE_CAP = 8192;

/**
 * Documented priority-0 overshoot: priority 0 is never dropped, so alive may exceed the cap by the
 * priority-0 particles alive at once – per commander explosion 1 flash + ≤ 110 fireball + 1 ring = 112
 * (docs/status/rfx-p3-particles.md). The battle has one commander per army → at most 2 × 112, rounded
 * up to 256.
 */
export const PRIO0_OVERSHOOT = 256;

test('battle with preset=low: the cap drops priority 2 first, never priority 0', async ({ page }) => {
  const log = await openLab(page, { scene: 'battle', preset: 'low', freeze: 10 });
  await expectHealthy(page, log, 'battle');
  const st = await labStats(page);
  expect(st.fx.particles, 'battle has a particle system').not.toBeNull();
  const p = st.fx.particles!;
  test.info().annotations.push({ type: 'particles', description: `alive ${p.alive} / cap ${p.cap}, dropped ${p.dropped.join('/')}, culled ${p.culled}` });
  expect(p.cap).toBe(LOW_PARTICLE_CAP);
  expect(p.dropped[2], 'priority-2 particles dropped (cap reached)').toBeGreaterThan(0);
  expect(p.dropped[0], 'priority 0 is never dropped').toBe(0);
  expect(p.alive, 'alive ≤ cap + priority-0 overshoot').toBeLessThanOrEqual(p.cap + PRIO0_OVERSHOOT);
  expect(p.alive, 'the cap is actually used').toBeGreaterThan(p.cap / 2);
});
