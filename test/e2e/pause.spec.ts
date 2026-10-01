import { expect, test } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// Pause (A5): the tick stands still, camera and command acceptance keep working; a command accepted
// during the pause is applied by the next step (N) and the game resumes with P.

for (const server of SERVERS) {
  test(`pause: Tick steht, Kamera und Commands laufen weiter – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, 'map=testplane', 1000);
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
    const handles = await page.evaluate(() => { const h = window.__faf!; return h.ownHandles().sort((a, b) => { const pa = h.unitPos(a)!; const pb = h.unitPos(b)!; return Math.hypot(pa.x - 140, pa.z - 140) - Math.hypot(pb.x - 140, pb.z - 140) || a - b; }).slice(0, 50); });
    const pos0 = await page.evaluate((hs) => hs.map((h) => window.__faf!.unitPos(h)), handles);
    const seq = await page.evaluate((hs) => window.__faf!.sendMove(hs, 140, 140), handles);
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

    // Resume: the commanded cubes drive towards (140, 140).
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => window.__faf!.paused === false);
    await waitTick(page, tick0 + 40);
    const pos1 = await page.evaluate((hs) => hs.map((h) => window.__faf!.unitPos(h)), handles);
    let closer = 0;
    for (let i = 0; i < handles.length; i++) {
      const a = pos0[i]!;
      const b = pos1[i]!;
      if (Math.hypot(b.x - 140, b.z - 140) < Math.hypot(a.x - 140, a.z - 140) - 0.5) closer++;
    }
    await attachJson(testInfo, 'pause', { tick0, cam0, cam1, during, afterStep, closer });
    expect(closer).toBeGreaterThanOrEqual(45);
    expectNoErrors(errors);
  });
}

// Singleplayer (PLAN §3.4, S9 preview): a hidden tab pauses the sim; becoming visible again resumes it
// — but only if the game paused itself (a manual pause stays).
for (const server of SERVERS) {
  test(`pause: verborgener Tab pausiert, sichtbarer setzt fort – ${server.label}`, async ({ page }) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, 'map=testplane', 1000);
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
