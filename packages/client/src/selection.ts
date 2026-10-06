/**
 * Selection of own units (C3, MS3 — FA behaviour).
 *
 * - The game starts with nothing selected; a right click without a selection does nothing.
 * - Box select (left drag) selects own units, click select picks one unit; Shift+box adds,
 *   Shift+click toggles, a double click selects every own unit of the same visual on screen,
 *   Ctrl/⌘+A selects every own unit, Esc (and a click on empty ground) clears.
 * - Hit geometry follows the strategic zoom exactly like the renderer draws it
 *   ({@link ScreenProjection}): a unit whose icon covers it (render `unitIconFade` ≥ 0.5, the same
 *   crossfade rule and zoom force) is hit through its icon rectangle (render `iconScreenRect`); a
 *   unit drawn as a mesh through its projected position plus its projected selection radius.
 *   Positions are interpolated with the current alpha and projected on the CPU (no GPU readback).
 *
 * State: the selected handles as a sorted set (typed array). Output per frame: `handles` /
 * `indices` (selected units in frame order, `count` entries) and `highlight` (one byte per
 * UnitRecord, 1 = selected) for the renderer (icon border, HP bars, selection rings). The frame
 * rebuild (`onFrame`) and the projection do not allocate; handles of units that vanished drop out.
 */
import { FrameReader, UnitFlags } from '@faf/protocol';
import {
  eyeDistanceWU,
  iconFade,
  iconProjectionScale,
  ICON_SIZE_PX,
  strategicZoom,
  unitProjectedPx,
  type RtsCamera,
  type StrategicZoom,
} from '@faf/render';
import { HandleIndex } from './handle-index.ts';
import type { VisualGeometry } from './visuals.ts';

/** Flags of records that are never selectable (not a live own unit). */
const UNSELECTABLE = UnitFlags.Wreck | UnitFlags.Ghost | UnitFlags.Blip;

/** A unit counts as "shown as icon" for hit tests from this icon coverage on (renderer crossfade). */
export const ICON_HIT_FADE = 0.5;

/** True if record `i` is a selectable unit of `army`. */
export function isOwnUnit(r: FrameReader, i: number, army: number): boolean {
  return r.unitArmy(i) === army && (r.unitFlags(i) & UNSELECTABLE) === 0;
}

/**
 * Interpolated world position (raw, float) of record `i` at `alpha` — the same formula as the
 * unit shader (`noInterp` ⇒ cur). Writes x, y, z into `out[0..2]`.
 */
export function interpolatedPos(r: FrameReader, i: number, alpha: number, out: Float64Array): void {
  if ((r.unitFlags(i) & UnitFlags.NoInterp) !== 0) {
    out[0] = r.unitCur(i, 0);
    out[1] = r.unitCur(i, 1);
    out[2] = r.unitCur(i, 2);
    return;
  }
  const px = r.unitPrev(i, 0);
  const py = r.unitPrev(i, 1);
  const pz = r.unitPrev(i, 2);
  out[0] = px + (r.unitCur(i, 0) - px) * alpha;
  out[1] = py + (r.unitCur(i, 1) - py) * alpha;
  out[2] = pz + (r.unitCur(i, 2) - pz) * alpha;
}

/**
 * Screen-space geometry of every UnitRecord of a frame (CSS px, top-left origin), cached per
 * (frame, camera version, alpha, geometry, icon size, map size). `icon[i] = 1` ⇒ the unit is hit
 * through its icon square `[sx − s/2, sy − s/2, sx + s/2, sy + s/2]` (s = `iconSizePx`), else through
 * the disc (sx, sy, radiusPx). `visible[i] = 0` ⇒ behind the camera (never hit).
 */
export class ScreenProjection {
  count = 0;
  sx = new Float64Array(1024);
  sy = new Float64Array(1024);
  /** Projected selection radius (CSS px). */
  radiusPx = new Float64Array(1024);
  /** Icon coverage 0..1 as the renderer computes it. */
  fade = new Float64Array(1024);
  icon = new Uint8Array(1024);
  visible = new Uint8Array(1024);
  /** Icon edge length (CSS px) used for the rectangles. */
  iconSizePx = ICON_SIZE_PX;
  /** Strategic zoom of the last computation. */
  readonly zoom: StrategicZoom = { level: 0, iconForce: 0, z1: 0, z2: 0 };
  /** Viewport of the last computation (CSS px). */
  viewportWidth = 0;
  viewportHeight = 0;
  /** Bumped by every recomputation. */
  version = 0;

  private kFrame = -1;
  private kCam = -1;
  private kAlpha = Number.NaN;
  private kGeo: VisualGeometry | null = null;
  private kSize = Number.NaN;
  private kMap = Number.NaN;
  private kCamObj: RtsCamera | null = null;
  private readonly p = new Float64Array(3);
  private readonly s = new Float64Array(4);

  /** Forces the next `update` to recompute. */
  invalidate(): void {
    this.kFrame = -1;
  }

  /**
   * Projects every record of `r` (interpolated with `alpha`) unless nothing changed since the last
   * call. `frameVersion` identifies the frame content (e.g. the stream's frame count).
   */
  update(
    r: FrameReader,
    frameVersion: number,
    camera: RtsCamera,
    alpha: number,
    geo: VisualGeometry,
    mapSizeWU: number,
    iconSizePx: number,
  ): void {
    camera.update();
    if (
      frameVersion === this.kFrame &&
      camera === this.kCamObj &&
      camera.version === this.kCam &&
      alpha === this.kAlpha &&
      geo === this.kGeo &&
      iconSizePx === this.kSize &&
      mapSizeWU === this.kMap
    ) {
      return;
    }
    this.kFrame = frameVersion;
    this.kCamObj = camera;
    this.kCam = camera.version;
    this.kAlpha = alpha;
    this.kGeo = geo;
    this.kSize = iconSizePx;
    this.kMap = mapSizeWU;
    this.iconSizePx = iconSizePx;
    this.viewportWidth = camera.viewportWidth;
    this.viewportHeight = camera.viewportHeight;
    const n = r.unitCount;
    this.ensure(n);
    const z = strategicZoom(camera.distance, mapSizeWU, this.zoom);
    const k = iconProjectionScale(camera.viewportHeight, camera.fovY);
    const p = this.p;
    const s = this.s;
    for (let i = 0; i < n; i++) {
      interpolatedPos(r, i, alpha, p);
      const x = p[0]!;
      const y = p[1]!;
      const zz = p[2]!;
      const vis = camera.project(x, y, zz, s);
      this.visible[i] = vis ? 1 : 0;
      this.sx[i] = vis ? s[0]! : Number.NaN;
      this.sy[i] = vis ? s[1]! : Number.NaN;
      const v = r.unitVisual(i);
      const rad = geo.radius(v);
      const dist = eyeDistanceWU(camera, x, y, zz);
      const f = iconFade(unitProjectedPx(rad, dist, k), geo.threshold(v), z.iconForce);
      this.fade[i] = f;
      this.icon[i] = f >= ICON_HIT_FADE ? 1 : 0;
      this.radiusPx[i] = (rad * k) / Math.max(dist, 1e-4);
    }
    this.count = n;
    this.version++;
  }

  /** True if record `i` intersects the CSS rect [lx, hx] × [ly, hy]. */
  hitsRect(i: number, lx: number, ly: number, hx: number, hy: number): boolean {
    if (this.visible[i] === 0) return false;
    const x = this.sx[i]!;
    const y = this.sy[i]!;
    if (this.icon[i] !== 0) {
      const h = this.iconSizePx / 2;
      return x + h >= lx && x - h <= hx && y + h >= ly && y - h <= hy;
    }
    const r = this.radiusPx[i]!;
    const cx = x < lx ? lx : x > hx ? hx : x;
    const cy = y < ly ? ly : y > hy ? hy : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }

  /**
   * Squared pixel distance from (px, py) to record `i`'s centre if the point hits it (icon square,
   * or the disc of max(radiusPx, `minRadiusPx`)), else −1.
   */
  hitPoint(i: number, px: number, py: number, minRadiusPx: number): number {
    if (this.visible[i] === 0) return -1;
    const dx = this.sx[i]! - px;
    const dy = this.sy[i]! - py;
    if (this.icon[i] !== 0) {
      const h = this.iconSizePx / 2;
      return dx >= -h && dx <= h && dy >= -h && dy <= h ? dx * dx + dy * dy : -1;
    }
    const r = Math.max(this.radiusPx[i]!, minRadiusPx);
    const d2 = dx * dx + dy * dy;
    return d2 <= r * r ? d2 : -1;
  }

  /** True if record `i`'s projected centre lies inside the viewport. */
  onScreen(i: number): boolean {
    if (this.visible[i] === 0) return false;
    const x = this.sx[i]!;
    const y = this.sy[i]!;
    return x >= 0 && y >= 0 && x <= this.viewportWidth && y <= this.viewportHeight;
  }

  private ensure(n: number): void {
    if (this.sx.length >= n) return;
    let cap = this.sx.length;
    while (cap < n) cap *= 2;
    this.sx = new Float64Array(cap);
    this.sy = new Float64Array(cap);
    this.radiusPx = new Float64Array(cap);
    this.fade = new Float64Array(cap);
    this.icon = new Uint8Array(cap);
    this.visible = new Uint8Array(cap);
  }
}

export class Selection {
  /** Selected handles in frame order (first `count` entries valid). */
  handles = new Uint32Array(1024);
  /** Record index (in the current frame) of each selected handle. */
  indices = new Int32Array(1024);
  count = 0;
  /** One byte per UnitRecord of the current frame (1 = highlighted). */
  highlight = new Uint8Array(1024);
  /** Records covered by `highlight`. */
  highlightCount = 0;
  /** Changes whenever `highlight` changes (renderer upload key). */
  highlightVersion = 0;
  /** Changes whenever the selected set changes. */
  version = 0;
  /** Minimum click radius in CSS pixels around a unit drawn as a mesh. */
  clickRadiusPx = 14;
  /** Per-visual selection radius / icon threshold (renderer numbers). */
  geometry: VisualGeometry | null = null;
  /** Map edge length (WU) for the strategic zoom level (renderer: terrain size). */
  mapSizeWU = 0;
  /** Icon edge length in CSS px (renderer `setIconSize`, default 20). */
  iconSizePx = ICON_SIZE_PX;
  /** Handle → record index of the bound frame. */
  readonly index = new HandleIndex();
  /** Screen geometry of the bound frame (hit tests, hooks). */
  readonly projection = new ScreenProjection();

  /** Sorted set of selected handles (`setN` entries). */
  private members = new Uint32Array(1024);
  private setN = 0;
  private reader: FrameReader | null = null;
  private frameVersion = 0;

  constructor(public playerArmy: number) {}

  /** Selects every own unit of the bound frame. */
  selectAll(): number {
    const r = this.reader;
    this.setN = 0;
    if (r !== null) {
      const n = r.unitCount;
      this.ensureSet(n);
      for (let i = 0; i < n; i++) if (isOwnUnit(r, i, this.playerArmy)) this.members[this.setN++] = r.unitHandle(i);
      this.normalize();
    }
    this.refresh();
    return this.count;
  }

  /** Clears the selection. */
  clear(): void {
    this.setN = 0;
    this.refresh();
  }

  /**
   * Selects `handles` (replacing, or adding with `additive`); handles that are not own units of
   * the bound frame are dropped on the rebuild.
   */
  set(handles: ArrayLike<number>, additive = false): number {
    if (!additive) this.setN = 0;
    this.ensureSet(this.setN + handles.length);
    for (let i = 0; i < handles.length; i++) this.members[this.setN++] = handles[i]! >>> 0;
    this.normalize();
    this.refresh();
    return this.count;
  }

  /** Adds or removes one handle (Shift+click). Returns true if it is selected afterwards. */
  toggle(handle: number): boolean {
    const h = handle >>> 0;
    const at = this.find(h);
    if (at >= 0) {
      this.members.copyWithin(at, at + 1, this.setN);
      this.setN--;
    } else {
      this.ensureSet(this.setN + 1);
      this.members[this.setN++] = h;
      this.normalize();
    }
    this.refresh();
    return at < 0 && this.find(h) >= 0;
  }

  /** True if `handle` is currently selected. */
  has(handle: number): boolean {
    return this.find(handle >>> 0) >= 0;
  }

  /** Current selection in frame order (view, valid until the next rebuild). */
  selected(): Uint32Array {
    return this.handles.subarray(0, this.count);
  }

  /** Binds to a new frame: indexes it and rebuilds handles/highlight (allocation-free). */
  onFrame(reader: FrameReader, frameVersion = this.frameVersion + 1): void {
    this.reader = reader;
    this.frameVersion = frameVersion;
    this.index.build(reader);
    this.rebuild(false);
  }

  /** Reader of the bound frame. */
  get frame(): FrameReader | null {
    return this.reader;
  }

  /** Projects the bound frame for `camera`/`alpha` (cached). Needs `geometry`. */
  project(camera: RtsCamera, alpha: number): ScreenProjection {
    const r = this.reader;
    const pr = this.projection;
    if (r === null || this.geometry === null) {
      pr.count = 0;
      return pr;
    }
    pr.update(r, this.frameVersion, camera, alpha, this.geometry, this.mapSizeWU, this.iconSizePx);
    return pr;
  }

  /**
   * Box select in CSS pixels: own units whose icon rectangle (icon mode) or projected selection
   * disc (mesh mode) intersects the rectangle. Replaces the selection, or adds with `additive`.
   * Returns the number of units hit.
   */
  boxSelect(camera: RtsCamera, alpha: number, x0: number, y0: number, x1: number, y1: number, additive: boolean): number {
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1);
    const hy = Math.max(y0, y1);
    if (!additive) this.setN = 0;
    let hits = 0;
    const r = this.reader;
    if (r !== null) {
      const pr = this.project(camera, alpha);
      const n = pr.count;
      this.ensureSet(this.setN + n);
      for (let i = 0; i < n; i++) {
        if (!isOwnUnit(r, i, this.playerArmy) || !pr.hitsRect(i, lx, ly, hx, hy)) continue;
        this.members[this.setN++] = r.unitHandle(i);
        hits++;
      }
      this.normalize();
    }
    this.refresh();
    return hits;
  }

  /**
   * Record index of the unit under (x, y) CSS px (own units only unless `ownOnly` is false): icon
   * square or projected disc (at least `clickRadiusPx`), nearest centre wins; −1 if none.
   */
  pick(camera: RtsCamera, alpha: number, x: number, y: number, ownOnly = true): number {
    const r = this.reader;
    if (r === null) return -1;
    const pr = this.project(camera, alpha);
    let best = -1;
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pr.count; i++) {
      if (ownOnly && !isOwnUnit(r, i, this.playerArmy)) continue;
      const d2 = pr.hitPoint(i, x, y, this.clickRadiusPx);
      if (d2 >= 0 && d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  }

  /**
   * Click select: the own unit under (x, y). Without `toggle` it replaces the selection (a click on
   * empty ground clears it); with `toggle` (Shift) it adds/removes that unit and keeps the rest.
   * Returns the picked handle or −1.
   */
  clickSelect(camera: RtsCamera, alpha: number, x: number, y: number, toggle: boolean): number {
    const i = this.pick(camera, alpha, x, y);
    const r = this.reader;
    const handle = i >= 0 && r !== null ? r.unitHandle(i) : -1;
    if (toggle) {
      if (handle >= 0) this.toggle(handle);
      return handle;
    }
    this.setN = 0;
    if (handle >= 0) {
      this.ensureSet(1);
      this.members[this.setN++] = handle;
    }
    this.refresh();
    return handle;
  }

  /**
   * Double click: every own unit with the same visual as the unit under (x, y) whose projected
   * centre is on screen. Replaces the selection (adds with `additive`). Returns the number of units
   * of that type selected, or −1 without a unit under the cursor (selection unchanged).
   */
  selectSameType(camera: RtsCamera, alpha: number, x: number, y: number, additive: boolean): number {
    const i = this.pick(camera, alpha, x, y);
    const r = this.reader;
    if (i < 0 || r === null) return -1;
    const visual = r.unitVisual(i);
    const pr = this.projection;
    if (!additive) this.setN = 0;
    this.ensureSet(this.setN + pr.count);
    let n = 0;
    for (let k = 0; k < pr.count; k++) {
      if (r.unitVisual(k) !== visual || !isOwnUnit(r, k, this.playerArmy) || !pr.onScreen(k)) continue;
      this.members[this.setN++] = r.unitHandle(k);
      n++;
    }
    this.normalize();
    this.refresh();
    return n;
  }

  /** Every own unit of the bound frame with visual (= blueprint sim id) `visual`. Returns the count. */
  selectVisual(visual: number, additive = false): number {
    const r = this.reader;
    if (!additive) this.setN = 0;
    let n = 0;
    if (r !== null) {
      this.ensureSet(this.setN + r.unitCount);
      for (let i = 0; i < r.unitCount; i++) {
        if (r.unitVisual(i) !== visual || !isOwnUnit(r, i, this.playerArmy)) continue;
        this.members[this.setN++] = r.unitHandle(i);
        n++;
      }
      this.normalize();
    }
    this.refresh();
    return n;
  }

  // ---- internals ------------------------------------------------------------------------------

  private refresh(): void {
    this.version++;
    this.rebuild(true);
  }

  /** Binary search in the sorted set; index or −1. */
  private find(h: number): number {
    let lo = 0;
    let hi = this.setN - 1;
    const s = this.members;
    while (lo <= hi) {
      const m = (lo + hi) >>> 1;
      const v = s[m]!;
      if (v === h) return m;
      if (v < h) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  }

  /** Sorts and dedupes the set (input path only: `subarray` allocates a view). */
  private normalize(): void {
    const n = this.setN;
    if (n < 2) return;
    const s = this.members;
    s.subarray(0, n).sort();
    let w = 1;
    for (let i = 1; i < n; i++) if (s[i] !== s[w - 1]) s[w++] = s[i]!;
    this.setN = w;
  }

  private ensureSet(n: number): void {
    if (this.members.length >= n) return;
    let cap = this.members.length;
    while (cap < n) cap *= 2;
    const next = new Uint32Array(cap);
    next.set(this.members.subarray(0, this.setN));
    this.members = next;
  }

  private ensure(n: number): void {
    if (this.handles.length < n) {
      let cap = this.handles.length;
      while (cap < n) cap *= 2;
      this.handles = new Uint32Array(cap);
      this.indices = new Int32Array(cap);
    }
    if (this.highlight.length < n) {
      let cap = this.highlight.length;
      while (cap < n) cap *= 2;
      this.highlight = new Uint8Array(cap);
    }
  }

  /** Rebuilds handles/highlight from the bound frame; drops selected handles that vanished. */
  private rebuild(selectionChanged: boolean): void {
    const r = this.reader;
    if (r === null) {
      this.count = 0;
      this.highlightCount = 0;
      if (selectionChanged) this.highlightVersion++;
      return;
    }
    const n = r.unitCount;
    this.ensure(n);
    const hl = this.highlight;
    hl.fill(0, 0, n);
    const army = this.playerArmy;
    const idx = this.index;
    const s = this.members;
    // Mark present own units; compact the set in place (keeps it sorted).
    let w = 0;
    for (let k = 0; k < this.setN; k++) {
      const h = s[k]!;
      const i = idx.get(h);
      if (i < 0 || !isOwnUnit(r, i, army)) continue;
      hl[i] = 1;
      s[w++] = h;
    }
    if (w !== this.setN) {
      this.setN = w;
      this.version++;
    }
    let c = 0;
    const hs = this.handles;
    const ix = this.indices;
    if (w > 0) {
      for (let i = 0; i < n; i++) {
        if (hl[i] === 0) continue;
        ix[c] = i;
        hs[c++] = r.unitHandle(i);
      }
    }
    this.count = c;
    this.highlightCount = n;
    this.highlightVersion++;
  }
}
