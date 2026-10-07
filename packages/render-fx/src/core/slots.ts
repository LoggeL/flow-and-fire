/**
 * Binding slot table of @faf/render-fx (TRACK-RENDERFX common contract, binding for every FX pass).
 *
 * Uniform blocks: @faf/render owns slots 0 (Frame), 1 (Palette), 2 (Pass – every pass binds its own
 * block there) and 3 (TerrainHeight); 4–5 stay free for render. FX uses 6–8.
 *
 * Texture units (the RHI tracks 16 units, WebGL2 guarantees 16 per shader stage). Two classes:
 * - RECEIVER units are sampled inside render-owned programs (terrain FS, unit FS, water FS) next to
 *   render's own samplers. They must never collide with any unit render binds anywhere. After MS3
 *   render uses 0–11 (terrain 0–7 + 10/11 dynamic decals, units 0/1, visual data 8, icon atlas 9),
 *   so the receivers take the last four units 12–15. A terrain FS with shadows and scorch then
 *   samples 0–7, 10–15 = 14 of the 16 units.
 * - FX-PROGRAM units are sampled only by programs that render-fx owns completely (particle pass).
 *   They are pass-local like render's units 0–7 and the post passes' units 0/1: every draw binds its
 *   own group, so they may share numbers with render's pass-local units, but never with a RECEIVER
 *   unit (a future FX program may receive shadows/scorch).
 * The slot test checks both rules against the units render's sources actually bind.
 */

/** Uniform block `FxView` (camera axes, FX time, pixel scale). */
export const SLOT_FX_VIEW = 6;
/** Uniform block of the cascaded shadow maps (light/). */
export const SLOT_FX_SHADOW = 7;
/** Uniform block of the scorch/crater decal field (decals/). */
export const SLOT_FX_SCORCH = 8;

// ---- receiver units (inside render-owned programs; disjoint from every render unit) ----

/** Static (cached) shadow cascade depth texture. */
export const UNIT_FX_SHADOW_STATIC = 12;
/** Dynamic (per-frame) shadow cascade depth texture. */
export const UNIT_FX_SHADOW_DYNAMIC = 13;
/** Scorch decal record texture. */
export const UNIT_FX_SCORCH_DATA = 14;
/** Scorch decal cell/bin texture. */
export const UNIT_FX_SCORCH_CELLS = 15;

// ---- FX-program units (only in programs owned by render-fx; pass-local) ----

/** Particle curve lookup texture (effects/particles). */
export const UNIT_FX_CURVE_LUT = 0;
/** Particle layer table (RGBA32F, texelFetch in the particle VS). */
export const UNIT_FX_PARTICLE_LAYERS = 1;

/** Receiver units in table order (tests, integration checks). */
export const FX_RECEIVER_UNITS: readonly number[] = [UNIT_FX_SHADOW_STATIC, UNIT_FX_SHADOW_DYNAMIC, UNIT_FX_SCORCH_DATA, UNIT_FX_SCORCH_CELLS];
/** FX-program units in table order (tests, integration checks). */
export const FX_PROGRAM_UNITS: readonly number[] = [UNIT_FX_CURVE_LUT, UNIT_FX_PARTICLE_LAYERS];

/**
 * FX time in shaders is seconds modulo this value (keeps f32 precision at ~0.5 ms after hours of play).
 * Particle age = mod(now − t0 + FX_TIME_WRAP_S, FX_TIME_WRAP_S); lifetimes must stay ≤ 60 s.
 */
export const FX_TIME_WRAP_S = 4096;
