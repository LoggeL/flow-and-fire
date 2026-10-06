/**
 * ArenaWorld — the simplified, deterministic headless test sim of TRACK-AI (docs/status/
 * track-ai-tai-p2-arena-world.md). It is a tool, not the game sim: floats are allowed, but the AI
 * determinism rules apply (ai.md §2.5: IEEE-exact math, total orders, insertion-ordered Map/Set).
 *
 * Tick phases (fixed order, one step = 0.1 s):
 *   1 CommandApply   commands of the tick in (army, seq) order, validated like the sim (handle
 *                    generation, owner, buildableBy, placement with the army's knowledge; the
 *                    TRUE occupancy is checked when the builder starts the site)
 *   2 Roll-off       units finished rollOffS ago leave the factory and walk to the rally
 *   3 Structures     factories pick their next item, own build power on production/upgrades
 *   4 Units          orders and movement of mobile units in slot order (build power on targets)
 *   5 Economy        FlowEconomy: income, upkeep, one stall ratio per army, progress + charges
 *   6 Combat         staggered target acquisition, DPS × 0.1 per tick, deaths, defeat
 *   7 Vision         every 2 ticks: visibility per army, sighting events, ghosts
 *   8 Metrics        idle engineers, observers; freed slots return to the FIFO freelist
 *
 * Cheat/scenario API (`spawn`, `kill`, `setStorage`, `setHp`, `addDemand`, `addIncome`,
 * `blockCells`) is only reachable from code, never through AI commands; every call is logged
 * (`cheatLog`) so `replayMatch` reproduces it.
 */
import {
  canPlaceKnown,
  createAiStatic,
  decodeAiPayload,
  isAiOp,
  OrderKind,
  placementContext,
  type AiBlueprint,
  type AiBlueprintTable,
  type AiPayload,
  type AiStatic,
  type KnownStructure,
  type PerceptionEvent,
  type PlacementContext,
  type RejectReason,
} from '@faf/ai';
import { MAX_ARMIES } from '@faf/fixed';
import { CmdFlags, Op, type CommandEnvelope } from '@faf/protocol';
import { getArenaAssumptions, getArenaBps, type ArenaAssumptions } from '../data/assumptions.ts';
import { getArenaMap, type ArenaMap } from '../data/maps.ts';
import { advanceDone, FlowEconomy, type EcoSnapshot } from '../eco/flow.ts';
import { UnitGrid } from './grid.ts';
import { worldHash } from './hash.ts';
import { HandleTable } from './handles.ts';
import { PathFinder } from './path.ts';
import { ArenaOrder, ArenaUnit, computeBpInfo, SITE_START_HP_FRAC, type BpInfo } from './unit.ts';

export const TICK_HZ = 10;
export const DT = 0.1;
/** Arrival radius of move orders (WU). */
export const ARRIVE_WU = 0.5;
/** Re-path a moving goal only if it moved this far from the path goal … */
export const REPATH_MOVED_WU = 4;
/** … and at most this often (ticks). */
export const REPATH_MIN_TICKS = 10;
/** Attack-move/patrol/guard units engage enemies up to weapon range + this (WU). */
export const ENGAGE_EXTRA_WU = 10;
/** Non-builder guards follow their target within this distance (WU). */
export const GUARD_FOLLOW_WU = 8;
/** Target re-acquisition is staggered: a unit looks for a new target when (tick + slot) % 3 = 0. */
export const TARGET_STAGGER = 3;
/** Extra targets hit by a splash weapon (simplified splash). */
export const SPLASH_MAX_EXTRA = 4;
/** Vision is updated every N ticks. */
export const VISION_EVERY = 2;
/** ownDamaged events per unit at most every N ticks (amounts in between are summed). */
export const DAMAGE_EVENT_MIN_TICKS = 5;
/** Energy stall is not counted for 60 s after losing a generator/storage (ai.md §7.1). */
export const STALL_EXEMPT_TICKS = 600;
/** Overcharge (Abstich) needs this much stored energy (roster note). */
export const OVERCHARGE_MIN_ENERGY = 7500;
/** Overcharge reload (roster: 3.3 s). */
export const OVERCHARGE_RELOAD_TICKS = 33;
/** Orderless engineers count as idle from this many ticks on (retroactively, ai.md §5.3). */
export const IDLE_GRACE_TICKS = 20;
/** Per-army event queue cap when nobody reads the perception (oldest events are dropped). */
export const EVENT_QUEUE_CAP = 65536;
/** One APM window (60 s). */
export const APM_WINDOW = 600;

export interface ArenaArmySetup {
  readonly army: number;
  /** Index into `ArenaMap.starts` (sorted by marker army). */
  readonly startIndex: number;
}

export interface ArenaWorldOptions {
  /** Map object or arena map name (content/maps/<name>.rtsmap). */
  readonly map: ArenaMap | string;
  /** Blueprint table (default: roster.json via getArenaBps). */
  readonly bps?: AiBlueprintTable;
  readonly seed: number;
  readonly armies: readonly ArenaArmySetup[];
  /** Model assumptions (default: ai-openings.json → assumptions). */
  readonly assumptions?: ArenaAssumptions;
}

export type CheatKind =
  | 'spawn'
  | 'kill'
  | 'setStorage'
  | 'setHp'
  | 'addDemand'
  | 'removeDemand'
  | 'addIncome'
  | 'removeIncome'
  | 'blockCells'
  | 'holdFire';

/** A logged cheat call (applied before the step of `tick`). */
export interface CheatRecord {
  readonly tick: number;
  readonly kind: CheatKind;
  readonly args: readonly (number | string | boolean)[];
}

/** An applied command envelope with the tick it was applied in. */
export interface LoggedCommand {
  readonly tick: number;
  readonly env: CommandEnvelope;
}

export type CompletionKind = 'build' | 'upgrade' | 'produced';

/** Truth hooks for metrics (never visible to the AI). `tick` = completed ticks after the step. */
export interface WorldObserver {
  onCompleted?(w: ArenaWorld, u: ArenaUnit, how: CompletionKind, tick: number): void;
  onDestroyed?(w: ArenaWorld, u: ArenaUnit, tick: number): void;
  onDamage?(w: ArenaWorld, victim: ArenaUnit, attackerArmy: number, amount: number, tick: number): void;
  /** After every step (w.tick is already incremented). */
  onTickEnd?(w: ArenaWorld): void;
}

/** Known enemy structure of one army (ghost memory). */
export interface Ghost {
  readonly handle: number;
  readonly army: number;
  bp: number;
  readonly x: number;
  readonly z: number;
  lastSeen: number;
  /** The structure died without being seen; removed once its place is seen again. */
  stale: boolean;
}

/** Per-army counters kept by the world (metrics source). */
export interface ArmyCounters {
  engineerAliveTicks: number;
  engineerIdleTicks: number;
  /** Command records per 60-s window (index = tick / 600). */
  commandsPerWindow: number[];
  commandsRejected: number;
  unitsProduced: number;
  unitsLost: number;
  firstDamageTick: number;
}

interface CheatFlow {
  readonly id: number;
  readonly army: number;
  readonly mass: number;
  readonly energy: number;
}

interface WorkRef {
  unit: ArenaUnit;
  kind: 0 | 1 | 2 | 3;
}

const W_BUILD = 0;
const W_PROD = 1;
const W_UPGRADE = 2;
const W_REPAIR = 3;

const baseStaticCache = new WeakMap<ArenaMap, WeakMap<AiBlueprintTable, AiStatic>>();

function baseStaticFor(map: ArenaMap, bps: AiBlueprintTable, a: ArenaAssumptions): AiStatic {
  let byBps = baseStaticCache.get(map);
  if (byBps === undefined) {
    byBps = new WeakMap();
    baseStaticCache.set(map, byBps);
  }
  let s = byBps.get(bps);
  if (s === undefined) {
    const first = map.starts[0];
    if (first === undefined) throw new Error(`arena: map '${map.name}' has no start markers`);
    s = createAiStatic({
      name: map.name,
      sizeWu: map.sizeWu,
      dim: map.dim,
      heights: map.heights,
      heightScaleRaw: map.heightScaleRaw,
      waterLevelRaw: map.waterLevelRaw,
      spots: map.spots,
      starts: map.starts,
      coords: 'wu',
      army: first.army,
      gameSeed: 0,
      bps,
      pass: a.pass,
      mapClass: map.mapClass,
    });
    byBps.set(bps, s);
  }
  return s;
}

function distSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export class ArenaWorld {
  readonly setup: ArenaWorldOptions;
  readonly map: ArenaMap;
  readonly bps: AiBlueprintTable;
  readonly assumptions: ArenaAssumptions;
  readonly seed: number;
  /** Active armies, ascending. */
  readonly armies: readonly number[];
  /** Army → start index (−1 = inactive). */
  readonly startIndexOf: readonly number[];
  /** Static truth for placement (terrain, spots); armyStart/activeArmies from the match setup. */
  readonly baseStatic: AiStatic;
  readonly eco: FlowEconomy;
  readonly paths: PathFinder;
  readonly infos: readonly BpInfo[];
  readonly rollOffTicks: number;

  /** Completed steps (the next step applies the commands of this tick). */
  tick = 0;
  over = false;
  /** Winning army, −1 for a draw or while running. */
  winner = -1;
  endReason: 'running' | 'commanderKilled' | 'maxTicks' = 'running';
  lastVisionTick = -1;

  readonly slots: (ArenaUnit | null)[] = [];
  readonly handles = new HandleTable();
  readonly defeated: boolean[] = new Array<boolean>(MAX_ARMIES).fill(false);
  readonly defeatTick: number[] = new Array<number>(MAX_ARMIES).fill(-1);
  readonly events: PerceptionEvent[][] = [];
  readonly ghosts: Map<number, Ghost>[] = [];
  readonly counters: ArmyCounters[] = [];
  /** Σ rates of the last economy phase per army (M/s, E/s, upkeep E/s) — truth for metrics. */
  readonly income: { mass: number; energy: number; upkeep: number }[] = [];
  readonly cheatLog: CheatRecord[] = [];
  readonly commandLog: LoggedCommand[] = [];
  readonly observers: WorldObserver[] = [];

  private readonly place: PlacementContext;
  private readonly blocked: Uint8Array;
  private readonly grid: UnitGrid;
  private gridX = new Float64Array(64);
  private gridZ = new Float64Array(64);
  private gridLayer = new Int8Array(64);
  /** Army → grid layer (index in `armies`), −1 = inactive. */
  private readonly layerOf: number[] = new Array<number>(MAX_ARMIES).fill(-1);
  private demands: CheatFlow[] = [];
  private incomes: CheatFlow[] = [];
  private nextFlowId = 1;
  private readonly commanderBp: number;
  private readonly maxVision: number[] = new Array<number>(MAX_ARMIES).fill(0);
  // consumer scratch of the economy phase
  private cUnit: ArenaUnit[] = [];
  private cKind: number[] = [];
  private cRate: number[] = [];
  private cInfo: BpInfo[] = [];

  private constructor(o: ArenaWorldOptions) {
    this.setup = o;
    this.map = typeof o.map === 'string' ? getArenaMap(o.map) : o.map;
    this.bps = o.bps ?? getArenaBps();
    this.assumptions = o.assumptions ?? getArenaAssumptions();
    if (this.assumptions.warpInS !== 0) throw new Error('arena: only warpInS = 0 is supported');
    this.seed = o.seed >>> 0;
    if (o.armies.length === 0) throw new Error('arena: at least one army');
    const startIndexOf = new Array<number>(MAX_ARMIES).fill(-1);
    const usedStarts = new Set<number>();
    for (const a of o.armies) {
      if (!Number.isInteger(a.army) || a.army < 0 || a.army >= MAX_ARMIES) throw new RangeError(`arena: bad army ${a.army}`);
      if (startIndexOf[a.army] !== -1) throw new Error(`arena: army ${a.army} listed twice`);
      if (this.map.starts[a.startIndex] === undefined) throw new RangeError(`arena: map '${this.map.name}' has no start ${a.startIndex}`);
      if (usedStarts.has(a.startIndex)) throw new Error(`arena: start ${a.startIndex} used twice`);
      usedStarts.add(a.startIndex);
      startIndexOf[a.army] = a.startIndex;
    }
    this.startIndexOf = startIndexOf;
    this.armies = o.armies.map((a) => a.army).sort((x, y) => x - y);
    const base = baseStaticFor(this.map, this.bps, this.assumptions);
    this.baseStatic = { ...base, armyStart: startIndexOf.slice(), activeArmies: this.armies.slice() };
    this.place = placementContext(this.baseStatic);
    this.blocked = new Uint8Array(base.passLowRes.length);
    this.paths = new PathFinder(base.passLowRes.slice(), base.passDim, base.passCellWu);
    this.grid = new UnitGrid(this.map.sizeWu, this.armies.length);
    this.armies.forEach((a, i) => {
      this.layerOf[a] = i;
    });
    this.eco = new FlowEconomy(MAX_ARMIES);
    this.infos = this.bps.list.map((bp) => computeBpInfo(this.bps, bp, this.assumptions));
    this.rollOffTicks = Math.round(this.assumptions.rollOffS * TICK_HZ);
    for (let a = 0; a < MAX_ARMIES; a++) {
      this.events.push([]);
      this.ghosts.push(new Map());
      this.counters.push({
        engineerAliveTicks: 0,
        engineerIdleTicks: 0,
        commandsPerWindow: [],
        commandsRejected: 0,
        unitsProduced: 0,
        unitsLost: 0,
        firstDamageTick: -1,
      });
      this.income.push({ mass: 0, energy: 0, upkeep: 0 });
    }
    const cmd = this.bps.list.find((b) => b.categoryNames.includes('COMMAND'));
    if (cmd === undefined) throw new Error('arena: blueprint table has no COMMAND unit');
    this.commanderBp = cmd.index;
    for (const a of this.armies) {
      const st = this.map.starts[startIndexOf[a]!]!;
      this.addUnit(a, this.commanderBp, st.x, st.z, true);
      if (this.assumptions.startStorageFull) this.eco.setStored(a, cmd.storageMass, cmd.storageEnergy);
      this.eco.setCapacity(a, cmd.storageMass, cmd.storageEnergy);
    }
    this.rebuildGrid();
    this.updateVision();
  }

  static create(o: ArenaWorldOptions): ArenaWorld {
    return new ArenaWorld(o);
  }

  // =================================================================================================
  // queries
  // =================================================================================================

  isActive(army: number): boolean {
    return army >= 0 && army < MAX_ARMIES && this.startIndexOf[army] !== -1;
  }

  /** Live unit of a handle (current generation), or null. */
  unit(handle: number): ArenaUnit | null {
    const s = this.handles.resolve(handle);
    if (s < 0) return null;
    const u = this.slots[s] ?? null;
    return u !== null && u.alive ? u : null;
  }

  /** Live units in slot order. */
  *units(): IterableIterator<ArenaUnit> {
    for (const u of this.slots) if (u !== null && u.alive) yield u;
  }

  /** Live units of an army in slot order. */
  unitsOf(army: number): ArenaUnit[] {
    const out: ArenaUnit[] = [];
    for (const u of this.slots) if (u !== null && u.alive && u.army === army) out.push(u);
    return out;
  }

  commander(army: number): ArenaUnit | null {
    for (const u of this.slots) if (u !== null && u.alive && u.army === army && u.info.isCommander) return u;
    return null;
  }

  info(bpIndex: number): BpInfo {
    const i = this.infos[bpIndex];
    if (i === undefined) throw new RangeError(`arena: unknown blueprint index ${bpIndex}`);
    return i;
  }

  bpIndex(bpId: string): number {
    const bp = this.bps.byId(bpId);
    if (bp === undefined) throw new Error(`arena: unknown blueprint '${bpId}'`);
    return bp.index;
  }

  /** Economy state of an army (rates of the last resolved tick). */
  ecoOf(army: number): EcoSnapshot {
    return this.eco.snapshot(army);
  }

  /** Start position of an army. */
  startOf(army: number): { x: number; z: number } {
    const i = this.startIndexOf[army] ?? -1;
    const s = this.map.starts[i];
    if (s === undefined) throw new RangeError(`arena: army ${army} is not active`);
    return { x: s.x, z: s.z };
  }

  /** True if `army` currently sees unit `u` (own units are always "seen"). */
  sees(army: number, u: ArenaUnit): boolean {
    return u.army === army || (u.seenMask & (1 << army)) !== 0;
  }

  /** xxHash32 of the canonical state dump (world/hash.ts). */
  hash(): number {
    return worldHash(this);
  }

  /** Placement against the TRUE occupancy (all structures of all armies, walls from blockCells). */
  canPlace(bpIndex: number, x: number, z: number, rot: number): boolean {
    if (!canPlaceKnown(this.place, this.allStructures(), bpIndex, x, z, rot)) return false;
    const bp = this.bps.list[bpIndex]!;
    const [w, d] = (rot & 1) === 1 ? [bp.footprint[1], bp.footprint[0]] : [bp.footprint[0], bp.footprint[1]];
    return !this.anyBlocked(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  }

  /**
   * Placement as `army` can know it (terrain, walls, own structures, enemy structures it sees or
   * remembers as ghosts) — used when a Build command arrives, so a rejection never reveals fogged
   * enemy structures (ai.md §5.3 R-08). The TRUE occupancy is checked when construction starts.
   */
  canPlaceKnownBy(army: number, bpIndex: number, x: number, z: number, rot: number): boolean {
    const known: KnownStructure[] = [];
    const bit = 1 << army;
    for (const u of this.slots) {
      if (u === null || !u.alive || !u.info.isStructure) continue;
      if (u.army === army || (u.seenMask & bit) !== 0) known.push({ bp: u.bp.index, x: u.x, z: u.z });
    }
    for (const g of this.ghosts[army]!.values()) {
      const live = this.unit(g.handle);
      if (live !== null && (live.seenMask & bit) !== 0) continue;
      known.push({ bp: g.bp, x: g.x, z: g.z });
    }
    if (!canPlaceKnown(this.place, known, bpIndex, x, z, rot)) return false;
    const bp = this.bps.list[bpIndex]!;
    const [w, d] = (rot & 1) === 1 ? [bp.footprint[1], bp.footprint[0]] : [bp.footprint[0], bp.footprint[1]];
    return !this.anyBlocked(x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  }

  private allStructures(): KnownStructure[] {
    const out: KnownStructure[] = [];
    for (const u of this.slots) {
      if (u !== null && u.alive && u.info.isStructure) out.push({ bp: u.bp.index, x: u.x, z: u.z });
    }
    return out;
  }

  private anyBlocked(x0: number, z0: number, x1: number, z1: number): boolean {
    const g = this.baseStatic.passCellWu;
    const d = this.baseStatic.passDim;
    const eps = 1e-9;
    const cx0 = Math.max(0, Math.floor(x0 / g + eps));
    const cz0 = Math.max(0, Math.floor(z0 / g + eps));
    const cx1 = Math.min(d - 1, Math.ceil(x1 / g - eps) - 1);
    const cz1 = Math.min(d - 1, Math.ceil(z1 / g - eps) - 1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) if (this.blocked[cz * d + cx] === 1) return true;
    }
    return false;
  }

  // =================================================================================================
  // units
  // =================================================================================================

  private addUnit(army: number, bpIndex: number, x: number, z: number, complete: boolean): ArenaUnit {
    const handle = this.handles.alloc();
    const slot = handle & 0xfffff;
    const u = new ArenaUnit(handle, slot, army, this.info(bpIndex), x, z, this.tick, complete);
    while (this.slots.length <= slot) this.slots.push(null);
    this.slots[slot] = u;
    if (u.info.isKranzGen || u.info.isEnergyStorage) this.updateKranz();
    return u;
  }

  private pushEvent(army: number, e: PerceptionEvent): void {
    const q = this.events[army]!;
    q.push(e);
    if (q.length > EVENT_QUEUE_CAP) q.splice(0, q.length - EVENT_QUEUE_CAP / 2);
  }

  /** Glutkranz adjacency: T1 generators touching a completed energy storage get +25 % each. */
  private updateKranz(): void {
    const stores: ArenaUnit[] = [];
    for (const u of this.slots) if (u !== null && u.alive && u.complete && u.info.isEnergyStorage) stores.push(u);
    for (const u of this.slots) {
      if (u === null || !u.alive || !u.info.isKranzGen) continue;
      let k = 0;
      for (const s of stores) if (s.army === u.army && touches(u, s)) k++;
      u.kranz = k;
    }
  }

  // =================================================================================================
  // step
  // =================================================================================================

  /** Advances one tick with the commands of `this.tick` (any order; applied in (army, seq) order). */
  step(cmds: readonly CommandEnvelope[] = []): void {
    const t = this.tick;
    for (const env of cmds) this.commandLog.push({ tick: t, env });
    if (cmds.length > 0) this.applyCommands(cmds);
    for (const u of this.slots) {
      if (u === null || !u.alive) continue;
      u.bpBuild = 0;
      u.bpProd = 0;
      u.bpUpgrade = 0;
      u.bpRepair = 0;
      u.moved = false;
    }
    this.phaseRollOff();
    this.phaseStructures();
    this.phaseUnits();
    this.phaseEconomy();
    this.phaseCombat();
    this.phaseDeaths();
    if (t % VISION_EVERY === 0) this.updateVision();
    this.phaseMetrics();
    this.cleanup();
    this.tick = t + 1;
    for (const o of this.observers) o.onTickEnd?.(this);
  }

  // =================================================================================================
  // 1 CommandApply
  // =================================================================================================

  private applyCommands(cmds: readonly CommandEnvelope[]): void {
    const idx = cmds.map((_, i) => i);
    idx.sort((a, b) => {
      const ea = cmds[a]!;
      const eb = cmds[b]!;
      return ea.army - eb.army || ea.seq - eb.seq || a - b;
    });
    for (const i of idx) this.applyCommand(cmds[i]!);
  }

  private reject(army: number, seq: number, reason: RejectReason, unit: number): void {
    this.counters[army]!.commandsRejected++;
    this.pushEvent(army, { kind: 'commandRejected', tick: this.tick, seq, reason, unit });
  }

  private applyCommand(env: CommandEnvelope): void {
    const army = env.army as number;
    if (!this.isActive(army)) return;
    const w = Math.floor(this.tick / APM_WINDOW);
    const cpw = this.counters[army]!.commandsPerWindow;
    while (cpw.length <= w) cpw.push(0);
    cpw[w]!++;
    const first = env.units.length > 0 ? (env.units[0] as number) : 0;
    if (this.defeated[army]) return;
    if (!isAiOp(env.op)) {
      this.reject(army, env.seq, 'unknownOp', first);
      return;
    }
    let pl: AiPayload;
    try {
      pl = decodeAiPayload(env.op, env.payload);
    } catch {
      this.reject(army, env.seq, 'malformed', first);
      return;
    }
    const units: ArenaUnit[] = [];
    let unitReason: RejectReason | null = null;
    for (const h of env.units) {
      const s = this.handles.resolve(h as number);
      const u = s < 0 ? null : (this.slots[s] ?? null);
      if (u === null || !u.alive) {
        unitReason ??= 'invalidUnit';
        continue;
      }
      if (u.army !== army) {
        unitReason ??= 'notOwner';
        continue;
      }
      if (!units.includes(u)) units.push(u);
    }
    if (units.length === 0) {
      this.reject(army, env.seq, unitReason ?? 'invalidUnit', first);
      return;
    }
    const queue = (env.flags & CmdFlags.Queue) !== 0;
    const reason = this.execCommand(army, env, pl, units, queue);
    if (reason !== null) this.reject(army, env.seq, reason, first);
  }

  /** Executes a validated command; returns a reject reason if no unit accepted it. */
  private execCommand(army: number, env: CommandEnvelope, pl: AiPayload, units: ArenaUnit[], queue: boolean): RejectReason | null {
    let accepted = 0;
    const size = this.map.sizeWu;
    const clampPos = (v: number): number => (v < 0 ? 0 : v > size ? size : v);
    switch (pl.op) {
      case 'position': {
        const x = clampPos(pl.value.x);
        const z = clampPos(pl.value.z);
        for (const u of units) {
          if (u.info.isFactory || env.op === Op.SetRally) {
            if (u.info.isFactory) {
              u.hasRally = true;
              u.rallyX = x;
              u.rallyZ = z;
              accepted++;
            }
            continue;
          }
          if (u.info.isStructure) continue;
          const kind = env.op === Op.Move ? OrderKind.Move : env.op === Op.AttackMove ? OrderKind.AttackMove : OrderKind.Patrol;
          const o = new ArenaOrder(kind);
          o.x = x;
          o.z = z;
          o.seq = env.seq;
          this.setOrder(u, o, queue);
          accepted++;
        }
        return accepted > 0 ? null : 'other';
      }
      case 'target': {
        const t = this.unit(pl.value);
        if (env.op === Op.Reclaim) return 'noTarget'; // no wrecks in the arena
        if (t === null) return 'noTarget';
        if (env.op === Op.Attack || env.op === Op.Overcharge) {
          if (t.army === army) return 'noTarget';
          if (env.op === Op.Overcharge) {
            if (this.eco.energyStoredMilli(army) < OVERCHARGE_MIN_ENERGY * 1000) return 'noEnergy';
          }
          for (const u of units) {
            if (u.info.isStructure) continue;
            if (env.op === Op.Overcharge && !u.info.isCommander) continue;
            if (env.op === Op.Attack && !(t.info.isAir ? u.info.hasAirWeapon : u.info.hasSurfaceWeapon)) continue;
            const o = new ArenaOrder(env.op === Op.Attack ? OrderKind.Attack : OrderKind.Overcharge);
            o.target = t.handle;
            o.seq = env.seq;
            this.setOrder(u, o, queue);
            accepted++;
          }
          return accepted > 0 ? null : 'other';
        }
        if (t.army !== army) return 'noTarget';
        const kind = env.op === Op.Assist ? OrderKind.Assist : env.op === Op.Guard ? OrderKind.Guard : OrderKind.Repair;
        for (const u of units) {
          if (u === t || u.info.isStructure) continue;
          if (kind !== OrderKind.Guard && !u.info.isBuilder) continue;
          const o = new ArenaOrder(kind);
          o.target = t.handle;
          o.seq = env.seq;
          o.finite = kind === OrderKind.Assist && t.info.isStructure && !t.info.isFactory;
          this.setOrder(u, o, queue);
          accepted++;
        }
        return accepted > 0 ? null : 'other';
      }
      case 'build': {
        const b = pl.value;
        const bp = this.bps.list[b.bp];
        if (bp === undefined || !bp.isStructure) return 'notBuildable';
        const builders = units.filter((u) => u.info.isBuilder && this.bps.canBuild(u.bp, bp));
        if (builders.length === 0) return 'notBuildable';
        if (this.findSite(army, b.bp, b.x, b.z) === null && !this.canPlaceKnownBy(army, b.bp, b.x, b.z, b.rot)) return 'placement';
        for (const u of builders) {
          const o = new ArenaOrder(OrderKind.Build);
          o.bp = b.bp;
          o.x = b.x;
          o.z = b.z;
          o.rot = b.rot;
          o.seq = env.seq;
          this.setOrder(u, o, queue);
        }
        return null;
      }
      case 'factoryQueue': {
        const item = this.bps.list[pl.value.bp];
        if (item === undefined || item.isStructure) return 'notBuildable';
        for (const u of units) {
          if (!u.info.isFactory || !this.bps.canBuild(u.bp, item)) continue;
          if (!queue) {
            u.queueBp.length = 0;
            u.queueCount.length = 0;
          }
          u.queueBp.push(item.index);
          u.queueCount.push(pl.value.count);
          accepted++;
        }
        return accepted > 0 ? null : 'notBuildable';
      }
      case 'factoryRepeat': {
        const items = pl.value.items;
        for (const u of units) {
          if (!u.info.isFactory) continue;
          if (pl.value.on) {
            let ok = true;
            for (const i of items) {
              const it = this.bps.list[i];
              if (it === undefined || it.isStructure || !this.bps.canBuild(u.bp, it)) ok = false;
            }
            if (!ok) continue;
            u.repeat = items.slice();
          } else {
            u.repeat = [];
          }
          u.repeatIdx = 0;
          accepted++;
        }
        return accepted > 0 ? null : 'notBuildable';
      }
      case 'upgrade': {
        for (const u of units) {
          if (!u.info.isStructure || !u.complete || u.bp.upgradesTo !== pl.value) continue;
          if (u.upgradeBp !== pl.value) {
            u.upgradeBp = pl.value;
            u.upgradeDone = 0;
          }
          accepted++;
        }
        return accepted > 0 ? null : 'notBuildable';
      }
      case 'stop': {
        for (const u of units) {
          if (u.info.isStructure) {
            u.queueBp.length = 0;
            u.queueCount.length = 0;
            u.repeat = [];
            u.repeatIdx = 0;
            u.prodBp = -1;
            u.prodDone = 0;
            u.upgradeBp = -1;
            u.upgradeDone = 0;
          } else {
            u.orders = [];
            u.path = null;
            u.pathFailed = false;
            u.target = 0;
          }
        }
        return null;
      }
    }
  }

  private setOrder(u: ArenaUnit, o: ArenaOrder, queue: boolean): void {
    if (queue && u.orders.length > 0) {
      u.orders.push(o);
      return;
    }
    u.orders = [o];
    u.path = null;
    u.pathFailed = false;
  }

  /** Own incomplete site of `bp` at (x, z) (±0.01 WU), or null. */
  private findSite(army: number, bp: number, x: number, z: number): ArenaUnit | null {
    for (const u of this.slots) {
      if (u === null || !u.alive || u.army !== army || u.complete || u.bp.index !== bp) continue;
      if (Math.abs(u.x - x) <= 0.01 && Math.abs(u.z - z) <= 0.01) return u;
    }
    return null;
  }

  // =================================================================================================
  // 3 Structures
  // =================================================================================================

  private phaseStructures(): void {
    for (const u of this.slots) {
      if (u === null || !u.alive || !u.info.isStructure || !u.complete) continue;
      if (u.upgradeBp >= 0) {
        u.bpUpgrade += u.bp.buildPower > 0 ? u.bp.buildPower : 10;
        continue;
      }
      if (!u.info.isFactory) continue;
      if (u.prodBp < 0) {
        if (u.queueBp.length > 0) {
          u.prodBp = u.queueBp[0]!;
          const left = u.queueCount[0]! - 1;
          if (left <= 0) {
            u.queueBp.shift();
            u.queueCount.shift();
          } else {
            u.queueCount[0] = left;
          }
          u.prodDone = 0;
        } else if (u.repeat.length > 0) {
          u.prodBp = u.repeat[u.repeatIdx % u.repeat.length]!;
          u.repeatIdx++;
          u.prodDone = 0;
        }
      }
      if (u.prodBp >= 0) u.bpProd += u.bp.buildPower;
    }
  }

  // =================================================================================================
  // 4 Units (orders + movement)
  // =================================================================================================

  private phaseUnits(): void {
    for (const u of this.slots) {
      if (u === null || !u.alive || u.info.isStructure) continue;
      let guard = 0;
      while (guard++ < 4) {
        const o = u.orders[0];
        if (o === undefined) break;
        if (!this.execOrder(u, o)) break;
        u.orders.shift();
        u.path = null;
        u.pathFailed = false;
      }
    }
  }

  /** Executes the current order; true when it is finished. */
  private execOrder(u: ArenaUnit, o: ArenaOrder): boolean {
    switch (o.kind) {
      case OrderKind.Move:
        return this.moveTo(u, o.x, o.z, ARRIVE_WU, false) || u.pathFailed;
      case OrderKind.AttackMove:
      case OrderKind.Patrol:
        return this.execAttackMove(u, o);
      case OrderKind.Attack: {
        const t = this.unit(o.target);
        if (t === null) return true;
        if (!t.info.isStructure && !this.sees(u.army, t)) return true;
        const r = u.bp.rangeMax;
        if (distSq(u.x, u.z, t.x, t.z) > r * r) {
          const end = this.moveTo(u, t.x, t.z, r * 0.9, !t.info.isStructure);
          return u.pathFailed || (end && distSq(u.x, u.z, t.x, t.z) > r * r);
        }
        return false;
      }
      case OrderKind.Build:
        return this.execBuild(u, o);
      case OrderKind.Assist:
      case OrderKind.Guard:
        return this.execAssist(u, o);
      case OrderKind.Repair: {
        const t = this.unit(o.target);
        if (t === null || t.army !== u.army) return true;
        if (t.complete && t.hp >= t.info.maxHp) return true;
        const range = u.info.buildRange + t.info.halfFoot;
        if (distSq(u.x, u.z, t.x, t.z) > range * range) {
          const end = this.moveTo(u, t.x, t.z, range, !t.info.isStructure);
          return u.pathFailed || (end && distSq(u.x, u.z, t.x, t.z) > range * range);
        }
        if (!t.complete) t.bpBuild += u.bp.buildPower;
        else t.bpRepair += u.bp.buildPower;
        return false;
      }
      case OrderKind.Overcharge:
        return this.execOvercharge(u, o);
      default:
        return true;
    }
  }

  private execAttackMove(u: ArenaUnit, o: ArenaOrder): boolean {
    if (o.kind === OrderKind.Patrol && !o.started) {
      o.started = true;
      o.px = u.x;
      o.pz = u.z;
    }
    const t = u.target !== 0 ? this.unit(u.target) : null;
    if (t !== null) {
      const r = this.weaponRange(u, t);
      if (distSq(u.x, u.z, t.x, t.z) > r * r) this.moveTo(u, t.x, t.z, r * 0.9, !t.info.isStructure);
      return false;
    }
    const arrived = this.moveTo(u, o.x, o.z, ARRIVE_WU, false);
    if (u.pathFailed) return true;
    if (!arrived) return false;
    if (o.kind === OrderKind.AttackMove) return true;
    const x = o.x;
    const z = o.z;
    o.x = o.px;
    o.z = o.pz;
    o.px = x;
    o.pz = z;
    u.path = null;
    return false;
  }

  private execBuild(u: ArenaUnit, o: ArenaOrder): boolean {
    const info = this.info(o.bp);
    const range = u.info.buildRange + info.halfFoot;
    if (o.site !== 0) {
      const site = this.unit(o.site);
      if (site === null || site.complete) return true;
      if (distSq(u.x, u.z, site.x, site.z) > range * range) {
        const end = this.moveTo(u, site.x, site.z, range, false);
        return u.pathFailed || (end && distSq(u.x, u.z, site.x, site.z) > range * range);
      }
      site.bpBuild += u.bp.buildPower;
      return false;
    }
    if (distSq(u.x, u.z, o.x, o.z) > range * range) {
      const end = this.moveTo(u, o.x, o.z, range, false);
      if (u.pathFailed || (end && distSq(u.x, u.z, o.x, o.z) > range * range)) {
        this.reject(u.army, o.seq, 'other', u.handle);
        return true;
      }
      return false;
    }
    let site = this.findSite(u.army, o.bp, o.x, o.z);
    if (site === null) {
      if (!this.canPlace(o.bp, o.x, o.z, o.rot)) {
        this.reject(u.army, o.seq, 'placement', u.handle);
        return true;
      }
      site = this.addUnit(u.army, o.bp, o.x, o.z, false);
      site.spot = this.spotAt(info, o.x, o.z);
    }
    o.site = site.handle;
    site.bpBuild += u.bp.buildPower;
    return false;
  }

  private spotAt(info: BpInfo, x: number, z: number): number {
    if (!info.isMex && !info.isHydro) return -1;
    const kind = info.isMex ? 'mass' : 'hydro';
    for (const s of this.baseStatic.spots) {
      if (s.kind === kind && Math.abs(s.x - x) <= 1 && Math.abs(s.z - z) <= 1) return s.index;
    }
    return -1;
  }

  /** What an assist/guard on `t` would work on (site, production, upgrade, repair), or null. */
  workOf(t: ArenaUnit, depth = 0): WorkRef | null {
    if (t.info.isStructure) {
      if (!t.complete) return { unit: t, kind: W_BUILD };
      if (t.upgradeBp >= 0) return { unit: t, kind: W_UPGRADE };
      if (t.info.isFactory && t.prodBp >= 0) return { unit: t, kind: W_PROD };
      return null;
    }
    if (!t.info.isBuilder || depth >= 2) return null;
    const o = t.orders[0];
    if (o === undefined) return null;
    if (o.kind === OrderKind.Build && o.site !== 0) {
      const s = this.unit(o.site);
      return s !== null && !s.complete ? { unit: s, kind: W_BUILD } : null;
    }
    if (o.kind === OrderKind.Repair) {
      const r = this.unit(o.target);
      if (r === null) return null;
      if (!r.complete) return { unit: r, kind: W_BUILD };
      return r.hp < r.info.maxHp ? { unit: r, kind: W_REPAIR } : null;
    }
    if (o.kind === OrderKind.Assist || o.kind === OrderKind.Guard) {
      const n = this.unit(o.target);
      return n === null ? null : this.workOf(n, depth + 1);
    }
    return null;
  }

  private execAssist(u: ArenaUnit, o: ArenaOrder): boolean {
    const t = this.unit(o.target);
    if (t === null || t.army !== u.army) return true;
    const work = u.info.isBuilder ? this.workOf(t) : null;
    if (work === null) {
      if (o.kind === OrderKind.Assist && o.finite) return true;
      const follow = u.info.isBuilder ? u.info.buildRange + t.info.halfFoot : GUARD_FOLLOW_WU;
      if (distSq(u.x, u.z, t.x, t.z) > (follow + 2) * (follow + 2)) this.moveTo(u, t.x, t.z, follow, !t.info.isStructure);
      return false;
    }
    const w = work.unit;
    const range = u.info.buildRange + w.info.halfFoot;
    if (distSq(u.x, u.z, w.x, w.z) > range * range) {
      const end = this.moveTo(u, w.x, w.z, range, !w.info.isStructure);
      return u.pathFailed || (end && distSq(u.x, u.z, w.x, w.z) > range * range);
    }
    const bp = u.bp.buildPower;
    if (work.kind === W_BUILD) w.bpBuild += bp;
    else if (work.kind === W_PROD) w.bpProd += bp;
    else if (work.kind === W_UPGRADE) w.bpUpgrade += bp;
    else w.bpRepair += bp;
    return false;
  }

  private execOvercharge(u: ArenaUnit, o: ArenaOrder): boolean {
    const t = this.unit(o.target);
    if (t === null || t.army === u.army) return true;
    const r = u.bp.rangeMax;
    if (distSq(u.x, u.z, t.x, t.z) > r * r) {
      const end = this.moveTo(u, t.x, t.z, r * 0.9, !t.info.isStructure);
      return u.pathFailed || (end && distSq(u.x, u.z, t.x, t.z) > r * r);
    }
    if (this.tick < u.overchargeReadyTick) return false;
    const stored = this.eco.energyStoredMilli(u.army) / 1000;
    if (stored < OVERCHARGE_MIN_ENERGY) {
      this.reject(u.army, o.seq, 'noEnergy', u.handle);
      return true;
    }
    this.fireOvercharge(u, t, stored);
    return true;
  }

  /**
   * Overcharge (Abstich), simplified after the roster note: damage vs. mobile units =
   * clamp(max HP of mobile non-commander enemies within 2.7 WU of the target, 1250,
   * min(15000, 0.9 · stored / 6)); vs. structures 800, vs. commanders 400; splash 2.5 WU on mobile
   * enemies; energy drain = 6 × damage.
   */
  private fireOvercharge(u: ArenaUnit, t: ArenaUnit, stored: number): void {
    const cap = Math.min(15000, (0.9 * stored) / 6);
    let maxHp = 0;
    for (const v of this.slots) {
      if (v === null || !v.alive || v.army === u.army || v.info.isStructure || v.info.isCommander) continue;
      if (distSq(v.x, v.z, t.x, t.z) <= 2.7 * 2.7 && v.info.maxHp > maxHp) maxHp = v.info.maxHp;
    }
    let dmg = maxHp > 0 ? maxHp : 1250;
    if (dmg < 1250) dmg = 1250;
    if (dmg > cap) dmg = cap;
    const main = t.info.isStructure ? 800 : t.info.isCommander ? 400 : dmg;
    t.dmgTick += main;
    t.dmgTickAttacker = u.handle;
    for (const v of this.slots) {
      if (v === null || v === t || !v.alive || v.army === u.army || v.info.isStructure || v.info.isCommander) continue;
      if (distSq(v.x, v.z, t.x, t.z) <= 2.5 * 2.5) {
        v.dmgTick += dmg;
        v.dmgTickAttacker = u.handle;
      }
    }
    const drain = 6 * main;
    const m = this.eco.massStoredMilli(u.army) / 1000;
    const e = this.eco.energyStoredMilli(u.army) / 1000 - drain;
    this.eco.setStored(u.army, m, e > 0 ? e : 0);
    u.overchargeReadyTick = this.tick + OVERCHARGE_RELOAD_TICKS;
  }

  /**
   * Moves `u` towards (gx, gz) until within `stop` WU. Land units follow A* paths (re-path when a
   * moving goal drifted ≥ REPATH_MOVED_WU, at most every REPATH_MIN_TICKS), air units fly straight.
   * Returns true when within `stop` — or, for a fixed goal, at the end of its path when the goal
   * itself is not reachable any closer (blocked goal cell); callers that need a range re-check it.
   * Sets `u.pathFailed` if no land path exists.
   */
  private moveTo(u: ArenaUnit, gx: number, gz: number, stop: number, movingGoal: boolean): boolean {
    const stopSq = stop * stop;
    if (distSq(u.x, u.z, gx, gz) <= stopSq) {
      u.path = null;
      return true;
    }
    if (u.moved) return false;
    u.moved = true;
    let step = u.bp.speed * DT;
    if (!(step > 0)) {
      u.pathFailed = true;
      return false;
    }
    if (u.info.isAir) {
      const dx = gx - u.x;
      const dz = gz - u.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const f = step >= d ? 1 : step / d;
      u.x += dx * f;
      u.z += dz * f;
      return distSq(u.x, u.z, gx, gz) <= stopSq;
    }
    const needPath =
      u.path === null ||
      (distSq(u.pathGoalX, u.pathGoalZ, gx, gz) > (movingGoal ? REPATH_MOVED_WU * REPATH_MOVED_WU : 1e-6) &&
        (!movingGoal || this.tick - u.pathTick >= REPATH_MIN_TICKS)) ||
      (u.pathIdx >= u.path.length && this.tick - u.pathTick >= REPATH_MIN_TICKS);
    if (needPath) {
      const p = this.paths.find(u.x, u.z, gx, gz);
      u.pathTick = this.tick;
      u.pathGoalX = gx;
      u.pathGoalZ = gz;
      if (p === null) {
        u.path = null;
        u.pathFailed = true;
        return false;
      }
      u.path = p;
      u.pathIdx = 0;
    }
    const path = u.path!;
    while (step > 0 && u.pathIdx < path.length) {
      const wx = path[u.pathIdx]!;
      const wz = path[u.pathIdx + 1]!;
      const dx = wx - u.x;
      const dz = wz - u.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d <= step) {
        u.x = wx;
        u.z = wz;
        step -= d;
        u.pathIdx += 2;
      } else {
        const f = step / d;
        u.x += dx * f;
        u.z += dz * f;
        step = 0;
      }
      if (distSq(u.x, u.z, gx, gz) <= stopSq) return true;
    }
    return distSq(u.x, u.z, gx, gz) <= stopSq || (!movingGoal && u.pathIdx >= path.length);
  }

  // =================================================================================================
  // 5 Economy
  // =================================================================================================

  private phaseEconomy(): void {
    const eco = this.eco;
    eco.beginTick();
    const incM = new Float64Array(MAX_ARMIES);
    const incE = new Float64Array(MAX_ARMIES);
    const upk = new Float64Array(MAX_ARMIES);
    const capM = new Float64Array(MAX_ARMIES);
    const capE = new Float64Array(MAX_ARMIES);
    for (const u of this.slots) {
      if (u === null || !u.alive || !u.complete) continue;
      const bp = u.bp;
      const a = u.army;
      incM[a] = incM[a]! + bp.massPerSec;
      incE[a] = incE[a]! + (u.kranz > 0 ? bp.energyPerSec * (1 + 0.25 * u.kranz) : bp.energyPerSec);
      upk[a] = upk[a]! + bp.upkeepEnergyPerSec;
      capM[a] = capM[a]! + bp.storageMass;
      capE[a] = capE[a]! + bp.storageEnergy;
    }
    for (const f of this.incomes) {
      incM[f.army] = incM[f.army]! + f.mass;
      incE[f.army] = incE[f.army]! + f.energy;
    }
    for (const a of this.armies) {
      eco.addIncome(a, incM[a]!, incE[a]!);
      eco.addUpkeep(a, upk[a]!);
      eco.setCapacity(a, capM[a]!, capE[a]!);
      const inc = this.income[a]!;
      inc.mass = incM[a]!;
      inc.energy = incE[a]!;
      inc.upkeep = upk[a]!;
    }
    // consumers in slot order
    const cu = this.cUnit;
    const ck = this.cKind;
    const cr = this.cRate;
    const ci = this.cInfo;
    let n = 0;
    const add = (u: ArenaUnit, kind: number, info: BpInfo, bpSum: number): void => {
      const bt = info.bp.buildTime;
      const rate = bt > 0 ? bpSum / bt / TICK_HZ : 1;
      eco.request(u.army, u.handle * 4 + kind, (info.bp.mass * rate), (info.bp.energy * rate), bpSum);
      cu[n] = u;
      ck[n] = kind;
      cr[n] = rate;
      ci[n] = info;
      n++;
    };
    for (const u of this.slots) {
      if (u === null || !u.alive) continue;
      if (!u.complete) {
        if (u.bpBuild > 0) add(u, W_BUILD, u.info, u.bpBuild);
        continue;
      }
      if (u.upgradeBp >= 0) {
        if (u.bpUpgrade > 0) add(u, W_UPGRADE, this.info(u.upgradeBp), u.bpUpgrade);
      } else if (u.prodBp >= 0 && u.bpProd > 0) {
        add(u, W_PROD, this.info(u.prodBp), u.bpProd);
      }
      if (u.bpRepair > 0 && u.hp < u.info.maxHp) add(u, W_REPAIR, u.info, u.bpRepair);
    }
    for (const f of this.demands) eco.request(f.army, -f.id, f.mass / TICK_HZ, f.energy / TICK_HZ, 0);
    eco.resolve();
    for (let i = 0; i < n; i++) {
      const u = cu[i]!;
      const kind = ck[i]!;
      const rate = cr[i]!;
      const info = ci[i]!;
      const r = eco.ratio(u.army);
      if (kind === W_REPAIR) {
        eco.chargeGranted(u.handle * 4 + kind);
        const hp = u.hp + u.info.maxHp * rate * r;
        u.hp = hp > u.info.maxHp ? u.info.maxHp : hp;
        continue;
      }
      const old = kind === W_BUILD ? u.buildDone : kind === W_PROD ? u.prodDone : u.upgradeDone;
      const nw = advanceDone(old, rate * r);
      eco.chargeProgress(u.army, info.costMassMilli, info.costEnergyMilli, old, nw);
      if (kind === W_BUILD) {
        u.buildDone = nw;
        const hp = u.hp + (nw - old) * u.info.maxHp * (1 - SITE_START_HP_FRAC);
        u.hp = hp > u.info.maxHp ? u.info.maxHp : hp;
        if (nw === 1) this.completeSite(u);
      } else if (kind === W_PROD) {
        u.prodDone = nw;
        if (nw === 1) {
          u.rolloff.push({ bp: u.prodBp, ticksLeft: this.rollOffTicks });
          u.prodBp = -1;
          u.prodDone = 0;
        }
      } else {
        u.upgradeDone = nw;
        if (nw === 1) this.completeUpgrade(u);
      }
    }
    for (const f of this.demands) eco.chargeGranted(-f.id);
    eco.endTick();
  }

  private completeSite(u: ArenaUnit): void {
    u.complete = true;
    u.buildDone = 1;
    if (u.info.isEnergyStorage || u.info.isKranzGen) this.updateKranz();
    this.pushEvent(u.army, { kind: 'ownCompleted', tick: this.tick, unit: u.handle, bp: u.bp.index });
    for (const o of this.observers) o.onCompleted?.(this, u, 'build', this.tick + 1);
  }

  private completeUpgrade(u: ArenaUnit): void {
    const frac = u.hpFrac;
    u.info = this.info(u.upgradeBp);
    u.hp = frac * u.info.maxHp;
    u.upgradeBp = -1;
    u.upgradeDone = 0;
    this.updateKranz();
    this.pushEvent(u.army, { kind: 'ownCompleted', tick: this.tick, unit: u.handle, bp: u.bp.index });
    for (const o of this.observers) o.onCompleted?.(this, u, 'upgrade', this.tick + 1);
  }

  // =================================================================================================
  // 2 Roll-off
  // =================================================================================================

  private phaseRollOff(): void {
    const hw = this.slots.length;
    for (let s = 0; s < hw; s++) {
      const f = this.slots[s];
      if (f === null || f === undefined || !f.alive || f.rolloff.length === 0) continue;
      for (const r of f.rolloff) r.ticksLeft--;
      while (f.rolloff.length > 0 && f.rolloff[0]!.ticksLeft <= 0) {
        const r = f.rolloff.shift()!;
        this.spawnFromFactory(f, r.bp);
      }
    }
  }

  private spawnFromFactory(f: ArenaUnit, bp: number): void {
    let dx = 0;
    let dz = 1;
    if (f.hasRally) {
      const rx = f.rallyX - f.x;
      const rz = f.rallyZ - f.z;
      const d = Math.sqrt(rx * rx + rz * rz);
      if (d > 1e-6) {
        dx = rx / d;
        dz = rz / d;
      }
    }
    const off = f.info.halfFoot + 1;
    const size = this.map.sizeWu;
    let x = f.x + dx * off;
    let z = f.z + dz * off;
    x = x < 0 ? 0 : x > size ? size : x;
    z = z < 0 ? 0 : z > size ? size : z;
    const u = this.addUnit(f.army, bp, x, z, true);
    if (f.hasRally) {
      const o = new ArenaOrder(OrderKind.Move);
      o.x = f.rallyX;
      o.z = f.rallyZ;
      u.orders = [o];
    }
    this.counters[f.army]!.unitsProduced++;
    this.pushEvent(f.army, { kind: 'ownCompleted', tick: this.tick, unit: u.handle, bp });
    for (const o of this.observers) o.onCompleted?.(this, u, 'produced', this.tick + 1);
  }

  // =================================================================================================
  // 6 Combat
  // =================================================================================================

  private rebuildGrid(): void {
    const hw = this.slots.length;
    if (this.gridX.length < hw) {
      let cap = this.gridX.length;
      while (cap < hw) cap *= 2;
      this.gridX = new Float64Array(cap);
      this.gridZ = new Float64Array(cap);
      this.gridLayer = new Int8Array(cap);
    }
    for (let s = 0; s < hw; s++) {
      const u = this.slots[s];
      if (u === null || u === undefined || !u.alive) {
        this.gridLayer[s] = -1;
        continue;
      }
      this.gridLayer[s] = this.layerOf[u.army]!;
      this.gridX[s] = u.x;
      this.gridZ[s] = u.z;
    }
    this.grid.rebuild(hw, this.gridLayer, this.gridX, this.gridZ);
  }

  private weaponRange(u: ArenaUnit, _t: ArenaUnit): number {
    return u.bp.rangeMax;
  }

  private canHit(u: ArenaUnit, t: ArenaUnit): boolean {
    return t.info.isAir ? u.info.hasAirWeapon : u.info.hasSurfaceWeapon;
  }

  private engageRange(u: ArenaUnit): number {
    const o = u.orders[0];
    if (o !== undefined && (o.kind === OrderKind.AttackMove || o.kind === OrderKind.Patrol || o.kind === OrderKind.Guard)) {
      return u.bp.rangeMax + ENGAGE_EXTRA_WU;
    }
    return u.bp.rangeMax;
  }

  private validTarget(u: ArenaUnit, t: ArenaUnit | null, range: number): boolean {
    if (t === null || !t.alive || t.dying || t.army === u.army || !this.canHit(u, t)) return false;
    if (!this.sees(u.army, t)) return false;
    return distSq(u.x, u.z, t.x, t.z) <= range * range;
  }

  private phaseCombat(): void {
    this.rebuildGrid();
    const t0 = this.tick;
    for (const u of this.slots) {
      if (u === null || !u.alive || !u.complete) continue;
      if (!u.info.hasSurfaceWeapon && !u.info.hasAirWeapon) continue;
      if (u.holdFire) continue;
      const eng = this.engageRange(u);
      let t = u.target !== 0 ? this.unit(u.target) : null;
      if (!this.validTarget(u, t, eng)) {
        u.target = 0;
        t = null;
      }
      const o = u.orders[0];
      if (o !== undefined && o.kind === OrderKind.Attack) {
        const ft = this.unit(o.target);
        if (ft !== null && ft.army !== u.army && this.canHit(u, ft) && (ft.info.isStructure || this.sees(u.army, ft))) {
          t = ft;
          u.target = ft.handle;
        }
      } else if ((t0 + u.slot) % TARGET_STAGGER === 0) {
        const n = this.nearestEnemy(u, eng);
        if (n !== null) {
          t = n;
          u.target = n.handle;
        }
      }
      if (t === null) continue;
      const d2 = distSq(u.x, u.z, t.x, t.z);
      const r = u.bp.rangeMax;
      const rMin = u.bp.rangeMin;
      if (d2 > r * r || d2 < rMin * rMin) continue;
      const dmg = (t.info.isAir ? u.bp.dpsAir : u.bp.dpsSurface) * DT;
      t.dmgTick += dmg;
      t.dmgTickAttacker = u.handle;
      if (u.bp.splash > 0 && !t.info.isAir) this.splash(u, t, dmg);
    }
  }

  private nearestEnemy(u: ArenaUnit, range: number): ArenaUnit | null {
    let best: ArenaUnit | null = null;
    let bestD = range * range;
    const army = u.army;
    const bit = 1 << army;
    const visit = (s: number): void => {
      const v = this.slots[s]!;
      if (!v.alive || v.dying || (v.seenMask & bit) === 0 || !this.canHit(u, v)) return;
      const d = distSq(u.x, u.z, v.x, v.z);
      if (d < bestD || (d === bestD && (best === null || v.slot < best.slot))) {
        best = v;
        bestD = d;
      }
    };
    for (const a of this.armies) {
      if (a !== army) this.grid.query(this.layerOf[a]!, u.x, u.z, range, visit);
    }
    return best;
  }

  /** Simplified splash: the same per-tick damage to up to SPLASH_MAX_EXTRA nearest other mobile ground enemies within the splash radius. */
  private splash(u: ArenaUnit, t: ArenaUnit, dmg: number): void {
    const r = u.bp.splash;
    const hits: ArenaUnit[] = [];
    const ds: number[] = [];
    const visit = (s: number): void => {
      const v = this.slots[s]!;
      if (v === t || !v.alive || v.info.isStructure || v.info.isAir) return;
      const d = distSq(t.x, t.z, v.x, v.z);
      if (d > r * r) return;
      hits.push(v);
      ds.push(d);
    };
    for (const a of this.armies) {
      if (a !== u.army) this.grid.query(this.layerOf[a]!, t.x, t.z, r, visit);
    }
    const order = hits.map((_, i) => i);
    order.sort((a, b) => ds[a]! - ds[b]! || hits[a]!.slot - hits[b]!.slot);
    for (let k = 0; k < order.length && k < SPLASH_MAX_EXTRA; k++) {
      const v = hits[order[k]!]!;
      v.dmgTick += dmg;
      v.dmgTickAttacker = u.handle;
    }
  }

  private phaseDeaths(): void {
    const t = this.tick;
    for (const u of this.slots) {
      if (u === null || !u.alive) continue;
      if (u.dmgTick > 0) {
        const amount = u.dmgTick;
        const attacker = this.unit(u.dmgTickAttacker);
        u.dmgTick = 0;
        u.hp -= amount;
        u.lastDamagedTick = t;
        u.dmgPending += amount;
        u.dmgPendingAttacker = attacker !== null ? attacker.handle : 0;
        const aArmy = attacker !== null ? attacker.army : -1;
        const c = this.counters[u.army]!;
        if (c.firstDamageTick < 0) c.firstDamageTick = t + 1;
        if (aArmy >= 0) {
          const ca = this.counters[aArmy]!;
          if (ca.firstDamageTick < 0) ca.firstDamageTick = t + 1;
        }
        for (const o of this.observers) o.onDamage?.(this, u, aArmy, amount, t + 1);
        if (u.hp <= 0) u.dying = true;
      }
      if (u.dmgPending > 0 && t - u.dmgEventTick >= DAMAGE_EVENT_MIN_TICKS) this.flushDamage(u);
    }
    let again = true;
    while (again) {
      again = false;
      for (const u of this.slots) {
        if (u === null || !u.alive || !u.dying) continue;
        this.killUnit(u);
        again = true;
      }
    }
    this.checkOver();
  }

  private flushDamage(u: ArenaUnit): void {
    const a = this.unit(u.dmgPendingAttacker);
    const visible = a !== null && this.sees(u.army, a);
    this.pushEvent(u.army, {
      kind: 'ownDamaged',
      tick: this.tick,
      unit: u.handle,
      attacker: visible ? a.handle : 0,
      attackerBp: visible ? a.bp.index : -1,
      amount: u.dmgPending,
    });
    u.dmgPending = 0;
    u.dmgEventTick = this.tick;
  }

  /** Removes a unit (events, ghosts, stall exemption, defeat); the slot is freed in cleanup. */
  private killUnit(u: ArenaUnit): void {
    u.alive = false;
    u.dying = false;
    const t = this.tick;
    this.counters[u.army]!.unitsLost++;
    this.pushEvent(u.army, { kind: 'ownDestroyed', tick: t, unit: u.handle, bp: u.bp.index });
    for (const a of this.armies) {
      if (a === u.army) continue;
      const seen = (u.seenMask & (1 << a)) !== 0;
      if (seen) this.pushEvent(a, { kind: 'enemyDestroyed', tick: t, id: u.handle, army: u.army, bp: u.bp.index });
      if (u.info.isStructure) {
        const g = this.ghosts[a]!.get(u.handle);
        if (g !== undefined) {
          if (seen) this.ghosts[a]!.delete(u.handle);
          else g.stale = true;
        }
      }
    }
    if (u.info.isEnergyInfra && u.complete) this.eco.exemptEnergyStallUntil(u.army, this.eco.tick + STALL_EXEMPT_TICKS);
    if (u.info.isEnergyStorage || u.info.isKranzGen) this.updateKranz();
    for (const o of this.observers) o.onDestroyed?.(this, u, t + 1);
    if (u.info.isCommander && !this.defeated[u.army]) this.defeat(u.army);
  }

  private defeat(army: number): void {
    this.defeated[army] = true;
    this.defeatTick[army] = this.tick + 1;
    for (const v of this.slots) if (v !== null && v.alive && v.army === army) v.dying = true;
  }

  private checkOver(): void {
    if (this.over) return;
    let alive = 0;
    let last = -1;
    for (const a of this.armies) {
      if (!this.defeated[a]) {
        alive++;
        last = a;
      }
    }
    if (this.armies.length > 1 ? alive <= 1 : alive === 0) {
      this.over = true;
      this.winner = alive === 1 ? last : -1;
      this.endReason = 'commanderKilled';
    }
  }

  /** Marks the match as ended by the tick limit (draw unless already decided). */
  endByTickLimit(): void {
    if (this.over) return;
    this.over = true;
    this.winner = -1;
    this.endReason = 'maxTicks';
  }

  // =================================================================================================
  // 7 Vision
  // =================================================================================================

  private updateVision(): void {
    this.rebuildGrid();
    const mv = this.maxVision;
    mv.fill(0);
    for (const u of this.slots) {
      if (u === null || !u.alive) continue;
      if (u.info.vision > mv[u.army]!) mv[u.army] = u.info.vision;
    }
    const t = this.tick;
    for (const v of this.slots) {
      if (v === null || !v.alive) continue;
      let mask = 0;
      for (const a of this.armies) {
        if (a === v.army || this.defeated[a]) continue;
        if (this.pointSeenBy(a, v.x, v.z)) mask |= 1 << a;
      }
      const fresh = mask & ~v.seenMask;
      v.seenMask = mask;
      if (mask === 0) continue;
      for (const a of this.armies) {
        const bit = 1 << a;
        if ((mask & bit) === 0) continue;
        if ((fresh & bit) !== 0) this.pushEvent(a, { kind: 'enemySighted', tick: t, id: v.handle, army: v.army, bp: v.bp.index });
        if (v.info.isStructure) {
          const gm = this.ghosts[a]!;
          const g = gm.get(v.handle);
          if (g === undefined) gm.set(v.handle, { handle: v.handle, army: v.army, bp: v.bp.index, x: v.x, z: v.z, lastSeen: t, stale: false });
          else {
            g.bp = v.bp.index;
            g.lastSeen = t;
          }
        }
      }
    }
    // stale ghosts disappear once their place is seen again
    for (const a of this.armies) {
      const gm = this.ghosts[a]!;
      let drop: number[] | null = null;
      for (const g of gm.values()) {
        const live = this.unit(g.handle);
        if ((g.stale || live === null) && this.pointSeenBy(a, g.x, g.z)) (drop ??= []).push(g.handle);
      }
      if (drop !== null) for (const h of drop) gm.delete(h);
    }
    this.lastVisionTick = t;
  }

  /** True if any live unit of `army` has (x, z) within its vision radius. */
  pointSeenBy(army: number, x: number, z: number): boolean {
    const r = this.maxVision[army]!;
    if (r <= 0) return false;
    let hit = false;
    this.grid.query(this.layerOf[army]!, x, z, r, (s) => {
      const u = this.slots[s]!;
      if (!u.alive) return false;
      const vr = u.info.vision;
      if (distSq(u.x, u.z, x, z) <= vr * vr) {
        hit = true;
        return true;
      }
      return false;
    });
    return hit;
  }

  // =================================================================================================
  // 8 Metrics + cleanup
  // =================================================================================================

  /** True if an engineer counts as idle this tick (ai.md §5.3/§7.1, orderless streak aside). */
  private busyAssistIdle(u: ArenaUnit): boolean {
    const o = u.orders[0];
    if (o === undefined || (o.kind !== OrderKind.Assist && o.kind !== OrderKind.Guard)) return false;
    const t = this.unit(o.target);
    return t === null || this.workOf(t) === null;
  }

  private phaseMetrics(): void {
    for (const u of this.slots) {
      if (u === null || !u.alive || !u.info.isEngineer) continue;
      const c = this.counters[u.army]!;
      c.engineerAliveTicks++;
      if (u.orders.length === 0) {
        u.idleStreak++;
        if (u.idleStreak === IDLE_GRACE_TICKS) c.engineerIdleTicks += IDLE_GRACE_TICKS;
        else if (u.idleStreak > IDLE_GRACE_TICKS) c.engineerIdleTicks++;
      } else {
        u.idleStreak = 0;
        if (this.busyAssistIdle(u)) c.engineerIdleTicks++;
      }
    }
  }

  private cleanup(): void {
    const hw = this.slots.length;
    for (let s = 0; s < hw; s++) {
      const u = this.slots[s];
      if (u === null || u === undefined || u.alive) continue;
      this.slots[s] = null;
      this.handles.freeSlot(s);
    }
  }

  // =================================================================================================
  // cheat / scenario API (logged, never reachable through commands)
  // =================================================================================================

  private logCheat(kind: CheatKind, args: (number | string | boolean)[]): void {
    this.cheatLog.push({ tick: this.tick, kind, args });
  }

  /** Spawns a unit (structures optionally as an unfinished site); returns its handle. */
  spawn(army: number, bpId: string, x: number, z: number, opts: { complete?: boolean } = {}): number {
    if (!this.isActive(army)) throw new RangeError(`arena.spawn: army ${army} is not active`);
    const bp = this.bpIndex(bpId);
    const complete = opts.complete ?? true;
    this.logCheat('spawn', [army, bpId, x, z, complete]);
    const u = this.addUnit(army, bp, x, z, complete);
    u.spot = this.spotAt(u.info, x, z);
    return u.handle;
  }

  /** Destroys a unit immediately (events as in combat). */
  kill(handle: number): void {
    const u = this.unit(handle);
    if (u === null) throw new Error(`arena.kill: no unit ${handle}`);
    this.logCheat('kill', [handle]);
    u.dying = true;
    let again = true;
    while (again) {
      again = false;
      for (const v of this.slots) {
        if (v === null || !v.alive || !v.dying) continue;
        this.killUnit(v);
        again = true;
      }
    }
    this.checkOver();
    this.cleanup();
  }

  /** Sets the stored resources of an army (clamped to capacity at the next economy phase). */
  setStorage(army: number, mass: number, energy: number): void {
    if (!this.isActive(army)) throw new RangeError(`arena.setStorage: army ${army} is not active`);
    this.logCheat('setStorage', [army, mass, energy]);
    this.eco.setStored(army, mass, energy);
  }

  /** Sets the HP fraction of a unit (0 < frac ≤ 1). */
  setHp(handle: number, frac: number): void {
    const u = this.unit(handle);
    if (u === null) throw new Error(`arena.setHp: no unit ${handle}`);
    if (!(frac > 0 && frac <= 1)) throw new RangeError('arena.setHp: frac must be in (0, 1]');
    this.logCheat('setHp', [handle, frac]);
    u.hp = frac * u.info.maxHp;
  }

  /** Test consumer (replaces `test:stall_consumer`, AI-ECO-01): permanent demand per second at ratio 1. */
  addDemand(army: number, massPerSec: number, energyPerSec: number): number {
    if (!this.isActive(army)) throw new RangeError(`arena.addDemand: army ${army} is not active`);
    const id = this.nextFlowId++;
    this.logCheat('addDemand', [army, massPerSec, energyPerSec]);
    this.demands.push({ id, army, mass: massPerSec, energy: energyPerSec });
    return id;
  }

  removeDemand(id: number): void {
    this.logCheat('removeDemand', [id]);
    this.demands = this.demands.filter((d) => d.id !== id);
  }

  /** Extra income per second (e.g. +30 M/s for AI-ECO-02). */
  addIncome(army: number, massPerSec: number, energyPerSec: number): number {
    if (!this.isActive(army)) throw new RangeError(`arena.addIncome: army ${army} is not active`);
    const id = this.nextFlowId++;
    this.logCheat('addIncome', [army, massPerSec, energyPerSec]);
    this.incomes.push({ id, army, mass: massPerSec, energy: energyPerSec });
    return id;
  }

  removeIncome(id: number): void {
    this.logCheat('removeIncome', [id]);
    this.incomes = this.incomes.filter((d) => d.id !== id);
  }

  /**
   * Walls (AI-ENG-02): marks every 2-WU cell overlapping the rectangle [x0, x1] × [z0, z1] (WU) as
   * blocked for placement and land paths. The AI's AiStatic does not change (it learns via rejection).
   */
  blockCells(x0: number, z0: number, x1: number, z1: number): void {
    this.logCheat('blockCells', [x0, z0, x1, z1]);
    const g = this.baseStatic.passCellWu;
    const d = this.baseStatic.passDim;
    const cells: number[] = [];
    const cx0 = Math.max(0, Math.floor(Math.min(x0, x1) / g));
    const cz0 = Math.max(0, Math.floor(Math.min(z0, z1) / g));
    const cx1 = Math.min(d - 1, Math.ceil(Math.max(x0, x1) / g) - 1);
    const cz1 = Math.min(d - 1, Math.ceil(Math.max(z0, z1) / g) - 1);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        this.blocked[cz * d + cx] = 1;
        cells.push(cz * d + cx);
      }
    }
    this.paths.block(cells);
  }

  /**
   * Scenario cheat (tai-p5, additive): the unit never fires while `on` (AI-DEF-03: a Funke walks
   * through a mex cluster without shooting). Part of the state dump.
   */
  holdFire(handle: number, on: boolean): void {
    const u = this.unit(handle);
    if (u === null) throw new Error(`arena.holdFire: no unit ${handle}`);
    this.logCheat('holdFire', [handle, on]);
    u.holdFire = on;
    if (on) u.target = 0;
  }

  /** Re-applies a logged cheat (replay). */
  applyCheat(r: CheatRecord): void {
    const a = r.args;
    switch (r.kind) {
      case 'spawn':
        this.spawn(a[0] as number, a[1] as string, a[2] as number, a[3] as number, { complete: a[4] as boolean });
        return;
      case 'kill':
        this.kill(a[0] as number);
        return;
      case 'setStorage':
        this.setStorage(a[0] as number, a[1] as number, a[2] as number);
        return;
      case 'setHp':
        this.setHp(a[0] as number, a[1] as number);
        return;
      case 'addDemand':
        this.addDemand(a[0] as number, a[1] as number, a[2] as number);
        return;
      case 'removeDemand':
        this.removeDemand(a[0] as number);
        return;
      case 'addIncome':
        this.addIncome(a[0] as number, a[1] as number, a[2] as number);
        return;
      case 'removeIncome':
        this.removeIncome(a[0] as number);
        return;
      case 'blockCells':
        this.blockCells(a[0] as number, a[1] as number, a[2] as number, a[3] as number);
        return;
      case 'holdFire':
        this.holdFire(a[0] as number, a[1] as boolean);
        return;
    }
  }

  /** Snapshot of cheat flows (for the state dump). */
  cheatFlows(): { demands: readonly CheatFlow[]; incomes: readonly CheatFlow[]; blocked: Uint8Array } {
    return { demands: this.demands, incomes: this.incomes, blocked: this.blocked };
  }
}

/** Footprints of a and b touch or overlap (edge contact counts as adjacency). */
function touches(a: ArenaUnit, b: ArenaUnit): boolean {
  const aw = a.bp.footprint[0];
  const ad = a.bp.footprint[1];
  const bw = b.bp.footprint[0];
  const bd = b.bp.footprint[1];
  const eps = 1e-6;
  const dx = Math.abs(a.x - b.x) * 2;
  const dz = Math.abs(a.z - b.z) * 2;
  const sx = aw + bw;
  const sz = ad + bd;
  // edge contact: one axis exactly touching, the other overlapping with positive length
  const touchX = Math.abs(dx - sx) <= eps && dz < sz - eps;
  const touchZ = Math.abs(dz - sz) <= eps && dx < sx - eps;
  return touchX || touchZ;
}

export type { AiBlueprint };
