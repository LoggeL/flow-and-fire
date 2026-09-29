/**
 * Selection of own units (MS1 preview of C1, accepted in MS3).
 *
 * - Default mode `allOwn`: every own unit of the current frame is selected (1,000 cubes react to
 *   a right click right away). This implicit selection is not highlighted.
 * - Box select (left drag) and click select (nearest own unit within a pixel radius) switch to the
 *   explicit mode; Shift adds to the current selection. A click on empty ground clears it.
 *   Ctrl/Cmd+A returns to `allOwn`.
 * - Box/click tests use the positions as they are on screen: interpolated with the current
 *   alpha, projected on the CPU (no GPU readback).
 *
 * Output: `handles` (selected units in frame order, `count` entries) and `highlight` (one byte per
 * UnitRecord of the frame, 1 = selected) for the renderer. Both are rebuilt on each new frame and
 * on each selection change; the rebuild does not allocate.
 */
import { FrameReader, UnitFlags } from '@faf/protocol';
import type { RtsCamera } from '@faf/render';

export type SelectionMode = 'allOwn' | 'explicit';

/** Flags of records that are never selectable (not a live own unit). */
const UNSELECTABLE = UnitFlags.Wreck | UnitFlags.Ghost | UnitFlags.Blip;

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

export class Selection {
  mode: SelectionMode = 'allOwn';
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
  /** Default click radius in CSS pixels. */
  clickRadiusPx = 14;
  /** Also highlight the implicit `allOwn` selection (default false: only explicit selections glow). */
  highlightImplicit = false;

  private readonly explicit = new Set<number>();
  private readonly p = new Float64Array(3);
  private readonly s = new Float64Array(4);
  private reader: FrameReader | null = null;

  constructor(public playerArmy: number) {}

  /** Selects all own units (default mode). */
  selectAll(): void {
    this.mode = 'allOwn';
    this.explicit.clear();
    this.refresh();
  }

  /** Clears the selection (explicit, empty). */
  clear(): void {
    this.mode = 'explicit';
    this.explicit.clear();
    this.refresh();
  }

  /** Selects exactly `handles` (explicit mode); units not in the current frame are dropped on rebuild. */
  set(handles: ArrayLike<number>, additive = false): void {
    if (!additive || this.mode === 'allOwn') this.explicit.clear();
    if (additive && this.mode === 'allOwn') this.copyCurrentInto();
    this.mode = 'explicit';
    for (let i = 0; i < handles.length; i++) this.explicit.add(handles[i]! >>> 0);
    this.refresh();
  }

  /** True if `handle` is currently selected. */
  has(handle: number): boolean {
    for (let i = 0; i < this.count; i++) if (this.handles[i] === handle >>> 0) return true;
    return false;
  }

  /** Current selection as a view (valid until the next rebuild). */
  selected(): Uint32Array {
    return this.handles.subarray(0, this.count);
  }

  /** Binds to a new frame and rebuilds handles/highlight. */
  onFrame(reader: FrameReader): void {
    this.reader = reader;
    this.rebuild(false);
  }

  /**
   * Box select in CSS pixels over the on-screen positions (interpolated with `alpha`).
   * Returns the number of units hit.
   */
  boxSelect(camera: RtsCamera, alpha: number, x0: number, y0: number, x1: number, y1: number, additive: boolean): number {
    const r = this.reader;
    const lx = Math.min(x0, x1);
    const hx = Math.max(x0, x1);
    const ly = Math.min(y0, y1);
    const hy = Math.max(y0, y1);
    if (!additive || this.mode === 'allOwn') {
      if (additive) this.copyCurrentInto();
      else this.explicit.clear();
    }
    this.mode = 'explicit';
    let hits = 0;
    if (r !== null) {
      camera.update();
      const n = r.unitCount;
      for (let i = 0; i < n; i++) {
        if (!isOwnUnit(r, i, this.playerArmy)) continue;
        interpolatedPos(r, i, alpha, this.p);
        if (!camera.project(this.p[0]!, this.p[1]!, this.p[2]!, this.s)) continue;
        const sx = this.s[0]!;
        const sy = this.s[1]!;
        if (sx >= lx && sx <= hx && sy >= ly && sy <= hy) {
          this.explicit.add(r.unitHandle(i));
          hits++;
        }
      }
    }
    this.refresh();
    return hits;
  }

  /**
   * Click select: the own unit nearest to (x, y) within `radiusPx` on screen. Without a hit the
   * selection is cleared (unless additive). Returns the picked handle or −1.
   */
  clickSelect(camera: RtsCamera, alpha: number, x: number, y: number, additive: boolean, radiusPx = this.clickRadiusPx): number {
    const r = this.reader;
    let best = -1;
    let bestD2 = radiusPx * radiusPx;
    if (r !== null) {
      camera.update();
      const n = r.unitCount;
      for (let i = 0; i < n; i++) {
        if (!isOwnUnit(r, i, this.playerArmy)) continue;
        interpolatedPos(r, i, alpha, this.p);
        if (!camera.project(this.p[0]!, this.p[1]!, this.p[2]!, this.s)) continue;
        const dx = this.s[0]! - x;
        const dy = this.s[1]! - y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
    if (!additive || this.mode === 'allOwn') {
      if (additive) this.copyCurrentInto();
      else this.explicit.clear();
    }
    this.mode = 'explicit';
    let handle = -1;
    if (best >= 0 && r !== null) {
      handle = r.unitHandle(best);
      this.explicit.add(handle);
    }
    this.refresh();
    return handle;
  }

  // ---- internals ------------------------------------------------------------------------------

  private copyCurrentInto(): void {
    for (let i = 0; i < this.count; i++) this.explicit.add(this.handles[i]!);
  }

  private refresh(): void {
    this.version++;
    this.rebuild(true);
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

  /** Rebuilds handles/highlight from the bound frame; prunes explicit handles that vanished. */
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
    const hs = this.handles;
    const ix = this.indices;
    const army = this.playerArmy;
    let c = 0;
    if (this.mode === 'allOwn') {
      const mark = this.highlightImplicit ? 1 : 0;
      for (let i = 0; i < n; i++) {
        if (isOwnUnit(r, i, army)) {
          ix[c] = i;
          hs[c++] = r.unitHandle(i);
          hl[i] = mark;
        } else hl[i] = 0;
      }
    } else {
      const set = this.explicit;
      for (let i = 0; i < n; i++) {
        const h = r.unitHandle(i);
        if (set.size !== 0 && set.has(h) && isOwnUnit(r, i, army)) {
          ix[c] = i;
          hs[c++] = h;
          hl[i] = 1;
        } else hl[i] = 0;
      }
      if (c < set.size) {
        // Some selected units are gone (killed / out of view): keep only the present ones.
        set.clear();
        for (let i = 0; i < c; i++) set.add(hs[i]!);
        this.version++;
      }
    }
    this.count = c;
    this.highlightCount = n;
    this.highlightVersion++;
  }
}
