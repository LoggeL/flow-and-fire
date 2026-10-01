/**
 * Shared editor types (TRACK-EDITOR P2). Validation (P3), overlay/picking (P4), the app controller
 * (P5) and the UI (P6) use these (or structurally identical copies). All coordinates are Fx raw
 * (Q20.12, 1 WU = 4096, integers); conversion to WU happens only at the UI/three.js boundary.
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
