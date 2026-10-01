import { expect, test } from './support/silent-test.ts';
import type { FlightReport } from '../../apps/game/src/hooks.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, openGame, SERVERS, waitTick, writeReport } from './support/game.ts';

// Skirmish map Tessera (512 WU, 1v1; content/maps/src/tessera.spec.md): `?map=tessera` loads it from the
// asset manifest (Setons stays the default map). The player's cubes stand at start 0 (SW, 108/404), the
// enemy at start 1 (NO, 404/108), the camera starts over the own base. Gated (machine-independent): map
// identity, starts/spots, unit positions and heights, whole map in view at maximum zoom, terrain = 1
// draw, water = 1 draw, draws ≤ 50, whole-map view = 256 patches. FPS and load time are only reported
// (test-results/tessera-<browser>-<transport>.json), locally measured (DECISIONS 5/16).

/** Identity of content/maps/tessera.rtsmap (packages/formats/test/tessera.test.ts pins the same hash). */
const TESSERA = {
  name: 'Tessera',
  sizeWu: 512,
  mapSimHash: 0x22cb60a8,
  own: { x: 108, z: 404 },
  enemy: { x: 404, z: 108 },
  starts: 2,
  mass: 34,
  hydro: 4,
} as const;
const MAX_DRAWS = 50;

for (const server of SERVERS) {
  test(`tessera: ?map=tessera lädt, Starts, Spots und Gesamtansicht – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = captureErrors(page);
    const t0 = Date.now();
    await openGame(page, server.url, 'map=tessera', 1024);
    const loadWallMs = Date.now() - t0;
    await waitTick(page, 5);

    const info = await page.evaluate((own) => {
      const h = window.__faf!;
      const p = h
        .ownHandles()
        .map((x) => h.unitPos(x))
        .filter((q) => q !== null);
      return {
        map: h.mapName,
        mapSimHash: h.mapSimHash,
        info: h.mapInfo(),
        camera: h.cameraState(),
        own: p.length,
        ownMaxDist: Math.max(...p.map((q) => Math.hypot(q!.x - own.x, q!.z - own.z))),
        army1: h.armyUnitCount(1),
        heights: h.unitHeights(),
        timings: h.loadTimings(),
      };
    }, TESSERA.own);
    expect(info.map).toBe(TESSERA.name);
    expect(info.mapSimHash).toBe(TESSERA.mapSimHash);
    expect(info.info!.sizeWu).toBe(TESSERA.sizeWu);
    expect(info.info!.starts).toHaveLength(TESSERA.starts);
    expect(info.info!.spots.filter((s) => s.kind === 'mass')).toHaveLength(TESSERA.mass);
    expect(info.info!.spots.filter((s) => s.kind === 'hydro')).toHaveLength(TESSERA.hydro);
    // Camera over the own base (start 0), own cubes on the base plate, the enemy at start 1.
    expect(Math.hypot(info.camera.x - TESSERA.own.x, info.camera.z - TESSERA.own.z)).toBeLessThan(0.5);
    expect(info.own).toBe(1000);
    expect(info.ownMaxDist).toBeLessThan(45);
    expect(info.army1).toBe(24);
    expect(info.heights.mismatches).toBe(0);

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
    // Short tour: own base → shard hollow → NW flank pond → enemy base.
    const tour: FlightReport = await page.evaluate(() =>
      window.__faf!.flight(
        [
          { x: 108, z: 404, distance: 105 },
          { x: 256, z: 256, distance: 140 },
          { x: 96, z: 96, distance: 120 },
          { x: 404, z: 108, distance: 160 },
        ],
        4000,
      ),
    );

    const report = {
      browser: testInfo.project.name,
      server: server.name,
      measuredLocally: MEASURED_LOCALLY,
      map: info.map,
      load: { wallMs: loadWallMs, timings: info.timings },
      overview: { camera: overview.cam, corners: overview.corners, css: overview.css },
      wholeMap: whole,
      tour,
    };
    writeReport(`tessera-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'tessera', report);

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
