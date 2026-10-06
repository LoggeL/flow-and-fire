/**
 * Uniform blocks shared by all passes (std140). GLSL declarations and the JS layouts are kept
 * side by side so they cannot drift apart silently (the layout test checks the offsets).
 */
import { std140Layout } from '../std140.ts';

/** Binding slots of the shared uniform blocks. */
export const SLOT_FRAME = 0;
export const SLOT_PALETTE = 1;
export const SLOT_PASS = 2;

export const MAX_ARMY_COLORS = 16;
/** Visual table capacity of the palette block (per-visual base color). */
export const MAX_VISUALS = 256;

export const FRAME_BLOCK_GLSL = /* glsl */ `
layout(std140) uniform Frame {
  mat4 u_viewProj;    // camera-relative (origin = camPosInt)
  ivec4 u_camPosInt;  // xyz: eye integer part (raw Q20.12)
  vec4 u_camFrac;     // xyz: eye - camPosInt (WU); w: interpolation alpha
  vec4 u_camMod;      // xyz: (camPosInt mod 32 WU) in WU; w: time in seconds (wrapped hourly)
  vec4 u_sunDir;      // xyz: unit vector towards the sun
  vec4 u_sunColor;
  vec4 u_skyColor;
  vec4 u_groundColor; // hemisphere ground bounce
  vec4 u_fog;         // rgb: fog color; w: fog start distance (WU)
  vec4 u_viewport;    // w, h, 1/w, 1/h (device pixels)
  vec4 u_strategic;   // x: projection scale (CSS px of 1 WU at 1 WU distance), y: zoom icon force 0..1,
                      // z: device px per CSS px, w: zoom level (0..2)
  vec4 u_iconParams;  // x: icon size (CSS px), y: first icon-only instance of the unit ring,
                      // z: HP bar mode bits, w: 0
};
`;

export const FRAME_LAYOUT = std140Layout([
  { name: 'viewProj', type: 'mat4' },
  { name: 'camPosInt', type: 'ivec4' },
  { name: 'camFrac', type: 'vec4' },
  { name: 'camMod', type: 'vec4' },
  { name: 'sunDir', type: 'vec4' },
  { name: 'sunColor', type: 'vec4' },
  { name: 'skyColor', type: 'vec4' },
  { name: 'groundColor', type: 'vec4' },
  { name: 'fog', type: 'vec4' },
  { name: 'viewport', type: 'vec4' },
  { name: 'strategic', type: 'vec4' },
  { name: 'iconParams', type: 'vec4' },
]);

export const PALETTE_BLOCK_GLSL = /* glsl */ `
layout(std140) uniform Palette {
  vec4 u_army[${MAX_ARMY_COLORS}];       // rgb team color
  vec4 u_visual[${MAX_VISUALS}];     // rgb base color, a: weight of the base color vs. team color
};
`;

export const PALETTE_LAYOUT = std140Layout([
  { name: 'army', type: 'vec4', count: MAX_ARMY_COLORS },
  { name: 'visual', type: 'vec4', count: MAX_VISUALS },
]);

/** Default army colors (linear-ish sRGB 0..1); slot 0 and 1 are the two MVP armies. */
export const DEFAULT_ARMY_COLORS: readonly (readonly [number, number, number])[] = [
  [0.16, 0.42, 0.95], // blue
  [0.92, 0.2, 0.16], // red
  [0.2, 0.75, 0.3], // green
  [0.95, 0.8, 0.15], // yellow
  [0.6, 0.3, 0.85], // violet
  [0.1, 0.8, 0.85], // cyan
  [0.98, 0.5, 0.1], // orange
  [0.9, 0.35, 0.65], // pink
  [0.55, 0.55, 0.55], // grey
  [0.45, 0.3, 0.15], // brown
  [0.6, 0.9, 0.2], // lime
  [0.1, 0.25, 0.55], // navy
  [0.55, 0.1, 0.12], // maroon
  [0.95, 0.95, 0.95], // white
  [0.15, 0.5, 0.45], // teal
  [0.8, 0.7, 0.5], // sand
];

/** Converts 0xRRGGBB into 0..1 components. */
export function rgbHex(c: number): [number, number, number] {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}
