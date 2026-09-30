/**
 * Symmetry tools, exact in Fx raw integers (S = sizeWu·4096):
 *   point        (x, z) → (S−x, S−z)     point reflection at the map centre
 *   mirrorX      (x, z) → (S−x, z)       reflection at the axis x = S/2
 *   mirrorZ      (x, z) → (x, S−z)       reflection at the axis z = S/2
 *   diagonal     (x, z) → (z, x)         reflection at the diagonal x = z
 *   antiDiagonal (x, z) → (S−z, S−x)     reflection at the anti-diagonal x + z = S
 * Every mapping is an involution and maps [0, S]² onto itself, so a mirrored valid marker is valid.
 *
 * Halves (symmetrize keep 'a' | 'b'), from the sign of an integer axis function f:
 *   point: f = 2x − S, on a tie 2z − S (a = left half, plus the upper part of the centre column)
 *   mirrorX: f = 2x − S · mirrorZ: f = 2z − S · diagonal: f = x − z · antiDiagonal: f = x + z − S
 *   f < 0 ⇒ half 'a', f > 0 ⇒ half 'b', f = 0 ⇒ on the axis (belongs to both halves, never duplicated).
 * Fields use the vertex sum (polygon, scaled by the vertex count) or the centre (circle).
 *
 * Mirrored fields get `seed XOR 0x9e3779b9` (MIRROR_SEED_XOR): the twin must not repeat the exact
 * cell pattern of its original under another name, and the XOR is its own inverse, so mirroring
 * twice gives back the original seed. (The expansion grid is global and not mirrored, so the twin's
 * props are statistically, not point-exactly, symmetric — see docs/status/track-editor-p0.md.)
 */
import type { MapPoint, MapPropField, MapSpot, MapStart, PropFieldShape } from '@faf/formats';
import { MAP_FX_ONE } from '@faf/formats';
import type { EditorDocument } from './document.ts';
import { EMPTY_BATCH, type EditorOp } from './ops.ts';
import type { MarkerRef, SymmetryMode } from './types.ts';

export { MIRROR_MODES, SYMMETRY_MODES } from './types.ts';
/** Seed of a mirrored field = seed XOR this constant (golden-ratio constant, involutive). */
export const MIRROR_SEED_XOR = 0x9e3779b9;

/** Mirror image of (x, z) in Fx raw (mode 'none' = identity). */
export function mirrorPoint(mode: SymmetryMode, sizeWu: number, x: number, z: number): MapPoint {
  const s = sizeWu * MAP_FX_ONE;
  switch (mode) {
    case 'none':
      return { x, z };
    case 'point':
      return { x: s - x, z: s - z };
    case 'mirrorX':
      return { x: s - x, z };
    case 'mirrorZ':
      return { x, z: s - z };
    case 'diagonal':
      return { x: z, z: x };
    case 'antiDiagonal':
      return { x: s - z, z: s - x };
  }
}

/** Linear part of the mirror: the twin of a marker moved by (dx, dz) moves by mirrorDelta. */
export function mirrorDelta(mode: SymmetryMode, dx: number, dz: number): MapPoint {
  switch (mode) {
    case 'none':
      return { x: dx, z: dz };
    case 'point':
      return { x: -dx, z: -dz };
    case 'mirrorX':
      return { x: -dx, z: dz };
    case 'mirrorZ':
      return { x: dx, z: -dz };
    case 'diagonal':
      return { x: dz, z: dx };
    case 'antiDiagonal':
      return { x: -dz, z: -dx };
  }
}

export function mirrorShape(mode: SymmetryMode, sizeWu: number, shape: PropFieldShape): PropFieldShape {
  if (shape.kind === 'circle') {
    const c = mirrorPoint(mode, sizeWu, shape.x, shape.z);
    return { kind: 'circle', x: c.x, z: c.z, r: shape.r };
  }
  return { kind: 'polygon', points: shape.points.map((p) => mirrorPoint(mode, sizeWu, p.x, p.z)) };
}

/** Mirrored field: mirrored shape, seed XOR MIRROR_SEED_XOR, everything else copied. */
export function mirrorField(mode: SymmetryMode, sizeWu: number, f: MapPropField): MapPropField {
  return { ...f, shape: mirrorShape(mode, sizeWu, f.shape), seed: (f.seed ^ MIRROR_SEED_XOR) >>> 0 };
}

/**
 * Half of a point given as coordinate sums of `n` points (n = 1 for a single point):
 * −1 = half 'a', 1 = half 'b', 0 = on the axis (see module header).
 */
export function sideOfSum(mode: SymmetryMode, sizeWu: number, sumX: number, sumZ: number, n: number): -1 | 0 | 1 {
  const ns = n * sizeWu * MAP_FX_ONE;
  let f: number;
  switch (mode) {
    case 'none':
      return 0;
    case 'point':
      f = 2 * sumX - ns;
      if (f === 0) f = 2 * sumZ - ns;
      break;
    case 'mirrorX':
      f = 2 * sumX - ns;
      break;
    case 'mirrorZ':
      f = 2 * sumZ - ns;
      break;
    case 'diagonal':
      f = sumX - sumZ;
      break;
    case 'antiDiagonal':
      f = sumX + sumZ - ns;
      break;
  }
  return f < 0 ? -1 : f > 0 ? 1 : 0;
}

export function sideOfPoint(mode: SymmetryMode, sizeWu: number, x: number, z: number): -1 | 0 | 1 {
  return sideOfSum(mode, sizeWu, x, z, 1);
}

export function sideOfShape(mode: SymmetryMode, sizeWu: number, shape: PropFieldShape): -1 | 0 | 1 {
  if (shape.kind === 'circle') return sideOfPoint(mode, sizeWu, shape.x, shape.z);
  let sx = 0;
  let sz = 0;
  for (const p of shape.points) {
    sx += p.x;
    sz += p.z;
  }
  return sideOfSum(mode, sizeWu, sx, sz, shape.points.length);
}

function samePoint(a: MapPoint, b: MapPoint): boolean {
  return a.x === b.x && a.z === b.z;
}

/** True if `b` equals the mirror image of `a` (polygons: same cycle in either direction). */
export function isMirrorShape(mode: SymmetryMode, sizeWu: number, a: PropFieldShape, b: PropFieldShape): boolean {
  if (a.kind === 'circle') {
    if (b.kind !== 'circle' || a.r !== b.r) return false;
    return samePoint(mirrorPoint(mode, sizeWu, a.x, a.z), b);
  }
  if (b.kind !== 'polygon' || a.points.length !== b.points.length) return false;
  const n = a.points.length;
  const m = a.points.map((p) => mirrorPoint(mode, sizeWu, p.x, p.z));
  for (let start = 0; start < n; start++) {
    if (!samePoint(m[0]!, b.points[start]!)) continue;
    let fwd = true;
    let bwd = true;
    for (let k = 1; k < n && (fwd || bwd); k++) {
      if (fwd && !samePoint(m[k]!, b.points[(start + k) % n]!)) fwd = false;
      if (bwd && !samePoint(m[k]!, b.points[(start - k + n) % n]!)) bwd = false;
    }
    if (fwd || bwd) return true;
  }
  return false;
}

/** Field parameters equal apart from shape, name and seed (a mirror twin may differ in those). */
export function sameFieldParams(a: MapPropField, b: MapPropField): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let i = 0; i < a.entries.length; i++) {
    if (a.entries[i]!.id !== b.entries[i]!.id || a.entries[i]!.weight !== b.entries[i]!.weight) return false;
  }
  return (
    a.kind === b.kind &&
    a.densityPerKWu2 === b.densityPerKWu2 &&
    a.scaleMinPermille === b.scaleMinPermille &&
    a.scaleMaxPermille === b.scaleMaxPermille &&
    a.maxSlopePermille === b.maxSlopePermille &&
    a.dryOnly === b.dryOnly &&
    a.reclaimMassMilli === b.reclaimMassMilli &&
    a.reclaimEnergyMilli === b.reclaimEnergyMilli
  );
}

/**
 * The mirror twin of a marker: the marker exactly at the mirrored coordinates (starts: any start;
 * spots: same kind; fields: same kind and mirrored shape; fieldVertex: the twin field's vertex at the
 * mirrored point; fieldRadius: the twin circle's radius handle). A marker on the axis may be its own
 * twin (the returned ref then equals `ref`). Null if there is none or mode is 'none'.
 */
export function findTwin(doc: EditorDocument, ref: MarkerRef, mode: SymmetryMode): MarkerRef | null {
  if (mode === 'none' || !doc.has(ref)) return null;
  const size = doc.sizeWu;
  switch (ref.type) {
    case 'start': {
      const s = doc.starts[ref.index]!;
      const m = mirrorPoint(mode, size, s.x, s.z);
      const i = doc.starts.findIndex((o) => samePoint(o, m));
      return i < 0 ? null : { type: 'start', index: i };
    }
    case 'spot': {
      const s = doc.spots[ref.index]!;
      const m = mirrorPoint(mode, size, s.x, s.z);
      const i = doc.spots.findIndex((o) => o.kind === s.kind && samePoint(o, m));
      return i < 0 ? null : { type: 'spot', index: i };
    }
    case 'field':
    case 'fieldRadius':
    case 'fieldVertex': {
      const f = doc.fields[ref.index]!;
      const i = doc.fields.findIndex((o) => o.kind === f.kind && isMirrorShape(mode, size, f.shape, o.shape));
      if (i < 0) return null;
      if (ref.type === 'field') return { type: 'field', index: i };
      if (ref.type === 'fieldRadius') return { type: 'fieldRadius', index: i };
      const p = (f.shape as { points: readonly MapPoint[] }).points[ref.vertex]!;
      const m = mirrorPoint(mode, size, p.x, p.z);
      const tw = doc.fields[i]!.shape as { points: readonly MapPoint[] };
      const v = tw.points.findIndex((o) => samePoint(o, m));
      return v < 0 ? null : { type: 'fieldVertex', index: i, vertex: v };
    }
  }
}

/** True if every start, spot and field has a mirror twin (possibly itself) under `mode`. */
export function isSymmetric(doc: EditorDocument, mode: SymmetryMode): boolean {
  if (mode === 'none') return true;
  for (let i = 0; i < doc.starts.length; i++) if (findTwin(doc, { type: 'start', index: i }, mode) === null) return false;
  for (let i = 0; i < doc.spots.length; i++) if (findTwin(doc, { type: 'spot', index: i }, mode) === null) return false;
  for (let i = 0; i < doc.fields.length; i++) if (findTwin(doc, { type: 'field', index: i }, mode) === null) return false;
  return true;
}

function dist2(a: MapPoint, b: MapPoint): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/**
 * One operation (a single undo step) that keeps every marker of half `keep` (plus the markers on
 * the axis) and replaces the other half by their mirror images. Markers of the other half that
 * already are the exact mirror of a kept marker stay untouched (so a symmetric map gives an empty
 * batch); all others are deleted, missing mirrors are appended (starts at their sorted position).
 *
 * Army of a mirrored start: the army of the nearest deleted start of the other half (so with two
 * starts 0 ↔ 1 swap sides), otherwise the smallest free army. Throws later in applyOp if more than
 * 16 starts (or 1024 spots / 256 fields) would result.
 */
export function symmetrizeOp(doc: EditorDocument, mode: SymmetryMode, keep: 'a' | 'b'): EditorOp {
  if (mode === 'none') return EMPTY_BATCH;
  const size = doc.sizeWu;
  const keepSide = keep === 'a' ? -1 : 1;
  const del: MarkerRef[] = [];
  const addStarts: MapStart[] = [];
  const addSpots: MapSpot[] = [];
  const addFields: MapPropField[] = [];

  // Starts.
  const sSide = doc.starts.map((s) => sideOfPoint(mode, size, s.x, s.z));
  const sClaimed = doc.starts.map(() => false);
  const sMissing: MapPoint[] = [];
  doc.starts.forEach((s, i) => {
    if (sSide[i] !== keepSide) return;
    const m = mirrorPoint(mode, size, s.x, s.z);
    const j = doc.starts.findIndex((o, k) => sSide[k] === -keepSide && !sClaimed[k] && samePoint(o, m));
    if (j >= 0) sClaimed[j] = true;
    else sMissing.push(m);
  });
  const deletedStarts: MapStart[] = [];
  doc.starts.forEach((s, i) => {
    if (sSide[i] === -keepSide && !sClaimed[i]) {
      del.push({ type: 'start', index: i });
      deletedStarts.push(s);
    }
  });
  const used = doc.starts.filter((_, i) => !(sSide[i] === -keepSide && !sClaimed[i])).map((s) => s.army);
  const partnerTaken = deletedStarts.map(() => false);
  for (const m of sMissing) {
    let best = -1;
    for (let k = 0; k < deletedStarts.length; k++) {
      if (partnerTaken[k]) continue;
      if (best < 0 || dist2(deletedStarts[k]!, m) < dist2(deletedStarts[best]!, m)) best = k;
    }
    let army: number;
    if (best >= 0) {
      partnerTaken[best] = true;
      army = deletedStarts[best]!.army;
    } else {
      army = 0;
      while (used.includes(army)) army++;
    }
    used.push(army);
    addStarts.push({ army, x: m.x, z: m.z });
  }

  // Spots.
  const pSide = doc.spots.map((s) => sideOfPoint(mode, size, s.x, s.z));
  const pClaimed = doc.spots.map(() => false);
  doc.spots.forEach((s, i) => {
    if (pSide[i] !== keepSide) return;
    const m = mirrorPoint(mode, size, s.x, s.z);
    const j = doc.spots.findIndex((o, k) => pSide[k] === -keepSide && !pClaimed[k] && o.kind === s.kind && samePoint(o, m));
    if (j >= 0) pClaimed[j] = true;
    else addSpots.push({ kind: s.kind, x: m.x, z: m.z });
  });
  doc.spots.forEach((_, i) => {
    if (pSide[i] === -keepSide && !pClaimed[i]) del.push({ type: 'spot', index: i });
  });

  // Fields.
  const fSide = doc.fields.map((f) => sideOfShape(mode, size, f.shape));
  const fClaimed = doc.fields.map(() => false);
  doc.fields.forEach((f, i) => {
    if (fSide[i] !== keepSide) return;
    const j = doc.fields.findIndex((o, k) => fSide[k] === -keepSide && !fClaimed[k] && sameFieldParams(f, o) && isMirrorShape(mode, size, f.shape, o.shape));
    if (j >= 0) fClaimed[j] = true;
    else addFields.push(mirrorField(mode, size, f));
  });
  doc.fields.forEach((_, i) => {
    if (fSide[i] === -keepSide && !fClaimed[i]) del.push({ type: 'field', index: i });
  });

  const ops: EditorOp[] = [];
  if (del.length > 0) ops.push({ kind: 'deleteMarkers', refs: del });
  for (const s of addStarts) ops.push({ kind: 'addStart', start: s });
  for (const s of addSpots) ops.push({ kind: 'addSpot', spot: s });
  for (const f of addFields) ops.push({ kind: 'addField', field: f });
  return ops.length === 0 ? EMPTY_BATCH : { kind: 'batch', ops };
}
