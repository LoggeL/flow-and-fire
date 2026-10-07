import { readFile } from 'node:fs/promises';
import { readAllCommands, readRtsReplay, ReplayFlags } from '../../packages/formats/src/index.ts';
import { CommandBatchView, Op, UnitFlags, WatchOrderType } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput, installSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, SERVERS, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, setFrontendLocale, SKIRMISH_BLUEPRINTS } from './support/skirmish.ts';

async function rendered(page: Page) {
  const frame = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(value => window.__faf!.renderStats().frames >= value, frame);
}
async function start(page: Page, url: string) {
  await installSilentOutput(page);
  await page.goto(`${url}?menu=1&map=hollow-ridge&seed=177`, { waitUntil: 'commit' });
  await page.waitForURL(/\/b\/[^/]+\/(\?.*)?$/);
  await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
  const main = page.getByTestId('MainMenu'); await expect(main).toBeVisible();
  await setFrontendLocale(page, 'de');
  await main.getByRole('button', { name: /Gefecht/ }).click();
  const setup = page.getByTestId('SkirmishSetup'); await expect(setup).toBeVisible();
  await setup.getByTestId('skirmish-map-hollow-ridge').click();
  await setup.getByRole('combobox', { name: 'KI-Stufe', exact: true }).selectOption('normal');
  await setup.getByRole('button', { name: 'Gefecht starten', exact: true }).click();
  // The Sim hook becomes ready before the session's audio/first-frame loading overlay retires.
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1'
    && document.documentElement.dataset['loadingProgress'] === '100'
    && window.__faf?.ready && window.__faf.tick >= 1, null, { timeout: 60_000 });
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('live-hud')).toHaveAttribute('data-screen', 'game');
  expect(await page.evaluate(() => window.__faf!.tainted)).toBe(false);
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const visual = SKIRMISH_BLUEPRINTS.indexOf('core:cmd_commander');
  const commander = await page.evaluate(bp => window.__faf!.ownHandles().find(id => window.__faf!.unitInfo(id)?.visual === bp)!, visual);
  expect(commander).toBeDefined(); return commander;
}
async function spawn(page: Page, id: string, x: number, z: number, army = 0) {
  const before = await page.evaluate(() => window.__faf!.projectedUnits().map(u => u.handle));
  await page.evaluate(args => window.__faf!.spawnAt(args.id, args.x, args.z, args.army), { id, x, z, army });
  await stepTicks(page, 2); await rendered(page);
  const visual = SKIRMISH_BLUEPRINTS.indexOf(id);
  const handle = await page.evaluate(args => window.__faf!.projectedUnits().find(u => !args.before.includes(u.handle) && u.visual === args.visual && u.army === args.army)?.handle ?? null, { before, visual, army });
  expect(handle, `accepted diagnostic Spawn ${id}`).not.toBeNull(); return handle!;
}
async function select(page: Page, handles: number[]) {
  await clickUnit(page, handles[0]!);
  for (const handle of handles.slice(1)) {
    const pos = await page.evaluate(id => window.__faf!.unitScreenPos(id)!, handle);
    await page.keyboard.down('Shift'); await page.mouse.click(pos.x, pos.y); await page.keyboard.up('Shift');
  }
  await expect.poll(() => page.evaluate(() => window.__faf!.selected().sort((a, b) => a - b))).toEqual([...handles].sort((a, b) => a - b));
  await stepTicks(page, 1); // Accept actual Watch subscription before testing order results.
}
async function recallCommander(page: Page, commander: number) {
  // Native saved handle group remains unambiguous after builders converge on a site.
  await page.keyboard.press('Digit1');
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([commander]);
  await stepTicks(page, 1);
  await expect.poll(() => page.evaluate(id => window.__faf!.watch().some(w => w.handle === id), commander)).toBe(true);
}
async function rightTarget(page: Page, handle: number, shift = false) {
  const pos = await page.evaluate(id => window.__faf!.unitScreenPos(id), handle); expect(pos).not.toBeNull();
  expect(await page.evaluate(p => document.elementFromPoint(p.x, p.y)?.id, pos!)).toBe('game-canvas');
  if (shift) await page.keyboard.down('Shift');
  try { await page.mouse.click(pos!.x, pos!.y, { button: 'right' }); } finally { if (shift) await page.keyboard.up('Shift'); }
}
async function receipt(page: Page, actors: number[], target?: number) {
  return page.evaluate(({ actors, target }) => {
    const h = window.__faf!;
    return { tick: h.tick, paused: h.paused, inspection: h.inspection(), actors: actors.map(handle => ({ handle, unit: h.unitInfo(handle), watch: h.watch().find(w => w.handle === handle) })),
      target: target === undefined ? null : { handle: target, unit: h.unitInfo(target) }, lastMove: h.lastMoveTarget(), hp: document.querySelector('[data-testid="unit-detail"] .live-hp')?.textContent };
  }, { actors, target });
}
async function hp(page: Page, handle: number) {
  await clickUnit(page, handle); await rendered(page);
  const text = await page.getByTestId('unit-detail').locator('.live-hp').textContent();
  const values = text!.split('/').map(s => Number(s.replace(/[^0-9]/g, '')));
  expect(values).toHaveLength(2); expect(values[1]).toBeGreaterThan(0);
  return { current: values[0]!, max: values[1]!, text };
}


/** Native fire mode, verified from the HUD cycle derived from this handle's accepted Watch. */
async function nativeFireMode(page: Page, handle: number, mode: 'hold' | 'free', rows: unknown[]) {
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([handle]);
  await expect.poll(() => page.evaluate(id => window.__faf!.watch().some(w => w.handle === id), handle)).toBe(true);
  const details = page.getByTestId('selection-details-toggle');
  await expect(details).toBeVisible();
  if (await details.getAttribute('aria-expanded') === 'false') await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  const button = page.getByTestId('order-fireState');
  await expect(button).toBeVisible(); await expect(button).toHaveAttribute('aria-disabled', 'false');
  const observed = button.locator('.ff-order__state');
  const transitions = mode === 'hold' ? [['●', '●●'], ['●●', '●●●']] : [['●●●', '●']];
  for (const [from, to] of transitions) {
    await expect(observed).toHaveText(from!);
    const before = await receipt(page, [handle]);
    await button.click(); await stepTicks(page, 1); await rendered(page);
    // live.updateOrders reads FrameReader.watchFireState; the cycle is not optimistically updated.
    await expect(observed).toHaveText(to!);
    const after = await receipt(page, [handle]);
    expect(after.inspection!.sentCommands - before.inspection!.sentCommands).toBe(1);
    rows.push({ id: 'native-fire-state-accepted-watch-cycle', handle, requested: mode,
      before, after, observedDots: await observed.textContent(),
      observationBoundary: 'Native HUD dots from live.updateOrders accepted FrameReader.watchFireState for the sole selected handle.' });
  }
}

for (const server of SERVERS) test(`native context matrix ${server.name}: supported orders and command precedence`, async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = captureErrors(page), rows: unknown[] = [];
  await installSilentOutput(page); await page.setViewportSize({ width: 1440, height: 900 });
  try {
    const commander = await start(page, server.url);
    expect(await page.evaluate(() => window.__faf!.transport)).toBe(server.transport);
    const origin = await page.evaluate(id => window.__faf!.unitPos(id)!, commander);
    await page.evaluate(p => window.__faf!.setCamera(p.x + 8, p.z + 5, 62), origin); await rendered(page);
    // Save through native input while the original commander is still spatially isolated.
    await select(page, [commander]); await page.keyboard.press('Control+Digit1');
    await expect.poll(() => page.evaluate(() => window.__faf!.controlGroups()[1])).toEqual([commander]);
    rows.push({ id: 'native-commander-group-before-convergence', after: await receipt(page, [commander]) });
    // Explicitly tainted diagnostic fixture: complete units use real Spawn commands.
    // Incomplete sites, repair damage, all subsequent orders and playback use real game operations.
    const engineer = await spawn(page, 'core:eng_t1', origin.x + 4, origin.z + 4);
    const tank = await spawn(page, 'core:lnd_t1_tank', origin.x + 8, origin.z + 8);
    const factory = await spawn(page, 'core:fac_land_t1', origin.x + 14, origin.z - 8);
    const enemy = await spawn(page, 'core:str_t1_mex', origin.x + 24, origin.z + 8, 1);
    expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);

    await select(page, [engineer, tank]);
    const beforeAttack = await receipt(page, [engineer, tank], enemy);
    await rightTarget(page, enemy); await stepTicks(page, 2);
    const attack = await receipt(page, [engineer, tank], enemy); rows.push({ id: 'visible-enemy-armed-subset', before: beforeAttack, after: attack });
    expect(attack.actors.find(a => a.handle === tank)?.watch?.targets[0]?.type).toBe(WatchOrderType.Attack);
    expect(attack.actors.find(a => a.handle === engineer)?.watch?.orders).toBe(beforeAttack.actors.find(a => a.handle === engineer)?.watch?.orders);
    expect(attack.inspection!.sentCommands - beforeAttack.inspection!.sentCommands).toBe(1);
    await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);

    await select(page, [engineer]);
    await rightTarget(page, enemy); await stepTicks(page, 2);
    const unarmed = await receipt(page, [engineer], enemy); rows.push({ id: 'unarmed-enemy-ground-move', after: unarmed });
    expect(unarmed.actors[0]!.watch?.targets[0]?.type).toBe(WatchOrderType.Move);
    await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);

    await select(page, [engineer, tank]);
    await rightTarget(page, factory); await stepTicks(page, 2);
    const guard = await receipt(page, [engineer, tank], factory); rows.push({ id: 'healthy-friendly-guard', after: guard });
    expect(guard.actors.map(a => a.watch?.targets[0]?.type)).toEqual([WatchOrderType.Guard, WatchOrderType.Guard]);
    await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);

    await select(page, [factory, tank]);
    const ground = await groundPixel(page, origin.x + 18, origin.z + 18);
    await page.mouse.click(ground.x, ground.y, { button: 'right' }); await stepTicks(page, 2);
    const rally = await receipt(page, [factory, tank]); rows.push({ id: 'mixed-factory-rally-mobile-move', after: rally });
    expect(rally.actors.find(a => a.handle === tank)?.watch?.targets[0]?.type).toBe(WatchOrderType.Move);
    const factoryWatch = rally.actors.find(a => a.handle === factory)?.watch;
    expect(factoryWatch?.orders).toBe(0);
    const acceptedRally = rally.inspection!.watches.find(w => w.handle === factory)!.rally;
    expect(Math.hypot(acceptedRally.x - origin.x - 18, acceptedRally.z - origin.z - 18)).toBeLessThan(.1);
    await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);

    // Genuine unfinished factory: native Build creates the site with accepted payment.
    await recallCommander(page, commander); await page.keyboard.press('KeyA');
    const ghost = page.getByTestId('build-ghost'); let site: { x: number; z: number } | null = null;
    for (const [dx, dz] of [[4, 0], [0, 4], [-4, 0], [0, -4], [4, 4]]) {
      const p = await groundPixel(page, Math.floor(origin.x + dx!) + .5, Math.floor(origin.z + dz!) + .5);
      await page.mouse.move(p.x, p.y); await expect(ghost).toBeVisible();
      if (await ghost.getAttribute('data-verdict') !== '0') continue;
      site = { x: Number(await ghost.getAttribute('data-x')) / 4096, z: Number(await ghost.getAttribute('data-z')) / 4096 };
      await page.mouse.click(p.x, p.y); break;
    }
    expect(site).not.toBeNull(); await stepTicks(page, 4);
    const siteHandle = await page.evaluate(({ visual, complete }) => window.__faf!.ownHandles().find(id => id !== complete && window.__faf!.unitInfo(id)?.visual === visual) ?? null, { visual: SKIRMISH_BLUEPRINTS.indexOf('core:fac_land_t1'), complete: factory });
    expect(siteHandle, 'actual native Build publishes a live incomplete site').not.toBeNull();
    await select(page, [engineer, tank]);
    // Observe the actual primary builder without adding it to the native Assist actors.
    await page.evaluate(handles => window.__faf!.ctl({ t: 'watch', handles }), [commander, engineer, tank]);
    await stepTicks(page, 1);
    await expect.poll(() => page.evaluate(id => window.__faf!.inspection()!.watches.some(w => w.handle === id), commander)).toBe(true);
    const beforeAssist = await receipt(page, [engineer, tank], siteHandle!);
    const commanderBeforeAssist = beforeAssist.inspection!.watches.find(w => w.handle === commander);
    expect(commanderBeforeAssist, 'accepted primary builder Watch before native Assist').toBeDefined();
    expect(beforeAssist.target!.unit!.build).toBeLessThan(1);
    await rightTarget(page, siteHandle!); await stepTicks(page, 2);
    const assist = await receipt(page, [engineer, tank], siteHandle!); rows.push({ id: 'unfinished-site-assist-builder-subset', site, before: beforeAssist, after: assist });
    expect(assist.actors.find(a => a.handle === engineer)?.watch?.targets[0]?.type).toBe(WatchOrderType.Assist);
    expect(assist.actors.find(a => a.handle === tank)?.watch?.orders).toBe(beforeAssist.actors.find(a => a.handle === tank)?.watch?.orders);
    expect(assist.inspection!.sentCommands - beforeAssist.inspection!.sentCommands).toBe(1);
    await stepTicks(page, 15); const assistedProgress = await receipt(page, [commander, engineer], siteHandle!);
    rows.push({ id: 'actual-assist-paid-progress', after: assistedProgress });
    expect(assistedProgress.target!.unit!.build).toBeGreaterThan(beforeAssist.target!.unit!.build);
    const commanderAfterAssist = assistedProgress.inspection!.watches.find(w => w.handle === commander);
    expect(commanderAfterAssist, 'accepted primary builder Watch after native Assist').toBeDefined();
    expect(commanderAfterAssist!.progress).toBeGreaterThan(commanderBeforeAssist!.progress);
    await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);
    await recallCommander(page, commander); await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);

    // Real combat damages a complete own tank. The weaker hostile scout dies to real return fire.
    // This uses a realistically repairable T1 blueprint, not the commander's six-million-work rebuild cost.
    await page.evaluate(p => window.__faf!.setCamera(p.x + 8, p.z + 8, 62), origin); await rendered(page);
    // Preserve the same combatants/coordinates while giving the scout a real opportunity to fire.
    // The prior tank's auto-fire can otherwise kill the scout before it damages this tank.
    await recallCommander(page, commander); await nativeFireMode(page, commander, 'hold', rows);
    await select(page, [tank]); await nativeFireMode(page, tank, 'hold', rows);
    const repairTarget = await spawn(page, 'core:lnd_t1_tank', origin.x + 12, origin.z + 20);
    await select(page, [repairTarget]); await nativeFireMode(page, repairTarget, 'hold', rows);
    const hostileTank = await spawn(page, 'core:lnd_t1_scout', origin.x + 14, origin.z + 20, 1);
    let damaged = await hp(page, repairTarget);
    for (let batch = 0; damaged.current === damaged.max && batch < 20; batch++) { await stepTicks(page, 5); damaged = await hp(page, repairTarget); }
    rows.push({ id: 'combat-created-repair-fixture', hostileTank, repairTarget, damaged });
    expect(damaged.current).toBeLessThan(damaged.max); expect(damaged.current).toBeGreaterThan(0);
    // Restore real return fire only after genuine damage, for the original combat wreck/reclaim rows.
    await recallCommander(page, commander); await nativeFireMode(page, commander, 'free', rows);
    await select(page, [tank]); await nativeFireMode(page, tank, 'free', rows);
    await select(page, [repairTarget]); await nativeFireMode(page, repairTarget, 'free', rows);
    await select(page, [engineer]); const beforeRepair = await receipt(page, [engineer], repairTarget);
    await rightTarget(page, repairTarget); await stepTicks(page, 2);
    const repair = await receipt(page, [engineer], repairTarget); rows.push({ id: 'damaged-friendly-repair', before: beforeRepair, after: repair });
    expect(repair.actors[0]!.watch?.targets[0]?.type).toBe(WatchOrderType.Repair);
    for (let batch = 0; batch < 25 && await page.evaluate(id => window.__faf!.unitInfo(id) !== null, hostileTank); batch++) await stepTicks(page, 5);
    expect(await page.evaluate(id => window.__faf!.unitInfo(id), hostileTank)).toBeNull();
    const safeBeforeRepair = await hp(page, repairTarget);
    if (safeBeforeRepair.current < safeBeforeRepair.max) {
      await select(page, [engineer]); await rightTarget(page, repairTarget); await stepTicks(page, 200);
      const safeAfterRepair = await hp(page, repairTarget); rows.push({ id: 'actual-repair-without-incoming-fire', before: safeBeforeRepair, after: safeAfterRepair });
      expect(safeAfterRepair.current).toBeGreaterThan(safeBeforeRepair.current);
    } else {
      rows.push({ id: 'actual-repair-completed-during-combat', before: damaged, after: safeBeforeRepair });
      expect(safeBeforeRepair.current).toBeGreaterThan(damaged.current);
    }

    const wreck = await page.evaluate(({ visual, flag }) => window.__faf!.projectedUnits().find(u => u.visual === visual &&
      (window.__faf!.unitInfo(u.handle)!.flags & flag) !== 0)?.handle ?? null, { visual: SKIRMISH_BLUEPRINTS.indexOf('core:lnd_t1_scout'), flag: UnitFlags.Wreck });
    expect(wreck, 'actual combat death publishes the scout wreck').not.toBeNull();
    expect(await page.evaluate(id => window.__faf!.unitInfo(id)!.flags, wreck!)).toBe(UnitFlags.Wreck);
    await select(page, [engineer]);
    const beforeReclaim = await receipt(page, [engineer], wreck!);
    await rightTarget(page, wreck!); await stepTicks(page, 1);
    const reclaim = await receipt(page, [engineer], wreck!); rows.push({ id: 'actual-visible-wreck-reclaim', before: beforeReclaim, after: reclaim });
    expect(reclaim.actors[0]!.watch?.targets[0]?.type).toBe(WatchOrderType.Reclaim);
    const reclaimSamples = [{ tick: reclaim.tick, bank: reclaim.inspection!.eco.find(e => e.army === 0)! }];
    for (let batch = 0; batch < 150 && await page.evaluate(id => window.__faf!.unitInfo(id) !== null, wreck!); batch++) {
      await stepTicks(page, 1);
      const sample = await receipt(page, [engineer], wreck!);
      reclaimSamples.push({ tick: sample.tick, bank: sample.inspection!.eco.find(e => e.army === 0)! });
    }
    const reclaimed = await receipt(page, [engineer], wreck!); rows.push({ id: 'actual-wreck-exhausted', after: reclaimed });
    expect(reclaimed.target!.unit).toBeNull();
    const beforeMass = beforeReclaim.inspection!.eco.find(e => e.army === 0)!, afterMass = reclaimed.inspection!.eco.find(e => e.army === 0)!;
    // Only the original commander supplies normal mass income (100 milli/tick).
    // Overflow is per-tick, not cumulative. Save and sum every actual accepted tick.
    rows.push({ id: 'actual-reclaim-accounting-every-tick', reclaimSamples });
    expect(afterMass.massStored - beforeMass.massStored + reclaimSamples.reduce((sum, sample) => sum + sample.bank.massOverflow, 0))
      .toBeGreaterThan((reclaimed.tick - beforeReclaim.tick) * 100);

    await select(page, [tank]); await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);
    const firstGround = await groundPixel(page, origin.x + 18, origin.z + 18), secondGround = await groundPixel(page, origin.x + 20, origin.z + 20);
    await page.mouse.click(firstGround.x, firstGround.y, { button: 'right' }); await stepTicks(page, 1);
    await page.keyboard.down('Shift'); await page.mouse.click(secondGround.x, secondGround.y, { button: 'right' }); await page.keyboard.up('Shift'); await stepTicks(page, 1);
    const queued = await receipt(page, [tank]); rows.push({ id: 'shift-appends-ground-order', after: queued }); expect(queued.actors[0]!.watch?.orders).toBe(2);
    await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);

    await page.keyboard.press('Alt+KeyA');
    const beforeArmed = await receipt(page, [tank]); await page.mouse.click(firstGround.x, firstGround.y, { button: 'right' }); await stepTicks(page, 1);
    const canceled = await receipt(page, [tank]); rows.push({ id: 'armed-first-right-cancels-only', before: beforeArmed, after: canceled });
    expect(canceled.inspection!.sentCommands).toBe(beforeArmed.inspection!.sentCommands); expect(canceled.actors[0]!.watch?.orders).toBe(0);
    await page.keyboard.press('Escape'); await expect(page.getByTestId('game-menu')).toBeVisible();
    const beforeMenu = await receipt(page, [tank]); await page.mouse.click(firstGround.x, firstGround.y, { button: 'right' }); await stepTicks(page, 1);
    const menu = await receipt(page, [tank]); rows.push({ id: 'menu-blocks-context', before: beforeMenu, after: menu }); expect(menu.inspection!.sentCommands).toBe(beforeMenu.inspection!.sentCommands);
    await page.keyboard.press('Escape'); await expect(page.getByTestId('game-menu')).toBeHidden();

    await recallCommander(page, commander); await page.keyboard.press('KeyA');
    await expect(page.getByTestId('build-ghost')).toBeVisible();
    const gestureBefore = await receipt(page, [commander]);
    await page.mouse.move(firstGround.x, firstGround.y); await page.keyboard.down('Shift');
    await page.mouse.down({ button: 'left' }); await page.mouse.move(secondGround.x, secondGround.y);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' }); await page.mouse.up({ button: 'left' }); await page.keyboard.up('Shift');
    await stepTicks(page, 1); const gestureAfter = await receipt(page, [commander]);
    rows.push({ id: 'build-drag-right-cancel-no-commit', before: gestureBefore, after: gestureAfter });
    expect(gestureAfter.inspection!.sentCommands).toBe(gestureBefore.inspection!.sentCommands); await expect(page.getByTestId('build-ghost')).toHaveCount(0);

    await select(page, [tank]); await page.keyboard.press('Alt+KeyS'); await stepTicks(page, 2);
    const runningBefore = await receipt(page, [tank]);
    await page.mouse.click(firstGround.x, firstGround.y, { button: 'right' }); await page.keyboard.press('KeyP');
    await page.waitForFunction(tick => window.__faf!.tick >= tick + 15, runningBefore.tick);
    await page.keyboard.press('KeyP'); await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
    const runningAfter = await receipt(page, [tank]); rows.push({ id: 'running-native-move-changes-real-position', before: runningBefore, after: runningAfter });
    expect(Math.hypot(runningAfter.actors[0]!.unit!.x - runningBefore.actors[0]!.unit!.x, runningAfter.actors[0]!.unit!.z - runningBefore.actors[0]!.unit!.z)).toBeGreaterThan(.01);

    // Foreign native left selection remains uncommandable, even while its full target record is visible.
    const foreignPixel = await page.evaluate(id => window.__faf!.unitScreenPos(id), hostileTank);
    if (foreignPixel) {
      await page.mouse.click(foreignPixel.x, foreignPixel.y); await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
      const before = await receipt(page, []); await page.mouse.click(firstGround.x, firstGround.y, { button: 'right' }); await stepTicks(page, 1);
      const after = await receipt(page, []); rows.push({ id: 'foreign-selection-no-command', before, after }); expect(after.inspection!.sentCommands).toBe(before.inspection!.sentCommands);
    } else {
      // The initial enemy mex can also die in genuine combat. A fresh unarmed hostile ensures this negative row always executes.
      const foreign = await spawn(page, 'core:str_t1_mex', origin.x + 24, origin.z - 18, 1);
      const pixel = await page.evaluate(id => window.__faf!.unitScreenPos(id)!, foreign);
      await page.mouse.click(pixel.x, pixel.y); await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
      const before = await receipt(page, []); await page.mouse.click(firstGround.x, firstGround.y, { button: 'right' }); await stepTicks(page, 1);
      const after = await receipt(page, []); rows.push({ id: 'foreign-selection-no-command', before, after }); expect(after.inspection!.sentCommands).toBe(before.inspection!.sentCommands);
    }

    await select(page, [tank]);
    const hidden = { x: origin.x + 170, z: origin.z + 170 };
    const visibleEnemies = await page.evaluate(() => window.__faf!.armyUnitCount(1));
    await page.evaluate(p => window.__faf!.spawnAt('core:str_t1_mex', p.x, p.z, 1), hidden); await stepTicks(page, 2);
    expect(await page.evaluate(() => window.__faf!.armyUnitCount(1))).toBe(visibleEnemies);
    await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), hidden); await rendered(page);
    const hiddenPixel = await groundPixel(page, hidden.x, hidden.z);
    const beforeHidden = await receipt(page, [tank]); await page.mouse.click(hiddenPixel.x, hiddenPixel.y, { button: 'right' }); await stepTicks(page, 1);
    const hiddenAfter = await receipt(page, [tank]); rows.push({ id: 'unseen-enemy-ground-only', hidden, before: beforeHidden, after: hiddenAfter });
    expect(hiddenAfter.actors[0]!.watch?.targets[0]?.type).toBe(WatchOrderType.Move);

    // Exported command stream supplies actual payload/actor receipts, not invented sample arrays.
    await page.getByRole('button', { name: 'Replays', exact: true }).click();
    const download = page.waitForEvent('download'); await page.getByTestId('replay-export-current').click();
    const file = info.outputPath(`context-${server.name}.rtsreplay`); await (await download).saveAs(file);
    const replay = readRtsReplay(new Uint8Array(await readFile(file))), batch = new CommandBatchView();
    const commands: { tick: number; army: number; op: number; flags: number; units: number[]; payload: number[] }[] = [];
    expect(replay.head.flags & ReplayFlags.Tainted).not.toBe(0);
    for (const entry of readAllCommands(replay)) {
      batch.reset(entry.batch);
      while (batch.next()) commands.push({ tick: entry.tick, army: batch.army, op: batch.op, flags: batch.flags,
        units: Array.from({ length: batch.unitCount }, (_, i) => batch.unitAt(i)),
        payload: Array.from({ length: batch.payloadLength }, (_, i) => batch.dataView.getUint8(batch.payloadOffset + i)) });
    }
    const human = commands.filter(c => c.army === 0);
    for (const handle of [commander, tank, repairTarget]) for (const state of [0, 2]) {
      expect(human.some(command => command.op === Op.FireState && command.units.length === 1 && command.units[0] === handle
        && command.payload.length === 1 && command.payload[0] === state), `recorded native FireState ${state} for actor ${handle}`).toBe(true);
    }
    for (const op of [Op.Attack, Op.Move, Op.Guard, Op.Assist, Op.Repair, Op.Reclaim, Op.SetRally, Op.Build]) expect(human.map(c => c.op)).toContain(op);
    const recordedTarget = (op: number, actor: number, target: number) => human.some(command => command.op === op && command.units.includes(actor) && command.payload.length === 4 &&
      new DataView(Uint8Array.from(command.payload).buffer).getUint32(0, true) === target);
    expect(recordedTarget(Op.Attack, tank, enemy)).toBe(true);
    expect(recordedTarget(Op.Assist, engineer, siteHandle!)).toBe(true);
    expect(recordedTarget(Op.Repair, engineer, repairTarget)).toBe(true);
    expect(recordedTarget(Op.Reclaim, engineer, wreck!)).toBe(true);
    expect(recordedTarget(Op.Guard, tank, factory)).toBe(true);
    expect(human.some(c => c.op === Op.SetRally && c.units.includes(factory) && c.payload.length === 12)).toBe(true);
    rows.push({ id: 'actual-recorded-native-command-stream', file, commands });

    // Same-build native replay import, then a context click must remain read-only.
    await page.getByTestId('replay-import').setInputFiles(file); await expect(page.getByTestId('replay-controls')).toBeVisible({ timeout: 60_000 });
    await page.waitForFunction(() => window.__faf?.ready && window.__faf.inspection()?.readOnlyCommands, null, { timeout: 60_000 });
    // Replay hooks become ready before the session's audio/first-frame loading overlay retires.
    await page.waitForFunction(() => document.documentElement.dataset['loadingProgress'] === '100', null, { timeout: 60_000 });
    await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 });
    await page.getByTestId('replay-seek').focus(); await page.getByTestId('replay-seek').press('End');
    await expect.poll(() => page.evaluate(() => window.__faf!.tick), { timeout: 30_000 }).toBe(replay.meta!.endTick);
    // Native replay perspective and HUD selection avoid a coordinate pick through converged builders.
    await page.getByTestId('replay-viewer').selectOption('0');
    await expect.poll(() => page.evaluate(() => ({ viewer: window.__faf!.inspection()!.viewer, viewArmy: window.__faf!.inspection()!.viewArmy })))
      .toEqual({ viewer: 0, viewArmy: 0 });
    await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 62), origin); await rendered(page);
    const replayGround = await groundPixel(page, origin.x + 18, origin.z + 18);
    await page.mouse.click(replayGround.x, replayGround.y); // Native canvas focus after the replay range/select controls.
    await page.keyboard.press('Control+KeyA');
    const replayCommanderGroup = page.getByTestId('selection-groups').locator('[data-type="core:cmd_commander"]');
    await expect(replayCommanderGroup).toHaveAttribute('data-count', '1');
    await replayCommanderGroup.click();
    await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([commander]);
    // Paused replay Watch publishes an accepted frame without advancing the recorded clock.
    await expect.poll(() => page.evaluate(id => ({
      watched: window.__faf!.watch().some(w => w.handle === id),
      workWatched: window.__faf!.inspection()!.watches.some(w => w.handle === id),
      ordersKnown: window.__faf!.unitInfo(id)?.orders !== null && window.__faf!.unitInfo(id)?.orders !== undefined,
    }), commander)).toEqual({ watched: true, workWatched: true, ordersKnown: true });
    const replayBefore = await receipt(page, [commander]);
    expect(replayBefore.tick).toBe(replay.meta!.endTick);
    expect(replayBefore.inspection!.readOnlyCommands).toBe(true);
    expect(replayBefore.actors[0]!.watch).toBeDefined();
    rows.push({ id: 'native-replay-commander-selection-and-watch-settled', after: replayBefore });
    await page.mouse.click(replayGround.x, replayGround.y, { button: 'right' }); await rendered(page);
    const replayAfter = await receipt(page, [commander]); rows.push({ id: 'replay-native-context-read-only', before: replayBefore, after: replayAfter });
    expect(replayAfter.inspection!.sentCommands).toBe(replayBefore.inspection!.sentCommands); expect(replayAfter.actors).toEqual(replayBefore.actors);
    expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]); await assertSilentOutput(page); expectNoErrors(errors);
    await page.screenshot({ path: info.outputPath(`context-${server.name}.png`) });
  } finally {
    const silent = await page.evaluate(() => (window as unknown as { __fafSilentAudio?: unknown }).__fafSilentAudio).catch(() => null);
    await attachJson(info, `context-matrix-${server.name}`, { server, rows, errors, silent,
      boundary: 'Explicitly tainted real diagnostic Spawn; genuine native Build/combat/commands and accepted Frame/UI results. No fabricated HP/build records or authoritative World reads.',
      unsupported: ['live-unit/prop reclaim', 'target/chained rally', 'automatic empty-ground Build'] });
  }
});
