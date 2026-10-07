/**
 * Screenshot tool of the fx-lab (development aid, `pnpm --filter @faf/fx-lab run shot -- …`; always through
 * the memory gate: `tools/heavy pnpm --filter @faf/fx-lab run shot -- --scenes=lighting`).
 *
 * 1. Vite build of apps/fx-lab → apps/fx-lab/dist (programmatic, no dev server).
 * 2. Browsers ONE AFTER ANOTHER with the launch flags of the root playwright.config.ts; the page is served
 *    through `page.route` under a virtual origin (COOP/COEP/CORP headers) – no port is opened.
 * 3. Per scene and freeze time: load `index.html?scene=…&preset=…&freeze=T&bench=1` → wait for
 *    `__fxlab.ready` → check `__fxlab.error`, page errors and GL/shader console messages → canvas not
 *    uniform → screenshot test-results/fx-lab-shots/<scene>[-t<T>][-<variant>]-<browser>.png.
 *    `--lose` additionally runs loseContext → restoreContext and saves `…-restored-<browser>.png`.
 * 4. Exit code 1 on any error. Browsers are always closed.
 *
 * Flags:
 *   --scenes=lighting,battle          scenes (default lighting)
 *   --browsers=chromium,firefox       browsers (default chromium)
 *   --freeze=6 | --freeze=6,battle:12,big:1.6|4
 *                                     freeze time(s): a plain number is the default for every scene,
 *                                     `scene:T1|T2` overrides it (several times → one shot per time, `-t<T>` in the name)
 *   --preset=medium  --size=1280x720  --seed=1
 *   --params=hdr=0&fx=0               extra URL parameters; they become part of the file name (`-hdr0-fx0`)
 *   --hud                             keep the HUD (default: bench=1, HUD off)
 *   --lose                            context loss + restore after the shot
 *   --measure=2                       after the shot: sample N seconds and print p50 of frame/JS/GPU times
 *   --headed  --no-build
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium, firefox, webkit } from '@playwright/test';
import type { Browser, BrowserType, LaunchOptions, Page } from '@playwright/test';
import { build } from 'vite';
// Brings the `window.__fxlab` declaration (FxLabHooks) into scope for page.evaluate.
import type {} from '../src/app/hooks.ts';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(APP_DIR, '../..');
const DIST_DIR = resolve(APP_DIR, 'dist');
const SHOTS_DIR = resolve(REPO_DIR, 'test-results/fx-lab-shots');
const ORIGIN = 'https://faf-fx-lab.test';
const SCENES = ['lighting', 'battle', 'shields', 'big', 'gallery'] as const;

// pnpm may forward a literal `--` before the flags.
const argv = process.argv.slice(2).filter((a) => a !== '--');
const flag = (name: string): string | undefined =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? (argv.includes(`--${name}`) ? '' : undefined);

const known = new Set(['scenes', 'browsers', 'freeze', 'preset', 'size', 'seed', 'params', 'hud', 'lose', 'measure', 'headed', 'no-build']);
for (const a of argv) {
  const m = /^--([a-z-]+)/.exec(a);
  if (m === null || !known.has(m[1]!)) throw new Error(`shot: unknown argument '${a}' (known: ${[...known].map((k) => `--${k}`).join(' ')})`);
}

const headed = flag('headed') !== undefined;
const noBuild = flag('no-build') !== undefined;
const keepHud = flag('hud') !== undefined;
const lose = flag('lose') !== undefined;
const measureS = Number(flag('measure') ?? '0');
if (!Number.isFinite(measureS) || measureS < 0) throw new Error('shot: --measure needs seconds');
const browserNames = (flag('browsers') ?? 'chromium').split(',').filter((s) => s.length > 0);
const sceneNames = (flag('scenes') ?? 'lighting').split(',').filter((s) => s.length > 0);
for (const s of sceneNames) if (!(SCENES as readonly string[]).includes(s)) throw new Error(`shot: unknown scene '${s}' (have: ${SCENES.join(', ')})`);
const preset = flag('preset') ?? 'medium';
const seed = flag('seed') ?? '1';
const sizeRaw = flag('size') ?? '1280x720';
const sizeMatch = /^(\d+)x(\d+)$/.exec(sizeRaw);
if (sizeMatch === null) throw new Error(`shot: --size must look like 1280x720, got '${sizeRaw}'`);
const VIEWPORT = { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) };
const extra = new URLSearchParams(flag('params') ?? '');
const variant = [...extra.entries()].map(([k, v]) => `${k}${v}`.replace(/[^a-zA-Z0-9.]/g, '')).join('-');

/** Freeze times per scene from `--freeze`. */
function parseFreeze(raw: string): (scene: string) => number[] {
  let def: number[] = [6];
  const per = new Map<string, number[]>();
  const num = (s: string): number => {
    const n = Number(s);
    if (s.trim() === '' || !Number.isFinite(n) || n < 0) throw new Error(`shot: invalid freeze time '${s}'`);
    return n;
  };
  for (const part of raw.split(',').filter((s) => s.length > 0)) {
    const i = part.indexOf(':');
    if (i < 0) def = part.split('|').map(num);
    else per.set(part.slice(0, i), part.slice(i + 1).split('|').map(num));
  }
  return (scene) => per.get(scene) ?? def;
}
const freezeFor = parseFreeze(flag('freeze') ?? '6');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

/** Console messages that are real GL errors (everything else from WebGL is an implementation note). */
const GL_ERROR_RE = /GL_INVALID|INVALID_(OPERATION|ENUM|VALUE|FRAMEBUFFER_OPERATION)|OUT_OF_MEMORY|CONTEXT_LOST|compile|link(ing)? (failed|error)|shader.*error|error.*shader/i;
/** The context loss is provoked on purpose with --lose – its console notes are expected. */
const EXPECTED_LOSS_RE = /context (was )?lost|CONTEXT_LOST_WEBGL|WebGL context was lost|restored/i;

const COI_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

/** See root playwright.config.ts: macOS denies Firefox its default profile folder. */
function firefoxEnv(): Record<string, string> | undefined {
  if (process.platform !== 'darwin') return undefined;
  const home = resolve(REPO_DIR, 'node_modules/.cache/faf-firefox-home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env['CFFIXED_USER_HOME'] = home;
  return env;
}

function launchConfig(name: string): { type: BrowserType; options: LaunchOptions } {
  switch (name) {
    case 'chromium':
      return { type: chromium, options: { headless: !headed, args: ['--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };
    case 'firefox': {
      const env = firefoxEnv();
      return {
        type: firefox,
        options: {
          headless: !headed,
          ...(env !== undefined ? { env } : {}),
          firefoxUserPrefs: { 'webgl.force-enabled': true, 'webgl.disabled': false },
        },
      };
    }
    case 'webkit':
      return { type: webkit, options: { headless: !headed } };
    default:
      throw new Error(`shot: unknown browser '${name}'`);
  }
}

async function servePage(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = resolve(DIST_DIR, '.' + rel);
    if (!(file === DIST_DIR || file.startsWith(DIST_DIR + sep)) || !existsSync(file)) {
      await route.fulfill({ status: 404, body: 'not found', headers: COI_HEADERS });
      return;
    }
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: TYPES[extname(file)] ?? 'application/octet-stream', headers: COI_HEADERS });
  });
}

/**
 * Luma spread of an 8-bit RGB(A) PNG (non-interlaced, as Playwright writes them): max − min over a
 * sample grid. A uniform (black/cleared) canvas gives ≈ 0.
 */
function pngLumaSpread(png: Buffer): number {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0;
  let h = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG: only 8-bit non-interlaced images are supported');
      colorType = data[9]!;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bpp === 0) throw new Error(`PNG: unsupported color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let min = 255;
  let max = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const b = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      let v = line[x]!;
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    if (y % 8 === 0) {
      for (let x = 0; x < w; x += 8) {
        const i = x * bpp;
        const l = (cur[i]! * 54 + cur[i + 1]! * 183 + cur[i + 2]! * 19) >> 8;
        if (l < min) min = l;
        if (l > max) max = l;
      }
    }
    cur.copy(prev);
  }
  return max - min;
}

interface ShotResult {
  name: string;
  ok: boolean;
  errors: string[];
  summary: string;
}

/** Samples `measureS` seconds of the running page and formats p50 values (GPU only where timer queries exist). */
async function measure(page: Page): Promise<string> {
  await page.evaluate(() => window.__fxlab!.resetSamples());
  await page.waitForTimeout(measureS * 1000);
  // GPU results arrive a few frames late; the newest samples may not be resolved yet.
  const samples = await page.evaluate(() => window.__fxlab!.samples().slice(0, -8));
  const p50 = (vals: number[]): number | null => {
    if (vals.length === 0) return null;
    const v = [...vals].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)]!;
  };
  const f = (v: number | null): string => (v === null ? 'n/v' : v.toFixed(2));
  const pick = (get: (x: (typeof samples)[number]) => number | null): number | null =>
    p50(samples.map(get).filter((v): v is number => v !== null));
  const segs = ['shadow', 'opaque', 'shields', 'particles', 'beams', 'post'] as const;
  return (
    `p50 over ${samples.length} frames: frame ${f(pick((x) => x.frameMs))} ms | mainJs ${f(pick((x) => x.mainJsMs))} | fxJs ${f(pick((x) => x.fxJsMs))} | ` +
    `labJs ${f(pick((x) => x.labJsMs))} | gpu ${f(pick((x) => x.gpuMs))} (${segs.map((k) => `${k} ${f(pick((x) => x.gpuSeg[k]))}`).join(', ')})`
  );
}

function fileBase(scene: string, t: number, multi: boolean): string {
  return [scene, multi ? `t${t}` : '', variant].filter((s) => s.length > 0).join('-');
}

async function runShot(browser: Browser, browserName: string, scene: string, t: number, multi: boolean): Promise<ShotResult> {
  const base = fileBase(scene, t, multi);
  const result: ShotResult = { name: `${base}-${browserName}`, ok: false, errors: [], summary: '' };
  const errors = result.errors;
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  let losing = false;
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (losing && EXPECTED_LOSS_RE.test(text)) return;
      if (type === 'error' || (type === 'warning' && GL_ERROR_RE.test(text))) errors.push(`console.${type}: ${text.slice(0, 400)}`);
    });
    await servePage(page);
    const q = new URLSearchParams({ scene, preset, seed, freeze: String(t) });
    if (!keepHud) q.set('bench', '1');
    for (const [k, v] of extra) q.set(k, v);
    await page.goto(`${ORIGIN}/index.html?${q.toString()}`);
    await page.waitForFunction(() => window.__fxlab !== undefined && (window.__fxlab.ready || window.__fxlab.error !== null), undefined, {
      timeout: 120_000,
    });
    const s = await page.evaluate(() => {
      const h = window.__fxlab!;
      if (h.error !== null) return { error: h.error, scene: h.scene, stats: null };
      return { error: null, scene: h.scene, stats: h.stats() };
    });
    if (s.error !== null) errors.push(`__fxlab.error: ${s.error}`);
    if (s.scene !== scene) errors.push(`scene is '${s.scene}', expected '${scene}' (not registered?)`);
    if (s.stats !== null) {
      const st = s.stats;
      const p = st.fx.particles;
      result.summary =
        `draws ${st.draws} (shadow ${st.drawsBySeg.shadow}, opaque ${st.drawsBySeg.opaque}, shields ${st.drawsBySeg.shields}, ` +
        `particles ${st.drawsBySeg.particles}, beams ${st.drawsBySeg.beams}, post ${st.drawsBySeg.post}) | units ${st.units} | ` +
        `decals ${st.decals.count}/${st.decals.cap} | ${st.post.hdr ? 'HDR' : 'LDR'} bloom ${st.post.levels} | csm ${st.csm.enabled ? `static ${st.csm.staticRefreshes}` : 'off'} | ` +
        `particles ${p === null ? '–' : `${p.alive}/${p.cap} dropped ${p.dropped.join('/')}`} | canvas ${st.canvas.join('×')}`;
    }
    mkdirSync(SHOTS_DIR, { recursive: true });
    const shot = resolve(SHOTS_DIR, `${base}-${browserName}.png`);
    const png = await page.locator('canvas').screenshot({ path: shot });
    const spread = pngLumaSpread(png);
    if (spread < 12) errors.push(`canvas is (nearly) uniform: luma spread ${spread}`);

    if (measureS > 0 && s.error === null) result.summary += `\n        ${await measure(page)}`;

    if (lose && s.error === null) {
      losing = true;
      const lost = await page.evaluate(() => window.__fxlab!.loseContext());
      if (!lost) {
        result.summary += ' | context loss unsupported';
      } else {
        await page.waitForFunction(() => window.__fxlab!.restoreContext() || window.__fxlab!.restoreCount > 0, undefined, { timeout: 10_000, polling: 100 });
        await page.waitForFunction(() => window.__fxlab!.restoreCount > 0, undefined, { timeout: 10_000 });
        const f0 = await page.evaluate(() => window.__fxlab!.frame);
        await page.waitForFunction((f) => window.__fxlab!.frame > f + 5, f0, { timeout: 20_000 });
        const after = await page.evaluate(() => ({ error: window.__fxlab!.error, restores: window.__fxlab!.restoreCount }));
        if (after.error !== null) errors.push(`after restore: ${after.error}`);
        if (after.restores !== 1) errors.push(`restoreCount ${after.restores}, expected 1`);
        const png2 = await page.locator('canvas').screenshot({ path: resolve(SHOTS_DIR, `${base}-restored-${browserName}.png`) });
        const spread2 = pngLumaSpread(png2);
        if (spread2 < 12) errors.push(`canvas after restore is (nearly) uniform: luma spread ${spread2}`);
        result.summary += ` | restored (spread ${spread2})`;
      }
      losing = false;
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message.split('\n')[0]! : String(e));
  } finally {
    await context.close();
  }
  result.ok = errors.length === 0;
  return result;
}

async function runBrowser(name: string): Promise<boolean> {
  const { type, options } = launchConfig(name);
  let browser: Browser | null = null;
  let ok = true;
  try {
    browser = await type.launch(options);
    console.log(`fx-lab shot: ${name} ${browser.version()}`);
    for (const scene of sceneNames) {
      const times = freezeFor(scene);
      for (const t of times) {
        const r = await runShot(browser, name, scene, t, times.length > 1);
        ok &&= r.ok;
        console.log(`  ${r.ok ? 'ok   ' : 'ERROR'} ${r.name}.png  ${r.summary}`);
        for (const e of r.errors) console.log(`    ! ${e}`);
      }
    }
  } catch (e) {
    ok = false;
    console.log(`  ${name}: FAILED ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (browser !== null) await browser.close();
  }
  return ok;
}

async function main(): Promise<number> {
  if (!noBuild) {
    console.log('fx-lab shot: building …');
    await build({ configFile: resolve(APP_DIR, 'vite.config.ts'), logLevel: 'warn' });
  }
  if (!existsSync(resolve(DIST_DIR, 'index.html'))) throw new Error('apps/fx-lab/dist/index.html missing (build failed?)');
  console.log(
    `fx-lab shot: scenes ${sceneNames.join(', ')} | browsers ${browserNames.join(', ')} | preset ${preset} | ${VIEWPORT.width}×${VIEWPORT.height}` +
      (variant.length > 0 ? ` | params ${extra.toString()}` : ''),
  );
  let ok = true;
  for (const b of browserNames) ok = (await runBrowser(b)) && ok;
  console.log(`fx-lab shot: ${ok ? 'ok' : 'FAILED'} – ${SHOTS_DIR}`);
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
