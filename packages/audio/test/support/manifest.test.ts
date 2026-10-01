import { describe, expect, it } from 'vitest';
import { FakeAudioBuffer, FakeAudioContext } from './fake-audio-context.ts';
import { categoryFromName, fakeBuffersFor, loadRealManifest, makeManifest, realManifestBytes, realWebmBytes } from './manifest.ts';

describe('test support: manifest helpers', () => {
  it('loads the real manifest (101 sounds, 246 variants)', () => {
    const m = loadRealManifest();
    expect(m.version).toBe(1);
    expect(m.sampleRate).toBe(48000);
    expect(m.maxVoices).toBe(32);
    expect(m.sounds).toHaveLength(101);
    expect(m.sounds.reduce((n, s) => n + s.variants.length, 0)).toBe(246);
    expect(new TextDecoder().decode(realManifestBytes()).startsWith('{')).toBe(true);
  });

  it('reads real .webm bytes (EBML magic) and refuses other paths', () => {
    const m = loadRealManifest();
    const v = m.sounds[0]!.variants[0]!;
    const a = realWebmBytes(v.opus);
    expect(Array.from(new Uint8Array(a, 0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const b = realWebmBytes(v.opus);
    expect(b).not.toBe(a);
    expect(() => realWebmBytes(v.wav)).toThrow();
    expect(() => realWebmBytes('../dist/common/x.v0.webm')).toThrow();
  });

  it('every sound name prefix implies its manifest category', () => {
    for (const s of loadRealManifest().sounds) expect(categoryFromName(s.name), s.id).toBe(s.category);
  });

  it('builds synthetic manifests with override pairs and loops', () => {
    const m = makeManifest({
      sounds: [
        { id: 'common:wpn_x' },
        { id: 'varkan:wpn_x', variants: 3 },
        { id: 'common:bld_pour_loop', loop: true, durationS: 1 },
        { id: 'common:alt_x', cooldownMs: 15000, priority: 99 },
      ],
      categories: { weapon: { maxVoices: 2 } },
    });
    expect(m.sounds.map((s) => s.category)).toEqual(['weapon', 'weapon', 'build', 'alert']);
    const [cx, vx, loop, alt] = m.sounds;
    expect(cx!.maxVoices).toBe(2);
    expect(vx!.variants.map((v) => v.opus)).toEqual(['varkan/wpn_x.v0.webm', 'varkan/wpn_x.v1.webm', 'varkan/wpn_x.v2.webm']);
    expect(loop!.loop).toEqual({ startSample: 1920, endSample: 49920, startS: 0.04, endS: 1.04 });
    expect(loop!.variants[0]!.samples).toBe(51840);
    expect(alt!.bus).toBe('voice');
    expect(alt!.cooldownMs).toBe(15000);
    expect(() => makeManifest({ sounds: [{ id: 'nope' }] })).toThrow();
    expect(() => makeManifest({ sounds: [{ id: 'a:b' }, { id: 'a:b' }] })).toThrow();
  });

  it('creates lazy fake buffers at the context rate', () => {
    const m = loadRealManifest();
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    const bufs = fakeBuffersFor(m, ctx);
    expect(bufs.size).toBe(101);
    const amb = m.sounds.find((s) => s.id === 'common:amb_magma_loop')!;
    const b = bufs.get(amb.id)![0]!;
    expect(b.numberOfChannels).toBe(2);
    expect(b.sampleRate).toBe(44100);
    expect(b.length).toBe(Math.round((amb.variants[0]!.samples * 44100) / 48000));
    expect(b instanceof FakeAudioBuffer && b.isMaterialized(0)).toBe(false);
    const filled = fakeBuffersFor(makeManifest({ sounds: [{ id: 'common:ui_x', durationS: 0.01 }] }), ctx, {
      fill: (d) => d.fill(0.5),
    });
    expect(filled.get('common:ui_x')![0]!.getChannelData(1)[0]).toBe(0.5);
  });
});
