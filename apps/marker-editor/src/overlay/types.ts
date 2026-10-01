/**
 * Types of the marker overlay and the picker (TRACK-EDITOR P4). MarkerRef, SymmetryMode,
 * EditorIssue and Validator are structurally identical to the editor model (P2) and the
 * validation (P3); the overlay does not import those modules, so the types live here.
 *
 * All coordinates are Fx raw (Q20.12, 1 WU = 4096, integers); conversion to WU happens only at
 * the three.js boundary (overlay geometry, picking).
 */
import type { ExpandedProp, MapPoint, MapProp, MapPropField, MapSpot, MapStart, RtsMap } from '@faf/formats';
import type * as THREE from 'three';

export type MarkerRef =
  | { readonly type: 'start'; readonly index: number }
  | { readonly type: 'spot'; readonly index: number }
  | { readonly type: 'field'; readonly index: number }
  | { readonly type: 'fieldVertex'; readonly index: number; readonly vertex: number }
  | { readonly type: 'fieldRadius'; readonly index: number };

export type SymmetryMode = 'none' | 'point' | 'mirrorX' | 'mirrorZ' | 'diagonal' | 'antiDiagonal';

export interface EditorIssue {
  readonly severity: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly message: string;
  /** Fx raw, null = no position (the overlay then uses the first positioned ref). */
  readonly x: number | null;
  readonly z: number | null;
  readonly refs: readonly MarkerRef[];
}

export type Validator = (map: RtsMap) => readonly EditorIssue[];

/** A field being drawn (not yet part of the map). */
export interface DraftField {
  readonly kind: 'circle' | 'polygon';
  /** circle: [centre] or [centre, point on the rim]; polygon: the vertices placed so far. */
  readonly points: readonly MapPoint[];
}

/** Everything the overlay shows; arrays are compared by identity in MarkerOverlay.update(). */
export interface ViewMarkers {
  readonly sizeWu: number;
  readonly starts: readonly MapStart[];
  readonly spots: readonly MapSpot[];
  readonly fields: readonly MapPropField[];
  /** Explicit PROP entries of the map. */
  readonly props: readonly MapProp[];
  /** Props expanded from the fields (expandPropFields). */
  readonly expanded: readonly ExpandedProp[];
  readonly selection: readonly MarkerRef[];
  readonly hover: MarkerRef | null;
  readonly issues: readonly EditorIssue[];
  readonly symmetry: SymmetryMode;
  /** Field being drawn. */
  readonly draft: DraftField | null;
}

export type OverlayLayer = 'starts' | 'spots' | 'fields' | 'props' | 'issues';

/** Rectangle of the canvas in client pixels (DOMRect subset). */
export interface ClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The part of TerrainView (src/view) that overlay and picker use. TerrainView satisfies it
 * structurally; tests pass a WebGL-free stand-in.
 */
export interface OverlayView {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: { getBoundingClientRect(): ClientRect };
  readonly map: RtsMap | null;
  /** Device pixels per CSS pixel (point sizes); absent = 1. */
  readonly renderer?: { getPixelRatio(): number };
  /** Terrain height (WU) at (xWu, zWu). */
  heightWuAt(xWu: number, zWu: number): number;
  requestRender(): void;
  onBeforeRender(cb: () => void): () => void;
}

export function sameRef(a: MarkerRef | null, b: MarkerRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type !== 'fieldVertex' || (b.type === 'fieldVertex' && a.vertex === b.vertex);
}

export function refIn(list: readonly MarkerRef[], ref: MarkerRef): boolean {
  for (const r of list) if (sameRef(r, ref)) return true;
  return false;
}

/** True if field `index` is selected (as a whole or through one of its handles). */
export function fieldSelected(selection: readonly MarkerRef[], index: number): boolean {
  for (const r of selection) {
    if ((r.type === 'field' || r.type === 'fieldVertex' || r.type === 'fieldRadius') && r.index === index) return true;
  }
  return false;
}
