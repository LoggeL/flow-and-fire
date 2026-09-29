import { expect, test } from '@playwright/test';
import { attachJson, captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';
import { decodePng, pixelStats } from './support/png.ts';

// Context loss (P10 preview, PLAN §3.7): WEBGL_lose_context drops the WebGL2 context; the Preact
// overlay survives and shows the banner, the sim keeps ticking in the worker, and after restore the
// resource registry rebuilds everything and the units are drawn again.

declare global {
  interface Window {
    __fafLoseCtx?: WEBGL_lose_context | null;
  }
}

for (const server of SERVERS) {
  test(`context-loss: Rendering kommt nach Restore zurück, Sim läuft weiter – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1000);
    await waitTick(page, 5);

    const hasExt = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      // Same context object the renderer created (getContext returns the existing one).
      const gl = canvas.getContext('webgl2');
      window.__fafLoseCtx = gl?.getExtension('WEBGL_lose_context') ?? null;
      return window.__fafLoseCtx !== null;
    });
    expect(hasExt, 'WEBGL_lose_context available').toBe(true);

    const before = await page.evaluate(() => ({ tick: window.__faf!.tick, render: window.__faf!.renderStats() }));
    await page.evaluate(() => window.__fafLoseCtx!.loseContext());
    await page.waitForFunction(() => window.__faf!.renderStats().lost === true);
    await expect(page.locator('[data-testid="context-lost"]')).toBeVisible();
    await expect(page.locator('[data-testid="hud"]')).toBeVisible();

    // The sim keeps running while the context is gone (≥ 10 ticks ≈ 1 s).
    const lostTick = await page.evaluate(() => window.__faf!.tick);
    await waitTick(page, lostTick + 10);
    const framesDuringLoss = await page.evaluate(() => window.__faf!.renderStats().frames);

    await page.evaluate(() => window.__fafLoseCtx!.restoreContext());
    await page.waitForFunction(() => window.__faf!.renderStats().lost === false);
    await expect(page.locator('[data-testid="context-lost"]')).toBeHidden();
    await page.waitForFunction((f) => window.__faf!.renderStats().frames > f + 10, framesDuringLoss);
    const after = await page.evaluate(() => ({ tick: window.__faf!.tick, render: window.__faf!.renderStats(), units: window.__faf!.unitCount }));

    const png = decodePng(await page.locator('#game-canvas').screenshot());
    const stats = pixelStats(png);
    await attachJson(testInfo, 'context-loss', { before, lostTick, framesDuringLoss, after, pixels: stats });
    expect(after.tick).toBeGreaterThanOrEqual(lostTick + 10);
    expect(after.units).toBe(1024);
    expect(after.render.instances).toBeGreaterThanOrEqual(1024);
    expect(stats.distinctColors).toBeGreaterThanOrEqual(16);
    expect(stats.dominantShare).toBeLessThan(0.9);
    // Browsers log context loss as a warning (not an error); anything else is a failure.
    expectNoErrors(errors.filter((e) => !/context (was )?lost|CONTEXT_LOST/i.test(e)));
  });
}
