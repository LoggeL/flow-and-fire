import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { MetricsSnapshot } from '../../packages/client/src/metrics.ts';
import { captureErrors, expectNoErrors, openGame, SERVERS, waitTick } from './support/game.ts';

// SPK6 latency chain (PLAN §4, MS1 acceptance), per browser and transport, real right clicks:
//   click marker ≤ 1 frame; seq confirmation ≤ 100 ms (sim side: applied in the next tick) plus at most
//   one display frame (the client polls frames once per rAF, P4 deviation 8); click → first moved
//   pixel ≤ 150 ms p95.
// Definitions (packages/client/src/metrics.ts): the click time is the pointerdown event timestamp;
// "first moved pixel" = first rAF in which a commanded unit that stood still at the click is drawn
// ≥ 1 CSS px away from how it was drawn at the click (position or heading, same camera). Every click
// commands a resting group of cubes; a random 40–140 ms pause before each click samples the tick phase
// uniformly. Because the cubes accelerate (3 WU/s²: 0.03 WU in the first tick) the pixel criterion
// depends on the zoom: the gate uses the closest zoom (6 WU camera distance ≈ 0.007 WU/px, i.e. the
// pipeline latency); 10 WU and the start view (105 WU) are logged for information.
// Environment guard: a gated phase that fails while the browser's rAF stalled (an interval ≥ 50 ms,
// i.e. ≥ 3 missed vsyncs – the compositor, not the pipeline) is repeated, at most 3 attempts; every
// attempt is written to the report.
// Afterwards Main-JS p95 and FPS are measured with all 1,000 own cubes driving (FPS: headless, local
// Apple M5 Pro, no GPU runner – logged, not gated).

const GROUP = 8;
const GROUPS = 110;
const PHASES = [
  { name: 'nah', distance: 6, clicks: 50, gated: true },
  { name: 'mittel', distance: 10, clicks: 16, gated: false },
  { name: 'start', distance: 105, clicks: 16, gated: false },
] as const;
const MAX_ATTEMPTS = 3;
const STALL_MS = 50;
const GATES = { markerFrames: 1, ackSimMs: 100, moveP95Ms: 150, mainJsP95Ms: 2 } as const;

interface PhaseResult {
  readonly attempt: number;
  readonly snap: MetricsSnapshot;
  readonly failures: string[];
  readonly stalled: boolean;
}

function gateFailures(s: MetricsSnapshot, clicks: number): string[] {
  const f: string[] = [];
  const rafMs = s.rafIntervalMs.p50;
  if (s.clicks !== clicks) f.push(`clicks ${s.clicks} ≠ ${clicks}`);
  if (s.clickToMarkerFrames.count < 30) f.push(`marker samples ${s.clickToMarkerFrames.count} < 30`);
  if (s.clickToMarkerFrames.max > GATES.markerFrames) f.push(`marker frames max ${s.clickToMarkerFrames.max} > 1`);
  if (s.clickToAckMs.count < 30) f.push(`ack samples ${s.clickToAckMs.count} < 30`);
  if (s.clickToAckMs.p95 > GATES.ackSimMs + rafMs) f.push(`ack p95 ${s.clickToAckMs.p95.toFixed(1)} > ${(GATES.ackSimMs + rafMs).toFixed(1)}`);
  if (s.clickToMoveMs.count < 30) f.push(`move samples ${s.clickToMoveMs.count} < 30`);
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
      for (let attempt = 1; attempt <= (phase.gated ? MAX_ATTEMPTS : 1); attempt++) {
        const snap = await clickPhase(page, groups, next, phase.clicks, phase.distance);
        next += phase.clicks;
        const failures = phase.gated ? gateFailures(snap, phase.clicks) : [];
        const stalled = snap.rafIntervalMs.max >= STALL_MS;
        attempts.push({ attempt, snap, failures, stalled });
        if (failures.length === 0 || !stalled) break;
      }
      results[phase.name] = attempts;
    }
    const gated = results['nah']!;
    const final = gated[gated.length - 1]!;

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

    const report = {
      browser: testInfo.project.name,
      transport: server.transport,
      crossOriginIsolated: server.coi,
      measuredLocally: 'lokal gemessen (Apple M5 Pro, Playwright headless), kein GPU-Runner',
      groupSize: GROUP,
      gates: { ...GATES, ackGateMs: GATES.ackSimMs + final.snap.rafIntervalMs.p50 },
      phases: PHASES.map((p) => ({
        name: p.name,
        distanceWU: p.distance,
        gated: p.gated,
        attempts: results[p.name]!.map((a) => ({ attempt: a.attempt, stalled: a.stalled, failures: a.failures, ...summary(a.snap) })),
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

    expect(final.failures, `attempt ${final.attempt}: ${final.failures.join('; ')}`).toEqual([]);
    for (const p of PHASES) {
      for (const a of results[p.name]!) {
        expect(a.snap.clickToMarkerFrames.max, `marker frames (${p.name}, attempt ${a.attempt})`).toBeLessThanOrEqual(GATES.markerFrames);
      }
    }
    expect(load.units).toBe(1024);
    expect(load.mainJsMs.p95).toBeLessThanOrEqual(GATES.mainJsP95Ms);
    expectNoErrors(errors);
  });
}
