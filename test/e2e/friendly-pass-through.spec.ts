import { assertSilentOutput } from '../../apps/game/test/support/silent-output.ts';
import { expect, test, type Page } from './support/silent-test.ts';
import { attachJson, captureErrors, expectNoErrors, stepTicks } from './support/game.ts';
import { clickUnit, SKIRMISH_BLUEPRINTS, startHumanAiSkirmish } from './support/skirmish.ts';

async function rendered(page: Page): Promise<void> {
  const f = await page.evaluate(() => window.__faf!.renderStats().frames + 2);
  await page.waitForFunction(f => window.__faf!.renderStats().frames >= f, f);
}
async function accepted(page: Page, n: number): Promise<void> { await stepTicks(page, n); await rendered(page); }
async function spawn(page: Page, id: string, x: number, z: number, army = 0): Promise<number> {
  const before = await page.evaluate(() => window.__faf!.projectedUnits().map(u => u.handle));
  await page.evaluate(a => window.__faf!.spawnAt(a.id, a.x, a.z, a.army), { id, x, z, army });
  await accepted(page, 2);
  const visual = SKIRMISH_BLUEPRINTS.indexOf(id);
  const h = await page.evaluate(a => window.__faf!.projectedUnits().find(u =>
    !a.before.includes(u.handle) && u.visual === a.visual && u.army === a.army)?.handle ?? null, { before, visual, army });
  expect(h, `actual Spawn of ${id}`).not.toBeNull(); return h!;
}
async function state(page: Page, ids: number[]) {
  return page.evaluate(ids => ({ buildHash: window.__faf!.buildHash, tick: window.__faf!.tick,
    tainted: window.__faf!.tainted, actors: ids.map(h => ({ handle: h, unit: window.__faf!.unitInfo(h) })),
    hostErrors: window.__faf!.hostErrors, inspection: window.__faf!.inspection(),
    silent: (window as unknown as { __fafSilentAudio: unknown }).__fafSilentAudio }), ids);
}

for (const area of [false, true]) test(`native ${area ? 'artillery area damage' : 'cannon passage through engineer and factory'} spares friendly actors and hits the enemy`, async ({ page }, info) => {
  test.setTimeout(120_000); const errors = captureErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 }); await startHumanAiSkirmish(page);
  if (!await page.evaluate(() => window.__faf!.paused)) await page.keyboard.press('KeyP');
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const shooter = await spawn(page, area ? 'core:lnd_t1_arty' : 'core:str_t1_pd', 110, 104);
  const friends = area
    ? [await spawn(page, 'core:str_t1_mex', 132, 105)]
    : [await spawn(page, 'core:eng_t1', 116, 104), await spawn(page, 'core:fac_land_t1', 122, 104)];
  const target = await spawn(page, 'core:str_t1_mex', area ? 132 : 130, 104, 1);
  await page.evaluate(() => window.__faf!.setCamera(122, 104, 65)); await rendered(page);
  await clickUnit(page, shooter); await page.keyboard.press('Alt+KeyA');
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-game-cursor', 'attack');
  const pixel = await page.evaluate(h => window.__faf!.unitScreenPos(h), target); expect(pixel).not.toBeNull();
  await page.mouse.click(pixel!.x, pixel!.y); await page.mouse.move(720, 220);
  const handles = [...friends, target], before = await state(page, handles), samples = [];
  for (const actor of before.actors) expect(actor.unit).not.toBeNull();
  for (let n = 0; n < 45; n++) {
    await accepted(page, 1); const sample = await state(page, handles); samples.push(sample);
    for (const h of friends) {
      const original = before.actors.find(a => a.handle === h)!.unit!;
      expect(sample.actors.find(a => a.handle === h)?.unit?.hp).toBe(original.hp);
    }
    if (sample.actors.find(a => a.handle === target)!.unit!.hp < before.actors.at(-1)!.unit!.hp) break;
  }
  const after = samples.at(-1)!;
  const targetBefore = before.actors.at(-1)!.unit!;
  expect(targetBefore.hp).toBe(targetBefore.hpMax);
  // HP is published as a floored u8 fraction and then rounded by unitInfo.
  // A genuine 90-HP hit on this 400-HP target therefore displays a 91-HP loss.
  const damage = area ? 90 : 45;
  const publishedHp = Math.round(Math.floor((targetBefore.hpMax - damage) * 255 / targetBefore.hpMax) / 255 * targetBefore.hpMax);
  expect(after.actors.at(-1)!.unit!.hp).toBe(publishedHp);
  expect(after.tainted).toBe(true); expect(after.hostErrors).toEqual([]);
  await assertSilentOutput(page); expectNoErrors(errors);
  await info.attach('native-friendly-passage', { body: await page.screenshot(), contentType: 'image/png' });
  await attachJson(info, 'native-friendly-passage-receipt', { engine: info.project.name, area, shooter, friends, target, before, samples, after,
    fixture: 'Explicitly tainted real Spawn fixture. Native canvas Attack, actual published HP and normal weapon/projectile phases; no injected frames, HP or World reads.' });
});
