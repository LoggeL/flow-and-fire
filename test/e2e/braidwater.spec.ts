import { expect, test } from '@playwright/test';
import type { FlightReport } from '../../apps/game/src/hooks.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, openGame, SERVERS, waitTick, writeReport } from './support/game.ts';

// Skirmish map Braidwater (512 WU, 1v1, content/maps/src/braidwater.spec.md) via `?map=braidwater`:
// map identity, 2 starts / 36 mass / 5 hydro, the player's cubes on the south base plateau (start 0),
// the enemy on the north plateau (start 1), the camera over the own base, CPU == GPU heights, units on
// the terrain; whole-map view (all four corners on screen), terrain = 1 draw, draws ≤ 50, every
// terrain patch drawn. FPS/frame times are only measured and reported (test-results/braidwater-*.json).

/** Identities fixed by the Braidwater package (packages/formats/test/braidwater.test.ts). */
const BRAIDWATER = {
  name: 'Braidwater',
  sizeWu: 512,
  mapSimHash: 0xeeaec694,
  own: { x: 154, z: 446 },
  enemy: { x: 154, z: 66 },
  starts: 2,
  mass: 36,
  hydro: 5,
} as const;
const MAX_DRAWS = 50;

for (const server of SERVERS) {
  test(`braidwater: Karte per ?map=braidwater, Starts, Höhen und Gesamtansicht – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, 'map=braidwater', 1024);
    await waitTick(page, 5);

    const info = await page.evaluate((own) => {
      const h = window.__faf!;
      const p = h
        .ownHandles()
        .map((x) => h.unitPos(x))
        .filter((u) => u !== null);
      return {
        map: h.mapName,
        mapSimHash: h.mapSimHash,
        info: h.mapInfo(),
        camera: h.cameraState(),
        own: p.length,
        ownMaxDist: Math.max(...p.map((u) => Math.hypot(u!.x - own.x, u!.z - own.z))),
        army1: h.armyUnitCount(1),
        heights: h.unitHeights(),
        probe: h.probeHeights(4000, 0x5eed),
      };
    }, BRAIDWATER.own);
    expect(info.map).toBe(BRAIDWATER.name);
    expect(info.mapSimHash).toBe(BRAIDWATER.mapSimHash);
    expect(info.info!.sizeWu).toBe(BRAIDWATER.sizeWu);
    expect(info.info!.starts).toHaveLength(BRAIDWATER.starts);
    expect(info.info!.spots.filter((s) => s.kind === 'mass')).toHaveLength(BRAIDWATER.mass);
    expect(info.info!.spots.filter((s) => s.kind === 'hydro')).toHaveLength(BRAIDWATER.hydro);
    expect(Math.hypot(info.camera.x - BRAIDWATER.own.x, info.camera.z - BRAIDWATER.own.z)).toBeLessThan(0.5);
    // 1,000 own cubes on the base plateau (flat r 45 around the start), 24 enemy cubes at start 1.
    expect(info.own).toBe(1000);
    expect(info.ownMaxDist).toBeLessThan(45);
    expect(info.army1).toBe(24);
    expect(info.heights.mismatches).toBe(0);
    expect(info.probe.mismatches, JSON.stringify(info.probe.first)).toBe(0);

    // Whole-map view: maximum zoom over the map centre, all four corners on screen.
    const overview = await page.evaluate(() => {
      const h = window.__faf!;
      const cam = h.setCamera(256, 256, 1e6);
      const css = h.renderStats().css;
      const corners = [
        [0, 0],
        [512, 0],
        [0, 512],
        [512, 512],
      ].map(([x, z]) => h.project(x!, h.heightAt(x!, z!), z!));
      return { cam, css, corners };
    });
    for (const c of overview.corners) {
      expect(c, 'corner projects').not.toBeNull();
      expect(c!.x).toBeGreaterThanOrEqual(0);
      expect(c!.x).toBeLessThanOrEqual(overview.css.width);
      expect(c!.y).toBeGreaterThanOrEqual(0);
      expect(c!.y).toBeLessThanOrEqual(overview.css.height);
    }

    const maxD = overview.cam.distance;
    const whole: FlightReport = await page.evaluate(
      (d) =>
        window.__faf!.flight(
          [
            { x: 250, z: 250, distance: d },
            { x: 262, z: 262, distance: d },
          ],
          2000,
        ),
      maxD,
    );
    // Tour: own base → west ford → bluffs → island → enemy base → estuary.
    const tour: FlightReport = await page.evaluate(() =>
      window.__faf!.flight(
        [
          { x: 154, z: 446, distance: 105 },
          { x: 80, z: 256, distance: 120 },
          { x: 208, z: 256, distance: 160 },
          { x: 350, z: 256, distance: 140 },
          { x: 154, z: 66, distance: 150 },
          { x: 470, z: 256, distance: 300 },
        ],
        5000,
      ),
    );

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      measuredLocally: MEASURED_LOCALLY,
      map: info.map,
      overview: { camera: overview.cam, corners: overview.corners, css: overview.css },
      wholeMap: whole,
      tour,
    };
    writeReport(`braidwater-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'braidwater', report);

    for (const f of [whole, tour]) {
      expect(f.frames).toBeGreaterThan(20);
      expect(f.draws.max).toBeLessThanOrEqual(MAX_DRAWS);
      expect(f.drawsByPassMax.terrain).toBe(1);
      expect(f.drawsByPassMax.water).toBe(1);
    }
    // The whole-map view draws every terrain patch (16 × 16 chunks of 32 WU).
    expect(whole.terrainPatches.max).toBe(256);
    expectNoErrors(errors);
  });
}
