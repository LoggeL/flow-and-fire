/**
 * Browser measurement of the audio engine (TRACK-AUDIOENG, audioeng-c2, part D).
 *
 * Builds the demo, serves it with `vite preview` (port FAF_E2E_PORT, default 4583) and measures per
 * browser (Chromium, Firefox, WebKit via Playwright) `runs` × `seconds` of the battle at 200 and
 * 400 shots/s: engine main-thread JS per frame (p50/p95/p99/max of `engine.stats().mainJs` and of
 * the demo's own measurement around all engine calls), voice peak, steals and drops, decode paths.
 * Writes `apps/audio-demo/results/<date>.json` (git-ignored); `--update-docs` replaces the table
 * between `<!-- bench:audio-browser:start -->` / `<!-- bench:audio-browser:end -->` in
 * docs/status/audioeng-c2.md and docs/status/track-audioeng.md. The 0.5 ms budget is reported, never gated (DECISIONS 16).
 *
 * Usage: FAF_E2E_PORT=4583 tools/heavy pnpm --filter @faf/audio-demo bench:browser [-- options]
 *   --update-docs        write the table into the status fragment
 *   --quick              1 run × 8 s per browser and rate
 *   --runs=N --seconds=S --warmup=S --rates=200,400 --browsers=chromium,firefox,webkit
 *   --skip-build         reuse dist/
 *
 * The preview server runs in its own process group and is always killed (also on errors and
 * SIGINT/SIGTERM).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import type { DemoHook, DemoStats } from '../src/demo/hook.ts';

declare global {
  interface Window {
    __fafAudioDemo?: DemoHook;
  }
}

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appDir, '../..');
/** Every file of this list that contains the markers gets the table. */
const statusFiles = ['docs/status/audioeng-c2.md', 'docs/status/track-audioeng.md'].map((f) => resolve(repoRoot, f));
const MARK_START = '<!-- bench:audio-browser:start -->';
const MARK_END = '<!-- bench:audio-browser:end -->';
const BUDGET_MS = 0.5;

type BrowserName = 'chromium' | 'firefox' | 'webkit';
const BROWSER_TYPES: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };

interface Options {
  updateDocs: boolean;
  runs: number;
  seconds: number;
  warmup: number;
  rates: number[];
  browsers: BrowserName[];
  skipBuild: boolean;
  port: number;
}

function parseArgs(argv: readonly string[]): Options {
  const o: Options = {
    updateDocs: false,
    runs: 3,
    seconds: 20,
    warmup: 2,
    rates: [200, 400],
    browsers: ['chromium', 'firefox', 'webkit'],
    skipBuild: false,
    port: Number(process.env['FAF_E2E_PORT'] ?? 4583),
  };
  for (const a of argv) {
    if (a === '--') continue;
    const [k, v = ''] = a.split('=', 2);
    if (k === '--update-docs') o.updateDocs = true;
    else if (k === '--skip-build') o.skipBuild = true;
    else if (k === '--quick') {
      o.runs = 1;
      o.seconds = 8;
    } else if (k === '--runs') o.runs = Math.max(1, Number(v) | 0);
    else if (k === '--seconds') o.seconds = Math.max(1, Number(v));
    else if (k === '--warmup') o.warmup = Math.max(0, Number(v));
    else if (k === '--rates') o.rates = v.split(',').map(Number).filter((n) => n > 0);
    else if (k === '--browsers') o.browsers = v.split(',').filter((b): b is BrowserName => b in BROWSER_TYPES);
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

// ---------------------------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------------------------

function runChecked(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: appDir, stdio: 'inherit' });
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited with ${String(code)}`))));
  });
}

let server: ChildProcess | null = null;

function killServer(): void {
  const s = server;
  server = null;
  if (s === null || s.pid === undefined || s.exitCode !== null) return;
  try {
    process.kill(-s.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
  const pid = s.pid;
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Exited after SIGTERM.
    }
  }, 2000).unref();
}

async function startServer(port: number): Promise<string> {
  const origin = `http://127.0.0.1:${port}`;
  server = spawn('pnpm', ['exec', 'vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: appDir,
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true,
  });
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (server === null || server.exitCode !== null) throw new Error('vite preview exited early (port in use?)');
    try {
      const r = await fetch(`${origin}/index.html`);
      if (r.ok) return origin;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite preview did not come up within 60 s');
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    killServer();
    process.exit(130);
  });
}
process.on('exit', () => killServer());

// ---------------------------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------------------------

interface RunResult {
  browser: BrowserName;
  shots: number;
  run: number;
  userAgent: string;
  stats: DemoStats;
}

function firefoxEnv(): Record<string, string> | undefined {
  if (platform() !== 'darwin') return undefined;
  const home = resolve(appDir, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

async function measure(page: Page, origin: string, shots: number, run: number, o: Options): Promise<DemoStats> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/index.html?shots=${shots}&seed=${run + 1}`);
  await page.waitForFunction(() => window.__fafAudioDemo !== undefined);
  await page.evaluate(() => window.__fafAudioDemo!.ready);
  if ((await page.evaluate(() => window.__fafAudioDemo!.engine.state)) !== 'running') {
    await page.click('#unlock-overlay');
    await page.waitForFunction(() => window.__fafAudioDemo!.engine.state === 'running', undefined, { timeout: 10_000 });
  }
  await page.evaluate((a) => {
    const h = window.__fafAudioDemo!;
    h.start({ shots: a.shots, seed: a.seed, speed: 1 });
    h.setCamera({ x: 256, z: 256, height: 90, yaw: 0 });
  }, { shots, seed: run + 1 });
  await page.waitForTimeout(o.warmup * 1000);
  await page.evaluate(() => window.__fafAudioDemo!.resetStats());
  await page.waitForTimeout(o.seconds * 1000);
  const s = await page.evaluate(() => window.__fafAudioDemo!.stats());
  await page.evaluate(() => window.__fafAudioDemo!.stop());
  if (errors.length > 0) throw new Error(`page errors: ${errors.join('; ')}`);
  return s;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n === 0 ? Number.NaN : n % 2 === 1 ? s[n >> 1]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

interface Row {
  browser: BrowserName;
  shots: number;
  runs: number;
  mainJs: { p50: number; p95: number; p99: number; max: number };
  mainJsRange: { p95Min: number; p95Max: number };
  engineCallsP95: number;
  tickFramesP95: number;
  tickFramesP99: number;
  generatorP95: number;
  voicesPeak: number;
  tailsPeak: number;
  stolenPerS: number;
  droppedPerS: number;
  playedPerS: number;
  drops: Record<string, number>;
  decodePaths: string;
  loadMs: number;
  timerMs: number;
  coi: boolean;
  frames: number;
  withinBudget: boolean;
}

function aggregate(results: RunResult[]): Row[] {
  const rows: Row[] = [];
  const keys = [...new Set(results.map((r) => `${r.browser}|${r.shots}`))];
  for (const key of keys) {
    const rs = results.filter((r) => `${r.browser}|${r.shots}` === key);
    const first = rs[0]!;
    const perS = (f: (s: DemoStats) => number): number => median(rs.map((r) => f(r.stats) / (r.stats.runMs / 1000)));
    const drops: Record<string, number> = {};
    for (const d of Object.keys(first.stats.engine.dropped)) {
      drops[d] = Math.round(median(rs.map((r) => (r.stats.engine.dropped as Record<string, number>)[d]! / (r.stats.runMs / 1000))));
    }
    const p95s = rs.map((r) => r.stats.engine.mainJs.p95);
    const row: Row = {
      browser: first.browser,
      shots: first.shots,
      runs: rs.length,
      mainJs: {
        p50: median(rs.map((r) => r.stats.engine.mainJs.p50)),
        p95: median(p95s),
        p99: median(rs.map((r) => r.stats.engine.mainJs.p99)),
        max: Math.max(...rs.map((r) => r.stats.engine.mainJs.max)),
      },
      mainJsRange: { p95Min: Math.min(...p95s), p95Max: Math.max(...p95s) },
      engineCallsP95: median(rs.map((r) => r.stats.engineCalls.p95)),
      tickFramesP95: median(rs.map((r) => r.stats.engineCallsTickFrames.p95)),
      tickFramesP99: median(rs.map((r) => r.stats.engineCallsTickFrames.p99)),
      generatorP95: median(rs.map((r) => r.stats.generator.p95)),
      voicesPeak: Math.max(...rs.map((r) => r.stats.maxVoicesSeen)),
      tailsPeak: Math.max(...rs.map((r) => r.stats.maxTailsSeen)),
      stolenPerS: perS((s) => s.engine.stolen),
      droppedPerS: perS((s) => Object.values(s.engine.dropped).reduce((a, b) => a + b, 0)),
      playedPerS: perS((s) => s.engine.played),
      drops,
      decodePaths: Object.entries(first.stats.load.paths)
        .filter(([, n]) => n > 0)
        .map(([p, n]) => `${p} ${n}`)
        .join(', '),
      loadMs: median(rs.map((r) => r.stats.load.ms)),
      timerMs: first.stats.timerResolutionMs,
      coi: first.stats.crossOriginIsolated,
      frames: median(rs.map((r) => r.stats.frames)),
      withinBudget: median(p95s) <= BUDGET_MS,
    };
    rows.push(row);
  }
  return rows;
}

const f3 = (v: number): string => v.toFixed(3).replace('.', ',');
const f0 = (v: number): string => String(Math.round(v));

function markdown(rows: Row[], o: Options, when: string, machine: string, versions: Record<string, string>): string {
  const lines = [
    `Gemessen ${when} auf ${machine}; je Browser und Rate ${o.runs} × ${o.seconds} s nach ${o.warmup} s Warm-up (Kamera auf der Front, Höhe 90 WU), Median der Läufe. Main-JS = \`engine.stats().mainJs\` (Engine-eigene Messung je Frame: handleEvents + play/playUi + setLoop + setListener + update, letzte 1024 Frames); „Aufrufe“ = Messung der Demo um alle Engine-Aufrufe über den ganzen Lauf, „Tick-Frames“ = nur Frames mit Sim-Tick (Event-Batch, ≈ jeder 6. Frame bei 60 fps). Budget ${String(BUDGET_MS).replace('.', ',')} ms p95 wird nur berichtet (DECISIONS 16).`,
    '',
    '| Browser | Schüsse/s | Main-JS p50 | p95 (Spanne) | p99 | max | Aufrufe p95 | Tick-Frames p95 / p99 | Generator p95 | Stimmen max | gespielt/s | gestohlen/s | verworfen/s | Frames | Dekodierpfad | Laden | Timer |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.browser} ${versions[r.browser] ?? ''} | ${r.shots} | ${f3(r.mainJs.p50)} | **${f3(r.mainJs.p95)}** (${f3(r.mainJsRange.p95Min)}–${f3(r.mainJsRange.p95Max)}) | ${f3(r.mainJs.p99)} | ${f3(r.mainJs.max)} | ${f3(r.engineCallsP95)} | ${f3(r.tickFramesP95)} / ${f3(r.tickFramesP99)} | ${f3(r.generatorP95)} | ${r.voicesPeak}/32 | ${f0(r.playedPerS)} | ${f0(r.stolenPerS)} | ${f0(r.droppedPerS)} | ${f0(r.frames)} | ${r.decodePaths} | ${f0(r.loadMs)} ms | ${f3(r.timerMs)} ms${r.coi ? ' (COI)' : ''} |`,
    );
  }
  lines.push('', 'Drops je Grund (Median je Sekunde):', '');
  lines.push('| Browser | Schüsse/s | ' + Object.keys(rows[0]?.drops ?? {}).join(' | ') + ' |');
  lines.push('|---|---|' + Object.keys(rows[0]?.drops ?? {}).map(() => '---').join('|') + '|');
  for (const r of rows) lines.push(`| ${r.browser} | ${r.shots} | ${Object.values(r.drops).join(' | ')} |`);
  return lines.join('\n');
}

function updateDocs(table: string): string[] {
  const updated: string[] = [];
  for (const file of statusFiles) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const a = text.indexOf(MARK_START);
    const b = text.indexOf(MARK_END);
    if (a < 0 || b < a) continue;
    writeFileSync(file, `${text.slice(0, a + MARK_START.length)}\n${table}\n${text.slice(b)}`);
    updated.push(file);
  }
  if (updated.length === 0) throw new Error(`markers ${MARK_START} / ${MARK_END} missing in ${statusFiles.join(', ')}`);
  return updated;
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv.slice(2));
  if (!o.skipBuild) await runChecked('pnpm', ['exec', 'vite', 'build', '--logLevel', 'warn']);
  const origin = await startServer(o.port);
  const results: RunResult[] = [];
  const versions: Record<string, string> = {};
  try {
    for (const name of o.browsers) {
      const ff = name === 'firefox' ? firefoxEnv() : undefined;
      let browser: Browser | null = null;
      try {
        browser = await BROWSER_TYPES[name].launch(ff !== undefined ? { env: ff } : {});
        versions[name] = browser.version();
        for (const shots of o.rates) {
          for (let run = 0; run < o.runs; run++) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
            const page = await context.newPage();
            try {
              const stats = await measure(page, origin, shots, run, o);
              const userAgent = await page.evaluate(() => navigator.userAgent);
              results.push({ browser: name, shots, run, userAgent, stats });
              const m = stats.engine.mainJs;
              console.log(
                `${name} ${shots}/s run ${run + 1}: mainJs p50 ${m.p50.toFixed(3)} p95 ${m.p95.toFixed(3)} p99 ${m.p99.toFixed(3)} ms, voices max ${stats.maxVoicesSeen}, stolen ${stats.engine.stolen}, frames ${stats.frames}`,
              );
            } finally {
              await context.close();
            }
          }
        }
      } finally {
        await browser?.close();
      }
    }
  } finally {
    killServer();
  }

  const rows = aggregate(results);
  const now = new Date();
  const when = `${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const machine = `${cpus()[0]?.model ?? 'unknown CPU'}, ${Math.round(totalmem() / 2 ** 30)} GB, ${platform()} ${release()}`;
  const table = markdown(rows, o, when, machine, versions);
  console.log(`\n${table}\n`);
  const outDir = resolve(appDir, 'results');
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ when: now.toISOString(), machine, options: o, versions, rows, runs: results }, null, 1));
  console.log(`wrote ${file}`);
  if (o.updateDocs) {
    for (const f of updateDocs(table)) console.log(`updated ${f}`);
  }
  for (const r of rows) if (!r.withinBudget) console.log(`note: ${r.browser} ${r.shots}/s p95 ${r.mainJs.p95.toFixed(3)} ms > ${BUDGET_MS} ms (reported, not gated)`);
}

main().catch((e: unknown) => {
  killServer();
  console.error(e);
  process.exit(1);
});
