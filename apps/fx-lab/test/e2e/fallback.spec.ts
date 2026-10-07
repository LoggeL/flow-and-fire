/**
 * LDR fallback of the PostChain (TRACK-RENDERFX acceptance "ohne EXT_color_buffer_float bzw. mit hdr=0
 * automatischer LDR-Fallback ohne Fehler"): explicitly with `hdr=0`, and automatically when the
 * browser does not expose EXT_color_buffer_float (hidden via an init script).
 */
import { expect, test } from '@playwright/test';
import { MIN_LUMA_SPREAD, canvasShot, expectHealthy, labStats, openLab } from './support/lab.ts';

/** Hides EXT_color_buffer_float from every WebGL2 context of the page (runs before the app). */
function hideColorBufferFloat(): void {
  const hidden = 'EXT_color_buffer_float';
  const proto = WebGL2RenderingContext.prototype;
  const getExtension = proto.getExtension;
  const getSupported = proto.getSupportedExtensions;
  Object.defineProperty(proto, 'getExtension', {
    configurable: true,
    writable: true,
    value: function (this: WebGL2RenderingContext, name: string): unknown {
      return name === hidden ? null : ((getExtension as (this: WebGL2RenderingContext, n: string) => unknown).call(this, name));
    },
  });
  Object.defineProperty(proto, 'getSupportedExtensions', {
    configurable: true,
    writable: true,
    value: function (this: WebGL2RenderingContext): string[] | null {
      const list = getSupported.call(this);
      return list === null ? null : list.filter((n) => n !== hidden);
    },
  });
}

test('hdr=0: LDR scene target, correct image, no errors', async ({ page }, info) => {
  const log = await openLab(page, { scene: 'battle', hdr: 0, freeze: 6 });
  await expectHealthy(page, log, 'battle');
  const st = await labStats(page);
  expect(st.post.hdr, 'stats.post.hdr').toBe(false);
  expect(st.fx.particles?.alive ?? 0, 'particles render in LDR too').toBeGreaterThan(0);
  const shot = await canvasShot(page, 'fallback-hdr0', info);
  expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
  expect(shot.stats.meanLuma, 'image not black').toBeGreaterThan(20);
  expect(shot.stats.blackFraction, 'no black screen').toBeLessThan(0.5);
});

test('without EXT_color_buffer_float: automatic LDR fallback', async ({ page }, info) => {
  const log = await openLab(page, { scene: 'battle', freeze: 6 }, { initScript: hideColorBufferFloat });
  const hidden = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const r = gl === null ? null : gl.getExtension('EXT_color_buffer_float') === null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  });
  expect(hidden, 'extension hidden by the init script').toBe(true);
  await expectHealthy(page, log, 'battle');
  const st = await labStats(page);
  expect(st.post.hdr, 'hdr requested (default 1) but not available → LDR').toBe(false);
  expect(st.post.bloom, 'bloom still runs on the LDR target').toBe(true);
  const shot = await canvasShot(page, 'fallback-nofloat', info);
  expect(shot.stats.lumaSpread).toBeGreaterThanOrEqual(MIN_LUMA_SPREAD);
  expect(shot.stats.meanLuma, 'image not black').toBeGreaterThan(20);
});
