import { expect, test } from './support/silent-test.ts';
import { openGame, SERVERS, waitTick } from './support/game.ts';
for (const server of SERVERS) test(`MS3 queued orders and watch lines (${server.name})`, async ({ page }) => {
  await openGame(page, server.url, 'map=testplane&spawn=cubes&cubes=1&enemy=0', 1, { legacySelection: false });
  const start = await page.evaluate(() => { const h = window.__faf!; const ids = h.ownHandles(); h.select(ids); h.ctl({ t: 'pause' }); return { id: ids[0]!, p: h.unitPos(ids[0]!)! }; });
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const targets = [8, 16, 24].map((n) => ({ x: start.p.x + n, z: start.p.z }));
  const pixels = await page.evaluate((ts) => ts.map((p) => window.__faf!.project(p.x, 0, p.z)!), targets);
  await page.mouse.click(pixels[0]!.x, pixels[0]!.y, { button: 'right' });
  await page.keyboard.down('Shift');
  for (const p of pixels.slice(1)) await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.keyboard.up('Shift');
  await page.evaluate(() => window.__faf!.ctl({ t: 'step', ticks: 1 }));
  await expect.poll(() => page.evaluate(() => window.__faf!.watch()[0]?.orders)).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().passDraws.overlay)).toBeGreaterThan(0);
  const visited: number[] = [];
  for (let batch = 0; batch < 30; batch++) {
    const targetTick = await page.evaluate(() => { const h = window.__faf!; const t = h.tick + 4; h.ctl({ t: 'step', ticks: 4 }); return t; });
    await waitTick(page, targetTick);
    const info = await page.evaluate((id) => window.__faf!.unitInfo(id)!, start.id);
    if (info.orders !== null && (visited.length === 0 || visited[visited.length - 1] !== info.orders)) visited.push(info.orders);
    if (info.orders === 0) break;
  }
  expect(visited).toContain(2); expect(visited).toContain(1); expect(visited.at(-1)).toBe(0);
  await page.evaluate(({ id, p }) => { const h = window.__faf!; h.sendMove([id], p.x, p.z); h.sendMove([id], p.x + 8, p.z, true); h.sendMove([id], p.x + 16, p.z); h.ctl({ t: 'step', ticks: 1 }); }, start);
  await expect.poll(() => page.evaluate(() => window.__faf!.watch()[0]?.orders)).toBe(1);
  await page.keyboard.press('KeyS'); await page.evaluate(() => window.__faf!.ctl({ t: 'step', ticks: 1 }));
  await expect.poll(() => page.evaluate(() => window.__faf!.watch()[0]?.orders)).toBe(0);
});
