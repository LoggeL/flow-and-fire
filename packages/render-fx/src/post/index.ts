// Post-processing (PLAN §3.7): HDR scene target, dual-Kawase bloom, ACES, FXAA with LDR fallback.
export { PostChain, DEFAULT_POST_OPTIONS } from './post-chain.ts';
export type { PostOptions, PostPhase, PostStats, PostTargetInfo } from './post-chain.ts';
export { POST_PRESET_TABLE, postOptionsForPreset } from './presets.ts';
export {
  ACES_GLSL,
  DISPLAY_GAMMA,
  KAWASE_DOWN_TAPS,
  KAWASE_UP_TAPS,
  MAX_BLOOM_LEVELS,
  MIN_BLOOM_LEVELS,
  acesFilm,
  bloomLevelSize,
  compositeHdr,
  kawaseOffsets,
} from './tonemap.ts';
export type { KawaseLevelTaps, KawaseTap } from './tonemap.ts';
export { FULLSCREEN_STREAM, FULLSCREEN_TRIANGLE, FULLSCREEN_VS, POST_LAYOUT, BLOOM_INPUT_MAX } from './shaders.ts';
