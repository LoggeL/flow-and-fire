/**
 * RTS camera controller on top of the render `RtsCamera` (PLAN §3.7, MS1 test plane).
 *
 * - Pan with WASD/arrow keys (continuous, speed proportional to the zoom distance) and with a
 *   middle-mouse drag ("grab the ground": the plane point under the cursor follows the mouse).
 * - Zoom with the mouse wheel towards the cursor: the ground point under the cursor stays put.
 * - The focus point is clamped to the map (512 WU test plane by default).
 *
 * The controller is pure presentation state: it never touches the sim and keeps working while the
 * game is paused.
 */
import { RAW_PER_WU, type RtsCamera } from '@faf/render';
import { GroundPicker, mapBoundsWU, type MapBounds } from './picking.ts';

export interface CameraControllerOptions {
  /** Map rectangle the focus point is clamped to; default: 512 × 512 WU test plane. */
  readonly bounds?: MapBounds;
  /** Keyboard pan speed in multiples of the zoom distance per second (default 1.1). */
  readonly keyPanSpeed?: number;
  /** Distance factor per wheel step (default 1.15; > 1). */
  readonly zoomStep?: number;
  /** Upper bound for one frame's dt in ms (tab switches, debugger pauses); default 100. */
  readonly maxDtMs?: number;
}

/** Plain snapshot of the camera state (UI, E2E hooks). */
export interface CameraState {
  /** Focus point in WU. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
  readonly yaw: number;
  readonly pitch: number;
}

export class CameraController {
  readonly camera: RtsCamera;
  bounds: MapBounds;
  keyPanSpeed: number;
  zoomStep: number;
  maxDtMs: number;
  /** Incremented on every change made through the controller. */
  version = 0;
  private readonly picker: GroundPicker;

  constructor(camera: RtsCamera, opts: CameraControllerOptions = {}) {
    this.camera = camera;
    this.bounds = opts.bounds ?? mapBoundsWU();
    this.keyPanSpeed = opts.keyPanSpeed ?? 1.1;
    this.zoomStep = opts.zoomStep ?? 1.15;
    this.maxDtMs = opts.maxDtMs ?? 100;
    this.picker = new GroundPicker(this.bounds);
    this.clamp();
  }

  /** Centers the camera on the map. */
  centerOnMap(): void {
    const b = this.bounds;
    this.focusRaw((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  }

  /** Moves the focus point to (x, z) in raw units (clamped). */
  focusRaw(xRaw: number, zRaw: number): void {
    this.camera.targetX = xRaw;
    this.camera.targetZ = zRaw;
    this.clamp();
    this.changed();
  }

  /** WU per CSS pixel at the focus point (vertical extent of the view at distance `d`). */
  worldPerPixel(): number {
    const c = this.camera;
    return (2 * c.distance * Math.tan(c.fovY / 2)) / Math.max(1, c.viewportHeight);
  }

  /**
   * Continuous keyboard pan. `axisX` (−1 left … +1 right) and `axisY` (−1 back … +1 forward) are
   * the held directions; `dtMs` is the frame time.
   */
  update(dtMs: number, axisX: number, axisY: number): void {
    if (axisX === 0 && axisY === 0) return;
    const dt = Math.min(Math.max(dtMs, 0), this.maxDtMs) / 1000;
    let ax = axisX;
    let ay = axisY;
    const len = Math.hypot(ax, ay);
    if (len > 1) {
      ax /= len;
      ay /= len;
    }
    const v = this.keyPanSpeed * this.camera.distance * dt;
    this.camera.pan(ax * v, ay * v);
    this.clamp();
    this.changed();
  }

  /**
   * Drag pan by a mouse movement in CSS pixels: the ground follows the cursor (moving the mouse
   * right moves the view left, i.e. the world right).
   */
  panPixels(dxPx: number, dyPx: number): void {
    if (dxPx === 0 && dyPx === 0) return;
    const k = this.worldPerPixel();
    // Mouse down on screen (dy > 0) drags the ground towards the viewer ⇒ camera moves forward.
    this.camera.pan(-dxPx * k, dyPx * k);
    this.clamp();
    this.changed();
  }

  /**
   * Zooms by `steps` wheel steps (positive = out) towards the ground point under (cssX, cssY):
   * that point stays under the cursor (unless the distance limits or the map clamp intervene).
   */
  zoomAt(steps: number, cssX: number, cssY: number): void {
    if (steps === 0) return;
    const cam = this.camera;
    const p = this.picker;
    cam.update();
    const hadBefore = p.pick(cam, cssX, cssY);
    const bx = p.wuX;
    const bz = p.wuZ;
    cam.zoom(Math.pow(this.zoomStep, steps));
    cam.update();
    if (hadBefore && p.pick(cam, cssX, cssY)) {
      cam.targetX += (bx - p.wuX) * RAW_PER_WU;
      cam.targetZ += (bz - p.wuZ) * RAW_PER_WU;
    }
    this.clamp();
    this.changed();
  }

  /** Clamps the focus point to the map bounds. */
  clamp(): void {
    const c = this.camera;
    const b = this.bounds;
    if (c.targetX < b.minX) c.targetX = b.minX;
    else if (c.targetX > b.maxX) c.targetX = b.maxX;
    if (c.targetZ < b.minZ) c.targetZ = b.minZ;
    else if (c.targetZ > b.maxZ) c.targetZ = b.maxZ;
  }

  /** Plain snapshot (WU). */
  state(): CameraState {
    const c = this.camera;
    return {
      x: c.targetX / RAW_PER_WU,
      y: c.targetY / RAW_PER_WU,
      z: c.targetZ / RAW_PER_WU,
      distance: c.distance,
      yaw: c.yaw,
      pitch: c.pitch,
    };
  }

  private changed(): void {
    this.camera.update();
    this.version++;
  }
}
