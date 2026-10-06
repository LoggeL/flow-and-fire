import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { MarkKind, parseCommandLog } from '../../packages/sim-host/src/log-format.ts';
import { attachJson, captureErrors, expectNoErrors, MEASURED_LOCALLY, PERF_GATE, writeReport } from './support/game.ts';
import { COI_PORT } from './support/ports.ts';
import { focusCanvas, pauseSim, resumeSim } from './support/ms3.ts';

// Blueprint HMR (S6, MS3; dev feature): a Vite dev server for apps/game is started here on
// FAF_E2E_PORT + 2 with FAF_BLUEPRINT_DIR pointing to a temporary copy of content/blueprints (OS
// temp dir). Editing the speed of the light tank in the copy reaches the running game: the command
// log gets a devReload MARK (tainted), the HUD shows the new blueprint simHash, and the tank then
// drives measurably faster. A syntax error and a schema error in the copy only produce an error
// message (HUD + console), no reload, and the game keeps running. File change → applied is
// measured and reported (≤ 1 s gated only with FAF_PERF_GATE=1). Server and copy are removed in
// afterAll. Chromium only: the plugin and the page code are the same in every engine, the other
// engines are covered by the production-build specs (and by `test/e2e/scripts/dev-check.ts`).

const REPO = resolve(import.meta.dirname, '../..');
const PORT = COI_PORT + 2;
const ORIGIN = `http://localhost:${PORT}`;
const TANK = 'core/units/lnd_t1_tank.ts';
const SPEED_OLD = 'speed: 3.0,';
const SPEED_NEW = 'speed: 4.5,';
const RUN_TICKS = 60;

let server: ChildProcess | null = null;
let tmp = '';
let bpDir = '';
let serverLog = '';

function killServer(): Promise<void> {
  const p = server;
  server = null;
  if (p === null || p.exitCode !== null || p.pid === undefined) return Promise.resolve();
  return new Promise((res) => {
    const done = (): void => {
      clearTimeout(hard);
      res();
    };
    p.once('exit', done);
    // Detached: the server is its own process group (vite may spawn helpers).
    try {
      process.kill(-p.pid!, 'SIGTERM');
    } catch {
      p.kill('SIGTERM');
    }
    const hard = setTimeout(() => {
      try {
        process.kill(-p.pid!, 'SIGKILL');
      } catch {
        p.kill('SIGKILL');
      }
      setTimeout(res, 500);
    }, 4000);
  });
}

async function waitForServer(ms: number): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (server === null || server.exitCode !== null) throw new Error(`dev server exited:\n${serverLog}`);
    try {
      const r = await fetch(`${ORIGIN}/`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - t0 > ms) throw new Error(`dev server on ${PORT} not ready after ${ms} ms:\n${serverLog}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

test.describe('hmr', () => {
  test.beforeAll(async ({ browserName }) => {
    if (browserName !== 'chromium') return;
    tmp = mkdtempSync(join(tmpdir(), 'faf-e2e-hmr-'));
    bpDir = join(tmp, 'blueprints');
    cpSync(join(REPO, 'content', 'blueprints'), bpDir, { recursive: true });
    const vite = join(REPO, 'apps', 'game', 'node_modules', 'vite', 'bin', 'vite.js');
    server = spawn(process.execPath, [vite, '--port', String(PORT), '--strictPort', '--host', 'localhost'], {
      cwd: join(REPO, 'apps', 'game'),
      env: { ...process.env, FAF_BLUEPRINT_DIR: bpDir },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (d: Buffer) => (serverLog += d.toString()));
    server.stderr?.on('data', (d: Buffer) => (serverLog += d.toString()));
    await waitForServer(30_000);
  });

  test.afterAll(async () => {
    await killServer();
    if (tmp !== '') rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  /** Drives the tank `dx` WU along x for RUN_TICKS ticks; top speed = largest per-tick displacement (WU/s). */
  async function tankRun(page: Page, handle: number, dx: number): Promise<{ distance: number; topSpeed: number; from: { x: number; z: number } }> {
    return page.evaluate(
      async ({ h: handle, dx, n }) => {
        const h = window.__faf!;
        const p0 = h.unitPos(handle)!;
        h.sendMove([handle], p0.x + dx, p0.z);
        let prev = p0;
        let top = 0;
        for (let t = 0; t < n; t++) {
          const target = h.tick + 1;
          h.ctl({ t: 'step', ticks: 1 });
          await h.waitTick(target, 10_000);
          const p = h.unitPos(handle)!;
          top = Math.max(top, Math.hypot(p.x - prev.x, p.z - prev.z) * 10);
          prev = p;
        }
        const p1 = h.unitPos(handle)!;
        return { distance: Math.hypot(p1.x - p0.x, p1.z - p0.z), topSpeed: top, from: { x: p0.x, z: p0.z } };
      },
      { h: handle, dx, n: RUN_TICKS },
    );
  }

  /** Waits for HMR record `id` (applied or failed). */
  async function waitHmr(page: Page, count: number, timeout = 20_000): Promise<void> {
    await page.waitForFunction((n) => window.__faf!.hmr.count >= n && !window.__faf!.hmr.pending, count, { timeout });
  }

  test('hmr: Blueprint-Änderung ⇒ devReload (tainted), neue simHash im HUD, Panzer schneller; Syntax-/Schemafehler ⇒ Meldung, kein Reload', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Dev-Feature: Vite-Dev-Server + Blueprint-HMR-Plugin sind engine-unabhängig; ein Lauf in Chromium (andere Engines: Produktions-Build-Specs)');
    test.setTimeout(120_000);
    const errors = captureErrors(page);
    await page.goto(`${ORIGIN}/?spawn=none&cubes=0&enemy=0`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.__faf?.ready === true, null, { timeout: 60_000 });
    await focusCanvas(page);
    const coi = await page.evaluate(() => window.__faf!.crossOriginIsolated);
    // One light tank on the flat NW plateau (console spawn at the camera focus).
    await page.evaluate(() => {
      const h = window.__faf!;
      h.setCamera(80, 96, 45);
      h.console('spawn 1 0 lnd_t1_tank');
    });
    await page.waitForFunction(() => window.__faf!.ownHandles().length === 1, null, { timeout: 10_000 });
    await page.waitForFunction(() => window.__faf!.tick >= 20);
    await pauseSim(page);
    const tank = (await page.evaluate(() => window.__faf!.ownHandles()))[0]!;
    const simHash0 = await page.evaluate(() => window.__faf!.simHash);
    const hud0 = await page.locator('[data-testid="hud-simhash"]').innerText();
    await page.evaluate(() => {
      (window as unknown as { __fafMarker?: number }).__fafMarker = 42;
    });

    // Baseline speed: 60 ticks towards a point 40 WU east.
    const before = await tankRun(page, tank, 40);
    await page.evaluate(() => window.__faf!.ctl({ t: 'step', ticks: 40 }));
    await page.waitForFunction(() => window.__faf!.unitInfo(window.__faf!.ownHandles()[0]!)?.idle === true, null, { timeout: 10_000 }).catch(() => undefined);

    // 1. Faster light tank.
    const file = join(bpDir, TANK);
    const original = readFileSync(file, 'utf8');
    expect(original).toContain(SPEED_OLD);
    const hmr0 = await page.evaluate(() => window.__faf!.hmr.count);
    writeFileSync(file, original.replace(SPEED_OLD, SPEED_NEW));
    const mtime = statSync(file).mtimeMs;
    await waitHmr(page, hmr0 + 1);
    const snap1 = await page.evaluate(() => window.__faf!.hmr);
    const last = snap1.last!;
    expect(last.ok, last.error ?? '').toBe(true);
    expect(last.files.some((f) => f.endsWith('lnd_t1_tank.ts'))).toBe(true);
    const simHash1 = await page.evaluate(() => window.__faf!.simHash);
    expect(simHash1).not.toBe(simHash0);
    expect(simHash1).not.toBeNull();
    expect(simHash1! >>> 0).toBe(last.simHash! >>> 0);
    const hex1 = '0x' + (simHash1! >>> 0).toString(16).padStart(8, '0');
    await expect(page.locator('[data-testid="hud-simhash"]')).toHaveText(hex1);
    expect(hex1).not.toBe(hud0);
    await expect(page.locator('[data-testid="hud-tainted"]')).toHaveAttribute('data-tainted', '1');
    expect(await page.evaluate(() => window.__faf!.tainted)).toBe(true);
    const log = parseCommandLog(new Uint8Array(await page.evaluate(() => window.__faf!.exportLogData())));
    const devMarks = log.marks.filter((m) => m.kind === MarkKind.DevReload);
    expect(devMarks.length, 'MARK devReload in the command log').toBe(1);
    expect(log.tainted).toBe(true);

    // The tank now drives faster (same distance budget, back west).
    const after = await tankRun(page, tank, -40);
    expect(after.topSpeed, `top speed ${before.topSpeed.toFixed(2)} → ${after.topSpeed.toFixed(2)} WU/s (blueprint 3.0 → 4.5)`).toBeGreaterThan(before.topSpeed * 1.3);

    // 2. Syntax error: diagnostics, no reload, the game keeps running.
    const hmr1 = snap1.count;
    const simHashBefore = simHash1;
    writeFileSync(file, original.replace(SPEED_OLD, 'speed: 3.0,,,}'));
    await waitHmr(page, hmr1 + 1);
    const snap2 = await page.evaluate(() => window.__faf!.hmr);
    expect(snap2.last!.ok).toBe(false);
    expect(snap2.last!.error ?? '').not.toBe('');
    expect((snap2.last!.error ?? '').includes(String.fromCharCode(27)), 'plain text (no ANSI escapes) for HUD and console').toBe(false);
    await expect(page.locator('[data-testid="hud-hmr-error"]')).toBeVisible();
    // 3. Schema error (negative speed).
    writeFileSync(file, original.replace(SPEED_OLD, 'speed: -2,'));
    await waitHmr(page, hmr1 + 2);
    const snap3 = await page.evaluate(() => window.__faf!.hmr);
    expect(snap3.last!.ok).toBe(false);
    expect(snap3.last!.error ?? '').not.toBe('');
    // No reload: same document, same simHash, no further devReload.
    expect(await page.evaluate(() => (window as unknown as { __fafMarker?: number }).__fafMarker)).toBe(42);
    expect(await page.evaluate(() => window.__faf!.simHash)).toBe(simHashBefore);
    await resumeSim(page);
    const t0 = await page.evaluate(() => window.__faf!.tick);
    await page.waitForFunction((t) => window.__faf!.tick >= t + 10, t0, { timeout: 10_000 });
    const log2 = parseCommandLog(new Uint8Array(await page.evaluate(() => window.__faf!.exportLogData())));
    expect(log2.marks.filter((m) => m.kind === MarkKind.DevReload).length).toBe(1);

    const report = {
      browser: testInfo.project.name,
      measured: MEASURED_LOCALLY,
      devServer: { port: PORT, crossOriginIsolated: coi, blueprintDir: 'OS-Temp-Kopie von content/blueprints' },
      change: { file: TANK, from: SPEED_OLD, to: SPEED_NEW, mtime },
      timing: { totalMs: last.totalMs, compileMs: last.compileMs, fileToCompiledMs: last.compiledAt - last.changedAt, gateMs: 1000, gateApplied: PERF_GATE },
      simHash: { before: simHash0, after: simHash1, hud: hex1 },
      devReloadMarks: devMarks.map((m) => m.tick),
      speed: { topBeforeWuPerS: before.topSpeed, topAfterWuPerS: after.topSpeed, ratio: after.topSpeed / before.topSpeed, distanceBeforeWU: before.distance, distanceAfterWU: after.distance, ticks: RUN_TICKS },
      errors: { syntax: snap2.last!.error, schema: snap3.last!.error },
    };
    writeReport(`hmr-${testInfo.project.name}`, report);
    await attachJson(testInfo, 'hmr', report);
    if (PERF_GATE) expect(last.totalMs!, 'file change → applied').toBeLessThanOrEqual(1000);
    // Page errors are not expected; the compile errors are reported via the HUD/console (console.error allowed).
    expectNoErrors(errors.filter((e) => !e.startsWith('console.error: [faf] blueprint HMR')));
  });
});
