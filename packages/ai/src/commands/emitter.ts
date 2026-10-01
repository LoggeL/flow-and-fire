/**
 * Command emitter (ai.md §2.4): priority classes P0–P4, APM bucket, dedup, sequence numbers and
 * the tick stamp N + lead. Managers only emit through this class.
 *
 * - Every envelope is one command record (a group command = 1, a shift queue with k orders = k).
 * - APM: a token bucket (capacity = burst, refilled per think proportionally to the elapsed ticks at
 *   cap/60 records per second) smooths bursts; additionally the records of every 60-s window never
 *   exceed the cap (hard limit, also for P0). P0 (emergencies: commander/platoon retreat,
 *   overcharge) may overdraw the bucket by `p0Overdraft` records.
 * - Groups (`group()`): all requests of a group are emitted together or not at all (shift queues).
 * - Dedup: a request that does not change the unit's current order (from the perception) is
 *   dropped; exact duplicates within one flush too; FactoryRepeat/SetRally (not visible in the
 *   perception) are compared with the last emitted payload of that unit.
 * - 10 ops per emitted command (OP_COST.command) from the reserve budget; P0 is charged but never
 *   blocked by the budget.
 * - Requests that do not fit are returned as `dropped`; managers re-evaluate them next think.
 */
import { asArmyId, asHandle, asTick, type Handle } from '@faf/fixed';
import { CmdFlags, encodeBatch, Op, type CommandEnvelope } from '@faf/protocol';
import { OP_COST, type OpBudget } from '../budget.ts';
import type { ApmSpec } from '../profile.ts';
import { OrderKind, type OwnUnit } from '../types.ts';
import {
  decodeAiPayload,
  encodeBuild,
  encodeFactoryQueue,
  encodeFactoryRepeat,
  encodePosition,
  encodeStop,
  encodeTarget,
  encodeUpgrade,
} from './payloads.ts';

/** The AI's output type: protocol envelopes. */
export type EncodedCommand = CommandEnvelope;

/** Priority classes (ai.md §2.4). */
export const Prio = {
  /** Emergency: commander retreat, platoon retreat, overcharge. May overdraw the bucket by 5. */
  P0: 0,
  /** Platoon orders. */
  P1: 1,
  /** Build and engineer orders. */
  P2: 2,
  /** Factory queues. */
  P3: 3,
  /** Cosmetics (rally corrections). */
  P4: 4,
} as const;
export type Priority = (typeof Prio)[keyof typeof Prio];

/** 60 s at 10 Hz. */
export const APM_WINDOW_TICKS = 600;

export interface CommandRequest {
  readonly op: number;
  readonly units: readonly number[];
  readonly payload: Uint8Array;
  readonly flags: number;
  readonly prio: Priority;
  /** Emitting manager (diagnostics). */
  readonly source: string;
}

export type DropReason = 'apm' | 'dedup' | 'budget' | 'aborted';

export interface DroppedCommand {
  readonly request: CommandRequest;
  readonly reason: DropReason;
}

export interface FlushResult {
  readonly commands: EncodedCommand[];
  readonly dropped: DroppedCommand[];
}

/** Current perceived state of an own unit (for dedup), undefined if unknown. */
export type UnitLookup = (handle: number) => OwnUnit | undefined;

export interface EmitOptions {
  /** Shift: append instead of replace. */
  readonly queue?: boolean;
  readonly source?: string;
}

interface Pending {
  readonly req: CommandRequest;
  readonly group: number;
  readonly order: number;
}

const POS_TOLERANCE = 0.5;

function hex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i]! < 16 ? '0' : '') + bytes[i]!.toString(16);
  return s;
}

function signature(r: CommandRequest): string {
  return `${r.op}|${r.flags}|${r.units.join(',')}|${hex(r.payload)}`;
}

function orderKindOf(op: number): number {
  switch (op) {
    case Op.Move:
      return OrderKind.Move;
    case Op.AttackMove:
      return OrderKind.AttackMove;
    case Op.Patrol:
      return OrderKind.Patrol;
    case Op.Attack:
      return OrderKind.Attack;
    case Op.Assist:
      return OrderKind.Assist;
    case Op.Guard:
      return OrderKind.Guard;
    case Op.Repair:
      return OrderKind.Repair;
    case Op.Reclaim:
      return OrderKind.Reclaim;
    case Op.Overcharge:
      return OrderKind.Overcharge;
    case Op.Build:
      return OrderKind.Build;
    default:
      return -1;
  }
}

/** True if the request does not change the perceived current order of unit `u`. */
function unchangedFor(req: CommandRequest, u: OwnUnit): boolean {
  const queued = (req.flags & CmdFlags.Queue) !== 0;
  let pl;
  try {
    pl = decodeAiPayload(req.op, req.payload);
  } catch {
    return false;
  }
  if (pl.op === 'upgrade') return u.upgradingTo === pl.value;
  if (queued) return false;
  if (u.queueLength !== 0) return false;
  switch (pl.op) {
    case 'position': {
      if (req.op === Op.SetRally) return false;
      return (
        u.order === orderKindOf(req.op) &&
        Math.abs(u.orderX - pl.value.x) <= POS_TOLERANCE &&
        Math.abs(u.orderZ - pl.value.z) <= POS_TOLERANCE
      );
    }
    case 'target':
      return u.order === orderKindOf(req.op) && u.orderTarget === pl.value;
    case 'build':
      return (
        u.order === OrderKind.Build &&
        u.orderBp === pl.value.bp &&
        Math.abs(u.orderX - pl.value.x) <= POS_TOLERANCE &&
        Math.abs(u.orderZ - pl.value.z) <= POS_TOLERANCE
      );
    case 'stop':
      return u.order === OrderKind.Idle;
    default:
      return false;
  }
}

export interface EmitterOptions {
  readonly army: number;
  readonly apm: ApmSpec;
  readonly lead: number;
  /** Initial sequence number (default 1; 0 is never used). */
  readonly firstSeq?: number;
}

export class CommandEmitter {
  readonly army: number;
  private readonly apm: ApmSpec;
  private readonly lead: number;
  private seq: number;
  private tokens: number;
  private lastThinkTick = -1;
  private tick = 0;
  private lookup: UnitLookup = () => undefined;
  private pending: Pending[] = [];
  private nextGroup = 1;
  private openGroup = 0;
  private orderCounter = 0;
  /** Ticks of emitted records inside the current APM window (FIFO). */
  private window: number[] = [];
  private windowHead = 0;
  /** handle → last emitted FactoryRepeat / SetRally signature. */
  private readonly memory = new Map<number, { repeat: string | null; rally: string | null }>();
  private recordsTotal = 0;

  constructor(opts: EmitterOptions) {
    this.army = opts.army;
    this.apm = opts.apm;
    this.lead = opts.lead;
    const s = opts.firstSeq ?? 1;
    if (!Number.isInteger(s) || s < 1 || s > 0xffff) throw new RangeError(`firstSeq ${s}`);
    this.seq = s;
    this.tokens = opts.apm.burst;
  }

  /** Next sequence number that will be assigned. */
  get nextSeq(): number {
    return this.seq;
  }

  /** Current bucket fill (records). */
  get bucket(): number {
    return this.tokens;
  }

  /** Records emitted since construction. */
  get totalRecords(): number {
    return this.recordsTotal;
  }

  /** Number of queued (not yet flushed) requests. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Starts a think at `tick`: refills the bucket proportionally to the ticks since the previous
   * think and binds the unit lookup used for dedup. Pending requests of an unflushed previous think
   * are discarded.
   */
  beginThink(tick: number, lookup: UnitLookup): void {
    if (this.lastThinkTick >= 0 && tick > this.lastThinkTick) {
      const elapsed = tick - this.lastThinkTick;
      this.tokens = Math.min(this.apm.burst, this.tokens + (this.apm.cap * elapsed) / APM_WINDOW_TICKS);
    }
    this.lastThinkTick = tick;
    this.tick = tick;
    this.lookup = lookup;
    this.pending = [];
    this.openGroup = 0;
  }

  /** Forgets the per-unit memory of a dead unit. */
  forget(handle: number): void {
    this.memory.delete(handle);
  }

  /** Queues a raw request. */
  emit(req: CommandRequest): void {
    const group = this.openGroup !== 0 ? this.openGroup : this.nextGroup++;
    this.pending.push({ req, group, order: this.orderCounter++ });
  }

  /** Runs `fn`; all requests emitted inside go out together or not at all. */
  group(fn: () => void): void {
    if (this.openGroup !== 0) {
      fn();
      return;
    }
    this.openGroup = this.nextGroup++;
    try {
      fn();
    } finally {
      this.openGroup = 0;
    }
  }

  /** Transaction mark (for step rollback). */
  mark(): number {
    return this.pending.length;
  }

  /** Discards requests queued after `mark`; returns them as dropped ('aborted'). */
  rollback(mark: number): DroppedCommand[] {
    const removed = this.pending.splice(mark);
    return removed.map((p) => ({ request: p.req, reason: 'aborted' as const }));
  }

  // ---- convenience -------------------------------------------------------------------------------

  private req(op: number, units: readonly number[], payload: Uint8Array, prio: Priority, o: EmitOptions = {}): void {
    this.emit({
      op,
      units: [...units],
      payload,
      flags: o.queue === true ? CmdFlags.Queue : 0,
      prio,
      source: o.source ?? '',
    });
  }

  move(units: readonly number[], x: number, z: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Move, units, encodePosition(x, z), prio, o);
  }

  attackMove(units: readonly number[], x: number, z: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.AttackMove, units, encodePosition(x, z), prio, o);
  }

  patrol(units: readonly number[], x: number, z: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Patrol, units, encodePosition(x, z), prio, o);
  }

  setRally(factories: readonly number[], x: number, z: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.SetRally, factories, encodePosition(x, z), prio, o);
  }

  build(unit: number, bp: number, x: number, z: number, rot: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Build, [unit], encodeBuild(bp, x, z, rot), prio, o);
  }

  attack(units: readonly number[], target: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Attack, units, encodeTarget(target), prio, o);
  }

  assist(units: readonly number[], target: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Assist, units, encodeTarget(target), prio, o);
  }

  guard(units: readonly number[], target: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Guard, units, encodeTarget(target), prio, o);
  }

  repair(units: readonly number[], target: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Repair, units, encodeTarget(target), prio, o);
  }

  reclaim(units: readonly number[], target: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Reclaim, units, encodeTarget(target), prio, o);
  }

  overcharge(unit: number, target: number, prio: Priority = Prio.P0, o?: EmitOptions): void {
    this.req(Op.Overcharge, [unit], encodeTarget(target), prio, o);
  }

  factoryQueue(factory: number, bp: number, count: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.FactoryQueue, [factory], encodeFactoryQueue(bp, count), prio, o);
  }

  factoryRepeat(factory: number, items: readonly number[], prio: Priority, o?: EmitOptions): void {
    this.req(Op.FactoryRepeat, [factory], encodeFactoryRepeat(items.length > 0, items), prio, o);
  }

  upgrade(unit: number, bp: number, prio: Priority, o?: EmitOptions): void {
    this.req(Op.Upgrade, [unit], encodeUpgrade(bp), prio, o);
  }

  stop(units: readonly number[], prio: Priority, o?: EmitOptions): void {
    this.req(Op.Stop, units, encodeStop(), prio, o);
  }

  // ---- flush -------------------------------------------------------------------------------------

  private isDuplicate(req: CommandRequest, seen: Set<string>): boolean {
    const sig = signature(req);
    if (seen.has(sig)) return true;
    if (req.op === Op.FactoryRepeat || req.op === Op.SetRally) {
      if (req.units.length === 0) return false;
      for (const h of req.units) {
        const m = this.memory.get(h);
        const last = m === undefined ? null : req.op === Op.FactoryRepeat ? m.repeat : m.rally;
        if (last !== sig) return false;
        if (req.op === Op.FactoryRepeat) {
          const u = this.lookup(h);
          if (u !== undefined && u.factoryRepeat !== (req.payload[0] === 1)) return false;
        }
      }
      return true;
    }
    if (req.op === Op.FactoryQueue || req.units.length === 0) return false;
    for (const h of req.units) {
      const u = this.lookup(h);
      if (u === undefined || !unchangedFor(req, u)) return false;
    }
    return true;
  }

  private windowCount(tick: number): number {
    const w = this.window;
    while (this.windowHead < w.length && w[this.windowHead]! <= tick - APM_WINDOW_TICKS) this.windowHead++;
    if (this.windowHead > 1024 && this.windowHead * 2 > w.length) {
      this.window = w.slice(this.windowHead);
      this.windowHead = 0;
    }
    return this.window.length - this.windowHead;
  }

  private nextSeqValue(): number {
    const s = this.seq;
    this.seq = s === 0xffff ? 1 : s + 1;
    return s;
  }

  /**
   * Emits the queued requests: groups sorted by (best priority, queue order); dedup, APM window,
   * bucket and budget checks; stamps tick = thinkTick + lead and seq.
   */
  flush(budget: OpBudget & { charge?(n: number): void }): FlushResult {
    const stamp = this.tick + this.lead;
    const groups: { id: number; prio: number; order: number; items: Pending[] }[] = [];
    for (const p of this.pending) {
      let g = groups.find((x) => x.id === p.group);
      if (g === undefined) {
        g = { id: p.group, prio: p.req.prio, order: p.order, items: [] };
        groups.push(g);
      }
      if (p.req.prio < g.prio) g.prio = p.req.prio;
      g.items.push(p);
    }
    groups.sort((a, b) => (a.prio !== b.prio ? a.prio - b.prio : a.order - b.order));
    const commands: EncodedCommand[] = [];
    const dropped: DroppedCommand[] = [];
    const seen = new Set<string>();
    for (const g of groups) {
      const keep: CommandRequest[] = [];
      const local = new Set<string>();
      for (const it of g.items) {
        const sig = signature(it.req);
        if (local.has(sig) || this.isDuplicate(it.req, seen)) dropped.push({ request: it.req, reason: 'dedup' });
        else {
          local.add(sig);
          keep.push(it.req);
        }
      }
      if (keep.length === 0) continue;
      const n = keep.length;
      const p0 = g.prio === Prio.P0;
      const floor = p0 ? -this.apm.p0Overdraft : 0;
      if (this.windowCount(stamp) + n > this.apm.cap || this.tokens - n < floor) {
        for (const r of keep) dropped.push({ request: r, reason: 'apm' });
        continue;
      }
      const ops = n * OP_COST.command;
      if (!budget.take(ops)) {
        if (p0 && budget.charge !== undefined) budget.charge(ops);
        else {
          for (const r of keep) dropped.push({ request: r, reason: 'budget' });
          continue;
        }
      }
      this.tokens -= n;
      for (const r of keep) {
        seen.add(signature(r));
        const units: Handle[] = r.units.map((h) => asHandle(h));
        commands.push({
          tick: asTick(stamp),
          army: asArmyId(this.army),
          seq: this.nextSeqValue(),
          op: r.op as CommandEnvelope['op'],
          flags: r.flags,
          units,
          payload: r.payload,
        });
        this.window.push(stamp);
        this.recordsTotal++;
        if (r.op === Op.FactoryRepeat || r.op === Op.SetRally) {
          const sig = signature(r);
          for (const h of r.units) {
            let m = this.memory.get(h);
            if (m === undefined) {
              m = { repeat: null, rally: null };
              this.memory.set(h, m);
            }
            if (r.op === Op.FactoryRepeat) m.repeat = sig;
            else m.rally = sig;
          }
        }
      }
    }
    this.pending = [];
    return { commands, dropped };
  }
}

/** Encodes AI commands as one protocol batch. */
export function encodeCommands(cmds: readonly EncodedCommand[]): Uint8Array {
  return encodeBatch(cmds);
}
