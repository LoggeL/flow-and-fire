/**
 * The editor contract (TRACK-EDITOR): marker references, symmetry modes, issues and the validator
 * signature. The ONLY definition — validation, overlay/picking, the app controller and the UI import
 * it from here (no structural copies), so a new marker type or symmetry mode reaches every module.
 * All coordinates are Fx raw (Q20.12, 1 WU = 4096, integers); conversion to WU happens only at the
 * UI/three.js boundary.
 */
import type { RtsMap } from '@faf/formats';

/** Reference to one editable marker (indices into meta.starts / meta.spots / propFields). */
export type MarkerRef =
  | { readonly type: 'start'; readonly index: number }
  | { readonly type: 'spot'; readonly index: number }
  | { readonly type: 'field'; readonly index: number }
  | { readonly type: 'fieldVertex'; readonly index: number; readonly vertex: number }
  | { readonly type: 'fieldRadius'; readonly index: number };

/**
 * Symmetry of the map square [0, S]² (S = sizeWu·4096):
 *   point (S−x, S−z) · mirrorX (S−x, z) · mirrorZ (x, S−z) · diagonal (z, x) · antiDiagonal (S−z, S−x).
 */
export type SymmetryMode = 'none' | 'point' | 'mirrorX' | 'mirrorZ' | 'diagonal' | 'antiDiagonal';

/** A symmetry mode that actually mirrors (everything but 'none'). */
export type MirrorMode = Exclude<SymmetryMode, 'none'>;

/** Every mirror mode in a fixed order (validation's symmetry detection, UI lists). */
export const MIRROR_MODES: readonly MirrorMode[] = ['point', 'mirrorX', 'mirrorZ', 'diagonal', 'antiDiagonal'];

/** Every symmetry mode: 'none' first, then MIRROR_MODES. */
export const SYMMETRY_MODES: readonly SymmetryMode[] = ['none', ...MIRROR_MODES];

/** Structural equality of two marker refs (null equals only null). */
export function sameRef(a: MarkerRef | null, b: MarkerRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type !== 'fieldVertex' || (b.type === 'fieldVertex' && a.vertex === b.vertex);
}

/** True if `list` contains a ref equal to `ref`. */
export function refIn(list: readonly MarkerRef[], ref: MarkerRef): boolean {
  for (const r of list) if (sameRef(r, ref)) return true;
  return false;
}

export interface EditorIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  /** Fx raw position of the issue (null = map-wide). */
  readonly x: number | null;
  readonly z: number | null;
  readonly refs: readonly MarkerRef[];
}

export type Validator = (map: RtsMap) => readonly EditorIssue[];

export type ToolId = 'select' | 'start' | 'mass' | 'hydro' | 'fieldCircle' | 'fieldPolygon' | 'delete';
