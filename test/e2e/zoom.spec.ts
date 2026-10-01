import { expect, test } from './support/silent-test.ts';
import { decodePng } from './support/png.ts';
import { openGame, SERVERS, attachJson, PERF_GATE } from './support/game.ts';
for (const server of SERVERS) test(`MS3 strategic zoom and 200 icon box gestures (${server.name})`, async ({ page }, info) => {
  test.setTimeout(120000);
  await openGame(page, server.url, 'map=testplane&spawn=cubes&cubes=1000&enemy=0', 1000, { legacySelection: false });
  await page.mouse.move(640, 360); for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.__faf!.zoomLevel)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__faf!.renderStats().passDraws.icons)).toBe(1);
  expect(await page.evaluate(() => window.__faf!.renderStats().passDraws.units)).toBe(0);
  await page.evaluate(() => window.__faf!.ctl({ t: 'pause' }));
  await expect.poll(() => page.evaluate(() => window.__faf!.paused)).toBe(true);
  const boxes = await page.evaluate(() => {
    const units = window.__faf!.projectedUnits().filter((u) => u.army === 0);
    const minX = Math.min(...units.map((u) => u.x)); const maxX = Math.max(...units.map((u) => u.x));
    const minY = Math.min(...units.map((u) => u.y)); const maxY = Math.max(...units.map((u) => u.y));
    let state = 47; const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    return Array.from({ length: 200 }, () => {
      const x = Math.round(minX - 12 + random() * (maxX - minX + 24)); const y = Math.round(minY - 12 + random() * (maxY - minY + 24));
      const w = Math.round(5 + random() * 45); const height = Math.round(5 + random() * 45);
      return { x, y, w, height, expected: units.filter((u) => u.rect[2]! >= x && u.rect[0]! <= x + w && u.rect[3]! >= y && u.rect[1]! <= y + height).map((u) => u.handle) };
    });
  });
  const icon = await page.evaluate(() => window.__faf!.projectedUnits().find((u) => u.army === 0)!);
  const image = decodePng(await page.locator('#game-canvas').screenshot());
  const scale = image.width / 1280; let iconBluePixels = 0;
  for (let y = Math.floor(icon.rect[1]! * scale); y <= Math.ceil(icon.rect[3]! * scale); y++) for (let x = Math.floor(icon.rect[0]! * scale); x <= Math.ceil(icon.rect[2]! * scale); x++) {
    const o = (y * image.width + x) * image.channels;
    if (image.data[o + 2]! > image.data[o]! + 35 && image.data[o + 2]! > image.data[o + 1]! + 25) iconBluePixels++;
  }
  expect(iconBluePixels, 'team-blue icon at its projected rectangle').toBeGreaterThan(5);
  let expected = 0; let hits = 0; let falsePositives = 0; let selected = 0;
  for (const box of boxes) {
    // Trusted mouse input exercises pointer capture in every browser, including Firefox.
    await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + box.w, box.y + box.height); await page.mouse.up();
    const got = await page.evaluate(() => window.__faf!.selected());
    const want = new Set(box.expected); expected += want.size; selected += got.length;
    for (const id of got) if (want.has(id)) hits++; else falsePositives++;
  }
  const baseline = await page.evaluate(async () => {
    window.__faf!.select([]);
    const times: number[] = []; let last = performance.now();
    for (let i = 0; i < 30; i++) await new Promise<void>((resolve) => requestAnimationFrame((t) => { times.push(t - last); last = t; resolve(); }));
    times.sort((a, b) => a - b); return 1000 / times[Math.floor(times.length / 2)]!;
  });
  const flight = await page.evaluate(() => window.__faf!.flight([{ x: 256, z: 256, distance: 80 }, { x: 256, z: 256, distance: 900 }], 3000));
  const report = { iconBluePixels, boxes: boxes.length, expected, selected, hits, falsePositives, recall: hits / Math.max(1, expected), falseRate: falsePositives / Math.max(1, selected), fps: flight.fps, baselineFps: baseline, mainJs: flight.mainJsMs };
  expect(report.expected).toBeGreaterThan(1000); expect(report.recall).toBeGreaterThanOrEqual(0.99); expect(report.falseRate).toBeLessThanOrEqual(0.01);
  if (PERF_GATE) expect(report.fps).toBeGreaterThanOrEqual(Math.min(60, 0.95 * baseline));
  await attachJson(info, 'MS3 zoom', report);
});
