import { describe, expect, it } from 'vitest';
import { GL } from '../src/webgl2/gl-const.ts';
import { createWebGL2Device, validateStreams } from '../src/webgl2/device.ts';
import { RtsCamera } from '../src/camera.ts';
import { UNIT_INSTANCE_STRIDE, UnitRecordWriter } from '../src/instance-layout.ts';
import { FRAME_LAYOUT } from '../src/passes/shared.ts';
import { HIGHLIGHT_STRIDE, MESH_VERTEX_STRIDE, UNIT_ATTR } from '../src/passes/units.ts';
import { FIXED_PASS_DRAWS, createRenderer } from '../src/renderer.ts';
import type { RenderView } from '../src/renderer.ts';
import { vf } from '../src/rhi/types.ts';
import type { GlCall } from './support/fake-gl.ts';
import { FakeCanvas } from './support/fake-gl.ts';

// LOD distances far out: every unit of these tests uses LOD 0 (16-segment cylinder). iconThreshold 0:
// no strategic icons in the small fake viewport (icons are tested in strategic.test.ts).
const VISUALS = [
  { spec: { hull: 'box', size: [1, 1, 1] }, color: 0x808080, lodDistancesWU: [1000, 2000], iconThreshold: 0 },
  { spec: { hull: 'cyl', size: [1, 2, 1] }, lodDistancesWU: [1000, 2000], iconThreshold: 0 },
] as const;

function makeUnits(n: number): UnitRecordWriter {
  const w = new UnitRecordWriter(n);
  for (let i = 0; i < n; i++) {
    w.write(i, {
      prevX: i * 4096,
      prevY: 0,
      prevZ: 0,
      x: i * 4096 + 100,
      y: 0,
      z: 0,
      prevYaw: 0,
      yaw: 1000,
      visual: i % 3 === 0 ? 1 : 0,
      army: i & 1,
      handle: i + 1,
    });
  }
  return w;
}

function view(w: UnitRecordWriter, n: number, extra: Partial<RenderView> = {}): RenderView {
  const camera = new RtsCamera();
  camera.setTargetWU(10, 0, 10);
  return { camera, units: { bytes: w.bytes, count: n, version: 1 }, alpha: 0.5, timeMs: 1000, ...extra };
}

/** Attribute pointer calls grouped by location, in call order. */
function pointers(calls: readonly GlCall[]): Map<number, GlCall[]> {
  const out = new Map<number, GlCall[]>();
  for (const c of calls) {
    if (c.name !== 'vertexAttribIPointer' && c.name !== 'vertexAttribPointer') continue;
    const loc = c.args[0] as number;
    const arr = out.get(loc) ?? [];
    arr.push(c);
    out.set(loc, arr);
  }
  return out;
}

describe('WebGL2 backend with a recording fake context', () => {
  it('binds UnitRecord integer attributes via vertexAttribIPointer, stride 48, divisor 1', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    // HP bars off: their instance streams reuse locations 0..3 (checked in strategic.test.ts).
    const r = createRenderer(canvas, { hpBars: 'off' });
    r.setVisuals(VISUALS);
    const n = 10;
    const w = makeUnits(n);
    gl.resetCalls();
    r.render(view(w, n, { highlight: new Uint8Array(n).fill(1) }));

    const ptr = pointers(gl.calls);
    // Instance stream: prevPos, curPos (i32×3), yaw (u16×2), meta (u16×4) – integer, stride 48.
    const expectAttr = (loc: number, size: number, type: number, stride: number, relOff: number): number => {
      const cs = ptr.get(loc);
      expect(cs, `location ${loc}`).toBeDefined();
      const c = cs![0]!;
      expect(c.name).toBe('vertexAttribIPointer');
      expect(c.args[1]).toBe(size);
      expect(c.args[2]).toBe(type);
      expect(c.args[3]).toBe(stride);
      const off = c.args[4] as number;
      expect(off % stride).toBe(relOff);
      return off - relOff;
    };
    const base = expectAttr(UNIT_ATTR.prevPos, 3, GL.INT, UNIT_INSTANCE_STRIDE, 0);
    expect(expectAttr(UNIT_ATTR.curPos, 3, GL.INT, UNIT_INSTANCE_STRIDE, 12)).toBe(base);
    expect(expectAttr(UNIT_ATTR.yaw, 2, GL.UNSIGNED_SHORT, UNIT_INSTANCE_STRIDE, 24)).toBe(base);
    expect(expectAttr(UNIT_ATTR.meta, 4, GL.UNSIGNED_SHORT, UNIT_INSTANCE_STRIDE, 28)).toBe(base);
    expectAttr(UNIT_ATTR.highlight, 1, GL.UNSIGNED_BYTE, HIGHLIGHT_STRIDE, 0);
    expectAttr(UNIT_ATTR.partId, 1, GL.UNSIGNED_BYTE, MESH_VERTEX_STRIDE, 16);
    // Float attributes: position f32×3, normal snorm8×4.
    // (location 0 is shared with the ground pass's corner stream: pick the mesh stream by stride)
    const pos = ptr.get(UNIT_ATTR.position)!.find((c) => c.args[4] === MESH_VERTEX_STRIDE)!;
    expect(pos.name).toBe('vertexAttribPointer');
    expect(pos.args.slice(1)).toEqual([3, GL.FLOAT, false, MESH_VERTEX_STRIDE, 0]);
    const nrm = ptr.get(UNIT_ATTR.normal)![0]!;
    expect(nrm.args.slice(1)).toEqual([4, GL.BYTE, true, MESH_VERTEX_STRIDE, 12]);

    // Divisors: mesh stream per vertex, instance streams per instance.
    const div = new Map(gl.named('vertexAttribDivisor').map((c) => [c.args[0] as number, c.args[1] as number]));
    // Ground corners: per-vertex stream on location 0 as well.
    for (const loc of [UNIT_ATTR.position, UNIT_ATTR.normal, UNIT_ATTR.partId]) expect(div.get(loc)).toBe(0);
    for (const loc of [UNIT_ATTR.prevPos, UNIT_ATTR.curPos, UNIT_ATTR.yaw, UNIT_ATTR.meta, UNIT_ATTR.highlight]) {
      expect(div.get(loc)).toBe(1);
    }

    // One instanced draw per visual; the second visual's stream starts after the first bucket.
    const draws = gl.named('drawElementsInstanced');
    expect(draws.length).toBe(2);
    const count1 = Array.from({ length: n }, (_, i) => i).filter((i) => i % 3 === 0).length;
    expect(draws[0]!.args[4]).toBe(n - count1); // visual 0
    expect(draws[1]!.args[4]).toBe(count1); // visual 1
    expect(draws[0]!.args[1]).toBe(36);
    expect(draws[1]!.args[1]).toBe(192);
    expect(draws[1]!.args[3]).toBe((36 + 36) * 2); // firstIndex × 2 bytes (box LOD 0/1 shared + box LOD 2)
    const prev = ptr.get(UNIT_ATTR.prevPos)!;
    expect(prev.length).toBe(2);
    expect((prev[1]!.args[4] as number) - base).toBe((n - count1) * UNIT_INSTANCE_STRIDE);
    const hl = ptr.get(UNIT_ATTR.highlight)!;
    expect((hl[1]!.args[4] as number) - (hl[0]!.args[4] as number)).toBe((n - count1) * HIGHLIGHT_STRIDE);

    expect(r.stats.drawCalls).toBe(2); // 2 visuals (no terrain set, no overlays)
    expect(r.stats.drawCalls).toBeLessThanOrEqual(2 + FIXED_PASS_DRAWS);
    expect(r.stats.visualsDrawn).toBe(2);
    expect(r.stats.instances).toBe(n);
    r.dispose();
  });

  it('skips re-sort and upload for an unchanged frame version and filters redundant state', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals(VISUALS);
    const w = makeUnits(50);
    const v = view(w, 50);
    r.render(v);
    gl.resetCalls();
    r.render({ ...v, alpha: 0.9 });
    // Only the frame UBO is rewritten.
    const uploads = gl.named('bufferSubData');
    expect(uploads.length).toBe(1);
    expect(r.stats.uploadBytes).toBe(FRAME_LAYOUT.size);
    // No VAO re-creation, no attribute re-pointing for the first visual (same ring region).
    expect(gl.named('createVertexArray').length).toBe(0);
    expect(gl.named('enableVertexAttribArray').length).toBe(0);
    expect(gl.named('useProgram').length).toBeLessThanOrEqual(2);
    // New version ⇒ upload into the next ring region.
    gl.resetCalls();
    r.render({ ...v, units: { bytes: w.bytes, count: 50, version: 2 } });
    expect(gl.named('bufferSubData').length).toBe(2 + 1); // instances + highlight + frame UBO
    r.dispose();
  });

  it('draws overlays as one instanced draw per kind', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals(VISUALS);
    const w = makeUnits(4);
    gl.resetCalls();
    r.render(
      view(w, 4, {
        overlays: {
          markers: [
            { x: 0, y: 0, z: 0, startMs: 900 },
            { x: 4096, y: 0, z: 0, startMs: 950 },
            { x: 0, y: 0, z: 0, startMs: 0 }, // expired
          ],
          lines: [
            { ax: 0, ay: 0, az: 0, bx: 4096, by: 0, bz: 4096 },
            { ax: 4096, ay: 0, az: 4096, bx: 8192, by: 0, bz: 0 },
          ],
        },
      }),
    );
    const arrays = gl.named('drawArraysInstanced');
    // lines (2), markers (2); no terrain set ⇒ no ground draw
    expect(arrays.map((c) => c.args[3])).toEqual([2, 2]);
    expect(r.stats.drawCalls).toBe(2 + 2);
    r.dispose();
  });

  it('reports shader compile errors with the info log and numbered source', () => {
    const canvas = new FakeCanvas({ failCompileMarker: 'BROKEN' });
    const dev = createWebGL2Device(canvas);
    expect(() =>
      dev.createPipeline({
        label: 'bad',
        vertex: '#version 300 es\nvoid main() { BROKEN; }',
        fragment: '#version 300 es\nvoid main() {}',
        streams: [],
      }),
    ).toThrow(/bad: shader compile\/link failed[\s\S]*vertex shader:[\s\S]*fake compile error[\s\S]*2: void main\(\) \{ BROKEN; \}/);
    dev.destroy();
  });

  it('validates stream layouts', () => {
    const ok = { stepMode: 'instance', stride: 48, attributes: [{ location: 0, format: vf('i32', 3, 'int'), offset: 0 }] } as const;
    expect(() => validateStreams([ok], 16, 't')).not.toThrow();
    expect(() => validateStreams([{ ...ok, stride: 0 }], 16, 't')).toThrow(/stride/);
    expect(() =>
      validateStreams([{ ...ok, attributes: [{ location: 0, format: vf('i32', 1, 'int'), offset: 2 }] }], 16, 't'),
    ).toThrow(/not aligned/);
    expect(() =>
      validateStreams([{ ...ok, attributes: [{ location: 0, format: vf('i32', 4, 'int'), offset: 40 }] }], 16, 't'),
    ).toThrow(/exceeds stride/);
    expect(() => validateStreams([ok, ok], 16, 't')).toThrow(/duplicate/);
    expect(() =>
      validateStreams([{ ...ok, attributes: [{ location: 0, format: vf('f32', 1, 'norm'), offset: 0 }] }], 16, 't'),
    ).toThrow(/f32/);
    expect(() =>
      validateStreams([{ ...ok, attributes: [{ location: 16, format: vf('u8', 1, 'int'), offset: 0 }] }], 16, 't'),
    ).toThrow(/out of range/);
  });

  it('uses WEBGL_multi_draw and the GPU timer when available', () => {
    const multi: GlCall[] = [];
    const canvas = new FakeCanvas({
      extensions: {
        WEBGL_multi_draw: {
          multiDrawElementsInstancedWEBGL: (...args: unknown[]) => multi.push({ name: 'multi', args }),
        },
        EXT_disjoint_timer_query_webgl2: {},
      },
    });
    const dev = createWebGL2Device(canvas);
    expect(dev.caps.multiDraw).toBe(true);
    expect(dev.caps.timerQuery).toBe(true);
    const vbo = dev.createBuffer({ usage: 'vertex', size: 64 });
    const ibo = dev.createBuffer({ usage: 'index', size: 12 });
    const pipe = dev.createPipeline({
      vertex: 'v',
      fragment: 'f',
      streams: [{ stepMode: 'vertex', stride: 12, attributes: [{ location: 0, format: vf('f32', 3, 'float'), offset: 0 }] }],
    });
    dev.beginFrame();
    const enc = dev.beginPass({ clearColor: [0, 0, 0, 1], clearDepth: 1 });
    enc.setPipeline(pipe);
    enc.setVertexStreams([{ buffer: vbo, offset: 0 }]);
    enc.setIndexBuffer(ibo, 'uint16');
    expect(enc.multiDrawIndexedInstanced).toBeDefined();
    enc.multiDrawIndexedInstanced!(Int32Array.of(3, 3), Int32Array.of(0, 6), Int32Array.of(2, 5), 2);
    enc.end();
    dev.endFrame();
    expect(multi.length).toBe(1);
    expect(multi[0]!.args[8]).toBe(2);
    expect(dev.counters.drawCalls).toBe(1);
    expect(dev.counters.instances).toBe(7);
    expect(canvas.gl.named('beginQuery')[0]!.args[0]).toBe(GL.TIME_ELAPSED_EXT);
    expect(canvas.gl.named('endQuery').length).toBe(1);
    // Index buffers are first bound to ELEMENT_ARRAY_BUFFER (WebGL buffer type rule).
    const firstBinds = canvas.gl.named('bindBuffer').filter((c) => c.args[1] !== null);
    expect(firstBinds[1]!.args[0]).toBe(GL.ELEMENT_ARRAY_BUFFER);
    dev.destroy();
  });

  it('resizes the drawing buffer from CSS size × pixel ratio × render scale', () => {
    const canvas = new FakeCanvas();
    canvas.clientWidth = 1000;
    canvas.clientHeight = 500;
    const r = createRenderer(canvas, { renderScale: 0.8, pixelRatio: 2 });
    expect([canvas.width, canvas.height]).toEqual([1600, 800]);
    expect(r.resize()).toBe(false);
    canvas.clientWidth = 500;
    expect(r.resize()).toBe(true);
    expect(canvas.width).toBe(800);
    r.dispose();
  });
});
