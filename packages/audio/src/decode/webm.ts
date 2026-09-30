/**
 * WebM/Matroska demuxer for a single Opus audio track (the fallback decode path, audioeng-b2).
 *
 * Own EBML parser: 1–4-byte IDs, 1–8-byte sizes including the "unknown size" value on Segment and
 * Cluster, SimpleBlock and BlockGroup/Block, lacing none/Xiph/fixed/EBML, DiscardPadding.
 * SeekHead, Cues, Tags, Chapters, Attachments, Void, CRC-32 and unknown elements are skipped.
 * Packets are zero-copy `subarray` views into the input. Any malformed input throws
 * {@link WebmParseError}; every loop advances by at least one byte, so parsing always terminates.
 */

import { EbmlReader, WebmParseError, readVintValue } from './ebml.ts';
import { OPUS_SAMPLE_RATE, opusPacketSamples } from './opus-packet.ts';

export { WebmParseError } from './ebml.ts';

/** Demuxed Opus track of a WebM file. */
export interface WebmOpusTrack {
  /** Matroska track number of the Opus track. */
  readonly trackNumber: number;
  /** Channel count from the OpusHead. */
  readonly channels: number;
  /** Original input sample rate from the OpusHead (informational; decoding is always 48 kHz). */
  readonly inputSampleRate: number;
  /** Samples (48 kHz) to discard at the start of the decoded stream (OpusHead pre-skip). */
  readonly preSkip: number;
  /** Output gain from the OpusHead in Q7.8 dB (signed). */
  readonly outputGainQ8: number;
  /** OpusHead channel mapping family (0 = mono/stereo). */
  readonly channelMappingFamily: number;
  /** Matroska CodecDelay in ns (0 if absent). */
  readonly codecDelayNs: number;
  /** Matroska SeekPreRoll in ns (0 if absent). */
  readonly seekPreRollNs: number;
  /** The raw OpusHead (CodecPrivate), a view into the input — WebCodecs `description`. */
  readonly opusHead: Uint8Array;
  /** Opus packets in stream order, zero-copy views into the input. */
  readonly packets: readonly Uint8Array[];
  /** Presentation timestamp of each packet in µs (cluster timecode + block offset, × TimecodeScale). */
  readonly timestampsUs: Float64Array;
  /** DiscardPadding of the last block in ns (samples to drop at the end); 0 if absent. */
  readonly discardPaddingNs: number;
  /** Segment duration in ns from Info/Duration, or null if absent. */
  readonly durationNs: number | null;
  /** TimecodeScale in ns (default 1 000 000). */
  readonly timecodeScaleNs: number;
  /** EBML DocType ('webm' or 'matroska'). */
  readonly docType: string;
}

// ---- element IDs (with marker bits, as written in the Matroska spec) ----
const ID_EBML = 0x1a45dfa3;
const ID_DOCTYPE = 0x4282;
const ID_EBML_MAX_ID_LENGTH = 0x42f2;
const ID_EBML_MAX_SIZE_LENGTH = 0x42f3;
const ID_SEGMENT = 0x18538067;
const ID_SEEKHEAD = 0x114d9b74;
const ID_INFO = 0x1549a966;
const ID_TRACKS = 0x1654ae6b;
const ID_CLUSTER = 0x1f43b675;
const ID_CUES = 0x1c53bb6b;
const ID_TAGS = 0x1254c367;
const ID_CHAPTERS = 0x1043a770;
const ID_ATTACHMENTS = 0x1941a469;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_CODEC_DELAY = 0x56aa;
const ID_SEEK_PRE_ROLL = 0x56bb;
const ID_AUDIO = 0xe1;
const ID_CHANNELS = 0x9f;
const ID_SAMPLING_FREQUENCY = 0xb5;
const ID_CLUSTER_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_DISCARD_PADDING = 0x75a2;

const TRACK_TYPE_AUDIO = 2;
const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;

/** IDs that may directly follow a Cluster inside a Segment; they end an unknown-size Cluster. */
function isSegmentLevelId(id: number): boolean {
  return (
    id === ID_CLUSTER ||
    id === ID_CUES ||
    id === ID_TAGS ||
    id === ID_INFO ||
    id === ID_TRACKS ||
    id === ID_SEEKHEAD ||
    id === ID_CHAPTERS ||
    id === ID_ATTACHMENTS ||
    id === ID_EBML ||
    id === ID_SEGMENT
  );
}

interface TrackInfo {
  number: number;
  type: number;
  codecId: string;
  codecPrivateStart: number;
  codecPrivateEnd: number;
  codecDelayNs: number;
  seekPreRollNs: number;
  channels: number;
  samplingFrequency: number;
}

/** Collected frames of all tracks (filtered to the Opus track at the end). */
interface FrameLog {
  track: number[];
  view: Uint8Array[];
  /** Block timestamp in TimecodeScale units (cluster + relative). */
  blockTc: number[];
  /** Position of the frame inside its lace (0 = first). */
  laceIndex: number[];
  /** Last DiscardPadding per track number (NaN = last block had none). */
  lastDiscard: Map<number, number>;
}

class Demuxer {
  private readonly r: EbmlReader;
  private readonly bytes: Uint8Array;
  private readonly vint = new Float64Array(2);
  private readonly laceSizes: number[] = [];
  docType = '';
  timecodeScaleNs = DEFAULT_TIMECODE_SCALE_NS;
  durationTc: number | null = null;
  readonly tracks: TrackInfo[] = [];
  readonly frames: FrameLog = { track: [], view: [], blockTc: [], laceIndex: [], lastDiscard: new Map() };

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.r = new EbmlReader(bytes);
  }

  run(): void {
    const end = this.bytes.length;
    const h = this.r.readHeader(0, end);
    if (h.id !== ID_EBML) throw new WebmParseError('not an EBML stream (missing EBML header)', 0);
    if (h.unknownSize) throw new WebmParseError('EBML header with unknown size', 0);
    const headerEnd = h.dataStart + h.size;
    this.parseEbmlHeader(h.dataStart, headerEnd);
    let pos = headerEnd;
    let sawSegment = false;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.id === ID_SEGMENT) {
        const dataStart = e.dataStart;
        const segEnd = e.unknownSize ? end : dataStart + e.size;
        this.parseSegment(dataStart, segEnd);
        sawSegment = true;
        break; // only the first Segment is read
      }
      if (e.unknownSize) throw new WebmParseError(`top-level element 0x${e.id.toString(16)} with unknown size`, pos);
      pos = e.dataStart + e.size;
    }
    if (!sawSegment) throw new WebmParseError('no Segment element', pos);
  }

  private parseEbmlHeader(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.unknownSize) throw new WebmParseError('unknown size inside EBML header', pos);
      const ds = e.dataStart;
      const sz = e.size;
      if (e.id === ID_DOCTYPE) this.docType = this.r.readString(ds, sz);
      else if (e.id === ID_EBML_MAX_ID_LENGTH && this.r.readUint(ds, sz) > 4) {
        throw new WebmParseError('EBMLMaxIDLength > 4 is not supported', pos);
      } else if (e.id === ID_EBML_MAX_SIZE_LENGTH && this.r.readUint(ds, sz) > 8) {
        throw new WebmParseError('EBMLMaxSizeLength > 8 is not supported', pos);
      }
      pos = ds + sz;
    }
    if (this.docType !== 'webm' && this.docType !== 'matroska') {
      throw new WebmParseError(`unsupported DocType '${this.docType}'`, start);
    }
  }

  private parseSegment(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      const id = e.id;
      const ds = e.dataStart;
      if (id === ID_CLUSTER) {
        pos = this.parseCluster(ds, e.unknownSize ? -1 : ds + e.size, end);
        continue;
      }
      if (e.unknownSize) throw new WebmParseError(`element 0x${id.toString(16)} with unknown size in Segment`, pos);
      const elEnd = ds + e.size;
      if (id === ID_INFO) this.parseInfo(ds, elEnd);
      else if (id === ID_TRACKS) this.parseTracks(ds, elEnd);
      // SeekHead, Cues, Tags, Chapters, Attachments, Void, CRC-32, unknown: skipped.
      pos = elEnd;
    }
  }

  private parseInfo(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.unknownSize) throw new WebmParseError('unknown size inside Info', pos);
      if (e.id === ID_TIMECODE_SCALE) {
        const v = this.r.readUint(e.dataStart, e.size);
        if (v <= 0) throw new WebmParseError('TimecodeScale must be > 0', pos);
        this.timecodeScaleNs = v;
      } else if (e.id === ID_DURATION) {
        const d = this.r.readFloat(e.dataStart, e.size);
        if (!Number.isFinite(d) || d < 0) throw new WebmParseError('invalid Duration', pos);
        this.durationTc = d;
      }
      pos = e.dataStart + e.size;
    }
  }

  private parseTracks(start: number, end: number): void {
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.unknownSize) throw new WebmParseError('unknown size inside Tracks', pos);
      const elEnd = e.dataStart + e.size;
      if (e.id === ID_TRACK_ENTRY) this.parseTrackEntry(e.dataStart, elEnd);
      pos = elEnd;
    }
  }

  private parseTrackEntry(start: number, end: number): void {
    const t: TrackInfo = {
      number: 0,
      type: 0,
      codecId: '',
      codecPrivateStart: -1,
      codecPrivateEnd: -1,
      codecDelayNs: 0,
      seekPreRollNs: 0,
      channels: 1,
      samplingFrequency: 8000,
    };
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.unknownSize) throw new WebmParseError('unknown size inside TrackEntry', pos);
      const ds = e.dataStart;
      const sz = e.size;
      switch (e.id) {
        case ID_TRACK_NUMBER:
          t.number = this.r.readUint(ds, sz);
          break;
        case ID_TRACK_TYPE:
          t.type = this.r.readUint(ds, sz);
          break;
        case ID_CODEC_ID:
          t.codecId = this.r.readString(ds, sz);
          break;
        case ID_CODEC_PRIVATE:
          t.codecPrivateStart = ds;
          t.codecPrivateEnd = ds + sz;
          break;
        case ID_CODEC_DELAY:
          t.codecDelayNs = this.r.readUint(ds, sz);
          break;
        case ID_SEEK_PRE_ROLL:
          t.seekPreRollNs = this.r.readUint(ds, sz);
          break;
        case ID_AUDIO:
          this.parseAudio(ds, ds + sz, t);
          break;
        default:
          break;
      }
      pos = ds + sz;
    }
    if (t.number === 0) throw new WebmParseError('TrackEntry without TrackNumber', start);
    this.tracks.push(t);
  }

  private parseAudio(start: number, end: number, t: TrackInfo): void {
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.unknownSize) throw new WebmParseError('unknown size inside Audio', pos);
      if (e.id === ID_CHANNELS) t.channels = this.r.readUint(e.dataStart, e.size);
      else if (e.id === ID_SAMPLING_FREQUENCY) t.samplingFrequency = this.r.readFloat(e.dataStart, e.size);
      pos = e.dataStart + e.size;
    }
  }

  /**
   * Parses one Cluster. `end` is −1 for an unknown-size Cluster, which then ends at the next
   * Segment-level element or at `parentEnd`. Returns the offset after the Cluster.
   */
  private parseCluster(start: number, end: number, parentEnd: number): number {
    const unknown = end < 0;
    const limit = unknown ? parentEnd : end;
    let clusterTc = -1;
    let pos = start;
    while (pos < limit) {
      const e = this.r.readHeader(pos, limit);
      if (unknown && isSegmentLevelId(e.id)) return pos;
      if (e.unknownSize) throw new WebmParseError(`element 0x${e.id.toString(16)} with unknown size in Cluster`, pos);
      const ds = e.dataStart;
      const elEnd = ds + e.size;
      if (e.id === ID_CLUSTER_TIMECODE) {
        clusterTc = this.r.readUint(ds, e.size);
      } else if (e.id === ID_SIMPLE_BLOCK) {
        if (clusterTc < 0) throw new WebmParseError('SimpleBlock before cluster Timecode', pos);
        this.parseBlock(ds, elEnd, clusterTc, Number.NaN);
      } else if (e.id === ID_BLOCK_GROUP) {
        if (clusterTc < 0) throw new WebmParseError('BlockGroup before cluster Timecode', pos);
        this.parseBlockGroup(ds, elEnd, clusterTc);
      }
      pos = elEnd;
    }
    return limit;
  }

  private parseBlockGroup(start: number, end: number, clusterTc: number): void {
    let blockStart = -1;
    let blockEnd = -1;
    let discard = Number.NaN;
    let pos = start;
    while (pos < end) {
      const e = this.r.readHeader(pos, end);
      if (e.unknownSize) throw new WebmParseError('unknown size inside BlockGroup', pos);
      if (e.id === ID_BLOCK) {
        if (blockStart >= 0) throw new WebmParseError('BlockGroup with more than one Block', pos);
        blockStart = e.dataStart;
        blockEnd = e.dataStart + e.size;
      } else if (e.id === ID_DISCARD_PADDING) {
        discard = this.r.readInt(e.dataStart, e.size);
      }
      pos = e.dataStart + e.size;
    }
    if (blockStart < 0) throw new WebmParseError('BlockGroup without Block', start);
    this.parseBlock(blockStart, blockEnd, clusterTc, discard);
  }

  /** Parses a (Simple)Block payload: track VINT, int16 timecode, flags, optional lacing, frames. */
  private parseBlock(start: number, end: number, clusterTc: number, discardNs: number): void {
    const b = this.bytes;
    const v = this.vint;
    readVintValue(b, start, end, v);
    const track = v[0]!;
    let pos = start + v[1]!;
    if (pos + 3 > end) throw new WebmParseError('truncated block header', start);
    const blockTc = clusterTc + this.r.readInt16(pos);
    const flags = b[pos + 2]!;
    pos += 3;
    const lacing = (flags >> 1) & 3;
    const f = this.frames;
    f.lastDiscard.set(track, discardNs);
    if (lacing === 0) {
      this.pushFrame(track, pos, end, blockTc, 0);
      return;
    }
    if (pos >= end) throw new WebmParseError('truncated lace header', pos);
    const count = b[pos]! + 1;
    pos++;
    const sizes = this.laceSizes;
    sizes.length = 0;
    if (lacing === 1) {
      // Xiph: each of the first count−1 sizes is a run of 255s plus a terminating byte < 255.
      for (let i = 0; i < count - 1; i++) {
        let size = 0;
        for (;;) {
          if (pos >= end) throw new WebmParseError('truncated Xiph lace size', pos);
          const x = b[pos++]!;
          size += x;
          if (x !== 255) break;
        }
        sizes.push(size);
      }
    } else if (lacing === 3) {
      // EBML: first size unsigned, following ones signed differences (VINT − (2^(7n−1) − 1)).
      readVintValue(b, pos, end, v);
      let size = v[0]!;
      pos += v[1]!;
      sizes.push(size);
      for (let i = 1; i < count - 1; i++) {
        readVintValue(b, pos, end, v);
        const len = v[1]!;
        size += v[0]! - (2 ** (7 * len - 1) - 1);
        if (size < 0) throw new WebmParseError('negative EBML lace size', pos);
        pos += len;
        sizes.push(size);
      }
    } else {
      // Fixed-size lacing: the remaining bytes split evenly.
      const rest = end - pos;
      if (rest % count !== 0) throw new WebmParseError(`fixed lacing: ${rest} bytes not divisible by ${count}`, pos);
      const size = rest / count;
      for (let i = 0; i < count - 1; i++) sizes.push(size);
    }
    let used = 0;
    for (let i = 0; i < sizes.length; i++) used += sizes[i]!;
    const last = end - pos - used;
    if (last < 0) throw new WebmParseError('lace sizes exceed block', pos);
    sizes.push(last);
    for (let i = 0; i < count; i++) {
      const s = sizes[i]!;
      this.pushFrame(track, pos, pos + s, blockTc, i);
      pos += s;
    }
  }

  private pushFrame(track: number, start: number, end: number, blockTc: number, laceIndex: number): void {
    const f = this.frames;
    f.track.push(track);
    f.view.push(this.bytes.subarray(start, end));
    f.blockTc.push(blockTc);
    f.laceIndex.push(laceIndex);
  }
}

function describeTracks(tracks: readonly TrackInfo[]): string {
  if (tracks.length === 0) return 'no tracks';
  return tracks.map((t) => `#${t.number} type ${t.type} '${t.codecId}'`).join(', ');
}

/**
 * Demuxes the first Opus audio track of a WebM/Matroska file.
 * @throws WebmParseError for malformed input, missing OpusHead or when no `A_OPUS` audio track exists.
 */
export function demuxWebmOpus(data: ArrayBuffer | Uint8Array): WebmOpusTrack {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const d = new Demuxer(bytes);
  d.run();
  const track = d.tracks.find((t) => t.type === TRACK_TYPE_AUDIO && t.codecId === 'A_OPUS');
  if (!track) throw new WebmParseError(`no A_OPUS audio track (${describeTracks(d.tracks)})`, 0);
  if (track.codecPrivateStart < 0) throw new WebmParseError('Opus track without CodecPrivate (OpusHead)', 0);
  const head = bytes.subarray(track.codecPrivateStart, track.codecPrivateEnd);
  const at = track.codecPrivateStart;
  if (head.length < 19) throw new WebmParseError('OpusHead shorter than 19 bytes', at);
  const magic = 'OpusHead';
  for (let i = 0; i < 8; i++) {
    if (head[i] !== magic.charCodeAt(i)) throw new WebmParseError('CodecPrivate is not an OpusHead', at);
  }
  if (head[8]! >> 4 !== 0) throw new WebmParseError(`unsupported OpusHead version ${head[8]}`, at + 8);
  const channels = head[9]!;
  if (channels === 0) throw new WebmParseError('OpusHead with 0 channels', at + 9);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const preSkip = hv.getUint16(10, true);
  const inputSampleRate = hv.getUint32(12, true);
  const outputGainQ8 = hv.getInt16(16, true);
  const family = head[18]!;
  if (family === 0 && channels > 2) throw new WebmParseError('mapping family 0 with more than 2 channels', at + 18);
  if (family !== 0 && head.length < 21 + channels) throw new WebmParseError('OpusHead channel mapping table truncated', at);

  const f = d.frames;
  const packets: Uint8Array[] = [];
  let n = 0;
  for (let i = 0; i < f.track.length; i++) if (f.track[i] === track.number) n++;
  if (n === 0) throw new WebmParseError('Opus track without packets', 0);
  const timestampsUs = new Float64Array(n);
  const tcToUs = d.timecodeScaleNs / 1000;
  let k = 0;
  for (let i = 0; i < f.track.length; i++) {
    if (f.track[i] !== track.number) continue;
    const view = f.view[i]!;
    if (f.laceIndex[i] === 0 || k === 0) {
      timestampsUs[k] = f.blockTc[i]! * tcToUs;
    } else {
      // Laced frames share the block timestamp; later ones follow the previous packet's duration.
      timestampsUs[k] = timestampsUs[k - 1]! + (opusPacketSamples(packets[k - 1]!) * 1e6) / OPUS_SAMPLE_RATE;
    }
    packets.push(view);
    k++;
  }
  const lastDiscard = f.lastDiscard.get(track.number);
  const discardPaddingNs = lastDiscard === undefined || Number.isNaN(lastDiscard) ? 0 : lastDiscard;
  return {
    trackNumber: track.number,
    channels,
    inputSampleRate,
    preSkip,
    outputGainQ8,
    channelMappingFamily: family,
    codecDelayNs: track.codecDelayNs,
    seekPreRollNs: track.seekPreRollNs,
    opusHead: head,
    packets,
    timestampsUs,
    discardPaddingNs,
    durationNs: d.durationTc === null ? null : d.durationTc * d.timecodeScaleNs,
    timecodeScaleNs: d.timecodeScaleNs,
    docType: d.docType,
  };
}
