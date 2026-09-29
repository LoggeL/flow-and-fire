/**
 * Asset manifest (P3, PLAN §2 "Assets", MS2): the single entry point of the content-hashed asset
 * files written by `tools/assets-pipeline` into `content/generated/assets/` and loaded by the
 * client's asset worker.
 *
 * ```json
 * { "version": 1,
 *   "assets": { "<logical id>": { "url", "bytes", "hash": "sha256-<base64>", "kind", "fallback"? } } }
 * ```
 *
 * - Logical ids follow {@link ASSET_ID_PATTERN}: models use their blueprint `view.mesh` id
 *   (`units/cube_bot`), maps `maps/<name>`, compiled content `content/sim.bin`, `content/view.json`.
 * - `url` is relative to the manifest and carries the content hash (`<name>.<hash8>.<ext>`), so a
 *   URL never changes its bytes (immutable caching, Cache API key).
 * - `hash` is a Subresource-Integrity style digest (`sha256-` + standard base64 of SHA-256).
 * - `fallback` (models only): the uncompressed GLB used when the meshopt decoder is missing/fails.
 *
 * The file is serialized canonically (sorted keys, 2-space indent, trailing newline) so the
 * pipeline output is byte-reproducible. No DOM, no Node: shared by pipeline, client and tests.
 */
import { canonicalJson } from './canonical.ts';
import { isPlainObject } from './merge.ts';

/** Logical asset id: lower-case path segments, e.g. `units/cube_bot`, `maps/hollow-ridge`. */
export const ASSET_ID_PATTERN = '^[a-z0-9_-]+(/[a-z0-9_.-]+)*$';
export const ASSET_MANIFEST_VERSION = 1;
/** File name of the manifest inside the asset directory. */
export const ASSET_MANIFEST_FILE = 'manifest.json';

export type AssetKind = 'map' | 'simbin' | 'viewjson' | 'model';
export const ASSET_KINDS: readonly AssetKind[] = ['map', 'simbin', 'viewjson', 'model'];

/** One hashed file. */
export interface AssetFileRef {
  /** Relative to the manifest URL; no `..`, no scheme, no leading slash. */
  readonly url: string;
  readonly bytes: number;
  /** `sha256-<base64>` (SRI format). */
  readonly hash: string;
}

export interface AssetEntry extends AssetFileRef {
  readonly kind: AssetKind;
  /** Uncompressed fallback (models: `.raw.glb`). */
  readonly fallback?: AssetFileRef;
}

export interface AssetManifest {
  readonly version: typeof ASSET_MANIFEST_VERSION;
  readonly assets: Readonly<Record<string, AssetEntry>>;
}

const ID_RE = new RegExp(ASSET_ID_PATTERN);
const URL_RE = /^[a-z0-9_-]+(\/[a-z0-9_.-]+)*$/i;
const HASH_RE = /^sha256-[A-Za-z0-9+/]{43}=$/;

function fail(path: string, msg: string): never {
  throw new RangeError(`asset manifest ${path}: ${msg}`);
}

function fileRef(v: unknown, path: string): AssetFileRef {
  if (!isPlainObject(v)) fail(path, 'expected an object');
  const { url, bytes, hash } = v;
  if (typeof url !== 'string' || !URL_RE.test(url) || url.includes('..')) fail(`${path}/url`, 'expected a relative path');
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) fail(`${path}/bytes`, 'expected a byte count');
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) fail(`${path}/hash`, "expected 'sha256-<base64>'");
  return { url, bytes, hash };
}

/** Parses and validates a manifest (text or parsed JSON). Unknown keys are rejected. */
export function parseAssetManifest(input: string | unknown): AssetManifest {
  const v: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isPlainObject(v)) fail('/', 'expected an object');
  for (const k of Object.keys(v)) if (k !== 'version' && k !== 'assets') fail(`/${k}`, 'unknown key');
  if (v.version !== ASSET_MANIFEST_VERSION) fail('/version', `unsupported version ${String(v.version)}`);
  if (!isPlainObject(v.assets)) fail('/assets', 'expected an object');
  const assets: Record<string, AssetEntry> = {};
  for (const id of Object.keys(v.assets).sort()) {
    const p = `/assets/${id}`;
    if (!ID_RE.test(id)) fail(p, 'invalid logical asset id');
    const e = v.assets[id];
    if (!isPlainObject(e)) fail(p, 'expected an object');
    for (const k of Object.keys(e)) {
      if (!['url', 'bytes', 'hash', 'kind', 'fallback'].includes(k)) fail(`${p}/${k}`, 'unknown key');
    }
    const ref = fileRef(e, p);
    const kind = e.kind;
    if (typeof kind !== 'string' || !(ASSET_KINDS as readonly string[]).includes(kind)) {
      fail(`${p}/kind`, `expected one of ${ASSET_KINDS.join(', ')}`);
    }
    let entry: AssetEntry = { ...ref, kind: kind as AssetKind };
    if (e.fallback !== undefined) {
      if (kind !== 'model') fail(`${p}/fallback`, 'only models have a fallback');
      const fb = e.fallback;
      if (isPlainObject(fb)) for (const k of Object.keys(fb)) if (!['url', 'bytes', 'hash'].includes(k)) fail(`${p}/fallback/${k}`, 'unknown key');
      entry = { ...entry, fallback: fileRef(fb, `${p}/fallback`) };
    }
    assets[id] = entry;
  }
  return { version: ASSET_MANIFEST_VERSION, assets };
}

/** Canonical manifest text (sorted keys, 2-space indent, trailing newline). */
export function serializeAssetManifest(m: AssetManifest): string {
  return canonicalJson(m, 2) + '\n';
}

/** Logical ids of all entries of `kind`, sorted. */
export function assetIdsOfKind(m: AssetManifest, kind: AssetKind): string[] {
  return Object.keys(m.assets)
    .filter((id) => m.assets[id]!.kind === kind)
    .sort();
}
