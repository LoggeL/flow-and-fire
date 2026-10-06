/**
 * Unit tests (vitest) of the FX benchmark helpers: statistics, PNG decoding/pixel statistics, run
 * evaluation (draw budget, GPU segments, particle deltas), Markdown tables and the doc marker block.
 * The Playwright specs of this folder are *.spec.ts (playwright.config.ts testMatch).
 */
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { FxLabSample, FxLabStats } from '../../src/app/hooks.ts';
import { classifyConsole, PageErrorLog } from '../../scripts/bench/browsers.ts';
import { contentionFrom, parseGpuUtilization } from '../../scripts/bench/load.ts';
import { decodePng, imageStats, meanAbsDiff, regionDiff } from '../../scripts/bench/png.ts';
import {
  DOC_BEGIN,
  DOC_END,
  GPU_PENDING_FRAMES,
  contentionLabel,
  docBlock,
  emptyPoll,
  evaluateRun,
  foldPoll,
  gpuDiffRows,
  markdownTables,
  rangeTables,
  replaceDocBlock,
} from '../../scripts/bench/report.ts';
import type { FxBenchReport, RunCapture } from '../../scripts/bench/report.ts';
import { FX_SCENARIOS, FX_SCENARIO_NAMES, QUICK_SCENARIOS, parseFxScenario, scenarioQuery } from '../../scripts/bench/scenarios.ts';
import { clockResolution, fmt, fmtInt, fmtRange, percentileSorted, summarize } from '../../scripts/bench/stats.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function stats(over: Partial<FxLabStats> = {}): FxLabStats {
  return {
    draws: 20,
    drawsBySeg: { shadow: 2, opaque: 3, shields: 1, particles: 1, beams: 2, post: 11 },
    fx: {
      particles: {
        alive: 5000,
        cap: 16384,
        capacity: 65536,
        spawnedFrame: 40,
        dropped: [0, 0, 10],
        culled: 5,
        uploadBytes: 1280,
        window: 7000,
        windowLimit: 24576,
        overwritten: [0, 3, 0],
        relocated: 900,
      },
      shields: { count: 20, ripplesActive: 3 },
      beams: 12,
      trails: 40,
    },
    scene: { units: 400 },
    units: 400,
    decals: { count: 30, cap: 256, chunkOverflow: 2 },
    csm: { enabled: true, staticRefreshes: 1, staticDraws: 2, dynamicDraws: 1 },
    post: { hdr: true, bloom: true, levels: 5, fxaa: true },
    shakeActive: false,
    gpuTimer: true,
    gpuSeg: 'fine',
    canvas: [1536, 864],
    ...over,
  };
}

function sample(i: number, gpu: boolean): FxLabSample {
  const seg = gpu
    ? { shadow: 0.2, opaque: 1 + (i % 3) * 0.1, shields: 0.1, particles: 0.5, beams: 0.05, post: 0.9 }
    : { shadow: null, opaque: null, shields: null, particles: null, beams: null, post: null };
  const sum = gpu ? Object.values(seg).reduce((a: number, v) => a + (v ?? 0), 0) : null;
  return {
    frame: i,
    t: i / 60,
    frameMs: 1000 / 60,
    mainJsMs: 0.5 + (i % 10) * 0.01,
    fxJsMs: 0.2,
    labJsMs: 0.1,
    draws: 20,
    gpuMs: sum,
    gpuSeg: seg,
    particlesAlive: 4000 + i,
  };
}

function capture(over: Partial<RunCapture> = {}): RunCapture {
  const samples = Array.from({ length: 120 }, (_, i) => sample(i, true));
  const poll = emptyPoll();
  foldPoll(poll, stats());
  return {
    scenario: 'battle',
    requestedScene: 'battle',
    scene: 'battle',
    hookError: null,
    samples,
    statsStart: stats({ fx: { ...stats().fx, particles: { ...stats().fx.particles!, dropped: [0, 0, 4], culled: 2, overwritten: [0, 1, 0], relocated: 400 } } }),
    statsEnd: stats(),
    poll,
    pageErrors: [],
    warnings: [],
    contention: [],
    gpuRenderer: 'ANGLE (Apple M5 Pro)',
    crossOriginIsolated: true,
    ...over,
  };
}

function report(mode: 'quick' | 'full', results = [evaluateRun(capture())]): FxBenchReport {
  return {
    date: '2026-09-30T12:00:00.000Z',
    mode,
    machine: { platform: 'darwin arm64', arch: 'arm64', cpus: '14× Apple M5 Pro', memGB: 48, note: 'lokal gemessen (Apple M5 Pro)' },
    options: { warmupS: 2, measureS: 8, viewport: '1920×1080 @1x', seed: 1 },
    load: { before: [1, 1, 1], after: [1, 1, 1], concurrent: [] },
    browsers: [{ browser: 'chromium', version: '153', results, errors: [] }],
    exitCode: 0,
  };
}

/** Builds a PNG (color type 2 or 6) with the given filter for every row. */
function makePng(w: number, h: number, px: (x: number, y: number) => [number, number, number], alpha: boolean, filter = 0): Buffer {
  const bpp = alpha ? 4 : 3;
  const rows: number[] = [];
  let prev = new Array<number>(w * bpp).fill(0);
  for (let y = 0; y < h; y++) {
    const line: number[] = [];
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      line.push(r, g, b);
      if (alpha) line.push(255);
    }
    rows.push(filter);
    for (let i = 0; i < line.length; i++) {
      const a = i >= bpp ? line[i - bpp]! : 0;
      const up = prev[i]!;
      const pred = filter === 1 ? a : filter === 2 ? up : filter === 3 ? (a + up) >> 1 : 0;
      rows.push((line[i]! - pred) & 0xff);
    }
    prev = line;
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------

describe('stats', () => {
  it('nearest-rank percentiles', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileSorted(xs, 50)).toBe(50);
    expect(percentileSorted(xs, 95)).toBe(95);
    expect(percentileSorted(xs, 99)).toBe(99);
    expect(percentileSorted(xs, 0)).toBe(1);
    expect(percentileSorted(xs, 100)).toBe(100);
    expect(percentileSorted([], 50)).toBeNaN();
  });

  it('summaries skip null/NaN samples', () => {
    const s = summarize([3, null, 1, Number.NaN, 2]);
    expect(s).toMatchObject({ n: 3, min: 1, max: 3, mean: 2, p50: 2 });
    expect(summarize([]).n).toBe(0);
  });

  it('clock resolution and German number formatting', () => {
    expect(clockResolution([1, 2, 2, 4])).toBe(1);
    expect(clockResolution([0.105, 0.11, 0.2])).toBeCloseTo(0.005, 9);
    expect(clockResolution([1])).toBeNaN();
    expect(fmt(1.234)).toBe('1,23');
    expect(fmt(Number.NaN)).toBe('–');
    expect(fmtInt(65536)).toBe('65.536');
    expect(fmtInt(-1234567)).toBe('−1.234.567');
    expect(fmtRange([1, 2.5, 2])).toBe('1,00–2,50');
    expect(fmtRange([2, 2])).toBe('2,00');
  });
});

describe('scenarios', () => {
  it('names, quick subset and query strings', () => {
    expect(FX_SCENARIO_NAMES).toEqual([
      'battle',
      'battle-nofx',
      'battle-pass',
      'battle-nofx-pass',
      'battle-low',
      'battle-ldr',
      'shields',
      'shields-nofx',
      'shields-pass',
      'shields-nofx-pass',
      'big',
      'lighting-csm',
      'lighting-nocsm',
    ]);
    const sp = new URLSearchParams(scenarioQuery(FX_SCENARIOS['shields-pass']));
    expect([sp.get('fx'), sp.get('gpuseg')]).toEqual(['shields', 'pass']);
    expect(new URLSearchParams(scenarioQuery(FX_SCENARIOS['shields-nofx'])).get('fx')).toBe('0');
    for (const q of QUICK_SCENARIOS) expect(FX_SCENARIO_NAMES).toContain(q);
    expect(parseFxScenario('battle-low')).toBe('battle-low');
    expect(parseFxScenario('nope')).toBeUndefined();
    const q = new URLSearchParams(scenarioQuery(FX_SCENARIOS['battle-low'], 7));
    expect(Object.fromEntries(q)).toEqual({ scene: 'battle', preset: 'low', flight: '1', bench: '1', seed: '7' });
    expect(new URLSearchParams(scenarioQuery(FX_SCENARIOS['battle-ldr'])).get('hdr')).toBe('0');
    expect(new URLSearchParams(scenarioQuery(FX_SCENARIOS['lighting-nocsm'])).get('csm')).toBe('0');
    expect(FX_SCENARIOS.big.triggerEveryS).toBeGreaterThan(0);
  });
});

describe('evaluateRun', () => {
  it('summaries, GPU segments without the pending newest frames, particle deltas', () => {
    const r = evaluateRun(capture());
    expect(r.ok).toBe(true);
    expect(r.frames).toBe(120);
    expect(r.fps).toBeCloseTo(60, 6);
    expect(r.draws.p50).toBe(20);
    expect(r.fxDrawsMax).toBe(4);
    expect(r.totalDrawsMax).toBe(20);
    expect(r.drawBudgetOk).toBe(true);
    expect(r.gpuMs!.n).toBe(120 - GPU_PENDING_FRAMES);
    expect(r.gpuSeg.post!.p50).toBeCloseTo(0.9, 9);
    expect(r.particles).toMatchObject({
      cap: 16384,
      capacity: 65536,
      droppedRun: [0, 0, 6],
      droppedTotal: [0, 0, 10],
      culledRun: 3,
      windowMax: 7000,
      windowLimit: 24576,
      overwrittenRun: [0, 2, 0],
      relocatedRun: 500,
    });
    expect(r.particles!.aliveMax).toBe(5000);
    expect(r.shields).toEqual({ count: 20, ripplesMax: 3 });
    expect(r.csm.staticRefreshesRun).toBe(0);
  });

  it('without timer query GPU values are null ("n/v"), never zero', () => {
    const samples = Array.from({ length: 50 }, (_, i) => sample(i, false));
    const r = evaluateRun(capture({ samples, statsEnd: stats({ gpuTimer: false }) }));
    expect(r.gpuMs).toBeNull();
    expect(r.gpuSeg.shields).toBeNull();
    expect(r.ok).toBe(true);
    expect(markdownTables(report('full', [r]))).toContain('n/v');
  });

  it('frames with unresolved segments do not count for the GPU total', () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample(i, true));
    samples[3] = { ...samples[3]!, gpuSeg: { ...samples[3]!.gpuSeg, post: null } };
    const r = evaluateRun(capture({ samples }));
    expect(r.gpuMs!.n).toBe(40 - GPU_PENDING_FRAMES - 1);
    expect(r.gpuSeg.shadow!.n).toBe(40 - GPU_PENDING_FRAMES);
  });

  it('draw budget: FX draws > 6 or total > 40 are errors', () => {
    const poll = emptyPoll();
    foldPoll(poll, stats({ drawsBySeg: { shadow: 2, opaque: 3, shields: 1, particles: 2, beams: 4, post: 11 } }));
    const fx = evaluateRun(capture({ poll }));
    expect(fx.ok).toBe(false);
    expect(fx.fxDrawsMax).toBe(7);
    expect(fx.errors.join()).toMatch(/FX draw budget/);
    const samples = Array.from({ length: 30 }, (_, i) => ({ ...sample(i, true), draws: i === 7 ? 41 : 20 }));
    const tot = evaluateRun(capture({ samples }));
    expect(tot.ok).toBe(false);
    expect(tot.totalDrawsMax).toBe(41);
    expect(tot.errors.join()).toMatch(/41 draws > 40/);
  });

  it('page errors, hook errors, unregistered scenes and empty runs are errors; ms values never are', () => {
    expect(evaluateRun(capture({ pageErrors: ['console.error: GL_INVALID_OPERATION'] })).ok).toBe(false);
    expect(evaluateRun(capture({ hookError: 'boom' })).errors).toContain('__fxlab.error: boom');
    expect(evaluateRun(capture({ scene: 'lighting' })).errors[0]).toMatch(/not registered/);
    expect(evaluateRun(capture({ samples: [] })).ok).toBe(false);
    const slow = Array.from({ length: 30 }, (_, i) => ({ ...sample(i, true), frameMs: 200, mainJsMs: 90, gpuMs: 150 }));
    expect(evaluateRun(capture({ samples: slow })).ok).toBe(true);
  });

  it('gpuseg=pass: only shadow/scene/post must resolve; differences of the -pass pairs', () => {
    const passSample = (i: number, scene: number): FxLabSample => ({
      ...sample(i, true),
      gpuSeg: { shadow: 0.2, opaque: scene, shields: null, particles: null, beams: null, post: 0.9 },
      gpuMs: 1.1 + scene,
    });
    const run = (scenario: 'shields-pass' | 'shields-nofx-pass', scene: number) =>
      evaluateRun(
        capture({
          scenario,
          requestedScene: 'shields',
          scene: 'shields',
          samples: Array.from({ length: 40 }, (_, i) => passSample(i, scene)),
          statsEnd: stats({ gpuSeg: 'pass' }),
        }),
      );
    const withFx = run('shields-pass', 3.4);
    const without = run('shields-nofx-pass', 2.9);
    expect(withFx.gpuSegMode).toBe('pass');
    expect(withFx.gpuMs!.n).toBe(40 - GPU_PENDING_FRAMES);
    expect(withFx.gpuSeg.shields).toBeNull();
    const rep = report('full', [withFx, without]);
    const rows = gpuDiffRows(rep);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deltaP50).toBeCloseTo(0.5, 9);
    expect(rows[0]!.budgetMs).toBe(1);
    const md = markdownTables(rep);
    expect(md).toContain('Kosten per Differenz');
    expect(md).toContain('| chromium | 20 Schilde (fx=shields) | shields-pass | shields-nofx-pass | 0,50 |');
    expect(md).toContain('✅');
  });

  it('scenes without particle system / shields report null', () => {
    const end = stats({ fx: { particles: null, shields: null, beams: 0, trails: 0 } });
    const r = evaluateRun(capture({ statsStart: end, statsEnd: end }));
    expect(r.particles).toBeNull();
    expect(r.shields).toBeNull();
    expect(markdownTables(report('full', [r]))).toContain('| – |');
  });
});

describe('markdown and docs', () => {
  it('tables carry the local-measurement note and the segment table', () => {
    const md = markdownTables(report('full'));
    expect(md).toContain('lokal gemessen (Apple M5 Pro)');
    expect(md).toContain('| chromium 153 | battle |');
    expect(md).toContain('GPU-Zeit je Segment');
    expect(md).toContain('HDR + Bloom 5 + FXAA');
    expect(md).toContain('DECISIONS 16');
  });

  it('WebKit-like coarse clocks report means', () => {
    const samples = Array.from({ length: 60 }, (_, i) => ({ ...sample(i, false), mainJsMs: i % 2, fxJsMs: i % 3 === 0 ? 1 : 0 }));
    const r = evaluateRun(capture({ samples, statsEnd: stats({ gpuTimer: false }) }));
    expect(r.clockResolutionMs).toBe(1);
    expect(markdownTables(report('full', [r]))).toContain('Ø 0,50 ms');
  });

  it('range tables only over full runs', () => {
    expect(rangeTables([report('quick')])).toBe('');
    const a = report('full');
    const b = report('full', [evaluateRun(capture({ contention: ['vitest run'] }))]);
    const t = rangeTables([a, b, report('quick')]);
    expect(t).toContain('über 2 Volllauf/Volläufe');
    expect(t).toContain('| chromium | battle | 2 (1) |');
    expect(t).not.toContain('| ⚠️');
    expect(rangeTables([b])).toContain('| ⚠️ ');
  });

  it('replaces only the marker block, appends a section when missing', () => {
    const block = docBlock(report('full'), [report('full')]);
    expect(block.startsWith(DOC_BEGIN)).toBe(true);
    expect(block.endsWith(DOC_END)).toBe(true);
    const doc = `# Titel\n\nvorher\n\n${DOC_BEGIN}\nalt\n${DOC_END}\n\nnachher\n`;
    const out = replaceDocBlock(doc, block);
    expect(out.startsWith('# Titel\n\nvorher\n\n')).toBe(true);
    expect(out.endsWith('\n\nnachher\n')).toBe(true);
    expect(out).not.toContain('\nalt\n');
    expect(replaceDocBlock(out, block)).toBe(out);
    const appended = replaceDocBlock('# Ohne Marker\n', block);
    expect(appended).toContain('## Messwerte (automatisch');
    expect(appended).toContain(DOC_BEGIN);
  });

  it('contention detection ignores the benchmark itself and labels foreign load', () => {
    const lines = [
      '  101 12.0 node --import tsx scripts/bench.ts --quick',
      '  102 50.0 /usr/bin/python -m h3mlx.validate run',
      '  103 3.0 node node_modules/@playwright/test/cli.js test -c apps/game',
      '  104 1.0 /bin/zsh',
      '  105 9.0 node vitest run',
      '  106 0.1 /usr/bin/python -m h3mlx.server --port 7860',
      '  107 0.0 /bin/zsh tools/gpurun python -m h3mlx.validate run',
    ];
    const hits = contentionFrom(lines, new Set(['105']));
    expect(hits).toHaveLength(2);
    expect(contentionLabel(hits)).toBe('h3mlx, playwright test');
    expect(hits[0]!.startsWith('h3mlx · ')).toBe(true);
    expect(contentionLabel(['GPU-Auslastung 97 % ohne Benchmark'])).toBe('GPU-Auslastung 97 %');
    expect(contentionLabel(['vitest · a', 'h3mlx · b', 'playwright test · c', 'smoke.ts · d'])).toBe('vitest, h3mlx, playwright test +1');
  });

  it('GPU utilisation from ioreg output', () => {
    const io = '| "PerformanceStatistics" = {"Renderer Utilization %"=69,"Device Utilization %"=98,"Tiler Utilization %"=12}\n"Device Utilization %"=3';
    expect(parseGpuUtilization(io)).toBe(98);
    expect(parseGpuUtilization('nothing')).toBeNull();
  });
});

describe('console classification', () => {
  it('GL errors are errors, WebGL notes are warnings', () => {
    expect(classifyConsole('error', 'anything')).toBe('error');
    expect(classifyConsole('warning', 'WebGL: INVALID_OPERATION: drawArrays')).toBe('error');
    expect(classifyConsole('warning', 'WebGL warning: texImage: Alpha-premult and y-flip are deprecated')).toBe('warning');
    expect(classifyConsole('log', 'hello')).toBeNull();
    const log = new PageErrorLog();
    log.expectLoss = true;
    log.onConsole('warning', 'WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost');
    expect(log.errors).toEqual([]);
    log.expectLoss = false;
    log.onConsole('warning', 'WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost');
    expect(log.errors).toHaveLength(1);
  });
});

describe('png', () => {
  const px = (x: number, y: number): [number, number, number] => [(x * 37 + y * 11) & 0xff, (x * 5 + y * 71) & 0xff, (x ^ y) & 0xff];

  it('decodes RGB and RGBA with every row filter', () => {
    for (const alpha of [false, true]) {
      for (const filter of [0, 1, 2, 3]) {
        const img = decodePng(makePng(13, 7, px, alpha, filter));
        expect([img.width, img.height]).toEqual([13, 7]);
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 13; x++) {
            const o = (y * 13 + x) * 3;
            expect([img.rgb[o], img.rgb[o + 1], img.rgb[o + 2]]).toEqual(px(x, y));
          }
        }
      }
    }
    expect(() => decodePng(Buffer.from('nope'))).toThrow(/not a PNG/);
  });

  it('pixel statistics: uniform, bright centre, fire colours, differences', () => {
    const uniform = decodePng(makePng(32, 32, () => [40, 40, 40], false));
    expect(imageStats(uniform, undefined, 1).lumaSpread).toBe(0);
    const spot = decodePng(makePng(40, 40, (x, y) => (Math.abs(x - 20) < 6 && Math.abs(y - 20) < 6 ? [255, 250, 240] : [30, 60, 20]), false));
    const whole = imageStats(spot, undefined, 1);
    const centre = imageStats(spot, { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }, 1);
    expect(whole.lumaSpread).toBeGreaterThanOrEqual(200);
    expect(centre.brightFraction).toBe(1);
    expect(whole.brightFraction).toBeCloseTo(121 / 1600, 6);
    const fire = decodePng(makePng(8, 8, () => [250, 140, 30], false));
    expect(imageStats(fire, undefined, 1).fireFraction).toBe(1);
    expect(meanAbsDiff(spot, spot)).toBe(0);
    expect(meanAbsDiff(uniform, decodePng(makePng(32, 32, () => [43, 43, 43], false)), 1)).toBe(3);
    expect(() => meanAbsDiff(uniform, spot)).toThrow(/size mismatch/);
  });

  it('regionDiff: changed fraction and mean difference inside a region', () => {
    const base = decodePng(makePng(40, 40, () => [30, 60, 20], false));
    const spot = decodePng(makePng(40, 40, (x, y) => (x >= 10 && x < 20 && y >= 10 && y < 20 ? [30, 90, 20] : [30, 60, 20]), false));
    const inner = regionDiff(spot, base, { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 });
    expect(inner).toEqual({ changedFraction: 1, meanAbs: 10, pixels: 100 });
    expect(regionDiff(spot, base, { x0: 0, y0: 0, x1: 1, y1: 1 }).changedFraction).toBeCloseTo(100 / 1600, 9);
    expect(regionDiff(spot, base, { x0: 0.6, y0: 0.6, x1: 1, y1: 1 }).changedFraction).toBe(0);
    expect(regionDiff(spot, base, { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }, 31).changedFraction).toBe(0);
    expect(() => regionDiff(base, decodePng(makePng(8, 8, () => [0, 0, 0], false)), { x0: 0, y0: 0, x1: 1, y1: 1 })).toThrow(/size mismatch/);
  });
});
