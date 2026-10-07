import { PlacementVerdict } from '../../packages/rules/src/index.ts';
import { WatchOrderType } from '../../packages/protocol/src/index.ts';
import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, groundPixel, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page): Promise<void> {
  const next = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(n => window.__faf!.renderStats().frames >= n, next);
}
async function pause(page: Page): Promise<void> {
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
}
async function spawn(page: Page, id: string, x: number, z: number): Promise<number> {
  const old = await page.evaluate(() => window.__faf!.ownHandles());
  await page.evaluate(a => window.__faf!.spawnAt(a.id, a.x, a.z), { id, x, z });
  await stepTicks(page, 2); await rendered(page);
  const bp = SKIRMISH_BLUEPRINTS.indexOf(id);
  const handle = await page.evaluate(a => window.__faf!.ownHandles().find(h =>
    !a.old.includes(h) && window.__faf!.unitInfo(h)?.visual === a.bp), { old, bp });
  expect(handle).toBeDefined(); return handle!;
}
async function receipt(page: Page) {
  return page.evaluate(() => ({ buildHash: window.__faf!.buildHash, tick: window.__faf!.tick,
    tainted: window.__faf!.tainted, hostErrors: window.__faf!.hostErrors,
    silent: (window as unknown as { __fafSilentAudio: unknown }).__fafSilentAudio,
    inspection: window.__faf!.inspection() }));
}
async function rings(page: Page) {
  return page.getByTestId('range-ring').evaluateAll(elements => elements.map(el => ({
    kind: el.getAttribute('data-kind'), radius: Number(el.getAttribute('data-radius')),
    source: el.getAttribute('data-source'), status: el.getAttribute('data-status'),
    x: Number(el.getAttribute('data-x')), z: Number(el.getAttribute('data-z')),
    geometry: [...el.querySelectorAll('path,polyline')].map(path => path.getAttribute('d') ?? path.getAttribute('points')),
  })));
}

test('native radar, weapon and planned radar rings follow real blueprint radii and the paused camera', async ({ page }, info) => {
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page); await pause(page);
  const radar = await spawn(page, 'core:str_t1_radar', 130, 82);
  const pd = await spawn(page, 'core:str_t1_pd', 140, 84);
  await page.evaluate(() => window.__faf!.setCamera(130, 82, 190)); await rendered(page);
  await clickUnit(page, radar);
  const radarBp = SKIRMISH_BLUEPRINTS.indexOf('core:str_t1_radar');
  const radarRing = page.locator('[data-testid="range-ring"][data-kind="radar"]');
  await expect(radarRing).toHaveCount(1);
  await expect(radarRing).toHaveAttribute('data-radius', String(SKIRMISH_BLUEPRINTS.radarCol[radarBp]! / 4096));
  await expect(page.locator('[data-testid="range-ring"][data-kind="vision"]')).toHaveAttribute('data-radius', String(SKIRMISH_BLUEPRINTS.vision(radarBp) / 4096));
  const initial = await rings(page);
  expect(initial.every(ring => ring.source === 'selection')).toBe(true);
  expect(initial.some(ring => ring.geometry.some(g => g !== null && g.length > 20))).toBe(true);
  await info.attach('selected-radar-ranges', { body: await page.screenshot(), contentType: 'image/png' });
  const tick = await page.evaluate(() => window.__faf!.tick);
  await page.evaluate(() => window.__faf!.setCamera(145, 90, 190)); await rendered(page);
  await expect.poll(async () => (await rings(page)).find(r => r.kind === 'radar')?.geometry).not.toEqual(initial.find(r => r.kind === 'radar')!.geometry);
  expect(await page.evaluate(() => window.__faf!.tick)).toBe(tick);
  const afterCamera = await rings(page);
  await clickUnit(page, pd);
  const pdBp = SKIRMISH_BLUEPRINTS.indexOf('core:str_t1_pd');
  const weapon = SKIRMISH_BLUEPRINTS.mountWeaponCol[SKIRMISH_BLUEPRINTS.firstMount(pdBp)]!;
  await expect(page.locator('[data-testid="range-ring"][data-kind="weapon"]')).toHaveAttribute('data-radius', String(SKIRMISH_BLUEPRINTS.weaponRangeCol[weapon]! / 4096));
  await expect(radarRing).toHaveCount(0);
  const defense = await rings(page);
  await clickUnit(page, commander);
  await page.getByRole('gridcell', { name: /Horcher/ }).click();
  const p = await groundPixel(page, 136, 80); await page.mouse.move(p.x, p.y);
  await expect(page.getByTestId('build-ghost')).toHaveAttribute('data-type', 'core:str_t1_radar');
  await expect(radarRing).toHaveAttribute('data-source', 'placement');
  await expect(radarRing).toHaveAttribute('data-status', 'planned');
  await expect(radarRing).toHaveAttribute('data-radius', String(SKIRMISH_BLUEPRINTS.radarCol[radarBp]! / 4096));
  const planned = await rings(page);
  expect(planned.every(ring => ring.source === 'placement')).toBe(true);
  await info.attach('planned-radar-ranges', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('Escape');
  await assertSilentOutput(page); expectNoErrors(errors);
  const final = await receipt(page); expect(final.hostErrors).toEqual([]);
  await attachJson(info, 'range-preview-receipt', { engine: info.project.name, commander, radar, pd, initial, afterCamera, defense, planned, final });
});

test('native raised pgen ghosts paint around a mex and accepted queues reserve the surrounding sites', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const commander = await startHumanAiSkirmish(page); await pause(page);
  await clickUnit(page, commander);
  await page.keyboard.press('KeyQ');
  const massSpot = await groundPixel(page, 116, 100);
  await page.mouse.move(massSpot.x, massSpot.y);
  await expect(page.getByTestId('build-ghost')).toHaveAttribute('data-verdict', '0');
  await page.mouse.click(massSpot.x, massSpot.y);
  const mexBp = SKIRMISH_BLUEPRINTS.indexOf('core:str_t1_mex');
  let mex: number | undefined;
  for (let n = 0; n < 60; n++) {
    await stepTicks(page, 5); await rendered(page);
    mex = await page.evaluate(bp => window.__faf!.ownHandles().find(h => {
      const u = window.__faf!.unitInfo(h); return u?.visual === bp && u.build === 1;
    }), mexBp);
    if (mex !== undefined) break;
  }
  expect(mex, 'a completed mex from a native Build on the real mass spot').toBeDefined();
  const mexHandle = mex!;
  await page.evaluate(() => window.__faf!.setCamera(116, 100, 45)); await rendered(page);
  await page.keyboard.press('KeyW');
  const start = await groundPixel(page, 114, 98), end = await groundPixel(page, 118.25, 102.25);
  const sites = () => page.getByTestId('build-drag-ghost').evaluateAll(elements => elements.map(el => ({
    x: Number(el.getAttribute('data-x')), z: Number(el.getAttribute('data-z')), verdict: Number(el.getAttribute('data-verdict')),
  })));
  const before = await page.evaluate(h => ({ mex: window.__faf!.unitInfo(h), sent: window.__faf!.inspection()!.sentCommands }), mexHandle);
  await page.keyboard.down('Shift');
  let proposed: Awaited<ReturnType<typeof sites>>;
  try {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 6 });
    await expect(page.getByTestId('build-drag-ghosts')).toHaveAttribute('data-count', '9');
    proposed = await sites();
    const center = proposed.find(s => s.x === 116 * 4096 && s.z === 100 * 4096);
    expect(center?.verdict).toBe(PlacementVerdict.Occupied);
    expect(proposed.filter(s => s.verdict === PlacementVerdict.Valid).length).toBeGreaterThanOrEqual(4);
    await expect(page.getByTestId('build-drag-ghost-volume')).toHaveCount(9);
    const raised = await page.getByTestId('build-drag-ghost-volume').evaluateAll(groups => groups.map(group => {
      const polys = group.querySelectorAll('polygon'); return { wallsAndRoof: polys.length, roof: polys[polys.length - 1]?.getAttribute('points') };
    }));
    expect(raised.every(g => g.wallsAndRoof === 5 && g.roof !== null)).toBe(true);
    expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(before.sent);
    await info.attach('raised-grid-around-mex', { body: await page.screenshot(), contentType: 'image/png' });
    await page.mouse.up();
  } finally { await page.mouse.up(); await page.keyboard.up('Shift'); }
  const valid = proposed.filter(s => s.verdict === PlacementVerdict.Valid);
  expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(before.sent + valid.length);
  await stepTicks(page, 4); await rendered(page);
  const watch = await page.evaluate(h => window.__faf!.watch().find(w => w.handle === h), commander);
  expect(watch?.orders).toBe(valid.length);
  expect(watch!.targets.map(({ type, x, z }) => ({ type, x, z }))).toEqual(valid.map(s => ({ type: WatchOrderType.Build, x: s.x / 4096, z: s.z / 4096 })));
  const accepted = await page.getByTestId('queued-build-ghost').count();
  expect(accepted).toBeGreaterThan(0);
  await expect(page.getByTestId('queued-build-ghost-volume')).toHaveCount(accepted);
  const sent = await page.evaluate(() => window.__faf!.inspection()!.sentCommands);
  await page.keyboard.down('Shift');
  let repeated: Awaited<ReturnType<typeof sites>>;
  try {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 6 });
    await expect.poll(async () => (await sites()).filter(s => s.verdict === PlacementVerdict.Valid).length).toBe(0);
    repeated = await sites(); expect(repeated).toHaveLength(9);
    await page.mouse.up();
  } finally { await page.mouse.up(); await page.keyboard.up('Shift'); }
  expect(await page.evaluate(() => window.__faf!.inspection()!.sentCommands)).toBe(sent);
  const afterMex = await page.evaluate(h => window.__faf!.unitInfo(h), mexHandle);
  expect(afterMex?.hp).toBe(before.mex!.hp); expect(afterMex?.visual).toBe(before.mex!.visual);
  await page.keyboard.press('Escape');
  await info.attach('accepted-raised-grid', { body: await page.screenshot(), contentType: 'image/png' });
  await assertSilentOutput(page); expectNoErrors(errors);
  const final = await receipt(page); expect(final.hostErrors).toEqual([]); expect(final.tainted).toBe(false);
  await attachJson(info, 'raised-build-preview-receipt', { engine: info.project.name, commander, mex: mexHandle, before, proposed, valid, watch, accepted, repeated, afterMex, final,
    fixture: 'Original skirmish commander and a normal completed Build on a real mass spot. Native Shift drag and accepted queues; no cheats, injected frames or sim World access.' });
});
