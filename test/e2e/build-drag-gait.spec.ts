import { WatchOrderType } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

interface Site { x: number; z: number; verdict: number }

async function rendered(page: Page): Promise<void> {
  const next = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(frame => window.__faf!.renderStats().frames >= frame, next);
}

async function pause(page: Page): Promise<void> {
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
}

async function proposedSites(page: Page): Promise<Site[]> {
  return page.getByTestId('build-drag-ghost').evaluateAll(elements => elements.map(el => ({
    x: Number(el.getAttribute('data-x')), z: Number(el.getAttribute('data-z')), verdict: Number(el.getAttribute('data-verdict')),
  })));
}

async function receipt(page: Page) {
  return page.evaluate(() => ({ buildHash: window.__faf!.buildHash, tick: window.__faf!.tick,
    inspection: window.__faf!.inspection(), selected: window.__faf!.selected(), tainted: window.__faf!.tainted,
    hostErrors: window.__faf!.hostErrors, frame: window.__faf!.lastFrameHash(), rigStats: window.__faf!.rigPoseStats() }));
}

async function nativeFavicon(page: Page) {
  const link = await page.evaluate(() => ({ href: document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href ?? null,
    versionRoot: new URL('.', location.href).pathname }));
  expect(link.href).not.toBeNull();
  const url = new URL(link.href!);
  expect(url.pathname).toMatch(/^\/b\/[^/]+\/favicon\.png$/);
  expect(url.pathname).toBe(`${link.versionRoot}favicon.png`);
  const response = await page.request.get(link.href!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');
  const dimensions = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close(); return result;
  }, [...await response.body()]);
  expect(dimensions).toEqual({ width: 32, height: 32 });
  return { ...link, status: response.status(), contentType: response.headers()['content-type'], dimensions };
}

// The root Playwright projects run each native spec in Chromium, Firefox and WebKit.
// Every page uses the pre-navigation hardware-destination guard from silent-test.
test('native Shift drag previews a bounded grid and queues its valid sites once', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  const favicon = await nativeFavicon(page);
  await pause(page);
  await page.evaluate(() => window.__faf!.setCamera(140, 90, 125));
  await clickUnit(page, commander);
  await page.keyboard.press('KeyW');
  const bp = SKIRMISH_BLUEPRINTS.indexOf('core:str_t1_pgen');
  expect(bp).toBeGreaterThanOrEqual(0);
  const width = SKIRMISH_BLUEPRINTS.footprintW(bp), height = SKIRMISH_BLUEPRINTS.footprintH(bp);
  const anchor = { x: 132, z: 80 };
  const start = await groundPixel(page, anchor.x, anchor.z);
  const huge = await groundPixel(page, anchor.x + width * 10 + .25, anchor.z + height * 10 + .25);
  const end = await groundPixel(page, anchor.x + width * 4 + .25, anchor.z + height * 2 + .25);
  const baseline = await page.evaluate(() => ({ sent: window.__faf!.inspection()!.sentCommands,
    tick: window.__faf!.tick, camera: window.__faf!.cameraState() }));
  await page.keyboard.down('Shift');
  try {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(huge.x, huge.y, { steps: 8 });
    await expect(page.getByTestId('build-drag-ghosts')).toHaveAttribute('data-count', '32');
    const capped = await proposedSites(page);
    expect(capped).toHaveLength(32);
    expect(new Set(capped.map(site => `${site.x}:${site.z}`)).size).toBe(32);
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await expect.poll(async () => (await proposedSites(page)).length).toBeLessThan(32);
    const proposed = await proposedSites(page), valid = proposed.filter(site => site.verdict === 0);
    expect(valid.length).toBeGreaterThanOrEqual(2);
    expect(proposed.length).toBeLessThanOrEqual(32);
    expect(new Set(proposed.map(site => site.x)).size).toBeGreaterThan(1);
    expect(new Set(proposed.map(site => site.z)).size).toBeGreaterThan(1);
    for (let i = 0; i < proposed.length; i++) for (let j = i + 1; j < proposed.length; j++) {
      expect(Math.abs(proposed[i]!.x - proposed[j]!.x) >= width * 4096 ||
        Math.abs(proposed[i]!.z - proposed[j]!.z) >= height * 4096).toBe(true);
    }
    await page.keyboard.down('ArrowRight');
    await page.mouse.wheel(0, 120);
    await rendered(page);
    await page.keyboard.up('ArrowRight');
    await expect(page.locator('.faf-drag')).toHaveCount(0);
    await expect(page.getByTestId('build-ghost')).toHaveCount(0);
    expect(await page.evaluate(() => window.__faf!.selected())).toEqual([commander]);
    expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(baseline.sent);
    expect(await page.evaluate(() => window.__faf!.tick)).toBe(baseline.tick);
    expect(await page.evaluate(() => window.__faf!.cameraState())).toEqual(baseline.camera);
    await info.attach('native-proposed-grid', { body: await page.screenshot(), contentType: 'image/png' });
    await page.mouse.up();
    await expect(page.getByTestId('build-drag-ghosts')).toHaveCount(0);
    expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(baseline.sent + valid.length);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(baseline.sent + valid.length);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Escape');
    await stepTicks(page, 4); await rendered(page);
    const watch = await page.evaluate(handle => window.__faf!.watch().find(record => record.handle === handle), commander);
    expect(watch).toBeDefined();
    expect(watch!.orders).toBe(valid.length);
    expect(watch!.targets.length).toBe(Math.min(valid.length, 16));
    expect(watch!.targets.map(({ type, x, z }) => ({ type, x, z }))).toEqual(valid.slice(0, 16).map(site => ({
      type: WatchOrderType.Build, x: site.x / 4096, z: site.z / 4096,
    })));
    // A started site may already have a mesh. Reconcile native geometry rather than assuming
    // every accepted order still appears as a ghost after the first stepped Frame.
    const acceptedGhosts = await page.getByTestId('queued-build-ghost').evaluateAll(elements => elements.map(el => ({
      x: Number(el.getAttribute('data-x')), z: Number(el.getAttribute('data-z')),
    })));
    const materialized = await page.evaluate(visual => {
      const h = window.__faf!;
      return h.ownHandles().flatMap(handle => {
        const unit = h.unitInfo(handle);
        return unit?.visual === visual ? [{ handle, x: Math.round(unit.x * 4096), z: Math.round(unit.z * 4096) }] : [];
      });
    }, bp);
    const geometry = new Set([...acceptedGhosts, ...materialized].map(site => `${site.x}:${site.z}`));
    expect(valid.every(site => geometry.has(`${site.x}:${site.z}`))).toBe(true);
    expect(acceptedGhosts.every(site => valid.some(expected => expected.x === site.x && expected.z === site.z))).toBe(true);
    expect(await page.evaluate(() => window.__faf!.selected())).toEqual([commander]);
    const final = await receipt(page);
    expect(final.tainted).toBe(false); expect(final.hostErrors).toEqual([]);
    await assertSilentOutput(page); expectNoErrors(errors);
    await attachJson(info, 'native-grid-command-receipt', { engine: info.project.name, commander, bp, width, height,
      baseline, capped, proposed, valid, watch, acceptedGhosts, materialized, favicon, final, hardwareAudioGuardVerified: true });
    await info.attach('native-accepted-grid', { body: await page.screenshot(), contentType: 'image/png' });
  } finally {
    await page.mouse.up(); await page.keyboard.up('Shift'); await page.keyboard.up('ArrowRight');
  }
});

test('native Escape right click and Pause cancel held building drags without a Build', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  await pause(page);
  await page.evaluate(() => window.__faf!.setCamera(132, 85, 100));
  await clickUnit(page, commander);
  const start = await groundPixel(page, 132, 80), end = await groundPixel(page, 140.25, 84.25);
  const cancellations = [];
  for (const action of ['Escape', 'right click', 'Pause'] as const) {
    await page.keyboard.press('KeyW');
    const sent = await page.evaluate(() => window.__faf!.inspection()!.sentCommands);
    await page.keyboard.down('Shift');
    try {
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 6 });
      await expect(page.getByTestId('build-drag-ghosts')).toBeVisible();
      expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(sent);
      if (action === 'Escape') await page.keyboard.press('Escape');
      if (action === 'right click') await page.mouse.click(end.x, end.y, { button: 'right' });
      if (action === 'Pause') await page.keyboard.press('KeyP');
      await page.mouse.up();
      await expect(page.getByTestId('build-drag-ghosts')).toHaveCount(0);
      expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(sent);
      expect(await page.evaluate(() => window.__faf!.selected())).toEqual([commander]);
      await expect(page.locator('.faf-drag')).toHaveCount(0);
      cancellations.push({ action, sent, after: await receipt(page) });
    } finally { await page.mouse.up(); await page.keyboard.up('Shift'); }
    await pause(page);
    // Pause retains placement mode for the next ordinary click; clear it before rearming.
    if (action === 'Pause') await page.keyboard.press('Escape');
  }
  await stepTicks(page, 2); await rendered(page);
  const watch = await page.evaluate(handle => window.__faf!.watch().find(record => record.handle === handle), commander);
  expect(watch?.orders).toBe(0);
  const final = await receipt(page);
  expect(final.tainted).toBe(false); expect(final.hostErrors).toEqual([]);
  await assertSilentOutput(page); expectNoErrors(errors);
  await attachJson(info, 'native-cancel-command-receipt', { engine: info.project.name, commander, cancellations, watch, final });
});

test('native original ACU Move drives opposed legs and returns their accepted pose to rest', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  await pause(page);
  const variants = ['core:cmd_commander', 'core:cmd_commander_engineering', 'core:cmd_commander_armored']
    .map(id => ({ id, bp: SKIRMISH_BLUEPRINTS.indexOf(id) }));
  expect(variants.every(variant => variant.bp >= 0)).toBe(true);
  expect(new Set(variants.map(variant => variant.bp)).size).toBe(3);
  const initial = await page.evaluate(handle => window.__faf!.unitInfo(handle), commander);
  expect(initial?.visual).toBe(variants[0]!.bp);
  await page.evaluate(point => window.__faf!.setCamera(point.x + 3, point.z, 34), initial!);
  await clickUnit(page, commander);
  await stepTicks(page, 2); await rendered(page);
  const origin = await page.evaluate(handle => window.__faf!.unitInfo(handle), commander);
  expect(origin?.orders).toBe(0);
  const idle = await page.evaluate(handle => window.__faf!.rigPose(handle), commander);
  expect(idle).not.toBeNull();
  expect(idle!.parts.find(part => part.id === 1)?.curPitch).toBe(0);
  expect(idle!.parts.find(part => part.id === 2)?.curPitch).toBe(0);
  expect(idle!.observationMask).toBe(0);
  const target = { x: origin!.x + 8, z: origin!.z };
  const ground = await groundPixel(page, target.x, target.z);
  const sent = await page.evaluate(() => window.__faf!.inspection()!.sentCommands);
  await page.mouse.click(ground.x, ground.y, { button: 'right' });
  expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(sent + 1);
  const issued = await page.evaluate(() => window.__faf!.lastMoveTarget());
  expect(issued?.units).toBe(1);
  expect(Math.abs(issued!.x / 4096 - target.x)).toBeLessThan(.05);
  expect(Math.abs(issued!.z / 4096 - target.z)).toBeLessThan(.05);
  const samples = [];
  let movingScreenshot = false, arrived = false;
  for (let n = 0; n < 120; n++) {
    await stepTicks(page, 1); await rendered(page);
    const sample = await page.evaluate(handle => ({ pose: window.__faf!.rigPose(handle),
      position: window.__faf!.unitPos(handle), watch: window.__faf!.watch().find(record => record.handle === handle),
      stats: window.__faf!.rigPoseStats(), tick: window.__faf!.tick }), commander);
    expect(sample.pose).not.toBeNull();
    const left = sample.pose!.parts.find(part => part.id === 1), right = sample.pose!.parts.find(part => part.id === 2);
    expect(left).toBeDefined(); expect(right).toBeDefined();
    expect(left!.curPitch + right!.curPitch).toBe(0);
    expect(Math.abs(left!.curPitch)).toBeLessThanOrEqual(Math.ceil(24 * 65536 / 360));
    expect(left!.curYaw).toBe(0); expect(right!.curYaw).toBe(0);
    // With no observed combat target, gait must not create torso/barrel aiming.
    expect(sample.pose!.observationMask).toBe(idle!.observationMask);
    expect(sample.pose!.parts.find(part => part.id === 3)?.curYaw).toBe(idle!.parts.find(part => part.id === 3)?.curYaw);
    expect(sample.pose!.parts.find(part => part.id === 4)?.curPitch).toBe(idle!.parts.find(part => part.id === 4)?.curPitch);
    expect(sample.stats.overflowUnits).toBe(0);
    samples.push(sample);
    if (!movingScreenshot && Math.abs(left!.curPitch) > 0) {
      expect(sample.stats.walkingUnits).toBeGreaterThan(0);
      expect(Math.hypot(sample.position!.x - origin!.x, sample.position!.z - origin!.z)).toBeGreaterThan(0);
      await info.attach('native-ACU-walking-frame', { body: await page.locator('#game-canvas').screenshot(), contentType: 'image/png' });
      movingScreenshot = true;
    }
    if (sample.watch?.orders === 0 && Math.hypot(sample.position!.x - target.x, sample.position!.z - target.z) < 1.5) {
      arrived = true; break;
    }
  }
  expect(movingScreenshot, 'accepted movement reaches a nonzero opposed leg pose').toBe(true);
  expect(arrived, 'ordinary Move completes within 120 accepted ticks').toBe(true);
  const moving = samples.filter(sample => sample.pose!.parts.find(part => part.id === 1)!.curPitch !== 0);
  expect(moving.some(sample => sample.pose!.parts.find(part => part.id === 1)!.curPitch > 0)).toBe(true);
  expect(moving.some(sample => sample.pose!.parts.find(part => part.id === 1)!.curPitch < 0)).toBe(true);
  await stepTicks(page, 3); await rendered(page);
  const firstRest = await page.evaluate(handle => ({ pose: window.__faf!.rigPose(handle), position: window.__faf!.unitPos(handle),
    watch: window.__faf!.watch().find(record => record.handle === handle), stats: window.__faf!.rigPoseStats() }), commander);
  await attachJson(info, 'native-ACU-first-rest', { engine: info.project.name, commander, firstRest });
  expect(firstRest.watch?.orders).toBe(0);
  // The first stationary current pose can still interpolate from the preceding moving pose.
  // A further accepted stationary Frame must settle both endpoints to authored rest.
  for (const id of [1, 2]) {
    expect(firstRest.pose!.parts.find(part => part.id === id)).toMatchObject({ prevYaw: 0, curYaw: 0, curPitch: 0 });
  }
  await stepTicks(page, 2); await rendered(page);
  const settledRest = await page.evaluate(handle => ({ pose: window.__faf!.rigPose(handle), position: window.__faf!.unitPos(handle),
    watch: window.__faf!.watch().find(record => record.handle === handle), stats: window.__faf!.rigPoseStats() }), commander);
  await attachJson(info, 'native-ACU-settled-rest', { engine: info.project.name, commander, firstRest, settledRest });
  expect(settledRest.pose!.tick).toBeGreaterThan(firstRest.pose!.tick);
  expect(settledRest.watch?.orders).toBe(0);
  expect(settledRest.position).toEqual(firstRest.position);
  for (const id of [1, 2]) {
    expect(settledRest.pose!.parts.find(part => part.id === id)).toMatchObject({ prevYaw: 0, curYaw: 0, prevPitch: 0, curPitch: 0 });
  }
  expect(firstRest.pose!.bodyCurYaw).toBe(samples.at(-1)!.pose!.bodyCurYaw);
  expect(settledRest.pose!.bodyCurYaw).toBe(firstRest.pose!.bodyCurYaw);
  for (const rest of [firstRest, settledRest]) {
    expect(rest.pose!.observationMask).toBe(idle!.observationMask);
    expect(rest.pose!.parts.find(part => part.id === 3)?.curYaw).toBe(idle!.parts.find(part => part.id === 3)?.curYaw);
    expect(rest.pose!.parts.find(part => part.id === 4)?.curPitch).toBe(idle!.parts.find(part => part.id === 4)?.curPitch);
  }
  const final = await receipt(page);
  expect(final.tainted).toBe(false); expect(final.hostErrors).toEqual([]);
  await assertSilentOutput(page); expectNoErrors(errors);
  await attachJson(info, 'native-original-ACU-gait-receipt', { engine: info.project.name, commander, variants, origin, idle,
    target, issued, samples, firstRest, settledRest, final, fixture: 'Original skirmish commander, ordinary native right-click Move, accepted Frames and submitted rig buffers; no Spawn.' });
  await info.attach('native-ACU-rest-frame', { body: await page.locator('#game-canvas').screenshot(), contentType: 'image/png' });
});
