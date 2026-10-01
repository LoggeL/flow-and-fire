import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page): Promise<void> {
  const frame = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(next => window.__faf!.renderStats().frames >= next, frame);
}

async function spawn(page: Page, blueprint: string, x: number, z: number, army = 0): Promise<number> {
  const before = await page.evaluate(() => window.__faf!.projectedUnits().map(u => u.handle));
  await page.evaluate(args => window.__faf!.spawnAt(args.blueprint, args.x, args.z, args.army), { blueprint, x, z, army });
  await stepTicks(page, 2);
  await rendered(page);
  const visual = SKIRMISH_BLUEPRINTS.indexOf(blueprint);
  const handle = await page.evaluate(args => window.__faf!.projectedUnits().find(u =>
    !args.before.includes(u.handle) && u.visual === args.visual && u.army === args.army)?.handle ?? null, { before, visual, army });
  expect(handle, `real Spawn command publishes ${blueprint}`).not.toBeNull();
  return handle!;
}

test('actual combat articulates tank barrel and independent heavy turrets without turning the stationary hull', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startHumanAiSkirmish(page);
  await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  await page.evaluate(() => window.__faf!.setCamera(119, 101, 34));

  // This is a deliberately tainted, bounded combat fixture, through the real command pipeline.
  // It does not fabricate Frames, inspect World, or claim ordinary production of T3 units.
  const heavy = await spawn(page, 'core:lnd_t3_heavy', 116, 96);
  const tank = await spawn(page, 'core:lnd_t1_tank', 110, 104);
  const idle = await page.evaluate(({ heavy, tank }) => ({ heavy: window.__faf!.rigPose(heavy), tank: window.__faf!.rigPose(tank) }), { heavy, tank });
  expect(idle.heavy?.observationMask).toBe(0);
  expect(idle.tank?.observationMask).toBe(0);
  const target = await spawn(page, 'core:str_t1_mex', 125, 105, 1);
  await clickUnit(page, heavy);
  await page.keyboard.press('Alt+KeyA');
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-game-cursor', 'attack');
  const pixel = await page.evaluate(h => window.__faf!.unitScreenPos(h), target);
  expect(pixel).not.toBeNull();
  await page.mouse.click(pixel!.x, pixel!.y);
  await stepTicks(page, 2);
  await rendered(page);
  expect(await page.evaluate(h => window.__faf!.watch().find(w => w.handle === h)?.orders ?? 0, heavy)).toBeGreaterThan(0);

  const aimed = await page.evaluate(({ heavy, tank }) => ({ heavy: window.__faf!.rigPose(heavy), tank: window.__faf!.rigPose(tank), stats: window.__faf!.rigPoseStats(), render: window.__faf!.renderStats() }), { heavy, tank });
  expect(aimed.heavy?.observationMask).toBe(3);
  expect(aimed.tank?.observationMask).toBe(1);
  expect(aimed.heavy!.bodyCurYaw).toBe(idle.heavy!.bodyCurYaw);
  expect(aimed.tank!.bodyCurYaw).toBe(idle.tank!.bodyCurYaw);
  const first = aimed.heavy!.parts.find(p => p.id === 3)!, second = aimed.heavy!.parts.find(p => p.id === 4)!;
  expect(first.curYaw).not.toBe(0);
  expect(second.curYaw).not.toBe(0);
  expect(first.curYaw, 'actual mounts have separate combat rotation rates').not.toBe(second.curYaw);
  expect(aimed.tank!.parts.find(p => p.id === 1)!.curYaw).not.toBe(0);
  expect(aimed.tank!.parts.find(p => p.id === 2)!.curPitch).toBeLessThan(0);
  expect(aimed.stats.overflowUnits).toBe(0);
  expect(aimed.stats.observedMounts).toBeGreaterThanOrEqual(3);
  expect(aimed.render.drawsByPass.units).toBeGreaterThan(0);
  expect(aimed.render.unitInstances).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: info.outputPath('actual-combat-joints.png') });
  await info.attach('actual-combat-joints', { path: info.outputPath('actual-combat-joints.png'), contentType: 'image/png' });

  for (let n = 0; n < 100 && await page.evaluate(h => window.__faf!.unitPos(h) !== null, target); n++) await stepTicks(page, 1);
  expect(await page.evaluate(h => window.__faf!.unitPos(h), target), 'actual projectiles destroy the enemy target').toBeNull();
  await stepTicks(page, 2);
  await rendered(page);
  const lost = await page.evaluate(({ heavy, tank }) => ({ heavy: window.__faf!.rigPose(heavy), tank: window.__faf!.rigPose(tank) }), { heavy, tank });
  for (const pose of [lost.heavy!, lost.tank!]) {
    expect(pose.observationMask).toBe(0);
    expect(pose.parts.every(p => p.prevYaw === 0 && p.curYaw === 0 && p.prevPitch === 0 && p.curPitch === 0)).toBe(true);
  }
  await clickUnit(page, tank);
  const moveTarget = { x: 104, z: 100 };
  const move = await groundPixel(page, moveTarget.x, moveTarget.z);
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, move)).toBe('game-canvas');
  await page.mouse.click(move.x, move.y, { button: 'right' });
  await expect.poll(() => page.evaluate(() => window.__faf!.lastMoveTarget()?.units)).toBe(1);
  const issuedMove = await page.evaluate(() => window.__faf!.lastMoveTarget()!);
  expect(Math.abs(issuedMove.x / 4096 - moveTarget.x)).toBeLessThan(.05);
  expect(Math.abs(issuedMove.z / 4096 - moveTarget.z)).toBeLessThan(.05);
  await stepTicks(page, 10);
  await rendered(page);
  const moving = await page.evaluate(h => window.__faf!.rigPose(h), tank);
  expect(moving?.bodyCurYaw).not.toBe(idle.tank!.bodyCurYaw);
  expect(moving!.parts.every(p => p.curYaw === 0 && p.curPitch === 0)).toBe(true);
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  await assertSilentOutput(page);
  await attachJson(info, 'actual-unit-rigs', { buildHash: await page.evaluate(() => window.__faf!.buildHash),
    fixture: 'Explicitly tainted real Spawn commands, native Attack and native Move, actual Sim combat/accepted Frames/render buffers.',
    heavy, tank, target, idle, aimed, lost, moveTarget, issuedMove, moving });
  expectNoErrors(errors);
});
