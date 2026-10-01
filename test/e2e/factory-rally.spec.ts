import { PlacementVerdict } from '../../packages/rules/src/index.ts';
import { WatchOrderType } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput, installSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page, type TestInfo } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page) {
  const target = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(n => window.__faf!.renderStats().frames >= n, target);
}
/** One real paused-host batch, followed by its actual accepted final frame. */
async function batchTicks(page: Page, count: number) {
  const target = await page.evaluate(n => {
    const h = window.__faf!;
    if (!h.paused) throw new Error('Factory rally qualification requires the paused host');
    const target = h.tick + n; h.ctl({ t: 'step', ticks: n }); return target;
  }, count);
  await page.waitForFunction(t => window.__faf!.tick === t, target, { timeout: 20_000 });
  await rendered(page);
}
async function state(page: Page, handles: number[]) {
  return page.evaluate(ids => {
    const h = window.__faf!, inspection = h.inspection()!;
    return { tick: h.tick, paused: h.paused, tainted: h.tainted, selected: h.selected(), inspection,
      actors: ids.map(handle => ({ handle, unit: h.unitInfo(handle), watch: h.watch().find(w => w.handle === handle) })),
      camera: h.cameraState(), render: h.renderStats(), hash: h.ruleHash(), hostErrors: h.hostErrors };
  }, handles);
}
async function select(page: Page, handles: number[]) {
  await clickUnit(page, handles[0]!);
  for (const handle of handles.slice(1)) {
    const pixel = await page.evaluate(id => window.__faf!.unitScreenPos(id)!, handle);
    expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, pixel)).toBe('game-canvas');
    await page.keyboard.down('Shift');
    try { await page.mouse.click(pixel.x, pixel.y); } finally { await page.keyboard.up('Shift'); }
  }
  await expect.poll(() => page.evaluate(() => window.__faf!.selected().sort((a, b) => a - b))).toEqual([...handles].sort((a, b) => a - b));
  await batchTicks(page, 1);
  for (const handle of handles) expect((await state(page, handles)).actors.find(a => a.handle === handle)?.watch).toBeDefined();
}
async function spawn(page: Page, id: string, point: { x: number; z: number }) {
  const before = await page.evaluate(() => window.__faf!.ownHandles());
  await page.evaluate(p => window.__faf!.spawnAt(p.id, p.x, p.z), { id, ...point });
  await batchTicks(page, 2);
  const visual = SKIRMISH_BLUEPRINTS.indexOf(id); expect(visual).toBeGreaterThanOrEqual(0);
  const handle = await page.evaluate(p => window.__faf!.ownHandles().find(h => !p.before.includes(h) && window.__faf!.unitInfo(h)?.visual === p.visual) ?? null, { before, visual });
  expect(handle, `actual accepted diagnostic Spawn ${id}`).not.toBeNull();
  const unit = await page.evaluate(h => window.__faf!.unitInfo(h)!, handle!);
  expect(unit.build).toBe(1); expect(unit.blocked).toBe(false); expect(unit.hp).toBe(unit.hpMax);
  return handle!;
}
function expectRally(snapshot: Awaited<ReturnType<typeof state>>, handle: number, point: { x: number; z: number }) {
  const accepted = snapshot.inspection.watches.find(w => w.handle === handle)?.rally;
  expect(accepted).toBeDefined();
  expect(accepted).toEqual(point);
  expect(snapshot.actors.find(a => a.handle === handle)?.watch?.orders).toBe(0);
}
/** Explicit integer native input; expected Q12 coordinates come from that same ray pick. */
async function nativePoint(page: Page, projected: { x: number; y: number }) {
  const pixel = { x: Math.round(projected.x), y: Math.round(projected.y) };
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, pixel)).toBe('game-canvas');
  const point = await page.evaluate(p => window.__faf!.screenToGround(p.x, p.y), pixel);
  expect(point).not.toBeNull();
  expect(Number.isInteger(point!.x * 4096)).toBe(true); expect(Number.isInteger(point!.z * 4096)).toBe(true);
  return { pixel, point: point! };
}
async function screenshots(page: Page, info: TestInfo, factory: number, focus: { x: number; z: number }) {
  const rows = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport); await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), focus); await rendered(page);
    const snapshot = await state(page, [factory]);
    expect(snapshot.render.lost).toBe(false); expect(snapshot.render.dynamicDecals).toBeGreaterThanOrEqual(3);
    const rally = snapshot.inspection.watches.find(w => w.handle === factory)!.rally;
    const pixel = await groundPixel(page, rally.x, rally.z);
    const path = info.outputPath(`accepted-factory-rally-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path }); await info.attach(`accepted-factory-rally-${viewport.width}x${viewport.height}`, { path, contentType: 'image/png' });
    rows.push({ viewport, rally, pixel, snapshot });
  }
  return rows;
}

// Root runs this same original scenario once in each of Chromium, Firefox and WebKit.
test.describe.configure({ retries: 0 });
test('native factory rally: friendly point, ground, armed HUD and real produced-unit movement', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = captureErrors(page), rows: unknown[] = [];
  try {
    await installSilentOutput(page); await page.setViewportSize({ width: 1440, height: 900 });
    const commander = await startHumanAiSkirmish(page);
    await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100');
    await expect(page.getByTestId('loading-screen')).toHaveCount(0);
    if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
    await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
    await assertSilentOutput(page);
    expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
    const origin = await page.evaluate(id => window.__faf!.unitPos(id)!, commander);
    await page.evaluate(p => window.__faf!.setCamera(p.x + 8, p.z + 4, 52), origin); await rendered(page);
    await select(page, [commander]); await page.keyboard.press('KeyA');
    // Validate the actual footprint through native Build preview before the explicit Spawn fixture.
    let site: { x: number; z: number } | null = null;
    for (const [dx, dz] of [[14, -8], [14, 0], [0, 14], [-14, 0]]) {
      const point = { x: Math.floor(origin.x + dx!) + 0.5, z: Math.floor(origin.z + dz!) + 0.5 };
      const pixel = await groundPixel(page, point.x, point.z); await page.mouse.move(pixel.x, pixel.y);
      const ghost = page.getByTestId('build-ghost'); await expect(ghost).toBeVisible();
      if (await ghost.getAttribute('data-verdict') !== String(PlacementVerdict.Valid)) continue;
      site = { x: Number(await ghost.getAttribute('data-x')) / 4096, z: Number(await ghost.getAttribute('data-z')) / 4096 }; break;
    }
    expect(site, 'real native footprint validation finds clear land').not.toBeNull(); await page.keyboard.press('Escape');
    const factory = await spawn(page, 'core:fac_land_t1', site!);
    const friend = await spawn(page, 'core:eng_t1', { x: site!.x + 8, z: site!.z + 8 });
    expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
    rows.push({ stage: 'explicitly-tainted-real-Spawn-fixture', site, commander, factory, friend, snapshot: await state(page, [factory, friend]) });

    await select(page, [factory]);
    const friendlyInput = await nativePoint(page, await page.evaluate(id => window.__faf!.unitScreenPos(id)!, friend));
    const beforeFriendly = await state(page, [factory, friend]);
    await page.mouse.click(friendlyInput.pixel.x, friendlyInput.pixel.y, { button: 'right' }); await batchTicks(page, 2);
    const afterFriendly = await state(page, [factory, friend]); expectRally(afterFriendly, factory, friendlyInput.point);
    expect(afterFriendly.inspection.sentCommands - beforeFriendly.inspection.sentCommands).toBe(1);
    rows.push({ stage: 'sole-factory-native-friendly-ground-point', input: friendlyInput, before: beforeFriendly, after: afterFriendly });

    const ground = { x: site!.x + 12, z: site!.z };
    const groundInput = await nativePoint(page, await groundPixel(page, ground.x, ground.z)), beforeGround = await state(page, [factory]);
    await page.mouse.click(groundInput.pixel.x, groundInput.pixel.y, { button: 'right' }); await batchTicks(page, 2);
    const afterGround = await state(page, [factory]); expectRally(afterGround, factory, groundInput.point);
    expect(afterGround.inspection.sentCommands - beforeGround.inspection.sentCommands).toBe(1);
    rows.push({ stage: 'sole-factory-native-free-ground-update', requested: ground, input: groundInput, before: beforeGround, after: afterGround });

    await select(page, [factory, friend]);
    const mixedPoint = { x: site!.x + 12, z: site!.z + 4 }, mixedInput = await nativePoint(page, await groundPixel(page, mixedPoint.x, mixedPoint.z));
    const beforeMixed = await state(page, [factory, friend]);
    await page.mouse.click(mixedInput.pixel.x, mixedInput.pixel.y, { button: 'right' }); await batchTicks(page, 2);
    const afterMixed = await state(page, [factory, friend]); expectRally(afterMixed, factory, mixedInput.point);
    expect(afterMixed.actors.find(a => a.handle === friend)?.watch?.targets[0]).toEqual({ type: WatchOrderType.Move, ...mixedInput.point });
    expect(afterMixed.inspection.sentCommands - beforeMixed.inspection.sentCommands).toBe(2);
    rows.push({ stage: 'native-mixed-factory-point-mobile-Move', requested: mixedPoint, input: mixedInput, before: beforeMixed, after: afterMixed,
      buttonBoundary: 'The live factory Rally button is presented only for all-factory selections; this mixed input qualifies the separate native context partition.' });
    await page.keyboard.press('Alt+KeyS'); await batchTicks(page, 2);

    await select(page, [factory]);
    const requestedRally = { x: site!.x + 12, z: site!.z + 12 };
    const queue = page.getByTestId('factory-queue'); await expect(queue).toBeVisible();
    const beforeArmed = await state(page, [factory, friend]);
    await queue.getByRole('button', { name: 'Rally', exact: true }).click();
    const armedInput = await nativePoint(page, await groundPixel(page, requestedRally.x, requestedRally.z));
    await page.mouse.click(armedInput.pixel.x, armedInput.pixel.y); await batchTicks(page, 2);
    const afterArmed = await state(page, [factory, friend]); expectRally(afterArmed, factory, armedInput.point);
    const rally = afterArmed.inspection.watches.find(w => w.handle === factory)!.rally;
    expect(afterArmed.inspection.sentCommands - beforeArmed.inspection.sentCommands).toBe(1);
    expect(afterArmed.actors.find(a => a.handle === friend)?.unit).toEqual(beforeArmed.actors.find(a => a.handle === friend)?.unit);
    rows.push({ stage: 'native-factory-HUD-Rally-arm-left-click', requested: requestedRally, input: armedInput, before: beforeArmed, after: afterArmed });
    const layouts = await screenshots(page, info, factory, { x: site!.x + 6, z: site!.z + 6 });
    await page.setViewportSize({ width: 1440, height: 900 }); await rendered(page);

    const beforeProduction = await page.evaluate(() => window.__faf!.ownHandles());
    const card = page.getByRole('gridcell').filter({ hasText: 'Lehrling' }); await expect(card).toHaveCount(1);
    await card.click(); await batchTicks(page, 1);
    const engineerVisual = SKIRMISH_BLUEPRINTS.indexOf('core:eng_t1');
    const product = await page.evaluate(p => window.__faf!.ownHandles().find(id => !p.before.includes(id) && window.__faf!.unitInfo(id)?.visual === p.visual) ?? null, { before: beforeProduction, visual: engineerVisual });
    expect(product, 'native HUD queue creates an actual incomplete factory product').not.toBeNull();
    const started = await state(page, [factory, product!]); expect(started.actors.find(a => a.handle === product)?.unit?.build).toBeLessThan(1);
    rows.push({ stage: 'native-HUD-card-real-paid-production-start', product, started });
    await select(page, [product!]);
    for (let batch = 0; batch < 25 && (await state(page, [product!])).actors[0]!.unit!.build < 1; batch++) await batchTicks(page, 10);
    const completed = await state(page, [product!]); expect(completed.actors[0]!.unit!.build).toBe(1);
    const move = completed.actors[0]!.watch!.targets.find(t => t.type === WatchOrderType.Move);
    expect(move, 'actual production completion supplies the accepted Move order').toBeDefined();
    expect({ x: move!.x, z: move!.z }).toEqual(rally);
    const position = completed.actors[0]!.unit!, initialDistance = Math.hypot(position.x - rally.x, position.z - rally.z);
    expect(initialDistance).toBeGreaterThan(3);
    const movement = [completed];
    for (let batch = 0; batch < 15; batch++) {
      await batchTicks(page, 10); const sample = await state(page, [product!]); movement.push(sample);
      const unit = sample.actors[0]!.unit!; if (Math.hypot(unit.x - rally.x, unit.z - rally.z) < 2) break;
    }
    const arrived = movement[movement.length - 1]!.actors[0]!.unit!;
    expect(Math.hypot(arrived.x - rally.x, arrived.z - rally.z)).toBeLessThan(2);
    expect(Math.hypot(arrived.x - position.x, arrived.z - position.z)).toBeGreaterThan(3);
    rows.push({ stage: 'accepted-production-Move-and-genuine-position-approach', rally, initialDistance, movement });
    await assertSilentOutput(page); expectNoErrors(errors);
    expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
    await attachJson(info, 'factory-rally-native-evidence', { rows, layouts, errors,
      boundary: 'Explicitly tainted real Spawn fixture; unchanged production content/costs, native input, real paused-worker steps, accepted watch coordinates and produced-unit movement. Screenshots and actual renderer counts document the cue; subjective pixel appearance requires visual review.' });
  } finally { await attachJson(info, 'factory-rally-partial-receipts', { rows, errors }); }
});
