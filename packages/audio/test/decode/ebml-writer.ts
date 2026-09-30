/**
 * Tiny EBML/WebM writer for synthetic demuxer tests (not part of the package API).
 * Builds byte arrays element by element; sizes are encoded minimally unless forced.
 */

export type Bytes = Uint8Array;

export function concat(...parts: readonly Bytes[]): Bytes {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Element ID bytes (the ID already contains its marker bits). */
export function idBytes(id: number): Bytes {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return Uint8Array.from(out);
}

/** EBML size VINT; `len` forces a byte length, 'unknown' writes the reserved all-ones value. */
export function sizeVint(size: number | 'unknown', len?: number): Bytes {
  if (size === 'unknown') {
    const l = len ?? 8;
    const out = new Uint8Array(l).fill(0xff);
    out[0] = 0xff >> (l - 1);
    return out;
  }
  let l = len ?? 1;
  while (size >= 2 ** (7 * l) - 1) l++;
  const out = new Uint8Array(l);
  let v = size;
  for (let i = l - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0]! |= 0x80 >> (l - 1);
  return out;
}

/** VINT number as used in block headers (track number) and EBML lacing. */
export function vintNumber(value: number, len?: number): Bytes {
  return sizeVint(value, len);
}

export function el(id: number, ...children: readonly Bytes[]): Bytes {
  const payload = concat(...children);
  return concat(idBytes(id), sizeVint(payload.length), payload);
}

export function elUnknown(id: number, ...children: readonly Bytes[]): Bytes {
  return concat(idBytes(id), sizeVint('unknown'), ...children);
}

export function uintEl(id: number, value: number): Bytes {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return el(id, Uint8Array.from(bytes));
}

export function intEl(id: number, value: number, len = 4): Bytes {
  const out = new Uint8Array(len);
  let v = value < 0 ? 2 ** (8 * len) + value : value;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return el(id, out);
}

export function strEl(id: number, s: string): Bytes {
  return el(id, Uint8Array.from(s, (c) => c.charCodeAt(0)));
}

export function floatEl(id: number, v: number): Bytes {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, false);
  return el(id, b);
}

// ---- IDs ----
export const ID = {
  EBML: 0x1a45dfa3,
  DocType: 0x4282,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  Audio: 0xe1,
  Channels: 0x9f,
  SamplingFrequency: 0xb5,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  DiscardPadding: 0x75a2,
  Cues: 0x1c53bb6b,
  Tags: 0x1254c367,
  Void: 0xec,
  CRC32: 0xbf,
} as const;

export function opusHead(channels: number, preSkip: number, inputRate = 48000, gainQ8 = 0): Bytes {
  const b = new Uint8Array(19);
  b.set(Uint8Array.from('OpusHead', (c) => c.charCodeAt(0)), 0);
  const dv = new DataView(b.buffer);
  b[8] = 1;
  b[9] = channels;
  dv.setUint16(10, preSkip, true);
  dv.setUint32(12, inputRate, true);
  dv.setInt16(16, gainQ8, true);
  b[18] = 0;
  return b;
}

/** Fake Opus packet: TOC byte (config, code) followed by `payload` filler bytes. */
export function opusPacket(config: number, code: 0 | 1 | 2 | 3, payload: number, frameCount?: number, fill = 0x55): Bytes {
  const head = code === 3 ? [(config << 3) | code, frameCount ?? 1] : [(config << 3) | code];
  const out = new Uint8Array(head.length + payload);
  out.set(head, 0);
  out.fill(fill, head.length);
  return out;
}

export type Lacing = 'none' | 'xiph' | 'fixed' | 'ebml';

/** (Simple)Block payload: track VINT, int16 relative timecode, flags, lace header, frames. */
export function blockPayload(track: number, relTc: number, frames: readonly Bytes[], lacing: Lacing, keyframe = true): Bytes {
  const lacingBits = { none: 0, xiph: 1, fixed: 2, ebml: 3 }[lacing];
  const hdr = new Uint8Array(3);
  new DataView(hdr.buffer).setInt16(0, relTc, false);
  hdr[2] = (keyframe ? 0x80 : 0) | (lacingBits << 1);
  const parts: Bytes[] = [vintNumber(track), hdr];
  if (lacing === 'none') {
    if (frames.length !== 1) throw new Error('unlaced block needs exactly one frame');
    parts.push(frames[0]!);
    return concat(...parts);
  }
  parts.push(Uint8Array.of(frames.length - 1));
  if (lacing === 'xiph') {
    for (let i = 0; i < frames.length - 1; i++) {
      let s = frames[i]!.length;
      const sz: number[] = [];
      while (s >= 255) {
        sz.push(255);
        s -= 255;
      }
      sz.push(s);
      parts.push(Uint8Array.from(sz));
    }
  } else if (lacing === 'ebml') {
    parts.push(vintNumber(frames[0]!.length));
    for (let i = 1; i < frames.length - 1; i++) {
      const diff = frames[i]!.length - frames[i - 1]!.length;
      // Signed VINT: 2 bytes → bias 2^13 − 1.
      parts.push(vintNumber(diff + (2 ** 13 - 1), 2));
    }
  } else {
    const n = frames[0]!.length;
    if (frames.some((f) => f.length !== n)) throw new Error('fixed lacing needs equal frame sizes');
  }
  parts.push(...frames);
  return concat(...parts);
}

export function simpleBlock(track: number, relTc: number, frames: readonly Bytes[], lacing: Lacing = 'none'): Bytes {
  return el(ID.SimpleBlock, blockPayload(track, relTc, frames, lacing));
}

export function blockGroup(track: number, relTc: number, frames: readonly Bytes[], lacing: Lacing = 'none', discardPaddingNs?: number): Bytes {
  const parts: Bytes[] = [el(ID.Block, blockPayload(track, relTc, frames, lacing, false))];
  if (discardPaddingNs !== undefined) parts.push(intEl(ID.DiscardPadding, discardPaddingNs, 4));
  return el(ID.BlockGroup, ...parts);
}

export function ebmlHeader(docType = 'webm'): Bytes {
  return el(ID.EBML, uintEl(0x4286, 1), uintEl(0x42f7, 1), uintEl(0x42f2, 4), uintEl(0x42f3, 8), strEl(ID.DocType, docType));
}

export interface TrackSpec {
  number?: number;
  type?: number;
  codec?: string;
  channels?: number;
  preSkip?: number;
  codecPrivate?: Bytes | null;
  codecDelayNs?: number;
  seekPreRollNs?: number;
}

export function trackEntry(t: TrackSpec = {}): Bytes {
  const channels = t.channels ?? 1;
  const parts: Bytes[] = [
    uintEl(ID.TrackNumber, t.number ?? 1),
    uintEl(0x73c5, 12345),
    uintEl(ID.TrackType, t.type ?? 2),
    strEl(ID.CodecID, t.codec ?? 'A_OPUS'),
  ];
  const cp = t.codecPrivate === undefined ? opusHead(channels, t.preSkip ?? 312) : t.codecPrivate;
  if (cp) parts.push(el(ID.CodecPrivate, cp));
  parts.push(uintEl(ID.CodecDelay, t.codecDelayNs ?? 6_500_000));
  parts.push(uintEl(ID.SeekPreRoll, t.seekPreRollNs ?? 80_000_000));
  parts.push(el(ID.Audio, floatEl(ID.SamplingFrequency, 48000), uintEl(ID.Channels, channels)));
  return el(ID.TrackEntry, ...parts);
}

export interface FileSpec {
  docType?: string;
  tracks?: readonly Bytes[];
  clusters: readonly Bytes[];
  segmentUnknownSize?: boolean;
  durationMs?: number;
  timecodeScale?: number;
  /** Extra Segment children before Info (SeekHead, Void …). */
  prelude?: readonly Bytes[];
  /** Extra Segment children after the clusters (Cues, Tags …). */
  trailer?: readonly Bytes[];
}

export function cluster(timecode: number, blocks: readonly Bytes[], unknownSize = false, extra: readonly Bytes[] = []): Bytes {
  const children = [...extra, uintEl(ID.Timecode, timecode), ...blocks];
  return unknownSize ? elUnknown(ID.Cluster, ...children) : el(ID.Cluster, ...children);
}

export function webmFile(spec: FileSpec): Bytes {
  const infoParts: Bytes[] = [uintEl(ID.TimecodeScale, spec.timecodeScale ?? 1_000_000)];
  if (spec.durationMs !== undefined) infoParts.push(floatEl(ID.Duration, spec.durationMs));
  const segChildren: Bytes[] = [
    ...(spec.prelude ?? []),
    el(ID.Info, ...infoParts),
    el(ID.Tracks, ...(spec.tracks ?? [trackEntry()])),
    ...spec.clusters,
    ...(spec.trailer ?? []),
  ];
  const segment = spec.segmentUnknownSize ? elUnknown(ID.Segment, ...segChildren) : el(ID.Segment, ...segChildren);
  return concat(ebmlHeader(spec.docType), segment);
}
