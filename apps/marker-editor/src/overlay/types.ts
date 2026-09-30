/**
 * Types of the marker overlay and the picker (TRACK-EDITOR P4). The contract types (MarkerRef,
 * SymmetryMode, EditorIssue, Validator, sameRef) come from the editor model (src/model/types.ts).
 *
 * All coordinates are Fx raw (Q20.12, 1 WU = 4096, integers); conversion to WU happens only at
 * the three.js boundary (overlay geometry, picking).
 */
import type { ExpandedProp, MapPoint, MapProp, MapPropField, MapSpot, MapStart, RtsMap } from '@faf/formats';
import type * as THREE from 'three';

import type { EditorIssue, MarkerRef, SymmetryMode } from '../model/types.ts';

export type { EditorIssue, MarkerRef, SymmetryMode, Validator } from '../model/types.ts';
export { refIn, sameRef } from '../model/types.ts';

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

/** True if field `index` is selected (as a whole or through one of its handles). */
export function fieldSelected(selection: readonly MarkerRef[], index: number): boolean {
  for (const r of selection) {
    if ((r.type === 'field' || r.type === 'fieldVertex' || r.type === 'fieldRadius') && r.index === index) return true;
  }
  return false;
}
