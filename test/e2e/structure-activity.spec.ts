import { UnitFlags } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page): Promise<void> {
  const target = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(n => window.__faf!.renderStats().frames >= n, target);
}

async function startPaused(page: Page): Promise<number> {
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  await assertSilentOutput(page);
  return commander;
}

async function accepted(page: Page, ticks: number): Promise<void> {
  await stepTicks(page, ticks);
  await rendered(page);
}

/** Diagnostic actors enter only through real, explicitly tainted Spawn commands. */
async function spawn(page: Page, id: string, x: number, z: number, army = 0): Promise<number> {
  const before = await page.evaluate(() => window.__faf!.projectedUnits().map(unit => unit.handle));
  await page.evaluate(args => window.__faf!.spawnAt(args.id, args.x, args.z, args.army), { id, x, z, army });
  await accepted(page, 2);
  const visual = SKIRMISH_BLUEPRINTS.indexOf(id);
  expect(visual).toBeGreaterThanOrEqual(0);
  const handle = await page.evaluate(args => window.__faf!.projectedUnits().find(unit =>
    !args.before.includes(unit.handle) && unit.visual === args.visual && unit.army === args.army)?.handle ?? null,
  { before, visual, army });
  expect(handle, `actual accepted Spawn publishes ${id}`).not.toBeNull();
  expect(await page.evaluate(h => window.__faf!.unitInfo(h)?.build, handle!)).toBe(1);
  return handle!;
}

async function state(page: Page, handles: number[]) {
  return page.evaluate(ids => {
    const h = window.__faf!, inspection = h.inspection()!;
    return { buildHash: h.buildHash, tick: h.tick, paused: h.paused, tainted: h.tainted, inspection,
      actors: ids.map(handle => ({ handle, unit: h.unitInfo(handle), pose: h.rigPose(handle),
        work: inspection.watches.find(record => record.handle === handle) })),
      stats: h.rigPoseStats(), render: h.renderStats(), hostErrors: h.hostErrors };
  }, handles);
}

type Snapshot = Awaited<ReturnType<typeof state>>;
function actor(snapshot: Snapshot, handle: number) {
  const row = snapshot.actors.find(unit => unit.handle === handle);
  expect(row).toBeDefined(); expect(row!.unit).not.toBeNull(); expect(row!.pose).not.toBeNull();
  return row!;
}
function part(snapshot: Snapshot, handle: number, id = 1) {
  const joint = actor(snapshot, handle).pose!.parts.find(p => p.id === id);
  expect(joint, `submitted part ${id} of ${handle}`).toBeDefined();
  return joint!;
}
function currentParts(snapshot: Snapshot) {
  return snapshot.actors.map(row => ({ handle: row.handle, parts: row.pose?.parts.map(p => ({ id: p.id, yaw: p.curYaw, pitch: p.curPitch })) }));
}

/** Let real render frames and wall time pass while the accepted sim tick stays fixed. */
async function noWallClockMotion(page: Page, handles: number[]) {
  const before = await state(page, handles);
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 250)));
  await rendered(page);
  const after = await state(page, handles);
  expect(after.tick).toBe(before.tick);
  expect(currentParts(after)).toEqual(currentParts(before));
  expect(after.render.frames).toBeGreaterThan(before.render.frames);
  return { before, after };
}

async function select(page: Page, handle: number): Promise<void> {
  const point = await page.evaluate(h => window.__faf!.unitPos(h)!, handle);
  await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 34), point);
  await rendered(page); await clickUnit(page, handle); await accepted(page, 1);
}

async function silentAudit(page: Page) {
  await assertSilentOutput(page);
  return page.evaluate(() => (window as unknown as { __fafSilentAudio: {
    installed: boolean; contexts: number; streamDestinations: number; speakerConnections: number; blockedConnections: number;
  } }).__fafSilentAudio);
}

test.describe.configure({ retries: 0 });

test('native paid T1 and T2 factory production animates gates and holds on pause before closing at idle', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page), rows: unknown[] = [];
  const commander = await startPaused(page);
  const origin = await page.evaluate(h => window.__faf!.unitPos(h)!, commander);
  const factories = [
    { id: 'core:fac_land_t1', product: 'core:lnd_t1_tank', label: 'Punze', handle: await spawn(page, 'core:fac_land_t1', origin.x + 14, origin.z - 8) },
    { id: 'core:fac_land_t2', product: 'core:lnd_t2_tank', label: 'Meißel', handle: await spawn(page, 'core:fac_land_t2', origin.x + 25, origin.z - 8) },
  ];
  for (const factory of factories) {
    await select(page, factory.handle);
    const idle = await state(page, [factory.handle]);
    expect(part(idle, factory.handle).curPitch).toBe(0);
    const queue = page.getByTestId('factory-queue'); await expect(queue).toBeVisible();
    const cell = page.getByRole('gridcell').filter({ hasText: factory.label }); await expect(cell).toHaveCount(1);
    await cell.click(); await accepted(page, 3);
    const begun = await state(page, [factory.handle]);
    expect(actor(begun, factory.handle).work?.product).toBe(factory.product);
    expect(actor(begun, factory.handle).work!.progress).toBeGreaterThan(0);
    const samples = [begun];
    for (let n = 0; n < 3; n++) { await accepted(page, 1); samples.push(await state(page, [factory.handle])); }
    const operating = samples.at(-1)!;
    expect(actor(operating, factory.handle).work!.progress).toBeGreaterThan(actor(begun, factory.handle).work!.progress);
    expect(operating.inspection.eco[0]!.massStored).toBeLessThan(begun.inspection.eco[0]!.massStored);
    expect(part(operating, factory.handle).curPitch).toBeGreaterThan(part(begun, factory.handle).curPitch);
    expect(part(operating, factory.handle).curPitch).toBeLessThanOrEqual(14564);
    const wallPause = await noWallClockMotion(page, [factory.handle]);
    await queue.getByRole('button', { name: 'Pause', exact: true }).click(); await accepted(page, 2);
    const paused = await state(page, [factory.handle]);
    expect(actor(paused, factory.handle).unit!.flags & UnitFlags.Paused).not.toBe(0);
    await accepted(page, 8); const held = await state(page, [factory.handle]);
    expect(actor(held, factory.handle).work!.progress).toBe(actor(paused, factory.handle).work!.progress);
    expect(part(held, factory.handle).curPitch).toBe(part(paused, factory.handle).curPitch);
    expect(part(held, factory.handle).prevPitch).toBe(part(held, factory.handle).curPitch);
    await queue.getByRole('button', { name: 'Pause', exact: true }).click(); await accepted(page, 2);
    const resumed = await state(page, [factory.handle]);
    expect(actor(resumed, factory.handle).unit!.flags & UnitFlags.Paused).toBe(0);
    expect(actor(resumed, factory.handle).work!.progress).toBeGreaterThan(actor(held, factory.handle).work!.progress);
    expect(part(resumed, factory.handle).curPitch - part(held, factory.handle).curPitch).toBeGreaterThan(0);
    expect(part(resumed, factory.handle).curPitch - part(held, factory.handle).curPitch).toBeLessThanOrEqual((resumed.tick - held.tick) * 1365);
    await info.attach(`native-${factory.id.replace(':', '-')}-producing`, { body: await page.screenshot(), contentType: 'image/png' });
    await queue.getByRole('button', { name: 'Leeren', exact: true }).click(); await accepted(page, 14);
    const closed = await state(page, [factory.handle]);
    expect(actor(closed, factory.handle).work?.product).toBeNull();
    expect(part(closed, factory.handle)).toMatchObject({ prevYaw: 0, curYaw: 0, prevPitch: 0, curPitch: 0 });
    rows.push({ factory, idle, begun, samples, operating, wallPause, paused, held, resumed, closed });
  }

  // An actual native Build supplies the incomplete case, rather than fabricated build flags.
  await select(page, commander); await page.keyboard.press('KeyA');
  let site: { x: number; z: number } | null = null;
  for (const [dx, dz] of [[4, 0], [0, 4], [-4, 0], [0, -4], [4, 4]]) {
    const pixel = await groundPixel(page, Math.floor(origin.x + dx!) + .5, Math.floor(origin.z + dz!) + .5);
    await page.mouse.move(pixel.x, pixel.y);
    const ghost = page.getByTestId('build-ghost'); await expect(ghost).toBeVisible();
    if (await ghost.getAttribute('data-verdict') !== '0') continue;
    site = { x: Number(await ghost.getAttribute('data-x')) / 4096, z: Number(await ghost.getAttribute('data-z')) / 4096 };
    await page.mouse.click(pixel.x, pixel.y); break;
  }
  expect(site).not.toBeNull(); await accepted(page, 4);
  const incomplete = await page.evaluate(complete => window.__faf!.ownHandles().find(h =>
    !complete.includes(h) && window.__faf!.unitInfo(h)?.visual === window.__faf!.unitInfo(complete[0]!)?.visual) ?? null,
  factories.map(factory => factory.handle));
  expect(incomplete, 'native Build creates an incomplete T1 factory').not.toBeNull();
  await page.keyboard.press('Alt+KeyS'); await accepted(page, 2);
  const before = await state(page, [incomplete!]); await accepted(page, 5); const after = await state(page, [incomplete!]);
  expect(actor(before, incomplete!).unit!.build).toBeLessThan(1);
  expect(actor(after, incomplete!).unit!.build).toBe(actor(before, incomplete!).unit!.build);
  expect(part(after, incomplete!)).toMatchObject({ prevYaw: 0, curYaw: 0, prevPitch: 0, curPitch: 0 });
  const final = await state(page, factories.map(factory => factory.handle));
  expect(final.tainted).toBe(true); expect(final.hostErrors).toEqual([]); expect(final.stats.overflowUnits).toBe(0);
  const silent = await silentAudit(page); expectNoErrors(errors);
  await attachJson(info, 'native-factory-activity-receipt', { engine: info.project.name, rows, site, incomplete, before, after, final, silent,
    fixture: 'Bounded explicitly tainted actual Spawn of completed factory tiers; ordinary HUD production, TogglePause and clear queue, native Build/Stop for incomplete site; actual accepted Frames and submitted rig buffers.' });
});

test('native billed extractor and radar activity holds without catchup and point defense retains real combat aim', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page), rows: unknown[] = [];
  const commander = await startPaused(page);
  const origin = await page.evaluate(h => window.__faf!.unitPos(h)!, commander);
  const actors = [
    { id: 'core:str_t1_mex', handle: await spawn(page, 'core:str_t1_mex', origin.x + 14, origin.z + 8), axis: 'pitch' },
    { id: 'core:str_t2_mex', handle: await spawn(page, 'core:str_t2_mex', origin.x + 22, origin.z + 9), axis: 'pitch' },
    { id: 'core:str_t1_radar', handle: await spawn(page, 'core:str_t1_radar', origin.x + 30, origin.z + 16), axis: 'yaw' },
  ];
  const handles = actors.map(unit => unit.handle), start = await state(page, handles), samples = [start];
  for (let n = 0; n < 25; n++) { await accepted(page, 1); samples.push(await state(page, handles)); }
  expect(samples.at(-1)!.inspection.eco[0]!.energyStored).toBeLessThan(start.inspection.eco[0]!.energyStored);
  for (const unit of actors) {
    const poses = samples.map(sample => part(sample, unit.handle));
    expect(new Set(poses.map(p => unit.axis === 'pitch' ? p.curPitch : p.curYaw)).size).toBeGreaterThan(5);
    if (unit.axis === 'pitch') {
      expect(poses.some(p => p.curPitch > 0)).toBe(true); expect(poses.some(p => p.curPitch < 0)).toBe(true);
      expect(poses.every(p => Math.abs(p.curPitch) <= 910 && p.curYaw === 0)).toBe(true);
    } else expect(poses.every(p => p.curPitch === 0)).toBe(true);
  }
  const wallPause = await noWallClockMotion(page, handles);
  for (const unit of actors) {
    await select(page, unit.handle);
    const toggle = page.getByTestId('selection-details-toggle');
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    await expect(page.getByTestId('order-pause')).toBeVisible();
    await page.getByTestId('order-pause').click(); await accepted(page, 2);
    const paused = await state(page, [unit.handle]);
    expect(actor(paused, unit.handle).unit!.flags & UnitFlags.Paused).not.toBe(0);
    await accepted(page, 9); const held = await state(page, [unit.handle]);
    expect(part(held, unit.handle).curPitch).toBe(part(paused, unit.handle).curPitch);
    expect(part(held, unit.handle).curYaw).toBe(part(paused, unit.handle).curYaw);
    expect(part(held, unit.handle).prevPitch).toBe(part(held, unit.handle).curPitch);
    expect(part(held, unit.handle).prevYaw).toBe(part(held, unit.handle).curYaw);
    await page.getByTestId('selection-resume').click(); await accepted(page, 2);
    const resumed = await state(page, [unit.handle]);
    expect(actor(resumed, unit.handle).unit!.flags & UnitFlags.Paused).toBe(0);
    if (unit.axis === 'yaw') {
      const delta = (part(resumed, unit.handle).curYaw - part(held, unit.handle).curYaw) & 65535;
      expect(delta).toBeGreaterThan(0); expect(delta).toBeLessThanOrEqual((resumed.tick - held.tick) * 1092);
    } else {
      const delta = Math.abs(part(resumed, unit.handle).curPitch - part(held, unit.handle).curPitch);
      expect(delta).toBeGreaterThan(0);
      expect(delta).toBeLessThanOrEqual(Math.ceil((resumed.tick - held.tick) * 910 * 2731 * Math.PI / 32768));
    }
    await info.attach(`native-${unit.id.replace(':', '-')}-resumed`, { body: await page.screenshot(), contentType: 'image/png' });
    rows.push({ unit, paused, held, resumed });
  }
  const foreign = [await spawn(page, 'core:str_t1_radar', origin.x + 42, origin.z + 16, 1),
    await spawn(page, 'core:str_t2_mex', origin.x + 42, origin.z + 10, 1)];
  const privateBefore = await state(page, foreign); await accepted(page, 5); const privateAfter = await state(page, foreign);
  expect(privateBefore.inspection.viewer).toBe(0);
  expect(currentParts(privateAfter)).toEqual(currentParts(privateBefore));
  for (const handle of foreign) expect(part(privateAfter, handle)).toMatchObject({ prevYaw: 0, curYaw: 0, prevPitch: 0, curPitch: 0 });

  const pd = await spawn(page, 'core:str_t1_pd', origin.x + 84, origin.z - 6);
  await select(page, pd); const idle = await state(page, [pd]); expect(actor(idle, pd).pose!.observationMask).toBe(0);
  const target = await spawn(page, 'core:str_t1_mex', origin.x + 97, origin.z + 3, 1);
  await page.keyboard.press('Alt+KeyA'); await expect(page.locator('#game-canvas')).toHaveAttribute('data-game-cursor', 'attack');
  const targetPixel = await page.evaluate(h => window.__faf!.unitScreenPos(h), target); expect(targetPixel).not.toBeNull();
  await page.mouse.click(targetPixel!.x, targetPixel!.y); await accepted(page, 2);
  const aimed = await state(page, [pd]);
  expect(actor(aimed, pd).pose!.observationMask).toBe(1);
  expect(part(aimed, pd).curYaw).not.toBe(0); expect(part(aimed, pd, 2).curPitch).not.toBe(0);
  expect(actor(aimed, pd).pose!.bodyCurYaw).toBe(actor(idle, pd).pose!.bodyCurYaw);
  await info.attach('native-point-defense-aim', { body: await page.screenshot(), contentType: 'image/png' });
  for (let n = 0; n < 120 && await page.evaluate(h => window.__faf!.unitPos(h) !== null, target); n++) await accepted(page, 1);
  expect(await page.evaluate(h => window.__faf!.unitPos(h), target)).toBeNull();
  await accepted(page, 2); const lost = await state(page, [pd]);
  expect(actor(lost, pd).pose!.observationMask).toBe(0);
  expect(actor(lost, pd).pose!.parts.every(p => p.prevYaw === 0 && p.curYaw === 0 && p.prevPitch === 0 && p.curPitch === 0)).toBe(true);
  const final = await state(page, handles);
  expect(final.tainted).toBe(true); expect(final.hostErrors).toEqual([]); expect(final.stats.overflowUnits).toBe(0);
  const silent = await silentAudit(page); expectNoErrors(errors);
  await attachJson(info, 'native-upkeep-and-point-defense-receipt', { engine: info.project.name, actors, start, samples, wallPause, rows,
    foreign, privateBefore, privateAfter, pd, target, idle, aimed, lost, final, silent,
    fixture: 'Bounded explicitly tainted actual Spawn commands, actual billed upkeep and accepted ticks, native TogglePause/resume and point-defense Attack, submitted rig buffers; no fake Frames or hidden World.' });
});
