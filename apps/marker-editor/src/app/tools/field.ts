/**
 * Field drawing tools.
 * - fieldCircle: press on the centre, drag to the rim, release → circle field (radius ≥ 1 WU; a
 *   plain click only shows a hint). Escape aborts the drag.
 * - fieldPolygon: each click adds a vertex; double click, Enter or a click on the first vertex
 *   finishes (≥ 3 vertices); Escape discards the polygon, Backspace removes the last vertex;
 *   left-drag pans the camera. A rejected polygon (e.g. self-intersecting) stays as a draft so it
 *   can be fixed with Backspace.
 */
import { MAP_FX_ONE, MAP_MAX_FIELD_POINTS, type MapPoint } from '@faf/formats';
import { STRINGS } from '../strings.ts';
import { distPx, PanDrag, Press, samePoint } from './common.ts';
import { CLOSE_POLYGON_PX, DRAG_THRESHOLD_PX, type PointerInput, type Tool, type ToolContext } from './types.ts';

export class CircleFieldTool implements Tool {
  readonly id = 'fieldCircle' as const;
  private press: Press | null = null;
  private centre: MapPoint | null = null;
  private rim: MapPoint | null = null;
  private readonly pan = new PanDrag();

  get pressed(): boolean {
    return this.press !== null;
  }

  down(p: PointerInput, ctx: ToolContext): boolean {
    if (ctx.store.doc.peek() === null) return false;
    this.press = new Press(p);
    this.centre = ctx.env.pick(p.x, p.y);
    this.rim = null;
    if (this.centre !== null) ctx.setDraft({ kind: 'circle', points: [this.centre] });
    return true;
  }

  move(p: PointerInput, ctx: ToolContext): void {
    const pr = this.press;
    if (pr === null) return;
    const started = pr.startsDrag(p);
    if (!pr.dragging) return;
    const c = this.centre;
    if (c === null) {
      // Pressed off the map: the drag pans.
      if (started) this.pan.start(ctx.env, pr.x0, pr.y0);
      this.pan.move(ctx.env, p.x, p.y);
      return;
    }
    const at = ctx.env.pick(p.x, p.y);
    if (at !== null) this.rim = at;
    if (this.rim !== null) ctx.setDraft({ kind: 'circle', points: [c, this.rim] });
  }

  up(_p: PointerInput, ctx: ToolContext): void {
    const pr = this.press;
    const c = this.centre;
    const rim = this.rim;
    this.clear(ctx);
    if (pr === null) return;
    if (c === null) {
      if (!pr.dragging) ctx.store.status.value = STRINGS.offMap;
      return;
    }
    if (!pr.dragging || rim === null) {
      ctx.store.status.value = STRINGS.circleDragHint;
      return;
    }
    const r = Math.max(MAP_FX_ONE, Math.round(Math.hypot(rim.x - c.x, rim.z - c.z)));
    ctx.store.addField({ kind: 'circle', x: c.x, z: c.z, r });
  }

  doubleClick(): void {
    // Circles are dragged, a double click has no meaning.
  }

  cancel(ctx: ToolContext): boolean {
    if (this.press === null) return false;
    this.clear(ctx);
    return true;
  }

  confirm(): boolean {
    return false;
  }

  backspace(): boolean {
    return false;
  }

  reset(ctx: ToolContext): void {
    this.clear(ctx);
  }

  cursor(): string {
    return this.press !== null && this.centre === null && this.press.dragging ? 'grabbing' : 'crosshair';
  }

  private clear(ctx: ToolContext): void {
    this.press = null;
    this.centre = null;
    this.rim = null;
    this.pan.stop();
    ctx.setDraft(null);
  }
}

export class PolygonFieldTool implements Tool {
  readonly id = 'fieldPolygon' as const;
  private press: Press | null = null;
  private readonly pan = new PanDrag();
  private points: MapPoint[] = [];
  private cursorPoint: MapPoint | null = null;

  get pressed(): boolean {
    return this.press !== null;
  }

  /** Vertices placed so far (tests, status). */
  get vertices(): readonly MapPoint[] {
    return this.points;
  }

  down(p: PointerInput, ctx: ToolContext): boolean {
    if (ctx.store.doc.peek() === null) return false;
    this.press = new Press(p);
    return true;
  }

  move(p: PointerInput, ctx: ToolContext): void {
    const pr = this.press;
    if (pr !== null) {
      if (pr.startsDrag(p)) this.pan.start(ctx.env, pr.x0, pr.y0);
      if (pr.dragging) this.pan.move(ctx.env, p.x, p.y);
      return;
    }
    this.cursorPoint = this.points.length > 0 ? ctx.env.pick(p.x, p.y) : null;
    this.publish(ctx);
  }

  up(p: PointerInput, ctx: ToolContext): void {
    const pr = this.press;
    if (pr === null) return;
    this.press = null;
    this.pan.stop();
    if (pr.dragging) return;
    this.click(pr.x0, pr.y0, ctx);
    this.cursorPoint = this.points.length > 0 ? ctx.env.pick(p.x, p.y) : null;
    this.publish(ctx);
  }

  private click(x: number, y: number, ctx: ToolContext): void {
    const pts = this.points;
    const env = ctx.env;
    if (pts.length >= 3) {
      const first = env.project(pts[0]!.x, pts[0]!.z);
      if (first !== null && distPx(x, y, first.x, first.y) <= CLOSE_POLYGON_PX) {
        this.commit(ctx);
        return;
      }
    }
    if (pts.length > 0) {
      // Second click of a double click (or a jitter click): no zero-length edge.
      const last = env.project(pts[pts.length - 1]!.x, pts[pts.length - 1]!.z);
      if (last !== null && distPx(x, y, last.x, last.y) < DRAG_THRESHOLD_PX) return;
    }
    const at = env.pick(x, y);
    if (at === null) {
      ctx.store.status.value = STRINGS.offMap;
      return;
    }
    if (pts.length > 0 && samePoint(pts[pts.length - 1]!, at)) return;
    if (pts.length >= MAP_MAX_FIELD_POINTS) {
      ctx.store.status.value = STRINGS.polygonMaxPoints(MAP_MAX_FIELD_POINTS);
      return;
    }
    pts.push(at);
    ctx.store.status.value = STRINGS.polygonPoint(pts.length);
  }

  doubleClick(_p: PointerInput, ctx: ToolContext): void {
    if (this.points.length === 0) return;
    this.commit(ctx);
  }

  cancel(ctx: ToolContext): boolean {
    if (this.press !== null) {
      this.press = null;
      this.pan.stop();
      return true;
    }
    if (this.points.length === 0) return false;
    this.points = [];
    this.cursorPoint = null;
    this.publish(ctx);
    ctx.store.status.value = STRINGS.polygonCancelled;
    return true;
  }

  confirm(ctx: ToolContext): boolean {
    if (this.points.length === 0) return false;
    this.commit(ctx);
    return true;
  }

  backspace(ctx: ToolContext): boolean {
    if (this.points.length === 0) return false;
    this.points.pop();
    if (this.points.length === 0) this.cursorPoint = null;
    this.publish(ctx);
    ctx.store.status.value = STRINGS.polygonPoint(this.points.length);
    return true;
  }

  reset(ctx: ToolContext): void {
    this.press = null;
    this.pan.stop();
    this.points = [];
    this.cursorPoint = null;
    ctx.setDraft(null);
  }

  cursor(): string {
    return this.press?.dragging === true ? 'grabbing' : 'crosshair';
  }

  /** Adds the polygon as a field; on success the draft is cleared, on rejection it stays. */
  private commit(ctx: ToolContext): void {
    if (this.points.length < 3) {
      ctx.store.status.value = STRINGS.polygonTooFew;
      return;
    }
    const doc = ctx.store.doc.peek();
    if (doc === null) return;
    const before = doc.fields.length;
    ctx.store.addField({ kind: 'polygon', points: this.points.slice() });
    const after = ctx.store.doc.peek()?.fields.length ?? before;
    if (after > before) {
      this.points = [];
      this.cursorPoint = null;
      this.publish(ctx);
    }
  }

  private publish(ctx: ToolContext): void {
    const pts = this.points;
    if (pts.length === 0) {
      ctx.setDraft(null);
      return;
    }
    const c = this.cursorPoint;
    const shown = c !== null && !samePoint(c, pts[pts.length - 1]!) ? [...pts, c] : pts.slice();
    ctx.setDraft({ kind: 'polygon', points: shown });
  }
}
