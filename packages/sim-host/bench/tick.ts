/**
 * Node tick benchmark of the sim host (PLAN §3.12 L6), measured through the real host tick path
 * (LocalSource → recorder → sim.step with phase probe → keyframes → frame writing into the SAB
 * triple buffer). p50/p95/p99 per phase, for the whole step, the hash tick, frame and host
 * overhead. Two scenarios on hollow-ridge (flag `--testplane`: the flat MS1 plane for `ms2`):
 *
 * - `ms2`: 1,000 driving cubes with continuously new move targets on the NW side of the river
 *   (MS2 acceptance "Sim p95 ≤ 2 ms inkl. Hash-Tick"; MS3 adds pathing to every move).
 * - `ms3`: 1,000 blueprint tanks (classes 1–3, two armies) driving across the whole map with
 *   HPA* pathing: 10 groups of 100, one group gets a new target (group order, sometimes queued)
 *   every 20 ticks — routes over ramps and fords, group offsets, stuck handling (MS3 acceptance
 *   "1.000 fahrende Units: Sim p95 ≤ 8 ms"). PathService and Movement are reported separately.
 *
 * ms budgets are machine dependent (DECISIONS 16): reported always, gated (exit 1) only with
 * FAF_PERF_GATE=1. Machine-independent checks (units moving, path requests) always gate.
 *
 * Run: pnpm --filter @faf/sim-host bench [-- --ticks 10000 --warmup 2000 --scenario ms3 --testplane]
 * Output: table on stdout + JSON in packages/sim-host/bench/results/node-<date>.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import {
  CmdFlags,
  createSabConsumer,
  createSabFrameBuffer,
  DEFAULT_FRAME_CAPS,
  encodeBatch,
  encodeCheatSpawn,
  encodeMove,
  frameCapacityBytes,
  Op,
  type CommandEnvelope,
} from '@faf/protocol';
import { createTestPlaneMap, writeRtsMap } from '@faf/formats';
import { ACTIVE_PHASES, unitHandles, WH_STUCK_GIVEUPS } from '@faf/sim';
import { emptySummary, Metric, METRIC_NAMES, SimHost, type HostReadyMsg, type PercentileSummary } from '../src/index.ts';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}
function argStr(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : def;
}

const TICKS = arg('ticks', 10_000);
const WARMUP = arg('warmup', 2_000);
const SCENARIO = argStr('scenario', 'all');
const PERF_GATE = process.env['FAF_PERF_GATE'] === '1';
const TEST_PLANE = process.argv.includes('--testplane');

const simBinBytes = readFileSync(fileURLToPath(new URL('../../../content/generated/sim.bin', import.meta.url)));
const ridgeBytes = readFileSync(fileURLToPath(new URL('../../../content/maps/hollow-ridge.rtsmap', import.meta.url)));

interface Row {
  metric: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
}

interface ScenarioResult {
  scenario: string;
  map: string;
  units: number;
  avgMoving: number;
  budgetP95Ms: number;
  pass: boolean;
  wallMsPerTick: number;
  requestsIssued: number;
  stuckGiveUps: number;
  navPrecomputeMs: number;
  rows: Row[];
}

interface Driver {
  /** Called before every tick with the host; may submit commands. */
  beforeTick(host: SimHost): void;
}

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(b.length);
  new Uint8Array(out).set(b);
  return out;
}

function makeHost(mapBytes: Uint8Array, ticks: number): { host: SimHost; consumer: ReturnType<typeof createSabConsumer>; ready: HostReadyMsg } {
  const cap = frameCapacityBytes(DEFAULT_FRAME_CAPS);
  const sab = createSabFrameBuffer(cap);
  let ready: HostReadyMsg | null = null;
  const host = new SimHost({
    post: (m) => {
      if (m.t === 'ready') ready = m as HostReadyMsg;
    },
    opfs: null,
    autoStart: false,
    statsWindow: ticks,
    logCapacity: 8 << 20,
  });
  host.init({ t: 'init', simBin: toArrayBuffer(simBinBytes), seed: 20260928, armyCount: 2, playerArmy: 0, transport: 'sab', frameSab: sab, frameCapacity: cap, buildHash: 'bench', map: toArrayBuffer(mapBytes) });
  return { host, consumer: createSabConsumer(sab), ready: ready! };
}

function spawnEnv(army: number, seq: number, bp: number, count: number, x: number, z: number, spread: number): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq, op: Op.Cheat, flags: 0, units: [], payload: encodeCheatSpawn({ bp, army, count, x: fx(x), z: fx(z), spread: fx(spread) }) };
}

function moveEnv(army: number, seq: number, units: readonly Handle[], x: number, z: number, flags = 0): CommandEnvelope {
  return { tick: asTick(0), army: asArmyId(army), seq: seq & 0xffff, op: Op.Move, flags, units, payload: encodeMove({ x: fx(x), y: fx(0), z: fx(z) }) };
}

/** MS2 load: 1,000 cubes, a new target for one of 10 groups every 20 ticks. */
function setupMs2(host: SimHost): Driver {
  const spawn = TEST_PLANE ? { x: 256, z: 256, spread: 90 } : { x: 150, z: 150, spread: 70 };
  const area = TEST_PLANE ? { min: 24, span: 464 } : { min: 40, span: 160 };
  host.submit(encodeBatch([spawnEnv(0, 1, 0, 1000, spawn.x, spawn.z, spawn.spread)]));
  host.runTicks(1);
  const handles = unitHandles(host.core.world, 0);
  const per = Math.floor(handles.length / 10);
  const batches: Uint8Array[] = [];
  for (let k = 0; k < 97; k++) {
    const g = k % 10;
    const a = Math.imul(k + 1, 0x9e3779b1) >>> 0;
    batches.push(encodeBatch([moveEnv(0, k + 2, handles.slice(g * per, (g + 1) * per), area.min + (a % area.span), area.min + ((a >>> 11) % area.span))]));
  }
  let k = 0;
  return {
    beforeTick(h) {
      if (h.tick % 20 === 0) h.submit(batches[k++ % batches.length]!);
    },
  };
}

/** MS3 load: 1,000 tanks (classes 1–3) of two armies across hollow-ridge with pathing. */
function setupMs3(host: SimHost): Driver {
  // Spawn discs without cliffs (no rejected points): both start plateaus.
  host.submit(
    encodeBatch([
      spawnEnv(0, 1, 4, 300, 100, 100, 20),
      spawnEnv(0, 2, 5, 150, 100, 100, 20),
      spawnEnv(0, 3, 6, 50, 100, 100, 20),
      spawnEnv(1, 1, 4, 300, 412, 412, 20),
      spawnEnv(1, 2, 5, 150, 412, 412, 20),
      spawnEnv(1, 3, 6, 50, 412, 412, 20),
    ]),
  );
  host.runTicks(1);
  const w = host.core.world;
  const armies = [unitHandles(w, 0), unitHandles(w, 1)];
  // Groups of 100 (mixed classes: interleave the handles by index).
  const groups: { army: number; units: Handle[] }[] = [];
  for (let a = 0; a < 2; a++) {
    const hs = armies[a]!;
    for (let g = 0; g < 5; g++) groups.push({ army: a, units: hs.filter((_, i) => i % 5 === g) });
  }
  // Cross-map targets: plateaus, lowland, mesas, both fords (hollow-ridge layout).
  const targets = [
    [402, 402],
    [110, 110],
    [150, 380],
    [380, 150],
    [256, 120],
    [120, 256],
    [300, 330],
    [200, 180],
    [356, 156],
    [156, 356],
  ] as const;
  const seqs = [10, 10];
  let k = 0;
  // Initial orders: everyone drives from the first measured tick on.
  const init: CommandEnvelope[] = [];
  groups.forEach((g, i) => {
    const [x, z] = targets[(i * 3 + 1) % targets.length]!;
    init.push(moveEnv(g.army, seqs[g.army]!++, g.units, x, z));
  });
  host.submit(encodeBatch(init));
  return {
    beforeTick(h) {
      if (h.tick % 20 !== 0) return;
      const g = groups[k % groups.length]!;
      // A different target on every visit of the group (round r = k / 10): long cross-map routes.
      const [x, z] = targets[(k * 7 + Math.floor(k / groups.length) * 3 + 3) % targets.length]!;
      // Every third order is queued behind the current one (Shift), the rest replace it.
      h.submit(encodeBatch([moveEnv(g.army, seqs[g.army]!++, g.units, x, z, k % 3 === 2 ? CmdFlags.Queue : 0)]));
      k++;
    },
  };
}

function runScenario(name: 'ms2' | 'ms3'): ScenarioResult {
  const mapBytes = name === 'ms2' && TEST_PLANE ? writeRtsMap(createTestPlaneMap()) : new Uint8Array(ridgeBytes);
  const { host, consumer, ready } = makeHost(mapBytes, TICKS);
  const driver = name === 'ms2' ? setupMs2(host) : setupMs3(host);
  let moving = 0;
  let movingSamples = 0;
  const run = (n: number): void => {
    for (let i = 0; i < n; i++) {
      driver.beforeTick(host);
      host.runTicks(1);
      consumer.poll();
    }
  };
  run(WARMUP);
  host.stats.reset();
  const nav = host.core.world.nav;
  const req0 = nav.requestsIssued;
  const t0 = performance.now();
  for (let done = 0; done < TICKS; done += 500) {
    run(Math.min(500, TICKS - done));
    const M = host.core.world.movers;
    for (let r = 0; r < M.count; r++) if (M.col.speed[r]! > 0) moving++;
    movingSamples++;
  }
  const wall = performance.now() - t0;
  const rows: Row[] = [];
  const sum: PercentileSummary = emptySummary();
  const metrics = [Metric.Tick, ...ACTIVE_PHASES, Metric.HashTick, Metric.Frame, Metric.Host];
  for (const m of metrics) {
    host.stats.summarize(m, sum);
    rows.push({
      metric: m === Metric.Tick ? 'Sim step (incl. hash tick)' : m === Metric.HashTick ? 'HashTick (hash ticks only)' : METRIC_NAMES[m]!,
      samples: sum.count,
      p50Ms: sum.p50 / 1000,
      p95Ms: sum.p95 / 1000,
      p99Ms: sum.p99 / 1000,
      maxMs: sum.max / 1000,
      meanMs: sum.mean / 1000,
    });
  }
  const budget = name === 'ms2' ? 2 : 8;
  const step = rows[0]!;
  const res: ScenarioResult = {
    scenario: name,
    map: host.core.mapName,
    units: host.core.world.units.liveCount,
    avgMoving: moving / movingSamples,
    budgetP95Ms: budget,
    pass: step.p95Ms <= budget,
    wallMsPerTick: wall / TICKS,
    requestsIssued: nav.requestsIssued - req0,
    stuckGiveUps: host.core.world.header.i32[WH_STUCK_GIVEUPS]!,
    navPrecomputeMs: ready.navStaticMs + ready.navDerivedMs,
    rows,
  };
  host.dispose();
  return res;
}

const f = (v: number): string => v.toFixed(3).padStart(8);
const results: ScenarioResult[] = [];
const scenarios: ('ms2' | 'ms3')[] = SCENARIO === 'all' ? ['ms2', 'ms3'] : [SCENARIO as 'ms2' | 'ms3'];
const failures: string[] = [];
for (const sc of scenarios) {
  const r = runScenario(sc);
  results.push(r);
  console.log(
    `\nsim-host tick bench [${sc}] (${r.map}) — node ${process.version}, ${os.cpus()[0]?.model ?? 'cpu?'}, ${TICKS} ticks (+${WARMUP} warm-up), ${r.units} units, avg moving ${r.avgMoving.toFixed(0)}, ` +
      `path requests ${r.requestsIssued}, nav precompute ${r.navPrecomputeMs.toFixed(1)} ms`,
  );
  console.log(`${'metric'.padEnd(28)} ${'p50 ms'.padStart(8)} ${'p95 ms'.padStart(8)} ${'p99 ms'.padStart(8)} ${'max ms'.padStart(8)} ${'mean ms'.padStart(8)}  samples`);
  for (const row of r.rows) console.log(`${row.metric.padEnd(28)} ${f(row.p50Ms)} ${f(row.p95Ms)} ${f(row.p99Ms)} ${f(row.maxMs)} ${f(row.meanMs)}  ${row.samples}`);
  const stepRow = r.rows[0]!;
  console.log(
    `${sc === 'ms2' ? 'MS2' : 'MS3'} budget: sim p95 ${stepRow.p95Ms.toFixed(3)} ms ≤ ${r.budgetP95Ms} ms (incl. hash tick) → ${r.pass ? 'PASS' : 'MISSED'}` +
      `${PERF_GATE ? '' : ' (reported only; gate with FAF_PERF_GATE=1)'}; wall ${r.wallMsPerTick.toFixed(3)} ms/tick incl. host + frame`,
  );
  // Machine-independent checks: the load is real.
  if (r.avgMoving < 300) failures.push(`${sc}: only ${r.avgMoving.toFixed(0)} units moving on average`);
  if (sc === 'ms3' && r.requestsIssued < TICKS / 20) failures.push(`${sc}: only ${r.requestsIssued} path requests`);
  if (PERF_GATE && !r.pass) failures.push(`${sc}: p95 ${stepRow.p95Ms.toFixed(3)} ms > ${r.budgetP95Ms} ms`);
}

const date = new Date().toISOString().slice(0, 10);
const outDir = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const out = {
  bench: 'sim-host/tick',
  date: new Date().toISOString(),
  engine: 'node',
  node: process.version,
  v8: process.versions.v8,
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model ?? null,
  loadAverage: os.loadavg(),
  note: `lokal gemessen (${os.cpus()[0]?.model ?? 'unbekannte CPU'}), nicht Referenz-Laptop`,
  ticks: TICKS,
  warmup: WARMUP,
  perfGate: PERF_GATE,
  scenarios: results,
};
const file = `${outDir}node-${date}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`\n→ ${file}`);
if (failures.length > 0) {
  console.error(`✗ ${failures.join('\n✗ ')}`);
  process.exitCode = 1;
}
