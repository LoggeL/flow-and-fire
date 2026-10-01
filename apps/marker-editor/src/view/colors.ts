/**
 * Terrain albedo for the editor view: painted SPLT weights × strata colours on top of an automatic
 * height/slope layering (mirrors the band logic of the game renderer's auto-splat, simplified to
 * one colour per layer). Tool code: floats allowed, but fully deterministic.
 */
import type { MapSplatRaw, Rgb, RtsMap } from '@faf/formats';

/** sRGB byte colours of the 8 layers when a map carries fewer strata than splat layers. */
export const FALLBACK_LAYER_SRGB: readonly Rgb[] = [
  [196, 182, 134], // 0 shore / sand
  [96, 132, 72], // 1 grass
  [118, 110, 98], // 2 rock
  [214, 214, 206], // 3 highland
  [116, 94, 66], // 4 dirt
  [150, 140, 84], // 5 dry grass
  [70, 70, 72], // 6 dark rock
  [70, 100, 56], // 7 moss
];

/** Number of splat layers the editor blends at most. */
export const MAX_LAYERS = 8;

/** Rock starts at slope (1 − n.y) 0.28, fully rock 0.12 above (same as the renderer). */
const ROCK_SLOPE = 0.28;
const ROCK_BLEND = 0.12;

/** sRGB byte (0..255) → linear 0..1 (three.js vertex colours are linear). */
export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Linear colour triple of an sRGB byte colour. */
export function rgbToLinear(c: Rgb): [number, number, number] {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Height bands of the automatic layering, derived from the height range and the water level. */
export interface AutoBands {
  /** Top of the shore band (WU). */
  readonly shoreTop: number;
  /** Start of the highland band (WU). */
  readonly highland: number;
  /** Width of the highland blend (WU). */
  readonly highlandBlend: number;
}

export function autoBands(map: RtsMap): AutoBands {
  const h = map.heights;
  let lo = 0xffff;
  let hi = 0;
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const s = map.meta.heightScaleRaw / 4096;
  const minWu = lo * s;
  const maxWu = hi * s;
  const range = Math.max(1, maxWu - minWu);
  const water = map.meta.waterLevelRaw;
  return {
    shoreTop: (water !== null ? water / 4096 : minWu) + 1.2,
    highland: minWu + range * 0.72,
    highlandBlend: range * 0.08 + 0.5,
  };
}

/** Linear colours of the layers used by a map (painted layers and the automatic base). */
export interface LayerPalette {
  /** 8 painted-layer colours (strata[i] or fallback[i]), linear RGB. */
  readonly painted: readonly (readonly [number, number, number])[];
  /** 4 automatic layer colours (shore, grass, rock, highland), linear RGB. */
  readonly auto: readonly (readonly [number, number, number])[];
}

/**
 * Painted layer i uses strata[i] (fallback palette if the map has fewer strata). Without a raw
 * splat the automatic layers take the map's first four strata (shore, meadow, cliff, ridge style),
 * otherwise the fallback palette.
 */
export function layerPalette(map: RtsMap): LayerPalette {
  const strata = map.meta.strata;
  const painted: [number, number, number][] = [];
  for (let i = 0; i < MAX_LAYERS; i++) painted.push(rgbToLinear(strata[i]?.color ?? FALLBACK_LAYER_SRGB[i]!));
  const useStrata = !(map.splat !== null && map.splat.codec === 0);
  const auto: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const c = useStrata ? (strata[i]?.color ?? FALLBACK_LAYER_SRGB[i]!) : FALLBACK_LAYER_SRGB[i]!;
    auto.push(rgbToLinear(c));
  }
  return { painted, auto };
}

/**
 * Bilinear sample of a raw splat (texel centres like GL LINEAR + CLAMP_TO_EDGE) at world (xWu, zWu):
 * writes `layers` weights 0..1 into `out`.
 */
export function sampleSplat(splat: MapSplatRaw, sizeWu: number, xWu: number, zWu: number, out: Float64Array): void {
  const r = splat.resolution;
  const u = Math.min(r - 1, Math.max(0, (xWu / sizeWu) * r - 0.5));
  const v = Math.min(r - 1, Math.max(0, (zWu / sizeWu) * r - 0.5));
  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const x1 = Math.min(r - 1, x0 + 1);
  const z1 = Math.min(r - 1, z0 + 1);
  const fx = u - x0;
  const fz = v - z0;
  const w00 = (1 - fx) * (1 - fz);
  const w10 = fx * (1 - fz);
  const w01 = (1 - fx) * fz;
  const w11 = fx * fz;
  const i00 = (z0 * r + x0) * 4;
  const i10 = (z0 * r + x1) * 4;
  const i01 = (z1 * r + x0) * 4;
  const i11 = (z1 * r + x1) * 4;
  for (let p = 0; p < splat.planes.length; p++) {
    const plane = splat.planes[p]!;
    for (let c = 0; c < 4; c++) {
      const v4 = plane[i00 + c]! * w00 + plane[i10 + c]! * w10 + plane[i01 + c]! * w01 + plane[i11 + c]! * w11;
      out[p * 4 + c] = v4 / 255;
    }
  }
}

/**
 * Final layer weights (sum 1) at one point: automatic base (4 layers), then the painted layers
 * lerped on top in layer order (a painted weight w keeps (1 − w) of everything below it).
 * `painted` = layers weights or null; writes 4 auto + 8 painted weights into `out` (12 entries).
 */
export function layerWeights(
  heightWu: number,
  slope: number,
  bands: AutoBands,
  painted: Float64Array | null,
  paintedLayers: number,
  out: Float64Array,
): void {
  const shore = 1 - smoothstep(bands.shoreTop - 0.6, bands.shoreTop + 0.6, heightWu);
  const high = smoothstep(bands.highland, bands.highland + Math.max(bands.highlandBlend, 0.001), heightWu);
  const rock = smoothstep(ROCK_SLOPE, ROCK_SLOPE + ROCK_BLEND, slope);
  const grass = Math.max(0, 1 - shore - high);
  let w0 = shore * (1 - rock);
  let w1 = grass * (1 - rock);
  const w2 = rock;
  let w3 = high * (1 - rock);
  const sum = Math.max(w0 + w1 + w2 + w3, 1e-4);
  w0 /= sum;
  w1 /= sum;
  w3 /= sum;
  out[0] = w0;
  out[1] = w1;
  out[2] = w2 / sum;
  out[3] = w3;
  for (let i = 4; i < 12; i++) out[i] = 0;
  if (painted === null) return;
  for (let l = 0; l < paintedLayers; l++) {
    const s = painted[l]!;
    if (s <= 0) continue;
    const k = 1 - s;
    for (let i = 0; i < 12; i++) out[i] = out[i]! * k;
    out[4 + l] = out[4 + l]! + s;
  }
}
