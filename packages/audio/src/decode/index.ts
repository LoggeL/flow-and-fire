/**
 * @faf/audio/decode — pure building blocks of the fallback decode path: WebM/Opus demuxer,
 * Opus packet sample counting and the PCM assembler (used by src/loader, audioeng-b2).
 */

export { demuxWebmOpus, WebmParseError, type WebmOpusTrack } from './webm.ts';
export {
  OPUS_SAMPLE_RATE,
  OPUS_MAX_PACKET_SAMPLES,
  opusFrameSamples,
  opusPacketFrames,
  opusPacketSamples,
  expectedOutputSamples,
  type OpusTrackSampleInfo,
} from './opus-packet.ts';
export { PcmAssembler, type PcmAssemblerOptions } from './pcm.ts';
