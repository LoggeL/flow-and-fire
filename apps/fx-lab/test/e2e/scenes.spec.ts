import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';
import { GL_ERROR, ready } from '../../scripts/browser.ts';

/** Decode PNG scanlines (including filters) to inspect actual pixels, independent of byte entropy. */
function imageRange(png: Buffer): { range: number; bright: number; centerBright: number } {
  let pos = 8, width = 0, height = 0, channels = 4;
  const data: Buffer[] = [];
  while (pos < png.length) {
    const n = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8), body = png.subarray(pos + 8, pos + 8 + n);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); channels = body[9] === 2 ? 3 : 4; }
    if (type === 'IDAT') data.push(body);
    pos += n + 12;
  }
  const bytes = inflateSync(Buffer.concat(data)), stride = width * channels;
  let prev = new Uint8Array(stride), low = 255, high = 0, bright = 0, centerBright = 0;
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c; };
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride), off = y * (stride + 1), filter = bytes[off]!;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels]! : 0, b = prev[x]!, c = x >= channels ? prev[x - channels]! : 0;
      row[x] = (bytes[off + 1 + x]! + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : filter === 4 ? paeth(a, b, c) : 0)) & 255;
    }
    for (let x = 0; x < width; x++) { const v = Math.max(row[x * channels]!, row[x * channels + 1]!, row[x * channels + 2]!); low = Math.min(low, v); high = Math.max(high, v); if (v > 200) { bright++; if (Math.abs(x - width / 2) < width / 6 && Math.abs(y - height / 2) < height / 6) centerBright++; } }
    prev = row;
  }
  return { range: high - low, bright, centerBright };
}
async function open(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' || GL_ERROR.test(m.text())) errors.push(m.text()); });
  await page.goto('/?' + query); await ready(page);
  return errors;
}
const freezes = { battle: 12, shields: 6, big: 1.6, gallery: 3, lighting: 3 };
for (const [scene, freeze] of Object.entries(freezes)) test(`${scene} renders its frozen scene`, async ({ page }, info) => {
  const errors = await open(page, `scene=${scene}&freeze=${freeze}&seed=77`);
  const stats = await page.evaluate(() => window.__fxlab!.stats());
  expect(stats.drawsBySeg.shields + stats.drawsBySeg.particles + stats.drawsBySeg.beams).toBeLessThanOrEqual(6);
  expect(stats.draws).toBeLessThanOrEqual(40);
  if (scene === 'battle') { expect(stats.fx.particles!.alive).toBeGreaterThan(3000); expect(stats.scene['soldiers']).toBe(400); }
  if (scene === 'shields') { expect(stats.fx.shields!.count).toBe(20); expect(stats.fx.shields!.ripplesActive).toBeGreaterThan(0); }
  if (scene === 'big') { expect(stats.shakeActive).toBe(true); expect(stats.decals.count).toBeGreaterThan(0); }
  if (scene === 'gallery') expect(stats.scene['registered']).toBe(stats.scene['labels']);
  const png = await page.locator('canvas').screenshot({ path: info.outputPath(`${scene}.png`) });
  const pixels = imageRange(png); expect(pixels.range).toBeGreaterThan(30);
  if (scene === 'big') expect(pixels.centerBright).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});
test('low cap drops secondary particles while retaining priority zero', async ({ page }) => {
  const errors = await open(page, 'scene=battle&preset=low&freeze=10');
  const p = await page.evaluate(() => window.__fxlab!.stats().fx.particles!);
  expect(p.cap).toBe(8192); expect(p.dropped[2]).toBeGreaterThan(0); expect(p.dropped[0]).toBe(0);
  // Priority zero has a bounded over-cap allowance; this scene has no ACU deaths.
  expect(p.alive).toBeLessThanOrEqual(p.cap); expect(errors).toEqual([]);
});
test('explicit LDR is readable and FX off submits no FX draws', async ({ page }) => {
  const errors = await open(page, 'scene=battle&freeze=3&hdr=0&fx=0');
  const s = await page.evaluate(() => window.__fxlab!.stats());
  expect(s.post.hdr).toBe(false); expect(s.drawsBySeg.shields + s.drawsBySeg.particles + s.drawsBySeg.beams).toBe(0);
  expect(imageRange(await page.locator('canvas').screenshot()).range).toBeGreaterThan(30); expect(errors).toEqual([]);
});
test('missing float render targets automatically select LDR', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Extension masking is qualified on Chromium');
  await page.addInitScript(() => {
    const original = WebGL2RenderingContext.prototype.getExtension;
    const masked = function(this: WebGL2RenderingContext, name: string) {
      return name === 'EXT_color_buffer_float' ? null : (original as (name: string) => unknown).call(this, name);
    };
    WebGL2RenderingContext.prototype.getExtension = masked as typeof original;
  });
  const errors = await open(page, 'scene=battle&freeze=3');
  expect(await page.evaluate(() => window.__fxlab!.stats().post.hdr)).toBe(false);
  expect(imageRange(await page.locator('canvas').screenshot()).range).toBeGreaterThan(30); expect(errors).toEqual([]);
});
test('context loss restores existing particle state and rendering', async ({ page }) => {
  const errors = await open(page, 'scene=battle');
  await page.waitForTimeout(1200);
  const lost = await page.evaluate(() => window.__fxlab!.loseContext());
  test.skip(!lost, 'WEBGL_lose_context unavailable');
  await page.waitForTimeout(200);
  await page.waitForFunction(() => window.__fxlab!.restoreContext(), undefined, { timeout: 5000 });
  await page.waitForFunction(() => window.__fxlab!.restoreCount === 1);
  const before = await page.evaluate(() => window.__fxlab!.frame);
  await page.waitForFunction(frame => window.__fxlab!.frame > frame + 2, before);
  expect(await page.evaluate(() => window.__fxlab!.stats().fx.particles!.alive)).toBeGreaterThan(0);
  expect(imageRange(await page.locator('canvas').screenshot()).range).toBeGreaterThan(30); expect(errors).toEqual([]);
});
test('an immediate explosion reaches the next presented frame', async ({ page }) => {
  const errors = await open(page, 'scene=big&freeze=0.5');
  const r = await page.evaluate(async () => {
    const h = window.__fxlab!, before = h.stats().fx.particles!.alive, frame = h.frame;
    h.triggerBigExplosion();
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return { before, after: h.stats().fx.particles!.alive, elapsed: h.frame - frame };
  });
  expect(r.after).toBeGreaterThan(r.before); expect(r.elapsed).toBeLessThanOrEqual(1); expect(errors).toEqual([]);
});
