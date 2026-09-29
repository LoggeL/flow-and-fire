import { describe, expect, it } from 'vitest';
import { RtsCamera } from '../src/camera.ts';
import { UnitRecordWriter } from '../src/instance-layout.ts';
import { createRenderer } from '../src/renderer.ts';
import { createWebGL2Device } from '../src/webgl2/device.ts';
import type { RegisteredResource } from '../src/webgl2/registry.ts';
import { ContextLossRegistry } from '../src/webgl2/registry.ts';
import { FakeCanvas } from './support/fake-gl.ts';

describe('ContextLossRegistry', () => {
  it('releases on loss, re-realizes everything on restore, then runs upload callbacks', () => {
    const canvas = new FakeCanvas();
    const log: string[] = [];
    const reg = new ContextLossRegistry(canvas, { beforeRealize: () => log.push('hook') }, false);
    const mk = (name: string, withRestore: boolean): RegisteredResource => ({
      realize: () => log.push(`realize:${name}`),
      release: (del) => log.push(`release:${name}:${del}`),
      restore: withRestore ? () => log.push(`restore:${name}`) : undefined,
    });
    const a = reg.register(mk('a', true));
    const b = reg.register(mk('b', false));
    const c = reg.register(mk('c', true));
    expect([a, b, c]).toEqual([1, 2, 3]);
    reg.unregister(b);
    expect(reg.liveCount()).toBe(2);
    let lostCalls = 0;
    let restoredCalls = 0;
    reg.onLost(() => lostCalls++);
    reg.onRestored(() => restoredCalls++);
    log.length = 0;

    const ev = canvas.dispatch('webglcontextlost');
    expect(ev.defaultPrevented).toBe(true); // required for webglcontextrestored to fire
    expect(reg.isLost()).toBe(true);
    expect(log).toEqual(['release:a:false', 'release:c:false']);
    expect(lostCalls).toBe(1);

    // Resources registered while lost are realized on restore.
    reg.register(mk('d', true));
    log.length = 0;
    canvas.dispatch('webglcontextrestored');
    expect(reg.isLost()).toBe(false);
    expect(log).toEqual(['hook', 'realize:a', 'realize:c', 'realize:d', 'restore:a', 'restore:c', 'restore:d']);
    expect(restoredCalls).toBe(1);
    expect(reg.restoreCount).toBe(1);

    reg.dispose();
    expect(canvas.listenerCount('webglcontextlost')).toBe(0);
    expect(canvas.listenerCount('webglcontextrestored')).toBe(0);
  });
});

describe('WebGL2 device context loss', () => {
  it('re-creates all GPU objects after restore and rewrites registered contents', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const dev = createWebGL2Device(canvas);
    const data = Uint8Array.of(1, 2, 3, 4);
    const restored: number[] = [];
    const buf = dev.createBuffer({
      usage: 'vertex',
      size: 4,
      restore: (h) => {
        restored.push(h);
        dev.writeBuffer(h, 0, data);
      },
    });
    dev.writeBuffer(buf, 0, data);
    const tex = dev.createTexture({ width: 2, height: 2, format: 'rgba8', restore: (h) => restored.push(h) });
    const pipe = dev.createPipeline({ vertex: 'v', fragment: 'f', streams: [] });
    expect(gl.created('buffer')).toBe(1);

    gl.lose();
    expect(dev.isLost()).toBe(true);
    // Calls while lost are no-ops and do not throw.
    dev.writeBuffer(buf, 0, data);
    const enc = dev.beginPass({ clearColor: [0, 0, 0, 1] });
    enc.setPipeline(pipe);
    enc.drawInstanced(3, 1);
    enc.end();
    expect(dev.counters.drawCalls).toBe(0);

    gl.resetCalls();
    gl.restore();
    expect(dev.isLost()).toBe(false);
    expect(gl.generation).toBe(2);
    expect(gl.created('buffer')).toBe(1);
    expect(gl.created('texture')).toBe(1);
    expect(gl.created('program')).toBe(1);
    expect(restored).toEqual([buf, tex]);
    const upload = gl.named('bufferSubData');
    expect(upload.length).toBe(1);
    expect(upload[0]!.args[2]).toBe(data);
    // State caches were reset: the next pass issues fresh state.
    gl.resetCalls();
    const enc2 = dev.beginPass({});
    enc2.setPipeline(pipe);
    enc2.setVertexStreams([]);
    enc2.drawInstanced(3, 1);
    enc2.end();
    expect(gl.named('useProgram').length).toBe(1);
    expect(gl.named('viewport').length).toBe(1);
    expect(dev.counters.drawCalls).toBe(1);
    dev.destroy();
  });

  it('renderer survives loss/restore: skips frames while lost, re-uploads units afterwards', () => {
    const canvas = new FakeCanvas();
    const gl = canvas.gl;
    const r = createRenderer(canvas);
    r.setVisuals([{ spec: { hull: 'box', size: [1, 1, 1] } }]);
    const w = new UnitRecordWriter(8);
    for (let i = 0; i < 8; i++) w.write(i, { prevX: 0, prevY: 0, prevZ: 0, x: i * 4096, y: 0, z: 0, prevYaw: 0, yaw: 0, visual: 0, army: 0 });
    const camera = new RtsCamera();
    const v = { camera, units: { bytes: w.bytes, count: 8, version: 7 }, alpha: 1, timeMs: 0 };
    r.render(v);
    expect(r.stats.drawCalls).toBe(1); // one visual; no terrain set ⇒ no ground draw
    const buffersBefore = gl.named('createBuffer').length - gl.named('deleteBuffer').length;
    const programsBefore = gl.named('createProgram').length - gl.named('deleteProgram').length;

    gl.lose();
    r.render(v);
    expect(r.stats.lost).toBe(true);
    expect(r.stats.drawCalls).toBe(0);

    gl.resetCalls();
    gl.restore();
    // Every live buffer and pipeline exists again in the new context generation.
    expect(gl.created('buffer')).toBe(buffersBefore);
    expect(gl.created('program')).toBe(programsBefore);
    // Static contents (mesh VBO/IBO, palette and frame UBOs) were rewritten.
    expect(gl.named('bufferSubData').length).toBe(4);

    gl.resetCalls();
    r.render(v); // same version: the ring must still be re-uploaded after the restore
    expect(r.stats.lost).toBe(false);
    expect(r.stats.drawCalls).toBe(1); // one visual; no terrain set ⇒ no ground draw
    expect(gl.named('bufferSubData').length).toBe(1 + 2);
    r.dispose();
  });
});
