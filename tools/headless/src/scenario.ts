/**
 * L2 scenario runner (PLAN §3.12): `ScenarioBuilder {map, seed, spawns, commands@tick, asserts}`.
 *
 * A scenario is a pure description; `runScenario` executes it on `sim.createWorld/step` with
 * protocol command batches and returns the hash trail (rule hash every HASH_INTERVAL_TICKS ticks)
 * plus the final rule and full hash. Commands are produced by callbacks that only read the world
 * (handles in slot order, unit info) and a per-run scratch object, so every engine issues exactly
 * the same command bytes — the runner is part of the determinism contract of the L2/L3 checks.
 *
 * Maps (MS2): a scenario runs on the flat test plane (`map({ sizeWu })`), on a `.rtsmap` file
 * (`map({ path })`, repo-relative; the bytes are handed in through `RunOptions.maps` because the
 * runner also runs in browser workers without a file system) or on an in-memory RtsMap
 * (`map({ rtsMap })`).
 */
import { asArmyId, asTick, fx, MAX_ARMIES, type Handle } from '@faf/fixed';
import type { SimBpTable } from '@faf/blueprints/simbin';
import { createTestPlaneMap, mapSimData, mapSimHash, readRtsMap, type RtsMap } from '@faf/formats';
import { CmdFlags, CommandBatchEncoder, encodeCheatKill, encodeCheatSpawn, encodeMove, Op } from '@faf/protocol';
import {
  armyUnitCount,
  createWorld,
  DEFAULT_MAP_SIZE_WU,
  fullHash,
  HASH_INTERVAL_TICKS,
  lastHash,
  lastAckSeq,
  lastHashTick,
  ruleHash,
  setAlliance,
  SIM_BUILD,
  step,
  unitCount,
  unitHandles,
  unitInfo,
  type UnitInfo,
  type World,
} from '@faf/sim';

/** Unit blueprint reference: string id (`core:cube`) or sim id. */
export type BpRef = string | number;

/** Cheat spawn of `count` units (positions in WU). */
export interface SpawnSpec {
  readonly army: number;
  readonly count: number;
  readonly x: number;
  readonly z: number;
  readonly spread: number;
  /** Default `core:cube`. */
  readonly bp?: BpRef;
  /** Issuing army (default: `army`). Cheats ignore ownership. */
  readonly by?: number;
}

/** One command of a scenario. Coordinates are WU (converted with `fx`). */
export type ScenarioCommand =
  | { readonly kind: 'move'; readonly army: number; readonly units: readonly Handle[]; readonly x: number; readonly z: number; readonly queue?: boolean }
  | { readonly kind: 'stop'; readonly army: number; readonly units: readonly Handle[] }
  | { readonly kind: 'kill'; readonly army: number; readonly units: readonly Handle[] }
  | ({ readonly kind: 'spawn' } & SpawnSpec);

/** Read access for command and assert callbacks. */
export interface ScenarioContext {
  readonly world: World;
  /** Commands: the tick they will be applied in. Asserts: the tick that just completed. */
  readonly tick: number;
  /** Per-run scratch storage (fresh object per run) for values carried between callbacks. */
  readonly vars: Record<string, unknown>;
  /** Live unit handles in slot order (all armies or one). */
  handles(army?: number): Handle[];
  /** Details of a live unit or null. */
  info(h: Handle): UnitInfo | null;
  /** Live units of an army. */
  count(army: number): number;
  /** Total live units. */
  total(): number;
  /** Sim id of a blueprint. */
  bp(ref: BpRef): number;
  /** Last acknowledged command seq of an army (−1 = none). */
  ackSeq(army: number): number;
  /** Seq the runner assigned to the most recent command of `army` (−1 = none yet). */
  lastSeq(army: number): number;
}

export type CommandFn = (ctx: ScenarioContext) => ScenarioCommand | readonly ScenarioCommand[] | null;
/** Returns true (pass) or a failure description. */
export type AssertFn = (ctx: ScenarioContext) => true | string;

export interface TimedCommands {
  readonly tick: number;
  readonly fn: CommandFn;
}

export interface TimedAssert {
  readonly tick: number;
  readonly name: string;
  readonly fn: AssertFn;
}

/** Check evaluated after every `every`-th tick; reported once (first failure or pass). */
export interface Invariant {
  readonly every: number;
  readonly name: string;
  readonly fn: AssertFn;
}

/** Map of a scenario: flat test plane, a .rtsmap file (repo-relative path) or an in-memory map. */
export type ScenarioMap =
  | { readonly kind: 'testplane'; readonly sizeWu: number }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inline'; readonly map: RtsMap };

/** Argument of `ScenarioBuilder.map`. */
export type MapSpec = { readonly sizeWu: number } | { readonly path: string } | { readonly rtsMap: RtsMap };

/** Stable label of a scenario map (golden field `map`). */
export function mapLabel(m: ScenarioMap): string {
  return m.kind === 'testplane' ? `testplane:${m.sizeWu}` : m.kind === 'file' ? m.path : `inline:${m.map.meta.name}`;
}

export interface Scenario {
  readonly name: string;
  readonly seed: number;
  readonly map: ScenarioMap;
  /** Map edge length in WU (test plane size, or the map's; file maps: known after loading). */
  readonly mapSizeWu: number;
  readonly armyCount: number;
  readonly ticks: number;
  /** Alliances set at match setup (pairs of armies). */
  readonly alliances: readonly (readonly [number, number])[];
  /** Cheat spawns issued in tick 1. */
  readonly spawns: readonly SpawnSpec[];
  /** Command callbacks, ascending by tick (stable for equal ticks). */
  readonly commands: readonly TimedCommands[];
  readonly asserts: readonly TimedAssert[];
  readonly invariants: readonly Invariant[];
}

/** Fluent builder of a Scenario. */
export class ScenarioBuilder {
  private readonly name: string;
  private seedValue = 1;
  private mapRef: ScenarioMap = { kind: 'testplane', sizeWu: DEFAULT_MAP_SIZE_WU };
  private armyCountValue = 2;
  private tickCount = 2000;
  private readonly alliancePairs: (readonly [number, number])[] = [];
  private readonly spawnList: SpawnSpec[] = [];
  private readonly commandList: TimedCommands[] = [];
  private readonly assertList: TimedAssert[] = [];
  private readonly invariantList: Invariant[] = [];

  constructor(name: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new RangeError(`invalid scenario name '${name}'`);
    this.name = name;
  }

  /** Test plane of `sizeWu`, a .rtsmap file (`path`, repo-relative) or an RtsMap. */
  map(spec: MapSpec): this {
    if ('sizeWu' in spec) this.mapRef = { kind: 'testplane', sizeWu: spec.sizeWu };
    else if ('path' in spec) {
      if (!/^[A-Za-z0-9_./-]+\.rtsmap$/.test(spec.path) || spec.path.includes('..')) throw new RangeError(`invalid map path '${spec.path}'`);
      this.mapRef = { kind: 'file', path: spec.path };
    } else this.mapRef = { kind: 'inline', map: spec.rtsMap };
    return this;
  }

  seed(seed: number): this {
    this.seedValue = seed >>> 0;
    return this;
  }

  armies(n: number): this {
    if (!Number.isInteger(n) || n < 1 || n > MAX_ARMIES) throw new RangeError(`armies: ${n}`);
    this.armyCountValue = n;
    return this;
  }

  ally(a: number, b: number): this {
    this.alliancePairs.push([a, b]);
    return this;
  }

  ticks(n: number): this {
    if (!Number.isInteger(n) || n < 1) throw new RangeError(`ticks: ${n}`);
    this.tickCount = n;
    return this;
  }

  /** Cheat spawn in tick 1 (applied before any command of tick 1). */
  spawn(spec: SpawnSpec): this {
    this.spawnList.push(spec);
    return this;
  }

  /** Commands produced at `tick` (applied in the step of that tick). */
  at(tick: number, fn: CommandFn): this {
    if (!Number.isInteger(tick) || tick < 1) throw new RangeError(`at: tick ${tick}`);
    this.commandList.push({ tick, fn });
    return this;
  }

  /** Check evaluated right after the step of `tick`. */
  assert(tick: number, name: string, fn: AssertFn): this {
    if (!Number.isInteger(tick) || tick < 1) throw new RangeError(`assert: tick ${tick}`);
    this.assertList.push({ tick, name, fn });
    return this;
  }

  /** Check evaluated after every `every`-th tick (1 = every tick); reported once per run. */
  invariant(every: number, name: string, fn: AssertFn): this {
    if (!Number.isInteger(every) || every < 1) throw new RangeError(`invariant: every ${every}`);
    this.invariantList.push({ every, name, fn });
    return this;
  }

  build(): Scenario {
    const byTick = <T extends { readonly tick: number }>(list: readonly T[]): T[] =>
      list
        .map((v, i) => ({ v, i }))
        .sort((a, b) => a.v.tick - b.v.tick || a.i - b.i)
        .map((e) => e.v);
    for (const c of this.commandList) if (c.tick > this.tickCount) throw new RangeError(`command at ${c.tick} > ticks`);
    for (const a of this.assertList) if (a.tick > this.tickCount) throw new RangeError(`assert at ${a.tick} > ticks`);
    const m = this.mapRef;
    return {
      name: this.name,
      seed: this.seedValue,
      map: m,
      mapSizeWu: m.kind === 'testplane' ? m.sizeWu : m.kind === 'inline' ? m.map.meta.sizeWu : 0,
      armyCount: this.armyCountValue,
      ticks: this.tickCount,
      alliances: this.alliancePairs.slice(),
      spawns: this.spawnList.slice(),
      commands: byTick(this.commandList),
      asserts: byTick(this.assertList),
      invariants: this.invariantList.slice(),
    };
  }
}

export interface AssertResult {
  readonly tick: number;
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/** Outcome of one scenario run. Hashes are u32 numbers. */
export interface ScenarioResult {
  readonly scenario: string;
  /** SIM_BUILD of the sim that produced the result. */
  readonly simBuild: string;
  readonly seed: number;
  readonly ticks: number;
  readonly simHash: number;
  readonly layoutHash: number;
  /** Map label (`testplane:512` or the .rtsmap path) and its mapSimHash (simId input). */
  readonly map: string;
  readonly mapSimHash: number;
  readonly hashIntervalTicks: number;
  /** Rule hashes at ticks HASH_INTERVAL_TICKS, 2·HASH_INTERVAL_TICKS, … */
  readonly trail: readonly number[];
  readonly finalRuleHash: number;
  readonly finalFullHash: number;
  readonly finalUnitCount: number;
  readonly commandCount: number;
  readonly asserts: readonly AssertResult[];
}

export interface RunOptions {
  /** Checked-in sim.bin bytes or a decoded table. */
  readonly simBin?: Uint8Array;
  readonly bpTable?: SimBpTable;
  /** Map files by scenario path (`.rtsmap` bytes or parsed), for scenarios with `map({ path })`. */
  readonly maps?: Readonly<Record<string, Uint8Array | RtsMap>>;
}

/**
 * Resolves the map of a scenario (the test plane is the generated flat map of its size, formats
 * createTestPlaneMap). Throws if a file map was not provided.
 */
export function resolveScenarioMap(m: ScenarioMap, maps: RunOptions['maps']): RtsMap {
  if (m.kind === 'testplane') return createTestPlaneMap(m.sizeWu);
  if (m.kind === 'inline') return m.map;
  const v = maps?.[m.path];
  if (v === undefined) throw new Error(`scenario map '${m.path}' not provided (RunOptions.maps)`);
  return v instanceof Uint8Array ? readRtsMap(v) : v;
}

/** Executes a scenario in a fresh world. */
export function runScenario(sc: Scenario, opts: RunOptions): ScenarioResult {
  const map = resolveScenarioMap(sc.map, opts.maps);
  const w = createWorld({
    ...(opts.simBin !== undefined ? { simBin: opts.simBin } : {}),
    ...(opts.bpTable !== undefined ? { bpTable: opts.bpTable } : {}),
    seed: sc.seed,
    armyCount: sc.armyCount,
    map: mapSimData(map),
  });
  for (const [a, b] of sc.alliances) setAlliance(w, a, b, true);

  const seqs = new Int32Array(MAX_ARMIES).fill(-1);
  const vars: Record<string, unknown> = {};
  const ctx: ScenarioContext & { tick: number } = {
    world: w,
    tick: 0,
    vars,
    handles: (army = -1) => unitHandles(w, army),
    info: (h) => unitInfo(w, h),
    count: (army) => armyUnitCount(w, army),
    total: () => unitCount(w),
    bp: (ref) => resolveBp(w, ref),
    ackSeq: (army) => lastAckSeq(w, army),
    lastSeq: (army) => seqs[army]!,
  };

  const enc = new CommandBatchEncoder(1 << 14);
  const trail: number[] = [];
  const asserts: AssertResult[] = [];
  const invariantFail: (AssertResult | null)[] = sc.invariants.map(() => null);
  let ci = 0;
  let ai = 0;
  let commandCount = 0;

  const addCmd = (tick: number, c: ScenarioCommand): void => {
    const by = c.kind === 'spawn' ? (c.by ?? c.army) : c.army;
    const seq = (seqs[by]! + 1) & 0xffff;
    seqs[by] = seq;
    commandCount++;
    const t = asTick(tick);
    const army = asArmyId(by);
    switch (c.kind) {
      case 'move':
        enc.add({ tick: t, army, seq, op: Op.Move, flags: c.queue === true ? CmdFlags.Queue : 0, units: c.units, payload: encodeMove({ x: fx(c.x), y: fx(0), z: fx(c.z) }) });
        return;
      case 'stop':
        enc.add({ tick: t, army, seq, op: Op.Stop, flags: 0, units: c.units, payload: new Uint8Array(0) });
        return;
      case 'kill':
        enc.add({ tick: t, army, seq, op: Op.Cheat, flags: 0, units: c.units, payload: encodeCheatKill() });
        return;
      case 'spawn':
        enc.add({
          tick: t,
          army,
          seq,
          op: Op.Cheat,
          flags: 0,
          units: [],
          payload: encodeCheatSpawn({ bp: resolveBp(w, c.bp ?? 'core:cube'), army: c.army, count: c.count, x: fx(c.x), z: fx(c.z), spread: fx(c.spread) }),
        });
        return;
    }
  };

  for (let tick = 1; tick <= sc.ticks; tick++) {
    enc.reset();
    ctx.tick = tick;
    if (tick === 1) for (const s of sc.spawns) addCmd(tick, { kind: 'spawn', ...s });
    while (ci < sc.commands.length && sc.commands[ci]!.tick === tick) {
      const out = sc.commands[ci]!.fn(ctx);
      if (out !== null) {
        if (isCommandList(out)) for (const c of out) addCmd(tick, c);
        else addCmd(tick, out);
      }
      ci++;
    }
    step(w, enc.count > 0 ? enc.view() : null);
    if (lastHashTick(w) === tick) trail.push(lastHash(w));
    while (ai < sc.asserts.length && sc.asserts[ai]!.tick === tick) {
      const a = sc.asserts[ai]!;
      let r: true | string;
      try {
        r = a.fn(ctx);
      } catch (e) {
        r = `threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      asserts.push(r === true ? { tick, name: a.name, ok: true } : { tick, name: a.name, ok: false, detail: r });
      ai++;
    }
    for (let k = 0; k < sc.invariants.length; k++) {
      const inv = sc.invariants[k]!;
      if (tick % inv.every !== 0 || invariantFail[k] !== null) continue;
      let r: true | string;
      try {
        r = inv.fn(ctx);
      } catch (e) {
        r = `threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      if (r !== true) invariantFail[k] = { tick, name: inv.name, ok: false, detail: r };
    }
  }
  for (let k = 0; k < sc.invariants.length; k++) {
    const inv = sc.invariants[k]!;
    const lastTick = sc.ticks - (sc.ticks % inv.every);
    asserts.push(invariantFail[k] ?? { tick: lastTick, name: `${inv.name} (every ${inv.every} ticks)`, ok: true });
  }

  return {
    scenario: sc.name,
    simBuild: SIM_BUILD,
    seed: sc.seed,
    ticks: sc.ticks,
    simHash: w.bp.simHash >>> 0,
    layoutHash: w.layoutHash >>> 0,
    map: mapLabel(sc.map),
    mapSimHash: mapSimHash(map) >>> 0,
    hashIntervalTicks: HASH_INTERVAL_TICKS,
    trail,
    finalRuleHash: ruleHash(w) >>> 0,
    finalFullHash: fullHash(w) >>> 0,
    finalUnitCount: unitCount(w),
    commandCount,
    asserts,
  };
}

function isCommandList(v: ScenarioCommand | readonly ScenarioCommand[]): v is readonly ScenarioCommand[] {
  return Array.isArray(v);
}

function resolveBp(w: World, ref: BpRef): number {
  if (typeof ref === 'number') return ref;
  const i = w.bp.indexOf(ref);
  if (i < 0) throw new RangeError(`unknown blueprint '${ref}'`);
  return i;
}

/** Failed asserts of a result (empty = all passed). */
export function failedAsserts(r: ScenarioResult): AssertResult[] {
  return r.asserts.filter((a) => !a.ok);
}
