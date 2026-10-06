/**
 * Compiles effect definitions into GPU-ready tables (PLAN §3.7 "Kurven-LUT"):
 *
 * - `layers`: Float32Array with {@link LAYER_STRIDE} floats per layer (field offsets `L_*` below);
 *   uploaded by the particle system as an RGBA32F data texture (LAYER_STRIDE / 4 texels per layer)
 *   or a uniform block.
 * - `lut`: RGBA float texture, {@link LUT_WIDTH} × 2·nLayers. Row 2i = color (linear HDR rgb, alpha)
 *   over normalized age, row 2i+1 = (size WU, blend 0..1, stretch, 0). Sampled with linear filtering
 *   at u = (a·(LUT_WIDTH − 1) + 0.5) / LUT_WIDTH, v = (row + 0.5) / height.
 */
import type { ColorCurve, Curve } from './curves.ts';
import { LUT_WIDTH, bakeColorCurve, bakeCurve } from './curves.ts';
import type { EffectDef, EffectMotion, EffectPriority, EffectShakeDef } from './define.ts';
import {
  EFFECT_MOTIONS,
  EFFECT_ORIENTS,
  EFFECT_SHAPES,
  defineEffect,
  effectBudget,
  layerCountMax,
  layerCountMin,
} from './define.ts';
import { fxHash32 } from './random.ts';

/** Floats per layer in {@link EffectLibrary.layers} (8 RGBA32F texels). */
export const LAYER_STRIDE = 32;
/** Texels per layer when the table is uploaded as an RGBA32F texture. */
export const LAYER_TEXELS = LAYER_STRIDE / 4;
/** Largest number of layers of one library (LUT height 512). */
export const MAX_LIBRARY_LAYERS = 256;

// Field offsets inside one layer record.
export const L_LIFE_MIN = 0;
export const L_LIFE_MAX = 1;
export const L_SPEED_MIN = 2;
export const L_SPEED_MAX = 3;
/** cos(spread half angle). */
export const L_COS_SPREAD = 4;
export const L_GRAVITY = 5;
export const L_DRAG = 6;
export const L_EMIT_RADIUS = 7;
export const L_DELAY_MIN = 8;
export const L_DELAY_MAX = 9;
export const L_SPIN_MIN = 10;
export const L_SPIN_MAX = 11;
export const L_SIZE_JITTER = 12;
export const L_STRETCH = 13;
/** Index into {@link EFFECT_SHAPES}. */
export const L_SHAPE = 14;
/** Index into {@link EFFECT_ORIENTS}. */
export const L_ORIENT = 15;
/** Index into {@link EFFECT_MOTIONS}. */
export const L_MOTION = 16;
export const L_PRIORITY = 17;
/** 0 = none, 1 = spawn tint. */
export const L_TINT = 18;
/** LUT row of the color curve (2·layer); the size row is L_LUT_ROW + 1. */
export const L_LUT_ROW = 19;
export const L_STREAM_WAVE = 20;
export const L_STREAM_WAVES = 21;
export const L_COUNT_MIN = 22;
export const L_COUNT_MAX = 23;
export const L_RATE = 24;
/** Index of the owning effect. */
export const L_EFFECT = 25;
/** Largest size of the size curve (WU), for bounds. */
export const L_SIZE_MAX = 26;
/** Spread half angle in radians. */
export const L_SPREAD_RAD = 27;
/** cos(inner cone half angle) (1 when spreadInner = 0). */
export const L_COS_SPREAD_INNER = 28;
// 29..31 reserved (0).

export const SHAPE_ID: Readonly<Record<(typeof EFFECT_SHAPES)[number], number>> = {
  glow: 0,
  spark: 1,
  smoke: 2,
  ring: 3,
  debris: 4,
  flash: 5,
  stream: 6,
};
export const ORIENT_ID: Readonly<Record<(typeof EFFECT_ORIENTS)[number], number>> = { billboard: 0, velocity: 1, ground: 2 };
export const MOTION_ID: Readonly<Record<(typeof EFFECT_MOTIONS)[number], number>> = { ballistic: 0, stream: 1 };

export interface CompiledLayer {
  /** Global layer index (row in the tables). */
  readonly index: number;
  /** Owning effect index. */
  readonly effect: number;
  readonly name: string;
  readonly countMin: number;
  readonly countMax: number;
  /** Continuous rate in particles/s (0 = burst only). */
  readonly rate: number;
  readonly priority: EffectPriority;
  readonly motion: EffectMotion;
  readonly lifeMax: number;
  readonly delayMax: number;
}

export interface EffectDefCompiled {
  readonly id: string;
  readonly index: number;
  readonly def: EffectDef;
  readonly firstLayer: number;
  readonly layerCount: number;
  readonly continuous: boolean;
  readonly boundsWu: number;
  readonly shake: EffectShakeDef | null;
  /** Sum of the largest bursts of all layers. */
  readonly maxBurst: number;
  /** Live-particle budget of one instance (bursts + steady state of rates). */
  readonly budget: number;
  /** Most important (lowest) layer priority. */
  readonly minPriority: EffectPriority;
  /** Longest delay + lifetime of any layer (s). */
  readonly maxAgeS: number;
}

export interface EffectLut {
  readonly width: number;
  readonly height: number;
  /** RGBA float texels, row-major. */
  readonly data: Float32Array;
}

export interface EffectLibrary {
  readonly effects: readonly EffectDefCompiled[];
  readonly layerInfo: readonly CompiledLayer[];
  readonly layerCount: number;
  /** {@link LAYER_STRIDE} floats per layer. */
  readonly layers: Float32Array;
  readonly lut: EffectLut;
  readonly index: Readonly<Record<string, number>>;
  /** Effect index by id; throws for unknown ids. */
  indexOf(id: string): number;
  /** Compiled effect by id; throws for unknown ids. */
  get(id: string): EffectDefCompiled;
  /** Largest burst of any single effect. */
  readonly maxBurst: number;
  /** fxHash32 fold over the layer table and the LUT bits (content fingerprint). */
  readonly hash: number;
}

function curveMax(c: Curve): number {
  if (typeof c === 'number') return c;
  let m = 0;
  for (const k of c) m = Math.max(m, k[1]);
  return m;
}

function hashFloats(h: number, data: Float32Array): number {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.length);
  for (let i = 0; i < words.length; i++) h = fxHash32(h, words[i]!, i);
  return h;
}

/** Validates (via {@link defineEffect}) and compiles a list of effects into one library. */
export function compileEffectLibrary(defs: readonly EffectDef[]): EffectLibrary {
  const ids = new Set<string>();
  let nLayers = 0;
  for (const d of defs) {
    defineEffect(d);
    if (ids.has(d.id)) throw new Error(`compileEffectLibrary: duplicate effect id '${d.id}'`);
    ids.add(d.id);
    nLayers += d.layers.length;
  }
  if (nLayers > MAX_LIBRARY_LAYERS) {
    throw new Error(`compileEffectLibrary: ${nLayers} layers > ${MAX_LIBRARY_LAYERS}`);
  }
  const layers = new Float32Array(Math.max(1, nLayers) * LAYER_STRIDE);
  const lutHeight = Math.max(2, 2 * nLayers);
  const lut = new Float32Array(LUT_WIDTH * lutHeight * 4);
  const effects: EffectDefCompiled[] = [];
  const layerInfo: CompiledLayer[] = [];
  const index: Record<string, number> = {};
  let li = 0;
  let maxBurst = 0;
  for (let ei = 0; ei < defs.length; ei++) {
    const d = defs[ei]!;
    const first = li;
    let minPriority: EffectPriority = 2;
    let maxAge = 0;
    for (const l of d.layers) {
      const o = li * LAYER_STRIDE;
      const spreadRad = (l.spread * Math.PI) / 180;
      layers[o + L_LIFE_MIN] = l.lifetime[0];
      layers[o + L_LIFE_MAX] = l.lifetime[1];
      layers[o + L_SPEED_MIN] = l.speed[0];
      layers[o + L_SPEED_MAX] = l.speed[1];
      layers[o + L_COS_SPREAD] = Math.cos(spreadRad);
      layers[o + L_GRAVITY] = l.gravity;
      layers[o + L_DRAG] = l.drag;
      layers[o + L_EMIT_RADIUS] = l.emitRadius ?? 0;
      layers[o + L_DELAY_MIN] = l.delay?.[0] ?? 0;
      layers[o + L_DELAY_MAX] = l.delay?.[1] ?? 0;
      layers[o + L_SPIN_MIN] = l.spin?.[0] ?? 0;
      layers[o + L_SPIN_MAX] = l.spin?.[1] ?? 0;
      layers[o + L_SIZE_JITTER] = l.sizeJitter ?? 0;
      layers[o + L_STRETCH] = l.stretch ?? 0;
      layers[o + L_SHAPE] = SHAPE_ID[l.shape];
      layers[o + L_ORIENT] = ORIENT_ID[l.orient];
      layers[o + L_MOTION] = MOTION_ID[l.motion];
      layers[o + L_PRIORITY] = l.priority;
      layers[o + L_TINT] = l.tint === 'spawn' ? 1 : 0;
      layers[o + L_LUT_ROW] = 2 * li;
      layers[o + L_STREAM_WAVE] = l.streamWave ?? 0;
      layers[o + L_STREAM_WAVES] = l.streamWaves ?? 0;
      layers[o + L_COUNT_MIN] = layerCountMin(l);
      layers[o + L_COUNT_MAX] = layerCountMax(l);
      layers[o + L_RATE] = l.rate ?? 0;
      layers[o + L_EFFECT] = ei;
      layers[o + L_SIZE_MAX] = curveMax(l.size);
      layers[o + L_SPREAD_RAD] = spreadRad;
      layers[o + L_COS_SPREAD_INNER] = Math.cos(((l.spreadInner ?? 0) * Math.PI) / 180);
      bakeLayerLut(lut, li, l.color, l.size, l.blend, l.stretch ?? 0);
      layerInfo.push({
        index: li,
        effect: ei,
        name: l.name,
        countMin: layerCountMin(l),
        countMax: layerCountMax(l),
        rate: l.rate ?? 0,
        priority: l.priority,
        motion: l.motion,
        lifeMax: l.lifetime[1],
        delayMax: l.delay?.[1] ?? 0,
      });
      if (l.priority < minPriority) minPriority = l.priority;
      maxAge = Math.max(maxAge, (l.delay?.[1] ?? 0) + l.lifetime[1]);
      li++;
    }
    const b = effectBudget(d);
    maxBurst = Math.max(maxBurst, b.burst);
    index[d.id] = ei;
    effects.push({
      id: d.id,
      index: ei,
      def: d,
      firstLayer: first,
      layerCount: d.layers.length,
      continuous: d.continuous === true,
      boundsWu: d.boundsWu,
      shake: d.shake ?? null,
      maxBurst: b.burst,
      budget: b.total,
      minPriority,
      maxAgeS: maxAge,
    });
  }
  const hash = hashFloats(hashFloats(fxHash32(nLayers, defs.length), layers), lut);
  const frozenIndex = Object.freeze(index);
  const indexOf = (id: string): number => {
    const i = frozenIndex[id];
    if (i === undefined) throw new Error(`EffectLibrary: unknown effect '${id}'`);
    return i;
  };
  return {
    effects,
    layerInfo,
    layerCount: nLayers,
    layers,
    lut: { width: LUT_WIDTH, height: lutHeight, data: lut },
    index: frozenIndex,
    indexOf,
    get: (id: string) => effects[indexOf(id)]!,
    maxBurst,
    hash,
  };
}

function bakeLayerLut(lut: Float32Array, li: number, color: ColorCurve, size: Curve, blend: Curve, stretch: number): void {
  const rowFloats = LUT_WIDTH * 4;
  lut.set(bakeColorCurve(color, LUT_WIDTH), 2 * li * rowFloats);
  const s = bakeCurve(size, LUT_WIDTH);
  const b = bakeCurve(blend, LUT_WIDTH);
  const o = (2 * li + 1) * rowFloats;
  for (let i = 0; i < LUT_WIDTH; i++) {
    lut[o + i * 4] = s[i]!;
    lut[o + i * 4 + 1] = b[i]!;
    lut[o + i * 4 + 2] = stretch;
    lut[o + i * 4 + 3] = 0;
  }
}
