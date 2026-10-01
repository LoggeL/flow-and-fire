/**
 * Unit list of the lab (CPU state + instance packing). Capacity {@link LAB_UNIT_CAPACITY}, stable
 * indices with a LIFO free list, previous/current transform per unit so the renderer can interpolate
 * between fixed steps (`snapshot()` before each step copies current → previous).
 *
 * Instance record ({@link LAB_UNIT_STRIDE} = 36 bytes, packed compactly in index order):
 * | off | type    | content                                              |
 * |-----|---------|------------------------------------------------------|
 * | 0   | i32×3   | previous position (raw Q20.12, y = ground height)    |
 * | 12  | i32×3   | current position                                     |
 * | 24  | f32×2   | previous yaw, current yaw (rad, 0 = +x towards +z)   |
 * | 32  | u8×4    | kind id, army, hp·255, glow·63.75 (glow 0..4)        |
 */
import type { GpuDevice } from '@faf/render';
import { DynamicInstanceBuffer, fxHash32 } from '@faf/render-fx';
export type LabUnitKind = 'tank' | 'bot' | 'arty' | 'engineer' | 'acu' | 'shieldgen' | 'structure' | 'wreck';

export interface LabUnitInit {
  kind: LabUnitKind;
  army: number;
  xWu: number;
  zWu: number;
  yaw: number;
  hp?: number;
  glow?: number;
}



export const LAB_UNIT_CAPACITY = 1024;
export const LAB_UNIT_STRIDE = 36;
/** Largest glow value that survives packing (u8 / 63.75). */
export const LAB_UNIT_MAX_GLOW = 4;
export const LAB_MAX_ARMIES = 16;

export const LAB_UNIT_KINDS: readonly LabUnitKind[] = ['tank', 'bot', 'arty', 'engineer', 'acu', 'shieldgen', 'structure', 'wreck'];

/** Box part of a unit kind: half extents x/z, full height y, offset of the bottom centre (unit-local WU). */
export interface LabUnitPart {
  readonly size: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
}

/**
 * Shape table: hull (0), upper body (1), barrel/arm/stack (2) per kind. Local x = facing direction.
 * Mirrored as GLSL const arrays by the unit pass. A zero size hides a part.
 */
export const LAB_UNIT_SHAPES: Readonly<Record<LabUnitKind, readonly [LabUnitPart, LabUnitPart, LabUnitPart]>> = {
  tank: [
    { size: [2.0, 1.1, 1.3], offset: [0, 0, 0] },
    { size: [1.0, 0.7, 0.85], offset: [-0.2, 1.1, 0] },
    { size: [1.3, 0.28, 0.15], offset: [1.9, 1.28, 0] },
  ],
  bot: [
    { size: [0.7, 1.6, 0.9], offset: [0, 0, 0] },
    { size: [0.85, 0.8, 1.2], offset: [0, 1.6, 0] },
    { size: [0.9, 0.26, 0.14], offset: [0.9, 1.85, 0.95] },
  ],
  arty: [
    { size: [2.4, 1.0, 1.5], offset: [0, 0, 0] },
    { size: [1.2, 0.85, 1.0], offset: [-0.7, 1.0, 0] },
    { size: [2.3, 0.36, 0.22], offset: [1.4, 1.55, 0] },
  ],
  engineer: [
    { size: [1.3, 0.9, 1.0], offset: [0, 0, 0] },
    { size: [0.55, 0.95, 0.55], offset: [-0.35, 0.9, 0] },
    { size: [0.95, 0.18, 0.18], offset: [0.65, 1.62, 0] },
  ],
  acu: [
    { size: [1.3, 3.0, 1.6], offset: [0, 0, 0] },
    { size: [1.5, 1.4, 2.3], offset: [0, 3.0, 0] },
    { size: [1.7, 0.5, 0.36], offset: [1.3, 3.4, 2.0] },
  ],
  shieldgen: [
    { size: [2.2, 1.2, 2.2], offset: [0, 0, 0] },
    { size: [1.1, 2.0, 1.1], offset: [0, 1.2, 0] },
    { size: [0.45, 0.9, 0.45], offset: [0, 3.2, 0] },
  ],
  structure: [
    { size: [5.0, 2.6, 5.0], offset: [0, 0, 0] },
    { size: [3.0, 2.4, 3.0], offset: [0.6, 2.6, -0.6] },
    { size: [0.75, 4.2, 0.75], offset: [-2.8, 2.6, 2.8] },
  ],
  wreck: [
    { size: [2.0, 0.6, 1.3], offset: [0, 0, 0] },
    { size: [1.0, 0.45, 0.85], offset: [-0.6, 0.5, 0.3] },
    { size: [1.2, 0.2, 0.15], offset: [0.9, 0.25, 1.0] },
  ],
};

/** Numeric id of a kind (index in {@link LAB_UNIT_KINDS}). */
export function labUnitKindId(kind: LabUnitKind): number {
  const i = LAB_UNIT_KINDS.indexOf(kind);
  if (i < 0) throw new Error(`unknown unit kind '${String(kind)}'`);
  return i;
}

/** Full state of one unit (as returned by {@link LabUnitList.get}). */
export interface LabUnitState {
  kind: LabUnitKind;
  army: number;
  xWu: number;
  yWu: number;
  zWu: number;
  yaw: number;
  hp: number;
  glow: number;
}

const TWO_PI = Math.PI * 2;
const RAW = 4096;

/** Wraps an angle difference into [−π, π). */
function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

export class LabUnitList {
  readonly capacity: number;
  /** Incremented by every change (add/set/move/remove/snapshot/clear); the upload is skipped when unchanged. */
  version = 0;
  private live: number;
  private high = 0;
  private readonly alive: Uint8Array;
  private readonly kind: Uint8Array;
  private readonly army: Uint8Array;
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly yaw: Float64Array;
  private readonly px: Float64Array;
  private readonly py: Float64Array;
  private readonly pz: Float64Array;
  private readonly pyaw: Float64Array;
  private readonly hp: Float64Array;
  private readonly glow: Float64Array;
  private readonly free: Int32Array;
  private freeCount: number;
  private readonly buffer: DynamicInstanceBuffer | null;
  private uploadedVersion = -1;
  private packedCount = 0;

  /**
   * @param dev device for the instance buffer (null = CPU only, e.g. headless scene tests).
   * @param height ground height used for the y coordinate of every unit.
   */
  constructor(
    dev: GpuDevice | null,
    private readonly height: (xWu: number, zWu: number) => number,
    capacity = LAB_UNIT_CAPACITY,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`LabUnitList: invalid capacity ${capacity}`);
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.kind = new Uint8Array(capacity);
    this.army = new Uint8Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.yaw = new Float64Array(capacity);
    this.px = new Float64Array(capacity);
    this.py = new Float64Array(capacity);
    this.pz = new Float64Array(capacity);
    this.pyaw = new Float64Array(capacity);
    this.hp = new Float64Array(capacity);
    this.glow = new Float64Array(capacity);
    this.free = new Int32Array(capacity);
    this.freeCount = 0;
    this.live = 0;
    this.buffer = dev === null ? null : new DynamicInstanceBuffer(dev, { label: 'lab.units.inst', stride: LAB_UNIT_STRIDE, capacity });
  }

  /** Live units. */
  get count(): number {
    return this.live;
  }

  /** One past the highest index ever used (iterate `for (i < highWater) if (has(i))`). */
  get highWater(): number {
    return this.high;
  }

  /** The GPU instance buffer (null for CPU-only lists). */
  get instances(): DynamicInstanceBuffer | null {
    return this.buffer;
  }

  /** Instances in the buffer after the last {@link upload}/{@link pack}. */
  get instanceCount(): number {
    return this.packedCount;
  }

  has(i: number): boolean {
    return i >= 0 && i < this.high && this.alive[i] === 1;
  }

  /**
   * Adds a unit (previous = current transform, no interpolation from elsewhere). Returns its index,
   * or −1 when the list is full.
   */
  add(u: LabUnitInit): number {
    const kind = labUnitKindId(u.kind);
    if (!Number.isInteger(u.army) || u.army < 0 || u.army >= LAB_MAX_ARMIES) throw new RangeError(`LabUnitList.add: army ${u.army} outside 0..15`);
    if (!Number.isFinite(u.xWu) || !Number.isFinite(u.zWu) || !Number.isFinite(u.yaw)) throw new Error('LabUnitList.add: position/yaw must be finite');
    let i: number;
    if (this.freeCount > 0) i = this.free[--this.freeCount]!;
    else if (this.high < this.capacity) i = this.high++;
    else return -1;
    this.alive[i] = 1;
    this.kind[i] = kind;
    this.army[i] = u.army;
    this.x[i] = u.xWu;
    this.z[i] = u.zWu;
    this.y[i] = this.height(u.xWu, u.zWu);
    this.yaw[i] = u.yaw;
    this.hp[i] = clamp01(u.hp ?? 1);
    this.glow[i] = clampGlow(u.glow ?? (u.kind === 'wreck' ? 0 : 1));
    this.snap(i);
    this.live++;
    this.version++;
    return i;
  }

  /** Changes fields of unit i; a position change keeps the previous transform (interpolated move). */
  set(i: number, patch: Partial<LabUnitInit>): void {
    this.check(i, 'set');
    if (patch.kind !== undefined) this.kind[i] = labUnitKindId(patch.kind);
    if (patch.army !== undefined) {
      if (!Number.isInteger(patch.army) || patch.army < 0 || patch.army >= LAB_MAX_ARMIES) throw new RangeError(`LabUnitList.set: army ${patch.army} outside 0..15`);
      this.army[i] = patch.army;
    }
    if (patch.xWu !== undefined || patch.zWu !== undefined || patch.yaw !== undefined) {
      this.move(i, patch.xWu ?? this.x[i]!, patch.zWu ?? this.z[i]!, patch.yaw ?? this.yaw[i]!);
    }
    if (patch.hp !== undefined) this.hp[i] = clamp01(patch.hp);
    if (patch.glow !== undefined) this.glow[i] = clampGlow(patch.glow);
    this.version++;
  }

  /** Hot path of {@link set}: new position/yaw of unit i (no allocation). */
  move(i: number, xWu: number, zWu: number, yaw: number): void {
    this.check(i, 'move');
    this.x[i] = xWu;
    this.z[i] = zWu;
    this.y[i] = this.height(xWu, zWu);
    this.yaw[i] = yaw;
    this.version++;
  }

  /** Sets hp (0..1) and glow (0..4) of unit i. */
  setHpGlow(i: number, hp: number, glow: number): void {
    this.check(i, 'setHpGlow');
    this.hp[i] = clamp01(hp);
    this.glow[i] = clampGlow(glow);
    this.version++;
  }

  /** Removes unit i; its index is reused by the next {@link add}. Returns false for dead/unknown indices. */
  remove(i: number): boolean {
    if (!this.has(i)) return false;
    this.alive[i] = 0;
    this.free[this.freeCount++] = i;
    this.live--;
    this.version++;
    return true;
  }

  /** State of unit i (written into `out` when given), null when dead/unknown. */
  get(i: number, out?: LabUnitState): LabUnitState | null {
    if (!this.has(i)) return null;
    const o: LabUnitState = out ?? { kind: 'tank', army: 0, xWu: 0, yWu: 0, zWu: 0, yaw: 0, hp: 1, glow: 1 };
    o.kind = LAB_UNIT_KINDS[this.kind[i]!]!;
    o.army = this.army[i]!;
    o.xWu = this.x[i]!;
    o.yWu = this.y[i]!;
    o.zWu = this.z[i]!;
    o.yaw = this.yaw[i]!;
    o.hp = this.hp[i]!;
    o.glow = this.glow[i]!;
    return o;
  }

  /** Allocation-free accessors for hot scene loops. */
  xWu(i: number): number {
    return this.x[i]!;
  }
  zWu(i: number): number {
    return this.z[i]!;
  }
  yWu(i: number): number {
    return this.y[i]!;
  }
  yawOf(i: number): number {
    return this.yaw[i]!;
  }
  armyOf(i: number): number {
    return this.army[i]!;
  }
  kindOf(i: number): LabUnitKind {
    return LAB_UNIT_KINDS[this.kind[i]!]!;
  }

  /** Previous transform := current for every unit (call before each fixed step). */
  snapshot(): void {
    for (let i = 0; i < this.high; i++) if (this.alive[i] === 1) this.snap(i);
    this.version++;
  }

  /** Previous transform := current for unit i (teleport, no interpolation). */
  snap(i: number): void {
    this.px[i] = this.x[i]!;
    this.py[i] = this.y[i]!;
    this.pz[i] = this.z[i]!;
    this.pyaw[i] = this.yaw[i]!;
  }

  clear(): void {
    this.alive.fill(0);
    this.live = 0;
    this.high = 0;
    this.freeCount = 0;
    this.version++;
  }

  /**
   * Packs the live units compactly (index order) into the instance staging memory. Returns the
   * instance count. CPU-only lists pack into `target` (tests) or do nothing.
   */
  pack(target?: DataView): number {
    let n = 0;
    if (target !== undefined) {
      for (let i = 0; i < this.high; i++) if (this.alive[i] === 1) this.packView(target, n++, i);
    } else if (this.buffer !== null) {
      const b = this.buffer;
      for (let i = 0; i < this.high; i++) if (this.alive[i] === 1) this.packFast(b, n++, i);
    } else {
      n = this.live;
    }
    this.packedCount = n;
    return n;
  }

  /**
   * Packs and uploads the instances when anything changed since the last upload (one writeBuffer).
   * Returns the uploaded bytes (0 when unchanged).
   */
  upload(): number {
    const b = this.buffer;
    if (b === null || this.uploadedVersion === this.version) return 0;
    const n = this.pack();
    this.uploadedVersion = this.version;
    return b.upload(n);
  }

  /** Deterministic hash of every live unit (index, kind, army, transform, hp, glow). */
  checksum(): number {
    let h = fxHash32(this.live, this.high);
    for (let i = 0; i < this.high; i++) {
      if (this.alive[i] !== 1) continue;
      h = fxHash32(h, i, this.kind[i]! | (this.army[i]! << 8));
      h = fxHash32(h, Math.round(this.x[i]! * RAW), Math.round(this.z[i]! * RAW));
      h = fxHash32(h, Math.round(this.yaw[i]! * 65536), Math.round(this.hp[i]! * 65536) ^ (Math.round(this.glow[i]! * 256) << 20));
    }
    return h >>> 0;
  }

  destroy(): void {
    this.buffer?.destroy();
  }

  private check(i: number, op: string): void {
    if (!this.has(i)) throw new RangeError(`LabUnitList.${op}: unit ${i} is not alive`);
  }

  private packFast(b: DynamicInstanceBuffer, n: number, i: number): void {
    const w = (n * LAB_UNIT_STRIDE) >> 2;
    const i32 = b.i32;
    i32[w] = Math.round(this.px[i]! * RAW);
    i32[w + 1] = Math.round(this.py[i]! * RAW);
    i32[w + 2] = Math.round(this.pz[i]! * RAW);
    i32[w + 3] = Math.round(this.x[i]! * RAW);
    i32[w + 4] = Math.round(this.y[i]! * RAW);
    i32[w + 5] = Math.round(this.z[i]! * RAW);
    const cur = this.yaw[i]!;
    b.f32[w + 6] = cur - wrapAngle(cur - this.pyaw[i]!);
    b.f32[w + 7] = cur;
    const o = n * LAB_UNIT_STRIDE + 32;
    const u8 = b.u8;
    u8[o] = this.kind[i]!;
    u8[o + 1] = this.army[i]!;
    u8[o + 2] = Math.round(this.hp[i]! * 255);
    u8[o + 3] = Math.round(this.glow[i]! * 63.75);
  }

  private packView(dv: DataView, n: number, i: number): void {
    const o = n * LAB_UNIT_STRIDE;
    dv.setInt32(o, Math.round(this.px[i]! * RAW), true);
    dv.setInt32(o + 4, Math.round(this.py[i]! * RAW), true);
    dv.setInt32(o + 8, Math.round(this.pz[i]! * RAW), true);
    dv.setInt32(o + 12, Math.round(this.x[i]! * RAW), true);
    dv.setInt32(o + 16, Math.round(this.y[i]! * RAW), true);
    dv.setInt32(o + 20, Math.round(this.z[i]! * RAW), true);
    const cur = this.yaw[i]!;
    dv.setFloat32(o + 24, cur - wrapAngle(cur - this.pyaw[i]!), true);
    dv.setFloat32(o + 28, cur, true);
    dv.setUint8(o + 32, this.kind[i]!);
    dv.setUint8(o + 33, this.army[i]!);
    dv.setUint8(o + 34, Math.round(this.hp[i]! * 255));
    dv.setUint8(o + 35, Math.round(this.glow[i]! * 63.75));
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

function clampGlow(v: number): number {
  return Number.isFinite(v) ? Math.min(LAB_UNIT_MAX_GLOW, Math.max(0, v)) : 0;
}
