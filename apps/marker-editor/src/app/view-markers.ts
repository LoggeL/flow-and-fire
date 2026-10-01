/**
 * Adapter EditorStore → ViewMarkers (the input of MarkerOverlay.update). The overlay compares every
 * array by identity and rebuilds only what changed, so the adapter keeps identities stable:
 * - starts / spots / fields / props come straight from the immutable EditorDocument (an edit that
 *   does not touch a list keeps its array);
 * - `expanded` is recomputed only when the field list or the heightfield changed (the store's own
 *   cache is per revision, which would rebuild all prop points on every spot drag);
 * - `issues` keeps the previous array while the validator reports the same content;
 * - empty lists share one frozen array.
 */
import type { ExpandedProp } from '@faf/formats';
import type { EditorDocument } from '../model/document.ts';
import type { EditorIssue, MarkerRef, SymmetryMode } from '../model/types.ts';
import type { DraftField, ViewMarkers } from '../overlay/types.ts';

/** Everything the adapter reads (signal values of the store and the controller's draft). */
export interface ViewMarkersInput {
  readonly doc: EditorDocument | null;
  readonly selection: readonly MarkerRef[];
  readonly hover: MarkerRef | null;
  readonly issues: readonly EditorIssue[];
  readonly symmetry: SymmetryMode;
  readonly draft: DraftField | null;
  /** Expanded props of the current document (store.expandedProps); called only when needed. */
  readonly expand: () => readonly ExpandedProp[];
}

export type ViewMarkersAdapter = (input: ViewMarkersInput) => ViewMarkers | null;

const NO_EXPANDED: readonly ExpandedProp[] = Object.freeze([]);

/** A fresh adapter with its own memo (one per overlay). */
export function createViewMarkersAdapter(): ViewMarkersAdapter {
  let expandedKey: { fields: EditorDocument['fields']; heights: Uint16Array } | null = null;
  let expanded: readonly ExpandedProp[] = NO_EXPANDED;
  let issues: readonly EditorIssue[] = [];

  return (input) => {
    const doc = input.doc;
    if (doc === null) {
      expandedKey = null;
      expanded = NO_EXPANDED;
      return null;
    }
    const heights = doc.source.heights;
    if (expandedKey === null || expandedKey.fields !== doc.fields || expandedKey.heights !== heights) {
      expanded = doc.fields.length === 0 ? NO_EXPANDED : input.expand();
      expandedKey = { fields: doc.fields, heights };
    }
    if (input.issues !== issues && !sameIssues(input.issues, issues)) issues = input.issues;
    return {
      sizeWu: doc.sizeWu,
      starts: doc.starts,
      spots: doc.spots,
      fields: doc.fields,
      props: doc.source.props,
      expanded,
      selection: input.selection,
      hover: input.hover,
      issues,
      symmetry: input.symmetry,
      draft: input.draft,
    };
  };
}

/** Content equality of two issue lists (severity, code, message, position, refs). */
export function sameIssues(a: readonly EditorIssue[], b: readonly EditorIssue[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (p.severity !== q.severity || p.code !== q.code || p.message !== q.message || p.x !== q.x || p.z !== q.z) return false;
    if (p.refs.length !== q.refs.length) return false;
    for (let k = 0; k < p.refs.length; k++) if (!sameMarkerRef(p.refs[k]!, q.refs[k]!)) return false;
  }
  return true;
}

function sameMarkerRef(a: MarkerRef, b: MarkerRef): boolean {
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type !== 'fieldVertex' || (b.type === 'fieldVertex' && a.vertex === b.vertex);
}
