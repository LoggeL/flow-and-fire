import { describe, expect, it } from 'vitest';
import { demuxWebmOpus, expectedOutputSamples, WebmParseError } from '../../src/decode/index.ts';
import {
  ID,
  blockGroup,
  cluster,
  concat,
  el,
  elUnknown,
  opusHead,
  opusPacket,
  simpleBlock,
  trackEntry,
  uintEl,
  webmFile,
  type Bytes,
  type Lacing,
} from './ebml-writer.ts';

/** 20 ms CELT FB packet (config 31, code 0) with a distinct filler byte. */
const pkt = (fill: number, payload = 30): Bytes => opusPacket(31, 0, payload, undefined, fill);

function expectParseError(bytes: Bytes, pattern: RegExp): WebmParseError {
  let err: unknown = null;
  try {
    demuxWebmOpus(bytes);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(WebmParseError);
  expect((err as Error).message).toMatch(pattern);
  expect((err as WebmParseError).offset).toBeGreaterThanOrEqual(0);
  return err as WebmParseError;
}

describe('demuxWebmOpus — synthetic files', () => {
  it('reads OpusHead fields, CodecDelay/SeekPreRoll, Duration and SimpleBlocks', () => {
    const file = webmFile({
      tracks: [trackEntry({ channels: 2, preSkip: 100, codecDelayNs: 2_083_333, seekPreRollNs: 80_000_000 })],
      durationMs: 60,
      clusters: [cluster(0, [simpleBlock(1, 0, [pkt(1)]), simpleBlock(1, 20, [pkt(2)]), simpleBlock(1, 40, [pkt(3)])])],
    });
    const t = demuxWebmOpus(file.buffer as ArrayBuffer);
    expect(t.channels).toBe(2);
    expect(t.preSkip).toBe(100);
    expect(t.inputSampleRate).toBe(48000);
    expect(t.codecDelayNs).toBe(2_083_333);
    expect(t.seekPreRollNs).toBe(80_000_000);
    expect(t.durationNs).toBe(60_000_000);
    expect(t.packets.map((p) => p[1])).toEqual([1, 2, 3]);
    expect(Array.from(t.timestampsUs)).toEqual([0, 20_000, 40_000]);
    expect(t.discardPaddingNs).toBe(0);
    expect(expectedOutputSamples(t)).toBe(3 * 960 - 100);
    expect(t.opusHead.length).toBe(19);
  });

  it('reads the output gain from the OpusHead and accepts DocType matroska', () => {
    const file = webmFile({
      docType: 'matroska',
      tracks: [trackEntry({ codecPrivate: opusHead(1, 312, 44100, -256) })],
      clusters: [cluster(0, [simpleBlock(1, 0, [pkt(9)])])],
    });
    const t = demuxWebmOpus(file);
    expect(t.outputGainQ8).toBe(-256);
    expect(t.inputSampleRate).toBe(44100);
    expect(t.docType).toBe('matroska');
  });

  const lacings: Lacing[] = ['xiph', 'fixed', 'ebml'];
  for (const lacing of lacings) {
    it(`splits ${lacing} laced blocks into packets with derived timestamps`, () => {
      const sizes = lacing === 'fixed' ? [40, 40, 40, 40] : [300, 17, 255, 511];
      const frames = sizes.map((s, i) => opusPacket(31, 0, s - 1, undefined, 10 + i));
      const file = webmFile({ clusters: [cluster(1000, [simpleBlock(1, 5, frames, lacing), simpleBlock(1, 85, [pkt(99)])])] });
      const t = demuxWebmOpus(file);
      expect(t.packets.length).toBe(5);
      expect(t.packets.slice(0, 4).map((p) => p.length)).toEqual(sizes);
      expect(t.packets.slice(0, 4).map((p) => p[1])).toEqual([10, 11, 12, 13]);
      expect(t.packets[4]![1]).toBe(99);
      // Block at 1005 ms; laced frames follow each other by 20 ms.
      expect(Array.from(t.timestampsUs)).toEqual([1_005_000, 1_025_000, 1_045_000, 1_065_000, 1_085_000]);
    });
  }

  it('handles unknown-size Segment and unknown-size Clusters followed by Cues', () => {
    const file = webmFile({
      segmentUnknownSize: true,
      clusters: [
        cluster(0, [simpleBlock(1, 0, [pkt(1)]), simpleBlock(1, 20, [pkt(2)])], true),
        cluster(40, [simpleBlock(1, 0, [pkt(3)])], true),
      ],
      trailer: [el(ID.Cues, el(0xbb, uintEl(0xb3, 0))), el(ID.Tags, el(0x7373))],
    });
    const t = demuxWebmOpus(file);
    expect(t.packets.map((p) => p[1])).toEqual([1, 2, 3]);
    expect(Array.from(t.timestampsUs)).toEqual([0, 20_000, 40_000]);
  });

  it('skips SeekHead, Void, CRC-32 and unknown elements at every level', () => {
    const voidEl = el(ID.Void, new Uint8Array(7));
    const crc = el(ID.CRC32, new Uint8Array(4));
    const unknown = el(0x4dbb, new Uint8Array(3)); // Seek entry outside SeekHead
    const file = webmFile({
      prelude: [el(ID.SeekHead, el(0x4dbb, el(0x53ab, Uint8Array.of(0x15, 0x49, 0xa9, 0x66)))), voidEl, crc, unknown],
      clusters: [cluster(0, [voidEl, simpleBlock(1, 0, [pkt(1)]), crc, simpleBlock(1, 20, [pkt(2)])], false, [crc])],
      trailer: [voidEl],
    });
    const t = demuxWebmOpus(file);
    expect(t.packets.length).toBe(2);
  });

  it('takes DiscardPadding from the BlockGroup of the last block', () => {
    const file = webmFile({
      clusters: [
        cluster(0, [blockGroup(1, 0, [pkt(1)], 'none', 1_000_000), simpleBlock(1, 20, [pkt(2)])]),
        cluster(40, [blockGroup(1, 0, [pkt(3)], 'none', 5_000_000)]),
      ],
    });
    const t = demuxWebmOpus(file);
    expect(t.discardPaddingNs).toBe(5_000_000);
    // 3 × 960 − 312 pre-skip − 240 (5 ms) padding.
    expect(expectedOutputSamples(t)).toBe(2880 - 312 - 240);
  });

  it('reports 0 padding when the last block has none, even if an earlier one had', () => {
    const file = webmFile({ clusters: [cluster(0, [blockGroup(1, 0, [pkt(1)], 'none', 1_000_000), simpleBlock(1, 20, [pkt(2)])])] });
    expect(demuxWebmOpus(file).discardPaddingNs).toBe(0);
  });

  it('BlockGroup blocks can be laced as well', () => {
    const frames = [pkt(1, 10), pkt(2, 10)];
    const file = webmFile({ clusters: [cluster(0, [blockGroup(1, 0, frames, 'xiph', 0)])] });
    expect(demuxWebmOpus(file).packets.length).toBe(2);
  });

  it('respects TimecodeScale and negative block offsets', () => {
    const file = webmFile({
      timecodeScale: 500_000, // 0.5 ms units
      clusters: [cluster(100, [simpleBlock(1, -40, [pkt(1)]), simpleBlock(1, 0, [pkt(2)])])],
    });
    const t = demuxWebmOpus(file);
    expect(Array.from(t.timestampsUs)).toEqual([30_000, 50_000]);
    expect(t.timecodeScaleNs).toBe(500_000);
  });

  it('selects the Opus track and ignores blocks of other tracks', () => {
    const file = webmFile({
      tracks: [trackEntry({ number: 1, type: 1, codec: 'V_VP9', codecPrivate: null }), trackEntry({ number: 2, channels: 1 })],
      clusters: [cluster(0, [simpleBlock(1, 0, [Uint8Array.of(1, 2, 3)]), simpleBlock(2, 0, [pkt(7)]), simpleBlock(1, 20, [Uint8Array.of(4)])])],
    });
    const t = demuxWebmOpus(file);
    expect(t.trackNumber).toBe(2);
    expect(t.packets.length).toBe(1);
    expect(t.packets[0]![1]).toBe(7);
  });

  it('rejects files without an A_OPUS audio track', () => {
    const vorbis = webmFile({ tracks: [trackEntry({ codec: 'A_VORBIS' })], clusters: [cluster(0, [simpleBlock(1, 0, [pkt(1)])])] });
    expectParseError(vorbis, /no A_OPUS audio track.*A_VORBIS/);
    const video = webmFile({ tracks: [trackEntry({ type: 1, codec: 'A_OPUS' })], clusters: [cluster(0, [simpleBlock(1, 0, [pkt(1)])])] });
    expectParseError(video, /no A_OPUS audio track/);
    const none = webmFile({ tracks: [], clusters: [] });
    expectParseError(none, /no tracks/);
  });

  it('rejects missing or broken OpusHead, empty tracks and wrong DocType', () => {
    expectParseError(webmFile({ tracks: [trackEntry({ codecPrivate: null })], clusters: [cluster(0, [simpleBlock(1, 0, [pkt(1)])])] }), /without CodecPrivate/);
    const bad = opusHead(1, 312);
    bad[0] = 0x41;
    expectParseError(webmFile({ tracks: [trackEntry({ codecPrivate: bad })], clusters: [cluster(0, [simpleBlock(1, 0, [pkt(1)])])] }), /not an OpusHead/);
    expectParseError(webmFile({ tracks: [trackEntry({ codecPrivate: opusHead(1, 312).subarray(0, 12) })], clusters: [] }), /shorter than 19/);
    expectParseError(webmFile({ clusters: [] }), /without packets/);
    expectParseError(webmFile({ docType: 'mp4', clusters: [] }), /unsupported DocType/);
    expectParseError(Uint8Array.of(0x00, 0x01, 0x02), /invalid element ID/);
    expectParseError(new Uint8Array(0), /unexpected end/);
    expectParseError(concat(el(0x4282, Uint8Array.of(1))), /not an EBML stream/);
  });

  it('rejects structural errors with the byte offset', () => {
    // Block before the cluster Timecode.
    const noTc = concat(
      webmFile({ clusters: [] }).subarray(0, 0),
      webmFile({ clusters: [el(ID.Cluster, simpleBlock(1, 0, [pkt(1)]))] }),
    );
    expectParseError(noTc, /before cluster Timecode/);
    // Fixed lacing with a remainder.
    const badFixed = webmFile({
      clusters: [cluster(0, [el(ID.SimpleBlock, concat(Uint8Array.of(0x81, 0, 0, 0x84, 1), new Uint8Array(5)))])],
    });
    expectParseError(badFixed, /fixed lacing/);
    // Xiph lace sizes larger than the block.
    const badXiph = webmFile({ clusters: [cluster(0, [el(ID.SimpleBlock, Uint8Array.of(0x81, 0, 0, 0x82, 1, 200, 1, 2))])] });
    expectParseError(badXiph, /lace sizes exceed block|truncated/);
    // Unknown size on an element that may not have one.
    const unknownTracks = concat(
      webmFile({ clusters: [] }).subarray(0, 0),
      concat(
        el(ID.EBML, el(ID.DocType, Uint8Array.from('webm', (c) => c.charCodeAt(0)))),
        elUnknown(ID.Segment, elUnknown(ID.Tracks, trackEntry())),
      ),
    );
    expectParseError(unknownTracks, /unknown size in Segment/);
    // Truncated file: element size exceeds its parent.
    const full = webmFile({ clusters: [cluster(0, [simpleBlock(1, 0, [pkt(1)])])] });
    const err = expectParseError(full.subarray(0, full.length - 5), /exceeds its parent/);
    expect(err.offset).toBeGreaterThan(0);
  });
});
