/**
 * `defineSfx`: the authoring contract for content/audio/<scope>/<name>.sfx.ts files.
 *
 * - `id` is "<scope>:<name>" and must match the file path (scope = folder, e.g. "varkan" or "common").
 * - `render(ctx)` synthesizes one variant; everything random must come from `ctx.rng` (deterministic).
 * - Post-processing (DC block, tail trim, loop crossfade, LUFS normalization, true-peak ceiling) is done
 *   by the pipeline, so `render` only needs to get shape and balance right, not absolute level.
 */
import { CATEGORIES, type SfxCategory, isCategory } from './categories.ts';
import type { Rng } from './rng.ts';
import type { Audio } from './signal.ts';

export interface SfxContext {
  id: string;
  /** Variant index 0..variants-1. */
  variant: number;
  variants: number;
  /** Deterministic random stream for this variant (seeded from id, variant and `seed`). */
  rng: Rng;
  sr: number;
  /** For loops: required render length in seconds (loop length + crossfade). */
  durationS: number | undefined;
}

export interface LoopSpec {
  /** Loop length in seconds (the file is exactly this long; loop points = whole file). */
  lengthS: number;
  /** Crossfade used to make the seam inaudible (default 0.25 s, at most half the length). */
  crossfadeS?: number;
}

export interface PostSpec {
  /** Remove DC with a 10 Hz high-pass (default true). */
  dcBlock?: boolean;
  /** Cut the silent tail (below -80 dB re. peak) of one-shots (default true). */
  trimTail?: boolean;
  /** Fade-out in seconds applied at the (trimmed) end of one-shots (default 0.01). */
  fadeOutS?: number;
  /** True-peak ceiling in dBTP (default -1). */
  ceilingDb?: number;
  /** Use the look-ahead limiter when the loudness target would exceed the ceiling (default true). */
  limit?: boolean;
}

export interface SfxDefinition {
  id: string;
  category: SfxCategory;
  /** One line: what it is and when it plays. */
  description?: string;
  /** Number of random variants (≥ 1). */
  variants: number;
  loop?: LoopSpec;
  /** Overrides of the category defaults. */
  channels?: 1 | 2;
  targetLufs?: number;
  priority?: number;
  cooldownMs?: number;
  maxVoices?: number;
  maxDurationS?: number;
  /** Extra seed to reroll all variants without renaming. */
  seed?: number;
  tags?: readonly string[];
  post?: PostSpec;
  render(ctx: SfxContext): Audio;
}

export const ID_RE = /^([a-z][a-z0-9_]*):([a-z][a-z0-9_]*)$/;

/** Validate and return a sound definition (the default export of a .sfx.ts file). */
export function defineSfx<T extends SfxDefinition>(def: T): T {
  const m = ID_RE.exec(def.id);
  if (!m) throw new Error(`defineSfx: ungültige id "${def.id}" (erwartet "<scope>:<name>", a-z0-9_)`);
  if (!isCategory(def.category)) throw new Error(`defineSfx(${def.id}): unbekannte Kategorie "${String(def.category)}"`);
  if (!Number.isInteger(def.variants) || def.variants < 1 || def.variants > 16) {
    throw new Error(`defineSfx(${def.id}): variants muss eine ganze Zahl 1..16 sein`);
  }
  if (def.loop) {
    if (!(def.loop.lengthS > 0)) throw new Error(`defineSfx(${def.id}): loop.lengthS muss > 0 sein`);
    const xf = def.loop.crossfadeS ?? 0.25;
    if (xf < 0 || xf > def.loop.lengthS / 2) throw new Error(`defineSfx(${def.id}): loop.crossfadeS muss 0..lengthS/2 sein`);
  }
  if (def.priority !== undefined && (def.priority < 0 || def.priority > 100)) throw new Error(`defineSfx(${def.id}): priority 0..100`);
  if (typeof def.render !== 'function') throw new Error(`defineSfx(${def.id}): render fehlt`);
  return Object.freeze(def);
}

/** Effective settings of a definition (category defaults + overrides). */
export function resolveSettings(def: SfxDefinition): {
  channels: 1 | 2;
  targetLufs: number;
  priority: number;
  cooldownMs: number;
  maxVoices: number;
  maxDurationS: number;
  spatial: boolean;
  bus: string;
} {
  const c = CATEGORIES[def.category];
  return {
    channels: def.channels ?? c.channels,
    targetLufs: def.targetLufs ?? c.targetLufs,
    priority: def.priority ?? c.priority,
    cooldownMs: def.cooldownMs ?? c.cooldownMs,
    maxVoices: def.maxVoices ?? c.maxVoices,
    maxDurationS: def.maxDurationS ?? c.maxDurationS,
    spatial: c.spatial,
    bus: c.bus,
  };
}

export function splitId(id: string): { scope: string; name: string } {
  const m = ID_RE.exec(id);
  if (!m) throw new Error(`ungültige id ${id}`);
  return { scope: m[1]!, name: m[2]! };
}
