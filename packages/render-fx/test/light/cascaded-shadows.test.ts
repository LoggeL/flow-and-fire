import { RtsCamera, createWebGL2Device } from '@faf/render';
import type { PassEncoder } from '@faf/render';
import { describe, expect, it } from 'vitest';
import { SLOT_FX_SHADOW, UNIT_FX_SHADOW_DYNAMIC, UNIT_FX_SHADOW_STATIC } from '../../src/core/slots.ts';
import { CascadedShadows, NullShadowReceiver, SHADOW_CASTER_SLOT, SHADOW_RECV_LAYOUT } from '../../src/light/index.ts';
import type { ShadowCasterFn, ShadowCasterView } from '../../src/light/index.ts';
import { FakeCanvas } from '../support/fake-gl.ts';

const SUN: [number, number, number] = [0.45, 0.8, 0.35];

function setup(cascades: 1 | 2 = 2) {
  const canvas = new FakeCanvas({ loseContext: true });
  const dev = createWebGL2Device(canvas);
  const csm = new CascadedShadows(dev, { size: 1024, cascades });
  const cam = new RtsCamera({ distance: 90 });
  cam.setViewport(960, 540);
  cam.setTargetWU(300, 0, 300);
  cam.update();
  return { canvas, gl: canvas.gl, dev, csm, cam };
}

/** Caster callback that records its calls and issues `n` fake draws. */
function recorder(n = 1) {
  const calls: { cascade: number; layer: string; view: ShadowCasterView }[] = [];
  const fn: ShadowCasterFn = (enc: PassEncoder, cascade, view) => {
    calls.push({ cascade, layer: view.layer, view });
    void enc;
    return n;
  };
  return { calls, fn };
}

describe('CascadedShadows', () => {
  it('creates two depth24 2D-array textures with compare lequal and one caster UBO per cascade', () => {
    const { gl, csm } = setup();
    const storage = gl.named('texStorage3D');
    expect(storage.length).toBe(2);
    for (const c of storage) {
      expect(c.args[2]).toBe(0x81a6); // DEPTH_COMPONENT24
      expect(c.args[3]).toBe(1024);
      expect(c.args[5]).toBe(2); // layers
    }
    const compare = gl.named('texParameteri').filter((c) => c.args[1] === 0x884d); // TEXTURE_COMPARE_FUNC
    expect(compare.length).toBe(2);
    expect(compare.every((c) => c.args[2] === 0x0203)).toBe(true); // LEQUAL
    const b = csm.receiverBindings();
    expect(b.buffers).toEqual([{ slot: SLOT_FX_SHADOW, buffer: expect.any(Number) }]);
    expect(b.textures).toEqual([
      { unit: UNIT_FX_SHADOW_STATIC, texture: csm.staticTex },
      { unit: UNIT_FX_SHADOW_DYNAMIC, texture: csm.dynamicTex },
    ]);
    expect(csm.receiverBindings()).toBe(b);
    csm.destroy();
  });

  it('renders the static layer once and keeps it for 300 frames of a resting camera', () => {
    const { gl, csm, cam } = setup();
    const stat = recorder(3);
    const dyn = recorder(2);
    let dynamicPasses = 0;
    for (let frame = 0; frame < 301; frame++) {
      const r = csm.update(cam, SUN);
      if (frame === 0) expect([...r.staticDirty]).toEqual([true, true]);
      else expect([...r.staticDirty]).toEqual([false, false]);
      csm.renderStatic(stat.fn);
      gl.resetCalls();
      expect(csm.renderDynamic(dyn.fn)).toBe(4);
      dynamicPasses += gl.named('framebufferTextureLayer').length > 0 || gl.named('clearBufferfv').length > 0 ? 1 : 0;
    }
    expect(csm.stats.staticRefreshes).toBe(1);
    expect(csm.stats.staticCascadeRefreshes).toBe(2);
    expect(csm.stats.refits).toBe(2);
    expect(stat.calls.map((c) => [c.cascade, c.layer])).toEqual([
      [0, 'static'],
      [1, 'static'],
    ]);
    expect(dyn.calls.length).toBe(301 * 2);
    expect(dyn.calls.every((c) => c.layer === 'dynamic')).toBe(true);
    expect(csm.stats.dynamicDraws).toBe(4);
    expect(csm.stats.staticDraws).toBe(0); // last renderStatic had nothing to do
    expect(dynamicPasses).toBe(301);
  });

  it('dynamic passes clear their own layer every frame', () => {
    const { gl, csm, cam } = setup();
    csm.update(cam, SUN);
    csm.renderStatic(recorder().fn);
    gl.resetCalls();
    csm.renderDynamic(recorder(0).fn);
    const clears = gl.named('clearBufferfv');
    expect(clears.length).toBe(2);
    const layers = gl.named('framebufferTextureLayer').map((c) => c.args[4]);
    expect(layers.sort()).toEqual([0, 1]);
  });

  it('caster views expose anchor, frustum, matrix and the caster UBO binding', () => {
    const { csm, cam } = setup();
    csm.update(cam, SUN);
    const v = csm.casterView(1, 'static');
    expect(v.cascade).toBe(1);
    expect(v.casterSlot).toBe(SHADOW_CASTER_SLOT);
    expect(v.bindGroupEntry.slot).toBe(SHADOW_CASTER_SLOT);
    const cas = csm.fitter.cascades[1]!;
    expect(v.anchorRaw).toBe(cas.anchor);
    expect(v.frustum).toBe(cas.frustum);
    expect([...v.lightViewProj]).toEqual([...cas.lightVP32]);
    expect(v.texelWu).toBeCloseTo((2 * cas.half) / 1024, 12);
    expect(csm.casterView(1, 'dynamic').bindGroup).toBe(v.bindGroup);
    expect(() => csm.casterView(2, 'static')).toThrow(RangeError);
  });

  it('pans within the headroom keep the cache, a jump re-renders it', () => {
    const { csm, cam } = setup();
    csm.update(cam, SUN);
    csm.renderStatic(recorder().fn);
    for (let i = 0; i < 10; i++) {
      cam.pan(0.5, 0.5);
      cam.update();
      expect([...csm.update(cam, SUN).staticDirty]).toEqual([false, false]);
      csm.renderStatic(recorder().fn);
    }
    expect(csm.stats.staticRefreshes).toBe(1);
    cam.setTargetWU(2000, 0, 3000);
    cam.update();
    expect([...csm.update(cam, SUN).staticDirty]).toEqual([true, true]);
    csm.renderStatic(recorder().fn);
    expect(csm.stats.staticRefreshes).toBe(2);
  });

  it('invalidateStatic re-renders every static layer once', () => {
    const { csm, cam } = setup();
    csm.update(cam, SUN);
    csm.renderStatic(recorder().fn);
    csm.invalidateStatic();
    expect([...csm.update(cam, SUN).staticDirty]).toEqual([true, true]);
    const r = recorder(5);
    expect(csm.renderStatic(r.fn)).toBe(10);
    expect(csm.stats.staticDraws).toBe(10);
    expect(csm.stats.refits).toBe(2); // boxes unchanged
    expect([...csm.update(cam, SUN).staticDirty]).toEqual([false, false]);
    expect(csm.stats.staticRefreshes).toBe(2);
  });

  it('marks the static cache dirty after a context restore and skips rendering while lost', () => {
    const { gl, dev, csm, cam } = setup();
    csm.update(cam, SUN);
    csm.renderStatic(recorder().fn);
    const textures = gl.created('texture');
    gl.lose();
    expect(dev.isLost()).toBe(true);
    const whileLost = recorder();
    csm.update(cam, SUN);
    expect(csm.renderStatic(whileLost.fn)).toBe(0);
    expect(whileLost.calls.length).toBe(0);
    gl.restore();
    expect(csm.stats.restores).toBe(1);
    expect(gl.created('texture')).toBe(textures); // re-created by the registry
    expect([...csm.update(cam, SUN).staticDirty]).toEqual([true, true]);
    const after = recorder();
    csm.renderStatic(after.fn);
    expect(after.calls.length).toBe(2);
    expect(csm.stats.staticRefreshes).toBe(2);
  });

  it('writes receiver uniforms every update: matrices, forward, splits, params', () => {
    const { gl, csm, cam } = setup();
    // Before the first update shadows are off (fwd.w = 0).
    const L = SHADOW_RECV_LAYOUT;
    let data = gl.state.bufferData.get(gl.state.lastBufferWrite!) as Float32Array;
    expect(data[(L.offsetOf('fwd') >> 2) + 3]).toBe(0);
    csm.update(cam, SUN);
    data = gl.state.bufferData.get(gl.state.lastBufferWrite!) as Float32Array;
    expect(data.length).toBe(L.size >> 2);
    const fwd = L.offsetOf('fwd') >> 2;
    expect(data[fwd]).toBeCloseTo(cam.forward[0]!, 6);
    expect(data[fwd + 3]).toBe(1);
    const sp = L.offsetOf('split') >> 2;
    expect(data[sp]).toBeCloseTo(csm.fitter.splits[1]!, 3);
    expect(data[sp + 1]).toBeCloseTo(csm.fitter.splits[2]!, 3);
    const p = L.offsetOf('params') >> 2;
    expect(data[p]).toBeCloseTo(0.72, 6);
    expect(data[p + 1]).toBeCloseTo(csm.fitter.cascades[0]!.texelWu * 1.2, 5);
    expect(data[(L.offsetOf('info') >> 2)]).toBe(2);
    // Moving the camera rewrites the matrices without a refit.
    cam.pan(0.25, 0);
    cam.update();
    gl.resetCalls();
    csm.update(cam, SUN);
    expect(gl.named('bufferSubData').length).toBe(1);
  });

  it('works with a single cascade', () => {
    const { gl, csm, cam } = setup(1);
    expect(gl.named('texStorage3D')[0]!.args[5]).toBe(1);
    expect([...csm.update(cam, SUN).staticDirty]).toEqual([true]);
    const r = recorder();
    csm.renderStatic(r.fn);
    csm.renderDynamic(r.fn);
    expect(r.calls.length).toBe(2);
    csm.update(cam, SUN);
    const data = gl.state.bufferData.get(gl.state.lastBufferWrite!) as Float32Array;
    expect(data[SHADOW_RECV_LAYOUT.offsetOf('info') >> 2]).toBe(1);
    // One cascade: the split equals the shadow end (no blend band).
    const sp = SHADOW_RECV_LAYOUT.offsetOf('split') >> 2;
    expect(data[sp]).toBe(data[sp + 1]);
    expect(data[sp + 3]).toBe(0);
    csm.destroy();
  });

  it('NullShadowReceiver binds a disabled block', () => {
    const canvas = new FakeCanvas();
    const dev = createWebGL2Device(canvas);
    const n = new NullShadowReceiver(dev);
    const b = n.receiverBindings();
    expect(b.buffers[0]!.slot).toBe(SLOT_FX_SHADOW);
    expect(b.textures.map((t) => t.unit)).toEqual([UNIT_FX_SHADOW_STATIC, UNIT_FX_SHADOW_DYNAMIC]);
    const data = canvas.gl.state.bufferData.get(canvas.gl.state.lastBufferWrite!) as Float32Array;
    expect(data[(SHADOW_RECV_LAYOUT.offsetOf('fwd') >> 2) + 3]).toBe(0);
    n.destroy();
  });
});
