/**
 * Forms for the factions after Varkan (docs/design/factions/f2–f4): struts and limb chains with joint pivots
 * (walkers, spiders, tripods), spikes/claws/bipyramids (Skarn), faceted chitin plates, sweeps along curves (organic
 * hulls, tubes, tails), ellipsoids/lenses/discs/torus arcs/dome shells (Sael, Aurith), crystals, crystal clusters and
 * glyph strips (Aurith, Skarn druses).
 *
 * Placement: closed volumes that have a natural center (`bipyramid`, `ellipsoid`, `lens`, `disc`, `domeShell`,
 * `crystal`, `plate`) are centered on their bounding box like the other primitives. Point-to-point forms (`strut`,
 * `spike`, `claw`, `sweep`, `limb`, `glyphStrip`) use the given coordinates; `torusArc` sits at its ring center.
 */
import {
  arcPoints,
  bezier,
  catmullRom,
  lerp3,
  pathFrames,
  polygonProfile,
  resampleValues,
  sweepPolys,
  type Section,
} from './curves.ts';
import { cross, dot, length, newell, normalize, sub, type Vec2, type Vec3 } from './math.ts';
import type { PartAnim, PartDef } from './model.ts';
import { loft, lodRings, lodSegments, toAxis, type Axis, type Lod, type Poly, type Ring } from './primitives.ts';
import { flipX, group, primNode, type GroupNode, type Place, type PrimNode, type Shape } from './shapes.ts';

function mapAxis(polys: Poly[], axis: Axis): Poly[] {
  return axis === 'y' ? polys : polys.map((poly) => poly.map((p) => toAxis(p, axis)));
}

function orient(poly: Poly, expected: Vec3): Poly {
  return dot(newell(poly), expected) < 0 ? poly.slice().reverse() : poly;
}

function shiftY(polys: Poly[], dy: number): Poly[] {
  return dy === 0 ? polys : polys.map((poly) => poly.map((p): Vec3 => [p[0], p[1] + dy, p[2]]));
}

/** Sides of a design-critical cross-section per LOD: round sections (> 4 sides) lose sides, 3/4-sided stay. */
function lodSides(sides: number, lod: Lod): number {
  return sides <= 4 ? sides : lodSegments(sides, lod, 4);
}

/** Sample count along a path per LOD (≈ 60 % / 40 %, ≥ 2). */
function lodSamples(n: number, lod: Lod): number {
  if (lod === 0) return n;
  return Math.max(2, Math.round(n * (lod === 1 ? 0.6 : 0.4)));
}

function positive(name: string, v: number): void {
  if (!(v > 0)) throw new RangeError(`${name} must be > 0 (got ${v})`);
}

// ---------------------------------------------------------------------------------------------------------------
// Struts, spikes, claws, bipyramids

export interface StrutOpts extends Place {
  readonly from: Vec3;
  readonly to: Vec3;
  /** Circumradius at `from`. */
  readonly radius: number;
  /** Circumradius at `to` (default = radius; 0 = pointed). */
  readonly radiusEnd?: number;
  /** Cross-section sides, default 4 (square beam; faces point up/down and sideways). Round sections (> 4) lose sides in LODs. */
  readonly sides?: number;
  /** Close the ends (default true). */
  readonly caps?: boolean | 'start' | 'end';
}

/** Tapered n-gon beam from `from` to `to` (leg segments, needles, struts, masts at an angle). */
export function strut(o: StrutOpts): PrimNode {
  const { from, to, radius } = o;
  const r1 = o.radiusEnd ?? radius;
  const sides = o.sides ?? 4;
  const caps = o.caps ?? true;
  if (!(radius >= 0 && r1 >= 0 && radius + r1 > 0)) throw new RangeError('strut: radii must be ≥ 0 and not both 0');
  if (length(sub(to, from)) < 1e-9) throw new RangeError('strut: from and to coincide');
  return primNode('strut', o, (lod) =>
    sweepPolys(pathFrames([from, to]), [[radius, radius], [r1, r1]], polygonProfile(lodSides(sides, lod)), {
      start: caps === true || caps === 'start',
      end: caps === true || caps === 'end',
    }),
  );
}

export interface SpikeOpts extends Place {
  /** Center of the base. */
  readonly from: Vec3;
  /** Tip. */
  readonly to: Vec3;
  readonly radius: number;
  /** Default 4 (Skarn thorn); 5–6 for Sael spines. */
  readonly sides?: number;
}

/** Pointed n-sided pyramid from a base center to a tip (thorns, AA spines, needle tips, feet). */
export function spike(o: SpikeOpts): PrimNode {
  const node = strut({ ...o, radiusEnd: 0, caps: 'start' });
  return { ...node, type: 'spike' };
}

export interface ClawOpts extends Place {
  readonly from: Vec3;
  readonly to: Vec3;
  /** Offset of the curve's control point from the chord midpoint (WU); [0,0,0] = straight. */
  readonly bend: Vec3;
  /** Base circumradius (tapers to 0 at the tip). */
  readonly radius: number;
  readonly sides?: number;
  /** Segments along the curve, default 3 (LOD1 2, LOD2 1). */
  readonly segments?: number;
}

/** Curved, tapered spike (claw, pincer, Skarn tail sting, Sael horn tip). */
export function claw(o: ClawOpts): PrimNode {
  const { from, to, bend, radius } = o;
  positive('claw radius', radius);
  const sides = o.sides ?? 4;
  const segs = o.segments ?? 3;
  const ctrl = lerp3(from, to, 0.5);
  const c: Vec3 = [ctrl[0] + bend[0], ctrl[1] + bend[1], ctrl[2] + bend[2]];
  return primNode('claw', o, (lod) => {
    const n = Math.max(1, lod === 0 ? segs : Math.round(segs * (lod === 1 ? 0.6 : 0.34)));
    const path = bezier([from, c, to], n);
    const sections = path.map((_, i): Section => {
      const r = radius * (1 - i / n);
      return [r, r];
    });
    return sweepPolys(pathFrames(path), sections, polygonProfile(lodSides(sides, lod)), { start: true, end: false });
  });
}

export interface BipyramidOpts extends Place {
  /** Circumradius of the waist. */
  readonly radius: number;
  /** Tip-to-tip length along `axis`. */
  readonly length: number;
  /** Share of the length in front of the waist (towards +axis), default 0.5. */
  readonly front?: number;
  /** Default 4 (Skarn garnet lens: stretched 4-sided double pyramid). */
  readonly sides?: number;
  /** Default 'z' (lying, pointing forward). */
  readonly axis?: Axis;
}

/** Double pyramid (Skarn garnet lens, splinters, Aurith spindle with sides 6). Centered on its bounding box. */
export function bipyramid(o: BipyramidOpts): PrimNode {
  const { radius, length: len } = o;
  positive('bipyramid radius', radius);
  positive('bipyramid length', len);
  const front = o.front ?? 0.5;
  if (!(front > 0 && front < 1)) throw new RangeError('bipyramid: front must be in (0, 1)');
  const sides = o.sides ?? 4;
  const axis = o.axis ?? 'z';
  const ring = polygonProfile(sides).map(([u, v]): Vec2 => [u * radius, v * radius]);
  const tip = ring.map((): Vec2 => [0, 0]);
  const waist = -len / 2 + len * (1 - front);
  return primNode('bipyramid', o, () =>
    mapAxis(
      loft([
        { y: -len / 2, pts: tip },
        { y: waist, pts: ring },
        { y: len / 2, pts: tip },
      ]),
      axis,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Chitin plates

export interface PlateOpts extends Place {
  /** [width x, depth z] of the outline. */
  readonly size: Vec2;
  /** Thickness (vertical offset between top and bottom surface). */
  readonly thickness: number;
  /** Rise of the top across x (cylindrical vault), default 0. */
  readonly arch?: number;
  /** Rise of the top along z (with `arch`: dome), default 0. */
  readonly archZ?: number;
  /** Facets [across x, along z], default [4, 2]. LOD1/2 halve them (min 1). */
  readonly segments?: readonly [number, number];
  /** Narrows the front (+Z) edge: 0 = rectangle, 0.9 = almost a point (shield / keel plate), default 0. */
  readonly point?: number;
}

/**
 * Vaulted, faceted plate with thickness (Skarn chitin back plates, Sael shell inlays, Aurith comb plates). The
 * top is a paraboloid facet grid, edges at y = 0 before centering. Centered on its bounding box.
 */
export function plate(o: PlateOpts): PrimNode {
  const [w, d] = o.size;
  positive('plate width', w);
  positive('plate depth', d);
  positive('plate thickness', o.thickness);
  const arch = o.arch ?? 0;
  const archZ = o.archZ ?? 0;
  if (arch < 0 || archZ < 0) throw new RangeError('plate: arch must be ≥ 0 (rotate the plate for a hollow)');
  const point = o.point ?? 0;
  if (!(point >= 0 && point <= 0.9)) throw new RangeError('plate: point must be in [0, 0.9]');
  const [sx, sz] = o.segments ?? [4, 2];
  const t = o.thickness;
  return primNode('plate', o, (lod) => {
    const nx = lod === 0 ? sx : Math.max(1, Math.round(sx / (lod === 1 ? 1.5 : 2.5)));
    const nz = lod === 0 ? sz : Math.max(1, Math.round(sz / (lod === 1 ? 1.5 : 2.5)));
    const top = (i: number, k: number): Vec3 => {
      const u = -1 + (2 * i) / nx;
      const v = -1 + (2 * k) / nz;
      const hw = (w / 2) * (1 - (point * (v + 1)) / 2);
      return [u * hw, arch * (1 - u * u) + archZ * (1 - v * v), (v * d) / 2];
    };
    const bot = (i: number, k: number): Vec3 => {
      const p = top(i, k);
      return [p[0], p[1] - t, p[2]];
    };
    const out: Poly[] = [];
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const [a, b, c, e] = [top(i, k), top(i + 1, k), top(i + 1, k + 1), top(i, k + 1)];
        out.push(orient([a, b, c], [0, 1, 0]), orient([a, c, e], [0, 1, 0]));
        const [a2, b2, c2, e2] = [bot(i, k), bot(i + 1, k), bot(i + 1, k + 1), bot(i, k + 1)];
        out.push(orient([a2, b2, c2], [0, -1, 0]), orient([a2, c2, e2], [0, -1, 0]));
      }
    }
    const wall = (p: [number, number], q: [number, number], outward: Vec3): void => {
      out.push(orient([top(...p), top(...q), bot(...q), bot(...p)], outward));
    };
    for (let i = 0; i < nx; i++) {
      wall([i, 0], [i + 1, 0], [0, 0, -1]);
      wall([i, nz], [i + 1, nz], [0, 0, 1]);
    }
    for (let k = 0; k < nz; k++) {
      wall([0, k], [0, k + 1], [-1, 0, 0]);
      wall([nx, k], [nx, k + 1], [1, 0, 0]);
    }
    return shiftY(out, -(arch + archZ - t) / 2);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Sweeps

export interface SweepOpts extends Place {
  /** Path points (≥ 2); with `samples` a Catmull-Rom spline through them. */
  readonly path: readonly Vec3[];
  /**
   * Section radius: one value, or one per path point (number = round, [rx, ry] = oval: rx sideways, ry up for
   * horizontal paths). 0 = pointed end.
   */
  readonly radius: number | readonly (number | Section)[];
  /** Sides of the regular section, default 8 (LOD1/2 fewer). Ignored with `profile`. */
  readonly sides?: number;
  /** Own convex unit profile (points by increasing angle, u = side, v = up), e.g. a flat-bottomed hull section. */
  readonly profile?: readonly Vec2[];
  /** Resample the path as a smooth spline with this many points (LOD1 60 %, LOD2 40 %). Default: path as given. */
  readonly samples?: number;
  /** Close the ends (default true). */
  readonly caps?: boolean | 'start' | 'end';
  /** Up hint for the first frame (default +Y). */
  readonly up?: Vec3;
  /**
   * Open profile: `profile` is a polyline (e.g. an arc), swept to a one-sided surface strip without caps. For panels
   * whose inside is never seen (skirt lanes, shell segments); normals face the side the profile turns away from.
   */
  readonly open?: boolean;
}

/** Profile swept along a curve: organic hulls (oval sections along z), tubes, tails, horns, cables. */
export function sweep(o: SweepOpts): PrimNode {
  const path = o.path;
  if (path.length < 2) throw new RangeError('sweep: path needs ≥ 2 points');
  const radii: Section[] = (typeof o.radius === 'number' ? [o.radius] : o.radius).map((r): Section => (typeof r === 'number' ? [r, r] : r));
  if (radii.length !== 1 && radii.length !== path.length) throw new RangeError('sweep: radius needs one value or one per path point');
  const sides = o.sides ?? 8;
  const caps = o.caps ?? true;
  const up = o.up ?? [0, 1, 0];
  if (o.profile !== undefined && o.profile.length < (o.open === true ? 2 : 3)) throw new RangeError('sweep: profile needs ≥ 3 points (open: ≥ 2)');
  if (o.open === true && o.profile === undefined) throw new RangeError('sweep: open needs an explicit profile');
  return primNode('sweep', o, (lod) => {
    const pts = o.samples === undefined ? path.slice() : catmullRom(path, lodSamples(o.samples, lod));
    const secs = resampleValues(radii, pts.length);
    const profile = o.profile ?? polygonProfile(lodSides(sides, lod));
    return sweepPolys(pathFrames(pts, up), secs, profile, { start: caps === true || caps === 'start', end: caps === true || caps === 'end' }, o.open === true);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Round bodies: ellipsoid, lens, disc, torus arc, dome shell

export interface EllipsoidOpts extends Place {
  /** Half axes [x, y, z]. */
  readonly radii: Vec3;
  /** Around the axis, default 10. */
  readonly segments?: number;
  /** Latitude bands, default 6 (half: 3). */
  readonly rings?: number;
  /** Upper half only with flat underside (Sael shell, Aurith keel), centered on its bounding box. */
  readonly half?: boolean;
  /** Drop shape seen from above: the front (+Z) half narrows; 0 = ellipse, 0.5 = clear teardrop, < 1. */
  readonly drop?: number;
  readonly axis?: Axis;
}

/** Ellipsoid / half ellipsoid / teardrop shell. Combine with `smooth: true` for Sael and Aurith bodies. */
export function ellipsoid(o: EllipsoidOpts): PrimNode {
  const [rx, ry, rz] = o.radii;
  positive('ellipsoid rx', rx);
  positive('ellipsoid ry', ry);
  positive('ellipsoid rz', rz);
  const half = o.half === true;
  const drop = o.drop ?? 0;
  if (!(drop >= 0 && drop < 1)) throw new RangeError('ellipsoid: drop must be in [0, 1)');
  const segments = o.segments ?? 10;
  const rings = o.rings ?? (half ? 3 : 6);
  const axis = o.axis ?? 'y';
  return primNode(half ? 'halfEllipsoid' : 'ellipsoid', o, (lod) => {
    const segs = lodSegments(segments, lod);
    const bands = lodRings(rings, lod, half ? 1 : 2);
    const start = half ? Math.PI / 2 : Math.PI;
    const list: Ring[] = [];
    for (let i = 0; i <= bands; i++) {
      const phi = start - (start * i) / bands;
      const s = Math.abs(Math.sin(phi)) < 1e-12 ? 0 : Math.sin(phi);
      const pts: Vec2[] = [];
      for (let j = 0; j < segs; j++) {
        const th = ((j + 0.5) / segs) * Math.PI * 2;
        const z = rz * s * Math.sin(th);
        const x = rx * s * Math.cos(th) * (1 - drop * Math.max(0, z / rz));
        pts.push([x, z]);
      }
      list.push({ y: ry * Math.cos(phi) + (half ? -ry / 2 : 0), pts });
    }
    return mapAxis(loft(list, { bottom: half, top: false }), axis);
  });
}

export interface LensOpts extends Place {
  readonly radius: number;
  /** Total thickness along the axis. */
  readonly thickness: number;
  /** Length along z (default 2 × radius = round lens). */
  readonly length?: number;
  readonly segments?: number;
  readonly rings?: number;
  readonly axis?: Axis;
}

/** Biconvex lens (Aurith socket lenses and pods, Sael lanterns with axis 'z'): a flat ellipsoid. */
export function lens(o: LensOpts): PrimNode {
  const node = ellipsoid({ ...o, radii: [o.radius, o.thickness / 2, (o.length ?? 2 * o.radius) / 2], rings: o.rings ?? 4 });
  return { ...node, type: 'lens' };
}

export interface DiscOpts extends Place {
  readonly radius: number;
  readonly height: number;
  /** 45° chamfer of both rims, default min(height / 3, radius / 4). */
  readonly bevel?: number;
  /** Default 12. */
  readonly segments?: number;
  readonly axis?: Axis;
}

/** Flat disc with chamfered rims (Sael hover pad, Skarn buzz disc with segments 6, socket plates). */
export function disc(o: DiscOpts): PrimNode {
  const { radius, height } = o;
  positive('disc radius', radius);
  positive('disc height', height);
  const bevel = o.bevel ?? Math.min(height / 3, radius / 4);
  if (!(bevel >= 0 && bevel * 2 <= height && bevel < radius)) throw new RangeError('disc: bevel must be ≥ 0, ≤ height / 2 and < radius');
  const segments = o.segments ?? 12;
  const axis = o.axis ?? 'y';
  return primNode('disc', o, (lod) => {
    const segs = lodSegments(segments, lod);
    const ring = (r: number): Vec2[] => polygonProfile(segs).map(([u, v]): Vec2 => [u * r, v * r]);
    const y0 = -height / 2;
    const y1 = height / 2;
    const rings: Ring[] =
      bevel > 0
        ? [
            { y: y0, pts: ring(radius - bevel) },
            { y: y0 + bevel, pts: ring(radius) },
            ...(bevel * 2 < height - 1e-9 ? [{ y: y1 - bevel, pts: ring(radius) }] : []),
            { y: y1, pts: ring(radius - bevel) },
          ]
        : [
            { y: y0, pts: ring(radius) },
            { y: y1, pts: ring(radius) },
          ];
    return mapAxis(loft(rings), axis);
  });
}

export interface TorusArcOpts extends Place {
  /** Radius of the arc center line. */
  readonly radius: number;
  /** Tube radius (across the arc, in the arc plane). */
  readonly tube: number;
  /** Arc length in degrees, default 120 (Sael sickle; arch 180). */
  readonly arc?: number;
  /** Start angle in degrees from +X towards +Z (axis y); default centers the arc on +Z (front). */
  readonly startDeg?: number;
  /** Segments along the arc, default 8. */
  readonly segments?: number;
  /** Tube sides, default 4 (8 for round, smooth arcs). */
  readonly sides?: number;
  /** Tube thickness perpendicular to the arc plane relative to `tube`, default 1 (0.5 = flattened sickle). */
  readonly flatten?: number;
  /** Tube radius factor at the arc end (0 = pointed sickle tip), default 1. */
  readonly taper?: number;
  /** Axis of the ring (the arc lies in the plane perpendicular to it), default y. */
  readonly axis?: Axis;
}

/** Torus segment (Sael/Aurith sickle, arches, halo, harp bows). Positioned at the ring center. */
export function torusArc(o: TorusArcOpts): PrimNode {
  const { radius, tube } = o;
  positive('torusArc radius', radius);
  positive('torusArc tube', tube);
  const arc = o.arc ?? 120;
  if (!(arc > 0 && arc < 360)) throw new RangeError('torusArc: arc must be in (0, 360)°');
  const start = o.startDeg ?? 90 - arc / 2;
  const segments = o.segments ?? 8;
  const sides = o.sides ?? 4;
  const flatten = o.flatten ?? 1;
  const taper = o.taper ?? 1;
  positive('torusArc flatten', flatten);
  if (!(taper >= 0)) throw new RangeError('torusArc: taper must be ≥ 0');
  const axis = o.axis ?? 'y';
  return primNode('torusArc', o, (lod) => {
    const n = Math.max(2, lod === 0 ? segments : Math.round(segments * (lod === 1 ? 0.6 : 0.4)));
    const path = arcPoints(radius, start, start + arc, n, 'y');
    const secs = path.map((_, i): Section => {
      const f = 1 + (taper - 1) * (i / n);
      return [tube * f, tube * f * flatten];
    });
    return mapAxis(sweepPolys(pathFrames(path), secs, polygonProfile(lodSides(sides, lod))), axis);
  });
}

export interface DomeShellOpts extends Place {
  /** Outer radius. */
  readonly radius: number;
  /** Wall thickness (< radius). */
  readonly thickness: number;
  /** Polar opening angle from the pole in degrees: 90 = half sphere, < 90 flat cap, default 90. */
  readonly arc?: number;
  /** Default 12. */
  readonly segments?: number;
  /** Latitude bands, default 3. */
  readonly rings?: number;
  /** Pole direction, default y (open underneath; rotate 180° about X for a bowl/basin). */
  readonly axis?: Axis;
}

/** Hollow spherical cap with wall thickness (Aurith shell/apsis, Sael cistern, dishes, hall domes). Centered. */
export function domeShell(o: DomeShellOpts): PrimNode {
  const { radius, thickness } = o;
  positive('domeShell radius', radius);
  if (!(thickness > 0 && thickness < radius)) throw new RangeError('domeShell: 0 < thickness < radius');
  const arc = o.arc ?? 90;
  if (!(arc > 0 && arc < 180)) throw new RangeError('domeShell: arc must be in (0, 180)°');
  const segments = o.segments ?? 12;
  const bandsIn = o.rings ?? 3;
  const axis = o.axis ?? 'y';
  const a = (arc * Math.PI) / 180;
  const inner = radius - thickness;
  const ymin = Math.min(radius * Math.cos(a), inner * Math.cos(a));
  const dy = -(ymin + radius) / 2;
  return primNode('domeShell', o, (lod) => {
    const segs = lodSegments(segments, lod);
    const bands = lodRings(bandsIn, lod, 1);
    const cap = (r: number): Ring[] => {
      const list: Ring[] = [];
      for (let i = 0; i <= bands; i++) {
        const phi = a - (a * i) / bands;
        const s = i === bands ? 0 : Math.sin(phi);
        list.push({ y: r * Math.cos(phi), pts: polygonProfile(segs).map(([u, v]): Vec2 => [u * r * s, v * r * s]) });
      }
      return list;
    };
    const outerRings = cap(radius);
    const innerRings = cap(inner);
    const out: Poly[] = loft(outerRings, { bottom: false, top: false });
    for (const p of loft(innerRings, { bottom: false, top: false })) out.push(p.slice().reverse());
    const o0 = outerRings[0]!;
    const i0 = innerRings[0]!;
    for (let j = 0; j < segs; j++) {
      const k = (j + 1) % segs;
      const P = (r: Ring, idx: number): Vec3 => [r.pts[idx]![0], r.y, r.pts[idx]![1]];
      const th = ((j + 1) / segs) * Math.PI * 2;
      const expected: Vec3 = [Math.cos(a) * Math.cos(th), -Math.sin(a), Math.cos(a) * Math.sin(th)];
      out.push(orient([P(o0, j), P(o0, k), P(i0, k), P(i0, j)], expected));
    }
    return mapAxis(shiftY(out, dy), axis);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Crystals and glyphs

export interface CrystalOpts extends Place {
  /** Circumradius of the body. */
  readonly radius: number;
  /** Height of the prism body. */
  readonly height: number;
  /** Height of the pyramid tip on top, default 1.5 × radius (0 = flat). */
  readonly tip?: number;
  /** Pyramid tip underneath (double-terminated crystal), default 0. */
  readonly bottomTip?: number;
  /** Default 6 (Aurith crystal, Skarn druse). No LOD reduction (design count). */
  readonly sides?: number;
  /** Radius factor at the top of the body (splinters narrow upwards), default 1. */
  readonly taper?: number;
}

/** Prism with pyramid tip (Aurith resonance crystals, Skarn druse, splinters). Centered on its bounding box. */
export function crystal(o: CrystalOpts): PrimNode {
  const { radius, height } = o;
  positive('crystal radius', radius);
  positive('crystal height', height);
  const tip = o.tip ?? radius * 1.5;
  const bt = o.bottomTip ?? 0;
  const taper = o.taper ?? 1;
  if (tip < 0 || bt < 0 || !(taper > 0)) throw new RangeError('crystal: tip, bottomTip ≥ 0 and taper > 0');
  const sides = o.sides ?? 6;
  const unit = polygonProfile(sides);
  const ring = (r: number): Vec2[] => unit.map(([u, v]): Vec2 => [u * r, v * r]);
  const y0 = -height / 2;
  const y1 = height / 2;
  const rings: Ring[] = [
    ...(bt > 0 ? [{ y: y0 - bt, pts: ring(0) }] : []),
    { y: y0, pts: ring(radius) },
    { y: y1, pts: ring(radius * taper) },
    ...(tip > 0 ? [{ y: y1 + tip, pts: ring(0) }] : []),
  ];
  const dy = -((y0 - bt) + (y1 + tip)) / 2;
  return primNode('crystal', o, () => shiftY(loft(rings), dy));
}

/** Deterministic PRNG (mulberry32) for clusters. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CrystalClusterOpts extends Place {
  /** Crystals: one upright in the middle, the others around it, default 3. */
  readonly count?: number;
  readonly radius: number;
  /** Body height of the central crystal (outer ones 60–90 %). */
  readonly height: number;
  /** Distance of the outer crystals from the center, default 1.4 × radius. */
  readonly spread?: number;
  /** Outward lean of the outer crystals in degrees, default 22. */
  readonly lean?: number;
  /** Variation (0–0.5) of height and angle, default 0.2. */
  readonly jitter?: number;
  readonly seed?: number;
  readonly sides?: number;
  /** Tip height relative to the radius, default 1.5. */
  readonly tip?: number;
}

/** Crystal cluster standing on the group origin (y = 0): Skarn druse, Aurith crown/resonator, splinter fields. */
export function crystalCluster(o: CrystalClusterOpts): GroupNode {
  const count = o.count ?? 3;
  if (!Number.isInteger(count) || count < 1) throw new RangeError('crystalCluster: count must be an integer ≥ 1');
  const r = o.radius;
  positive('crystalCluster radius', r);
  positive('crystalCluster height', o.height);
  const spread = o.spread ?? r * 1.4;
  const lean = o.lean ?? 22;
  const jitter = o.jitter ?? 0.2;
  const tipF = o.tip ?? 1.5;
  const rand = rng(o.seed ?? 1);
  const sides = o.sides ?? 6;
  const children: Shape[] = [];
  const sink = 0.08 * o.height;
  for (let i = 0; i < count; i++) {
    const outer = i > 0;
    const h = outer ? o.height * (0.6 + 0.3 * rand()) * (1 - jitter / 2 + jitter * rand()) : o.height;
    const rr = outer ? r * (0.75 + 0.2 * rand()) : r;
    const tip = rr * tipF;
    const phiDeg = outer ? ((i - 1) / (count - 1)) * 360 + (rand() - 0.5) * 60 * jitter : 0;
    const leanDeg = outer ? lean * (1 - jitter / 2 + jitter * rand()) : 0;
    const phi = (phiDeg * Math.PI) / 180;
    const la = (leanDeg * Math.PI) / 180;
    const dir: Vec3 = [Math.sin(la) * Math.sin(phi), Math.cos(la), Math.sin(la) * Math.cos(phi)];
    const base: Vec3 = outer ? [spread * Math.sin(phi), -sink, spread * Math.cos(phi)] : [0, -sink, 0];
    const half = (h + tip) / 2;
    children.push(
      crystal({
        radius: rr,
        height: h,
        tip,
        sides,
        at: [base[0] + dir[0] * half, base[1] + dir[1] * half, base[2] + dir[2] * half],
        rot: [leanDeg, phiDeg, 0],
      }),
    );
  }
  return group(children, o);
}

export interface GlyphStripOpts extends Place {
  /** Line on the surface (≥ 2 points). */
  readonly path: readonly Vec3[];
  /** Surface normal: one for all or one per path point, default +Y. */
  readonly normal?: Vec3 | readonly Vec3[];
  /** Strip width, default 0.06 WU. */
  readonly width?: number;
  /** Dash rhythm in WU, repeated: > 0 dash, < 0 gap. Default: an irregular note-line rhythm. */
  readonly pattern?: readonly number[];
  /** Width factors of consecutive dashes, repeated, default [1, 0.55, 1, 0.8, 0.55]. */
  readonly widths?: readonly number[];
  /** Lift above the surface along the normal, default 0.006 WU. */
  readonly lift?: number;
}

const DEFAULT_GLYPH_PATTERN = [0.14, -0.05, 0.05, -0.05, 0.22, -0.06, 0.05, -0.04, 0.09, -0.07];
const DEFAULT_GLYPH_WIDTHS = [1, 0.55, 1, 0.8, 0.55];

/**
 * Glyph strip: a row of one-sided decal dashes along a surface line (Aurith glyph bands, Skarn nerve seams, Sael
 * light seams). Use material `glow2` (or `glow`) and keep it ≤ 2–3 % of the surface.
 */
export function glyphStrip(o: GlyphStripOpts): PrimNode {
  const path = o.path;
  if (path.length < 2) throw new RangeError('glyphStrip: path needs ≥ 2 points');
  const normals: readonly Vec3[] =
    o.normal === undefined ? path.map((): Vec3 => [0, 1, 0]) : Array.isArray(o.normal[0]) ? (o.normal as readonly Vec3[]) : path.map(() => o.normal as Vec3);
  if (normals.length !== path.length) throw new RangeError('glyphStrip: one normal or one per path point');
  const width = o.width ?? 0.06;
  positive('glyphStrip width', width);
  const pattern = o.pattern ?? DEFAULT_GLYPH_PATTERN;
  if (!pattern.some((v) => v > 0) || pattern.some((v) => v === 0)) throw new RangeError('glyphStrip: pattern needs dashes (> 0) and no zeros');
  const widths = o.widths ?? DEFAULT_GLYPH_WIDTHS;
  const lift = o.lift ?? 0.006;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + length(sub(path[i]!, path[i - 1]!)));
  const total = cum[cum.length - 1]!;
  positive('glyphStrip length', total);
  const at = (s: number): { p: Vec3; n: Vec3 } => {
    let i = 0;
    while (i < path.length - 2 && s > cum[i + 1]!) i++;
    const seg = cum[i + 1]! - cum[i]!;
    const f = seg > 0 ? Math.min(1, Math.max(0, (s - cum[i]!) / seg)) : 0;
    return { p: lerp3(path[i]!, path[i + 1]!, f), n: normalize(lerp3(normals[i]!, normals[i + 1]!, f)) };
  };
  const polys: Poly[] = [];
  let s = 0;
  let k = 0;
  let dash = 0;
  while (s < total - 1e-9) {
    const len = pattern[k % pattern.length]!;
    k++;
    if (len > 0) {
      const s1 = Math.min(total, s + len);
      if (s1 - s > 1e-4) {
        const a = at(s);
        const b = at(s1);
        const n = normalize(lerp3(a.n, b.n, 0.5));
        const t = normalize(sub(b.p, a.p));
        const side = normalize(cross(n, t));
        const hw = (width * widths[dash % widths.length]!) / 2;
        dash++;
        const q = (p: Vec3, sgn: number): Vec3 => [p[0] + side[0] * hw * sgn + n[0] * lift, p[1] + side[1] * hw * sgn + n[1] * lift, p[2] + side[2] * hw * sgn + n[2] * lift];
        polys.push(orient([q(a.p, 1), q(a.p, -1), q(b.p, -1), q(b.p, 1)], n));
      }
    }
    s += Math.abs(len);
  }
  return primNode('glyphs', o, () => polys.map((p) => p.slice()));
}

// ---------------------------------------------------------------------------------------------------------------
// Limbs: segment chains with joint pivots

export interface LimbOpts extends Place {
  /** Joint chain hip → knee → … → foot (≥ 2 points). */
  readonly joints: readonly Vec3[];
  /** Circumradius per joint (or one for all); 0 at the last joint = pointed foot. */
  readonly radius: number | readonly number[];
  /** Cross-section sides, default 4 (Skarn beams); 6 for Sael/Aurith (with `smooth`). */
  readonly sides?: number;
  /** Segments reach this share of the joint radius past inner joints to close the knee gaps, default 0.5. */
  readonly overlap?: number;
  /** Close the first segment at the hip (default true; false when the hip sits inside the body, saves tris). */
  readonly hipCap?: boolean;
  /** Close the segments at inner joints (default true; false for far LODs: the overlap hides the gap). */
  readonly jointCaps?: boolean;
}

function jointRadii(joints: readonly Vec3[], radius: number | readonly number[]): number[] {
  const r = typeof radius === 'number' ? joints.map(() => radius) : radius.slice();
  if (r.length !== joints.length) throw new RangeError('limb: radius needs one value or one per joint');
  return r;
}

function limbSegment(
  joints: readonly Vec3[],
  r: readonly number[],
  i: number,
  sides: number,
  overlap: number,
  place: Place = {},
  hipCap = true,
  jointCaps = true,
): PrimNode {
  const a = joints[i]!;
  const b = joints[i + 1]!;
  const d = normalize(sub(b, a));
  const ea = i > 0 ? overlap * r[i]! : 0;
  const eb = i + 2 < joints.length ? overlap * r[i + 1]! : 0;
  const node = strut({
    ...place,
    from: [a[0] - d[0] * ea, a[1] - d[1] * ea, a[2] - d[2] * ea],
    to: [b[0] + d[0] * eb, b[1] + d[1] * eb, b[2] + d[2] * eb],
    radius: r[i]!,
    radiusEnd: r[i + 1]!,
    sides,
    caps: segmentCaps(i === 0 ? hipCap : jointCaps, i + 2 < joints.length ? jointCaps : true),
  });
  return { ...node, type: 'limb' };
}

function segmentCaps(start: boolean, end: boolean): boolean | 'start' | 'end' {
  return start && end ? true : start ? 'start' : end ? 'end' : false;
}

/** Static limb: one tapered strut per segment (legs, arms, feelers, needles). The joints are the pivots. */
export function limb(o: LimbOpts): GroupNode {
  if (o.joints.length < 2) throw new RangeError('limb: ≥ 2 joints');
  const r = jointRadii(o.joints, o.radius);
  const sides = o.sides ?? 4;
  const overlap = o.overlap ?? 0.5;
  const segs: Shape[] = [];
  for (let i = 0; i + 1 < o.joints.length; i++) segs.push(limbSegment(o.joints, r, i, sides, overlap, {}, o.hipCap ?? true, o.jointCaps ?? true));
  const { joints: _j, radius: _r, sides: _s, overlap: _o, hipCap: _h, jointCaps: _c, ...place } = o;
  return group(segs, place);
}

export interface LegJointOpts {
  /** Knee position along hip → foot, default 0.35. */
  readonly kneeAt?: number;
  /** Knee lift above the hip–foot line (WU); Skarn high knees ≈ 0.4–0.8. */
  readonly kneeUp?: number;
  /** Knee offset towards -Z (backward-bent Aurith legs) in WU, default 0. */
  readonly kneeBack?: number;
}

/** Hip, knee and foot of a two-segment leg. */
export function legJoints(hip: Vec3, foot: Vec3, o: LegJointOpts = {}): [Vec3, Vec3, Vec3] {
  const k = lerp3(hip, foot, o.kneeAt ?? 0.35);
  return [hip, [k[0], k[1] + (o.kneeUp ?? 0.3), k[2] - (o.kneeBack ?? 0)], foot];
}

export interface LegPairsOpts extends Place, LegJointOpts {
  /** Hip joints of the left side (+X); the right side is mirrored. Legs per side = hips.length. */
  readonly hips: readonly Vec3[];
  /** Foot distance outward from the hip (x). */
  readonly footOut: number;
  /** Fan the feet along z: foot z = hip z × (1 + splay), default 0.4. */
  readonly splay?: number;
  /** Foot height, default 0 (ground). */
  readonly footY?: number;
  /** Per joint (hip, knee, foot) or one value. */
  readonly radius: number | readonly number[];
  readonly sides?: number;
  readonly overlap?: number;
  readonly hipCap?: boolean;
  readonly jointCaps?: boolean;
}

export interface LegPairs {
  /** Left legs (+X) and their mirror image. Put them in parts `legs_l` / `legs_r` (anim `legs`). */
  readonly left: GroupNode;
  readonly right: GroupNode;
  /** Joints of the left legs [hip, knee, foot] (mirror x for the right side). */
  readonly joints: readonly (readonly [Vec3, Vec3, Vec3])[];
  /** Mean hip of each side (pivot suggestion for `legs_l` / `legs_r`). */
  readonly pivotL: Vec3;
  readonly pivotR: Vec3;
}

/** Mirrored leg sets for walkers and spiders (Skarn 2/4/6 legs, Sael runners, Aurith tripod with one + one mirrored). */
export function legPairs(o: LegPairsOpts): LegPairs {
  if (o.hips.length < 1) throw new RangeError('legPairs: ≥ 1 hip');
  const splay = o.splay ?? 0.4;
  const footY = o.footY ?? 0;
  const joints = o.hips.map((h) => legJoints(h, [h[0] + o.footOut, footY, h[2] * (1 + splay)], o));
  const legs = joints.map((j) =>
    limb({ joints: j, radius: o.radius, sides: o.sides ?? 4, overlap: o.overlap ?? 0.5, hipCap: o.hipCap ?? true, jointCaps: o.jointCaps ?? true }),
  );
  const { hips, footOut: _f, splay: _s, footY: _y, radius: _r, sides: _d, overlap: _o, kneeAt: _ka, kneeUp: _ku, kneeBack: _kb, hipCap: _h, jointCaps: _c, ...place } = o;
  const n = hips.length;
  const mean: Vec3 = [hips.reduce((s, h) => s + h[0], 0) / n, hips.reduce((s, h) => s + h[1], 0) / n, hips.reduce((s, h) => s + h[2], 0) / n];
  return {
    left: group(legs, place),
    right: flipX(group(legs), place),
    joints,
    pivotL: mean,
    pivotR: [-mean[0], mean[1], mean[2]],
  };
}

export interface LimbPartsOpts extends Omit<LimbOpts, keyof Place>, Place {
  /** Part name prefix: parts `<name>_0`, `<name>_1`, … (one per segment). */
  readonly name: string;
  /** Parent of the first segment (default `hull`). */
  readonly parent?: string;
  /** Animation of every segment, default `pitch` (knees). */
  readonly anim?: PartAnim;
  /** Smooth normals of the segment parts. */
  readonly smoothPart?: boolean | number;
}

/**
 * Animated limb: one part per segment, each pivoting at its first joint and parented to the previous segment (big
 * walkers, T4 legs, crane arms). Uses one PartStream slot per segment (limit 8 per model).
 */
export function limbParts(o: LimbPartsOpts): PartDef[] {
  if (o.joints.length < 2) throw new RangeError('limbParts: ≥ 2 joints');
  const r = jointRadii(o.joints, o.radius);
  const sides = o.sides ?? 4;
  const overlap = o.overlap ?? 0.5;
  const { name, parent, anim, joints, radius: _r, sides: _s, overlap: _o, hipCap, jointCaps, smoothPart, ...place } = o;
  const parts: PartDef[] = [];
  for (let i = 0; i + 1 < joints.length; i++) {
    parts.push({
      name: `${name}_${i}`,
      parent: i === 0 ? (parent ?? 'hull') : `${name}_${i - 1}`,
      pivot: joints[i]!,
      anim: anim ?? 'pitch',
      ...(smoothPart === undefined ? {} : { smooth: smoothPart }),
      shapes: [limbSegment(joints, r, i, sides, overlap, place, hipCap ?? true, jointCaps ?? true)],
    });
  }
  return parts;
}
