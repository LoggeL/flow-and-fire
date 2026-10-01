import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from './support/silent-test.ts';
import type { MetricsSnapshot } from '../../packages/client/src/metrics.ts';
import { UnitFlags } from '../../packages/protocol/src/index.ts';
import { captureErrors, expectNoErrors, HOLLOW_RIDGE, openGame, SERVERS, waitTick } from './support/game.ts';

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
// FAF_LATENCY_GATE=1 retains the legacy near-camera gate: movement p95 ≤ 150 ms and ACK p95
// ≤ 100 ms + median rAF, with at most three near-phase attempts when rAF stalls ≥ 50 ms.
// That mode and the default invariant-only mode do not qualify the literal SPK6 criteria.
// FAF_LITERAL_LATENCY_GATE=1 takes precedence: ACK p95 ≤ 100 ms in every phase and rendered
// movement p95 ≤ 150 ms in the unchanged 105 WU start view. Every phase runs exactly once;
// compositor stalls remain evidence and never trigger a replacement literal attempt.
// Every attempt saves its complete metrics snapshot before assertions, including failed runs.
// The native-pointer-cell/accepted-tail fixture preserves the original (170,40) screen direction.
// It scans outward while retaining the real 24px context radius and all native latency samples.
// Endpoint distance can change. This is separate evidence from the failed original fixed endpoint.

const GROUP = 8;
const GROUPS = 110;
const FIXTURE = 'native-pointer-cell-accepted-tail-clear-ground';
const PHASES = [
  { name: 'nah', distance: 6, clicks: 50, pipeline: true },
  { name: 'mittel', distance: 10, clicks: 16, pipeline: false },
  { name: 'start', distance: 105, clicks: 40, pipeline: false },
] as const;
const LITERAL_GATE = process.env['FAF_LITERAL_LATENCY_GATE'] === '1';
const LEGACY_GATE_REQUESTED = process.env['FAF_LATENCY_GATE'] === '1';
const MEASURE_GATE = LEGACY_GATE_REQUESTED && !LITERAL_GATE;
const GATE_MODE = LITERAL_GATE ? 'literal-spk6' : MEASURE_GATE ? 'legacy-near-camera' : 'invariants-only';
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
  /** Literal ACK gate for every phase; literal movement gate for the start view. */
  readonly literalFailures: string[];
  readonly stalled: boolean;
  readonly clickGeometry: readonly unknown[];
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

/** Original limits, without an rAF allowance or a nearer-camera substitute. */
function literalFailures(s: MetricsSnapshot, startView: boolean): string[] {
  const f: string[] = [];
  if (!Number.isFinite(s.clickToAckMs.p95) || s.clickToAckMs.p95 > GATES.ackSimMs) {
    f.push(`ack p95 ${s.clickToAckMs.p95} must be finite and ≤ ${GATES.ackSimMs}`);
  }
  if (startView && (!Number.isFinite(s.clickToMoveMs.p95) || s.clickToMoveMs.p95 > GATES.moveP95Ms)) {
    f.push(`start-view first moved pixel p95 ${s.clickToMoveMs.p95} must be finite and ≤ ${GATES.moveP95Ms}`);
  }
  return f;
}

// Literal qualification never replaces a failed test with a Playwright retry either.
if (LITERAL_GATE) test.describe.configure({ retries: 0 });

/** Runs `clicks` right clicks, each commanding the next resting group, camera at `distance`. */
async function clickPhase(page: Page, groups: number[][], start: number, clicks: number, distance: number, clickGeometry: unknown[]): Promise<MetricsSnapshot> {
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
    const geometry = await page.evaluate(({ width, height, hiddenFlags }) => {
      const h = window.__faf!;
      // Context targeting reads accepted records. Bound the native pointer's floor/ceil CSS
      // cell and the remaining accepted interpolation tail, rather than a single instant.
      const full: { handle: number; army: number; visual: number; x: number; y: number;
        acceptedCur: { x: number; y: number } | null; worldCur: { x: number; y: number; z: number } }[] = [];
      for (const unit of h.projectedUnits()) {
        const current = h.unitInfo(unit.handle);
        if (current === null || (current.flags & hiddenFlags) !== 0) continue;
        full.push({ handle: unit.handle, army: unit.army, visual: unit.visual, x: unit.x, y: unit.y,
          acceptedCur: h.project(current.x, current.y, current.z),
          worldCur: { x: current.x, y: current.y, z: current.z } });
      }
      const pointSegmentSquared = (x: number, y: number, ax: number, ay: number, bx: number, by: number): number => {
        const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
        const t=length===0?0:Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length));
        return (x-ax-t*dx)**2+(y-ay-t*dy)**2;
      };
      const cellSweepSquared = (pixel: { x: number; y: number }, unit: (typeof full)[number]): number => {
        if (unit.acceptedCur === null) return 0; // cannot prove a tail crossing the eye plane clear
        const x0=Math.floor(pixel.x),x1=Math.ceil(pixel.x),y0=Math.floor(pixel.y),y1=Math.ceil(pixel.y);
        const ax=unit.x,ay=unit.y,bx=unit.acceptedCur.x,by=unit.acceptedCur.y,dx=bx-ax,dy=by-ay;
        let lo=0,hi=1;
        if(dx===0){if(ax<x0||ax>x1)lo=2;}
        else {const t0=(x0-ax)/dx,t1=(x1-ax)/dx;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
        if(dy===0){if(ay<y0||ay>y1)lo=2;}
        else {const t0=(y0-ay)/dy,t1=(y1-ay)/dy;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
        if(lo<=hi)return 0;
        const endpointSquared=(x: number,y: number):number => (x-Math.max(x0,Math.min(x1,x)))**2+(y-Math.max(y0,Math.min(y1,y)))**2;
        return Math.min(endpointSquared(ax,ay),endpointSquared(bx,by),
          pointSegmentSquared(x0,y0,ax,ay,bx,by),pointSegmentSquared(x0,y1,ax,ay,bx,by),
          pointSegmentSquared(x1,y0,ax,ay,bx,by),pointSegmentSquared(x1,y1,ax,ay,bx,by));
      };
      const rejected: { lambda: number; pixel: { x: number; y: number }; reason: string;
        targets: { handle: number; army: number; x: number; y: number; distancePx: number; envelopeDistancePx: number }[] }[] = [];
      const maxStep = Math.floor(width / 2 - 1 - 170);
      for (let step = 0; step <= maxStep; step++) {
        const lambda = 1 + step / 170;
        const pixel = { x: width / 2 + 170 * lambda, y: height / 2 + 40 * lambda };
        if (pixel.y >= height - 1) break;
        const targets: { handle: number; army: number; x: number; y: number; distancePx: number; envelopeDistancePx: number }[] = [];
        for (const unit of full) {
          const squared = (unit.x - pixel.x) ** 2 + (unit.y - pixel.y) ** 2;
          const envelopeSquared=cellSweepSquared(pixel,unit);
          if (envelopeSquared <= 24 * 24) targets.push({ handle: unit.handle, army: unit.army, x: unit.x, y: unit.y,
            distancePx: Math.sqrt(squared),envelopeDistancePx: Math.sqrt(envelopeSquared) });
        }
        if (targets.length) { rejected.push({ lambda, pixel, reason: 'visible-target-envelope', targets }); continue; }
        if (document.elementFromPoint(pixel.x, pixel.y)?.id !== 'game-canvas') {
          rejected.push({ lambda, pixel, reason: 'outside-canvas', targets }); continue;
        }
        const pick = h.pickAt(pixel.x, pixel.y);
        if (pick === null || !pick.hit) { rejected.push({ lambda, pixel, reason: 'no-terrain-hit', targets }); continue; }
        return { tick: h.tick, camera: h.cameraState(), direction: { x: 170, y: 40 }, rejected,
          accepted: { lambda, pixel, pick, pointerCell: { x0: Math.floor(pixel.x), x1: Math.ceil(pixel.x),
            y0: Math.floor(pixel.y), y1: Math.ceil(pixel.y) } },fullRecordCount: full.length,acceptedProjectionTails: full,
          envelope: '24px-capsule-vs-native-pointer-cell',futureFrameMotionBound: false };
      }
      return { tick: h.tick, camera: h.cameraState(), direction: { x: 170, y: 40 }, rejected,
        accepted: null, fullRecordCount: full.length,acceptedProjectionTails: full,
        envelope: '24px-capsule-vs-native-pointer-cell',futureFrameMotionBound: false };
    }, { width: vp.width, height: vp.height, hiddenFlags: UnitFlags.Ghost | UnitFlags.Blip });
    // Retain all actual inspected endpoints before a click or a hard fixture failure.
    clickGeometry.push({ click: i, group: (start + i) % groups.length, handles, geometry });
    expect(geometry.accepted, 'original screen direction must reach clear visible terrain inside the actual canvas').not.toBeNull();
    await page.mouse.click(geometry.accepted!.pixel.x, geometry.accepted!.pixel.y, { button: 'right' });
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

    // Disjoint groups of resting cubes around a 11 × 10 grid over the start army (own map start).
    const groups = await page.evaluate(
      ({ count, size, c }) => {
        const h = window.__faf!;
        const units = h.ownHandles().map((handle) => ({ handle, p: h.unitPos(handle)! }));
        const used = new Set<number>();
        const out: number[][] = [];
        for (let i = 0; i < count; i++) {
          const gx = c.x - 27.5 + (i % 11) * 5.5;
          const gz = c.z - 27 + Math.floor(i / 11) * 6;
          const cand = units
            .filter((u) => !used.has(u.handle))
            .sort((a, b) => Math.hypot(a.p.x - gx, a.p.z - gz) - Math.hypot(b.p.x - gx, b.p.z - gz))
            .slice(0, size);
          for (const u of cand) used.add(u.handle);
          out.push(cand.map((u) => u.handle));
        }
        return out;
      },
      { count: GROUPS, size: GROUP, c: HOLLOW_RIDGE.own },
    );
    expect(groups).toHaveLength(GROUPS);

    let next = 0;
    const results: Record<string, PhaseResult[]> = {};
    for (const phase of PHASES) {
      const attempts: PhaseResult[] = [];
      for (let attempt = 1; attempt <= (phase.pipeline ? MAX_ATTEMPTS : 1); attempt++) {
        let snap: MetricsSnapshot | null = null;
        let interruption: string | null = null;
        const clickGeometry: unknown[] = [];
        try {
          snap = await clickPhase(page, groups, next, phase.clicks, phase.distance, clickGeometry);
        } catch (error) {
          interruption = String(error);
          snap = await page.evaluate(() => window.__faf!.metrics.snapshot()).catch(() => null);
          throw error;
        } finally {
          // Test-specific paths retain every actual attempt, even if a click wait fails or later
          // load/assertions abort the test. No samples or compositor stalls are filtered out.
          const raw = {
            browser: testInfo.project.name, transport: server.transport,
            gateMode: GATE_MODE, fixture: FIXTURE, phase: phase.name, distanceWU: phase.distance, clickGeometry,
            plannedClicks: phase.clicks, attempt, retry: testInfo.retry,
            repeatEachIndex: testInfo.repeatEachIndex, interruption, snapshot: snap,
          };
          const path = testInfo.outputPath(`latency-${phase.name}-attempt-${attempt}.json`);
          mkdirSync(dirname(path), { recursive: true });
          const body = JSON.stringify(raw, null, 2);
          writeFileSync(path, body);
          await testInfo.attach(`latency-${phase.name}-attempt-${attempt}`, { path, contentType: 'application/json' });
        }
        next += phase.clicks;
        const inv = invariantFailures(snap, phase.clicks);
        const ms = phase.pipeline ? msFailures(snap) : [];
        const literal = literalFailures(snap, phase.name === 'start');
        const stalled = snap.rafIntervalMs.max >= STALL_MS;
        attempts.push({ attempt, snap, invariantFailures: inv, msFailures: ms, literalFailures: literal, stalled, clickGeometry });
        if (!MEASURE_GATE || (inv.length === 0 && ms.length === 0) || !stalled) break;
      }
      results[phase.name] = attempts;
    }
    const pipeline = results['nah']!;
    const final = pipeline[pipeline.length - 1]!;
    const start = results['start']![0]!;

    // Main-JS and FPS with all 1,000 own cubes driving.
    await page.evaluate((o) => {
      const h = window.__faf!;
      h.select(null);
      h.setCamera(o.x, o.z, 105);
      h.sendMove(h.ownHandles(), o.x + 30, o.z - 30);
    }, HOLLOW_RIDGE.own);
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
      literalGate: LITERAL_GATE,
      legacyGateRequested: LEGACY_GATE_REQUESTED,
      gateMode: GATE_MODE,
      fixture: FIXTURE,
      originalFixedEndpointPreserved: false,
      originalLiteralCriteriaGated: LITERAL_GATE,
      gates: { ...GATES, ackGateMs: LITERAL_GATE ? GATES.ackSimMs : GATES.ackSimMs + final.snap.rafIntervalMs.p50 },
      // Default/legacy runs only report these limits. Literal mode also asserts every phase.
      criteria: {
        markerMaxFrames: Math.max(...PHASES.flatMap((p) => results[p.name]!.map((a) => a.snap.clickToMarkerFrames.max))),
        ackP95Ms: final.snap.clickToAckMs.p95,
        ackP95Le100: Number.isFinite(final.snap.clickToAckMs.p95) && final.snap.clickToAckMs.p95 <= GATES.ackSimMs,
        ackP95MsByPhase: Object.fromEntries(PHASES.map((p) => [p.name, results[p.name]![0]!.snap.clickToAckMs.p95])),
        allPhaseAckP95Le100: PHASES.every((p) => results[p.name]!.every((a) =>
          Number.isFinite(a.snap.clickToAckMs.p95) && a.snap.clickToAckMs.p95 <= GATES.ackSimMs)),
        firstMovedPixelP95MsPipeline: final.snap.clickToMoveMs.p95,
        firstMovedPixelP95MsStartView: start.snap.clickToMoveMs.p95,
        firstMovedPixelStartViewLe150: Number.isFinite(start.snap.clickToMoveMs.p95) && start.snap.clickToMoveMs.p95 <= GATES.moveP95Ms,
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
          literalFailures: a.literalFailures,
          snapshot: a.snap,
          clickGeometry: a.clickGeometry,
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
    const reportPath = resolve(dir, `latency-${testInfo.project.name}-${server.transport}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    await testInfo.attach('latency', { path: reportPath, contentType: 'application/json' });

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
    if (LITERAL_GATE) {
      for (const p of PHASES) {
        expect(results[p.name], `${p.name}: one literal attempt`).toHaveLength(1);
        expect(results[p.name]![0]!.literalFailures, `${p.name}: literal SPK6 limits`).toEqual([]);
      }
    }
    expect(load.units).toBe(1024);
    expect(load.mainJsMs.p95).toBeLessThanOrEqual(GATES.mainJsP95Ms);
    expectNoErrors(errors);
  });
}
