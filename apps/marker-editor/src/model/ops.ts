/**
 * Editor operations as plain data. `applyOp(doc, op)` returns the new document and the exact
 * inverse operation (applying the inverse to the result gives a document that serializes to the
 * same bytes as `doc`). Operations are position-independent data, so a redo simply re-applies the
 * forward operation to the restored state.
 *
 * Invariants checked after every top-level operation (violations throw EditorOpError or the
 * FormatError of @faf/formats, the document stays unchanged):
 *   - coordinates are integers in [0, sizeWu·4096] (Fx raw), 1..16 starts with distinct armies
 *     0..15 sorted ascending, at most 1024 spots, at most 256 fields
 *   - prop fields satisfy validatePropFields (simple polygons, limits, cell and prop budgets), so a
 *     document is always writable with writeRtsMap
 *   - polygons keep >= 3 vertices
 */
import {
  MAP_MAX_ARMIES,
  MAP_MAX_PROP_FIELDS,
  MAP_MAX_SPOTS,
  validatePropFields,
  type MapPoint,
  type MapPropField,
  type MapSpot,
  type MapStart,
  type PropFieldShape,
} from '@faf/formats';
import type { EditorDocument } from './document.ts';
import type { MarkerRef } from './types.ts';

/** Every field property except the shape (shape changes have their own operations). */
export type FieldPatch = Partial<Omit<MapPropField, 'shape'>>;

export type EditorOp =
  /** Inserts a start at its sorted position (army must be free). */
  | { readonly kind: 'addStart'; readonly start: MapStart }
  /** Inserts a spot at `index` (default: append). */
  | { readonly kind: 'addSpot'; readonly spot: MapSpot; readonly index?: number }
  /** Inserts a field at `index` (default: append). */
  | { readonly kind: 'addField'; readonly field: MapPropField; readonly index?: number }
  /**
   * Translates starts, spots, whole fields and single polygon vertices by (dx, dz). A fieldRadius
   * ref counts as its field; a vertex whose field is also listed is moved once (with the field).
   */
  | { readonly kind: 'moveMarkers'; readonly refs: readonly MarkerRef[]; readonly dx: number; readonly dz: number }
  | { readonly kind: 'moveFieldVertex'; readonly field: number; readonly vertex: number; readonly x: number; readonly z: number }
  /** Inserts a vertex after `after` (−1 = before vertex 0). */
  | { readonly kind: 'insertFieldVertex'; readonly field: number; readonly after: number; readonly x: number; readonly z: number }
  | { readonly kind: 'deleteFieldVertex'; readonly field: number; readonly vertex: number }
  | { readonly kind: 'setFieldRadius'; readonly field: number; readonly r: number }
  | { readonly kind: 'updateField'; readonly index: number; readonly patch: FieldPatch }
  /** Sets the army of start `index`; a start that already has `army` gets the old one (swap); re-sorted. */
  | { readonly kind: 'setStartArmy'; readonly index: number; readonly army: number }
  /** Deletes starts, spots and fields (fieldVertex/fieldRadius refs count as their field). */
  | { readonly kind: 'deleteMarkers'; readonly refs: readonly MarkerRef[] }
  | { readonly kind: 'batch'; readonly ops: readonly EditorOp[] };

export interface OpResult {
  readonly doc: EditorDocument;
  readonly inverse: EditorOp;
}

/** An operation that would break a document invariant. */
export class EditorOpError extends Error {
  override readonly name = 'EditorOpError';
}

export const EMPTY_BATCH: EditorOp = { kind: 'batch', ops: [] };

const FIELD_PATCH_KEYS = [
  'name',
  'kind',
  'entries',
  'densityPerKWu2',
  'seed',
  'scaleMinPermille',
  'scaleMaxPermille',
  'maxSlopePermille',
  'dryOnly',
  'reclaimMassMilli',
  'reclaimEnergyMilli',
] as const satisfies readonly (keyof FieldPatch)[];

function fail(msg: string): never {
  throw new EditorOpError(msg);
}

function checkIndex(what: string, i: number, n: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= n) fail(`${what} index ${i} out of range (${n} present)`);
}

function checkCoord(what: string, v: number, max: number): void {
  if (!Number.isInteger(v) || v < 0 || v > max) fail(`${what} = ${v} lies outside the map (0..${max} raw)`);
}

function insertAt<T>(list: readonly T[], index: number, item: T): T[] {
  const out = list.slice();
  out.splice(index, 0, item);
  return out;
}

function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  const out = list.slice();
  out[index] = item;
  return out;
}

function withShape(f: MapPropField, shape: PropFieldShape): MapPropField {
  return { ...f, shape };
}

function polygonOf(doc: EditorDocument, field: number): readonly MapPoint[] {
  checkIndex('field', field, doc.fields.length);
  const sh = doc.fields[field]!.shape;
  if (sh.kind !== 'polygon') fail(`field ${field} is a circle, not a polygon`);
  return sh.points;
}

/** Deduplicated start/spot/field/vertex refs of a move (see EditorOp moveMarkers). */
function normalizeMoveRefs(refs: readonly MarkerRef[]): MarkerRef[] {
  const out: MarkerRef[] = [];
  const has = (r: MarkerRef): boolean =>
    out.some((o) => o.type === r.type && o.index === r.index && (r.type !== 'fieldVertex' || (o.type === 'fieldVertex' && o.vertex === r.vertex)));
  for (const r0 of refs) {
    const r: MarkerRef = r0.type === 'fieldRadius' ? { type: 'field', index: r0.index } : r0;
    if (!has(r)) out.push(r);
  }
  return out.filter((r) => r.type !== 'fieldVertex' || !out.some((o) => o.type === 'field' && o.index === r.index));
}

function translateShape(sh: PropFieldShape, dx: number, dz: number): PropFieldShape {
  if (sh.kind === 'circle') return { kind: 'circle', x: sh.x + dx, z: sh.z + dz, r: sh.r };
  return { kind: 'polygon', points: sh.points.map((p) => ({ x: p.x + dx, z: p.z + dz })) };
}

interface RawResult {
  doc: EditorDocument;
  inverse: EditorOp;
  fieldsTouched: boolean;
}

function applyRaw(doc: EditorDocument, op: EditorOp): RawResult {
  const max = doc.maxRaw;
  switch (op.kind) {
    case 'addStart': {
      const s = op.start;
      if (!Number.isInteger(s.army) || s.army < 0 || s.army >= MAP_MAX_ARMIES) fail(`army ${s.army} is not in 0..${MAP_MAX_ARMIES - 1}`);
      if (doc.starts.some((o) => o.army === s.army)) fail(`army ${s.army} already has a start position`);
      if (doc.starts.length >= MAP_MAX_ARMIES) fail(`a map has at most ${MAP_MAX_ARMIES} start positions`);
      checkCoord('start x', s.x, max);
      checkCoord('start z', s.z, max);
      let at = 0;
      while (at < doc.starts.length && doc.starts[at]!.army < s.army) at++;
      const start: MapStart = { army: s.army, x: s.x, z: s.z };
      return { doc: doc.with({ starts: insertAt(doc.starts, at, start) }), inverse: { kind: 'deleteMarkers', refs: [{ type: 'start', index: at }] }, fieldsTouched: false };
    }
    case 'addSpot': {
      const at = op.index ?? doc.spots.length;
      if (!Number.isInteger(at) || at < 0 || at > doc.spots.length) fail(`spot insert index ${at} out of range`);
      if (doc.spots.length >= MAP_MAX_SPOTS) fail(`a map has at most ${MAP_MAX_SPOTS} spots`);
      const s = op.spot;
      if (s.kind !== 'mass' && s.kind !== 'hydro') fail(`unknown spot kind ${String(s.kind)}`);
      checkCoord('spot x', s.x, max);
      checkCoord('spot z', s.z, max);
      const spot: MapSpot = { kind: s.kind, x: s.x, z: s.z };
      return { doc: doc.with({ spots: insertAt(doc.spots, at, spot) }), inverse: { kind: 'deleteMarkers', refs: [{ type: 'spot', index: at }] }, fieldsTouched: false };
    }
    case 'addField': {
      const at = op.index ?? doc.fields.length;
      if (!Number.isInteger(at) || at < 0 || at > doc.fields.length) fail(`field insert index ${at} out of range`);
      if (doc.fields.length >= MAP_MAX_PROP_FIELDS) fail(`a map has at most ${MAP_MAX_PROP_FIELDS} prop fields`);
      return { doc: doc.with({ fields: insertAt(doc.fields, at, op.field) }), inverse: { kind: 'deleteMarkers', refs: [{ type: 'field', index: at }] }, fieldsTouched: true };
    }
    case 'moveMarkers': {
      const { dx, dz } = op;
      if (!Number.isInteger(dx) || !Number.isInteger(dz)) fail('move delta must be integer Fx raw');
      const refs = normalizeMoveRefs(op.refs);
      let starts = doc.starts;
      let spots = doc.spots;
      let fields = doc.fields;
      let fieldsTouched = false;
      for (const r of refs) {
        switch (r.type) {
          case 'start': {
            checkIndex('start', r.index, starts.length);
            const s = starts[r.index]!;
            checkCoord('start x', s.x + dx, max);
            checkCoord('start z', s.z + dz, max);
            starts = replaceAt(starts, r.index, { army: s.army, x: s.x + dx, z: s.z + dz });
            break;
          }
          case 'spot': {
            checkIndex('spot', r.index, spots.length);
            const s = spots[r.index]!;
            checkCoord('spot x', s.x + dx, max);
            checkCoord('spot z', s.z + dz, max);
            spots = replaceAt(spots, r.index, { kind: s.kind, x: s.x + dx, z: s.z + dz });
            break;
          }
          case 'field': {
            checkIndex('field', r.index, fields.length);
            const f = fields[r.index]!;
            fields = replaceAt(fields, r.index, withShape(f, translateShape(f.shape, dx, dz)));
            fieldsTouched = true;
            break;
          }
          case 'fieldVertex': {
            checkIndex('field', r.index, fields.length);
            const f = fields[r.index]!;
            if (f.shape.kind !== 'polygon') fail(`field ${r.index} is a circle, not a polygon`);
            checkIndex(`field ${r.index} vertex`, r.vertex, f.shape.points.length);
            const p = f.shape.points[r.vertex]!;
            fields = replaceAt(fields, r.index, withShape(f, { kind: 'polygon', points: replaceAt(f.shape.points, r.vertex, { x: p.x + dx, z: p.z + dz }) }));
            fieldsTouched = true;
            break;
          }
          case 'fieldRadius':
            break; // normalized to 'field' above
        }
      }
      return { doc: doc.with({ starts, spots, fields }), inverse: { kind: 'moveMarkers', refs, dx: -dx, dz: -dz }, fieldsTouched };
    }
    case 'moveFieldVertex': {
      const pts = polygonOf(doc, op.field);
      checkIndex(`field ${op.field} vertex`, op.vertex, pts.length);
      const prev = pts[op.vertex]!;
      const f = doc.fields[op.field]!;
      const next = withShape(f, { kind: 'polygon', points: replaceAt(pts, op.vertex, { x: op.x, z: op.z }) });
      return {
        doc: doc.with({ fields: replaceAt(doc.fields, op.field, next) }),
        inverse: { kind: 'moveFieldVertex', field: op.field, vertex: op.vertex, x: prev.x, z: prev.z },
        fieldsTouched: true,
      };
    }
    case 'insertFieldVertex': {
      const pts = polygonOf(doc, op.field);
      if (!Number.isInteger(op.after) || op.after < -1 || op.after >= pts.length) fail(`insert position after vertex ${op.after} out of range`);
      const f = doc.fields[op.field]!;
      const next = withShape(f, { kind: 'polygon', points: insertAt(pts, op.after + 1, { x: op.x, z: op.z }) });
      return {
        doc: doc.with({ fields: replaceAt(doc.fields, op.field, next) }),
        inverse: { kind: 'deleteFieldVertex', field: op.field, vertex: op.after + 1 },
        fieldsTouched: true,
      };
    }
    case 'deleteFieldVertex': {
      const pts = polygonOf(doc, op.field);
      checkIndex(`field ${op.field} vertex`, op.vertex, pts.length);
      if (pts.length <= 3) fail(`field ${op.field} needs at least 3 vertices`);
      const prev = pts[op.vertex]!;
      const out = pts.slice();
      out.splice(op.vertex, 1);
      const f = doc.fields[op.field]!;
      return {
        doc: doc.with({ fields: replaceAt(doc.fields, op.field, withShape(f, { kind: 'polygon', points: out })) }),
        inverse: { kind: 'insertFieldVertex', field: op.field, after: op.vertex - 1, x: prev.x, z: prev.z },
        fieldsTouched: true,
      };
    }
    case 'setFieldRadius': {
      checkIndex('field', op.field, doc.fields.length);
      const f = doc.fields[op.field]!;
      const sh = f.shape;
      if (sh.kind !== 'circle') fail(`field ${op.field} is a polygon, not a circle`);
      return {
        doc: doc.with({ fields: replaceAt(doc.fields, op.field, withShape(f, { kind: 'circle', x: sh.x, z: sh.z, r: op.r })) }),
        inverse: { kind: 'setFieldRadius', field: op.field, r: sh.r },
        fieldsTouched: true,
      };
    }
    case 'updateField': {
      checkIndex('field', op.index, doc.fields.length);
      const f = doc.fields[op.index]!;
      const patch = op.patch as Record<string, unknown>;
      const prev: Record<string, unknown> = {};
      const next: Record<string, unknown> = { ...f };
      for (const k of Object.keys(patch)) {
        if (!(FIELD_PATCH_KEYS as readonly string[]).includes(k)) fail(`updateField: '${k}' cannot be patched`);
        const v = patch[k];
        if (v === undefined) continue;
        prev[k] = (f as unknown as Record<string, unknown>)[k];
        next[k] = k === 'entries' ? (v as MapPropField['entries']).map((e) => ({ id: e.id, weight: e.weight })) : v;
      }
      return {
        doc: doc.with({ fields: replaceAt(doc.fields, op.index, next as unknown as MapPropField) }),
        inverse: { kind: 'updateField', index: op.index, patch: prev as FieldPatch },
        fieldsTouched: true,
      };
    }
    case 'setStartArmy': {
      checkIndex('start', op.index, doc.starts.length);
      if (!Number.isInteger(op.army) || op.army < 0 || op.army >= MAP_MAX_ARMIES) fail(`army ${op.army} is not in 0..${MAP_MAX_ARMIES - 1}`);
      const s = doc.starts[op.index]!;
      if (s.army === op.army) return { doc, inverse: EMPTY_BATCH, fieldsTouched: false };
      const old = s.army;
      const swapped = doc.starts.map((o, i) => (i === op.index ? { army: op.army, x: o.x, z: o.z } : o.army === op.army ? { army: old, x: o.x, z: o.z } : o));
      const starts = swapped.slice().sort((a, b) => a.army - b.army);
      const at = starts.findIndex((o) => o.army === op.army);
      return { doc: doc.with({ starts }), inverse: { kind: 'setStartArmy', index: at, army: old }, fieldsTouched: false };
    }
    case 'deleteMarkers': {
      const del = { start: [] as number[], spot: [] as number[], field: [] as number[] };
      for (const r of op.refs) {
        const type = r.type === 'fieldVertex' || r.type === 'fieldRadius' ? 'field' : r.type;
        const n = type === 'start' ? doc.starts.length : type === 'spot' ? doc.spots.length : doc.fields.length;
        checkIndex(type, r.index, n);
        if (!del[type].includes(r.index)) del[type].push(r.index);
      }
      for (const k of ['start', 'spot', 'field'] as const) del[k].sort((a, b) => a - b);
      const keep = <T>(list: readonly T[], gone: readonly number[]): T[] => list.filter((_, i) => !gone.includes(i));
      const inv: EditorOp[] = [];
      for (const i of del.start) inv.push({ kind: 'addStart', start: doc.starts[i]! });
      for (const i of del.spot) inv.push({ kind: 'addSpot', spot: doc.spots[i]!, index: i });
      for (const i of del.field) inv.push({ kind: 'addField', field: doc.fields[i]!, index: i });
      return {
        doc: doc.with({ starts: keep(doc.starts, del.start), spots: keep(doc.spots, del.spot), fields: keep(doc.fields, del.field) }),
        inverse: inv.length === 1 ? inv[0]! : { kind: 'batch', ops: inv },
        fieldsTouched: del.field.length > 0,
      };
    }
    case 'batch': {
      let d = doc;
      let fieldsTouched = false;
      const inv: EditorOp[] = [];
      for (const o of op.ops) {
        const r = applyRaw(d, o);
        d = r.doc;
        fieldsTouched ||= r.fieldsTouched;
        if (!isNoop(r.inverse)) inv.push(r.inverse);
      }
      inv.reverse();
      return { doc: d, inverse: inv.length === 1 ? inv[0]! : { kind: 'batch', ops: inv }, fieldsTouched };
    }
  }
}

/** True for an empty batch (also nested). */
export function isNoop(op: EditorOp): boolean {
  return op.kind === 'batch' && op.ops.every(isNoop);
}

/**
 * Applies `op` and returns the new document with the exact inverse. Throws EditorOpError (or a
 * FormatError from the prop field validation) if the result would break an invariant.
 */
export function applyOp(doc: EditorDocument, op: EditorOp): OpResult {
  const r = applyRaw(doc, op);
  if (r.doc.starts.length < 1) fail('a map needs at least one start position');
  if (r.fieldsTouched && r.doc.fields.length > 0) {
    const m = r.doc.toRtsMap();
    validatePropFields({ meta: m.meta, heights: m.heights, props: m.props, propFields: r.doc.fields });
  }
  return { doc: r.doc, inverse: r.inverse };
}
