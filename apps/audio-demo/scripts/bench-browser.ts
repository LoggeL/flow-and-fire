import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { chromium, firefox, webkit, type BrowserType } from '@playwright/test';
import { firefoxEnv } from '../playwright.config.ts';
import type { DemoStats } from '../src/main.ts';
import { installSilentOutput } from '../test/support/silent-output.ts';
const appDir = resolve(import.meta.dirname, '..');
const port = Number(process.env['FAF_E2E_PORT'] ?? 4583);
const origin = `http://127.0.0.1:${port}`;
function command(args: string[]): Promise<void> { return new Promise((ok, fail) => { const child = spawn('pnpm', args, { cwd: appDir, stdio: 'inherit' }); child.once('error', fail); child.once('exit', code => { if (code === 0) ok(); else fail(new Error(`pnpm ${args.join(' ')} exited ${code}`)); }); }); }
await command(['build']);
const resultDir = resolve(appDir, 'results'); mkdirSync(resultDir, { recursive: true });
const digest = createHash('sha256');
function hashTree(dir: string): void { for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) { const path = resolve(dir, entry.name); if (entry.isDirectory()) hashTree(path); else { digest.update(path); digest.update(readFileSync(path)); } } }
hashTree(resolve(appDir, 'dist')); digest.update(readFileSync(resolve(appDir, 'playwright.config.ts'))); digest.update(`${process.platform}/${process.arch}/${cpus()[0]?.model}`); digest.update(readFileSync(resolve(appDir, 'test/support/silent-output.ts'))); digest.update(readFileSync(resolve(appDir, 'vite.config.ts'))); digest.update(readFileSync(resolve(appDir, 'scripts/bench-browser.ts'))); digest.update(readFileSync(resolve(appDir, '../../content/audio/dist/manifest.json')));
const fingerprint = digest.digest('hex'), checkpoint = resolve(resultDir, 'browser-incomplete.json');
const runs: { browser: string; shots: number; run: number; browserVersion: string; clockResolutionMs: number; crossOriginIsolated: boolean; measuredAt: string; stats: DemoStats }[] = [];
const persist = (): void => { writeFileSync(checkpoint + '.tmp', JSON.stringify({ fingerprint, runs }, null, 2)); renameSync(checkpoint + '.tmp', checkpoint); };
if (existsSync(checkpoint)) { const saved = JSON.parse(readFileSync(checkpoint, 'utf8')) as { fingerprint?: string; runs?: typeof runs }; if (saved.fingerprint === fingerprint && Array.isArray(saved.runs) && saved.runs.length < 18) runs.push(...saved.runs); }
const server = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let serverOutput = ''; server.stdout.on('data', data => { serverOutput += String(data); }); server.stderr.on('data', data => { serverOutput += String(data); });
try {
  let ready = false; for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(`Preview exited: ${serverOutput}`); try { const r = await fetch(`${origin}/offline.html`); ready = r.ok; } catch { /* Await preview startup. */ } if (ready) break; await new Promise(r => setTimeout(r, 100)); } if (!ready) throw new Error('Preview did not start');
  const engines: [string, BrowserType][] = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
  for (const [name, type] of engines) {
    const env = name === 'firefox' ? firefoxEnv() : undefined; const browser = await type.launch({ ...(env ? { env } : {}) });
    try { for (const shots of [200, 400]) for (let run = 1; run <= 3; run++) {
      if (runs.some(r => r.browser === name && r.shots === shots && r.run === run && r.browserVersion === browser.version())) { console.log(`Resumed ${name} ${shots} #${run}`); continue; }
      for (let i = runs.length - 1; i >= 0; i--) if (runs[i]!.browser === name && runs[i]!.shots === shots && runs[i]!.run === run) runs.splice(i, 1);
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
      await installSilentOutput(page);
      await page.goto(`${origin}/?shots=${shots}&seconds=21&seed=${run}`); await page.evaluate(() => window.__fafAudioDemo.ready);
      if (!await page.evaluate(() => window.__fafAudioDemo.engine.context.destination instanceof MediaStreamAudioDestinationNode)) throw new Error('Audio output is not silent');
      const clock = await page.evaluate(() => { let last = performance.now(), resolution = Infinity; for (let i = 0; i < 200000; i++) { const t = performance.now(); if (t > last) { resolution = Math.min(resolution, t - last); last = t; } } return { clockResolutionMs: Number.isFinite(resolution) ? resolution : 1, crossOriginIsolated }; });
      await page.getByRole('button', { name: 'Klicken zum Aktivieren des Tons' }).click();
      await page.waitForTimeout(20000); const stats = await page.evaluate(() => window.__fafAudioDemo.stats()); if (errors.length) throw new Error(errors.join('\n')); if (stats.maxVoicesSeen > 32) throw new Error('Voice budget exceeded'); for (const category of Object.keys(stats.categoryLimits) as (keyof typeof stats.categoryLimits)[]) if (stats.maxByCategorySeen[category] > stats.categoryLimits[category]) throw new Error(`${category} voice budget exceeded`); if (stats.engine.loadedSounds <= 0 || stats.engine.dropped.notLoaded > 0 || stats.scenario.weaponFire < shots * 18 || stats.engine.mainJs.samples < 600 || stats.engine.played === 0) throw new Error('Incomplete audio workload'); runs.push({ browser: name, shots, run, browserVersion: browser.version(), ...clock, measuredAt: new Date().toISOString(), stats }); persist(); console.log(`${name} ${shots} #${run}: p95 ${stats.engine.mainJs.p95.toFixed(4)} ms`); await page.close();
    } } finally { await browser.close(); }
  }
  const dir = resolve(appDir, 'results'); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, `${Date.now()}.json`), JSON.stringify({ fingerprint, output: 'real AudioContext graph to MediaStream destination, no speaker connection', measuredAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, runs }, null, 2));
  const table = ['| Browser | Schüsse/s | p50 ms (Bereich) | p95 ms (Bereich) | p99 ms (Bereich) | Stimmen | Timer ms | Dekodierpfad |', '|---|---|---|---|---|---|---|---|'];
  for (const name of ['chromium', 'firefox', 'webkit']) for (const shots of [200, 400]) { const selected = runs.filter(r => r.browser === name && r.shots === shots); const range = (key: 'p50' | 'p95' | 'p99'): string => { const v = selected.map(r => r.stats.engine.mainJs[key]); return `${Math.min(...v).toFixed(4)} bis ${Math.max(...v).toFixed(4)}`; }; table.push(`| ${name} | ${shots} | ${range('p50')} | ${range('p95')} | ${range('p99')} | ${Math.max(...selected.map(r => r.stats.maxVoicesSeen))} | ${Math.max(...selected.map(r => r.clockResolutionMs)).toFixed(4)} | ${JSON.stringify(selected[0]!.stats.engine.decodePaths)} |`); }
  if (process.argv.includes('--update-docs')) for (const file of ['track-audioeng-c2.md', 'track-audioeng.md']) { const path = resolve(appDir, '../../docs/status', file); const s = readFileSync(path, 'utf8'); writeFileSync(path, s.replace(/<!-- bench:audio-browser:start -->[\s\S]*?<!-- bench:audio-browser:end -->/, `<!-- bench:audio-browser:start -->\n${table.join('\n')}\n<!-- bench:audio-browser:end -->`)); }
  unlinkSync(checkpoint);
  if (process.env['FAF_AUDIO_PERF_GATE'] === '1' && runs.some(r => r.shots === 200 && r.stats.engine.mainJs.p95 > .5)) throw new Error('Browser p95 exceeds 0.5 ms');
} finally {
  if (server.pid !== undefined) { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* Server already stopped. */ } await new Promise<void>(r => { if (server.exitCode !== null) r(); else server.once('exit', () => r()); }); }
}
