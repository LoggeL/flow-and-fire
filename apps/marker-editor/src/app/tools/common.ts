/** Helpers shared by the tools: press/drag detection, camera panning with the left button. */
import type { MapPoint } from '@faf/formats';
import type { MarkerRef } from '../../model/types.ts';
import { DRAG_THRESHOLD_PX, type PointerInput, type ToolEnv } from './types.ts';

/** A held left button: start position and whether it has become a drag. */
export class Press {
  readonly x0: number;
  readonly y0: number;
  dragging = false;

  constructor(p: PointerInput) {
    this.x0 = p.x;
    this.y0 = p.y;
  }

  /** True on the move that turns the press into a drag (only once). */
  startsDrag(p: PointerInput): boolean {
    if (this.dragging) return false;
    if (Math.hypot(p.x - this.x0, p.y - this.y0) < DRAG_THRESHOLD_PX) return false;
    this.dragging = true;
    return true;
  }
}

/**
 * Left-drag camera pan: the ground point grabbed at the start stays under the cursor (the camera
 * moves by the difference of the ground points under the cursor).
 */
export class PanDrag {
  private anchor: { x: number; z: number } | null = null;

  start(env: ToolEnv, x: number, y: number): void {
    this.anchor = env.groundAt(x, y);
  }

  move(env: ToolEnv, x: number, y: number): void {
    const a = this.anchor;
    if (a === null) {
      this.anchor = env.groundAt(x, y);
      return;
    }
    const g = env.groundAt(x, y);
    if (g === null) return;
    const dx = a.x - g.x;
    const dz = a.z - g.z;
    if (dx !== 0 || dz !== 0) env.panBy(dx, dz);
  }

  stop(): void {
    this.anchor = null;
  }
}

export function distPx(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Distance (px) of p to the segment a–b and the segment parameter t ∈ [0, 1] of the closest point. */
export function pointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; t: number } {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (ax + t * vx), py - (ay + t * vy)), t };
}

/** Refs of every field of a document (used to hit-test the handles of all fields). */
export function allFieldRefs(fields: readonly unknown[], base: readonly MarkerRef[]): MarkerRef[] {
  const out: MarkerRef[] = base.slice();
  for (let i = 0; i < fields.length; i++) out.push({ type: 'field', index: i });
  return out;
}

export function samePoint(a: MapPoint, b: MapPoint): boolean {
  return a.x === b.x && a.z === b.z;
}
