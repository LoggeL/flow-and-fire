/**
 * Node benchmark 'Gefecht-200' of the audio engine (TRACK-AUDIOENG, audioeng-c1).
 *
 * Drives the real engine (router → alert queue → voice manager → mixer graph) over the battle
 * scenario of bench/scenario.ts against a minimal-overhead Web Audio stand-in
 * (bench/lean-context.ts): 30 s simulated at 60 fps with 10 Hz sim ticks, variants of
 * 100/200/400 weaponFire/s (impacts 0.75×, 8 deaths/s, one commanderDeath, three located
 * alerts, two keyed build loops). Per frame the engine JS time (handleEvents + update) is
 * measured with performance.now; reported are p50/p95/p99/max, peak voices, drops per reason,
 * steals and the warm heap delta.
 *
 * Budget: p95 ≤ 0.5 ms main-thread JS (PLAN §5.2 MS5). Measured locally, reported only
 * (DECISIONS 5 and 16); FAF_AUDIO_PERF_GATE=1 turns an exceeded budget into exit code 1.
 *
 * Run:  pnpm --filter @faf/audio bench [-- --quick] [-- --update-docs] [-- --runs 3] [-- --seconds 60]
 * Output: table on stdout + JSON in packages/audio/bench/results/<ISO timestamp>.json
 * (git-ignored); `--update-docs` replaces the table between the markers
 * `<!-- bench:audio:start -->` / `<!-- bench:audio:end -->` in docs/status/audioeng-c1.md and
 * docs/status/track-audioeng.md (every file of the list that contains the markers).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAudioEngine, type FafAudioEngine } from '../src/engine/index.ts';
import { DROP_REASONS, type AudioManifest, type DropReason } from '../src/types.ts';
import { measureAllocation } from './heap.ts';
import { LeanAudioContext, LeanBuffer } from './lean-context.ts';
import { BattleDriver, BattleScenario, battleVisualName, mulberry32 } from './scenario.ts';

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function argNumber(name: string, def: number): number {
  const v = argValue(name);
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`--${name}: expected a positive number, got ${v}`);
  return n;
}

const QUICK = process.argv.includes('--quick');
const UPDATE_DOCS = process.argv.includes('--update-docs');
const SECONDS = argNumber('seconds', QUICK ? 5 : 30);
const RUNS = Math.round(argNumber('runs', 2));
const WARMUP_SECONDS = 3;
const FPS = 60;
const VARIANTS = [100, 200, 400] as const;
const BUDGET_P95_MS = 0.5;
const GATE = process.env.FAF_AUDIO_PERF_GATE === '1';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${repoRoot}content/audio/dist/manifest.json`, 'utf8')) as AudioManifest;
const gc = (globalThis as { gc?: () => void }).gc;

// ---------------------------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------------------------

interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

interface RunResult {
  shotsPerSecond: number;
  run: number;
  frames: number;
  events: number;
  eventsPerSecond: number;
  /** Engine JS per frame (handleEvents + update), measured by the driver. */
  frameMs: Percentiles;
  /** Engine JS per frame with sim events only (every 6th frame at 60 fps / 10 Hz). */
  eventFrameMs: Percentiles;
  /** Engine-internal ring (last 1024 frames; includes setListener/setLoop/play time). */
  engineRing: { samples: number; p50: number; p95: number; p99: number; max: number };
  peakVoices: number;
  peakLiveSources: number;
  played: number;
  stolen: number;
  dropped: Record<DropReason, number>;
  alertsVoiced: number;
  /**
   * Heap still live after the measured run compared to before (gc() before both readings; a
   * leak indicator, NOT allocation; bytes; null without --expose-gc).
   */
  retainedBytes: number | null;
  /**
   * Bytes allocated during the measured run, garbage included (bench/heap.ts). Includes the
   * scenario driver and the lean fake context's node objects per started voice.
   */
  allocatedBytes: number;
}

function percentiles(values: Float64Array, n: number): Percentiles {
  if (n === 0) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  const v = values.slice(0, n).sort();
  const at = (p: number): number => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))]!;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += v[i]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: v[n - 1]!, mean: sum / n };
}

function preload(engine: FafAudioEngine): void {
  const catalog = engine.catalog!;
  for (let i = 0; i < catalog.size; i++) {
    const s = catalog.manifestSound(i);
    for (let v = 0; v < s.variants.length; v++) catalog.setBuffer(i, v, new LeanBuffer(s.channels, s.variants[v]!.samples, 48000));
  }
}

async function runVariant(shotsPerSecond: number, run: number): Promise<RunResult> {
  const ctx = new LeanAudioContext();
  const engine = createAudioEngine({
    context: ctx,
    manifest,
    baseUrl: '/audio/',
    settingsStore: null,
    unlockTarget: null,
    visibilityDocument: null,
    clock: () => ctx.nowMs,
    random: mulberry32(17 + run),
    visualName: battleVisualName,
  });
  preload(engine);
  if (!(await engine.unlock())) throw new Error('bench: engine did not unlock');

  const warm = new BattleScenario({ seconds: WARMUP_SECONDS, fps: FPS, shotsPerSecond, seed: 1000 + run, alerts: [] });
  const warmDriver = new BattleDriver(engine, warm, { advance: (ms) => ctx.advance(ms), now: () => ctx.nowMs });
  for (let f = 0; f < warmDriver.frames; f++) warmDriver.step();

  const scenario = new BattleScenario({ seconds: SECONDS, fps: FPS, shotsPerSecond, seed: 1 + run, buildLoops: 0 });
  const frames = Math.round(SECONDS * FPS);
  const frameMs = new Float64Array(frames);
  const eventFrameMs = new Float64Array(frames);
  let eventFrames = 0;
  let peakVoices = 0;
  let peakLive = 0;
  const voices = engine.voices!;
  const driver = new BattleDriver(engine, scenario, {
    advance: (ms) => ctx.advance(ms),
    now: () => ctx.nowMs,
    timer: () => performance.now(),
    onFrame: (f, fed, ms) => {
      frameMs[f] = ms;
      if (fed) eventFrameMs[eventFrames++] = ms;
      const n = voices.voiceCount;
      if (n > peakVoices) peakVoices = n;
      const live = ctx.liveSources;
      if (live > peakLive) peakLive = live;
    },
  });
  // Build loops of the warm-up keep running (setLoop happened there); the listener too.
  engine.resetStats();
  const alertsBefore = engine.alerts!.stats.voiced;
  gc?.();
  gc?.();
  const heap0 = gc === undefined ? 0 : process.memoryUsage().heapUsed;
  const alloc = measureAllocation(() => {
    for (let f = 0; f < frames; f++) driver.step();
  });
  gc?.();
  gc?.();
  const retainedBytes = gc === undefined ? null : process.memoryUsage().heapUsed - heap0;

  const s = engine.stats();
  const events = scenario.counts.weaponFire + scenario.counts.impacts + scenario.counts.deaths + scenario.counts.commanderDeaths + scenario.counts.alerts;
  const result: RunResult = {
    shotsPerSecond,
    run,
    frames,
    events,
    eventsPerSecond: events / SECONDS,
    frameMs: percentiles(frameMs, frames),
    eventFrameMs: percentiles(eventFrameMs, eventFrames),
    engineRing: { samples: s.mainJs.samples, p50: s.mainJs.p50, p95: s.mainJs.p95, p99: s.mainJs.p99, max: s.mainJs.max },
    peakVoices,
    peakLiveSources: peakLive,
    played: s.played,
    stolen: s.stolen,
    dropped: { ...s.dropped },
    alertsVoiced: engine.alerts!.stats.voiced - alertsBefore,
    retainedBytes,
    allocatedBytes: alloc.allocatedBytes,
  };
  await engine.dispose();
  return result;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const f3 = (v: number): string => v.toFixed(4).replace('.', ',');
const kb = (b: number | null): string => (b === null ? 'n/a' : b >= 10 * 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

const DROP_SHORT: Record<DropReason, string> = {
  cooldown: 'cd',
  categoryLimit: 'cat',
  soundLimit: 'snd',
  globalLimit: 'glob',
  culled: 'cull',
  notLoaded: 'nl',
  unknownSound: 'unk',
  locked: 'lock',
  muted: 'mute',
};

function dropsCell(d: Record<DropReason, number>): string {
  const parts: string[] = [];
  for (const r of DROP_REASONS) if (d[r] > 0) parts.push(`${DROP_SHORT[r]} ${d[r]}`);
  return parts.length === 0 ? '0' : parts.join(' · ');
}

function table(results: readonly RunResult[], meta: { date: string; machine: string; node: string }): string {
  const lines: string[] = [];
  lines.push(
    `Lokal gemessen (${meta.machine}, Node ${meta.node}, ${meta.date}); ${SECONDS} s simuliert je Lauf, ${FPS} fps, 10-Hz-Ticks, ` +
      `${WARMUP_SECONDS} s Warm-up; schlanker Fake-Kontext (bench/lean-context.ts). Engine-JS = handleEvents + update je Frame in ms. ` +
      `Grenze p95 ≤ ${String(BUDGET_P95_MS).replace('.', ',')} ms wird nur gemeldet (DECISIONS 5/16).`,
  );
  lines.push('');
  lines.push('| Schüsse/s | Lauf | Events/s | JS p50 | JS p95 | JS p99 | JS max | p95 Event-Frames | Stimmen peak | gestartet | Steals | Drops (je Grund) | Heap gehalten | alloziert |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.shotsPerSecond} | ${r.run + 1} | ${Math.round(r.eventsPerSecond)} | ${f3(r.frameMs.p50)} | ${f3(r.frameMs.p95)} | ${f3(r.frameMs.p99)} | ${f3(r.frameMs.max)} | ` +
        `${f3(r.eventFrameMs.p95)} | ${r.peakVoices} | ${r.played} | ${r.stolen} | ${dropsCell(r.dropped)} | ${kb(r.retainedBytes)} | ${kb(r.allocatedBytes)} |`,
    );
  }
  lines.push('');
  lines.push('Drop-Kürzel: cd = cooldown, cat = categoryLimit, snd = soundLimit, glob = globalLimit, cull = culled (unhörbar), nl = notLoaded.');
  lines.push(
    '„Heap gehalten“ = nach gc() noch lebender Zuwachs (Leck-Indikator). „alloziert“ = während des Laufs allozierte Bytes inkl. Müll ' +
      '(bench/heap.ts, kein gc() vor dem zweiten Messwert) — enthält Szenario-Treiber und die Fake-Knoten je gestarteter Stimme; ' +
      'der Event-Pfad selbst ist allokationsfrei (test/router/alloc.test.ts, test/engine/alloc.test.ts).',
  );
  return lines.join('\n');
}

const DOC_FILES = ['docs/status/audioeng-c1.md', 'docs/status/track-audioeng.md'];

function updateDocs(markdown: string): void {
  const start = '<!-- bench:audio:start -->';
  const end = '<!-- bench:audio:end -->';
  let updated = 0;
  for (const rel of DOC_FILES) {
    const path = `${repoRoot}${rel}`;
    if (!existsSync(path)) continue;
    const doc = readFileSync(path, 'utf8');
    const a = doc.indexOf(start);
    const b = doc.indexOf(end);
    if (a < 0 || b < a) continue;
    writeFileSync(path, `${doc.slice(0, a + start.length)}\n${markdown}\n${doc.slice(b)}`);
    console.log(`updated ${path}`);
    updated++;
  }
  if (updated === 0) throw new Error(`--update-docs: markers ${start} / ${end} not found in ${DOC_FILES.join(', ')}`);
}

async function main(): Promise<void> {
  if (gc === undefined) console.warn('note: run with --expose-gc for the heap delta (pnpm bench does)');
  const results: RunResult[] = [];
  for (const shots of VARIANTS) {
    for (let run = 0; run < RUNS; run++) results.push(await runVariant(shots, run));
  }
  const date = new Date();
  const meta = {
    date: date.toISOString().slice(0, 10),
    machine: `${os.cpus()[0]?.model ?? os.arch()}`.trim(),
    node: process.versions.node,
  };
  const md = table(results, meta);
  console.log(md);

  const dir = fileURLToPath(new URL('./results/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = `${dir}${date.toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    file,
    JSON.stringify(
      {
        bench: 'audio-gefecht',
        localMeasurement: true,
        date: date.toISOString(),
        machine: meta.machine,
        cpus: os.cpus().length,
        node: meta.node,
        platform: `${os.platform()} ${os.release()}`,
        config: { seconds: SECONDS, warmupSeconds: WARMUP_SECONDS, fps: FPS, runs: RUNS, variants: VARIANTS, quick: QUICK },
        budgetP95Ms: BUDGET_P95_MS,
        results,
      },
      null,
      1,
    ),
  );
  console.log(`\nwrote ${file}`);
  if (UPDATE_DOCS) updateDocs(md);

  const over = results.filter((r) => r.shotsPerSecond === 200 && r.frameMs.p95 > BUDGET_P95_MS);
  if (over.length > 0) {
    const msg = `Gefecht-200: engine JS p95 ${over.map((r) => r.frameMs.p95.toFixed(3)).join('/')} ms > ${BUDGET_P95_MS} ms`;
    if (GATE) {
      console.error(`FAIL ${msg} (FAF_AUDIO_PERF_GATE=1)`);
      process.exitCode = 1;
    } else {
      console.warn(`note: ${msg} (reported only; gate with FAF_AUDIO_PERF_GATE=1)`);
    }
  }
}

await main();
