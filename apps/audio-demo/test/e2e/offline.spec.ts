/**
 * @faf/audio against the browser's real Web Audio implementation (OfflineAudioContext): decode
 * chain, stereo pan, bus volume, master limiter, loop seam and voice limits. The cases run inside
 * offline.html (`window.__fafAudioOffline`, src/offline/cases.ts) and report their measurements
 * plus violated criteria; this spec asserts on both and annotates the per-browser decode paths.
 */

import { expect, test, type Page } from '@playwright/test';
import type { DecodeCaseResult, OfflineApi, OfflineCaseName, OfflineResult } from '../../src/offline/cases.ts';

declare global {
  interface Window {
    __fafAudioOffline?: OfflineApi;
  }
}

async function openBench(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto('/offline.html');
  await page.waitForFunction(() => window.__fafAudioOffline !== undefined);
  await page.evaluate(() => window.__fafAudioOffline!.ready);
  expect(errors).toEqual([]);
}

async function run(page: Page, name: OfflineCaseName): Promise<OfflineResult> {
  return page.evaluate((n) => window.__fafAudioOffline!.run(n), name);
}

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openBench(page);
});

test.afterAll(async () => {
  await page.close();
});

test('decode: real files over the decode chain, lengths match the manifest', async ({ browserName }, info) => {
  const r = (await run(page, 'decode')) as DecodeCaseResult;
  const paths = Object.entries(r.byPath)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${p} ${n}`)
    .join(', ');
  const forced = Object.entries(r.forced)
    .filter(([, n]) => n > 0)
    .map(([p, n]) => `${p} ${n}`)
    .join(', ');
  info.annotations.push(
    { type: 'decode-path', description: `${browserName}: ${paths} (native support ${r.nativeSupport})` },
    {
      type: 'decode-compare',
      description: `forced paths: ${forced}; AudioDecoder ${r.hasAudioDecoder ? 'yes' : 'no'}; webcodecsTrim ${r.webcodecsTrim}; max |Δlength| vs default ${r.maxLengthDelta}; min correlation ${Math.min(...r.files.flatMap((f) => f.compare.map((c) => c.corr ?? 1)))}`,
    },
    { type: 'decode-ms', description: JSON.stringify(r.msByPath) },
  );
  expect(r.failures).toEqual([]);
  expect(r.files.length).toBeGreaterThanOrEqual(12);
  const ok = r.files.filter((f) => f.lengthOk);
  expect(ok.length).toBeGreaterThanOrEqual(12);
  expect(new Set(ok.map((f) => f.channels))).toEqual(new Set([1, 2]));
  expect(ok.filter((f) => f.loop).length).toBeGreaterThanOrEqual(2);
  // Every compared software path agrees with the default path (length + correlation).
  for (const f of r.files) {
    for (const c of f.compare) {
      if (!c.supported) continue;
      expect(c.length, `${f.id} ${c.path}`).toBe(f.expectedSamples);
    }
  }
});

test('pan: a shot left of the focus is ≥ 6 dB louder on the left, right mirrored', async ({ browserName }, info) => {
  const r = await run(page, 'pan');
  expect(r.name).toBe('pan');
  if (r.name !== 'pan') return;
  info.annotations.push({
    type: 'pan',
    description: `${browserName}: left ${r.left.lrDb} dB, right ${r.right.lrDb} dB, centre ${r.centre.lrDb} dB, rotated ${r.rotatedRight.lrDb} dB`,
  });
  expect(r.failures).toEqual([]);
  expect(r.left.lrDb).toBeGreaterThanOrEqual(6);
  expect(r.right.lrDb).toBeLessThanOrEqual(-6);
});

test('bus: sfx volume 0 is silent while the ui bus keeps playing', async () => {
  const r = await run(page, 'bus');
  expect(r.name).toBe('bus');
  if (r.name !== 'bus') return;
  expect(r.failures).toEqual([]);
  expect(r.sfxMutedRms).toBeLessThan(1e-5);
  expect(r.uiRms).toBeGreaterThan(1e-3);
});

test('limiter: 32 simultaneous loud voices peak at ≤ 1.0', async ({ browserName }, info) => {
  const r = await run(page, 'limiter');
  expect(r.name).toBe('limiter');
  if (r.name !== 'limiter') return;
  info.annotations.push({ type: 'limiter', description: `${browserName}: peak ${r.peak}, without clip ${r.peakBeforeClip} (unlimited ${r.unlimitedPeak}), reduction ${r.limiterReductionDb} dB; bare compressor (makeup +${r.makeupGainDb} dB uncompensated) ${r.peakUncompensated}` });
  expect(r.failures).toEqual([]);
  expect(r.voices).toBe(32);
  expect(r.peak).toBeLessThanOrEqual(1.0);
  expect(r.peakBeforeClip).toBeLessThanOrEqual(1.0);
});

test('loop: bld_pour_loop loops between the manifest loop points without a seam', async ({ browserName }, info) => {
  const r = await run(page, 'loop');
  expect(r.name).toBe('loop');
  if (r.name !== 'loop') return;
  info.annotations.push({ type: 'loop', description: `${browserName}: seams ${r.seams.map((s) => s.ratio).join(' / ')} × median, pass correlation ${r.passCorrelation}; 44.1 kHz (buffer ${r.resampled.bufferRate} Hz, ${r.resampled.decodePath}): seams ${r.resampled.seams.map((s) => s.ratio).join(' / ')} × median, pass correlation ${r.resampled.passCorrelation} (lag error ${r.resampled.lagError})` });
  expect(r.failures).toEqual([]);
  expect(r.passesRendered).toBeGreaterThanOrEqual(2);
  for (const s of r.seams) expect(s.ratio).toBeLessThanOrEqual(3);
  for (const s of r.resampled.seams) expect(s.ratio).toBeLessThanOrEqual(3);
});

test('limits: 200 shots in 1 s never exceed 32 voices or a category limit', async ({ browserName }, info) => {
  const r = await run(page, 'limits');
  expect(r.name).toBe('limits');
  if (r.name !== 'limits') return;
  info.annotations.push({ type: 'limits', description: `${browserName}: max ${r.maxVoices} voices, ${JSON.stringify(r.maxByCategory)}, played ${r.played}, stolen ${r.stolen}, dropped ${r.droppedTotal}` });
  expect(r.failures).toEqual([]);
  expect(r.maxVoices).toBeLessThanOrEqual(32);
  for (const [c, n] of Object.entries(r.maxByCategory)) expect(n, c).toBeLessThanOrEqual(r.categoryLimits[c]!);
  expect(r.droppedTotal).toBeGreaterThan(0);
});
