import { expect, test } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';
import { decodePng, pixelStats } from './support/png.ts';

// Boot (S1, P1, G14, blueprint skeleton): the game loads, the sim worker is ready with a simId,
// 1,000 own cubes (+ the second army) arrive in the frame and are drawn by the instanced renderer.

for (const server of SERVERS) {
  test(`boot: 1.000 Würfel, ready mit simId – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1000);
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

    const simIdHex = '0x' + (info.simId! >>> 0).toString(16).padStart(8, '0');
    await expect(page.locator('[data-testid="hud-simid"]')).toHaveText(simIdHex);
    await expect(page.locator('[data-testid="hud-transport"]')).toHaveText(server.transport);

    // Canvas is not a single color: ground grid + two army colors + shading.
    const png = decodePng(await page.locator('#game-canvas').screenshot());
    const stats = pixelStats(png);
    await attachJson(testInfo, 'boot', { ...info, pixels: stats });
    expect(stats.distinctColors).toBeGreaterThanOrEqual(16);
    expect(stats.dominantShare).toBeLessThan(0.9);
    expectNoErrors(errors);
  });
}
