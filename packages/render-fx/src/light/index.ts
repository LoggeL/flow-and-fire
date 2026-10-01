// Lighting and shadows (PLAN §3.7): cascaded shadow maps with a static cache, receiver/caster GLSL,
// forward sun + hemisphere lighting and the emissive convention.
export { CascadedShadows, NullShadowReceiver, DEFAULT_SHADOW_SIZE, DEFAULT_SHADOW_STRENGTH } from './cascaded-shadows.ts';
export type { CascadedShadowsOptions, CascadedShadowsStats, ShadowCasterFn, ShadowCasterView } from './cascaded-shadows.ts';
export { CascadeFitter, MAX_CASCADES, cascadeSplits, shadowEnd, shadowNear } from './cascades.ts';
export type { Cascade, CascadeFitOptions } from './cascades.ts';
export {
  SHADOW_CASTER_BLOCK_NAME,
  SHADOW_CASTER_GLSL,
  SHADOW_CASTER_LAYOUT,
  SHADOW_CASTER_PIPELINE,
  SHADOW_CASTER_SLOT,
  SHADOW_CASTER_UNIFORM_BLOCKS,
  SHADOW_DEPTH_FS,
  SHADOW_RECEIVE_GLSL,
  SHADOW_RECV_BLOCK_GLSL,
  SHADOW_RECV_BLOCK_NAME,
  SHADOW_RECV_LAYOUT,
  SHADOW_RECV_SAMPLERS,
  SHADOW_RECV_UNIFORM_BLOCKS,
} from './shadow-glsl.ts';
export { LIGHTING_GLSL, LIGHTING_GLSL_LDR, fxEmissiveRef, fxLightRef, lightingGlsl } from './lighting.ts';
export type { LightParams } from './lighting.ts';
export { SHADOW_PRESET_TABLE, shadowOptionsForPreset } from './presets.ts';
export type { ShadowPresetTarget } from './presets.ts';
