/**
 * Kitbash DSL: shape nodes (primitives, groups, mirror, repetition). Shapes are pure data; `build.ts` turns them
 * into polygons per LOD. All sizes in WU; every primitive is centered on its bounding box before `at`/`rot`/`scale`.
 */
import { compose, mul, rotation, scaling, type Mat, type Vec2, type Vec3 } from './math.ts';
import {
  beveledBoxPolys,
  capsulePolys,
  cylinderPolys,
  extrudePolys,
  icospherePolys,
  loft,
  prismPolys,
  quadPolys,
  spherePolys,
  torusPolys,
  tubePolys,
  wedgePolys,
  type Axis,
  type Bevel,
  type Lod,
  type Poly,
  type Ring,
} from './primitives.ts';

export type LodLevel = Lod;

/** Placement and flags shared by all shapes (primitives and groups). */
export interface Place {
  /** Center of the shape (primitives) or origin of the group, WU. */
  readonly at?: Vec3;
  /** Euler angles in degrees, applied X, then Y, then Z. */
  readonly rot?: Vec3;
  /** Uniform or per-axis scale (applied before `rot`). */
  readonly scale?: number | Vec3;
  /** Material slot or faction alias (`team`, `glow`, `copper`, …). Groups pass it to children without own `mat`. */
  readonly mat?: string;
  /** Never removed by the automatic LOD reduction (silhouette-defining small parts: barrels, masts, glow cores). */
  readonly keep?: boolean;
  /** Highest LOD that still contains the shape (e.g. 0 = detail only in LOD0). */
  readonly maxLod?: LodLevel;
  /** Lowest LOD that contains the shape (e.g. 2 = simplified stand-in only in LOD2). */
  readonly minLod?: LodLevel;
  /** Free kitbash tag for lints and statistics (`bell`, `barrel`, `stack`, …). */
  readonly tag?: string;
}

/**
 * Generator of a primitive. `minFeature` (WU) is the size below which the automatic LOD drops details
 * (0 in LOD0): bevels narrower than it vanish in LOD2, extrude profiles lose corners smaller than it.
 */
export type PrimGen = (lod: Lod, minFeature: number) => Poly[];

export interface PrimNode {
  readonly kind: 'prim';
  readonly type: string;
  readonly gen: PrimGen;
  readonly place: Place;
}

export interface GroupNode {
  readonly kind: 'group';
  readonly children: readonly Shape[];
  readonly place: Place;
  /** Extra matrix applied after the placement (used by mirror/array/radial). */
  readonly extra?: Mat;
}

export type Shape = PrimNode | GroupNode;

function prim(type: string, place: Place, gen: PrimGen): PrimNode {
  return { kind: 'prim', type, gen, place };
}

/** Placement matrix of a shape. */
export function placeMatrix(p: Place): Mat {
  const s = p.scale;
  const sv: Vec3 | undefined = s === undefined ? undefined : typeof s === 'number' ? [s, s, s] : s;
  return compose(p.at, p.rot, sv);
}

// ---------------------------------------------------------------------------------------------------------------
// Primitives

export interface BoxOpts extends Place {
  readonly size: Vec3;
}
export function box(o: BoxOpts): PrimNode {
  const size = o.size;
  return prim('box', o, () => beveledBoxPolys(size, {}));
}

export interface BeveledBoxOpts extends Place {
  readonly size: Vec3;
  /** Number = all edges (top, bottom, vertical), or per edge group. 45° chamfers. */
  readonly bevel: number | Bevel;
}
/**
 * Box with 45° chamfers. LOD2 drops the vertical-edge chamfer (`side`) and every chamfer narrower than the LOD's
 * minimum feature size; LOD0/LOD1 keep all chamfers (the bow chamfer shows the driving direction).
 */
export function beveledBox(o: BeveledBoxOpts): PrimNode {
  const b: Bevel = typeof o.bevel === 'number' ? { top: o.bevel, bottom: o.bevel, side: o.bevel } : o.bevel;
  const size = o.size;
  return prim('beveledBox', o, (lod, minFeature) => beveledBoxPolys(size, lod === 2 ? dropSmallBevels(b, minFeature) : b));
}

function dropSmallBevels(b: Bevel, min: number): Bevel {
  const f = (v: number | undefined): number | undefined => (v === undefined ? undefined : v < min ? 0 : v);
  const out: Record<string, number> = { side: 0 };
  const put = (k: keyof Bevel, v: number | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  put('top', f(b.top));
  put('bottom', f(b.bottom));
  put('topFront', f(b.topFront));
  put('topBack', f(b.topBack));
  put('bottomFront', f(b.bottomFront));
  put('bottomBack', f(b.bottomBack));
  return out as Bevel;
}

export interface WedgeOpts extends Place {
  /** [width x, height y (at the back), depth z]. */
  readonly size: Vec3;
  /** Height at the front edge (+Z); 0 = sharp wedge. */
  readonly front?: number;
}
/** Ramp: full height at the back (-Z), sloping down towards +Z. Rotate with `rot` for other directions. */
export function wedge(o: WedgeOpts): PrimNode {
  const size = o.size;
  const front = o.front ?? 0;
  return prim('wedge', o, () => wedgePolys(size, front));
}

export interface PrismOpts extends Place {
  readonly sides: number;
  /** Circumradius. */
  readonly radius: number;
  readonly height: number;
  readonly axis?: Axis;
}
/** Regular n-sided prism (no LOD reduction: the side count is part of the design). */
export function prism(o: PrismOpts): PrimNode {
  const { sides, radius, height } = o;
  const axis = o.axis ?? 'y';
  return prim('prism', o, () => prismPolys(sides, radius, height, axis));
}

export interface CylinderOpts extends Place {
  readonly radius: number;
  readonly height: number;
  /** Default 8. LOD1 ≈ 75 %, LOD2 ≈ 50 % (min 4). */
  readonly segments?: number;
  readonly axis?: Axis;
  /** Close both ends (default), only one, or none. */
  readonly caps?: boolean | 'top' | 'bottom';
}
export function cylinder(o: CylinderOpts): PrimNode {
  const spec = { radius: o.radius, height: o.height, segments: o.segments ?? 8, axis: o.axis ?? 'y', caps: o.caps ?? true };
  return prim('cylinder', o, (lod) => cylinderPolys(spec, lod));
}

export interface FrustumOpts extends Place {
  /** Radius at the -axis end. */
  readonly radius: number;
  /** Radius at the +axis end. */
  readonly radiusTop: number;
  readonly height: number;
  readonly segments?: number;
  readonly axis?: Axis;
  readonly caps?: boolean | 'top' | 'bottom';
}
export function frustum(o: FrustumOpts): PrimNode {
  const spec = { radius: o.radius, radiusTop: o.radiusTop, height: o.height, segments: o.segments ?? 8, axis: o.axis ?? 'y', caps: o.caps ?? true };
  return prim('frustum', o, (lod) => cylinderPolys(spec, lod));
}

export interface ConeOpts extends Place {
  readonly radius: number;
  readonly height: number;
  readonly segments?: number;
  readonly axis?: Axis;
}
/** Cone with the tip at +axis. */
export function cone(o: ConeOpts): PrimNode {
  const spec = { radius: o.radius, radiusTop: 0, height: o.height, segments: o.segments ?? 8, axis: o.axis ?? 'y', caps: 'bottom' as const };
  return prim('cone', o, (lod) => cylinderPolys(spec, lod));
}

export interface SphereOpts extends Place {
  readonly radius: number;
  /** Around the axis, default 8. */
  readonly segments?: number;
  /** Latitude bands (full sphere, pole to pole; hemisphere: equator to pole), default 4 / 3. */
  readonly rings?: number;
  /** Upper half only, closed flat (dome / bell). Centered on its bounding box: y ∈ [-r/2, r/2]. */
  readonly hemi?: boolean;
  readonly axis?: Axis;
}
export function sphere(o: SphereOpts): PrimNode {
  const spec = {
    radius: o.radius,
    segments: o.segments ?? 8,
    rings: o.rings ?? (o.hemi === true ? 3 : 4),
    axis: o.axis ?? 'y',
    ...(o.hemi === undefined ? {} : { hemi: o.hemi }),
  };
  return prim(o.hemi === true ? 'hemisphere' : 'sphere', o, (lod) => spherePolys(spec, lod));
}

export interface IcosphereOpts extends Place {
  readonly radius: number;
  /** Subdivisions, default 1 (80 tris). Each LOD drops one level. */
  readonly detail?: number;
}
export function icosphere(o: IcosphereOpts): PrimNode {
  const r = o.radius;
  const d = o.detail ?? 1;
  return prim('icosphere', o, (lod) => icospherePolys(r, d, lod));
}

export interface CapsuleOpts extends Place {
  readonly radius: number;
  /** Total length including the round ends. */
  readonly length: number;
  readonly segments?: number;
  /** Bands per round end, default 2. */
  readonly rings?: number;
  readonly axis?: Axis;
}
export function capsule(o: CapsuleOpts): PrimNode {
  const spec = { radius: o.radius, length: o.length, segments: o.segments ?? 8, rings: o.rings ?? 2, axis: o.axis ?? 'y' };
  return prim('capsule', o, (lod) => capsulePolys(spec, lod));
}

export interface TorusOpts extends Place {
  /** Radius of the center line. */
  readonly radius: number;
  /** Radius of the tube. */
  readonly tube: number;
  readonly segments?: number;
  readonly sides?: number;
  /** Axis through the hole, default y (flat ring). */
  readonly axis?: Axis;
}
export function torus(o: TorusOpts): PrimNode {
  const spec = { radius: o.radius, tube: o.tube, segments: o.segments ?? 12, sides: o.sides ?? 4, axis: o.axis ?? 'y' };
  return prim('torus', o, (lod) => torusPolys(spec, lod));
}

export interface TubeOpts extends Place {
  readonly outer: number;
  readonly inner: number;
  readonly height: number;
  readonly segments?: number;
  readonly axis?: Axis;
  /** Closed bottom (bowl, ladle) with this thickness. */
  readonly floor?: number;
}
/** Hollow cylinder (pipe, ring, collar) or with `floor` an open bowl. */
export function tube(o: TubeOpts): PrimNode {
  const spec = {
    outer: o.outer,
    inner: o.inner,
    height: o.height,
    segments: o.segments ?? 8,
    axis: o.axis ?? 'y',
    ...(o.floor === undefined ? {} : { floor: o.floor }),
  };
  return prim('tube', o, (lod) => tubePolys(spec, lod));
}

export interface ExtrudeOpts extends Place {
  /**
   * Simple polygon (convex or concave, any winding). Axis 'x' (default): points are [z, y] = side view with +Z
   * forward; 'y': [x, z] = top view; 'z': [x, y] = front view.
   */
  readonly profile: readonly Vec2[];
  readonly depth: number;
  readonly axis?: Axis;
}
/**
 * Extruded profile (hull side profiles, armor plates, fins, wings). Not centered: profile coordinates are kept.
 * Automatic LOD: corners whose triangle area is below (minFeature / 2)² are removed (Visvalingam).
 */
export function extrude(o: ExtrudeOpts): PrimNode {
  const profile = o.profile;
  const depth = o.depth;
  const axis = o.axis ?? 'x';
  return prim('extrude', o, (lod, minFeature) => extrudePolys(profile, depth, axis, lod === 0 ? 0 : (minFeature / 2) ** 2));
}

export interface LoftOpts extends Place {
  /** Horizontal sections bottom → top, same point count, points ordered by angle (x = cos θ, z = sin θ). */
  readonly rings: readonly Ring[];
  readonly caps?: { bottom?: boolean; top?: boolean };
}
/** Advanced: stacked sections (hull tubs, towers). Not centered. */
export function loftShape(o: LoftOpts): PrimNode {
  const rings = o.rings;
  const caps = o.caps ?? {};
  return prim('loft', o, () => loft(rings, caps));
}

export interface QuadOpts extends Place {
  /** [width x, depth z]; one-sided, facing +Y (rotate for other directions). */
  readonly size: Vec2;
}
/** Flat decal quad (tech stripes, glow slits). Place it ≥ 0.004 WU above the surface it lies on. */
export function quad(o: QuadOpts): PrimNode {
  const size = o.size;
  return prim('quad', o, () => quadPolys(size));
}

// ---------------------------------------------------------------------------------------------------------------
// Composition

/** Groups shapes under one placement (children are relative to the group). */
export function group(children: readonly Shape[], place: Place = {}): GroupNode {
  return { kind: 'group', children, place };
}

/** The shapes plus their mirror image across the plane x = 0 (of the enclosing frame). */
export function mirrorX(shapes: Shape | readonly Shape[], place: Place = {}): GroupNode {
  const list = Array.isArray(shapes) ? (shapes as readonly Shape[]) : [shapes as Shape];
  const mirrored: GroupNode = { kind: 'group', children: list, place: {}, extra: scaling([-1, 1, 1]) };
  return { kind: 'group', children: [...list, mirrored], place };
}

/** Only the mirror image (x → -x) of the shapes. */
export function flipX(shapes: Shape | readonly Shape[], place: Place = {}): GroupNode {
  const list = Array.isArray(shapes) ? (shapes as readonly Shape[]) : [shapes as Shape];
  return { kind: 'group', children: list, place, extra: scaling([-1, 1, 1]) };
}

export interface ArrayOpts extends Place {
  readonly count: number;
  /** Offset between copies. */
  readonly step: Vec3;
  /** Center the row on the origin (default true); false: first copy at the origin. */
  readonly center?: boolean;
}
/** `count` copies along `step`. */
export function array(shape: Shape, o: ArrayOpts): GroupNode {
  if (!Number.isInteger(o.count) || o.count < 1) throw new RangeError('array: count must be an integer ≥ 1');
  const off = o.center === false ? 0 : (o.count - 1) / 2;
  const children: GroupNode[] = [];
  for (let i = 0; i < o.count; i++) {
    const k = i - off;
    children.push({ kind: 'group', children: [shape], place: { at: [o.step[0] * k, o.step[1] * k, o.step[2] * k] } });
  }
  return { kind: 'group', children, place: o };
}

export interface RadialOpts extends Place {
  readonly count: number;
  /** Rotation axis through the group origin, default y. */
  readonly axis?: Axis;
  /** Angle of the first copy in degrees (default 0). */
  readonly startDeg?: number;
  /** Angle between copies (default 360 / count). */
  readonly stepDeg?: number;
}
/** `count` copies rotated around an axis (spokes, exhaust rings, rotor blades). */
export function radial(shape: Shape, o: RadialOpts): GroupNode {
  if (!Number.isInteger(o.count) || o.count < 1) throw new RangeError('radial: count must be an integer ≥ 1');
  const axis = o.axis ?? 'y';
  const step = o.stepDeg ?? 360 / o.count;
  const start = o.startDeg ?? 0;
  const children: GroupNode[] = [];
  for (let i = 0; i < o.count; i++) {
    const a = start + step * i;
    const rot: Vec3 = axis === 'x' ? [a, 0, 0] : axis === 'y' ? [0, a, 0] : [0, 0, a];
    children.push({ kind: 'group', children: [shape], place: {}, extra: rotation(rot) });
  }
  return { kind: 'group', children, place: o };
}

export interface StripesOpts extends Place {
  /** Number of stripes (= tech level, 1–3). */
  readonly count: number;
  /** Stripe length across the deck (x), WU. */
  readonly width: number;
  /** Stripe depth along z (default 0.10 WU, faction.md §3.4). */
  readonly stripe?: number;
  /** Gap between stripes (default 0.10 WU). */
  readonly gap?: number;
}
/** Tech stripes: `count` decal quads across the deck, centered on `at`, stacked along z (front stripe first). */
export function stripes(o: StripesOpts): GroupNode {
  const depth = o.stripe ?? 0.1;
  const gap = o.gap ?? 0.1;
  const one = quad({ size: [o.width, depth] });
  return array(one, { ...o, mat: o.mat ?? 'accent', step: [0, 0, -(depth + gap)], count: o.count });
}

/** Matrix of a group including its extra transform. */
export function groupMatrix(g: GroupNode): Mat {
  const m = placeMatrix(g.place);
  return g.extra === undefined ? m : mul(m, g.extra);
}
