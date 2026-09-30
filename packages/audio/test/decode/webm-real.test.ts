import { describe, expect, it } from 'vitest';
import { demuxWebmOpus, expectedOutputSamples, opusPacketSamples } from '../../src/decode/index.ts';
import { realBytes, realVariants } from './real-files.ts';

describe('demuxWebmOpus on all real content/audio/dist variants', () => {
  const variants = realVariants();

  it('covers the whole manifest (246 variants of 101 sounds)', () => {
    expect(variants.length).toBe(246);
    expect(new Set(variants.map((v) => v.soundId)).size).toBe(101);
  });

  it('parses every variant; channels, rate and expected output length match the manifest exactly', () => {
    const mismatches: string[] = [];
    let withPadding = 0;
    for (const v of variants) {
      const bytes = realBytes(v.opus);
      const t = demuxWebmOpus(bytes);
      if (t.discardPaddingNs > 0) withPadding++;
      const expected = expectedOutputSamples(t);
      if (t.channels !== v.channels) mismatches.push(`${v.opus}: channels ${t.channels} != ${v.channels}`);
      if (t.inputSampleRate !== 48000) mismatches.push(`${v.opus}: inputSampleRate ${t.inputSampleRate}`);
      if (expected !== v.samples) mismatches.push(`${v.opus}: expected ${expected} != manifest ${v.samples}`);
      if (t.docType !== 'webm') mismatches.push(`${v.opus}: docType ${t.docType}`);
      // ffmpeg/libopus: 312 samples pre-skip, CodecDelay = the same in ns.
      if (t.preSkip !== 312 || t.codecDelayNs !== 6_500_000) mismatches.push(`${v.opus}: preSkip ${t.preSkip}/${t.codecDelayNs}`);
      // Zero-copy views into the input buffer.
      for (const p of t.packets) {
        if (p.buffer !== bytes.buffer) mismatches.push(`${v.opus}: packet is not a view`);
      }
      if (t.opusHead.buffer !== bytes.buffer) mismatches.push(`${v.opus}: opusHead is not a view`);
    }
    expect(mismatches).toEqual([]);
    // Almost every file ends mid-frame, so the muxer writes DiscardPadding on the last block
    // (245 of 246; one variant is an exact multiple of 20 ms and has none).
    expect(withPadding).toBeGreaterThanOrEqual(240);
  });

  it('timestamps advance by the 20 ms frame duration (ms-rounded) and Info/Duration is plausible', () => {
    for (const v of variants) {
      const t = demuxWebmOpus(realBytes(v.opus));
      expect(t.timestampsUs.length).toBe(t.packets.length);
      expect(t.timestampsUs[0]).toBe(0);
      for (let i = 1; i < t.timestampsUs.length; i++) {
        const d = t.timestampsUs[i]! - t.timestampsUs[i - 1]!;
        // Block timecodes are whole ms (TimecodeScale 1 ms) and ffmpeg rounds the pre-skip-shifted
        // pts, so 20 ms frames show up as 20 000 or 21 000 µs steps (never drifting).
        const frameUs = (opusPacketSamples(t.packets[i - 1]!) * 1e6) / 48000;
        expect(Math.abs(d - frameUs)).toBeLessThanOrEqual(1000);
        expect(Math.abs(t.timestampsUs[i]! - i * frameUs)).toBeLessThanOrEqual(1000);
      }
      expect(t.durationNs).not.toBeNull();
      // ffmpeg's Duration is derived from packet pts, not from the trimmed output length:
      // within 1.5 frames (30 ms) of it.
      expect(Math.abs(t.durationNs! / 1e9 - v.samples / 48000)).toBeLessThanOrEqual(0.03);
    }
  });
});
