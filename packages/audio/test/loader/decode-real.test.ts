/**
 * Real decoding in Node: the native path is unavailable (fake decodeAudioData rejects like a
 * browser without Opus/WebM), WebCodecs does not exist in Node, so the chain must fall through to
 * the WASM decoder and produce sample-exact buffers from the real content/audio/dist files.
 */

import { describe, expect, it } from 'vitest';
import { createDecodeChain } from '../../src/loader/index.ts';
import type { AudioBufferLike } from '../../src/ports.ts';
import { FakeAudioContext, loadRealManifest, realWebmBytes } from '../support/index.ts';

const manifest = loadRealManifest();

function levels(b: AudioBufferLike): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const x = d[i]!;
      sum += x * x;
      const a = Math.abs(x);
      if (a > peak) peak = a;
    }
    n += d.length;
  }
  return { rms: Math.sqrt(sum / n), peak };
}

describe('decode chain on real files (Node → WASM)', () => {
  it('decodes every variant of the 17 MS5 sounds sample-exact (native reject → no WebCodecs → WASM)', async () => {
    const ms5 = manifest.sounds.filter((s) => s.tags.includes('MS5'));
    expect(ms5.length).toBe(17);
    const ctx = new FakeAudioContext();
    const chain = createDecodeChain(ctx);
    const t0 = performance.now();
    let variants = 0;
    const problems: string[] = [];
    for (const s of ms5) {
      for (const v of s.variants) {
        const r = await chain.decode(realWebmBytes(v.opus), { samples: v.samples, channels: s.channels });
        variants++;
        const { rms, peak } = levels(r.buffer);
        // Tolerance from audioeng-a1: the software path is sample exact (0 frames).
        if (r.path !== 'wasm') problems.push(`${v.opus}: path ${r.path}`);
        if (r.buffer.length !== v.samples) problems.push(`${v.opus}: length ${r.buffer.length} ≠ ${v.samples}`);
        if (r.buffer.numberOfChannels !== s.channels) problems.push(`${v.opus}: ${r.buffer.numberOfChannels} ch ≠ ${s.channels}`);
        if (r.buffer.sampleRate !== 48000) problems.push(`${v.opus}: rate ${r.buffer.sampleRate}`);
        if (!(rms > 1e-4)) problems.push(`${v.opus}: rms ${rms}`);
        if (!(peak <= 1.0)) problems.push(`${v.opus}: peak ${peak}`);
        if (r.suspicious) problems.push(`${v.opus}: suspicious`);
      }
    }
    const ms = performance.now() - t0;
    expect(problems).toEqual([]);
    expect(variants).toBe(55);
    expect(chain.stats.byPath.wasm).toBe(55);
    expect(chain.stats.nativeRejects).toBe(1); // probe only
    expect(ctx.decodeCalls).toBe(1);
    expect(ms).toBeLessThan(30_000);
    chain.dispose();
  });

  it('decodes all 101 sounds / 246 variants; memory balance = Σ samples × channels × 4', async () => {
    const chain = createDecodeChain(new FakeAudioContext(), { forcePath: 'wasm' });
    let bytes = 0;
    let expected = 0;
    let variants = 0;
    const mismatches: string[] = [];
    for (const s of manifest.sounds) {
      for (const v of s.variants) {
        const r = await chain.decode(realWebmBytes(v.opus), { samples: v.samples, channels: s.channels });
        bytes += r.buffer.length * r.buffer.numberOfChannels * 4;
        expected += v.samples * s.channels * 4;
        variants++;
        if (r.buffer.length !== v.samples || r.buffer.numberOfChannels !== s.channels) mismatches.push(v.opus);
      }
    }
    expect(mismatches).toEqual([]);
    expect(variants).toBe(246);
    expect(bytes).toBe(expected);
    expect(bytes).toBe(82_650_668);
    chain.dispose();
  });
});
