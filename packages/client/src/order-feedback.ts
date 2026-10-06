/**
 * Order feedback of the selection (C3/G7/G19, MS3; PLAN §3.6 "Latenz"): everything drawn for the
 * orders of selected units, built without allocation in the rAF path.
 *
 * - Optimistic feedback: right after a Move command a waypoint line (from the group's centroid, or
 *   for Shift-queued moves from the previous command target) and a target disc, until a frame
 *   confirms the command's seq (`ackSeq`).
 * - Watch lines (after confirmation): for every selected unit in the frame's Watch section
 *   (`ctl.watch` = the first 64 selected handles) the route unit → remaining path waypoints →
 *   queued order targets as overlay segments (subdivided so they follow the terrain), plus a target
 *   disc per order target (terrain decal).
 * - Selected units that are not watched (> 64) or shown as icons only get one target disc per
 *   command (not one per unit slot): the client remembers the
 *   targets of its own Move commands per handle ({@link CommandTargets}) and shows a disc while one
 *   of the command's units is selected, unwatched and not idle (approximation: a queued unit shows
 *   all its command targets until it is idle).
 * - Selection rings: one dynamic terrain decal per selected unit drawn as a mesh (selection radius
 *   from view.json, army color) at the interpolated position; a unit shown as an icon (strategic
 *   zoom) marks its selection with the icon border instead (keeps the per-chunk decal budget for the
 *   units that need it).
 * - Route lines keep a roughly constant screen width (width ∝ camera distance).
 * - Optional path overlay (`pathOverlay`): waypoint dots and route colours by watch flags (stuck
 *   red, path pending yellow, retargeted orange).
 */
import { UnitFlags, WatchFlags, WatchOrderType, type FrameReader } from '@faf/protocol';
import {
  DynamicDecals,
  ICON_FADE_BAND,
  RAW_PER_WU,
  iconProjectionScale,
  strategicZoom,
  type OverlaySegment,
  type RtsCamera,
  type StrategicZoom,
} from '@faf/render';
import { ICON_HIT_FADE, interpolatedPos, type Selection } from './selection.ts';
import type { VisualGeometry } from './visuals.ts';

/** What the feedback needs from the map: the sim-exact terrain height (raw). */
export interface HeightSource {
  heightAtRaw(xRaw: number, zRaw: number): number;
}

export const ROUTE_COLOR = 0x40ff60;
export const QUEUED_COLOR = 0xb8ffc4;
export const STOP_COLOR = 0xff6a4a;
export const STUCK_COLOR = 0xff4a3a;
export const PENDING_COLOR = 0xffd24a;
export const RETARGET_COLOR = 0xff9a2a;
export const ROUTE_WIDTH_WU = 0.14;
/** Route width per WU of camera distance (≈ 2.5 CSS px at 720 px viewport height). */
export const ROUTE_WIDTH_PER_DISTANCE = 0.003;
export const TARGET_DISC_WU = 0.55;
/** Longest terrain-following piece of a route segment (WU). */
export const ROUTE_PIECE_WU = 4;
/** At most this many pieces per route segment. */
const MAX_PIECES = 24;
/** Hard cap of overlay segments per frame. */
export const MAX_ROUTE_SEGMENTS = 16384;
/** Remembered Move commands (ring). */
export const MAX_COMMAND_TARGETS = 64;
/** Optimistic lines/discs awaiting their seq. */
const MAX_OPTIMISTIC = 32;
/** Raw units per WU (render RAW_PER_WU; a module-local constant keeps the hot loops free of import getters). */
const RAW = RAW_PER_WU;

interface MutableSegment {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  color: number;
  widthWU: number;
}

/** Targets of the client's own Move/Stop commands per handle (for unwatched selected units). */
export class CommandTargets {
  readonly seq = new Int32Array(MAX_COMMAND_TARGETS);
  readonly x = new Int32Array(MAX_COMMAND_TARGETS);
  readonly z = new Int32Array(MAX_COMMAND_TARGETS);
  readonly n = new Int32Array(MAX_COMMAND_TARGETS);
  readonly handles: Uint32Array[] = [];
  /** Oldest record slot (ring). */
  private head = 0;
  /** Records in use. */
  size = 0;

  constructor() {
    for (let i = 0; i < MAX_COMMAND_TARGETS; i++) this.handles.push(new Uint32Array(16));
  }

  /** Slot of the k-th record (0 = oldest). */
  slot(k: number): number {
    return (this.head + k) % MAX_COMMAND_TARGETS;
  }

  /**
   * Remembers a Move to (x, z) for `units`. Without `queue` the units' earlier targets are
   * forgotten (the command replaces their orders).
   */
  add(seq: number, units: ArrayLike<number>, x: number, z: number, queue: boolean): void {
    if (!queue) this.forget(units);
    if (units.length === 0) return;
    if (this.size === MAX_COMMAND_TARGETS) {
      this.n[this.head] = 0;
      this.head = (this.head + 1) % MAX_COMMAND_TARGETS;
      this.size--;
    }
    const s = (this.head + this.size) % MAX_COMMAND_TARGETS;
    let list = this.handles[s]!;
    if (list.length < units.length) {
      let cap = list.length;
      while (cap < units.length) cap *= 2;
      list = new Uint32Array(cap);
      this.handles[s] = list;
    }
    for (let i = 0; i < units.length; i++) list[i] = units[i]! >>> 0;
    this.n[s] = units.length;
    this.seq[s] = seq;
    this.x[s] = x;
    this.z[s] = z;
    this.size++;
  }

  /** Forgets every remembered target of `units` (Stop, non-queued Move). */
  forget(units: ArrayLike<number>): void {
    if (units.length === 0 || this.size === 0) return;
    for (let k = 0; k < this.size; k++) {
      const s = this.slot(k);
      const list = this.handles[s]!;
      let n = this.n[s]!;
      for (let i = 0; i < n; ) {
        let hit = false;
        const h = list[i]!;
        for (let u = 0; u < units.length; u++) {
          if (units[u]! >>> 0 === h) {
            hit = true;
            break;
          }
        }
        if (hit) list[i] = list[--n]!;
        else i++;
      }
      this.n[s] = n;
    }
    this.compact();
  }

  /** Target (x, z raw) of the newest record containing `handle`, into `out`; false if none. */
  lastTargetOf(handle: number, out: Float64Array): boolean {
    const h = handle >>> 0;
    for (let k = this.size - 1; k >= 0; k--) {
      const s = this.slot(k);
      const list = this.handles[s]!;
      const n = this.n[s]!;
      for (let i = 0; i < n; i++) {
        if (list[i] === h) {
          out[0] = this.x[s]!;
          out[1] = this.z[s]!;
          return true;
        }
      }
    }
    return false;
  }

  /** Drops empty records at the ring's head. */
  private compact(): void {
    while (this.size > 0 && this.n[this.head] === 0) {
      this.head = (this.head + 1) % MAX_COMMAND_TARGETS;
      this.size--;
    }
  }
}

export class OrderFeedback {
  /** Overlay segments (renderer `overlays.lines`), rebuilt by `update`. */
  readonly lines: OverlaySegment[] = [];
  /** Dynamic terrain decals (selection rings, target discs), rebuilt by `update`. */
  readonly decals = new DynamicDecals();
  readonly targets = new CommandTargets();
  /** Debug overlay: waypoint dots, route colors by watch flags. */
  pathOverlay = false;
  /** Draw selection rings (default on). */
  rings = true;
  /** Army color of the selection rings (0xRRGGBB). */
  ringColor = 0x2a6bf2;
  /** Last build: route segments / target discs / rings / watched units drawn. */
  segments = 0;
  discs = 0;
  ringCount = 0;
  watchedDrawn = 0;
  /** Bumped whenever lines or decals were rebuilt. */
  version = 0;

  private readonly pool: MutableSegment[] = [];
  private height: HeightSource;
  // optimistic entries (ring, oldest first)
  private readonly oSeq = new Int32Array(MAX_OPTIMISTIC);
  private readonly oAx = new Float64Array(MAX_OPTIMISTIC);
  private readonly oAy = new Float64Array(MAX_OPTIMISTIC);
  private readonly oAz = new Float64Array(MAX_OPTIMISTIC);
  private readonly oBx = new Int32Array(MAX_OPTIMISTIC);
  private readonly oBz = new Int32Array(MAX_OPTIMISTIC);
  private oN = 0;
  /** Per record of the current frame: 1 = in the frame's watch section. */
  private watched = new Uint8Array(1024);
  /** Per record of the current frame (selected units only): 1 = drawn as an icon. */
  private iconMode = new Uint8Array(1024);
  private readonly p = new Float64Array(3);
  /** Route cursor (raw x, y, z) and end point scratch. */
  private readonly from = new Float64Array(3);
  private readonly to = new Float64Array(2);
  // change detection
  private kFrame = -1;
  private kAlpha = Number.NaN;
  private kSel = -1;
  private kOpt = 0;
  private optVersion = 0;
  private kOverlay = false;
  private kHeight: HeightSource | null = null;
  private kCam = -1;
  private camera: RtsCamera | null = null;
  private mapSizeWU = 0;
  private width = ROUTE_WIDTH_WU;
  private readonly zoom: StrategicZoom = { level: 0, iconForce: 0, z1: 0, z2: 0 };

  constructor(height: HeightSource) {
    this.height = height;
  }

  /** Switches the height source (new map). */
  setHeightSource(h: HeightSource): void {
    this.height = h;
    this.optVersion++;
  }

  /** Number of optimistic entries still waiting for their seq. */
  get optimisticCount(): number {
    return this.oN;
  }

  /**
   * Optimistic feedback for a sent Move (seq): line from (ax, ay, az) to (bx, bz) raw and a target
   * disc at (bx, bz), until `acknowledge` confirms the seq.
   */
  addOptimistic(seq: number, ax: number, ay: number, az: number, bx: number, bz: number): void {
    if (this.oN === MAX_OPTIMISTIC) this.dropOptimistic(0);
    const k = this.oN++;
    this.oSeq[k] = seq;
    this.oAx[k] = ax;
    this.oAy[k] = ay;
    this.oAz[k] = az;
    this.oBx[k] = bx;
    this.oBz[k] = bz;
    this.optVersion++;
  }

  /** Drops the optimistic entries confirmed by `ackSeq` (u16 serial arithmetic). */
  acknowledge(ackSeq: number): void {
    const ack = ackSeq & 0xffff;
    for (let k = 0; k < this.oN; ) {
      if (((ack - this.oSeq[k]!) & 0xffff) < 0x8000) this.dropOptimistic(k);
      else k++;
    }
  }

  /** Forces a rebuild on the next `update`. */
  invalidate(): void {
    this.optVersion++;
  }

  /**
   * Rebuilds lines and decals if the frame, alpha, selection or optimistic set changed.
   * `frameVersion` identifies the frame (stream frame count). Returns true if rebuilt.
   */
  update(
    r: FrameReader | null,
    frameVersion: number,
    sel: Selection,
    geo: VisualGeometry | null,
    alpha: number,
    camera: RtsCamera | null = null,
    mapSizeWU = 0,
  ): boolean {
    const selChanged = sel.version !== this.kSel;
    const camChanged = camera !== null && camera.version !== this.kCam;
    const moving = sel.count > 0 || this.oN > 0;
    if (
      frameVersion === this.kFrame &&
      !selChanged &&
      this.optVersion === this.kOpt &&
      this.pathOverlay === this.kOverlay &&
      this.height === this.kHeight &&
      !(camChanged && moving) &&
      (!moving || alpha === this.kAlpha)
    ) {
      return false;
    }
    this.camera = camera;
    this.mapSizeWU = mapSizeWU;
    if (camera !== null) {
      this.kCam = camera.version;
      const w = camera.distance * ROUTE_WIDTH_PER_DISTANCE;
      this.width = w < ROUTE_WIDTH_WU ? ROUTE_WIDTH_WU : w;
    } else {
      this.width = ROUTE_WIDTH_WU;
    }
    this.kFrame = frameVersion;
    this.kAlpha = alpha;
    this.kSel = sel.version;
    this.kOpt = this.optVersion;
    this.kOverlay = this.pathOverlay;
    this.kHeight = this.height;
    this.build(r, sel, geo, alpha);
    this.version++;
    return true;
  }

  // ---- internals ------------------------------------------------------------------------------

  private dropOptimistic(k: number): void {
    const last = this.oN - 1;
    for (let i = k; i < last; i++) {
      this.oSeq[i] = this.oSeq[i + 1]!;
      this.oAx[i] = this.oAx[i + 1]!;
      this.oAy[i] = this.oAy[i + 1]!;
      this.oAz[i] = this.oAz[i + 1]!;
      this.oBx[i] = this.oBx[i + 1]!;
      this.oBz[i] = this.oBz[i + 1]!;
    }
    this.oN = last;
    this.optVersion++;
  }

  private build(r: FrameReader | null, sel: Selection, geo: VisualGeometry | null, alpha: number): void {
    const d = this.decals;
    d.clear();
    this.segments = 0;
    this.discs = 0;
    this.ringCount = 0;
    this.watchedDrawn = 0;
    const p = this.p;
    // 1. per selected unit: icon or mesh (renderer crossfade rule, render `unitIconFade`, inlined:
    //    no boxing in the rAF path); selection rings for meshes (first: they matter most when a
    //    chunk runs out of decal slots). Icons mark the selection with their border.
    if (r !== null) {
      const n = r.unitCount;
      if (this.watched.length < n) {
        let cap = this.watched.length;
        while (cap < n) cap *= 2;
        this.watched = new Uint8Array(cap);
        this.iconMode = new Uint8Array(cap);
      }
      const im = this.iconMode;
      const color = this.ringColor;
      const cam = this.camera;
      let k2 = 0;
      let force = 0;
      if (cam !== null) {
        k2 = iconProjectionScale(cam.viewportHeight, cam.fovY);
        force = strategicZoom(cam.distance, this.mapSizeWU, this.zoom).iconForce;
      }
      for (let k = 0; k < sel.count; k++) {
        const i = sel.indices[k]!;
        interpolatedPos(r, i, alpha, p);
        const v = r.unitVisual(i);
        const rad = geo === null ? 0.6 : geo.radius(v);
        let icon = 0;
        if (cam !== null && geo !== null) {
          const ci = cam.camPosInt;
          const cf = cam.camFrac;
          const dx = (p[0]! - ci[0]!) / RAW - cf[0]!;
          const dy = (p[1]! - ci[1]!) / RAW - cf[1]!;
          const dz = (p[2]! - ci[2]!) / RAW - cf[2]!;
          let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < 1e-4) dist = 1e-4;
          const px = (2 * rad * k2) / dist;
          const thr = geo.threshold(v);
          let f = 0;
          if (thr > 0) {
            f = (ICON_FADE_BAND * thr - px) / ((ICON_FADE_BAND - 1) * thr);
            f = f < 0 ? 0 : f > 1 ? 1 : f;
          }
          if (force > f) f = force;
          if (f >= ICON_HIT_FADE) icon = 1;
        }
        im[i] = icon;
        if (icon === 0 && this.rings && d.ring(p[0]!, p[2]!, rad, color, 0.9, Math.max(0.08, Math.min(0.2, rad * 0.12))) >= 0) this.ringCount++;
      }
    }
    // 2. optimistic lines + discs
    for (let k = 0; k < this.oN; k++) {
      const bx = this.oBx[k]!;
      const bz = this.oBz[k]!;
      const f = this.from;
      f[0] = this.oAx[k]!;
      f[1] = this.oAy[k]!;
      f[2] = this.oAz[k]!;
      this.route(bx, bz, ROUTE_COLOR);
      this.disc(bx, bz, ROUTE_COLOR, 0.9);
    }
    if (r === null) {
      this.finishLines();
      return;
    }
    // 3. watch routes of selected units; per-unit target discs only for units drawn as meshes
    //    (icons, e.g. the whole-map view, get one disc per command target in step 4)
    const n = r.unitCount;
    const wm = this.watched;
    const im = this.iconMode;
    wm.fill(0, 0, n);
    const hl = sel.highlight;
    const wc = r.watchCount;
    const overlay = this.pathOverlay;
    for (let w = 0; w < wc; w++) {
      const i = sel.index.get(r.watchHandle(w));
      if (i < 0) continue;
      wm[i] = 1;
      if (hl[i] !== 1) continue;
      this.watchedDrawn++;
      // Route cursor: `from` (doubles live in a typed array – no boxed call arguments).
      const f = this.from;
      interpolatedPos(r, i, alpha, f);
      const flags = r.watchFlags(w);
      let color = ROUTE_COLOR;
      if (overlay) {
        if ((flags & WatchFlags.Stuck) !== 0) color = STUCK_COLOR;
        else if ((flags & WatchFlags.PathPending) !== 0) color = PENDING_COLOR;
        else if ((flags & WatchFlags.Retargeted) !== 0) color = RETARGET_COLOR;
      }
      const pc = r.watchPointCount(w);
      for (let k = 0; k < pc; k++) {
        const bx = r.watchPointX(w, k);
        const bz = r.watchPointZ(w, k);
        this.route(bx, bz, color);
        if (overlay) d.disc(bx, bz, 0.22, color, 0.85, 0.05);
      }
      const tc = r.watchTargetCount(w);
      for (let k = 0; k < tc; k++) {
        const bx = r.watchTargetX(w, k);
        const bz = r.watchTargetZ(w, k);
        const stop = r.watchTargetType(w, k) === WatchOrderType.Stop;
        // The active order's target is the route's last point already (unless the path is empty).
        if (!(k === 0 && pc > 0 && f[0] === bx && f[2] === bz)) this.route(bx, bz, k === 0 ? color : QUEUED_COLOR);
        if (im[i] === 0) this.disc(bx, bz, stop ? STOP_COLOR : k === 0 ? ROUTE_COLOR : QUEUED_COLOR, k === 0 ? 0.9 : 0.7);
      }
    }
    // 4. command targets of selected, non-idle units that are unwatched or shown as icons
    const ct = this.targets;
    for (let k = 0; k < ct.size; k++) {
      const s = ct.slot(k);
      const list = ct.handles[s]!;
      const cnt = ct.n[s]!;
      let show = false;
      for (let u = 0; u < cnt && !show; u++) {
        const i = sel.index.get(list[u]!);
        if (i < 0 || hl[i] !== 1 || (wm[i] !== 0 && im[i] === 0)) continue;
        if ((r.unitFlags(i) & UnitFlags.Idle) === 0) show = true;
      }
      if (show) this.disc(ct.x[s]!, ct.z[s]!, QUEUED_COLOR, 0.75);
    }
    this.finishLines();
  }

  private disc(x: number, z: number, color: number, alpha: number): void {
    if (this.decals.disc(x, z, TARGET_DISC_WU, color, alpha, 0.12) >= 0) this.discs++;
  }

  /**
   * Appends a terrain-following route from `from` (raw, x/y/z) to (bx, terrain height, bz) and moves
   * `from` to the end point. Doubles never cross a call boundary (they would be boxed).
   */
  private route(bx: number, bz: number, color: number): void {
    const f = this.from;
    // End point as float64 (typed array load): a phi of a tagged parameter and a float64 would be
    // tagged in optimized code and box a HeapNumber per piece.
    const e = this.to;
    e[0] = bx;
    e[1] = bz;
    const ex = e[0]!;
    const ez = e[1]!;
    const ax = f[0]!;
    const az = f[2]!;
    const dx = ex - ax;
    const dz = ez - az;
    const lenWU = Math.sqrt(dx * dx + dz * dz) / RAW;
    let pieces = Math.ceil(lenWU / ROUTE_PIECE_WU);
    if (pieces < 1) pieces = 1;
    else if (pieces > MAX_PIECES) pieces = MAX_PIECES;
    const h = this.height;
    const width = this.width;
    for (let k = 1; k <= pieces; k++) {
      if (this.segments >= MAX_ROUTE_SEGMENTS) break;
      const t = k / pieces;
      const qx = k === pieces ? ex : ax + dx * t;
      const qz = k === pieces ? ez : az + dz * t;
      const qy = h.heightAtRaw(Math.round(qx), Math.round(qz));
      const n = this.segments++;
      let s = this.pool[n];
      if (s === undefined) {
        s = { ax: 0.5, ay: 0.5, az: 0.5, bx: 0.5, by: 0.5, bz: 0.5, color: ROUTE_COLOR, widthWU: ROUTE_WIDTH_WU };
        this.pool.push(s);
      }
      s.ax = f[0]!;
      s.ay = f[1]!;
      s.az = f[2]!;
      s.bx = qx;
      s.by = qy;
      s.bz = qz;
      s.color = color;
      s.widthWU = width;
      if (n < this.lines.length) this.lines[n] = s;
      else this.lines.push(s);
      f[0] = qx;
      f[1] = qy;
      f[2] = qz;
    }
    f[0] = bx;
    f[1] = h.heightAtRaw(bx, bz);
    f[2] = bz;
  }

  private finishLines(): void {
    if (this.lines.length !== this.segments) this.lines.length = this.segments;
  }
}
