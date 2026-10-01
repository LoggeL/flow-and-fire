import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fxHash32 } from '../../src/effects/random.ts';
import { CameraShake, MAX_SHAKES, MAX_SHAKE_ROLL_RAD, SHAKE_ROLL_PER_WU, shakeNoise } from '../../src/effects/shake.ts';

function peak(shake: CameraShake, t0: number, t1: number, target: number[]): number {
  let m = 0;
  for (let t = t0; t < t1; t += 1 / 240) {
    const s = shake.sample(t, target);
    m = Math.max(m, Math.hypot(s.dx, s.dy, s.dz));
  }
  return m;
}

describe('shakeNoise', () => {
  it('is smooth, bounded and deterministic', () => {
    let prev = shakeNoise(3, 0);
    for (let x = 0; x < 20; x += 0.01) {
      const v = shakeNoise(3, x);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      expect(shakeNoise(3, x)).toBe(v);
      prev = v;
    }
    expect(shakeNoise(3, 1.5)).not.toBe(shakeNoise(4, 1.5));
  });
});

describe('CameraShake', () => {
  it('decays quadratically over its duration and ends', () => {
    const s = new CameraShake();
    s.add([0, 0, 0], 2, 2, 100, 8, 0);
    const early = peak(s, 0, 0.4, [0, 0, 0]);
    const late = peak(s, 1.4, 1.8, [0, 0, 0]);
    expect(early).toBeGreaterThan(0.5);
    expect(early).toBeLessThanOrEqual(2 * Math.sqrt(3));
    expect(late).toBeLessThan(early * 0.25);
    const end = s.sample(2.01, [0, 0, 0]);
    expect(end.active).toBe(false);
    expect(end.dx).toBe(0);
    expect(s.activeCount).toBe(0);
  });

  it('sample() equals the documented formula with shakeNoise', () => {
    const s = new CameraShake();
    s.add([2, 0, 3], 1.5, 2, 100, 7, 0.25);
    const seed = fxHash32(0x5a4e, 0) & 0x3fffffff; // first source: serial 0
    for (const t of [0.25, 0.4, 0.9, 1.7]) {
      const age = t - 0.25;
      const k = 1 - age / 2;
      const fall = 1 - Math.hypot(1, 0, 1) / 100;
      const amp = 1.5 * k * k * fall * fall;
      const x = age * 7;
      const r = s.sample(t, [3, 0, 4]);
      expect(r.dx).toBeCloseTo(amp * shakeNoise(seed, x), 12);
      expect(r.dy).toBeCloseTo(amp * shakeNoise(seed + 1, x), 12);
      expect(r.dz).toBeCloseTo(amp * shakeNoise(seed + 2, x), 12);
      expect(r.rollRad).toBeCloseTo(amp * shakeNoise(seed + 3, x * 0.5) * SHAKE_ROLL_PER_WU, 12);
    }
  });

  it('falls off with distance and is zero outside the radius', () => {
    const s = new CameraShake();
    s.add([0, 0, 0], 2, 2, 100, 8, 0);
    const near = peak(s, 0, 0.5, [5, 0, 0]);
    const far = peak(s, 0, 0.5, [80, 0, 0]);
    const out = peak(s, 0, 0.5, [120, 0, 0]);
    expect(far).toBeLessThan(near * 0.2);
    expect(out).toBe(0);
    expect(s.sample(0.1, [120, 0, 0]).active).toBe(true);
  });

  it('is deterministic across instances and bounded in roll', () => {
    const a = new CameraShake();
    const b = new CameraShake();
    for (const s of [a, b]) {
      s.add([3, 0, 4], 3, 2.5, 150, 9, 1);
      s.addFromEffect({ shake: { amplitudeWu: 1, durationS: 1, radiusWu: 40, frequencyHz: 6 } }, [0, 0, 0], 1.2);
      s.addFromEffect({}, [0, 0, 0], 1.2);
      s.addFromEffect({ shake: null }, [0, 0, 0], 1.2);
    }
    expect(a.activeCount).toBe(2);
    for (let t = 1; t < 3; t += 0.05) {
      const sa = a.sample(t, [1, 0, 1]);
      const ra = [sa.dx, sa.dy, sa.dz, sa.rollRad];
      const sb = b.sample(t, [1, 0, 1]);
      expect([sb.dx, sb.dy, sb.dz, sb.rollRad]).toEqual(ra);
      expect(Math.abs(sa.rollRad)).toBeLessThanOrEqual(MAX_SHAKE_ROLL_RAD);
    }
  });

  it('keeps at most MAX_SHAKES sources, replacing the weakest', () => {
    const s = new CameraShake();
    for (let i = 0; i < MAX_SHAKES; i++) s.add([0, 0, 0], 1 + i * 0.01, 5, 100, 8, 0);
    expect(s.activeCount).toBe(MAX_SHAKES);
    s.add([0, 0, 0], 0.5, 5, 100, 8, 0); // weaker than all: ignored
    expect(s.activeCount).toBe(MAX_SHAKES);
    const before = peak(s, 0, 0.3, [0, 0, 0]);
    s.add([0, 0, 0], 50, 5, 100, 8, 0.3);
    expect(s.activeCount).toBe(MAX_SHAKES);
    expect(peak(s, 0.3, 0.6, [0, 0, 0])).toBeGreaterThan(before * 3);
    s.clear();
    expect(s.activeCount).toBe(0);
  });

  it('sample() returns the same object and does not allocate', () => {
    const s = new CameraShake();
    s.add([0, 0, 0], 2, 30, 100, 8, 0);
    const target = [1, 0, 1];
    const r0 = s.sample(0.1, target);
    for (let i = 0; i < 1000; i++) expect(s.sample(i * 0.001, target)).toBe(r0);
    // Heap growth of 500k warm calls, measured in a plain Node process (support/shake-alloc.ts);
    // one 16-byte allocation per call would add ≈ 8 MB.
    const script = fileURLToPath(new URL('./support/shake-alloc.ts', import.meta.url));
    const out = execFileSync(process.execPath, ['--expose-gc', '--import', 'tsx', script], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
    });
    const { growth } = JSON.parse(out) as { growth: number };
    expect(growth).toBeLessThan(200_000);
    expect(r0.active).toBe(true);
  });
});
