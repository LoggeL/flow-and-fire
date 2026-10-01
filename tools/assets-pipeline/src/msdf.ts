/**
 * Multi-channel signed distance fields (MSDF) for the strategic icon atlas (C2, PLAN §3.7), written
 * from scratch in TypeScript (no npm dependency), following the method of Chlumsky's msdfgen:
 *
 * 1. Shapes are contours of line segments and circular arcs (`Edge`). Contours are normalized so the
 *    filled region is always on the LEFT of every edge (outer contours: positive signed area, holes:
 *    negative), i.e. `cross(direction, p − q) > 0` ⇔ p is inside.
 * 2. Edge coloring (`colorEdges`, msdfgen "simple" strategy with a fixed seed): corners are vertices
 *    whose tangent directions turn by more than ~8° (`sin 3.0` cross threshold). Smooth contours get
 *    one color; contours with corners get runs of CYAN/MAGENTA/YELLOW so that the two edges meeting at
 *    a corner share exactly one channel; single-corner "teardrops" are split into three runs.
 * 3. Per texel and channel the closest edge carrying that channel (tie-break: the more orthogonal one)
 *    determines the channel value as its PSEUDO-distance (distance to the edge extended along its end
 *    tangents), so the median of the three channels reconstructs sharp corners.
 * 4. Error correction: texels whose median disagrees in sign with the exact signed distance, and
 *    neighbor pairs/quads whose bilinear interpolation produces a wrong-sign median further than
 *    {@link CLASH_TOLERANCE_PX} from the true edge, are flattened to the exact distance (all channels
 *    equal – locally a plain SDF).
 *
 * All coordinates are in texels of the target cell, y down. Everything is deterministic: no
 * randomness, fixed iteration orders, results quantized to 8 bits.
 */

export type Vec2 = readonly [number, number];

/** Channel bits of an edge color (msdfgen convention). */
export const RED = 1;
export const GREEN = 2;
export const BLUE = 4;
export const YELLOW = RED | GREEN;
export const MAGENTA = RED | BLUE;
export const CYAN = GREEN | BLUE;
export const WHITE = RED | GREEN | BLUE;

export interface LineEdge {
  readonly kind: 'line';
  readonly p0: Vec2;
  readonly p1: Vec2;
  color: number;
}

/** Circular arc: center, radius > 0, start angle and signed sweep (|sweep| < 2π; > 0 = counterclockwise in math axes). */
export interface ArcEdge {
  readonly kind: 'arc';
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly a0: number;
  readonly sweep: number;
  readonly p0: Vec2;
  readonly p1: Vec2;
  color: number;
}

export type Edge = LineEdge | ArcEdge;

export interface Contour {
  readonly edges: Edge[];
}

export interface Shape {
  readonly contours: Contour[];
}

/** Cross threshold for corners: sin(3 rad) ≈ 0.141 (≈ 8° turn), as msdfgen's default. */
export const CORNER_CROSS_THRESHOLD = Math.sin(3);
/** Interpolation clashes closer than this to the true edge (texels) are tolerated. */
export const CLASH_TOLERANCE_PX = 0.3;

// -------------------------------------------------------------------------------------------------
// Construction
// -------------------------------------------------------------------------------------------------

export function line(p0: Vec2, p1: Vec2): LineEdge {
  return { kind: 'line', p0, p1, color: WHITE };
}

/** Arc from `p0` to `p1` with a DXF-style bulge `b = tan(sweep / 4)` (b > 0: turns left in math axes). */
export function arcFromBulge(p0: Vec2, p1: Vec2, bulge: number): ArcEdge {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) throw new Error('arc: endpoints coincide');
  const sweep = 4 * Math.atan(bulge);
  const r = len / (2 * Math.sin(Math.abs(sweep) / 2));
  // Center on the left of the chord for a left-turning arc below 180°, see module doc.
  const h = r * Math.cos(sweep / 2) * Math.sign(sweep);
  const nx = -dy / len;
  const ny = dx / len;
  const cx = (p0[0] + p1[0]) / 2 + nx * h;
  const cy = (p0[1] + p1[1]) / 2 + ny * h;
  const a0 = Math.atan2(p0[1] - cy, p0[0] - cx);
  return { kind: 'arc', cx, cy, r, a0, sweep, p0, p1, color: WHITE };
}

/** Closed contour through `points`; `bulges[i]` (optional, default 0 = straight) bends segment i → i+1. */
export function polygonContour(points: readonly Vec2[], bulges?: readonly number[]): Contour {
  if (points.length < 2) throw new Error('contour needs at least 2 points');
  const edges: Edge[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const bulge = bulges?.[i] ?? 0;
    if (bulge !== 0) edges.push(arcFromBulge(a, b, bulge));
    else if (a[0] !== b[0] || a[1] !== b[1]) edges.push(line(a, b));
  }
  if (edges.length < 2 && !(edges.length === 1 && edges[0]!.kind === 'arc')) throw new Error('degenerate contour');
  return { edges };
}

export function circleContour(cx: number, cy: number, r: number): Contour {
  return polygonContour(
    [
      [cx + r, cy],
      [cx - r, cy],
    ],
    [1, 1],
  );
}

export function rectContour(x0: number, y0: number, x1: number, y1: number): Contour {
  return polygonContour([
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]);
}

/** Rectangle with quarter-circle corners of radius `r`. */
export function roundRectContour(x0: number, y0: number, x1: number, y1: number, r: number): Contour {
  const b = Math.tan(Math.PI / 8); // quarter circle
  // In math axes (y up) this point order turns left at every corner.
  return polygonContour(
    [
      [x0 + r, y0],
      [x1 - r, y0],
      [x1, y0 + r],
      [x1, y1 - r],
      [x1 - r, y1],
      [x0 + r, y1],
      [x0, y1 - r],
      [x0, y0 + r],
    ],
    [0, b, 0, b, 0, b, 0, b],
  );
}

// -------------------------------------------------------------------------------------------------
// Edge geometry
// -------------------------------------------------------------------------------------------------

/** Point at parameter t ∈ [0, 1]. */
export function edgePoint(e: Edge, t: number): [number, number] {
  if (e.kind === 'line') return [e.p0[0] + (e.p1[0] - e.p0[0]) * t, e.p0[1] + (e.p1[1] - e.p0[1]) * t];
  const a = e.a0 + e.sweep * t;
  return [e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)];
}

/** Unit tangent at parameter t (direction of travel). */
export function edgeDirection(e: Edge, t: number): [number, number] {
  if (e.kind === 'line') {
    const dx = e.p1[0] - e.p0[0];
    const dy = e.p1[1] - e.p0[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  }
  const a = e.a0 + e.sweep * t;
  const s = Math.sign(e.sweep);
  return [-Math.sin(a) * s, Math.cos(a) * s];
}

/** Signed area contribution ∮ (x dy − y dx) / 2 of one edge. */
function edgeArea(e: Edge): number {
  if (e.kind === 'line') return (e.p0[0] * e.p1[1] - e.p1[0] * e.p0[1]) / 2;
  const a1 = e.a0 + e.sweep;
  return 0.5 * (e.cx * e.r * (Math.sin(a1) - Math.sin(e.a0)) - e.cy * e.r * (Math.cos(a1) - Math.cos(e.a0)) + e.r * e.r * e.sweep);
}

/** Signed area of a contour (> 0: counterclockwise in math axes, filled region on the left). */
export function contourArea(c: Contour): number {
  let a = 0;
  for (const e of c.edges) a += edgeArea(e);
  return a;
}

function reverseEdge(e: Edge): Edge {
  if (e.kind === 'line') return { kind: 'line', p0: e.p1, p1: e.p0, color: e.color };
  return { kind: 'arc', cx: e.cx, cy: e.cy, r: e.r, a0: e.a0 + e.sweep, sweep: -e.sweep, p0: e.p1, p1: e.p0, color: e.color };
}

export function reverseContour(c: Contour): Contour {
  const edges: Edge[] = [];
  for (let i = c.edges.length - 1; i >= 0; i--) edges.push(reverseEdge(c.edges[i]!));
  return { edges };
}

/** Orients a contour: `hole` ⇒ negative area, otherwise positive (filled region on the left). */
export function orientContour(c: Contour, hole: boolean): Contour {
  const a = contourArea(c);
  return (a < 0) !== hole ? reverseContour(c) : c;
}

/** Splits an edge into three pieces (teardrop coloring of contours with fewer than 3 edges). */
function splitEdgeInThirds(e: Edge): Edge[] {
  const out: Edge[] = [];
  for (let k = 0; k < 3; k++) {
    const t0 = k / 3;
    const t1 = (k + 1) / 3;
    const p0 = edgePoint(e, t0);
    const p1 = edgePoint(e, t1);
    if (e.kind === 'line') out.push({ kind: 'line', p0, p1, color: e.color });
    else out.push({ kind: 'arc', cx: e.cx, cy: e.cy, r: e.r, a0: e.a0 + e.sweep * t0, sweep: e.sweep / 3, p0, p1, color: e.color });
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Edge coloring (msdfgen "simple", fixed seed 0 ⇒ CYAN → MAGENTA → YELLOW cycle)
// -------------------------------------------------------------------------------------------------

function isCorner(a: readonly number[], b: readonly number[]): boolean {
  const dot = a[0]! * b[0]! + a[1]! * b[1]!;
  const cross = a[0]! * b[1]! - a[1]! * b[0]!;
  return dot <= 0 || Math.abs(cross) > CORNER_CROSS_THRESHOLD;
}

/** Next color of the cycle; `banned` forces a color sharing no channel with a banned primary. */
function switchColor(color: number, banned = 0): number {
  const combined = color & banned;
  if (combined === RED || combined === GREEN || combined === BLUE) return combined ^ WHITE;
  if (color === 0 || color === WHITE) return CYAN;
  const shifted = color << 1;
  return (shifted | (shifted >> 3)) & WHITE;
}

/** Colors all edges of a shape in place (returns the same shape; teardrop contours may gain edges). */
export function colorEdges(shape: Shape): Shape {
  let color = 0;
  for (let ci = 0; ci < shape.contours.length; ci++) {
    let contour = shape.contours[ci]!;
    const edges = contour.edges;
    if (edges.length === 0) continue;
    const corners: number[] = [];
    let prev = edgeDirection(edges[edges.length - 1]!, 1);
    for (let i = 0; i < edges.length; i++) {
      if (isCorner(prev, edgeDirection(edges[i]!, 0))) corners.push(i);
      prev = edgeDirection(edges[i]!, 1);
    }
    if (corners.length === 0) {
      color = switchColor(color);
      for (const e of edges) e.color = color;
    } else if (corners.length === 1) {
      // Teardrop: three runs (color, WHITE, color') around the single corner.
      const wasSplit = edges.length < 3;
      if (wasSplit) {
        const split: Edge[] = [];
        for (const e of edges) split.push(...splitEdgeInThirds(e));
        contour = { edges: split };
        shape.contours[ci] = contour;
      }
      const es = contour.edges;
      const m = es.length;
      color = switchColor(color);
      const c0 = color;
      color = switchColor(color);
      const colors = [c0, WHITE, color];
      const corner = corners[0]! * (wasSplit ? 3 : 1);
      for (let i = 0; i < m; i++) {
        // symmetrical trichotomy of i over m
        const third = Math.trunc(3 + (2.875 * i) / (m - 1) - 1.4375 + 0.5) - 3;
        es[(corner + i) % m]!.color = colors[1 + third]!;
      }
    } else {
      const m = edges.length;
      const start = corners[0]!;
      let spline = 0;
      color = switchColor(color);
      const initial = color;
      for (let i = 0; i < m; i++) {
        const index = (start + i) % m;
        if (spline + 1 < corners.length && corners[spline + 1] === index) {
          spline++;
          color = switchColor(color, spline === corners.length - 1 ? initial : 0);
        }
        edges[index]!.color = color;
      }
    }
  }
  return shape;
}

// -------------------------------------------------------------------------------------------------
// Distances
// -------------------------------------------------------------------------------------------------

/** Result of an edge distance query (reused, allocation-free in the inner loop). */
interface EdgeDist {
  /** Signed distance (> 0 inside = left of the edge). */
  d: number;
  /** |cos| between the edge tangent and the direction to the point at an endpoint (0 = orthogonal). */
  dot: number;
  /** -1: nearest point is the start (param < 0 side), 0: interior, +1: the end. */
  side: number;
}

const TWO_PI = Math.PI * 2;

function endpointDist(e: Edge, px: number, py: number, atEnd: boolean, out: EdgeDist): void {
  const q = atEnd ? e.p1 : e.p0;
  const dir = edgeDirection(e, atEnd ? 1 : 0);
  const vx = px - q[0];
  const vy = py - q[1];
  const len = Math.hypot(vx, vy);
  const cross = dir[0] * vy - dir[1] * vx;
  out.d = (cross < 0 ? -1 : 1) * len;
  out.dot = len > 0 ? Math.abs((dir[0] * vx + dir[1] * vy) / len) : 0;
  out.side = atEnd ? 1 : -1;
}

/** Signed distance from (px, py) to an edge. */
export function edgeSignedDistance(e: Edge, px: number, py: number, out: EdgeDist): void {
  if (e.kind === 'line') {
    const ax = e.p0[0];
    const ay = e.p0[1];
    const bx = e.p1[0] - ax;
    const by = e.p1[1] - ay;
    const l2 = bx * bx + by * by;
    const t = ((px - ax) * bx + (py - ay) * by) / l2;
    if (t > 0 && t < 1) {
      const l = Math.sqrt(l2);
      const ortho = (bx * (py - ay) - by * (px - ax)) / l;
      // Endpoint distances are never shorter in the interior parameter range of a line.
      out.d = ortho;
      out.dot = 0;
      out.side = 0;
      return;
    }
    endpointDist(e, px, py, t >= 0.5, out);
    return;
  }
  const vx = px - e.cx;
  const vy = py - e.cy;
  const phi = Math.atan2(vy, vx);
  let delta = e.sweep > 0 ? phi - e.a0 : e.a0 - phi;
  delta -= Math.floor(delta / TWO_PI) * TWO_PI;
  const span = Math.abs(e.sweep);
  if (delta <= span) {
    const dist = Math.hypot(vx, vy);
    // Left of a counterclockwise arc is the center side.
    out.d = e.sweep > 0 ? e.r - dist : dist - e.r;
    out.dot = 0;
    out.side = 0;
    return;
  }
  // Outside the sweep: the nearer endpoint.
  const d0 = Math.hypot(px - e.p0[0], py - e.p0[1]);
  const d1 = Math.hypot(px - e.p1[0], py - e.p1[1]);
  endpointDist(e, px, py, d1 < d0, out);
}

/** Pseudo-distance: beyond an endpoint, the distance to the tangent line there (if not larger). */
function pseudoDistance(e: Edge, px: number, py: number, dist: EdgeDist): number {
  if (dist.side === 0) return dist.d;
  const atEnd = dist.side > 0;
  const q = atEnd ? e.p1 : e.p0;
  const dir = edgeDirection(e, atEnd ? 1 : 0);
  const vx = px - q[0];
  const vy = py - q[1];
  const ts = dir[0] * vx + dir[1] * vy;
  if (atEnd ? ts > 0 : ts < 0) {
    const pd = dir[0] * vy - dir[1] * vx;
    if (Math.abs(pd) <= Math.abs(dist.d)) return pd;
  }
  return dist.d;
}

// -------------------------------------------------------------------------------------------------
// Inside test (nonzero winding over finely flattened contours)
// -------------------------------------------------------------------------------------------------

/** Flattened contour polygon for the exact inside test (arcs → ≤ 1/2048-turn chords). */
export interface Polyline {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

export function flattenShape(shape: Shape): Polyline[] {
  const out: Polyline[] = [];
  for (const c of shape.contours) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const e of c.edges) {
      const n = e.kind === 'line' ? 1 : Math.max(8, Math.ceil((Math.abs(e.sweep) / TWO_PI) * 2048));
      for (let k = 0; k < n; k++) {
        const p = edgePoint(e, k / n);
        xs.push(p[0]);
        ys.push(p[1]);
      }
    }
    out.push({ xs: Float64Array.from(xs), ys: Float64Array.from(ys) });
  }
  return out;
}

/** Nonzero winding number of (px, py) against flattened contours. */
export function windingNumber(polys: readonly Polyline[], px: number, py: number): number {
  let w = 0;
  for (const p of polys) {
    const n = p.xs.length;
    for (let i = 0; i < n; i++) {
      const x0 = p.xs[i]!;
      const y0 = p.ys[i]!;
      const x1 = p.xs[(i + 1) % n]!;
      const y1 = p.ys[(i + 1) % n]!;
      if (y0 <= py) {
        if (y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) w++;
      } else if (y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) w--;
    }
  }
  return w;
}

// -------------------------------------------------------------------------------------------------
// Field generation
// -------------------------------------------------------------------------------------------------

/** Exact signed distance (texels, > 0 inside) of a shape at a point. */
export function trueSignedDistance(shape: Shape, polys: readonly Polyline[], px: number, py: number): number {
  const tmp: EdgeDist = { d: 0, dot: 0, side: 0 };
  let best = Infinity;
  for (const c of shape.contours) {
    for (const e of c.edges) {
      edgeSignedDistance(e, px, py, tmp);
      const a = Math.abs(tmp.d);
      if (a < best) best = a;
    }
  }
  return windingNumber(polys, px, py) !== 0 ? best : -best;
}

export interface FieldOptions {
  /** Cell size in texels (square). */
  readonly size: number;
}

/** Plain signed distance field (texels, float) of a shape sampled at texel centers. */
export function generateSdf(shape: Shape, opts: FieldOptions): Float64Array {
  const n = opts.size;
  const polys = flattenShape(shape);
  const out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = trueSignedDistance(shape, polys, x + 0.5, y + 0.5);
  return out;
}

export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

export interface MsdfResult {
  /** 3 channels (r, g, b) per texel, pseudo-distances in texels (> 0 inside). */
  readonly channels: Float64Array;
  /** Exact signed distance per texel. */
  readonly sdf: Float64Array;
  /** Texels flattened by the error correction. */
  readonly corrected: number;
}

/**
 * MSDF of a shape (edges must be colored, contours oriented). `pxRange` is only used for the clash
 * test's saturation (channels beyond ±pxRange/2 are clamped on encode).
 */
export function generateMsdf(shape: Shape, opts: FieldOptions & { readonly pxRange: number }): MsdfResult {
  const n = opts.size;
  const polys = flattenShape(shape);
  const channels = new Float64Array(n * n * 3);
  const sdf = new Float64Array(n * n);
  const tmp: EdgeDist = { d: 0, dot: 0, side: 0 };
  const best: EdgeDist[] = [
    { d: 0, dot: 0, side: 0 },
    { d: 0, dot: 0, side: 0 },
    { d: 0, dot: 0, side: 0 },
  ];
  const bestEdge: (Edge | null)[] = [null, null, null];
  const bits = [RED, GREEN, BLUE];
  const edges: Edge[] = [];
  for (const c of shape.contours) for (const e of c.edges) edges.push(e);

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      for (let k = 0; k < 3; k++) {
        best[k]!.d = Infinity;
        best[k]!.dot = Infinity;
        bestEdge[k] = null;
      }
      let minAbs = Infinity;
      for (const e of edges) {
        edgeSignedDistance(e, px, py, tmp);
        const a = Math.abs(tmp.d);
        if (a < minAbs) minAbs = a;
        for (let k = 0; k < 3; k++) {
          if ((e.color & bits[k]!) === 0) continue;
          const b = best[k]!;
          const ba = Math.abs(b.d);
          if (a < ba - 1e-12 || (Math.abs(a - ba) <= 1e-12 && tmp.dot < b.dot)) {
            b.d = tmp.d;
            b.dot = tmp.dot;
            b.side = tmp.side;
            bestEdge[k] = e;
          }
        }
      }
      const i = y * n + x;
      const inside = windingNumber(polys, px, py) !== 0;
      sdf[i] = inside ? minAbs : -minAbs;
      for (let k = 0; k < 3; k++) {
        const e = bestEdge[k] ?? null;
        channels[i * 3 + k] = e === null ? sdf[i]! : pseudoDistance(e, px, py, best[k]!);
      }
    }
  }
  const corrected = correctErrors(shape, polys, channels, sdf, n, opts.pxRange);
  return { channels, sdf, corrected };
}

function flatten(channels: Float64Array, sdf: Float64Array, i: number, mark: Uint8Array): boolean {
  if (mark[i] === 1) return false;
  mark[i] = 1;
  channels[i * 3] = sdf[i]!;
  channels[i * 3 + 1] = sdf[i]!;
  channels[i * 3 + 2] = sdf[i]!;
  return true;
}

/** See module doc step 4. Returns the number of flattened texels. */
function correctErrors(shape: Shape, polys: readonly Polyline[], ch: Float64Array, sdf: Float64Array, n: number, pxRange: number): number {
  const mark = new Uint8Array(n * n);
  const half = pxRange / 2;
  const clampd = (v: number): number => (v > half ? half : v < -half ? -half : v);
  let count = 0;
  // (a) wrong-sign medians at texel centers.
  for (let i = 0; i < n * n; i++) {
    const m = median3(ch[i * 3]!, ch[i * 3 + 1]!, ch[i * 3 + 2]!);
    if (Math.abs(sdf[i]!) > 1e-9 && m > 0 !== sdf[i]! > 0) if (flatten(ch, sdf, i, mark)) count++;
  }
  // (b) wrong-sign medians of the bilinear interpolation between neighbors (as the GPU samples).
  const pairs: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [1, 1],
  ];
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        for (const [dx, dy] of pairs) {
          const x1 = x + dx;
          const y1 = y + dy;
          if (x1 >= n || y1 >= n) continue;
          const members = dx === 1 && dy === 1 ? [i, i + 1, i + n, i + n + 1] : [i, y1 * n + x1];
          let r = 0;
          let g = 0;
          let b = 0;
          for (const j of members) {
            r += clampd(ch[j * 3]!);
            g += clampd(ch[j * 3 + 1]!);
            b += clampd(ch[j * 3 + 2]!);
          }
          const m = median3(r, g, b) / members.length;
          const t = trueSignedDistance(shape, polys, x + 0.5 + dx / 2, y + 0.5 + dy / 2);
          if (Math.abs(t) > CLASH_TOLERANCE_PX && m > 0 !== t > 0) {
            for (const j of members) if (flatten(ch, sdf, j, mark)) changed++;
          }
        }
      }
    }
    count += changed;
    if (changed === 0) break;
  }
  return count;
}

/** Encodes a distance (texels) into u8 with `value = 0.5 + d / range`, clamped. */
export function encodeDistance(d: number, range: number): number {
  const v = 0.5 + d / range;
  return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
}

/** Decodes a u8 back into a distance (texels). */
export function decodeDistance(v: number, range: number): number {
  return (v / 255 - 0.5) * range;
}
