/**
 * Binding slot table of @faf/render-fx (TRACK-RENDERFX common contract, binding for every FX pass).
 *
 * @faf/render owns uniform-block slots 0 (Frame), 1 (Palette), 2 (Pass – every pass binds its own
 * block there) and 3 (TerrainHeight) plus texture units 0–7. Slots 4–5 and units 8–9 stay free for
 * render/MS3. Post-processing passes are standalone fullscreen passes with their own units 0/1.
 */

/** Uniform block `FxView` (camera axes, FX time, pixel scale). */
export const SLOT_FX_VIEW = 6;
/** Uniform block of the cascaded shadow maps (light/). */
export const SLOT_FX_SHADOW = 7;
/** Uniform block of the scorch/crater decal field (decals/). */
export const SLOT_FX_SCORCH = 8;

/** Static (cached) shadow cascade depth texture. */
export const UNIT_FX_SHADOW_STATIC = 10;
/** Dynamic (per-frame) shadow cascade depth texture. */
export const UNIT_FX_SHADOW_DYNAMIC = 11;
/** Particle curve lookup texture (effects/particles). */
export const UNIT_FX_CURVE_LUT = 12;
/** Scorch decal record texture. */
export const UNIT_FX_SCORCH_DATA = 13;
/** Scorch decal cell/bin texture. */
export const UNIT_FX_SCORCH_CELLS = 14;

/**
 * FX time in shaders is seconds modulo this value (keeps f32 precision at ~0.5 ms after hours of play).
 * Particle age = mod(now − t0 + FX_TIME_WRAP_S, FX_TIME_WRAP_S); lifetimes must stay ≤ 60 s.
 */
export const FX_TIME_WRAP_S = 4096;
