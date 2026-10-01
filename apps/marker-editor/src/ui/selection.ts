/**
 * Selection helpers of the properties panel (pure, DOM-free): what the panel edits for a given
 * selection and per-field expansion statistics.
 */
import type { ExpandedProp } from '@faf/formats';
import type { EditorDocument } from '../model/document.ts';
import type { MarkerRef } from '../model/types.ts';

/** What the properties panel shows. */
export type PanelFocus =
  | { readonly kind: 'none' }
  | { readonly kind: 'start'; readonly index: number }
  | { readonly kind: 'spot'; readonly index: number }
  /** A field; `vertex` is set when exactly one polygon vertex of it is selected. */
  | { readonly kind: 'field'; readonly index: number; readonly vertex: number | null }
  | { readonly kind: 'multi'; readonly summary: SelectionSummary };

export interface SelectionSummary {
  readonly objects: number;
  readonly starts: number;
  readonly mass: number;
  readonly hydro: number;
  readonly fields: number;
  /** Selected polygon vertices of fields that are not selected as a whole. */
  readonly vertices: number;
  /** Field indices of the selected fields (ascending). */
  readonly fieldIndices: readonly number[];
}

/** Object key of a ref: a vertex or radius handle belongs to its field. */
function objectKey(r: MarkerRef): string {
  return r.type === 'start' ? `s${r.index}` : r.type === 'spot' ? `p${r.index}` : `f${r.index}`;
}

/** Panel focus of `selection` in `doc` (refs that no longer exist are ignored). */
export function panelFocus(doc: EditorDocument | null, selection: readonly MarkerRef[]): PanelFocus {
  if (doc === null) return { kind: 'none' };
  const sel = selection.filter((r) => doc.has(r));
  if (sel.length === 0) return { kind: 'none' };
  const keys: string[] = [];
  for (const r of sel) {
    const k = objectKey(r);
    if (!keys.includes(k)) keys.push(k);
  }
  const first = sel[0]!;
  if (keys.length === 1) {
    if (first.type === 'start') return { kind: 'start', index: first.index };
    if (first.type === 'spot') return { kind: 'spot', index: first.index };
    const only = sel.length === 1 && first.type === 'fieldVertex' ? first.vertex : null;
    return { kind: 'field', index: first.index, vertex: only };
  }
  return { kind: 'multi', summary: summarizeSelection(doc, sel) };
}

/** Counts per marker type of a (valid) selection. */
export function summarizeSelection(doc: EditorDocument, sel: readonly MarkerRef[]): SelectionSummary {
  const starts: number[] = [];
  const spots: number[] = [];
  const fields: number[] = [];
  const vertexKeys: string[] = [];
  for (const r of sel) {
    if (r.type === 'start') {
      if (!starts.includes(r.index)) starts.push(r.index);
    } else if (r.type === 'spot') {
      if (!spots.includes(r.index)) spots.push(r.index);
    } else if (r.type === 'fieldVertex') {
      const k = `${r.index}:${r.vertex}`;
      if (!vertexKeys.includes(k)) vertexKeys.push(k);
    } else if (!fields.includes(r.index)) {
      fields.push(r.index);
    }
  }
  const vertices = vertexKeys.filter((k) => !fields.includes(Number(k.slice(0, k.indexOf(':'))))).length;
  let mass = 0;
  let hydro = 0;
  for (const i of spots) {
    if (doc.spots[i]!.kind === 'mass') mass++;
    else hydro++;
  }
  const vertexFields: number[] = [];
  for (const k of vertexKeys) {
    const f = Number(k.slice(0, k.indexOf(':')));
    if (!fields.includes(f) && !vertexFields.includes(f)) vertexFields.push(f);
  }
  return {
    objects: starts.length + spots.length + fields.length + vertexFields.length,
    starts: starts.length,
    mass,
    hydro,
    fields: fields.length,
    vertices,
    fieldIndices: fields.slice().sort((a, b) => a - b),
  };
}

export interface FieldStats {
  readonly count: number;
  /** Sum over the expanded props (milli). */
  readonly massMilli: number;
  readonly energyMilli: number;
}

/** Expanded prop count and reclaim sums of the fields in `indices`. */
export function fieldStats(expanded: readonly ExpandedProp[], indices: readonly number[]): FieldStats {
  let count = 0;
  let massMilli = 0;
  let energyMilli = 0;
  for (const p of expanded) {
    if (!indices.includes(p.field)) continue;
    count++;
    massMilli += p.reclaimMassMilli;
    energyMilli += p.reclaimEnergyMilli;
  }
  return { count, massMilli, energyMilli };
}

/** True if `ref` belongs to one of the objects in `selection` (issue rows are highlighted then). */
export function refsIntersect(a: readonly MarkerRef[], b: readonly MarkerRef[]): boolean {
  for (const r of a) {
    const k = objectKey(r);
    if (b.some((o) => objectKey(o) === k)) return true;
  }
  return false;
}
