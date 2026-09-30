/**
 * .rtsmap — the map file (PLAN §3.9) in the chunk container (magic 'RTSM', format version 1).
 *
 * Chunks, written in this fixed order (unknown chunks keep their relative position):
 *   META    canonical UTF-8 JSON (fixed key order, no whitespace, integers only):
 *           {"v":1,"name":…,"sizeWu":…,"heightScaleRaw":…,"waterLevelRaw":int|null,
 *            "starts":[{"army","x","z"}],"spots":[{"kind":"mass"|"hydro","x","z"}],
 *            "light":{"azimuthDeg","elevationDeg","sun":[r,g,b],"ambient":[r,g,b]},
 *            "strata":[{"name","color":[r,g,b]}]}
 *           Coordinates are Fx raw (Q20.12) in [0, sizeWu·4096].
 *   'HGT '  u16 dim (= sizeWu + 1) | u16 reserved (0) | dim² × u16 (index z·dim + x)
 *   SPLT?   u8 codec (0 = raw RGBA8, 1 = KTX2 passed through) | u8 layerCount (4|8) | u16 resolution
 *           | codec 0: ceil(layerCount/4) RGBA8 planes of resolution² texels; codec 1: opaque payload
 *   PROP    u32 count | per prop: u16 idLen | id (UTF-8) | zero pad to 4 | i32 x | i32 z
 *           | u16 yaw (Ang16) | u16 scalePermille
 *   PFLD?   prop fields (TRACK-EDITOR, additive; layout and expansion in propfields.ts):
 *           u16 algoVersion | u16 fieldCount | per field: u16 nameLen | name | pad4 | u8 kind | u8 shapeKind
 *           | u16 flags | u32 seed | u16 density | u16 maxSlope | u16 scaleMin | u16 scaleMax
 *           | u32 reclaimMassMilli | u32 reclaimEnergyMilli | u16 entryCount | u16 pointCount
 *           | entries (u16 idLen | id | pad4 | u16 weight | u16 reserved) | circle (i32 x, z, r)
 *           or polygon (pointCount × i32 x, z). Absent chunk ⇔ `propFields` absent; written iff
 *           `propFields !== undefined` (maps without fields stay byte-identical).
 *   PREV?   u16 w | u16 h | w·h RGBA8
 *
 * mapSimHash covers exactly the simulation-relevant fields (see mapSimHash below); name, light,
 * strata, splat, preview, prop field names and unknown chunks never change it.
 *
 * Determinism contract (PLAN §3.12): integers only — this module runs in the sim worker.
 */

import { xxHash32 } from '@faf/fixed';
import { readContainer, writeContainer, isFourCC, type ContainerChunk } from './container.ts';
import { FormatError } from './errors.ts';
import { decodeUtf8, encodeUtf8 } from '@faf/protocol';
import { MAP_MAX_PROP_ID_BYTES, MAP_MAX_PROPS, PROP_ID_RE, type MapProp } from './mapprop.ts';
import {
  decodePropFieldsChunk,
  encodePropFieldsChunk,
  propFieldAlgoOf,
  propFieldsSimBytes,
  validatePropFields,
  type MapPropField,
} from './propfields.ts';

export { MAP_MAX_PROP_ID_BYTES, MAP_MAX_PROPS, PROP_ID_RE, type MapProp };

export const RTSMAP_MAGIC = 'RTSM';
export const RTSMAP_FORMAT_VERSION = 1;
/** Version field inside the META JSON. */
export const RTSMAP_META_VERSION = 1;

/** Fx raw units per world unit (Q20.12). */
export const MAP_FX_ONE = 4096;
export const MAP_MIN_SIZE_WU = 64;
export const MAP_MAX_SIZE_WU = 4096;
export const MAP_MIN_HEIGHT_SCALE_RAW = 1;
export const MAP_MAX_HEIGHT_SCALE_RAW = 32;
export const MAP_MAX_ARMIES = 16;
export const MAP_MAX_SPOTS = 1024;
export const MAP_MAX_STRATA = 8;
export const MAP_MAX_NAME_BYTES = 128;
export const MAP_MAX_SPLAT_RESOLUTION = 4096;
export const MAP_MAX_PREVIEW_SIZE = 1024;

/** Known chunk ids in their fixed write order. */
export const RTSMAP_CHUNK_ORDER = ['META', 'HGT ', 'SPLT', 'PROP', 'PFLD', 'PREV'] as const;
export type RtsMapChunkId = (typeof RTSMAP_CHUNK_ORDER)[number];

export type SpotKind = 'mass' | 'hydro';
export type Rgb = readonly [number, number, number];

export interface MapStart {
  /** Army slot 0..15. */
  readonly army: number;
  readonly x: number;
  readonly z: number;
}

export interface MapSpot {
  readonly kind: SpotKind;
  readonly x: number;
  readonly z: number;
}

export interface MapLight {
  /** Sun direction around +y, degrees 0..359 (0 = from +z, 90 = from +x). */
  readonly azimuthDeg: number;
  /** Sun elevation above the horizon, degrees 0..90. */
  readonly elevationDeg: number;
  readonly sun: Rgb;
  readonly ambient: Rgb;
}

export interface MapStratum {
  readonly name: string;
  readonly color: Rgb;
}

export interface MapMeta {
  readonly v: 1;
  readonly name: string;
  /** Edge length in world units: a power of two in 64..4096. */
  readonly sizeWu: number;
  /** Fx raw per u16 height step, 1..32 (32 = 1/128 WU). */
  readonly heightScaleRaw: number;
  /** Water surface in Fx raw, or null = no water. */
  readonly waterLevelRaw: number | null;
  /** Sorted by strictly ascending army. */
  readonly starts: readonly MapStart[];
  readonly spots: readonly MapSpot[];
  readonly light: MapLight;
  readonly strata: readonly MapStratum[];
}

/** Raw splat weights: `layers / 4` RGBA8 planes of resolution² texels (4 weights per plane). */
export interface MapSplatRaw {
  readonly codec: 0;
  readonly layers: 4 | 8;
  readonly resolution: number;
  readonly planes: readonly Uint8Array[];
}

/** KTX2-compressed splat (MS9): stored and written back untouched. */
export interface MapSplatKtx2 {
  readonly codec: 1;
  readonly layers: 4 | 8;
  readonly resolution: number;
  readonly payload: Uint8Array;
}

export type MapSplat = MapSplatRaw | MapSplatKtx2;

export interface MapPreview {
  readonly width: number;
  readonly height: number;
  /** width·height RGBA8, row-major from the map's z = 0 row. */
  readonly rgba: Uint8Array;
}

/** A chunk this reader does not know: kept raw and written back after the same known chunk. */
export interface UnknownChunk {
  readonly id: string;
  readonly data: Uint8Array;
  /** The known chunk it followed in the file (null = before the first known chunk). */
  readonly after: RtsMapChunkId | null;
}

export interface RtsMap {
  readonly meta: MapMeta;
  /** dim² u16 height steps, index z·dim + x (dim = sizeWu + 1). */
  readonly heights: Uint16Array;
  readonly splat: MapSplat | null;
  /** Order is preserved (it is part of mapSimHash). */
  readonly props: readonly MapProp[];
  /**
   * Prop fields (PFLD chunk, see propfields.ts). Absent ⇔ the file has no PFLD chunk; present
   * (also with 0 fields) ⇔ PFLD is written. Order is preserved (part of mapSimHash).
   */
  readonly propFields?: readonly MapPropField[];
  /**
   * Expansion algorithm version of `propFields` (PFLD header). readRtsMap always sets it when the
   * file has a PFLD chunk; absent in memory = PROPFIELD_ALGO_VERSION (new fields). Ignored without
   * `propFields`. Part of mapSimHash (only with a non-empty field list).
   */
  readonly propFieldAlgo?: number;
  readonly preview: MapPreview | null;
  readonly unknownChunks: readonly UnknownChunk[];
}

/** Simulation view of a map (input of createWorld in @faf/sim). Arrays are shared, treat as read-only. */
export interface MapSimData {
  readonly sizeWu: number;
  readonly dim: number;
  readonly heightScaleRaw: number;
  readonly waterLevelRaw: number | null;
  readonly heights: Uint16Array;
  readonly starts: readonly MapStart[];
  readonly spots: readonly MapSpot[];
  readonly props: readonly MapProp[];
}

export const DEFAULT_MAP_LIGHT: MapLight = {
  azimuthDeg: 135,
  elevationDeg: 50,
  sun: [255, 244, 222],
  ambient: [96, 108, 128],
};

// ---------------------------------------------------------------------------------------------
// Validation

function fail(chunk: RtsMapChunkId | null, detail: string): never {
  throw new FormatError('bad-value', detail, chunk);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function checkInt(chunk: RtsMapChunkId, what: string, v: unknown, lo: number, hi: number): number {
  if (!isInt(v) || v < lo || v > hi) fail(chunk, `${what} must be an integer in [${lo}, ${hi}], got ${String(v)}`);
  return v;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function checkText(chunk: RtsMapChunkId, what: string, v: unknown, maxBytes: number): string {
  if (typeof v !== 'string' || v.length === 0) fail(chunk, `${what} must be a non-empty string`);
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) fail(chunk, `${what} contains a control character`);
  }
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(v);
  } catch {
    return fail(chunk, `${what} is not valid Unicode`);
  }
  if (bytes.length > maxBytes) fail(chunk, `${what} is longer than ${maxBytes} UTF-8 bytes`);
  return v;
}

function checkRgb(chunk: RtsMapChunkId, what: string, v: unknown): Rgb {
  if (!Array.isArray(v) || v.length !== 3) fail(chunk, `${what} must be [r, g, b]`);
  return [checkInt(chunk, `${what}[0]`, v[0], 0, 255), checkInt(chunk, `${what}[1]`, v[1], 0, 255), checkInt(chunk, `${what}[2]`, v[2], 0, 255)];
}

/** Throws FormatError('bad-value') unless `map` satisfies every invariant of the format. */
export function validateRtsMap(map: RtsMap): void {
  const m = map.meta;
  if (m.v !== RTSMAP_META_VERSION) fail('META', `meta version ${String(m.v)}, expected ${RTSMAP_META_VERSION}`);
  checkText('META', 'name', m.name, MAP_MAX_NAME_BYTES);
  const size = checkInt('META', 'sizeWu', m.sizeWu, MAP_MIN_SIZE_WU, MAP_MAX_SIZE_WU);
  if (!isPowerOfTwo(size)) fail('META', `sizeWu ${size} is not a power of two`);
  const s = checkInt('META', 'heightScaleRaw', m.heightScaleRaw, MAP_MIN_HEIGHT_SCALE_RAW, MAP_MAX_HEIGHT_SCALE_RAW);
  if (m.waterLevelRaw !== null) checkInt('META', 'waterLevelRaw', m.waterLevelRaw, 0, 0xffff * s);
  const maxCoord = size * MAP_FX_ONE;

  if (!Array.isArray(m.starts) || m.starts.length < 1 || m.starts.length > MAP_MAX_ARMIES) {
    fail('META', `starts must list 1..${MAP_MAX_ARMIES} armies`);
  }
  let prevArmy = -1;
  for (let i = 0; i < m.starts.length; i++) {
    const st = m.starts[i]!;
    const army = checkInt('META', `starts[${i}].army`, st.army, 0, MAP_MAX_ARMIES - 1);
    if (army <= prevArmy) fail('META', `starts must be sorted by strictly ascending army (starts[${i}].army = ${army})`);
    prevArmy = army;
    checkInt('META', `starts[${i}].x`, st.x, 0, maxCoord);
    checkInt('META', `starts[${i}].z`, st.z, 0, maxCoord);
  }
  if (!Array.isArray(m.spots) || m.spots.length > MAP_MAX_SPOTS) fail('META', `spots must list 0..${MAP_MAX_SPOTS} entries`);
  for (let i = 0; i < m.spots.length; i++) {
    const sp = m.spots[i]!;
    if (sp.kind !== 'mass' && sp.kind !== 'hydro') fail('META', `spots[${i}].kind must be 'mass' or 'hydro'`);
    checkInt('META', `spots[${i}].x`, sp.x, 0, maxCoord);
    checkInt('META', `spots[${i}].z`, sp.z, 0, maxCoord);
  }
  const l = m.light;
  if (typeof l !== 'object' || l === null) fail('META', 'light must be an object');
  checkInt('META', 'light.azimuthDeg', l.azimuthDeg, 0, 359);
  checkInt('META', 'light.elevationDeg', l.elevationDeg, 0, 90);
  checkRgb('META', 'light.sun', l.sun);
  checkRgb('META', 'light.ambient', l.ambient);
  if (!Array.isArray(m.strata) || m.strata.length > MAP_MAX_STRATA) fail('META', `strata must list 0..${MAP_MAX_STRATA} entries`);
  for (let i = 0; i < m.strata.length; i++) {
    const st = m.strata[i]!;
    checkText('META', `strata[${i}].name`, st.name, 32);
    checkRgb('META', `strata[${i}].color`, st.color);
  }

  const dim = size + 1;
  if (!(map.heights instanceof Uint16Array) || map.heights.length !== dim * dim) {
    fail('HGT ', `heights must be a Uint16Array of ${dim}×${dim} samples`);
  }

  const sp = map.splat;
  if (sp !== null) {
    if (sp.codec !== 0 && sp.codec !== 1) fail('SPLT', `unknown splat codec ${String((sp as { codec: unknown }).codec)}`);
    if (sp.layers !== 4 && sp.layers !== 8) fail('SPLT', `splat layers must be 4 or 8, got ${String(sp.layers)}`);
    const res = checkInt('SPLT', 'splat resolution', sp.resolution, 1, MAP_MAX_SPLAT_RESOLUTION);
    if (sp.codec === 0) {
      if (sp.planes.length !== sp.layers >> 2) fail('SPLT', `splat needs ${sp.layers >> 2} RGBA planes`);
      for (let i = 0; i < sp.planes.length; i++) {
        const pl = sp.planes[i]!;
        if (!(pl instanceof Uint8Array) || pl.length !== res * res * 4) fail('SPLT', `splat plane ${i} must hold ${res}×${res} RGBA8 texels`);
      }
    } else if (!(sp.payload instanceof Uint8Array)) {
      fail('SPLT', 'KTX2 splat payload must be a Uint8Array');
    }
  }

  if (!Array.isArray(map.props) || map.props.length > MAP_MAX_PROPS) fail('PROP', `props must list 0..${MAP_MAX_PROPS} entries`);
  for (let i = 0; i < map.props.length; i++) {
    const p = map.props[i]!;
    checkText('PROP', `props[${i}].id`, p.id, MAP_MAX_PROP_ID_BYTES);
    if (!PROP_ID_RE.test(p.id)) fail('PROP', `props[${i}].id '${p.id}' is not a namespace id like 'core:rock_01'`);
    checkInt('PROP', `props[${i}].x`, p.x, 0, maxCoord);
    checkInt('PROP', `props[${i}].z`, p.z, 0, maxCoord);
    checkInt('PROP', `props[${i}].yaw`, p.yaw, 0, 0xffff);
    checkInt('PROP', `props[${i}].scalePermille`, p.scalePermille, 1, 0xffff);
  }

  validatePropFields(map);

  const pv = map.preview;
  if (pv !== null) {
    const w = checkInt('PREV', 'preview width', pv.width, 1, MAP_MAX_PREVIEW_SIZE);
    const h = checkInt('PREV', 'preview height', pv.height, 1, MAP_MAX_PREVIEW_SIZE);
    if (!(pv.rgba instanceof Uint8Array) || pv.rgba.length !== w * h * 4) fail('PREV', `preview must hold ${w}×${h} RGBA8 texels`);
  }

  for (let i = 0; i < map.unknownChunks.length; i++) {
    const u = map.unknownChunks[i]!;
    if (!isFourCC(u.id)) fail(null, `unknown chunk ${i} has an invalid id`);
    if (knownIndex(u.id) >= 0) fail(null, `unknown chunk ${i} uses the known id '${u.id}'`);
    if (u.after !== null && knownIndex(u.after) < 0) fail(null, `unknown chunk ${i} anchors to '${u.after}', not a known chunk`);
    if (!(u.data instanceof Uint8Array)) fail(null, `unknown chunk ${i} data must be a Uint8Array`);
  }
}

function knownIndex(id: string): number {
  for (let i = 0; i < RTSMAP_CHUNK_ORDER.length; i++) if (RTSMAP_CHUNK_ORDER[i] === id) return i;
  return -1;
}

// ---------------------------------------------------------------------------------------------
// META (canonical JSON)

function rgbJson(c: Rgb): string {
  return `[${c[0]},${c[1]},${c[2]}]`;
}

/** Canonical META JSON: fixed key order, no whitespace, integers only. */
export function metaToCanonicalJson(m: MapMeta): string {
  let s = `{"v":${m.v},"name":${JSON.stringify(m.name)},"sizeWu":${m.sizeWu},"heightScaleRaw":${m.heightScaleRaw}`;
  s += `,"waterLevelRaw":${m.waterLevelRaw === null ? 'null' : String(m.waterLevelRaw)},"starts":[`;
  for (let i = 0; i < m.starts.length; i++) {
    const st = m.starts[i]!;
    s += `${i > 0 ? ',' : ''}{"army":${st.army},"x":${st.x},"z":${st.z}}`;
  }
  s += '],"spots":[';
  for (let i = 0; i < m.spots.length; i++) {
    const sp = m.spots[i]!;
    s += `${i > 0 ? ',' : ''}{"kind":"${sp.kind}","x":${sp.x},"z":${sp.z}}`;
  }
  const l = m.light;
  s += `],"light":{"azimuthDeg":${l.azimuthDeg},"elevationDeg":${l.elevationDeg},"sun":${rgbJson(l.sun)},"ambient":${rgbJson(l.ambient)}},"strata":[`;
  for (let i = 0; i < m.strata.length; i++) {
    const st = m.strata[i]!;
    s += `${i > 0 ? ',' : ''}{"name":${JSON.stringify(st.name)},"color":${rgbJson(st.color)}}`;
  }
  return s + ']}';
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function obj(v: Json | undefined, what: string, keys: readonly string[]): { [k: string]: Json } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('META', `${what} must be an object`);
  const ks = Object.keys(v);
  if (ks.length !== keys.length || ks.some((k, i) => k !== keys[i])) {
    fail('META', `${what} must have exactly the keys ${keys.join(', ')} in this order`);
  }
  return v;
}

function arr(v: Json | undefined, what: string): Json[] {
  if (!Array.isArray(v)) fail('META', `${what} must be an array`);
  return v;
}

function num(v: Json | undefined, what: string): number {
  if (!isInt(v)) fail('META', `${what} must be an integer`);
  return v;
}

function str(v: Json | undefined, what: string): string {
  if (typeof v !== 'string') fail('META', `${what} must be a string`);
  return v;
}

function rgbOf(v: Json | undefined, what: string): Rgb {
  const a = arr(v, what);
  if (a.length !== 3) fail('META', `${what} must be [r, g, b]`);
  return [num(a[0], what), num(a[1], what), num(a[2], what)];
}

function parseMeta(data: Uint8Array, offset: number): MapMeta {
  let json: Json;
  try {
    json = JSON.parse(decodeUtf8(data)) as Json;
  } catch (e) {
    throw new FormatError('bad-json', `META is not UTF-8 JSON (${(e as Error).message})`, 'META', offset);
  }
  const o = obj(json, 'META', ['v', 'name', 'sizeWu', 'heightScaleRaw', 'waterLevelRaw', 'starts', 'spots', 'light', 'strata']);
  const v = num(o['v'], 'v');
  if (v !== RTSMAP_META_VERSION) fail('META', `meta version ${v}, expected ${RTSMAP_META_VERSION}`);
  const water = o['waterLevelRaw'];
  const light = obj(o['light'], 'light', ['azimuthDeg', 'elevationDeg', 'sun', 'ambient']);
  return {
    v: RTSMAP_META_VERSION,
    name: str(o['name'], 'name'),
    sizeWu: num(o['sizeWu'], 'sizeWu'),
    heightScaleRaw: num(o['heightScaleRaw'], 'heightScaleRaw'),
    waterLevelRaw: water === null ? null : num(water, 'waterLevelRaw'),
    starts: arr(o['starts'], 'starts').map((e, i) => {
      const so = obj(e, `starts[${i}]`, ['army', 'x', 'z']);
      return { army: num(so['army'], 'army'), x: num(so['x'], 'x'), z: num(so['z'], 'z') };
    }),
    spots: arr(o['spots'], 'spots').map((e, i) => {
      const so = obj(e, `spots[${i}]`, ['kind', 'x', 'z']);
      const kind = str(so['kind'], 'kind');
      if (kind !== 'mass' && kind !== 'hydro') fail('META', `spots[${i}].kind must be 'mass' or 'hydro'`);
      return { kind, x: num(so['x'], 'x'), z: num(so['z'], 'z') };
    }),
    light: {
      azimuthDeg: num(light['azimuthDeg'], 'light.azimuthDeg'),
      elevationDeg: num(light['elevationDeg'], 'light.elevationDeg'),
      sun: rgbOf(light['sun'], 'light.sun'),
      ambient: rgbOf(light['ambient'], 'light.ambient'),
    },
    strata: arr(o['strata'], 'strata').map((e, i) => {
      const so = obj(e, `strata[${i}]`, ['name', 'color']);
      return { name: str(so['name'], 'name'), color: rgbOf(so['color'], 'color') };
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Binary chunk payloads

function dvOf(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/** 'HGT ' payload: u16 dim | u16 reserved | dim² u16 LE. */
export function encodeHeightsChunk(sizeWu: number, heights: Uint16Array): Uint8Array {
  const dim = sizeWu + 1;
  const out = new Uint8Array(4 + dim * dim * 2);
  const dv = dvOf(out);
  dv.setUint16(0, dim, true);
  dv.setUint16(2, 0, true);
  for (let i = 0, p = 4; i < heights.length; i++, p += 2) dv.setUint16(p, heights[i]!, true);
  return out;
}

function decodeHeights(data: Uint8Array, sizeWu: number, offset: number): Uint16Array {
  const dim = sizeWu + 1;
  if (data.length < 4) throw new FormatError('bad-length', 'HGT header needs 4 bytes', 'HGT ', offset);
  const dv = dvOf(data);
  if (dv.getUint16(0, true) !== dim) fail('HGT ', `dim ${dv.getUint16(0, true)} does not match sizeWu + 1 = ${dim}`);
  if (dv.getUint16(2, true) !== 0) throw new FormatError('bad-reserved', 'HGT reserved field must be 0', 'HGT ', offset + 2);
  if (data.length !== 4 + dim * dim * 2) {
    throw new FormatError('bad-length', `HGT has ${data.length} bytes, expected ${4 + dim * dim * 2}`, 'HGT ', offset);
  }
  const h = new Uint16Array(dim * dim);
  for (let i = 0, p = 4; i < h.length; i++, p += 2) h[i] = dv.getUint16(p, true);
  return h;
}

function encodeSplat(sp: MapSplat): Uint8Array {
  const body = sp.codec === 0 ? sp.planes.reduce((n, pl) => n + pl.length, 0) : sp.payload.length;
  const out = new Uint8Array(4 + body);
  const dv = dvOf(out);
  dv.setUint8(0, sp.codec);
  dv.setUint8(1, sp.layers);
  dv.setUint16(2, sp.resolution, true);
  if (sp.codec === 0) {
    let p = 4;
    for (const pl of sp.planes) {
      out.set(pl, p);
      p += pl.length;
    }
  } else {
    out.set(sp.payload, 4);
  }
  return out;
}

function decodeSplat(data: Uint8Array, offset: number): MapSplat {
  if (data.length < 4) throw new FormatError('bad-length', 'SPLT header needs 4 bytes', 'SPLT', offset);
  const dv = dvOf(data);
  const codec = dv.getUint8(0);
  const layers = dv.getUint8(1);
  const resolution = dv.getUint16(2, true);
  if (layers !== 4 && layers !== 8) fail('SPLT', `splat layers must be 4 or 8, got ${layers}`);
  if (resolution < 1) fail('SPLT', 'splat resolution must be >= 1');
  if (codec === 0) {
    const planeBytes = resolution * resolution * 4;
    const n = layers >> 2;
    if (data.length !== 4 + n * planeBytes) {
      throw new FormatError('bad-length', `SPLT has ${data.length} bytes, expected ${4 + n * planeBytes}`, 'SPLT', offset);
    }
    const planes: Uint8Array[] = [];
    for (let i = 0; i < n; i++) planes.push(data.slice(4 + i * planeBytes, 4 + (i + 1) * planeBytes));
    return { codec: 0, layers, resolution, planes };
  }
  if (codec === 1) return { codec: 1, layers, resolution, payload: data.slice(4) };
  return fail('SPLT', `unknown splat codec ${codec}`);
}

/** PROP payload (also hashed verbatim by mapSimHash). */
export function encodePropsChunk(props: readonly MapProp[]): Uint8Array {
  const ids = props.map((p) => encodeUtf8(p.id));
  let n = 4;
  for (const id of ids) n += ((2 + id.length + 3) & ~3) + 12;
  const out = new Uint8Array(n);
  const dv = dvOf(out);
  dv.setUint32(0, props.length, true);
  let p = 4;
  for (let i = 0; i < props.length; i++) {
    const pr = props[i]!;
    const id = ids[i]!;
    dv.setUint16(p, id.length, true);
    out.set(id, p + 2);
    p = (p + 2 + id.length + 3) & ~3;
    dv.setInt32(p, pr.x, true);
    dv.setInt32(p + 4, pr.z, true);
    dv.setUint16(p + 8, pr.yaw, true);
    dv.setUint16(p + 10, pr.scalePermille, true);
    p += 12;
  }
  return out;
}

function decodeProps(data: Uint8Array, offset: number): MapProp[] {
  const bad = (detail: string, at: number): never => {
    throw new FormatError('bad-length', detail, 'PROP', offset + at);
  };
  if (data.length < 4) bad('PROP header needs 4 bytes', 0);
  const dv = dvOf(data);
  const count = dv.getUint32(0, true);
  if (count > MAP_MAX_PROPS) fail('PROP', `prop count ${count} exceeds ${MAP_MAX_PROPS}`);
  const props: MapProp[] = [];
  let p = 4;
  for (let i = 0; i < count; i++) {
    if (p + 2 > data.length) bad(`prop ${i} runs past the chunk end`, p);
    const idLen = dv.getUint16(p, true);
    const idEnd = p + 2 + idLen;
    const fields = (idEnd + 3) & ~3;
    if (fields + 12 > data.length) bad(`prop ${i} runs past the chunk end`, p);
    for (let k = idEnd; k < fields; k++) {
      if (data[k] !== 0) throw new FormatError('bad-padding', `prop ${i} id padding must be 0`, 'PROP', offset + k);
    }
    let id: string;
    try {
      id = decodeUtf8(data, p + 2, idLen);
    } catch {
      return fail('PROP', `prop ${i} id is not valid UTF-8`);
    }
    props.push({
      id,
      x: dv.getInt32(fields, true),
      z: dv.getInt32(fields + 4, true),
      yaw: dv.getUint16(fields + 8, true),
      scalePermille: dv.getUint16(fields + 10, true),
    });
    p = fields + 12;
  }
  if (p !== data.length) bad(`${data.length - p} bytes after the last prop`, p);
  return props;
}

function encodePreview(pv: MapPreview): Uint8Array {
  const out = new Uint8Array(4 + pv.rgba.length);
  const dv = dvOf(out);
  dv.setUint16(0, pv.width, true);
  dv.setUint16(2, pv.height, true);
  out.set(pv.rgba, 4);
  return out;
}

function decodePreview(data: Uint8Array, offset: number): MapPreview {
  if (data.length < 4) throw new FormatError('bad-length', 'PREV header needs 4 bytes', 'PREV', offset);
  const dv = dvOf(data);
  const width = dv.getUint16(0, true);
  const height = dv.getUint16(2, true);
  if (data.length !== 4 + width * height * 4) {
    throw new FormatError('bad-length', `PREV has ${data.length} bytes, expected ${4 + width * height * 4}`, 'PREV', offset);
  }
  return { width, height, rgba: data.slice(4) };
}

// ---------------------------------------------------------------------------------------------
// Read / write

/** Parses and validates an .rtsmap file. Throws FormatError. */
export function readRtsMap(bytes: Uint8Array): RtsMap {
  const c = readContainer(bytes, RTSMAP_MAGIC);
  if (c.formatVersion !== RTSMAP_FORMAT_VERSION) {
    throw new FormatError('bad-format-version', `format version ${c.formatVersion}, expected ${RTSMAP_FORMAT_VERSION}`, null, 6);
  }
  let meta: MapMeta | null = null;
  let heights: Uint16Array | null = null;
  let splat: MapSplat | null = null;
  let props: MapProp[] | null = null;
  let propFields: MapPropField[] | undefined;
  let propFieldAlgo = 0;
  let preview: MapPreview | null = null;
  const unknownChunks: UnknownChunk[] = [];
  let last = -1;
  for (const ch of c.chunks) {
    const k = knownIndex(ch.id);
    if (k < 0) {
      unknownChunks.push({ id: ch.id, data: ch.data.slice(), after: last < 0 ? null : RTSMAP_CHUNK_ORDER[last]! });
      continue;
    }
    if (k === last) throw new FormatError('duplicate-chunk', 'chunk occurs twice', ch.id, ch.offset);
    if (k < last) {
      throw new FormatError('chunk-order', `'${ch.id}' must come before '${RTSMAP_CHUNK_ORDER[last]!}'`, ch.id, ch.offset);
    }
    last = k;
    const at = ch.offset + 8;
    switch (ch.id) {
      case 'META':
        meta = parseMeta(ch.data, at);
        break;
      case 'HGT ':
        if (meta === null) throw new FormatError('missing-chunk', 'META must precede HGT', 'META', ch.offset);
        checkInt('META', 'sizeWu', meta.sizeWu, MAP_MIN_SIZE_WU, MAP_MAX_SIZE_WU);
        if (!isPowerOfTwo(meta.sizeWu)) fail('META', `sizeWu ${meta.sizeWu} is not a power of two`);
        heights = decodeHeights(ch.data, meta.sizeWu, at);
        break;
      case 'SPLT':
        splat = decodeSplat(ch.data, at);
        break;
      case 'PROP':
        props = decodeProps(ch.data, at);
        break;
      case 'PFLD':
      {
        const pf = decodePropFieldsChunk(ch.data, at);
        propFields = pf.fields;
        propFieldAlgo = pf.algo;
        break;
      }
      default:
        preview = decodePreview(ch.data, at);
        break;
    }
  }
  if (meta === null) throw new FormatError('missing-chunk', 'required chunk META is missing', 'META');
  if (heights === null) throw new FormatError('missing-chunk', "required chunk 'HGT ' is missing", 'HGT ');
  if (props === null) throw new FormatError('missing-chunk', 'required chunk PROP is missing', 'PROP');
  const map: RtsMap =
    propFields === undefined
      ? { meta, heights, splat, props, preview, unknownChunks }
      : { meta, heights, splat, props, propFields, propFieldAlgo, preview, unknownChunks };
  validateRtsMap(map);
  // Canonical META only: guarantees read -> write is byte-identical.
  const canon = encodeUtf8(metaToCanonicalJson(meta));
  const metaChunk = c.chunks.find((ch) => ch.id === 'META')!;
  if (!bytesEqual(canon, metaChunk.data)) {
    throw new FormatError('non-canonical', 'META JSON is not in canonical form (key order, whitespace, escapes)', 'META', metaChunk.offset + 8);
  }
  return map;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Chunks of `map` in write order (known chunks in fixed order, unknown ones after their anchor). */
export function rtsMapChunks(map: RtsMap): ContainerChunk[] {
  const known: (ContainerChunk | null)[] = [
    { id: 'META', data: encodeUtf8(metaToCanonicalJson(map.meta)) },
    { id: 'HGT ', data: encodeHeightsChunk(map.meta.sizeWu, map.heights) },
    map.splat === null ? null : { id: 'SPLT', data: encodeSplat(map.splat) },
    { id: 'PROP', data: encodePropsChunk(map.props) },
    map.propFields === undefined ? null : { id: 'PFLD', data: encodePropFieldsChunk(map.propFields, propFieldAlgoOf(map)) },
    map.preview === null ? null : { id: 'PREV', data: encodePreview(map.preview) },
  ];
  // Effective anchor: the chunk it followed, or the nearest present chunk before that one.
  const anchors = map.unknownChunks.map((u) => {
    let a = u.after === null ? -1 : knownIndex(u.after);
    while (a >= 0 && known[a] === null) a--;
    return a;
  });
  const out: ContainerChunk[] = [];
  for (let slot = -1; slot < known.length; slot++) {
    if (slot >= 0) {
      const k = known[slot]!;
      if (k === null) continue;
      out.push(k);
    }
    for (let i = 0; i < map.unknownChunks.length; i++) {
      if (anchors[i] === slot) out.push({ id: map.unknownChunks[i]!.id, data: map.unknownChunks[i]!.data });
    }
  }
  return out;
}

/** Validates and serializes a map. read → write of a canonical file is byte-identical. */
export function writeRtsMap(map: RtsMap): Uint8Array {
  validateRtsMap(map);
  return writeContainer(RTSMAP_MAGIC, RTSMAP_FORMAT_VERSION, rtsMapChunks(map));
}

// ---------------------------------------------------------------------------------------------
// Builder

export interface CreateRtsMapParams {
  readonly sizeWu: number;
  readonly name?: string;
  /** Default 32 (1/128 WU per step). */
  readonly heightScaleRaw?: number;
  /** Default null (no water). */
  readonly waterLevelRaw?: number | null;
  /**
   * Height steps (u16) per sample: an array of dim² values (index z·dim + x) or a function of the
   * integer sample coordinates 0..sizeWu. Default: flat 0.
   */
  readonly heights?: Uint16Array | ((x: number, z: number) => number);
  /** Default: army 0 at (¼, ¼), army 1 at (¾, ¾) of the map. Sorted by army by the builder. */
  readonly starts?: readonly MapStart[];
  readonly spots?: readonly MapSpot[];
  readonly props?: readonly MapProp[];
  /** Default absent (no PFLD chunk). */
  readonly propFields?: readonly MapPropField[];
  /** Expansion algorithm of propFields; default absent (= PROPFIELD_ALGO_VERSION). */
  readonly propFieldAlgo?: number;
  readonly light?: MapLight;
  readonly strata?: readonly MapStratum[];
  readonly splat?: MapSplat | null;
  readonly preview?: MapPreview | null;
  readonly unknownChunks?: readonly UnknownChunk[];
}

/**
 * Validating builder for tests and scenarios (e.g. a flat map or a map from a height function).
 * Throws FormatError('bad-value') on invalid input.
 */
export function createRtsMap(p: CreateRtsMapParams): RtsMap {
  const size = p.sizeWu;
  if (!isInt(size) || size < MAP_MIN_SIZE_WU || size > MAP_MAX_SIZE_WU || !isPowerOfTwo(size)) {
    fail('META', `sizeWu must be a power of two in [${MAP_MIN_SIZE_WU}, ${MAP_MAX_SIZE_WU}], got ${String(size)}`);
  }
  const dim = size + 1;
  let heights: Uint16Array;
  const h = p.heights;
  if (h === undefined) {
    heights = new Uint16Array(dim * dim);
  } else if (h instanceof Uint16Array) {
    heights = h;
  } else {
    heights = new Uint16Array(dim * dim);
    for (let z = 0; z < dim; z++) {
      for (let x = 0; x < dim; x++) {
        const v = h(x, z);
        if (!isInt(v) || v < 0 || v > 0xffff) fail('HGT ', `height function returned ${String(v)} at (${x}, ${z}); expected an integer 0..65535`);
        heights[z * dim + x] = v;
      }
    }
  }
  const q = (size >> 2) * MAP_FX_ONE;
  const starts = (p.starts ?? [
    { army: 0, x: q, z: q },
    { army: 1, x: 3 * q, z: 3 * q },
  ])
    .slice()
    .sort((a, b) => a.army - b.army);
  const base: RtsMap = {
    meta: {
      v: RTSMAP_META_VERSION,
      name: p.name ?? 'untitled',
      sizeWu: size,
      heightScaleRaw: p.heightScaleRaw ?? MAP_MAX_HEIGHT_SCALE_RAW,
      waterLevelRaw: p.waterLevelRaw ?? null,
      starts,
      spots: p.spots ?? [],
      light: p.light ?? DEFAULT_MAP_LIGHT,
      strata: p.strata ?? [],
    },
    heights,
    splat: p.splat ?? null,
    props: p.props ?? [],
    preview: p.preview ?? null,
    unknownChunks: p.unknownChunks ?? [],
  };
  const map: RtsMap =
    p.propFields === undefined
      ? base
      : {
          meta: base.meta,
          heights,
          splat: base.splat,
          props: base.props,
          propFields: p.propFields,
          ...(p.propFieldAlgo === undefined ? {} : { propFieldAlgo: p.propFieldAlgo }),
          preview: base.preview,
          unknownChunks: base.unknownChunks,
        };
  validateRtsMap(map);
  return map;
}

/** META name of the generated flat test plane (`?map=testplane`, scenarios `map({ sizeWu })`). */
export const TEST_PLANE_MAP_NAME = 'testplane';
/** Default edge length of the test plane in WU (the MS1 plane). */
export const TEST_PLANE_SIZE_WU = 512;

/**
 * The flat MS1 test plane as a real map (it runs through the same map pipeline as every other
 * map: sim static area, mapSimHash/simId, client heightmap, renderer terrain): all heights 0, no
 * water, no spots, name {@link TEST_PLANE_MAP_NAME}. Starts keep the MS1 layout relative to the
 * map: army 0 in the centre, army 1 at centre + (7/64, −21/256)·size (512 WU: (256, 256) and
 * (312, 214)). `sizeWu` follows the format rule (power of two in 64..4096).
 */
export function createTestPlaneMap(sizeWu: number = TEST_PLANE_SIZE_WU): RtsMap {
  const half = sizeWu * (MAP_FX_ONE >> 1);
  return createRtsMap({
    sizeWu,
    name: TEST_PLANE_MAP_NAME,
    starts: [
      { army: 0, x: half, z: half },
      { army: 1, x: half + sizeWu * 448, z: half - sizeWu * 336 },
    ],
  });
}

// ---------------------------------------------------------------------------------------------
// Simulation identity

/** ASCII tag that starts the canonical sim bytes (bump the digit if their layout ever changes). */
export const MAP_SIM_HASH_TAG = 'FAFMAPS1';

/**
 * Canonical simulation bytes of a map (all LE):
 *   'FAFMAPS1' | u32 sizeWu | u32 heightScaleRaw | u32 waterFlag (0/1) | i32 waterLevelRaw (0 if none)
 *   | u32 startCount | startCount × (u32 army, i32 x, i32 z)
 *   | u32 spotCount | spotCount × (u32 kind (0 mass, 1 hydro), i32 x, i32 z)
 *   | 'HGT ' payload | PROP payload
 *   [only if propFields is present and non-empty:
 *    'PFLD' | propFieldsSimBytes (PFLD layout incl. the stored u16 algoVersion, without names)]
 * Name, light, strata, SPLT, PREV, prop field names and unknown chunks are presentation-only and
 * excluded. Without prop fields the bytes are exactly those of MS2 (golden hashes unchanged).
 */
export function mapSimBytes(map: RtsMap): Uint8Array {
  const m = map.meta;
  const hgt = encodeHeightsChunk(m.sizeWu, map.heights);
  const prop = encodePropsChunk(map.props);
  const fields = map.propFields;
  const pfld = fields === undefined || fields.length === 0 ? null : propFieldsSimBytes(fields, propFieldAlgoOf(map));
  const head = 8 + 16 + 4 + m.starts.length * 12 + 4 + m.spots.length * 12;
  const out = new Uint8Array(head + hgt.length + prop.length + (pfld === null ? 0 : 4 + pfld.length));
  const dv = dvOf(out);
  for (let i = 0; i < 8; i++) out[i] = MAP_SIM_HASH_TAG.charCodeAt(i);
  let p = 8;
  dv.setUint32(p, m.sizeWu, true);
  dv.setUint32(p + 4, m.heightScaleRaw, true);
  dv.setUint32(p + 8, m.waterLevelRaw === null ? 0 : 1, true);
  dv.setInt32(p + 12, m.waterLevelRaw ?? 0, true);
  dv.setUint32(p + 16, m.starts.length, true);
  p += 20;
  for (const st of m.starts) {
    dv.setUint32(p, st.army, true);
    dv.setInt32(p + 4, st.x, true);
    dv.setInt32(p + 8, st.z, true);
    p += 12;
  }
  dv.setUint32(p, m.spots.length, true);
  p += 4;
  for (const sp of m.spots) {
    dv.setUint32(p, sp.kind === 'mass' ? 0 : 1, true);
    dv.setInt32(p + 4, sp.x, true);
    dv.setInt32(p + 8, sp.z, true);
    p += 12;
  }
  out.set(hgt, p);
  out.set(prop, p + hgt.length);
  if (pfld !== null) {
    const q = p + hgt.length + prop.length;
    for (let i = 0; i < 4; i++) out[q + i] = 'PFLD'.charCodeAt(i);
    out.set(pfld, q + 4);
  }
  return out;
}

/** u32 identity of the simulation-relevant map content (enters simId, PLAN §3.1). xxHash32, seed 0. */
export function mapSimHash(map: RtsMap): number {
  const b = mapSimBytes(map);
  return xxHash32(b, 0, b.length, 0);
}

/**
 * The map as the simulation sees it (input of createWorld). Shares the arrays of `map`. Prop fields
 * are not part of it yet (sim integration of expandPropFields is MS8/E8).
 */
export function mapSimData(map: RtsMap): MapSimData {
  const m = map.meta;
  return {
    sizeWu: m.sizeWu,
    dim: m.sizeWu + 1,
    heightScaleRaw: m.heightScaleRaw,
    waterLevelRaw: m.waterLevelRaw,
    heights: map.heights,
    starts: m.starts,
    spots: m.spots,
    props: map.props,
  };
}
