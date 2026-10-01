/**
 * EditorDocument — an immutable snapshot of the map being edited.
 *
 * The editor only changes start positions, resource spots and prop fields. Everything else of the
 * original RtsMap (heights, SPLT, PREV, PROP, unknown chunks and every META field other than
 * starts/spots) is passed through untouched, so `fromBytes(b).toBytes()` is byte-identical for every
 * canonical file, and so is any edit sequence followed by a complete undo.
 *
 * List rules (see ops.ts): starts stay sorted by strictly ascending army (format rule), spots and
 * fields keep their order, new spots/fields are appended, deleting removes, moving keeps the index.
 * `propFields` is present in the output iff the source file had a PFLD chunk or at least one field
 * exists (a file without PFLD stays without it as long as it has no field; deleting the last field of
 * a file that had PFLD leaves an empty array, so the chunk survives the roundtrip).
 */
import {
  MAP_FX_ONE,
  readRtsMap,
  validateRtsMap,
  writeRtsMap,
  type MapPoint,
  type MapPropField,
  type MapSpot,
  type MapStart,
  type RtsMap,
} from '@faf/formats';
import type { MarkerRef } from './types.ts';

export class EditorDocument {
  /** The map the document was opened from (source of every pass-through field). */
  readonly source: RtsMap;
  /** Sorted by strictly ascending army. */
  readonly starts: readonly MapStart[];
  readonly spots: readonly MapSpot[];
  readonly fields: readonly MapPropField[];
  /** True if the source file had a PFLD chunk (then it is always written, also when empty). */
  readonly fieldChunkInSource: boolean;
  private cachedMap: RtsMap | null = null;

  private constructor(source: RtsMap, starts: readonly MapStart[], spots: readonly MapSpot[], fields: readonly MapPropField[], fieldChunkInSource: boolean) {
    this.source = source;
    this.starts = starts;
    this.spots = spots;
    this.fields = fields;
    this.fieldChunkInSource = fieldChunkInSource;
  }

  /** Wraps a map (validated; throws FormatError). */
  static fromMap(map: RtsMap): EditorDocument {
    validateRtsMap(map);
    const doc = new EditorDocument(map, map.meta.starts, map.meta.spots, map.propFields ?? [], map.propFields !== undefined);
    doc.cachedMap = map;
    return doc;
  }

  /** Parses .rtsmap bytes (throws FormatError). */
  static fromBytes(bytes: Uint8Array): EditorDocument {
    return EditorDocument.fromMap(readRtsMap(bytes));
  }

  /** A new snapshot with some of the editable lists replaced (the rest is shared). */
  with(parts: { readonly starts?: readonly MapStart[]; readonly spots?: readonly MapSpot[]; readonly fields?: readonly MapPropField[] }): EditorDocument {
    return new EditorDocument(this.source, parts.starts ?? this.starts, parts.spots ?? this.spots, parts.fields ?? this.fields, this.fieldChunkInSource);
  }

  get sizeWu(): number {
    return this.source.meta.sizeWu;
  }

  /** Edge length S = sizeWu·4096 in Fx raw; valid coordinates are 0..S. */
  get maxRaw(): number {
    return this.source.meta.sizeWu * MAP_FX_ONE;
  }

  get name(): string {
    return this.source.meta.name;
  }

  /** True if the output map carries a PFLD chunk. */
  get hasFieldChunk(): boolean {
    return this.fieldChunkInSource || this.fields.length > 0;
  }

  /** The edited map (cached; shares every untouched part with `source`). Not validated. */
  toRtsMap(): RtsMap {
    if (this.cachedMap !== null) return this.cachedMap;
    const s = this.source;
    const meta = { ...s.meta, starts: this.starts, spots: this.spots };
    const map: RtsMap = this.hasFieldChunk
      ? { meta, heights: s.heights, splat: s.splat, props: s.props, propFields: this.fields, preview: s.preview, unknownChunks: s.unknownChunks }
      : { meta, heights: s.heights, splat: s.splat, props: s.props, preview: s.preview, unknownChunks: s.unknownChunks };
    this.cachedMap = map;
    return map;
  }

  /** Validates and serializes (writeRtsMap; throws FormatError). */
  toBytes(): Uint8Array {
    return writeRtsMap(this.toRtsMap());
  }

  /** True if `ref` points at an existing marker / vertex. */
  has(ref: MarkerRef): boolean {
    switch (ref.type) {
      case 'start':
        return isIndex(ref.index, this.starts.length);
      case 'spot':
        return isIndex(ref.index, this.spots.length);
      case 'field':
        return isIndex(ref.index, this.fields.length);
      case 'fieldRadius':
        return isIndex(ref.index, this.fields.length) && this.fields[ref.index]!.shape.kind === 'circle';
      case 'fieldVertex': {
        if (!isIndex(ref.index, this.fields.length)) return false;
        const sh = this.fields[ref.index]!.shape;
        return sh.kind === 'polygon' && isIndex(ref.vertex, sh.points.length);
      }
    }
  }

  /**
   * Anchor point of a marker in Fx raw: start/spot position, circle centre, polygon vertex 0 (field),
   * the vertex itself (fieldVertex) or the circle's rightmost point (fieldRadius, x + r clamped).
   */
  positionOf(ref: MarkerRef): MapPoint {
    switch (ref.type) {
      case 'start':
        return pick(this.starts, ref.index);
      case 'spot':
        return pick(this.spots, ref.index);
      case 'field': {
        const sh = pick(this.fields, ref.index).shape;
        return sh.kind === 'circle' ? { x: sh.x, z: sh.z } : sh.points[0]!;
      }
      case 'fieldVertex': {
        const sh = pick(this.fields, ref.index).shape;
        if (sh.kind !== 'polygon' || !isIndex(ref.vertex, sh.points.length)) throw new RangeError(`field ${ref.index} has no vertex ${ref.vertex}`);
        return sh.points[ref.vertex]!;
      }
      case 'fieldRadius': {
        const sh = pick(this.fields, ref.index).shape;
        if (sh.kind !== 'circle') throw new RangeError(`field ${ref.index} is not a circle`);
        return { x: Math.min(this.maxRaw, sh.x + sh.r), z: sh.z };
      }
    }
  }

  /** Smallest army 0..15 without a start (−1 if all 16 are used). */
  freeArmy(): number {
    for (let a = 0; a < 16; a++) if (!this.starts.some((s) => s.army === a)) return a;
    return -1;
  }
}

function isIndex(i: number, n: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < n;
}

function pick<T>(list: readonly T[], i: number): T {
  if (!isIndex(i, list.length)) throw new RangeError(`index ${i} out of range (0..${list.length - 1})`);
  return list[i]!;
}

/** Structural equality of two marker refs. */
export function sameRef(a: MarkerRef, b: MarkerRef): boolean {
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type !== 'fieldVertex' || (b.type === 'fieldVertex' && a.vertex === b.vertex);
}
