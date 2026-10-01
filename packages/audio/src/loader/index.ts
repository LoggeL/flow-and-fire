/**
 * @faf/audio/loader — decode chain (native → WebCodecs → WASM opus-decoder) and the prioritized
 * sound loader (fetch, decode, lazy loading, manifest fetch). audioeng-b2.
 */

export {
  createDecodeChain,
  nativeLengthWindow,
  DecodeError,
  NATIVE_TOLERANCE_FRAMES,
  type AudioDataLike,
  type AudioDecoderLike,
  type DecodeAttempt,
  type DecodeChain,
  type DecodeChainOptions,
  type DecodeExpect,
  type DecodeResult,
  type DecodeStats,
  type NativeSupport,
  type OpusDecoderConfigLike,
  type WasmOpusDecoderLike,
  type WasmOpusModuleLike,
  type WebCodecsApi,
  type WebCodecsTrim,
} from './decode-chain.ts';
export {
  SoundLoader,
  loadManifest,
  FIRST_CATEGORIES,
  type DecoderLike,
  type FetchLike,
  type FetchResponseLike,
  type LoadFailure,
  type LoadOptions,
  type LoadProgress,
  type SoundLoaderOptions,
  type SoundLoadReport,
  type SoundLoadState,
} from './loader.ts';
