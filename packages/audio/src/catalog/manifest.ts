/**
 * Strict runtime validation of content/audio/dist/manifest.json (version 1, written by @faf/sfx).
 *
 * The manifest is untrusted input (fetched at runtime). `parseManifest` checks every field the
 * engine uses, fills per-sound policy fields that are missing from the category policy, and
 * returns a fresh, deeply frozen {@link AudioManifest}. Every error names the JSON path of the
 * offending value (`$.sounds[3].variants[0].samples`).
 */

import {
  SOUND_CATEGORIES,
  isManifestBus,
  isSoundCategory,
  type AudioManifest,
  type ManifestBus,
  type ManifestCategory,
  type ManifestLoop,
  type ManifestSound,
  type ManifestVariant,
  type SoundCategory,
} from '../types.ts';

/** Invalid manifest; `path` is the JSON path of the offending value. */
export class ManifestError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'ManifestError';
    this.path = path;
  }
}

/** Opus always decodes at 48 kHz; sample counts and loop points of the manifest use this rate. */
export const MANIFEST_SAMPLE_RATE = 48_000;

/**
 * Upper bound of the wrap-around padding around a loop (the files carry 40 ms before and after the
 * loop, @faf/sfx): `loop.endS` may exceed the nominal `durationS` by at most this much.
 */
export const MAX_LOOP_PADDING_S = 0.1;

/** Hard upper bound for the global voice budget and per-category/per-sound limits. */
export const MAX_VOICE_LIMIT = 256;

const ID_RE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
const SCOPE_RE = /^[a-z][a-z0-9_]*$/;
/** '<scope>/<name>.v<n>.webm' or nested relative paths; no traversal, no absolute paths or URLs. */
const OPUS_PATH_RE = /^[a-z0-9_][a-z0-9_./-]*\.webm$/i;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) throw new ManifestError(path, `expected an object, got ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `string ${JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v)}`;
  if (typeof v === 'number') return `number ${String(v)}`;
  return typeof v;
}

function str(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new ManifestError(`${path}.${key}`, `expected a string, got ${describe(v)}`);
  return v;
}

function optStr(o: Obj, key: string, path: string, fallback: string): string {
  return o[key] === undefined ? fallback : str(o, key, path);
}

function num(o: Obj, key: string, path: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ManifestError(`${path}.${key}`, `expected a finite number, got ${describe(v)}`);
  }
  if (v < min || v > max) throw new ManifestError(`${path}.${key}`, `${v} out of range ${min}..${max}`);
  return v;
}

function int(o: Obj, key: string, path: string, min: number, max: number): number {
  const v = num(o, key, path, min, max);
  if (!Number.isInteger(v)) throw new ManifestError(`${path}.${key}`, `expected an integer, got ${v}`);
  return v;
}

function bool(o: Obj, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') throw new ManifestError(`${path}.${key}`, `expected a boolean, got ${describe(v)}`);
  return v;
}

function channels(o: Obj, key: string, path: string): 1 | 2 {
  const v = o[key];
  if (v !== 1 && v !== 2) throw new ManifestError(`${path}.${key}`, `expected 1 or 2, got ${describe(v)}`);
  return v;
}

function bus(o: Obj, key: string, path: string): ManifestBus {
  const v = str(o, key, path);
  if (!isManifestBus(v)) throw new ManifestError(`${path}.${key}`, `unknown bus ${JSON.stringify(v)}`);
  return v;
}

function optNum(o: Obj, key: string, path: string): number | undefined {
  return o[key] === undefined ? undefined : num(o, key, path);
}

function stringArray(o: Obj, key: string, path: string): readonly string[] {
  const v = o[key];
  if (v === undefined) return Object.freeze([]);
  if (!Array.isArray(v)) throw new ManifestError(`${path}.${key}`, `expected an array of strings, got ${describe(v)}`);
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const s: unknown = v[i];
    if (typeof s !== 'string') throw new ManifestError(`${path}.${key}[${i}]`, `expected a string, got ${describe(s)}`);
    out.push(s);
  }
  return Object.freeze(out);
}

function parseCategory(v: unknown, path: string): ManifestCategory {
  const o = obj(v, path);
  return Object.freeze({
    label: str(o, 'label', path),
    bus: bus(o, 'bus', path),
    targetLufs: num(o, 'targetLufs', path, -70, 0),
    priority: num(o, 'priority', path, 0, 1000),
    cooldownMs: num(o, 'cooldownMs', path, 0, 600_000),
    maxVoices: int(o, 'maxVoices', path, 1, MAX_VOICE_LIMIT),
    channels: channels(o, 'channels', path),
    maxDurationS: num(o, 'maxDurationS', path, 0, 3600),
    band: str(o, 'band', path),
    spatial: bool(o, 'spatial', path),
    opusKbps: num(o, 'opusKbps', path, 1, 1024),
  });
}

function parseCategories(v: unknown, path: string): Readonly<Record<SoundCategory, ManifestCategory>> {
  const o = obj(v, path);
  for (const key of Object.keys(o)) {
    if (!isSoundCategory(key)) throw new ManifestError(`${path}.${key}`, `unknown category ${JSON.stringify(key)}`);
  }
  const out = {} as Record<SoundCategory, ManifestCategory>;
  for (const c of SOUND_CATEGORIES) {
    if (o[c] === undefined) throw new ManifestError(`${path}.${c}`, 'missing category policy');
    out[c] = parseCategory(o[c], `${path}.${c}`);
  }
  return Object.freeze(out);
}

function parseVariant(v: unknown, path: string, expectedIndex: number, sampleRate: number): ManifestVariant {
  const o = obj(v, path);
  const index = int(o, 'index', path, 0, 1_000_000);
  if (index !== expectedIndex) throw new ManifestError(`${path}.index`, `expected ${expectedIndex} (variants must be dense and ordered), got ${index}`);
  const opus = str(o, 'opus', path);
  if (!OPUS_PATH_RE.test(opus) || opus.includes('..') || opus.includes('//')) {
    throw new ManifestError(`${path}.opus`, `invalid relative .webm path ${JSON.stringify(opus)}`);
  }
  const samples = int(o, 'samples', path, 1, sampleRate * 3600);
  const out: {
    -readonly [K in keyof ManifestVariant]: ManifestVariant[K];
  } = {
    index,
    opus,
    wav: optStr(o, 'wav', path, ''),
    samples,
    durationS: o['durationS'] === undefined ? samples / sampleRate : num(o, 'durationS', path, 0, 3600),
    lufs: o['lufs'] === undefined ? 0 : num(o, 'lufs', path),
    truePeakDb: o['truePeakDb'] === undefined ? 0 : num(o, 'truePeakDb', path),
    sha1: optStr(o, 'sha1', path, ''),
  };
  const extras = ['lufsIntegrated', 'lufsMomentaryMax', 'limitedDb', 'opusTruePeakDb', 'opusLufs', 'centroidHz'] as const;
  for (const k of extras) {
    const x = optNum(o, k, path);
    if (x !== undefined) out[k] = x;
  }
  return Object.freeze(out);
}

function parseLoop(v: unknown, path: string, sampleRate: number, durationS: number, variants: readonly ManifestVariant[]): ManifestLoop | null {
  if (v === null) return null;
  const o = obj(v, path);
  const startSample = int(o, 'startSample', path, 0, Number.MAX_SAFE_INTEGER);
  const endSample = int(o, 'endSample', path, 0, Number.MAX_SAFE_INTEGER);
  const startS = num(o, 'startS', path, 0);
  const endS = num(o, 'endS', path, 0);
  if (!(startSample < endSample)) throw new ManifestError(`${path}.endSample`, `loop end ${endSample} must be after start ${startSample}`);
  if (!(startS < endS)) throw new ManifestError(`${path}.endS`, `loop end ${endS} s must be after start ${startS} s`);
  const tol = 1 / sampleRate + 1e-9;
  if (Math.abs(startS - startSample / sampleRate) > tol) {
    throw new ManifestError(`${path}.startS`, `${startS} s does not match startSample ${startSample} at ${sampleRate} Hz`);
  }
  if (Math.abs(endS - endSample / sampleRate) > tol) {
    throw new ManifestError(`${path}.endS`, `${endS} s does not match endSample ${endSample} at ${sampleRate} Hz`);
  }
  if (endS > durationS + MAX_LOOP_PADDING_S + 1e-9) {
    throw new ManifestError(`${path}.endS`, `${endS} s exceeds durationS ${durationS} + padding ${MAX_LOOP_PADDING_S} s`);
  }
  for (const variant of variants) {
    if (endSample > variant.samples) {
      throw new ManifestError(`${path}.endSample`, `${endSample} exceeds variant ${variant.index} length ${variant.samples}`);
    }
  }
  return Object.freeze({ startSample, endSample, startS, endS });
}

function parseSound(
  v: unknown,
  path: string,
  sampleRate: number,
  categories: Readonly<Record<SoundCategory, ManifestCategory>>,
): ManifestSound {
  const o = obj(v, path);
  const id = str(o, 'id', path);
  if (!ID_RE.test(id)) throw new ManifestError(`${path}.id`, `expected '<scope>:<name>' (lowercase, digits, '_'), got ${JSON.stringify(id)}`);
  const colon = id.indexOf(':');
  const scope = optStr(o, 'scope', path, id.slice(0, colon));
  const name = optStr(o, 'name', path, id.slice(colon + 1));
  if (!SCOPE_RE.test(scope) || `${scope}:${name}` !== id) {
    throw new ManifestError(`${path}.scope`, `scope/name ${JSON.stringify(scope)}/${JSON.stringify(name)} do not match id ${JSON.stringify(id)}`);
  }
  const categoryName = str(o, 'category', path);
  if (!isSoundCategory(categoryName)) throw new ManifestError(`${path}.category`, `unknown category ${JSON.stringify(categoryName)}`);
  const cat = categories[categoryName];

  const rawVariants = o['variants'];
  if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
    throw new ManifestError(`${path}.variants`, `expected a non-empty array, got ${describe(rawVariants)}`);
  }
  const variants: ManifestVariant[] = [];
  for (let i = 0; i < rawVariants.length; i++) variants.push(parseVariant(rawVariants[i], `${path}.variants[${i}]`, i, sampleRate));

  const durationS = num(o, 'durationS', path, 0, 3600);
  if (!(durationS > 0)) throw new ManifestError(`${path}.durationS`, `must be > 0, got ${durationS}`);
  if (!('loop' in o)) throw new ManifestError(`${path}.loop`, 'missing (null for one-shots)');
  const loop = parseLoop(o['loop'], `${path}.loop`, sampleRate, durationS, variants);

  const out: { -readonly [K in keyof ManifestSound]: ManifestSound[K] } = {
    id,
    scope,
    name,
    category: categoryName,
    bus: o['bus'] === undefined ? cat.bus : bus(o, 'bus', path),
    description: optStr(o, 'description', path, ''),
    channels: o['channels'] === undefined ? cat.channels : channels(o, 'channels', path),
    spatial: o['spatial'] === undefined ? cat.spatial : bool(o, 'spatial', path),
    durationS,
    loop,
    priority: o['priority'] === undefined ? cat.priority : num(o, 'priority', path, 0, 1000),
    cooldownMs: o['cooldownMs'] === undefined ? cat.cooldownMs : num(o, 'cooldownMs', path, 0, 600_000),
    maxVoices: o['maxVoices'] === undefined ? cat.maxVoices : int(o, 'maxVoices', path, 1, MAX_VOICE_LIMIT),
    tags: stringArray(o, 'tags', path),
    variants: Object.freeze(variants),
  };
  const opusKbps = optNum(o, 'opusKbps', path);
  if (opusKbps !== undefined) out.opusKbps = opusKbps;
  const targetLufs = optNum(o, 'targetLufs', path);
  if (targetLufs !== undefined) out.targetLufs = targetLufs;
  if (o['loudnessMode'] !== undefined) out.loudnessMode = str(o, 'loudnessMode', path);
  if (o['warnings'] !== undefined) out.warnings = stringArray(o, 'warnings', path);
  return Object.freeze(out);
}

/**
 * Validates an untrusted manifest (parsed JSON) and returns a fresh, deeply frozen copy.
 *
 * Rules: `version` must be 1; `sampleRate` must be 48000 (Opus); all 15 categories must be present
 * and no unknown ones; every bus must be a known manifest bus; sound ids are unique
 * `'<scope>:<name>'`; variants are dense (`index` = position) with relative `.webm` paths; loop
 * points satisfy `startS < endS ≤ durationS + MAX_LOOP_PADDING_S`, match their sample positions and
 * lie inside every variant. Missing per-sound policy fields (bus, channels, spatial, priority,
 * cooldownMs, maxVoices) fall back to the category policy. Unknown extra fields are ignored.
 *
 * @throws {ManifestError} with the JSON path of the first violation
 */
export function parseManifest(json: unknown): AudioManifest {
  const root = obj(json, '$');
  if (root['version'] !== 1) throw new ManifestError('$.version', `unsupported manifest version ${describe(root['version'])} (expected 1)`);
  const sampleRate = int(root, 'sampleRate', '$', 1, 1_000_000);
  if (sampleRate !== MANIFEST_SAMPLE_RATE) {
    throw new ManifestError('$.sampleRate', `expected ${MANIFEST_SAMPLE_RATE} (Opus decodes at 48 kHz), got ${sampleRate}`);
  }
  const maxVoices = int(root, 'maxVoices', '$', 1, MAX_VOICE_LIMIT);
  const categories = parseCategories(root['categories'], '$.categories');
  const rawSounds = root['sounds'];
  if (!Array.isArray(rawSounds)) throw new ManifestError('$.sounds', `expected an array, got ${describe(rawSounds)}`);
  const seen = new Set<string>();
  const sounds: ManifestSound[] = [];
  for (let i = 0; i < rawSounds.length; i++) {
    const s = parseSound(rawSounds[i], `$.sounds[${i}]`, sampleRate, categories);
    if (seen.has(s.id)) throw new ManifestError(`$.sounds[${i}].id`, `duplicate id ${JSON.stringify(s.id)}`);
    seen.add(s.id);
    sounds.push(s);
  }
  return Object.freeze({
    version: 1,
    generator: optStr(root, 'generator', '$', ''),
    sampleRate,
    maxVoices,
    categories,
    sounds: Object.freeze(sounds),
  });
}
