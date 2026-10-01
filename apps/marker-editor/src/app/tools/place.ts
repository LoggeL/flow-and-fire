/**
 * Placement tools (start, mass, hydro) and the delete tool: a click acts on the pressed point,
 * a left-drag pans the camera instead.
 */
import type { MapPoint } from '@faf/formats';
import type { MarkerRef } from '../../model/types.ts';
import { STRINGS } from '../strings.ts';
import { allFieldRefs, PanDrag, Press } from './common.ts';
import type { PointerInput, Tool, ToolContext } from './types.ts';

/** Base of click tools: press → click (no drag) or pan (drag). */
abstract class ClickTool implements Tool {
  abstract readonly id: Tool['id'];
  private press: Press | null = null;
  private readonly pan = new PanDrag();

  get pressed(): boolean {
    return this.press !== null;
  }

  down(p: PointerInput, ctx: ToolContext): boolean {
    if (ctx.store.doc.peek() === null) return false;
    this.press = new Press(p);
    return true;
  }

  move(p: PointerInput, ctx: ToolContext): void {
    const pr = this.press;
    if (pr === null) {
      this.hover(p, ctx);
      return;
    }
    if (pr.startsDrag(p)) this.pan.start(ctx.env, pr.x0, pr.y0);
    if (pr.dragging) this.pan.move(ctx.env, p.x, p.y);
  }

  up(p: PointerInput, ctx: ToolContext): void {
    const pr = this.press;
    if (pr === null) return;
    this.press = null;
    this.pan.stop();
    if (!pr.dragging) this.click({ x: pr.x0, y: pr.y0, shift: p.shift, mod: p.mod }, ctx);
    this.hover(p, ctx);
  }

  doubleClick(): void {
    // A double click is two clicks; nothing extra.
  }

  cancel(): boolean {
    if (this.press === null) return false;
    this.press = null;
    this.pan.stop();
    return true;
  }

  confirm(): boolean {
    return false;
  }

  backspace(): boolean {
    return false;
  }

  reset(ctx: ToolContext): void {
    this.press = null;
    this.pan.stop();
    ctx.setHover(null);
  }

  cursor(_ctx: ToolContext): string {
    return this.press?.dragging === true ? 'grabbing' : 'crosshair';
  }

  protected hover(_p: PointerInput, ctx: ToolContext): void {
    ctx.setHover(null);
  }

  protected abstract click(p: PointerInput, ctx: ToolContext): void;

  /** Terrain point under p; reports "off the map" in the status line when there is none. */
  protected pickOrReport(p: PointerInput, ctx: ToolContext): MapPoint | null {
    const at = ctx.env.pick(p.x, p.y);
    if (at === null) ctx.store.status.value = STRINGS.offMap;
    return at;
  }
}

export class StartTool extends ClickTool {
  readonly id = 'start' as const;

  protected click(p: PointerInput, ctx: ToolContext): void {
    const at = this.pickOrReport(p, ctx);
    if (at !== null) ctx.store.addStart(at.x, at.z);
  }
}

export class SpotTool extends ClickTool {
  readonly id: 'mass' | 'hydro';

  constructor(kind: 'mass' | 'hydro') {
    super();
    this.id = kind;
  }

  protected click(p: PointerInput, ctx: ToolContext): void {
    const at = this.pickOrReport(p, ctx);
    if (at !== null) ctx.store.addSpot(this.id, at.x, at.z);
  }
}

/**
 * Delete tool: a click deletes the marker under the cursor; on a polygon vertex (of any field) it
 * deletes only that vertex (at least 3 remain), on a radius handle the circle field.
 */
export class DeleteTool extends ClickTool {
  readonly id = 'delete' as const;

  /** What a click at p would delete (vertex handles of every field are hit-testable). */
  target(p: PointerInput, ctx: ToolContext): MarkerRef | null {
    const doc = ctx.store.doc.peek();
    if (doc === null) return null;
    return ctx.env.hitTest(p.x, p.y, allFieldRefs(doc.fields, ctx.store.selection.peek()));
  }

  protected override hover(p: PointerInput, ctx: ToolContext): void {
    ctx.setHover(this.target(p, ctx));
  }

  protected click(p: PointerInput, ctx: ToolContext): void {
    const t = this.target(p, ctx);
    if (t === null) return;
    ctx.store.select([t]);
    ctx.store.deleteSelection();
  }

  override cursor(ctx: ToolContext): string {
    if (this.pressed) return super.cursor(ctx);
    return ctx.store.hover.peek() === null ? 'crosshair' : 'pointer';
  }
}
