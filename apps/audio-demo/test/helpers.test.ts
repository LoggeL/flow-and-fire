/**
 * DOM-free helpers of the demo and the browser test bench: URL parameters, camera/listener
 * mapping, the timing ring and the signal measurements used by the offline cases.
 */

import { describe, expect, it } from 'vitest';
import { bestCorrelation, correlation, energy, median, peak, ratioDb, rms, seamCheck } from '../src/offline/analysis.ts';
import { Camera, MAX_HEIGHT, MIN_HEIGHT, TAN_HALF_FOV } from '../src/demo/camera.ts';
import { TimingRing } from '../src/demo/hook.ts';
import { DEFAULT_PARAMS, parseDemoParams } from '../src/demo/params.ts';

describe('parseDemoParams', () => {
  it('returns the defaults for an empty query', () => {
    expect(parseDemoParams('')).toEqual({ ...DEFAULT_PARAMS });
    expect(DEFAULT_PARAMS.shots).toBe(200);
  });

  it('reads and clamps all parameters', () => {
    expect(parseDemoParams('?shots=400&seconds=12.5&speed=2&seed=77&zoom=150&autostart=1')).toEqual({
      shots: 400,
      seconds: 12.5,
      speed: 2,
      seed: 77,
      zoom: 150,
      autostart: true,
    });
    const c = parseDemoParams('?shots=99999&speed=9&zoom=5&seconds=-3&seed=-1');
    expect(c.shots).toBe(2000);
    expect(c.speed).toBe(3);
    expect(c.zoom).toBe(MIN_HEIGHT);
    expect(c.seconds).toBeNull();
    expect(c.seed).toBe(0xffffffff);
    expect(parseDemoParams('?speed=0.1&zoom=1000').speed).toBe(0.25);
    expect(parseDemoParams('?zoom=1000').zoom).toBe(MAX_HEIGHT);
  });

  it('ignores garbage', () => {
    expect(parseDemoParams('?shots=abc&speed=&seed=NaN&autostart=yes')).toEqual({ ...DEFAULT_PARAMS });
  });
});

describe('Camera', () => {
  it('derives the listener from height, FOV and yaw', () => {
    const c = new Camera();
    c.set({ x: 100, z: 200, height: 60, yaw: 0 });
    const l = c.toListener();
    expect(l.focusX).toBe(100);
    expect(l.focusZ).toBe(200);
    expect(l.viewHalfWidth).toBeCloseTo(60 * TAN_HALF_FOV, 12);
    expect(l.rightX).toBeCloseTo(1, 12);
    expect(l.rightZ).toBeCloseTo(0, 12);
    c.set({ yaw: Math.PI / 2 });
    expect(c.toListener().rightX).toBeCloseTo(0, 12);
    expect(c.toListener().rightZ).toBeCloseTo(1, 12);
    expect(c.toListener()).toBe(l); // reused object
  });

  it('clamps the height to 20..400 WU', () => {
    const c = new Camera();
    c.zoomBy(100);
    expect(c.height).toBe(MAX_HEIGHT);
    c.zoomBy(0.0001);
    expect(c.height).toBe(MIN_HEIGHT);
  });

  it('maps screen right to the right vector, also when rotated', () => {
    const c = new Camera();
    const out: [number, number] = [0, 0];
    for (const yaw of [0, 0.7, Math.PI / 2, -2.5]) {
      c.set({ x: 256, z: 256, height: 100, yaw });
      // Centre → focus.
      c.screenToWorld(400, 300, 800, 600, out);
      expect(out[0]).toBeCloseTo(256, 9);
      expect(out[1]).toBeCloseTo(256, 9);
      // Right screen edge → focus + right · viewHalfWidth (exactly what the spatial model pans by).
      c.screenToWorld(800, 300, 800, 600, out);
      expect(out[0]).toBeCloseTo(256 + c.rightX * c.viewHalfWidth, 9);
      expect(out[1]).toBeCloseTo(256 + c.rightZ * c.viewHalfWidth, 9);
      // Panning by screen deltas moves the focus consistently with screenToWorld.
      c.screenToWorld(500, 250, 800, 600, out);
      const s = c.scale(800);
      c.panScreen(100 / s, -50 / s);
      expect(c.x).toBeCloseTo(out[0], 9);
      expect(c.z).toBeCloseTo(out[1], 9);
    }
  });

  it('flies smoothly to a jump target', () => {
    const c = new Camera();
    c.set({ x: 0, z: 0 });
    c.dirty = false;
    c.flyTo(300, 100, 1000);
    expect(c.flying).toBe(true);
    c.tick(1000 + 100);
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(300);
    expect(c.dirty).toBe(true);
    c.tick(1000 + 10_000);
    expect(c.x).toBe(300);
    expect(c.z).toBe(100);
    expect(c.flying).toBe(false);
  });
});

describe('TimingRing', () => {
  it('computes nearest-rank percentiles', () => {
    const r = new TimingRing(1024);
    for (let i = 1; i <= 100; i++) r.push(i / 100);
    const s = r.stats();
    expect(s).toEqual({ samples: 100, p50: 0.5, p95: 0.95, p99: 0.99, max: 1 });
    r.clear();
    expect(r.stats().samples).toBe(0);
  });

  it('keeps the newest half when full', () => {
    const r = new TimingRing(8);
    for (let i = 0; i < 20; i++) r.push(i);
    expect(r.count).toBeLessThanOrEqual(8);
    expect(r.stats().max).toBe(19);
    expect(r.stats().p50).toBeGreaterThan(10);
  });
});

describe('signal analysis', () => {
  const sine = (n: number, f: number, a = 1, phase = 0): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * i + phase));

  it('rms / peak / energy / ratioDb', () => {
    const s = sine(48_000, 1 / 48);
    expect(rms([s])).toBeCloseTo(Math.SQRT1_2, 3);
    expect(peak([s])).toBeCloseTo(1, 3);
    expect(energy(s)).toBeCloseTo(24_000, -1);
    expect(rms([new Float32Array(10)])).toBe(0);
    expect(rms([s], 10, 10)).toBe(0);
    expect(ratioDb(100, 1)).toBeCloseTo(20, 9);
    expect(ratioDb(0, 0)).toBe(0);
    expect(Number.isFinite(ratioDb(1, 0))).toBe(true);
  });

  it('median and correlation', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
    const a = sine(4800, 1 / 37);
    expect(correlation(a, a)).toBeCloseTo(1, 9);
    expect(correlation(a, Float32Array.from(a, (v) => -v))).toBeCloseTo(-1, 9);
    const shifted = new Float32Array(4800);
    shifted.set(a.subarray(0, 4790), 10);
    const best = bestCorrelation(a, shifted, 20);
    expect(best.lag).toBe(10);
    expect(best.corr).toBeCloseTo(1, 6);
    expect(Number.isNaN(correlation(new Float32Array(10), a))).toBe(true);
  });

  it('seamCheck detects a discontinuity against the local activity', () => {
    const smooth = sine(2000, 1 / 100, 0.5);
    const clean = seamCheck([smooth], 1000, 240);
    expect(clean.ratio).toBeLessThan(3);
    const broken = Float32Array.from(smooth);
    for (let i = 1000; i < 2000; i++) broken[i] = broken[i]! + 0.4;
    expect(seamCheck([broken], 1000, 240).ratio).toBeGreaterThan(3);
  });
});

describe('compressorMakeupDb', () => {
  it('follows the Web Audio makeup-gain formula (1 / fullRangeGain)^0.6', async () => {
    const { compressorMakeupDb } = await import('../src/offline/cases.ts');
    // Mixer limiter: threshold −3 dB, ratio 20 → full-range gain −2.85 dB → makeup +1.71 dB.
    expect(compressorMakeupDb(-3, 20)).toBeCloseTo(1.71, 9);
    expect(compressorMakeupDb(-24, 12)).toBeCloseTo(0.6 * (24 - 2), 9);
    expect(compressorMakeupDb(0, 20)).toBe(0);
  });
});
