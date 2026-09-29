/**
 * Node tick benchmark of the sim host (PLAN §3.12 L6, MS1/MS2 acceptance "Sim p95 ≤ 2 ms inkl.
 * Hash-Tick"): 1,000 driving cubes with continuously new move targets on hollow-ridge (MS2; flag
 * `--testplane` = the flat MS1 plane), measured through the real host tick path (LocalSource → recorder → sim.step with phase probe → keyframes → frame writing
 * into the SAB triple buffer). p50/p95/p99 per phase, for the whole step, the hash tick, frame
 * and host overhead.
 *
 * Run: pnpm --filter @faf/sim-host bench [-- --ticks 10000 --warmup 1000 --testplane]
 * Output: table on stdout + JSON in packages/sim-host/bench/results/node-<date>.json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { asArmyId, asTick, fx, type Handle } from '@faf/fixed';
import {
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
import { ACTIVE_PHASES, unitHandles } from '@faf/sim';
import { emptySummary, Metric, METRIC_NAMES, SimHost, type PercentileSummary } from '../src/index.ts';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

const TICKS = arg('ticks', 10_000);
const WARMUP = arg('warmup', 1_000);
const UNITS = 1000;
const GROUPS = 10;
/** A new target for one group every RETARGET ticks ⇒ every group gets a new target every 200 ticks. */
const RETARGET = 20;
const BUDGET_P95_MS = 2;

const simBinBytes = readFileSync(fileURLToPath(new URL('../../../content/generated/sim.bin', import.meta.url)));
const simBin = new ArrayBuffer(simBinBytes.length);
new Uint8Array(simBin).set(simBinBytes);
const TEST_PLANE = process.argv.includes('--testplane');
// The test plane is a generated map (formats createTestPlaneMap) sent as .rtsmap bytes like any map.
const mapBytes = TEST_PLANE ? writeRtsMap(createTestPlaneMap()) : readFileSync(fileURLToPath(new URL('../../../content/maps/hollow-ridge.rtsmap', import.meta.url)));
const map = new Uint8Array(mapBytes).slice().buffer;
/** Spawn disc and target square (WU): hollow-ridge keeps both on the NW side of the river. */
const SPAWN = TEST_PLANE ? { x: 256, z: 256, spread: 90 } : { x: 150, z: 150, spread: 70 };
const AREA = TEST_PLANE ? { min: 24, span: 464 } : { min: 40, span: 160 };

const cap = frameCapacityBytes(DEFAULT_FRAME_CAPS);
const sab = createSabFrameBuffer(cap);
const host = new SimHost({ post: () => undefined, opfs: null, autoStart: false, statsWindow: TICKS, logCapacity: 8 << 20 });
host.init({ t: 'init', simBin, seed: 20260928, armyCount: 2, playerArmy: 0, transport: 'sab', frameSab: sab, frameCapacity: cap, buildHash: 'bench', map });
const consumer = createSabConsumer(sab);

const spawn: CommandEnvelope = {
  tick: asTick(0),
  army: asArmyId(0),
  seq: 1,
  op: Op.Cheat,
  flags: 0,
  units: [],
  payload: encodeCheatSpawn({ bp: 0, army: 0, count: UNITS, x: fx(SPAWN.x), z: fx(SPAWN.z), spread: fx(SPAWN.spread) }),
};
host.submit(encodeBatch([spawn]));
host.runTicks(1);
const handles = unitHandles(host.core.world, 0);
const perGroup = UNITS / GROUPS;

/** Pre-built retarget batches (one group each), cycled. */
const batches: Uint8Array[] = [];
for (let k = 0; k < 97; k++) {
  const g = k % GROUPS;
  const a = Math.imul(k + 1, 0x9e3779b1) >>> 0;
  const units: Handle[] = handles.slice(g * perGroup, (g + 1) * perGroup);
  batches.push(
    encodeBatch([
      {
        tick: asTick(0),
        army: asArmyId(0),
        seq: (k + 2) & 0xffff,
        op: Op.Move,
        flags: 0,
        units,
        payload: encodeMove({ x: fx(AREA.min + (a % AREA.span)), y: fx(0), z: fx(AREA.min + ((a >>> 11) % AREA.span)) }),
      },
    ]),
  );
}

let k = 0;
let moving = 0;
function run(n: number): void {
  for (let i = 0; i < n; i++) {
    if (host.tick % RETARGET === 0) host.submit(batches[k++ % batches.length]!);
    host.runTicks(1);
    consumer.poll();
  }
}

run(WARMUP);
host.stats.reset();
const t0 = performance.now();
let movingSamples = 0;
for (let done = 0; done < TICKS; done += 1000) {
  run(Math.min(1000, TICKS - done));
  const M = host.core.world.movers;
  for (let r = 0; r < M.count; r++) if (M.col.speed[r]! > 0) moving++;
  movingSamples++;
}
const wall = performance.now() - t0;

interface Row {
  metric: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  meanMs: number;
}
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

const f = (v: number): string => v.toFixed(3).padStart(8);
console.log(`sim-host tick bench (${host.core.mapName}) — node ${process.version}, ${os.cpus()[0]?.model ?? 'cpu?'}, ${TICKS} ticks (+${WARMUP} warm-up), ${host.core.world.units.liveCount} cubes, avg moving ${(moving / movingSamples).toFixed(0)}`);
console.log(`${'metric'.padEnd(28)} ${'p50 ms'.padStart(8)} ${'p95 ms'.padStart(8)} ${'p99 ms'.padStart(8)} ${'max ms'.padStart(8)} ${'mean ms'.padStart(8)}  samples`);
for (const r of rows) console.log(`${r.metric.padEnd(28)} ${f(r.p50Ms)} ${f(r.p95Ms)} ${f(r.p99Ms)} ${f(r.maxMs)} ${f(r.meanMs)}  ${r.samples}`);
const step = rows[0]!;
const pass = step.p95Ms <= BUDGET_P95_MS;
console.log(`MS2 budget: sim p95 ${step.p95Ms.toFixed(3)} ms ≤ ${BUDGET_P95_MS} ms (incl. hash tick) → ${pass ? 'PASS' : 'FAIL'}; wall ${wall.toFixed(0)} ms (${(wall / TICKS).toFixed(3)} ms/tick incl. host + frame)`);

const date = new Date().toISOString().slice(0, 10);
const outDir = fileURLToPath(new URL('./results/', import.meta.url));
mkdirSync(outDir, { recursive: true });
const out = {
  bench: 'sim-host/tick',
  date: new Date().toISOString(),
  engine: 'node',
  map: host.core.mapName,
  node: process.version,
  v8: process.versions.v8,
  platform: `${os.platform()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model ?? null,
  note: `lokal gemessen (${os.cpus()[0]?.model ?? 'unbekannte CPU'}), nicht Referenz-Laptop`,
  ticks: TICKS,
  warmup: WARMUP,
  units: host.core.world.units.liveCount,
  avgMoving: moving / movingSamples,
  retargetEveryTicks: RETARGET,
  budgetP95Ms: BUDGET_P95_MS,
  pass,
  wallMsPerTick: wall / TICKS,
  rows,
};
const file = `${outDir}node-${date}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`→ ${file}`);
host.dispose();
if (!pass) process.exitCode = 1;
