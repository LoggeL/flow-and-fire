import { describe, expect, it } from 'vitest';
import {
  ICOSPHERE_MAX_SUBDIVISIONS,
  SHIELD_OFF_CENTER,
  SHIELD_OFF_COLOR,
  SHIELD_OFF_PARAMS,
  SHIELD_OFF_RADIUS,
  SHIELD_OFF_RIPPLE_DIR,
  SHIELD_OFF_RIPPLE_STR,
  SHIELD_OFF_RIPPLE_T0,
  SHIELD_RIPPLE_LIFE_S,
  SHIELD_STRIDE,
  ShieldPass,
  createIcosphere,
  fromHalf,
  icosphereTriangleCount,
  icosphereVertexCount,
  shieldRadiusScale,
  shieldRippleEnergy,
  wrapFxTime,
} from '../../src/index.ts';
import type { ShieldState } from '../../src/index.ts';
import { encodeOnce, fakeFx } from '../trails/support.ts';

const W = 4096;

function state(x: number, z: number, r = 10, hp = 1, up = 1): ShieldState {
  return { centerRaw: [x * W, 0, z * W], radiusWu: r, color: [0.3, 0.7, 1.2], hpFrac: hp, upFrac: up };
}

function rec(pass: ShieldPass, i: number) {
  const ib = pass.instances;
  const b = i * SHIELD_STRIDE;
  const h = (o: number): number => fromHalf(ib.u16[(b + o) >> 1]!);
  return {
    center: [...ib.i32.subarray((b + SHIELD_OFF_CENTER) >> 2, ((b + SHIELD_OFF_CENTER) >> 2) + 3)],
    radius: ib.f32[(b + SHIELD_OFF_RADIUS) >> 2]!,
    color: [h(SHIELD_OFF_COLOR), h(SHIELD_OFF_COLOR + 2), h(SHIELD_OFF_COLOR + 4)],
    hp: h(SHIELD_OFF_COLOR + 6),
    up: h(SHIELD_OFF_PARAMS),
    t0: [0, 1, 2, 3].map((k) => ib.f32[((b + SHIELD_OFF_RIPPLE_T0) >> 2) + k]!),
    str: [0, 1, 2, 3].map((k) => h(SHIELD_OFF_RIPPLE_STR + k * 2)),
    dir: [0, 1, 2, 3].map((k) => [0, 1, 2].map((c) => ib.i16[((b + SHIELD_OFF_RIPPLE_DIR) >> 1) + k * 4 + c]! / 32767)),
  };
}

describe('createIcosphere', () => {
  it('has 10·4ⁿ+2 unit vertices, 20·4ⁿ outward (CCW) triangles, u16 indices', () => {
    for (let n = 0; n <= 4; n++) {
      const s = createIcosphere(n);
      expect(s.vertexCount).toBe(icosphereVertexCount(n));
      expect(s.triangleCount).toBe(icosphereTriangleCount(n));
      expect(s.positions.length).toBe(s.vertexCount * 3);
      expect(s.indices.length).toBe(s.triangleCount * 3);
      expect(s.indices).toBeInstanceOf(Uint16Array);
      for (let v = 0; v < s.vertexCount; v++) {
        const l = Math.hypot(s.positions[v * 3]!, s.positions[v * 3 + 1]!, s.positions[v * 3 + 2]!);
        expect(Math.abs(l - 1)).toBeLessThan(1e-6);
      }
      const p = (i: number): number[] => [s.positions[i * 3]!, s.positions[i * 3 + 1]!, s.positions[i * 3 + 2]!];
      let maxIdx = 0;
      for (let t = 0; t < s.triangleCount; t++) {
        const a = p(s.indices[t * 3]!);
        const b = p(s.indices[t * 3 + 1]!);
        const c = p(s.indices[t * 3 + 2]!);
        const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
        const ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
        const nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
        expect(nx * a[0]! + ny * a[1]! + nz * a[2]!).toBeGreaterThan(0);
        maxIdx = Math.max(maxIdx, s.indices[t * 3]!, s.indices[t * 3 + 1]!, s.indices[t * 3 + 2]!);
      }
      expect(maxIdx).toBe(s.vertexCount - 1);
    }
    expect(createIcosphere(3).vertexCount).toBe(642);
    expect(icosphereVertexCount(ICOSPHERE_MAX_SUBDIVISIONS)).toBeLessThanOrEqual(65536);
    expect(() => createIcosphere(ICOSPHERE_MAX_SUBDIVISIONS + 1)).toThrow(RangeError);
    expect(() => createIcosphere(-1)).toThrow();
  });
});

describe('ShieldPass', () => {
  it('packs set() into the record (centre, radius, color, hp, up) and draws once', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings, { capacity: 8 });
    pass.set(42, state(100, 50, 12, 0.25, 0.5));
    const r = rec(pass, 0);
    expect(r.center).toEqual([100 * W, 0, 50 * W]);
    expect(r.radius).toBe(12);
    expect(r.color[0]).toBeCloseTo(0.3, 3);
    expect(r.color[2]).toBeCloseTo(1.2, 3);
    expect(r.hp).toBe(0.25);
    expect(r.up).toBe(0.5);
    expect(r.str).toEqual([0, 0, 0, 0]);
    const e = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(e.draws).toBe(1);
    expect(e.glDraws.length).toBe(1);
    expect(e.glDraws[0]!.name).toBe('drawElementsInstanced');
    expect(e.glDraws[0]!.args[1]).toBe(pass.indexCount);
    expect(e.glDraws[0]!.args[2]).toBe(0x1403); // UNSIGNED_SHORT
    expect(e.glDraws[0]!.args[4]).toBe(1);
    expect(pass.indexCount).toBe(1280 * 3);
    // Clean frame: no re-upload, still one draw.
    const e2 = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(e2.writes.length).toBe(0);
    expect(e2.draws).toBe(1);
    pass.destroy();
  });

  it('20 shields → one draw with 20 instances; capacity overflow is rejected', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings, { capacity: 20 });
    for (let i = 0; i < 20; i++) expect(pass.set(1000 + i, state(i * 30, 0))).toBe(true);
    expect(pass.set(5000, state(0, 0))).toBe(false);
    expect(pass.stats.rejected).toBe(1);
    expect(pass.set(1003, state(1, 1))).toBe(true); // update of an existing id still works
    const e = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(e.glDraws.length).toBe(1);
    expect(e.glDraws[0]!.args[4]).toBe(20);
    expect(pass.stats.uploadBytes).toBe(20 * SHIELD_STRIDE);
    pass.destroy();
  });

  it('keeps the relative order stable across set/remove', () => {
    const { dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings);
    const ids = [7, 3, 11, 5, 9];
    ids.forEach((id, i) => pass.set(id, state(i + 1, 0)));
    pass.hit(5, [4 * W, 10 * W, 0], 1);
    expect(pass.remove(3)).toBe(true);
    expect(pass.remove(3)).toBe(false);
    expect([7, 11, 5, 9].map((id) => pass.indexOf(id))).toEqual([0, 1, 2, 3]);
    expect(pass.indexOf(3)).toBe(-1);
    // Records moved with their shields (x = order of creation), including the ripple of id 5.
    expect([0, 1, 2, 3].map((i) => rec(pass, i).center[0]! / W)).toEqual([1, 3, 4, 5]);
    expect(rec(pass, 2).str[0]).toBe(1);
    // Update keeps the place; a new id appends.
    pass.set(11, state(33, 0));
    pass.set(1, state(99, 0));
    expect(pass.indexOf(11)).toBe(1);
    expect(pass.indexOf(1)).toBe(4);
    expect(rec(pass, 1).center[0]! / W).toBe(33);
    pass.remove(9);
    pass.remove(7);
    expect([11, 5, 1].map((id) => pass.indexOf(id))).toEqual([0, 1, 2]);
    expect(pass.count).toBe(3);
    // A re-added id starts without ripples.
    pass.remove(5);
    pass.set(5, state(4, 0));
    expect(rec(pass, pass.indexOf(5)).str).toEqual([0, 0, 0, 0]);
    pass.destroy();
  });

  it('hit writes direction (snorm), wrapped t0 and strength; 4 simultaneous hits use 4 slots', () => {
    const { dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings);
    pass.set(1, state(10, 10, 10));
    const now = 5000.25; // > FX_TIME_WRAP_S → wrapped in the record
    const pts: number[][] = [
      [20 * W, 0, 10 * W],
      [10 * W, 10 * W, 10 * W],
      [0, 0, 10 * W],
      [10 * W, 0, 20 * W],
    ];
    const slots = pts.map((p) => pass.hit(1, p, now, 0.75));
    expect(new Set(slots).size).toBe(4);
    const r = rec(pass, 0);
    expect(r.t0).toEqual([0, 1, 2, 3].map(() => Math.fround(wrapFxTime(now))));
    expect(r.str).toEqual([0.75, 0.75, 0.75, 0.75]);
    const expectDirs = [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, 1],
    ];
    slots.forEach((s, k) => {
      for (let c = 0; c < 3; c++) expect(r.dir[s]![c]).toBeCloseTo(expectDirs[k]![c]!, 4);
    });
    pass.update(now);
    expect(pass.stats.ripplesActive).toBe(4);
    // Hit exactly at the centre → default direction +y, no NaN.
    pass.set(2, state(50, 50));
    const s = pass.hit(2, [50 * W, 0, 50 * W], now);
    expect(rec(pass, 1).dir[s]).toEqual([0, 1, 0]);
    expect(pass.hit(99, [0, 0, 0], now)).toBe(-1);
    expect(pass.stats.hitsIgnored).toBe(1);
    pass.destroy();
  });

  it('the 5th hit replaces the oldest (same-frame hits: the first one)', () => {
    const { dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings);
    pass.set(1, state(0, 0));
    // Same frame: 5 hits at t = 1 → the 5th replaces the first slot (oldest by sequence).
    const s = [0, 1, 2, 3, 4].map((k) => pass.hit(1, [W * (k + 1), W, 0], 1));
    expect(s.slice(0, 4).sort()).toEqual([0, 1, 2, 3]);
    expect(s[4]).toBe(s[0]);
    // A 6th hit in the same frame replaces the next oldest (the 2nd hit).
    expect(pass.hit(1, [0, W, 0], 1)).toBe(s[1]);
    // Staggered hits: the most decayed (oldest) ripple is replaced first.
    const p2 = new ShieldPass(dev, bindings);
    p2.set(1, state(0, 0));
    const t = [0, 0.2, 0.4, 0.6];
    const slot = t.map((ti) => p2.hit(1, [W, 0, 0], ti));
    expect(p2.hit(1, [W, 0, 0], 0.7)).toBe(slot[0]);
    expect(p2.hit(1, [W, 0, 0], 0.75)).toBe(slot[1]);
    // A strong old ripple can outlive a weak newer one (energy criterion).
    const p3 = new ShieldPass(dev, bindings);
    p3.set(1, state(0, 0));
    const strong = p3.hit(1, [W, 0, 0], 0, 3);
    const weak = [0.1, 0.1, 0.1].map(() => p3.hit(1, [W, 0, 0], 0.3, 0.05));
    expect(p3.hit(1, [W, 0, 0], 0.4)).toBe(weak[0]);
    expect(p3.hit(1, [W, 0, 0], 0.4)).not.toBe(strong);
    // An expired ripple frees its slot for the next hit.
    const p4 = new ShieldPass(dev, bindings);
    p4.set(1, state(0, 0));
    const first = [0, 1, 2, 3].map((k) => p4.hit(1, [W, 0, 0], k * 0.01 + (k === 2 ? -5 : 0)));
    expect(p4.hit(1, [W, 0, 0], 0.05)).toBe(first[2]);
    pass.destroy();
    p2.destroy();
    p3.destroy();
    p4.destroy();
  });

  it('update expires ripples after their lifetime (strength cleared in the record)', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings);
    pass.set(1, state(0, 0));
    pass.hit(1, [W, 0, 0], 10);
    pass.hit(1, [0, W, 0], 10.5);
    pass.update(10.6);
    expect(pass.stats.ripplesActive).toBe(2);
    encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    pass.update(10 + SHIELD_RIPPLE_LIFE_S + 1e-9);
    expect(pass.stats.ripplesActive).toBe(1);
    expect(rec(pass, 0).str.filter((v) => v > 0).length).toBe(1);
    const e = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(e.writes.length).toBe(1); // expiry re-uploads
    pass.update(12);
    expect(pass.stats.ripplesActive).toBe(0);
    expect(rec(pass, 0).str).toEqual([0, 0, 0, 0]);
    pass.destroy();
  });

  it('ripple energy and radius scale helpers', () => {
    expect(shieldRippleEnergy(1, 0)).toBe(1);
    expect(shieldRippleEnergy(1, SHIELD_RIPPLE_LIFE_S)).toBe(0);
    expect(shieldRippleEnergy(0, 0.1)).toBe(0);
    expect(shieldRippleEnergy(2, SHIELD_RIPPLE_LIFE_S / 2)).toBeCloseTo(0.5, 12);
    expect(shieldRadiusScale(1)).toBe(1);
    expect(shieldRadiusScale(0)).toBeCloseTo(0.35, 12);
    expect(shieldRadiusScale(0.5)).toBeGreaterThan(0.35);
  });

  it('restores mesh, indices and instance records after a context loss', () => {
    const { canvas, dev, bindings } = fakeFx();
    const pass = new ShieldPass(dev, bindings);
    pass.set(1, state(0, 0));
    pass.set(2, state(30, 0));
    encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    canvas.gl.lose();
    canvas.gl.resetCalls();
    canvas.gl.restore();
    const writes = canvas.gl.named('bufferSubData');
    const sizes = writes.map((w) => (w.args[2] as ArrayBufferView).byteLength);
    expect(sizes).toContain(pass.vertexCount * 12);
    expect(sizes).toContain(pass.indexCount * 2);
    const gen = canvas.gl.generation;
    const e = encodeOnce(canvas, dev, (enc) => pass.encode(enc));
    expect(e.draws).toBe(1);
    expect(e.glDraws[0]!.args[4]).toBe(2);
    expect(canvas.gl.generation).toBe(gen);
    // The instance buffer content survives (restore uploaded the staging range).
    const data = [...canvas.gl.state.bufferData.values()].some((v) => v.byteLength === 2 * SHIELD_STRIDE);
    expect(data).toBe(true);
    pass.destroy();
  });
});
