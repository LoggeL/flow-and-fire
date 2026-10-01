/** @faf/audio/voices — voice manager (limits, priority, stealing, cooldowns, variants, loops) and keyed loops. */
export { VoiceManager, DEFAULT_CULL_GAIN, DEFAULT_STOP_FADE_MS, VOICE_RAMP_TAU_S } from './voice-manager.ts';
export type { VoiceManagerOptions, VoiceMixer } from './voice-manager.ts';
export { LoopSet } from './loop-set.ts';
export type { LoopSetOptions } from './loop-set.ts';
export { createVoiceStats, dropReasonIndex } from './stats.ts';
export type { VoiceStats } from './stats.ts';
