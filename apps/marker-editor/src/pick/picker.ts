/**
 * Terrain picking and marker hit tests of the editor (TRACK-EDITOR P4).
 *
 * TerrainPicker.pick casts the camera ray through a client pixel and marches it over the
 * heightfield exactly as the sim samples it (view.heightWuAt → @faf/rules sampleHeightRaw,
 * bilinear): steps of at most 0.5 WU horizontally, shortened by a Lipschitz bound of the terrain
 * (steepest sample step) so a grazing ray cannot tunnel through a ridge, then a fine re-march
 * (1/32 WU) inside the bracket and bisection to <= 1/4096 WU. Results are Fx raw integers
 * (Math.round(wu · 4096)); null outside the map or when the ray misses the terrain.
 */
import { propFieldContains, type RtsMap } from '@faf/formats';
import * as THREE from 'three';
import { outlineCenterWu, pointsToWu, polygonAreaWu } from '../overlay/geometry.ts';
import { FX, SIZES, wuPerPixel } from '../overlay/style.ts';
import { fieldSelected, type MarkerRef, type OverlayView, type ViewMarkers } from '../overlay/types.ts';

/** Horizontal march step (WU): the MS2 requirement is <= 0.5 WU. */
export const PICK_STEP_WU = 0.5;
/** Horizontal re-march step inside a bracket (WU). */
const FINE_STEP_WU = 1 / 32;
/** Bisection stops below this horizontal interval (WU); the requirement is <= 1/64 WU. */
export const PICK_TOLERANCE_WU = 1 / 4096;
/**
 * Smallest adaptive step (WU horizontally) near the surface: the resolution of sampleHeightRaw
 * (x/z are quantized to 1/256 WU), so only slivers thinner than one height cell can be skipped.
 */
const MIN_STEP_WU = 1 / 256;

/** Per-map terrain bounds for the ray march. */
interface TerrainBounds {
  readonly map: RtsMap;
  readonly minWu: number;
  readonly maxWu: number;
  /** Upper bound of |dh/dx|, |dh/dz| in WU per WU (steepest neighbouring sample step). */
  readonly slope: number;
}

function terrainBounds(map: RtsMap): TerrainBounds {
  const h = map.heights;
  const dim = map.meta.sizeWu + 1;
  const s = map.meta.heightScaleRaw / FX;
  let lo = 65535;
  let hi = 0;
  let steep = 0;
  for (let z = 0; z < dim; z++) {
    const row = z * dim;
    for (let x = 0; x < dim; x++) {
      const v = h[row + x]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (x + 1 < dim) {
        const d = Math.abs(h[row + x + 1]! - v);
        if (d > steep) steep = d;
      }
      if (z + 1 < dim) {
        const d = Math.abs(h[row + dim + x]! - v);
        if (d > steep) steep = d;
      }
    }
  }
  return { map, minWu: lo * s, maxWu: hi * s, slope: steep * s };
}

/** Normalized device coordinates of a client pixel, or null for an empty canvas. */
function toNdc(view: OverlayView, clientX: number, clientY: number, out: THREE.Vector2): THREE.Vector2 | null {
  const r = view.canvas.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return out.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
}

export class TerrainPicker {
  private readonly view: OverlayView;
  private bounds: TerrainBounds | null = null;
  private readonly ray = new THREE.Ray();
  private readonly ndc = new THREE.Vector2();
  private readonly v = new THREE.Vector3();

  constructor(view: OverlayView) {
    this.view = view;
  }

  /** Map point (Fx raw) under the client pixel, or null outside the map / no terrain hit. */
  pick(clientX: number, clientY: number): { x: number; z: number } | null {
    const w = this.pickWu(clientX, clientY);
    return w === null ? null : { x: Math.round(w.x * FX), z: Math.round(w.z * FX) };
  }

  /** Like pick(), in WU with the hit height (y), unrounded. */
  pickWu(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const map = this.view.map;
    if (map === null) return null;
    if (this.bounds?.map !== map) this.bounds = terrainBounds(map);
    const b = this.bounds;
    if (!this.cameraRay(clientX, clientY)) return null;
    const o = this.ray.origin;
    const d = this.ray.direction;
    const size = map.meta.sizeWu;

    // Clip the ray to the map box [0,size] × [minH, maxH] × [0,size].
    let t0 = 0;
    let t1 = Infinity;
    const slab = (orig: number, dir: number, lo: number, hi: number): boolean => {
      if (Math.abs(dir) < 1e-12) return orig >= lo && orig <= hi;
      let a = (lo - orig) / dir;
      let c = (hi - orig) / dir;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      return t0 <= t1;
    };
    const eps = 1e-6;
    if (!slab(o.x, d.x, 0, size) || !slab(o.z, d.z, 0, size) || !slab(o.y, d.y, b.minWu - eps, b.maxWu + eps)) return null;

    const hAt = (t: number): number => o.y + d.y * t - this.view.heightWuAt(o.x + d.x * t, o.z + d.z * t);
    const horiz = Math.hypot(d.x, d.z);
    // Parameter steps for the horizontal limits (vertical rays: the whole box at once).
    const maxDt = horiz > 1e-9 ? PICK_STEP_WU / horiz : t1 - t0;
    const minDt = horiz > 1e-9 ? MIN_STEP_WU / horiz : (t1 - t0) / 64;
    // f(t) = ray height − terrain height falls at most this fast per unit t.
    const fall = Math.abs(d.y) + b.slope * (Math.abs(d.x) + Math.abs(d.z));

    let ta = t0;
    let fa = hAt(ta);
    if (fa <= 0) {
      // The ray enters the box below the surface: only a hit right at the entry counts (camera
      // above the map looking down through the top face).
      return fa > -1e-4 ? this.point(ta) : null;
    }
    while (ta < t1) {
      const safe = fall > 0 ? fa / fall : maxDt;
      const tb = Math.min(t1, ta + Math.min(maxDt, Math.max(minDt, safe)));
      const fb = hAt(tb);
      if (fb <= 0) return this.point(this.refine(hAt, ta, tb, horiz));
      ta = tb;
      fa = fb;
      if (tb >= t1) break;
    }
    return null;
  }

  /** First sign change of f in (ta, tb] (fine re-march), then bisection. */
  private refine(f: (t: number) => number, ta: number, tb: number, horiz: number): number {
    const fine = horiz > 1e-9 ? FINE_STEP_WU / horiz : (tb - ta) / 32;
    let lo = ta;
    let hi = tb;
    if (tb - ta > fine * 1.5) {
      for (let t = ta; t < tb; ) {
        const tn = Math.min(tb, t + fine);
        if (f(tn) <= 0) {
          lo = t;
          hi = tn;
          break;
        }
        t = tn;
      }
    }
    const tol = horiz > 1e-9 ? PICK_TOLERANCE_WU / horiz : 1e-6;
    for (let i = 0; i < 64 && hi - lo > tol; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  private point(t: number): { x: number; y: number; z: number } {
    const p = this.ray.at(t, this.v);
    return { x: p.x, y: p.y, z: p.z };
  }

  private cameraRay(clientX: number, clientY: number): boolean {
    const ndc = toNdc(this.view, clientX, clientY, this.ndc);
    if (ndc === null) return false;
    const cam = this.view.camera;
    cam.updateMatrixWorld();
    this.ray.origin.setFromMatrixPosition(cam.matrixWorld);
    this.ray.direction.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(this.ray.origin).normalize();
    return true;
  }
}

/**
 * Client pixel of a map point (Fx raw) on the terrain surface, or null if it lies behind the
 * camera or outside the canvas.
 */
export function worldToClient(view: OverlayView, xRaw: number, zRaw: number): { x: number; y: number } | null {
  const x = xRaw / FX;
  const z = zRaw / FX;
  return projectWu(view, x, view.heightWuAt(x, z), z);
}

/** Client pixel of a world point (WU), null behind the camera or outside the canvas. */
export function projectWu(view: OverlayView, xWu: number, yWu: number, zWu: number): { x: number; y: number } | null {
  const cam = view.camera;
  cam.updateMatrixWorld();
  const v = new THREE.Vector3(xWu, yWu, zWu).applyMatrix4(cam.matrixWorldInverse);
  if (v.z >= -cam.near) return null;
  v.applyMatrix4(cam.projectionMatrix);
  if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
  const r = view.canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}

/** One picker per view for hitTestMarkers (keeps its per-map terrain bounds). */
const pickers = new WeakMap<OverlayView, TerrainPicker>();

function pickerOf(view: OverlayView): TerrainPicker {
  let p = pickers.get(view);
  if (p === undefined) {
    p = new TerrainPicker(view);
    pickers.set(view, p);
  }
  return p;
}

/** Drawn radius (CSS px) of a marker of `radiusWu` / `minPx` at a world position. */
function drawnRadiusPx(view: OverlayView, xWu: number, yWu: number, zWu: number, radiusWu: number, minPx: number): number {
  const cam = view.camera;
  const dist = cam.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(xWu, yWu, zWu));
  const wpp = wuPerPixel(dist, cam.fov, view.canvas.getBoundingClientRect().height);
  return Math.max(minPx, radiusWu / wpp);
}

interface Candidate {
  readonly ref: MarkerRef;
  readonly distPx: number;
}

function nearest(list: readonly Candidate[]): MarkerRef | null {
  let best: Candidate | null = null;
  for (const c of list) if (best === null || c.distPx < best.distPx) best = c;
  return best?.ref ?? null;
}

/**
 * Marker under a client pixel. Priority: handles of selected fields (fieldVertex/fieldRadius) >
 * start > spot > field (point inside the shape). Within a class the marker nearest to the cursor
 * wins; a marker counts if the cursor is within max(radiusPx, its drawn radius). Fields: the
 * smallest (most specific) containing field, ties to the higher index.
 */
export function hitTestMarkers(view: OverlayView, m: ViewMarkers, clientX: number, clientY: number, radiusPx = 12): MarkerRef | null {
  const within = (xRaw: number, zRaw: number, radiusWu: number, minPx: number): number | null => {
    const x = xRaw / FX;
    const z = zRaw / FX;
    const y = view.heightWuAt(x, z);
    const p = projectWu(view, x, y, z);
    if (p === null) return null;
    const d = Math.hypot(p.x - clientX, p.y - clientY);
    return d <= Math.max(radiusPx, drawnRadiusPx(view, x, y, z, radiusWu, minPx)) ? d : null;
  };

  const handles: Candidate[] = [];
  for (let i = 0; i < m.fields.length; i++) {
    if (!fieldSelected(m.selection, i)) continue;
    const shape = m.fields[i]!.shape;
    if (shape.kind === 'polygon') {
      for (let v = 0; v < shape.points.length; v++) {
        const p = shape.points[v]!;
        const d = within(p.x, p.z, SIZES.handle.radiusWu, SIZES.handle.minPx);
        if (d !== null) handles.push({ ref: { type: 'fieldVertex', index: i, vertex: v }, distPx: d });
      }
    } else {
      const d = within(shape.x + shape.r, shape.z, SIZES.handle.radiusWu, SIZES.handle.minPx);
      if (d !== null) handles.push({ ref: { type: 'fieldRadius', index: i }, distPx: d });
    }
  }
  const h = nearest(handles);
  if (h !== null) return h;

  const starts: Candidate[] = [];
  for (let i = 0; i < m.starts.length; i++) {
    const s = m.starts[i]!;
    const d = within(s.x, s.z, SIZES.start.radiusWu, SIZES.start.minPx);
    if (d !== null) starts.push({ ref: { type: 'start', index: i }, distPx: d });
  }
  const s = nearest(starts);
  if (s !== null) return s;

  const spots: Candidate[] = [];
  for (let i = 0; i < m.spots.length; i++) {
    const sp = m.spots[i]!;
    const size = sp.kind === 'hydro' ? SIZES.hydro : SIZES.mass;
    const d = within(sp.x, sp.z, size.radiusWu, size.minPx);
    if (d !== null) spots.push({ ref: { type: 'spot', index: i }, distPx: d });
  }
  const sp = nearest(spots);
  if (sp !== null) return sp;

  if (m.fields.length === 0) return null;
  const at = pickerOf(view).pick(clientX, clientY);
  if (at === null) return null;
  let best = -1;
  let bestArea = Infinity;
  for (let i = 0; i < m.fields.length; i++) {
    const shape = m.fields[i]!.shape;
    if (!propFieldContains(shape, at.x, at.z)) continue;
    const area = shapeAreaWu(shape);
    if (area <= bestArea) {
      best = i;
      bestArea = area;
    }
  }
  return best < 0 ? null : { type: 'field', index: best };
}

function shapeAreaWu(shape: ViewMarkers['fields'][number]['shape']): number {
  return shape.kind === 'circle' ? Math.PI * (shape.r / FX) ** 2 : polygonAreaWu(pointsToWu(shape.points));
}

/** Map centre of a field (Fx raw): circle centre or polygon bounding-box centre. */
export function fieldAnchor(shape: ViewMarkers['fields'][number]['shape']): { x: number; z: number } {
  if (shape.kind === 'circle') return { x: shape.x, z: shape.z };
  const c = outlineCenterWu(pointsToWu(shape.points));
  return { x: Math.round(c.x * FX), z: Math.round(c.z * FX) };
}
