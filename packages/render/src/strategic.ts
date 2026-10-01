/**
 * Strategic zoom (C2, PLAN §3.7 "Mesh → Icon per Alpha-Crossfade … Ab Z1 keine Schatten und Props,
 * ab Z2 nur Icons"): pure functions shared by the shaders (GLSL mirror {@link STRATEGIC_GLSL}), the CPU
 * culler and the client (box select on icons uses exactly the same geometry).
 *
 * Crossfade per unit (DECISIONS 23): the projected height of the unit's selection circle,
 * `px = 2 · selectionRadius · projK / distance` in CSS px (distance = eye → interpolated unit position,
 * `projK = viewportCssHeight / (2 · tan(fovY / 2))`), against the visual's `iconThreshold`:
 * `px ≤ threshold` ⇒ icon only, `px ≥ ICON_FADE_BAND · threshold` ⇒ mesh only, linear in between
 * ({@link iconFade}). The mesh fades out by screen-door dithering in the unit FS (no sorting), the
 * icon by alpha. A threshold of 0 disables the icon for that visual (except in Z2).
 *
 * Zoom levels from the camera distance relative to the map size ({@link strategicZoom}):
 * Z0 `< Z1`, Z1 `≥ max(ZOOM_Z1_FACTOR · map, ZOOM_Z1_MIN_WU)` (flags: no shadows/props – for later
 * passes; today: reduced decal detail), Z2 `≥ max(ZOOM_Z2_FACTOR · map, ZOOM_Z2_MIN_WU)` icons only:
 * the unit pass is skipped. Between `ZOOM_FORCE_START · Z2` and Z2 a global icon force ramps 0 → 1 and
 * enters every unit's fade as `max(fade, force)`, so the switch to Z2 never pops.
 */
import type { RtsCamera } from './camera.ts';

/** Mesh fully visible from `ICON_FADE_BAND × iconThreshold` projected px (band [T, 1.5 T]). */
export const ICON_FADE_BAND = 1.5;
/** Default `iconThreshold` (CSS px) when a visual does not set one (= blueprint default). */
export const DEFAULT_ICON_THRESHOLD_PX = 14;
/** Icon edge length in CSS px (DPR-scaled on the GPU). */
export const ICON_SIZE_PX = 20;
/** Height of the tech-stroke strip above the icon, relative to the icon size. */
export const ICON_TECH_STRIP = 0.4;
/** Zoom level factors relative to the map edge length and their minimum distances (WU). */
export const ZOOM_Z1_FACTOR = 0.25;
export const ZOOM_Z2_FACTOR = 0.75;
export const ZOOM_Z1_MIN_WU = 60;
export const ZOOM_Z2_MIN_WU = 180;
/** The global icon force ramps from `ZOOM_FORCE_START × Z2` to Z2. */
export const ZOOM_FORCE_START = 0.85;
/** Map size assumed without terrain. */
export const DEFAULT_MAP_SIZE_WU = 1024;

/** HP bar geometry (CSS px): above the mesh / below the icon. */
export const HP_BAR_WIDTH_PX = 26;
export const HP_BAR_HEIGHT_PX = 4;
export const HP_BAR_GAP_PX = 3;

export type ZoomLevel = 0 | 1 | 2;

export interface StrategicZoom {
  level: ZoomLevel;
  /** Global icon force 0..1 (1 from Z2 on). */
  iconForce: number;
  /** Distances (WU) where Z1 and Z2 start for this map. */
  z1: number;
  z2: number;
}

/** Zoom level and icon force for a camera distance (WU) and map edge length (WU). */
export function strategicZoom(distanceWU: number, mapSizeWU: number, out?: StrategicZoom): StrategicZoom {
  const map = mapSizeWU > 0 ? mapSizeWU : DEFAULT_MAP_SIZE_WU;
  const z1 = Math.max(ZOOM_Z1_FACTOR * map, ZOOM_Z1_MIN_WU);
  const z2 = Math.max(ZOOM_Z2_FACTOR * map, ZOOM_Z2_MIN_WU);
  const level: ZoomLevel = distanceWU >= z2 ? 2 : distanceWU >= z1 ? 1 : 0;
  const f0 = ZOOM_FORCE_START * z2;
  const force = distanceWU >= z2 ? 1 : distanceWU <= f0 ? 0 : (distanceWU - f0) / (z2 - f0);
  const o = out ?? { level: 0, iconForce: 0, z1: 0, z2: 0 };
  o.level = level;
  o.iconForce = force;
  o.z1 = z1;
  o.z2 = z2;
  return o;
}

export interface ZoomFlags {
  /** Unit meshes are drawn (false in Z2: the unit pass is skipped). */
  readonly meshes: boolean;
  /** Shadows / props (for later passes: off from Z1). */
  readonly shadows: boolean;
  readonly props: boolean;
  /** Decal details (dashes, footprint fill): off from Z1. */
  readonly decalDetail: boolean;
}

const ZOOM_FLAGS: readonly ZoomFlags[] = [
  { meshes: true, shadows: true, props: true, decalDetail: true },
  { meshes: true, shadows: false, props: false, decalDetail: false },
  { meshes: false, shadows: false, props: false, decalDetail: false },
];

export function zoomFlags(level: ZoomLevel): ZoomFlags {
  return ZOOM_FLAGS[level]!;
}

/** CSS px of 1 WU seen at 1 WU distance: `viewportCssHeight / (2 · tan(fovY / 2))`. */
export function iconProjectionScale(viewportCssHeight: number, fovY: number): number {
  return viewportCssHeight / (2 * Math.tan(fovY / 2));
}

/** Projected height (CSS px) of a selection circle of radius `selectionRadiusWU` at `distanceWU`. */
export function unitProjectedPx(selectionRadiusWU: number, distanceWU: number, projK: number): number {
  return (2 * selectionRadiusWU * projK) / Math.max(distanceWU, 1e-4);
}

/**
 * Icon opacity 0..1 (= mesh dither coverage) for a projected height: 1 at or below the threshold, 0 at
 * or above `ICON_FADE_BAND × threshold`, linear in between; `max` with the zoom icon force.
 */
export function iconFade(projectedPx: number, thresholdPx: number, iconForce = 0): number {
  let f = 0;
  if (thresholdPx > 0) {
    f = (ICON_FADE_BAND * thresholdPx - projectedPx) / ((ICON_FADE_BAND - 1) * thresholdPx);
    f = f < 0 ? 0 : f > 1 ? 1 : f;
  }
  const g = iconForce < 0 ? 0 : iconForce > 1 ? 1 : iconForce;
  return f > g ? f : g;
}

/** Eye → world point (raw Q20.12) distance in WU, computed like the shaders (integer difference first). */
export function eyeDistanceWU(camera: RtsCamera, xRaw: number, yRaw: number, zRaw: number): number {
  const ci = camera.camPosInt;
  const cf = camera.camFrac;
  const dx = (xRaw - ci[0]!) / 4096 - cf[0]!;
  const dy = (yRaw - ci[1]!) / 4096 - cf[1]!;
  const dz = (zRaw - ci[2]!) / 4096 - cf[2]!;
  return Math.hypot(dx, dy, dz);
}

/**
 * Icon opacity of a unit at a world position (raw), as the shaders compute it. `iconForce` is the
 * zoom force of the frame ({@link strategicZoom} of `camera.distance` and the map size).
 */
export function unitIconFade(
  camera: RtsCamera,
  xRaw: number,
  yRaw: number,
  zRaw: number,
  selectionRadiusWU: number,
  thresholdPx: number,
  iconForce: number,
): number {
  const k = iconProjectionScale(camera.viewportHeight, camera.fovY);
  return iconFade(unitProjectedPx(selectionRadiusWU, eyeDistanceWU(camera, xRaw, yRaw, zRaw), k), thresholdPx, iconForce);
}

const projTmp = new Float64Array(4);

/**
 * Screen rectangle (CSS px, `[x0, y0, x1, y1]`, top-left origin) of the icon square of a unit at a
 * world position (raw): centered on the projected position, `sizePx` wide and high – the same quad
 * the IconPass draws (the tech strip sits above it and is not part of the hit area). Returns false
 * when the point is behind the camera.
 */
export function iconScreenRect(
  camera: RtsCamera,
  xRaw: number,
  yRaw: number,
  zRaw: number,
  out: Float64Array | number[],
  sizePx = ICON_SIZE_PX,
): boolean {
  if (!camera.project(xRaw, yRaw, zRaw, projTmp)) return false;
  const h = sizePx / 2;
  out[0] = projTmp[0]! - h;
  out[1] = projTmp[1]! - h;
  out[2] = projTmp[0]! + h;
  out[3] = projTmp[1]! + h;
  return true;
}

/** GLSL mirror of {@link iconFade} / {@link unitIconFade} (needs FRAME_BLOCK_GLSL). */
export const STRATEGIC_GLSL = /* glsl */ `
float iconFadeOf(float px, float thr, float force) {
  float f = 0.0;
  if (thr > 0.0) f = clamp((${ICON_FADE_BAND.toFixed(4)} * thr - px) / (${(ICON_FADE_BAND - 1).toFixed(4)} * thr), 0.0, 1.0);
  return max(f, clamp(force, 0.0, 1.0));
}
// rel: unit position relative to the eye (WU); vis: visual row 0 (glyph, tech, threshold, selectionRadius).
float unitIconFade(vec3 rel, vec4 vis) {
  if (u_strategic.x <= 0.0) return 0.0; // strategic zoom disabled (no frame data)
  float px = 2.0 * vis.w * u_strategic.x / max(length(rel), 1e-4);
  return iconFadeOf(px, vis.z, u_strategic.y);
}
`;
