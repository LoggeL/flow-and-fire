/**
 * Control groups (C7, MS3): ten groups (digits 0–9) of unit handles.
 *
 * - store (Ctrl+digit or Alt+digit — Alt is the browser-safe default, some browsers take
 *   Ctrl+digit for tab switching; ⌘ is never used): the group becomes the current selection;
 * - add (Shift+Ctrl/Alt+digit): the selection is added to the group;
 * - recall (digit): the group becomes the selection; Shift+digit adds it to the selection;
 * - a second recall of the same group within {@link DOUBLE_TAP_MS} is a double tap: the camera
 *   centres on the group's centroid (the client does that);
 * - dead handles drop out (`prune` on every new frame, allocation-free).
 *
 * Bindings go through `KeyboardEvent.code` (actions.ts): `Digit0`–`Digit9` and `Numpad0`–`Numpad9`.
 */
import type { HandleIndex } from './handle-index.ts';

/** Number of control groups (digits 0–9). */
export const CONTROL_GROUP_COUNT = 10;
/** Two recalls of the same group within this window (ms) center the camera on it. */
export const DOUBLE_TAP_MS = 350;

export type ControlGroupOp = 'store' | 'add' | 'recall' | 'recallAdd';

/** Group number of a `KeyboardEvent.code` (`Digit3`/`Numpad3` → 3), or −1. */
export function controlGroupOfCode(code: string): number {
  if (code.length === 6 && code.startsWith('Digit')) {
    const d = code.charCodeAt(5) - 48;
    return d >= 0 && d <= 9 ? d : -1;
  }
  if (code.length === 7 && code.startsWith('Numpad')) {
    const d = code.charCodeAt(6) - 48;
    return d >= 0 && d <= 9 ? d : -1;
  }
  return -1;
}

export class ControlGroups {
  private readonly lists: Uint32Array[] = [];
  private readonly counts = new Int32Array(CONTROL_GROUP_COUNT);
  private lastRecallGroup = -1;
  private lastRecallMs = Number.NEGATIVE_INFINITY;
  /** Bumped whenever a group changes (UI key). */
  version = 0;

  constructor() {
    for (let g = 0; g < CONTROL_GROUP_COUNT; g++) this.lists.push(new Uint32Array(64));
  }

  /** Members of group `g` (view, valid until the group changes). */
  get(g: number): Uint32Array {
    checkGroup(g);
    return this.lists[g]!.subarray(0, this.counts[g]!);
  }

  /** Number of members of group `g`. */
  size(g: number): number {
    checkGroup(g);
    return this.counts[g]!;
  }

  /** Replaces group `g` with `handles` (deduplicated, order kept). */
  store(g: number, handles: ArrayLike<number>): void {
    checkGroup(g);
    this.counts[g] = 0;
    this.add(g, handles);
    this.version++;
  }

  /** Adds `handles` to group `g` (members already in it are skipped). */
  add(g: number, handles: ArrayLike<number>): void {
    checkGroup(g);
    if (handles.length === 0) return;
    let list = this.lists[g]!;
    let n = this.counts[g]!;
    if (list.length < n + handles.length) {
      let cap = list.length;
      while (cap < n + handles.length) cap *= 2;
      const next = new Uint32Array(cap);
      next.set(list.subarray(0, n));
      list = next;
      this.lists[g] = next;
    }
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i]! >>> 0;
      let dup = false;
      for (let k = 0; k < n; k++) {
        if (list[k] === h) {
          dup = true;
          break;
        }
      }
      if (!dup) list[n++] = h;
    }
    this.counts[g] = n;
    this.version++;
  }

  /** Empties group `g`. */
  clear(g: number): void {
    checkGroup(g);
    this.counts[g] = 0;
    this.version++;
  }

  /**
   * Registers a recall of group `g` at `nowMs`; returns true if it is the second tap of a double tap
   * (same group within {@link DOUBLE_TAP_MS}). A double tap resets the tap state.
   */
  tap(g: number, nowMs: number): boolean {
    checkGroup(g);
    const double = this.lastRecallGroup === g && nowMs - this.lastRecallMs < DOUBLE_TAP_MS && nowMs >= this.lastRecallMs;
    if (double) {
      this.lastRecallGroup = -1;
      this.lastRecallMs = Number.NEGATIVE_INFINITY;
    } else {
      this.lastRecallGroup = g;
      this.lastRecallMs = nowMs;
    }
    return double;
  }

  /**
   * Drops members that are not in the indexed frame (dead units) or no longer own (`isOwn`).
   * Allocation-free; returns the number of dropped handles.
   */
  prune(index: HandleIndex, isOwn?: (recordIndex: number) => boolean): number {
    let dropped = 0;
    for (let g = 0; g < CONTROL_GROUP_COUNT; g++) {
      const list = this.lists[g]!;
      const n = this.counts[g]!;
      let w = 0;
      for (let k = 0; k < n; k++) {
        const h = list[k]!;
        const i = index.get(h);
        if (i < 0 || (isOwn !== undefined && !isOwn(i))) continue;
        list[w++] = h;
      }
      if (w !== n) {
        dropped += n - w;
        this.counts[g] = w;
      }
    }
    if (dropped > 0) this.version++;
    return dropped;
  }

  /** Plain snapshot (hooks/UI): members per group. */
  snapshot(): number[][] {
    const out: number[][] = [];
    for (let g = 0; g < CONTROL_GROUP_COUNT; g++) out.push(Array.from(this.get(g)));
    return out;
  }
}

function checkGroup(g: number): void {
  if (!Number.isInteger(g) || g < 0 || g >= CONTROL_GROUP_COUNT) throw new RangeError(`control group must be 0..${CONTROL_GROUP_COUNT - 1}, got ${g}`);
}
