/**
 * Sim-valid long game (TRACK-REPLAY p3): a recorded 1v1 command log of real sim commands on a
 * real map — the measurement object for replay size, headless playback speed and seek (p5 bench).
 * Unlike the synthetic size model (synthetic.ts) every command here targets live handles of the
 * running world, so the log replays through the sim host with identical hashes.
 *
 * Model (MS1/MS2 know no factories, economy or combat yet — stand-ins are cheats and documented as
 * such; all randomness from rng32 of @faf/fixed, no clocks → deterministic):
 *
 * - Two armies on hollow-ridge (default) or setons, map start positions 0 and 1, HeadlessSim with
 *   the command-log recorder (the host pipeline, log format v2).
 * - Start army: tick 1, one Cheat spawn of START_UNITS_PER_ARMY cubes per army at its start.
 * - Reinforcements (production stand-in): every REINFORCE_EVERY_TICKS a Cheat spawn of up to
 *   REINFORCE_UNITS at the start position while the army is below ARMY_UNIT_CAP.
 * - Losses (combat stand-in): from LOSS_START_TICK every LOSS_EVERY_TICKS, with LOSS_CHANCE_PERMILLE,
 *   one Cheat kill of 1–5 random units of the army → typical load ≈ 300–400 units in total.
 * - Player orders (the APM): per army exactly round(apm·minutes) envelopes, spread over the seconds
 *   by the activity curve of the size model (idle 0.35× / normal 1× / burst 2.4× phases of 3–24 s)
 *   and uniformly over the ticks of each second. Ops: Move (900 ‰) and Stop (100 ‰) — the ops MS2
 *   simulates. 30 % of the moves start a shift queue of 2–6 waypoints (CmdFlags.Queue, same
 *   selection; the sim treats Queue like replace until G7/MS3) that consume the next scheduled
 *   order slots of that army.
 * - Selections: 55 % one of six control groups (8–40 units, re-formed every 2 min or when less than
 *   half of it is alive; dead members drop out), else fresh: 1 / 2–5 / 6–20 / 21–60 units
 *   (250/300/300/150 ‰), 75 % a blob (adjacent slots — units spawned together move together),
 *   25 % scattered; handles in ascending slot order (box select).
 * - Targets: 75 % around the front line (moves between the bases on a 4-minute triangle wave,
 *   ±40 WU), 25 % back to the own base (±30 WU); queue waypoints ±24 WU from the previous one;
 *   clamped to the map (8 WU margin). Positions carry full Fx precision.
 *
 * Cheat envelopes are not counted as APM (they stand in for the sim's own production/combat);
 * they taint the log (Cheat MARKs), which is expected for a measurement object.
 *
 * Environment-neutral (Node and browser worker): no node: imports.
 */

import { asArmyId, asFx, asTick, FX_ONE, rng32, rngRange, type Handle } from '@faf/fixed';
import { CmdFlags, CommandBatchEncoder, encodeCheatKill, encodeCheatSpawn, encodeMove, Op } from '@faf/protocol';
import { isUnitAlive, unitCount, unitHandles, type World } from '@faf/sim';
import { HeadlessSim, parseCommandLog } from '@faf/sim-host';
import { HOLLOW_RIDGE_PATH, SETONS_PATH } from '../scenarios.ts';

export const LONG_GAME_TICKS_PER_SECOND = 10;
export const LONG_GAME_TICKS_PER_MINUTE = 600;
export const LONG_GAME_DEFAULT_SEED = 0x10ec9a3e;
export const START_UNITS_PER_ARMY = 140;
export const REINFORCE_EVERY_TICKS = 150;
export const REINFORCE_UNITS = 12;
export const ARMY_UNIT_CAP = 190;
export const LOSS_START_TICK = 900;
export const LOSS_EVERY_TICKS = 50;
export const LOSS_CHANCE_PERMILLE = 600;
const CONTROL_GROUPS = 6;
const GROUP_REFORM_TICKS = 2 * LONG_GAME_TICKS_PER_MINUTE;
const FRONT_PERIOD_TICKS = 4 * LONG_GAME_TICKS_PER_MINUTE;
const MAP_MARGIN_WU = 8;
/** Blueprint of all units (MS2 has one: the cube). */
const UNIT_BP = 'core:cube';

export type LongGameMap = 'hollow-ridge' | 'setons';

const MAP_PATHS: Readonly<Record<LongGameMap, string>> = {
  'hollow-ridge': HOLLOW_RIDGE_PATH,
  setons: SETONS_PATH,
};

export interface LongGameOptions {
  /** Game length in minutes (integer 1..600). Default 30. */
  readonly minutes?: number;
  readonly seed?: number;
  /** Default hollow-ridge. */
  readonly map?: LongGameMap;
  /** .rtsmap bytes by repo-relative path (scripts/lib loadMaps) or by map name. */
  readonly maps: Readonly<Record<string, Uint8Array>>;
  /** content/generated/sim.bin bytes. */
  readonly simBin: Uint8Array;
  /** Target APM of army 0 and 1 (player orders per minute). Default [120, 120]. */
  readonly apm?: readonly [number, number];
}

export interface LongGameStats {
  readonly map: LongGameMap;
  readonly minutes: number;
  readonly seed: number;
  readonly ticks: number;
  /** All envelopes (orders + cheats). */
  readonly envelopes: number;
  /** Player orders per army and their APM (orders / minutes). */
  readonly ordersPerArmy: readonly number[];
  readonly apmPerArmy: readonly number[];
  /** Cheat envelopes (spawns and kills; production/combat stand-ins, not APM). */
  readonly cheatEnvelopes: number;
  /** Envelopes by op ('Move', 'Stop', 'Cheat:spawn', 'Cheat:kill'). */
  readonly opHistogram: Readonly<Record<string, number>>;
  /** Player orders by selection size ('0', '1', '2-5', '6-20', '21-60'). */
  readonly unitsPerCommandHistogram: Readonly<Record<string, number>>;
  /** Orders with CmdFlags.Queue (shift-queue follow-ups). */
  readonly queuedEnvelopes: number;
  /** Units requested by spawn cheats / named by kill cheats. */
  readonly unitsSpawnRequested: number;
  readonly unitsKillRequested: number;
  /** Live units (all armies), sampled every second: min after the first minute, max, mean, end. */
  readonly liveUnitsMin: number;
  readonly liveUnitsMax: number;
  readonly liveUnitsMean: number;
  readonly liveUnitsEnd: number;
  /** Ticks with a CMDS entry, log size, HASH / MARK entries. */
  readonly commandTicks: number;
  readonly logBytes: number;
  readonly hashEntries: number;
  readonly markEntries: number;
  readonly finalRuleHash: number;
  readonly finalFullHash: number;
}

export interface LongGame {
  /** Closed FAFL v2 command log (END at the last tick). */
  readonly log: Uint8Array;
  readonly stats: LongGameStats;
}

/** Counter-based random stream over rng32: (seed, stream id, counter, salt). */
class Stream {
  private n = 0;
  constructor(
    private readonly seed: number,
    private readonly id: number,
    private readonly salt: number,
  ) {}

  u32(): number {
    return rng32(this.seed, this.id, this.n++, this.salt);
  }

  /** Uniform integer in [0, n). */
  below(n: number): number {
    return rngRange(this.u32(), n);
  }

  /** Uniform integer in [lo, hi]. */
  between(lo: number, hi: number): number {
    return lo + this.below(hi - lo + 1);
  }

  chance(permille: number): boolean {
    return this.below(1000) < permille;
  }

  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.below(total);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i]!;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
}

const S_ACTIVITY = 0x21;
const S_SCHEDULE = 0x22;
const S_ORDER = 0x23;
const S_CHEAT = 0x24;

/** Player orders per second of one army (activity curve scaled to exactly `total`). */
function perSecondCounts(seed: number, army: number, seconds: number, total: number): Uint16Array {
  const rs = new Stream(seed, army, S_ACTIVITY);
  const weight = new Uint32Array(seconds);
  let s = 0;
  while (s < seconds) {
    const late = s >= 20 * 60;
    const state = rs.weighted(late ? [300, 380, 320] : [220, 560, 220]);
    const w = state === 0 ? 350 : state === 1 ? 1000 : 2400;
    const len = rs.between(3, 24);
    for (let i = 0; i < len && s < seconds; i++, s++) weight[s] = w;
  }
  let sum = 0;
  for (let i = 0; i < seconds; i++) sum += weight[i]!;
  const out = new Uint16Array(seconds);
  let cum = 0;
  let placed = 0;
  for (let i = 0; i < seconds; i++) {
    cum += weight[i]!;
    const upTo = Math.floor((total * cum) / sum);
    out[i] = upTo - placed;
    placed = upTo;
  }
  return out;
}

function sizeBucket(n: number): string {
  if (n <= 1) return String(n);
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '21-60';
}

interface ArmyState {
  readonly army: number;
  readonly baseX: number;
  readonly baseZ: number;
  seq: number;
  orders: number;
  readonly groups: Handle[][];
  readonly groupFormed: number[];
  queueLeft: number;
  queueUnits: Handle[];
  queueX: number;
  queueZ: number;
}

function resolveMapBytes(name: LongGameMap, maps: LongGameOptions['maps']): Uint8Array {
  const path = MAP_PATHS[name];
  const bytes = maps[path] ?? maps[name];
  if (bytes === undefined) throw new Error(`recordLongGame: map '${name}' not provided (maps['${path}'])`);
  return bytes;
}

/**
 * Plays and records the long game (see module doc). Deterministic: equal options →
 * byte-identical log.
 */
export function recordLongGame(opts: LongGameOptions): LongGame {
  const minutes = opts.minutes ?? 30;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new RangeError(`recordLongGame: minutes must be an integer in 1..600, got ${minutes}`);
  const seed = (opts.seed ?? LONG_GAME_DEFAULT_SEED) >>> 0;
  const apm = opts.apm ?? [120, 120];
  for (const a of apm) if (!Number.isFinite(a) || a < 1 || a > 2000) throw new RangeError(`recordLongGame: apm must be in 1..2000, got ${a}`);
  const mapName = opts.map ?? 'hollow-ridge';
  const ticks = minutes * LONG_GAME_TICKS_PER_MINUTE;
  const seconds = minutes * 60;

  const sim = new HeadlessSim({
    simBin: opts.simBin,
    seed,
    armyCount: 2,
    playerArmy: 0,
    map: resolveMapBytes(mapName, opts.maps),
    buildHash: 'long-game',
    keyframes: false,
    trail: false,
    recorder: { initialCapacity: 1 << 20 },
  });
  const w: World = sim.world;
  const bp = w.bp.indexOf(UNIT_BP);
  if (bp < 0) throw new Error(`recordLongGame: blueprint ${UNIT_BP} missing`);
  const meta = sim.map.meta;
  if (meta.starts.length < 2) throw new Error(`recordLongGame: map '${mapName}' has fewer than 2 start positions`);
  const lo = MAP_MARGIN_WU * FX_ONE;
  const hi = (meta.sizeWu - MAP_MARGIN_WU) * FX_ONE;
  const clamp = (v: number): number => (v < lo ? lo : v > hi ? hi : v);

  // Order schedule: player orders per tick and army.
  const schedule: Uint8Array[] = [];
  for (let a = 0; a < 2; a++) {
    const total = Math.round(apm[a]! * minutes);
    const perSec = perSecondCounts(seed, a, seconds, total);
    const perTick = new Uint8Array(ticks + 1);
    const rs = new Stream(seed, a, S_SCHEDULE);
    for (let s = 0; s < seconds; s++) {
      for (let k = 0; k < perSec[s]!; k++) perTick[s * LONG_GAME_TICKS_PER_SECOND + 1 + rs.below(LONG_GAME_TICKS_PER_SECOND)]!++;
    }
    schedule.push(perTick);
  }

  const armies: ArmyState[] = [];
  for (let a = 0; a < 2; a++) {
    const st = meta.starts[a]!;
    armies.push({
      army: a,
      baseX: st.x,
      baseZ: st.z,
      seq: 0,
      orders: 0,
      groups: Array.from({ length: CONTROL_GROUPS }, () => [] as Handle[]),
      groupFormed: new Array<number>(CONTROL_GROUPS).fill(-GROUP_REFORM_TICKS),
      queueLeft: 0,
      queueUnits: [],
      queueX: 0,
      queueZ: 0,
    });
  }
  const rOrder = [new Stream(seed, 0, S_ORDER), new Stream(seed, 1, S_ORDER)];
  const rCheat = new Stream(seed, 0, S_CHEAT);
  const enc = new CommandBatchEncoder(1 << 12);
  const ops: Record<string, number> = {};
  const buckets: Record<string, number> = { '0': 0, '1': 0, '2-5': 0, '6-20': 0, '21-60': 0 };
  let envelopes = 0;
  let cheats = 0;
  let queued = 0;
  let spawnReq = 0;
  let killReq = 0;
  let liveMin = Number.MAX_SAFE_INTEGER;
  let liveMax = 0;
  let liveSum = 0;
  let liveSamples = 0;

  // Live handles per army, fetched lazily once per tick (ascending slot order).
  let handlesTick = -1;
  const handleCache: Handle[][] = [[], []];
  const handlesOf = (army: number, tick: number): Handle[] => {
    if (handlesTick !== tick) {
      handlesTick = tick;
      handleCache[0] = unitHandles(w, 0);
      handleCache[1] = unitHandles(w, 1);
    }
    return handleCache[army]!;
  };

  const emit = (tick: number, st: ArmyState, op: Op, flags: number, units: readonly Handle[], payload: Uint8Array, name: string): void => {
    enc.add({ tick: asTick(tick), army: asArmyId(st.army), seq: st.seq, op, flags, units, payload });
    st.seq = (st.seq + 1) & 0xffff;
    envelopes++;
    ops[name] = (ops[name] ?? 0) + 1;
  };

  const spawn = (tick: number, st: ArmyState, count: number): void => {
    emit(tick, st, Op.Cheat, 0, [], encodeCheatSpawn({ bp, army: st.army, count, x: asFx(st.baseX), z: asFx(st.baseZ), spread: asFx(24 * FX_ONE) }), 'Cheat:spawn');
    cheats++;
    spawnReq += count;
  };

  /** Blob (adjacent slots) or scattered selection of `n` of `hs`, ascending slot order. */
  const pick = (r: Stream, hs: readonly Handle[], n: number, blob: boolean): Handle[] => {
    if (n >= hs.length) return hs.slice();
    if (blob) {
      const start = r.below(hs.length - n + 1);
      return hs.slice(start, start + n);
    }
    const idx = new Uint8Array(hs.length);
    let chosen = 0;
    while (chosen < n) {
      const i = r.below(hs.length);
      if (idx[i] === 0) {
        idx[i] = 1;
        chosen++;
      }
    }
    const out: Handle[] = [];
    for (let i = 0; i < hs.length; i++) if (idx[i] === 1) out.push(hs[i]!);
    return out;
  };

  const selection = (tick: number, st: ArmyState, r: Stream): Handle[] => {
    const hs = handlesOf(st.army, tick);
    if (hs.length === 0) return [];
    if (r.chance(550)) {
      const g = r.below(CONTROL_GROUPS);
      let members = st.groups[g]!.filter((h) => isUnitAlive(w, h));
      if (tick - st.groupFormed[g]! >= GROUP_REFORM_TICKS || members.length * 2 < st.groups[g]!.length || members.length === 0) {
        members = pick(r, hs, r.between(8, 40), true);
        st.groupFormed[g] = tick;
      }
      st.groups[g] = members;
      return members.slice();
    }
    const b = r.weighted([250, 300, 300, 150]);
    const n = b === 0 ? 1 : b === 1 ? r.between(2, 5) : b === 2 ? r.between(6, 20) : r.between(21, 60);
    return pick(r, hs, n, r.chance(750));
  };

  const order = (tick: number, st: ArmyState): void => {
    const r = rOrder[st.army]!;
    st.orders++;
    if (st.queueLeft > 0) {
      const units = st.queueUnits.filter((h) => isUnitAlive(w, h));
      st.queueX = clamp(st.queueX + r.between(-24 * FX_ONE, 24 * FX_ONE));
      st.queueZ = clamp(st.queueZ + r.between(-24 * FX_ONE, 24 * FX_ONE));
      st.queueLeft--;
      st.queueUnits = units;
      emit(tick, st, Op.Move, CmdFlags.Queue, units, encodeMove({ x: asFx(st.queueX), y: asFx(0), z: asFx(st.queueZ) }), 'Move');
      buckets[sizeBucket(units.length)]!++;
      queued++;
      return;
    }
    const units = selection(tick, st, r);
    buckets[sizeBucket(units.length)]!++;
    if (r.chance(100)) {
      emit(tick, st, Op.Stop, 0, units, new Uint8Array(0), 'Stop');
      return;
    }
    let x: number;
    let z: number;
    if (r.chance(750)) {
      const other = armies[1 - st.army]!;
      const tri = Math.abs((tick % FRONT_PERIOD_TICKS) - (FRONT_PERIOD_TICKS >> 1));
      const f = 300 + Math.floor((tri * 400) / (FRONT_PERIOD_TICKS >> 1));
      x = st.baseX + Math.floor(((other.baseX - st.baseX) * f) / 1000) + r.between(-40 * FX_ONE, 40 * FX_ONE);
      z = st.baseZ + Math.floor(((other.baseZ - st.baseZ) * f) / 1000) + r.between(-40 * FX_ONE, 40 * FX_ONE);
    } else {
      x = st.baseX + r.between(-30 * FX_ONE, 30 * FX_ONE);
      z = st.baseZ + r.between(-30 * FX_ONE, 30 * FX_ONE);
    }
    x = clamp(x);
    z = clamp(z);
    emit(tick, st, Op.Move, 0, units, encodeMove({ x: asFx(x), y: asFx(0), z: asFx(z) }), 'Move');
    if (units.length > 0 && r.chance(300)) {
      st.queueLeft = r.between(1, 5);
      st.queueUnits = units;
      st.queueX = x;
      st.queueZ = z;
    }
  };

  for (let tick = 1; tick <= ticks; tick++) {
    enc.reset();
    for (const st of armies) {
      if (tick === 1) {
        spawn(tick, st, START_UNITS_PER_ARMY);
      } else if (tick % REINFORCE_EVERY_TICKS === 0) {
        const live = handlesOf(st.army, tick).length;
        const n = Math.min(REINFORCE_UNITS, ARMY_UNIT_CAP - live);
        if (n > 0) spawn(tick, st, n);
      }
      if (tick >= LOSS_START_TICK && tick % LOSS_EVERY_TICKS === 0 && rCheat.chance(LOSS_CHANCE_PERMILLE)) {
        const hs = handlesOf(st.army, tick);
        if (hs.length > 0) {
          const victims = pick(rCheat, hs, rCheat.between(1, 5), false);
          emit(tick, st, Op.Cheat, 0, victims, encodeCheatKill(), 'Cheat:kill');
          cheats++;
          killReq += victims.length;
        }
      }
      for (let k = schedule[st.army]![tick]!; k > 0; k--) order(tick, st);
    }
    if (enc.count > 0) sim.submit(enc.view());
    if (sim.step(1) !== 1) throw new Error(`recordLongGame: tick ${tick} did not run`);
    if (tick % LONG_GAME_TICKS_PER_SECOND === 0) {
      const live = unitCount(w);
      if (tick >= LONG_GAME_TICKS_PER_MINUTE && live < liveMin) liveMin = live;
      if (live > liveMax) liveMax = live;
      liveSum += live;
      liveSamples++;
    }
  }

  const log = sim.exportLog();
  const parsed = parseCommandLog(log);
  const ordersPerArmy = armies.map((a) => a.orders);
  return {
    log,
    stats: {
      map: mapName,
      minutes,
      seed,
      ticks,
      envelopes,
      ordersPerArmy,
      apmPerArmy: ordersPerArmy.map((n) => n / minutes),
      cheatEnvelopes: cheats,
      opHistogram: ops,
      unitsPerCommandHistogram: buckets,
      queuedEnvelopes: queued,
      unitsSpawnRequested: spawnReq,
      unitsKillRequested: killReq,
      liveUnitsMin: liveMin === Number.MAX_SAFE_INTEGER ? unitCount(w) : liveMin,
      liveUnitsMax: liveMax,
      liveUnitsMean: liveSamples > 0 ? Math.round(liveSum / liveSamples) : unitCount(w),
      liveUnitsEnd: unitCount(w),
      commandTicks: parsed.commands.length,
      logBytes: log.length,
      hashEntries: parsed.hashes.length,
      markEntries: parsed.marks.length,
      finalRuleHash: sim.ruleHash(),
      finalFullHash: sim.fullHash(),
    },
  };
}
