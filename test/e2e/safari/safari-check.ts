/**
 * Real Safari check (MS2 acceptance "WebKit-Smoke und echtes Safari grün") via safaridriver
 * (WebDriver, W3C). Nothing is configured here: remote automation must already be allowed
 * (Safari ▸ Develop ▸ Allow Remote Automation, or `safaridriver --enable` by the user) – this script
 * never changes system settings and never uses sudo.
 *
 *   pnpm build && node --import tsx test/e2e/safari/safari-check.ts
 *
 * Starts `apps/game/scripts/serve.mjs --coi` and `safaridriver` on free ports, opens the game,
 * waits for `data-ready`, runs the map checks through the test hooks (CPU == GPU in 10,000 probes,
 * units on the terrain, mapSimHash, crossOriginIsolated) and writes test-results/safari-check.json.
 * If safaridriver does not come up or refuses the session (remote automation off), the report says
 * so (`status: 'unavailable'`) and the script exits 0. Both child processes are always stopped.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '../../..');
const MAP_SIM_HASH = 0x90ec94f0;

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const port = typeof a === 'object' && a !== null ? a.port : 0;
      s.close(() => res(port));
    });
  });
}

async function waitHttp(url: string, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.status > 0) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

interface WdResponse {
  value: unknown;
}

async function wd(base: string, method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<WdResponse> {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json()) as WdResponse;
  const v = j.value as { error?: string; message?: string } | null;
  if (!r.ok || (v !== null && typeof v === 'object' && typeof v.error === 'string')) {
    throw new Error(`WebDriver ${method} ${path}: ${v?.error ?? r.status} ${v?.message ?? ''}`.trim());
  }
  return j;
}

async function main(): Promise<void> {
  const out = resolve(repo, 'test-results');
  mkdirSync(out, { recursive: true });
  const report: Record<string, unknown> = { date: new Date().toISOString(), status: 'unavailable' };
  const children: ChildProcess[] = [];
  let session: string | null = null;
  let driverBase = '';
  try {
    const webPort = await freePort();
    const driverPort = await freePort();
    const web = spawn(process.execPath, [resolve(repo, 'apps/game/scripts/serve.mjs'), '--port', String(webPort), '--coi'], { stdio: 'ignore' });
    children.push(web);
    if (!(await waitHttp(`http://localhost:${webPort}/build.json`, 10_000))) throw new Error('game server did not start (run pnpm build first)');
    const driver = spawn('safaridriver', ['--port', String(driverPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(driver);
    let driverLog = '';
    driver.stdout?.on('data', (d: Buffer) => (driverLog += d.toString()));
    driver.stderr?.on('data', (d: Buffer) => (driverLog += d.toString()));
    driverBase = `http://127.0.0.1:${driverPort}`;
    if (!(await waitHttp(`${driverBase}/status`, 10_000))) {
      report['reason'] = `safaridriver lauscht nicht auf Port ${driverPort} (Remote Automation nicht freigegeben?) ${driverLog.trim()}`.trim();
      return;
    }
    try {
      const s = await wd(driverBase, 'POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }, 60_000);
      session = (s.value as { sessionId: string }).sessionId;
    } catch (e) {
      report['reason'] = `Session abgelehnt: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    const sp = `/session/${session}`;
    await wd(driverBase, 'POST', `${sp}/url`, { url: `http://localhost:${webPort}/` });
    const exec = async <T>(script: string): Promise<T> => (await wd(driverBase, 'POST', `${sp}/execute/sync`, { script, args: [] })).value as T;
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000 && (await exec<string | null>('return document.documentElement.dataset.ready || null')) !== '1') {
      await new Promise((r) => setTimeout(r, 250));
    }
    const result = await exec<Record<string, unknown>>(`
      const h = window.__faf;
      return {
        ready: document.documentElement.dataset.ready === '1',
        userAgent: navigator.userAgent,
        crossOriginIsolated: h.crossOriginIsolated,
        transport: h.transport,
        map: h.mapName,
        mapSimHash: h.mapSimHash,
        simId: h.simId,
        units: h.unitCount,
        probe: h.probeHeights(10000, 2026),
        heights: h.unitHeights(),
        render: h.renderStats(),
        timings: h.loadTimings(),
        hostErrors: h.hostErrors,
      };`);
    const failures: string[] = [];
    if (result['ready'] !== true) failures.push('not ready');
    if (result['mapSimHash'] !== MAP_SIM_HASH) failures.push(`mapSimHash ${String(result['mapSimHash'])}`);
    if ((result['probe'] as { mismatches: number }).mismatches !== 0) failures.push('CPU ≠ GPU');
    if ((result['heights'] as { mismatches: number }).mismatches !== 0) failures.push('units off the terrain');
    report['status'] = failures.length === 0 ? 'ok' : 'failed';
    report['failures'] = failures;
    report['result'] = result;
  } catch (e) {
    report['reason'] = e instanceof Error ? e.message : String(e);
  } finally {
    if (session !== null) await wd(driverBase, 'DELETE', `/session/${session}`).catch(() => undefined);
    for (const c of children) c.kill('SIGTERM');
    writeFileSync(resolve(out, 'safari-check.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report['status'], reason: report['reason'] ?? null, failures: report['failures'] ?? [] }));
  }
  if (report['status'] === 'failed') process.exitCode = 1;
}

await main();
