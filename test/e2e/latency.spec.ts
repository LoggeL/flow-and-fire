import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { MetricsSnapshot } from '../../packages/client/src/metrics.ts';
import { captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// SPK6 latency chain (PLAN §4, MS1 acceptance), per browser and transport, real right clicks.
// Definitions (packages/client/src/metrics.ts): the click time is the pointerdown event timestamp;
// "first moved pixel" = first rAF in which a commanded unit that stood still at the click is drawn
// ≥ 1 CSS px away from how it was drawn at the click (position or heading, same camera). Every click
// commands a resting group of cubes; a random 40–140 ms pause before each click samples the tick phase
// uniformly. The cubes accelerate from standstill (3 WU/s²: 0.03 WU in the first tick), so the pixel
// criterion depends on the zoom: 6 WU camera distance (≈ 0.007 WU/px) isolates the pipeline latency,
// the start view (105 WU) is what a player sees.
//
// Measurement and gate are separate (review MS1): every run writes all values of all phases to
// test-results/latency-<browser>-<transport>.json, but by default only machine-independent pipeline
// invariants are gated:
//   - click marker ≤ 1 rAF (counted in frames, not ms),
//   - every click measured (no timeouts, enough samples),
//   - host side: every `cmd` applied in the next tick after its arrival (cmdApplyTicksMax = 1),
//   - Main-JS p95 ≤ 2 ms with 1,000 driving cubes (≈ 10× headroom).
// The millisecond gates of the pipeline (6 WU: first moved pixel p95 ≤ 150 ms, seq ack p95 ≤ 100 ms
// + one rAF) only run in an explicit measurement run: FAF_LATENCY_GATE=1 pnpm test:e2e latency.
// There a gated phase that fails while the browser's rAF stalled (an interval ≥ 50 ms, i.e. ≥ 3
// missed vsyncs – the compositor, not the pipeline) is repeated, at most 3 attempts.
// The literal SPK6 criteria (start view ≤ 150 ms, ack ≤ 100 ms p95) are evaluated into the report
// (`criteria`) without gating; docs/STATUS.md reports them as a deviation where they are not met.

const GROUP = 8;
const GROUPS = 110;
const PHASES = [
  { name: 'nah', distance: 6, clicks: 50, pipeline: true },
  { name: 'mittel', distance: 10, clicks: 16, pipeline: false },
  { name: 'start', distance: 105, clicks: 40, pipeline: false },
] as const;
const MEASURE_GATE = process.env['FAF_LATENCY_GATE'] === '1';
const MAX_ATTEMPTS = MEASURE_GATE ? 3 : 1;
const STALL_MS = 50;
const MIN_SAMPLES = 0.6;
const GATES = { markerFrames: 1, ackSimMs: 100, moveP95Ms: 150, mainJsP95Ms: 2, cmdApplyTicks: 1 } as const;

interface PhaseResult {
  readonly attempt: number;
  readonly snap: MetricsSnapshot;
  /** Always-on invariant failures. */
  readonly invariantFailures: string[];
  /** Millisecond pipeline gate failures (only evaluated for the pipeline phase). */
  readonly msFailures: string[];
  readonly stalled: boolean;
}

/** Machine-independent invariants of one phase. */
function invariantFailures(s: MetricsSnapshot, clicks: number): string[] {
  const f: string[] = [];
  const min = Math.ceil(clicks * MIN_SAMPLES);
  if (s.clicks !== clicks) f.push(`clicks ${s.clicks} ≠ ${clicks}`);
  if (s.timeouts !== 0) f.push(`timeouts ${s.timeouts}`);
  if (s.clickToMarkerFrames.count !== clicks) f.push(`marker samples ${s.clickToMarkerFrames.count} ≠ ${clicks}`);
  if (s.clickToMarkerFrames.max > GATES.markerFrames) f.push(`marker frames max ${s.clickToMarkerFrames.max} > ${GATES.markerFrames}`);
  if (s.clickToAckMs.count !== clicks) f.push(`ack samples ${s.clickToAckMs.count} ≠ ${clicks}`);
  if (s.clickToMoveMs.count < min) f.push(`move samples ${s.clickToMoveMs.count} < ${min}`);
  return f;
}

/** Millisecond gates of the pipeline phase (explicit measurement run only). */
function msFailures(s: MetricsSnapshot): string[] {
  const f: string[] = [];
  const rafMs = s.rafIntervalMs.p50;
  if (s.clickToAckMs.p95 > GATES.ackSimMs + rafMs) f.push(`ack p95 ${s.clickToAckMs.p95.toFixed(1)} > ${(GATES.ackSimMs + rafMs).toFixed(1)}`);
  if (s.clickToMoveMs.p95 > GATES.moveP95Ms) f.push(`first moved pixel p95 ${s.clickToMoveMs.p95.toFixed(1)} > ${GATES.moveP95Ms}`);
  return f;
}

/** Runs `clicks` right clicks, each commanding the next resting group, camera at `distance`. */
async function clickPhase(page: Page, groups: number[][], start: number, clicks: number, distance: number): Promise<MetricsSnapshot> {
  const vp = page.viewportSize()!;
  await page.evaluate(() => window.__faf!.metrics.reset());
  for (let i = 0; i < clicks; i++) {
    const handles = groups[(start + i) % groups.length]!;
    await page.evaluate(
      ({ hs, d }) => {
        const h = window.__faf!;
        let x = 0;
        let z = 0;
        let n = 0;
        for (const handle of hs) {
          const p = h.unitPos(handle);
          if (p === null) continue;
          x += p.x;
          z += p.z;
          n++;
        }
        h.select(hs);
        if (n > 0) h.setCamera(x / n, z / n, d);
      },
      { hs: handles, d: distance },
    );
    await page.waitForTimeout(40 + Math.random() * 100);
    await page.mouse.click(vp.width / 2 + 170, vp.height / 2 + 40, { button: 'right' });
    await page.waitForFunction(() => window.__faf!.metrics.snapshot().pendingMeasurements === 0, null, { timeout: 8000 });
  }
  return page.evaluate(() => window.__faf!.metrics.snapshot());
}

function summary(s: MetricsSnapshot) {
  return {
    clicks: s.clicks,
    markerFrames: s.clickToMarkerFrames,
    markerMs: s.clickToMarkerMs,
    ackMs: s.clickToAckMs,
    firstMovedPixelMs: s.clickToMoveMs,
    movingAtClick: s.movingAtClick,
    timeouts: s.timeouts,
    rafIntervalMs: s.rafIntervalMs,
  };
}

for (const server of SERVERS) {
  test(`latency (SPK6): Marker, seq-Bestätigung, erster bewegter Pixel – ${server.label}`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const errors = captureErrors(page);
    await openGame(page, server.url, '', 1000);
    await waitTick(page, 30); // spawn settled, separation asleep

    // Disjoint groups of resting cubes around a 11 × 10 grid over the start army.
    const groups = await page.evaluate(
      ({ count, size }) => {
        const h = window.__faf!;
        const units = h.ownHandles().map((handle) => ({ handle, p: h.unitPos(handle)! }));
        const used = new Set<number>();
        const out: number[][] = [];
        for (let i = 0; i < count; i++) {
          const gx = 256 - 27.5 + (i % 11) * 5.5;
          const gz = 256 - 27 + Math.floor(i / 11) * 6;
          const cand = units
            .filter((u) => !used.has(u.handle))
            .sort((a, b) => Math.hypot(a.p.x - gx, a.p.z - gz) - Math.hypot(b.p.x - gx, b.p.z - gz))
            .slice(0, size);
          for (const u of cand) used.add(u.handle);
          out.push(cand.map((u) => u.handle));
        }
        return out;
      },
      { count: GROUPS, size: GROUP },
    );
    expect(groups).toHaveLength(GROUPS);

    let next = 0;
    const results: Record<string, PhaseResult[]> = {};
    for (const phase of PHASES) {
      const attempts: PhaseResult[] = [];
      for (let attempt = 1; attempt <= (phase.pipeline ? MAX_ATTEMPTS : 1); attempt++) {
        const snap = await clickPhase(page, groups, next, phase.clicks, phase.distance);
        next += phase.clicks;
        const inv = invariantFailures(snap, phase.clicks);
        const ms = phase.pipeline ? msFailures(snap) : [];
        const stalled = snap.rafIntervalMs.max >= STALL_MS;
        attempts.push({ attempt, snap, invariantFailures: inv, msFailures: ms, stalled });
        if (!MEASURE_GATE || (inv.length === 0 && ms.length === 0) || !stalled) break;
      }
      results[phase.name] = attempts;
    }
    const pipeline = results['nah']!;
    const final = pipeline[pipeline.length - 1]!;
    const start = results['start']![0]!;

    // Main-JS and FPS with all 1,000 own cubes driving.
    await page.evaluate(() => {
      const h = window.__faf!;
      h.select(null);
      h.setCamera(256, 256, 105);
      h.sendMove(h.ownHandles(), 256, 150);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__faf!.metrics.reset());
    await page.waitForTimeout(3000);
    const load = await page.evaluate(() => {
      const h = window.__faf!;
      const s = h.metrics.snapshot();
      return {
        mainJsMs: s.mainJsMs,
        fps: s.fps,
        rafIntervalMs: s.rafIntervalMs,
        units: h.unitCount,
        render: h.renderStats(),
        stats: h.stats(),
        status: h.hostStatus(),
        frame: s.frame,
      };
    });

    // Host command counters (stats arrive every 10 ticks; read after the 3 s load phase).
    const hostStats = load.stats as { cmdApplyTicksMax: number; cmdBatchesApplied: number } | null;
    const report = {
      browser: testInfo.project.name,
      transport: server.transport,
      crossOriginIsolated: server.coi,
      measuredLocally: 'lokal gemessen (Apple M5 Pro, Playwright headless), kein GPU-Runner',
      groupSize: GROUP,
      measurementGate: MEASURE_GATE,
      gates: { ...GATES, ackGateMs: GATES.ackSimMs + final.snap.rafIntervalMs.p50 },
      // Literal SPK6 criteria (PLAN §4), evaluated, not gated (see header comment).
      criteria: {
        markerMaxFrames: Math.max(...PHASES.flatMap((p) => results[p.name]!.map((a) => a.snap.clickToMarkerFrames.max))),
        ackP95Ms: final.snap.clickToAckMs.p95,
        ackP95Le100: final.snap.clickToAckMs.p95 <= 100,
        firstMovedPixelP95MsPipeline: final.snap.clickToMoveMs.p95,
        firstMovedPixelP95MsStartView: start.snap.clickToMoveMs.p95,
        firstMovedPixelStartViewLe150: start.snap.clickToMoveMs.p95 <= 150,
        cmdApplyTicksMax: hostStats?.cmdApplyTicksMax ?? null,
      },
      phases: PHASES.map((p) => ({
        name: p.name,
        distanceWU: p.distance,
        pipeline: p.pipeline,
        attempts: results[p.name]!.map((a) => ({
          attempt: a.attempt,
          stalled: a.stalled,
          invariantFailures: a.invariantFailures,
          msFailures: a.msFailures,
          ...summary(a.snap),
        })),
      })),
      mainJsMs: load.mainJsMs,
      fps: load.fps,
      rafIntervalMs: load.rafIntervalMs,
      unitsDuringLoad: load.units,
      renderCpuMs: load.render.cpuMs,
      simStats: load.stats,
      hostStatus: load.status,
      frameStream: load.frame,
    };
    const dir = resolve(import.meta.dirname, '../../test-results');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `latency-${testInfo.project.name}-${server.transport}.json`), JSON.stringify(report, null, 2));
    await testInfo.attach('latency', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    // Always: pipeline invariants in frames/ticks.
    for (const p of PHASES) {
      for (const a of results[p.name]!) {
        expect(a.invariantFailures, `${p.name}, attempt ${a.attempt}`).toEqual([]);
      }
    }
    expect(hostStats, 'host stats').not.toBeNull();
    expect(hostStats!.cmdApplyTicksMax, 'cmd → applied in the next tick').toBe(GATES.cmdApplyTicks);
    expect(hostStats!.cmdBatchesApplied).toBeGreaterThanOrEqual(PHASES.reduce((n, p) => n + p.clicks, 0));
    // Explicit measurement run only: millisecond gates of the pipeline phase.
    if (MEASURE_GATE) expect(final.msFailures, `attempt ${final.attempt}: ${final.msFailures.join('; ')}`).toEqual([]);
    expect(load.units).toBe(1024);
    expect(load.mainJsMs.p95).toBeLessThanOrEqual(GATES.mainJsP95Ms);
    expectNoErrors(errors);
  });
}
