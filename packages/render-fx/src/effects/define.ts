/**
 * Effect definitions (PLAN §3.7 "defineEffect-Daten, Prioritäten"). An effect is a small set of
 * particle layers; every layer is simulated statelessly on the GPU as f(t − t0) (see reference.ts
 * for the exact formulas) and shaded procedurally (no textures).
 */
import type { ColorCurve, Curve } from './curves.ts';
import { colorCurveError, curveError } from './curves.ts';

/** Procedural particle shapes evaluated in the fragment shader. */
export type EffectShape = 'glow' | 'spark' | 'smoke' | 'ring' | 'debris' | 'flash' | 'stream';
/** Quad orientation: camera-facing, stretched along the screen velocity, or flat on the XZ plane. */
export type EffectOrient = 'billboard' | 'velocity' | 'ground';
/** Motion model: closed-form ballistic flight with drag/gravity, or origin → target stream. */
export type EffectMotion = 'ballistic' | 'stream';
/** 0 = critical (never dropped), 1 = normal, 2 = cosmetic (dropped first). */
export type EffectPriority = 0 | 1 | 2;
export type EffectTint = 'none' | 'spawn';

export const EFFECT_SHAPES: readonly EffectShape[] = ['glow', 'spark', 'smoke', 'ring', 'debris', 'flash', 'stream'];
export const EFFECT_ORIENTS: readonly EffectOrient[] = ['billboard', 'velocity', 'ground'];
export const EFFECT_MOTIONS: readonly EffectMotion[] = ['ballistic', 'stream'];

/** Largest burst count of one layer. */
export const MAX_LAYER_COUNT = 4096;
/** Longest particle lifetime (s). */
export const MAX_LIFETIME_S = 30;
/** Longest spawn delay (s); MAX_DELAY_S + MAX_LIFETIME_S = 40 s stays below the FX age contract (≤ 60 s). */
export const MAX_DELAY_S = 10;
/** Layers per effect. */
export const MAX_EFFECT_LAYERS = 8;
/** Largest continuous emission rate of one layer (particles/s). */
export const MAX_LAYER_RATE = 8192;

export type Range = readonly [min: number, max: number];

export interface EffectLayerDef {
  /** Unique within the effect (diagnostics, tuning). */
  readonly name: string;
  readonly shape: EffectShape;
  readonly orient: EffectOrient;
  readonly motion: EffectMotion;
  /** Burst size when the effect is spawned (fixed or [min, max], ≤ 4096). */
  readonly count: number | Range;
  /** Continuous emission in particles/s (only for `continuous` effects). */
  readonly rate?: number;
  /** Lifetime range in s (0 < min ≤ max ≤ 30). For 'stream' it is the travel time origin → target. */
  readonly lifetime: Range;
  /** Spawn delay range in s (default [0, 0]). */
  readonly delay?: Range;
  /** Initial speed range in WU/s along the cone direction. */
  readonly speed: Range;
  /** Cone half angle in degrees around the spawn direction (180 = full sphere). */
  readonly spread: number;
  /**
   * Inner cone half angle in degrees (default 0): directions lie between spreadInner and spread,
   * e.g. spreadInner 80 / spread 90 around +y = flat radial ring (dust ring, splash crown).
   */
  readonly spreadInner?: number;
  /** Spawn offset along the particle direction, 0..emitRadius WU (stream: lateral offset at the source). */
  readonly emitRadius?: number;
  /** Acceleration along +y in WU/s² (negative = falls, positive = buoyancy for smoke). */
  readonly gravity: number;
  /** Linear drag coefficient in 1/s (0 = none). */
  readonly drag: number;
  /** Quad size (edge length) over normalized age in WU. */
  readonly size: Curve;
  /** Random size variation ±sizeJitter (0..1). */
  readonly sizeJitter?: number;
  /** Linear HDR color and alpha over normalized age. */
  readonly color: ColorCurve;
  /** 0 = additive, 1 = alpha blended (premultiplied, one draw); may vary over age. */
  readonly blend: Curve;
  /** Streak factor for orient 'velocity' (quad length = size + stretch·|v|·0.05 s). */
  readonly stretch?: number;
  /** Rotation speed range in rad/s. */
  readonly spin?: Range;
  readonly priority: EffectPriority;
  /** 'spawn': color is multiplied by the spawn tint (team color, white-hot glow). */
  readonly tint?: EffectTint;
  /** Stream only: lateral wave amplitude in WU (pinned to 0 at both ends). */
  readonly streamWave?: number;
  /** Stream only: number of wave cycles along the path. */
  readonly streamWaves?: number;
}

export interface EffectShakeDef {
  /** Peak camera displacement in WU at the epicenter. */
  readonly amplitudeWu: number;
  readonly durationS: number;
  /** Distance (camera target → epicenter) at which the shake has faded to 0. */
  readonly radiusWu: number;
  readonly frequencyHz: number;
}

export type EffectId = `${string}:${string}`;

export interface EffectDef {
  /** Namespaced id, e.g. `varkan:explosion_small`. */
  readonly id: EffectId;
  readonly layers: readonly EffectLayerDef[];
  /** Attached emitter (smoke trail, build stream): layers with `rate` emit while it lives. */
  readonly continuous?: boolean;
  /** Culling sphere radius around the spawn point in WU. */
  readonly boundsWu: number;
  readonly shake?: EffectShakeDef;
}

const ID_RE = /^[a-z][a-z0-9_]*:[a-z0-9_]+$/;

function rangeError(r: unknown, min: number, max: number, allowZeroMin: boolean): string | null {
  if (!Array.isArray(r) || r.length !== 2) return 'must be [min, max]';
  const [a, b] = r as [number, number];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'values must be finite';
  if (a > b) return `min ${a} > max ${b}`;
  if (allowZeroMin ? a < min : a <= min) return `min ${a} must be ${allowZeroMin ? '≥' : '>'} ${min}`;
  if (b > max) return `max ${b} > ${max}`;
  return null;
}

function fail(id: string, layer: string | null, msg: string): never {
  throw new Error(`defineEffect(${id})${layer !== null ? ` layer '${layer}'` : ''}: ${msg}`);
}

/** Largest burst of a layer. */
export function layerCountMax(l: EffectLayerDef): number {
  return typeof l.count === 'number' ? l.count : l.count[1];
}

/** Smallest burst of a layer. */
export function layerCountMin(l: EffectLayerDef): number {
  return typeof l.count === 'number' ? l.count : l.count[0];
}

function validateLayer(def: EffectDef, l: EffectLayerDef): void {
  const id = def.id;
  const name = typeof l.name === 'string' && l.name.length > 0 ? l.name : '?';
  const e = (msg: string): never => fail(id, name, msg);
  if (name === '?') e('name must be a non-empty string');
  if (!EFFECT_SHAPES.includes(l.shape)) e(`unknown shape '${String(l.shape)}'`);
  if (!EFFECT_ORIENTS.includes(l.orient)) e(`unknown orient '${String(l.orient)}'`);
  if (!EFFECT_MOTIONS.includes(l.motion)) e(`unknown motion '${String(l.motion)}'`);
  if (typeof l.count === 'number') {
    if (!Number.isInteger(l.count) || l.count < 0 || l.count > MAX_LAYER_COUNT) {
      e(`count ${l.count} must be an integer in [0, ${MAX_LAYER_COUNT}]`);
    }
  } else {
    const err = rangeError(l.count, 0, MAX_LAYER_COUNT, true);
    if (err !== null) e(`count ${err}`);
    if (!Number.isInteger(l.count[0]) || !Number.isInteger(l.count[1])) e('count range must be integers');
  }
  if (l.rate !== undefined) {
    if (!Number.isFinite(l.rate) || l.rate < 0 || l.rate > MAX_LAYER_RATE) e(`rate ${l.rate} must be in [0, ${MAX_LAYER_RATE}]`);
    if (def.continuous !== true) e('rate requires a continuous effect');
  }
  if (layerCountMax(l) === 0 && (l.rate ?? 0) === 0) e('layer emits nothing (count 0 and no rate)');
  let err = rangeError(l.lifetime, 0, MAX_LIFETIME_S, false);
  if (err !== null) e(`lifetime ${err}`);
  if (l.delay !== undefined) {
    err = rangeError(l.delay, 0, MAX_DELAY_S, true);
    if (err !== null) e(`delay ${err}`);
  }
  err = rangeError(l.speed, 0, 10000, true);
  if (err !== null) e(`speed ${err}`);
  if (!Number.isFinite(l.spread) || l.spread < 0 || l.spread > 180) e(`spread ${l.spread} must be in [0, 180] degrees`);
  if (l.spreadInner !== undefined && (!Number.isFinite(l.spreadInner) || l.spreadInner < 0 || l.spreadInner > l.spread)) {
    e(`spreadInner ${l.spreadInner} must be in [0, spread]`);
  }
  if (l.emitRadius !== undefined && (!Number.isFinite(l.emitRadius) || l.emitRadius < 0 || l.emitRadius > 1000)) {
    e(`emitRadius ${l.emitRadius} must be in [0, 1000]`);
  }
  if (!Number.isFinite(l.gravity) || Math.abs(l.gravity) > 1000) e(`gravity ${l.gravity} must be finite and |g| ≤ 1000`);
  if (!Number.isFinite(l.drag) || l.drag < 0 || l.drag > 100) e(`drag ${l.drag} must be in [0, 100]`);
  err = curveError(l.size, 0, 1000);
  if (err !== null) e(`size: ${err}`);
  if (l.sizeJitter !== undefined && (!Number.isFinite(l.sizeJitter) || l.sizeJitter < 0 || l.sizeJitter > 1)) {
    e(`sizeJitter ${l.sizeJitter} must be in [0, 1]`);
  }
  err = colorCurveError(l.color);
  if (err !== null) e(`color: ${err}`);
  err = curveError(l.blend, 0, 1);
  if (err !== null) e(`blend: ${err}`);
  if (l.stretch !== undefined && (!Number.isFinite(l.stretch) || l.stretch < 0 || l.stretch > 32)) {
    e(`stretch ${l.stretch} must be in [0, 32]`);
  }
  if (l.spin !== undefined) {
    err = rangeError(l.spin, -1000, 1000, true);
    if (err !== null) e(`spin ${err}`);
  }
  if (l.priority !== 0 && l.priority !== 1 && l.priority !== 2) e(`priority ${String(l.priority)} must be 0, 1 or 2`);
  if (l.tint !== undefined && l.tint !== 'none' && l.tint !== 'spawn') e(`unknown tint '${String(l.tint)}'`);
  if (l.streamWave !== undefined && (!Number.isFinite(l.streamWave) || l.streamWave < 0 || l.streamWave > 100)) {
    e(`streamWave ${l.streamWave} must be in [0, 100]`);
  }
  if (l.streamWaves !== undefined && (!Number.isFinite(l.streamWaves) || l.streamWaves < 0 || l.streamWaves > 64)) {
    e(`streamWaves ${l.streamWaves} must be in [0, 64]`);
  }
  if (l.motion !== 'stream' && (l.streamWave !== undefined || l.streamWaves !== undefined)) {
    e("streamWave/streamWaves need motion 'stream'");
  }
}

/**
 * Validates an effect definition and returns it unchanged (typed identity), so libraries read like
 * data. Throws an Error with a precise message (`defineEffect(<id>) layer '<name>': …`).
 */
export function defineEffect(def: EffectDef): EffectDef {
  const id = typeof def.id === 'string' ? def.id : '?';
  if (!ID_RE.test(id)) fail(id, null, "id must look like 'namespace:name' (lowercase, digits, _)");
  if (!Array.isArray(def.layers) || def.layers.length === 0) fail(id, null, 'needs at least one layer');
  if (def.layers.length > MAX_EFFECT_LAYERS) fail(id, null, `${def.layers.length} layers > ${MAX_EFFECT_LAYERS}`);
  if (!Number.isFinite(def.boundsWu) || def.boundsWu <= 0) fail(id, null, `boundsWu ${def.boundsWu} must be > 0`);
  const names = new Set<string>();
  for (const l of def.layers) {
    validateLayer(def, l);
    if (names.has(l.name)) fail(id, l.name, 'duplicate layer name');
    names.add(l.name);
  }
  if (def.continuous === true && !def.layers.some((l) => (l.rate ?? 0) > 0)) {
    fail(id, null, 'continuous effect needs at least one layer with rate > 0');
  }
  const s = def.shake;
  if (s !== undefined) {
    for (const k of ['amplitudeWu', 'durationS', 'radiusWu', 'frequencyHz'] as const) {
      const v = s[k];
      if (!Number.isFinite(v) || v <= 0) fail(id, null, `shake.${k} ${v} must be > 0`);
    }
    if (s.durationS > 30) fail(id, null, `shake.durationS ${s.durationS} must be ≤ 30`);
  }
  return def;
}

/**
 * Particle budget of an effect: the sum of the largest bursts plus, for emitting layers, the
 * steady-state population rate · lifetime.max (+ delay.max) — the number of simultaneously live
 * particles one instance can cause.
 */
export function effectBudget(def: EffectDef): { burst: number; steady: number; total: number } {
  let burst = 0;
  let steady = 0;
  for (const l of def.layers) {
    burst += layerCountMax(l);
    if (l.rate !== undefined) steady += Math.ceil(l.rate * l.lifetime[1]);
  }
  return { burst, steady, total: burst + steady };
}
