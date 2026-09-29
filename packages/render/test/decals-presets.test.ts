import { describe, expect, it } from 'vitest';
import { RENDER_PRESETS, RENDER_PRESET_NAMES, backbufferSize, parsePresetName, resolvePreset } from '../src/presets.ts';
import type { TerrainDecal } from '../src/terrain/decals.ts';
import {
  DECAL_DATA_WIDTH,
  DECALS_PER_ROW,
  DecalBinner,
  MAX_DECALS_PER_CHUNK,
  MAX_TERRAIN_DECALS,
} from '../src/terrain/decals.ts';

const W = (wu: number): number => Math.round(wu * 4096);

function entries(b: DecalBinner, cx: number, cz: number): number[] {
  const e = b.chunkIndex[cz * b.chunks + cx]!;
  const start = e >>> 6;
  const n = e & 63;
  return Array.from(b.list.subarray(start, start + n));
}

describe('DecalBinner', () => {
  it('bins each decal into every chunk its ring (plus AA margin) touches, in input order', () => {
    const b = new DecalBinner(512);
    expect(b.chunks).toBe(16);
    const decals: TerrainDecal[] = [
      { kind: 'ring', x: W(64), z: W(64), radiusWU: 2, color: 0x40ff40 }, // corner of 4 chunks
      { kind: 'disc', x: W(16), z: W(16), radiusWU: 3, widthWU: 0.5, color: 0x00e0ff, alpha: 0.5 }, // inside chunk (0,0)
      { kind: 'ring', x: W(-100), z: W(40), radiusWU: 2, color: 0xffffff }, // off-map: no chunk
    ];
    const st = b.bin(decals);
    expect(st).toMatchObject({ decals: 3, droppedDecals: 0, chunkOverflow: 0, listEntries: 5 });
    for (const [cx, cz] of [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ] as const) {
      expect(entries(b, cx, cz)).toEqual([0]);
    }
    expect(entries(b, 0, 0)).toEqual([1]);
    expect(entries(b, 0, 1)).toEqual([]);
    // Packed data: texel 0 = (x, z, r, w), texel 1 = (kind, rgba).
    const d = b.data;
    const rgba = 0x40 | (0xff << 8) | (0x40 << 16) | (Math.round(0.9 * 255) << 24); // r | g | b | a (default alpha 0.9)
    expect(Array.from(d.subarray(0, 8))).toEqual([W(64), W(64), W(2), W(0.3), 0, rgba, 0, 0]);
    expect(d[8 + 4]).toBe(1); // disc
    expect((d[8 + 5]! >>> 24) & 255).toBe(128); // alpha 0.5
    expect(d[8 + 3]).toBe(W(0.5));
  });

  it('caps at 32 decals per chunk and counts the overflow', () => {
    const b = new DecalBinner(512);
    const decals: TerrainDecal[] = [];
    for (let i = 0; i < 40; i++) decals.push({ kind: 'disc', x: W(100 + (i % 5)), z: W(100 + Math.floor(i / 5) * 0.5), radiusWU: 0.5, color: i });
    const st = b.bin(decals);
    expect(st.chunkOverflow).toBe(40 - MAX_DECALS_PER_CHUNK);
    const e = entries(b, 3, 3);
    expect(e.length).toBe(MAX_DECALS_PER_CHUNK);
    expect(e).toEqual(Array.from({ length: 32 }, (_, i) => i)); // first 32 in input order win
  });

  it('drops decals beyond 4,096 and lays out the data texture in rows of 64', () => {
    const b = new DecalBinner(512);
    const decals: TerrainDecal[] = [];
    for (let i = 0; i < MAX_TERRAIN_DECALS + 10; i++) {
      decals.push({ kind: 'ring', x: W((i % 64) * 8 + 4), z: W(Math.floor(i / 64) * 8 % 512 + 4), radiusWU: 0.5, color: 0x123456 });
    }
    const st = b.bin(decals);
    expect(st.decals).toBe(MAX_TERRAIN_DECALS);
    expect(st.droppedDecals).toBe(10);
    // decal 65 → row 1, column 1 → texel (2, 1)
    const o = (1 * DECAL_DATA_WIDTH + 1 * 2) * 4;
    expect(b.data[o]).toBe(decals[DECALS_PER_ROW + 1]!.x);
    // Every chunk index entry points inside the list.
    for (let k = 0; k < b.chunks * b.chunks; k++) {
      const e = b.chunkIndex[k]!;
      expect((e >>> 6) + (e & 63)).toBeLessThanOrEqual(st.listEntries);
    }
  });

  it('re-binning replaces the previous content', () => {
    const b = new DecalBinner(64);
    b.bin([{ kind: 'ring', x: W(10), z: W(10), radiusWU: 1, color: 1 }]);
    expect(b.bin([]).listEntries).toBe(0);
    expect(Array.from(b.chunkIndex)).toEqual([0, 0, 0, 0]);
    expect(b.data[0]).toBe(0);
  });
});

describe('render presets', () => {
  it('has the planned table (render scale, splat layers, shadows none in MS2)', () => {
    expect(RENDER_PRESET_NAMES).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(RENDER_PRESETS.low.renderScale).toBe(0.66);
    expect(RENDER_PRESETS.medium.renderScale).toBe(0.8);
    expect(RENDER_PRESETS.high.renderScale).toBe(1);
    expect(RENDER_PRESETS.ultra.renderScale).toBe(1);
    expect([RENDER_PRESETS.low.splatLayers, RENDER_PRESETS.medium.splatLayers]).toEqual([4, 4]);
    expect([RENDER_PRESETS.high.splatLayers, RENDER_PRESETS.ultra.splatLayers]).toEqual([8, 8]);
    for (const n of RENDER_PRESET_NAMES) {
      const p = RENDER_PRESETS[n];
      expect(p.name).toBe(n);
      expect(p.shadows).toBe('none');
      expect(p.shadowCascades).toBe(0);
      expect(p.lodBias).toBeGreaterThan(0);
      expect(p.caps.decals).toBeLessThanOrEqual(MAX_TERRAIN_DECALS);
    }
    // Monotone quality: LOD bias and caps never shrink from low to ultra.
    for (let i = 1; i < RENDER_PRESET_NAMES.length; i++) {
      const a = RENDER_PRESETS[RENDER_PRESET_NAMES[i - 1]!];
      const b = RENDER_PRESETS[RENDER_PRESET_NAMES[i]!];
      expect(b.lodBias).toBeGreaterThanOrEqual(a.lodBias);
      expect(b.caps.particles).toBeGreaterThanOrEqual(a.caps.particles);
      expect(b.renderScale).toBeGreaterThanOrEqual(a.renderScale);
    }
    expect(parsePresetName('medium')).toBe('medium');
    expect(parsePresetName('extreme')).toBeUndefined();
    expect(parsePresetName(null)).toBeUndefined();
    expect(resolvePreset('low')).toBe(RENDER_PRESETS.low);
  });

  it('backbufferSize = round(css × dpr × scale), clamped to [1, maxSize]', () => {
    expect(backbufferSize(1920, 1080, 1, 0.8)).toEqual({ width: 1536, height: 864 });
    expect(backbufferSize(1000, 500, 2, 0.66)).toEqual({ width: 1320, height: 660 });
    expect(backbufferSize(1280, 720, 1.5, 1)).toEqual({ width: 1920, height: 1080 });
    expect(backbufferSize(0, 0, 1, 1)).toEqual({ width: 1, height: 1 });
    expect(backbufferSize(8000, 4000, 2, 1, 8192)).toEqual({ width: 8192, height: 8000 });
  });
});
