import { expect, test } from './support/silent-test.ts';
import { attachJson, openGame, SERVERS } from './support/game.ts';

for (const server of SERVERS) test(`MS3 mixed tank group crosses Hollow Ridge (${server.name})`, async ({ page }, info) => {
  test.setTimeout(120000);
  await openGame(page, server.url, 'map=hollow-ridge&spawn=none', 0, { legacySelection: false });
  await page.evaluate(() => window.__faf!.ctl({ t: 'pause' }));
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const report = await page.evaluate(async () => {
    const h = window.__faf!;
    const advance = async (n: number): Promise<void> => { const t = h.tick + n; h.ctl({ t: 'step', ticks: n }); await h.waitTick(t, 20000); };
    for (let i = 0; i < 40; i++) h.spawnAt(['core:lnd_t1_tank', 'core:lnd_t2_tank', 'core:lnd_t3_heavy'][i % 3]!, 95 + i % 8 * 3.2, 95 + Math.floor(i / 8) * 3.2);
    await advance(1);
    const ids = h.ownHandles(); h.select(ids);
    const before = h.pathStats(); h.sendMove(ids, 405, 405); await advance(1);
    const groupRequests = h.pathStats().requestsIssued - before.requestsIssued;
    const slots = h.watch().map((w) => ({ handle: w.handle, target: w.targets[0]! }));
    let blockedFrames = 0; let samples = 0;
    for (let tick = 0; tick < 3600; tick += 20) {
      await advance(20); samples++;
      if (ids.some((id) => h.unitInfo(id)!.blocked)) blockedFrames++;
    }
    const arrived = ids.filter((id) => { const u = h.unitInfo(id)!; return Math.hypot(u.x - 405, u.z - 405) <= 15 && u.orders === 0; }).length;
    const offsetError = Math.max(...slots.map((s) => { const p = h.unitPos(s.handle)!; return Math.hypot(p.x - s.target.x, p.z - s.target.z); }));
    return { units: ids.length, groupRequests, samples, blockedFrames, arrived, offsetError, arrivalRate: arrived / ids.length, finalStats: h.pathStats() };
  });
  expect(report.units).toBe(40); expect(report.groupRequests).toBe(1); expect(report.blockedFrames).toBe(0); expect(report.arrivalRate).toBeGreaterThanOrEqual(0.95); expect(report.offsetError).toBeLessThanOrEqual(1.5);
  await attachJson(info, 'MS3 pathing', report);
});

for (const server of SERVERS) test(`MS3 footprint marks only intersected paths (${server.name})`, async ({ page }, info) => {
  await openGame(page, server.url, 'map=testplane&spawn=none', 0, { legacySelection: false });
  await page.evaluate(() => window.__faf!.ctl({ t: 'pause' }));
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const report = await page.evaluate(async () => {
    const h = window.__faf!;
    const advance = async (n: number): Promise<void> => { const t = h.tick + n; h.ctl({ t: 'step', ticks: n }); await h.waitTick(t); };
    h.spawnAt('core:lnd_t1_tank', 100, 100); h.spawnAt('core:lnd_t1_tank', 100, 200); await advance(1);
    const ids = h.ownHandles(); h.select(ids);
    h.sendMove([ids[0]!], 200, 100); h.sendMove([ids[1]!], 200, 200); await advance(1);
    const before = h.pathStats(); const start = h.unitPos(ids[0]!)!; const waypoint = h.watch()[0]!.points[0]!;
    const x = Math.floor((start.x + waypoint.x) / 2) - 1; const z = Math.floor((start.z + waypoint.z) / 2) - 1;
    const command = h.console(`obstacle ${x} ${z} 4 4`); await advance(1);
    const after = h.pathStats(); let blockedFrames = 0;
    for (let i = 0; i < 100; i++) { await advance(5); if (ids.some((id) => h.unitInfo(id)!.blocked)) blockedFrames++; }
    return { command, before, after, blockedFrames, arrived: ids.map((id) => h.unitInfo(id)!) };
  });
  await attachJson(info, 'MS3 footprint repath', report);
  expect(report.command.ok).toBe(true); expect(report.after.repathsTriggered - report.before.repathsTriggered).toBe(1); expect(report.blockedFrames).toBe(0);
  expect(report.arrived.every((u) => u.orders === 0 && Math.abs(u.x - 200) < 2)).toBe(true);
});
