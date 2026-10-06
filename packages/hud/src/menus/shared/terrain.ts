/**
 * Procedural placeholder terrain for menu backgrounds and map previews (port of the mockup helpers
 * FF.heightField / FF.drawTerrain / FF.spots, docs/design/ui-mockups/assets/ff.js). Not game assets and
 * not the final rendering: the game can later hand real preview images to the same components.
 * Deterministic (own LCG, no Math.random); float maths is fine here – this is UI code, not the sim.
 */
import type { MapPreviewSpec, SkirmishResource } from '../../model/menus/skirmish.ts';

export type HeightField = (x: number, y: number) => number;

/** LCG of the mockup (same sequence as ff.js `rng`). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function makeNoise(seed: number): (x: number, y: number) => number {
  const r = lcg(seed);
  const perm = new Uint8Array(512);
  const g = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    perm[i] = i;
    g[i] = r();
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i] as number;
    perm[i] = perm[j] as number;
    perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i] as number;
  const v = (x: number, y: number): number => g[perm[(x & 255) + (perm[y & 255] as number)] as number] as number;
  const sm = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const a = v(xi, yi);
    const b = v(xi + 1, yi);
    const c = v(xi, yi + 1);
    const d = v(xi + 1, yi + 1);
    const u = sm(xf);
    const w = sm(yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}

export interface HeightFieldOptions {
  /** Mirror along the diagonal (fair 1v1 maps). */
  readonly mirror?: boolean;
  /** Terraces → cliffs. */
  readonly plateau?: boolean;
  readonly freq?: number;
}

/** Height field over the unit square (x, y in 0..1). */
export function heightField(seed: number, opts: HeightFieldOptions = {}): HeightField {
  const n = makeNoise(seed);
  const base = opts.freq ?? 3.2;
  return (x0, y0) => {
    let x = x0;
    let y = y0;
    if (opts.mirror && y < x) {
      const t = x;
      x = y;
      y = t;
    }
    let f = 0;
    let amp = 0.55;
    let fr = base;
    for (let o = 0; o < 5; o++) {
      f += amp * n(x * fr + 17.3 * o, y * fr - 9.1 * o);
      amp *= 0.5;
      fr *= 2.03;
    }
    const ridge = 1 - Math.abs(n(x * 2.1 + 40, y * 2.1 - 12) * 2 - 1);
    let h = f * 0.8 + ridge * 0.28 - 0.06;
    if (opts.plateau) h = (Math.round(h * 5) / 5) * 0.55 + h * 0.45;
    return h;
  };
}

/** Height field of a map preview (optional two lakes + diagonal land bridge, Setons-like). */
export function previewField(spec: MapPreviewSpec): HeightField {
  const f = heightField(spec.seed, { mirror: true, plateau: true, freq: 2.6 });
  if (!spec.water) return f;
  return (x, y) =>
    f(x, y) -
    0.05 -
    0.09 * Math.exp(-(((x - 0.72) ** 2 + (y - 0.72) ** 2) / 0.03)) -
    0.09 * Math.exp(-(((x - 0.28) ** 2 + (y - 0.28) ** 2) / 0.03)) +
    0.08 * Math.exp(-((x + y - 1) ** 2 / 0.02));
}

export const WATER_LEVEL = 0.385;

const RAMP: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0.0, [18, 36, 44]],
  [0.34, [27, 58, 66]],
  [0.385, [44, 70, 66]],
  [0.4, [58, 62, 48]],
  [0.47, [66, 70, 50]],
  [0.56, [82, 76, 56]],
  [0.65, [96, 84, 64]],
  [0.74, [112, 100, 84]],
  [0.86, [134, 126, 112]],
  [1.0, [160, 154, 142]],
];

/** Colour ramp by height (water → grass → rock). */
export function rampColor(h: number): readonly [number, number, number] {
  const first = RAMP[0] as (typeof RAMP)[number];
  if (h <= 0) return first[1];
  for (let i = 1; i < RAMP.length; i++) {
    const [h1, c1] = RAMP[i] as (typeof RAMP)[number];
    if (h <= h1) {
      const [h0, c0] = RAMP[i - 1] as (typeof RAMP)[number];
      const t = (h - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return (RAMP[RAMP.length - 1] as (typeof RAMP)[number])[1];
}

export interface TerrainOptions {
  /** Viewport [x0, y0, x1, y1] in map coordinates (default whole map). */
  readonly view?: readonly [number, number, number, number];
  readonly tint?: number;
  /** Seed of the detail noise (moss, grain); omitted = plain ramp. */
  readonly detail?: number;
}

/** Writes a hill-shaded top view of `field` into RGBA pixels (width × height). */
export function terrainPixels(field: HeightField, width: number, height: number, opts: TerrainOptions = {}): Uint8ClampedArray {
  const d = new Uint8ClampedArray(width * height * 4);
  const [x0, y0, x1, y1] = opts.view ?? [0, 0, 1, 1];
  const sx = (x1 - x0) / width;
  const sy = (y1 - y0) / height;
  const e = Math.max(sx, sy) * 1.5;
  const tint = opts.tint ?? 1;
  const dn = opts.detail !== undefined ? makeNoise(opts.detail) : null;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const x = x0 + i * sx;
      const y = y0 + j * sy;
      const h = field(x, y);
      const dx = field(x + e, y) - field(x - e, y);
      const dy = field(x, y + e) - field(x, y - e);
      let shade = 0.82 + ((-dx * 0.9 - dy * 1.2) / (e * 2)) * 0.018;
      shade = Math.max(0.45, Math.min(1.35, shade));
      let c: readonly [number, number, number] = rampColor(h);
      if (dn && h >= WATER_LEVEL) {
        const v = dn(x * 90, y * 90) * 0.6 + dn(x * 260 + 5, y * 260) * 0.4;
        const moss = Math.max(0, dn(x * 22 + 3, y * 22 - 7) - 0.5) * 1.2;
        c = [c[0] * (0.9 + v * 0.2) - moss * 14, c[1] * (0.9 + v * 0.2) + moss * 4, c[2] * (0.88 + v * 0.18) - moss * 10];
      }
      if (h < WATER_LEVEL) shade = 0.92 + (WATER_LEVEL - h) * -0.9;
      const k = (j * width + i) * 4;
      d[k] = c[0] * shade * tint;
      d[k + 1] = c[1] * shade * tint;
      d[k + 2] = c[2] * shade * tint;
      d[k + 3] = 255;
    }
  }
  return d;
}

/** Draws terrain into a canvas (no-op without a 2D context, e.g. in DOM test environments). */
export function drawTerrain(canvas: HTMLCanvasElement, field: HeightField, opts: TerrainOptions = {}): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return false;
  const img = ctx.createImageData(canvas.width, canvas.height);
  img.data.set(terrainPixels(field, canvas.width, canvas.height, opts));
  ctx.putImageData(img, 0, 0);
  return true;
}

/** Deterministic, mirrored resource points for fake map data (every 12th pair is a hydro spot). */
export function resourceSpots(spec: MapPreviewSpec, count: number): readonly SkirmishResource[] {
  const field = previewField(spec);
  const r = lcg(spec.seed * 7 + 3);
  const out: SkirmishResource[] = [];
  let guard = 0;
  while (out.length < count && guard++ < 4000) {
    const x = 0.06 + r() * 0.88;
    const y = 0.06 + r() * 0.88;
    if (y < x + 0.03) continue;
    const h = field(x, y);
    if (h < WATER_LEVEL + 0.03 || h > 0.8) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 0.09)) continue;
    const kind = out.length % 12 === 10 ? 'hydro' : 'mass';
    out.push({ x, y, kind }, { x: y, y: x, kind });
  }
  return out.slice(0, count);
}
