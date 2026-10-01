import { describe, expect, it } from 'vitest';
import { expectedOutputSamples, opusFrameSamples, opusPacketFrames, opusPacketSamples } from '../../src/decode/index.ts';

const toc = (config: number, code: number): number => (config << 3) | code;

describe('opusPacketSamples', () => {
  it('maps all 32 TOC configurations to the RFC 6716 frame sizes at 48 kHz', () => {
    const expected: number[] = [];
    for (let c = 0; c < 12; c++) expected.push([480, 960, 1920, 2880][c % 4]!); // SILK 10/20/40/60 ms
    for (let c = 12; c < 16; c++) expected.push([480, 960][c % 2]!); // Hybrid 10/20 ms
    for (let c = 16; c < 32; c++) expected.push([120, 240, 480, 960][c % 4]!); // CELT 2.5/5/10/20 ms
    for (let c = 0; c < 32; c++) expect(opusFrameSamples(toc(c, 0))).toBe(expected[c]);
  });

  it('counts frames per packet code 0/1/2/3', () => {
    expect(opusPacketSamples(Uint8Array.of(toc(31, 0), 1, 2))).toBe(960);
    expect(opusPacketSamples(Uint8Array.of(toc(31, 1), 1, 2))).toBe(1920);
    expect(opusPacketSamples(Uint8Array.of(toc(16, 2), 1, 1, 2))).toBe(240);
    expect(opusPacketSamples(Uint8Array.of(toc(16, 3), 5, 0))).toBe(600);
    // Frame-count byte: only the low 6 bits count (VBR/padding flags in the top bits).
    expect(opusPacketSamples(Uint8Array.of(toc(19, 3), 0xc3))).toBe(3 * 960);
    expect(opusPacketFrames(Uint8Array.of(toc(19, 3), 0x86))).toBe(6);
  });

  it('returns 0 for malformed packets', () => {
    expect(opusPacketSamples(new Uint8Array(0))).toBe(0);
    expect(opusPacketSamples(Uint8Array.of(toc(31, 3)))).toBe(0); // missing count byte
    expect(opusPacketSamples(Uint8Array.of(toc(31, 3), 0))).toBe(0); // zero frames
    expect(opusPacketSamples(Uint8Array.of(toc(3, 3), 3))).toBe(0); // 3 × 60 ms > 120 ms
    expect(opusPacketSamples(Uint8Array.of(toc(3, 3), 2))).toBe(5760); // exactly 120 ms is fine
  });
});

describe('expectedOutputSamples', () => {
  const p20 = Uint8Array.of(toc(31, 0), 0);
  it('subtracts pre-skip and rounded discard padding', () => {
    expect(expectedOutputSamples({ packets: [p20, p20, p20], preSkip: 312, discardPaddingNs: 0 })).toBe(2880 - 312);
    // 4 895 833 ns · 48 kHz = 234.99998 → 235 samples.
    expect(expectedOutputSamples({ packets: [p20, p20, p20], preSkip: 312, discardPaddingNs: 4_895_833 })).toBe(2880 - 312 - 235);
  });
  it('never goes negative and ignores negative padding', () => {
    expect(expectedOutputSamples({ packets: [p20], preSkip: 2000, discardPaddingNs: 0 })).toBe(0);
    expect(expectedOutputSamples({ packets: [p20], preSkip: 0, discardPaddingNs: -1_000_000 })).toBe(960);
  });
});
