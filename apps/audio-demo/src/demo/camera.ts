/**
 * Top-down RTS camera of the audio demo: focus point on the ground, height (zoom) and yaw. Produces
 * the engine's {@link ListenerState} (reused object) and the world ↔ screen mapping of the
 * renderer. Screen right is the camera right vector (cos yaw, sin yaw); screen down is
 * (−sin yaw, cos yaw), so yaw 0 shows +x to the right and +z downwards.
 */

import type { ListenerState } from '@faf/audio';
import { FIELD_SIZE } from './scenario.ts';

/** Height range of the camera in WU (task: 20–400). */
export const MIN_HEIGHT = 20;
export const MAX_HEIGHT = 400;
/** Horizontal half field of view: viewHalfWidth = height · tan(30°). */
export const TAN_HALF_FOV = Math.tan(Math.PI / 6);
/** Duration of a jump-to-alert flight in ms. */
export const FLY_MS = 450;

export interface CameraPose {
  x: number;
  z: number;
  height: number;
  /** Rotation in radians (Q/E). */
  yaw: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Camera implements CameraPose {
  x = FIELD_SIZE / 2;
  z = FIELD_SIZE / 2;
  height = 90;
  yaw = 0;
  /** Set whenever the pose changed; the demo pushes the listener to the engine and clears it. */
  dirty = true;
  readonly listener: ListenerState = { focusX: 0, focusZ: 0, height: 0, viewHalfWidth: 1, rightX: 1, rightZ: 0 };

  private flyFromX = 0;
  private flyFromZ = 0;
  private flyToX = 0;
  private flyToZ = 0;
  private flyStart = -1;

  get viewHalfWidth(): number {
    return this.height * TAN_HALF_FOV;
  }

  get rightX(): number {
    return Math.cos(this.yaw);
  }

  get rightZ(): number {
    return Math.sin(this.yaw);
  }

  /** True while a jump-to flight is animating. */
  get flying(): boolean {
    return this.flyStart >= 0;
  }

  set(p: Partial<CameraPose>): void {
    if (p.x !== undefined && Number.isFinite(p.x)) this.x = p.x;
    if (p.z !== undefined && Number.isFinite(p.z)) this.z = p.z;
    if (p.height !== undefined && Number.isFinite(p.height)) this.height = p.height;
    if (p.yaw !== undefined && Number.isFinite(p.yaw)) this.yaw = p.yaw;
    this.flyStart = -1;
    this.clampPose();
    this.dirty = true;
  }

  /** Starts a smooth flight of the focus to (x, z). */
  flyTo(x: number, z: number, nowMs: number): void {
    this.flyFromX = this.x;
    this.flyFromZ = this.z;
    this.flyToX = clamp(x, 0, FIELD_SIZE);
    this.flyToZ = clamp(z, 0, FIELD_SIZE);
    this.flyStart = nowMs;
  }

  /** Pans by screen-space deltas in WU (dxRight along the right vector, dyDown along screen down). */
  panScreen(dxRight: number, dyDown: number): void {
    const rx = this.rightX;
    const rz = this.rightZ;
    this.x += rx * dxRight - rz * dyDown;
    this.z += rz * dxRight + rx * dyDown;
    this.flyStart = -1;
    this.clampPose();
    this.dirty = true;
  }

  zoomBy(factor: number): void {
    this.height *= factor;
    this.clampPose();
    this.dirty = true;
  }

  rotateBy(rad: number): void {
    this.yaw += rad;
    // Keep yaw in −π..π (display only; the right vector is periodic anyway).
    if (this.yaw > Math.PI) this.yaw -= 2 * Math.PI;
    if (this.yaw < -Math.PI) this.yaw += 2 * Math.PI;
    this.dirty = true;
  }

  /** Advances a running flight. */
  tick(nowMs: number): void {
    if (this.flyStart < 0) return;
    const f = clamp((nowMs - this.flyStart) / FLY_MS, 0, 1);
    const e = f * f * (3 - 2 * f);
    this.x = this.flyFromX + (this.flyToX - this.flyFromX) * e;
    this.z = this.flyFromZ + (this.flyToZ - this.flyFromZ) * e;
    if (f >= 1) this.flyStart = -1;
    this.dirty = true;
  }

  /** Fills and returns the reused listener object. */
  toListener(): ListenerState {
    const l = this.listener;
    l.focusX = this.x;
    l.focusZ = this.z;
    l.height = this.height;
    l.viewHalfWidth = this.viewHalfWidth;
    l.rightX = this.rightX;
    l.rightZ = this.rightZ;
    return l;
  }

  /** Pixels per WU for a canvas `widthPx` wide. */
  scale(widthPx: number): number {
    return widthPx / 2 / this.viewHalfWidth;
  }

  /** Screen (canvas px) → world; writes into `out` = [x, z]. */
  screenToWorld(sx: number, sy: number, widthPx: number, heightPx: number, out: [number, number]): [number, number] {
    const s = this.scale(widthPx);
    const r = (sx - widthPx / 2) / s;
    const d = (sy - heightPx / 2) / s;
    out[0] = this.x + this.rightX * r - this.rightZ * d;
    out[1] = this.z + this.rightZ * r + this.rightX * d;
    return out;
  }

  private clampPose(): void {
    this.height = clamp(this.height, MIN_HEIGHT, MAX_HEIGHT);
    this.x = clamp(this.x, -64, FIELD_SIZE + 64);
    this.z = clamp(this.z, -64, FIELD_SIZE + 64);
  }
}
