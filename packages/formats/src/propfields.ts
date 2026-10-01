/**
 * Prop fields (PFLD chunk of .rtsmap): areas that the map places many props into — trees, rocks,
 * wrecks — described by a shape, a density, a seed and a reclaim value instead of one PROP entry
 * per object. Data format for the prop system (E8, MS8) and the marker editor (M12).
 *
 * PFLD payload (all integers little-endian; "pad4" = zero bytes up to the next multiple of 4,
 * counted from the start of the chunk payload):
 *
 *   u32 fieldCount (0..256)
 *   per field:
 *     u16 nameLen | name (UTF-8, 1..64 bytes, no control characters) | pad4
 *     u8  kind (0 tree, 1 rock, 2 wreck) | u8 shapeKind (0 circle, 1 polygon)
 *     u16 flags (bit 0 = dryOnly, all other bits 0)
 *     u32 seed
 *     u16 densityPerKWu2 (1..4096) | u16 maxSlopePermille (0 = unlimited)
 *     u16 scaleMinPermille (1..65535) | u16 scaleMaxPermille (>= min)
 *     u32 reclaimMassMilli | u32 reclaimEnergyMilli
 *     u16 entryCount (1..16) | u16 pointCount (circle: 0, polygon: 3..64)
 *     entryCount × ( u16 idLen | id (UTF-8 namespace id like PROP) | pad4 | u16 weight (1..65535)
 *                    | u16 reserved (0) )
 *     circle:  i32 x | i32 z | i32 r            (Fx raw; r in [4096, sizeWu·4096])
 *     polygon: pointCount × ( i32 x | i32 z )    (Fx raw; simple polygon, non-zero area)
 *
 * The reader rejects truncation / trailing bytes ('bad-length'), non-zero padding ('bad-padding'),
 * non-zero reserved fields or flag bits ('bad-reserved') and out-of-range enums/counts ('bad-value'),
 * like the PROP reader does. All coordinates lie in [0, sizeWu·4096].
 *
 * mapSimHash: the field list enters the sim bytes as `propFieldsSimBytes` = the PFLD layout above
 * with nameLen 0 and no name bytes (the name is an editor label only).
 *
 * Expansion (PROPFIELD_ALGO_VERSION 1) — integer-only, deterministic, runs in the sim worker (MS8):
 *   cellRaw = isqrt(floor(2^34 / densityPerKWu2))   (32 WU at density 1, 0.5 WU at 4096; one
 *             candidate per cell ⇒ ≈ density props per 1024 WU²)
 *   The grid is global and aligned to (0, 0). Cells (cx, cz) whose rectangle
 *   [cx·cellRaw, (cx+1)·cellRaw) × [cz·cellRaw, (cz+1)·cellRaw) intersects the shape's bounding box
 *   (clamped to the map) are visited row by row (cz ascending, then cx ascending). Per cell:
 *     x = cx·cellRaw + rng32(seed, cz, cx, 1) mod cellRaw
 *     z = cz·cellRaw + rng32(seed, cz, cx, 2) mod cellRaw
 *   The candidate is dropped if it lies outside the map (> sizeWu·4096), outside the shape
 *   (propFieldContains), or — using the nearest height sample (sx, sz) = ((x + 2048) >> 12,
 *   (z + 2048) >> 12) — if dryOnly and the map has water and h·heightScaleRaw <= waterLevelRaw, or
 *   if maxSlopePermille > 0 and slope > maxSlopePermille, where
 *     gx = (h[sx+1] − h[sx−1])·s (central) or 2·(one-sided difference) at the map edge, gz likewise,
 *     slope = floor(isqrt(gx² + gz²)·1000 / 8192)   (per mille; 8192 = 2 samples in Fx raw).
 *   A kept candidate becomes a prop with
 *     entry = weighted pick: r = rng32(seed, cz, cx, 3) mod Σweight, first entry with r < weight
 *             after subtracting the weights of the entries before it
 *     yaw   = rng32(seed, cz, cx, 4) & 0xffff
 *     scalePermille = scaleMin + rng32(seed, cz, cx, 5) mod (scaleMax − scaleMin + 1)
 *   and the field's reclaim values. Fields expand in list order.
 *
 * Bounds that keep validation and expansion cheap: at most MAP_MAX_FIELD_CELLS candidate cells over
 * all fields, and PROP entries + expanded props <= MAP_MAX_PROPS.
 *
 * Determinism contract (PLAN §3.12): integers only (every product < 2^53), no Map/Set state.
 * This module must not import rtsmap.ts (rtsmap.ts imports it; no cycles).
 */

import { isqrt, rng32 } from '@faf/fixed';
import { decodeUtf8, encodeUtf8 } from '@faf/protocol';
import { FormatError } from './errors.ts';
import { MAP_MAX_PROP_ID_BYTES, MAP_MAX_PROPS, PROP_ID_RE, type MapProp } from './mapprop.ts';

export type PropFieldKind = 'tree' | 'rock' | 'wreck';

/** A point in Fx raw map coordinates. */
export interface MapPoint {
  readonly x: number;
  readonly z: number;
}

export type PropFieldShape =
  | { readonly kind: 'circle'; readonly x: number; readonly z: number; readonly r: number }
  | { readonly kind: 'polygon'; readonly points: readonly MapPoint[] };

export interface PropFieldEntry {
  /** Namespace blueprint id like a PROP id ('core:tree_01'). */
  readonly id: string;
  /** Relative pick weight 1..65535. */
  readonly weight: number;
}

export interface MapPropField {
  /** Editor label, 1..64 UTF-8 bytes, no control characters (not part of mapSimHash). */
  readonly name: string;
  readonly kind: PropFieldKind;
  /** circle: r in [4096, sizeWu·4096]; polygon: 3..64 points, simple (not self-intersecting). */
  readonly shape: PropFieldShape;
  /** 1..16 entries. */
  readonly entries: readonly PropFieldEntry[];
  /** Expected props per 1024 WU² (one 32×32 WU chunk), 1..4096. */
  readonly densityPerKWu2: number;
  /** u32. */
  readonly seed: number;
  /** 1..65535, <= scaleMaxPermille. */
  readonly scaleMinPermille: number;
  readonly scaleMaxPermille: number;
  /** 0 = unlimited, else props only where the slope <= value / 1000. */
  readonly maxSlopePermille: number;
  /** true = no props at or below the water level. */
  readonly dryOnly: boolean;
  /** Reclaim value per prop in 1/1000 mass, u32. */
  readonly reclaimMassMilli: number;
  /** Reclaim value per prop in 1/1000 energy, u32. */
  readonly reclaimEnergyMilli: number;
}

/** One prop produced by expanding a field. */
export interface ExpandedProp extends MapProp {
  /** Index of the field in `propFields`. */
  readonly field: number;
  readonly reclaimMassMilli: number;
  readonly reclaimEnergyMilli: number;
}

/** The parts of a map that validation and expansion read (an RtsMap satisfies it). */
export interface PropFieldMapView {
  readonly meta: { readonly sizeWu: number; readonly heightScaleRaw: number; readonly waterLevelRaw: number | null };
  /** dim² u16 height steps, index z·dim + x (dim = sizeWu + 1). */
  readonly heights: Uint16Array;
  readonly props: readonly MapProp[];
  readonly propFields?: readonly MapPropField[];
}

export const MAP_MAX_PROP_FIELDS = 256;
export const MAP_MAX_FIELD_POINTS = 64;
export const MAP_MAX_FIELD_ENTRIES = 16;
export const MAP_MAX_FIELD_DENSITY = 4096;
export const MAP_MAX_FIELD_NAME_BYTES = 64;
/** Version of the expansion algorithm (part of the sim bytes; bump on any change). */
export const PROPFIELD_ALGO_VERSION = 1;
/** Upper bound of candidate cells (bounding box clamped to the map) summed over all fields. */
export const MAP_MAX_FIELD_CELLS = 1 << 21;

const FX_ONE = 4096;
const HALF_SAMPLE = 2048;
/** 2^34: cellRaw² · density ≈ 1024 WU² in Fx raw² (1024 · 4096²). */
const CELL_AREA_NUMERATOR = 17179869184;
/** Distance of a central difference in Fx raw (two samples). */
const SLOPE_DISTANCE = 8192;
/** Fixed bytes of a field after its (padded) name. */
const FIELD_FIXED_BYTES = 28;
const KINDS: readonly PropFieldKind[] = ['tree', 'rock', 'wreck'];
const EMPTY = new Uint8Array(0);

// ---------------------------------------------------------------------------------------------
// Helpers

function fail(detail: string): never {
  throw new FormatError('bad-value', detail, 'PFLD');
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function checkInt(what: string, v: unknown, lo: number, hi: number): number {
  if (!isInt(v) || v < lo || v > hi) fail(`${what} must be an integer in [${lo}, ${hi}], got ${String(v)}`);
  return v;
}

function checkText(what: string, v: unknown, maxBytes: number): string {
  if (typeof v !== 'string' || v.length === 0) fail(`${what} must be a non-empty string`);
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) fail(`${what} contains a control character`);
  }
  let bytes: Uint8Array;
  try {
    bytes = encodeUtf8(v);
  } catch {
    return fail(`${what} is not valid Unicode`);
  }
  if (bytes.length > maxBytes) fail(`${what} is longer than ${maxBytes} UTF-8 bytes`);
  return v;
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function dvOf(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

/** Orientation of (a, b, c): > 0 counter-clockwise, < 0 clockwise, 0 collinear (|coords| < 2^25). */
function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

/** True if c lies within the bounding box of segment ab (use only when a, b, c are collinear). */
function onSegment(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): boolean {
  return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(az, bz) <= cz && cz <= Math.max(az, bz);
}

/** Closed segment intersection (touching and collinear overlap count). */
function segmentsIntersect(p1: MapPoint, p2: MapPoint, p3: MapPoint, p4: MapPoint): boolean {
  const d1 = Math.sign(orient(p3.x, p3.z, p4.x, p4.z, p1.x, p1.z));
  const d2 = Math.sign(orient(p3.x, p3.z, p4.x, p4.z, p2.x, p2.z));
  const d3 = Math.sign(orient(p1.x, p1.z, p2.x, p2.z, p3.x, p3.z));
  const d4 = Math.sign(orient(p1.x, p1.z, p2.x, p2.z, p4.x, p4.z));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  if (d1 === 0 && onSegment(p3.x, p3.z, p4.x, p4.z, p1.x, p1.z)) return true;
  if (d2 === 0 && onSegment(p3.x, p3.z, p4.x, p4.z, p2.x, p2.z)) return true;
  if (d3 === 0 && onSegment(p1.x, p1.z, p2.x, p2.z, p3.x, p3.z)) return true;
  if (d4 === 0 && onSegment(p1.x, p1.z, p2.x, p2.z, p4.x, p4.z)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Geometry

/** Bounding box of a shape in Fx raw (inclusive, not clamped to the map). */
export function propFieldBounds(shape: PropFieldShape): { x0: number; z0: number; x1: number; z1: number } {
  if (shape.kind === 'circle') return { x0: shape.x - shape.r, z0: shape.z - shape.r, x1: shape.x + shape.r, z1: shape.z + shape.r };
  const pts = shape.points;
  let x0 = pts[0]!.x;
  let z0 = pts[0]!.z;
  let x1 = x0;
  let z1 = z0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  }
  return { x0, z0, x1, z1 };
}

/**
 * Integer point-in-shape test. Circle: dx² + dz² <= r². Polygon: crossing number with the half-open
 * rule (an edge counts if exactly one endpoint has z > pz) and an exact cross-product comparison
 * instead of the intersection division. Coordinates must lie within ±2^24 (all products < 2^53).
 */
export function propFieldContains(shape: PropFieldShape, x: number, z: number): boolean {
  if (shape.kind === 'circle') {
    const dx = x - shape.x;
    const dz = z - shape.z;
    return dx * dx + dz * dz <= shape.r * shape.r;
  }
  const pts = shape.points;
  const n = pts.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i]!;
    const b = pts[j]!;
    if (a.z > z !== b.z > z) {
      // x < a.x + (z − a.z)·(b.x − a.x) / (b.z − a.z), multiplied by d = b.z − a.z (sign-aware).
      const d = b.z - a.z;
      const lhs = (x - a.x) * d;
      const rhs = (z - a.z) * (b.x - a.x);
      if (d > 0 ? lhs < rhs : lhs > rhs) inside = !inside;
    }
  }
  return inside;
}

/** Edge length of the expansion grid cell in Fx raw for a density (props per 1024 WU²). */
export function propFieldCellRaw(densityPerKWu2: number): number {
  return isqrt(Math.floor(CELL_AREA_NUMERATOR / densityPerKWu2));
}

interface CellRange {
  readonly cell: number;
  readonly cx0: number;
  readonly cz0: number;
  readonly cx1: number;
  readonly cz1: number;
}

/** Candidate cell range of a valid field (null = the bounding box misses the map). */
function cellRange(f: MapPropField, maxCoord: number): CellRange | null {
  const b = propFieldBounds(f.shape);
  const x0 = Math.max(0, b.x0);
  const z0 = Math.max(0, b.z0);
  const x1 = Math.min(maxCoord, b.x1);
  const z1 = Math.min(maxCoord, b.z1);
  if (x0 > x1 || z0 > z1) return null;
  const cell = propFieldCellRaw(f.densityPerKWu2);
  return { cell, cx0: Math.floor(x0 / cell), cz0: Math.floor(z0 / cell), cx1: Math.floor(x1 / cell), cz1: Math.floor(z1 / cell) };
}

function cellCount(r: CellRange | null): number {
  return r === null ? 0 : (r.cx1 - r.cx0 + 1) * (r.cz1 - r.cz0 + 1);
}

// ---------------------------------------------------------------------------------------------
// Validation

function validateShape(what: string, shape: unknown, maxCoord: number): void {
  if (typeof shape !== 'object' || shape === null) fail(`${what} must be an object`);
  const s = shape as { kind?: unknown };
  if (s.kind === 'circle') {
    const c = shape as { x?: unknown; z?: unknown; r?: unknown };
    checkInt(`${what}.x`, c.x, 0, maxCoord);
    checkInt(`${what}.z`, c.z, 0, maxCoord);
    checkInt(`${what}.r`, c.r, FX_ONE, maxCoord);
    return;
  }
  if (s.kind !== 'polygon') fail(`${what}.kind must be 'circle' or 'polygon'`);
  const pts = (shape as { points?: unknown }).points;
  if (!Array.isArray(pts) || pts.length < 3 || pts.length > MAP_MAX_FIELD_POINTS) {
    fail(`${what}.points must list 3..${MAP_MAX_FIELD_POINTS} points`);
  }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i] as unknown;
    if (typeof p !== 'object' || p === null) fail(`${what}.points[${i}] must be an object`);
    checkInt(`${what}.points[${i}].x`, (p as { x?: unknown }).x, 0, maxCoord);
    checkInt(`${what}.points[${i}].z`, (p as { z?: unknown }).z, 0, maxCoord);
  }
  const P = pts as readonly MapPoint[];
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const a = P[i]!;
    const b = P[(i + 1) % n]!;
    if (a.x === b.x && a.z === b.z) fail(`${what}.points[${i}] repeats the next point`);
    area2 += a.x * b.z - b.x * a.z;
  }
  if (area2 === 0) fail(`${what} has zero area`);
  for (let i = 0; i < n; i++) {
    const a1 = P[i]!;
    const a2 = P[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      const b1 = P[j]!;
      const b2 = P[(j + 1) % n]!;
      if (j === i + 1 || (i === 0 && j === n - 1)) {
        // Adjacent edges share one vertex v; they must not fold back onto each other.
        const v = j === i + 1 ? a2 : a1;
        const a = j === i + 1 ? a1 : a2;
        const b = j === i + 1 ? b2 : b1;
        if (orient(v.x, v.z, a.x, a.z, b.x, b.z) === 0 && (a.x - v.x) * (b.x - v.x) + (a.z - v.z) * (b.z - v.z) > 0) {
          fail(`${what} edges ${i} and ${j} overlap`);
        }
      } else if (segmentsIntersect(a1, a2, b1, b2)) {
        fail(`${what} is not simple: edges ${i} and ${j} intersect`);
      }
    }
  }
}

/** Checks one field's invariants (everything except the global prop/cell budgets). */
function validateField(f: MapPropField, i: number, maxCoord: number): void {
  const w = `propFields[${i}]`;
  if (typeof f !== 'object' || f === null) fail(`${w} must be an object`);
  checkText(`${w}.name`, f.name, MAP_MAX_FIELD_NAME_BYTES);
  if (KINDS.indexOf(f.kind) < 0) fail(`${w}.kind must be 'tree', 'rock' or 'wreck'`);
  validateShape(`${w}.shape`, f.shape, maxCoord);
  const entries = f.entries;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAP_MAX_FIELD_ENTRIES) {
    fail(`${w}.entries must list 1..${MAP_MAX_FIELD_ENTRIES} entries`);
  }
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k]!;
    if (typeof e !== 'object' || e === null) fail(`${w}.entries[${k}] must be an object`);
    checkText(`${w}.entries[${k}].id`, e.id, MAP_MAX_PROP_ID_BYTES);
    if (!PROP_ID_RE.test(e.id)) fail(`${w}.entries[${k}].id '${e.id}' is not a namespace id like 'core:tree_01'`);
    checkInt(`${w}.entries[${k}].weight`, e.weight, 1, 0xffff);
  }
  checkInt(`${w}.densityPerKWu2`, f.densityPerKWu2, 1, MAP_MAX_FIELD_DENSITY);
  checkInt(`${w}.seed`, f.seed, 0, 0xffffffff);
  const lo = checkInt(`${w}.scaleMinPermille`, f.scaleMinPermille, 1, 0xffff);
  checkInt(`${w}.scaleMaxPermille`, f.scaleMaxPermille, lo, 0xffff);
  checkInt(`${w}.maxSlopePermille`, f.maxSlopePermille, 0, 0xffff);
  if (typeof f.dryOnly !== 'boolean') fail(`${w}.dryOnly must be a boolean`);
  checkInt(`${w}.reclaimMassMilli`, f.reclaimMassMilli, 0, 0xffffffff);
  checkInt(`${w}.reclaimEnergyMilli`, f.reclaimEnergyMilli, 0, 0xffffffff);
}

/**
 * Throws FormatError('bad-value', chunk 'PFLD') unless `map.propFields` (if present) satisfies every
 * invariant: per-field limits (see MapPropField), coordinates in [0, sizeWu·4096], simple polygons,
 * at most MAP_MAX_FIELD_CELLS candidate cells in total and props + expanded props <= MAP_MAX_PROPS.
 * Expects the rest of the map (size, heights, props) to be valid already (validateRtsMap order).
 */
export function validatePropFields(map: PropFieldMapView): void {
  const fields = map.propFields;
  if (fields === undefined) return;
  if (!Array.isArray(fields) || fields.length > MAP_MAX_PROP_FIELDS) fail(`propFields must list 0..${MAP_MAX_PROP_FIELDS} fields`);
  const maxCoord = map.meta.sizeWu * FX_ONE;
  let cells = 0;
  for (let i = 0; i < fields.length; i++) {
    validateField(fields[i]!, i, maxCoord);
    cells += cellCount(cellRange(fields[i]!, maxCoord));
  }
  if (cells > MAP_MAX_FIELD_CELLS) fail(`prop fields cover ${cells} candidate cells, at most ${MAP_MAX_FIELD_CELLS} allowed (lower the density or the area)`);
  let budget = MAP_MAX_PROPS - map.props.length;
  for (let i = 0; i < fields.length; i++) {
    const n = scanField(map, fields[i]!, i, null, budget);
    if (n > budget) fail(`props plus expanded prop fields exceed ${MAP_MAX_PROPS} (field ${i} alone would add more than ${budget})`);
    budget -= n;
  }
}

// ---------------------------------------------------------------------------------------------
// Expansion

/**
 * Runs the expansion of one valid field. Pushes the props into `out` (null = count only) and stops
 * as soon as the count exceeds `limit`. Returns the number of props produced.
 */
function scanField(map: PropFieldMapView, f: MapPropField, index: number, out: ExpandedProp[] | null, limit: number): number {
  const size = map.meta.sizeWu;
  const maxCoord = size * FX_ONE;
  const range = cellRange(f, maxCoord);
  if (range === null) return 0;
  const { cell, cx0, cz0, cx1, cz1 } = range;
  const dim = size + 1;
  const h = map.heights;
  const s = map.meta.heightScaleRaw;
  const water = map.meta.waterLevelRaw;
  const checkDry = f.dryOnly && water !== null;
  const waterRaw = water === null ? 0 : water;
  const maxSlope = f.maxSlopePermille;
  const shape = f.shape;
  const entries = f.entries;
  let totalWeight = 0;
  for (let k = 0; k < entries.length; k++) totalWeight += entries[k]!.weight;
  const seed = f.seed;
  const scaleMin = f.scaleMinPermille;
  const scaleSpan = f.scaleMaxPermille - scaleMin + 1;
  let count = 0;
  for (let cz = cz0; cz <= cz1; cz++) {
    const oz = cz * cell;
    for (let cx = cx0; cx <= cx1; cx++) {
      const x = cx * cell + (rng32(seed, cz, cx, 1) % cell);
      const z = oz + (rng32(seed, cz, cx, 2) % cell);
      if (x > maxCoord || z > maxCoord) continue;
      if (!propFieldContains(shape, x, z)) continue;
      if (checkDry || maxSlope > 0) {
        const sx = Math.min(size, (x + HALF_SAMPLE) >> 12);
        const sz = Math.min(size, (z + HALF_SAMPLE) >> 12);
        const i = sz * dim + sx;
        if (checkDry && h[i]! * s <= waterRaw) continue;
        if (maxSlope > 0) {
          const gx = sx === 0 ? (h[i + 1]! - h[i]!) * 2 : sx === size ? (h[i]! - h[i - 1]!) * 2 : h[i + 1]! - h[i - 1]!;
          const gz = sz === 0 ? (h[i + dim]! - h[i]!) * 2 : sz === size ? (h[i]! - h[i - dim]!) * 2 : h[i + dim]! - h[i - dim]!;
          const gxr = gx * s;
          const gzr = gz * s;
          const slope = Math.floor((isqrt(gxr * gxr + gzr * gzr) * 1000) / SLOPE_DISTANCE);
          if (slope > maxSlope) continue;
        }
      }
      count++;
      if (out !== null) {
        let r = rng32(seed, cz, cx, 3) % totalWeight;
        let e = 0;
        while (r >= entries[e]!.weight) {
          r -= entries[e]!.weight;
          e++;
        }
        out.push({
          id: entries[e]!.id,
          x,
          z,
          yaw: rng32(seed, cz, cx, 4) & 0xffff,
          scalePermille: scaleMin + (rng32(seed, cz, cx, 5) % scaleSpan),
          field: index,
          reclaimMassMilli: f.reclaimMassMilli,
          reclaimEnergyMilli: f.reclaimEnergyMilli,
        });
      }
      if (count > limit) return count;
    }
  }
  return count;
}

/**
 * Expands field `index` of `map.propFields` into props (cells row by row: z, then x). Validates the
 * field on its own first (editor use: unsaved fields), including the candidate cell bound.
 */
export function expandPropField(map: PropFieldMapView, index: number): ExpandedProp[] {
  const fields = map.propFields;
  if (fields === undefined || !isInt(index) || index < 0 || index >= fields.length) {
    fail(`prop field index ${String(index)} out of range (${fields === undefined ? 'no prop fields' : `${fields.length} fields`})`);
  }
  const maxCoord = map.meta.sizeWu * FX_ONE;
  const f = fields[index]!;
  validateField(f, index, maxCoord);
  const cells = cellCount(cellRange(f, maxCoord));
  if (cells > MAP_MAX_FIELD_CELLS) fail(`propFields[${index}] covers ${cells} candidate cells, at most ${MAP_MAX_FIELD_CELLS} allowed`);
  const out: ExpandedProp[] = [];
  scanField(map, f, index, out, MAP_MAX_FIELD_CELLS);
  return out;
}

/** Expands every field in list order (empty if the map has no prop fields). */
export function expandPropFields(map: PropFieldMapView): ExpandedProp[] {
  const fields = map.propFields;
  if (fields === undefined) return [];
  const out: ExpandedProp[] = [];
  for (let i = 0; i < fields.length; i++) {
    const part = expandPropField(map, i);
    for (let k = 0; k < part.length; k++) out.push(part[k]!);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Codec

function encodeFields(fields: readonly MapPropField[], withNames: boolean): Uint8Array {
  const names: Uint8Array[] = [];
  const ids: Uint8Array[][] = [];
  let n = 4;
  for (const f of fields) {
    const name = withNames ? encodeUtf8(f.name) : EMPTY;
    names.push(name);
    n = pad4(n + 2 + name.length) + FIELD_FIXED_BYTES;
    const fid: Uint8Array[] = [];
    for (const e of f.entries) {
      const id = encodeUtf8(e.id);
      fid.push(id);
      n = pad4(n + 2 + id.length) + 4;
    }
    ids.push(fid);
    n += f.shape.kind === 'circle' ? 12 : f.shape.points.length * 8;
  }
  const out = new Uint8Array(n);
  const dv = dvOf(out);
  dv.setUint32(0, fields.length, true);
  let p = 4;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    const name = names[i]!;
    dv.setUint16(p, name.length, true);
    out.set(name, p + 2);
    p = pad4(p + 2 + name.length);
    const shape = f.shape;
    dv.setUint8(p, KINDS.indexOf(f.kind));
    dv.setUint8(p + 1, shape.kind === 'circle' ? 0 : 1);
    dv.setUint16(p + 2, f.dryOnly ? 1 : 0, true);
    dv.setUint32(p + 4, f.seed, true);
    dv.setUint16(p + 8, f.densityPerKWu2, true);
    dv.setUint16(p + 10, f.maxSlopePermille, true);
    dv.setUint16(p + 12, f.scaleMinPermille, true);
    dv.setUint16(p + 14, f.scaleMaxPermille, true);
    dv.setUint32(p + 16, f.reclaimMassMilli, true);
    dv.setUint32(p + 20, f.reclaimEnergyMilli, true);
    dv.setUint16(p + 24, f.entries.length, true);
    dv.setUint16(p + 26, shape.kind === 'circle' ? 0 : shape.points.length, true);
    p += FIELD_FIXED_BYTES;
    const fid = ids[i]!;
    for (let k = 0; k < fid.length; k++) {
      const id = fid[k]!;
      dv.setUint16(p, id.length, true);
      out.set(id, p + 2);
      p = pad4(p + 2 + id.length);
      dv.setUint16(p, f.entries[k]!.weight, true);
      dv.setUint16(p + 2, 0, true);
      p += 4;
    }
    if (shape.kind === 'circle') {
      dv.setInt32(p, shape.x, true);
      dv.setInt32(p + 4, shape.z, true);
      dv.setInt32(p + 8, shape.r, true);
      p += 12;
    } else {
      for (const pt of shape.points) {
        dv.setInt32(p, pt.x, true);
        dv.setInt32(p + 4, pt.z, true);
        p += 8;
      }
    }
  }
  return out;
}

/** PFLD payload of valid fields (layout in the module header). */
export function encodePropFieldsChunk(fields: readonly MapPropField[]): Uint8Array {
  return encodeFields(fields, true);
}

/** Simulation bytes of the fields: the PFLD layout with nameLen 0 and no names (see mapSimBytes). */
export function propFieldsSimBytes(fields: readonly MapPropField[]): Uint8Array {
  return encodeFields(fields, false);
}

/**
 * Parses a PFLD payload (structure only; value invariants are checked by validatePropFields).
 * `offset` is the payload's byte offset in the file, used for error positions.
 */
export function decodePropFieldsChunk(data: Uint8Array, offset: number): MapPropField[] {
  const need = (p: number, bytes: number, what: string): void => {
    if (p + bytes > data.length) throw new FormatError('bad-length', `${what} runs past the chunk end`, 'PFLD', offset + p);
  };
  const zeroPad = (from: number, to: number, what: string): void => {
    for (let k = from; k < to; k++) {
      if (data[k] !== 0) throw new FormatError('bad-padding', `${what} padding must be 0`, 'PFLD', offset + k);
    }
  };
  const text = (p: number, len: number, what: string): string => {
    try {
      return decodeUtf8(data, p, len);
    } catch {
      return fail(`${what} is not valid UTF-8`);
    }
  };
  need(0, 4, 'PFLD header');
  const dv = dvOf(data);
  const count = dv.getUint32(0, true);
  if (count > MAP_MAX_PROP_FIELDS) fail(`prop field count ${count} exceeds ${MAP_MAX_PROP_FIELDS}`);
  const fields: MapPropField[] = [];
  let p = 4;
  for (let i = 0; i < count; i++) {
    need(p, 2, `field ${i}`);
    const nameLen = dv.getUint16(p, true);
    const nameEnd = p + 2 + nameLen;
    const q = pad4(nameEnd);
    need(q, FIELD_FIXED_BYTES, `field ${i}`);
    zeroPad(nameEnd, q, `field ${i} name`);
    const name = text(p + 2, nameLen, `field ${i} name`);
    const kindCode = dv.getUint8(q);
    const shapeCode = dv.getUint8(q + 1);
    const flags = dv.getUint16(q + 2, true);
    if (kindCode >= KINDS.length) fail(`field ${i} has unknown kind ${kindCode}`);
    if (shapeCode > 1) fail(`field ${i} has unknown shape kind ${shapeCode}`);
    if ((flags & ~1) !== 0) throw new FormatError('bad-reserved', `field ${i} flags 0x${flags.toString(16)} use reserved bits`, 'PFLD', offset + q + 2);
    const entryCount = dv.getUint16(q + 24, true);
    const pointCount = dv.getUint16(q + 26, true);
    if (entryCount > MAP_MAX_FIELD_ENTRIES) fail(`field ${i} has ${entryCount} entries, at most ${MAP_MAX_FIELD_ENTRIES}`);
    if (shapeCode === 0 && pointCount !== 0) fail(`circle field ${i} must have pointCount 0, got ${pointCount}`);
    if (pointCount > MAP_MAX_FIELD_POINTS) fail(`field ${i} has ${pointCount} points, at most ${MAP_MAX_FIELD_POINTS}`);
    const seed = dv.getUint32(q + 4, true);
    const densityPerKWu2 = dv.getUint16(q + 8, true);
    const maxSlopePermille = dv.getUint16(q + 10, true);
    const scaleMinPermille = dv.getUint16(q + 12, true);
    const scaleMaxPermille = dv.getUint16(q + 14, true);
    const reclaimMassMilli = dv.getUint32(q + 16, true);
    const reclaimEnergyMilli = dv.getUint32(q + 20, true);
    p = q + FIELD_FIXED_BYTES;
    const entries: PropFieldEntry[] = [];
    for (let k = 0; k < entryCount; k++) {
      need(p, 2, `field ${i} entry ${k}`);
      const idLen = dv.getUint16(p, true);
      const idEnd = p + 2 + idLen;
      const r = pad4(idEnd);
      need(r, 4, `field ${i} entry ${k}`);
      zeroPad(idEnd, r, `field ${i} entry ${k} id`);
      const id = text(p + 2, idLen, `field ${i} entry ${k} id`);
      if (dv.getUint16(r + 2, true) !== 0) throw new FormatError('bad-reserved', `field ${i} entry ${k} reserved field must be 0`, 'PFLD', offset + r + 2);
      entries.push({ id, weight: dv.getUint16(r, true) });
      p = r + 4;
    }
    let shape: PropFieldShape;
    if (shapeCode === 0) {
      need(p, 12, `field ${i} circle`);
      shape = { kind: 'circle', x: dv.getInt32(p, true), z: dv.getInt32(p + 4, true), r: dv.getInt32(p + 8, true) };
      p += 12;
    } else {
      need(p, pointCount * 8, `field ${i} polygon`);
      const points: MapPoint[] = [];
      for (let k = 0; k < pointCount; k++, p += 8) points.push({ x: dv.getInt32(p, true), z: dv.getInt32(p + 4, true) });
      shape = { kind: 'polygon', points };
    }
    fields.push({
      name,
      kind: KINDS[kindCode]!,
      shape,
      entries,
      densityPerKWu2,
      seed,
      scaleMinPermille,
      scaleMaxPermille,
      maxSlopePermille,
      dryOnly: (flags & 1) !== 0,
      reclaimMassMilli,
      reclaimEnergyMilli,
    });
  }
  if (p !== data.length) throw new FormatError('bad-length', `${data.length - p} bytes after the last prop field`, 'PFLD', offset + p);
  return fields;
}
