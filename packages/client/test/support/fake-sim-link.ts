/**
 * FakeSimLink: an in-process stand-in for the sim worker. It keeps a tiny cube world, applies the
 * received command batches on the next tick (Move incl. Shift queue, Stop, Cheat Spawn/Kill/
 * Footprint), writes real frames with the protocol FrameWriter (ackSeq, paused flag, speed,
 * prev/cur positions, noInterp on spawn, MS3: watch section for `ctl.watch` handles with the order
 * targets and one mid-route waypoint) and hands them to the client through a copy-on-arrival
 * FrameConsumer.
 *
 * Time is driven by the test: `advance(ms)` runs as many ticks as the current speed allows (none
 * while paused, except requested steps), `tickNow()` runs exactly one tick.
 */
import {
  CheatSub,
  CmdFlags,
  CommandBatchView,
  DEFAULT_FRAME_CAPS,
  FrameFlags,
  FrameWriter,
  Op,
  readCheatSpawnInto,
  readCheatSub,
  readMoveInto,
  speedToPermille,
  UnitFlags,
  WatchOrderType,
  type CheatSpawnPayload,
  type CtlMessage,
  type FrameConsumer,
  type HostMessage,
  type MovePayload,
} from '@faf/protocol';
import { asFx } from '@faf/fixed';
import type { SimLink } from '../../src/sim-link.ts';

export const FAKE_CAPS = { ...DEFAULT_FRAME_CAPS, units: 4096, parts: 4096, projectiles: 0, beams: 0, events: 0, debugBytes: 0 };

/** Copy-on-arrival consumer: `deliver()` copies a frame, `poll()` returns it once. */
export class FakeFrameConsumer implements FrameConsumer {
  private readonly buf: Uint8Array;
  private len = 0;
  private pendingSeq = 0;
  private lastSeq = 0;
  private receivedCount = 0;
  private view: Uint8Array | null = null;

  constructor(capacity: number) {
    this.buf = new Uint8Array(capacity);
  }

  /** Copies `bytes[0, len)` (copy-on-arrival) and makes it available to the next poll. */
  deliver(bytes: Uint8Array, seq: number, len = bytes.length): void {
    if (len === bytes.length) this.buf.set(bytes, 0);
    else for (let i = 0; i < len; i++) this.buf[i] = bytes[i]!;
    this.len = len;
    this.pendingSeq = seq;
  }

  poll(): Uint8Array | null {
    if (this.pendingSeq === 0 || this.pendingSeq === this.lastSeq) return null;
    this.lastSeq = this.pendingSeq;
    this.receivedCount++;
    if (this.view === null || this.view.length !== this.len) this.view = this.buf.subarray(0, this.len);
    return this.view;
  }

  get seq(): number {
    return this.lastSeq;
  }

  get received(): number {
    return this.receivedCount;
  }

  close(): void {}
}

export interface FakeSimOptions {
  /** Own cubes (army `playerArmy`) laid out on a grid. */
  readonly units?: number;
  /** Additional cubes of army 1 (enemy). */
  readonly enemyUnits?: number;
  readonly playerArmy?: number;
  /** Speed in raw per tick (default 0.5 WU/tick). */
  readonly speedRaw?: number;
  /** Grid spacing in WU (default 2). */
  readonly spacingWU?: number;
  /** Grid origin in WU (default 200, 200). */
  readonly originWU?: readonly [number, number];
  readonly paused?: boolean;
  /** Write one PartStream record (turret yaw = tick · 1000) per live unit (merged-part test). */
  readonly parts?: boolean;
  /** Visual (blueprint sim id) per unit: `visualOf(index)`; default 0. */
  readonly visualOf?: (i: number) => number;
}

/** Queued targets per unit (Shift moves). */
const QUEUE_CAP = 8;

export class FakeSimLink implements SimLink {
  readonly frames: FakeFrameConsumer;
  readonly sentBatches: Uint8Array[] = [];
  readonly sentCtl: CtlMessage[] = [];
  readonly playerArmy: number;

  tick = 0;
  paused: boolean;
  speedPermille = 1000;
  /** Highest applied seq of the player army. */
  ackSeq = 0;
  /** Commands applied (all armies). */
  applied = 0;

  // Cube world (index = slot, handle = slot | gen << 20).
  readonly x: Int32Array;
  readonly z: Int32Array;
  readonly px: Int32Array;
  readonly pz: Int32Array;
  readonly tx: Int32Array;
  readonly tz: Int32Array;
  readonly moving: Uint8Array;
  readonly alive: Uint8Array;
  readonly army: Uint8Array;
  readonly gen: Uint16Array;
  readonly fresh: Uint8Array;
  readonly visual: Uint16Array;
  /** Queued targets (QUEUE_CAP per unit) and their count. */
  readonly qx: Int32Array;
  readonly qz: Int32Array;
  readonly qn: Uint8Array;
  readonly speedRaw: number;
  readonly withParts: boolean;
  highWater = 0;
  /** Handles of the last `ctl.watch` (first `watchN`). */
  readonly watchHandles = new Uint32Array(64);
  watchN = 0;
  /** Footprint cheats received: [x, z, w, h, delta] each. */
  readonly footprints: number[][] = [];

  private readonly writer = new FrameWriter(FAKE_CAPS);
  private readonly target: Uint8Array;
  private readonly queue: Uint8Array[] = [];
  private readonly view = new CommandBatchView();
  private readonly move: MovePayload = { x: asFx(0), y: asFx(0), z: asFx(0) };
  private readonly spawnP: CheatSpawnPayload = { bp: 0, army: 0, count: 0, x: asFx(0), z: asFx(0), spread: asFx(0) };
  private readonly listeners: ((m: HostMessage) => void)[] = [];
  private readonly visualOf: ((i: number) => number) | null;
  private frameSeq = 0;
  private stepsPending = 0;
  private acc = 0;

  constructor(opts: FakeSimOptions = {}) {
    const cap = FAKE_CAPS.units;
    this.frames = new FakeFrameConsumer(this.writer.capacityBytes);
    this.target = new Uint8Array(this.writer.capacityBytes);
    this.x = new Int32Array(cap);
    this.z = new Int32Array(cap);
    this.px = new Int32Array(cap);
    this.pz = new Int32Array(cap);
    this.tx = new Int32Array(cap);
    this.tz = new Int32Array(cap);
    this.moving = new Uint8Array(cap);
    this.alive = new Uint8Array(cap);
    this.army = new Uint8Array(cap);
    this.gen = new Uint16Array(cap);
    this.fresh = new Uint8Array(cap);
    this.visual = new Uint16Array(cap);
    this.qx = new Int32Array(cap * QUEUE_CAP);
    this.qz = new Int32Array(cap * QUEUE_CAP);
    this.qn = new Uint8Array(cap);
    this.visualOf = opts.visualOf ?? null;
    this.playerArmy = opts.playerArmy ?? 0;
    this.paused = opts.paused ?? false;
    this.speedRaw = opts.speedRaw ?? 2048;
    this.withParts = opts.parts ?? false;
    const spacing = (opts.spacingWU ?? 2) * 4096;
    const ox = (opts.originWU?.[0] ?? 200) * 4096;
    const oz = (opts.originWU?.[1] ?? 200) * 4096;
    const own = opts.units ?? 16;
    const side = Math.max(1, Math.ceil(Math.sqrt(own)));
    for (let i = 0; i < own; i++) this.addUnit(this.playerArmy, ox + (i % side) * spacing, oz + Math.floor(i / side) * spacing, false);
    const enemy = opts.enemyUnits ?? 0;
    for (let i = 0; i < enemy; i++) this.addUnit(1, ox + i * spacing, oz - 20 * 4096, false);
    this.publish();
  }

  // ---- SimLink --------------------------------------------------------------------------------

  sendCommands(batch: ArrayBuffer): void {
    const bytes = new Uint8Array(batch);
    this.view.reset(bytes); // validates (throws on malformed)
    this.sentBatches.push(bytes);
    this.queue.push(bytes);
  }

  sendCtl(msg: CtlMessage): void {
    this.sentCtl.push(msg);
    switch (msg.t) {
      case 'pause':
        this.paused = true;
        this.publish();
        break;
      case 'resume':
        this.paused = false;
        this.acc = 0;
        break;
      case 'speed':
        this.speedPermille = speedToPermille(msg.speed);
        break;
      case 'step':
        if (this.paused) this.stepsPending += msg.ticks;
        break;
      case 'watch':
        this.watchN = Math.min(64, msg.handles.length);
        for (let i = 0; i < this.watchN; i++) this.watchHandles[i] = msg.handles[i]! >>> 0;
        break;
      default:
        break;
    }
  }

  onHostMessage(cb: (m: HostMessage) => void): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  // ---- test controls --------------------------------------------------------------------------

  emitHost(m: HostMessage): void {
    for (const l of this.listeners) l(m);
  }

  get tickMs(): number {
    return (100 * 1000) / this.speedPermille;
  }

  /** Advances wall time: runs due ticks (and pending steps while paused). Returns ticks run. */
  advance(ms: number): number {
    let n = 0;
    if (this.paused) {
      while (this.stepsPending > 0) {
        this.stepsPending--;
        this.tickNow();
        n++;
      }
      return n;
    }
    this.acc += ms;
    while (this.acc >= this.tickMs) {
      this.acc -= this.tickMs;
      this.tickNow();
      n++;
    }
    return n;
  }

  /** Runs exactly one tick (regardless of pause) and publishes a frame. */
  tickNow(): void {
    for (let i = 0; i < this.highWater; i++) {
      this.px[i] = this.x[i]!;
      this.pz[i] = this.z[i]!;
      this.fresh[i] = 0;
    }
    for (let q = 0; q < this.queue.length; q++) this.apply(this.queue[q]!);
    this.queue.length = 0;
    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0 || this.moving[i] === 0) continue;
      const dx = this.tx[i]! - this.x[i]!;
      const dz = this.tz[i]! - this.z[i]!;
      const d = Math.sqrt(dx * dx + dz * dz); // not Math.hypot: its varargs call boxes (harness allocation)
      if (d <= this.speedRaw) {
        this.x[i] = this.tx[i]!;
        this.z[i] = this.tz[i]!;
        this.moving[i] = 0;
        this.popQueue(i);
      } else {
        this.x[i] = this.x[i]! + Math.trunc((dx * this.speedRaw) / d);
        this.z[i] = this.z[i]! + Math.trunc((dz * this.speedRaw) / d);
      }
    }
    this.tick++;
    this.publish();
  }

  /** Writes and delivers a frame of the current state. */
  publish(): void {
    const w = this.writer;
    w.beginFrame(
      this.target,
      ++this.frameSeq,
      this.tick,
      500,
      this.speedPermille,
      -1,
      this.paused ? FrameFlags.Paused : 0,
      this.ackSeq,
      this.tick,
      0,
    );
    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0) continue;
      let flags = this.moving[i] === 0 ? UnitFlags.Idle : 0;
      if (this.fresh[i] !== 0) flags |= UnitFlags.NoInterp;
      if (this.withParts) {
        const yaw = (this.tick * 1000) & 0xffff;
        const part = w.writePart((yaw - 1000) & 0xffff, yaw, 0, 0);
        w.writeUnit(this.px[i]!, 0, this.pz[i]!, this.x[i]!, 0, this.z[i]!, 0, 0, this.visual[i]!, this.army[i]!, 255, 255, 0, flags, this.handleOf(i), part, 1);
      } else {
        w.writeUnit(this.px[i]!, 0, this.pz[i]!, this.x[i]!, 0, this.z[i]!, 0, 0, this.visual[i]!, this.army[i]!, 255, 255, 0, flags, this.handleOf(i), 0, 0);
      }
    }
    // Watch section: order targets (active + queued) and one waypoint halfway on long routes.
    for (let k = 0; k < this.watchN; k++) {
      const i = this.slotOf(this.watchHandles[k]!);
      if (i < 0 || this.army[i] !== this.playerArmy) continue;
      const orders = (this.moving[i] !== 0 ? 1 : 0) + this.qn[i]!;
      if (w.beginWatch(this.handleOf(i), orders, 0) < 0) break;
      if (this.moving[i] !== 0) {
        const dx = this.tx[i]! - this.x[i]!;
        const dz = this.tz[i]! - this.z[i]!;
        if (dx * dx + dz * dz > (8 * 4096) ** 2) w.addWatchPoint(this.x[i]! + (dx >> 1), this.z[i]! + (dz >> 1));
        w.addWatchPoint(this.tx[i]!, this.tz[i]!);
        w.addWatchTarget(WatchOrderType.Move, this.tx[i]!, this.tz[i]!);
      }
      for (let q = 0; q < this.qn[i]!; q++) w.addWatchTarget(WatchOrderType.Move, this.qx[i * QUEUE_CAP + q]!, this.qz[i * QUEUE_CAP + q]!);
    }
    const len = w.endFrame();
    this.frames.deliver(this.target, this.frameSeq, len);
  }

  handleOf(i: number): number {
    return (i | (this.gen[i]! << 20)) >>> 0;
  }

  /** Handles of all live units of `army`. */
  handles(army = this.playerArmy): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.highWater; i++) if (this.alive[i] !== 0 && this.army[i] === army) out.push(this.handleOf(i));
    return out;
  }

  slotOf(handle: number): number {
    const i = handle & 0xfffff;
    return i < this.highWater && this.alive[i] !== 0 && this.handleOf(i) === handle >>> 0 ? i : -1;
  }

  // ---- internals ------------------------------------------------------------------------------

  private popQueue(i: number): void {
    const n = this.qn[i]!;
    if (n === 0) return;
    const o = i * QUEUE_CAP;
    this.tx[i] = this.qx[o]!;
    this.tz[i] = this.qz[o]!;
    this.moving[i] = 1;
    for (let q = 1; q < n; q++) {
      this.qx[o + q - 1] = this.qx[o + q]!;
      this.qz[o + q - 1] = this.qz[o + q]!;
    }
    this.qn[i] = n - 1;
  }

  private addUnit(army: number, x: number, z: number, fresh: boolean): number {
    const i = this.highWater++;
    this.alive[i] = 1;
    this.army[i] = army;
    this.visual[i] = this.visualOf === null ? 0 : this.visualOf(i);
    this.qn[i] = 0;
    this.x[i] = this.px[i] = this.tx[i] = x;
    this.z[i] = this.pz[i] = this.tz[i] = z;
    this.moving[i] = 0;
    this.fresh[i] = fresh ? 1 : 0;
    return i;
  }

  private apply(bytes: Uint8Array): void {
    const v = this.view;
    v.reset(bytes);
    while (v.next()) {
      this.applied++;
      if (v.army === this.playerArmy) this.ackSeq = v.seq;
      if (v.op === Op.Move) {
        readMoveInto(v.dataView, v.payloadOffset, this.move);
        const queue = (v.flags & CmdFlags.Queue) !== 0;
        for (let k = 0; k < v.unitCount; k++) {
          const i = this.slotOf(v.unitAt(k));
          if (i < 0 || this.army[i] !== v.army) continue;
          if (queue && this.moving[i] !== 0) {
            if (this.qn[i]! < QUEUE_CAP) {
              this.qx[i * QUEUE_CAP + this.qn[i]!] = this.move.x;
              this.qz[i * QUEUE_CAP + this.qn[i]!] = this.move.z;
              this.qn[i]!++;
            }
            continue;
          }
          this.qn[i] = 0;
          this.tx[i] = this.move.x;
          this.tz[i] = this.move.z;
          this.moving[i] = 1;
        }
      } else if (v.op === Op.Stop) {
        for (let k = 0; k < v.unitCount; k++) {
          const i = this.slotOf(v.unitAt(k));
          if (i < 0) continue;
          this.moving[i] = 0;
          this.qn[i] = 0;
          this.tx[i] = this.x[i]!;
          this.tz[i] = this.z[i]!;
        }
      } else if (v.op === Op.Cheat) {
        const sub = readCheatSub(v.dataView, v.payloadOffset);
        if (sub === CheatSub.Spawn) {
          const p = readCheatSpawnInto(v.dataView, v.payloadOffset, this.spawnP);
          for (let k = 0; k < p.count; k++) this.addUnit(p.army, p.x + ((k % 8) - 4) * 4096, p.z + (Math.floor(k / 8) - 4) * 4096, true);
        } else if (sub === CheatSub.Footprint) {
          const dv = v.dataView;
          const o = v.payloadOffset;
          this.footprints.push([dv.getInt32(o + 1, true), dv.getInt32(o + 5, true), dv.getUint16(o + 9, true), dv.getUint16(o + 11, true), dv.getInt8(o + 13)]);
        } else if (sub === CheatSub.Kill) {
          for (let k = 0; k < v.unitCount; k++) {
            const i = this.slotOf(v.unitAt(k));
            if (i < 0) continue;
            this.alive[i] = 0;
            this.gen[i] = (this.gen[i]! + 1) & 0xfff;
          }
        }
      }
    }
  }
}
