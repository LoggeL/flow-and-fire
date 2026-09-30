/**
 * Opus packet helpers (RFC 6716 §3.1): frame size from the TOC byte and frame count per packet.
 * Pure functions, no allocation. All sample counts are at 48 kHz (Opus' internal rate).
 */

/** Opus always decodes at 48 kHz internally; all sample counts here refer to that rate. */
export const OPUS_SAMPLE_RATE = 48_000;

/** Maximum duration of one Opus packet: 120 ms at 48 kHz (RFC 6716 §3.2.5). */
export const OPUS_MAX_PACKET_SAMPLES = 5_760;

/**
 * Samples (at 48 kHz) of one frame for each of the 32 TOC configurations.
 * 0–11 SILK NB/MB/WB: 10/20/40/60 ms; 12–15 Hybrid SWB/FB: 10/20 ms; 16–31 CELT NB/WB/SWB/FB: 2.5/5/10/20 ms.
 */
const FRAME_SAMPLES_BY_CONFIG: Int32Array = (() => {
  const t = new Int32Array(32);
  const silk = [480, 960, 1920, 2880];
  const hybrid = [480, 960];
  const celt = [120, 240, 480, 960];
  for (let c = 0; c < 32; c++) {
    if (c < 12) t[c] = silk[c & 3]!;
    else if (c < 16) t[c] = hybrid[c & 1]!;
    else t[c] = celt[c & 3]!;
  }
  return t;
})();

/** Samples (48 kHz) of one frame for the TOC byte `toc` (config = toc >> 3). */
export function opusFrameSamples(toc: number): number {
  return FRAME_SAMPLES_BY_CONFIG[(toc >> 3) & 31]!;
}

/**
 * Number of frames in an Opus packet from its TOC code (toc & 3): code 0 → 1, code 1/2 → 2,
 * code 3 → the frame-count byte (low 6 bits). Returns 0 for malformed packets (empty packet,
 * code 3 without count byte, count 0).
 */
export function opusPacketFrames(packet: Uint8Array): number {
  if (packet.length < 1) return 0;
  const code = packet[0]! & 3;
  if (code === 0) return 1;
  if (code !== 3) return 2;
  if (packet.length < 2) return 0;
  return packet[1]! & 0x3f;
}

/**
 * Decoded samples per channel (48 kHz) of one Opus packet, from the TOC byte and the frame count.
 * Malformed packets (empty, missing count byte, zero frames, total > 120 ms) yield 0, matching the
 * decoder's behaviour of rejecting them (libopus `opus_packet_get_nb_samples` → OPUS_INVALID_PACKET).
 */
export function opusPacketSamples(packet: Uint8Array): number {
  const frames = opusPacketFrames(packet);
  if (frames === 0) return 0;
  const total = frames * opusFrameSamples(packet[0]!);
  return total > OPUS_MAX_PACKET_SAMPLES ? 0 : total;
}

/** The part of a parsed WebM/Opus track that {@link expectedOutputSamples} needs. */
export interface OpusTrackSampleInfo {
  readonly packets: readonly Uint8Array[];
  readonly preSkip: number;
  readonly discardPaddingNs: number;
}

/**
 * Samples per channel (48 kHz) a conforming decoder outputs for the whole track:
 * Σ packet samples − preSkip − round(discardPaddingNs · 48000 / 1e9), never below 0.
 * For files written by ffmpeg (libopus + WebM muxer) this equals the length of the source PCM.
 */
export function expectedOutputSamples(track: OpusTrackSampleInfo): number {
  let total = 0;
  const packets = track.packets;
  for (let i = 0; i < packets.length; i++) total += opusPacketSamples(packets[i]!);
  const padding = Math.round((track.discardPaddingNs * OPUS_SAMPLE_RATE) / 1e9);
  const out = total - track.preSkip - (padding > 0 ? padding : 0);
  return out > 0 ? out : 0;
}
