/**
 * SPK3 on nav level (PLAN §4 "Pathing realistisch", MS3): `pnpm bench:nav` (`-- --quick`).
 *
 * Maps: generated 512- and 1,024-WU 'bases' maps (@faf/nav/testmap, bases stamped as footprints).
 *  1. Precompute: static terrain, derived regions (clearance, components, sector graph), base stamps.
 *  2. 200 simultaneous single requests across the map (classes 1–3): ticks until all are served,
 *     ms per tick p50/p95/max at the chosen expansion budget, expansions per request, HPA*
 *     suboptimality (abstract route cost / optimal fine cost).
 *  3. Base building: 200 active paths between the bases, a new footprint (3×3 … 8×8) near a base
 *     every 10 ticks ⇒ repaths per footprint (corridor rule), stamp time, pathing ms per tick.
 * Full mode additionally sweeps the budget on 1,024 WU.
 *
 * Wall-clock values are machine-dependent (DECISIONS 16): reported, never gated here. Output:
 * packages/nav/bench/results/spk3-<date>.json (git-ignored) and Markdown tables on stdout.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { rng32 } from '@faf/fixed';
import { ArenaBuilder } from '@faf/heap';
import {
  addNavRegions,
  defineNavRegions,
  fineSearch,
  Nav,
  NAV_BUDGET_EXPANSIONS_PER_TICK,
  navMemoryBytes,
  PATH_DIRECT,
  PATH_F_FALLBACK,
  PATH_F_RETARGETED,
  PATH_READY,
  WP_NEED_REFINE,
  WP_OK,
  type StandaloneNav,
} from '../src/index.ts';
import { generateNavTestMap, type NavTestMap } from './testmap.ts';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const budgetArg = args.find((a) => a.startsWith('--budget='));
const BUDGET = budgetArg !== undefined ? Number.parseInt(budgetArg.slice(9), 10) : NAV_BUDGET_EXPANSIONS_PER_TICK;
const REPS = QUICK ? 3 : 8;
const OPT_SAMPLES = QUICK ? 40 : 200;
const BUILD_TICKS = QUICK ? 200 : 600;
const FX = 4096;

interface Dist {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

function dist(values: readonly number[]): Dist {
  const s = values.slice().sort((a, b) => a - b);
  const q = (f: number): number => (s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(f * s.length))]!);
  let sum = 0;
  for (const v of s) sum += v;
  return { n: s.length, mean: s.length > 0 ? sum / s.length : 0, p50: q(0.5), p95: q(0.95), max: s.length > 0 ? s[s.length - 1]! : 0 };
}

function f2(v: number): string {
  return v.toFixed(2).replace('.', ',');
}

function f3(v: number): string {
  return v.toFixed(3).replace('.', ',');
}

function int(v: number): string {
  return Math.round(v).toLocaleString('de-DE');
}

function gc(): void {
  const g = (globalThis as { gc?: () => void }).gc;
  if (g !== undefined) g();
}

/** 200 request endpoints across the map (passable for the class, ≥ size/4 apart), deterministic. */
function requestSet(nav: Nav, seed: number, count: number): Int32Array {
  const st = nav.st;
  const size = st.size;
  const out = new Int32Array(count * 5);
  let k = 0;
  for (let i = 0; k < count; i++) {
    const cls = 1 + (k % 3);
    const sx = 4 + (rng32(seed, i, 0, 1) % (size - 8));
    const sz = 4 + (rng32(seed, i, 0, 2) % (size - 8));
    const tx = 4 + (rng32(seed, i, 0, 3) % (size - 8));
    const tz = 4 + (rng32(seed, i, 0, 4) % (size - 8));
    if (!nav.isPassable(cls, sx, sz)) continue;
    if (Math.abs(tx - sx) + Math.abs(tz - sz) < size >> 2) continue;
    out.set([cls, sx * FX + FX / 2, sz * FX + FX / 2, tx * FX + FX / 2, tz * FX + FX / 2], 5 * k);
    k++;
  }
  return out;
}

function issue(nav: Nav, reqs: Int32Array, tick: number): number[] {
  const ids: number[] = [];
  for (let k = 0; k < reqs.length / 5; k++) {
    ids.push(nav.request(k, tick, reqs[5 * k]!, reqs[5 * k + 1]!, reqs[5 * k + 2]!, reqs[5 * k + 3]!, reqs[5 * k + 4]!));
  }
  return ids;
}

interface BurstResult {
  ticks: number[];
  msPerTick: Dist;
  msPerTickCold: Dist;
  expPerTick: Dist;
  expPerRequest: Dist;
  msPerRequest: number;
  suboptimality: Dist;
  within110: number;
  direct: number;
  fallback: number;
  retargeted: number;
}

function burst(sn: StandaloneNav, snap: Uint8Array, budget: number, withQuality: boolean): BurstResult {
  const { nav, arena } = sn;
  const reqs = requestSet(nav, 0x5b3, 200);
  const ticks: number[] = [];
  const warm: number[] = [];
  const cold: number[] = [];
  const expTick: number[] = [];
  let totalMs = 0;
  let totalReq = 0;
  for (let rep = 0; rep < REPS; rep++) {
    arena.restore(snap);
    gc();
    issue(nav, reqs, 0);
    let t = 0;
    while (nav.pendingCount > 0) {
      const t0 = performance.now();
      const e = nav.serviceTick(budget);
      const ms = performance.now() - t0;
      (rep === 0 ? cold : warm).push(ms);
      if (rep > 0) {
        expTick.push(e);
        totalMs += ms;
      }
      t++;
    }
    if (rep > 0) totalReq += 200;
    ticks.push(t);
  }
  // expansions per request (one request per call)
  arena.restore(snap);
  const ids = issue(nav, reqs, 0);
  const expReq: number[] = [];
  while (nav.pendingCount > 0) expReq.push(nav.serviceTick(1));
  let direct = 0;
  let fallback = 0;
  let retargeted = 0;
  const ratios: number[] = [];
  for (let k = 0; k < ids.length; k++) {
    const p = ids[k]!;
    const s = nav.pathState(p);
    if (s === PATH_DIRECT) direct++;
    if ((nav.pathFlags(p) & PATH_F_FALLBACK) !== 0) fallback++;
    if ((nav.pathFlags(p) & PATH_F_RETARGETED) !== 0) retargeted++;
    if (withQuality && k < OPT_SAMPLES && s === PATH_READY && (nav.pathFlags(p) & PATH_F_FALLBACK) === 0) {
      const st = nav.st;
      const opt = fineSearch(st, nav.pathClass(p), nav.pathStartCell(p), nav.pathGoalCell(p), 0, 0, st.size, st.size, 0);
      if (opt > 0) ratios.push(nav.pathCost(p) / opt);
    }
  }
  return {
    ticks,
    msPerTick: dist(warm),
    msPerTickCold: dist(cold),
    expPerTick: dist(expTick),
    expPerRequest: dist(expReq),
    msPerRequest: totalMs / Math.max(1, totalReq),
    suboptimality: dist(ratios),
    within110: ratios.length > 0 ? ratios.filter((r) => r <= 1.1).length / ratios.length : 1,
    direct,
    fallback,
    retargeted,
  };
}

interface BuildResult {
  footprints: number;
  repathsPerFootprint: Dist;
  pathsTouchedShare: number;
  stampMs: Dist;
  msPerTick: Dist;
  requests: number;
}

/** Base building: 200 paths between the bases, a footprint near a base every 10 ticks. */
function baseBuilding(sn: StandaloneNav, snap: Uint8Array, map: NavTestMap, budget: number): BuildResult {
  const { nav, arena } = sn;
  arena.restore(snap);
  gc();
  const size = map.sizeWu;
  const starts = map.starts;
  const ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    const s = starts[i % starts.length]!;
    const t = starts[(i + 1 + (i % 3)) % starts.length]!;
    const j = (v: number, salt: number): number => v + (((rng32(0xba5e, i, salt, 1) % 61) - 30) * FX);
    const tx = i % 4 === 0 ? (8 + (rng32(0xba5e, i, 5, 2) % (size - 16))) * FX : j(t.x, 3);
    const tz = i % 4 === 0 ? (8 + (rng32(0xba5e, i, 6, 2) % (size - 16))) * FX : j(t.z, 4);
    ids.push(nav.request(i, 0, 1 + (i % 3), j(s.x, 1), j(s.z, 2), tx, tz));
  }
  while (nav.pendingCount > 0) nav.serviceTick(budget);
  const issued0 = nav.requestsIssued;
  const out = new Int32Array(2);
  const repaths: number[] = [];
  const stampMs: number[] = [];
  const tickMs: number[] = [];
  const touched = new Uint8Array(ids.length);
  for (let tick = 1; tick <= BUILD_TICKS; tick++) {
    if (tick % 10 === 0) {
      const f = tick / 10;
      const b = starts[f % starts.length]!;
      const w = 3 + (rng32(0xf00d, f, 1, 0) % 6);
      const h = 3 + (rng32(0xf00d, f, 2, 0) % 6);
      const x = (b.x >> 12) + (rng32(0xf00d, f, 3, 0) % 81) - 40;
      const z = (b.z >> 12) + (rng32(0xf00d, f, 4, 0) % 81) - 40;
      const t0 = performance.now();
      const marked = nav.stampFootprint(x, z, w, h, 1);
      stampMs.push(performance.now() - t0);
      repaths.push(marked);
    }
    // units advance: every 5 ticks each path consumes a waypoint (refining on demand)
    if (tick % 5 === 0) {
      for (const p of ids) {
        const r = nav.waypoint(p, out);
        if (r === WP_OK) nav.advance(p);
        else if (r === WP_NEED_REFINE) nav.refineNext(p, 1);
      }
    }
    for (let k = 0; k < ids.length; k++) {
      const p = ids[k]!;
      if (nav.needsRepath(p)) {
        touched[k] = 1;
        const d = nav.pathDebug(p);
        nav.repath(p, d.prevX, d.prevZ, tick);
      }
    }
    const t0 = performance.now();
    nav.serviceTick(budget);
    tickMs.push(performance.now() - t0);
  }
  let t = 0;
  for (const v of touched) t += v;
  return {
    footprints: repaths.length,
    repathsPerFootprint: dist(repaths),
    pathsTouchedShare: t / ids.length,
    stampMs: dist(stampMs),
    msPerTick: dist(tickMs),
    requests: nav.requestsIssued - issued0,
  };
}

interface MapResult {
  sizeWu: number;
  name: string;
  memoryMiB: number;
  precompute: { staticMs: number; derivedMs: number; stampsMs: number; stamps: number; sectors: number };
  burst: BurstResult;
  build: BuildResult;
  sweep: { budget: number; ticks: number; p95: number; max: number }[];
}

function runMap(size: number): MapResult {
  const map = generateNavTestMap({ sizeWu: size, seed: 1, kind: 'bases' });
  // precompute timings (median of 3 builds)
  const statics: number[] = [];
  const derived: number[] = [];
  const stamps: number[] = [];
  let sn: StandaloneNav | null = null;
  for (let r = 0; r < 3; r++) {
    gc();
    const b = new ArenaBuilder();
    const regions = addNavRegions(b, defineNavRegions(size));
    const arena = b.build();
    const s: StandaloneNav = { arena, regions, nav: new Nav(regions) };
    let t0 = performance.now();
    s.nav.precomputeStatic(map);
    statics.push(performance.now() - t0);
    t0 = performance.now();
    s.nav.rebuildDerived();
    derived.push(performance.now() - t0);
    t0 = performance.now();
    for (const f of map.baseFootprints) s.nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
    stamps.push(performance.now() - t0);
    sn = s;
  }
  const s = sn!;
  const snap = s.arena.snapshot();
  const b = burst(s, snap, BUDGET, true);
  const build = baseBuilding(s, snap, map, BUDGET);
  const sweep: MapResult['sweep'] = [];
  if (!QUICK && size === 1024) {
    for (const bud of [20000, 30000, 40000, 60000, 80000, 120000]) {
      const r = burst(s, snap, bud, false);
      sweep.push({ budget: bud, ticks: Math.max(...r.ticks), p95: r.msPerTick.p95, max: r.msPerTick.max });
    }
  }
  return {
    sizeWu: size,
    name: map.name,
    memoryMiB: navMemoryBytes(size).total / 1048576,
    precompute: {
      staticMs: dist(statics).p50,
      derivedMs: dist(derived).p50,
      stampsMs: dist(stamps).p50,
      stamps: map.baseFootprints.length,
      sectors: s.nav.st.numSectors,
    },
    burst: b,
    build,
    sweep,
  };
}

function main(): void {
  const started = new Date();
  const results: MapResult[] = [];
  for (const size of [512, 1024]) results.push(runMap(size));
  const cpu = cpus()[0]?.model ?? 'unknown';
  const report = {
    date: started.toISOString(),
    quick: QUICK,
    budget: BUDGET,
    machine: { cpu, cores: cpus().length, node: process.version, loadavg: loadavg() },
    note: 'lokal gemessen (Apple M5 Pro), Node; ms-Werte maschinenabhängig (DECISIONS 5/16)',
    results,
  };
  const dir = resolve(import.meta.dirname, 'results');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `spk3-${started.toISOString().slice(0, 10)}${QUICK ? '-quick' : ''}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

  const L: string[] = [];
  L.push(`SPK3 (Nav-Ebene), ${QUICK ? 'quick' : 'voll'}, Budget ${int(BUDGET)} Expansionen/Tick, ${cpu}, Node ${process.version}, Load ${loadavg().map((v) => v.toFixed(1)).join('/')}`);
  L.push('');
  L.push('| Karte | Nav-Speicher | Precompute statisch | abgeleitet | Basen gestempelt (Anzahl, gesamt) | Sektoren |');
  L.push('|---|---|---|---|---|---|');
  for (const r of results) {
    L.push(`| ${r.sizeWu} WU | ${f2(r.memoryMiB)} MiB | ${f2(r.precompute.staticMs)} ms | ${f2(r.precompute.derivedMs)} ms | ${r.precompute.stamps}, ${f2(r.precompute.stampsMs)} ms | ${r.precompute.sectors} |`);
  }
  L.push('');
  L.push('| Karte | Ticks bis alle 200 fertig (je Lauf) | ms/Tick p50 / p95 / max (warm) | kalt p95 / max | Expansionen/Tick p95 | Expansionen/Anfrage p50 / p95 / max | ms/Anfrage | HPA*/Optimum p50 / p95 / max (≤ 1,10) | Direct / Fallback / Retarget |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const b = r.burst;
    L.push(
      `| ${r.sizeWu} WU | ${b.ticks.join(', ')} | ${f2(b.msPerTick.p50)} / **${f2(b.msPerTick.p95)}** / ${f2(b.msPerTick.max)} | ${f2(b.msPerTickCold.p95)} / ${f2(b.msPerTickCold.max)} | ${int(b.expPerTick.p95)} | ${int(b.expPerRequest.p50)} / ${int(b.expPerRequest.p95)} / ${int(b.expPerRequest.max)} | ${f3(b.msPerRequest)} | ${f3(b.suboptimality.p50)} / ${f3(b.suboptimality.p95)} / ${f3(b.suboptimality.max)} (${f2(100 * b.within110)} %) | ${b.direct} / ${b.fallback} / ${b.retargeted} |`,
    );
  }
  L.push('');
  L.push('| Karte | Footprints | Repaths je Footprint Ø / p95 / max | Pfade mit ≥ 1 Repath | Stempeln ms p50 / max | Pathing ms/Tick p95 / max | Anfragen (Repaths) |');
  L.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const b = r.build;
    L.push(
      `| ${r.sizeWu} WU | ${b.footprints} | ${f2(b.repathsPerFootprint.mean)} / ${b.repathsPerFootprint.p95} / ${b.repathsPerFootprint.max} | ${f2(100 * b.pathsTouchedShare)} % | ${f2(b.stampMs.p50)} / ${f2(b.stampMs.max)} | ${f2(b.msPerTick.p95)} / ${f2(b.msPerTick.max)} | ${b.requests} |`,
    );
  }
  for (const r of results) {
    if (r.sweep.length === 0) continue;
    L.push('');
    L.push(`Budget-Sweep ${r.sizeWu} WU (200 Anfragen):`);
    L.push('');
    L.push('| Budget | Ticks (max) | ms/Tick p95 | max |');
    L.push('|---|---|---|---|');
    for (const w of r.sweep) L.push(`| ${int(w.budget)} | ${w.ticks} | ${f2(w.p95)} | ${f2(w.max)} |`);
  }
  console.log(L.join('\n'));
  console.log(`\nBericht: ${file}`);
  // machine-independent sanity (always): all served within 10 ticks at the constant budget on 1,024 WU
  const r1024 = results.find((r) => r.sizeWu === 1024)!;
  const worstTicks = Math.max(...r1024.burst.ticks);
  if (BUDGET === NAV_BUDGET_EXPANSIONS_PER_TICK && worstTicks > 10) {
    console.error(`SPK3: 200 requests on 1,024 WU need ${worstTicks} ticks (> 10)`);
    process.exitCode = 1;
  }
  if (process.env['FAF_PERF_GATE'] === '1' && r1024.burst.msPerTick.p95 > 5) {
    console.error(`SPK3: pathing p95 ${r1024.burst.msPerTick.p95.toFixed(2)} ms/tick > 5 ms (FAF_PERF_GATE=1)`);
    process.exitCode = 1;
  }
}

main();
