import { expect, test } from './support/silent-test.ts';
import { decodePng } from './support/png.ts';
import { openGame, SERVERS } from './support/game.ts';
for (const server of SERVERS) test(`MS3 selection gestures (${server.name})`, async ({ page }) => {
  await openGame(page, server.url, 'map=testplane&spawn=tanks&cubes=60&enemy=0', 60, { legacySelection: false });
  expect(await page.evaluate(() => window.__faf!.selected())).toEqual([]);
  await page.mouse.click(640, 400, { button: 'right' });
  expect(await page.evaluate(() => window.__faf!.lastMoveTarget())).toBeNull();
  const p = await page.evaluate(() => window.__faf!.projectedUnits().filter((u) => u.army === 0));
  const unit = p.find((u) => u.x > 350 && u.x < 1100 && u.y > 150 && u.y < 650)!;
  await page.mouse.click(unit.x, unit.y);
  expect(await page.evaluate(() => window.__faf!.selected().length)).toBe(1);
  await page.keyboard.down('Shift'); await page.mouse.click(unit.x, unit.y); await page.keyboard.up('Shift');
  expect(await page.evaluate(() => window.__faf!.selected().length)).toBe(0);
  await page.mouse.move(350, 170); await page.mouse.down(); await page.mouse.move(1000, 650, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => window.__faf!.selected().length)).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().dynamicDecals)).toBeGreaterThan(1);
  const first = await page.evaluate(() => window.__faf!.ownHandles()[0]!);
  await page.evaluate((id) => window.__faf!.select([id]), first);
  await page.keyboard.down('Shift');
  await page.mouse.move(350, 170); await page.mouse.down(); await page.mouse.move(1000, 650, { steps: 4 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  const additive = await page.evaluate(() => window.__faf!.selected());
  expect(additive).toContain(first); expect(additive.length).toBeGreaterThan(1);
  await page.keyboard.press('Escape'); expect(await page.evaluate(() => window.__faf!.selected())).toEqual([]);
  await page.mouse.dblclick(unit.x, unit.y);
  const types = await page.evaluate(() => { const h = window.__faf!; return h.selected().map((id) => h.unitInfo(id)!.visual); });
  expect(types.length).toBeGreaterThan(1); expect(new Set(types).size).toBe(1);
  await page.keyboard.press('Control+KeyA'); expect(await page.evaluate(() => window.__faf!.selected().length)).toBe(60);
});

for (const server of SERVERS) test(`MS3 selected ring and HP bar pixels (${server.name})`, async ({ page }) => {
  await openGame(page, server.url, 'map=testplane&spawn=none', 0, { legacySelection: false });
  await page.evaluate(() => { const h = window.__faf!; h.ctl({ t: 'pause' }); });
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const state = await page.evaluate(async () => {
    const h = window.__faf!; h.spawnAt('core:lnd_t1_tank', 256, 256);
    const t = h.tick + 1; h.ctl({ t: 'step', ticks: 1 }); await h.waitTick(t);
    h.setCamera(256, 256, 24);
    return { id: h.ownHandles()[0]! };
  });
  await page.waitForFunction(() => window.__faf!.renderStats().frames > 5);
  const baseline = decodePng(await page.locator('#game-canvas').screenshot());
  await page.evaluate((id) => window.__faf!.select([id]), state.id);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().dynamicDecals)).toBe(1);
  const selected = decodePng(await page.locator('#game-canvas').screenshot());
  const positions = await page.evaluate(() => {
    const h = window.__faf!;
    return { ring: Array.from({ length: 32 }, (_, i) => { const a = i * Math.PI / 16; return h.project(256 + 0.6 * Math.cos(a), 0, 256 + 0.6 * Math.sin(a))!; }), top: h.project(256, 0.6, 256)! };
  });
  const scale = selected.width / 1280;
  let blueRing = 0;
  for (const p of positions.ring) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.round(p.x * scale) + dx; const y = Math.round(p.y * scale) + dy;
    const o = (y * selected.width + x) * selected.channels;
    if (selected.data[o + 2]! > selected.data[o]! + 35 && selected.data[o + 2]! > selected.data[o + 1]! + 25 && Math.abs(selected.data[o + 2]! - baseline.data[o + 2]!) > 15) blueRing++;
  }
  let greenBar = 0;
  for (let y = Math.floor((positions.top.y - 20) * scale); y < Math.ceil(positions.top.y * scale); y++) for (let x = Math.floor((positions.top.x - 15) * scale); x < Math.ceil((positions.top.x + 15) * scale); x++) {
    const o = (y * selected.width + x) * selected.channels;
    if (selected.data[o + 1]! > selected.data[o]! + 70 && selected.data[o + 1]! > selected.data[o + 2]! + 70 && selected.data[o + 1]! > baseline.data[o + 1]! + 30) greenBar++;
  }
  expect(blueRing, 'team-blue ring changes pixels at its projected circumference').toBeGreaterThan(5);
  expect(greenBar, 'selected HP bar adds green pixels above the tank').toBeGreaterThan(10);
});
