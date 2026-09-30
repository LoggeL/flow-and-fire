/**
 * @faf/audio/engine — the AudioEngine facade (`createAudioEngine`) that wires context, mixer,
 * settings, catalog, loader, voice manager, loops, alert queue, event router and unlock.
 */
export {
  createAudioEngine,
  createDefaultAudioContext,
  timingStats,
  DEFAULT_FACTION,
  MAIN_JS_RING_SIZE,
  ALERT_DUCK_SFX_DB,
  ALERT_DUCK_BED_DB,
  ALERT_DUCK_ATTACK_MS,
  ALERT_DUCK_RELEASE_MS,
  type AudioEngineOptions,
  type EngineExtraOptions,
  type FafAudioEngine,
} from './engine.ts';
