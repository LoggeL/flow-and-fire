/**
 * Colours and sizes of the marker overlay. Shared with the picker (src/pick) so hit radii match
 * what is drawn. Sizes are in WU at 1:1 zoom; every screen marker additionally keeps a minimum
 * size in CSS pixels (DECISIONS 28: resource spots stay readable from afar, lines >= 2 px).
 */
import type { PropFieldKind } from '@faf/formats';

/** Fx raw per WU. */
export const FX = 4096;

/**
 * Army colours (sRGB 0..1), same order as the game's default palette (packages/render
 * DEFAULT_ARMY_COLORS, copied: the editor must not import render).
 */
export const ARMY_COLORS: readonly (readonly [number, number, number])[] = [
  [0.16, 0.42, 0.95],
  [0.92, 0.2, 0.16],
  [0.2, 0.75, 0.3],
  [0.95, 0.8, 0.15],
  [0.6, 0.3, 0.85],
  [0.1, 0.8, 0.85],
  [0.98, 0.5, 0.1],
  [0.9, 0.35, 0.65],
  [0.55, 0.55, 0.55],
  [0.45, 0.3, 0.15],
  [0.6, 0.9, 0.2],
  [0.1, 0.25, 0.55],
  [0.55, 0.1, 0.12],
  [0.95, 0.95, 0.95],
  [0.15, 0.5, 0.45],
  [0.8, 0.7, 0.5],
];

/** 0xRRGGBB of an army slot (wraps for slots >= 16). */
export function armyHex(army: number): number {
  const c = ARMY_COLORS[((army % 16) + 16) % 16]!;
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

export const COLORS = {
  mass: 0x5fe06a,
  hydro: 0x36d8ec,
  selection: 0xffe14d,
  hover: 0xa6e8ff,
  handle: 0xffffff,
  handleRadius: 0xffb13d,
  handleBorder: 0x10151c,
  explicitProp: 0xa4a9b0,
  symmetry: 0xff62d4,
  draft: 0xf2f5f8,
  issue: { error: 0xff4747, warning: 0xffc21a, info: 0x70b8ff },
} as const;

/** Fill/outline colour of a field and the colour of its expanded props, by kind. */
export const FIELD_COLORS: Readonly<Record<PropFieldKind, { readonly fill: number; readonly prop: number }>> = {
  tree: { fill: 0x3fa33a, prop: 0x86dd72 },
  rock: { fill: 0xa89a84, prop: 0xe0d6c2 },
  wreck: { fill: 0xc9763a, prop: 0xf0a064 },
};

export const FIELD_FILL_OPACITY = 0.3;

/** Screen markers: world radius (WU) at 1:1 and minimum radius in CSS pixels. */
export const SIZES = {
  /** Start: ring radius; pillar and label scale with it. */
  start: { radiusWu: 4, minPx: 14 },
  startPillarWu: 9,
  mass: { radiusWu: 1.4, minPx: 7 },
  hydro: { radiusWu: 2.6, minPx: 9 },
  /** Selection/hover ring around starts and spots (factor of the marker radius). */
  highlightFactor: 1.45,
  handle: { radiusWu: 0.9, minPx: 6 },
  issue: { radiusWu: 2.2, minPx: 11 },
  /** Draped lines: width in CSS pixels. */
  lineWidthPx: 2,
  selectedLineWidthPx: 3.5,
  /** Expanded props: diameter in WU and minimum diameter in device pixels. */
  propWu: 1.1,
  propMinPx: 2.5,
  explicitPropWu: 0.9,
  explicitPropMinPx: 3,
  /** Height offsets above the terrain (WU). */
  fillLiftWu: 0.08,
  lineLiftWu: 0.2,
  propLiftWu: 0.35,
} as const;

/** WU per CSS pixel at distance `distanceWu` from a perspective camera (vertical fov in degrees). */
export function wuPerPixel(distanceWu: number, fovDeg: number, viewportHeightPx: number): number {
  return (2 * distanceWu * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportHeightPx);
}

/** Scale factor (>= 1) that keeps a marker of `radiusWu` at least `minPx` CSS pixels large. */
export function minPixelScale(radiusWu: number, minPx: number, wuPerPx: number): number {
  return Math.max(1, (minPx * wuPerPx) / radiusWu);
}
