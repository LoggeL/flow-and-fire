/**
 * @faf/audio/catalog — manifest validation and the sound catalog (lookup faction → common,
 * resolved policies, decoded-buffer store). audioeng-b2.
 */

export { parseManifest, ManifestError, MANIFEST_SAMPLE_RATE, MAX_LOOP_PADDING_S, MAX_VOICE_LIMIT } from './manifest.ts';
export { SoundCatalog, COMMON_SCOPE, bufferBytes, joinUrl, type LoadHook } from './catalog.ts';
