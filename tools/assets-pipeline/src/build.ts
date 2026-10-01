/**
 * Asset pipeline build (P3, MS2): turns the content sources into the content-hashed files of
 * `content/generated/assets/` plus `manifest.json`.
 *
 * Inputs (all read-only here):
 * - procedural source models (`models.ts`) → `models/<id>.<hash8>.glb` (meshopt) and
 *   `models/<id>.<hash8>.raw.glb` (uncompressed fallback),
 * - `content/maps/*.rtsmap` (validated with `@faf/formats`) → `maps/<name>.<hash8>.rtsmap`,
 * - `content/generated/sim.bin` / `view.json` (blueprint compiler output, validated) →
 *   `content/sim.<hash8>.bin`, `content/view.<hash8>.json`,
 * - `content/icons/icons.json` (vector icon sources, MS3/C2) → the MSDF atlas
 *   `icons/atlas.<hash8>.rgba` (kind `iconatlas`) + `icons/atlas.<hash8>.json` (kind `iconmetrics`),
 *   see icons.ts; every `view.icon` must be an atlas glyph.
 *
 * `hash8` = first 8 hex digits of the file's own SHA-256; the manifest carries the full digest in
 * SRI form. Every `view.mesh` must name a built model. The build is byte-deterministic (building
 * twice yields identical files) and the output is checked in; `check` reports drift.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_MANIFEST_FILE,
  ASSET_MANIFEST_VERSION,
  parseAssetManifest,
  serializeAssetManifest,
  type AssetEntry,
  type AssetFileRef,
  type AssetManifest,
} from '@faf/blueprints/asset-manifest';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { parseViewJson } from '@faf/blueprints/view';
import { readRtsMap } from '@faf/formats';
import { writeCompressedGlb, writeRawGlb } from './gltf.ts';
import { buildIconAtlas, parseIconSource } from './icons.ts';
import { type ModelDef } from './models.ts';
import { referencedModels } from './modelkit.ts';

/** Repository root (…/flow-and-fire). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/** Default output directory. */
export const ASSETS_DIR = join(REPO_ROOT, 'content', 'generated', 'assets');

export interface AssetFile {
  /** Path relative to the asset directory (POSIX separators). */
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface AssetBuild {
  /** All output files incl. `manifest.json`, sorted by path. */
  readonly files: readonly AssetFile[];
  readonly manifest: AssetManifest;
  /** Manifest text as written. */
  readonly manifestText: string;
}

export interface BuildOptions {
  /** Repository root to read sources from (default: this checkout). */
  readonly repoRoot?: string;
  /** Models to build (default: all pipeline models). */
  readonly models?: readonly ModelDef[];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SRI digest `sha256-<base64>`. */
export function sriSha256(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('base64')}`;
}

/** `dir/name.<hash8>.ext` for `bytes`. */
export function hashedName(dir: string, name: string, ext: string, bytes: Uint8Array): string {
  return `${dir}/${name}.${sha256Hex(bytes).slice(0, 8)}.${ext}`;
}

function ref(path: string, bytes: Uint8Array): AssetFileRef {
  return { url: path, bytes: bytes.length, hash: sriSha256(bytes) };
}

/** Builds all asset files in memory. */
export async function buildAssets(opts: BuildOptions = {}): Promise<AssetBuild> {
  const root = opts.repoRoot ?? REPO_ROOT;
  const files: AssetFile[] = [];
  const assets: Record<string, AssetEntry> = {};
  const add = (id: string, path: string, bytes: Uint8Array, kind: AssetEntry['kind'], fallback?: AssetFileRef): void => {
    if (assets[id] !== undefined) throw new Error(`asset id '${id}' built twice`);
    files.push({ path, bytes });
    assets[id] = fallback === undefined ? { ...ref(path, bytes), kind } : { ...ref(path, bytes), kind, fallback };
  };

  // Compiled content (blueprint compiler output).
  const generated = join(root, 'content', 'generated');
  const simBin = new Uint8Array(await readFile(join(generated, 'sim.bin')));
  const blueprintTable = decodeSimBin(simBin); // validates
  const viewBytes = new Uint8Array(await readFile(join(generated, 'view.json')));
  const view = parseViewJson(new TextDecoder().decode(viewBytes));
  const structureFootprints = new Map<string, readonly [number, number]>();
  for (const v of view.visuals) if (v.mesh !== undefined && v.categories.includes('STRUCTURE')) {
    const index = blueprintTable.indexOf(v.id);
    structureFootprints.set(v.mesh, [blueprintTable.footprintWCol[index]!, blueprintTable.footprintHCol[index]!]);
  }
  const models = [...(opts.models ?? await referencedModels(view.visuals.flatMap(v => v.mesh === undefined ? [] : [v.mesh]), root, structureFootprints))]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  add('content/sim.bin', hashedName('content', 'sim', 'bin', simBin), simBin, 'simbin');
  add('content/view.json', hashedName('content', 'view', 'json', viewBytes), viewBytes, 'viewjson');

  // Strategic icon atlas (MSDF, raw RGBA8) + metrics.
  const iconSrc = parseIconSource(new TextDecoder().decode(await readFile(join(root, 'content', 'icons', 'icons.json'))));
  const atlas = buildIconAtlas(iconSrc);
  const metricsBytes = new TextEncoder().encode(atlas.metricsText);
  add('icons/atlas', hashedName('icons', 'atlas', 'rgba', atlas.pixels), atlas.pixels, 'iconatlas');
  add('icons/atlas-metrics', hashedName('icons', 'atlas', 'json', metricsBytes), metricsBytes, 'iconmetrics');
  const glyphIds = new Set(atlas.metrics.glyphs.map((g) => g.id));
  const noGlyph = view.visuals.filter((v) => v.icon !== undefined && !glyphIds.has(v.icon));
  if (noGlyph.length > 0) throw new Error(`view.json references icons without atlas glyph: ${noGlyph.map((v) => `${v.id} → ${v.icon}`).join(', ')}`);

  // Maps.
  const mapDir = join(root, 'content', 'maps');
  const mapFiles = (await readdir(mapDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name.endsWith('.rtsmap'))
    .map((e) => e.name)
    .sort();
  for (const f of mapFiles) {
    const bytes = new Uint8Array(await readFile(join(mapDir, f)));
    try {
      readRtsMap(bytes);
    } catch (e) {
      throw new Error(`content/maps/${f}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    const name = f.slice(0, -'.rtsmap'.length);
    add(`maps/${name}`, hashedName('maps', name, 'rtsmap', bytes), bytes, 'map');
  }

  // Models.
  const modelIds = new Set<string>();
  for (const m of models) {
    const glb = await writeCompressedGlb(m);
    const raw = await writeRawGlb(m);
    const dir = `models/${m.id.slice(0, m.id.lastIndexOf('/') + 1)}`.replace(/\/$/, '');
    const name = m.id.slice(m.id.lastIndexOf('/') + 1);
    const rawPath = hashedName(dir, name, 'raw.glb', raw);
    files.push({ path: rawPath, bytes: raw });
    add(m.id, hashedName(dir, name, 'glb', glb), glb, 'model', ref(rawPath, raw));
    modelIds.add(m.id);
  }
  const missing = view.visuals.filter((v) => v.mesh !== undefined && !modelIds.has(v.mesh));
  if (missing.length > 0) {
    throw new Error(`view.json references unknown models: ${missing.map((v) => `${v.id} → ${v.mesh}`).join(', ')}`);
  }

  const manifest = parseAssetManifest({ version: ASSET_MANIFEST_VERSION, assets });
  const manifestText = serializeAssetManifest(manifest);
  files.push({ path: ASSET_MANIFEST_FILE, bytes: new TextEncoder().encode(manifestText) });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, manifest, manifestText };
}

async function listFiles(dir: string, base = dir, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFiles(p, base, out);
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out.sort();
}

/** Problems of `dir` against `build`: `missing <f>`, `changed <f>`, `stale <f>` (sorted). */
export async function diffAssets(build: AssetBuild, dir: string = ASSETS_DIR): Promise<string[]> {
  const problems: string[] = [];
  const want = new Map(build.files.map((f) => [f.path, f.bytes] as const));
  for (const [path, bytes] of want) {
    let cur: Buffer | null;
    try {
      cur = await readFile(join(dir, path));
    } catch {
      cur = null;
    }
    if (cur === null) problems.push(`missing ${path}`);
    else if (!cur.equals(bytes)) problems.push(`changed ${path}`);
  }
  for (const f of await listFiles(dir)) if (!want.has(f)) problems.push(`stale ${f}`);
  return problems.sort();
}

/** Writes `build` into `dir` and removes files that are no longer part of it. */
export async function writeAssets(build: AssetBuild, dir: string = ASSETS_DIR): Promise<{ written: number; removed: number }> {
  const want = new Set(build.files.map((f) => f.path));
  let removed = 0;
  for (const f of await listFiles(dir)) {
    if (want.has(f)) continue;
    await rm(join(dir, f));
    removed++;
  }
  let written = 0;
  for (const f of build.files) {
    const p = join(dir, f.path);
    let same: boolean;
    try {
      same = (await readFile(p)).equals(f.bytes);
    } catch {
      same = false;
    }
    if (same) continue;
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, f.bytes);
    written++;
  }
  await removeEmptyDirs(dir);
  return { written, removed };
}

async function removeEmptyDirs(dir: string, isRoot = true): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let empty = true;
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!(await removeEmptyDirs(join(dir, e.name), false))) empty = false;
    } else {
      empty = false;
    }
  }
  if (empty && !isRoot) await rm(dir, { recursive: true });
  return empty;
}
