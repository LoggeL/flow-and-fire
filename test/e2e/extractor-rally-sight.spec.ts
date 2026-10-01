import { readFile } from 'node:fs/promises';
import type { Handle } from '../../packages/fixed/src/index.ts';
import { readAllCommands, readRtsMap, readRtsReplay, ReplayFlags } from '../../packages/formats/src/index.ts';
import { decodeBatch, Op, WatchOrderType } from '../../packages/protocol/src/index.ts';
import { ReplayPlayer } from '../../packages/sim-host/src/index.ts';
import { PlacementVerdict } from '../../packages/rules/src/index.ts';
import { assertSilentOutput, installSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page, type TestInfo } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, findOwnUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page) {
  const target = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(n => window.__faf!.renderStats().frames >= n, target);
}
async function startPaused(page: Page) {
  await installSilentOutput(page); await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page);
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  await assertSilentOutput(page);
  return commander;
}
/** One original host step request, followed by its accepted final frame, rather than wall-time sleep. */
async function batchTicks(page: Page, count: number) {
  const target = await page.evaluate(n => { const h = window.__faf!; if (!h.paused) throw new Error('Qualification requires paused host'); const target = h.tick + n; h.ctl({ t: 'step', ticks: n }); return target; }, count);
  await page.waitForFunction(t => window.__faf!.tick === t, target, { timeout: 30_000 });
  await rendered(page);
}
async function state(page: Page, handle: number) {
  return page.evaluate(id => { const h = window.__faf!, inspection = h.inspection()!; return {
    tick: h.tick, unit: h.unitInfo(id), position: h.unitPos(id), rig: h.rigPose(id),
    work: inspection.watches.find(w => w.handle === id), watch: h.watch().find(w => w.handle === id),
    bank: inspection.eco.find(e => e.army === 0), tainted: h.tainted, ruleHash: h.ruleHash(), render: h.renderStats(),
  }; }, handle);
}
async function select(page: Page, handle: number) { await clickUnit(page, handle); await stepTicks(page, 1); await rendered(page); }
async function screenshots(page: Page, info: TestInfo, label: string, focus: { x: number; z: number }) {
  const rows = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport); await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 76), focus); await rendered(page);
    const path = info.outputPath(`${label}-${viewport.width}.png`); await page.screenshot({ path }); await info.attach(`${label}-${viewport.width}`, { path, contentType: 'image/png' });
    rows.push(await page.evaluate(v => ({ viewport: v, camera: window.__faf!.cameraState(), projected: window.__faf!.projectedUnits(), render: window.__faf!.renderStats() }), viewport));
  }
  // These screenshots document the real boundary. No subjective roundness/darkness score is invented.
  return rows;
}
async function exportRecording(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: 'Replays', exact: true }).click();
  const pending = page.waitForEvent('download'); await page.getByTestId('replay-export-current').click();
  const path = info.outputPath(`${name}.rtsreplay`); await (await pending).saveAs(path);
  await info.attach(name, { path, contentType: 'application/octet-stream' });
  return readRtsReplay(new Uint8Array(await readFile(path)));
}

// Root config runs each case in Chromium, Firefox and WebKit, once, with no replacement attempt.
test.describe.configure({ retries: 0 });

test('native extractor: genuine mass-spot construction, paid T2/T3, pause/resume/cancel and sight evidence', async ({ page }, info) => {
  test.setTimeout(180_000); const errors = captureErrors(page), rows: unknown[] = [];
  try {
    const commander = await startPaused(page);
    const origin = await page.evaluate(id => window.__faf!.unitPos(id)!, commander);
    await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), origin); await rendered(page); await select(page, commander);
    const acuSight = await screenshots(page, info, 'original-untainted-acu-sight', origin);
    const spot = await page.evaluate(p => window.__faf!.mapInfo()!.spots.filter(s => s.kind === 'mass').sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]!, origin);
    expect(spot).toBeDefined();
    await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), spot); await rendered(page);
    await page.keyboard.press('KeyQ');
    const pixel = await groundPixel(page, spot.x, spot.z); await page.mouse.move(pixel.x, pixel.y);
    await expect(page.getByTestId('build-ghost')).toHaveAttribute('data-type', 'core:str_t1_mex');
    await expect(page.getByTestId('build-ghost')).toHaveAttribute('data-verdict', String(PlacementVerdict.Valid));
    await page.mouse.click(pixel.x, pixel.y);
    let mex: number | null = null;
    for (let n = 0; n < 30; n++) { await batchTicks(page, 100); mex = await findOwnUnit(page, 'core:str_t1_mex'); if (mex !== null && (await state(page, mex)).unit?.build === 1) break; }
    expect(mex, 'real accepted mass-spot build').not.toBeNull(); const built = await state(page, mex!);
    expect(built.unit?.build).toBe(1); expect(built.position!.x).toBe(spot.x); expect(built.position!.z).toBe(spot.z); expect(built.tainted).toBe(false);
    rows.push({ stage: 'original-untainted-native-mass-spot-build', built });
    await select(page, mex!); await expect(page.getByTestId('extractor-upgrade-start')).toBeEnabled();
    await expect(page.getByTestId('extractor-upgrade-start')).toContainText('900 M'); await expect(page.getByTestId('extractor-upgrade-start')).toContainText('5.400 E');
    await page.getByTestId('extractor-upgrade-start').click(); await batchTicks(page, 10); const begun = await state(page, mex!);
    expect(begun.work?.product).toBe('core:str_t2_mex'); expect(begun.work!.progress).toBeGreaterThan(0); expect(begun.unit?.visual).toBe(SKIRMISH_BLUEPRINTS.indexOf('core:str_t1_mex'));
    await page.getByTestId('extractor-upgrade-pause').click(); await batchTicks(page, 2); const paused = await state(page, mex!); await batchTicks(page, 10);
    expect((await state(page, mex!)).work?.progress).toBe(paused.work?.progress); await expect(page.getByTestId('extractor-upgrades')).toContainText('Pausiert');
    await page.getByTestId('extractor-upgrade-pause').click(); await batchTicks(page, 10); expect((await state(page, mex!)).work!.progress).toBeGreaterThan(paused.work!.progress);
    const beforeCancel = await state(page, mex!); await page.getByTestId('extractor-upgrade-cancel').click(); await batchTicks(page, 2); const canceled = await state(page, mex!);
    expect(canceled.unit?.visual).toBe(SKIRMISH_BLUEPRINTS.indexOf('core:str_t1_mex')); expect(canceled.watch?.targets.some(t => t.type === WatchOrderType.Upgrade) ?? false).toBe(false);
    expect(canceled.bank!.massStored).toBeLessThanOrEqual(beforeCancel.bank!.massStored + (canceled.tick - beforeCancel.tick) * 300);
    rows.push({ stage: 'original-untainted-pause-resume-cancel', begun, paused, beforeCancel, canceled });
    // Explicitly tainted supply-only fixture: all actors arrive through actual Spawn commands.
    // It changes neither target work/buildTime nor World/frame/resource values.
    const supplyBefore = await page.evaluate(() => window.__faf!.ownHandles().length);
    // The native build ghost confirms 32 distinct passable 2x2 land footprints before
    // any supply command. Both supplied types use that same layer/size/footprint.
    const supplyCenter = await page.evaluate(id => window.__faf!.unitPos(id)!, commander);
    await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), supplyCenter); await rendered(page);
    await select(page, commander); await page.keyboard.press('KeyW');
    const supplySites: { x: number; z: number }[] = [];
    for (let n = 0; n < 64 && supplySites.length < 32; n++) {
      const proposed = { x: Math.floor(supplyCenter.x) - 12 + n % 8 * 3 + .5, z: Math.floor(supplyCenter.z) - 12 + Math.floor(n / 8) * 3 + .5 };
      const point = await groundPixel(page, proposed.x, proposed.z); await page.mouse.move(point.x, point.y); await rendered(page);
      const ghost = page.getByTestId('build-ghost');
      if (await ghost.getAttribute('data-verdict') === String(PlacementVerdict.Valid)) supplySites.push({ x: Number(await ghost.getAttribute('data-x')) / 4096, z: Number(await ghost.getAttribute('data-z')) / 4096 });
    }
    expect(supplySites).toHaveLength(32); expect(new Set(supplySites.map(p => `${p.x},${p.z}`)).size).toBe(32);
    await page.keyboard.press('Escape');
    await page.evaluate(sites => { for (let n = 0; n < sites.length; n++) window.__faf!.spawnAt(n < 16 ? 'core:str_t1_pgen' : 'core:str_t1_mex', sites[n]!.x, sites[n]!.z); }, supplySites);
    await batchTicks(page, 2);
    expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
    expect(await page.evaluate(() => window.__faf!.ownHandles().length)).toBe(supplyBefore + 32);
    rows.push({ stage: 'tainted-real-Spawn-supply-only', supplySites, state: await state(page, mex!) });
    await page.evaluate(p => window.__faf!.setCamera(p.x, p.z, 52), built.position!); await rendered(page); await select(page, mex!);
    for (const tier of [2, 3]) {
      await expect(page.getByTestId('extractor-upgrade-start')).toBeEnabled(); await page.getByTestId('extractor-upgrade-start').click(); await batchTicks(page, 10);
      const started = await state(page, mex!); expect(started.work?.product).toBe(`core:str_t${tier}_mex`); expect(started.work!.progress).toBeGreaterThan(0);
      for (let n = 0; n < 30 && (await state(page, mex!)).unit?.visual !== SKIRMISH_BLUEPRINTS.indexOf(`core:str_t${tier}_mex`); n++) await batchTicks(page, 100);
      await batchTicks(page, 1); const completed = await state(page, mex!);
      expect(completed.unit?.visual).toBe(SKIRMISH_BLUEPRINTS.indexOf(`core:str_t${tier}_mex`)); expect(completed.position).toEqual(built.position); expect(completed.unit?.hpMax).toBe(tier === 2 ? 2100 : 7000);
      // Normal AI can deal damage during these original paid-work ticks. The
      // accepted frame floors HP to 8 bits, then unitInfo rounds its reconstruction.
      // Exact no-combat damage preservation is covered by extractor-upgrade.test.ts.
      const hpQuantizationBound = Math.ceil(started.unit!.hpMax / 255 + completed.unit!.hpMax / 255 + 1);
      rows.push({ stage: `paid-completed-T${tier}-same-handle`, started, completed, hpQuantizationBound });
      expect(completed.unit!.hp).toBeGreaterThan(0); expect(completed.unit!.hp).toBeLessThanOrEqual(completed.unit!.hpMax);
      expect(completed.unit!.hp).toBeLessThanOrEqual(started.unit!.hp + completed.unit!.hpMax - started.unit!.hpMax + hpQuantizationBound);
      expect(completed.rig).not.toBeNull();
    }
    await expect(page.getByTestId('extractor-upgrades')).toContainText('Voll ausgebaut'); await expect(page.getByTestId('extractor-upgrade-start')).toHaveCount(0);
    const final = await state(page, mex!); const mexSight = await screenshots(page, info, 'paid-T3-extractor-sight', built.position!);
    expect(final.render.visibilityFog).toMatchObject({ enabled: true, active: true, unknown: 0 });
    // This skirmish pre-reveals terrain: dark cells are explored, rather than unknown.
    expect(final.render.visibilityFog.explored).toBeGreaterThan(0); expect(final.render.visibilityFog.visible).toBeGreaterThan(0);
    const replay = await exportRecording(page, info, 'extractor-native-paid'); expect(replay.head.flags & ReplayFlags.Tainted).not.toBe(0);
    const mexHandle = mex! as Handle; // Accepted numeric hook handle enters the branded protocol boundary.
    const commandRows = readAllCommands(replay);
    const recorded = commandRows.flatMap(e => decodeBatch(e.batch));
    expect(recorded.filter(c => c.army === 0 && c.op === Op.Upgrade && c.units.includes(mexHandle))).toHaveLength(3);
    const byTick = new Map(commandRows.map(e => [e.tick, decodeBatch(e.batch)]));
    const map = readRtsMap(new Uint8Array(await readFile(new URL('../../content/maps/hollow-ridge.rtsmap', import.meta.url))));
    const simBin = new Uint8Array(await readFile(new URL('../../content/generated/sim.bin', import.meta.url)));
    const player = ReplayPlayer.open(replay, { simBin, map });
    const costs: { tick: number; seq: number; target: number; mass: number; energy: number; completed: boolean; canceled: boolean }[] = [];
    let active: typeof costs[number] | null = null;
    while (player.tick < player.endTick) {
      for (const c of byTick.get(player.tick + 1) ?? []) if (c.army === 0 && c.units.includes(mexHandle)) {
        if (c.op === Op.Upgrade) { active = { tick: player.tick + 1, seq: c.seq, target: new DataView(c.payload.buffer, c.payload.byteOffset, c.payload.byteLength).getUint16(0, true), mass: 0, energy: 0, completed: false, canceled: false }; costs.push(active); }
        else if (c.op === Op.Stop && active) { active.canceled = true; active = null; }
      }
      const w = player.world, U = w.units.col, u = w.units.resolve(mex!), old = u >= 0 ? U.bp[u]! : -1;
      const paidM = u >= 0 ? U.repairPaidMass.get(u) : 0, paidE = u >= 0 ? U.repairPaidEnergy.get(u) : 0;
      player.step(); const current = w.units.resolve(mex!);
      if (current < 0 || old < 0 || active === null) continue;
      if (w.frameFlowPower.get(current) > 0) {
        // Actual per-consumer billing survives completion, unlike the reset progress
        // counters. Its upkeep was charged for the PREVIOUS blueprint this tick.
        const ratio = U.ecoRatio[current]!;
        const mass = w.frameFlowSpentMass.get(current) - Math.floor(w.bp.massUpkeepMilliPerTickCol[old]! * ratio / 65536);
        const energy = w.frameFlowSpentEnergy.get(current) - Math.floor(w.bp.energyUpkeepMilliPerTickCol[old]! * ratio / 65536);
        expect(mass).toBeGreaterThanOrEqual(0); expect(energy).toBeGreaterThanOrEqual(0);
        active.mass += mass; active.energy += energy;
        if (U.bp[current] === old && player.tick !== active.tick) {
          expect(U.repairPaidMass.get(current)).toBeGreaterThanOrEqual(paidM); expect(U.repairPaidEnergy.get(current)).toBeGreaterThanOrEqual(paidE);
        }
      }
      if (U.bp[current] !== old) { expect(U.bp[current]).toBe(active.target); active.completed = true; active = null; }
    }
    expect(costs).toHaveLength(3); expect(costs[0]).toMatchObject({ canceled: true, completed: false });
    expect(costs[0]!.mass).toBeGreaterThan(0); expect(costs[0]!.mass).toBeLessThan(900000);
    expect(costs[1]).toMatchObject({ target: SKIRMISH_BLUEPRINTS.indexOf('core:str_t2_mex'), mass: 900000, energy: 5400000, completed: true, canceled: false });
    expect(costs[2]).toMatchObject({ target: SKIRMISH_BLUEPRINTS.indexOf('core:str_t3_mex'), mass: 4500000, energy: 31000000, completed: true, canceled: false });
    const result = player.playToEnd(); expect(result.divergences).toEqual([]); expect(result.tainted).toBe(true);
    const at = player.world.units.resolve(mex!); expect(player.world.units.col.bp[at]).toBe(SKIRMISH_BLUEPRINTS.indexOf('core:str_t3_mex'));
    expect(result.endTick).toBe(final.tick);
    const nativeHashRow = (final.ruleHash!.hashTick - replay.hashes.firstTick) / replay.hashes.interval;
    expect(Number.isInteger(nativeHashRow)).toBe(true); expect(replay.hashes.hashes[nativeHashRow]).toBe(final.ruleHash!.hash);
    await assertSilentOutput(page); expectNoErrors(errors);
    await attachJson(info, 'extractor-native-evidence', { rows, acuSight, mexSight, final, replayPaidCosts: costs, errors,
      boundary: 'Original untainted native Build, then explicitly tainted real-Spawn supply actors. Native HUD paid work and accepted frames. Full replay per-consumer billing includes the completion tick and subtracts old-tier upkeep, proving exact prices without a resource mutation. Sight screenshots require visual review; no subjective pixel PASS.' });
  } finally { await attachJson(info, 'extractor-partial-receipts', { rows, errors }); }
});
