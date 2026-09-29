/**
 * FA-style RTS camera controller (C1, MS2) on top of the render `RtsCamera`.
 *
 * - Focus: `targetX/Z` on the map (clamped to the map bounds), `targetY` follows the terrain
 *   height at the focus, smoothed (exponential, `heightSmoothingMs`).
 * - Zoom: 6 WU up to the whole map (`maxDistance` from the map size), mouse wheel towards the
 *   cursor: the terrain point under the cursor stays under it after every wheel step
 *   (iterative anchor solve against the terrain picker; the focus height is snapped to the
 *   terrain there, so no smoothing drift follows).
 * - Pitch curve (FA-like: flat close to the ground, near top-down at the whole-map view):
 *   `pitch(d) = 38° + (82° − 38°) · smoothstep(t)`, `t = ln(d / dMin) / ln(dMax / dMin)` ∈ [0, 1],
 *   plus a user offset from rotating (± 20°), clamped to the camera's pitch limits.
 * - Terrain clearance: the eye stays ≥ `minClearanceWU` (2 WU) above the terrain below it —
 *   the pitch is raised (and, only if that is not enough, the eye lifted); `camera.groundHeight`
 *   = terrain height under the eye drives the dynamic near plane.
 * - Pan: WASD/arrows and edge pan (speed ∝ distance), middle-drag grabs the terrain (the grabbed
 *   point follows the cursor), Ctrl+middle-drag rotates (yaw; vertical = pitch offset), reset.
 * - `jumpTo(x, z)` and the start position/commander jump are done by the GameClient on top.
 *
 * Pure presentation state: it never touches the sim and keeps working while the game is paused.
 */
import { createRay, RAW_PER_WU, type Ray, type RtsCamera } from '@faf/render';
import { ClientMap } from './map.ts';
import { mapBoundsWU, type MapBounds } from './picking.ts';
import { TerrainPicker, type PickableTerrain } from './terrain-picker.ts';

const DEG = Math.PI / 180;

/** FA-like pitch curve over the zoom distance (radians). */
export interface PitchCurve {
  /** Pitch at the minimum distance. */
  readonly near: number;
  /** Pitch at the maximum distance. */
  readonly far: number;
}

export const DEFAULT_PITCH_CURVE: PitchCurve = { near: 38 * DEG, far: 82 * DEG };
/** Smallest zoom distance (WU). */
export const MIN_ZOOM_DISTANCE_WU = 6;
/** Eye–terrain clearance (WU). */
export const MIN_EYE_CLEARANCE_WU = 2;
/** Maximum user pitch offset from rotating (radians). */
export const MAX_PITCH_OFFSET = 20 * DEG;

export interface CameraControllerOptions {
  /** Map rectangle the focus point is clamped to; default: [0, terrain size]². */
  readonly bounds?: MapBounds;
  /** Terrain (ClientMap); default: the generated 512 WU test plane map (`ClientMap.testPlane()`). */
  readonly terrain?: PickableTerrain;
  /** Keyboard pan speed in multiples of the zoom distance per second (default 1.1). */
  readonly keyPanSpeed?: number;
  /** Edge pan speed in multiples of the zoom distance per second (default 1.0). */
  readonly edgePanSpeed?: number;
  /** Distance factor per wheel step (default 1.15; > 1). */
  readonly zoomStep?: number;
  /** Upper bound for one frame's dt in ms (tab switches, debugger pauses); default 100. */
  readonly maxDtMs?: number;
  /** Pitch curve (default {@link DEFAULT_PITCH_CURVE}); null keeps the camera pitch fixed (MS1). */
  readonly pitchCurve?: PitchCurve | null;
  /** Time constant of the focus-height smoothing in ms (default 150). */
  readonly heightSmoothingMs?: number;
  /** Rotation per dragged CSS pixel in radians (default 0.006). */
  readonly rotateSpeed?: number;
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
  /** Eye height above the terrain below it (WU). */
  readonly clearance: number;
}

/** Auto zoom limit: the whole map fits vertically at the far pitch (plus 15 % margin). */
export function maxDistanceForMap(sizeWu: number, fovY: number): number {
  return (sizeWu / (2 * Math.tan(fovY / 2))) * 1.15;
}

export class CameraController {
  readonly camera: RtsCamera;
  bounds: MapBounds;
  keyPanSpeed: number;
  edgePanSpeed: number;
  zoomStep: number;
  maxDtMs: number;
  pitchCurve: PitchCurve | null;
  heightSmoothingMs: number;
  rotateSpeed: number;
  /** User pitch offset (rotation drag), radians in ±MAX_PITCH_OFFSET. */
  pitchOffset = 0;
  /** Yaw restored by {@link resetRotation}. */
  defaultYaw: number;
  /** Incremented on every change made through the controller. */
  version = 0;

  private terrain: PickableTerrain;
  private picker: TerrainPicker;
  /** Grab anchor (WU) while a middle-drag is active. */
  private grabbing = false;
  private readonly grab = new Float64Array(3);
  private readonly ray: Ray = createRay();
  /** Smoothed focus height (raw); `camera.targetY` = focusY + clearance lift. */
  private focusY = 0;
  /** View inputs of the last `apply()` (steady-state frames skip all work). */
  private appliedX = Number.NaN;
  private appliedZ = Number.NaN;
  private appliedD = Number.NaN;
  private appliedYaw = Number.NaN;
  private appliedOffset = Number.NaN;
  private appliedFocusY = Number.NaN;
  private appliedTerrain: PickableTerrain | null = null;
  /** Focus-height target at (appliedX, appliedZ, appliedD). */
  private focusWant = 0;

  constructor(camera: RtsCamera, opts: CameraControllerOptions = {}) {
    this.camera = camera;
    this.keyPanSpeed = opts.keyPanSpeed ?? 1.1;
    this.edgePanSpeed = opts.edgePanSpeed ?? 1.0;
    this.zoomStep = opts.zoomStep ?? 1.15;
    this.maxDtMs = opts.maxDtMs ?? 100;
    this.pitchCurve = opts.pitchCurve === undefined ? DEFAULT_PITCH_CURVE : opts.pitchCurve;
    this.heightSmoothingMs = opts.heightSmoothingMs ?? 150;
    this.rotateSpeed = opts.rotateSpeed ?? 0.006;
    this.defaultYaw = camera.yaw;
    const terrain = opts.terrain ?? ClientMap.testPlane();
    const size = terrain.sizeWu;
    this.bounds = opts.bounds ?? mapBoundsWU(0, 0, size);
    this.terrain = terrain;
    this.picker = new TerrainPicker(terrain);
    camera.minDistance = MIN_ZOOM_DISTANCE_WU;
    camera.maxDistance = maxDistanceForMap(size, camera.fovY);
    this.clamp();
    this.focusY = this.terrainHeightRaw();
    this.apply();
  }

  /** Current height source. */
  get terrainSource(): PickableTerrain {
    return this.terrain;
  }

  /** Switches the terrain and the map bounds (default [0, size]²); snaps the focus height. */
  setTerrain(terrain: PickableTerrain, bounds?: MapBounds): void {
    const size = terrain.sizeWu;
    this.terrain = terrain;
    this.bounds = bounds ?? mapBoundsWU(0, 0, size);
    this.picker = new TerrainPicker(terrain);
    this.camera.maxDistance = maxDistanceForMap(size, this.camera.fovY);
    this.clamp();
    this.focusY = this.terrainHeightRaw();
    this.changed();
  }

  /** Centers the camera on the map. */
  centerOnMap(): void {
    const b = this.bounds;
    this.focusRaw((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
  }

  /** Moves the focus point to (x, z) raw (clamped); the focus height snaps to the terrain. */
  focusRaw(xRaw: number, zRaw: number): void {
    this.camera.targetX = xRaw;
    this.camera.targetZ = zRaw;
    this.clamp();
    this.focusY = this.terrainHeightRaw();
    this.changed();
  }

  /** Jumps to (x, z) raw, optionally with a new zoom distance (WU). */
  jumpTo(xRaw: number, zRaw: number, distance?: number): void {
    if (distance !== undefined) this.camera.distance = distance;
    this.focusRaw(xRaw, zRaw);
  }

  /** WU per CSS pixel at the focus point (vertical extent of the view at the zoom distance). */
  worldPerPixel(): number {
    const c = this.camera;
    return (2 * c.distance * Math.tan(c.fovY / 2)) / Math.max(1, c.viewportHeight);
  }

  /**
   * Per-frame update: keyboard pan (`axisX` −1 left … +1 right, `axisY` −1 back … +1 forward),
   * edge pan (same axes, own speed) and the focus-height smoothing. Call every frame.
   */
  update(dtMs: number, axisX: number, axisY: number, edgeX = 0, edgeY = 0): void {
    const c = this.camera;
    if (
      axisX === 0 &&
      axisY === 0 &&
      edgeX === 0 &&
      edgeY === 0 &&
      c.targetX === this.appliedX &&
      c.targetZ === this.appliedZ &&
      c.distance === this.appliedD &&
      c.yaw === this.appliedYaw &&
      this.pitchOffset === this.appliedOffset &&
      this.focusY === this.appliedFocusY &&
      this.focusY === this.focusWant &&
      this.terrain === this.appliedTerrain
    ) {
      return; // steady state: nothing to smooth, nothing moved
    }
    const dt = Math.min(Math.max(dtMs, 0), this.maxDtMs) / 1000;
    let moved = false;
    if (axisX !== 0 || axisY !== 0 || edgeX !== 0 || edgeY !== 0) {
      let kx = axisX;
      let ky = axisY;
      const kl = Math.hypot(kx, ky);
      if (kl > 1) {
        kx /= kl;
        ky /= kl;
      }
      let ex = edgeX;
      let ey = edgeY;
      const el = Math.hypot(ex, ey);
      if (el > 1) {
        ex /= el;
        ey /= el;
      }
      const vk = this.keyPanSpeed * c.distance * dt;
      const ve = this.edgePanSpeed * c.distance * dt;
      c.pan(kx * vk + ex * ve, ky * vk + ey * ve);
      this.clamp();
      moved = true;
    }
    // Focus height follows the terrain (exponential smoothing).
    const want =
      c.targetX === this.appliedX && c.targetZ === this.appliedZ && c.distance === this.appliedD && this.terrain === this.appliedTerrain
        ? this.focusWant
        : this.terrainHeightRaw();
    const diff = want - this.focusY;
    if (diff !== 0) {
      if (Math.abs(diff) < 0.5 || this.heightSmoothingMs <= 0) this.focusY = want;
      else this.focusY += diff * (1 - Math.exp(-(dt * 1000) / this.heightSmoothingMs));
      moved = true;
    }
    if (moved) this.changed();
    else this.apply();
  }

  /**
   * Drag pan by a mouse movement in CSS pixels without an anchor (fallback when no terrain point
   * is under the cursor): the view moves by the world size of a pixel at the focus.
   */
  panPixels(dxPx: number, dyPx: number): void {
    if (dxPx === 0 && dyPx === 0) return;
    const k = this.worldPerPixel();
    this.camera.pan(-dxPx * k, dyPx * k);
    this.clamp();
    this.changed();
  }

  /** Starts a middle-drag "grab": remembers the terrain point under the cursor. */
  grabStart(cssX: number, cssY: number): boolean {
    this.apply();
    this.grabbing = this.picker.pick(this.camera, cssX, cssY);
    if (this.grabbing) {
      this.grab[0] = this.picker.wuX;
      this.grab[1] = this.picker.wuY;
      this.grab[2] = this.picker.wuZ;
    }
    return this.grabbing;
  }

  /** Moves the view so the grabbed terrain point is under (cssX, cssY). */
  grabMove(cssX: number, cssY: number, dxPx = 0, dyPx = 0): void {
    if (!this.grabbing) {
      this.panPixels(dxPx, dyPx);
      return;
    }
    this.anchor(this.grab[0]!, this.grab[1]!, this.grab[2]!, cssX, cssY);
    this.changed();
  }

  grabEnd(): void {
    this.grabbing = false;
  }

  /** True while a grab is active. */
  get isGrabbing(): boolean {
    return this.grabbing;
  }

  /**
   * Zooms by `steps` wheel steps (positive = out) towards the terrain point under (cssX, cssY):
   * that point stays under the cursor (unless the distance limits or the map clamp intervene).
   */
  zoomAt(steps: number, cssX: number, cssY: number): void {
    if (steps === 0) return;
    const cam = this.camera;
    this.apply();
    const had = this.picker.pick(cam, cssX, cssY);
    const ax = this.picker.wuX;
    const ay = this.picker.wuY;
    const az = this.picker.wuZ;
    cam.zoom(Math.pow(this.zoomStep, steps));
    if (had) this.anchor(ax, ay, az, cssX, cssY);
    else {
      this.clamp();
      this.apply();
    }
    this.changed();
  }

  /** Rotation drag: horizontal → yaw around the focus, vertical → pitch offset (limited). */
  rotate(dxPx: number, dyPx: number): void {
    if (dxPx === 0 && dyPx === 0) return;
    this.camera.yaw += dxPx * this.rotateSpeed;
    const o = this.pitchOffset + dyPx * this.rotateSpeed;
    this.pitchOffset = o < -MAX_PITCH_OFFSET ? -MAX_PITCH_OFFSET : o > MAX_PITCH_OFFSET ? MAX_PITCH_OFFSET : o;
    this.changed();
  }

  /** Restores the default heading and removes the pitch offset. */
  resetRotation(): void {
    this.camera.yaw = this.defaultYaw;
    this.pitchOffset = 0;
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

  /** Pitch of the curve at `distance` (radians, without offset/clearance). */
  curvePitch(distance: number): number {
    const pc = this.pitchCurve;
    if (pc === null) return this.camera.pitch;
    const c = this.camera;
    const lo = Math.max(1e-3, c.minDistance);
    const hi = Math.max(lo * 1.0001, c.maxDistance);
    let t = Math.log(Math.max(lo, distance) / lo) / Math.log(hi / lo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const s = t * t * (3 - 2 * t);
    return pc.near + (pc.far - pc.near) * s;
  }

  /** Eye height above the terrain below the eye (WU) for the current view. */
  eyeClearance(): number {
    const c = this.camera;
    c.update();
    const ex = c.eyeRaw[0]! / RAW_PER_WU;
    const ez = c.eyeRaw[2]! / RAW_PER_WU;
    return c.eyeRaw[1]! / RAW_PER_WU - this.terrain.heightWU(ex, ez);
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
      clearance: this.eyeClearance(),
    };
  }

  /**
   * Applies the derived view state: pitch from the curve (+ offset), terrain clearance (pitch up,
   * then lift), `groundHeight` under the eye for the near plane, then `camera.update()`.
   */
  apply(): void {
    const c = this.camera;
    c.distance = Math.min(c.maxDistance, Math.max(c.minDistance, c.distance));
    let pitch = this.pitchCurve === null ? c.pitch : this.curvePitch(c.distance) + this.pitchOffset;
    pitch = Math.min(c.maxPitch, Math.max(c.minPitch, pitch));
    const d = c.distance;
    const ty = this.focusY / RAW_PER_WU;
    const need = MIN_EYE_CLEARANCE_WU;
    let ground = this.groundUnderEye(pitch);
    for (let i = 0; i < 4 && ty + d * Math.sin(pitch) < ground + need; i++) {
      const s = (ground + need - ty) / d;
      if (s >= Math.sin(c.maxPitch)) {
        pitch = c.maxPitch;
        ground = this.groundUnderEye(pitch);
        break;
      }
      // Slightly above the minimum so the next ground sample under the moved eye is covered.
      pitch = Math.max(pitch, Math.asin(Math.min(1, s)) + 0.5 * DEG);
      ground = this.groundUnderEye(pitch);
    }
    const eyeY = ty + d * Math.sin(pitch);
    const lift = eyeY < ground + need ? (ground + need - eyeY) * RAW_PER_WU : 0;
    c.targetY = this.focusY + lift;
    c.pitch = pitch;
    c.groundHeight = ground;
    c.update();
    if (c.targetX !== this.appliedX || c.targetZ !== this.appliedZ || c.distance !== this.appliedD || this.terrain !== this.appliedTerrain) {
      this.appliedX = c.targetX;
      this.appliedZ = c.targetZ;
      this.appliedD = c.distance;
      this.appliedTerrain = this.terrain;
      this.focusWant = this.terrainHeightRaw();
    }
    this.appliedYaw = c.yaw;
    this.appliedOffset = this.pitchOffset;
    this.appliedFocusY = this.focusY;
  }

  // ---- internals ------------------------------------------------------------------------------

  /**
   * Focus height (WU) at (x, z) WU for zoom distance `d`: the terrain low-passed with a 3 × 3
   * sample box of spacing r = clamp(0.05·d, 0.5, 24) WU. Cliffs thus become ramps for the camera
   * (smooth terrain following, well-posed zoom anchoring); the same function is the target of the
   * temporal smoothing, so an anchored zoom has no drift afterwards.
   */
  focusHeightWU(x: number, z: number, d: number = this.camera.distance): number {
    const r = Math.min(24, Math.max(0.5, 0.05 * d));
    const t = this.terrain;
    let sum = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) sum += t.heightWU(x + i * r, z + j * r) * (i === 0 ? 2 : 1) * (j === 0 ? 2 : 1);
    }
    return sum / 16;
  }

  /** Focus height (raw, float) at the focus xz. */
  private terrainHeightRaw(): number {
    const c = this.camera;
    return this.focusHeightWU(c.targetX / RAW_PER_WU, c.targetZ / RAW_PER_WU) * RAW_PER_WU;
  }

  private groundUnderEye(pitch: number): number {
    const c = this.camera;
    const h = c.distance * Math.cos(pitch);
    const ex = c.targetX / RAW_PER_WU - Math.cos(c.yaw) * h;
    const ez = c.targetZ / RAW_PER_WU - Math.sin(c.yaw) * h;
    return this.terrain.heightWU(ex, ez);
  }

  /**
   * Places the camera so that the world point A = (ax, ay, az) WU lies on the ray through
   * (cssX, cssY) with the current distance/orientation. The eye is `A − r·L` (r = the cursor ray
   * direction, which only depends on the orientation), the focus `eye + forward·d` must sit on the
   * focus-height surface: a 1D root in L, bracketed and bisected (robust at cliffs, where a
   * fixed-point iteration over the focus oscillates). Clearance may raise the pitch, which changes
   * r, so the solve is repeated (≤ 4 passes).
   */
  private anchor(ax: number, ay: number, az: number, cssX: number, cssY: number): void {
    const c = this.camera;
    const r = this.ray;
    const d = c.distance;
    for (let pass = 0; pass < 4; pass++) {
      this.apply();
      c.screenToRay(cssX, cssY, r);
      const rx = r.dir[0]!;
      const ry = r.dir[1]!;
      const rz = r.dir[2]!;
      if (ry > -1e-6) break; // cursor at/above the horizon: no anchor possible
      const fx = c.forward[0]! * d;
      const fy = c.forward[1]! * d;
      const fz = c.forward[2]! * d;
      const g = (L: number): number => ay - ry * L + fy - this.focusHeightWU(ax - rx * L + fx, az - rz * L + fz, d);
      // Start from the current eye distance to A.
      const ex = c.eyeRaw[0]! / RAW_PER_WU - ax;
      const ey = c.eyeRaw[1]! / RAW_PER_WU - ay;
      const ez = c.eyeRaw[2]! / RAW_PER_WU - az;
      let L = Math.max(1e-3, Math.hypot(ex, ey, ez));
      let lo = L;
      let hi = L;
      let glo = g(lo);
      let ghi = glo;
      let step = Math.max(0.5, 0.1 * L);
      for (let k = 0; k < 60 && glo > 0; k++) {
        hi = lo;
        ghi = glo;
        lo = Math.max(0, lo - step);
        glo = g(lo);
        step *= 1.6;
        if (lo === 0) break;
      }
      for (let k = 0; k < 60 && ghi < 0; k++) {
        lo = hi;
        glo = ghi;
        hi += step;
        ghi = g(hi);
        step *= 1.6;
      }
      if (glo > 0 || ghi < 0) break; // no bracket (should not happen)
      for (let k = 0; k < 60 && hi - lo > 1e-7; k++) {
        const m = 0.5 * (lo + hi);
        if (g(m) > 0) hi = m;
        else lo = m;
      }
      L = 0.5 * (lo + hi);
      c.targetX = (ax - rx * L + fx) * RAW_PER_WU;
      c.targetZ = (az - rz * L + fz) * RAW_PER_WU;
      this.clamp();
      this.focusY = this.terrainHeightRaw();
      const pitchBefore = c.pitch;
      this.apply();
      if (Math.abs(c.pitch - pitchBefore) < 1e-9) break;
    }
    this.clamp();
    this.focusY = this.terrainHeightRaw();
    this.apply();
  }

  private changed(): void {
    this.apply();
    this.version++;
  }
}
