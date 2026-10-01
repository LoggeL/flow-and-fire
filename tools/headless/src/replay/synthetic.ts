/**
 * Synthetic 30-min 1v1 command stream — the SIZE MODEL behind the replay size gate
 * (PLAN §3.11: 30 min 1v1 → CMDS ≤ 100 KB, whole file ≤ 250 KB).
 *
 * The stream is not sim-valid (handles do not exist in any world); it models what a real FA-style
 * 1v1 sends through the command channel. Implemented operations use their protocol layouts,
 * while future operations retain the documented size model. The
 * model is documented here and in docs/status/track-replay/p0.md and must NOT be weakened to make
 * the gate pass — the gate exists to find out whether the CMDS encoding is good enough.
 *
 * Model (all randomness from rng32 of @faf/fixed; no clocks, no Math.random → deterministic):
 *
 * - Time: 10 ticks/s, 600 ticks/min, commands on ticks 1..minutes·600.
 * - APM (per army): exactly round(apm·minutes) envelopes. They are spread over the seconds of the
 *   game by an activity curve: a per-army state machine switches between idle (0.35×), normal (1×)
 *   and burst (2.4×) phases of 3–24 s; the late game has more bursts and idles (fights, then
 *   macro). The per-second counts follow the cumulative activity (largest-remainder style), so the
 *   game-wide APM equals the target while seconds range from 0 to ~8 envelopes.
 * - Phases: opening (< 4 min: ACU/engineer build orders, factory queues, rally, reclaim),
 *   midgame (< 20 min: Move/AttackMove/Attack/Assist/Patrol/Repair/Reclaim, more building),
 *   late game (bursts, larger selections, formation moves, overcharge, ground attacks).
 * - Units: one shared unit table (like the sim's): a new unit takes the most recently freed slot
 *   (LIFO) or the next fresh index; a death bumps the slot generation. Handles are real
 *   index:gen packs (makeHandle), so indices and generations grow over the game. Per army:
 *   ACU, engineers (→ 20), factories (→ 10), structures (→ 80), mobile units (→ 260) with combat
 *   losses from minute 5 on → 300–400 live units per army in the late game.
 * - Selections: builder ops use 1 engineer/ACU (70 %) or 2–5 builders; factory ops 1–3
 *   factories; army ops 1 / 2–5 / 6–20 / 21–60 units (late game skews larger). 55 % of army
 *   orders reuse one of six control groups (re-formed every ~2 min, dead units drop out). Fresh
 *   selections are blobs (75 %: k of a window of k..1.5k units adjacent in production order —
 *   units built together move together) or scattered (25 %: uniform over the army). Selections
 *   list handles in ascending slot order (box select scans the frame records).
 * - Shift queues: Move/AttackMove/Patrol 30 %, Build 45 %, Reclaim 40 %, Repair/Assist 10 % start
 *   a queue of 2–6 orders with the same selection; follow-ups carry CmdFlags.Queue, come
 *   2–9 ticks apart and continue near the previous waypoint.
 * - seq: per army, starting at 0, +1 per envelope (u16 wrap).
 * - Payloads: Move and Build use real encoders (@faf/protocol, 12 B each). The other operations
 *   use the documented byte layouts in PAYLOAD_MODEL below. Click positions carry full Fx
 *   precision (terrain ray hits); build sites snap to
 *   half-WU grid cells with a yaw of 0/90/180/270°.
 * - Hashes: rule hash every 10 ticks, sub-hashes (one per rule region) every 100 ticks — all
 *   pseudo-random u32 (incompressible, like real hashes).
 * - Marks: initial speed, two pause/resume pairs (same tick: the sim does not advance while
 *   paused) and one speed change.
 *
 * Runs in Node and in the browser worker bundle: no node: imports, no sim-host.
 */

import { makeHandle, rng32, rngRange } from '@faf/fixed';
import { BUILD_PAYLOAD_BYTES, CmdFlags, CommandBatchEncoder, MOVE_PAYLOAD_BYTES, Op, opName, writeBuild, writeMove } from '@faf/protocol';

export const SYNTHETIC_TICKS_PER_SECOND = 10;
export const SYNTHETIC_TICKS_PER_MINUTE = 600;
export const SYNTHETIC_HASH_INTERVAL = 10;
export const SYNTHETIC_SUB_HASH_INTERVAL = 100;
export const SYNTHETIC_MAP_SIZE_WU = 512;
/** Largest selection the model issues (PLAN task: selections of 1–60 units). */
export const SYNTHETIC_MAX_SELECTION = 60;

/**
 * Rule regions of the current World (dynamic, non-derived, registration order) — the sub-hash
 * columns. Pinned by tools/headless/test/replay-synthetic.test.ts against createWorld; when the
 * sim schema gains regions (MS3+), update this list (sizes grow with it, which is intended).
 */
export const SYNTHETIC_RULE_REGION_NAMES: readonly string[] = ['world', 'armies', 'alliance', 'units', 'movers', 'orders', 'formations', 'combat.weapons', 'wrecks', 'projectiles', 'factory.queue', 'intel.explored', 'paths.owner', 'nav.foot', 'nav.paths', 'nav.blocks', 'nav.fifo', 'nav.ctr'];

/** Mark kinds used by the model (values of sim-host MarkKind / formats ReplayMarkKind). */
export const SyntheticMarkKind = {
  Pause: 1,
  Resume: 2,
  /** value = speed in ‰ */
  Speed: 3,
} as const;

/**
 * Payload layouts of the size model (bytes, little-endian). `pos` = i32 x | i32 y | i32 z (Fx raw),
 * `target` = u32 handle. Move and Build use the authoritative protocol encoders.
 */
export const PAYLOAD_MODEL: Readonly<Record<string, string>> = {
  Move: 'pos (12 B, real encoder)',
  AttackMove: 'pos (12 B)',
  Patrol: 'pos (12 B)',
  AttackGround: 'pos (12 B)',
  SetRally: 'pos (12 B)',
  FormationMove: 'pos + u16 yaw (14 B)',
  Attack: 'target (4 B)',
  Guard: 'target (4 B)',
  Assist: 'target (4 B)',
  Repair: 'target (4 B)',
  Reclaim: 'target prop/wreck handle (4 B)',
  Overcharge: 'target (4 B)',
  Build: 'u16 bp + u16 yaw + i32 x + i32 z (12 B, real encoder)',
  FactoryQueue: 'u16 bp + u16 count (4 B)',
  Upgrade: 'u16 bp (2 B)',
  FactoryRepeat: 'u8 on (1 B)',
  FireState: 'u8 state (1 B)',
  TogglePause: 'u8 on (1 B)',
  SetPriority: 'u8 priority (1 B)',
  ToggleAbility: 'u8 ability + u8 on (2 B)',
  SelfDestruct: 'empty',
  Stop: 'empty',
};

export interface SyntheticOptions {
  /** Game length in minutes (integer ≥ 1). Default 30. */
  readonly minutes?: number;
  /** Seed of all randomness. Default 0x5eed1e55. */
  readonly seed?: number;
  /** Target APM (envelopes per minute) of army 0 and army 1. Default [120, 120]. */
  readonly apm?: readonly [number, number];
  /** Sub-hash region names. Default SYNTHETIC_RULE_REGION_NAMES. */
  readonly regionNames?: readonly string[];
}

export interface SyntheticTickCommands {
  readonly tick: number;
  /** protocol batch; every envelope carries `tick`. */
  readonly batch: Uint8Array;
}

export interface SyntheticMark {
  readonly tick: number;
  readonly kind: number;
  readonly value: number;
}

export interface SyntheticStats {
  readonly ticks: number;
  readonly envelopes: number;
  /** Envelopes per army. */
  readonly envelopesPerArmy: readonly number[];
  /** Measured APM per army (envelopes / minutes). */
  readonly apmPerArmy: readonly number[];
  /** Sum of all batch byte lengths (the uncompressed protocol stream). */
  readonly rawCommandBytes: number;
  /** Envelopes per op name. */
  readonly opHistogram: Readonly<Record<string, number>>;
  /** Envelopes per selection-size bucket ('0', '1', '2-5', '6-20', '21-60'). */
  readonly unitsPerCommandHistogram: Readonly<Record<string, number>>;
  /** Envelopes with CmdFlags.Queue (shift-queue follow-ups). */
  readonly queuedEnvelopes: number;
  /** Live units per army at the end, total units ever created, highest slot index + 1. */
  readonly liveUnitsAtEnd: readonly number[];
  readonly unitsCreated: number;
  readonly slotHighWater: number;
  /** Highest handle generation reached. */
  readonly maxGeneration: number;
}

export interface SyntheticGame {
  readonly minutes: number;
  readonly seed: number;
  readonly apm: readonly [number, number];
  readonly mapSizeWu: number;
  /** Ascending ticks, one batch per tick that has commands. */
  readonly commands: readonly SyntheticTickCommands[];
  readonly hashes: { readonly interval: number; readonly firstTick: number; readonly values: Uint32Array };
  readonly subHashes: {
    readonly interval: number;
    readonly firstTick: number;
    readonly regionNames: readonly string[];
    /** Index k·regionNames.length + r (k-th sub-hash tick, region r). */
    readonly values: Uint32Array;
  };
  readonly marks: readonly SyntheticMark[];
  readonly stats: SyntheticStats;
}

// ---- deterministic random streams ----------------------------------------------------------

// Salts of the independent streams (rng32 salt argument).
const S_ACTIVITY = 0x11;
const S_SCHEDULE = 0x12;
const S_ORDER = 0x13;
const S_ROSTER = 0x14;
const S_HASH = 0x15;
const S_SUBHASH = 0x16;
const S_TERRAIN = 0x17;

/** Counter-based stream over rng32: (seed, stream, counter, salt). */
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

  /** True with probability permille/1000. */
  chance(permille: number): boolean {
    return this.below(1000) < permille;
  }

  /** Index picked by integer weights. */
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

// ---- phases and op mixes -------------------------------------------------------------------

const enum Phase {
  Opening = 0,
  Mid = 1,
  Late = 2,
}

const OPENING_END_TICKS = 4 * SYNTHETIC_TICKS_PER_MINUTE;
const MID_END_TICKS = 20 * SYNTHETIC_TICKS_PER_MINUTE;
const COMBAT_START_TICKS = 5 * SYNTHETIC_TICKS_PER_MINUTE;

function phaseAt(tick: number): Phase {
  if (tick < OPENING_END_TICKS) return Phase.Opening;
  return tick < MID_END_TICKS ? Phase.Mid : Phase.Late;
}

/** Ops of the model with their per-phase weights (‰, rows sum to 1000). */
const OP_TABLE: readonly { readonly op: Op; readonly w: readonly [number, number, number] }[] = [
  { op: Op.Move, w: [200, 270, 230] },
  { op: Op.AttackMove, w: [30, 130, 150] },
  { op: Op.Attack, w: [0, 60, 90] },
  { op: Op.AttackGround, w: [0, 10, 20] },
  { op: Op.Patrol, w: [10, 30, 30] },
  { op: Op.Guard, w: [0, 20, 20] },
  { op: Op.Assist, w: [80, 70, 80] },
  { op: Op.Build, w: [300, 120, 90] },
  { op: Op.Repair, w: [20, 30, 30] },
  { op: Op.Reclaim, w: [100, 60, 40] },
  { op: Op.Upgrade, w: [0, 10, 10] },
  { op: Op.FactoryQueue, w: [180, 90, 80] },
  { op: Op.FactoryRepeat, w: [20, 10, 5] },
  { op: Op.SetRally, w: [40, 20, 15] },
  { op: Op.FireState, w: [0, 10, 10] },
  { op: Op.TogglePause, w: [0, 10, 10] },
  { op: Op.SetPriority, w: [0, 5, 10] },
  { op: Op.ToggleAbility, w: [0, 5, 10] },
  { op: Op.Overcharge, w: [0, 10, 15] },
  { op: Op.SelfDestruct, w: [0, 0, 5] },
  { op: Op.Stop, w: [0, 20, 20] },
  { op: Op.FormationMove, w: [0, 10, 30] },
];

const OP_WEIGHTS: readonly (readonly number[])[] = [0, 1, 2].map((p) => OP_TABLE.map((e) => e.w[p]!));

/** Ops that order the mobile army (fall back to builders while there is none). */
function isArmyOp(op: number): boolean {
  return (
    op === Op.Move ||
    op === Op.AttackMove ||
    op === Op.Attack ||
    op === Op.AttackGround ||
    op === Op.Patrol ||
    op === Op.Guard ||
    op === Op.FireState ||
    op === Op.ToggleAbility ||
    op === Op.SelfDestruct ||
    op === Op.Stop ||
    op === Op.FormationMove
  );
}

function isFactoryOp(op: number): boolean {
  return op === Op.FactoryQueue || op === Op.FactoryRepeat || op === Op.SetRally;
}

/** Start probability (‰) and max length of a shift queue per op. */
function queueChance(op: number): number {
  if (op === Op.Move || op === Op.AttackMove || op === Op.Patrol) return 300;
  if (op === Op.Build) return 450;
  if (op === Op.Reclaim) return 400;
  if (op === Op.Repair || op === Op.Assist) return 100;
  return 0;
}

// ---- unit table and armies -----------------------------------------------------------------

const MAX_GEN = 0xfff;

/** Shared unit table: LIFO slot reuse, generation bump on death (like @faf/heap tables). */
class UnitTable {
  readonly gen: number[] = [];
  private readonly free: number[] = [];
  created = 0;
  maxGen = 0;

  alloc(): number {
    this.created++;
    const idx = this.free.length > 0 ? this.free.pop()! : this.gen.push(0) - 1;
    return makeHandle(idx, this.gen[idx]!);
  }

  kill(h: number): void {
    const idx = h & 0xfffff;
    const g = (this.gen[idx]! + 1) & MAX_GEN;
    this.gen[idx] = g;
    if (g > this.maxGen) this.maxGen = g;
    this.free.push(idx);
  }

  get highWater(): number {
    return this.gen.length;
  }
}

interface ArmyState {
  readonly army: number;
  readonly baseX: number;
  readonly baseZ: number;
  readonly acu: number;
  readonly engineers: number[];
  readonly factories: number[];
  readonly structures: number[];
  readonly mobile: number[];
  /** Six control groups (handle lists, ascending slot order); empty = not formed yet. */
  readonly groups: number[][];
  readonly groupFormedAt: number[];
  seq: number;
  // Shift-queue state.
  queueLeft: number;
  queueOp: number;
  queueUnits: number[];
  queueX: number;
  queueZ: number;
  queueNext: number;
  envelopes: number;
}

const WU = 4096;
const BUILDER_BP_FIRST = 1; // structure blueprints 1..18 (mex, pgen, factories, defenses …)
const BUILDER_BP_COUNT = 18;
const UNIT_BP_FIRST = 32; // unit blueprints 32..55 (tanks, bots, arty, engineers, AA …)
const UNIT_BP_COUNT = 24;
const PROP_SLOTS = 1500; // map props/wrecks that can be reclaimed (separate table, gen 0)

function slotOrder(a: number, b: number): number {
  return (a & 0xfffff) - (b & 0xfffff);
}

function removeHandle(list: number[], h: number): void {
  const i = list.indexOf(h);
  if (i >= 0) list.splice(i, 1);
}

/** Target sizes per army (engineers, factories, structures, mobile) at second `sec`. */
function targetSizes(sec: number): readonly [number, number, number, number] {
  const engineers = Math.min(2 + Math.floor(sec / 20), 20);
  const factories = Math.min(1 + Math.floor(sec / 90), 10);
  const structures = Math.min(Math.floor(sec / 15), 80);
  const mobile = sec < 90 ? 0 : Math.min(Math.floor((sec - 90) / 5), 260);
  return [engineers, factories, structures, mobile];
}

// ---- generator ------------------------------------------------------------------------------

const DEFAULT_SEED = 0x5eed1e55;

function checkOptions(o: SyntheticOptions): { minutes: number; seed: number; apm: readonly [number, number] } {
  const minutes = o.minutes ?? 30;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new RangeError(`synthetic: minutes must be an integer in 1..600, got ${minutes}`);
  const seed = (o.seed ?? DEFAULT_SEED) >>> 0;
  const apm = o.apm ?? [120, 120];
  for (const a of apm) {
    if (!Number.isFinite(a) || a < 1 || a > 2000) throw new RangeError(`synthetic: apm must be in 1..2000, got ${a}`);
  }
  return { minutes, seed, apm: [apm[0], apm[1]] };
}

/**
 * Envelopes per second of one army: activity curve (idle/normal/burst state machine) scaled so the
 * game total is exactly `total`.
 */
function perSecondCounts(seed: number, army: number, seconds: number, total: number): Uint16Array {
  const rs = new Stream(seed, army, S_ACTIVITY);
  const weight = new Uint32Array(seconds);
  let s = 0;
  while (s < seconds) {
    const late = s * SYNTHETIC_TICKS_PER_SECOND >= MID_END_TICKS;
    // idle / normal / burst probabilities (‰); the late game alternates fights and macro more.
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
    const upTo = Math.floor((total * cum) / sum); // exact: total·cum < 2^53
    out[i] = upTo - placed;
    placed = upTo;
  }
  return out;
}

/** Deterministic terrain height (Fx) at a click position: 16-WU cells plus interpolation noise. */
function terrainY(seed: number, x: number, z: number): number {
  const cell = rng32(seed, x >> 16, z >> 16, S_TERRAIN);
  return (cell % (40 * WU)) + (rng32(seed, x, z, S_TERRAIN) & 0xfff);
}

function clampWu(v: number): number {
  const lo = 4 * WU;
  const hi = (SYNTHETIC_MAP_SIZE_WU - 4) * WU;
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Generates the synthetic 1v1 command stream (see module doc for the model). Deterministic:
 * equal options → byte-identical output.
 */
export function generateSynthetic1v1(opts: SyntheticOptions = {}): SyntheticGame {
  const { minutes, seed, apm } = checkOptions(opts);
  const regionNames = (opts.regionNames ?? SYNTHETIC_RULE_REGION_NAMES).slice();
  const ticks = minutes * SYNTHETIC_TICKS_PER_MINUTE;
  const seconds = minutes * 60;

  // Per army: exact envelope count, spread over seconds, then over the ticks of each second.
  const schedule: Uint8Array[] = [];
  for (let a = 0; a < 2; a++) {
    const total = Math.round(apm[a]! * minutes);
    const perSec = perSecondCounts(seed, a, seconds, total);
    const perTick = new Uint8Array(ticks + 1);
    const rs = new Stream(seed, a, S_SCHEDULE);
    for (let s = 0; s < seconds; s++) {
      for (let k = 0; k < perSec[s]!; k++) perTick[s * SYNTHETIC_TICKS_PER_SECOND + 1 + rs.below(SYNTHETIC_TICKS_PER_SECOND)]!++;
    }
    schedule.push(perTick);
  }

  const table = new UnitTable();
  const armies: ArmyState[] = [];
  for (let a = 0; a < 2; a++) {
    const baseX = (a === 0 ? 96 : SYNTHETIC_MAP_SIZE_WU - 96) * WU;
    const baseZ = (a === 0 ? SYNTHETIC_MAP_SIZE_WU - 96 : 96) * WU;
    armies.push({
      army: a,
      baseX,
      baseZ,
      acu: table.alloc(),
      engineers: [],
      factories: [],
      structures: [],
      mobile: [],
      groups: [[], [], [], [], [], []],
      groupFormedAt: [0, 0, 0, 0, 0, 0],
      seq: 0,
      queueLeft: 0,
      queueOp: 0,
      queueUnits: [],
      queueX: 0,
      queueZ: 0,
      queueNext: 0,
      envelopes: 0,
    });
  }

  const rRoster = new Stream(seed, 0, S_ROSTER);
  const rOrder = [new Stream(seed, 0, S_ORDER), new Stream(seed, 1, S_ORDER)];

  /** One simulated second of production and losses (runs before the commands of its first tick). */
  const updateRoster = (tick: number): void => {
    const sec = Math.floor(tick / SYNTHETIC_TICKS_PER_SECOND);
    const [eng, fac, str, mob] = targetSizes(sec);
    const late = tick >= MID_END_TICKS;
    for (const st of armies) {
      if (tick >= COMBAT_START_TICKS) {
        // Combat losses: mobile units die in skirmishes (bursty), raids kill engineers/structures.
        const fight = rRoster.chance(late ? 300 : 220);
        const losses = fight ? Math.floor((st.mobile.length * rRoster.between(5, late ? 60 : 40)) / 1000) + rRoster.below(3) : 0;
        for (let i = 0; i < losses && st.mobile.length > 0; i++) {
          const h = st.mobile[rRoster.below(st.mobile.length)]!;
          removeHandle(st.mobile, h);
          table.kill(h);
        }
        if (rRoster.chance(late ? 25 : 12) && st.engineers.length > 0) {
          const h = st.engineers[rRoster.below(st.engineers.length)]!;
          removeHandle(st.engineers, h);
          table.kill(h);
        }
        if (rRoster.chance(late ? 20 : 8) && st.structures.length > 0) {
          const h = st.structures[rRoster.below(st.structures.length)]!;
          removeHandle(st.structures, h);
          table.kill(h);
        }
      }
      // Production towards the target sizes (factories build ~1–3 units per second at most).
      if (st.engineers.length < eng && rRoster.chance(400)) st.engineers.push(table.alloc());
      if (st.factories.length < fac && rRoster.chance(200)) st.factories.push(table.alloc());
      if (st.structures.length < str && rRoster.chance(500)) st.structures.push(table.alloc());
      const want = Math.min(mob - st.mobile.length, 1 + Math.floor(st.factories.length / 3));
      for (let i = 0; i < want; i++) st.mobile.push(table.alloc());
    }
  };

  /** Front line (Fx) at `tick`: moves between the bases with a slow wobble. */
  const frontAt = (tick: number): readonly [number, number] => {
    const a = armies[0]!;
    const b = armies[1]!;
    const wob = (Math.floor(tick / 900) * 137 + (rng32(seed, Math.floor(tick / 900), 0, S_TERRAIN) % 400)) % 400; // 0..399
    const permille = 300 + wob; // 30 %..70 % of the way from base 0 to base 1
    return [a.baseX + Math.floor(((b.baseX - a.baseX) * permille) / 1000), a.baseZ + Math.floor(((b.baseZ - a.baseZ) * permille) / 1000)];
  };

  const pickSubset = (r: Stream, from: readonly number[], k: number): number[] => {
    const n = from.length;
    if (k >= n) return from.slice().sort(slotOrder);
    // Partial Fisher–Yates on an index array.
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    for (let i = 0; i < k; i++) {
      const j = i + r.below(n - i);
      const t = idx[i]!;
      idx[i] = idx[j]!;
      idx[j] = t;
    }
    const out: number[] = [];
    for (let i = 0; i < k; i++) out.push(from[idx[i]!]!);
    return out.sort(slotOrder);
  };

  /**
   * Box selection of a blob: units built around the same time move together, so a box picks k of
   * a window of k..1.5k units that are adjacent in production order (slots are still scattered by
   * LIFO reuse). 25 % of fresh selections are scattered instead (select-all-of-type, map-wide).
   */
  const pickFresh = (r: Stream, from: readonly number[], k: number): number[] => {
    const n = from.length;
    if (k >= n || r.chance(250)) return pickSubset(r, from, k);
    const w = Math.min(n, k + Math.floor((k * r.between(0, 50)) / 100));
    const start = r.below(n - w + 1);
    return pickSubset(r, from.slice(start, start + w), k);
  };

  const armySelectionSize = (r: Stream, phase: Phase): number => {
    const b = r.weighted(phase === Phase.Late ? [150, 200, 300, 350] : [250, 250, 280, 220]);
    if (b === 0) return 1;
    if (b === 1) return r.between(2, 5);
    if (b === 2) return r.between(6, 20);
    return r.between(21, SYNTHETIC_MAX_SELECTION);
  };

  const builderSelection = (r: Stream, st: ArmyState, phase: Phase): number[] => {
    const builders = st.engineers.length > 0 ? st.engineers : [st.acu];
    if (r.chance(phase === Phase.Opening ? 350 : 120)) return [st.acu];
    if (r.chance(700)) return [builders[r.below(builders.length)]!];
    const sel = pickSubset(r, builders, r.between(2, 5));
    if (r.chance(300)) sel.push(st.acu);
    return sel.sort(slotOrder);
  };

  const factorySelection = (r: Stream, st: ArmyState): number[] => {
    if (st.factories.length === 0) return [st.acu];
    return pickSubset(r, st.factories, r.weighted([700, 200, 100]) + 1);
  };

  const armySelection = (r: Stream, st: ArmyState, tick: number, phase: Phase): number[] => {
    if (st.mobile.length === 0) return builderSelection(r, st, phase);
    if (r.chance(550)) {
      // Control groups: low numbers are used most.
      const g = r.weighted([300, 240, 180, 120, 90, 70]);
      const alive = st.groups[g]!.filter((h) => st.mobile.includes(h));
      if (alive.length > 0 && tick - st.groupFormedAt[g]! < 2 * SYNTHETIC_TICKS_PER_MINUTE) {
        st.groups[g] = alive;
        return alive.slice();
      }
      const fresh = pickFresh(r, st.mobile, armySelectionSize(r, phase));
      st.groups[g] = fresh;
      st.groupFormedAt[g] = tick;
      return fresh.slice();
    }
    return pickFresh(r, st.mobile, armySelectionSize(r, phase));
  };

  const payload = new Uint8Array(32);
  const pdv = new DataView(payload.buffer);

  /** Writes a click position near (cx, cz) ± spread WU with full Fx precision; returns [x, z]. */
  const writePos = (r: Stream, off: number, cx: number, cz: number, spreadWu: number, snap: boolean): readonly [number, number] => {
    let x = clampWu(cx + r.between(-spreadWu * WU, spreadWu * WU));
    let z = clampWu(cz + r.between(-spreadWu * WU, spreadWu * WU));
    if (snap) {
      x &= ~0x7ff; // half-WU build grid
      z &= ~0x7ff;
    }
    writeMove(pdv, off, x, terrainY(seed, x, z), z);
    return [x, z];
  };

  const enemyTarget = (r: Stream, st: ArmyState): number => {
    const e = armies[1 - st.army]!;
    if (e.mobile.length > 0 && r.chance(700)) return e.mobile[r.below(e.mobile.length)]!;
    if (e.structures.length > 0) return e.structures[r.below(e.structures.length)]!;
    return e.acu;
  };

  const ownTarget = (r: Stream, st: ArmyState, op: number): number => {
    if (op === Op.Assist && st.factories.length > 0 && r.chance(600)) return st.factories[r.below(st.factories.length)]!;
    if (op === Op.Repair && st.structures.length > 0) return st.structures[r.below(st.structures.length)]!;
    if (op === Op.Guard && st.mobile.length > 0) return st.mobile[r.below(st.mobile.length)]!;
    if (st.engineers.length > 0) return st.engineers[r.below(st.engineers.length)]!;
    return st.acu;
  };

  const enc = new CommandBatchEncoder(1 << 12);
  const commands: SyntheticTickCommands[] = [];
  const opHistogram: Record<string, number> = {};
  const sizeHistogram: Record<string, number> = { '0': 0, '1': 0, '2-5': 0, '6-20': 0, '21-60': 0 };
  let rawBytes = 0;
  let queued = 0;

  /** Emits one envelope of army `st` at `tick` into `enc`. */
  const emit = (st: ArmyState, tick: number): void => {
    const r = rOrder[st.army]!;
    const phase = phaseAt(tick);
    let op: number;
    let units: number[];
    let flags = 0;
    let anchorX: number;
    let anchorZ: number;
    let spread: number;
    const continuing = st.queueLeft > 0 && tick >= st.queueNext;
    if (continuing) {
      op = st.queueOp;
      if (isArmyOp(op) && r.chance(200)) op = [Op.Move, Op.AttackMove, Op.Patrol][r.below(3)]!;
      units = st.queueUnits;
      flags = CmdFlags.Queue;
      anchorX = st.queueX;
      anchorZ = st.queueZ;
      spread = 20;
      st.queueLeft--;
      queued++;
    } else {
      op = OP_TABLE[r.weighted(OP_WEIGHTS[phase]!)]!.op;
      if (isArmyOp(op)) units = armySelection(r, st, tick, phase);
      else if (isFactoryOp(op)) units = factorySelection(r, st);
      else if (op === Op.Upgrade) units = st.structures.length > 0 && r.chance(700) ? [st.structures[r.below(st.structures.length)]!] : factorySelection(r, st);
      else if (op === Op.TogglePause || op === Op.SetPriority) units = factorySelection(r, st);
      else units = builderSelection(r, st, phase);
      if (op === Op.Build || op === Op.Reclaim || op === Op.Repair || op === Op.Assist) {
        // Base building, expansions (mex fields) and reclaim fields around the base.
        anchorX = st.baseX;
        anchorZ = st.baseZ;
        spread = r.chance(600) ? 40 : 140;
      } else if (op === Op.SetRally) {
        anchorX = st.baseX;
        anchorZ = st.baseZ;
        spread = 50;
      } else if (phase === Phase.Opening) {
        anchorX = st.baseX;
        anchorZ = st.baseZ;
        spread = 120;
      } else {
        const f = frontAt(tick);
        anchorX = f[0];
        anchorZ = f[1];
        spread = 90;
      }
      const qc = queueChance(op);
      if (qc > 0 && r.chance(qc)) {
        st.queueLeft = r.between(1, 5);
        st.queueOp = op;
        st.queueUnits = units;
      } else {
        st.queueLeft = 0;
      }
    }

    let plen: number;
    switch (op) {
      case Op.Move:
      case Op.AttackMove:
      case Op.Patrol:
      case Op.AttackGround:
      case Op.SetRally: {
        const [x, z] = writePos(r, 0, anchorX, anchorZ, spread, false);
        st.queueX = x;
        st.queueZ = z;
        plen = MOVE_PAYLOAD_BYTES;
        break;
      }
      case Op.FormationMove: {
        const [x, z] = writePos(r, 0, anchorX, anchorZ, spread, false);
        st.queueX = x;
        st.queueZ = z;
        pdv.setUint16(12, r.below(0x10000), true);
        plen = 14;
        break;
      }
      case Op.Build: {
        const bp = BUILDER_BP_FIRST + r.below(BUILDER_BP_COUNT);
        const [x, z] = writePos(r, 2, anchorX, anchorZ, continuing ? 8 : spread, true);
        st.queueX = x;
        st.queueZ = z;
        writeBuild(pdv, 0, bp, r.below(4) * 0x4000, x, z);
        plen = BUILD_PAYLOAD_BYTES;
        break;
      }
      case Op.Attack:
      case Op.Overcharge:
        pdv.setUint32(0, enemyTarget(r, st), true);
        plen = 4;
        break;
      case Op.Guard:
      case Op.Assist:
      case Op.Repair:
        pdv.setUint32(0, ownTarget(r, st, op), true);
        plen = 4;
        break;
      case Op.Reclaim:
        pdv.setUint32(0, makeHandle(r.below(PROP_SLOTS), 0), true);
        plen = 4;
        break;
      case Op.FactoryQueue:
        pdv.setUint16(0, UNIT_BP_FIRST + r.below(UNIT_BP_COUNT), true);
        pdv.setUint16(2, r.weighted([500, 200, 150, 150]) === 3 ? 5 : r.between(1, 3), true);
        plen = 4;
        break;
      case Op.Upgrade:
        pdv.setUint16(0, BUILDER_BP_FIRST + r.below(BUILDER_BP_COUNT), true);
        plen = 2;
        break;
      case Op.FactoryRepeat:
      case Op.FireState:
      case Op.TogglePause:
      case Op.SetPriority:
        payload[0] = r.below(op === Op.FireState ? 3 : 2);
        plen = 1;
        break;
      case Op.ToggleAbility:
        payload[0] = r.below(4);
        payload[1] = r.below(2);
        plen = 2;
        break;
      default:
        // Stop, SelfDestruct: no payload.
        plen = 0;
    }

    enc.addRaw(tick, st.army, st.seq, op, flags, units, payload, 0, plen);
    st.seq = (st.seq + 1) & 0xffff;
    st.envelopes++;
    if (st.queueLeft > 0) st.queueNext = tick + r.between(2, 9);
    const name = opName(op);
    opHistogram[name] = (opHistogram[name] ?? 0) + 1;
    const n = units.length;
    const bucket = n === 0 ? '0' : n === 1 ? '1' : n <= 5 ? '2-5' : n <= 20 ? '6-20' : '21-60';
    sizeHistogram[bucket]!++;
  };

  for (let tick = 1; tick <= ticks; tick++) {
    if (tick % SYNTHETIC_TICKS_PER_SECOND === 1) updateRoster(tick);
    enc.reset();
    for (let a = 0; a < 2; a++) {
      const st = armies[a]!;
      const n = schedule[a]![tick]!;
      for (let k = 0; k < n; k++) emit(st, tick);
    }
    if (enc.count > 0) {
      const batch = enc.view().slice();
      rawBytes += batch.length;
      commands.push({ tick, batch });
    }
  }

  // Hashes: pseudo-random u32 (incompressible like real hashes).
  const hashCount = Math.floor(ticks / SYNTHETIC_HASH_INTERVAL);
  const hashValues = new Uint32Array(hashCount);
  for (let i = 0; i < hashCount; i++) hashValues[i] = rng32(seed, (i + 1) * SYNTHETIC_HASH_INTERVAL, 0, S_HASH);
  const subCount = Math.floor(ticks / SYNTHETIC_SUB_HASH_INTERVAL);
  const subValues = new Uint32Array(subCount * regionNames.length);
  for (let k = 0; k < subCount; k++) {
    for (let r = 0; r < regionNames.length; r++) {
      subValues[k * regionNames.length + r] = rng32(seed, (k + 1) * SYNTHETIC_SUB_HASH_INTERVAL, r, S_SUBHASH);
    }
  }

  // Marks: initial speed, two pause/resume pairs, one speed change and its reset.
  const marks: SyntheticMark[] = [{ tick: 1, kind: SyntheticMarkKind.Speed, value: 1000 }];
  const at = (permille: number): number => Math.max(1, Math.floor((ticks * permille) / 1000));
  marks.push({ tick: at(370), kind: SyntheticMarkKind.Pause, value: 0 });
  marks.push({ tick: at(370), kind: SyntheticMarkKind.Resume, value: 0 });
  marks.push({ tick: at(520), kind: SyntheticMarkKind.Speed, value: 1500 });
  marks.push({ tick: at(560), kind: SyntheticMarkKind.Speed, value: 1000 });
  marks.push({ tick: at(760), kind: SyntheticMarkKind.Pause, value: 0 });
  marks.push({ tick: at(760), kind: SyntheticMarkKind.Resume, value: 0 });

  const envelopesPerArmy = armies.map((s) => s.envelopes);
  return {
    minutes,
    seed,
    apm,
    mapSizeWu: SYNTHETIC_MAP_SIZE_WU,
    commands,
    hashes: { interval: SYNTHETIC_HASH_INTERVAL, firstTick: SYNTHETIC_HASH_INTERVAL, values: hashValues },
    subHashes: { interval: SYNTHETIC_SUB_HASH_INTERVAL, firstTick: SYNTHETIC_SUB_HASH_INTERVAL, regionNames, values: subValues },
    marks,
    stats: {
      ticks,
      envelopes: envelopesPerArmy[0]! + envelopesPerArmy[1]!,
      envelopesPerArmy,
      apmPerArmy: envelopesPerArmy.map((n) => n / minutes),
      rawCommandBytes: rawBytes,
      opHistogram,
      unitsPerCommandHistogram: sizeHistogram,
      queuedEnvelopes: queued,
      liveUnitsAtEnd: armies.map((s) => 1 + s.engineers.length + s.factories.length + s.structures.length + s.mobile.length),
      unitsCreated: table.created,
      slotHighWater: table.highWater,
      maxGeneration: table.maxGen,
    },
  };
}
