/**
 * FX benchmark evaluation and reporting: turns the raw capture of one scenario run (fx-lab samples,
 * stats snapshots, page errors) into a {@link ScenarioResult}, and renders the German Markdown tables
 * that `--update-docs` writes into docs/status/track-renderfx.md. Pure functions (unit-tested).
 */
import type { FxLabSample, FxLabStats, SegmentRecord } from '../../src/app/hooks.ts';
import { FX_DRAW_LIMIT, FX_GPU_DIFFS, FX_SCENARIOS, TOTAL_DRAW_LIMIT } from './scenarios.ts';
import type { FxScenarioName } from './scenarios.ts';
import { clockResolution, fmt, fmtInt, fmtRange, summarize } from './stats.ts';
import type { Summary } from './stats.ts';

export const SEGMENTS = ['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'] as const;
export type Segment = (typeof SEGMENTS)[number];
/** Segments timed with `gpuseg=pass` ('opaque' then holds the whole scene pass: opaque + FX). */
export const PASS_SEGMENTS: readonly Segment[] = ['shadow', 'opaque', 'post'];

export const DOC_BEGIN = '<!-- fx:results:begin -->';
export const DOC_END = '<!-- fx:results:end -->';

/** Newest samples whose GPU timings may not be resolved yet (timer results arrive a few frames late). */
export const GPU_PENDING_FRAMES = 8;

/** Aggregates of the in-page stats poll (every ~100 ms during the measured window). */
export interface PagePoll {
  polls: number;
  segMax: SegmentRecord<number>;
  /** Maximum of shields + particles + beams draws of one polled frame. */
  fxDrawsMax: number;
  aliveMax: number;
  /** Maximum drawn particle ring window (= particle VS instances of one frame). */
  windowMax: number;
  /** Maximum scorch (decal, chunk) pairs dropped by the per-chunk limit. */
  decalOverflowMax: number;
  beamsMax: number;
  trailsMax: number;
  shieldsMax: number;
  ripplesMax: number;
  /** Polls with an active camera shake. */
  shakePolls: number;
}

/** Everything the runner captured for one scenario run. */
export interface RunCapture {
  scenario: FxScenarioName;
  requestedScene: string;
  /** `__fxlab.scene` after load (differs when the scene is not registered). */
  scene: string;
  /** `__fxlab.error` at the end of the run. */
  hookError: string | null;
  samples: readonly FxLabSample[];
  statsStart: FxLabStats;
  statsEnd: FxLabStats;
  poll: PagePoll;
  /** Page errors and GL console errors. */
  pageErrors: readonly string[];
  warnings: readonly string[];
  contention: readonly string[];
  gpuRenderer: string;
  crossOriginIsolated: boolean;
}

export interface ParticleResult {
  aliveP50: number;
  aliveMax: number;
  cap: number;
  capacity: number;
  /** Dropped per priority during the measured window. */
  droppedRun: [number, number, number];
  /** Dropped per priority since scene start (cumulative counters of the system). */
  droppedTotal: [number, number, number];
  culledRun: number;
  /** Maximum drawn ring window (particle VS instances per frame) and its bound at the end. */
  windowMax: number;
  windowLimit: number;
  /** Live particles overwritten by a full ring during the measured window, per priority. */
  overwrittenRun: [number, number, number];
  /** Live records relocated to bound the window during the measured window. */
  relocatedRun: number;
}

export interface ScenarioResult {
  scenario: FxScenarioName;
  ok: boolean;
  errors: string[];
  warnings: string[];
  contention: string[];
  gpuRenderer: string;
  crossOriginIsolated: boolean;
  frames: number;
  /** Sum of the measured rAF intervals (s). */
  measuredS: number;
  fps: number;
  frameMs: Summary;
  mainJsMs: Summary;
  fxJsMs: Summary;
  labJsMs: Summary;
  /** Granularity of performance.now in the JS samples (WebKit ≈ 1 ms ⇒ percentiles quantized, mean reported). */
  clockResolutionMs: number;
  draws: Summary;
  drawsBySegMax: SegmentRecord<number>;
  fxDrawsMax: number;
  totalDrawsMax: number;
  drawBudgetOk: boolean;
  /** GPU time per frame (all six segments resolved), null without timer query. */
  gpuMs: Summary | null;
  gpuSeg: SegmentRecord<Summary | null>;
  gpuTimer: boolean;
  /** Timer granularity of the run ('pass': 'opaque' = scene pass incl. FX, FX segments untimed). */
  gpuSegMode: 'fine' | 'pass';
  particles: ParticleResult | null;
  shields: { count: number; ripplesMax: number } | null;
  beamsMax: number;
  trailsMax: number;
  units: number;
  /** Scorch pool at the end; chunkOverflowMax = maximum per-chunk overflow seen during the run. */
  decals: { count: number; cap: number; chunkOverflowMax: number };
  post: FxLabStats['post'];
  csm: { enabled: boolean; staticRefreshesRun: number; staticDraws: number; dynamicDraws: number };
  canvas: [number, number];
  shakeSeen: boolean;
  scene: Record<string, number>;
}

export interface BrowserReport {
  browser: string;
  version: string;
  results: ScenarioResult[];
  errors: string[];
}

export interface FxBenchReport {
  date: string;
  mode: 'quick' | 'full';
  machine: { platform: string; arch: string; cpus: string; memGB: number; note: string };
  options: { warmupS: number; measureS: number; viewport: string; seed: number };
  load: { before: number[]; after: number[]; concurrent: string[] };
  browsers: BrowserReport[];
  exitCode: number;
}

export function emptyPoll(): PagePoll {
  return {
    polls: 0,
    segMax: { shadow: 0, opaque: 0, shields: 0, particles: 0, beams: 0, post: 0 },
    fxDrawsMax: 0,
    aliveMax: 0,
    windowMax: 0,
    decalOverflowMax: 0,
    beamsMax: 0,
    trailsMax: 0,
    shieldsMax: 0,
    ripplesMax: 0,
    shakePolls: 0,
  };
}

/** Folds one stats snapshot into the poll aggregate (the page runs the same logic in its own loop). */
export function foldPoll(p: PagePoll, s: FxLabStats): void {
  p.polls++;
  for (const k of SEGMENTS) p.segMax[k] = Math.max(p.segMax[k], s.drawsBySeg[k]);
  p.fxDrawsMax = Math.max(p.fxDrawsMax, s.drawsBySeg.shields + s.drawsBySeg.particles + s.drawsBySeg.beams);
  p.aliveMax = Math.max(p.aliveMax, s.fx.particles?.alive ?? 0);
  p.windowMax = Math.max(p.windowMax, s.fx.particles?.window ?? 0);
  p.decalOverflowMax = Math.max(p.decalOverflowMax, s.decals.chunkOverflow);
  p.beamsMax = Math.max(p.beamsMax, s.fx.beams);
  p.trailsMax = Math.max(p.trailsMax, s.fx.trails);
  p.shieldsMax = Math.max(p.shieldsMax, s.fx.shields?.count ?? 0);
  p.ripplesMax = Math.max(p.ripplesMax, s.fx.shields?.ripplesActive ?? 0);
  if (s.shakeActive) p.shakePolls++;
}

const triple = (a: readonly number[] | undefined): [number, number, number] => [a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0];

/** Evaluates one captured run: summaries, draw budget and errors. */
export function evaluateRun(c: RunCapture): ScenarioResult {
  const errors: string[] = [...c.pageErrors];
  if (c.hookError !== null) errors.push(`__fxlab.error: ${c.hookError}`);
  if (c.scene !== c.requestedScene) errors.push(`scene is '${c.scene}', expected '${c.requestedScene}' (not registered?)`);
  const samples = c.samples;
  if (samples.length === 0) errors.push('no frames were sampled');

  const col = (get: (s: FxLabSample) => number): number[] => samples.map(get);
  const frameMs = summarize(col((s) => s.frameMs));
  const mainJs = col((s) => s.mainJsMs);
  const draws = summarize(col((s) => s.draws));
  const measuredS = samples.reduce((a, s) => a + s.frameMs, 0) / 1000;

  // GPU: only frames whose six segments all resolved; the newest frames may still be pending.
  const settled = samples.slice(0, Math.max(0, samples.length - GPU_PENDING_FRAMES));
  const gpuSegMode = c.statsEnd.gpuSeg;
  const timed = gpuSegMode === 'pass' ? PASS_SEGMENTS : SEGMENTS;
  const complete = settled.filter((s) => timed.every((k) => s.gpuSeg[k] !== null));
  const gpuTimer = c.statsEnd.gpuTimer;
  const gpuMs = gpuTimer && complete.length > 0 ? summarize(complete.map((s) => s.gpuMs)) : null;
  const gpuSeg = {} as SegmentRecord<Summary | null>;
  for (const k of SEGMENTS) {
    const vals = settled.map((s) => s.gpuSeg[k]).filter((v): v is number => v !== null);
    gpuSeg[k] = gpuTimer && vals.length > 0 ? summarize(vals) : null;
  }

  const segMax = { ...c.poll.segMax };
  for (const k of SEGMENTS) segMax[k] = Math.max(segMax[k], c.statsEnd.drawsBySeg[k]);
  const fxEnd = c.statsEnd.drawsBySeg.shields + c.statsEnd.drawsBySeg.particles + c.statsEnd.drawsBySeg.beams;
  const fxDrawsMax = Math.max(c.poll.fxDrawsMax, fxEnd);
  const totalDrawsMax = Math.max(Number.isFinite(draws.max) ? draws.max : 0, c.statsEnd.draws);
  if (fxDrawsMax > FX_DRAW_LIMIT) errors.push(`FX draw budget exceeded: shields + particles + beams = ${fxDrawsMax} > ${FX_DRAW_LIMIT}`);
  if (totalDrawsMax > TOTAL_DRAW_LIMIT) errors.push(`draw budget exceeded: ${totalDrawsMax} draws > ${TOTAL_DRAW_LIMIT}`);

  const p0 = c.statsStart.fx.particles;
  const p1 = c.statsEnd.fx.particles;
  let particles: ParticleResult | null = null;
  if (p1 !== null) {
    const d0 = triple(p0?.dropped);
    const d1 = triple(p1.dropped);
    const o0 = triple(p0?.overwritten);
    const o1 = triple(p1.overwritten);
    const alive = summarize(col((s) => s.particlesAlive));
    particles = {
      aliveP50: alive.p50,
      aliveMax: Math.max(Number.isFinite(alive.max) ? alive.max : 0, c.poll.aliveMax, p1.alive),
      cap: p1.cap,
      capacity: p1.capacity,
      droppedRun: [d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]],
      droppedTotal: d1,
      culledRun: p1.culled - (p0?.culled ?? 0),
      windowMax: Math.max(c.poll.windowMax, p1.window),
      windowLimit: p1.windowLimit,
      overwrittenRun: [o1[0] - o0[0], o1[1] - o0[1], o1[2] - o0[2]],
      relocatedRun: p1.relocated - (p0?.relocated ?? 0),
    };
  }
  const sh = c.statsEnd.fx.shields;
  return {
    scenario: c.scenario,
    ok: errors.length === 0,
    errors,
    warnings: [...c.warnings],
    contention: [...c.contention],
    gpuRenderer: c.gpuRenderer,
    crossOriginIsolated: c.crossOriginIsolated,
    frames: samples.length,
    measuredS,
    fps: measuredS > 0 ? samples.length / measuredS : Number.NaN,
    frameMs,
    mainJsMs: summarize(mainJs),
    fxJsMs: summarize(col((s) => s.fxJsMs)),
    labJsMs: summarize(col((s) => s.labJsMs)),
    clockResolutionMs: clockResolution(mainJs),
    draws,
    drawsBySegMax: segMax,
    fxDrawsMax,
    totalDrawsMax,
    drawBudgetOk: fxDrawsMax <= FX_DRAW_LIMIT && totalDrawsMax <= TOTAL_DRAW_LIMIT,
    gpuMs,
    gpuSeg,
    gpuTimer,
    gpuSegMode,
    particles,
    shields: sh === null ? null : { count: Math.max(sh.count, c.poll.shieldsMax), ripplesMax: Math.max(sh.ripplesActive, c.poll.ripplesMax) },
    beamsMax: Math.max(c.statsEnd.fx.beams, c.poll.beamsMax),
    trailsMax: Math.max(c.statsEnd.fx.trails, c.poll.trailsMax),
    units: c.statsEnd.units,
    decals: { count: c.statsEnd.decals.count, cap: c.statsEnd.decals.cap, chunkOverflowMax: Math.max(c.poll.decalOverflowMax, c.statsEnd.decals.chunkOverflow) },
    post: { ...c.statsEnd.post },
    csm: {
      enabled: c.statsEnd.csm.enabled,
      staticRefreshesRun: c.statsEnd.csm.staticRefreshes - c.statsStart.csm.staticRefreshes,
      staticDraws: c.statsEnd.csm.staticDraws,
      dynamicDraws: c.statsEnd.csm.dynamicDraws,
    },
    canvas: [c.statsEnd.canvas[0], c.statsEnd.canvas[1]],
    shakeSeen: c.poll.shakePolls > 0 || c.statsEnd.shakeActive,
    scene: { ...c.statsEnd.scene },
  };
}

// ---------------------------------------------------------------------------------------------
// Markdown (German docs)
// ---------------------------------------------------------------------------------------------

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 300);
}

/** Quantized clocks (WebKit: 1 ms) make JS percentiles meaningless – the mean is reported instead. */
export function coarseClock(r: ScenarioResult): boolean {
  return r.clockResolutionMs >= 0.1;
}

function jsCell(s: Summary, coarse: boolean): string {
  if (s.n === 0) return '–';
  return coarse ? `Ø ${fmt(s.mean)}` : `${fmt(s.p50)} / ${fmt(s.p95)} / ${fmt(s.p99)}`;
}

function gpuCell(s: Summary | null): string {
  return s === null || s.n === 0 ? 'n/v' : `${fmt(s.p50)} / ${fmt(s.p95)}`;
}

function particlesCell(r: ScenarioResult): string {
  const p = r.particles;
  if (p === null) return '–';
  return `${fmtInt(p.aliveP50)} / ${fmtInt(p.aliveMax)} (Cap ${fmtInt(p.cap)})`;
}

function droppedCell(r: ScenarioResult): string {
  const p = r.particles;
  if (p === null) return '–';
  return p.droppedRun.map(fmtInt).join(' / ');
}

function windowCell(r: ScenarioResult): string {
  const p = r.particles;
  if (p === null) return '–';
  return `${fmtInt(p.windowMax)} / ${fmtInt(p.windowLimit)}; ${p.overwrittenRun.map(fmtInt).join(' / ')}; ${fmtInt(p.relocatedRun)}`;
}

/** Short label of the foreign load seen during a run ("mlx", "playwright test", …). */
export function contentionLabel(contention: readonly string[]): string {
  const labels = new Set<string>();
  for (const c of contention) {
    const m = /GPU-Auslastung \d+ %|h3mlx|mlx_lm|\bmlx\b|gpurun|playwright test|@playwright\/test\/cli\.js test|vitest|shot\.ts|smoke\.ts|spk4\.ts/i.exec(c);
    labels.add(m === null ? oneLine(c).slice(0, 30) : m[0].replace('@playwright/test/cli.js test', 'playwright test'));
  }
  const list = [...labels];
  return list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3}` : list.join(', ');
}

function verdict(ok: boolean): string {
  return ok ? '✅' : '❌';
}

/** Detail tables of one report (block content between the doc markers). */
export function markdownTables(report: FxBenchReport): string {
  const L: string[] = [];
  const o = report.options;
  L.push(
    `Lauf ${report.date.slice(0, 16).replace('T', ' ')} UTC (${report.mode === 'quick' ? 'quick' : 'voll'}), ${report.machine.note}; ` +
      `Viewport ${o.viewport}, ${fmt(o.warmupS, 0)} s Warm-up + ${fmt(o.measureS, 0)} s Messung je Szenario, Seed ${o.seed}.`,
  );
  const conc = report.load.concurrent;
  L.push(
    `Last: loadavg vorher ${report.load.before.map((v) => fmt(v, 1)).join('/')}, nachher ${report.load.after.map((v) => fmt(v, 1)).join('/')}; ` +
      `parallel: ${conc.length === 0 ? 'nichts Auffälliges' : `${conc.length} Prozess(e) (${contentionLabel(conc)})`}.`,
  );
  L.push('');
  L.push('| Browser | Szenario | Frames / FPS | Frame p50 / p95 / p99 | Main-JS p50 / p95 / p99 | FX-JS p50 / p95 / p99 | Lab-JS p50 | Draws p50 / max (FX max) | GPU gesamt p50 / p95 | Partikel alive p50 / max | dropped P0 / P1 / P2 | Ring-Fenster max / Grenze; overwritten P0 / P1 / P2; relocated | Fremdlast | Draw-Budget |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of report.browsers) {
    for (const r of b.results) {
      const coarse = coarseClock(r);
      L.push(
        `| ${b.browser} ${b.version} | ${r.scenario} | ${r.frames} / ${fmt(r.fps, 1)} | ${fmt(r.frameMs.p50, 1)} / ${fmt(r.frameMs.p95, 1)} / ${fmt(r.frameMs.p99, 1)} ms | ` +
          `${jsCell(r.mainJsMs, coarse)} ms | ${jsCell(r.fxJsMs, coarse)} ms | ${coarse ? `Ø ${fmt(r.labJsMs.mean)}` : fmt(r.labJsMs.p50)} ms | ` +
          `${fmt(r.draws.p50, 0)} / ${r.totalDrawsMax} (${r.fxDrawsMax}) | ${gpuCell(r.gpuMs)}${r.gpuMs === null ? '' : ' ms'} | ${particlesCell(r)} | ${droppedCell(r)} | ${windowCell(r)} | ` +
          `${r.contention.length > 0 ? '⚠️ ' + contentionLabel(r.contention) : 'keine'} | ${verdict(r.drawBudgetOk)} |`,
      );
      for (const e of r.errors) L.push(`| ${b.browser} | ${r.scenario} | Fehler: ${oneLine(e)} | | | | | | | | | | | |`);
    }
    for (const e of b.errors) L.push(`| ${b.browser} | – | Fehler: ${oneLine(e)} | | | | | | | | | | | |`);
  }
  L.push('');
  const withGpu = report.browsers.flatMap((b) => b.results.filter((r) => r.gpuTimer && r.gpuMs !== null).map((r) => ({ b, r })));
  if (withGpu.length > 0) {
    L.push('GPU-Zeit je Segment (EXT_disjoint_timer_query_webgl2, p50 / p95 in ms; nur wo verfügbar, sonst n/v):');
    L.push('');
    L.push('| Browser | Szenario | shadow | opaque | shields | particles | beams | post | gesamt |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const { b, r } of withGpu) {
      L.push(`| ${b.browser} | ${r.scenario}${r.gpuSegMode === 'pass' ? ' (pass: opaque = Szene inkl. FX)' : ''} | ${SEGMENTS.map((k) => gpuCell(r.gpuSeg[k])).join(' | ')} | ${gpuCell(r.gpuMs)} |`);
    }
    L.push('');
    L.push(
      'Hinweis: Mit `gpuseg=fine` beginnen und enden die Timer-Queries der FX-Segmente mitten im offenen Szenen-Pass. ' +
        'Auf Tile-GPUs teilt das den Pass und kostet selbst messbar GPU-Zeit (Sockel je nicht leerem Segment); ' +
        'belastbar sind nur die Differenzen der `-pass`-Szenarien unten.',
    );
    L.push('');
    const diffs = gpuDiffRows(report);
    if (diffs.length > 0) {
      L.push('Kosten per Differenz (Szenen-Segment mit minus ohne FX, gleiche Auflösung, Timer nur an Pass-Grenzen, p50 / Mittelwert in ms):');
      L.push('');
      L.push('| Browser | Kosten von | mit | ohne | Δ p50 | Δ Mittel | Budget |');
      L.push('|---|---|---|---|---|---|---|');
      for (const d of diffs) {
        const budget = d.budgetMs === null ? '–' : `≤ ${fmt(d.budgetMs)} ms ${d.deltaP50 <= d.budgetMs ? '✅' : '❌'}`;
        L.push(`| ${d.browser} | ${d.label} | ${d.with} | ${d.without} | ${fmt(d.deltaP50)} | ${fmt(d.deltaMean)} | ${budget} |`);
      }
      L.push('');
    }
  }
  L.push('Draws je Segment (Maximum), FX-Zustand und Post (letzter Frame):');
  L.push('');
  L.push('| Browser | Szenario | shadow | opaque | shields | particles | beams | post | Units | Schilde / Ripples max | Beams / Trails max | Decals (Chunk-Überlauf max) | Post | CSM (stat. Neuaufbauten) | Canvas |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of report.browsers) {
    for (const r of b.results) {
      const s = r.drawsBySegMax;
      L.push(
        `| ${b.browser} | ${r.scenario} | ${s.shadow} | ${s.opaque} | ${s.shields} | ${s.particles} | ${s.beams} | ${s.post} | ${r.units} | ` +
          `${r.shields === null ? '–' : `${r.shields.count} / ${r.shields.ripplesMax}`} | ${r.beamsMax} / ${r.trailsMax} | ${r.decals.count}/${r.decals.cap} (${r.decals.chunkOverflowMax}) | ` +
          `${r.post.hdr ? 'HDR' : 'LDR'}${r.post.bloom ? ` + Bloom ${r.post.levels}` : ''}${r.post.fxaa ? ' + FXAA' : ''} | ` +
          `${r.csm.enabled ? `an (${r.csm.staticRefreshesRun})` : 'aus'} | ${r.canvas[0]}×${r.canvas[1]} |`,
      );
    }
  }
  L.push('');
  const gpus = new Set<string>();
  for (const b of report.browsers) {
    const r = b.results[0];
    if (r !== undefined) gpus.add(`${b.browser}: ${r.gpuRenderer || 'unbekannt'} (Timer-Query ${r.gpuTimer ? 'ja' : 'nein'}, COI ${r.crossOriginIsolated ? 'ja' : 'nein'})`);
  }
  if (gpus.size > 0) L.push(`GPU/Treiber: ${[...gpus].join('; ')}.`);
  L.push(
    `Draw-Budget: FX-Draws (shields + particles + beams) ≤ ${FX_DRAW_LIMIT} und Gesamt ≤ ${TOTAL_DRAW_LIMIT} je Frame (Überschreitung = Bench-Fehler); ` +
      'ms-Werte sind Messung, kein Gate (DECISIONS 16). WebKit taktet `performance.now` in 1-ms-Schritten → dort Mittelwerte (Ø).',
  );
  const warns = report.browsers.flatMap((b) => b.results.flatMap((r) => r.warnings.map((w) => `${b.browser}/${r.scenario}: ${oneLine(w)}`)));
  const uniq = [...new Set(warns)];
  if (uniq.length > 0) {
    L.push('');
    L.push('Browser-Hinweise (WebGL-Warnungen, keine Fehler):');
    L.push('');
    for (const w of uniq.slice(0, 10)) L.push(`- ${w}`);
  }
  return L.join('\n');
}

export interface GpuDiffRow {
  browser: string;
  label: string;
  with: string;
  without: string;
  deltaP50: number;
  deltaMean: number;
  budgetMs: number | null;
}

/** Scene-segment differences of the FX_GPU_DIFFS pairs present in `report` (both runs timed). */
export function gpuDiffRows(report: FxBenchReport): GpuDiffRow[] {
  const rows: GpuDiffRow[] = [];
  for (const b of report.browsers) {
    for (const d of FX_GPU_DIFFS) {
      const a = b.results.find((r) => r.scenario === d.with)?.gpuSeg.opaque;
      const z = b.results.find((r) => r.scenario === d.without)?.gpuSeg.opaque;
      if (a === undefined || z === undefined || a === null || z === null || a.n === 0 || z.n === 0) continue;
      rows.push({ browser: b.browser, label: d.label, with: d.with, without: d.without, deltaP50: a.p50 - z.p50, deltaMean: a.mean - z.mean, budgetMs: d.budgetMs });
    }
  }
  return rows;
}

/** Value ranges over every full run (DECISIONS 16: ranges instead of single values). */
export function rangeTables(reports: readonly FxBenchReport[]): string {
  const full = reports.filter((r) => r.mode === 'full');
  if (full.length === 0) return '';
  const keys = new Map<string, ScenarioResult[]>();
  for (const rep of full) {
    for (const b of rep.browsers) {
      for (const r of b.results) {
        const k = `${b.browser}|${r.scenario}`;
        const list = keys.get(k) ?? [];
        list.push(r);
        keys.set(k, list);
      }
    }
  }
  const L: string[] = [];
  L.push(
    `Wertebereiche über ${full.length} Volllauf/Volläufe (${full[0]!.date.slice(0, 10)} … ${full[full.length - 1]!.date.slice(0, 10)}); ` +
      'GPU-Werte aus Läufen ohne erkannte Fremdlast; ⚠️ = es gibt nur Läufe mit Fremdlast (Obergrenze, nicht belastbar):',
  );
  L.push('');
  L.push('| Browser | Szenario | Läufe (ohne Fremdlast) | FPS | Main-JS p95 (WebKit Ø) | FX-JS p95 (WebKit Ø) | Draws max (FX) | GPU p50 | GPU p95 | shields p50 | particles p50 | shadow p50 | post p50 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [k, list] of keys) {
    const [browser, scenario] = k.split('|') as [string, string];
    const clean = list.filter((r) => r.contention.length === 0);
    const js = (pick: (r: ScenarioResult) => Summary): number[] => list.map((r) => (coarseClock(r) ? pick(r).mean : pick(r).p95));
    const gpu = (pick: (r: ScenarioResult) => Summary | null, p: 'p50' | 'p95'): string => {
      const vals = (rs: readonly ScenarioResult[]): number[] => rs.map(pick).filter((s): s is Summary => s !== null && s.n > 0).map((s) => s[p]);
      const v = vals(clean);
      if (v.length > 0) return `${fmtRange(v)} ms`;
      const loaded = vals(list);
      return loaded.length > 0 ? `⚠️ ${fmtRange(loaded)} ms` : 'n/v';
    };
    L.push(
      `| ${browser} | ${scenario} | ${list.length} (${clean.length}) | ${fmtRange(list.map((r) => r.fps), 1)} | ${fmtRange(js((r) => r.mainJsMs))} ms | ` +
        `${fmtRange(js((r) => r.fxJsMs))} ms | ${fmtRange(list.map((r) => r.totalDrawsMax), 0)} (${fmtRange(list.map((r) => r.fxDrawsMax), 0)}) | ` +
        `${gpu((r) => r.gpuMs, 'p50')} | ${gpu((r) => r.gpuMs, 'p95')} | ${gpu((r) => r.gpuSeg.shields, 'p50')} | ${gpu((r) => r.gpuSeg.particles, 'p50')} | ` +
        `${gpu((r) => r.gpuSeg.shadow, 'p50')} | ${gpu((r) => r.gpuSeg.post, 'p50')} |`,
    );
  }
  return L.join('\n');
}

/** Scenario legend for the docs. */
export function scenarioLegend(): string {
  return Object.values(FX_SCENARIOS)
    .map((s) => `- \`${s.name}\`: ${s.purpose} (\`${new URLSearchParams(s.params as Record<string, string>).toString()}\`)`)
    .join('\n');
}

/** Complete marker block for the status doc. */
export function docBlock(report: FxBenchReport, all: readonly FxBenchReport[]): string {
  const ranges = rangeTables(all);
  const parts = [DOC_BEGIN, '_Automatisch erzeugt von `pnpm bench:fx -- --update-docs` – lokal gemessen, Apple M5 Pro, kein Iris Xe (DECISIONS 5)._', ''];
  parts.push('Szenarien:', '', scenarioLegend(), '');
  if (ranges.length > 0) parts.push(ranges, '', 'Letzter Lauf im Detail:', '');
  parts.push(markdownTables(report), DOC_END);
  return parts.join('\n');
}

/**
 * Replaces the marker block in `text` (or appends a new measurement section when the markers are
 * missing). Text outside the markers stays byte-identical.
 */
export function replaceDocBlock(text: string, block: string): string {
  const a = text.indexOf(DOC_BEGIN);
  const b = text.indexOf(DOC_END);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + DOC_END.length);
  return `${text.trimEnd()}\n\n## Messwerte (automatisch, \`bench:fx --update-docs\`)\n\n${block}\n`;
}
