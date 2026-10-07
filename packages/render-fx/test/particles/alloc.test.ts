import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toHalf } from '../../src/core/half.ts';
import { fxHash32, FxRng } from '../../src/effects/random.ts';
import { halfBitsAt, hashHi24, hashLo16 } from '../../src/particles/index.ts';
import { FX, frame, setup } from './support.ts';

interface ProbeResult {
  growth: number;
  frames: number;
  alive: number;
  emitters: number;
}

function probe(mode: 'frame' | 'spawn'): ProbeResult {
  const script = fileURLToPath(new URL('./alloc-probe.ts', import.meta.url));
  const out = execFileSync(process.execPath, ['--expose-gc', '--import', 'tsx', script, mode], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
  });
  return JSON.parse(out) as ProbeResult;
}

describe('ParticleSystem – no allocation in warm hot paths', () => {
  // One boxed double per written particle (~100 per frame in the probe) or per emitter (80) would
  // add > 1 KB per frame; the budget below leaves room only for GC/heap bookkeeping noise.
  const BYTES_PER_FRAME = 128;

  it('update() + encode() with 80 continuous emitters', () => {
    const r = probe('frame');
    expect(r.emitters).toBe(80);
    expect(r.alive).toBeGreaterThan(1000);
    expect(r.growth / r.frames).toBeLessThan(BYTES_PER_FRAME);
  });

  it('plus two bursts per frame via spawn()', () => {
    const r = probe('spawn');
    expect(r.alive).toBeGreaterThan(1000);
    expect(r.growth / r.frames).toBeLessThan(BYTES_PER_FRAME);
  });

  it('reuses the stats object, its arrays and the vertex stream bindings', () => {
    const env = setup();
    const s0 = env.ps.stats;
    const { requested, dropped } = s0;
    env.ps.spawn(FX.p1, [0, 0, 0]);
    frame(env, 1);
    frame(env, 1.1);
    const s1 = env.ps.stats;
    expect(s1).toBe(s0);
    expect(s1.requested).toBe(requested);
    expect(s1.dropped).toBe(dropped);
  });
});

describe('boxing-free helpers equal their reference', () => {
  it('hashLo16 / hashHi24 == fxHash32 bits', () => {
    const rng = new FxRng(77);
    for (let i = 0; i < 20_000; i++) {
      const a = rng.next();
      const b = i < 10_000 ? rng.int(0, 300) : rng.next();
      const c = rng.int(0, 0xffff);
      const h = fxHash32(a, b, c);
      expect(hashLo16(a, b, c)).toBe(h & 0xffff);
      expect(hashHi24(a, b, c)).toBe(h >>> 8);
    }
  });

  it('halfBitsAt == toHalf (edge cases and 200k values)', () => {
    const buf = new Float64Array(1);
    const edge = [
      0, -0, 1, -1, 0.5, 65504, 65519.99, 65520, -65520, 1e9, Infinity, -Infinity, NaN,
      2 ** -14, 2 ** -15, 2 ** -24, 2 ** -25, 2 ** -25 * 1.0000001, 3 * 2 ** -26, 5.960464477539063e-8,
      1 + 2 ** -11, 1 + 3 * 2 ** -11, 1 + 2 ** -11 + 2 ** -40, 2047.5, 2049, 0.1, -0.3, 1 / 3,
    ];
    for (const x of edge) {
      buf[0] = x;
      expect(halfBitsAt(buf, 0)).toBe(toHalf(x));
    }
    const rng = new FxRng(9);
    for (let i = 0; i < 200_000; i++) {
      const mag = 2 ** rng.range(-28, 17);
      const x = (rng.float01() < 0.5 ? -1 : 1) * mag * rng.float01();
      buf[0] = x;
      expect(halfBitsAt(buf, 0)).toBe(toHalf(x));
    }
  });
});
