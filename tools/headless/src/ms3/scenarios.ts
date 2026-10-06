/**
 * MS3 acceptance benchmarks on sim level (PLAN §5.2 MS3 "Headless-Benchmark auf 1.024 WU"),
 * scenarios 1–4 of `pnpm bench:ms3` plus the SPK6 follow-up (start-up ticks). Scenario 5 (1,000
 * moving units, all engines) is the harness job in load.ts.
 *
 * 1. crossMap: 200 tanks (classes 1–3) across the map, group and single orders mixed — start-up
 *    ticks per unit, arrival share without stuck > 3 s, group offset errors, land invariants.
 * 2. choke: 100 T1 tanks through the 3-WU gap of the 'choke' test map — ticks until all are
 *    through, deadlock detection.
 * 3. burst: 200 simultaneous single requests on 1,024 WU with stamped base footprints — ticks
 *    until every path is ready, PathService ms per tick, expansions; one group order of 50 units
 *    must issue exactly one request.
 * 4. storm: 200 moving units with paths, 20 new footprints — the paths marked for a repath equal
 *    the brute-force corridor rule (@faf/nav/check) exactly, no repath outside the stamps.
 *
 * Machine-independent criteria (tick counts, shares, set equality, request counts, deadlock) are
 * returned as `checks`; wall-clock values are only measured (DECISIONS 16).
 */
import { FX_ONE, type Handle } from '@faf/fixed';
import { createTestPlaneMap, type RtsMap } from '@faf/formats';
import { PATH_DIRECT, PATH_F_REPATH, PATH_FAILED, PATH_PENDING, PATH_READY, type PathDebug } from '@faf/nav';
import { clipFootprint, copyNavGraph, corridorCutBrute, type NavGraphCopy } from '@faf/nav/check';
import type { NavTestMap } from '@faf/nav/testmap';
import { MoverBits, PhaseId, snapshot, restore, unitClass, WH_STUCK_GIVEUPS, type PhaseProbe, type World } from '@faf/sim';
import type { Clock } from '../stats.ts';
import { BP_T1, dist, isIdle, isMoving, landViolation, mixedTank, offsetErrors, routeLength, SimDriver, slotOf, TANKS, type Dist } from './driver.ts';

/** A machine-independent criterion (always gated by the scripts). */
export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** False: reported only (informational scenario variant), never fails the run. */
  readonly gated: boolean;
}

/** Stuck metric of the acceptance: > 3 s = 30 ticks without progress on the remaining route. */
export const STUCK_METRIC_TICKS = 30;
/** Progress = the remaining route got this much shorter than its best value (SPK2 stuckEpsilon). */
export const PROGRESS_EPS_WU = 0.15;
/** Start-up criterion: every unit changes its position within this many ticks (< 1 s). */
export const START_TICKS_MAX = 10;
/** Arrival: idle with its order done within this distance of its slot (contagion stops ≤ 4 WU). */
export const ARRIVAL_SLOT_WU = 5;
export const ARRIVAL_SHARE_MIN = 0.95;
/** Offset golden tolerance (ms3-p2): reported per group, not gated here. */
export const OFFSET_TOL_WU = 1.5;
/** Choke: all 100 through within 600 ticks; no further unit through for 150 ticks = deadlock. */
export const CHOKE_TICKS_MAX = 600;
export const CHOKE_DEADLOCK_TICKS = 150;
/** Burst: every request ready within 10 ticks. */
export const BURST_TICKS_MAX = 10;
/** Burst runs after the cold one that only warm the JIT up (not in the warm statistics). */
export const BURST_WARMUP_RUNS = 2;

/** Full GC between measured runs when the process exposes it (`node --expose-gc`). */
export function collectGarbage(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g !== undefined) g();
}

function check(name: string, ok: boolean, detail: string, gated = true): Check {
  return { name, ok, detail, gated };
}

// ---- 1. crossMap -----------------------------------------------------------------------------

/** One order group of the cross-map scenario. */
interface OrderGroup {
  readonly label: string;
  /** 'group': one Move for all units; 'single': one Move per unit. */
  readonly kind: 'group' | 'single';
  readonly units: Handle[];
}

export interface GroupOffsetResult {
  readonly label: string;
  readonly units: number;
  readonly offset: Dist;
}

export interface CrossMapResult {
  readonly map: string;
  readonly layout: string;
  readonly gated: boolean;
  readonly sizeWu: number;
  readonly units: number;
  readonly orders: number;
  /** requestsIssued in the command tick (must equal `orders`: one request per Move). */
  readonly requestsAtCommand: number;
  readonly startTicks: Dist;
  readonly startTicksHistogram: Readonly<Record<string, number>>;
  readonly arrived: number;
  readonly arrivedNoStuck: number;
  readonly arrivalShare: number;
  readonly maxNoProgress: Dist;
  readonly arrivalTicks: Dist;
  readonly ticksUntilAllIdle: number | null;
  readonly offsets: readonly GroupOffsetResult[];
  readonly offsetAll: Dist;
  readonly invariantViolations: number;
  readonly firstViolation: string | null;
  /** Units with a stall > STUCK_METRIC_TICKS (longest first, at most 40): where and why. */
  readonly stalls: readonly StallInfo[];
  readonly requestsTotal: number;
  readonly stuckGiveUps: number;
  readonly wallMs: number;
  readonly checks: readonly Check[];
}

export interface StallInfo {
  readonly group: string;
  readonly cls: number;
  readonly ticks: number;
  readonly fromTick: number;
  readonly x: number;
  readonly z: number;
  readonly route: number;
  readonly flags: number;
}

/**
 * Order layout of the cross-map scenario: 200 mixed tanks (classes 1–3) spawned as one block
 * around `spawn`, split into order groups (every 4th unit per quarter): a group of 50, 50 single
 * orders (target grid 7 × 4 WU from `singles`), five groups of 10 and two groups of 25.
 */
export interface CrossMapLayout {
  readonly name: string;
  readonly description: string;
  readonly spawn: readonly [number, number];
  readonly g50: readonly [number, number];
  readonly singles: readonly [number, number];
  readonly g10: readonly (readonly [number, number])[];
  readonly g25: readonly [readonly [number, number], readonly [number, number]];
}

/**
 * hollow-ridge, acceptance layout (like the SPK2 cross-map scenario, DECISIONS 22): the block
 * starts in the open north-west lowland; every order crosses the ridge through one of the two
 * fords, the group of 50 climbs onto the south-east plateau (8-WU ramp).
 */
export const RIDGE_CROSS: CrossMapLayout = {
  name: 'hollow-ridge',
  description: 'Start im NW-Tiefland (250, 60); alle Ziele jenseits des Grats (beide Furten), G50 auf das SE-Plateau (Rampe 8 WU)',
  spawn: [250, 60],
  g50: [405, 405],
  singles: [300, 360],
  g10: [
    [420, 120],
    [120, 450],
    [460, 200],
    [200, 460],
    [300, 330],
  ],
  g25: [
    [380, 300],
    [300, 440],
  ],
};

/**
 * hollow-ridge, plateau exit (reported, not gated): the block starts on the NW start plateau, so
 * all 200 units leave through its two 8-WU ramps at once, and two targets lie at the foot of the
 * SE plateau ramps — the worst case of crowd funnels on this map.
 */
export const RIDGE_PLATEAU: CrossMapLayout = {
  name: 'hollow-ridge-plateau',
  description: 'Start auf dem NW-Startplateau (100, 100): alle 200 über die zwei 8-WU-Rampen, zwei Ziele am Fuß der SE-Rampen',
  spawn: [100, 100],
  g50: [405, 405],
  singles: [300, 360],
  g10: [
    [420, 120],
    [120, 450],
    [356, 156],
    [156, 356],
    [300, 330],
  ],
  g25: [
    [402, 340],
    [340, 402],
  ],
};

/**
 * 1,024-WU 'bases' map (stamped bases): the block starts in the open lowland between the
 * north-western bases and the river; orders go north past the bases and south across the river
 * through the fords at x = 256 and 512 (≈ 12 WU wide, like the SPK2 passes). The ridge gaps
 * (3–8 WU, single file for class 3) are chokes by design and belong to scenario 2, not here.
 */
export const BASES_CROSS: CrossMapLayout = {
  name: 'bases-1024',
  description: 'Start im Tiefland (300, 400) zwischen den NW-Basen und dem Fluss; Ziele im Norden und jenseits des Flusses (Furten x = 256 / 512)',
  spawn: [300, 400],
  g50: [256, 650],
  singles: [500, 600],
  g10: [
    [150, 150],
    [450, 150],
    [100, 900],
    [400, 850],
    [512, 960],
  ],
  g25: [
    [200, 900],
    [450, 700],
  ],
};

export interface CrossMapSetup {
  readonly label: string;
  readonly map: RtsMap;
  readonly nav?: NavTestMap;
  readonly layout: CrossMapLayout;
  readonly maxTicks: number;
  /** Gate the machine-independent criteria (false: reported only, e.g. the plateau exit). */
  readonly gated: boolean;
  /** World seed (default 0x3a110001; robustness runs vary it). */
  readonly seed?: number;
}

/** Stamps the base footprints of a generated 'bases' map (tick 1) and advances. */
export function stampBases(d: SimDriver, nav: NavTestMap | undefined): number {
  if (nav === undefined || nav.baseFootprints.length === 0) return 0;
  for (const f of nav.baseFootprints) d.footprint(f.x, f.z, f.w, f.h, 1);
  d.step();
  return nav.baseFootprints.length;
}

/** Spawns the block and queues the orders of a cross-map layout; returns the order groups. */
function crossMapOrders(d: SimDriver, s: CrossMapSetup): OrderGroup[] {
  const L = s.layout;
  const target = (p: readonly [number, number], what: string): readonly [number, number] => {
    if (!d.free(p[0], p[1], 3)) throw new Error(`${L.name}: target ${what} (${p[0]}, ${p[1]}) is not free for class 3`);
    return p;
  };
  d.place(0, Array.from({ length: 200 }, (_, i) => mixedTank(i)), L.spawn[0], L.spawn[1], 3.2);
  d.step();
  const hs = d.handles(0);
  const q = (r: number): Handle[] => hs.filter((_, i) => i % 4 === r);
  const [g50, singles, g10, g25] = [q(0), q(1), q(2), q(3)];
  const groups: OrderGroup[] = [];
  const t50 = target(L.g50, 'G50');
  groups.push({ label: `G50 → (${t50[0]}, ${t50[1]})`, kind: 'group', units: g50 });
  d.move(0, g50, t50[0], t50[1]);
  groups.push({ label: `50 Einzel → (${L.singles[0]}, ${L.singles[1]}) + Raster`, kind: 'single', units: singles });
  singles.forEach((h, i) => {
    const t = target([L.singles[0] + (i % 7) * 4, L.singles[1] + Math.floor(i / 7) * 4], `single ${i}`);
    d.move(0, [h], t[0], t[1]);
  });
  L.g10.forEach((p, k) => {
    const t = target(p, `G10 ${k}`);
    const u = g10.slice(k * 10, k * 10 + 10);
    groups.push({ label: `G10 → (${t[0]}, ${t[1]})`, kind: 'group', units: u });
    d.move(0, u, t[0], t[1]);
  });
  L.g25.forEach((p, k) => {
    const t = target(p, `G25 ${k}`);
    const u = g25.slice(k * 25, k * 25 + 25);
    groups.push({ label: `G25 → (${t[0]}, ${t[1]})`, kind: 'group', units: u });
    d.move(0, u, t[0], t[1]);
  });
  return groups;
}

/**
 * Per-unit progress tracker of the stuck metric, with the semantics of the SPK2 prototype (DECISIONS
 * 22, tools/headless/src/spk2/sim.ts): progress = the remaining route (routeLength) got
 * PROGRESS_EPS_WU shorter than its reference. When the route itself changes — the group path
 * becomes ready or is repathed, the stuck chain switches to an own path or a side step, a segment
 * is refined (lazy refinement replaces the straight line to the next portal by the real way) — a
 * longer new route raises the reference without crediting progress and without resetting the
 * stall clock (SPK2 `onStuck`: "the metric reference follows a longer new path"); a shorter one
 * counts as progress. A new order (group record) starts a fresh reference. A unit that is pushed
 * backwards or waits in a crowd accumulates stall time.
 */
export class ProgressTracker {
  private readonly best: Float64Array;
  private readonly bestTick: Int32Array;
  private readonly key: Int32Array;
  private readonly refined: Int32Array;
  private readonly order: Int32Array;
  private readonly seen: Int32Array;
  readonly maxNoProgress: Int32Array;
  /** Where the longest stall of each unit happened: start tick, position (WU) and mover flags at its end. */
  readonly stallStart: Int32Array;
  readonly stallX: Float64Array;
  readonly stallZ: Float64Array;
  readonly stallFlags: Int32Array;
  readonly stallRoute: Float64Array;

  constructor(n: number) {
    this.stallStart = new Int32Array(n);
    this.stallX = new Float64Array(n);
    this.stallZ = new Float64Array(n);
    this.stallFlags = new Int32Array(n);
    this.stallRoute = new Float64Array(n);
    this.best = new Float64Array(n).fill(Infinity);
    this.bestTick = new Int32Array(n).fill(-1);
    this.key = new Int32Array(n).fill(-1);
    this.refined = new Int32Array(n);
    this.order = new Int32Array(n).fill(-1);
    this.seen = new Int32Array(n).fill(-2);
    this.maxNoProgress = new Int32Array(n);
  }

  /** Current run of ticks without progress of unit k at tick t (0 before its first update). */
  noProgress(k: number, t: number): number {
    const b = this.bestTick[k]!;
    return b < 0 ? 0 : t - b;
  }

  /** Updates unit k (slot `i`) after the step of tick `t` (command tick = 1). */
  update(w: World, k: number, i: number, t: number): void {
    const U = w.units.col;
    const r = U.mover[i]!;
    if (r < 0 || !isMoving(w, i)) return;
    const M = w.movers.col;
    const mf = M.flags[r]!;
    const p = M.path[r]!;
    const pending = p >= 0 && w.nav.pathState(p) === PATH_PENDING;
    const route = mf & (MoverBits.OwnPath | MoverBits.Detour | MoverBits.FinalLeg);
    const key = ((p & 0xfff) << 16) ^ ((M.pgen[r]! & 0xff) << 8) ^ (route << 1) ^ (pending ? 1 : 0);
    const refined = p >= 0 && !pending ? w.nav.refinedLeft(p) : 0;
    const L = routeLength(w, i);
    const order = U.formation[i]!;
    const resumed = t - this.seen[k]! > 1;
    this.seen[k] = t;
    if (this.bestTick[k]! < 0 || order !== this.order[k] || resumed) {
      // New order (group record) or moving again after a pause (slot return): fresh reference
      // (SPK2 beginOrder).
      this.order[k] = order;
      this.best[k] = L;
      this.bestTick[k] = t;
    } else if (key !== this.key[k] || refined > this.refined[k]!) {
      // New route: re-base (SPK2), progress only if it is shorter.
      if (L < this.best[k]! - PROGRESS_EPS_WU) this.bestTick[k] = t;
      this.best[k] = L;
    } else if (L < this.best[k]! - PROGRESS_EPS_WU) {
      this.best[k] = L;
      this.bestTick[k] = t;
    }
    this.key[k] = key;
    this.refined[k] = refined;
    const np = t - this.bestTick[k]!;
    if (np > this.maxNoProgress[k]!) {
      this.maxNoProgress[k] = np;
      this.stallStart[k] = this.bestTick[k]!;
      this.stallX[k] = U.x[i]! / FX_ONE;
      this.stallZ[k] = U.z[i]! / FX_ONE;
      this.stallFlags[k] = mf;
      this.stallRoute[k] = L;
    }
  }
}

/** Start-up ticks histogram buckets. */
function histogram(values: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = v < 0 ? 'nie' : v > 10 ? '>10' : String(v);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function runCrossMap(simBin: Uint8Array, s: CrossMapSetup, clock: Clock): CrossMapResult {
  const t0 = clock();
  const d = new SimDriver({ simBin, map: s.map, seed: s.seed ?? 0x3a110001 });
  stampBases(d, s.nav);
  const groups = crossMapOrders(d, s);
  const w = d.w;
  const all: Handle[] = groups.flatMap((g) => g.units);
  const n = all.length;
  const slots = all.map((h) => slotOf(w, h));
  const x0 = slots.map((i) => w.units.col.x[i]!);
  const z0 = slots.map((i) => w.units.col.z[i]!);
  const orders = d.queued;
  const req0 = w.nav.requestsIssued;
  const giveUps0 = w.header.i32[WH_STUCK_GIVEUPS]!;
  const cmdTick = w.tick + 1;
  d.step();
  const requestsAtCommand = w.nav.requestsIssued - req0;
  const startTick = new Int32Array(n).fill(-1);
  const arriveTick = new Int32Array(n).fill(-1);
  const arriveDist = new Float64Array(n);
  const tracker = new ProgressTracker(n);
  let violations = 0;
  let firstViolation: string | null = null;
  let allIdleAt: number | null = null;
  for (;;) {
    const t = w.tick - cmdTick + 1; // ticks since the command (the command tick = 1)
    const U = w.units.col;
    let idle = 0;
    for (let k = 0; k < n; k++) {
      const i = slots[k]!;
      if (startTick[k]! < 0 && (U.x[i] !== x0[k] || U.z[i] !== z0[k])) startTick[k] = t;
      if (arriveTick[k]! < 0) {
        if (isIdle(w, i)) {
          arriveTick[k] = t;
          const r = U.mover[i]!;
          arriveDist[k] = r < 0 ? 0 : Math.hypot(U.x[i]! - w.movers.col.tx[r]!, U.z[i]! - w.movers.col.tz[r]!) / FX_ONE;
        } else tracker.update(w, k, i, t);
      }
      if (arriveTick[k]! >= 0) idle++;
    }
    const v = landViolation(w);
    if (v !== null) {
      violations++;
      firstViolation ??= v;
    }
    if (idle === n) {
      allIdleAt = t;
      break;
    }
    if (t >= s.maxTicks) break;
    d.step();
  }
  let arrived = 0;
  let arrivedNoStuck = 0;
  const arrivalTicks: number[] = [];
  for (let k = 0; k < n; k++) {
    if (arriveTick[k]! < 0 || arriveDist[k]! > ARRIVAL_SLOT_WU) continue;
    arrived++;
    arrivalTicks.push(arriveTick[k]!);
    if (tracker.maxNoProgress[k]! <= STUCK_METRIC_TICKS) arrivedNoStuck++;
  }
  const stalls: StallInfo[] = [];
  const labelOf: string[] = [];
  for (const g of groups) for (let j = 0; j < g.units.length; j++) labelOf.push(g.label);
  for (let k = 0; k < n; k++) {
    if (tracker.maxNoProgress[k]! <= STUCK_METRIC_TICKS) continue;
    stalls.push({
      group: labelOf[k]!,
      cls: unitClass(w, slots[k]!),
      ticks: tracker.maxNoProgress[k]!,
      fromTick: tracker.stallStart[k]!,
      x: Math.round(tracker.stallX[k]! * 10) / 10,
      z: Math.round(tracker.stallZ[k]! * 10) / 10,
      route: Math.round(tracker.stallRoute[k]! * 10) / 10,
      flags: tracker.stallFlags[k]!,
    });
  }
  stalls.sort((a, b) => b.ticks - a.ticks);
  stalls.length = Math.min(stalls.length, 40);
  const offsets: GroupOffsetResult[] = [];
  const offAll: number[] = [];
  for (const g of groups) {
    if (g.kind !== 'group' || g.units.length < 2) continue;
    const e = offsetErrors(w, g.units);
    offAll.push(...e);
    offsets.push({ label: g.label, units: g.units.length, offset: dist(e) });
  }
  const starts = Array.from(startTick);
  const worstStart = starts.some((v) => v < 0) ? -1 : Math.max(...starts);
  const share = arrivedNoStuck / n;
  const pre = s.gated ? '' : '(nur berichtet) ';
  const checks = [
    check(`${pre}${s.label}: alle ${n} Units fahren ≤ ${START_TICKS_MAX} Ticks nach dem Befehl an`, worstStart >= 1 && worstStart <= START_TICKS_MAX, worstStart < 0 ? `${starts.filter((v) => v < 0).length} Units nie angefahren` : `max ${worstStart} Ticks`, s.gated),
    check(`${pre}${s.label}: ≥ 95 % kommen ohne Stuck > 3 s an`, share >= ARRIVAL_SHARE_MIN, `${arrivedNoStuck}/${n} = ${(100 * share).toFixed(1)} %`, s.gated),
    check(`${pre}${s.label}: ein Move = eine Pfadanfrage`, requestsAtCommand === orders, `${orders} Befehle ⇒ ${requestsAtCommand} Anfragen`, s.gated),
    check(`${pre}${s.label}: nie eine Land-Unit auf blockierter Zelle/im Tiefwasser`, violations === 0, firstViolation ?? '0 Verstöße', s.gated),
  ];
  return {
    map: s.label,
    layout: s.layout.description,
    gated: s.gated,
    sizeWu: s.map.meta.sizeWu,
    units: n,
    orders,
    requestsAtCommand,
    startTicks: dist(starts.filter((v) => v >= 0)),
    startTicksHistogram: histogram(starts),
    arrived,
    arrivedNoStuck,
    arrivalShare: share,
    maxNoProgress: dist(Array.from(tracker.maxNoProgress)),
    arrivalTicks: dist(arrivalTicks),
    ticksUntilAllIdle: allIdleAt,
    offsets,
    offsetAll: dist(offAll),
    invariantViolations: violations,
    firstViolation,
    stalls,
    requestsTotal: w.nav.requestsIssued - req0,
    stuckGiveUps: w.header.i32[WH_STUCK_GIVEUPS]! - giveUps0,
    wallMs: clock() - t0,
    checks,
  };
}

// ---- 2. choke ----------------------------------------------------------------------------------

export interface ChokeResult {
  readonly map: string;
  readonly sizeWu: number;
  readonly gapWu: number;
  readonly units: number;
  readonly allThroughTick: number | null;
  readonly deadlock: boolean;
  readonly longestNoThroughput: number;
  /** Ticks when 25 / 50 / 75 / 100 units were through (null = never). */
  readonly milestones: readonly (number | null)[];
  readonly invariantViolations: number;
  readonly wallMs: number;
  readonly checks: readonly Check[];
}

export function runChoke(simBin: Uint8Array, map: RtsMap, nav: NavTestMap, clock: Clock): ChokeResult {
  const t0 = clock();
  const gap = nav.choke!;
  const wallZ = gap.z; // blocked rows wallZ − 1 and wallZ
  const d = new SimDriver({ simBin, map, seed: 0x3a110002 });
  d.place(0, Array.from({ length: 100 }, () => BP_T1), gap.x + 1.5, wallZ - 22, 2.6);
  d.step();
  const w = d.w;
  const hs = d.handles(0);
  d.move(0, hs, gap.x + 1.5, wallZ + 30);
  const lineZ = (wallZ + 1) * FX_ONE + 1843; // south of the wall plus a T1 radius
  let best = 0;
  let bestTick = 0;
  let longest = 0;
  let allAt: number | null = null;
  let deadlock = false;
  let violations = 0;
  const milestones: (number | null)[] = [null, null, null, null];
  const limit = CHOKE_TICKS_MAX + 200;
  for (let t = 1; t <= limit; t++) {
    d.step();
    let through = 0;
    for (const h of hs) {
      const i = slotOf(w, h);
      if (i >= 0 && w.units.col.z[i]! > lineZ) through++;
    }
    if (landViolation(w) !== null) violations++;
    [25, 50, 75, 100].forEach((m, k) => {
      if (milestones[k] === null && through >= m) milestones[k] = t;
    });
    if (through > best) {
      best = through;
      bestTick = t;
    }
    if (t - bestTick > longest) longest = t - bestTick;
    if (through === hs.length) {
      allAt = t;
      break;
    }
    if (t - bestTick > CHOKE_DEADLOCK_TICKS) {
      deadlock = true;
      break;
    }
  }
  return {
    map: nav.name,
    sizeWu: map.meta.sizeWu,
    gapWu: gap.gapWu,
    units: hs.length,
    allThroughTick: allAt,
    deadlock,
    longestNoThroughput: longest,
    milestones,
    invariantViolations: violations,
    wallMs: clock() - t0,
    checks: [
      check(`Engstelle ${gap.gapWu} WU (${map.meta.sizeWu} WU): 100 Units durch in ≤ ${CHOKE_TICKS_MAX} Ticks`, allAt !== null && allAt <= CHOKE_TICKS_MAX, allAt === null ? `nur ${best}/100 durch` : `alle durch nach ${allAt} Ticks`),
      check(`Engstelle ${gap.gapWu} WU (${map.meta.sizeWu} WU): kein Deadlock (> ${CHOKE_DEADLOCK_TICKS} Ticks ohne Durchsatz)`, !deadlock, `längste Pause ${longest} Ticks`),
      check(`Engstelle ${gap.gapWu} WU (${map.meta.sizeWu} WU): nie auf blockierter Zelle`, violations === 0, `${violations} Verstöße`),
    ],
  };
}

// ---- 3. burst ----------------------------------------------------------------------------------

export interface BurstRun {
  /** Ticks until every path of the 200 requests left PENDING (command tick = 1). */
  readonly ticksUntilReady: number;
  /** PathService phase per tick of the burst (ms). */
  readonly pathServiceMs: readonly number[];
  readonly expansionsPerTick: readonly number[];
}

export interface BurstResult {
  readonly map: string;
  readonly sizeWu: number;
  readonly footprints: number;
  readonly requests: number;
  readonly runs: readonly BurstRun[];
  /** Ticks until ready per request (distribution over all requests of the warm runs). */
  readonly readyTicks: Dist;
  readonly readyTicksMax: number;
  /** PathService ms per tick: cold run and warm runs (burst ticks only). */
  readonly pathServiceCold: Dist;
  readonly pathServiceWarm: Dist;
  readonly expansionsPerTick: Dist;
  readonly expansionsTotal: number;
  readonly states: { readonly ready: number; readonly direct: number; readonly failed: number; readonly retargeted: number };
  /** Per request expansions (nav replay, one request per serviceTick). */
  readonly expansionsPerRequest: Dist;
  /** Raw values for histograms (SPK3): expansions per request, ready tick per request (warm runs). */
  readonly expansionsPerRequestRaw: readonly number[];
  readonly readyTicksRaw: readonly number[];
  /** Group order of 50 units on the same state ⇒ requestsIssued delta (must be 1) and shared path. */
  readonly groupRequests: number;
  readonly groupSharedPath: boolean;
  readonly wallMs: number;
  readonly checks: readonly Check[];
}

export interface BurstWorld {
  readonly d: SimDriver;
  /** Units (slot order) and their targets (WU). */
  readonly units: Handle[];
  readonly targets: [number, number][];
  readonly footprints: number;
  readonly snap: Uint8Array;
}

/** World with stamped bases and 200 idle tanks at random free points (classes 1–3). */
export function burstWorld(simBin: Uint8Array, map: RtsMap, nav: NavTestMap | undefined, count = 200, seed = 0xb0057): BurstWorld {
  const d = new SimDriver({ simBin, map, seed: 0x3a110003 });
  const footprints = stampBases(d, nav);
  const size = map.meta.sizeWu;
  const targets: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    const bp = TANKS[k % 3]!;
    const cls = d.classOfBp(bp);
    const [sx, sz] = d.randomFree(seed, k, cls);
    // Target: a free cell ≥ size/4 (Manhattan) away.
    let tgt = d.randomFree(seed ^ 0x7777, k * 64, cls);
    for (let j = 1; Math.abs(tgt[0] - sx) + Math.abs(tgt[1] - sz) < size / 4; j++) tgt = d.randomFree(seed ^ 0x7777, k * 64 + j, cls);
    d.spawn(0, bp, 1, sx, sz, 0);
    targets.push(tgt);
  }
  d.step();
  // Let the spawn settle (no orders; units fall asleep) before the snapshot.
  for (let t = 0; t < 5; t++) d.step();
  const units = d.handles(0);
  if (units.length !== count) throw new Error(`burstWorld: ${units.length}/${count} units spawned`);
  return { d, units, targets, footprints, snap: snapshot(d.w) };
}

export function runBurst(simBin: Uint8Array, label: string, map: RtsMap, nav: NavTestMap | undefined, reps: number, clock: Clock): BurstResult {
  const t0 = clock();
  const bw = burstWorld(simBin, map, nav);
  const { d, units, targets, snap } = bw;
  const w = d.w;
  const runs: BurstRun[] = [];
  const readyAll: number[] = [];
  let states = { ready: 0, direct: 0, failed: 0, retargeted: 0 };
  let expTotal = 0;
  let psStart = 0;
  const psMs: number[] = [];
  const probe: PhaseProbe = {
    begin(p) {
      if (p === PhaseId.PathService) psStart = clock();
    },
    end(p) {
      if (p === PhaseId.PathService) psMs.push(clock() - psStart);
    },
  };
  for (let rep = 0; rep < reps; rep++) {
    restore(w, snap);
    collectGarbage();
    psMs.length = 0;
    const exp: number[] = [];
    units.forEach((h, k) => d.move(0, [h], targets[k]![0], targets[k]![1]));
    const exp0 = w.nav.expansionsTotal;
    const readyAt = new Int32Array(units.length).fill(-1);
    let t = 0;
    for (; t < 40; ) {
      d.step(probe);
      t++;
      exp.push(w.nav.expansionsLastTick);
      let pending = 0;
      for (let k = 0; k < units.length; k++) {
        if (readyAt[k]! >= 0) continue;
        const i = slotOf(w, units[k]!);
        const p = w.movers.col.path[w.units.col.mover[i]!]!;
        if (p >= 0 && w.nav.pathState(p) !== PATH_PENDING) readyAt[k] = t;
        else pending++;
      }
      if (pending === 0) break;
    }
    if (rep === reps - 1) {
      expTotal = w.nav.expansionsTotal - exp0;
      states = { ready: 0, direct: 0, failed: 0, retargeted: 0 };
      for (const h of units) {
        const i = slotOf(w, h);
        const p = w.movers.col.path[w.units.col.mover[i]!]!;
        const s = p >= 0 ? w.nav.pathState(p) : PATH_FAILED;
        if (s === PATH_READY) states.ready++;
        else if (s === PATH_DIRECT) states.direct++;
        else states.failed++;
        if ((w.movers.col.flags[w.units.col.mover[i]!]! & MoverBits.Retargeted) !== 0) states.retargeted++;
      }
    }
    if (rep > 0 || reps === 1) readyAll.push(...Array.from(readyAt));
    runs.push({ ticksUntilReady: t, pathServiceMs: psMs.slice(), expansionsPerTick: exp });
  }
  // Per request expansions: nav replay on the pre-command state, one request per serviceTick.
  restore(w, snap);
  const perReq: number[] = [];
  const pathIds: number[] = [];
  units.forEach((h, k) => {
    const i = slotOf(w, h);
    const cls = TANKS.indexOf(TANKS[k % 3]!) + 1;
    pathIds.push(w.nav.request(i, w.tick, cls, w.units.col.x[i]!, w.units.col.z[i]!, Math.round(targets[k]![0] * FX_ONE), Math.round(targets[k]![1] * FX_ONE)));
  });
  while (w.nav.pendingCount > 0) perReq.push(w.nav.serviceTick(1));
  // Group order of 50 idle units on the pre-command state: exactly one request, one shared path.
  restore(w, snap);
  const g = units.slice(0, 50);
  const req0 = w.nav.requestsIssued;
  d.move(0, g, targets[0]![0], targets[0]![1]);
  d.step();
  const groupRequests = w.nav.requestsIssued - req0;
  const gp = new Set(g.map((h) => w.movers.col.path[w.units.col.mover[slotOf(w, h)]!]!));
  const groupSharedPath = gp.size === 1 && !gp.has(-1);
  restore(w, snap);
  // Run 1 = JIT cold; runs 2–3 warm the JIT up (like the harness series), later runs are warm.
  const warm = runs.slice(reps > BURST_WARMUP_RUNS + 1 ? BURST_WARMUP_RUNS + 1 : reps > 1 ? 1 : 0);
  const readyMax = Math.max(...runs.map((r) => r.ticksUntilReady));
  const notReady = readyAll.filter((v) => v < 0).length;
  return {
    map: label,
    sizeWu: map.meta.sizeWu,
    footprints: bw.footprints,
    requests: units.length,
    runs,
    readyTicks: dist(readyAll.filter((v) => v >= 0)),
    readyTicksMax: readyMax,
    pathServiceCold: dist(runs[0]!.pathServiceMs),
    pathServiceWarm: dist(warm.flatMap((r) => r.pathServiceMs)),
    expansionsPerTick: dist(warm.flatMap((r) => r.expansionsPerTick)),
    expansionsTotal: expTotal,
    states,
    expansionsPerRequest: dist(perReq),
    expansionsPerRequestRaw: perReq,
    readyTicksRaw: readyAll,
    groupRequests,
    groupSharedPath,
    wallMs: clock() - t0,
    checks: [
      check(`${label}: ${units.length} Einzelanfragen alle fertig ≤ ${BURST_TICKS_MAX} Ticks`, readyMax <= BURST_TICKS_MAX && notReady === 0, `max ${readyMax} Ticks (${runs.map((r) => r.ticksUntilReady).join(', ')})`),
      check(`${label}: Gruppenbefehl mit 50 Units ⇒ requestsIssued genau +1`, groupRequests === 1 && groupSharedPath, `+${groupRequests}, ${groupSharedPath ? 'ein gemeinsamer Pfad' : 'KEIN gemeinsamer Pfad'}`),
      check(`${label}: keine Anfrage gescheitert`, states.failed === 0, `${states.failed} Failed`),
    ],
  };
}

// ---- 4. storm ----------------------------------------------------------------------------------

export interface StormStamp {
  readonly tick: number;
  readonly rect: readonly [number, number, number, number];
  readonly eligible: number;
  readonly marked: number;
  readonly expected: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly counterDelta: number;
}

export interface StormResult {
  readonly map: string;
  readonly sizeWu: number;
  readonly units: number;
  readonly stamps: readonly StormStamp[];
  readonly markedTotal: number;
  readonly expectedTotal: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  /** repathsTriggered changes outside the stamp ticks (must be 0). */
  readonly otherRepaths: number;
  /** Other path requests during the storm (stuck chain), for information. */
  readonly otherRequests: number;
  readonly invariantViolations: number;
  readonly wallMs: number;
  readonly checks: readonly Check[];
}

export const STORM_STAMPS = 20;

export function runStorm(simBin: Uint8Array, label: string, map: RtsMap, nav: NavTestMap | undefined, clock: Clock): StormResult {
  const t0 = clock();
  const bw = burstWorld(simBin, map, nav, 200, 0x5703);
  const { d, units, targets } = bw;
  const w = d.w;
  units.forEach((h, k) => d.move(0, [h], targets[k]![0], targets[k]![1]));
  d.step();
  // Drive until every path is ready and the units are under way.
  for (let t = 0; t < 19; t++) d.step();
  const stamps: StormStamp[] = [];
  let capture: { before: { p: number; d: PathDebug; eligible: boolean }[]; graph: NavGraphCopy; counter: number } | null = null;
  let after: { marked: Set<number>; graph: NavGraphCopy; counter: number } | null;
  const probe: PhaseProbe = {
    begin(p) {
      if (p !== PhaseId.CommandApply || capture !== null) return;
      const paths = w.nav.st.paths;
      const before: { p: number; d: PathDebug; eligible: boolean }[] = [];
      for (let q = 0; q < paths.highWater; q++) {
        if (paths.alive[q] !== 1) continue;
        const dd = w.nav.pathDebug(q);
        before.push({ p: q, d: dd, eligible: (dd.state === PATH_READY || dd.state === PATH_DIRECT) && (dd.flags & PATH_F_REPATH) === 0 });
      }
      capture = { before, graph: copyNavGraph(w.nav), counter: w.nav.repathsTriggered };
    },
    end(p) {
      if (p !== PhaseId.CommandApply || capture === null) return;
      const marked = new Set<number>();
      for (const e of capture.before) if (e.eligible && (w.nav.pathFlags(e.p) & PATH_F_REPATH) !== 0) marked.add(e.p);
      after = { marked, graph: copyNavGraph(w.nav), counter: w.nav.repathsTriggered };
    },
  };
  let otherRepaths = 0;
  let violations = 0;
  const req0 = w.nav.requestsIssued;
  const hsz = map.meta.sizeWu;
  for (let k = 0; k < STORM_STAMPS; k++) {
    // 9 plain ticks, then the stamp tick.
    for (let t = 0; t < 9; t++) {
      const c = w.nav.repathsTriggered;
      d.step();
      otherRepaths += w.nav.repathsTriggered - c;
      if (landViolation(w) !== null) violations++;
    }
    // Footprint on the route of a moving unit: around its steering point (varied size/offset).
    const alive = units.filter((h) => slotOf(w, h) >= 0 && isMoving(w, slotOf(w, h)));
    const pool = alive.length > 0 ? alive : units;
    const i = slotOf(w, pool[(k * 37) % pool.length]!);
    const r = w.units.col.mover[i]!;
    const fw = 3 + (k % 6);
    const fh = 3 + ((k * 5) % 6);
    const sx = (w.movers.col.wx[r]! >> 12) - (fw >> 1) + (k % 5) - 2;
    const sz = (w.movers.col.wz[r]! >> 12) - (fh >> 1) + ((k * 3) % 5) - 2;
    const x = Math.max(1, Math.min(hsz - fw - 1, sx));
    const z = Math.max(1, Math.min(hsz - fh - 1, sz));
    d.footprint(x, z, fw, fh, 1);
    capture = null;
    after = null;
    d.step(probe);
    if (landViolation(w) !== null) violations++;
    const cap = capture as { before: { p: number; d: PathDebug; eligible: boolean }[]; graph: NavGraphCopy; counter: number } | null;
    const aft = after as { marked: Set<number>; graph: NavGraphCopy; counter: number } | null;
    if (cap === null || aft === null) throw new Error('storm: probe did not capture the stamp tick');
    const rect = clipFootprint(hsz, x, z, fw, fh);
    let expected = 0;
    let fp = 0;
    let fn = 0;
    let eligible = 0;
    for (const e of cap.before) {
      if (!e.eligible) continue;
      eligible++;
      const cut = corridorCutBrute(w.nav, e.d, rect, cap.graph, aft.graph);
      const m = aft.marked.has(e.p);
      if (cut) expected++;
      if (m && !cut) fp++;
      if (!m && cut) fn++;
    }
    stamps.push({ tick: w.tick, rect, eligible, marked: aft.marked.size, expected, falsePositives: fp, falseNegatives: fn, counterDelta: aft.counter - cap.counter });
    // Repaths after CommandApply in the same tick (none may happen besides the stamp's).
    otherRepaths += w.nav.repathsTriggered - aft.counter;
  }
  const markedTotal = stamps.reduce((s, x) => s + x.marked, 0);
  const expectedTotal = stamps.reduce((s, x) => s + x.expected, 0);
  const fpT = stamps.reduce((s, x) => s + x.falsePositives, 0);
  const fnT = stamps.reduce((s, x) => s + x.falseNegatives, 0);
  const counterMismatch = stamps.filter((x) => x.counterDelta !== x.marked).length;
  return {
    map: label,
    sizeWu: hsz,
    units: units.length,
    stamps,
    markedTotal,
    expectedTotal,
    falsePositives: fpT,
    falseNegatives: fnT,
    otherRepaths,
    otherRequests: w.nav.requestsIssued - req0 - markedTotal,
    invariantViolations: violations,
    wallMs: clock() - t0,
    checks: [
      check(`${label}: repathsTriggered == Brute-Force-Korridorschnitt (0 falsch-positiv/-negativ)`, fpT === 0 && fnT === 0 && counterMismatch === 0, `${markedTotal} markiert, ${expectedTotal} erwartet, FP ${fpT}, FN ${fnT}, Zählerabweichungen ${counterMismatch}`),
      check(`${label}: keine sonstigen Korridor-Repaths`, otherRepaths === 0, `${otherRepaths}`),
      check(`${label}: Sturm ist aussagekräftig (Schnitte > 0, nicht alle Pfade)`, markedTotal > 0 && markedTotal < STORM_STAMPS * units.length, `${markedTotal} Markierungen`),
      check(`${label}: nie auf blockierter Zelle/im Tiefwasser`, violations === 0, `${violations} Verstöße`),
    ],
  };
}

// ---- SPK6 follow-up: start-up ticks from standstill ---------------------------------------------

export interface StartupRow {
  readonly bp: string;
  readonly headingDeg: number;
  /** Ticks after the command tick (command tick = 1) until: yaw changed, position changed, ≥ 0.05 WU, ≥ 0.5 WU, ≥ 1 WU. */
  readonly yawTick: number;
  readonly moveTick: number;
  readonly move005Tick: number;
  readonly move05Tick: number;
  readonly move1Tick: number;
}

export interface StartupResult {
  readonly rows: readonly StartupRow[];
  /** Group of 20 mixed tanks from standstill: max ticks until each changed its position. */
  readonly groupMaxMoveTick: number;
  readonly checks: readonly Check[];
}

/**
 * Ticks from the command to the first position change from standstill with the SPK2 start-up
 * profile (DECISIONS 22), per blueprint and heading error (0°…180° between the unit's yaw and the
 * target direction), on the flat test plane. Reference for the E2E latency measurement (ms3-p6):
 * the command is applied in the next tick (inputDelay 0), so "Tick 1" = the first step after it.
 */
export function runStartup(simBin: Uint8Array): StartupResult {
  const map = createTestPlaneMap(256);
  const d = new SimDriver({ simBin, map, seed: 0x3a110006 });
  const headings = [0, 45, 90, 135, 180];
  const cases: { bp: string; deg: number }[] = [];
  for (const bp of TANKS) for (const deg of headings) cases.push({ bp, deg });
  cases.forEach((c, k) => d.spawn(0, c.bp, 1, 30 + (k % 5) * 40, 30 + Math.floor(k / 5) * 40, 0));
  // A group of 20 mixed tanks for the group case.
  d.place(0, Array.from({ length: 20 }, (_, i) => mixedTank(i)), 200, 200, 3.2);
  d.step();
  for (let t = 0; t < 30; t++) d.step(); // settle: idle, asleep
  const w = d.w;
  const hs = d.handles(0);
  const U = w.units.col;
  const probes = hs.map((h) => {
    const i = slotOf(w, h);
    return { i, x: U.x[i]!, z: U.z[i]!, yaw: U.yaw[i]! };
  });
  cases.forEach((c, k) => {
    const p = probes[k]!;
    const a = (p.yaw / 65536) * 2 * Math.PI + (c.deg * Math.PI) / 180;
    d.move(0, [hs[k]!], p.x / FX_ONE + 20 * Math.cos(a), p.z / FX_ONE + 20 * Math.sin(a));
  });
  const group = hs.slice(cases.length);
  d.move(0, group, 200, 150);
  const res = probes.map(() => ({ yaw: -1, move: -1, m005: -1, m05: -1, m1: -1 }));
  for (let t = 1; t <= 60; t++) {
    d.step();
    probes.forEach((p, k) => {
      const r = res[k]!;
      const dd = Math.hypot(U.x[p.i]! - p.x, U.z[p.i]! - p.z) / FX_ONE;
      if (r.yaw < 0 && U.yaw[p.i] !== p.yaw) r.yaw = t;
      if (r.move < 0 && dd > 0) r.move = t;
      if (r.m005 < 0 && dd >= 0.05) r.m005 = t;
      if (r.m05 < 0 && dd >= 0.5) r.m05 = t;
      if (r.m1 < 0 && dd >= 1) r.m1 = t;
    });
  }
  const rows: StartupRow[] = cases.map((c, k) => ({ bp: c.bp, headingDeg: c.deg, yawTick: res[k]!.yaw, moveTick: res[k]!.move, move005Tick: res[k]!.m005, move05Tick: res[k]!.m05, move1Tick: res[k]!.m1 }));
  const gm = res.slice(cases.length).map((r) => r.move);
  const groupMax = gm.some((v) => v < 0) ? -1 : Math.max(...gm);
  const worst = rows.some((r) => r.moveTick < 0) ? -1 : Math.max(...rows.map((r) => r.moveTick));
  return {
    rows,
    groupMaxMoveTick: groupMax,
    checks: [
      check('SPK6-Referenz: jede Unit ändert ihre Position ≤ 10 Ticks nach dem Befehl (aus dem Stand, 0–180°)', worst >= 1 && worst <= START_TICKS_MAX && groupMax >= 1 && groupMax <= START_TICKS_MAX, `Einzel max ${worst}, Gruppe max ${groupMax} Ticks`),
    ],
  };
}
