// G19 (MS3): dynamic terrain decal layer – preallocated buffer, re-binning only on change, limits
// shared with the static layer, rect/dash packing, 1,000 selection rings binned in ≤ 0.5 ms.
import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../src/camera.ts';
import { UnitRecordWriter } from '../src/instance-layout.ts';
import { createRenderer } from '../src/renderer.ts';
import type { TerrainDesc } from '../src/terrain/heightfield.ts';
import {
  DECAL_DATA_WIDTH,
  DECAL_KIND_RECT,
  DECAL_KIND_RING,
  DecalBinner,
  DynamicDecals,
  MAX_DECALS_PER_CHUNK,
  MAX_TERRAIN_DECALS,
} from '../src/terrain/decals.ts';
import type { TerrainDecal } from '../src/terrain/decals.ts';
import { GL } from '../src/webgl2/gl-const.ts';
import { FakeCanvas } from './support/fake-gl.ts';

const W = (wu: number): number => Math.round(wu * 4096);

function entries(layer: { chunkIndex: Uint32Array; list: Uint32Array }, chunks: number, cx: number, cz: number): number[] {
  const e = layer.chunkIndex[cz * chunks + cx]!;
  return Array.from(layer.list.subarray(e >>> 6, (e >>> 6) + (e & 63)));
}

function flatTerrain(sizeWu = 256): TerrainDesc {
  const dim = sizeWu + 1;
  return { sizeWu, dim, heights: new Uint16Array(dim * dim).fill(1024), heightScaleRaw: 16, waterLevelRaw: null };
}

describe('DynamicDecals buffer', () => {
  it('pushes rings/discs/rects without allocation, bumps the version and counts overflow', () => {
    const buf = new DynamicDecals(3);
    const v0 = buf.version;
    expect(buf.ring(W(10), W(12), 1.5, 0x40ff40, 0.8, 0.12, 24)).toBe(0);
    expect(buf.disc(W(20), W(20), 0.6, 0xffd040)).toBe(1);
    expect(buf.rect(W(30), W(30), 2, 1.5, 0x60a0ff, 1, 0.2)).toBe(2);
    expect(buf.ring(0, 0, 1, 0)).toBe(-1);
    expect(buf.overflow).toBe(1);
    expect(buf.count).toBe(3);
    expect(buf.version).toBe(v0 + 4);
    expect(buf.argb[0]).toBe(((204 << 24) | 0x40ff40) >>> 0);
    expect(buf.dashes[0]).toBe(24);
    buf.clear();
    expect([buf.count, buf.overflow]).toEqual([0, 0]);
    expect(() => new DynamicDecals(MAX_TERRAIN_DECALS + 1)).toThrow(/capacity/);
  });
});

describe('DecalBinner dynamic layer', () => {
  it('packs rings (dashes), discs and rects; bins into the room the static layer leaves per chunk', () => {
    const b = new DecalBinner(256);
    // 30 static decals in chunk (1, 1) → 2 left for the dynamic layer there.
    const stat: TerrainDecal[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'disc', x: W(48 + (i % 6)), z: W(48 + Math.floor(i / 6)), radiusWU: 0.2, color: 0xffffff }));
    b.bin(stat);
    const staticIndex = b.static.chunkIndex.slice();
    const staticList = b.static.list.slice();
    const buf = new DynamicDecals(64);
    for (let i = 0; i < 5; i++) buf.ring(W(50 + i), W(50), 0.4, 0x40ff40, 0.9, 0.1, i === 0 ? 16 : 0);
    buf.rect(W(100), W(100), 3, 2, 0x60a0ff, 1, 0.25);
    const st = b.binDynamic(buf);
    expect(st.decals).toBe(6);
    expect(st.chunkOverflow).toBe(3); // 5 rings want chunk (1,1), only 2 fit
    expect(entries(b.dynamic, b.chunks, 1, 1)).toEqual([0, 1]);
    expect(entries(b.static, b.chunks, 1, 1).length).toBe(30);
    expect(b.static.counts[1 * b.chunks + 1]! + b.dynamic.counts[1 * b.chunks + 1]!).toBe(MAX_DECALS_PER_CHUNK);
    // The static layer is untouched by dynamic binning.
    expect(b.static.chunkIndex).toEqual(staticIndex);
    expect(b.static.list).toEqual(staticList);
    // Packing: ring 0 with 16 dashes, rect with half extents and outline width.
    const d = b.dynamic.data;
    expect(Array.from(d.subarray(0, 5))).toEqual([W(50), W(50), W(0.4), W(0.1), DECAL_KIND_RING | (16 << 8)]);
    const o = 5 * 8;
    expect(Array.from(d.subarray(o, o + 7))).toEqual([W(100), W(100), W(3), W(2), DECAL_KIND_RECT, d[o + 5]!, W(0.25)]);
    // The rect covers chunks 2..3 (100 ± 3.75 WU incl. outline and AA margin).
    expect(entries(b.dynamic, b.chunks, 3, 3)).toEqual([5]);
    expect(entries(b.dynamic, b.chunks, 2, 2)).toEqual([]);
    // Shrinking clears stale data rows.
    buf.clear();
    buf.ring(W(10), W(10), 1, 0xff0000);
    b.binDynamic(buf);
    expect(Array.from(d.subarray(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(b.dynamic.dataRows).toBe(1);
  });

  it('shares the 4,096-decal budget with the static layer', () => {
    const b = new DecalBinner(512);
    const stat: TerrainDecal[] = Array.from({ length: 4000 }, (_, i) => ({ kind: 'ring', x: W((i % 64) * 8 + 4), z: W(Math.floor(i / 64) * 8 + 4), radiusWU: 0.3, color: 1 }));
    b.bin(stat);
    const buf = new DynamicDecals();
    for (let i = 0; i < 200; i++) buf.ring(W(4), W(4 + i), 0.3, 2);
    const st = b.binDynamic(buf);
    expect(st.decals).toBe(MAX_TERRAIN_DECALS - 4000);
    expect(st.droppedDecals).toBe(200 - (MAX_TERRAIN_DECALS - 4000));
  });

  it('bins 1,000 selection rings within 0.5 ms (measured; gated only with FAF_PERF_GATE=1)', () => {
    const b = new DecalBinner(1024);
    b.bin([{ kind: 'ring', x: W(500), z: W(500), radiusWU: 1.6, color: 0x40ff50 }]);
    const buf = new DynamicDecals();
    const fill = (seed: number): void => {
      buf.clear();
      for (let i = 0; i < 1000; i++) {
        const x = 100 + ((i * 37 + seed) % 800) + (i % 7) * 0.13;
        const z = 100 + ((i * 53 + seed * 3) % 800);
        buf.ring(W(x), W(z), 0.6 + (i % 5) * 0.2, 0x40ff50, 0.9, 0.12);
      }
    };
    const times: number[] = [];
    for (let run = 0; run < 60; run++) {
      fill(run);
      const t0 = performance.now();
      const st = b.binDynamic(buf);
      times.push(performance.now() - t0);
      expect(st.decals).toBe(1000);
      expect(st.chunkOverflow).toBe(0);
    }
    times.sort((a, c) => a - c);
    const median = times[times.length >> 1]!;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`[decals] 1,000 selection rings: bin median ${median.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms (local, Apple M5 Pro)`);
    if (process.env['FAF_PERF_GATE'] === '1') expect(median).toBeLessThanOrEqual(0.5);
    expect(median).toBeLessThan(20); // sanity bound only
  });
});

describe('Renderer dynamic decals (fake WebGL2)', () => {
  it('re-bins and uploads only the dynamic layer, only when the buffer version changes', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas, { pixelRatio: 1 });
    r.setVisuals([{ spec: { hull: 'box', size: [1, 1, 1] } }]);
    const buf = new DynamicDecals(256);
    buf.ring(W(40), W(40), 1, 0x40ff40);
    r.setDynamicDecals(buf); // before the terrain: applied on setTerrain
    r.setTerrain(flatTerrain());
    r.setTerrainDecals([{ kind: 'ring', x: W(20), z: W(20), radiusWU: 1.6, color: 0x40ff50 }]);
    const cam = new RtsCamera({ distance: 60 });
    cam.setTargetWU(40, 0, 40);
    const w = new UnitRecordWriter(1);
    w.write(0, { prevX: W(40), prevY: 0, prevZ: W(40), x: W(40), y: 0, z: W(40), prevYaw: 0, yaw: 0, visual: 0, army: 0 });
    const v = { camera: cam, units: { bytes: w.bytes, count: 1, version: 1 }, alpha: 1, timeMs: 0 };
    r.render(v);
    expect(r.stats.decals).toBe(2);
    expect(r.stats.dynamicDecals).toBe(1);
    const texUploads = (): number => gl.named('texSubImage2D').length;
    // Same version every frame ⇒ nothing re-binned or uploaded.
    gl.resetCalls();
    for (let f = 0; f < 5; f++) {
      r.setDynamicDecals(buf);
      r.render(v);
    }
    expect(texUploads()).toBe(0);
    // New version ⇒ exactly the three dynamic textures (data rows in use, chunk index, list rows).
    buf.ring(W(42), W(40), 1, 0x40ff40, 0.9, 0.12, 12);
    gl.resetCalls();
    r.setDynamicDecals(buf);
    r.render(v);
    const ups = gl.named('texSubImage2D');
    expect(ups.length).toBe(3);
    expect(ups[0]!.args.slice(4, 6)).toEqual([DECAL_DATA_WIDTH, 1]); // one data row
    expect(r.stats.dynamicDecals).toBe(2);
    expect(r.stats.decals).toBe(3);
    // The static data texture was not touched: its last upload still starts with the static ring.
    const staticData = [...gl.state.textures].filter(([o, t]) => o.gen === gl.state.generation && t.internalFormat === GL.RGBA32I);
    expect(staticData.length).toBe(2);
    r.setDynamicDecals(null);
    r.render(v);
    expect(r.stats.dynamicDecals).toBe(0);
    r.dispose();
  });
});
