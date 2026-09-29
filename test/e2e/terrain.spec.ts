import { expect, test } from '@playwright/test';
import { attachJson, captureErrors, COI_URL, expectNoErrors, HOLLOW_RIDGE, openGame, SERVERS, waitTick, writeReport } from './support/game.ts';
import { colorShare, decodePng, pixelStats } from './support/png.ts';
import { CLEAR_RGB, checkSpot, checkWater, settle } from './support/terrain.ts';

// Terrain (M1, M2, M4 in the game on hollow-ridge):
// - heights on CPU (rules.sampleHeightRaw via ClientMap) and GPU (TERRAIN_HEIGHT_GLSL, R16UI +
//   texelFetch, renderer.probeTerrainHeights) are bit-identical in 10,000 samples (always gated);
// - every unit stands on the terrain: frame y (cur and prev) == CPU height at its frame position,
//   also after driving down the plateau cliff;
// - deep water is water-colored, mass (green) and hydro (cyan) spot decals are visible (pixels at
//   the projected positions), the start view is terrain (not the clear color, not one color).

for (const server of SERVERS) {
  test(`terrain: CPU == GPU (10.000), Einheiten auf dem Terrain, Wasser und Spots sichtbar – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    await waitTick(page, 10);

    // CPU == GPU in 10,000 pseudo-random samples (seed per browser/server).
    const seed = (testInfo.project.name.length * 7919 + (server.coi ? 17 : 29)) >>> 0;
    const probe = await page.evaluate((s) => window.__faf!.probeHeights(10_000, s), seed);
    expect(probe.n).toBe(10_000);
    expect(probe.mismatches, JSON.stringify(probe.first)).toBe(0);

    // Units on the terrain at rest …
    const rest = await page.evaluate(() => window.__faf!.unitHeights());
    expect(rest.units).toBe(1024);
    expect(rest.mismatches, JSON.stringify(rest.first)).toBe(0);
    expect(rest.prevMismatches).toBe(0);
    // … and while driving down from the plateau (24 WU) into the lowland (≈ 14 WU).
    const t0 = await page.evaluate(() => {
      const h = window.__faf!;
      h.sendMove(h.ownHandles(), 150, 175);
      return h.tick;
    });
    const driving: { tick: number; mismatches: number; prevMismatches: number; units: number }[] = [];
    for (let k = 1; k <= 8; k++) {
      await waitTick(page, t0 + 10 * k);
      const r = await page.evaluate(() => window.__faf!.unitHeights());
      driving.push({ tick: r.tick, mismatches: r.mismatches, prevMismatches: r.prevMismatches, units: r.units });
      expect(r.mismatches, JSON.stringify(r.first)).toBe(0);
      expect(r.prevMismatches).toBe(0);
    }
    const heightsMoved = await page.evaluate(() => {
      const h = window.__faf!;
      let lower = 0;
      for (const handle of h.ownHandles()) if ((h.unitPos(handle)?.y ?? 99) < 23) lower++;
      return lower;
    });

    // Start view: terrain everywhere (no clear color), many colors.
    const view = await page.evaluate(({ o }) => window.__faf!.setCamera(o.x, o.z, 105), { o: HOLLOW_RIDGE.own });
    await settle(page);
    const img = decodePng(await page.locator('#game-canvas').screenshot());
    const pixels = pixelStats(img);
    const clearShare = colorShare(img, CLEAR_RGB, 3);
    const render = await page.evaluate(() => window.__faf!.renderStats());

    const water = await checkWater(page, HOLLOW_RIDGE.deepWater.x, HOLLOW_RIDGE.deepWater.z);
    const mass = await checkSpot(page, 'mass', HOLLOW_RIDGE.massSpot);
    const hydro = await checkSpot(page, 'hydro', HOLLOW_RIDGE.hydroSpot);

    const report = { browser: testInfo.project.name, server: server.name, probe, rest, driving, heightsMoved, view, pixels, clearShare, render, water, mass, hydro };
    writeReport(`terrain-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'terrain', report);

    expect(heightsMoved, 'cubes drove down the plateau cliff').toBeGreaterThanOrEqual(20);
    expect(pixels.distinctColors).toBeGreaterThanOrEqual(16);
    expect(pixels.dominantShare).toBeLessThan(0.9);
    expect(clearShare, 'terrain covers the start view').toBeLessThan(0.05);
    expect(render.drawsByPass.terrain).toBe(1);
    expect(render.drawsByPass.water).toBe(1);
    expect(render.terrainPatches).toBeGreaterThan(0);
    expect(render.decals).toBe(18);
    expect(water.ok, `water pixel ${JSON.stringify(water.pixel)}`).toBe(true);
    expect(water.boxShare).toBeGreaterThan(0.5);
    expect(mass.hits, 'mass ring samples').toBeGreaterThanOrEqual(6);
    expect(hydro.hits, 'hydro ring samples').toBeGreaterThanOrEqual(6);
    expectNoErrors(errors);
  });
}

test('terrain: ?map=testplane lädt die flache MS1-Ebene als generierte Karte (Terrain-Pfad, kein Wasser)', async ({ page }) => {
  const errors = captureErrors(page);
  await openGame(page, COI_URL, 'map=testplane', 1024);
  const info = await page.evaluate(() => ({
    map: window.__faf!.mapName,
    heights: window.__faf!.unitHeights(),
    probe: window.__faf!.probeHeights(1000, 7),
    render: window.__faf!.renderStats(),
    timings: window.__faf!.loadTimings(),
  }));
  expect(info.map).toBe('testplane');
  expect(info.heights.units).toBeGreaterThan(0);
  expect(info.heights.mismatches).toBe(0);
  // Same terrain pipeline as every map: CDLOD patches drawn, GPU heights == CPU (all 0), no water.
  expect(info.probe.mismatches).toBe(0);
  expect(info.render.drawsByPass.terrain).toBe(1);
  expect(info.render.terrainPatches).toBeGreaterThan(0);
  expect(info.render.drawsByPass.water).toBe(0);
  expect(Object.keys(info.timings!.sources).some((id) => id.startsWith('maps/'))).toBe(false);
  expectNoErrors(errors);
});
