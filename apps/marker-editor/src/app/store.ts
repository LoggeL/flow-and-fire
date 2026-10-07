/**
 * EditorStore — the DOM-free editor state (TRACK-EDITOR P2) on @preact/signals. The app controller
 * (P5) and the UI (P6) read the signals and call the commands; every change of the document goes
 * through the undo history (src/model/history.ts) as an invertible operation.
 *
 * Conventions:
 * - All coordinates are Fx raw (Q20.12). Commands round positions to `snapRaw` (default 2048 =
 *   0.5 WU, 0 = integer raw only) and clamp them to the map [0, sizeWu·4096]; field radii are
 *   clamped to [4096, sizeWu·4096].
 * - With `liveSymmetry` on and `symmetry` != 'none', add / move / delete / vertex / radius / field
 *   updates also apply to the mirror twin (findTwin, exact coordinates) in the same undo step.
 * - An operation that would break a document invariant (format limits, simple polygons, ≥ 1 start,
 *   ≥ 3 vertices …) changes nothing and reports the reason in `status`.
 * - `revision` increments on every document change (open, edit, undo, redo); the validator runs
 *   synchronously on each revision and fills `issues`.
 */
import { batch, computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { rng32 } from '@faf/fixed';
import {
  expandPropFields,
  MAP_FX_ONE,
  type ExpandedProp,
  type MapPoint,
  type MapPropField,
  type PropFieldKind,
  type PropFieldShape,
  type RtsMap,
  type SpotKind,
} from '@faf/formats';
import { EditorDocument } from '../model/document.ts';
import { History } from '../model/history.ts';
import { toEditorOverlayJson, toMarkersJson } from '../model/markers-json.ts';
import type { EditorOp, FieldPatch } from '../model/ops.ts';
import { findTwin, mirrorDelta, mirrorField, mirrorPoint, MIRROR_SEED_XOR, symmetrizeOp } from '../model/symmetry.ts';
import { refIn, sameRef, type EditorIssue, type MarkerRef, type SymmetryMode, type ToolId, type Validator } from '../model/types.ts';

/** Default snap: 0.5 WU. */
export const DEFAULT_SNAP_RAW = 2048;
/** Smallest circle radius of the format (1 WU). */
const MIN_RADIUS_RAW = MAP_FX_ONE;

/** Default entry id and reclaim value per field kind (see docs/status/track-editor-p2.md). */
export const FIELD_KIND_DEFAULTS: Readonly<Record<PropFieldKind, { readonly id: string; readonly reclaimMassMilli: number; readonly reclaimEnergyMilli: number }>> = {
  tree: { id: 'core:tree_01', reclaimMassMilli: 0, reclaimEnergyMilli: 25000 },
  rock: { id: 'core:rock_01', reclaimMassMilli: 10000, reclaimEnergyMilli: 0 },
  wreck: { id: 'core:wreck_01', reclaimMassMilli: 30000, reclaimEnergyMilli: 0 },
};

/** Salt of the default field seed (rng32(revision, fieldIndex, FIELD_SEED_SALT, 0)). */
const FIELD_SEED_SALT = 0x6d6b6564;

/** Default field for `kind` (everything except the shape); the seed comes from the store. */
export function defaultField(kind: PropFieldKind, name: string, seed: number): Omit<MapPropField, 'shape'> {
  const d = FIELD_KIND_DEFAULTS[kind];
  return {
    name,
    kind,
    entries: [{ id: d.id, weight: 1 }],
    densityPerKWu2: 64,
    seed: seed >>> 0,
    scaleMinPermille: 800,
    scaleMaxPermille: 1200,
    maxSlopePermille: 600,
    dryOnly: true,
    reclaimMassMilli: d.reclaimMassMilli,
    reclaimEnergyMilli: d.reclaimEnergyMilli,
  };
}

interface GestureMove {
  /** Anchor position when the gesture's first move started. */
  readonly anchor0: MapPoint;
  accX: number;
  accZ: number;
  readonly refs: readonly MarkerRef[];
  readonly twins: readonly MarkerRef[];
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class EditorStore {
  private readonly docSig = signal<EditorDocument | null>(null);
  private readonly revisionSig = signal(0);
  private readonly fileNameSig = signal<string | null>(null);
  private readonly stateIdSig = signal(0);
  private readonly savedStateIdSig = signal(0);
  private readonly selectionSig = signal<readonly MarkerRef[]>([]);
  private readonly issuesSig = signal<readonly EditorIssue[]>([]);
  private readonly undoDepthSig = signal(0);
  private readonly redoDepthSig = signal(0);

  readonly doc: ReadonlySignal<EditorDocument | null> = this.docSig;
  readonly revision: ReadonlySignal<number> = this.revisionSig;
  readonly fileName: ReadonlySignal<string | null> = this.fileNameSig;
  readonly dirty: ReadonlySignal<boolean> = computed(() => this.docSig.value !== null && this.stateIdSig.value !== this.savedStateIdSig.value);
  readonly tool: Signal<ToolId> = signal<ToolId>('select');
  readonly selection: ReadonlySignal<readonly MarkerRef[]> = this.selectionSig;
  readonly hover: Signal<MarkerRef | null> = signal<MarkerRef | null>(null);
  readonly symmetry: Signal<SymmetryMode> = signal<SymmetryMode>('none');
  readonly liveSymmetry: Signal<boolean> = signal(false);
  /** Snap step in Fx raw (default 2048 = 0.5 WU, 0 = off). */
  readonly snapRaw: Signal<number> = signal(DEFAULT_SNAP_RAW);
  readonly issues: ReadonlySignal<readonly EditorIssue[]> = this.issuesSig;
  readonly canUndo: ReadonlySignal<boolean> = computed(() => this.undoDepthSig.value > 0);
  readonly canRedo: ReadonlySignal<boolean> = computed(() => this.redoDepthSig.value > 0);
  readonly undoDepth: ReadonlySignal<number> = this.undoDepthSig;
  readonly redoDepth: ReadonlySignal<number> = this.redoDepthSig;
  readonly status: Signal<string> = signal('');

  private readonly history: History;
  private validator: Validator | null = null;
  private expandedCache: { revision: number; props: readonly ExpandedProp[] } | null = null;
  private gestureMove: GestureMove | null = null;

  constructor(historyLimit?: number) {
    this.history = new History(historyLimit);
  }

  // -------------------------------------------------------------------------------------------
  // Document lifecycle

  /** Opens .rtsmap bytes (throws FormatError, the store is then unchanged); clears history and selection. */
  open(bytes: Uint8Array, fileName: string): void {
    this.openDocument(EditorDocument.fromBytes(bytes), fileName);
  }

  /** Opens an already parsed map (throws FormatError if invalid). */
  openMap(map: RtsMap, fileName: string): void {
    this.openDocument(EditorDocument.fromMap(map), fileName);
  }

  private openDocument(doc: EditorDocument, fileName: string): void {
    this.history.clear();
    this.gestureMove = null;
    batch(() => {
      this.fileNameSig.value = fileName;
      this.selectionSig.value = [];
      this.hover.value = null;
      this.savedStateIdSig.value = this.history.stateId;
      this.commit(doc);
      this.status.value = `${doc.name} geladen`;
    });
  }

  /** Current document bytes (writeRtsMap; throws if no document is open). */
  exportBytes(): Uint8Array {
    return this.requireDoc().toBytes();
  }

  /** Marks the current state as saved (dirty = false until the next change). */
  markSaved(): void {
    this.savedStateIdSig.value = this.history.stateId;
  }

  /** markers.json text for mapc (throws if no document is open). */
  exportMarkersJson(): string {
    return toMarkersJson(this.requireDoc());
  }

  /** editor.json text (marker overlay for content/maps/src/<name>/; throws if no document is open). */
  exportEditorOverlay(): string {
    return toEditorOverlayJson(this.requireDoc());
  }

  /** All prop fields expanded (cached per revision; empty without a document). */
  expandedProps(): readonly ExpandedProp[] {
    const doc = this.docSig.peek();
    if (doc === null) return [];
    const rev = this.revisionSig.peek();
    if (this.expandedCache === null || this.expandedCache.revision !== rev) {
      this.expandedCache = { revision: rev, props: expandPropFields(doc.toRtsMap()) };
    }
    return this.expandedCache.props;
  }

  /** Installs the validator (null = none) and runs it on the current revision. */
  setValidator(v: Validator | null): void {
    this.validator = v;
    this.runValidator(this.docSig.peek());
  }

  // -------------------------------------------------------------------------------------------
  // Selection

  /** Replaces the selection (additive: adds refs that are not selected yet). Unknown refs are dropped. */
  select(refs: readonly MarkerRef[], additive = false): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const out: MarkerRef[] = additive ? this.selectionSig.peek().slice() : [];
    for (const r of refs) if (doc.has(r) && !refIn(out, r)) out.push(r);
    this.selectionSig.value = out;
  }

  // -------------------------------------------------------------------------------------------
  // Commands

  private get live(): SymmetryMode {
    return this.liveSymmetry.peek() ? this.symmetry.peek() : 'none';
  }

  /** Adds a start with the smallest free army (plus its mirror twin with the next free army). */
  addStart(x: number, z: number): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const p = this.snapPoint(doc, x, z);
    const army = doc.freeArmy();
    if (army < 0) {
      this.status.value = 'Nicht möglich: alle 16 Startpositionen sind belegt';
      return;
    }
    const ops: EditorOp[] = [{ kind: 'addStart', start: { army, x: p.x, z: p.z } }];
    const mode = this.live;
    if (mode !== 'none') {
      const m = mirrorPoint(mode, doc.sizeWu, p.x, p.z);
      if (m.x !== p.x || m.z !== p.z) {
        let a2 = 0;
        while (a2 === army || doc.starts.some((s) => s.army === a2)) a2++;
        ops.push({ kind: 'addStart', start: { army: a2, x: m.x, z: m.z } });
      }
    }
    if (this.run(single(ops), 'Start setzen')) {
      const d = this.requireDoc();
      this.selectionSig.value = [{ type: 'start', index: d.starts.findIndex((s) => s.army === army) }];
      this.status.value = `Start ${army + 1} gesetzt`;
    }
  }

  /** Appends a mass or hydro spot (plus its mirror twin). */
  addSpot(kind: SpotKind, x: number, z: number): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const p = this.snapPoint(doc, x, z);
    const ops: EditorOp[] = [{ kind: 'addSpot', spot: { kind, x: p.x, z: p.z } }];
    const mode = this.live;
    if (mode !== 'none') {
      const m = mirrorPoint(mode, doc.sizeWu, p.x, p.z);
      if (m.x !== p.x || m.z !== p.z) ops.push({ kind: 'addSpot', spot: { kind, x: m.x, z: m.z } });
    }
    const index = doc.spots.length;
    if (this.run(single(ops), kind === 'mass' ? 'Mass-Spot setzen' : 'Hydro-Spot setzen')) {
      this.selectionSig.value = [{ type: 'spot', index }];
      this.status.value = `${kind === 'mass' ? 'Mass' : 'Hydro'}-Spot gesetzt`;
    }
  }

  /**
   * Appends a prop field with `shape` (snapped/clamped) and the default template overridden by
   * `template` (plus its mirror twin with seed XOR MIRROR_SEED_XOR).
   */
  addField(shape: PropFieldShape, template: Partial<Omit<MapPropField, 'shape'>> = {}): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const sh = this.snapShape(doc, shape);
    if (sh === null) {
      this.status.value = 'Nicht möglich: ein Polygon braucht mindestens 3 verschiedene Punkte';
      return;
    }
    const index = doc.fields.length;
    const kind = template.kind ?? 'tree';
    const seed = rng32(this.revisionSig.peek(), index, FIELD_SEED_SALT, 0);
    const base = defaultField(kind, `${kind} ${index + 1}`, seed);
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(template)) if (v !== undefined) merged[k] = v;
    const field = { ...(merged as unknown as Omit<MapPropField, 'shape'>), shape: sh } as MapPropField;
    const ops: EditorOp[] = [{ kind: 'addField', field }];
    const mode = this.live;
    if (mode !== 'none') {
      const tw = mirrorField(mode, doc.sizeWu, field);
      if (!shapesEqual(tw.shape, field.shape)) ops.push({ kind: 'addField', field: tw });
    }
    if (this.run(single(ops), 'Prop-Feld anlegen')) {
      this.selectionSig.value = [{ type: 'field', index }];
      this.status.value = `Prop-Feld „${field.name}“ angelegt`;
    }
  }

  /** Starts a gesture: every change until endGesture() is one undo step. */
  beginGesture(): void {
    this.history.beginGesture();
    this.gestureMove = null;
  }

  /** Ends the gesture started by beginGesture(). */
  endGesture(): void {
    this.history.endGesture();
    if (!this.history.inGesture) this.gestureMove = null;
    this.refreshHistorySignals();
  }

  /**
   * Moves the selection (starts, spots, whole fields, polygon vertices; a radius handle moves its
   * field) by (dx, dz). The first selected marker is the anchor: its target position is snapped, and
   * inside a gesture the deltas accumulate from the gesture start (small mouse steps are not lost to
   * snapping). The delta is clamped so everything stays on the map.
   */
  moveSelectionBy(dx: number, dz: number): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    let g = this.history.inGesture ? this.gestureMove : null;
    if (g === null) {
      const refs = normalizeSelection(doc, this.selectionSig.peek());
      if (refs.length === 0) return;
      const mode = this.live;
      const twins: MarkerRef[] = [];
      if (mode !== 'none') {
        for (const r of refs) {
          const t = findTwin(doc, r, mode);
          if (t === null || refIn(refs, t) || refIn(twins, t)) continue;
          if (t.type === 'fieldVertex' && refs.some((o) => o.type === 'field' && o.index === t.index)) continue;
          twins.push(t);
        }
      }
      g = { anchor0: doc.positionOf(refs[0]!), accX: 0, accZ: 0, refs, twins };
      if (this.history.inGesture) this.gestureMove = g;
    }
    if (!g.refs.every((r) => doc.has(r)) || !g.twins.every((r) => doc.has(r))) return;
    g.accX += dx;
    g.accZ += dz;
    const cur = doc.positionOf(g.refs[0]!);
    const snap = this.snapRaw.peek();
    let mx = this.snapValue(g.anchor0.x + g.accX, snap) - cur.x;
    let mz = this.snapValue(g.anchor0.z + g.accZ, snap) - cur.z;
    const box = boundsOf(doc, g.refs);
    const max = doc.maxRaw;
    mx = Math.max(-box.x0, Math.min(max - box.x1, mx));
    mz = Math.max(-box.z0, Math.min(max - box.z1, mz));
    if (mx === 0 && mz === 0) return;
    const ops: EditorOp[] = [{ kind: 'moveMarkers', refs: g.refs, dx: mx, dz: mz }];
    if (g.twins.length > 0) {
      const d = mirrorDelta(this.symmetry.peek(), mx, mz);
      ops.push({ kind: 'moveMarkers', refs: g.twins, dx: d.x, dz: d.z });
    }
    this.run(single(ops), 'Verschieben');
  }

  /** Moves polygon vertex `vertex` of field `field` to (x, z) (snapped/clamped; twin vertex follows). */
  moveVertex(field: number, vertex: number, x: number, z: number): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const ref: MarkerRef = { type: 'fieldVertex', index: field, vertex };
    if (!doc.has(ref)) return;
    const p = this.snapPoint(doc, x, z);
    const ops: EditorOp[] = [{ kind: 'moveFieldVertex', field, vertex, x: p.x, z: p.z }];
    const mode = this.live;
    const t = mode === 'none' ? null : findTwin(doc, ref, mode);
    if (t !== null && t.type === 'fieldVertex' && !sameRef(t, ref)) {
      const m = mirrorPoint(mode, doc.sizeWu, p.x, p.z);
      ops.push({ kind: 'moveFieldVertex', field: t.index, vertex: t.vertex, x: m.x, z: m.z });
    }
    this.run(single(ops), 'Eckpunkt verschieben');
  }

  /** Sets the radius of circle field `field` (snapped, clamped to [4096, sizeWu·4096]; twin follows). */
  setFieldRadius(field: number, r: number): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const ref: MarkerRef = { type: 'fieldRadius', index: field };
    if (!doc.has(ref)) return;
    const rr = Math.max(MIN_RADIUS_RAW, Math.min(doc.maxRaw, this.snapValue(r, this.snapRaw.peek())));
    const ops: EditorOp[] = [{ kind: 'setFieldRadius', field, r: rr }];
    const mode = this.live;
    const t = mode === 'none' ? null : findTwin(doc, ref, mode);
    if (t !== null && t.index !== field) ops.push({ kind: 'setFieldRadius', field: t.index, r: rr });
    this.run(single(ops), 'Radius ändern');
  }

  /** Inserts a vertex after `afterVertex` (−1 = before vertex 0) of polygon field `field` (twin follows). */
  insertVertex(field: number, afterVertex: number, x: number, z: number): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const f = doc.fields[field];
    if (f === undefined || f.shape.kind !== 'polygon') return;
    const pts = f.shape.points;
    const p = this.snapPoint(doc, x, z);
    const ops: EditorOp[] = [{ kind: 'insertFieldVertex', field, after: afterVertex, x: p.x, z: p.z }];
    const mode = this.live;
    const t = mode === 'none' ? null : findTwin(doc, { type: 'field', index: field }, mode);
    if (t !== null && t.index !== field && afterVertex >= -1 && afterVertex < pts.length) {
      const n = pts.length;
      const a = pts[(afterVertex + n) % n]!;
      const b = pts[(afterVertex + 1) % n]!;
      const tw = (doc.fields[t.index]!.shape as { points: readonly MapPoint[] }).points;
      const ma = mirrorPoint(mode, doc.sizeWu, a.x, a.z);
      const mb = mirrorPoint(mode, doc.sizeWu, b.x, b.z);
      const k1 = tw.findIndex((q) => q.x === ma.x && q.z === ma.z);
      const k2 = tw.findIndex((q) => q.x === mb.x && q.z === mb.z);
      const m = mirrorPoint(mode, doc.sizeWu, p.x, p.z);
      if (k1 >= 0 && k2 >= 0) {
        const after = k2 === (k1 + 1) % n ? k1 : k1 === (k2 + 1) % n ? k2 : -2;
        if (after >= 0) ops.push({ kind: 'insertFieldVertex', field: t.index, after, x: m.x, z: m.z });
      }
    }
    if (this.run(single(ops), 'Eckpunkt einfügen')) {
      this.selectionSig.value = [{ type: 'fieldVertex', index: field, vertex: afterVertex + 1 }];
    }
  }

  /**
   * Deletes the selection: vertex refs delete polygon vertices (>= 3 must remain), all other refs
   * delete their start / spot / field (a radius handle deletes its field). The last start is kept.
   */
  deleteSelection(): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    const sel = this.selectionSig.peek().filter((r) => doc.has(r));
    if (sel.length === 0) return;
    const mode = this.live;
    const all: MarkerRef[] = [];
    for (const r of sel) {
      if (!refIn(all, r)) all.push(r);
      const t = mode === 'none' ? null : findTwin(doc, r, mode);
      if (t !== null && !refIn(all, t)) all.push(t);
    }
    const whole: MarkerRef[] = [];
    for (const r of all) {
      if (r.type === 'fieldVertex') continue;
      const w: MarkerRef = r.type === 'fieldRadius' ? { type: 'field', index: r.index } : r;
      if (!refIn(whole, w)) whole.push(w);
    }
    const startsLeft = doc.starts.length - whole.filter((r) => r.type === 'start').length;
    let note = '';
    let wholeRefs = whole;
    if (startsLeft < 1) {
      const keep = whole.find((r) => r.type === 'start')!;
      wholeRefs = whole.filter((r) => !sameRef(r, keep));
      note = ' (die letzte Startposition bleibt erhalten)';
    }
    const vertexOps: EditorOp[] = [];
    const byField: number[][] = doc.fields.map(() => []);
    for (const r of all) {
      if (r.type !== 'fieldVertex' || wholeRefs.some((w) => w.type === 'field' && w.index === r.index)) continue;
      if (!byField[r.index]!.includes(r.vertex)) byField[r.index]!.push(r.vertex);
    }
    for (let fi = 0; fi < byField.length; fi++) {
      const vs = byField[fi]!;
      if (vs.length === 0) continue;
      const n = (doc.fields[fi]!.shape as { points: readonly MapPoint[] }).points.length;
      if (n - vs.length < 3) {
        this.status.value = `Nicht möglich: Prop-Feld ${fi + 1} braucht mindestens 3 Eckpunkte`;
        return;
      }
      vs.sort((a, b) => b - a);
      for (const v of vs) vertexOps.push({ kind: 'deleteFieldVertex', field: fi, vertex: v });
    }
    const ops: EditorOp[] = [...vertexOps];
    if (wholeRefs.length > 0) ops.push({ kind: 'deleteMarkers', refs: wholeRefs });
    if (ops.length === 0) {
      this.status.value = `Nichts gelöscht${note}`;
      return;
    }
    if (this.run(single(ops), 'Löschen')) {
      this.selectionSig.value = [];
      this.status.value = `${all.length} Objekt(e) gelöscht${note}`;
    }
  }

  /** Changes field properties (not the shape); the twin gets the same patch (seed XOR MIRROR_SEED_XOR). */
  updateField(index: number, patch: Partial<Omit<MapPropField, 'shape'>>): void {
    const doc = this.docSig.peek();
    if (doc === null || !doc.has({ type: 'field', index })) return;
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && k !== 'shape') clean[k] = v;
    if (Object.keys(clean).length === 0) return;
    const ops: EditorOp[] = [{ kind: 'updateField', index, patch: clean as FieldPatch }];
    const mode = this.live;
    const t = mode === 'none' ? null : findTwin(doc, { type: 'field', index }, mode);
    if (t !== null && t.index !== index) {
      const tp: Record<string, unknown> = { ...clean };
      if (typeof clean['seed'] === 'number') tp['seed'] = ((clean['seed'] as number) ^ MIRROR_SEED_XOR) >>> 0;
      ops.push({ kind: 'updateField', index: t.index, patch: tp as FieldPatch });
    }
    this.run(single(ops), 'Prop-Feld ändern');
  }

  /** Gives start `index` army `army` (a start that has it gets the old army); keeps it selected. */
  setStartArmy(index: number, army: number): void {
    const doc = this.docSig.peek();
    if (doc === null || !doc.has({ type: 'start', index })) return;
    if (this.run({ kind: 'setStartArmy', index, army }, 'Armee ändern')) {
      const d = this.requireDoc();
      this.selectionSig.value = [{ type: 'start', index: d.starts.findIndex((s) => s.army === army) }];
    }
  }

  /** Replaces half `keep`'s counterpart by mirror images (one undo step, see symmetrizeOp). */
  symmetrize(mode: SymmetryMode, keep: 'a' | 'b'): void {
    const doc = this.docSig.peek();
    if (doc === null) return;
    let op: EditorOp;
    try {
      op = symmetrizeOp(doc, mode, keep);
    } catch (e) {
      this.status.value = `Nicht möglich: ${errorText(e)}`;
      return;
    }
    if (op.kind === 'batch' && op.ops.length === 0) {
      this.status.value = 'Karte ist bereits symmetrisch';
      return;
    }
    if (this.run(op, 'Symmetrisieren')) {
      this.selectionSig.value = [];
      this.status.value = 'Symmetrie angewendet';
    }
  }

  undo(): void {
    const doc = this.docSig.peek();
    if (doc === null || !this.history.canUndo) return;
    this.gestureMove = null;
    try {
      this.commit(this.history.undo(doc));
      this.status.value = 'Rückgängig';
    } catch (e) {
      this.status.value = `Rückgängig fehlgeschlagen: ${errorText(e)}`;
    }
  }

  redo(): void {
    const doc = this.docSig.peek();
    if (doc === null || !this.history.canRedo) return;
    this.gestureMove = null;
    try {
      this.commit(this.history.redo(doc));
      this.status.value = 'Wiederholt';
    } catch (e) {
      this.status.value = `Wiederholen fehlgeschlagen: ${errorText(e)}`;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Internals

  private requireDoc(): EditorDocument {
    const d = this.docSig.peek();
    if (d === null) throw new Error('EditorStore: no document open');
    return d;
  }

  /** Applies `op` through the history; false (and a status message) if it was rejected or a no-op. */
  private run(op: EditorOp, label: string): boolean {
    const doc = this.docSig.peek();
    if (doc === null) return false;
    let next: EditorDocument;
    try {
      next = this.history.apply(doc, op, label);
    } catch (e) {
      this.status.value = `Nicht möglich: ${errorText(e)}`;
      return false;
    }
    if (next === doc) return false;
    this.commit(next);
    return true;
  }

  private commit(doc: EditorDocument): void {
    batch(() => {
      this.docSig.value = doc;
      this.revisionSig.value = this.revisionSig.peek() + 1;
      this.stateIdSig.value = this.history.stateId;
      const sel = this.selectionSig.peek();
      const kept = sel.filter((r) => doc.has(r));
      if (kept.length !== sel.length) this.selectionSig.value = kept;
      const h = this.hover.peek();
      if (h !== null && !doc.has(h)) this.hover.value = null;
      this.refreshHistorySignals();
      this.runValidator(doc);
    });
  }

  private refreshHistorySignals(): void {
    this.undoDepthSig.value = this.history.undoDepth;
    this.redoDepthSig.value = this.history.redoDepth;
  }

  private runValidator(doc: EditorDocument | null): void {
    if (doc === null || this.validator === null) {
      this.issuesSig.value = [];
      return;
    }
    try {
      this.issuesSig.value = this.validator(doc.toRtsMap());
    } catch (e) {
      this.issuesSig.value = [{ severity: 'error', code: 'validator-failed', message: `Validierung fehlgeschlagen: ${errorText(e)}`, x: null, z: null, refs: [] }];
    }
  }

  private snapValue(v: number, snap: number): number {
    return snap > 0 ? Math.round(v / snap) * snap : Math.round(v);
  }

  private snapPoint(doc: EditorDocument, x: number, z: number): MapPoint {
    const snap = this.snapRaw.peek();
    const max = doc.maxRaw;
    return { x: Math.max(0, Math.min(max, this.snapValue(x, snap))), z: Math.max(0, Math.min(max, this.snapValue(z, snap))) };
  }

  /** Snapped/clamped shape; polygons drop repeated neighbours (null if < 3 points remain). */
  private snapShape(doc: EditorDocument, shape: PropFieldShape): PropFieldShape | null {
    if (shape.kind === 'circle') {
      const c = this.snapPoint(doc, shape.x, shape.z);
      const r = Math.max(MIN_RADIUS_RAW, Math.min(doc.maxRaw, this.snapValue(shape.r, this.snapRaw.peek())));
      return { kind: 'circle', x: c.x, z: c.z, r };
    }
    const pts: MapPoint[] = [];
    for (const p of shape.points) {
      const q = this.snapPoint(doc, p.x, p.z);
      const last = pts[pts.length - 1];
      if (last === undefined || last.x !== q.x || last.z !== q.z) pts.push(q);
    }
    while (pts.length > 1 && pts[0]!.x === pts[pts.length - 1]!.x && pts[0]!.z === pts[pts.length - 1]!.z) pts.pop();
    return pts.length < 3 ? null : { kind: 'polygon', points: pts };
  }
}

function single(ops: readonly EditorOp[]): EditorOp {
  return ops.length === 1 ? ops[0]! : { kind: 'batch', ops };
}

function shapesEqual(a: PropFieldShape, b: PropFieldShape): boolean {
  if (a.kind === 'circle') return b.kind === 'circle' && a.x === b.x && a.z === b.z && a.r === b.r;
  if (b.kind !== 'polygon' || a.points.length !== b.points.length) return false;
  return a.points.every((p, i) => p.x === b.points[i]!.x && p.z === b.points[i]!.z);
}

/** Move refs of a selection: radius handles → field, vertices of selected fields dropped, deduplicated. */
function normalizeSelection(doc: EditorDocument, sel: readonly MarkerRef[]): MarkerRef[] {
  const out: MarkerRef[] = [];
  for (const r0 of sel) {
    if (!doc.has(r0)) continue;
    const r: MarkerRef = r0.type === 'fieldRadius' ? { type: 'field', index: r0.index } : r0;
    if (!refIn(out, r)) out.push(r);
  }
  return out.filter((r) => r.type !== 'fieldVertex' || !out.some((o) => o.type === 'field' && o.index === r.index));
}

/** Bounding box (Fx raw) of everything a move of `refs` translates (circle: centre only). */
function boundsOf(doc: EditorDocument, refs: readonly MarkerRef[]): { x0: number; z0: number; x1: number; z1: number } {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const add = (p: MapPoint): void => {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.z < z0) z0 = p.z;
    if (p.z > z1) z1 = p.z;
  };
  for (const r of refs) {
    if (r.type === 'field') {
      const sh = doc.fields[r.index]!.shape;
      if (sh.kind === 'circle') add({ x: sh.x, z: sh.z });
      else for (const p of sh.points) add(p);
    } else {
      add(doc.positionOf(r));
    }
  }
  return { x0, z0, x1, z1 };
}
