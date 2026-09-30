/**
 * Undo/redo history over EditorDocument snapshots and invertible EditorOps.
 *
 * - `apply` runs an operation, records forward op + inverse and clears the redo stack.
 * - Gestures: between beginGesture() and endGesture() every applied operation joins ONE history
 *   entry (one drag = one undo step). Consecutive moves of the same markers are merged (deltas
 *   summed), consecutive moveFieldVertex / setFieldRadius on the same target keep
 *   the first inverse and the last forward value, so a long drag stays O(1) in memory.
 * - At most `limit` (default 500) entries; the oldest are dropped.
 * - Every entry has a unique id; `stateId` (id of the newest undo entry, 0 = none) identifies the
 *   document state for dirty tracking (an undo back to the saved state is clean again).
 */
import type { EditorDocument } from './document.ts';
import { applyOp, isNoop, type EditorOp } from './ops.ts';
import type { MarkerRef } from './types.ts';

export const HISTORY_LIMIT = 500;

interface Entry {
  readonly id: number;
  /** Applied in order on redo. */
  readonly forward: EditorOp[];
  /** Applied in reverse order on undo. */
  readonly inverse: EditorOp[];
  label: string;
}

function sameRefs(a: readonly MarkerRef[], b: readonly MarkerRef[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.type !== y.type || x.index !== y.index) return false;
    if (x.type === 'fieldVertex' && (y.type !== 'fieldVertex' || x.vertex !== y.vertex)) return false;
  }
  return true;
}

/** Merges `next` into `prev` if both describe the same continuous edit (null = not mergeable). */
function mergeForward(prev: EditorOp, next: EditorOp): EditorOp | null {
  if (prev.kind === 'moveMarkers' && next.kind === 'moveMarkers' && sameRefs(prev.refs, next.refs)) {
    return { kind: 'moveMarkers', refs: prev.refs, dx: prev.dx + next.dx, dz: prev.dz + next.dz };
  }
  if (prev.kind === 'moveFieldVertex' && next.kind === 'moveFieldVertex' && prev.field === next.field && prev.vertex === next.vertex) return next;
  if (prev.kind === 'setFieldRadius' && next.kind === 'setFieldRadius' && prev.field === next.field) return next;
  if (prev.kind === 'batch' && next.kind === 'batch' && prev.ops.length === next.ops.length && prev.ops.length > 0) {
    const ops: EditorOp[] = [];
    for (let i = 0; i < prev.ops.length; i++) {
      const m = mergeForward(prev.ops[i]!, next.ops[i]!);
      if (m === null) return null;
      ops.push(m);
    }
    return { kind: 'batch', ops };
  }
  return null;
}

/** Inverse of a merged pair: the older inverse already restores the state before both. */
function mergeInverse(prevInv: EditorOp, nextInv: EditorOp): EditorOp | null {
  if (prevInv.kind === 'moveMarkers' && nextInv.kind === 'moveMarkers') {
    return { kind: 'moveMarkers', refs: prevInv.refs, dx: prevInv.dx + nextInv.dx, dz: prevInv.dz + nextInv.dz };
  }
  if (prevInv.kind === 'batch' && nextInv.kind === 'batch' && prevInv.ops.length === nextInv.ops.length) {
    const ops: EditorOp[] = [];
    for (let i = 0; i < prevInv.ops.length; i++) {
      const m = mergeInverse(prevInv.ops[i]!, nextInv.ops[i]!);
      if (m === null) return null;
      ops.push(m);
    }
    return { kind: 'batch', ops };
  }
  if (prevInv.kind === 'moveFieldVertex' && nextInv.kind === 'moveFieldVertex' && prevInv.field === nextInv.field && prevInv.vertex === nextInv.vertex) return prevInv;
  if (prevInv.kind === 'setFieldRadius' && nextInv.kind === 'setFieldRadius' && prevInv.field === nextInv.field) return prevInv;
  return null;
}

export class History {
  readonly limit: number;
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private gestureDepth = 0;
  private gestureEntry: Entry | null = null;
  private nextId = 1;

  constructor(limit: number = HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError(`history limit must be >= 1, got ${limit}`);
    this.limit = limit;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get inGesture(): boolean {
    return this.gestureDepth > 0;
  }

  /** Identity of the current state (id of the newest undo entry, 0 = the opened document). */
  get stateId(): number {
    const top = this.undoStack[this.undoStack.length - 1];
    return top === undefined ? 0 : top.id;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.gestureDepth = 0;
    this.gestureEntry = null;
  }

  beginGesture(): void {
    this.gestureDepth++;
  }

  endGesture(): void {
    if (this.gestureDepth === 0) return;
    this.gestureDepth--;
    if (this.gestureDepth === 0) this.gestureEntry = null;
  }

  /**
   * Applies `op` to `doc` and records it. Returns the new document (the same object if the op is a
   * no-op). Throws (and records nothing) if the op is invalid.
   */
  apply(doc: EditorDocument, op: EditorOp, label: string = op.kind): EditorDocument {
    if (isNoop(op)) return doc;
    const r = applyOp(doc, op);
    if (isNoop(r.inverse)) return r.doc;
    this.redoStack = [];
    const g = this.gestureDepth > 0 ? this.gestureEntry : null;
    if (g !== null && this.undoStack[this.undoStack.length - 1] === g) {
      const lastF = g.forward[g.forward.length - 1];
      const lastI = g.inverse[g.inverse.length - 1];
      const mf = lastF === undefined ? null : mergeForward(lastF, op);
      const mi = mf === null || lastI === undefined ? null : mergeInverse(lastI, r.inverse);
      if (mf !== null && mi !== null) {
        g.forward[g.forward.length - 1] = mf;
        g.inverse[g.inverse.length - 1] = mi;
      } else {
        g.forward.push(op);
        g.inverse.push(r.inverse);
      }
      return r.doc;
    }
    const entry: Entry = { id: this.nextId++, forward: [op], inverse: [r.inverse], label };
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    if (this.gestureDepth > 0) this.gestureEntry = entry;
    return r.doc;
  }

  /** Reverts the newest entry (ends an open gesture first). Returns `doc` unchanged if none. */
  undo(doc: EditorDocument): EditorDocument {
    this.gestureDepth = 0;
    this.gestureEntry = null;
    const e = this.undoStack.pop();
    if (e === undefined) return doc;
    let d = doc;
    for (let i = e.inverse.length - 1; i >= 0; i--) d = applyOp(d, e.inverse[i]!).doc;
    this.redoStack.push(e);
    return d;
  }

  /** Re-applies the newest undone entry. Returns `doc` unchanged if none. */
  redo(doc: EditorDocument): EditorDocument {
    this.gestureDepth = 0;
    this.gestureEntry = null;
    const e = this.redoStack.pop();
    if (e === undefined) return doc;
    let d = doc;
    for (const op of e.forward) d = applyOp(d, op).doc;
    this.undoStack.push(e);
    return d;
  }

  /** Label of the entry the next undo / redo would apply (for tooltips). */
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
}
