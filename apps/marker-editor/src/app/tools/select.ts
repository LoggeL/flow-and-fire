/**
 * Select tool:
 * - click on a marker selects it (Shift: adds it, or removes it if it was selected);
 *   click into empty space clears the selection (Shift: keeps it);
 * - left-drag on a marker moves the selection as ONE gesture (one undo step); dragging an
 *   unselected marker selects it first;
 * - left-drag on a vertex handle moves that vertex, on a radius handle changes the radius;
 * - double click on a polygon edge inserts a vertex there;
 * - left-drag into empty space pans the camera;
 * - Escape during a drag reverts it.
 */
import type { MapPoint } from '@faf/formats';
import type { MarkerRef } from '../../model/types.ts';
import { STRINGS } from '../strings.ts';
import { distPx, PanDrag, pointSegment, Press } from './common.ts';
import { EDGE_PICK_PX, type PointerInput, type Tool, type ToolContext } from './types.ts';

type DragMode = 'move' | 'vertex' | 'radius' | 'pan';

interface SelectPress {
  readonly press: Press;
  readonly mode: DragMode;
  readonly hit: MarkerRef | null;
  readonly downPick: MapPoint | null;
  /** Handle position minus the grabbed terrain point (vertex/radius drags). */
  readonly offset: MapPoint;
  /** Selection change applied on release if the press did not become a drag. */
  onClick: (() => void) | null;
  /** Total delta already sent to moveSelectionBy. */
  appliedX: number;
  appliedZ: number;
  gesture: boolean;
  revision0: number;
  readonly pan: PanDrag;
}

function sameRef(a: MarkerRef, b: MarkerRef): boolean {
  if (a.type !== b.type || a.index !== b.index) return false;
  return a.type !== 'fieldVertex' || (b.type === 'fieldVertex' && a.vertex === b.vertex);
}

function contains(list: readonly MarkerRef[], r: MarkerRef): boolean {
  return list.some((o) => sameRef(o, r));
}

/** Edge of a polygon field near a client pixel: insertion data for store.insertVertex. */
export interface EdgeHit {
  readonly field: number;
  /** Insert after this vertex (the edge runs from `after` to `after + 1` mod n). */
  readonly after: number;
  readonly x: number;
  readonly z: number;
  readonly distPx: number;
}

/**
 * Nearest polygon edge within EDGE_PICK_PX of (x, y), excluding the ends (a double click on a
 * vertex inserts nothing). The insertion point is the picked terrain point projected onto the edge.
 */
export function findEdge(ctx: ToolContext, x: number, y: number): EdgeHit | null {
  const doc = ctx.store.doc.peek();
  if (doc === null) return null;
  const env = ctx.env;
  let best: EdgeHit | null = null;
  const at = env.pick(x, y);
  for (let fi = 0; fi < doc.fields.length; fi++) {
    const sh = doc.fields[fi]!.shape;
    if (sh.kind !== 'polygon') continue;
    const pts = sh.points;
    const scr = pts.map((q) => env.project(q.x, q.z));
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const pa = scr[i];
      const pb = scr[j];
      if (pa == null || pb == null) continue;
      if (distPx(x, y, pa.x, pa.y) <= EDGE_PICK_PX || distPx(x, y, pb.x, pb.y) <= EDGE_PICK_PX) continue;
      const s = pointSegment(x, y, pa.x, pa.y, pb.x, pb.y);
      if (s.d > EDGE_PICK_PX || (best !== null && s.d >= best.distPx)) continue;
      const a = pts[i]!;
      const b = pts[j]!;
      let t = s.t;
      if (at !== null) {
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const len2 = vx * vx + vz * vz;
        if (len2 > 0) t = ((at.x - a.x) * vx + (at.z - a.z) * vz) / len2;
      }
      t = Math.max(0.01, Math.min(0.99, t));
      best = { field: fi, after: i, x: Math.round(a.x + t * (b.x - a.x)), z: Math.round(a.z + t * (b.z - a.z)), distPx: s.d };
    }
  }
  return best;
}

/** Position of a handle (vertex or the radius handle at (x + r, z)). */
function handlePosition(ctx: ToolContext, r: MarkerRef): MapPoint | null {
  const doc = ctx.store.doc.peek();
  if (doc === null || !doc.has(r)) return null;
  if (r.type === 'fieldRadius') {
    const sh = doc.fields[r.index]!.shape;
    return sh.kind === 'circle' ? { x: sh.x + sh.r, z: sh.z } : null;
  }
  return doc.positionOf(r);
}

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  private state: SelectPress | null = null;

  get pressed(): boolean {
    return this.state !== null;
  }

  down(p: PointerInput, ctx: ToolContext): boolean {
    const store = ctx.store;
    if (store.doc.peek() === null) return false;
    const hit = ctx.env.hitTest(p.x, p.y);
    const downPick = ctx.env.pick(p.x, p.y);
    const sel = store.selection.peek();
    let mode: DragMode;
    let onClick: (() => void) | null = null;
    let offset: MapPoint = { x: 0, z: 0 };
    if (hit === null) {
      mode = 'pan';
      if (!p.shift) onClick = () => store.select([]);
    } else if (hit.type === 'fieldRadius' || (hit.type === 'fieldVertex' && !p.shift)) {
      mode = hit.type === 'fieldRadius' ? 'radius' : 'vertex';
      store.select([hit], p.shift);
      const h = handlePosition(ctx, hit);
      if (h !== null && downPick !== null) offset = { x: h.x - downPick.x, z: h.z - downPick.z };
    } else {
      mode = 'move';
      const selected = contains(sel, hit);
      if (p.shift) {
        if (selected) onClick = () => store.select(store.selection.peek().filter((r) => !sameRef(r, hit)));
        else store.select([hit], true);
      } else if (selected) {
        onClick = () => store.select([hit]);
      } else {
        store.select([hit]);
      }
    }
    this.state = {
      press: new Press(p),
      mode,
      hit,
      downPick,
      offset,
      onClick,
      appliedX: 0,
      appliedZ: 0,
      gesture: false,
      revision0: store.revision.peek(),
      pan: new PanDrag(),
    };
    ctx.setHover(hit);
    return true;
  }

  move(p: PointerInput, ctx: ToolContext): void {
    const s = this.state;
    if (s === null) {
      ctx.setHover(ctx.store.doc.peek() === null ? null : ctx.env.hitTest(p.x, p.y));
      return;
    }
    if (!s.press.dragging) {
      if (!s.press.startsDrag(p)) return;
      s.onClick = null;
      if (s.mode === 'pan') {
        s.pan.start(ctx.env, s.press.x0, s.press.y0);
      } else {
        ctx.store.beginGesture();
        s.gesture = true;
        s.revision0 = ctx.store.revision.peek();
      }
    }
    this.dragStep(s, p, ctx);
  }

  private dragStep(s: SelectPress, p: PointerInput, ctx: ToolContext): void {
    const store = ctx.store;
    if (s.mode === 'pan') {
      s.pan.move(ctx.env, p.x, p.y);
      return;
    }
    const at = ctx.env.pick(p.x, p.y);
    if (at === null) return;
    const hit = s.hit;
    if (s.mode === 'move') {
      if (s.downPick === null) return;
      const tx = at.x - s.downPick.x;
      const tz = at.z - s.downPick.z;
      const dx = tx - s.appliedX;
      const dz = tz - s.appliedZ;
      if (dx === 0 && dz === 0) return;
      s.appliedX = tx;
      s.appliedZ = tz;
      store.moveSelectionBy(dx, dz);
    } else if (s.mode === 'vertex' && hit !== null && hit.type === 'fieldVertex') {
      store.moveVertex(hit.index, hit.vertex, at.x + s.offset.x, at.z + s.offset.z);
    } else if (s.mode === 'radius' && hit !== null) {
      const doc = store.doc.peek();
      const sh = doc?.fields[hit.index]?.shape;
      if (sh === undefined || sh.kind !== 'circle') return;
      const r = Math.round(Math.hypot(at.x + s.offset.x - sh.x, at.z + s.offset.z - sh.z));
      store.setFieldRadius(hit.index, r);
    }
  }

  up(p: PointerInput, ctx: ToolContext): void {
    const s = this.state;
    if (s === null) return;
    this.state = null;
    if (s.press.dragging) {
      if (s.gesture) ctx.store.endGesture();
      s.pan.stop();
    } else {
      s.onClick?.();
    }
    ctx.setHover(ctx.env.hitTest(p.x, p.y));
  }

  doubleClick(p: PointerInput, ctx: ToolContext): void {
    if (this.state !== null) return;
    const e = findEdge(ctx, p.x, p.y);
    if (e === null) return;
    const before = ctx.store.revision.peek();
    ctx.store.insertVertex(e.field, e.after, e.x, e.z);
    if (ctx.store.revision.peek() !== before) ctx.store.status.value = STRINGS.vertexInserted;
  }

  cancel(ctx: ToolContext): boolean {
    const s = this.state;
    if (s === null) return false;
    this.state = null;
    s.pan.stop();
    if (s.gesture) {
      ctx.store.endGesture();
      if (ctx.store.revision.peek() !== s.revision0) {
        ctx.store.undo();
        ctx.store.status.value = STRINGS.dragCancelled;
      }
    }
    return true;
  }

  confirm(): boolean {
    return false;
  }

  backspace(): boolean {
    return false;
  }

  reset(ctx: ToolContext): void {
    const s = this.state;
    this.state = null;
    if (s !== null && s.gesture) ctx.store.endGesture();
    ctx.setHover(null);
  }

  cursor(ctx: ToolContext): string {
    const s = this.state;
    if (s !== null) {
      if (s.mode === 'pan') return s.press.dragging ? 'grabbing' : 'default';
      return s.mode === 'move' ? 'move' : 'grabbing';
    }
    const h = ctx.store.hover.peek();
    if (h === null) return 'default';
    return h.type === 'fieldVertex' || h.type === 'fieldRadius' ? 'grab' : 'move';
  }
}
