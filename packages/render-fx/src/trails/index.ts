// Beams and projectile trails (rfx-p4, PLAN §3.7 "Beams … instanzierte Quads").
export {
  BeamPass,
  BEAM_STRIDE,
  BEAM_OFF_FROM,
  BEAM_OFF_TO,
  BEAM_OFF_CORE,
  BEAM_OFF_GLOW,
  BEAM_OFF_PARAMS,
  BEAM_OFF_MISC,
  BEAM_CORE_WIDTH,
  BEAM_GLOW_SHARPNESS,
  BEAM_GLOW_WEIGHT,
  beamProfile,
  timedBeamFade,
} from './beams.ts';
export type { BeamStyle, BeamPassOptions, BeamPassStats } from './beams.ts';
export {
  TrailPass,
  TRAIL_STRIDE,
  TRAIL_OFF_PREV,
  TRAIL_OFF_CUR,
  TRAIL_OFF_HEAD,
  TRAIL_OFF_TAIL,
  TRAIL_OFF_DIMS,
  TRAIL_TAIL_TAPER,
  TRAIL_MIN_DIR_SQ,
  trailEndpointsWu,
} from './trails.ts';
export type { TrailStyle, TrailPassOptions, TrailPassStats } from './trails.ts';
export { VARKAN_BEAM_STYLES, VARKAN_TRAIL_STYLES } from './presets.ts';
export type { VarkanBeamStyleName, VarkanTrailStyleName } from './presets.ts';
export { FX_HALF_GLSL, FX_NOISE_GLSL, FX_RIBBON_GLSL, glslFloat } from './glsl.ts';
export { packHalf } from './pack.ts';
