import { expect, test } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// Pause (A5): the tick stands still, camera and command acceptance keep working; a command accepted
// during the pause is applied by the next step (N) and the game resumes with P.

for (const server of SERVERS) {
  test(`pause: Tick steht, Kamera und Commands laufen weiter – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, 'spawn=cubes', 1000);
    await waitTick(page, 5);
    await page.locator('#game-canvas').focus();

    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__faf!.paused === true);
    await expect(page.locator('[data-testid="pause-banner"]')).toBeVisible();
    const tick0 = await page.evaluate(() => window.__faf!.tick);

    // Camera moves by keyboard (hold D) and wheel zoom while paused.
    const cam0 = await page.evaluate(() => window.__faf!.cameraState());
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyD');
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(100);
    const cam1 = await page.evaluate(() => window.__faf!.cameraState());
    expect(Math.abs(cam1.x - cam0.x)).toBeGreaterThan(5);
    expect(cam1.distance).toBeLessThan(cam0.distance);

    // Command accepted during the pause (sent, not yet applied).
    const handles = await page.evaluate(() => window.__faf!.ownHandles().slice(0, 50));
    const pos0 = await page.evaluate((hs) => hs.map((h) => window.__faf!.unitPos(h)), handles);
    // Target on the start plateau (MS3 pathing: a target below the cliff is reached over a ramp).
    const seq = await page.evaluate((hs) => window.__faf!.sendMove(hs, 130, 100), handles);
    expect(seq).toBeGreaterThan(0);
    await page.waitForTimeout(1100);
    const during = await page.evaluate(() => {
      const h = window.__faf!;
      const s = h.metrics.snapshot();
      return { tick: h.tick, paused: h.paused, pending: s.frame['pendingCommands'], ackSeq: s.frame['ackSeq'] };
    });
    expect(during.tick).toBe(tick0); // ≥ 1 s without a tick
    expect(during.paused).toBe(true);
    expect(during.pending).toBe(1);

    // Step (N) applies the queued command in exactly one tick.
    await page.keyboard.press('KeyN');
    await waitTick(page, tick0 + 1);
    await page.waitForFunction((s) => window.__faf!.metrics.snapshot().frame['ackSeq'] === s, seq);
    const afterStep = await page.evaluate(() => ({ tick: window.__faf!.tick, paused: window.__faf!.paused }));
    expect(afterStep).toEqual({ tick: tick0 + 1, paused: true });

    // Resume: the commanded cubes drive off (group order: slots around (130, 100)).
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__faf!.paused === false);
    await waitTick(page, tick0 + 15);
    const pos1 = await page.evaluate((hs) => hs.map((h) => window.__faf!.unitPos(h)), handles);
    let moved = 0;
    const c0 = { x: 0, z: 0 };
    const c1 = { x: 0, z: 0 };
    for (let i = 0; i < handles.length; i++) {
      const a = pos0[i]!;
      const b = pos1[i]!;
      if (Math.hypot(b.x - a.x, b.z - a.z) > 0.5) moved++;
      c0.x += a.x / handles.length;
      c0.z += a.z / handles.length;
      c1.x += b.x / handles.length;
      c1.z += b.z / handles.length;
    }
    const d0 = Math.hypot(c0.x - 130, c0.z - 100);
    const d1 = Math.hypot(c1.x - 130, c1.z - 100);
    await attachJson(testInfo, 'pause', { tick0, cam0, cam1, during, afterStep, moved, d0, d1 });
    expect(moved).toBeGreaterThanOrEqual(45);
    expect(d1).toBeLessThan(d0 - 0.5);
    expectNoErrors(errors);
  });
}

// Singleplayer (PLAN §3.4, S9 preview): a hidden tab pauses the sim; becoming visible again resumes it
// — but only if the game paused itself (a manual pause stays).
for (const server of SERVERS) {
  test(`pause: verborgener Tab pausiert, sichtbarer setzt fort – ${server.label}`, async ({ page }) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, 'spawn=cubes', 1000);
    await waitTick(page, 3);
    const setVisibility = (state: 'hidden' | 'visible') =>
      page.evaluate((s) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);

    await setVisibility('hidden');
    await page.waitForFunction(() => window.__faf!.paused === true);
    const t0 = await page.evaluate(() => window.__faf!.tick);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__faf!.tick)).toBe(t0);
    await setVisibility('visible');
    await page.waitForFunction(() => window.__faf!.paused === false);
    await waitTick(page, t0 + 3);

    // Manual pause survives hide/show.
    await page.evaluate(() => window.__faf!.ctl({ t: 'pause' }));
    await page.waitForFunction(() => window.__faf!.paused === true);
    await setVisibility('hidden');
    await setVisibility('visible');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__faf!.paused)).toBe(true);
    expectNoErrors(errors);
  });
}
