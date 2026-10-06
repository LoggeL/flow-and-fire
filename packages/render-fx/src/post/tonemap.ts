/**
 * Tonemapping and dual-Kawase tap tables shared by the post shaders and their JS references
 * (PLAN §3.7 "HDR RGBA16F (sonst LDR), Dual-Kawase-Bloom, ACES, FXAA").
 *
 * The GLSL of the bloom passes is generated from the tap tables below, so the JS reference
 * {@link kawaseOffsets} and the shaders cannot drift apart.
 */

/**
 * ACES filmic curve (Krzysztof Narkowicz' fit) in linear space. Declares `vec3 fxAces(vec3 x)`.
 * Input: linear, exposed scene radiance; output: linear display value in [0, 1].
 */
export const ACES_GLSL = /* glsl */ `
vec3 fxAces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
`;

/** JS reference of {@link ACES_GLSL} for one channel (same constants, same clamp). */
export function acesFilm(x: number): number {
  const v = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Display gamma used by the composite: scene shaders output display-referred colors (like @faf/render). */
export const DISPLAY_GAMMA = 2.2;

/**
 * JS reference of the HDR composite for one channel: display-referred scene value (+ bloom) →
 * linearize, expose, ACES, back to display space.
 */
export function compositeHdr(sceneDisplay: number, exposure: number): number {
  const lin = Math.pow(Math.max(sceneDisplay, 0), DISPLAY_GAMMA) * exposure;
  return Math.pow(acesFilm(lin), 1 / DISPLAY_GAMMA);
}

/** One filter tap: offset in texels of the SOURCE image and weight. */
export type KawaseTap = readonly [x: number, y: number, weight: number];

/**
 * Dual-Kawase downsample (Bjørge 2015): centre ×4 plus the four diagonal half-texel corners
 * (each a bilinear 2×2 average), normalised by 8.
 */
export const KAWASE_DOWN_TAPS: readonly KawaseTap[] = [
  [0, 0, 4],
  [-0.5, -0.5, 1],
  [0.5, 0.5, 1],
  [0.5, -0.5, 1],
  [-0.5, 0.5, 1],
];

/** Dual-Kawase upsample (tent): 4 edge taps ×1 at one texel, 4 diagonal taps ×2 at half a texel, normalised by 12. */
export const KAWASE_UP_TAPS: readonly KawaseTap[] = [
  [-1, 0, 1],
  [-0.5, 0.5, 2],
  [0, 1, 1],
  [0.5, 0.5, 2],
  [1, 0, 1],
  [0.5, -0.5, 2],
  [0, -1, 1],
  [-0.5, -0.5, 2],
];

export const MIN_BLOOM_LEVELS = 1;
export const MAX_BLOOM_LEVELS = 6;

export interface KawaseLevelTaps {
  /** Bloom level (1 = half resolution … 6 = 1/64). */
  readonly level: number;
  /**
   * Taps of the downsample that PRODUCES this level (reads level − 1; level 0 = the scene). Offsets
   * are in full-resolution pixels: one source texel = 2^(level − 1) pixels.
   */
  readonly down: readonly KawaseTap[];
  /**
   * Taps of the upsample that READS this level (writes level − 1; only used for level ≥ 2 inside
   * the chain). Offsets in full-resolution pixels: one source texel = 2^level pixels.
   */
  readonly up: readonly KawaseTap[];
  readonly downWeightSum: number;
  readonly upWeightSum: number;
}

/**
 * Filter footprint of bloom level `level` (1..6) in full-resolution pixels. With every level halving
 * the resolution the effective blur radius doubles per level while each pass stays 5 resp. 8 taps.
 */
export function kawaseOffsets(level: number): KawaseLevelTaps {
  if (!Number.isInteger(level) || level < MIN_BLOOM_LEVELS || level > MAX_BLOOM_LEVELS) {
    throw new RangeError(`kawaseOffsets: level ${level} outside ${MIN_BLOOM_LEVELS}..${MAX_BLOOM_LEVELS}`);
  }
  const ds = 2 ** (level - 1);
  const us = 2 ** level;
  const scale = (taps: readonly KawaseTap[], s: number): KawaseTap[] => taps.map(([x, y, w]) => [x * s, y * s, w] as const);
  return {
    level,
    down: scale(KAWASE_DOWN_TAPS, ds),
    up: scale(KAWASE_UP_TAPS, us),
    downWeightSum: KAWASE_DOWN_TAPS.reduce((a, t) => a + t[2], 0),
    upWeightSum: KAWASE_UP_TAPS.reduce((a, t) => a + t[2], 0),
  };
}

/** Size of bloom level `level` for a `w × h` scene: max(1, floor(size / 2^level)). Level 0 = the scene. */
export function bloomLevelSize(w: number, h: number, level: number): { readonly width: number; readonly height: number } {
  const d = 2 ** level;
  return { width: Math.max(1, Math.floor(w / d)), height: Math.max(1, Math.floor(h / d)) };
}

/** GLSL float literal (always with a decimal point). */
export function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Generates `sum += texture(sampler, uv + vec2(x, y) * texel).rgb * w;` lines for a tap table. */
export function kawaseTapsGlsl(taps: readonly KawaseTap[], sampler: string, uv: string, texel: string): string {
  const lines: string[] = [];
  for (const [x, y, w] of taps) {
    const off = x === 0 && y === 0 ? uv : `${uv} + vec2(${glslFloat(x)}, ${glslFloat(y)}) * ${texel}`;
    const tap = `texture(${sampler}, ${off}).rgb`;
    lines.push(`  sum += ${w === 1 ? tap : `${tap} * ${glslFloat(w)}`};`);
  }
  return lines.join('\n');
}
