/**
 * Test helpers for manager unit tests (no sim, no arena): a FakeWorld that holds own units, known
 * enemies, eco and events and produces a real PerceptionView through PerceptionWriter +
 * SnapshotPerception (the same bytes path as the arena/sim), a synthetic flat AiStatic, and
 * `runThinks` to drive a brain.
 *
 * `applyOrders` mirrors emitted commands into the units' perceived order fields (no movement, no
 * construction) so dedup and cursor logic can be tested across thinks.
 */
import { makeHandle, MAX_ARMIES } from '@faf/fixed';
import { CmdFlags, Op } from '@faf/protocol';
import { analyzeMap, type MapAnalysis } from '../analysis/map-analysis.ts';
import type { AiBrain, ThinkOptions, ThinkResult } from '../brain.ts';
import { decodeAiPayload } from '../commands/payloads.ts';
import type { EncodedCommand } from '../commands/emitter.ts';
import type { OpeningsDoc } from '../openings.ts';
import { mapClassOf } from '../openings.ts';
import { SnapshotPerception, MutableKnownUnit, MutableOwnUnit } from '../perception/snapshot.ts';
import { PerceptionWriter } from '../perception/writer.ts';
import {
  OrderKind,
  type AiBlueprintTable,
  type AiStatic,
  type EcoState,
  type KnownKind,
  type MapClass,
  type PerceptionEvent,
  type Spot,
  type SpotKind,
  type Vec2,
} from '../types.ts';

export interface FlatStaticOptions {
  readonly bps: AiBlueprintTable;
  readonly sizeWu?: number;
  readonly army?: number;
  readonly gameSeed?: number;
  readonly starts?: readonly Vec2[];
  readonly activeArmies?: readonly number[];
  readonly spots?: readonly { readonly kind: SpotKind; readonly x: number; readonly z: number }[];
  readonly name?: string;
  readonly mapClass?: MapClass;
  /** Marks 2-WU cells impassable (walls/cliffs in tests). */
  readonly blocked?: (cx: number, cz: number) => boolean;
  /** Height per cell in WU (default 0). */
  readonly height?: (cx: number, cz: number) => number;
}

/** A synthetic AiStatic: flat, fully passable (unless `blocked`), one component. */
export function flatStatic(o: FlatStaticOptions): AiStatic {
  const sizeWu = o.sizeWu ?? 256;
  const cell = 2;
  const dim = sizeWu / cell;
  const pass = new Uint8Array(dim * dim).fill(1);
  const height = new Float64Array(dim * dim);
  for (let cz = 0; cz < dim; cz++) {
    for (let cx = 0; cx < dim; cx++) {
      const i = cz * dim + cx;
      if (o.blocked?.(cx, cz) === true) pass[i] = 0;
      height[i] = o.height?.(cx, cz) ?? 0;
    }
  }
  const components = new Int32Array(dim * dim);
  for (let i = 0; i < components.length; i++) components[i] = pass[i] === 1 ? 0 : -1;
  const starts = o.starts ?? [
    { x: sizeWu / 4, z: sizeWu / 4 },
    { x: (3 * sizeWu) / 4, z: (3 * sizeWu) / 4 },
  ];
  const active = o.activeArmies ?? starts.map((_, i) => i);
  const armyStart = new Array<number>(MAX_ARMIES).fill(-1);
  for (const a of active) armyStart[a] = a;
  const spots: Spot[] = (o.spots ?? []).map((s, index) => ({ index, kind: s.kind, x: s.x, z: s.z }));
  const name = o.name ?? 'flat';
  return {
    army: o.army ?? 0,
    gameSeed: (o.gameSeed ?? 1) >>> 0,
    map: { name, sizeWu, mapClass: o.mapClass ?? mapClassOf(name, sizeWu) },
    spots,
    passLowRes: pass,
    passCellWu: cell,
    passDim: dim,
    heightLowRes: height,
    components,
    sectors: null,
    bps: o.bps,
    starts,
    armyStart,
    activeArmies: [...active].sort((a, b) => a - b),
  };
}

/** Map analysis for tests, optionally with overrides (e.g. a fixed rally point). */
export function fakeAnalysis(s: AiStatic, doc: OpeningsDoc, overrides: Partial<MapAnalysis> = {}): MapAnalysis {
  return { ...analyzeMap(s, doc), ...overrides };
}

export type FakeOwnOptions = Partial<Omit<MutableOwnUnit, 'bp' | 'x' | 'z'>>;

export interface FakeEnemyOptions {
  readonly id?: number;
  readonly army?: number;
  readonly kind?: KnownKind;
  readonly hpFrac?: number;
  readonly lastSeenTick?: number;
}

const DEFAULT_ECO: EcoState = {
  massIncome: 1,
  energyIncome: 20,
  energyUpkeep: 0,
  massStored: 650,
  energyStored: 3900,
  massCapacity: 650,
  energyCapacity: 3900,
  massRatio: 1,
  energyRatio: 1,
  massDemand: 0,
  energyDemand: 0,
};

/** Base index of enemy handles in the fake world (own handles start at 1). */
export const FAKE_ENEMY_INDEX_BASE = 0x80000;

export class FakeWorld {
  readonly static: AiStatic;
  tick: number;
  eco: EcoState;
  private readonly ownUnits = new Map<number, MutableOwnUnit>();
  private readonly enemies = new Map<number, MutableKnownUnit>();
  private events: PerceptionEvent[] = [];
  private readonly writer = new PerceptionWriter();
  private nextOwn = 1;
  private nextEnemy = FAKE_ENEMY_INDEX_BASE;

  constructor(s: AiStatic, opts: { tick?: number; eco?: Partial<EcoState> } = {}) {
    this.static = s;
    this.tick = opts.tick ?? 0;
    this.eco = { ...DEFAULT_ECO, ...opts.eco };
  }

  private bpIndex(bpId: string): number {
    const bp = this.static.bps.byId(bpId);
    if (bp === undefined) throw new Error(`FakeWorld: unknown blueprint '${bpId}'`);
    return bp.index;
  }

  /** Adds an own unit (complete by default); returns its handle. */
  addOwn(bpId: string, x: number, z: number, o: FakeOwnOptions = {}): number {
    const u = new MutableOwnUnit();
    u.handle = o.handle ?? makeHandle(this.nextOwn++, 1);
    u.bp = this.bpIndex(bpId);
    u.x = x;
    u.z = z;
    u.hpFrac = o.hpFrac ?? 1;
    u.complete = o.complete ?? true;
    u.buildFrac = o.buildFrac ?? (u.complete ? 1 : 0);
    u.order = o.order ?? OrderKind.Idle;
    u.orderTarget = o.orderTarget ?? 0;
    u.orderBp = o.orderBp ?? -1;
    u.orderX = o.orderX ?? x;
    u.orderZ = o.orderZ ?? z;
    u.queueLength = o.queueLength ?? 0;
    u.factoryBp = o.factoryBp ?? -1;
    u.factoryProgress = o.factoryProgress ?? 0;
    u.factoryRepeat = o.factoryRepeat ?? false;
    u.upgradingTo = o.upgradingTo ?? -1;
    u.lastDamagedTick = o.lastDamagedTick ?? -1;
    if (this.ownUnits.has(u.handle)) throw new Error(`FakeWorld: handle ${u.handle} exists`);
    this.ownUnits.set(u.handle, u);
    return u.handle;
  }

  /** Mutable own unit (tests may change fields between thinks). */
  own(handle: number): MutableOwnUnit {
    const u = this.ownUnits.get(handle);
    if (u === undefined) throw new Error(`FakeWorld: no own unit ${handle}`);
    return u;
  }

  /** Own handles in perception order. */
  ownHandles(): number[] {
    return [...this.ownUnits.keys()];
  }

  /** Removes an own unit; `destroyed` also emits an ownDestroyed event. */
  removeOwn(handle: number, destroyed = true): void {
    const u = this.own(handle);
    this.ownUnits.delete(handle);
    if (destroyed) this.event({ kind: 'ownDestroyed', tick: this.tick, unit: handle, bp: u.bp });
  }

  /** Adds a known enemy (bpId null = radar blip); returns its id. */
  addEnemy(bpId: string | null, x: number, z: number, o: FakeEnemyOptions = {}): number {
    const e = new MutableKnownUnit();
    e.id = o.id ?? makeHandle(this.nextEnemy++, 1);
    e.army = o.army ?? (this.static.army === 0 ? 1 : 0);
    e.kind = bpId === null ? 'blip' : (o.kind ?? 'visible');
    e.bp = bpId === null ? -1 : this.bpIndex(bpId);
    e.x = x;
    e.z = z;
    e.hpFrac = o.hpFrac ?? 1;
    e.lastSeenTick = o.lastSeenTick ?? this.tick;
    if (this.enemies.has(e.id)) throw new Error(`FakeWorld: enemy ${e.id} exists`);
    this.enemies.set(e.id, e);
    return e.id;
  }

  enemy(id: number): MutableKnownUnit {
    const e = this.enemies.get(id);
    if (e === undefined) throw new Error(`FakeWorld: no enemy ${id}`);
    return e;
  }

  /** Removes a known enemy; `destroyed` emits enemyDestroyed (seen destruction). */
  removeEnemy(id: number, destroyed = false): void {
    const e = this.enemy(id);
    this.enemies.delete(id);
    if (destroyed) this.event({ kind: 'enemyDestroyed', tick: this.tick, id, army: e.army, bp: e.bp });
  }

  /** Queues an event for the next perception. */
  event(e: PerceptionEvent): void {
    this.events.push(e);
  }

  setEco(p: Partial<EcoState>): void {
    this.eco = { ...this.eco, ...p };
  }

  advance(ticks: number): void {
    this.tick += ticks;
    for (const e of this.enemies.values()) if (e.kind === 'visible') e.lastSeenTick = this.tick;
  }

  /** Writes the snapshot of the current state (consumes the queued events); returns a copy. */
  snapshot(): Uint8Array {
    const w = this.writer.begin(this.tick, this.static.army).setEco(this.eco);
    for (const u of this.ownUnits.values()) w.addOwn(u);
    for (const e of this.enemies.values()) w.addKnown(e);
    for (const ev of this.events) w.addEvent(ev);
    this.events = [];
    return w.finish().slice();
  }

  /** Perception of the current state (consumes the queued events). */
  perceive(): SnapshotPerception {
    return new SnapshotPerception(this.static, this.snapshot());
  }

  /** Mirrors emitted commands into the perceived order fields (no simulation). */
  applyOrders(cmds: readonly EncodedCommand[]): void {
    for (const c of cmds) {
      const queued = (c.flags & CmdFlags.Queue) !== 0;
      const pl = decodeAiPayload(c.op, c.payload);
      for (const h of c.units) {
        const u = this.ownUnits.get(h);
        if (u === undefined) continue;
        if (queued && c.op !== Op.FactoryQueue && u.order !== OrderKind.Idle) {
          u.queueLength++;
          continue;
        }
        switch (pl.op) {
          case 'position':
            if (c.op === Op.SetRally) break;
            u.order = c.op === Op.Move ? OrderKind.Move : c.op === Op.AttackMove ? OrderKind.AttackMove : OrderKind.Patrol;
            u.orderX = pl.value.x;
            u.orderZ = pl.value.z;
            u.orderTarget = 0;
            u.orderBp = -1;
            u.queueLength = 0;
            break;
          case 'target':
            u.order =
              c.op === Op.Attack
                ? OrderKind.Attack
                : c.op === Op.Assist
                  ? OrderKind.Assist
                  : c.op === Op.Guard
                    ? OrderKind.Guard
                    : c.op === Op.Repair
                      ? OrderKind.Repair
                      : c.op === Op.Reclaim
                        ? OrderKind.Reclaim
                        : OrderKind.Overcharge;
            u.orderTarget = pl.value;
            u.orderBp = -1;
            u.queueLength = 0;
            break;
          case 'build':
            u.order = OrderKind.Build;
            u.orderBp = pl.value.bp;
            u.orderX = pl.value.x;
            u.orderZ = pl.value.z;
            u.orderTarget = 0;
            u.queueLength = 0;
            break;
          case 'factoryQueue':
            if (u.factoryBp < 0) u.factoryBp = pl.value.bp;
            else u.queueLength += pl.value.count;
            break;
          case 'factoryRepeat':
            u.factoryRepeat = pl.value.on;
            if (pl.value.on && u.factoryBp < 0) u.factoryBp = pl.value.items[0]!;
            break;
          case 'upgrade':
            u.upgradingTo = pl.value;
            break;
          case 'stop':
            u.order = OrderKind.Idle;
            u.queueLength = 0;
            u.orderTarget = 0;
            u.orderBp = -1;
            break;
        }
      }
    }
  }
}

export interface RunThinksOptions {
  /** Mirror commands into the world's orders (default true). */
  readonly apply?: boolean;
  readonly thinkOptions?: ThinkOptions;
  /** Called before each think (e.g. to script the world). */
  readonly before?: (world: FakeWorld, i: number) => void;
}

/**
 * Runs n thinks: aligns the world tick to the brain's think grid, perceives, thinks, optionally
 * applies the orders, then advances by thinkEvery.
 */
export function runThinks(brain: AiBrain, world: FakeWorld, n: number, o: RunThinksOptions = {}): ThinkResult[] {
  const every = brain.profile.thinkEvery;
  const out: ThinkResult[] = [];
  for (let i = 0; i < n; i++) {
    const rem = world.tick % every;
    if (rem !== 0) world.advance(every - rem);
    o.before?.(world, i);
    const r = brain.think(world.perceive(), o.thinkOptions);
    if (o.apply ?? true) world.applyOrders(r.commands);
    out.push(r);
    world.advance(every);
  }
  return out;
}
