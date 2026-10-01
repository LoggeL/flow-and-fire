import { PlacementVerdict } from '../../packages/rules/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

interface Site { x: number; z: number }

async function pause(page: Page, wanted: boolean): Promise<void> {
  if (await page.evaluate(() => window.__faf!.paused) !== wanted) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(wanted);
}

async function factories(page: Page): Promise<{ handle: number; x: number; z: number }[]> {
  return page.evaluate(bp => {
    const h = window.__faf!;
    return h.ownHandles().flatMap(handle => {
      const unit = h.unitInfo(handle);
      return unit?.visual === bp ? [{ handle, x: unit.x, z: unit.z }] : [];
    });
  }, SKIRMISH_BLUEPRINTS.indexOf('core:fac_land_t1'));
}

async function projectionError(page: Page): Promise<number> {
  const bp = SKIRMISH_BLUEPRINTS.indexOf('core:fac_land_t1');
  const dimensions = { width: SKIRMISH_BLUEPRINTS.footprintW(bp), height: SKIRMISH_BLUEPRINTS.footprintH(bp) };
  return page.evaluate(({ width, height }) => {
    const h = window.__faf!;
    let error = 0;
    for (const el of document.querySelectorAll('[data-testid="queued-build-ghost"]')) {
      const x = Number(el.getAttribute('data-x')) / 4096, z = Number(el.getAttribute('data-z')) / 4096;
      const yaw = Number(el.getAttribute('data-yaw'));
      const rotated = ((yaw + 8192) & 0xffff) >> 14;
      const w = rotated & 1 ? height : width, d = rotated & 1 ? width : height;
      const actual = (el.getAttribute('points') ?? '').split(' ').map(point => point.split(',').map(Number));
      const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      if (actual.length !== 4) return Infinity;
      for (let k = 0; k < 4; k++) {
        const cx = x + signs[k]![0]! * w / 2, cz = z + signs[k]![1]! * d / 2;
        const expected = h.project(cx, h.heightAt(cx, cz), cz);
        if (expected === null) return Infinity;
        error = Math.max(error, Math.hypot(actual[k]![0]! - expected.x, actual[k]![1]! - expected.y));
      }
    }
    return error;
  }, dimensions);
}

test('20 accepted shared build ghosts survive native builder death and takeover', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startHumanAiSkirmish(page);
  await pause(page, true);
  const before = await page.evaluate(() => window.__faf!.ownHandles());
  // This bounded setup uses real Spawn commands. The entire receipt is explicitly tainted.
  // Every subsequent build and self-destruct uses the ordinary native HUD command path.
  await page.evaluate(() => {
    window.__faf!.spawnAt('core:eng_t1', 92, 72);
    window.__faf!.spawnAt('core:eng_t1', 96, 72);
    window.__faf!.setCamera(117, 91, 100);
  });
  await stepTicks(page, 4);
  const engineers = await page.evaluate(({ previous, bp }) => {
    const h = window.__faf!;
    return h.ownHandles().filter(handle => !previous.includes(handle) && h.unitInfo(handle)?.visual === bp);
  }, { previous: before, bp: SKIRMISH_BLUEPRINTS.indexOf('core:eng_t1') });
  expect(engineers).toHaveLength(2);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
  await clickUnit(page, engineers[0]!);
  const second = await page.evaluate(handle => window.__faf!.unitScreenPos(handle), engineers[1]!);
  expect(second).not.toBeNull();
  await page.keyboard.down('Shift');
  await page.mouse.click(second!.x, second!.y);
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => [...window.__faf!.selected()].sort((a, b) => a - b))).toEqual([...engineers].sort((a, b) => a - b));
  await expect(page.getByTestId('card-KeyA')).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('KeyA');
  const cursor = page.getByTestId('build-ghost');
  const firstGround = await groundPixel(page, 108.5, 80.5);
  await page.mouse.move(firstGround.x, firstGround.y);
  await expect(cursor).toHaveAttribute('data-type', 'core:str_t1_fac_land');
  const sites: Site[] = [];
  await page.keyboard.down('Shift');
  try {
    // A 7 WU grid leaves distinct, nonoverlapping 5x5 footprints on the starting plateau.
    // The first site is outside both builders' range, keeping all 20 intents visible initially.
    for (let row = 0; row < 5 && sites.length < 20; row++) {
      for (let column = 0; column < 6 && sites.length < 20; column++) {
        const candidate = { x: 108.5 + column * 7, z: 80.5 + row * 7 };
        const pixel = await groundPixel(page, candidate.x, candidate.z);
        expect(pixel.y).toBeLessThan(650);
        await page.mouse.move(pixel.x, pixel.y);
        await expect(cursor).toBeVisible();
        await expect(cursor).toHaveAttribute('data-x', String(Math.round(candidate.x * 4096)));
        await expect(cursor).toHaveAttribute('data-z', String(Math.round(candidate.z * 4096)));
        if (await cursor.getAttribute('data-verdict') !== String(PlacementVerdict.Valid)) continue;
        const site = { x: Number(await cursor.getAttribute('data-x')), z: Number(await cursor.getAttribute('data-z')) };
        if (sites.some(existing => existing.x === site.x && existing.z === site.z)) continue;
        await page.mouse.click(pixel.x, pixel.y);
        sites.push(site);
      }
    }
  } finally { await page.keyboard.up('Shift'); }
  expect(sites, '20 actual accepted, distinct native placements').toHaveLength(20);
  await page.keyboard.press('Escape');
  await page.mouse.move(720, 350);
  await stepTicks(page, 4);
  const ghosts = page.getByTestId('queued-build-ghost');
  await expect(ghosts).toHaveCount(20);
  await expect(page.getByTestId('queued-build-ghosts')).toHaveAttribute('data-count', '20');
  const initial = await ghosts.evaluateAll(elements => elements.map(el => ({
    x: Number(el.getAttribute('data-x')), z: Number(el.getAttribute('data-z')),
    builders: Number(el.getAttribute('data-builders')), orders: Number(el.getAttribute('data-orders')),
    index: Number(el.getAttribute('data-queue-index')), points: el.getAttribute('points'),
  })));
  expect(initial.map(({ x, z }) => ({ x, z }))).toEqual(sites);
  expect(initial.every(site => site.builders === 2 && site.orders === 2)).toBe(true);
  expect(initial.map(site => site.index)).toEqual(Array.from({ length: 20 }, (_, k) => k));
  const watches = await page.evaluate(handles => window.__faf!.watch().filter(record => handles.includes(record.handle)), engineers);
  expect(watches).toHaveLength(2);
  expect(watches.every(record => record.orders === 20 && record.targets.length === 16)).toBe(true);
  expect(await factories(page)).toHaveLength(0);
  await expect.poll(() => projectionError(page)).toBeLessThan(1);

  const pausedTick = await page.evaluate(() => window.__faf!.tick);
  const cameraBefore = await page.evaluate(() => window.__faf!.cameraState());
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(120);
  await page.keyboard.up('ArrowRight');
  await expect.poll(() => ghosts.first().getAttribute('points')).not.toBe(initial[0]!.points);
  expect(await page.evaluate(() => window.__faf!.tick)).toBe(pausedTick);
  const cameraAfter = await page.evaluate(() => window.__faf!.cameraState());
  expect(Math.hypot(cameraAfter.x - cameraBefore.x, cameraAfter.z - cameraBefore.z)).toBeGreaterThan(1);
  await expect.poll(() => projectionError(page)).toBeLessThan(1);

  await pause(page, false);
  await expect.poll(async () => (await factories(page)).length, { timeout: 30_000 }).toBe(1);
  const firstFactory = (await factories(page))[0]!;
  expect(firstFactory.x * 4096).toBe(sites[0]!.x);
  expect(firstFactory.z * 4096).toBe(sites[0]!.z);
  await expect(ghosts).toHaveCount(19);
  await expect(page.locator(`[data-testid="queued-build-ghost"][data-x="${sites[0]!.x}"][data-z="${sites[0]!.z}"]`)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window.__faf!.fxStats() as { beams: number }).beams)).toBeGreaterThan(0);
  // An ordinary self-destruct removes just the original engineer. The shared site and queue remain.
  await clickUnit(page, engineers[0]!);
  await page.getByTestId('selection-details-toggle').click();
  await expect(page.getByTestId('order-selfDestruct')).toBeVisible();
  await page.getByTestId('order-selfDestruct').click();
  await expect(page.getByTestId('order-selfDestruct')).toHaveClass(/is-countdown/);
  await expect.poll(() => page.evaluate(handle => window.__faf!.ownHandles().includes(handle), engineers[0]!), { timeout: 15_000 }).toBe(false);
  expect(await page.evaluate(handle => window.__faf!.ownHandles().includes(handle), engineers[1]!)).toBe(true);
  await expect.poll(() => ghosts.evaluateAll(elements => elements.every(el => el.getAttribute('data-builders') === '1' && el.getAttribute('data-orders') === '1'))).toBe(true);
  await clickUnit(page, engineers[1]!);
  const takeoverSnapshot = () => page.evaluate(({ engineers, firstFactory, sites, rangeRaw }) => {
    const h = window.__faf!, survivor = h.unitInfo(engineers[1]!), original = h.unitInfo(engineers[0]!);
    const inspection = h.inspection(), relevant = [engineers[0]!, engineers[1]!, firstFactory.handle];
    const host = h.hostStatus() as { speed?: number } | null;
    return {
      inputs: { engineers, acceptedSitesRaw: sites, firstFactory, buildRangeRaw: rangeRaw, buildRangeWU: rangeRaw / 4096 },
      buildHash: h.buildHash, tick: h.tick, acceptedTick: inspection?.tick ?? null, paused: h.paused, speed: host?.speed ?? null,
      original, survivor, survivorState: null, survivorStateUnavailable: 'Simulation FSM state and unit flags are not exposed by unitInfo; no state is inferred.',
      survivorDistanceToFirstSiteWU: survivor ? Math.hypot(survivor.x - firstFactory.x, survivor.z - firstFactory.z) : null,
      firstSite: { unit: h.unitInfo(firstFactory.handle), factoryWatch: inspection?.watches.find(record => record.handle === firstFactory.handle) ?? null,
        constructionProgress: null, constructionProgressUnavailable: 'No independent site construction progress is exposed by the existing hooks.' },
      selected: h.selected(), watch: h.watch().filter(record => relevant.includes(record.handle)),
      inspection: inspection ? { ...inspection, watches: inspection.watches.filter(record => relevant.includes(record.handle)) } : null,
      resources: { mass: document.querySelector<HTMLElement>('[data-testid="resource-mass"]')?.innerText ?? null,
        energy: document.querySelector<HTMLElement>('[data-testid="resource-energy"]')?.innerText ?? null },
      path: h.pathStats(), host, frameMetrics: h.metrics.snapshot().frame, frameFingerprint: h.lastFrameHash(), ruleHash: h.ruleHash(), fx: h.fxStats(),
    };
  }, { engineers, firstFactory, sites, rangeRaw: SKIRMISH_BLUEPRINTS.buildRangeRawCol[SKIRMISH_BLUEPRINTS.indexOf('core:eng_t1')]! });
  await attachJson(testInfo, 'build-intents-takeover-before', await takeoverSnapshot());
  // Advancing to a second physical site proves completion and consumption of the original shared head.
  try {
    await expect.poll(() => page.evaluate(handle => window.__faf!.unitInfo(handle)?.orders, engineers[1]!), { timeout: 60_000 }).toBe(19);
  } catch (error) {
    try {
      await attachJson(testInfo, 'build-intents-takeover-failure', { error: String(error), snapshot: await takeoverSnapshot() });
    } catch (diagnosticError) {
      try { await attachJson(testInfo, 'build-intents-takeover-diagnostic-error', { error: String(error), diagnosticError: String(diagnosticError) }); }
      catch { /* Preserve the original native assertion failure even if the page or attachment transport closed. */ }
    }
    throw error;
  }
  await expect.poll(async () => (await factories(page)).length, { timeout: 30_000 }).toBe(2);
  expect((await factories(page)).some(factory => factory.handle === firstFactory.handle)).toBe(true);
  await expect(ghosts).toHaveCount(18);
  await expect.poll(() => projectionError(page)).toBeLessThan(1);
  await pause(page, true);
  const receipt = await page.evaluate(() => ({ tick: window.__faf!.tick, tainted: window.__faf!.tainted, hostErrors: window.__faf!.hostErrors, buildHash: window.__faf!.buildHash }));
  expect(receipt.tainted).toBe(true);
  expect(receipt.hostErrors).toEqual([]);
  await assertSilentOutput(page);
  await attachJson(testInfo, 'build-intents-tainted-command-fixture', {
    setup: 'Two diagnostic Spawn commands only; tainted replay. Native selection, 20 Shift-builds, pause, camera pan and SelfDestruct thereafter.',
    engineers, sites, initial, watches, pausedTick, cameraBefore, cameraAfter, firstFactory, finalFactories: await factories(page), receipt,
  });
  expectNoErrors(errors);
});
