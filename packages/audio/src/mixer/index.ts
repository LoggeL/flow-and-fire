/** @faf/audio/mixer — buses, perceptual volume curve, ducking, mute sources, master limiter. */
export { Mixer, CHANNEL_BUSES, LIMITER_SETTINGS, RAMP_TAU_S } from './mixer.ts';
export type { MixerGraph, MixerOptions, MuteSource } from './mixer.ts';
export { clamp01, dbToGain, gainToDb, gainToSlider, sliderToGain } from './curve.ts';
