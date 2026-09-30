/**
 * Manifest helpers for Node tests of @faf/audio: the real manifest and .webm bytes from
 * content/audio/dist, synthetic manifests (e.g. override cases 'varkan:x' + 'common:x' that the
 * real manifest does not contain) and fake decoded buffers.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOUND_CATEGORIES,
  isManifestBus,
  isSoundCategory,
  type AudioManifest,
  type ManifestCategory,
  type ManifestLoop,
  type ManifestSound,
  type ManifestVariant,
  type SoundCategory,
} from '../../src/types.ts';
import type { AudioBufferLike, BaseAudioContextLike } from '../../src/ports.ts';

/** Repository root (packages/audio/test/support → ../../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
/** content/audio/dist (manifest.json + <scope>/<name>.v<i>.webm). */
export const AUDIO_DIST_DIR = resolve(REPO_ROOT, 'content/audio/dist');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Shallow shape check of a parsed manifest (the real parser with full validation lives in
 * src/catalog, audioeng-b2). Throws with the offending path.
 */
export function assertManifestShape(v: unknown): asserts v is AudioManifest {
  if (!isRecord(v)) throw new Error('manifest: not an object');
  if (v['version'] !== 1) throw new Error(`manifest.version: expected 1, got ${String(v['version'])}`);
  if (typeof v['sampleRate'] !== 'number' || typeof v['maxVoices'] !== 'number') throw new Error('manifest: sampleRate/maxVoices missing');
  const cats = v['categories'];
  if (!isRecord(cats)) throw new Error('manifest.categories: not an object');
  for (const c of SOUND_CATEGORIES) if (!isRecord(cats[c])) throw new Error(`manifest.categories.${c}: missing`);
  const sounds = v['sounds'];
  if (!Array.isArray(sounds)) throw new Error('manifest.sounds: not an array');
  sounds.forEach((s: unknown, i) => {
    if (!isRecord(s)) throw new Error(`manifest.sounds[${i}]: not an object`);
    if (typeof s['id'] !== 'string' || typeof s['name'] !== 'string') throw new Error(`manifest.sounds[${i}]: id/name missing`);
    if (typeof s['category'] !== 'string' || !isSoundCategory(s['category'])) throw new Error(`manifest.sounds[${i}].category: ${String(s['category'])}`);
    if (typeof s['bus'] !== 'string' || !isManifestBus(s['bus'])) throw new Error(`manifest.sounds[${i}].bus: ${String(s['bus'])}`);
    if (!Array.isArray(s['variants']) || s['variants'].length === 0) throw new Error(`manifest.sounds[${i}].variants: empty`);
  });
}

let cachedReal: AudioManifest | null = null;

/** content/audio/dist/manifest.json (parsed once per test file; treat as read-only). */
export function loadRealManifest(): AudioManifest {
  if (cachedReal === null) {
    const parsed: unknown = JSON.parse(readFileSync(resolve(AUDIO_DIST_DIR, 'manifest.json'), 'utf8'));
    assertManifestShape(parsed);
    cachedReal = parsed;
  }
  return cachedReal;
}

/** Raw bytes of manifest.json (for fetch fakes). */
export function realManifestBytes(): ArrayBuffer {
  return realDistBytes('manifest.json');
}

function realDistBytes(relPath: string): ArrayBuffer {
  const file = resolve(AUDIO_DIST_DIR, relPath);
  if (!file.startsWith(AUDIO_DIST_DIR + sep)) throw new Error(`path escapes content/audio/dist: ${relPath}`);
  const buf = readFileSync(file);
  // Own, exactly sized ArrayBuffer (Node Buffers may share a pooled one).
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

/**
 * Bytes of one real Opus/WebM file, `relPath` as in `variant.opus` (e.g. 'common/ui_click.v0.webm').
 * Every call returns a fresh ArrayBuffer (decodeAudioData detaches its input).
 */
export function realWebmBytes(relPath: string): ArrayBuffer {
  if (!/^[a-z][a-z0-9_]*\/[a-z0-9_]+\.v\d+\.webm$/.test(relPath)) throw new Error(`not a dist .webm path: ${relPath}`);
  return realDistBytes(relPath);
}

// ---------------------------------------------------------------------------------------------
// Synthetic manifests
// ---------------------------------------------------------------------------------------------

/** One sound of a synthetic manifest; omitted fields come from the category policy. */
export interface SoundSpec {
  /** Fully qualified id '<scope>:<name>'. */
  id: string;
  /** Default: the real category whose prefix matches the name (wpn_ → weapon …), else 'weapon'. */
  category?: SoundCategory;
  /** Number of variants (default 1). */
  variants?: number;
  /** Duration of every variant in seconds (default 0.5; loops: loop length). */
  durationS?: number;
  /** true = loop with 40 ms padding on both ends (like @faf/sfx), or explicit loop points. */
  loop?: boolean | ManifestLoop;
  priority?: number;
  cooldownMs?: number;
  maxVoices?: number;
  spatial?: boolean;
  channels?: 1 | 2;
  tags?: readonly string[];
}

export interface ManifestSpec {
  sounds: readonly SoundSpec[];
  /** Per-category overrides on top of the real category table. */
  categories?: Partial<Record<SoundCategory, Partial<ManifestCategory>>>;
  sampleRate?: number;
  maxVoices?: number;
}

const PREFIX_CATEGORY: readonly (readonly [string, SoundCategory])[] = [
  ['wpn_', 'weapon'],
  ['prj_', 'projectile'],
  ['imp_', 'impact'],
  ['exp_', 'explosion'],
  ['bld_', 'build'],
  ['rcl_', 'build'],
  ['fac_', 'build'],
  ['sig_', 'signature'],
  ['eco_', 'eco'],
  ['mov_', 'unit'],
  ['shd_', 'shield'],
  ['int_', 'intel'],
  ['ui_', 'ui'],
  ['ack_', 'ack'],
  ['alt_', 'alert'],
  ['mus_', 'music'],
  ['amb_', 'ambience'],
];

/** Category implied by the name prefix convention (docs/design/audio.md §3). */
export function categoryFromName(name: string): SoundCategory | null {
  for (const [p, c] of PREFIX_CATEGORY) if (name.startsWith(p)) return c;
  return null;
}

/** Loop padding of @faf/sfx loop files (40 ms at 48 kHz). */
export const LOOP_PAD_SAMPLES = 1920;

/** Builds a valid manifest from a compact spec (policies default to the real category table). */
export function makeManifest(spec: ManifestSpec): AudioManifest {
  const real = loadRealManifest();
  const sampleRate = spec.sampleRate ?? real.sampleRate;
  const categories: Record<SoundCategory, ManifestCategory> = { ...real.categories };
  for (const c of SOUND_CATEGORIES) categories[c] = { ...real.categories[c], ...spec.categories?.[c] };
  const seen = new Set<string>();
  const sounds: ManifestSound[] = spec.sounds.map((s) => {
    const colon = s.id.indexOf(':');
    if (colon <= 0 || colon === s.id.length - 1) throw new Error(`makeManifest: id must be '<scope>:<name>': ${s.id}`);
    if (seen.has(s.id)) throw new Error(`makeManifest: duplicate id ${s.id}`);
    seen.add(s.id);
    const scope = s.id.slice(0, colon);
    const name = s.id.slice(colon + 1);
    const category = s.category ?? categoryFromName(name) ?? 'weapon';
    const cat = categories[category];
    const durationS = s.durationS ?? 0.5;
    let loop: ManifestLoop | null = null;
    if (s.loop === true) {
      const len = Math.round(durationS * sampleRate);
      loop = {
        startSample: LOOP_PAD_SAMPLES,
        endSample: LOOP_PAD_SAMPLES + len,
        startS: LOOP_PAD_SAMPLES / sampleRate,
        endS: (LOOP_PAD_SAMPLES + len) / sampleRate,
      };
    } else if (typeof s.loop === 'object') {
      loop = s.loop;
    }
    const samples = loop === null ? Math.round(durationS * sampleRate) : loop.endSample + LOOP_PAD_SAMPLES;
    const variants: ManifestVariant[] = [];
    for (let i = 0; i < (s.variants ?? 1); i++) {
      variants.push({
        index: i,
        opus: `${scope}/${name}.v${i}.webm`,
        wav: `${scope}/${name}.v${i}.wav`,
        samples,
        durationS: samples / sampleRate,
        lufs: cat.targetLufs,
        truePeakDb: -1,
        sha1: '0'.repeat(40),
      });
    }
    return {
      id: s.id,
      scope,
      name,
      category,
      bus: cat.bus,
      description: `synthetic ${s.id}`,
      channels: s.channels ?? cat.channels,
      spatial: s.spatial ?? cat.spatial,
      durationS,
      loop,
      priority: s.priority ?? cat.priority,
      cooldownMs: s.cooldownMs ?? cat.cooldownMs,
      maxVoices: s.maxVoices ?? cat.maxVoices,
      tags: s.tags ?? [category],
      variants,
    };
  });
  return {
    version: 1,
    generator: 'test/support/manifest.ts',
    sampleRate,
    maxVoices: spec.maxVoices ?? real.maxVoices,
    categories,
    sounds,
  };
}

export interface FakeBufferOptions {
  /**
   * Fills each channel (materializes the data). Default: none — FakeAudioBuffers stay lazy, so
   * buffers for the whole real manifest cost almost no memory.
   */
  fill?: (data: Float32Array, channel: number, sound: ManifestSound, variant: number) => void;
}

/**
 * One buffer per variant, keyed by sound id, created through `ctx.createBuffer` at the context
 * rate (length resampled from the manifest rate like decodeAudioData would, e.g. 44.1 kHz).
 */
export function fakeBuffersFor(
  manifest: AudioManifest,
  ctx: BaseAudioContextLike,
  opts: FakeBufferOptions = {},
): Map<string, AudioBufferLike[]> {
  const out = new Map<string, AudioBufferLike[]>();
  const ratio = ctx.sampleRate / manifest.sampleRate;
  for (const s of manifest.sounds) {
    const list: AudioBufferLike[] = [];
    for (const v of s.variants) {
      const b = ctx.createBuffer(s.channels, Math.max(1, Math.round(v.samples * ratio)), ctx.sampleRate);
      if (opts.fill !== undefined) for (let c = 0; c < s.channels; c++) opts.fill(b.getChannelData(c), c, s, v.index);
      list.push(b);
    }
    out.set(s.id, list);
  }
  return out;
}
