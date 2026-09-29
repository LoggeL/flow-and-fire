/**
 * mapc — CLI import "heightmap + JSON markers → .rtsmap" (PLAN §3.9; replaces the marker editor
 * until MS8).
 *
 *   pnpm --filter @faf/formats mapc -- --heightmap <file.png|.pgm|.r16> --markers <markers.json>
 *        --out <file.rtsmap> [--splat a.png[,b.png]] [--preview]
 *
 * markers.json uses world units (decimals, human-readable):
 *   { "version": 1, "name": "…", "sizeWu": 512,
 *     "heightScale": <WU per height step> | "heightScaleRaw": <Fx raw per step, 1..32>,
 *     "waterLevel": <WU> | null,
 *     "starts": [{ "army": 0, "x": …, "z": … }], "mass": [{ "x", "z" }], "hydro": [{ "x", "z" }],
 *     "props": [{ "id": "core:rock_01", "x", "z", "yawDeg"?, "scale"? }],
 *     "light"?: { "azimuthDeg", "elevationDeg", "sun": [r,g,b], "ambient": [r,g,b] },
 *     "strata"?: [{ "name", "color": [r,g,b] }] }
 *
 * Unit conversion happens exactly once, here: WU → Fx raw = Math.round(v·4096); yawDeg → Ang16 =
 * Math.round(yawDeg·65536/360) mod 65536; scale → scalePermille = Math.round(scale·1000);
 * heightScale → heightScaleRaw = Math.round(heightScale·4096). Everything after this point
 * (the .rtsmap, the sim) is integer-only.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LAND_MAX_WATER_DEPTH_RAW, sampleHeightRaw, type Heightfield } from '@faf/rules';
import {
  createRtsMap,
  DEFAULT_MAP_LIGHT,
  FormatError,
  writeRtsMap,
  type MapLight,
  type MapPreview,
  type MapProp,
  type MapSplatRaw,
  type MapSpot,
  type MapStart,
  type MapStratum,
  type RtsMap,
} from '../src/index.ts';
import { readHeightmap, type HeightmapData } from './heightmap-io.ts';
import { decodePng } from './png.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const MAPS_DIR = join(REPO_ROOT, 'content/maps');
export const MAPS_SRC_DIR = join(MAPS_DIR, 'src');
/** Edge length of the PREV thumbnail written with --preview. */
export const PREVIEW_SIZE = 128;

export class MapcError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(problems.length === 1 ? problems[0]! : `${problems.length} problems:\n  - ${problems.join('\n  - ')}`);
    this.name = 'MapcError';
    this.problems = problems;
  }
}

/** WU → Fx raw, the single rounding step of the import (documented in the module header). */
export function wuToRaw(v: number): number {
  return Math.round(v * 4096) + 0;
}

export function degToAng16(deg: number): number {
  return (((Math.round((deg * 65536) / 360) % 65536) + 65536) % 65536) + 0;
}

export interface CompileInput {
  readonly heightmap: HeightmapData;
  /** Parsed markers.json (validated here). */
  readonly markers: unknown;
  /** Splat weight images (RGBA8 PNG bytes), 1 or 2 ⇒ 4 or 8 layers. */
  readonly splatPngs?: readonly Uint8Array[];
  readonly preview?: boolean;
  /** Name used in error messages. */
  readonly source?: string;
}

type Obj = Record<string, unknown>;

class Problems {
  readonly list: string[] = [];
  constructor(private readonly source: string) {}
  add(msg: string): void {
    this.list.push(`${this.source}: ${msg}`);
  }
  throwIfAny(): void {
    if (this.list.length > 0) throw new MapcError(this.list);
  }
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkKeys(o: Obj, allowed: readonly string[], where: string, pr: Problems): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) pr.add(`${where}: unknown key '${k}' (allowed: ${allowed.join(', ')})`);
}

function rgbOf(v: unknown, where: string, pr: Problems): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => Number.isInteger(c) && (c as number) >= 0 && (c as number) <= 255)) {
    pr.add(`${where} must be [r, g, b] with integers 0..255`);
    return [0, 0, 0];
  }
  return [v[0] as number, v[1] as number, v[2] as number];
}

function heightfieldOf(hm: HeightmapData, heightScaleRaw: number): Heightfield {
  return { sizeWu: hm.dim - 1, dim: hm.dim, heights: hm.samples, heightScaleRaw };
}

/** Validates markers + heightmap and builds the map. Throws MapcError listing every problem. */
export function compileMap(input: CompileInput): RtsMap {
  const source = input.source ?? 'markers.json';
  const pr = new Problems(source);
  const m = input.markers;
  if (!isObj(m)) throw new MapcError([`${source}: markers must be a JSON object`]);
  checkKeys(
    m,
    ['version', 'name', 'sizeWu', 'heightScale', 'heightScaleRaw', 'waterLevel', 'starts', 'mass', 'hydro', 'props', 'light', 'strata'],
    'markers',
    pr,
  );
  if (m['version'] !== 1) pr.add(`version must be 1, got ${JSON.stringify(m['version'])}`);
  const name = m['name'];
  if (typeof name !== 'string' || name.length === 0) pr.add('name must be a non-empty string');

  const hm = input.heightmap;
  const sizeWu = m['sizeWu'];
  if (!Number.isInteger(sizeWu)) pr.add('sizeWu must be an integer');
  else if (sizeWu !== hm.dim - 1) pr.add(`sizeWu ${String(sizeWu)} does not match the heightmap (${hm.dim}×${hm.dim} samples ⇒ sizeWu ${hm.dim - 1})`);
  const size = hm.dim - 1;
  if (size < 64 || size > 4096) pr.add(`map size ${size} WU is outside 64..4096 (heightmap ${hm.dim}×${hm.dim})`);

  let heightScaleRaw = 32;
  if (m['heightScale'] !== undefined && m['heightScaleRaw'] !== undefined) pr.add("give either 'heightScale' or 'heightScaleRaw', not both");
  if (m['heightScaleRaw'] !== undefined) {
    if (!Number.isInteger(m['heightScaleRaw'])) pr.add('heightScaleRaw must be an integer');
    else heightScaleRaw = m['heightScaleRaw'] as number;
  } else if (m['heightScale'] !== undefined) {
    if (!finite(m['heightScale'])) pr.add('heightScale must be a number (WU per height step)');
    else heightScaleRaw = wuToRaw(m['heightScale']);
  } else {
    pr.add("missing 'heightScale' (WU per height step) or 'heightScaleRaw' (Fx raw per step)");
  }
  if (heightScaleRaw < 1 || heightScaleRaw > 32) pr.add(`height scale ${heightScaleRaw} raw (${heightScaleRaw / 4096} WU per step) is outside 1..32 raw`);

  let waterLevelRaw: number | null = null;
  const wl = m['waterLevel'];
  if (wl === undefined) pr.add("missing 'waterLevel' (WU, or null for no water)");
  else if (wl !== null) {
    if (!finite(wl) || wl < 0) pr.add('waterLevel must be a number >= 0 (WU) or null');
    else waterLevelRaw = wuToRaw(wl);
  }
  pr.throwIfAny();

  const hf = heightfieldOf(hm, heightScaleRaw);
  const maxRaw = size * 4096;
  const point = (v: unknown, where: string, deepWaterIsError: boolean): { x: number; z: number } | null => {
    if (!isObj(v)) {
      pr.add(`${where} must be an object`);
      return null;
    }
    const x = v['x'];
    const z = v['z'];
    if (!finite(x) || !finite(z)) {
      pr.add(`${where} needs numeric x and z (WU)`);
      return null;
    }
    const xr = wuToRaw(x);
    const zr = wuToRaw(z);
    if (xr < 0 || xr > maxRaw || zr < 0 || zr > maxRaw) {
      pr.add(`${where} (x=${x}, z=${z}) lies outside the map (0..${size} WU)`);
      return null;
    }
    if (deepWaterIsError && waterLevelRaw !== null) {
      const depth = waterLevelRaw - sampleHeightRaw(hf, xr, zr);
      if (depth > LAND_MAX_WATER_DEPTH_RAW) {
        pr.add(`${where} (x=${x}, z=${z}) lies in deep water (${(depth / 4096).toFixed(2)} WU > ${LAND_MAX_WATER_DEPTH_RAW / 4096} WU)`);
      }
    }
    return { x: xr, z: zr };
  };
  const list = (key: string): unknown[] => {
    const v = m[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      pr.add(`${key} must be an array`);
      return [];
    }
    return v;
  };

  const starts: MapStart[] = [];
  const seenArmies: number[] = [];
  list('starts').forEach((s, i) => {
    const where = `starts[${i}]`;
    if (isObj(s)) checkKeys(s, ['army', 'x', 'z'], where, pr);
    const army = isObj(s) ? s['army'] : undefined;
    if (!Number.isInteger(army) || (army as number) < 0 || (army as number) > 15) {
      pr.add(`${where}.army must be an integer 0..15`);
      return;
    }
    if (seenArmies.includes(army as number)) pr.add(`${where}: army ${String(army)} has more than one start position`);
    seenArmies.push(army as number);
    const p = point(s, where, true);
    if (p !== null) starts.push({ army: army as number, x: p.x, z: p.z });
  });
  if (m['starts'] === undefined || starts.length === 0) pr.add('at least one start position is required');
  starts.sort((a, b) => a.army - b.army);

  const spots: MapSpot[] = [];
  for (const kind of ['mass', 'hydro'] as const) {
    list(kind).forEach((s, i) => {
      if (isObj(s)) checkKeys(s, ['x', 'z'], `${kind}[${i}]`, pr);
      const p = point(s, `${kind}[${i}]`, true);
      if (p !== null) spots.push({ kind, x: p.x, z: p.z });
    });
  }

  const props: MapProp[] = [];
  list('props').forEach((s, i) => {
    const where = `props[${i}]`;
    if (!isObj(s)) {
      pr.add(`${where} must be an object`);
      return;
    }
    checkKeys(s, ['id', 'x', 'z', 'yawDeg', 'scale'], where, pr);
    const id = s['id'];
    if (typeof id !== 'string' || !/^[a-z0-9_]+:[a-z0-9_./-]+$/.test(id)) {
      pr.add(`${where}.id must be a namespace id like 'core:rock_01'`);
      return;
    }
    const yawDeg = s['yawDeg'] ?? 0;
    const scale = s['scale'] ?? 1;
    if (!finite(yawDeg)) pr.add(`${where}.yawDeg must be a number`);
    if (!finite(scale) || Math.round(scale * 1000) < 1 || Math.round(scale * 1000) > 65535) pr.add(`${where}.scale must be in 0.001..65.535`);
    const p = point(s, where, false);
    if (p !== null && finite(yawDeg) && finite(scale)) {
      props.push({ id, x: p.x, z: p.z, yaw: degToAng16(yawDeg), scalePermille: Math.round(scale * 1000) });
    }
  });

  let light: MapLight = DEFAULT_MAP_LIGHT;
  if (m['light'] !== undefined) {
    const l = m['light'];
    if (!isObj(l)) pr.add('light must be an object');
    else {
      checkKeys(l, ['azimuthDeg', 'elevationDeg', 'sun', 'ambient'], 'light', pr);
      const az = l['azimuthDeg'];
      const el = l['elevationDeg'];
      if (!Number.isInteger(az) || (az as number) < 0 || (az as number) > 359) pr.add('light.azimuthDeg must be an integer 0..359');
      if (!Number.isInteger(el) || (el as number) < 0 || (el as number) > 90) pr.add('light.elevationDeg must be an integer 0..90');
      light = { azimuthDeg: az as number, elevationDeg: el as number, sun: rgbOf(l['sun'], 'light.sun', pr), ambient: rgbOf(l['ambient'], 'light.ambient', pr) };
    }
  }

  const strata: MapStratum[] = [];
  list('strata').forEach((s, i) => {
    if (!isObj(s) || typeof s['name'] !== 'string' || s['name'].length === 0) {
      pr.add(`strata[${i}] needs a non-empty name`);
      return;
    }
    checkKeys(s, ['name', 'color'], `strata[${i}]`, pr);
    strata.push({ name: s['name'], color: rgbOf(s['color'], `strata[${i}].color`, pr) });
  });

  let splat: MapSplatRaw | null = null;
  const splatPngs = input.splatPngs ?? [];
  if (splatPngs.length > 0) {
    if (splatPngs.length > 2) pr.add(`--splat takes 1 or 2 RGBA images (4 or 8 layers), got ${splatPngs.length}`);
    const planes: Uint8Array[] = [];
    let res = -1;
    splatPngs.forEach((bytes, i) => {
      const img = decodePng(bytes);
      if (img.channels !== 4 || img.bitDepth !== 8) pr.add(`splat image ${i} must be RGBA with 8 bits per channel`);
      if (img.width !== img.height) pr.add(`splat image ${i} must be square`);
      if (res >= 0 && img.width !== res) pr.add(`splat image ${i} has resolution ${img.width}, image 0 has ${res}`);
      res = img.width;
      planes.push(Uint8Array.from(img.samples));
    });
    if (res > 4096) pr.add(`splat resolution ${res} exceeds 4096`);
    if (pr.list.length === 0) splat = { codec: 0, layers: splatPngs.length === 2 ? 8 : 4, resolution: res, planes };
  }
  pr.throwIfAny();

  try {
    const base = createRtsMap({
      sizeWu: size,
      name: name as string,
      heightScaleRaw,
      waterLevelRaw,
      heights: hm.samples,
      starts,
      spots,
      props,
      light,
      strata,
      splat,
    });
    return input.preview === true ? { ...base, preview: renderPreview(base, PREVIEW_SIZE) } : base;
  } catch (e) {
    if (e instanceof FormatError) throw new MapcError([`${source}: ${e.message}`]);
    throw e;
  }
}

const RAMP: readonly (readonly [number, number, number])[] = [
  [196, 182, 134], // shore sand
  [96, 132, 72], // grass
  [118, 110, 98], // rock
  [214, 214, 206], // highland
];

function lerp8(a: number, b: number, t: number): number {
  return a + Math.floor(((b - a) * t) / 256);
}

/**
 * Deterministic integer thumbnail (PREV): height ramp with hill shading, water tinted by depth,
 * mass spots green, hydro spots cyan, start positions in army colors.
 */
export function renderPreview(map: RtsMap, size: number): MapPreview {
  const meta = map.meta;
  const hf: Heightfield = { sizeWu: meta.sizeWu, dim: meta.sizeWu + 1, heights: map.heights, heightScaleRaw: meta.heightScaleRaw };
  const step = Math.floor((meta.sizeWu * 4096) / size);
  let lo = 0x7fffffff;
  let hi = 0;
  for (const h of map.heights) {
    lo = Math.min(lo, h * meta.heightScaleRaw);
    hi = Math.max(hi, h * meta.heightScaleRaw);
  }
  const range = Math.max(1, hi - lo);
  const rgba = new Uint8Array(size * size * 4);
  for (let pz = 0; pz < size; pz++) {
    for (let px = 0; px < size; px++) {
      const x = px * step + (step >> 1);
      const z = pz * step + (step >> 1);
      const h = sampleHeightRaw(hf, x, z);
      const gx = sampleHeightRaw(hf, x + step, z) - sampleHeightRaw(hf, x - step, z);
      const gz = sampleHeightRaw(hf, x, z + step) - sampleHeightRaw(hf, x, z - step);
      // Light from -x/-z; slope in raw per 2·step.
      const shade = Math.max(64, Math.min(320, 256 - Math.floor(((gx + gz) * 256) / (2 * step))));
      let r: number;
      let g: number;
      let b: number;
      const depth = meta.waterLevelRaw === null ? 0 : meta.waterLevelRaw - h;
      if (depth > 0) {
        const t = Math.min(256, Math.floor((depth * 256) / (3 * 4096)));
        r = lerp8(72, 22, t);
        g = lerp8(150, 62, t);
        b = lerp8(158, 104, t);
      } else {
        const t = Math.floor(((h - lo) * 768) / range); // 0..768 over three ramp segments
        const seg = Math.min(2, t >> 8);
        const f = t - seg * 256;
        const c0 = RAMP[seg]!;
        const c1 = RAMP[seg + 1]!;
        r = Math.min(255, (lerp8(c0[0], c1[0], f) * shade) >> 8);
        g = Math.min(255, (lerp8(c0[1], c1[1], f) * shade) >> 8);
        b = Math.min(255, (lerp8(c0[2], c1[2], f) * shade) >> 8);
      }
      const o = (pz * size + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  const dot = (xr: number, zr: number, radius: number, c: readonly [number, number, number]): void => {
    const cx = Math.floor(xr / step);
    const cz = Math.floor(zr / step);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= size || z >= size) continue;
        const o = (z * size + x) * 4;
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
      }
    }
  };
  for (const s of meta.spots) dot(s.x, s.z, 1, s.kind === 'mass' ? [70, 230, 90] : [70, 220, 240]);
  const armyColors: readonly (readonly [number, number, number])[] = [
    [60, 120, 255],
    [235, 60, 50],
  ];
  for (const s of meta.starts) dot(s.x, s.z, 2, armyColors[s.army] ?? [240, 210, 60]);
  return { width: size, height: size, rgba };
}

// ---------------------------------------------------------------------------------------------
// Map source directories (content/maps/src/<name>/): heightmap.{png,pgm,r16}, markers.json and
// optional splat-0.png / splat-1.png. Output: content/maps/<name>.rtsmap with a preview.

export interface MapSourceFiles {
  readonly heightmap: string;
  readonly markers: string;
  readonly splat: readonly string[];
}

export function mapSourceFiles(dir: string): MapSourceFiles {
  const hms = ['heightmap.png', 'heightmap.pgm', 'heightmap.r16'].filter((f) => existsSync(join(dir, f)));
  if (hms.length !== 1) throw new MapcError([`${dir}: expected exactly one heightmap.{png,pgm,r16}, found ${hms.length}`]);
  const splat = ['splat-0.png', 'splat-1.png'].filter((f) => existsSync(join(dir, f))).map((f) => join(dir, f));
  return { heightmap: join(dir, hms[0]!), markers: join(dir, 'markers.json'), splat };
}

export interface MapcOptions {
  readonly heightmap: string;
  readonly markers: string;
  readonly splat?: readonly string[];
  readonly preview?: boolean;
}

/** Reads the input files and compiles them to .rtsmap bytes. */
export function mapcFiles(o: MapcOptions): { map: RtsMap; bytes: Uint8Array } {
  let markers: unknown;
  try {
    markers = JSON.parse(readFileSync(o.markers, 'utf8'));
  } catch (e) {
    throw new MapcError([`${o.markers}: not valid JSON (${(e as Error).message})`]);
  }
  const map = compileMap({
    heightmap: readHeightmap(o.heightmap),
    markers,
    splatPngs: (o.splat ?? []).map((f) => new Uint8Array(readFileSync(f))),
    preview: o.preview ?? false,
    source: o.markers,
  });
  return { map, bytes: writeRtsMap(map) };
}

/** Compiles content/maps/src/<name> (convention above, always with preview). */
export function compileMapSource(dir: string): { map: RtsMap; bytes: Uint8Array } {
  const f = mapSourceFiles(dir);
  return mapcFiles({ heightmap: f.heightmap, markers: f.markers, splat: f.splat, preview: true });
}

/** Names of all map source directories under content/maps/src. */
export function listMapSources(): string[] {
  if (!existsSync(MAPS_SRC_DIR)) return [];
  return readdirSync(MAPS_SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(MAPS_SRC_DIR, d.name, 'markers.json')))
    .map((d) => d.name)
    .sort();
}

/** Compiles every map source to content/maps/<name>.rtsmap; returns the written paths. */
export function compileAllMapSources(log: (msg: string) => void = () => {}): string[] {
  const out: string[] = [];
  for (const name of listMapSources()) {
    const { map, bytes } = compileMapSource(join(MAPS_SRC_DIR, name));
    const path = join(MAPS_DIR, `${name}.rtsmap`);
    writeFileSync(path, bytes);
    log(`mapc: ${name} -> ${path} (${bytes.length} B, '${map.meta.name}')`);
    out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CLI

function parseArgs(argv: readonly string[]): { heightmap: string; markers: string; out: string; splat: string[]; preview: boolean } {
  const base = process.env['INIT_CWD'] ?? process.cwd();
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(base, p));
  let heightmap = '';
  let markers = '';
  let out = '';
  let splat: string[] = [];
  let preview = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new MapcError([`${a} needs a value`]);
      return v;
    };
    if (a === '--') continue;
    else if (a === '--heightmap') heightmap = abs(next());
    else if (a === '--markers') markers = abs(next());
    else if (a === '--out') out = abs(next());
    else if (a === '--splat') splat = next().split(',').filter((s) => s.length > 0).map(abs);
    else if (a === '--preview') preview = true;
    else throw new MapcError([`unknown argument '${a}'`]);
  }
  const missing = [heightmap === '' && '--heightmap', markers === '' && '--markers', out === '' && '--out'].filter((x) => x !== false);
  if (missing.length > 0) {
    throw new MapcError([`missing ${missing.join(', ')}; usage: mapc --heightmap <file> --markers <markers.json> --out <file.rtsmap> [--splat a.png,b.png] [--preview]`]);
  }
  return { heightmap, markers, out, splat, preview };
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const { map, bytes } = mapcFiles(args);
    writeFileSync(args.out, bytes);
    console.log(`mapc: wrote ${args.out} (${bytes.length} B) — '${map.meta.name}', ${map.meta.sizeWu} WU, ${map.meta.starts.length} starts, ${map.meta.spots.length} spots, ${map.props.length} props`);
  } catch (e) {
    if (e instanceof MapcError || e instanceof Error) {
      console.error(`mapc: ${e.message}`);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();

