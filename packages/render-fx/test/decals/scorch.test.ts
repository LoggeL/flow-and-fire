import { describe, expect, it } from 'vitest';
import { FX_TIME_WRAP_S, SLOT_FX_SCORCH, UNIT_FX_SCORCH_CELLS, UNIT_FX_SCORCH_DATA } from '../../src/core/slots.ts';
import {
  MAX_SCORCH_PER_CHUNK,
  SCORCH_BIN_MARGIN_WU,
  SCORCH_BLOCK_GLSL,
  SCORCH_CAPS,
  SCORCH_CELLS_WIDTH,
  SCORCH_CHUNK_WU,
  SCORCH_DATA_WIDTH,
  SCORCH_DECALS_PER_ROW,
  SCORCH_GLSL,
  SCORCH_LAYOUT,
  SCORCH_SAMPLERS,
  SCORCH_UNIFORM_BLOCKS,
  ScorchDecals,
  VARKAN_SCORCH,
  scorchRot12,
  scorchShadeReference,
} from '../../src/decals/scorch.ts';
import type { ScorchDecalInput, ScorchKind } from '../../src/decals/scorch.ts';
import { FxRng } from '../../src/effects/random.ts';

const KINDS: ScorchKind[] = ['scorch', 'crater', 'scar'];

function decal(i: number, over: Partial<ScorchDecalInput> = {}): ScorchDecalInput {
  return { xWu: 40 + i, zWu: 60, radiusWu: 2, kind: 'scorch', seed: i, tS: i, lifetimeS: 0, ...over };
}

describe('ScorchDecals pool', () => {
  it('sizes the textures from cap and map size', () => {
    const d = new ScorchDecals({ cap: SCORCH_CAPS.medium, mapSizeWu: 512 });
    expect(d.chunks).toBe(16);
    expect(d.dataTexture).toEqual({ width: SCORCH_DATA_WIDTH, height: 4, format: 'rgba32i' });
    expect(d.data.length).toBe(SCORCH_DATA_WIDTH * 4 * 4);
    expect(d.listBase).toBe(256);
    expect(d.cellsTexture.format).toBe('r32ui');
    expect(d.cellsTexture.width).toBe(SCORCH_CELLS_WIDTH);
    expect(d.cells.length).toBe(d.cellsTexture.width * d.cellsTexture.height);
    expect(d.cellsTexture.width * d.cellsTexture.height).toBeGreaterThanOrEqual(d.listBase + d.listCapacity);
    expect(() => new ScorchDecals({ cap: 16, mapSizeWu: 100 })).toThrow(/multiple of 32/);
    expect(() => new ScorchDecals({ cap: 0, mapSizeWu: 512 })).toThrow(/cap 0/);
    expect(SCORCH_CAPS).toEqual({ low: 128, medium: 256, high: 512, ultra: 1024 });
  });

  it('replaces the oldest decal when the cap is reached', () => {
    const d = new ScorchDecals({ cap: 4, mapSizeWu: 256 });
    const handles = [0, 1, 2, 3].map((i) => d.add(decal(i)));
    expect(d.count).toBe(4);
    d.add(decal(4));
    expect(d.count).toBe(4);
    expect(d.stats.replaced).toBe(1);
    expect(d.remove(handles[0]!)).toBe(false); // the oldest was replaced
    expect(d.remove(handles[1]!)).toBe(true);
    expect(d.remove(handles[1]!)).toBe(false);
    expect(d.count).toBe(3);
    d.pack();
    const xs = new Set<number>();
    for (let i = 0; i < d.stats.decals; i++) xs.add(d.data[i * 8]! / 4096);
    expect([...xs].sort((a, b) => a - b)).toEqual([42, 43, 44]);
  });

  it('expires decals after their lifetime and clears finished embers', () => {
    const d = new ScorchDecals({ cap: 8, mapSizeWu: 256 });
    d.add(decal(0, { tS: 10, lifetimeS: 5, emberS: 2 }));
    d.add(decal(1, { tS: 10, lifetimeS: 0, emberS: 3 }));
    d.pack();
    expect(d.dirty).toBe(false);
    d.update(11);
    expect(d.dirty).toBe(false);
    expect(d.count).toBe(2);
    d.update(12.5);
    expect(d.dirty).toBe(true); // ember of decal 0 finished
    d.pack();
    // Packing order is newest first: decal 1 at index 0, decal 0 at index 1.
    expect(d.data[6]).toBe(3000);
    expect(d.data[8 + 6]).toBe(0);
    d.update(15);
    expect(d.count).toBe(1);
    expect(d.stats.expired).toBe(1);
    d.update(5000); // permanent decal survives the FX time wrap, its ember stays off
    d.pack();
    expect(d.count).toBe(1);
    expect(d.data[6]).toBe(0);
    d.clear();
    expect(d.count).toBe(0);
  });

  it('validates input', () => {
    const d = new ScorchDecals({ cap: 8, mapSizeWu: 256 });
    expect(() => d.add(decal(0, { radiusWu: 0 }))).toThrow(/radiusWu/);
    expect(() => d.add(decal(0, { radiusWu: 41 }))).toThrow(/radiusWu/);
    expect(() => d.add(decal(0, { lifetimeS: 5000 }))).toThrow(/lifetimeS/);
    expect(() => d.add(decal(0, { xWu: Number.NaN }))).toThrow(/finite/);
    expect(() => d.add(decal(0, { kind: 'blob' as ScorchKind }))).toThrow(/unknown kind/);
  });

  it('packs a lossless roundtrip of all fields', () => {
    const d = new ScorchDecals({ cap: 130, mapSizeWu: 1024 });
    const rng = new FxRng(9);
    const inputs: ScorchDecalInput[] = [];
    for (let i = 0; i < 130; i++) {
      const inp: ScorchDecalInput = {
        xWu: rng.range(0, 1024),
        zWu: rng.range(0, 1024),
        radiusWu: rng.range(0.5, 30),
        kind: KINDS[i % 3]!,
        rotation: rng.range(-7, 7),
        seed: rng.next(),
        tS: 4000 + rng.range(0, 200),
        lifetimeS: rng.range(0, 600),
        emberS: rng.range(0, 8),
        strength: rng.float01(),
      };
      inputs.push(inp);
      d.add(inp);
    }
    d.pack();
    expect(d.stats.decals).toBe(130);
    for (let i = 0; i < 130; i++) {
      // Newest first: packed index i holds the (129 − i)-th added decal.
      const inp = inputs[129 - i]!;
      const o = (Math.floor(i / SCORCH_DECALS_PER_ROW) * SCORCH_DATA_WIDTH + (i % SCORCH_DECALS_PER_ROW) * 2) * 4;
      const t = d.data;
      expect(t[o]).toBe(Math.round(inp.xWu * 4096));
      expect(t[o + 1]).toBe(Math.round(inp.zWu * 4096));
      expect(t[o + 2]).toBe(Math.round(inp.radiusWu * 4096));
      expect(t[o + 3]).toBeGreaterThanOrEqual(0);
      const pk = t[o + 3]!;
      expect(pk & 4095).toBe(scorchRot12(inp.rotation!));
      expect((pk >>> 12) & 3).toBe((129 - i) % 3);
      expect(pk >>> 14).toBe((inp.seed >>> 0) & 0x1ffff);
      expect(t[o + 4]).toBe(Math.round(inp.tS * 1000) % (FX_TIME_WRAP_S * 1000));
      expect(t[o + 5]).toBe(Math.round(inp.lifetimeS! * 1000));
      expect(t[o + 6]).toBe(Math.round(inp.emberS! * 1000));
      expect(t[o + 7]).toBe(Math.round(inp.strength! * 1000));
    }
  });

  function bruteForceCheck(d: ScorchDecals, inputs: readonly ScorchDecalInput[]): { overflow: number; exact: number } {
    // Packing order is newest first (no removals here), so packed index i == inputs[n − 1 − i].
    const n = d.stats.decals;
    let overflow = 0;
    let exact = 0;
    const span = SCORCH_CHUNK_WU;
    for (let cz = 0; cz < d.chunks; cz++) {
      for (let cx = 0; cx < d.chunks; cx++) {
        // Brute force: every decal whose circle (+margin) touches the chunk square must be listed.
        const must: number[] = [];
        const may = new Set<number>();
        for (let i = 0; i < n; i++) {
          const inp = inputs[n - 1 - i]!;
          const x = Math.round(inp.xWu * 4096) / 4096;
          const z = Math.round(inp.zWu * 4096) / 4096;
          const r = Math.round(inp.radiusWu * 4096) / 4096;
          const nx = Math.min(Math.max(x, cx * span), (cx + 1) * span);
          const nz = Math.min(Math.max(z, cz * span), (cz + 1) * span);
          if (Math.hypot(x - nx, z - nz) < r) must.push(i);
          const reach = r + SCORCH_BIN_MARGIN_WU;
          const inX = x + reach >= cx * span && x - reach < (cx + 1) * span;
          const inZ = z + reach >= cz * span && z - reach < (cz + 1) * span;
          if (inX && inZ) may.add(i);
        }
        const cell = d.cells[cz * d.chunks + cx]!;
        const cnt = cell & 63;
        const first = cell >>> 6;
        expect(first).toBeGreaterThanOrEqual(d.listBase);
        const listed: number[] = [];
        for (let k = 0; k < cnt; k++) listed.push(d.cells[first + k]!);
        expect(cnt).toBeLessThanOrEqual(MAX_SCORCH_PER_CHUNK);
        for (const i of listed) expect(may.has(i)).toBe(true);
        // Lists keep packing order and take the first 32 candidates = the 32 newest decals.
        const expected = [...may].sort((a, b) => a - b).slice(0, MAX_SCORCH_PER_CHUNK);
        expect(listed).toEqual(expected);
        overflow += Math.max(0, may.size - MAX_SCORCH_PER_CHUNK);
        if (may.size <= MAX_SCORCH_PER_CHUNK) {
          for (const i of must) expect(listed).toContain(i);
          exact++;
        }
      }
    }
    return { overflow, exact };
  }

  it('chunk binning equals brute force for 1,000 random decals (with overflow counter)', () => {
    const d = new ScorchDecals({ cap: SCORCH_CAPS.ultra, mapSizeWu: 1024 });
    const rng = new FxRng(1234);
    const inputs: ScorchDecalInput[] = [];
    for (let i = 0; i < 1000; i++) {
      // Clustered distribution so some chunks overflow.
      const cluster = i % 5 === 0;
      const inp: ScorchDecalInput = {
        xWu: cluster ? rng.range(300, 330) : rng.range(-10, 1034),
        zWu: cluster ? rng.range(500, 520) : rng.range(-10, 1034),
        radiusWu: rng.range(0.5, i % 50 === 0 ? 40 : 8),
        kind: KINDS[i % 3]!,
        seed: i,
        tS: 0,
        lifetimeS: 0,
      };
      inputs.push(inp);
      d.add(inp);
    }
    d.pack();
    expect(d.stats.decals).toBe(1000);
    const { overflow, exact } = bruteForceCheck(d, inputs);
    expect(overflow).toBeGreaterThan(0);
    expect(d.stats.chunkOverflow).toBe(overflow);
    expect(exact).toBeGreaterThan(900);
    let entries = 0;
    for (let k = 0; k < d.chunks * d.chunks; k++) entries += d.cells[k]! & 63;
    expect(d.stats.listEntries).toBe(entries);
  });

  it('an overflowing chunk keeps its newest decals (fresh embers stay visible)', () => {
    const d = new ScorchDecals({ cap: 128, mapSizeWu: 256 });
    // 40 decals in chunk (1, 1), the last one is fresh and glowing.
    for (let i = 0; i < 40; i++) d.add({ xWu: 48, zWu: 48, radiusWu: 1, kind: 'scorch', seed: i, tS: i * 0.1, lifetimeS: 0, emberS: i === 39 ? 5 : 0 });
    d.pack();
    expect(d.stats.chunkOverflow).toBe(40 - MAX_SCORCH_PER_CHUNK);
    const cell = d.cells[1 * d.chunks + 1]!;
    expect(cell & 63).toBe(MAX_SCORCH_PER_CHUNK);
    const listed = Array.from({ length: MAX_SCORCH_PER_CHUNK }, (_, k) => d.cells[(cell >>> 6) + k]!);
    // Packed indices 0..31 = the 32 newest decals (seeds 39..8).
    expect(listed).toEqual(Array.from({ length: MAX_SCORCH_PER_CHUNK }, (_, k) => k));
    const seeds = listed.map((p) => {
      const o = (Math.floor(p / SCORCH_DECALS_PER_ROW) * SCORCH_DATA_WIDTH + (p % SCORCH_DECALS_PER_ROW) * 2) * 4;
      return d.data[o + 3]! >>> 14;
    });
    expect(Math.min(...seeds)).toBe(8);
    expect(seeds).toContain(39);
    // The glowing newest decal shows up in shadeAt.
    expect(d.shadeAt(48, 48, 3.95).ember).toBeGreaterThan(0);
  });

  it('shadeAt mirrors the single-decal reference through packing and binning', () => {
    const d = new ScorchDecals({ cap: 16, mapSizeWu: 256 });
    const inp: ScorchDecalInput = { xWu: 100.3, zWu: 64.9, radiusWu: 6, kind: 'crater', rotation: 0.7, seed: 4711, tS: 20, lifetimeS: 100, emberS: 4 };
    d.add(inp);
    d.update(21);
    d.pack();
    const rng = new FxRng(3);
    for (let i = 0; i < 500; i++) {
      const x = inp.xWu + rng.range(-8, 8);
      const z = inp.zWu + rng.range(-8, 8);
      const got = d.shadeAt(x, z, 21);
      const ref = scorchShadeReference({
        dxWu: x - Math.round(inp.xWu * 4096) / 4096,
        dzWu: z - Math.round(inp.zWu * 4096) / 4096,
        radiusWu: 6,
        rotation: 0.7,
        kind: 'crater',
        seed: 4711,
        ageS: 1,
        lifetimeS: 100,
        emberS: 4,
      });
      expect(got.mult).toBeCloseTo(Math.max(0.1, ref.mult), 3);
      expect(got.ember).toBeCloseTo(ref.ember, 3);
    }
    expect(d.shadeAt(-5, 10, 21)).toEqual({ mult: 1, ember: 0 });
    expect(d.shadeAt(10, 10, 21)).toEqual({ mult: 1, ember: 0 });
  });
});

describe('scorchShadeReference', () => {
  const base = { dxWu: 0, dzWu: 0, radiusWu: 4, rotation: 0, seed: 99, ageS: 0.5, lifetimeS: 100, emberS: 3 } as const;

  it('crater: dark floor, brighter rim, untouched outside', () => {
    const c = scorchShadeReference({ ...base, kind: 'crater' });
    expect(c.mult).toBeLessThan(0.4);
    expect(c.ember).toBeGreaterThan(0.25);
    let rimMax = 0;
    for (let a = 0; a < 6.28; a += 0.1) {
      for (let r = 2.4; r < 3.4; r += 0.05) {
        rimMax = Math.max(rimMax, scorchShadeReference({ ...base, kind: 'crater', dxWu: r * Math.cos(a), dzWu: r * Math.sin(a) }).mult);
      }
    }
    expect(rimMax).toBeGreaterThan(1.05);
    const out = scorchShadeReference({ ...base, kind: 'crater', dxWu: 4.01 });
    expect(out).toEqual({ mult: 1, ember: 0 });
  });

  it('scorch: dark center, soft edge, fades with lifetime, ember ends', () => {
    const c = scorchShadeReference({ ...base, kind: 'scorch' });
    expect(c.mult).toBeLessThan(0.3);
    const edge = scorchShadeReference({ ...base, kind: 'scorch', dxWu: 3.9 });
    expect(edge.mult).toBeGreaterThan(c.mult);
    expect(edge.mult).toBeLessThanOrEqual(1);
    const old = scorchShadeReference({ ...base, kind: 'scorch', ageS: 90 });
    expect(old.mult).toBeGreaterThan(c.mult);
    expect(old.ember).toBe(0);
    const dead = scorchShadeReference({ ...base, kind: 'scorch', ageS: 100 });
    expect(dead.mult).toBeCloseTo(1, 9);
    const permanent = scorchShadeReference({ ...base, kind: 'scorch', ageS: 1000, lifetimeS: 0 });
    expect(permanent.mult).toBeCloseTo(c.mult, 9);
    const weak = scorchShadeReference({ ...base, kind: 'scorch', strength: 0.5 });
    expect(weak.mult).toBeCloseTo(1 - (1 - c.mult) * 0.5, 9);
  });

  it('scar: elongated along its rotation', () => {
    const along = scorchShadeReference({ ...base, kind: 'scar', dxWu: 3 });
    const across = scorchShadeReference({ ...base, kind: 'scar', dzWu: 3 });
    expect(along.mult).toBeLessThan(1);
    expect(across.mult).toBe(1);
    const rotated = scorchShadeReference({ ...base, kind: 'scar', rotation: Math.PI / 2, dzWu: 3 });
    expect(rotated.mult).toBeLessThan(1);
  });
});

describe('scorch GLSL contract', () => {
  it('exposes block, layout, samplers and the snippet functions', () => {
    expect(SCORCH_BLOCK_GLSL).toContain('uniform FxScorch');
    expect(SCORCH_LAYOUT.size).toBe(32);
    expect(SCORCH_LAYOUT.offsetOf('grid')).toBe(0);
    expect(SCORCH_LAYOUT.offsetOf('time')).toBe(16);
    expect(() => SCORCH_LAYOUT.offsetOf('nope')).toThrow(/unknown field/);
    expect(SCORCH_UNIFORM_BLOCKS).toEqual([{ name: 'FxScorch', slot: SLOT_FX_SCORCH }]);
    expect(SCORCH_SAMPLERS).toEqual([
      { name: 'u_fxScorchData', unit: UNIT_FX_SCORCH_DATA },
      { name: 'u_fxScorchCells', unit: UNIT_FX_SCORCH_CELLS },
    ]);
    expect(SCORCH_GLSL).toContain('vec4 fxScorch(vec3 relPos)');
    expect(SCORCH_GLSL).toContain('vec3 fxScorchGlow(float e)');
    expect(SCORCH_GLSL).not.toMatch(/\$\{/);
  });

  it('writes the block (grid, wrapped time)', () => {
    const d = new ScorchDecals({ cap: 64, mapSizeWu: 512 });
    d.add(decal(0));
    d.pack();
    const buf = d.writeBlock(FX_TIME_WRAP_S + 12.5, 3, 0.8);
    const i32 = new Int32Array(buf);
    const f32 = new Float32Array(buf);
    expect(Array.from(i32.subarray(0, 4))).toEqual([16, SCORCH_CELLS_WIDTH, 1, SCORCH_DECALS_PER_ROW]);
    expect(f32[4]).toBeCloseTo(12.5, 5);
    expect(f32[5]).toBe(3);
    expect(f32[6]).toBeCloseTo(0.8, 6);
    expect(d.writeBlock(1)).toBe(buf);
  });

  it('VARKAN_SCORCH presets are valid decals', () => {
    const d = new ScorchDecals({ cap: 16, mapSizeWu: 256 });
    for (const p of Object.values(VARKAN_SCORCH)) d.add({ xWu: 128, zWu: 128, seed: 1, tS: 0, ...p });
    expect(d.count).toBe(Object.keys(VARKAN_SCORCH).length);
  });
});
