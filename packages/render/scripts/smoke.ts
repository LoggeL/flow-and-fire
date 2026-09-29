/**
 * Browser smoke test for @faf/render (`pnpm --filter @faf/render smoke`).
 *
 * 1. Typechecks and builds the demo (packages/render/demo → packages/render/dist/demo).
 * 2. Serves it from a short-lived node:http server on a free port.
 * 3. Runs Chromium, Firefox and WebKit headless ONE AFTER ANOTHER (memory budget) with the same
 *    WebGL2 launch flags as the root playwright.config.ts and checks:
 *    - no shader/GL errors or page errors in the console,
 *    - the canvas is not a single color (decoded screenshot pixels),
 *    - draw calls ≤ visuals + fixed passes,
 *    - context loss → restore brings the picture back (if WEBGL_lose_context exists),
 *    and logs the main-thread JS time per frame.
 * 4. Closes every browser and the server; writes test-results/render-smoke.json.
 *
 * Flags: --browsers=chromium,firefox,webkit  --n=1000  --no-build  --headed
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium, firefox, webkit } from '@playwright/test';
import type { Browser, BrowserType, LaunchOptions, Page } from '@playwright/test';
import { build } from 'vite';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(pkgDir, '../..');
const outDir = resolve(pkgDir, 'dist/demo');
const FIXED_PASS_DRAWS = 3; // ground, waypoint lines, click markers (mirrors src/renderer.ts)

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (argv.includes(`--${name}`) ? '' : undefined);
const browserNames = (arg('browsers') ?? 'chromium,firefox,webkit').split(',').filter((s) => s.length > 0);
const unitCount = Number(arg('n') ?? 1000);
const headed = arg('headed') !== undefined;

// ---------------------------------------------------------------------------------------------
// PNG decoding (8-bit RGB/RGBA, non-interlaced – what Playwright screenshots produce)
// ---------------------------------------------------------------------------------------------

interface Image {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

function decodePng(buf: Uint8Array): Image {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (off < buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(off + 8);
      height = dv.getUint32(off + 12);
      const depth = body[8]!;
      colorType = body[9]!;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) {
        throw new Error(`unsupported PNG (depth ${depth}, color type ${colorType}, interlace ${body[12]})`);
      }
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : 3;
  const stride = width * ch;
  const data = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const r = raw[src + x]!;
      const a = x >= ch ? data[dst + x - ch]! : 0;
      const b = y > 0 ? data[dst - stride + x]! : 0;
      const c = x >= ch && y > 0 ? data[dst - stride + x - ch]! : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = r;
          break;
        case 1:
          v = r + a;
          break;
        case 2:
          v = r + b;
          break;
        case 3:
          v = r + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = r + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error(`bad PNG filter ${filter}`);
      }
      data[dst + x] = v & 255;
    }
  }
  return { width, height, channels: ch, data };
}

interface PixelReport {
  distinctColors: number;
  dominantShare: number;
  /** Pixels whose blue channel dominates (army 0) / red dominates (army 1). */
  bluish: number;
  reddish: number;
}

function analyze(img: Image): PixelReport {
  const counts = new Map<number, number>();
  let samples = 0;
  let bluish = 0;
  let reddish = 0;
  const step = 4;
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const o = (y * img.width + x) * img.channels;
      const r = img.data[o]!;
      const g = img.data[o + 1]!;
      const b = img.data[o + 2]!;
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (b > r + 40 && b > g + 20) bluish++;
      if (r > g + 40 && r > b + 40) reddish++;
      samples++;
    }
  }
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  return { distinctColors: counts.size, dominantShare: max / Math.max(1, samples), bluish, reddish };
}

// ---------------------------------------------------------------------------------------------
// Static server
// ---------------------------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function startServer(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root + sep) && file !== root) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      const body = readFileSync(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
        // Cross-origin isolation: Firefox/WebKit only give sub-millisecond performance.now() then.
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      ok({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Browser runs
// ---------------------------------------------------------------------------------------------

function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  // Same workaround as the root playwright.config.ts (TCC blocks ~/Library/Application Support/Firefox).
  const home = resolve(repoDir, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

function launchConfig(name: string): { type: BrowserType; options: LaunchOptions } {
  const headless = !headed;
  switch (name) {
    case 'chromium':
      return {
        type: chromium,
        options: { headless, args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      };
    case 'firefox': {
      const env = firefoxEnv();
      return {
        type: firefox,
        options: {
          headless,
          ...(env !== undefined ? { env } : {}),
          firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
        },
      };
    }
    case 'webkit':
      return { type: webkit, options: { headless } };
    default:
      throw new Error(`unknown browser ${name}`);
  }
}

interface DemoStats {
  drawCalls: number;
  instances: number;
  visualsDrawn: number;
  droppedUnits: number;
  gpuMs: number | undefined;
  frames: number;
  lost: boolean;
}

interface CpuStats {
  n: number;
  renderMean: number;
  timerResolutionMs: number;
  renderP50: number;
  renderP95: number;
  renderMax: number;
  frameP50: number;
  frameP95: number;
  fps: number;
}

interface BrowserResult {
  browser: string;
  version: string;
  ok: boolean;
  failures: string[];
  renderer?: string;
  multiDraw?: boolean;
  timerQuery?: boolean;
  drawCalls?: number;
  visualCount?: number;
  instances?: number;
  cpu?: CpuStats;
  gpuMs?: number | undefined;
  pixels?: PixelReport;
  contextLoss?: 'ok' | 'unsupported' | 'failed';
  pixelsAfterRestore?: PixelReport;
  consoleErrors: string[];
  durationMs: number;
}

interface DemoApiView {
  ready: boolean;
  frames: number;
  units: number;
  visualCount: number;
  renderer: string;
  caps: { multiDraw: boolean; timerQuery: boolean };
  lost: boolean;
  restores: number;
  glErrors: string[];
  stats(): DemoStats;
  cpuStats(): CpuStats;
  resetSamples(): void;
  loseContext(): boolean;
  restoreContext(): boolean;
  checkErrors(): string[];
}

type DemoWindow = Window & { __renderDemo?: DemoApiView };

async function waitFrames(page: Page, atLeast: number, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const d = (window as DemoWindow).__renderDemo;
      return d !== undefined && d.ready && d.frames >= n;
    },
    atLeast,
    { timeout, polling: 50 },
  );
}

async function framesNow(page: Page): Promise<number> {
  return page.evaluate(() => (window as DemoWindow).__renderDemo?.frames ?? 0);
}

function pixelFailures(tag: string, p: PixelReport): string[] {
  const f: string[] = [];
  if (p.distinctColors < 24) f.push(`${tag}: only ${p.distinctColors} distinct colors (canvas looks uniform)`);
  if (p.dominantShare > 0.9) f.push(`${tag}: one color covers ${(p.dominantShare * 100).toFixed(1)} % of the canvas`);
  if (p.bluish < 20 || p.reddish < 20) f.push(`${tag}: army colors missing (blue ${p.bluish}, red ${p.reddish} samples)`);
  return f;
}

async function runBrowser(name: string, url: string): Promise<BrowserResult> {
  const t0 = Date.now();
  const { type, options } = launchConfig(name);
  const failures: string[] = [];
  const consoleErrors: string[] = [];
  let browser: Browser | null = null;
  const result: BrowserResult = { browser: name, version: '', ok: false, failures, consoleErrors, durationMs: 0 };
  try {
    browser = await type.launch(options);
    result.version = browser.version();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page.on('console', (msg) => {
      const t = msg.type();
      const text = msg.text();
      if (t === 'error') consoleErrors.push(text);
      else if (t === 'warning' && /webgl|shader|gl_|GL ERROR|INVALID_/i.test(text)) consoleErrors.push(`warning: ${text}`);
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(`${url}?n=${unitCount}`, { waitUntil: 'load' });
    await waitFrames(page, 60);
    await page.evaluate(() => (window as DemoWindow).__renderDemo!.resetSamples());
    // Measure ~2 s of steady-state frames (at least 120 frames or until the timeout).
    const start = await framesNow(page);
    await page.waitForTimeout(2000);
    await waitFrames(page, start + 60);

    const info = await page.evaluate(() => {
      const d = (window as DemoWindow).__renderDemo!;
      return {
        renderer: d.renderer,
        caps: d.caps,
        visualCount: d.visualCount,
        units: d.units,
        stats: d.stats(),
        cpu: d.cpuStats(),
        glErrors: d.glErrors.concat(d.checkErrors()),
      };
    });
    result.renderer = info.renderer;
    result.multiDraw = info.caps.multiDraw;
    result.timerQuery = info.caps.timerQuery;
    result.drawCalls = info.stats.drawCalls;
    result.visualCount = info.visualCount;
    result.instances = info.stats.instances;
    result.cpu = info.cpu;
    result.gpuMs = info.stats.gpuMs;
    if (info.glErrors.length > 0) failures.push(`GL errors: ${info.glErrors.join(', ')}`);
    if (info.stats.drawCalls > info.visualCount + FIXED_PASS_DRAWS) {
      failures.push(`draw calls ${info.stats.drawCalls} > visuals ${info.visualCount} + fixed passes ${FIXED_PASS_DRAWS}`);
    }
    if (info.stats.drawCalls < 1 + info.visualCount) failures.push(`only ${info.stats.drawCalls} draw calls`);
    if (info.stats.instances < info.units) failures.push(`only ${info.stats.instances} instances drawn (${info.units} units)`);

    const shot = await page.locator('canvas#view').screenshot({ type: 'png' });
    result.pixels = analyze(decodePng(new Uint8Array(shot)));
    failures.push(...pixelFailures('screenshot', result.pixels));

    // Context loss → restore (P10 groundwork): the registry must bring the picture back.
    const lostOk = await page.evaluate(() => (window as DemoWindow).__renderDemo!.loseContext());
    if (!lostOk) result.contextLoss = 'unsupported';
    else {
      try {
        await page.waitForFunction(() => (window as DemoWindow).__renderDemo!.lost, undefined, { timeout: 10_000 });
        await page.evaluate(() => (window as DemoWindow).__renderDemo!.restoreContext());
        await page.waitForFunction(
          () => {
            const d = (window as DemoWindow).__renderDemo!;
            return !d.lost && d.restores >= 1;
          },
          undefined,
          { timeout: 10_000 },
        );
        await waitFrames(page, (await framesNow(page)) + 30);
        const shot2 = await page.locator('canvas#view').screenshot({ type: 'png' });
        result.pixelsAfterRestore = analyze(decodePng(new Uint8Array(shot2)));
        const f2 = pixelFailures('after restore', result.pixelsAfterRestore);
        const errs = await page.evaluate(() => (window as DemoWindow).__renderDemo!.checkErrors());
        if (errs.length > 0) f2.push(`GL errors after restore: ${errs.join(', ')}`);
        failures.push(...f2);
        result.contextLoss = f2.length === 0 ? 'ok' : 'failed';
      } catch (e) {
        result.contextLoss = 'failed';
        failures.push(`context loss/restore: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    // Console errors are fatal except the expected context-loss notices some engines print.
    const fatal = consoleErrors.filter((m) => !/context (was )?lost|CONTEXT_LOST_WEBGL|loseContext|restoreContext/i.test(m));
    if (fatal.length > 0) failures.push(`console errors: ${fatal.slice(0, 5).join(' | ')}`);
  } catch (e) {
    failures.push(`run failed: ${(e as Error).message.split('\n').slice(0, 3).join(' ')}`);
  } finally {
    if (browser !== null) await browser.close();
    result.durationMs = Date.now() - t0;
  }
  result.ok = failures.length === 0;
  return result;
}

function fmt(v: number | undefined, d = 3): string {
  return v === undefined ? 'n/a' : v.toFixed(d);
}

async function main(): Promise<void> {
  if (arg('no-build') === undefined) {
    const tsc = spawnSync(process.execPath, [resolve(repoDir, 'node_modules/typescript/bin/tsc'), '-p', resolve(pkgDir, 'demo/tsconfig.json')], {
      stdio: 'inherit',
    });
    if (tsc.status !== 0) throw new Error('demo typecheck failed');
    await build({ configFile: resolve(pkgDir, 'vite.config.ts'), logLevel: 'warn' });
  }
  const server = await startServer(outDir);
  const results: BrowserResult[] = [];
  try {
    for (const name of browserNames) {
      process.stdout.write(`[smoke] ${name} …\n`);
      const r = await runBrowser(name, server.url);
      results.push(r);
      const c = r.cpu;
      process.stdout.write(
        `[smoke] ${name} ${r.version}: ${r.ok ? 'OK' : 'FAIL'} | ${r.renderer ?? '?'} | draws ${r.drawCalls ?? '?'} ` +
          `(visuals ${r.visualCount ?? '?'} + ${FIXED_PASS_DRAWS}) | inst ${r.instances ?? '?'} | ` +
          `render-JS mean ${fmt(c?.renderMean)} p50 ${fmt(c?.renderP50)} p95 ${fmt(c?.renderP95)} max ${fmt(c?.renderMax)} ms ` +
          `(timer ${fmt(c?.timerResolutionMs)} ms) | ` +
          `frame-JS p95 ${fmt(c?.frameP95)} ms | ${fmt(c?.fps, 1)} FPS | GPU ${fmt(r.gpuMs, 2)} ms | ` +
          `colors ${r.pixels?.distinctColors ?? '?'} | ctx-loss ${r.contextLoss ?? '?'} | ${r.durationMs} ms\n`,
      );
      for (const f of r.failures) process.stdout.write(`[smoke]   ✗ ${f}\n`);
    }
  } finally {
    await server.close();
  }
  const outFile = resolve(repoDir, 'test-results/render-smoke.json');
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ date: new Date().toISOString(), units: unitCount, results }, null, 2));
  process.stdout.write(`[smoke] results → ${outFile}\n`);
  if (results.some((r) => !r.ok) || results.length === 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
