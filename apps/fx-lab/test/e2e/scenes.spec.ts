/**
 * Every fx-lab scene with `freeze=T` (deterministic image): ready, no page/GL errors, `__fxlab.error`
 * null, canvas not uniform, screenshot test-results/fx-lab-e2e/shots/<scene>-<browser>.png, plus
 * scene-specific checks (TRACK-RENDERFX acceptance: battle particles + FX draw budget, big explosion
 * shake + HDR/bloom highlights, 20 shields with ripples, gallery with every Varkan effect).
 */
import { expect, test } from '@playwright/test';
import { VARKAN_EFFECTS } from '@faf/render-fx';
import { FX_DRAW_LIMIT, TOTAL_DRAW_LIMIT } from '../../scripts/bench/scenarios.ts';
import { regionDiff } from '../../scripts/bench/png.ts';
import { MIN_LUMA_SPREAD, canvasShot, centreRegion, expectHealthy, labStats, openLab, regionStats } from './support/lab.ts';

/**
 * A gallery tile counts as visible when at least this many pixels of its screen box change by ≥ 16
 * per channel between fx=1 and fx=0 (same frozen frame; units, props and decals are identical).
 * 25 px ≈ a 5×5 blob: small impacts are small at RTS distance by design (gallery = real size).
 */
const MIN_TILE_CHANGED_PX = 25;

/** Freeze time per scene (s): late enough that the scene is in full swing. */
export const SCENE_FREEZE = { lighting: 6, battle: 12, shields: 6, big: 1.3, gallery: 3 } as const;

test.describe('fx-lab scenes', () => {
  test('lighting: shadows, scorch decals, post', async ({ page }, info) => {
    const log = await openLab(page, { scene: 'lighting', freeze: SCENE_FREEZE.lighting });
    await expectHealthy(page, log, 'lighting');
    const st = await labStats(page);
    expect(st.csm.enabled).toBe(true);
    expect(st.decals.count).toBeGreaterThan(0);
    expect(st.post.hdr, 'HDR scene target (EXT_color_buffer_float is available on the test machine)').toBe(true);
    const shot = await canvasShot(page, 'lighting', info);
    expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
  });

  test('battle: 2×200 units, > 3.000 particles, FX draws within budget', async ({ page }, info) => {
    const log = await openLab(page, { scene: 'battle', freeze: SCENE_FREEZE.battle });
    await expectHealthy(page, log, 'battle');
    const st = await labStats(page);
    const p = st.fx.particles;
    expect(p, 'battle has a particle system').not.toBeNull();
    expect(p!.alive, 'particles alive').toBeGreaterThan(3000);
    const fxDraws = st.drawsBySeg.shields + st.drawsBySeg.particles + st.drawsBySeg.beams;
    expect(fxDraws, 'FX draws (shields + particles + beams)').toBeLessThanOrEqual(FX_DRAW_LIMIT);
    expect(st.draws, 'total draws').toBeLessThanOrEqual(TOTAL_DRAW_LIMIT);
    expect(st.units, 'units alive').toBeGreaterThanOrEqual(380);
    expect(st.post.hdr).toBe(true);
    const shot = await canvasShot(page, 'battle', info);
    expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
  });

  test('shields: 20 shields under fire with active ripples', async ({ page }, info) => {
    const log = await openLab(page, { scene: 'shields', freeze: SCENE_FREEZE.shields });
    await expectHealthy(page, log, 'shields');
    const st = await labStats(page);
    expect(st.fx.shields, 'shield pass').not.toBeNull();
    expect(st.fx.shields!.count).toBe(20);
    expect(st.fx.shields!.ripplesActive, 'ripples from hits').toBeGreaterThan(0);
    expect(st.drawsBySeg.shields, 'all shields in one draw').toBe(1);
    const shot = await canvasShot(page, 'shields', info);
    expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
  });

  test('big: commander explosion with camera shake and HDR highlights', async ({ page }, info) => {
    const log = await openLab(page, { scene: 'big', freeze: SCENE_FREEZE.big });
    await expectHealthy(page, log, 'big');
    const st = await labStats(page);
    expect(st.shakeActive, 'camera shake active at t = 1.3 s').toBe(true);
    expect(st.fx.particles?.alive ?? 0, 'explosion particles').toBeGreaterThan(200);
    expect(st.post.hdr).toBe(true);
    const shot = await canvasShot(page, 'big', info);
    expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
    // Fireball + bloom: many (near) white pixels around the image centre.
    const centre = regionStats(shot, centreRegion(0.2));
    info.annotations.push({ type: 'centre', description: `bright ${(centre.brightFraction * 100).toFixed(1)} %, fire ${(centre.fireFraction * 100).toFixed(1)} %, mean luma ${centre.meanLuma.toFixed(0)}` });
    expect(centre.brightFraction, 'bright pixels (luma ≥ 235) in the central 40 %').toBeGreaterThan(0.03);
    expect(centre.meanLuma, 'centre brighter than the whole image').toBeGreaterThan(shot.stats.meanLuma);
  });

  test('gallery: every Varkan effect registered and visible', async ({ page }, info) => {
    const log = await openLab(page, { scene: 'gallery', freeze: SCENE_FREEZE.gallery });
    await expectHealthy(page, log, 'gallery');
    const st = await labStats(page);
    const scene = st.scene;
    info.annotations.push({ type: 'scene-stats', description: JSON.stringify(scene) });
    expect(VARKAN_EFFECTS.length).toBeGreaterThanOrEqual(18);
    expect(scene['effects'], 'gallery shows every effect of the library').toBe(VARKAN_EFFECTS.length);
    expect(st.fx.particles?.alive ?? 0).toBeGreaterThan(0);
    const shot = await canvasShot(page, 'gallery', info);
    expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
    // Per tile: the same frozen frame without transparent FX must differ inside the tile's box.
    const markers = await page.evaluate(() => window.__fxlab!.markers());
    expect(markers.length, 'one marker per effect tile (acu_explosion + acu_aftermath share one)').toBe(VARKAN_EFFECTS.length - 1);
    const log0 = await openLab(page, { scene: 'gallery', freeze: SCENE_FREEZE.gallery, fx: 0 });
    await expectHealthy(page, log0, 'gallery');
    const bare = await canvasShot(page, 'gallery-nofx', info);
    const rows: string[] = [];
    const invisible: string[] = [];
    for (const m of markers) {
      const region = { x0: m.x - m.rx, y0: m.y - m.ry * 1.6, x1: m.x + m.rx, y1: m.y + m.ry };
      const d = regionDiff(shot.img, bare.img, region);
      const px = Math.round(d.changedFraction * d.pixels);
      rows.push(`${m.id} ${px} px (${(d.changedFraction * 100).toFixed(1)} %)`);
      expect(m.x > 0 && m.x < 1 && m.y > 0 && m.y < 1, `tile ${m.id} on screen`).toBe(true);
      if (px < MIN_TILE_CHANGED_PX) invisible.push(`${m.id} (${px} px)`);
    }
    info.annotations.push({ type: 'tiles changed by FX', description: rows.join(', ') });
    expect(invisible, `tiles without visible FX (< ${MIN_TILE_CHANGED_PX} changed px)`).toEqual([]);
  });
});
