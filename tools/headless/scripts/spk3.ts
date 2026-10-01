/** SPK3: HPA* request burst and a sim-only alternative chunk-entry invalidation experiment. */
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { PATH_F_REPATH, PATH_READY, PATH_DIRECT, NAV_BUDGET_EXPANSIONS_PER_TICK } from '@faf/nav';
import { step, unitHandles, unitInfo, pathStats, PhaseId, type PhaseProbe } from '@faf/sim';
import { navTestRtsMap } from '../src/maps.ts';
import { endpoints, requestBurst, distribution, world, spawn, move } from './ms3.ts';
import { machine, RESULTS_DIR, writeText } from './lib.ts';

const quick = process.argv.includes('--quick');
const only = process.argv.find((a) => a.startsWith('--strategy='))?.slice(11);
if (only !== undefined && only !== 'corridor' && only !== 'chunk-entry') throw new Error('strategy must be corridor or chunk-entry');
const strategies = only === undefined ? ['corridor', 'chunk-entry'] as const : [only as 'corridor' | 'chunk-entry'];
const ticks = quick ? 600 : 1800;

function experiment(size: 512 | 1024, strategy: 'corridor' | 'chunk-entry', building: boolean) {
  const generated = navTestRtsMap('bases', size, 73);
  const w = world(generated.map);
  for (const f of generated.nav.baseFootprints) w.nav.stampFootprint(f.x, f.z, f.w, f.h, 1);
  const req = endpoints(w);
  const tank = w.bp.indexOf('core:lnd_t1_tank');
  step(w, req.map((p, i) => spawn(w, tank, p.sx, p.sz, i % 2)));
  const hs = unitHandles(w);
  step(w, hs.map((h, i) => move([h], req[i]!.tx, req[i]!.tz, i % 2)));
  const sectors = size / 32;
  const versions = new Int32Array(sectors * sectors);
  const planned = new Int32Array(w.nav.st.paths.cap);
  const previousSector = new Int32Array(hs.length).fill(-1);
  const tickMs: number[] = []; const pathMs: number[] = []; const stampMs: number[] = [];
  const first = hs.map((h) => unitInfo(w, h)!); const firstMove = new Int32Array(hs.length).fill(-1);
  let epoch = 0; let lazyTriggers = 0; let footprints = 0; let stuckUnitTicks = 0;
  const requests0 = w.nav.requestsIssued; const repaths0 = w.nav.repathsTriggered;
  let pathStart = 0;
  const probe: PhaseProbe = { begin(p) { if (p === PhaseId.PathService) pathStart = performance.now(); }, end(p) { if (p === PhaseId.PathService) pathMs.push(performance.now() - pathStart); } };
  for (let tick = 1; tick <= ticks; tick++) {
    if (building && tick % 10 === 0) {
      const anchor = unitInfo(w, hs[(tick * 7) % hs.length]!)!;
      const x = Math.max(4, Math.min(size - 10, (anchor.x >> 12) + 5));
      const z = Math.max(4, Math.min(size - 10, (anchor.z >> 12) + 5));
      const t = performance.now(); w.nav.stampFootprint(x, z, 3, 3, 1); stampMs.push(performance.now() - t); footprints++; epoch++;
      if (strategy === 'chunk-entry') {
        // Bench-only alternative: suppress eager corridor marks, version all affected chunks.
        // Native lazy refinement/collision checks remain active. No production sim option is added.
        const paths = w.nav.st.paths;
        for (let p = 0; p < paths.highWater; p++) if (paths.alive[p] === 1) paths.col.flags[p] = paths.col.flags[p]! & ~PATH_F_REPATH;
        for (let cz = Math.max(0, (z - 3) >> 5); cz <= Math.min(sectors - 1, (z + 6) >> 5); cz++) {
          for (let cx = Math.max(0, (x - 3) >> 5); cx <= Math.min(sectors - 1, (x + 6) >> 5); cx++) versions[cz * sectors + cx] = epoch;
        }
      }
    }
    if (strategy === 'chunk-entry') {
      for (let i = 0; i < hs.length; i++) {
        const u = unitInfo(w, hs[i]!)!;
        const sector = (u.z >> 17) * sectors + (u.x >> 17);
        if (u.path >= 0 && previousSector[i] !== sector && versions[sector]! > planned[u.path]!) {
          const state = w.nav.pathState(u.path);
          if (state === PATH_READY || state === PATH_DIRECT) { w.nav.st.paths.col.flags[u.path] = w.nav.pathFlags(u.path) | PATH_F_REPATH; lazyTriggers++; planned[u.path] = epoch; }
        }
        previousSector[i] = sector;
      }
    }
    const t = performance.now(); step(w, null, probe); tickMs.push(performance.now() - t);
    for (let i = 0; i < hs.length; i++) {
      const u = unitInfo(w, hs[i]!)!;
      if (firstMove[i]! < 0 && (u.x !== first[i]!.x || u.z !== first[i]!.z)) firstMove[i] = tick;
      const row = w.units.col.mover[u.slot]!;
      if (row >= 0 && w.movers.col.stuck[row]! >= 20) stuckUnitTicks++;
    }
  }
  const stats = pathStats(w);
  return { size, strategy, scenario: building ? 'base-building' : 'two-armies', ticks, units: hs.length, footprints, requests: w.nav.requestsIssued - requests0, corridorMarks: w.nav.repathsTriggered - repaths0, lazyTriggers, stuckUnitTicks, stuckUnitTicksPerMinute: stuckUnitTicks * 600 / ticks, giveUps: stats.stuckGiveUps, firstMoveTicks: distribution(Array.from(firstMove)), tickMs: distribution(tickMs), pathMs: distribution(pathMs), stampMs: distribution(stampMs) };
}

const bursts = [requestBurst(512), requestBurst(1024)];
const experiments = [];
for (const size of [512, 1024] as const) for (const strategy of strategies) for (const building of [true, false]) {
  console.log(`SPK3 ${size} ${strategy} ${building ? 'base-building' : 'two-armies'}`);
  experiments.push(experiment(size, strategy, building)); globalThis.gc?.();
}
const problems = bursts.filter((b) => b.ready !== 200 || b.requests !== 200 || b.ticks > 10).map((b) => `burst ${b.size} failed`);
if (process.env['FAF_PERF_GATE'] === '1') for (const b of bursts) if (b.phaseMs.p95 > 5) problems.push(`PathService ${b.size} p95 ${b.phaseMs.p95} > 5 ms`);
const report = { format: 'faf-spk3-sim', date: new Date().toISOString(), machine: machine(), node: process.version, loadAverage: loadavg(), quick, budget: NAV_BUDGET_EXPANSIONS_PER_TICK, bursts, experiments, problems,
  alternative: 'Bench-only chunk versions with eager corridor flags suppressed; invalidate on entering a changed chunk. Native lazy refinement and collision protection retained. Stamp CPU includes corridor detection in both modes, so stamp timings do not measure the cost of removing its index.' };
const file = resolve(RESULTS_DIR, `spk3-${Date.now()}.json`); writeText(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ file, bursts, experiments, problems }, null, 2));
if (problems.length > 0) process.exitCode = 1;
