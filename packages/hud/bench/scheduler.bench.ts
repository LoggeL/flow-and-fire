/**
 * Node benchmark of the HUD binding path (hud-p5-root, DECISIONS 16: measurement, not a gate):
 * push + diff + signal writes of the HudScheduler for the perf-500 scenario (500 own units, multi selection
 * of 60 units / 24 types, flow details open, alerts, 800 minimap entries) over 3,000 sim ticks, plus ×3 speed,
 * paused (events only) and the minimap's dynamic drawing against a counting 2D-context stub. No DOM here –
 * the browser run (apps/hud-gallery perf.spec.ts) measures script + style/layout of the full HUD.
 *
 *   pnpm --filter @faf/hud bench            → console table + bench/results/scheduler.json
 *   pnpm --filter @faf/hud bench -- --ticks 6000
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effect } from '@preact/signals';
import { createHudScenario, createSnapshotGenerator } from '../src/demo/scenarios.ts';
import { DEFAULT_MINIMAP_PALETTE, blipSpriteSize, drawDynamicLayer, ghostSpriteSize } from '../src/hud/minimap/draw.ts';
import type { Ctx2D } from '../src/hud/minimap/draw.ts';
import { createHudModel } from '../src/model/index.ts';
import type { HudModel } from '../src/model/index.ts';
import { HudScheduler } from '../src/scheduler/HudScheduler.ts';
import { demoUnitCatalog } from '../src/demo/catalog.ts';

const CAT = demoUnitCatalog();

interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

function summarize(samples: readonly number[]): Summary {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0;
  const sum = s.reduce((a, b) => a + b, 0);
  return { n: s.length, mean: s.length > 0 ? sum / s.length : 0, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] ?? 0 };
}

function nowMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

function argValue(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Subscribes an effect to every signal of the sections the scheduler writes (like mounted components). */
function subscribeAll(model: HudModel): { readonly notifications: () => number; readonly dispose: () => void } {
  let count = 0;
  const sigs: { readonly value: unknown }[] = [];
  const collect = (o: object): void => {
    for (const v of Object.values(o)) {
      if (v !== null && typeof v === 'object' && 'peek' in v && 'value' in v) sigs.push(v as { readonly value: unknown });
      else if (v !== null && typeof v === 'object' && !ArrayBuffer.isView(v)) collect(v as object);
    }
  };
  for (const section of [model.eco, model.match, model.alerts, model.selection, model.factory, model.card, model.orders, model.strip, model.minimap]) collect(section);
  const disposers = sigs.map((s) =>
    effect(() => {
      void s.value;
      count++;
    }),
  );
  return { notifications: () => count, dispose: () => disposers.forEach((d) => d()) };
}

interface RunResult {
  readonly name: string;
  readonly speed: number;
  readonly paused: boolean;
  readonly ticks: number;
  readonly perTick: Summary;
  readonly writes: number;
  readonly writesPerTick: number;
  readonly passes: Readonly<Record<string, number>>;
  readonly notifications: number;
}

function run(name: string, ticks: number, speed: number, paused: boolean): RunResult {
  const scenario = createHudScenario('perf-500');
  const model = createHudModel({ units: CAT });
  model.eco.detailsOpen.value = true;
  let clock = 0;
  const scheduler = new HudScheduler(model, { now: () => clock, requestFrame: () => undefined, measure: true });
  const gen = createSnapshotGenerator(scenario);
  const subs = subscribeAll(model);
  scheduler.push(gen.current(), 0, speed, paused);
  scheduler.flush();
  const warmup = 100;
  const samples: number[] = [];
  for (let t = 0; t < ticks + warmup; t++) {
    clock += 100 / speed;
    const snap = paused ? gen.current() : gen.next();
    const t0 = nowMs();
    scheduler.push(snap, paused ? 0 : gen.tick, speed, paused);
    scheduler.flush();
    const t1 = nowMs();
    if (t >= warmup) samples.push(t1 - t0);
  }
  const notifications = subs.notifications();
  subs.dispose();
  return {
    name,
    speed,
    paused,
    ticks,
    perTick: summarize(samples),
    writes: scheduler.stats.writes,
    writesPerTick: scheduler.stats.writes / (ticks + warmup + 1),
    passes: { ...scheduler.stats.passes },
    notifications,
  };
}

/** Counting 2D-context stub: measures the JS side of the minimap's dynamic layer (path building, loops, stamps). */
function stubCtx(): Ctx2D & { calls: number } {
  const ctx = {
    calls: 0,
    fillStyle: '' as string | CanvasGradient | CanvasPattern,
    strokeStyle: '' as string | CanvasGradient | CanvasPattern,
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    clearRect() {
      ctx.calls++;
    },
    fillRect() {
      ctx.calls++;
    },
    beginPath() {
      ctx.calls++;
    },
    closePath() {
      ctx.calls++;
    },
    moveTo() {
      ctx.calls++;
    },
    lineTo() {
      ctx.calls++;
    },
    rect() {
      ctx.calls++;
    },
    arc() {
      ctx.calls++;
    },
    fill() {
      ctx.calls++;
    },
    stroke() {
      ctx.calls++;
    },
    drawImage() {
      ctx.calls++;
    },
  };
  return ctx;
}

function runMinimap(frames: number): { readonly perDraw: Summary; readonly entries: number; readonly callsPerDraw: number } {
  const scenario = createHudScenario('perf-500');
  const gen = createSnapshotGenerator(scenario);
  const ctx = stubCtx();
  const samples: number[] = [];
  let entries = 0;
  for (let f = 0; f < frames + 50; f++) {
    const s = gen.next();
    const mm = s.minimap;
    entries = mm.units.count;
    const t0 = nowMs();
    drawDynamicLayer(ctx, {
      size: 372,
      dpr: 2,
      mapSizeWu: mm.mapSizeWu,
      spots: mm.spots,
      showResources: true,
      units: mm.units,
      pings: mm.pings,
      nowS: s.timeS,
      palette: DEFAULT_MINIMAP_PALETTE,
      sprites: {
        blip: { image: {} as CanvasImageSource, size: blipSpriteSize(2) },
        ghostSelf: { image: {} as CanvasImageSource, size: ghostSpriteSize(2) },
        ghostEnemy: { image: {} as CanvasImageSource, size: ghostSpriteSize(2) },
      },
    });
    const t1 = nowMs();
    if (f >= 50) samples.push(t1 - t0);
  }
  return { perDraw: summarize(samples), entries, callsPerDraw: ctx.calls / (frames + 50) };
}

const ticks = argValue('--ticks', 3000);
const runs = [run('perf-500 ×1', ticks, 1, false), run('perf-500 ×3', ticks, 3, false), run('perf-500 paused', ticks, 1, true)];
const mm = runMinimap(Math.round(ticks / 2.5));

const fmt = (v: number): string => v.toFixed(4);
console.log(`\nHUD scheduler benchmark (Node ${process.version}, ${platform()} ${release()}, ${cpus()[0]?.model ?? '?'}) – lokal gemessen, kein Referenz-Laptop`);
console.table(
  runs.map((r) => ({
    run: r.name,
    ticks: r.ticks,
    'mean ms': fmt(r.perTick.mean),
    'p50 ms': fmt(r.perTick.p50),
    'p95 ms': fmt(r.perTick.p95),
    'p99 ms': fmt(r.perTick.p99),
    'max ms': fmt(r.perTick.max),
    'writes/tick': r.writesPerTick.toFixed(1),
    'eco/hot/map/fog/slow/event': `${r.passes['eco']}/${r.passes['hot']}/${r.passes['map']}/${r.passes['fog']}/${r.passes['slow']}/${r.passes['event']}`,
  })),
);
console.table([
  {
    run: 'minimap dynamic layer (stub ctx, JS only)',
    draws: mm.perDraw.n,
    entries: mm.entries,
    'p50 ms': fmt(mm.perDraw.p50),
    'p95 ms': fmt(mm.perDraw.p95),
    'p99 ms': fmt(mm.perDraw.p99),
    'calls/draw': mm.callsPerDraw.toFixed(0),
  },
]);

const out = {
  date: new Date().toISOString(),
  note: 'lokal gemessen (Apple M5 Pro), kein Referenz-Laptop; Messung ≠ Gate (DECISIONS 16)',
  node: process.version,
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model ?? null,
  ticks,
  runs,
  minimap: mm,
};
const dir = resolve(dirname(fileURLToPath(import.meta.url)), 'results');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, 'scheduler.json');
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`→ ${file}`);
