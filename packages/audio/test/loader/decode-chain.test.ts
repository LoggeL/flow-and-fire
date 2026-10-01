import { describe, expect, it } from 'vitest';
import { DecodeError, createDecodeChain, nativeLengthWindow, type FetchLike, type WasmOpusModuleLike, type WebCodecsApi } from '../../src/loader/index.ts';
import type { AudioBufferLike } from '../../src/ports.ts';
import { FakeAudioContext, loadRealManifest, realWebmBytes } from '../support/index.ts';
import { createFakeWebCodecs } from './fake-webcodecs.ts';

const manifest = loadRealManifest();

function variantOf(id: string, v = 0): { opus: string; samples: number; channels: number } {
  const s = manifest.sounds.find((x) => x.id === id)!;
  return { opus: s.variants[v]!.opus, samples: s.variants[v]!.samples, channels: s.channels };
}

const MONO = variantOf('varkan:wpn_cannon_t1_fire', 1);
const STEREO = variantOf('common:ui_click', 0);
const LOOP = variantOf('varkan:bld_pour_loop', 0);

function expectOf(v: { samples: number; channels: number }): { samples: number; channels: number } {
  return { samples: v.samples, channels: v.channels };
}

function maxAbsDiff(a: AudioBufferLike, b: AudioBufferLike): number {
  let m = 0;
  for (let c = 0; c < a.numberOfChannels; c++) {
    const x = a.getChannelData(c);
    const y = b.getChannelData(c);
    for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]! - y[i]!));
  }
  return m;
}

describe('createDecodeChain — native path (fake decodeAudioData)', () => {
  it('uses decodeAudioData on a copy and accepts a matching length', async () => {
    const ctx = new FakeAudioContext();
    ctx.setDecoder((_data, c) => c.createBuffer(MONO.channels, MONO.samples + 500, 48000));
    const chain = createDecodeChain(ctx, { webCodecs: null });
    const bytes = realWebmBytes(MONO.opus);
    const size = bytes.byteLength;
    const r = await chain.decode(bytes, expectOf(MONO));
    expect(r.path).toBe('native');
    expect(r.suspicious).toBe(false);
    expect(bytes.byteLength).toBe(size); // original not detached
    expect(chain.nativeSupport).toBe('yes');
    expect(chain.stats.byPath.native).toBe(1);
  });

  it.each([-1, 1])('normalizes one terminal PCM frame of native rounding (%i) without shifting samples', async offset => {
    const ctx = new FakeAudioContext();
    ctx.setDecoder((_data, c) => { const b = c.createBuffer(1, MONO.samples + offset, 48000); b.getChannelData(0)[0] = .25; b.getChannelData(0)[100] = -.5; return b; });
    const result = await createDecodeChain(ctx, { webCodecs: null }).decode(realWebmBytes(MONO.opus), expectOf(MONO));
    expect(result.path).toBe('native'); expect(result.buffer.length).toBe(MONO.samples); expect(result.buffer.getChannelData(0)[0]).toBe(.25); expect(result.buffer.getChannelData(0)[100]).toBe(-.5); expect(result.suspicious).toBe(false);
  });

  it('flags a length outside ±2 Opus frames as suspicious but accepts it', async () => {
    const ctx = new FakeAudioContext();
    ctx.setDecoder((_data, c) => c.createBuffer(1, MONO.samples + 2 * 960 + 1, 48000));
    const chain = createDecodeChain(ctx, { webCodecs: null });
    const r = await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO));
    expect(r.path).toBe('native');
    expect(r.suspicious).toBe(true);
    expect(chain.stats.suspicious).toBe(1);
  });

  it('scales the expected length and tolerance to the context rate (44.1 kHz)', async () => {
    const w = nativeLengthWindow(48000, 44100);
    expect(w.expected).toBe(44100);
    expect(w.tolerance).toBe(Math.ceil(1920 * 44100 / 48000));
    const ctx = new FakeAudioContext({ sampleRate: 44100 });
    ctx.setDecoder((_d, c) => c.createBuffer(1, Math.round((MONO.samples * 44100) / 48000) + 1000, 44100));
    const chain = createDecodeChain(ctx, { webCodecs: null });
    expect((await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).suspicious).toBe(false);
    ctx.setDecoder((_d, c) => c.createBuffer(2, Math.round((MONO.samples * 44100) / 48000), 44100));
    expect((await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).suspicious).toBe(true); // channels differ
  });

  it('falls back when native rejects, remembers "no native Opus" and skips native afterwards', async () => {
    const ctx = new FakeAudioContext(); // default fake decoder rejects with EncodingError
    const chain = createDecodeChain(ctx); // Node: no WebCodecs globals
    const r = await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO));
    expect(r.path).toBe('wasm');
    expect(r.buffer.length).toBe(MONO.samples);
    expect(chain.nativeSupport).toBe('no');
    expect(ctx.decodeCalls).toBe(1);
    const r2 = await chain.decode(realWebmBytes(STEREO.opus), expectOf(STEREO));
    expect(r2.path).toBe('wasm');
    expect(ctx.decodeCalls).toBe(1);
    expect(chain.stats.nativeRejects).toBe(1);
    chain.dispose();
  });

  it('runs the capability probe once even for concurrent decodes', async () => {
    const ctx = new FakeAudioContext();
    const chain = createDecodeChain(ctx);
    const ids = ['varkan:wpn_cannon_t1_fire', 'common:ui_click', 'varkan:exp_small', 'common:imp_shell_ground'];
    const results = await Promise.all(ids.map((id) => chain.decode(realWebmBytes(variantOf(id).opus), expectOf(variantOf(id)))));
    expect(results.map((r) => r.path)).toEqual(['wasm', 'wasm', 'wasm', 'wasm']);
    expect(ctx.decodeCalls).toBe(1);
    ids.forEach((id, i) => expect(results[i]!.buffer.length).toBe(variantOf(id).samples));
    chain.dispose();
  });

  it('keeps native after a single native rejection once native support is known', async () => {
    const ctx = new FakeAudioContext();
    let fail = false;
    ctx.setDecoder((_d, c) => {
      if (fail) throw new DOMException('broken file', 'EncodingError');
      return c.createBuffer(MONO.channels, MONO.samples, 48000);
    });
    const chain = createDecodeChain(ctx);
    expect((await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).path).toBe('native');
    fail = true;
    expect((await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).path).toBe('wasm');
    expect(chain.nativeSupport).toBe('yes');
    fail = false;
    expect((await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).path).toBe('native');
    chain.dispose();
  });

  it('treats an empty native buffer as a rejection', async () => {
    const ctx = new FakeAudioContext();
    ctx.setDecoder(() => ({ length: 0, duration: 0, sampleRate: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(0), copyToChannel: () => {} }));
    const chain = createDecodeChain(ctx);
    expect((await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).path).toBe('wasm');
    chain.dispose();
  });
});

describe('createDecodeChain — failures and forcePath', () => {
  it('throws DecodeError with the cause chain when every path fails; probe stays open', async () => {
    const ctx = new FakeAudioContext();
    const chain = createDecodeChain(ctx);
    const junk = new Uint8Array(4000).map((_, i) => (i * 7919) & 255).buffer;
    const err = await chain.decode(junk, { samples: 1000, channels: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DecodeError);
    const de = err as DecodeError;
    expect(de.attempts.map((a) => a.path)).toEqual(['native', 'webcodecs']);
    expect(de.message).toMatch(/native: EncodingError/);
    expect(chain.nativeSupport).toBe('unknown'); // inconclusive: the file itself is broken
    expect(chain.stats.failed).toBe(1);
  });

  it('reports WASM errors (module load failure) in the chain', async () => {
    const ctx = new FakeAudioContext();
    const chain = createDecodeChain(ctx, { webCodecs: null, loadWasm: () => Promise.reject(new Error('chunk 404')) });
    const err = (await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO)).catch((e: unknown) => e)) as DecodeError;
    expect(err).toBeInstanceOf(DecodeError);
    expect(err.attempts.map((a) => a.path)).toEqual(['native', 'webcodecs', 'wasm']);
    expect(String(err.attempts[2]!.error)).toMatch(/chunk 404/);
    expect(err.cause).toBe(err.attempts[2]!.error);
  });

  it('retries the WASM module import after a failed load', async () => {
    const ctx = new FakeAudioContext();
    let calls = 0;
    const loadWasm = async (): Promise<WasmOpusModuleLike> => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return (await import('opus-decoder')) as unknown as WasmOpusModuleLike;
    };
    const chain = createDecodeChain(ctx, { forcePath: 'wasm', loadWasm });
    await expect(chain.decode(realWebmBytes(MONO.opus), expectOf(MONO))).rejects.toBeInstanceOf(DecodeError);
    const r = await chain.decode(realWebmBytes(MONO.opus), expectOf(MONO));
    expect(r.path).toBe('wasm');
    expect(calls).toBe(2);
    chain.dispose();
  });

  it('forcePath restricts the chain to one path', async () => {
    const ctx = new FakeAudioContext();
    ctx.setDecoder((_d, c) => c.createBuffer(1, MONO.samples, 48000));
    const wasm = createDecodeChain(ctx, { forcePath: 'wasm' });
    expect((await wasm.decode(realWebmBytes(MONO.opus), expectOf(MONO))).path).toBe('wasm');
    expect(ctx.decodeCalls).toBe(0);
    wasm.dispose();

    const native = createDecodeChain(new FakeAudioContext(), { forcePath: 'native' });
    const e1 = (await native.decode(realWebmBytes(MONO.opus), expectOf(MONO)).catch((e: unknown) => e)) as DecodeError;
    expect(e1.attempts.map((a) => a.path)).toEqual(['native']);

    const wc = createDecodeChain(new FakeAudioContext(), { forcePath: 'webcodecs', webCodecs: null });
    const e2 = (await wc.decode(realWebmBytes(MONO.opus), expectOf(MONO)).catch((e: unknown) => e)) as DecodeError;
    expect(e2).toBeInstanceOf(DecodeError);
    expect(e2.attempts.map((a) => a.path)).toEqual(['webcodecs']);
  });

  it('rejects invalid expectations', async () => {
    const chain = createDecodeChain(new FakeAudioContext());
    await expect(chain.decode(new ArrayBuffer(8), { samples: 0, channels: 1 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('createDecodeChain — WebCodecs path (fake AudioDecoder backed by opus-decoder)', () => {
  for (const trimPreSkip of [false, true]) {
    it(`decodes sample-exact when the decoder ${trimPreSkip ? 'trims' : 'keeps'} the pre-skip`, async () => {
      const ctx = new FakeAudioContext();
      const { api, stats } = createFakeWebCodecs({ trimPreSkip });
      const chain = createDecodeChain(ctx, { webCodecs: api });
      const wasm = createDecodeChain(ctx, { forcePath: 'wasm' });
      for (const v of [MONO, STEREO, LOOP]) {
        const r = await chain.decode(realWebmBytes(v.opus), expectOf(v));
        expect(r.path).toBe('webcodecs');
        expect(r.suspicious).toBe(false);
        expect(r.buffer.length).toBe(v.samples);
        expect(r.buffer.numberOfChannels).toBe(v.channels);
        expect(r.buffer.sampleRate).toBe(48000);
        const ref = await wasm.decode(realWebmBytes(v.opus), expectOf(v));
        expect(maxAbsDiff(r.buffer, ref.buffer)).toBeLessThan(1e-6);
      }
      expect(chain.stats.webcodecsTrim).toBe(trimPreSkip ? 'decoder' : 'chain');
      expect(stats.configs[0]!.codec).toBe('opus');
      expect(stats.configs[0]!.sampleRate).toBe(48000);
      expect(stats.configs[0]!.description[0]).toBe(0x4f); // 'O'pusHead
      expect(stats.audioData).toBe(stats.closedAudioData); // every AudioData closed
      expect(stats.timestamps.every((t, i) => i === 0 || t >= stats.timestamps[i - 1]! || t === 0)).toBe(true);
      wasm.dispose();
    });
  }

  it('converts interleaved AudioData via copyTo(f32-planar)', async () => {
    const { api } = createFakeWebCodecs({ interleaved: true });
    const chain = createDecodeChain(new FakeAudioContext(), { webCodecs: api });
    const r = await chain.decode(realWebmBytes(STEREO.opus), expectOf(STEREO));
    expect(r.path).toBe('webcodecs');
    expect(r.buffer.length).toBe(STEREO.samples);
  });

  it('falls back to WASM when the Opus config is unsupported or the decoder errors', async () => {
    const unsupported = createDecodeChain(new FakeAudioContext(), { webCodecs: createFakeWebCodecs({ supported: false }).api });
    const r1 = await unsupported.decode(realWebmBytes(MONO.opus), expectOf(MONO));
    expect(r1.path).toBe('wasm');
    expect(r1.buffer.length).toBe(MONO.samples);
    unsupported.dispose();

    const erroring = createDecodeChain(new FakeAudioContext(), { webCodecs: createFakeWebCodecs({ failAtPacket: 3 }).api });
    const r2 = await erroring.decode(realWebmBytes(MONO.opus), expectOf(MONO));
    expect(r2.path).toBe('wasm');
    expect(r2.buffer.length).toBe(MONO.samples);
    erroring.dispose();
  });
});

describe('platform type compatibility (static)', () => {
  it('lib.dom WebCodecs constructors satisfy WebCodecsApi and fetch satisfies FetchLike', () => {
    const webCodecs = (g: { AudioDecoder: typeof AudioDecoder; EncodedAudioChunk: typeof EncodedAudioChunk }): WebCodecsApi => g;
    const fetchLike = (f: typeof fetch): FetchLike => f;
    expect(typeof webCodecs).toBe('function');
    expect(typeof fetchLike).toBe('function');
  });
});
