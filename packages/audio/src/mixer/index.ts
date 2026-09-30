/** @faf/audio/mixer — buses, perceptual volume curve, ducking, mute sources, master limiter. */
export { Mixer, CHANNEL_BUSES, LIMITER_MAKEUP_DB, LIMITER_SETTINGS, RAMP_TAU_S, compressorMakeupDb } from './mixer.ts';
export type { MixerGraph, MixerOptions, MuteSource, WaveShaperNodeLike } from './mixer.ts';
export { clamp01, dbToGain, gainToDb, gainToSlider, sliderToGain } from './curve.ts';
