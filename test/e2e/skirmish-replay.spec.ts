import { readFile } from 'node:fs/promises';
import { readAllCommands, readRtsReplay, ReplayFlags } from '../../packages/formats/src/index.ts';
import { CommandBatchView, Op } from '../../packages/protocol/src/index.ts';
import { unitText } from '../../packages/hud/src/data/roster.ts';
import { fmtInt } from '../../packages/hud/src/format/index.ts';
import { hudTypeId } from '../../apps/game/src/hud/type-ids.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, waitTick } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

test('real skirmish recording: export, import, recorded AI and deterministic backward seek', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startHumanAiSkirmish(page);
  // Real worker decisions and normal economy advance at the configured 3x UI speed.
  await waitTick(page, 900, 60_000);
  await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const recordedTick = await page.evaluate(() => window.__faf!.tick);
  await page.getByRole('button', { name: 'Replays', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('replay-export-current').click();
  const file = testInfo.outputPath('actual-skirmish.rtsreplay');
  await (await downloaded).saveAs(file);
  const bytes = new Uint8Array(await readFile(file));
  const replay = readRtsReplay(bytes);
  expect(replay.head.flags & ReplayFlags.Tainted).toBe(0);
  expect(replay.game.initialization?.kind).toBe('skirmish');
  expect(replay.game.initialization?.slots?.map(slot => slot.controller)).toEqual(['human', 'ai']);
  expect(replay.game.initialization?.slots?.[1]?.difficulty).toBe('normal');
  expect(replay.game.seed).toBe(177);
  expect(replay.meta?.endTick).toBe(recordedTick);
  const aiOps: number[] = [];
  let firstProduction: { tick: number; handle: number; bp: number; count: number } | null = null;
  const view = new CommandBatchView();
  for (const command of readAllCommands(replay)) {
    view.reset(command.batch);
    while (view.next()) {
      expect(view.op).not.toBe(Op.Cheat);
      if (view.army === 1) {
        aiOps.push(view.op);
        if (firstProduction === null && view.op === Op.FactoryQueue && view.unitCount > 0) {
          firstProduction = { tick: command.tick, handle: view.unitAt(0),
            bp: view.dataView.getUint16(view.payloadOffset, true), count: view.dataView.getUint16(view.payloadOffset + 2, true) };
        }
      }
    }
  }
  expect(aiOps).toContain(Op.Build);
  expect(aiOps).toContain(Op.FactoryQueue);
  expect(firstProduction).not.toBeNull();

  await page.getByTestId('replay-import').setInputFiles(file);
  await expect(page.getByTestId('replay-controls')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => document.documentElement.dataset['ready'] === '1' && window.__faf?.ready && window.__faf.tick === 0, null, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.__faf!.tick)).toBe(0);
  const hashAt = (tick: number): number => {
    const index = (tick - replay.hashes.firstTick) / replay.hashes.interval;
    expect(Number.isInteger(index), `Tick ${tick} has a recorded HASH entry`).toBe(true);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(replay.hashes.hashes.length);
    return replay.hashes.hashes[index]!;
  };
  const expectRecordedHash = async (target: number): Promise<void> => {
    await expect.poll(() => page.evaluate(() => window.__faf!.tick), { timeout: 30_000 }).toBe(target);
    const actual = await page.evaluate(() => window.__faf!.ruleHash());
    expect(actual?.hashTick).toBe(target);
    expect(actual?.hash).toBe(hashAt(target));
  };
  for (const target of [600, 100, 800, 200]) {
    await page.getByTestId('replay-seek').evaluate((input, tick) => {
      (input as HTMLInputElement).value = String(tick);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, target);
    await expectRecordedHash(target);
  }

  // Inspect a production point derived from the actual recorded AI command, not a synthetic fixture.
  const production = firstProduction!;
  const inspectionTick = Math.ceil((production.tick + 1) / replay.hashes.interval) * replay.hashes.interval;
  expect(inspectionTick + replay.hashes.interval).toBeLessThan(recordedTick);
  const seek = async (target: number): Promise<void> => {
    await page.getByTestId('replay-seek').evaluate((input, tick) => {
      (input as HTMLInputElement).value = String(tick);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, target);
    await expectRecordedHash(target);
    expect(await page.evaluate(() => window.__faf!.paused)).toBe(true);
  };
  const expectResourcePerspective = async (viewer: number): Promise<void> => {
    await expect.poll(() => page.evaluate(() => window.__faf!.inspection()?.viewer)).toBe(viewer);
    const snapshot = await page.evaluate(() => window.__faf!.inspection()!);
    expect(snapshot.viewArmy).toBe(viewer);
    expect(snapshot.readOnlyCommands).toBe(true);
    const army = snapshot.eco.find(row => row.army === viewer);
    if (viewer >= 0) expect(army).toBeDefined();
    for (const resource of ['mass', 'energy'] as const) {
      const stored = army?.[resource === 'mass' ? 'massStored' : 'energyStored'] ?? 0;
      const capacity = army?.[resource === 'mass' ? 'massCapacity' : 'energyCapacity'] ?? 0;
      await expect(page.getByTestId(`resource-${resource}`).locator('.res__store [data-component="Num"]'))
        .toHaveText([fmtInt(stored / 1000, 'de'), fmtInt(capacity / 1000, 'de')]);
    }
  };
  await seek(inspectionTick + replay.hashes.interval);
  await page.getByTestId('replay-viewer').selectOption('0');
  await expectResourcePerspective(0);
  const humanResources = await page.getByTestId('resource-bar').innerText();
  await page.getByTestId('replay-viewer').selectOption('1');
  await expectResourcePerspective(1);
  await expect.poll(() => page.getByTestId('resource-bar').innerText()).not.toBe(humanResources);
  const aiResources = await page.getByTestId('resource-bar').innerText();
  const commandState = await page.evaluate(() => {
    const h = window.__faf!, snapshot = h.inspection()!, frame = h.metrics.snapshot().frame;
    return { lastSeq: frame['lastSeq'], pending: frame['pendingCommands'], sent: snapshot.sentCommands, readOnly: snapshot.readOnlyCommands };
  });
  expect(commandState).toEqual({ lastSeq: 0, pending: 0, sent: 0, readOnly: true });
  const selectFactory = async (): Promise<void> => {
    const position = await page.evaluate(handle => window.__faf!.unitPos(handle), production.handle);
    expect(position, 'the recorded AI production handle is in the accepted perspective frame').not.toBeNull();
    await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 45), position!);
    await clickUnit(page, production.handle);
    await expect(page.getByTestId('factory-detail')).toBeVisible();
    await expect.poll(() => page.evaluate(handle => window.__faf!.watch().some(record => record.handle === handle), production.handle)).toBe(true);
    await expect.poll(() => page.evaluate(handle => window.__faf!.inspection()?.watches.find(record => record.handle === handle)?.product, production.handle))
      .toBe(SKIRMISH_BLUEPRINTS.ids[production.bp]!);
    const watch = (await page.evaluate(handle => window.__faf!.inspection()!.watches.find(record => record.handle === handle), production.handle))!;
    const queue = page.getByTestId('factory-queue');
    await expect(queue.locator('.fq__now')).toContainText(unitText(hudTypeId(watch.product!), 'name', 'de'));
    const progress = page.getByTestId('factory-queue').locator('.fq__now [data-testid="bar-build"] i');
    await expect(progress).toBeVisible();
    await expect.poll(() => progress.evaluate(el => Number(el.style.getPropertyValue('--v')))).toBeCloseTo(watch.progress / 65536, 5);
    expect(watch.progress).toBeGreaterThan(0);
    expect(watch.queue[0], 'accepted queue head is the separately displayed active product').toBe(watch.product);
    const blocks: { typeId: string; count: number }[] = [];
    for (const typeId of watch.queue.slice(1)) {
      const previous = blocks.at(-1);
      if (previous?.typeId === typeId) previous.count++;
      else blocks.push({ typeId, count: 1 });
    }
    await expect(queue.locator('.fqi')).toHaveCount(Math.min(10, blocks.length));
    for (const [index, block] of blocks.slice(0, 10).entries()) {
      await expect(queue.locator('.fqi').nth(index)).toHaveAttribute('aria-label',
        `${unitText(hudTypeId(block.typeId), 'name', 'de')} ×${block.count} · Klick +1 · Umschalt+Klick +5 · Rechtsklick −1 · Strg+Klick an den Anfang`);
    }
    await expect(page.getByTestId('factory-remaining')).toBeVisible();
  };
  await selectFactory();
  const inspectedQueue = await page.getByTestId('factory-queue').innerText();
  const inspectedWatch = await page.evaluate(handle => window.__faf!.inspection()!.watches.find(record => record.handle === handle), production.handle);
  // Native command attempts leave both the paused simulation and the command sequence untouched.
  await expect(page.locator('.live-command-context')).toHaveCount(0);
  for (const testId of ['order-stop', 'card-KeyA']) {
    const control = page.getByTestId(testId);
    if (await control.count() === 0) await expect(control).toHaveCount(0);
    else await expect(control).toHaveAttribute('aria-disabled', 'true');
  }
  await page.keyboard.press('Alt+KeyS');
  // Physical pointer attempts exercise the real disabled controls without enabled auto-wait.
  const readonlyQueue = page.getByTestId('factory-queue');
  for (const name of ['Pause', 'Leeren']) {
    const control = readonlyQueue.getByRole('button', { name, exact: true });
    await expect(control).toBeDisabled();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  }
  for (const block of await readonlyQueue.locator('.fqi').all()) {
    await expect(block).toBeDisabled();
    const box = await block.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' });
  }
  await page.keyboard.press('KeyA');
  const factoryPosition = await page.evaluate(handle => window.__faf!.unitPos(handle)!, production.handle);
  const movePixel = await groundPixel(page, factoryPosition.x + 8, factoryPosition.z);
  await page.mouse.click(movePixel.x, movePixel.y, { button: 'right' });
  await expect.poll(() => page.getByTestId('factory-queue').innerText()).toBe(inspectedQueue);
  expect(await page.evaluate(handle => window.__faf!.inspection()!.watches.find(record => record.handle === handle), production.handle)).toEqual(inspectedWatch);
  expect(await page.evaluate(() => window.__faf!.tick)).toBe(inspectionTick + replay.hashes.interval);
  expect(await page.evaluate(() => {
    const h = window.__faf!, snapshot = h.inspection()!, frame = h.metrics.snapshot().frame;
    return { lastSeq: frame['lastSeq'], pending: frame['pendingCommands'], sent: snapshot.sentCommands, readOnly: snapshot.readOnlyCommands };
  })).toEqual(commandState);
  await seek(inspectionTick);
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
  await expect(page.getByTestId('factory-detail')).toHaveCount(0);
  await selectFactory();
  await page.getByTestId('replay-viewer').selectOption('-1');
  await expectResourcePerspective(-1);
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
  await expect(page.getByTestId('factory-detail')).toHaveCount(0);
  await expect.poll(() => page.getByTestId('resource-mass').locator('.res__store').innerText()).toMatch(/^\s*0\s*\/\s*0\s*$/);
  await expect.poll(() => page.getByTestId('resource-energy').locator('.res__store').innerText()).toMatch(/^\s*0\s*\/\s*0\s*$/);
  const observerResources = await page.getByTestId('resource-bar').innerText();
  await selectFactory();
  await page.getByTestId('replay-viewer').selectOption('1');
  await expectResourcePerspective(1);
  await expect.poll(() => page.evaluate(() => window.__faf!.selected())).toEqual([]);
  await expect(page.getByTestId('factory-detail')).toHaveCount(0);
  await expect.poll(() => page.getByTestId('resource-bar').innerText()).not.toBe(observerResources);
  await seek(200);
  await page.getByTestId('replay-speed').selectOption('5');
  await page.getByRole('button', { name: '10 s zurück', exact: true }).click();
  await expectRecordedHash(100);
  await expect(page.getByTestId('replay-viewer')).toHaveValue('1');
  await expect(page.getByTestId('replay-speed')).toHaveValue('5');
  await expect(page.getByTestId('replay-verification')).toContainText('Keine Abweichung.');
  await expect(page.getByTestId('replay-verification')).not.toContainText('Markierte Aufnahme.');
  expect(await page.evaluate(() => ({ sent: window.__faf!.inspection()!.sentCommands, readOnly: window.__faf!.inspection()!.readOnlyCommands })))
    .toEqual({ sent: 0, readOnly: true });
  const copyDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Replay herunterladen', exact: true }).click();
  const copy = testInfo.outputPath('actual-skirmish-copy.rtsreplay');
  await (await copyDownload).saveAs(copy);
  expect(new Uint8Array(await readFile(copy))).toEqual(bytes);
  expect(await page.evaluate(() => window.__faf!.hostErrors)).toEqual([]);
  await page.getByRole('button', { name: 'Zurück zum Hauptmenü', exact: true }).click();
  await expect(page.getByTestId('MainMenu')).toBeVisible();
  await assertSilentOutput(page);
  await attachJson(testInfo, 'actual-skirmish-recording', { recordedTick, bytes: bytes.length, initialization: replay.game.initialization, aiCommands: aiOps.length,
    comparedHashTicks: [600, 100, 800, 200, 100], inspectionHashTicks: [inspectionTick + replay.hashes.interval, inspectionTick, 200],
    production, inspectedWatch, inspectedQueue, humanResources, aiResources, observerResources, commandState });
  expectNoErrors(errors);
});
