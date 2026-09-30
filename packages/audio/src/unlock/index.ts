/**
 * @faf/audio/unlock — autoplay unlock of the realtime AudioContext (first user gesture, re-arm
 * after suspend/interruption). audioeng-b2.
 */

export { AutoplayUnlocker, UNLOCK_EVENTS, type AutoplayUnlockerOptions, type UnlockListener } from './unlocker.ts';
