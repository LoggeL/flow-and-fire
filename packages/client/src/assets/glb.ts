/**
 * Minimal GLB reader for pipeline models (P3): GLB container, accessors (float / normalized int /
 * integer, strided), `KHR_mesh_quantization` (dequantization through the node transforms) and
 * `EXT_meshopt_compression` (buffer views decoded by the meshopt decoder). Output: one render
 * `MeshData` per LOD node (`extras.faf.lod`) in model space, with part ids (`_PARTID`) and the
 * part pivots/parents from `extras.faf.parts` (see tools/assets-pipeline/src/gltf.ts).
 *
 * Runs in the asset worker (no DOM, no WebGL); the render dependency is type-only.
 */
import type { MeshData } from '@faf/render';

/** The subset of meshoptimizer's MeshoptDecoder used here. */
export interface MeshoptDecoderLike {
  readonly supported: boolean;
  readonly ready?: Promise<void>;
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void;
}

export type GlbErrorCode = 'format' | 'unsupported' | 'meshopt-unavailable' | 'meshopt-failed';

export class GlbError extends Error {
  readonly code: GlbErrorCode;
  constructor(code: GlbErrorCode, message: string) {
    super(`GLB: ${message}`);
    this.name = 'GlbError';
    this.code = code;
  }
}

export interface ModelPartInfo {
  readonly name: string;
  readonly parent: number;
  readonly pivot: readonly [number, number, number];
  readonly anim?: string;
}

export interface ParsedModel {
  /** `extras.faf.id` of the scene (logical asset id), or null. */
  readonly id: string | null;
  /** LOD meshes, finest first. */
  readonly lods: MeshData[];
  readonly parts: readonly ModelPartInfo[];
  /** True if the file used EXT_meshopt_compression. */
  readonly meshopt: boolean;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const SUPPORTED_EXTENSIONS = ['EXT_meshopt_compression', 'KHR_mesh_quantization'];
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// glTF JSON is untyped input, validated on access.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

function isObj(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function componentSize(ct: number): number {
  switch (ct) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      throw new GlbError('unsupported', `componentType ${ct}`);
  }
}

function readComponent(dv: DataView, off: number, ct: number, normalized: boolean): number {
  switch (ct) {
    case 5120: {
      const v = dv.getInt8(off);
      return normalized ? Math.max(v / 127, -1) : v;
    }
    case 5121: {
      const v = dv.getUint8(off);
      return normalized ? v / 255 : v;
    }
    case 5122: {
      const v = dv.getInt16(off, true);
      return normalized ? Math.max(v / 32767, -1) : v;
    }
    case 5123: {
      const v = dv.getUint16(off, true);
      return normalized ? v / 65535 : v;
    }
    case 5125:
      return dv.getUint32(off, true);
    default:
      return dv.getFloat32(off, true);
  }
}

/** Column-major 4×4 matrix helpers (float64). */
function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiply(a: readonly number[], b: readonly number[]): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

function localMatrix(node: Record<string, Json>): number[] {
  if (Array.isArray(node.matrix)) {
    if (node.matrix.length !== 16) throw new GlbError('format', 'node.matrix must have 16 entries');
    return node.matrix.map(Number);
  }
  const t = Array.isArray(node.translation) ? node.translation.map(Number) : [0, 0, 0];
  const q = Array.isArray(node.rotation) ? node.rotation.map(Number) : [0, 0, 0, 1];
  const s = Array.isArray(node.scale) ? node.scale.map(Number) : [1, 1, 1];
  const [x, y, z, w] = q as [number, number, number, number];
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
  for (let i = 0; i < 3; i++) {
    r[i] = r[i]! * s[0]!;
    r[4 + i] = r[4 + i]! * s[1]!;
    r[8 + i] = r[8 + i]! * s[2]!;
  }
  r[12] = t[0]!;
  r[13] = t[1]!;
  r[14] = t[2]!;
  return r;
}

/** Inverse-transpose of the upper 3×3 (normal matrix), row-major 9 entries acting like m3. */
function normalMatrix(m: readonly number[]): number[] {
  const a = m[0]!, b = m[4]!, c = m[8]!;
  const d = m[1]!, e = m[5]!, f = m[9]!;
  const g = m[2]!, h = m[6]!, i = m[10]!;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-30) throw new GlbError('format', 'singular node transform');
  const inv = 1 / det;
  // Cofactor matrix / det = inverse transpose.
  return [
    A * inv, B * inv, C * inv,
    -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv,
    (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv,
  ];
}

class GlbReader {
  readonly json: Record<string, Json>;
  private readonly buffers: (Uint8Array | null)[];
  private readonly views = new Map<number, { bytes: Uint8Array; stride: number | undefined }>();
  readonly meshopt: boolean;

  constructor(
    bytes: Uint8Array,
    private readonly decoder: MeshoptDecoderLike | null,
  ) {
    if (bytes.length < 20) throw new GlbError('format', 'file too short');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) !== GLB_MAGIC) throw new GlbError('format', 'bad magic');
    if (dv.getUint32(4, true) !== 2) throw new GlbError('unsupported', `container version ${dv.getUint32(4, true)}`);
    const total = dv.getUint32(8, true);
    if (total > bytes.length) throw new GlbError('format', `length ${total} exceeds ${bytes.length} bytes`);
    let off = 12;
    let json: Record<string, Json> | null = null;
    let bin: Uint8Array | null = null;
    while (off + 8 <= total) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      const start = off + 8;
      if (start + len > total) throw new GlbError('format', 'chunk exceeds the file');
      const data = bytes.subarray(start, start + len);
      if (type === CHUNK_JSON && json === null) {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(data));
        if (!isObj(parsed)) throw new GlbError('format', 'JSON chunk is not an object');
        json = parsed;
      } else if (type === CHUNK_BIN && bin === null) {
        bin = data;
      }
      off = start + ((len + 3) & ~3);
    }
    if (json === null) throw new GlbError('format', 'missing JSON chunk');
    this.json = json;
    const required: unknown[] = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
    for (const e of required) if (!SUPPORTED_EXTENSIONS.includes(String(e))) throw new GlbError('unsupported', `required extension ${String(e)}`);
    const used: unknown[] = Array.isArray(json.extensionsUsed) ? json.extensionsUsed : [];
    this.meshopt = used.includes('EXT_meshopt_compression') || required.includes('EXT_meshopt_compression');
    const bufs: Json[] = Array.isArray(json.buffers) ? json.buffers : [];
    this.buffers = bufs.map((b: Json, i: number) => {
      if (!isObj(b)) throw new GlbError('format', `buffer ${i}`);
      if (b.uri !== undefined) throw new GlbError('unsupported', `external buffer uri in buffer ${i}`);
      if (isObj(b.extensions) && isObj(b.extensions.EXT_meshopt_compression) && b.extensions.EXT_meshopt_compression.fallback === true) return null;
      if (i !== 0 || bin === null) throw new GlbError('format', `buffer ${i} has no data`);
      if (Number(b.byteLength) > bin.length) throw new GlbError('format', `buffer ${i} longer than the BIN chunk`);
      return bin;
    });
  }

  view(index: number): { bytes: Uint8Array; stride: number | undefined } {
    const cached = this.views.get(index);
    if (cached !== undefined) return cached;
    const v = Array.isArray(this.json.bufferViews) ? this.json.bufferViews[index] : undefined;
    if (!isObj(v)) throw new GlbError('format', `bufferView ${index}`);
    const stride = v.byteStride === undefined ? undefined : Number(v.byteStride);
    const ext = isObj(v.extensions) ? v.extensions.EXT_meshopt_compression : undefined;
    let out: { bytes: Uint8Array; stride: number | undefined };
    if (isObj(ext)) {
      const dec = this.decoder;
      if (dec === null || !dec.supported) throw new GlbError('meshopt-unavailable', 'EXT_meshopt_compression needs the meshopt decoder');
      const src = this.buffers[Number(ext.buffer)];
      if (src === null || src === undefined) throw new GlbError('format', `meshopt source buffer ${String(ext.buffer)}`);
      const o = Number(ext.byteOffset ?? 0);
      const len = Number(ext.byteLength);
      const count = Number(ext.count);
      const size = Number(ext.byteStride);
      if (o + len > src.length) throw new GlbError('format', `meshopt view ${index} exceeds its buffer`);
      const target = new Uint8Array(count * size);
      try {
        dec.decodeGltfBuffer(target, count, size, src.subarray(o, o + len), String(ext.mode), ext.filter === undefined ? undefined : String(ext.filter));
      } catch (e) {
        throw new GlbError('meshopt-failed', `view ${index}: ${e instanceof Error ? e.message : String(e)}`);
      }
      out = { bytes: target, stride };
    } else {
      const src = this.buffers[Number(v.buffer)];
      if (src === null || src === undefined) throw new GlbError('format', `bufferView ${index} without data`);
      const o = Number(v.byteOffset ?? 0);
      const len = Number(v.byteLength);
      if (o + len > src.length) throw new GlbError('format', `bufferView ${index} exceeds its buffer`);
      out = { bytes: src.subarray(o, o + len), stride };
    }
    this.views.set(index, out);
    return out;
  }

  /** Accessor as float64 values (normalized ints decoded), `count × comps`. */
  accessor(index: number): { count: number; comps: number; values: Float64Array } {
    const a = Array.isArray(this.json.accessors) ? this.json.accessors[index] : undefined;
    if (!isObj(a)) throw new GlbError('format', `accessor ${index}`);
    if (a.sparse !== undefined) throw new GlbError('unsupported', `sparse accessor ${index}`);
    const comps = COMPONENTS[String(a.type)];
    if (comps === undefined) throw new GlbError('unsupported', `accessor type ${String(a.type)}`);
    const ct = Number(a.componentType);
    const cs = componentSize(ct);
    const count = Number(a.count);
    const values = new Float64Array(count * comps);
    if (a.bufferView === undefined) return { count, comps, values };
    const view = this.view(Number(a.bufferView));
    const stride = view.stride ?? cs * comps;
    const base = Number(a.byteOffset ?? 0);
    const need = count === 0 ? 0 : base + (count - 1) * stride + cs * comps;
    if (need > view.bytes.length) throw new GlbError('format', `accessor ${index} exceeds its view`);
    const dv = new DataView(view.bytes.buffer, view.bytes.byteOffset, view.bytes.byteLength);
    const norm = a.normalized === true;
    for (let i = 0; i < count; i++) {
      const o = base + i * stride;
      for (let c = 0; c < comps; c++) values[i * comps + c] = readComponent(dv, o + c * cs, ct, norm);
    }
    return { count, comps, values };
  }
}

function parseParts(v: unknown): ModelPartInfo[] {
  if (!Array.isArray(v)) return [];
  return v.map((p: unknown, i: number) => {
    if (!isObj(p) || !Array.isArray(p.pivot) || p.pivot.length !== 3) throw new GlbError('format', `extras.faf.parts[${i}]`);
    const parent = Number(p.parent ?? 0);
    if (!Number.isInteger(parent) || parent < 0 || (i > 0 && parent >= i)) throw new GlbError('format', `extras.faf.parts[${i}].parent`);
    return { name: String(p.name ?? `part${i}`), parent, pivot: [Number(p.pivot[0]), Number(p.pivot[1]), Number(p.pivot[2])] as const,
      ...(typeof p.anim === 'string' ? { anim: p.anim } : {}) };
  });
}

/**
 * Parses a pipeline GLB into LOD meshes. `decoder` is required for meshopt-compressed files
 * (throws `GlbError('meshopt-unavailable')` otherwise).
 */
export function parseGlb(bytes: Uint8Array, decoder: MeshoptDecoderLike | null): ParsedModel {
  const r = new GlbReader(bytes, decoder);
  const json = r.json;
  const scenes: Json[] = Array.isArray(json.scenes) ? json.scenes : [];
  const scene = scenes[Number(json.scene ?? 0)];
  if (!isObj(scene)) throw new GlbError('format', 'no scene');
  const faf = isObj(scene.extras) && isObj(scene.extras.faf) ? scene.extras.faf : {};
  const parts = parseParts(faf.parts);
  // Modelkit is +Z forward; yaw-zero Game meshes are +X forward. Rotate geometry,
  // normals and pivots together with a proper rotation (no winding reversal or scale).
  const forwardZ = faf.forward === '+z';
  const orient = (x: number, y: number, z: number): readonly [number, number, number] => forwardZ ? [z, y, -x] : [x, y, z];
  const orientedParts = parts.map(p => ({ ...p, pivot: orient(...p.pivot) }));
  const nodes: Json[] = Array.isArray(json.nodes) ? json.nodes : [];
  const meshes: Json[] = Array.isArray(json.meshes) ? json.meshes : [];
  const lodNodes: { lod: number; mesh: number; world: number[] }[] = [];
  const visit = (ni: number, parent: readonly number[], depth: number): void => {
    if (depth > 64) throw new GlbError('format', 'node hierarchy too deep');
    const n = nodes[ni];
    if (!isObj(n)) throw new GlbError('format', `node ${ni}`);
    const world = multiply(parent, localMatrix(n));
    if (n.mesh !== undefined) {
      const lod = isObj(n.extras) && isObj(n.extras.faf) && Number.isInteger(n.extras.faf.lod) ? Number(n.extras.faf.lod) : lodNodes.length;
      lodNodes.push({ lod, mesh: Number(n.mesh), world });
    }
    if (Array.isArray(n.children)) for (const c of n.children) visit(Number(c), world, depth + 1);
  };
  const roots: unknown[] = Array.isArray(scene.nodes) ? scene.nodes : [];
  for (const ni of roots) visit(Number(ni), identity(), 0);
  lodNodes.sort((a, b) => a.lod - b.lod);
  if (lodNodes.length === 0) throw new GlbError('format', 'no mesh nodes');

  const partPivots = new Float32Array(parts.length * 3);
  const partParents = new Uint8Array(parts.length);
  orientedParts.forEach((p, i) => {
    partPivots.set(p.pivot, i * 3);
    partParents[i] = p.parent;
  });

  const lods: MeshData[] = lodNodes.map(({ mesh, world }) => {
    const m = meshes[mesh];
    if (!isObj(m) || !Array.isArray(m.primitives) || m.primitives.length !== 1) throw new GlbError('format', `mesh ${mesh}: expected one primitive`);
    const prim = m.primitives[0];
    if (!isObj(prim) || !isObj(prim.attributes)) throw new GlbError('format', `mesh ${mesh} primitive`);
    if (prim.mode !== undefined && prim.mode !== 4) throw new GlbError('unsupported', `primitive mode ${String(prim.mode)}`);
    if (prim.attributes.POSITION === undefined || prim.indices === undefined) throw new GlbError('format', `mesh ${mesh}: POSITION and indices required`);
    const pos = r.accessor(Number(prim.attributes.POSITION));
    if (pos.comps !== 3) throw new GlbError('format', 'POSITION must be VEC3');
    const n = pos.count;
    const positions = new Float32Array(n * 3);
    const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = pos.values[i * 3]!;
      const y = pos.values[i * 3 + 1]!;
      const z = pos.values[i * 3 + 2]!;
      const [wx, wy, wz] = orient(world[0]! * x + world[4]! * y + world[8]! * z + world[12]!,
        world[1]! * x + world[5]! * y + world[9]! * z + world[13]!,
        world[2]! * x + world[6]! * y + world[10]! * z + world[14]!);
      positions[i * 3] = wx;
      positions[i * 3 + 1] = wy;
      positions[i * 3 + 2] = wz;
      bounds[0] = Math.min(bounds[0]!, wx);
      bounds[1] = Math.min(bounds[1]!, wy);
      bounds[2] = Math.min(bounds[2]!, wz);
      bounds[3] = Math.max(bounds[3]!, wx);
      bounds[4] = Math.max(bounds[4]!, wy);
      bounds[5] = Math.max(bounds[5]!, wz);
    }
    const normals = new Float32Array(n * 3);
    if (prim.attributes.NORMAL !== undefined) {
      const nrm = r.accessor(Number(prim.attributes.NORMAL));
      if (nrm.count !== n || nrm.comps !== 3) throw new GlbError('format', 'NORMAL must be VEC3 with the vertex count');
      const nm = normalMatrix(world);
      for (let i = 0; i < n; i++) {
        const x = nrm.values[i * 3]!;
        const y = nrm.values[i * 3 + 1]!;
        const z = nrm.values[i * 3 + 2]!;
        const [nx, ny, nz] = orient(nm[0]! * x + nm[1]! * y + nm[2]! * z,
          nm[3]! * x + nm[4]! * y + nm[5]! * z, nm[6]! * x + nm[7]! * y + nm[8]! * z);
        const l = Math.hypot(nx, ny, nz) || 1;
        normals[i * 3] = nx / l;
        normals[i * 3 + 1] = ny / l;
        normals[i * 3 + 2] = nz / l;
      }
    } else {
      for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
    }
    const partIds = new Uint8Array(n);
    if (prim.attributes._PARTID !== undefined) {
      const pid = r.accessor(Number(prim.attributes._PARTID));
      if (pid.count !== n || pid.comps !== 1) throw new GlbError('format', '_PARTID must be SCALAR with the vertex count');
      for (let i = 0; i < n; i++) {
        const v = pid.values[i]!;
        if (!Number.isInteger(v) || v < 0 || v > 255 || (parts.length > 0 && v >= parts.length)) throw new GlbError('format', `_PARTID ${v} out of range`);
        partIds[i] = v;
      }
    }
    const idx = r.accessor(Number(prim.indices));
    let colors: Float32Array | undefined;
    let mask: Uint8Array | undefined;
    let surface: Uint8Array | undefined;
    if (prim.attributes.COLOR_0 !== undefined || prim.attributes._MASK !== undefined) {
      if (prim.attributes.COLOR_0 === undefined || prim.attributes._MASK === undefined) throw new GlbError('format', 'COLOR_0 and _MASK must be paired');
      const col = r.accessor(Number(prim.attributes.COLOR_0)), channels = r.accessor(Number(prim.attributes._MASK));
      if (col.count !== n || col.comps !== 3 || channels.count !== n || channels.comps !== 4) throw new GlbError('format', 'invalid palette attribute sizes');
      colors = new Float32Array(col.values);
      mask = new Uint8Array(channels.values.length);
      for (let i = 0; i < colors.length; i++) if (!Number.isFinite(colors[i]) || colors[i]! < 0 || colors[i]! > 1) throw new GlbError('format', 'palette color out of range');
      for (let i = 0; i < mask.length; i++) {
        const value = channels.values[i]!;
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new GlbError('format', 'palette mask out of range');
        mask[i] = Math.round(value * 255);
      }
    }
    if (prim.attributes._SURFACE !== undefined) {
      const grain = r.accessor(Number(prim.attributes._SURFACE));
      if (grain.count !== n || grain.comps !== 1) throw new GlbError('format', '_SURFACE must be SCALAR with the vertex count');
      surface = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const value = grain.values[i]!;
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new GlbError('format', 'surface weight out of range');
        surface[i] = Math.round(value * 255);
      }
    }
    if (idx.comps !== 1 || idx.count % 3 !== 0) throw new GlbError('format', 'indices must be a triangle list');
    const indices = n <= 65536 ? new Uint16Array(idx.count) : new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i++) {
      const v = idx.values[i]!;
      if (!Number.isInteger(v) || v < 0 || v >= n) throw new GlbError('format', `index ${v} out of range`);
      indices[i] = v;
    }
    const data: MeshData = {
      positions,
      normals,
      partIds,
      ...(colors === undefined ? {} : { colors, mask: mask! }),
      ...(surface === undefined ? {} : { surface }),
      indices,
      vertexCount: n,
      indexCount: idx.count,
      bounds: [bounds[0]!, bounds[1]!, bounds[2]!, bounds[3]!, bounds[4]!, bounds[5]!],
      ...(parts.length > 0 ? { partPivots: partPivots.slice(), partParents: partParents.slice() } : {}),
    };
    return data;
  });
  const id = typeof faf.id === 'string' ? faf.id : null;
  return { id, lods, parts: orientedParts, meshopt: r.meshopt };
}
