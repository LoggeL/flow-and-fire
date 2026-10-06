/**
 * CPU side of the cascaded shadow maps (float64 math, GL-free, unit-testable). Ported from the SPK4
 * prototype (tools/render-bench/src/proto/shadows.ts `CascadeFitter`, DECISIONS 17) and decoupled
 * from terrain/props/units:
 *
 * - Cascades are fitted to view-depth slices of the camera frustum (practical split scheme with
 *   λ = 0.55) up to a shadow distance that follows the zoom (capped by `maxDistanceWu`).
 * - Each cascade owns a CACHED light box: centre snapped to its texel grid, half extent = needed
 *   sphere radius × headroom. The box (and with it the static layer) is refitted only when the needed
 *   sphere leaves the box, when the sphere shrank below 1/headroom² of the box (quality) or when the
 *   sun direction / caster bounds change.
 * - Casters work in integers relative to the cascade anchor (`ivec3(pos) − anchor`), receivers get a
 *   matrix from camera-relative space: precision is independent of the map position.
 */
import { Frustum, RAW_PER_WU } from '@faf/render';
import type { RtsCamera } from '@faf/render';
import { mat4 } from 'gl-matrix';

const INV_RAW = 1 / RAW_PER_WU;

export const MAX_CASCADES = 2;

export interface CascadeFitOptions {
  /** Shadow map size in texels (square). */
  readonly size: number;
  readonly cascades: 1 | 2;
  /** Practical split weight: 1 = logarithmic, 0 = uniform (default 0.55). */
  readonly lambda: number;
  /** Cached box half extent / needed sphere radius (> 1, default 1.4). */
  readonly headroom: number;
  /** Upper bound of the shadow distance (view depth, WU). */
  readonly maxDistanceWu: number;
  /** Smallest cascade sphere radius (WU). */
  readonly minRadiusWu: number;
  /** World AABB (WU) containing every possible caster: defines the light depth range. */
  readonly worldMin: readonly [number, number, number];
  readonly worldMax: readonly [number, number, number];
}

export interface Cascade {
  /** Box fitted at least once (matrices valid). */
  valid: boolean;
  /** Needed sphere radius at the last refit (WU). */
  radius: number;
  /** Half extent of the cached light box (WU). */
  half: number;
  /** Light-space centre (WU) of the cached box, snapped to the texel grid. */
  cx: number;
  cy: number;
  /** Anchor of the caster space (raw Q20.12 ints, world). */
  readonly anchor: Int32Array;
  /** Anchor-relative WU → light clip space. */
  readonly lightVP: Float64Array;
  readonly lightVP32: Float32Array;
  /** Planes of the light box in anchor-relative WU (caster culling). */
  readonly frustum: Frustum;
  /** Texel size in WU. */
  texelWu: number;
  /** Incremented on each refit. */
  version: number;
}

/** Split depths: `out[0] = near`, `out[i] = practical split i`, `out[count] = end`. */
export function cascadeSplits(near: number, end: number, count: number, lambda: number, out: Float64Array = new Float64Array(count + 1)): Float64Array {
  out[0] = near;
  for (let i = 1; i < count; i++) {
    const f = i / count;
    const log = near * Math.pow(end / near, f);
    const uni = near + (end - near) * f;
    out[i] = lambda * log + (1 - lambda) * uni;
  }
  out[count] = end;
  return out;
}

/** Near end of the shadowed view-depth range (WU). */
export function shadowNear(cam: RtsCamera): number {
  return Math.max(0.05, cam.near);
}

/** Far end of the shadowed view-depth range (WU): follows the zoom, capped by `maxDistanceWu`. */
export function shadowEnd(cam: RtsCamera, maxDistanceWu: number): number {
  const near = shadowNear(cam);
  return Math.max(near * 2, Math.min(cam.far, cam.distance * 2.4 + 30, maxDistanceWu));
}

export class CascadeFitter {
  readonly cascades: Cascade[] = [];
  /** Light travel direction (from the sun), light-space x/y axes. */
  readonly dir = new Float64Array(3);
  readonly lx = new Float64Array(3);
  readonly ly = new Float64Array(3);
  /** View depths: [near, split(s)…, end]. */
  readonly splits: Float64Array;
  /** Box refits in total (all cascades). */
  refits = 0;
  /** Bit c set = cascade c was refitted by the last {@link update}. */
  lastRefit = 0;
  private readonly sun = new Float64Array([Number.NaN, 0, 0]);
  private readonly corners = new Float64Array(24);
  private readonly tmp = new Float64Array(16);
  private readonly view = new Float64Array(16);
  private readonly proj = new Float64Array(16);
  private readonly sphere = new Float64Array(4);
  private worldMin: [number, number, number];
  private worldMax: [number, number, number];

  constructor(readonly opts: CascadeFitOptions) {
    if (opts.cascades !== 1 && opts.cascades !== 2) throw new RangeError('CascadeFitter: cascades must be 1 or 2');
    if (!(opts.headroom > 1)) throw new RangeError('CascadeFitter: headroom must be > 1');
    if (!(opts.lambda >= 0 && opts.lambda <= 1)) throw new RangeError('CascadeFitter: lambda must be in [0, 1]');
    this.worldMin = [opts.worldMin[0], opts.worldMin[1], opts.worldMin[2]];
    this.worldMax = [opts.worldMax[0], opts.worldMax[1], opts.worldMax[2]];
    this.splits = new Float64Array(opts.cascades + 1);
    for (let c = 0; c < opts.cascades; c++) {
      this.cascades.push({
        valid: false,
        radius: 0,
        half: 0,
        cx: 0,
        cy: 0,
        anchor: new Int32Array(3),
        lightVP: new Float64Array(16),
        lightVP32: new Float32Array(16),
        frustum: new Frustum(),
        texelWu: 1,
        version: 0,
      });
    }
  }

  /** Forces a refit of every cascade on the next update (e.g. new caster bounds). */
  invalidate(): void {
    for (const c of this.cascades) c.valid = false;
  }

  setWorldBounds(min: readonly [number, number, number], max: readonly [number, number, number]): void {
    this.worldMin = [min[0], min[1], min[2]];
    this.worldMax = [max[0], max[1], max[2]];
    this.invalidate();
  }

  /**
   * Fits the cascades to the camera and refits cached boxes where needed. `sunDir` points TOWARDS the
   * sun (like @faf/render's `u_sunDir`). Returns the refit bit mask (bit c = cascade c refitted).
   */
  update(cam: RtsCamera, sunDir: readonly [number, number, number] | ArrayLike<number>): number {
    this.setSun(sunDir);
    const near = shadowNear(cam);
    const end = shadowEnd(cam, this.opts.maxDistanceWu);
    const n = this.cascades.length;
    cascadeSplits(near, end, n, this.opts.lambda, this.splits);
    let refit = 0;
    for (let c = 0; c < n; c++) {
      const cas = this.cascades[c]!;
      this.sliceSphere(cam, this.splits[c]!, this.splits[c + 1]!);
      const s = this.sphere;
      const r = Math.max(s[3]!, this.opts.minRadiusWu);
      const wx = cam.camPosInt[0]! * INV_RAW + s[0]!;
      const wy = cam.camPosInt[1]! * INV_RAW + s[1]!;
      const wz = cam.camPosInt[2]! * INV_RAW + s[2]!;
      const cx = wx * this.lx[0]! + wy * this.lx[1]! + wz * this.lx[2]!;
      const cy = wx * this.ly[0]! + wy * this.ly[1]! + wz * this.ly[2]!;
      if (cas.valid && this.fits(cas, cx, cy, r)) continue;
      this.refit(cas, cx, cy, wx * this.dir[0]! + wy * this.dir[1]! + wz * this.dir[2]!, r);
      refit |= 1 << c;
      this.refits++;
    }
    this.lastRefit = refit;
    return refit;
  }

  /** True when the sphere (light-space centre cx/cy, radius r) is served by the cached box. */
  fits(cas: Cascade, cx: number, cy: number, r: number): boolean {
    const h = this.opts.headroom;
    const inside = Math.max(Math.abs(cx - cas.cx), Math.abs(cy - cas.cy)) + r <= cas.half;
    const notTooSmall = r * h * h >= cas.half;
    return inside && notTooSmall;
  }

  /**
   * Receiver matrix of cascade c: camera-relative WU (origin = camPosInt) → shadow texture space
   * [0, 1]³ (translation to anchor-relative space, light view-projection, bias).
   */
  receiverMatrix(c: number, camPosInt: ArrayLike<number>, out: Float32Array, offset = 0): void {
    const cas = this.cascades[c]!;
    const m = this.tmp;
    m.set(cas.lightVP);
    const ox = (camPosInt[0]! - cas.anchor[0]!) * INV_RAW;
    const oy = (camPosInt[1]! - cas.anchor[1]!) * INV_RAW;
    const oz = (camPosInt[2]! - cas.anchor[2]!) * INV_RAW;
    for (let i = 0; i < 4; i++) m[12 + i] = m[i]! * ox + m[4 + i]! * oy + m[8 + i]! * oz + m[12 + i]!;
    for (let col = 0; col < 4; col++) {
      const w = m[col * 4 + 3]!;
      for (let i = 0; i < 3; i++) out[offset + col * 4 + i] = 0.5 * m[col * 4 + i]! + 0.5 * w;
      out[offset + col * 4 + 3] = w;
    }
  }

  /** Bounding sphere (centre relative to camPosInt in WU, radius) of the last fitted slice of cascade c. */
  sliceSphereOf(cam: RtsCamera, c: number): Float64Array {
    this.sliceSphere(cam, this.splits[c]!, this.splits[c + 1]!);
    return this.sphere;
  }

  private setSun(sunDir: ArrayLike<number>): void {
    const l = Math.hypot(sunDir[0]!, sunDir[1]!, sunDir[2]!) || 1;
    const x = sunDir[0]! / l;
    const y = sunDir[1]! / l;
    const z = sunDir[2]! / l;
    const s = this.sun;
    if (s[0] === x && s[1] === y && s[2] === z) return;
    s[0] = x;
    s[1] = y;
    s[2] = z;
    const d = this.dir;
    d[0] = -x;
    d[1] = -y;
    d[2] = -z;
    // lx = normalize(cross(dir, up)), ly = cross(lx, dir)
    const ux = 0;
    const uy = Math.abs(d[1]!) > 0.99 ? 0 : 1;
    const uz = Math.abs(d[1]!) > 0.99 ? 1 : 0;
    let x0 = d[1]! * uz - d[2]! * uy;
    let x1 = d[2]! * ux - d[0]! * uz;
    let x2 = d[0]! * uy - d[1]! * ux;
    const xl = Math.hypot(x0, x1, x2) || 1;
    x0 /= xl;
    x1 /= xl;
    x2 /= xl;
    this.lx[0] = x0;
    this.lx[1] = x1;
    this.lx[2] = x2;
    this.ly[0] = x1 * d[2]! - x2 * d[1]!;
    this.ly[1] = x2 * d[0]! - x0 * d[2]!;
    this.ly[2] = x0 * d[1]! - x1 * d[0]!;
    this.invalidate();
  }

  /** Bounding sphere of the frustum slice [d0, d1] (view depth), centre relative to camPosInt. */
  private sliceSphere(cam: RtsCamera, d0: number, d1: number): void {
    const fw = cam.forward;
    const fx = fw[0]!;
    const fy = fw[1]!;
    const fz = fw[2]!;
    let rx = -fz;
    let rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    // up = cross(right, forward) with right = (rx, 0, rz)
    const ux = -rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy;
    const tanY = Math.tan(cam.fovY / 2);
    const tanX = tanY * (cam.viewportWidth / cam.viewportHeight);
    const e = cam.camFrac;
    const k = this.corners;
    let i = 0;
    for (let di = 0; di < 2; di++) {
      const d = di === 0 ? d0 : d1;
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sx = -1; sx <= 1; sx += 2) {
          k[i++] = e[0]! + d * (fx + rx * sx * tanX + ux * sy * tanY);
          k[i++] = e[1]! + d * (fy + uy * sy * tanY);
          k[i++] = e[2]! + d * (fz + rz * sx * tanX + uz * sy * tanY);
        }
      }
    }
    let mx = 0;
    let my = 0;
    let mz = 0;
    for (let j = 0; j < 8; j++) {
      mx += k[j * 3]!;
      my += k[j * 3 + 1]!;
      mz += k[j * 3 + 2]!;
    }
    mx /= 8;
    my /= 8;
    mz /= 8;
    let r = 0;
    for (let j = 0; j < 8; j++) r = Math.max(r, Math.hypot(k[j * 3]! - mx, k[j * 3 + 1]! - my, k[j * 3 + 2]! - mz));
    const s = this.sphere;
    s[0] = mx;
    s[1] = my;
    s[2] = mz;
    s[3] = r;
  }

  private refit(cas: Cascade, cx: number, cy: number, cz: number, r: number): void {
    const half = r * this.opts.headroom;
    const texel = (2 * half) / this.opts.size;
    const sx = Math.round(cx / texel) * texel;
    const sy = Math.round(cy / texel) * texel;
    cas.valid = true;
    cas.radius = r;
    cas.half = half;
    cas.cx = sx;
    cas.cy = sy;
    cas.texelWu = texel;
    const lx = this.lx;
    const ly = this.ly;
    const d = this.dir;
    const ax = sx * lx[0]! + sy * ly[0]! + cz * d[0]!;
    const ay = sx * lx[1]! + sy * ly[1]! + cz * d[1]!;
    const az = sx * lx[2]! + sy * ly[2]! + cz * d[2]!;
    cas.anchor[0] = Math.round(ax * RAW_PER_WU);
    cas.anchor[1] = Math.round(ay * RAW_PER_WU);
    cas.anchor[2] = Math.round(az * RAW_PER_WU);
    const oax = cas.anchor[0]! * INV_RAW;
    const oay = cas.anchor[1]! * INV_RAW;
    const oaz = cas.anchor[2]! * INV_RAW;
    // The exact anchor misses the snapped centre by < 1 raw; shift the ortho box so the box centre
    // stays on the texel grid (stable texel footprint across refits).
    const offX = sx - (oax * lx[0]! + oay * lx[1]! + oaz * lx[2]!);
    const offY = sy - (oax * ly[0]! + oay * ly[1]! + oaz * ly[2]!);
    // Depth range: every caster inside the world bounds.
    let zmin = Infinity;
    let zmax = -Infinity;
    const lo = this.worldMin;
    const hi = this.worldMax;
    for (let i = 0; i < 8; i++) {
      const px = (i & 1 ? hi[0] : lo[0]) - oax;
      const py = (i & 2 ? hi[1] : lo[1]) - oay;
      const pz = (i & 4 ? hi[2] : lo[2]) - oaz;
      const depth = px * d[0]! + py * d[1]! + pz * d[2]!;
      zmin = Math.min(zmin, depth);
      zmax = Math.max(zmax, depth);
    }
    // Receivers inside the needed sphere must be covered as well.
    zmin = Math.min(zmin, -half);
    zmax = Math.max(zmax, half);
    const v = this.view;
    v.fill(0);
    v[0] = lx[0]!;
    v[4] = lx[1]!;
    v[8] = lx[2]!;
    v[1] = ly[0]!;
    v[5] = ly[1]!;
    v[9] = ly[2]!;
    v[2] = -d[0]!;
    v[6] = -d[1]!;
    v[10] = -d[2]!;
    v[15] = 1;
    mat4.ortho(this.proj, offX - half, offX + half, offY - half, offY + half, zmin - 2, zmax + 2);
    mat4.multiply(cas.lightVP, this.proj, v);
    for (let i = 0; i < 16; i++) cas.lightVP32[i] = cas.lightVP[i]!;
    cas.frustum.setFromViewProj(cas.lightVP);
    cas.version++;
  }
}
