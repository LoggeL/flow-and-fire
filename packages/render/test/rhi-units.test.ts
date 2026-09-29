import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../src/camera.ts';
import { UNIT_INSTANCE_STRIDE, UnitRecordWriter } from '../src/instance-layout.ts';
import { combineParts, createPlaceholderLods, createPlaceholderMesh, meshBoundingRadius } from '../src/mesh/placeholder.ts';
import { UNIT_ATTR } from '../src/passes/units.ts';
import { createRenderer } from '../src/renderer.ts';
import type { VisualTable } from '../src/renderer.ts';
import { createWebGL2Device } from '../src/webgl2/device.ts';
import { GL } from '../src/webgl2/gl-const.ts';
import { FakeCanvas } from './support/fake-gl.ts';

describe('RHI extensions (WebGL2 backend)', () => {
  it('reports capabilities and float render targets only with EXT_color_buffer_float', () => {
    const plain = createWebGL2Device(new FakeCanvas());
    expect(plain.caps.colorBufferFloat).toBe(false);
    const hdr = plain.createTexture({ width: 4, height: 4, format: 'rgba16f' });
    expect(() => plain.beginPass({ colorAttachments: [{ texture: hdr }] })).toThrow(/EXT_color_buffer_float/);
    plain.destroy();

    const canvas = new FakeCanvas({ extensions: { EXT_color_buffer_float: {}, OES_texture_float_linear: {} } });
    const dev = createWebGL2Device(canvas);
    expect(dev.caps.colorBufferFloat).toBe(true);
    expect(dev.caps.textureFloatLinear).toBe(true);
    expect(dev.caps.maxColorAttachments).toBeGreaterThanOrEqual(4);
    const gl = canvas.gl;
    gl.resetCalls();
    const color = dev.createTexture({ width: 64, height: 32, format: 'rgba16f', filter: 'linear' });
    const depth = dev.createTexture({ width: 64, height: 32, format: 'depth24', compare: 'lequal', filter: 'linear' });
    const enc = dev.beginPass({ colorAttachments: [{ texture: color }], depthAttachment: { texture: depth }, clearColor: [0, 0, 0, 1], clearDepth: 1 });
    enc.end();
    expect(gl.named('createFramebuffer').length).toBe(1);
    expect(gl.named('framebufferTexture2D').map((c) => c.args[1])).toEqual([GL.COLOR_ATTACHMENT0, GL.DEPTH_ATTACHMENT]);
    expect(gl.named('drawBuffers')[0]!.args[0]).toEqual([GL.COLOR_ATTACHMENT0]);
    expect(gl.named('viewport')[0]!.args).toEqual([0, 0, 64, 32]); // attachment size
    expect(gl.named('clearBufferfv').map((c) => c.args[0])).toEqual([GL.COLOR, GL.DEPTH]);
    // Depth compare mode for shadow samplers.
    const params = gl.named('texParameteri').map((c) => [c.args[1], c.args[2]]);
    expect(params).toContainEqual([GL.TEXTURE_COMPARE_MODE, GL.COMPARE_REF_TO_TEXTURE]);
    expect(params).toContainEqual([GL.TEXTURE_COMPARE_FUNC, GL.LEQUAL]);
    // Second pass with the same attachments reuses the framebuffer; the canvas pass unbinds it.
    gl.resetCalls();
    dev.beginPass({ colorAttachments: [{ texture: color }], depthAttachment: { texture: depth } }).end();
    expect(gl.named('createFramebuffer').length).toBe(0);
    dev.beginPass({}).end();
    expect(gl.named('bindFramebuffer').at(-1)!.args[1]).toBeNull();
    // Destroying an attached texture drops the framebuffer.
    gl.resetCalls();
    dev.destroyTexture(color);
    expect(gl.named('deleteFramebuffer').length).toBe(1);
    expect(() => dev.createTexture({ width: 4, height: 4, format: 'rgba8', compare: 'less' })).toThrow(/depth format/);
    dev.destroy();
  });

  it('2D array textures: texStorage3D, one texSubImage3D per layer, mipmaps, layer attachments', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const dev = createWebGL2Device(canvas);
    const arr = dev.createTexture({ width: 8, height: 8, format: 'rgba8', dimension: '2d-array', layers: 3, mipLevels: 4, filter: 'linear', wrap: 'repeat' });
    expect(gl.named('texStorage3D')[0]!.args).toEqual([GL.TEXTURE_2D_ARRAY, 4, GL.RGBA8, 8, 8, 3]);
    const params = gl.named('texParameteri').map((c) => [c.args[1], c.args[2]]);
    expect(params).toContainEqual([GL.TEXTURE_MIN_FILTER, GL.LINEAR_MIPMAP_LINEAR]);
    for (let l = 0; l < 3; l++) dev.writeTexture(arr, { x: 0, y: 0, width: 8, height: 8 }, new Uint8Array(256).fill(l), l);
    expect(gl.named('texSubImage3D').map((c) => c.args[4])).toEqual([0, 1, 2]);
    dev.generateMipmaps(arr);
    expect(gl.named('generateMipmap')[0]!.args[0]).toBe(GL.TEXTURE_2D_ARRAY);
    expect(() => dev.writeTexture(arr, { x: 0, y: 0, width: 8, height: 8 }, new Uint8Array(256), 3)).toThrow(/layer/);
    expect(() => dev.writeTexture(arr, { x: 4, y: 0, width: 8, height: 8 }, new Uint8Array(256))).toThrow(/rect/);
    // Rendering into one layer of an array (CSM cascades).
    const shadow = dev.createTexture({ width: 16, height: 16, format: 'depth32f', dimension: '2d-array', layers: 2, compare: 'less' });
    dev.beginPass({ depthAttachment: { texture: shadow, layer: 1 }, clearDepth: 1 }).end();
    const layerCall = gl.named('framebufferTextureLayer')[0]!;
    expect(layerCall.args[1]).toBe(GL.DEPTH_ATTACHMENT);
    expect(layerCall.args[4]).toBe(1);
    expect(gl.named('drawBuffers').at(-1)!.args[0]).toEqual([GL.NONE]);
    dev.destroy();
  });

  it('readTexture reads the guaranteed format/type and compacts channels', () => {
    const canvas = new FakeCanvas({
      onReadPixels: (_s, args) => {
        const out = args[6] as Int32Array | Uint8Array;
        for (let i = 0; i < out.length; i++) out[i] = i;
      },
    });
    const dev = createWebGL2Device(canvas);
    const gl = canvas.gl;
    const r32i = dev.createTexture({ width: 4, height: 2, format: 'r32i' });
    const out = new Int32Array(8);
    dev.readTexture(r32i, { x: 0, y: 0, width: 4, height: 2 }, out);
    expect(gl.named('readPixels')[0]!.args.slice(0, 6)).toEqual([0, 0, 4, 2, GL.RGBA_INTEGER, GL.INT]);
    expect(Array.from(out)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]); // red channel of each RGBA texel
    const rgba = dev.createTexture({ width: 2, height: 1, format: 'rgba8' });
    const px = new Uint8Array(8);
    dev.readTexture(rgba, { x: 0, y: 0, width: 2, height: 1 }, px);
    expect(Array.from(px)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // read directly into `out`
    expect(() => dev.readTexture(rgba, { x: 0, y: 0, width: 2, height: 1 }, new Uint8Array(4))).toThrow(/need 8/);
    const d = dev.createTexture({ width: 2, height: 2, format: 'depth24' });
    expect(() => dev.readTexture(d, { x: 0, y: 0, width: 2, height: 2 }, new Float32Array(4))).toThrow(/depth/);
    expect(() => dev.writeTexture(d, { x: 0, y: 0, width: 2, height: 2 }, new Uint32Array(4))).toThrow(/depth/);
    dev.destroy();
  });

  it('polygon offset and color-write-off pipelines (shadow passes)', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const dev = createWebGL2Device(canvas);
    const p = dev.createPipeline({ vertex: 'v', fragment: 'f', streams: [], depthBias: { constant: 2, slopeScale: 1.5 }, colorWrite: false });
    const enc = dev.beginPass({});
    enc.setPipeline(p);
    enc.end();
    expect(gl.named('enable').map((c) => c.args[0])).toContain(GL.POLYGON_OFFSET_FILL);
    expect(gl.named('polygonOffset')[0]!.args).toEqual([1.5, 2]);
    expect(gl.named('colorMask')[0]!.args).toEqual([false, false, false, false]);
    // A later clear re-enables color writes.
    gl.resetCalls();
    dev.beginPass({ clearColor: [0, 0, 0, 1] }).end();
    expect(gl.named('colorMask')[0]!.args).toEqual([true, true, true, true]);
    dev.destroy();
  });
});

describe('UnitPass P2: LODs, draws per (visual, LOD), merged parts', () => {
  const W = (wu: number): number => Math.round(wu * 4096);

  function tank(): ReturnType<typeof combineParts> {
    return combineParts([
      { mesh: createPlaceholderMesh({ hull: 'box', size: [2, 0.6, 1.4] }), partId: 0 },
      { mesh: createPlaceholderMesh({ hull: 'cyl', size: [1, 0.4, 1] }), partId: 1, offset: [0, 0.6, 0], pivot: [0, 0.6, 0] },
      { mesh: createPlaceholderMesh({ hull: 'box', size: [1.2, 0.15, 0.15] }), partId: 2, offset: [0.8, 0.75, 0], pivot: [0.3, 0.8, 0], parent: 1 },
    ]);
  }

  it('placeholder LODs: cylinders 16/8/4 segments, boxes share LOD 0/1', () => {
    const c = createPlaceholderLods({ hull: 'cyl', size: [1, 1, 1] });
    expect(c.map((m) => m.indexCount)).toEqual([192, 96, 48]);
    const b = createPlaceholderLods({ hull: 'box', size: [1, 1, 1] });
    expect(b[0]).toBe(b[1]);
    expect(b[2].vertexCount).toBe(8);
    expect(b[2].indexCount).toBe(36);
  });

  it('combineParts keeps part ids, pivots and parents; radius covers every rotation', () => {
    const m = tank();
    expect(Array.from(new Set(m.partIds))).toEqual([0, 1, 2]);
    expect(Array.from(m.partPivots!)).toEqual([0, 0, 0, 0, 0.6000000238418579, 0, 0.30000001192092896, 0.800000011920929, 0]);
    expect(Array.from(m.partParents!)).toEqual([0, 0, 1]);
    // barrel tip at (1.4, 0.75, 0) relative to pivot (0.3, 0.8) → 1.1; + |pivot2 − pivot1| + |pivot1|
    expect(meshBoundingRadius(m)).toBeGreaterThan(Math.hypot(1.4, 0.825, 0.075));
    expect(() => combineParts([{ mesh: m, partId: 2, parent: 2 }])).toThrow(/parent/);
  });

  it('one draw per non-empty (visual, LOD) bucket; PartStream texture and pivot table', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    const t = tank();
    const visuals: VisualTable = [
      { spec: { hull: 'box', size: [1, 1, 1] }, lodDistancesWU: [30, 90] },
      { spec: { hull: 'box', size: [2, 0.6, 1.4] }, meshes: [t], lodDistancesWU: [30, 90] },
    ];
    r.setVisuals(visuals);
    // Camera looking down on (100, 0, 100) from ~60 WU: rows of units at increasing distance.
    const cam = new RtsCamera({ distance: 60, pitch: (70 * Math.PI) / 180, maxDistance: 3000 });
    cam.setTargetWU(100, 0, 100);
    const n = 12;
    const w = new UnitRecordWriter(n);
    for (let i = 0; i < n; i++) {
      const far = i >= 8; // units 8..11 far behind the target → other LOD or culled
      const x = W(100 + (i % 4));
      const z = W(far ? -400 : 100 + (i < 4 ? 0 : 1));
      w.write(i, { prevX: x, prevY: 0, prevZ: z, x, y: 0, z, prevYaw: 0, yaw: 0, visual: i % 2, army: 0, partBase: (i % 2) * 2, partCount: i % 2 === 1 ? 2 : 0 });
    }
    const parts = new Uint8Array(8 * 4);
    new Uint16Array(parts.buffer).set([0, 16384, 0, 0, 0, 0, 0, 2048, 100, 200, 0, 0, 1, 2, 3, 4]);
    gl.resetCalls();
    r.render({ camera: cam, units: { bytes: w.bytes, count: n, version: 1 }, parts: { bytes: parts, count: 4, version: 1 }, alpha: 0.5, timeMs: 0 });
    const s = r.stats;
    expect(s.culledInstances).toBe(4); // the far row lies behind the camera
    expect(s.unitInstances).toBe(8);
    // Units at ~60 WU distance: LOD 1 for both visuals (switch at 30/90) → 2 unit draws.
    expect(Array.from(s.lodInstances)).toEqual([0, 8, 0]);
    expect(s.drawsByPass.units).toBe(2);
    const unitDraws = gl.named('drawElementsInstanced');
    expect(unitDraws.map((c) => c.args[4])).toEqual([4, 4]);
    // Instance attribute 'parts' = (partBase, partCount word) as u32×2 at offset 40.
    const partsPtr = gl.named('vertexAttribIPointer').find((c) => c.args[0] === UNIT_ATTR.parts)!;
    expect(partsPtr.args.slice(1, 4)).toEqual([2, GL.UNSIGNED_INT, UNIT_INSTANCE_STRIDE]);
    expect((partsPtr.args[4] as number) % UNIT_INSTANCE_STRIDE).toBe(40);
    // PartStream texture: RGBA16UI, 1024 parts per row, uploaded as u16.
    const partUpload = gl.named('texSubImage2D').find((c) => c.args[6] === GL.RGBA_INTEGER && c.args[7] === GL.UNSIGNED_SHORT)!;
    expect(partUpload.args.slice(2, 6)).toEqual([0, 0, 1024, 1]);
    expect(Array.from((partUpload.args[8] as Uint16Array).subarray(0, 4))).toEqual([0, 16384, 0, 0]);
    // Same parts version ⇒ no re-upload; LOD bias change ⇒ re-cull.
    gl.resetCalls();
    r.render({ camera: cam, units: { bytes: w.bytes, count: n, version: 1 }, parts: { bytes: parts, count: 4, version: 1 }, alpha: 0.7, timeMs: 10 });
    expect(gl.named('texSubImage2D').length).toBe(0);
    r.setPreset('ultra'); // LOD bias 1.25 → 30 × 1.25 = 37.5 < 60: still LOD 1
    r.setPreset({ ...r.preset, lodBias: 3 }); // switch distances 90/270 WU → every unit at ~60 WU uses LOD 0
    r.render({ camera: cam, units: { bytes: w.bytes, count: n, version: 1 }, alpha: 0.7, timeMs: 20 });
    expect(Array.from(r.stats.lodInstances)).toEqual([8, 0, 0]);
    r.dispose();
  });
});
