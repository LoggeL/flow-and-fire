/**
 * Render presets (PLAN §3.7 "Presets": Low bis Ultra mit Caps, Render-Scale, Splat-Layern und
 * Kaskaden; infrastructure from MS2, UI and autodetect in MS14).
 *
 * The renderer applies splat layers, LOD bias and water quality; the render scale is applied by
 * whoever sizes the canvas ({@link backbufferSize}; `Renderer.resize()` uses it as well). Shadows are
 * 'none' in MS2 – CSM/blob shadows arrive with SPK4/MS8 and only then get real values here.
 */

export type RenderPresetName = 'low' | 'medium' | 'high' | 'ultra';
export type WaterQuality = 'low' | 'medium' | 'high';
export type ShadowMode = 'none' | 'blob' | 'csm';

export interface RenderCaps {
  /** Particle ring size (PLAN §3.7 "64k, Cap nach Preset"). */
  readonly particles: number;
  /** Props drawn at most (instanced). */
  readonly props: number;
  /** Terrain decals uploaded at most (≤ 4,096). */
  readonly decals: number;
  /** Unit instances drawn at most per frame (after culling). */
  readonly unitInstances: number;
}

export interface RenderPreset {
  readonly name: RenderPresetName;
  /** Drawing-buffer scale relative to CSS px × devicePixelRatio. */
  readonly renderScale: number;
  /** Painted splat layers used at most (the auto-splat base is always on). */
  readonly splatLayers: 4 | 8;
  /** Multiplies the LOD switch distances (< 1: earlier to coarser meshes). */
  readonly lodBias: number;
  readonly waterQuality: WaterQuality;
  readonly shadows: ShadowMode;
  /** CSM cascades (0 while shadows are 'none'). */
  readonly shadowCascades: number;
  /** HDR RGBA16F target + bloom (needs EXT_color_buffer_float; LDR fallback otherwise). */
  readonly hdr: boolean;
  readonly bloom: boolean;
  /** MSAA samples of the main target (PLAN: "MSAA ab High"). */
  readonly msaa: number;
  /** Triplanar terrain mapping on steep slopes (PLAN: "Triplanar ab High"; since DECISIONS 25 ab Medium). */
  readonly triplanar: boolean;
  readonly caps: RenderCaps;
}

export const RENDER_PRESETS: { readonly [K in RenderPresetName]: RenderPreset } = {
  low: {
    name: 'low',
    renderScale: 0.66,
    splatLayers: 4,
    lodBias: 0.6,
    waterQuality: 'low',
    shadows: 'none',
    shadowCascades: 0,
    hdr: false,
    bloom: false,
    msaa: 0,
    triplanar: false,
    caps: { particles: 8192, props: 16384, decals: 1024, unitInstances: 4096 },
  },
  medium: {
    name: 'medium',
    renderScale: 0.8,
    // 8 layers and triplanar cliffs on Medium as well (Setons review R1: without plane 1 the map
    // lacks earth/dry grass/moss; measured cost negligible, DECISIONS 25).
    splatLayers: 8,
    lodBias: 0.8,
    waterQuality: 'medium',
    shadows: 'none',
    shadowCascades: 0,
    hdr: false,
    bloom: false,
    msaa: 0,
    triplanar: true,
    caps: { particles: 16384, props: 32768, decals: 2048, unitInstances: 8192 },
  },
  high: {
    name: 'high',
    renderScale: 1,
    splatLayers: 8,
    lodBias: 1,
    waterQuality: 'high',
    shadows: 'none',
    shadowCascades: 0,
    hdr: false,
    bloom: false,
    msaa: 4,
    triplanar: true,
    caps: { particles: 32768, props: 65536, decals: 4096, unitInstances: 16384 },
  },
  ultra: {
    name: 'ultra',
    renderScale: 1,
    splatLayers: 8,
    lodBias: 1.25,
    waterQuality: 'high',
    shadows: 'none',
    shadowCascades: 0,
    hdr: false,
    bloom: false,
    msaa: 4,
    triplanar: true,
    caps: { particles: 65536, props: 65536, decals: 4096, unitInstances: 16384 },
  },
};

export const RENDER_PRESET_NAMES: readonly RenderPresetName[] = ['low', 'medium', 'high', 'ultra'];

/** Parses a preset name (e.g. from `?preset=`); unknown → undefined. */
export function parsePresetName(s: string | null | undefined): RenderPresetName | undefined {
  return s === 'low' || s === 'medium' || s === 'high' || s === 'ultra' ? s : undefined;
}

export function resolvePreset(p: RenderPresetName | RenderPreset): RenderPreset {
  return typeof p === 'string' ? RENDER_PRESETS[p] : p;
}

/**
 * Drawing-buffer size for a canvas of `cssW × cssH` CSS pixels: `round(css × dpr × renderScale)`,
 * at least 1 and at most `maxSize` (the device's MAX_TEXTURE_SIZE / renderbuffer limit).
 */
export function backbufferSize(
  cssW: number,
  cssH: number,
  dpr: number,
  renderScale: number,
  maxSize = 16384,
): { width: number; height: number } {
  const f = Math.max(0, dpr) * Math.max(0, renderScale);
  const width = Math.min(maxSize, Math.max(1, Math.round(cssW * f)));
  const height = Math.min(maxSize, Math.max(1, Math.round(cssH * f)));
  return { width, height };
}
