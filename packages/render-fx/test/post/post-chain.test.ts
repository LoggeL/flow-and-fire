import { RENDER_PRESETS, createWebGL2Device } from '@faf/render';
import { describe, expect, it } from 'vitest';
import {
  ACES_GLSL,
  DEFAULT_POST_OPTIONS,
  PostChain,
  acesFilm,
  bloomLevelSize,
  compositeHdr,
  kawaseOffsets,
  postOptionsForPreset,
} from '../../src/post/index.ts';
import type { PostOptions } from '../../src/post/index.ts';
import { COMPOSITE_FS, DOWN_FS, UP_FS } from '../../src/post/shaders.ts';
import { FakeCanvas } from '../support/fake-gl.ts';

const GL_RGBA16F = 0x881a;
const GL_RGBA8 = 0x8058;

function setup(opts: Partial<PostOptions> = {}, hdrCaps = true, size: [number, number] = [960, 540]) {
  const canvas = new FakeCanvas({ colorBufferFloat: hdrCaps, loseContext: true });
  canvas.width = size[0];
  canvas.height = size[1];
  const dev = createWebGL2Device(canvas);
  const post = new PostChain(dev, { ...DEFAULT_POST_OPTIONS, ...opts });
  return { canvas, gl: canvas.gl, dev, post };
}

describe('tonemapping references', () => {
  it('acesFilm: 0 → 0, monotonic, below 1 for mid values, clamped to 1', () => {
    expect(acesFilm(0)).toBe(0);
    expect(acesFilm(0.18)).toBeCloseTo(0.2669, 4);
    expect(acesFilm(1)).toBeCloseTo(0.8038, 4);
    let prev = -1;
    for (let i = 0; i <= 2000; i++) {
      const v = acesFilm(i * 0.01);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(acesFilm(4)).toBeLessThan(1);
    expect(acesFilm(1e6)).toBe(1);
    expect(ACES_GLSL).toContain('2.51');
    expect(ACES_GLSL).toContain('0.14');
  });

  it('compositeHdr maps black to black and bright values towards white', () => {
    expect(compositeHdr(0, 1.1)).toBe(0);
    expect(compositeHdr(0.5, 1.1)).toBeLessThan(compositeHdr(1, 1.1));
    expect(compositeHdr(20, 1.1)).toBe(1);
  });

  it('kawaseOffsets scales the tap footprint per level and keeps the weights', () => {
    const l1 = kawaseOffsets(1);
    expect(l1.downWeightSum).toBe(8);
    expect(l1.upWeightSum).toBe(12);
    expect(l1.down).toContainEqual([0.5, 0.5, 1]);
    expect(l1.up).toContainEqual([2, 0, 1]);
    const l5 = kawaseOffsets(5);
    expect(l5.down).toContainEqual([8, 8, 1]);
    expect(l5.up).toContainEqual([-16, -16, 2]);
    expect(() => kawaseOffsets(0)).toThrow(RangeError);
    expect(() => kawaseOffsets(7)).toThrow(RangeError);
    // The shaders are generated from the same tables.
    expect(DOWN_FS).toContain('vec2(-0.5, -0.5) * u_texel.xy');
    expect(UP_FS).toContain('vec2(-1.0, 0.0) * u_texel.xy');
    expect(UP_FS).toContain('* 2.0');
    expect(COMPOSITE_FS).toContain('fxAces');
  });

  it('bloom level sizes use max(1, floor(size / 2^i))', () => {
    expect(bloomLevelSize(1537, 865, 1)).toEqual({ width: 768, height: 432 });
    expect(bloomLevelSize(1537, 865, 5)).toEqual({ width: 48, height: 27 });
    expect(bloomLevelSize(3, 3, 2)).toEqual({ width: 1, height: 1 });
    expect(bloomLevelSize(3, 3, 6)).toEqual({ width: 1, height: 1 });
  });
});

describe('postOptionsForPreset', () => {
  it('maps Low to LDR without bloom and Medium–Ultra to HDR + bloom 5 + FXAA', () => {
    const low = postOptionsForPreset('low');
    expect([low.hdr, low.bloom, low.fxaa]).toEqual([false, false, true]);
    for (const p of ['medium', 'high', 'ultra'] as const) {
      const o = postOptionsForPreset(RENDER_PRESETS[p]);
      expect([o.hdr, o.bloom, o.bloomLevels, o.fxaa]).toEqual([true, true, 5, true]);
      expect(o.exposure).toBe(1.1);
      expect(o.bloomIntensity).toBe(0.55);
      expect(o.bloomThreshold).toBe(0.9);
    }
  });
});

describe('PostChain', () => {
  it('allocates the HDR chain: scene, depth, 5 down, 4 up, LDR – 4 pipelines, 11 draws', () => {
    const { gl, dev, post } = setup();
    expect(post.hdrActive).toBe(true);
    expect(post.sceneFormat).toBe('rgba16f');
    expect(post.width).toBe(960);
    expect(post.height).toBe(540);
    const t = post.targetInfo();
    expect(t.map((x) => x.label)).toEqual([
      'fx.post.scene',
      'fx.post.depth',
      'fx.post.down1',
      'fx.post.down2',
      'fx.post.down3',
      'fx.post.down4',
      'fx.post.down5',
      'fx.post.up1',
      'fx.post.up2',
      'fx.post.up3',
      'fx.post.up4',
      'fx.post.ldr',
    ]);
    expect(t.find((x) => x.label === 'fx.post.depth')!.format).toBe('depth24');
    expect(t.find((x) => x.label === 'fx.post.down5')).toMatchObject({ width: 30, height: 16, format: 'rgba16f' });
    expect(t.find((x) => x.label === 'fx.post.ldr')!.format).toBe('rgba8');
    expect(gl.created('program')).toBe(4);
    const storage = gl.named('texStorage2D').map((c) => c.args[2]);
    expect(storage.filter((f) => f === GL_RGBA16F).length).toBe(10);
    dev.beginFrame();
    gl.resetCalls();
    expect(post.resolve()).toBe(11);
    expect(post.stats).toMatchObject({ draws: 11, hdr: true, bloomLevels: 5, fxaa: true });
    expect(gl.named('drawArraysInstanced').length).toBe(11);
    expect(dev.counters.drawCalls).toBe(11);
    // The last pass (FXAA) renders into the canvas.
    expect(gl.state.framebuffer).toBeNull();
    post.destroy();
  });

  it('falls back to an RGBA8 scene without EXT_color_buffer_float', () => {
    const { gl, post } = setup({}, false);
    expect(post.hdrActive).toBe(false);
    expect(post.stats.hdr).toBe(false);
    expect(post.sceneFormat).toBe('rgba8');
    const storage = gl.named('texStorage2D').map((c) => c.args[2]);
    expect(storage).not.toContain(GL_RGBA16F);
    expect(storage.filter((f) => f === GL_RGBA8).length).toBe(11);
    expect(post.resolve()).toBe(11);
    // hdr: false with float support → LDR as well.
    const b = setup({ hdr: false }, true);
    expect(b.post.hdrActive).toBe(false);
    expect(b.gl.named('texStorage2D').map((c) => c.args[2])).not.toContain(GL_RGBA16F);
  });

  it('creates only the resources an option set needs', () => {
    const none = setup({ bloom: false, fxaa: false });
    expect(none.post.targetInfo().map((x) => x.label)).toEqual(['fx.post.scene', 'fx.post.depth']);
    expect(none.gl.created('program')).toBe(1);
    expect(none.post.resolve()).toBe(1);
    expect(none.gl.state.framebuffer).toBeNull();

    const fxaaOnly = setup({ bloom: false, fxaa: true });
    expect(fxaaOnly.post.targetInfo().length).toBe(3);
    expect(fxaaOnly.gl.created('program')).toBe(2);
    expect(fxaaOnly.post.resolve()).toBe(2);

    const one = setup({ bloomLevels: 1 });
    expect(one.post.targetInfo().map((x) => x.label)).toEqual(['fx.post.scene', 'fx.post.depth', 'fx.post.down1', 'fx.post.ldr']);
    expect(one.gl.created('program')).toBe(3); // down, composite, fxaa (no up pass)
    expect(one.post.resolve()).toBe(3);

    const six = setup({ bloomLevels: 6 });
    expect(six.post.resolve()).toBe(6 + 5 + 1 + 1);
    expect(() => setup({ bloomLevels: 7 })).toThrow(RangeError);
    expect(() => setup({ exposure: -1 })).toThrow(RangeError);
  });

  it('sizes the bloom chain of odd resolutions with max(1, floor(w / 2^i))', () => {
    const { post } = setup({ bloomLevels: 6 }, true, [1537, 865]);
    const t = post.targetInfo();
    for (let i = 1; i <= 6; i++) {
      const d = t.find((x) => x.label === `fx.post.down${i}`)!;
      expect([d.width, d.height]).toEqual([Math.max(1, Math.floor(1537 / 2 ** i)), Math.max(1, Math.floor(865 / 2 ** i))]);
    }
    post.resize(5, 3);
    const tiny = post.targetInfo();
    expect(tiny.find((x) => x.label === 'fx.post.down1')).toMatchObject({ width: 2, height: 1 });
    expect(tiny.find((x) => x.label === 'fx.post.down6')).toMatchObject({ width: 1, height: 1 });
    expect(post.resolve()).toBe(13);
  });

  it('resize reallocates only on a real size change', () => {
    const { gl, post } = setup();
    const scene = post.sceneColor;
    const textures = gl.created('texture');
    expect(post.stats.allocations).toBe(1);
    post.resize(960, 540);
    expect(gl.created('texture')).toBe(textures);
    expect(post.stats.allocations).toBe(1);
    expect(post.sceneColor).toBe(scene);
    gl.resetCalls();
    post.resize(1280, 720);
    expect(post.stats.allocations).toBe(2);
    expect(gl.created('texture')).toBe(textures + 12);
    expect(gl.named('deleteTexture').length).toBe(12);
    expect(post.targetInfo()[0]).toMatchObject({ width: 1280, height: 720 });
    post.resize(0, -5);
    expect([post.width, post.height]).toEqual([1, 1]);
  });

  it('caches the scene pass descriptor and renders the scene into the offscreen targets', () => {
    const { gl, post } = setup();
    const a = post.scenePass([0.1, 0.2, 0.3]);
    expect(post.scenePass([0.1, 0.2, 0.3])).toBe(a);
    expect(a.clearColor).toEqual([0.1, 0.2, 0.3, 1]);
    expect(a.clearDepth).toBe(1);
    expect(a.colorAttachments![0]!.texture).toBe(post.sceneColor);
    expect(a.depthAttachment!.texture).toBe(post.sceneDepth);
    const b = post.scenePass([0.1, 0.2, 0.4, 1]);
    expect(b).not.toBe(a);
    post.resize(640, 360);
    const c = post.scenePass([0.1, 0.2, 0.4, 1]);
    expect(c).not.toBe(b);
    expect(c.colorAttachments![0]!.texture).toBe(post.sceneColor);
    const enc = post.beginScene([0, 0, 0]);
    expect(gl.state.framebuffer).not.toBeNull();
    enc.end();
    expect(post.sceneLoadPass().clearColor).toBeUndefined();
  });

  it('setOptions rewrites uniforms for parameters and rebuilds only for structural changes', () => {
    const { gl, post } = setup();
    const textures = gl.created('texture');
    gl.resetCalls();
    post.setOptions({ exposure: 2, bloomIntensity: 0.3, bloomThreshold: 1.2, bloomKnee: 0.2 });
    expect(post.stats.allocations).toBe(1);
    expect(gl.created('texture')).toBe(textures);
    expect(gl.named('bufferSubData').length).toBe(1);
    const ubo = gl.state.bufferData.get(gl.state.lastBufferWrite!) as Float32Array;
    // Composite step (index 9 with bloom 5): params = exposure, bloom intensity, hdr, luma alpha.
    const stride = 256 / 4;
    expect([...ubo.subarray(9 * stride + 4, 9 * stride + 8)]).toEqual([2, Math.fround(0.3), 1, 1]);
    // First down step: threshold, knee, prefilter on.
    expect([...ubo.subarray(4, 7)]).toEqual([Math.fround(1.2), Math.fround(0.2), 1]);
    post.setOptions({ bloomLevels: 3 });
    expect(post.stats.allocations).toBe(2);
    expect(post.resolve()).toBe(3 + 2 + 1 + 1);
    post.setOptions({ fxaa: false });
    expect(post.resolve()).toBe(3 + 2 + 1);
    const ubo2 = gl.state.bufferData.get(gl.state.lastBufferWrite!) as Float32Array;
    // Without FXAA the composite writes alpha 1 into the canvas.
    expect(ubo2[5 * stride + 7]).toBe(0);
    post.setOptions({ hdr: false });
    expect(post.hdrActive).toBe(false);
    expect(post.stats.hdr).toBe(false);
    post.setOptions({ bloom: false });
    expect(post.resolve()).toBe(1);
    // Changing bloomLevels while bloom is off is not structural.
    const allocs = post.stats.allocations;
    post.setOptions({ bloomLevels: 2 });
    expect(post.stats.allocations).toBe(allocs);
  });

  it('survives a context loss: the registry re-creates the targets, the chain only re-uploads its uniforms', () => {
    const { gl, dev, post } = setup();
    const liveTextures = gl.created('texture');
    const scene = post.sceneColor;
    const allocations = post.stats.allocations;
    gl.lose();
    expect(dev.isLost()).toBe(true);
    expect(post.resolve()).toBe(11); // recorded as no-ops while lost
    gl.restore();
    expect(dev.isLost()).toBe(false);
    expect(post.stats.restores).toBe(1);
    expect(post.stats.allocations).toBe(allocations);
    expect(post.sceneColor).toBe(scene);
    // Every texture of the chain exists again in the new generation (created by the registry).
    expect(gl.created('texture')).toBe(liveTextures);
    expect(gl.created('program')).toBe(4);
    gl.resetCalls();
    expect(post.resolve()).toBe(11);
    expect(gl.named('bufferSubData').length).toBe(1); // uniforms re-uploaded once
    expect(gl.named('drawArraysInstanced').length).toBe(11);
    gl.resetCalls();
    post.resolve();
    expect(gl.named('bufferSubData').length).toBe(0);
    // The attachments point at live objects of the new generation.
    for (const [fb, att] of gl.state.attachments) {
      if (fb.gen !== gl.generation) continue;
      for (const tex of att.values()) expect(tex.gen).toBe(gl.generation);
    }
    gl.resetCalls();
    post.destroy();
    expect(gl.named('deleteProgram').length).toBe(4);
  });

  it('destroy releases every resource and unsubscribes', () => {
    const { gl, post } = setup();
    gl.resetCalls();
    post.destroy();
    expect(gl.named('deleteTexture').length).toBe(12);
    expect(() => post.resolve()).toThrow();
    gl.lose();
    gl.restore();
    expect(post.stats.restores).toBe(0);
  });
});

describe('PostChain.resolve phases', () => {
  it('calls the mark callback once before each phase', () => {
    const { post } = setup();
    const phases: string[] = [];
    post.resolve((p) => phases.push(p));
    expect(phases).toEqual(['bloom', 'composite', 'fxaa']);
    post.setOptions({ bloom: false, fxaa: false });
    phases.length = 0;
    post.resolve((p) => phases.push(p));
    expect(phases).toEqual(['composite']);
  });

  it('writes the final pass into the output viewport', () => {
    const { gl, post } = setup();
    post.setOutputViewport({ x: 480, y: 0, width: 480, height: 540 });
    gl.resetCalls();
    post.resolve();
    const vp = gl.named('viewport');
    expect(vp[vp.length - 1]!.args).toEqual([480, 0, 480, 540]);
    post.setOutputViewport(null);
    gl.resetCalls();
    post.resolve();
    const vp2 = gl.named('viewport');
    expect(vp2[vp2.length - 1]!.args).toEqual([0, 0, 960, 540]);
  });
});
