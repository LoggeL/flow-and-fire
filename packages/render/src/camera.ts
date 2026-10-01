/**
 * RTS camera math (PLAN §3.7).
 *
 * Positions are Q20.12 raw values (1 WU = 4096 raw). The eye position is split into an exact
 * integer part `camPosInt` (raw, int32) and a sub-raw float rest `camFrac` (WU). Shaders compute
 * `rel = ivec3(pos) − camPosInt` in integers and only then convert `vec3(rel) / 4096.0`, so the
 * view/projection matrices always work near the origin and precision does not depend on where the
 * camera is on the map (exact up to 81 km).
 *
 * World axes: x east, y up (height), z south. `yaw` is the heading of the view direction on the
 * ground plane: forward = (cos yaw, 0, sin yaw) — the same convention as Ang16 (0 = +x, towards +z).
 * `pitch` is the angle below the horizon.
 */
import { mat4 } from 'gl-matrix';

export const RAW_PER_WU = 4096;
const INV_RAW = 1 / RAW_PER_WU;

/** Dynamic near plane (PLAN §3.7): `clamp(height · NEAR_PER_HEIGHT, NEAR_MIN_WU, NEAR_MAX_WU)`. */
export const NEAR_PER_HEIGHT = 0.02;
export const NEAR_MIN_WU = 0.05;
export const NEAR_MAX_WU = 32;
const MAX_FAR = 60000;

/** Near plane (WU) for an eye height above the ground (WU), see {@link NEAR_PER_HEIGHT}. */
export function nearPlaneForHeight(heightWU: number): number {
  const n = heightWU * NEAR_PER_HEIGHT;
  return n < NEAR_MIN_WU || Number.isNaN(n) ? NEAR_MIN_WU : n > NEAR_MAX_WU ? NEAR_MAX_WU : n;
}

export interface Ray {
  /** Absolute world position in WU (float64). */
  readonly origin: Float64Array;
  /** Normalized direction. */
  readonly dir: Float64Array;
}

export function createRay(): Ray {
  return { origin: new Float64Array(3), dir: new Float64Array(3) };
}

export interface CameraOptions {
  fovY?: number;
  pitch?: number;
  yaw?: number;
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  minPitch?: number;
  maxPitch?: number;
}

export class RtsCamera {
  /** Focus point (raw Q20.12, may carry fractions during smooth motion). */
  targetX = 0;
  targetY = 0;
  targetZ = 0;
  /** Heading of the view direction in radians (see module doc). Default looks towards −z. */
  yaw: number;
  /** Angle below the horizon in radians. */
  pitch: number;
  /** Eye distance from the target in WU. */
  distance: number;
  /** Vertical field of view in radians. */
  fovY: number;
  minDistance: number;
  maxDistance: number;
  minPitch: number;
  maxPitch: number;
  /** Ground height (WU) used for the dynamic near plane (flat test plane: 0). */
  groundHeight = 0;
  /**
   * Map edge length (WU, 0 = unknown). The far plane then always reaches the farthest map corner
   * (strategic zoom over the whole map, up to 4,096 WU). The renderer sets it from its terrain.
   */
  mapSizeWU = 0;

  /** Viewport in CSS pixels. */
  viewportWidth = 1;
  viewportHeight = 1;

  // ---- derived by update() ----
  /** Exact integer part of the eye position (raw). */
  readonly camPosInt = new Int32Array(3);
  /** Eye position minus camPosInt, in WU (each component in [0, 1/4096)). */
  readonly camFrac = new Float64Array(3);
  /** Absolute eye position in raw units (float64). */
  readonly eyeRaw = new Float64Array(3);
  /** Unit view direction. */
  readonly forward = new Float64Array(3);
  near = 1;
  far = 1000;
  /** Height of the eye above `groundHeight` (WU). */
  height = 0;
  /** Camera-relative matrices (origin = camPosInt), float64. */
  readonly view = new Float64Array(16);
  readonly proj = new Float64Array(16);
  readonly viewProj = new Float64Array(16);
  readonly invViewProj = new Float64Array(16);
  /** Float32 copy of `viewProj` for UBO upload. */
  readonly viewProj32 = new Float32Array(16);
  /** Incremented whenever update() produced a different view (render-side caching). */
  version = 0;

  private readonly tmp4 = new Float64Array(4);
  private readonly eyeRel = new Float64Array(3);
  private readonly center = new Float64Array(3);
  private readonly up = new Float64Array([0, 1, 0]);
  private lastKey = new Float64Array(11).fill(Number.NaN);

  constructor(opts: CameraOptions = {}) {
    this.fovY = opts.fovY ?? (45 * Math.PI) / 180;
    this.pitch = opts.pitch ?? (55 * Math.PI) / 180;
    this.yaw = opts.yaw ?? -Math.PI / 2;
    this.distance = opts.distance ?? 80;
    this.minDistance = opts.minDistance ?? 6;
    this.maxDistance = opts.maxDistance ?? 1500;
    this.minPitch = opts.minPitch ?? (15 * Math.PI) / 180;
    this.maxPitch = opts.maxPitch ?? (89 * Math.PI) / 180;
    this.update();
  }

  setViewport(cssWidth: number, cssHeight: number): void {
    this.viewportWidth = Math.max(1, cssWidth);
    this.viewportHeight = Math.max(1, cssHeight);
  }

  /** Sets the focus point in WU. */
  setTargetWU(x: number, y: number, z: number): void {
    this.targetX = x * RAW_PER_WU;
    this.targetY = y * RAW_PER_WU;
    this.targetZ = z * RAW_PER_WU;
  }

  /** Pans in screen-aligned ground directions (WU): +right, +forward (up on screen). */
  pan(rightWU: number, forwardWU: number): void {
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    // forward = (c, s), right = forward rotated −90° around +y = (−s, c)
    this.targetX += (c * forwardWU - s * rightWU) * RAW_PER_WU;
    this.targetZ += (s * forwardWU + c * rightWU) * RAW_PER_WU;
  }

  /** Multiplies the distance by `factor` (clamped). */
  zoom(factor: number): void {
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * factor));
  }

  rotate(dYaw: number, dPitch = 0): void {
    this.yaw += dYaw;
    this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + dPitch));
  }

  /** Recomputes the eye split, near/far and all matrices. Cheap; skips work when nothing changed. */
  update(): void {
    this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch));
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance));
    const k = this.lastKey;
    if (
      k[0] === this.targetX &&
      k[1] === this.targetY &&
      k[2] === this.targetZ &&
      k[3] === this.yaw &&
      k[4] === this.pitch &&
      k[5] === this.distance &&
      k[6] === this.fovY &&
      k[7] === this.viewportWidth &&
      k[8] === this.viewportHeight &&
      k[9] === this.groundHeight &&
      k[10] === this.mapSizeWU
    ) {
      return;
    }
    k[0] = this.targetX;
    k[1] = this.targetY;
    k[2] = this.targetZ;
    k[3] = this.yaw;
    k[4] = this.pitch;
    k[5] = this.distance;
    k[6] = this.fovY;
    k[7] = this.viewportWidth;
    k[8] = this.viewportHeight;
    k[9] = this.groundHeight;
    k[10] = this.mapSizeWU;

    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const fx = cp * Math.cos(this.yaw);
    const fy = -sp;
    const fz = cp * Math.sin(this.yaw);
    this.forward[0] = fx;
    this.forward[1] = fy;
    this.forward[2] = fz;
    const dRaw = this.distance * RAW_PER_WU;
    const ex = this.targetX - fx * dRaw;
    const ey = this.targetY - fy * dRaw;
    const ez = this.targetZ - fz * dRaw;
    this.eyeRaw[0] = ex;
    this.eyeRaw[1] = ey;
    this.eyeRaw[2] = ez;
    splitRaw(ex, this.camPosInt, this.camFrac, 0);
    splitRaw(ey, this.camPosInt, this.camFrac, 1);
    splitRaw(ez, this.camPosInt, this.camFrac, 2);

    // Dynamic near plane from the camera height (PLAN §3.7).
    this.height = ey * INV_RAW - this.groundHeight;
    const h = Math.max(this.height, NEAR_MIN_WU);
    this.near = nearPlaneForHeight(h);
    const lowest = Math.max(this.pitch - this.fovY / 2, 0.05);
    let far = Math.max(this.near * 20, (h / Math.sin(lowest)) * 1.5 + this.distance);
    const map = this.mapSizeWU;
    if (map > 0) {
      // Farthest map corner (ground level) plus margin: the whole map stays inside the frustum depth.
      const exw = ex * INV_RAW;
      const ezw = ez * INV_RAW;
      const dx = Math.max(Math.abs(exw), Math.abs(exw - map));
      const dz = Math.max(Math.abs(ezw), Math.abs(ezw - map));
      far = Math.max(far, Math.hypot(dx, dz, h + 64) * 1.05 + 16);
    }
    this.far = Math.min(MAX_FAR, far);

    const eye = this.eyeRel;
    eye[0] = this.camFrac[0]!;
    eye[1] = this.camFrac[1]!;
    eye[2] = this.camFrac[2]!;
    const center = this.center;
    center[0] = eye[0] + fx;
    center[1] = eye[1] + fy;
    center[2] = eye[2] + fz;
    mat4.lookAt(this.view, eye, center, this.up);
    mat4.perspective(this.proj, this.fovY, this.viewportWidth / this.viewportHeight, this.near, this.far);
    mat4.multiply(this.viewProj, this.proj, this.view);
    if (mat4.invert(this.invViewProj, this.viewProj) === null) this.invViewProj.fill(0);
    for (let i = 0; i < 16; i++) this.viewProj32[i] = this.viewProj[i]!;
    this.version++;
  }

  /**
   * Projects a world point (raw Q20.12) to CSS pixels (top-left origin). `out = [x, y, ndcZ, clipW]`.
   * Returns false if the point is behind the camera.
   */
  project(xRaw: number, yRaw: number, zRaw: number, out: Float64Array): boolean {
    // Same order as the shader: integer difference first, then scale.
    const rx = (xRaw - this.camPosInt[0]!) * INV_RAW;
    const ry = (yRaw - this.camPosInt[1]!) * INV_RAW;
    const rz = (zRaw - this.camPosInt[2]!) * INV_RAW;
    const m = this.viewProj;
    const cx = m[0]! * rx + m[4]! * ry + m[8]! * rz + m[12]!;
    const cy = m[1]! * rx + m[5]! * ry + m[9]! * rz + m[13]!;
    const cz = m[2]! * rx + m[6]! * ry + m[10]! * rz + m[14]!;
    const cw = m[3]! * rx + m[7]! * ry + m[11]! * rz + m[15]!;
    const iw = cw !== 0 ? 1 / cw : 0;
    out[0] = (cx * iw * 0.5 + 0.5) * this.viewportWidth;
    out[1] = (0.5 - cy * iw * 0.5) * this.viewportHeight;
    out[2] = cz * iw;
    out[3] = cw;
    return cw > 0;
  }

  /** Ray through a CSS pixel. Origin on the near plane in absolute WU, unit direction. */
  screenToRay(x: number, y: number, out: Ray = createRay()): Ray {
    const nx = (x / this.viewportWidth) * 2 - 1;
    const ny = 1 - (y / this.viewportHeight) * 2;
    const p = this.tmp4;
    unproject(this.invViewProj, nx, ny, -1, p);
    const ax = p[0]!;
    const ay = p[1]!;
    const az = p[2]!;
    unproject(this.invViewProj, nx, ny, 1, p);
    let dx = p[0]! - ax;
    let dy = p[1]! - ay;
    let dz = p[2]! - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    out.origin[0] = this.camPosInt[0]! * INV_RAW + ax;
    out.origin[1] = this.camPosInt[1]! * INV_RAW + ay;
    out.origin[2] = this.camPosInt[2]! * INV_RAW + az;
    out.dir[0] = dx;
    out.dir[1] = dy;
    out.dir[2] = dz;
    return out;
  }
}

/** Splits a raw coordinate into an exact int32 part and a WU remainder. */
function splitRaw(v: number, ints: Int32Array, frac: Float64Array, i: number): void {
  const f = Math.floor(v);
  if (f > 2147483647 || f < -2147483648) throw new RangeError(`camera coordinate ${v} outside int32 raw range`);
  ints[i] = f;
  frac[i] = (v - f) * INV_RAW;
}

function unproject(inv: Float64Array, x: number, y: number, z: number, out: Float64Array): void {
  const X = inv[0]! * x + inv[4]! * y + inv[8]! * z + inv[12]!;
  const Y = inv[1]! * x + inv[5]! * y + inv[9]! * z + inv[13]!;
  const Z = inv[2]! * x + inv[6]! * y + inv[10]! * z + inv[14]!;
  const W = inv[3]! * x + inv[7]! * y + inv[11]! * z + inv[15]!;
  const iw = W !== 0 ? 1 / W : 0;
  out[0] = X * iw;
  out[1] = Y * iw;
  out[2] = Z * iw;
}

/**
 * Intersects a ray with the horizontal plane y = `heightWU`. Writes `[x, z]` in WU and returns
 * true when the plane is hit in front of the origin.
 */
export function intersectGround(ray: Ray, heightWU: number, out: Float64Array): boolean {
  const dy = ray.dir[1]!;
  if (dy > -1e-9) return false;
  const t = (heightWU - ray.origin[1]!) / dy;
  if (t < 0) return false;
  out[0] = ray.origin[0]! + ray.dir[0]! * t;
  out[1] = ray.origin[2]! + ray.dir[2]! * t;
  return true;
}
