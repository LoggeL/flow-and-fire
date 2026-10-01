// Shield bubbles (rfx-p4, PLAN §3.7 "Kugel-Instanzen mit Fresnel und 4 Ripples aus ShieldHit").
export {
  ShieldPass,
  SHIELD_RIPPLES,
  SHIELD_RIPPLE_LIFE_S,
  SHIELD_RIPPLE_SPEED,
  SHIELD_RIPPLE_WIDTH,
  SHIELD_RIPPLE_WIDTH_GROWTH,
  SHIELD_STRIDE,
  SHIELD_OFF_CENTER,
  SHIELD_OFF_RADIUS,
  SHIELD_OFF_COLOR,
  SHIELD_OFF_PARAMS,
  SHIELD_OFF_RIPPLE_T0,
  SHIELD_OFF_RIPPLE_STR,
  SHIELD_OFF_RIPPLE_DIR,
  shieldRippleEnergy,
  shieldRadiusScale,
} from './shields.ts';
export type { ShieldState, ShieldPassOptions, ShieldPassStats } from './shields.ts';
export { createIcosphere, icosphereVertexCount, icosphereTriangleCount, ICOSPHERE_MAX_SUBDIVISIONS } from './icosphere.ts';
export type { Icosphere } from './icosphere.ts';
