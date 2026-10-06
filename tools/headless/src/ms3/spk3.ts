/**
 * SPK3 "Pathing realistisch" with sim integration (PLAN §4, MS3): the measurements of
 * `pnpm bench:spk3` beyond the burst of scenarios.ts.
 *
 *  - baseBuilding (sim): 200 tanks keep driving between random points of a 'bases' map, every 10
 *    ticks a new footprint (3×3 … 8×8) lands a few WU ahead of a moving unit ⇒ corridor repaths,
 *    stuck-chain requests, evictions, PathService time per tick.
 *  - combat (sim): two armies of 100 swap places through each other again and again (no weapons in
 *    MS3: pure movement interference) ⇒ stuck-chain requests and stalls per minute.
 *  - repath variants (nav level, same stamp sequence for both): the corridor rule of @faf/nav
 *    (PLAN §3.8, default) against the fallback of PLAN §4 "invalidation on chunk entry + lazy
 *    repair" — paths are only invalidated when their mover enters a chunk (32-WU sector) that
 *    changed after the path was planned, and repaired when the mover actually runs into a blocked
 *    leg. The variant exists only here (Nav.corridorRepath = false); the truth for its unnecessary
 *    repaths comes from the brute-force corridor check (@faf/nav/check) at each stamp.
 *
 * Tools code: floats, clocks and allocation are fine; the sim is driven through protocol batches.
 */
import { FX_ONE, rng32, type Handle } from '@faf/fixed';
import type { RtsMap } from '@faf/formats';
import {
  createStandaloneNav,
  NAV_BUDGET_EXPANSIONS_PER_TICK,
  NAV_CLASSES,
  NAV_SECTOR_SHIFT,
  PATH_DIRECT,
  PATH_READY,
  WP_END,
  WP_NEED_REFINE,
  WP_NONE,
  WP_OK,
  WP_PENDING,
  type Nav,
  type PathDebug,
} from '@faf/nav';
import { clipFootprint, copyNavGraph, corridorCutBrute } from '@faf/nav/check';
import type { NavTestMap } from '@faf/nav/testmap';
import { MoverState, PhaseId, WH_STUCK_GIVEUPS, WH_UNITS_EVICTED, type PhaseProbe, type World } from '@faf/sim';
import type { Clock } from '../stats.ts';
import { dist, isIdle, isMoving, mixedTank, SimDriver, slotOf, TANKS, type Dist } from './driver.ts';
import { burstWorld, collectGarbage, ProgressTracker, STUCK_METRIC_TICKS } from './scenarios.ts';

const TICKS_PER_MINUTE = 600;

/** Footprint 3×3 … 8×8, deterministic in (seed, k). */
function footSize(seed: number, k: number): [number, number] {
  return [3 + (rng32(seed, k, 1, 0) % 6), 3 + (rng32(seed, k, 2, 0) % 6)];
}

// ---- base building (sim) -----------------------------------------------------------------------

export interface BaseBuildingResult {
  readonly map: string;
  readonly sizeWu: number;
  readonly ticks: number;
  readonly units: number;
  readonly footprints: number;
  /** Footprints that could not be placed ahead of a moving unit without covering a unit. */
  readonly skipped: number;
  readonly orders: number;
  readonly corridorRepaths: number;
  readonly repathsPerFootprint: Dist;
  /** Paths hit by ≥ 1 corridor repath / all order paths. */
  readonly stuckRequests: number;
  readonly perMinute: { readonly corridorRepaths: number; readonly stuckRequests: number; readonly giveUps: number; readonly orders: number };
  readonly evicted: number;
  readonly giveUps: number;
  readonly pathServiceMs: Dist;
  readonly expansionsPerTick: Dist;
  readonly wallMs: number;
}

export function runBaseBuilding(simBin: Uint8Array, label: string, map: RtsMap, nav: NavTestMap | undefined, ticks: number, clock: Clock): BaseBuildingResult {
  const t0 = clock();
  const bw = burstWorld(simBin, map, nav, 200, 0xba5e);
  const { d, units, targets } = bw;
  const w = d.w;
  const size = map.meta.sizeWu;
  let orders = 0;
  const legs = new Int32Array(units.length);
  units.forEach((h, k) => {
    d.move(0, [h], targets[k]![0], targets[k]![1]);
    orders++;
  });
  const req0 = w.nav.requestsIssued;
  const rep0 = w.nav.repathsTriggered;
  const ev0 = w.header.i32[WH_UNITS_EVICTED]!;
  const give0 = w.header.i32[WH_STUCK_GIVEUPS]!;
  let psStart = 0;
  const psMs: number[] = [];
  const expTick: number[] = [];
  const probe: PhaseProbe = {
    begin(p) {
      if (p === PhaseId.PathService) psStart = clock();
    },
    end(p) {
      if (p === PhaseId.PathService) psMs.push(clock() - psStart);
    },
  };
  const perStamp: number[] = [];
  let skipped = 0;
  let stampNo = 0;
  collectGarbage();
  for (let t = 1; t <= ticks; t++) {
    let stamped = false;
    if (t % 10 === 0) {
      // A footprint a few WU ahead of a moving unit (rotating over the moving ones).
      const moving = units.filter((h) => isMoving(w, slotOf(w, h)));
      if (moving.length > 0) {
        const h = moving[(stampNo * 37) % moving.length]!;
        const i = slotOf(w, h);
        const [fw, fh] = footSize(0xb11d, stampNo);
        const a = (w.units.col.yaw[i]! / 65536) * 2 * Math.PI;
        const ahead = 4 + (stampNo % 7) + Math.max(fw, fh) / 2;
        const cx = w.units.col.x[i]! / FX_ONE + Math.cos(a) * ahead;
        const cz = w.units.col.z[i]! / FX_ONE + Math.sin(a) * ahead;
        const x = Math.max(1, Math.min(size - fw - 1, Math.round(cx - fw / 2)));
        const z = Math.max(1, Math.min(size - fh - 1, Math.round(cz - fh / 2)));
        const covers = units.some((u) => {
          const j = slotOf(w, u);
          const ux = w.units.col.x[j]! / FX_ONE;
          const uz = w.units.col.z[j]! / FX_ONE;
          return ux > x - 2 && ux < x + fw + 2 && uz > z - 2 && uz < z + fh + 2;
        });
        if (covers) skipped++;
        else {
          d.footprint(x, z, fw, fh, 1);
          stamped = true;
        }
        stampNo++;
      }
    }
    const r = w.nav.repathsTriggered;
    d.step(probe);
    expTick.push(w.nav.expansionsLastTick);
    if (stamped) perStamp.push(w.nav.repathsTriggered - r);
    // Idle units get the next leg (keeps 200 units under way).
    units.forEach((h, k) => {
      const i = slotOf(w, h);
      if (i < 0 || !isIdle(w, i)) return;
      legs[k] = legs[k]! + 1;
      const cls = d.classOfBp(TANKS[k % 3]!);
      const [tx, tz] = d.randomFree(0x1e65, k * 4096 + legs[k]!, cls);
      d.move(0, [h], tx, tz);
      orders++;
    });
  }
  const minutes = ticks / TICKS_PER_MINUTE;
  const corridor = w.nav.repathsTriggered - rep0;
  const stuckReq = w.nav.requestsIssued - req0 - orders - corridor;
  const giveUps = w.header.i32[WH_STUCK_GIVEUPS]! - give0;
  return {
    map: label,
    sizeWu: size,
    ticks,
    units: units.length,
    footprints: perStamp.length,
    skipped,
    orders,
    corridorRepaths: corridor,
    repathsPerFootprint: dist(perStamp),
    stuckRequests: stuckReq,
    perMinute: { corridorRepaths: round2(corridor / minutes), stuckRequests: round2(stuckReq / minutes), giveUps: round2(giveUps / minutes), orders: round2(orders / minutes) },
    evicted: w.header.i32[WH_UNITS_EVICTED]! - ev0,
    giveUps,
    pathServiceMs: dist(psMs),
    expansionsPerTick: dist(expTick),
    wallMs: clock() - t0,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ---- combat (sim) ------------------------------------------------------------------------------

/** The unit has no order left (idle, or only correcting its slot after arrival). */
function orderDone(w: World, i: number): boolean {
  const r = w.units.col.mover[i]!;
  return r < 0 || (w.movers.col.orders[r] === 0 && w.movers.col.state[r] !== MoverState.Moving);
}

export interface CombatResult {
  readonly map: string;
  readonly ticks: number;
  readonly units: number;
  /** Completed legs (a group of 25 reached the other side). */
  readonly legs: number;
  readonly orders: number;
  readonly stuckRequests: number;
  readonly giveUps: number;
  readonly perMinute: { readonly stuckRequests: number; readonly giveUps: number; readonly stalls: number };
  /** Stall episodes > 3 s (30 ticks without progress, SPK2 metric) and units with ≥ 1 of them. */
  readonly stalls: number;
  readonly unitsWithStall: number;
  readonly maxNoProgress: Dist;
  readonly pathServiceMs: Dist;
  readonly wallMs: number;
}

/**
 * Two armies of 100 mixed tanks (4 groups of 25 each) start as blocks at `a` and `b` and swap
 * places through each other; a group that has arrived is sent back at once.
 */
export function runCombat(simBin: Uint8Array, label: string, map: RtsMap, nav: NavTestMap | undefined, a: readonly [number, number], b: readonly [number, number], ticks: number, clock: Clock): CombatResult {
  const t0 = clock();
  const d = new SimDriver({ simBin, map, seed: 0x3a110007 });
  if (nav !== undefined) for (const f of nav.baseFootprints) d.footprint(f.x, f.z, f.w, f.h, 1);
  d.step();
  d.place(0, Array.from({ length: 100 }, (_, i) => mixedTank(i)), a[0], a[1], 3.2);
  d.place(1, Array.from({ length: 100 }, (_, i) => mixedTank(i + 7)), b[0], b[1], 3.2);
  d.step();
  const w = d.w;
  const groups: { army: number; units: Handle[]; at: 0 | 1 }[] = [];
  for (let army = 0; army < 2; army++) {
    const hs = d.handles(army);
    for (let g = 0; g < 4; g++) groups.push({ army, units: hs.filter((_, i) => i % 4 === g), at: army === 0 ? 0 : 1 });
  }
  const all = groups.flatMap((g) => g.units);
  let orders = 0;
  let legs = 0;
  const send = (g: (typeof groups)[number]): void => {
    const to = g.at === 0 ? b : a;
    d.move(g.army, g.units, to[0], to[1]);
    g.at = g.at === 0 ? 1 : 0;
    orders++;
  };
  for (const g of groups) send(g);
  const req0 = w.nav.requestsIssued;
  const give0 = w.header.i32[WH_STUCK_GIVEUPS]!;
  const tracker = new ProgressTracker(all.length);
  const stallOpen = new Uint8Array(all.length);
  let stalls = 0;
  const withStall = new Uint8Array(all.length);
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
  collectGarbage();
  for (let t = 1; t <= ticks; t++) {
    d.step(probe);
    all.forEach((h, k) => {
      const i = slotOf(w, h);
      if (i < 0 || !isMoving(w, i)) {
        stallOpen[k] = 0;
        return;
      }
      tracker.update(w, k, i, t);
      // A stall episode: the unit's current no-progress run crosses the threshold.
      const cur = tracker.noProgress(k, t);
      if (cur > STUCK_METRIC_TICKS && stallOpen[k] === 0) {
        stallOpen[k] = 1;
        stalls++;
        withStall[k] = 1;
      } else if (cur <= STUCK_METRIC_TICKS) stallOpen[k] = 0;
    });
    for (const g of groups) {
      if (g.units.every((h) => orderDone(w, slotOf(w, h)))) {
        legs++;
        send(g);
      }
    }
  }
  const minutes = ticks / TICKS_PER_MINUTE;
  const stuckReq = w.nav.requestsIssued - req0 - (orders - groups.length);
  const giveUps = w.header.i32[WH_STUCK_GIVEUPS]! - give0;
  let n = 0;
  for (const v of withStall) n += v;
  return {
    map: label,
    ticks,
    units: all.length,
    legs,
    orders,
    stuckRequests: stuckReq,
    giveUps,
    perMinute: { stuckRequests: round2(stuckReq / minutes), giveUps: round2(giveUps / minutes), stalls: round2(stalls / minutes) },
    stalls,
    unitsWithStall: n,
    maxNoProgress: dist(Array.from(tracker.maxNoProgress)),
    pathServiceMs: dist(psMs),
    wallMs: clock() - t0,
  };
}

// ---- repath variants (nav level) ---------------------------------------------------------------

export type RepathPolicy = 'corridor' | 'chunk';

export interface VariantResult {
  readonly policy: RepathPolicy;
  readonly map: string;
  readonly sizeWu: number;
  readonly ticks: number;
  readonly movers: number;
  readonly footprints: number;
  /** Repaths by cause: corridor mark (corridor), chunk entry / lazy repair (chunk). */
  readonly repathsCorridor: number;
  readonly repathsChunkEntry: number;
  readonly repathsLazy: number;
  readonly repathsTotal: number;
  readonly repathsPerMinute: number;
  /** Repaths of paths whose corridor was actually cut (brute force at stamp time) / of intact ones. */
  readonly necessary: number;
  readonly unnecessary: number;
  /** Cut paths that were never repaired before their mover finished (reached the goal anyway). */
  readonly cutUnrepaired: number;
  /** Ticks from the cutting stamp to the repath of a cut path. */
  readonly latency: Dist;
  /** Mover ticks spent steering along a blocked leg (ran into the obstacle) before a repair. */
  readonly staleTicks: number;
  readonly requests: number;
  readonly expansions: number;
  readonly stampMs: Dist;
  readonly serviceMs: Dist;
  readonly wallMs: number;
}

/**
 * True if the current planned leg of path p (previous waypoint → current waypoint, the mover drives
 * on it) lost its clearance LOS for `cls` — the same cells the corridor rule checks: this only
 * happens after a footprint cut it and nobody repathed.
 */
function legBlocked(nav: Nav, p: number, cls: number, wp: Int32Array): boolean {
  nav.pathPrev(p, PREV);
  return !nav.lineOfSight(cls, nav.cellOfFx(PREV[0]!, PREV[1]!), nav.cellOfFx(wp[0]!, wp[1]!));
}
const PREV = new Int32Array(2);

/** Mover speed of the nav-level replay (2.5 WU/s) and waypoint radius. */
const VAR_SPEED = 0.25 * FX_ONE;
const VAR_WP_RADIUS = 0.5 * FX_ONE;

/**
 * Nav-level replay: 200 movers (classes 1–3) drive along their paths at 2.5 WU/s between random
 * points of a 'bases' map (bases stamped); every 10 ticks a footprint lands 4–10 WU ahead of a
 * mover. `policy` decides when paths are repathed (see module comment). Deterministic stamp and
 * target sequences: both policies see the same obstacles as long as the movers do not diverge.
 */
export function runRepathVariant(map: NavTestMap, policy: RepathPolicy, ticks: number, clock: Clock): VariantResult {
  const t0 = clock();
  const sn = createStandaloneNav(map);
  const nav: Nav = sn.nav;
  for (const f of map.baseFootprints) nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
  nav.corridorRepath = policy === 'corridor';
  const size = map.sizeWu;
  const n = 200;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  const cls = new Int32Array(n);
  const path = new Int32Array(n).fill(-1);
  const planTick = new Int32Array(n);
  const sector = new Int32Array(n);
  const cutTick = new Int32Array(n).fill(-1);
  const legNo = new Int32Array(n);
  const secShift = nav.st.secShift;
  const secOf = (x: number, z: number): number => ((Math.floor(z / FX_ONE) >> NAV_SECTOR_SHIFT) << secShift) | (Math.floor(x / FX_ONE) >> NAV_SECTOR_SHIFT);
  const dirty = new Int32Array(1 << (2 * secShift)).fill(-1);
  const freeCell = (seed: number, k: number, c: number): [number, number] => {
    for (let t = 0; ; t++) {
      const x = 8 + (rng32(seed, k, t, 1) % (size - 16));
      const z = 8 + (rng32(seed, k, t, 2) % (size - 16));
      if (nav.isPassable(c, x, z) && nav.clearanceAt(x, z) >= c + 1) return [x * FX_ONE + FX_ONE / 2, z * FX_ONE + FX_ONE / 2];
    }
  };
  const newLeg = (k: number, tick: number): void => {
    legNo[k] = legNo[k]! + 1;
    let tgt: [number, number];
    for (let j = 0; ; j++) {
      tgt = freeCell(0x7a26, k * 4096 + legNo[k]! * 64 + j, cls[k]!);
      if (Math.abs(tgt[0] - px[k]!) + Math.abs(tgt[1] - pz[k]!) >= (size / 4) * FX_ONE) break;
    }
    if (path[k]! >= 0) nav.release(path[k]!);
    path[k] = nav.request(k, tick, cls[k]!, Math.round(px[k]!), Math.round(pz[k]!), tgt[0], tgt[1]);
    planTick[k] = tick;
    cutTick[k] = -1;
  };
  for (let k = 0; k < n; k++) {
    cls[k] = 1 + (k % NAV_CLASSES);
    const [x, z] = freeCell(0x5747, k, cls[k]!);
    px[k] = x;
    pz[k] = z;
    sector[k] = secOf(x, z);
    newLeg(k, 0);
  }
  while (nav.pendingCount > 0) nav.serviceTick(NAV_BUDGET_EXPANSIONS_PER_TICK);
  const req0 = nav.requestsIssued;
  const exp0 = nav.expansionsTotal;
  let repCorr = 0;
  let repChunk = 0;
  let repLazy = 0;
  let necessary = 0;
  let unnecessary = 0;
  let cutUnrepaired = 0;
  let stale = 0;
  let footprints = 0;
  let stampNo = 0;
  const latency: number[] = [];
  const stampMs: number[] = [];
  const serviceMs: number[] = [];
  const wp = new Int32Array(2);
  const repath = (k: number, tick: number): void => {
    if (cutTick[k]! >= 0) {
      necessary++;
      latency.push(tick - cutTick[k]!);
    } else unnecessary++;
    nav.repath(path[k]!, Math.round(px[k]!), Math.round(pz[k]!), tick);
    planTick[k] = tick;
    cutTick[k] = -1;
  };
  collectGarbage();
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick % 10 === 0) {
      // footprint 4–10 WU ahead of a moving mover, not covering any mover
      const k = (stampNo * 37) % n;
      const [fw, fh] = footSize(0xc0de, stampNo);
      stampNo++;
      const s = nav.waypoint(path[k]!, wp);
      if (s === WP_OK) {
        const dx = wp[0]! - px[k]!;
        const dz = wp[1]! - pz[k]!;
        const len = Math.hypot(dx, dz) || 1;
        const ahead = (4 + (stampNo % 7) + Math.max(fw, fh) / 2) * FX_ONE;
        const cx = (px[k]! + (dx / len) * ahead) / FX_ONE;
        const cz = (pz[k]! + (dz / len) * ahead) / FX_ONE;
        const x = Math.max(1, Math.min(size - fw - 1, Math.round(cx - fw / 2)));
        const z = Math.max(1, Math.min(size - fh - 1, Math.round(cz - fh / 2)));
        let covers = false;
        for (let j = 0; j < n && !covers; j++) {
          const ux = px[j]! / FX_ONE;
          const uz = pz[j]! / FX_ONE;
          covers = ux > x - 3 && ux < x + fw + 3 && uz > z - 3 && uz < z + fh + 3;
        }
        if (!covers) {
          // truth (chunk policy only; the corridor policy marks exactly this set itself)
          let before: { k: number; d: PathDebug }[] = [];
          let graph0 = null as ReturnType<typeof copyNavGraph> | null;
          if (policy === 'chunk') {
            before = [];
            for (let j = 0; j < n; j++) {
              const st = nav.pathState(path[j]!);
              if (st === PATH_READY || st === PATH_DIRECT) before.push({ k: j, d: nav.pathDebug(path[j]!) });
            }
            graph0 = copyNavGraph(nav);
          }
          const a = clock();
          nav.stampFootprint(x, z, fw, fh, 1);
          stampMs.push(clock() - a);
          footprints++;
          if (policy === 'chunk') {
            const graph1 = copyNavGraph(nav);
            const rect = clipFootprint(size, x, z, fw, fh);
            for (const e of before) if (cutTick[e.k]! < 0 && corridorCutBrute(nav, e.d, rect, graph0!, graph1)) cutTick[e.k] = tick;
            const m = NAV_CLASSES + 1;
            const sx0 = Math.max(0, x - m) >> NAV_SECTOR_SHIFT;
            const sz0 = Math.max(0, z - m) >> NAV_SECTOR_SHIFT;
            const sx1 = Math.min(size - 1, x + fw - 1 + m) >> NAV_SECTOR_SHIFT;
            const sz1 = Math.min(size - 1, z + fh - 1 + m) >> NAV_SECTOR_SHIFT;
            for (let sz = sz0; sz <= sz1; sz++) for (let sx = sx0; sx <= sx1; sx++) dirty[(sz << secShift) | sx] = tick;
          } else {
            for (let j = 0; j < n; j++) if (nav.needsRepath(path[j]!)) cutTick[j] = tick;
          }
        }
      }
    }
    // corridor policy: marked paths repath at once (sim: phase 3 of the same tick)
    if (policy === 'corridor') {
      for (let k = 0; k < n; k++) {
        if (nav.needsRepath(path[k]!)) {
          repCorr++;
          repath(k, tick);
        }
      }
    }
    // movement
    for (let k = 0; k < n; k++) {
      const p = path[k]!;
      let s = nav.waypoint(p, wp);
      let guard = 0;
      while (s === WP_NEED_REFINE && guard++ < 4) {
        nav.refineNext(p, 1);
        s = nav.waypoint(p, wp);
      }
      if (s === WP_PENDING || s === WP_NONE) continue;
      if (s === WP_END || s === WP_NEED_REFINE) {
        if (cutTick[k]! >= 0) cutUnrepaired++;
        newLeg(k, tick);
        continue;
      }
      // blocked leg ahead (the mover runs into an obstacle): lazy repair in the chunk policy
      if (tick % 5 === k % 5 && legBlocked(nav, p, cls[k]!, wp)) {
        stale++;
        if (policy === 'chunk') {
          repLazy++;
          repath(k, tick);
          continue;
        }
      }
      const dx = wp[0]! - px[k]!;
      const dz = wp[1]! - pz[k]!;
      const len = Math.hypot(dx, dz);
      if (len <= VAR_SPEED) {
        px[k] = wp[0]!;
        pz[k] = wp[1]!;
      } else {
        px[k] = px[k]! + (dx / len) * VAR_SPEED;
        pz[k] = pz[k]! + (dz / len) * VAR_SPEED;
      }
      if (Math.hypot(wp[0]! - px[k]!, wp[1]! - pz[k]!) <= VAR_WP_RADIUS) nav.advance(p);
      const sec = secOf(px[k]!, pz[k]!);
      if (sec !== sector[k]) {
        sector[k] = sec;
        if (policy === 'chunk' && dirty[sec]! > planTick[k]!) {
          repChunk++;
          repath(k, tick);
        }
      }
    }
    const a = clock();
    nav.serviceTick(NAV_BUDGET_EXPANSIONS_PER_TICK);
    serviceMs.push(clock() - a);
  }
  const total = repCorr + repChunk + repLazy;
  return {
    policy,
    map: map.name,
    sizeWu: size,
    ticks,
    movers: n,
    footprints,
    repathsCorridor: repCorr,
    repathsChunkEntry: repChunk,
    repathsLazy: repLazy,
    repathsTotal: total,
    repathsPerMinute: round2(total / (ticks / TICKS_PER_MINUTE)),
    necessary,
    unnecessary,
    cutUnrepaired,
    latency: dist(latency),
    staleTicks: stale,
    requests: nav.requestsIssued - req0,
    expansions: nav.expansionsTotal - exp0,
    stampMs: dist(stampMs),
    serviceMs: dist(serviceMs),
    wallMs: clock() - t0,
  };
}
