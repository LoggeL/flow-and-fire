import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, HOLLOW_RIDGE, openGame, SERVERS, waitTick } from './support/game.ts';
import { decodePng, pixelStats } from './support/png.ts';

// Boot (S1, P1, G14, blueprint skeleton; MS2: on hollow-ridge): the game loads, the sim worker is
// ready with a simId, 1,000 own cubes (+ the second army) arrive in the frame at the map starts and
// are drawn by the instanced renderer on the terrain.

for (const server of SERVERS) {
  test(`boot: 1.000 Würfel, ready mit simId – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, 'spawn=cubes', 1000);
    await waitTick(page, 10);

    const info = await page.evaluate(() => {
      const h = window.__faf!;
      return {
        transport: h.transport,
        coi: h.crossOriginIsolated,
        simId: h.simId,
        buildHash: h.buildHash,
        own: h.ownHandles().length,
        enemy: h.armyUnitCount(1),
        units: h.unitCount,
        tick: h.tick,
        render: h.renderStats(),
        hostErrors: h.hostErrors,
        map: h.mapName,
        mapSimHash: h.mapSimHash,
        heights: h.unitHeights(),
      };
    });
    expect(info.transport).toBe(server.transport);
    expect(info.coi).toBe(server.coi);
    expect(info.simId).not.toBeNull();
    expect(info.own).toBe(1000);
    expect(info.enemy).toBe(24);
    expect(info.units).toBe(1024);
    expect(info.render.instances).toBeGreaterThanOrEqual(1024);
    expect(info.render.lost).toBe(false);
    expect(info.hostErrors).toEqual([]);
    // MS2: the session runs on hollow-ridge, every cube stands on the terrain.
    expect(info.map).toBe(HOLLOW_RIDGE.name);
    expect(info.mapSimHash).toBe(HOLLOW_RIDGE.mapSimHash);
    expect(info.heights.mismatches).toBe(0);
    expect(info.render.drawsByPass.terrain).toBe(1);

    const simIdHex = '0x' + (info.simId! >>> 0).toString(16).padStart(8, '0');
    await expect(page.locator('[data-testid="hud-simid"]')).toHaveText(simIdHex);
    await expect(page.locator('[data-testid="hud-transport"]')).toHaveText(server.transport);

    // Command-log recorder runs from tick 0: OPFS in the worker, in-memory fallback with a reason.
    await page.waitForFunction(() => {
      const st = window.__faf!.hostStatus() as { recorder?: string; recorderNote?: string | null } | null;
      return st !== null && (st.recorder === 'opfs' || (st.recorderNote ?? null) !== null);
    }, null, { timeout: 5000 }).catch(() => undefined);
    const recorder = (await page.evaluate(() => window.__faf!.hostStatus())) as { recorder: string; recorderNote: string | null; logBytes: number };
    expect(['opfs', 'memory']).toContain(recorder.recorder);
    expect(recorder.logBytes).toBeGreaterThan(0);

    // Canvas is not a single color: ground grid + two army colors + shading.
    const png = decodePng(await page.locator('#game-canvas').screenshot());
    const stats = pixelStats(png);
    const report = { browser: testInfo.project.name, server: server.name, ...info, recorder, pixels: stats };
    await attachJson(testInfo, 'boot', report);
    const dir = resolve(import.meta.dirname, '../../test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `boot-${testInfo.project.name}-${server.transport}.json`), JSON.stringify(report, null, 2));
    expect(stats.distinctColors).toBeGreaterThanOrEqual(16);
    expect(stats.dominantShare).toBeLessThan(0.9);
    expectNoErrors(errors);
  });
}

// MS3 default scene: blueprint placeholder tanks (5 core land types, all size classes) instead of
// cubes, nothing selected, every tank on the terrain, drawn as meshes (with turret) in the start view.
for (const server of SERVERS) {
  test(`boot: Standardszene mit Platzhalter-Panzern (MS3) – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 300);
    await waitTick(page, 20);
    const info = await page.evaluate(() => {
      const h = window.__faf!;
      const own = h.ownHandles();
      const types: Record<string, number> = {};
      for (const bp of ['lnd_t1_tank', 'lnd_t1_arty', 'lnd_t1_scout', 'lnd_t2_tank', 'lnd_t3_heavy']) types[bp] = h.selectBlueprint(bp);
      h.clearSelection();
      return {
        own: own.length,
        enemy: h.armyUnitCount(1),
        types,
        selection: h.selection().length,
        heights: h.unitHeights(),
        render: h.renderStats(),
        zoom: h.zoom(),
        hostErrors: h.hostErrors,
      };
    });
    await attachJson(testInfo, 'boot-tanks', info);
    expect(info.own).toBe(150);
    expect(info.enemy).toBe(150);
    // Largest-remainder split of the 5:2:2:2:1 mix (apps/game content.ts TANK_MIX).
    expect(info.types).toEqual({ lnd_t1_tank: 63, lnd_t1_arty: 25, lnd_t1_scout: 25, lnd_t2_tank: 25, lnd_t3_heavy: 12 });
    expect(info.selection).toBe(0);
    expect(info.heights.mismatches).toBe(0);
    expect(info.zoom.level).toBe(0);
    expect(info.render.drawsByPass.units).toBeGreaterThanOrEqual(5);
    expect(info.render.drawsByPass.terrain).toBe(1);
    expect(info.hostErrors).toEqual([]);
    await expect(page.locator('[data-testid="hud-zoom"]')).toHaveAttribute('data-level', '0');
    expectNoErrors(errors);
  });
}
