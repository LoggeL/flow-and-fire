import { describe, expect, it } from 'vitest';
import { fromHalf, toHalf } from '../../src/core/half.ts';
import {
  L_COS_SPREAD,
  L_COS_SPREAD_INNER,
  L_DELAY_MAX,
  L_DELAY_MIN,
  L_DRAG,
  L_EMIT_RADIUS,
  L_GRAVITY,
  L_LIFE_MAX,
  L_LIFE_MIN,
  L_LUT_ROW,
  L_MOTION,
  L_ORIENT,
  L_PRIORITY,
  L_SHAPE,
  L_SIZE_JITTER,
  L_SPEED_MAX,
  L_SPEED_MIN,
  L_SPIN_MAX,
  L_SPIN_MIN,
  L_STREAM_WAVE,
  L_STREAM_WAVES,
  L_STRETCH,
  L_TINT,
  LAYER_STRIDE,
  compileEffectLibrary,
} from '../../src/effects/compile.ts';
import { sampleBaked } from '../../src/effects/curves.ts';
import { FxRng } from '../../src/effects/random.ts';
import { createParticleState, evalParticle, particleRandoms } from '../../src/effects/reference.ts';
import { VARKAN_EFFECTS } from '../../src/effects/varkan.ts';
import {
  GROUND_LIFT_WU,
  PARTICLE_FS,
  PARTICLE_RECORD_STRIDE,
  PARTICLE_STREAM_LAYOUT,
  PARTICLE_VS,
  STREAK_SECONDS,
  createMirrorState,
  createParticleRecord,
  mirrorCorner,
  mirrorLut,
  mirrorParticle,
  readRecord,
  recordViews,
  writeRecord,
} from '../../src/particles/index.ts';
import type { ParticleRecord } from '../../src/particles/index.ts';

const lib = compileEffectLibrary(VARKAN_EFFECTS);

function halfDecode(x: number): number {
  return fromHalf(toHalf(x));
}

describe('particle record layout', () => {
  it('is 32 bytes with the documented attribute offsets', () => {
    expect(PARTICLE_RECORD_STRIDE).toBe(32);
    expect(PARTICLE_STREAM_LAYOUT.stride).toBe(32);
    expect(PARTICLE_STREAM_LAYOUT.stepMode).toBe('instance');
    expect(PARTICLE_STREAM_LAYOUT.attributes.map((a) => [a.location, a.offset, a.format.scalar, a.format.count, a.format.mode])).toEqual([
      [0, 0, 'i32', 3, 'int'],
      [1, 12, 'f32', 1, 'float'],
      [2, 16, 'u16', 4, 'int'],
      [3, 24, 'u16', 2, 'int'],
      [4, 28, 'u8', 4, 'norm'],
    ]);
    expect(PARTICLE_VS).toContain('layout(location = 0) in ivec3 a_origin');
    expect(PARTICLE_VS).toContain('layout(location = 2) in uvec4 a_vec');
    expect(PARTICLE_VS).toContain('layout(location = 3) in uvec2 a_layerSeed');
  });

  it('write/read roundtrip', () => {
    const v = recordViews(new ArrayBuffer(4 * PARTICLE_RECORD_STRIDE));
    writeRecord(v, 2, -123456, 7, 99999, 1234.5, toHalf(0.5), toHalf(-1), toHalf(20), toHalf(1.25), 76, 0x1abcd, 0xa1b2c3);
    const r = readRecord(v, 2);
    expect(r).toEqual({ originRaw: [-123456, 7, 99999], t0: 1234.5, vec: [0.5, -1, 20, 1.25], layer: 76, seed: 0xabcd, tint: 0xa1b2c3 });
    expect(readRecord(v, 1)).toEqual({ ...createParticleRecord(), tint: 0 });
  });

  it('layer texels read by the shader match the compiled layer table offsets', () => {
    // texel i = floats 4i..4i+3 of the layer record (see the L0..L7 comments in PARTICLE_VS).
    expect([L_LIFE_MIN, L_LIFE_MAX, L_SPEED_MIN, L_SPEED_MAX]).toEqual([0, 1, 2, 3]);
    expect([L_COS_SPREAD, L_GRAVITY, L_DRAG, L_EMIT_RADIUS]).toEqual([4, 5, 6, 7]);
    expect([L_DELAY_MIN, L_DELAY_MAX, L_SPIN_MIN, L_SPIN_MAX]).toEqual([8, 9, 10, 11]);
    expect([L_SIZE_JITTER, L_STRETCH, L_SHAPE, L_ORIENT]).toEqual([12, 13, 14, 15]);
    expect([L_MOTION, L_PRIORITY, L_TINT, L_LUT_ROW]).toEqual([16, 17, 18, 19]);
    expect([L_STREAM_WAVE, L_STREAM_WAVES]).toEqual([20, 21]);
    expect(L_COS_SPREAD_INNER).toBe(28);
    expect(LAYER_STRIDE).toBe(32);
    // Hash constants of random.ts in the shader.
    for (const c of ['0x85EBCA6Bu', '0xC2B2AE35u', '0x9E3779B9u', '0x7F4A7C15u', '0x94D049BBu']) expect(PARTICLE_VS).toContain(c);
    expect(PARTICLE_VS).toContain(`${STREAK_SECONDS}`);
    expect(PARTICLE_VS).toContain(`${GROUND_LIFT_WU}`);
    // Premultiplied output with alpha·blend.
    expect(PARTICLE_FS).toContain('alpha * clamp(v_misc.x, 0.0, 1.0)');
  });
});

describe('vs-mirror parity with evalParticle', () => {
  it('10,000 random records: same liveness, position within 1e-3 WU, same size/color/blend', () => {
    const rng = new FxRng(20260929);
    const rec: ParticleRecord = createParticleRecord();
    const m = createMirrorState();
    const ref = createParticleState();
    const rnd = particleRandoms(0, 0);
    let alive = 0;
    let maxErr = 0;
    let streams = 0;
    for (let i = 0; i < 10_000; i++) {
      const layer = rng.int(0, lib.layerCount - 1);
      const o = layer * LAYER_STRIDE;
      const seed = rng.int(0, 0xffff);
      const origin: [number, number, number] = [rng.int(-(1 << 24), 1 << 24), rng.int(-(1 << 20), 1 << 22), rng.int(-(1 << 24), 1 << 24)];
      const scale = halfDecode(rng.range(0.4, 2.5));
      const isStream = lib.layers[o + L_MOTION]! > 0.5;
      let dir: [number, number, number];
      if (isStream) {
        streams++;
        dir = [halfDecode(rng.range(-30, 30)), halfDecode(rng.range(-5, 10)), halfDecode(rng.range(-30, 30))];
      } else {
        const u = rng.unitVector();
        dir = [halfDecode(u[0]), halfDecode(u[1]), halfDecode(u[2])];
      }
      particleRandoms(seed, layer, rnd);
      const L = lib.layers;
      const life = L[o + L_LIFE_MIN]! + (L[o + L_LIFE_MAX]! - L[o + L_LIFE_MIN]!) * rnd.uLife;
      const delay = L[o + L_DELAY_MIN]! + (L[o + L_DELAY_MAX]! - L[o + L_DELAY_MIN]!) * rnd.uDelay;
      const wanted = rng.float01() < 0.9 ? delay + rng.float01() * life : rng.range(0, 45);
      // Dyadic times (multiples of 1/1024 s) are exact in f32: no time quantization in the comparison.
      const age = Math.round(wanted * 1024) / 1024;
      const t0 = rng.int(0, 4096 * 1024 - 1) / 1024;
      const fxTime = (t0 + age) % 4096;
      rec.originRaw = origin;
      rec.t0 = t0;
      rec.vec = [dir[0], dir[1], dir[2], scale];
      rec.layer = layer;
      rec.seed = seed;
      rec.tint = rng.int(0, 0xffffff);
      mirrorParticle(lib.layers, lib.lut, rec, fxTime, m);
      expect(m.ageS).toBe(age);
      const originWu = [origin[0] / 4096, origin[1] / 4096, origin[2] / 4096];
      let spawnDir: number[] | undefined;
      let targetWu: number[] | undefined;
      if (isStream) {
        targetWu = [originWu[0]! + dir[0], originWu[1]! + dir[1], originWu[2]! + dir[2]];
      } else {
        const l = Math.hypot(dir[0], dir[1], dir[2]);
        spawnDir = [dir[0] / l, dir[1] / l, dir[2] / l];
      }
      evalParticle(
        lib,
        layer,
        {
          originWu,
          seed,
          scale,
          tint: rec.tint,
          ...(spawnDir !== undefined ? { dir: spawnDir } : {}),
          ...(targetWu !== undefined ? { targetWu } : {}),
        },
        age,
        ref,
      );
      const nearEdge = Math.abs(age - delay) < 1e-4 || Math.abs(age - delay - life) < 1e-4;
      if (!nearEdge) expect(m.alive).toBe(ref.alive);
      if (!m.alive || !ref.alive) continue;
      alive++;
      for (let c = 0; c < 3; c++) {
        const e = Math.abs(m.posWu[c]! - ref.posWu[c]!);
        maxErr = Math.max(maxErr, e);
        if (e > 1e-3) throw new Error(`case ${i} layer ${layer} axis ${c}: mirror ${m.posWu[c]} vs ref ${ref.posWu[c]} (age ${age})`);
      }
      expect(Math.abs(m.sizeWu - ref.sizeWu)).toBeLessThanOrEqual(1e-4 * Math.max(1, ref.sizeWu));
      for (let c = 0; c < 4; c++) expect(Math.abs(m.color[c]! - ref.color[c]!)).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(ref.color[c]!)));
      expect(Math.abs(m.blend - ref.blend)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(m.rotation - ref.rotation)).toBeLessThanOrEqual(1e-3);
      for (let c = 0; c < 3; c++) expect(Math.abs(m.velWu[c]! - ref.velWu[c]!)).toBeLessThanOrEqual(2e-3 * Math.max(1, Math.abs(ref.velWu[c]!)));
    }
    expect(alive).toBeGreaterThan(8000);
    expect(streams).toBeGreaterThan(100);
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('handles the FX time wrap (t0 just before 4096 s, now just after 0)', () => {
    const layer = lib.effects[lib.indexOf('varkan:explosion_medium')]!.firstLayer + 1;
    const rec = createParticleRecord();
    rec.layer = layer;
    rec.seed = 42;
    rec.vec = [0, 1, 0, 1];
    rec.t0 = 4096 - 0.125;
    const m = mirrorParticle(lib.layers, lib.lut, rec, 0.125);
    expect(m.ageS).toBe(0.25);
    const ref = evalParticle(lib, layer, { originWu: [0, 0, 0], seed: 42 }, 0.25);
    expect(m.alive).toBe(ref.alive);
    expect(m.posWu[1]).toBeCloseTo(ref.posWu[1], 4);
  });

  it('mirrorLut equals sampleBaked', () => {
    const rng = new FxRng(5);
    for (let i = 0; i < 2000; i++) {
      const row = rng.int(0, lib.lut.height - 1);
      const a = rng.float01();
      const ch = rng.int(0, 3);
      const ref = sampleBaked(lib.lut.data, row * lib.lut.width * 4, lib.lut.width, 4, a, ch);
      expect(Math.abs(mirrorLut(lib.lut, row, a, ch) - ref)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(ref)));
    }
  });
});

describe('vs-mirror quad corners', () => {
  const axes = { right: [1, 0, 0], up: [0, 0.6, -0.8], fwd: [0, -0.8, -0.6] };
  const corner: [number, number, number] = [0, 0, 0];

  function aliveState(effect: string, layerOffset: number, age: number) {
    const rec = createParticleRecord();
    rec.layer = lib.effects[lib.indexOf(effect)]!.firstLayer + layerOffset;
    rec.seed = 7;
    rec.vec = [0, 1, 0, 1];
    rec.originRaw = [4096 * 10, 4096 * 2, 4096 * -5];
    const s = mirrorParticle(lib.layers, lib.lut, rec, age);
    expect(s.alive).toBe(true);
    return s;
  }

  it('billboard: corners at size/2·√2 from the centre in the camera plane', () => {
    const s = aliveState('varkan:explosion_medium', 1, 0.2); // fireball, billboard
    expect(s.orient).toBe(0);
    for (const [cx, cy] of [
      [-1, -1],
      [1, 1],
    ] as const) {
      mirrorCorner(s, axes, cx, cy, corner);
      const d = [corner[0] - s.posWu[0], corner[1] - s.posWu[1], corner[2] - s.posWu[2]];
      expect(Math.hypot(d[0]!, d[1]!, d[2]!)).toBeCloseTo((s.sizeWu / 2) * Math.SQRT2, 5);
      expect(d[0]! * axes.fwd[0]! + d[1]! * axes.fwd[1]! + d[2]! * axes.fwd[2]!).toBeCloseTo(0, 6);
    }
  });

  it('ground: flat on XZ, lifted by GROUND_LIFT_WU', () => {
    const s = aliveState('varkan:acu_explosion', 2, 0.3); // shockwave, ground
    expect(s.orient).toBe(2);
    mirrorCorner(s, axes, 1, -1, corner);
    expect(corner[1]).toBeCloseTo(s.posWu[1] + GROUND_LIFT_WU, 6);
    expect(Math.hypot(corner[0] - s.posWu[0], corner[2] - s.posWu[2])).toBeCloseTo((s.sizeWu / 2) * Math.SQRT2, 4);
  });

  it('velocity: head edge at the particle, streak trails behind along the screen velocity', () => {
    const s = aliveState('varkan:explosion_medium', 4, 0.1); // sparks, velocity
    expect(s.orient).toBe(1);
    const head: [number, number, number] = [0, 0, 0];
    const tail: [number, number, number] = [0, 0, 0];
    mirrorCorner(s, axes, 1, 0, head);
    mirrorCorner(s, axes, -1, 0, tail);
    const len = Math.hypot(head[0] - tail[0], head[1] - tail[1], head[2] - tail[2]);
    const v = s.velWu;
    const dv = v[0] * axes.fwd[0]! + v[1] * axes.fwd[1]! + v[2] * axes.fwd[2]!;
    const sp = Math.hypot(v[0] - axes.fwd[0]! * dv, v[1] - axes.fwd[1]! * dv, v[2] - axes.fwd[2]! * dv);
    expect(len).toBeCloseTo(s.sizeWu + s.stretch * sp * STREAK_SECONDS, 5);
    // The head edge lies size/2 ahead of the particle position.
    expect(Math.hypot(head[0] - s.posWu[0], head[1] - s.posWu[1], head[2] - s.posWu[2])).toBeCloseTo(s.sizeWu / 2, 5);
  });
});
