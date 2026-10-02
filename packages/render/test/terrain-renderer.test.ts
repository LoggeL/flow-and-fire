import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../src/camera.ts';
import { UnitRecordWriter } from '../src/instance-layout.ts';
import { PROBE_BATCH } from '../src/passes/probe.ts';
import { PATCH_INDEX_COUNT } from '../src/passes/terrain.ts';
import { FIXED_PASS_DRAWS, createRenderer, sunDirection } from '../src/renderer.ts';
import type { RenderView } from '../src/renderer.ts';
import type { TerrainDesc } from '../src/terrain/heightfield.ts';
import { sampleTerrainHeightRaw } from '../src/terrain/heightfield.ts';
import { GL } from '../src/webgl2/gl-const.ts';
import type { FakeGlObject, FakeGlState } from './support/fake-gl.ts';
import { FakeCanvas } from './support/fake-gl.ts';

const SCALE = 32;

function testTerrain(sizeWu = 128, water: number | null = 6 * 4096): TerrainDesc {
  const dim = sizeWu + 1;
  const heights = new Uint16Array(dim * dim);
  for (let z = 0; z < dim; z++) {
    for (let x = 0; x < dim; x++) {
      heights[z * dim + x] = Math.round((8 + 6 * Math.sin(x * 0.11) * Math.cos(z * 0.07) + (x * 7919 + z * 104729) % 13 * 0.05) * 128);
    }
  }
  return {
    sizeWu,
    dim,
    heights,
    heightScaleRaw: SCALE,
    waterLevelRaw: water,
    light: { azimuthDeg: 30, elevationDeg: 50, sun: [240, 230, 210], ambient: [110, 120, 140] },
  };
}

/** readPixels emulation of the probe: the GLSL height function modeled by the CPU mirror on the
 *  heightmap texture uploaded in the CURRENT context generation. */
function probeEmulator(state: FakeGlState, args: readonly unknown[]): void {
  let heightTex: { width: number; data: Uint16Array } | null = null;
  for (const [obj, t] of state.textures) {
    if (obj.gen !== state.generation || t.internalFormat !== GL.R16UI || t.uploads.length === 0) continue;
    heightTex = { width: t.width, data: t.uploads[t.uploads.length - 1]!.data as Uint16Array };
  }
  if (heightTex === null || state.lastBufferWrite === null || state.lastDraw === null) return;
  const xz = state.bufferData.get(state.lastBufferWrite) as Int32Array;
  const out = args[6] as Int32Array;
  const dim = heightTex.width;
  const hf = { sizeWu: dim - 1, dim, heights: heightTex.data, heightScaleRaw: SCALE };
  for (let i = 0; i < state.lastDraw.count; i++) out[i * 4] = sampleTerrainHeightRaw(hf, xz[i * 2]!, xz[i * 2 + 1]!);
}

function view(camera: RtsCamera, w: UnitRecordWriter, n: number, version = 1): RenderView {
  return { camera, units: { bytes: w.bytes, count: n, version }, alpha: 0.5, timeMs: 1000 };
}

function units(n: number, t: TerrainDesc): UnitRecordWriter {
  const w = new UnitRecordWriter(n);
  for (let i = 0; i < n; i++) {
    const x = (20 + (i % 10) * 2) * 4096;
    const z = (20 + Math.floor(i / 10) * 2) * 4096;
    const y = sampleTerrainHeightRaw(t, x, z);
    w.write(i, { prevX: x, prevY: y, prevZ: z, x, y, z, prevYaw: 0, yaw: 0, visual: i % 2, army: i & 1 });
  }
  return w;
}

function camera(): RtsCamera {
  const cam = new RtsCamera({ distance: 60, pitch: (55 * Math.PI) / 180 });
  cam.setTargetWU(40, 8, 60);
  return cam;
}

// iconThreshold 0: these tests are about the mesh passes (no strategic icons in the small fake viewport).
const VISUALS = [
  { spec: { hull: 'box', size: [1, 1, 1] }, iconThreshold: 0 },
  { spec: { hull: 'cyl', size: [1, 2, 1] }, iconThreshold: 0 },
] as const;

function liveTextures(gl: FakeCanvas['gl'], internal: number): { obj: FakeGlObject; width: number; height: number }[] {
  const out: { obj: FakeGlObject; width: number; height: number }[] = [];
  for (const [obj, t] of gl.state.textures) if (obj.gen === gl.state.generation && t.internalFormat === internal) out.push({ obj, width: t.width, height: t.height });
  return out;
}

describe('Renderer with terrain (fake WebGL2)', () => {
  it('uploads the heightmap as R16UI and draws all visible patches in ONE instanced draw', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals(VISUALS);
    const t = testTerrain();
    r.setTerrain(t);
    const hm = liveTextures(gl, GL.R16UI);
    expect(hm.length).toBe(1);
    expect([hm[0]!.width, hm[0]!.height]).toEqual([129, 129]);
    const up = gl.state.textures.get(hm[0]!.obj)!.uploads[0]!;
    expect(up.data).toEqual(t.heights);

    gl.resetCalls();
    const w = units(20, t);
    r.render(view(camera(), w, 20));
    const s = r.stats;
    expect(s.terrainPatches).toBeGreaterThan(0);
    expect(s.terrainPatches).toBeLessThanOrEqual(16);
    expect(s.drawsByPass.terrain).toBe(1);
    expect(s.drawsByPass.water).toBe(1);
    expect(s.drawsByPass.overlay).toBe(0);
    expect(s.drawsByPass.units).toBeGreaterThanOrEqual(1);
    expect(s.drawCalls).toBe(s.drawsByPass.terrain + s.drawsByPass.water + s.drawsByPass.units + s.drawsByPass.overlay);
    expect(s.drawCalls).toBeLessThanOrEqual(2 * 3 + FIXED_PASS_DRAWS);
    const terrainDraw = gl.named('drawElementsInstanced').find((c) => c.args[1] === PATCH_INDEX_COUNT)!;
    expect(terrainDraw.args[4]).toBe(s.terrainPatches);
    // Order: terrain → units → water (arrays, 6 vertices) → overlay.
    const order = gl.calls.filter((c) => c.name === 'drawElementsInstanced' || c.name === 'drawArraysInstanced');
    expect(order[0]).toBe(terrainDraw);
    expect(order[order.length - 1]!.name).toBe('drawArraysInstanced');
    // The map's light went into the Frame block (sun color 240/255).
    expect(s.lost).toBe(false);
    r.dispose();
  });

  it('rebuilds the patch list only when the camera changes', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals(VISUALS);
    const t = testTerrain();
    r.setTerrain(t);
    const cam = camera();
    const w = units(1, t);
    r.render(view(cam, w, 1));
    gl.resetCalls();
    r.render(view(cam, w, 1));
    // Only the frame UBO is written: no patch list, no unit ring upload.
    expect(gl.named('bufferSubData').length).toBe(1);
    cam.pan(3, 0);
    gl.resetCalls();
    r.render(view(cam, w, 1));
    expect(gl.named('bufferSubData').length).toBe(1 + 1 + 2); // frame UBO + patch list + unit ring/highlight
    r.dispose();
  });

  it('skips the water pass without water and draws no ground at all without terrain', () => {
    const canvas = new FakeCanvas();
    const r = createRenderer(canvas);
    r.setVisuals(VISUALS);
    const t = testTerrain(128, null);
    r.setTerrain(t);
    const w = units(4, t);
    r.render(view(camera(), w, 4));
    expect(r.stats.drawsByPass.water).toBe(0);
    expect(r.stats.drawsByPass.terrain).toBe(1);
    r.setTerrain(null);
    r.render(view(camera(), w, 4, 2));
    expect(r.stats.terrainPatches).toBe(0);
    expect(r.stats.drawsByPass.terrain).toBe(0); // every map (test plane included) is a terrain
    expect(() => r.probeTerrainHeights(new Int32Array(2), new Int32Array(1))).toThrow(/no terrain/);
    r.dispose();
  });

  it('uploads decals (data/chunk index/list) and reports overflow', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setTerrainDecals([{ kind: 'ring', x: 10 * 4096, z: 10 * 4096, radiusWU: 2, color: 0x40ff40 }]);
    const t = testTerrain();
    r.setTerrain(t); // decals set before the terrain are applied on setTerrain
    const data = liveTextures(gl, GL.RGBA32I)[0]!;
    const uploads = gl.state.textures.get(data.obj)!.uploads;
    expect((uploads[uploads.length - 1]!.data as Int32Array)[0]).toBe(10 * 4096);
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: 'disc' as const, x: 50 * 4096 + i, z: 50 * 4096, radiusWU: 0.5, color: 0xffffff }));
    const st = r.setTerrainDecals(many);
    expect(st.chunkOverflow).toBe(8);
    r.render(view(camera(), units(1, t), 1));
    expect(r.stats.decals).toBe(40);
    expect(r.stats.decalChunkOverflow).toBe(8);
    r.dispose();
  });

  it('GPU probe renders POINTS into an R32I target and reads it back (emulated = CPU mirror)', () => {
    const canvas = new FakeCanvas({ onReadPixels: probeEmulator });
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    const t = testTerrain();
    r.setTerrain(t);
    const n = PROBE_BATCH + 123; // two batches
    const xz = new Int32Array(n * 2);
    for (let i = 0; i < n * 2; i++) xz[i] = ((i * 2654435761) >>> 0) % (140 * 4096) - 4096;
    const out = new Int32Array(n);
    gl.resetCalls();
    r.probeTerrainHeights(xz, out);
    for (let i = 0; i < n; i++) expect(out[i]).toBe(sampleTerrainHeightRaw(t, xz[i * 2]!, xz[i * 2 + 1]!));
    const draws = gl.named('drawArraysInstanced');
    expect(draws.map((c) => [c.args[0], c.args[2]])).toEqual([
      [GL.POINTS, PROBE_BATCH],
      [GL.POINTS, 123],
    ]);
    const reads = gl.named('readPixels');
    expect(reads.length).toBe(2);
    expect(reads[0]!.args.slice(4, 6)).toEqual([GL.RGBA_INTEGER, GL.INT]);
    expect(gl.named('clearBufferiv').length).toBe(2);
    expect(liveTextures(gl, GL.R32I).length).toBe(1);
    // The framebuffer is created once and reused.
    expect(gl.named('createFramebuffer').length).toBe(1);
    r.dispose();
  });

  it('context loss: every terrain resource is re-created and re-uploaded; render and probe work again', () => {
    const canvas = new FakeCanvas({ onReadPixels: probeEmulator });
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals(VISUALS);
    const t = testTerrain();
    r.setTerrain(t);
    r.setTerrainDecals([{ kind: 'ring', x: 30 * 4096, z: 30 * 4096, radiusWU: 3, color: 0x00e0ff }]);
    const w = units(20, t);
    const cam = camera();
    r.render({ ...view(cam, w, 20), parts: { bytes: new Uint8Array(64), count: 8, version: 1 } });
    const xz = new Int32Array(2000);
    for (let i = 0; i < xz.length; i++) xz[i] = (i * 7727) % (128 * 4096);
    const before = new Int32Array(1000);
    r.probeTerrainHeights(xz, before);
    const drawsBefore = r.stats.drawCalls;
    const live = (kind: string): number => gl.named(`create${kind}`).length - gl.named(`delete${kind}`).length;
    const texturesBefore = live('Texture');
    const buffersBefore = live('Buffer');
    const programsBefore = live('Program');

    gl.lose();
    r.render(view(cam, w, 20));
    expect(r.stats.lost).toBe(true);
    expect(() => r.probeTerrainHeights(xz, before)).toThrow(/lost/);
    gl.resetCalls();
    gl.restore();
    // heightmap, albedo array, 2 splat planes, 2 × 3 decal textures (static + dynamic), parts, pivots,
    // visual data, icon atlas, shared armor grain, probe target
    expect(gl.created('texture')).toBe(texturesBefore);
    expect(texturesBefore).toBe(16);
    expect(gl.created('buffer')).toBe(buffersBefore);
    expect(gl.created('program')).toBe(programsBefore);
    // Heightmap content re-uploaded in the new generation.
    const hm = liveTextures(gl, GL.R16UI)[0]!;
    expect(gl.state.textures.get(hm.obj)!.uploads[0]!.data).toEqual(t.heights);
    // Albedo array: one texSubImage3D per layer + mipmaps.
    expect(gl.named('texSubImage3D').length).toBe(8);
    expect(gl.named('generateMipmap').length).toBe(2);
    // Decal data restored from the CPU copy.
    const dec = liveTextures(gl, GL.RGBA32I)[0]!;
    expect((gl.state.textures.get(dec.obj)!.uploads[0]!.data as Int32Array)[0]).toBe(30 * 4096);

    r.render({ ...view(cam, w, 20), parts: { bytes: new Uint8Array(64), count: 8, version: 1 } });
    expect(r.stats.lost).toBe(false);
    expect(r.stats.drawCalls).toBe(drawsBefore);
    const after = new Int32Array(1000);
    r.probeTerrainHeights(xz, after);
    expect(after).toEqual(before);
    expect(Array.from(after.subarray(0, 5))).toEqual(Array.from({ length: 5 }, (_, i) => sampleTerrainHeightRaw(t, xz[i * 2]!, xz[i * 2 + 1]!)));
    r.dispose();
  });

  it('presets limit splat layers, set the LOD bias and resize with the render scale', () => {
    const canvas = new FakeCanvas();
    canvas.clientWidth = 1000;
    canvas.clientHeight = 500;
    const r = createRenderer(canvas, { pixelRatio: 1, preset: 'medium' });
    expect([canvas.width, canvas.height]).toEqual([800, 400]);
    expect(r.preset.name).toBe('medium');
    const t: TerrainDesc = {
      ...testTerrain(64),
      splat: { layers: 8, resolution: 4, planes: [new Uint8Array(64), new Uint8Array(64)] },
    };
    r.setTerrain(t);
    r.setPreset('ultra');
    const w = units(1, t);
    r.render(view(camera(), w, 1));
    expect([canvas.width, canvas.height]).toEqual([1000, 500]);
    expect(r.stats.preset).toBe('ultra');
    r.setPreset('low');
    r.render(view(camera(), w, 1));
    expect([canvas.width, canvas.height]).toEqual([660, 330]);
    r.dispose();

    // manageCanvasSize: false ⇒ the caller sizes the canvas.
    const c2 = new FakeCanvas();
    c2.width = 123;
    const r2 = createRenderer(c2, { manageCanvasSize: false, preset: 'low' });
    expect(c2.width).toBe(123);
    r2.dispose();
  });
});

describe('sunDirection (.rtsmap light convention)', () => {
  it('0° = sun from +z, 90° = from +x, elevation lifts y; unit length', () => {
    const [x0, y0, z0] = sunDirection(0, 45);
    expect(x0).toBeCloseTo(0, 12);
    expect(z0).toBeCloseTo(Math.SQRT1_2, 12);
    expect(y0).toBeCloseTo(Math.SQRT1_2, 12);
    const [x1, , z1] = sunDirection(90, 0);
    expect(x1).toBeGreaterThan(0.99);
    expect(z1).toBeCloseTo(0, 12);
    const [x2, , z2] = sunDirection(270, 30);
    expect(x2).toBeLessThan(-0.8);
    expect(z2).toBeCloseTo(0, 12);
    expect(sunDirection(0, 90)[1]).toBeCloseTo(1, 12);
  });
});
