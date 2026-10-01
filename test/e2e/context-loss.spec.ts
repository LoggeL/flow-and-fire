import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, COI_URL, expectNoErrors, HOLLOW_RIDGE, openGame, PERF_GATE, SERVERS, stepTicks, waitTick, writeReport } from './support/game.ts';
import { colorShare, decodePng, pixelStats } from './support/png.ts';
import { CLEAR_RGB } from './support/terrain.ts';

// Context loss (P10, MS2 acceptance "Bild nach ≤ 2 s zurück, die Sim tickt weiter, Hash
// unverändert") with terrain, water and spot decals on hollow-ridge:
// 1. running game: WEBGL_lose_context drops the context, the DOM overlay shows the banner, the sim
//    keeps ticking in the worker; after restore the resource registry rebuilds heightmap, splat,
//    decal and water resources: the picture is back (terrain pixels, not one color) – restore →
//    first new frame is measured (≤ 2 s gated with FAF_PERF_GATE=1) – and the GPU height probe
//    matches the CPU again;
// 2. determinism: paused sessions (?autostart=0) are stepped to tick T with the same commands, once
//    with a context loss in the middle and once without – the rule hash at T is identical (the loss
//    touches presentation only).

declare global {
  interface Window {
    __fafLoseCtx?: WEBGL_lose_context | null;
  }
}

const RESTORE_LIMIT_MS = 2000;

async function loseContextExt(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    // Same context object the renderer created (getContext returns the existing one).
    const gl = canvas.getContext('webgl2');
    window.__fafLoseCtx = gl?.getExtension('WEBGL_lose_context') ?? null;
    return window.__fafLoseCtx !== null;
  });
}

const isLossMessage = (e: string): boolean => /context (was )?lost|CONTEXT_LOST|context restored/i.test(e);

for (const server of SERVERS) {
  test(`context-loss: Terrain/Wasser/Decals nach Restore zurück, Sim läuft weiter – ${server.label}`, async ({ page }, testInfo) => {
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1024);
    await waitTick(page, 5);
    await page.evaluate((o) => window.__faf!.setCamera(o.x + 40, o.z + 40, 140), HOLLOW_RIDGE.own);
    expect(await loseContextExt(page), 'WEBGL_lose_context available').toBe(true);

    const before = await page.evaluate(() => ({ tick: window.__faf!.tick, render: window.__faf!.renderStats() }));
    await page.evaluate(() => window.__fafLoseCtx!.loseContext());
    await page.waitForFunction(() => window.__faf!.renderStats().lost === true);
    await expect(page.locator('[data-testid="context-lost"]')).toBeVisible();
    await expect(page.locator('[data-testid="hud"]')).toBeVisible();

    // The sim keeps running while the context is gone (≥ 10 ticks ≈ 1 s).
    const lostTick = await page.evaluate(() => window.__faf!.tick);
    await waitTick(page, lostTick + 10);
    const framesDuringLoss = await page.evaluate(() => window.__faf!.renderStats().frames);

    // Restore → time until the renderer draws again (measured in the page).
    const restoreMs = await page.evaluate(
      (f) =>
        new Promise<number>((resolve) => {
          const t0 = performance.now();
          window.__fafLoseCtx!.restoreContext();
          const poll = (): void => {
            const s = window.__faf!.renderStats();
            if (!s.lost && s.frames > f) resolve(performance.now() - t0);
            else requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        }),
      framesDuringLoss,
    );
    await expect(page.locator('[data-testid="context-lost"]')).toBeHidden();
    await page.waitForFunction((f) => window.__faf!.renderStats().frames > f + 10, framesDuringLoss);
    const after = await page.evaluate(() => ({
      tick: window.__faf!.tick,
      render: window.__faf!.renderStats(),
      units: window.__faf!.unitCount,
      probe: window.__faf!.probeHeights(2000, 99),
    }));

    const img = decodePng(await page.locator('#game-canvas').screenshot());
    const stats = pixelStats(img);
    const clearShare = colorShare(img, CLEAR_RGB, 3);
    const report = { browser: testInfo.project.name, server: server.name, before, lostTick, framesDuringLoss, restoreMs, after, pixels: stats, clearShare, perfGate: PERF_GATE };
    writeReport(`context-loss-${testInfo.project.name}-${server.transport}`, report);
    await attachJson(testInfo, 'context-loss', report);
    expect(after.tick).toBeGreaterThanOrEqual(lostTick + 10);
    expect(after.units).toBe(1024);
    expect(after.render.drawsByPass.terrain).toBe(1);
    expect(after.render.drawsByPass.water).toBe(1);
    expect(after.render.terrainPatches).toBeGreaterThan(0);
    expect(after.render.decals - after.render.dynamicDecals).toBe(18);
    expect(after.render.unitInstances).toBeGreaterThan(0);
    expect(after.probe.mismatches, 'GPU probe after restore').toBe(0);
    expect(stats.distinctColors).toBeGreaterThanOrEqual(16);
    expect(stats.dominantShare).toBeLessThan(0.9);
    expect(clearShare, 'terrain pixels (not the clear color)').toBeLessThan(0.05);
    if (PERF_GATE) expect(restoreMs, 'picture back after restore').toBeLessThanOrEqual(RESTORE_LIMIT_MS);
    // MS3: the restored context must also rebuild the icon atlas.
    await page.evaluate(() => window.__faf!.setCamera(256, 256, 900));
    await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().passDraws.icons)).toBe(1);
    expect(await page.evaluate(() => window.__faf!.renderStats().iconCount)).toBeGreaterThan(0);
    expectNoErrors(errors.filter((e) => !isLossMessage(e)));
  });
}

const T = 60;
const MOVE_AT = 20;
const LOSS_AT = 30;
const RESTORE_AT = 45;

/** Steps a paused session to tick T (move at MOVE_AT); optionally loses the context in between. */
async function deterministicRun(page: Page, base: string, withLoss: boolean): Promise<{ hash: { tick: number; hashTick: number; hash: number }; fingerprints: number[]; lostFrames: number | null }> {
  // Paused from tick 0: the start armies are spawned by the first step.
  await openGame(page, base, 'autostart=0&seed=11', 0);
  await page.evaluate(() => window.__faf!.recordFrameHashes(true));
  await stepTicks(page, MOVE_AT);
  await page.evaluate(() => {
    const h = window.__faf!;
    h.sendMove(h.ownHandles().filter((_, i) => i % 3 === 0), 150, 180);
  });
  await stepTicks(page, LOSS_AT - MOVE_AT);
  let lostFrames: number | null = null;
  if (withLoss) {
    expect(await loseContextExt(page)).toBe(true);
    await page.evaluate(() => window.__fafLoseCtx!.loseContext());
    await page.waitForFunction(() => window.__faf!.renderStats().lost === true);
    await stepTicks(page, RESTORE_AT - LOSS_AT);
    lostFrames = await page.evaluate(() => window.__faf!.renderStats().frames);
    await page.evaluate(() => window.__fafLoseCtx!.restoreContext());
    await page.waitForFunction(() => window.__faf!.renderStats().lost === false);
    await stepTicks(page, T - RESTORE_AT);
  } else {
    await stepTicks(page, T - LOSS_AT);
  }
  const hash = await page.evaluate(() => window.__faf!.ruleHash()!);
  const fingerprints = await page.evaluate((n) => {
    const out: number[] = [];
    for (let t = 1; t <= n; t++) out.push(window.__faf!.frameHashAt(t) ?? -1);
    return out;
  }, T);
  return { hash, fingerprints, lostFrames };
}

test('context-loss: Regel-Hash bei Tick T identisch zu einem Lauf ohne Verlust (Pause + step)', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const runs: Record<string, Awaited<ReturnType<typeof deterministicRun>>> = {};
  for (const withLoss of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errors = captureErrors(page);
    runs[withLoss ? 'loss' : 'clean'] = await deterministicRun(page, COI_URL, withLoss);
    expectNoErrors(errors.filter((e) => !isLossMessage(e)));
    await ctx.close();
  }
  const clean = runs['clean']!;
  const loss = runs['loss']!;
  const firstDiff = clean.fingerprints.findIndex((h, i) => h !== loss.fingerprints[i]);
  const report = { browser: testInfo.project.name, T, moveAt: MOVE_AT, lossTicks: [LOSS_AT, RESTORE_AT], clean: clean.hash, loss: loss.hash, firstDiffTick: firstDiff < 0 ? null : firstDiff + 1 };
  writeReport(`context-loss-determinism-${testInfo.project.name}`, report);
  await attachJson(testInfo, 'context-loss-determinism', report);
  expect(clean.hash.tick).toBe(T);
  expect(clean.hash.hashTick).toBe(T);
  expect(loss.hash).toEqual(clean.hash);
  expect(clean.fingerprints.every((h) => h >= 0)).toBe(true);
  expect(firstDiff, `first differing frame at tick ${firstDiff + 1}`).toBe(-1);
});
