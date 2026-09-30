import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CameraSpatialModel, SPATIAL_PROFILES, zoomAttenuationDb, type SpatialProfile } from '../../src/spatial/index.ts';
import { SOUND_CATEGORIES, categoryIndex, type ListenerState, type SoundCategory, type SpatialResult } from '../../src/types.ts';

const W = categoryIndex('weapon');
const EXP = categoryIndex('explosion');
const SIG = categoryIndex('signature');

function listener(p: Partial<ListenerState> = {}): ListenerState {
  return { focusX: 100, focusZ: 100, height: 40, viewHalfWidth: 20, rightX: 1, rightZ: 0, ...p };
}

function model(l: ListenerState = listener()): CameraSpatialModel {
  const m = new CameraSpatialModel();
  m.setListener(l);
  return m;
}

const out: SpatialResult = { gain: -1, pan: -9 };

describe('CameraSpatialModel pan', () => {
  it('pans left / centre / right along the camera right vector (maxPan 0.8)', () => {
    const m = model();
    expect(m.spatialize(W, 80, 100, out)).toBe(true);
    expect(out.pan).toBeCloseTo(-0.8, 9);
    m.spatialize(W, 100, 100, out);
    expect(out.pan).toBe(0);
    m.spatialize(W, 110, 100, out);
    expect(out.pan).toBeCloseTo(0.4, 9);
    m.spatialize(W, 120, 100, out);
    expect(out.pan).toBeCloseTo(0.8, 9);
    // Pure depth offset (along the view direction) stays centred.
    m.spatialize(W, 100, 115, out);
    expect(out.pan).toBeCloseTo(0, 9);
    // Off-screen to the right: clamped at maxPan.
    m.spatialize(W, 140, 100, out);
    expect(out.pan).toBeCloseTo(0.8, 9);
  });

  it('follows a rotated camera (right vector not +x, not normalized input)', () => {
    // Camera turned 90°: screen right is world +z.
    const m = model(listener({ rightX: 0, rightZ: 3 }));
    m.spatialize(W, 100, 110, out);
    expect(out.pan).toBeCloseTo(0.4, 9);
    m.spatialize(W, 100, 90, out);
    expect(out.pan).toBeCloseTo(-0.4, 9);
    m.spatialize(W, 110, 100, out);
    expect(out.pan).toBeCloseTo(0, 9);
    // Turned 180°: +x is screen left.
    m.setListener(listener({ rightX: -1, rightZ: 0 }));
    m.spatialize(W, 110, 100, out);
    expect(out.pan).toBeCloseTo(-0.4, 9);
    // 45°: right = (1, 1)/√2.
    m.setListener(listener({ rightX: 1, rightZ: 1 }));
    m.spatialize(W, 110, 110, out);
    expect(out.pan).toBeCloseTo(0.8 * (Math.SQRT2 * 10) / 20, 9);
    expect(m.listener.rightX).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe('CameraSpatialModel distance and zoom', () => {
  it('is 0 dB on screen and falls monotonically off-screen', () => {
    const m = model();
    m.spatialize(W, 115, 110, out);
    expect(out.gain).toBe(1);
    let prev = 1;
    for (let d = 20; d <= 50; d += 0.5) {
      expect(m.spatialize(W, 100 + d, 100, out)).toBe(true);
      expect(out.gain).toBeLessThanOrEqual(prev);
      prev = out.gain;
    }
    expect(prev).toBeLessThan(0.12);
    // Formula check at r = 2: 1 / (1 + 1.5)².
    m.spatialize(W, 140, 100, out);
    expect(out.gain).toBeCloseTo(1 / 6.25, 12);
  });

  it('culls beyond the cutoff radius (per category)', () => {
    const m = model();
    expect(m.spatialize(W, 100 + 20 * 2.5 - 0.01, 100, out)).toBe(true);
    expect(m.spatialize(W, 100 + 20 * 2.5 + 0.01, 100, out)).toBe(false);
    expect(out.gain).toBe(0);
    // Explosions carry farther (cutoff 4).
    expect(m.spatialize(EXP, 100 + 20 * 3.5, 100, out)).toBe(true);
    expect(out.gain).toBeGreaterThan(0);
    expect(m.spatialize(EXP, 100, 100 + 20 * 4.2, out)).toBe(false);
    // NaN positions are inaudible.
    expect(m.spatialize(W, Number.NaN, 100, out)).toBe(false);
  });

  it('attenuates by zoom per profile: weapon strongly, explosion little, signature barely', () => {
    const m = model(listener({ height: 60 }));
    m.spatialize(W, 100, 100, out);
    expect(out.gain).toBe(1);
    // 8× the reference height of weapons (3 doublings): −18 dB.
    m.setListener(listener({ height: 480, viewHalfWidth: 200 }));
    expect(m.zoomDb(W)).toBeCloseTo(-18, 9);
    m.spatialize(W, 100, 100, out);
    const w = out.gain;
    m.spatialize(EXP, 100, 100, out);
    const e = out.gain;
    m.spatialize(SIG, 100, 100, out);
    const s = out.gain;
    expect(w).toBeCloseTo(Math.pow(10, -18 / 20), 9);
    expect(e).toBeCloseTo(Math.pow(10, (-3 * Math.log2(480 / 80)) / 20), 9);
    expect(w).toBeLessThan(e);
    expect(e).toBeLessThan(s);
    expect(20 * Math.log10(s)).toBeGreaterThan(-4);
    // Full strategic zoom: floors.
    m.setListener(listener({ height: 1400, viewHalfWidth: 600 }));
    expect(m.zoomDb(W)).toBeCloseTo(-6 * Math.log2(1400 / 60), 9);
    m.setListener(listener({ height: 2000, viewHalfWidth: 850 }));
    expect(m.zoomDb(W)).toBeCloseTo(-30, 9);
    expect(m.zoomDb(EXP)).toBeCloseTo(-12, 9);
    expect(m.zoomDb(SIG)).toBeCloseTo(-6, 9);
    expect(zoomAttenuationDb(SPATIAL_PROFILES.signature, 1e6)).toBe(-6);
  });

  it('leaves non-spatial categories untouched', () => {
    const m = model(listener({ height: 2000, viewHalfWidth: 800 }));
    for (const c of ['ui', 'ack', 'alert', 'music', 'ambience'] as const) {
      out.gain = -1;
      out.pan = -1;
      expect(m.spatialize(categoryIndex(c), 99999, -99999, out)).toBe(true);
      expect(out.gain).toBe(1);
      expect(out.pan).toBe(0);
      expect(m.zoomDb(categoryIndex(c))).toBe(0);
    }
    expect(m.spatialize(99, 1, 1, out)).toBe(true);
    expect(out.gain).toBe(1);
  });

  it('sanitizes degenerate listeners and rejects invalid profiles', () => {
    const m = model(listener({ viewHalfWidth: 0, rightX: 0, rightZ: 0, height: Number.NaN, focusX: Number.POSITIVE_INFINITY }));
    expect(m.listener.viewHalfWidth).toBeGreaterThan(0);
    expect(m.listener.rightX).toBe(1);
    expect(m.listener.height).toBe(0);
    expect(m.listener.focusX).toBe(0);
    expect(m.spatialize(W, 0, 100, out)).toBe(true);
    expect(m.spatialize(W, 0, 101, out)).toBe(false);
    expect(Number.isFinite(out.gain) && Number.isFinite(out.pan)).toBe(true);

    const bad = (patch: Partial<SpatialProfile>): Record<SoundCategory, SpatialProfile> => ({
      ...SPATIAL_PROFILES,
      weapon: { ...SPATIAL_PROFILES.weapon, ...patch },
    });
    expect(() => new CameraSpatialModel(bad({ maxPan: 1.5 }))).toThrow(RangeError);
    expect(() => new CameraSpatialModel(bad({ zoomDbPerDoubling: 3 }))).toThrow(/zoomDbPerDoubling/);
    expect(() => new CameraSpatialModel(bad({ cutoffRadius: 0.5 }))).toThrow(/cutoffRadius/);
    expect(() => new CameraSpatialModel(bad({ zoomRefHeight: 0 }))).toThrow(/zoomRefHeight/);
  });

  it('property: gain ∈ [0, 1], pan ∈ [−maxPan, maxPan], culled ⇒ gain 0', () => {
    const m = new CameraSpatialModel();
    const r: SpatialResult = { gain: 0, pan: 0 };
    const coord = fc.double({ min: -5000, max: 5000, noNaN: true });
    fc.assert(
      fc.property(
        coord,
        coord,
        fc.double({ min: 0, max: 3000, noNaN: true }),
        fc.double({ min: 0.01, max: 2000, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        coord,
        coord,
        fc.integer({ min: 0, max: SOUND_CATEGORIES.length - 1 }),
        (fx, fz, h, hw, yaw, x, z, ci) => {
          m.setListener({ focusX: fx, focusZ: fz, height: h, viewHalfWidth: hw, rightX: Math.cos(yaw), rightZ: Math.sin(yaw) });
          const audible = m.spatialize(ci, x, z, r);
          const maxPan = SPATIAL_PROFILES[SOUND_CATEGORIES[ci]!].maxPan;
          expect(r.gain).toBeGreaterThanOrEqual(0);
          expect(r.gain).toBeLessThanOrEqual(1);
          expect(Math.abs(r.pan)).toBeLessThanOrEqual(maxPan + 1e-12);
          if (!audible) expect(r.gain).toBe(0);
        },
      ),
      { numRuns: 5000 },
    );
  });

  it('does not allocate in spatialize', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    const m = model();
    const r: SpatialResult = { gain: 0, pan: 0 };
    let acc = 0;
    for (let i = 0; i < 20_000; i++) acc += m.spatialize(i % 15, (i * 7) % 90, (i * 13) % 90, r) ? r.gain : 0;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1_000_000; i++) acc += m.spatialize(i % 15, (i * 7) % 90, (i * 13) % 90, r) ? r.gain : 0;
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(acc).toBeGreaterThan(0);
    if (gc !== undefined) expect(grown).toBeLessThan(256 * 1024);
  });
});
